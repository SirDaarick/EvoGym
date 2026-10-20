"""Tests for cash registers, payment terminals, shifts, and concurrency controls (BK-020)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.auth.admin import authenticate_admin
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import (
    Branch,
    CashRegister,
    PaymentTerminal,
    RoleGrant,
    Shift,
    StaffCredential,
    StaffUser,
)
from app.main import create_app
from app.shifts.queries import (
    CashRegisterNotFoundError,
    ShiftAlreadyOpenError,
    create_cash_register,
    create_payment_terminal,
    get_cash_register,
    get_open_shift,
    get_shift_by_id,
    list_cash_registers,
    list_payment_terminals,
    open_shift,
)
from test_admin_auth import configured_settings, seed_admin


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'shifts-test.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    return url, engine, factory


def _seed_branch(factory, code="central", name="Central Branch") -> UUID:
    with factory.begin() as session:
        branch = Branch(code=code, name=name)
        session.add(branch)
        session.flush()
        return branch.id


def _seed_staff_user(factory, login="staff@evogym.com") -> UUID:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        return staff.id


def _seed_receptionist(factory, branch_id: UUID, login="receptionist@evogym.com", pin="1234") -> tuple[UUID, str]:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch_id),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin(pin)),
        ])
        staff_id = staff.id

    now = datetime.now(timezone.utc)
    issued = issue_session(factory, login, pin, branch_id, now + timedelta(hours=1))
    return staff_id, issued.token


# ==============================================================================
# Model & Query Level Tests
# ==============================================================================


def test_payment_terminal_creation_and_per_branch_uniqueness(tmp_path):
    """Verify terminal creation, listing, and per-branch code uniqueness."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory, "branch-1", "Branch One")
        b2 = _seed_branch(factory, "branch-2", "Branch Two")

        with factory() as session:
            t1 = create_payment_terminal(
                session,
                branch_id=b1,
                code="point_01",
                name="Point Central 1",
                device_id="MP-POINT-001",
                provider="mercado_pago",
            )
            session.commit()
            assert t1.id is not None
            assert t1.code == "point_01"
            assert t1.status == "active"

        # Duplicate code in same branch must fail
        with factory() as session:
            with pytest.raises(IntegrityError):
                create_payment_terminal(
                    session,
                    branch_id=b1,
                    code="point_01",
                    name="Duplicate Code Point",
                    device_id="MP-POINT-002",
                )

        # Same code in a different branch must succeed
        with factory() as session:
            t_b2 = create_payment_terminal(
                session,
                branch_id=b2,
                code="point_01",
                name="Point Branch 2",
                device_id="MP-POINT-003",
            )
            session.commit()
            assert t_b2.id is not None

        # Listing terminals filtered by branch
        with factory() as session:
            b1_terms = list_payment_terminals(session, branch_id=b1)
            assert len(b1_terms) == 1
            assert b1_terms[0].code == "point_01"

            all_terms = list_payment_terminals(session)
            assert len(all_terms) == 2
    finally:
        engine.dispose()


def test_cash_register_creation_and_terminal_linkage(tmp_path):
    """Verify cash register creation, terminal linkage, and uniqueness."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory, "branch-1", "Branch One")

        with factory() as session:
            terminal = create_payment_terminal(
                session,
                branch_id=b1,
                code="term_front",
                name="Front Desk Terminal",
                device_id="MP-DEV-99",
            )
            session.commit()
            term_id = terminal.id

        with factory() as session:
            reg = create_cash_register(
                session,
                branch_id=b1,
                code="reg_01",
                name="Register 01",
                default_terminal_id=term_id,
            )
            session.commit()
            assert reg.id is not None
            assert reg.code == "reg_01"
            assert reg.default_terminal_id == term_id

        with factory() as session:
            loaded_reg = get_cash_register(session, reg.id)
            assert loaded_reg is not None
            assert loaded_reg.default_terminal is not None
            assert loaded_reg.default_terminal.id == term_id
            assert loaded_reg.default_terminal.code == "term_front"

        # Duplicate register code in same branch must fail
        with factory() as session:
            with pytest.raises(IntegrityError):
                create_cash_register(
                    session,
                    branch_id=b1,
                    code="reg_01",
                    name="Duplicate Register",
                )
    finally:
        engine.dispose()


def test_shift_open_lifecycle_and_single_active_invariant(tmp_path):
    """Verify shift opening, actor/timestamp retention, and at most one open shift per register."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory)
        staff1_id = _seed_staff_user(factory, "staff1@evogym.com")
        staff2_id = _seed_staff_user(factory, "staff2@evogym.com")

        with factory() as session:
            reg1 = create_cash_register(session, branch_id=b1, code="reg_main", name="Main Register")
            reg2 = create_cash_register(session, branch_id=b1, code="reg_side", name="Side Register")
            session.commit()
            reg1_id = reg1.id
            reg2_id = reg2.id

        # 1. Open shift on reg1
        with factory() as session:
            shift1 = open_shift(
                session,
                register_id=reg1_id,
                opened_by=staff1_id,
                opening_cash_minor=50000,  # $500.00
            )
            session.commit()
            assert shift1.id is not None
            assert shift1.status == "open"
            assert shift1.opening_cash_minor == 50000
            assert shift1.opened_by == staff1_id
            assert shift1.opened_at is not None
            assert shift1.closed_at is None
            shift1_id = shift1.id

        # 2. Attempting to open a second shift on reg1 raises ShiftAlreadyOpenError
        with factory() as session:
            with pytest.raises(ShiftAlreadyOpenError):
                open_shift(
                    session,
                    register_id=reg1_id,
                    opened_by=staff2_id,
                    opening_cash_minor=20000,
                )

        # 3. Direct DB insert violating partial unique index uq_shifts_active_per_register raises IntegrityError
        with factory() as session:
            illegal_shift = Shift(
                cash_register_id=reg1_id,
                opened_by=staff2_id,
                opening_cash_minor=10000,
                status="open",
            )
            session.add(illegal_shift)
            with pytest.raises(IntegrityError):
                session.commit()

        # 4. Opening a shift on reg2 succeeds (independent registers)
        with factory() as session:
            shift2 = open_shift(
                session,
                register_id=reg2_id,
                opened_by=staff2_id,
                opening_cash_minor=30000,
            )
            session.commit()
            assert shift2.id is not None
            assert shift2.status == "open"

        # 5. Get current open shift
        with factory() as session:
            current = get_open_shift(session, reg1_id)
            assert current is not None
            assert current.id == shift1_id

            shift_by_id = get_shift_by_id(session, shift1_id)
            assert shift_by_id is not None
            assert shift_by_id.cash_register_id == reg1_id

        # 6. Close shift 1, now a new shift can be opened on reg1
        with factory() as session:
            s1 = session.get(Shift, shift1_id)
            s1.status = "closed"
            s1.closed_by = staff1_id
            s1.closed_at = datetime.now(timezone.utc)
            s1.counted_cash_minor = 55000
            session.commit()

        with factory() as session:
            # Current open shift is now None
            assert get_open_shift(session, reg1_id) is None

            # New shift can now be opened on reg1
            shift3 = open_shift(
                session,
                register_id=reg1_id,
                opened_by=staff2_id,
                opening_cash_minor=60000,
            )
            session.commit()
            assert shift3.id is not None
            assert shift3.status == "open"
    finally:
        engine.dispose()


def test_negative_opening_cash_rejected(tmp_path):
    """Verify negative opening cash is rejected both by Python check and DB constraint."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory)
        staff_id = _seed_staff_user(factory)

        with factory() as session:
            reg = create_cash_register(session, branch_id=b1, code="reg_neg", name="Negative Reg")
            session.commit()
            reg_id = reg.id

        # Python check
        with factory() as session:
            with pytest.raises(ValueError, match="Opening cash cannot be negative"):
                open_shift(session, register_id=reg_id, opened_by=staff_id, opening_cash_minor=-100)

        # Database CheckConstraint
        with factory() as session:
            neg_shift = Shift(
                cash_register_id=reg_id,
                opened_by=staff_id,
                opening_cash_minor=-500,
                status="open",
            )
            session.add(neg_shift)
            with pytest.raises(IntegrityError):
                session.commit()
    finally:
        engine.dispose()


def test_concurrent_open_shift_yields_exactly_one_success(tmp_path):
    """Simulate concurrent threads attempting to open shift on the same register simultaneously."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory)
        staff1_id = _seed_staff_user(factory, "worker1@evogym.com")
        staff2_id = _seed_staff_user(factory, "worker2@evogym.com")

        with factory() as session:
            reg = create_cash_register(session, branch_id=b1, code="reg_race", name="Race Register")
            session.commit()
            reg_id = reg.id

        results = []
        errors = []

        def attempt_open(staff_id: UUID, cash: int):
            try:
                with factory() as session:
                    shift = open_shift(
                        session,
                        register_id=reg_id,
                        opened_by=staff_id,
                        opening_cash_minor=cash,
                    )
                    session.commit()
                    results.append(shift.id)
            except ShiftAlreadyOpenError as err:
                errors.append(err)
            except Exception as e:
                errors.append(e)

        with ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(attempt_open, staff1_id, 10000)
            f2 = executor.submit(attempt_open, staff2_id, 20000)
            f1.result()
            f2.result()

        # Exactly one open attempt must have succeeded and one must have failed with ShiftAlreadyOpenError
        assert len(results) == 1, f"Expected 1 success, got {len(results)}"
        assert len(errors) == 1, f"Expected 1 error, got {len(errors)}"
        assert isinstance(errors[0], ShiftAlreadyOpenError)
    finally:
        engine.dispose()


# ==============================================================================
# API & RBAC Integration Tests
# ==============================================================================


def test_shifts_and_registers_rbac_and_api(tmp_path):
    """Verify RBAC permissions for Receptionist vs Admin across terminals, registers, and shifts."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch1_id = _seed_branch(factory, "branch-1", "Branch 1")
        branch2_id = _seed_branch(factory, "branch-2", "Branch 2")

        _staff1_id, recep1_token = _seed_receptionist(factory, branch1_id, "receptionist1@evogym.com", "1111")
        _staff2_id, recep2_token = _seed_receptionist(factory, branch2_id, "receptionist2@evogym.com", "2222")

        seed_admin(factory, "admin@example.invalid", "super-admin-pass")
        admin_token_obj = authenticate_admin(factory, "admin@example.invalid", "super-admin-pass", 3600, uuid4())
        admin_token = admin_token_obj.token

        app = create_app(configured_settings(url))

        r1_headers = {"Authorization": f"Bearer {recep1_token}"}
        r2_headers = {"Authorization": f"Bearer {recep2_token}"}
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        with TestClient(app) as client:
            # 1. Unauthenticated gets 401
            assert client.get("/api/v1/terminals").status_code == 401
            assert client.get("/api/v1/registers").status_code == 401
            assert client.post("/api/v1/shifts/open", json={"cash_register_id": str(uuid4()), "opening_cash_minor": 0}).status_code == 401

            # 2. Receptionist cannot create a terminal (403)
            res_r_term = client.post(
                "/api/v1/terminals",
                headers=r1_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "term_b1",
                    "name": "B1 Terminal",
                    "device_id": "DEV-01",
                },
            )
            assert res_r_term.status_code == 403

            # 3. Receptionist cannot create a cash register (403)
            res_r_reg = client.post(
                "/api/v1/registers",
                headers=r1_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "reg_b1",
                    "name": "B1 Cash Register",
                },
            )
            assert res_r_reg.status_code == 403

            # 4. Admin creates terminal for branch 1 (201)
            res_a_t1 = client.post(
                "/api/v1/terminals",
                headers=admin_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "term_b1",
                    "name": "B1 Terminal",
                    "device_id": "DEV-01",
                },
            )
            assert res_a_t1.status_code == 201
            t1_data = res_a_t1.json()
            assert t1_data["code"] == "term_b1"
            assert t1_data["provider"] == "mercado_pago"
            t1_id = t1_data["id"]

            # Admin duplicate code in same branch -> 409
            res_a_dup_term = client.post(
                "/api/v1/terminals",
                headers=admin_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "term_b1",
                    "name": "Duplicate Code",
                    "device_id": "DEV-02",
                },
            )
            assert res_a_dup_term.status_code == 409

            # 5. Admin creates cash registers for branch 1 and branch 2
            res_a_reg1 = client.post(
                "/api/v1/registers",
                headers=admin_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "caja_01",
                    "name": "Caja 1 Front Desk",
                    "default_terminal_id": t1_id,
                },
            )
            assert res_a_reg1.status_code == 201
            reg1_data = res_a_reg1.json()
            assert reg1_data["code"] == "caja_01"
            assert reg1_data["has_open_shift"] is False
            reg1_id = reg1_data["id"]

            res_a_reg2 = client.post(
                "/api/v1/registers",
                headers=admin_headers,
                json={
                    "branch_id": str(branch2_id),
                    "code": "caja_b2",
                    "name": "Caja Branch 2",
                },
            )
            assert res_a_reg2.status_code == 201
            reg2_id = res_a_reg2.json()["id"]

            # Admin duplicate register code in same branch -> 409
            res_a_dup_reg = client.post(
                "/api/v1/registers",
                headers=admin_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "caja_01",
                    "name": "Duplicate Register",
                },
            )
            assert res_a_dup_reg.status_code == 409

            # 6. Receptionist 1 lists terminals in Branch 1 (sees 1)
            res_r1_terms = client.get("/api/v1/terminals", headers=r1_headers)
            assert res_r1_terms.status_code == 200
            assert len(res_r1_terms.json()) == 1

            # Receptionist 1 trying to list branch 2 terminals -> 403
            res_r1_terms_b2 = client.get(f"/api/v1/terminals?branch_id={branch2_id}", headers=r1_headers)
            assert res_r1_terms_b2.status_code == 403

            # Receptionist 1 lists registers (sees only Branch 1 register)
            res_r1_regs = client.get("/api/v1/registers", headers=r1_headers)
            assert res_r1_regs.status_code == 200
            regs = res_r1_regs.json()
            assert len(regs) == 1
            assert regs[0]["id"] == reg1_id
            assert regs[0]["has_open_shift"] is False

            # Receptionist 1 checks current shift when none open -> 404
            res_r1_curr_none = client.get(f"/api/v1/shifts/current?register_id={reg1_id}", headers=r1_headers)
            assert res_r1_curr_none.status_code == 404

            # 7. Receptionist 1 opens shift on Branch 1 register (201)
            res_r1_open = client.post(
                "/api/v1/shifts/open",
                headers=r1_headers,
                json={
                    "cash_register_id": reg1_id,
                    "opening_cash_minor": 150000,  # $1,500.00
                },
            )
            assert res_r1_open.status_code == 201
            shift1_data = res_r1_open.json()
            assert shift1_data["cash_register_id"] == reg1_id
            assert shift1_data["status"] == "open"
            assert shift1_data["opening_cash_minor"] == 150000
            shift1_id = shift1_data["id"]

            # Receptionist 1 trying to open SECOND shift on same register -> 409
            res_r1_open_dup = client.post(
                "/api/v1/shifts/open",
                headers=r1_headers,
                json={
                    "cash_register_id": reg1_id,
                    "opening_cash_minor": 50000,
                },
            )
            assert res_r1_open_dup.status_code == 409

            # Negative opening cash -> 422
            res_r1_open_neg = client.post(
                "/api/v1/shifts/open",
                headers=r1_headers,
                json={
                    "cash_register_id": reg1_id,
                    "opening_cash_minor": -10,
                },
            )
            assert res_r1_open_neg.status_code == 422

            # Receptionist 1 attempting to open shift on Branch 2 register -> 403
            res_r1_open_b2 = client.post(
                "/api/v1/shifts/open",
                headers=r1_headers,
                json={
                    "cash_register_id": reg2_id,
                    "opening_cash_minor": 10000,
                },
            )
            assert res_r1_open_b2.status_code == 403

            # Receptionist 1 queries current shift -> 200 with open shift
            res_r1_curr = client.get(f"/api/v1/shifts/current?register_id={reg1_id}", headers=r1_headers)
            assert res_r1_curr.status_code == 200
            assert res_r1_curr.json()["id"] == shift1_id

            # Receptionist 1 queries shift by ID -> 200
            res_r1_shift_by_id = client.get(f"/api/v1/shifts/{shift1_id}", headers=r1_headers)
            assert res_r1_shift_by_id.status_code == 200
            assert res_r1_shift_by_id.json()["id"] == shift1_id

            # Registers list now reflects has_open_shift=True
            res_r1_regs_updated = client.get("/api/v1/registers", headers=r1_headers)
            assert res_r1_regs_updated.status_code == 200
            assert res_r1_regs_updated.json()[0]["has_open_shift"] is True

            # Admin can list all registers across branches
            res_a_all_regs = client.get("/api/v1/registers", headers=admin_headers)
            assert res_a_all_regs.status_code == 200
            assert len(res_a_all_regs.json()) == 2
    finally:
        engine.dispose()
