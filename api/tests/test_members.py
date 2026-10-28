"""Tests for Member read DTO, query, and API contract (BK-013)."""
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session, revoke_session
from app.db.base import Base
from app.db.models import (
    Branch,
    Member,
    MemberEligibilityRecord,
    MemberNote,
    RoleGrant,
    StaffCredential,
    StaffUser,
)
from app.main import create_app
from app.members.queries import (
    DuplicateMemberNumberError,
    add_member_eligibility,
    add_member_note,
    create_member,
    get_member_by_id,
    list_member_eligibility,
    list_member_notes,
    list_members,
    revoke_member_eligibility,
    update_member,
    void_member_note,
)
from app.members.schemas import CreateMemberDTO, UpdateMemberDTO
from sqlalchemy.exc import IntegrityError
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'members-test.db').as_posix()}"
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


def _seed_sample_members(factory) -> list[Member]:
    members_data = [
        Member(
            id=uuid4(),
            member_number="SOC-0001",
            full_name="Carlos Gomez",
            phone="555-1001",
            email="carlos@example.com",
            birth_date=date(1990, 5, 15),
            emergency_contact_name="Maria Gomez",
            emergency_contact_phone="555-9001",
            notes="Requires locker access key.",
            status="active",
            joined_on=date(2026, 1, 10),
            credit_balance_minor=15000,
            photo_url="https://images.example.com/carlos.jpg",
        ),
        Member(
            id=uuid4(),
            member_number="SOC-0002",
            full_name="Ana Martinez",
            phone="555-1002",
            email="ana@example.com",
            birth_date=date(1995, 8, 20),
            emergency_contact_name="Pedro Martinez",
            emergency_contact_phone="555-9002",
            notes="VIP gold tier member; confidential medical note.",
            status="active",
            joined_on=date(2026, 2, 1),
            credit_balance_minor=0,
            photo_url=None,
        ),
        Member(
            id=uuid4(),
            member_number="SOC-0003",
            full_name="Beatriz Ramirez",
            phone="555-1003",
            email="beatriz@example.com",
            birth_date=date(1988, 12, 5),
            emergency_contact_name=None,
            emergency_contact_phone=None,
            notes="Suspended due to broken equipment dispute.",
            status="suspended",
            joined_on=date(2026, 3, 15),
            credit_balance_minor=-5000,
            photo_url=None,
        ),
        Member(
            id=uuid4(),
            member_number="SOC-0004",
            full_name="David Lopez",
            phone="555-1004",
            email=None,
            birth_date=None,
            emergency_contact_name=None,
            emergency_contact_phone=None,
            notes=None,
            status="expired",
            joined_on=date(2025, 11, 20),
            credit_balance_minor=0,
            photo_url=None,
        ),
        Member(
            id=uuid4(),
            member_number="SOC-0005",
            full_name="Elena Fernandez",
            phone="555-1005",
            email="elena@example.com",
            birth_date=date(2000, 1, 30),
            emergency_contact_name="Jorge Fernandez",
            emergency_contact_phone="555-9005",
            notes="Internal admin note: friend of owner.",
            status="inactive",
            joined_on=date(2026, 4, 1),
            credit_balance_minor=20000,
            photo_url="https://images.example.com/elena.jpg",
        ),
    ]
    with factory(expire_on_commit=False) as session:
        session.add_all(members_data)
        session.commit()
        session.expunge_all()
    return members_data


# -------------------------------------------------------------------------
# Query Unit Tests
# -------------------------------------------------------------------------

def test_list_members_query_pagination_and_sorting(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        _seed_sample_members(factory)
        with factory() as session:
            # Sort by full_name asc
            res_asc = list_members(session, page=1, limit=3, sort_by="full_name", sort_dir="asc")
            assert res_asc.total == 5
            assert res_asc.pages == 2
            assert len(res_asc.items) == 3
            assert [m.full_name for m in res_asc.items] == ["Ana Martinez", "Beatriz Ramirez", "Carlos Gomez"]

            # Page 2
            res_p2 = list_members(session, page=2, limit=3, sort_by="full_name", sort_dir="asc")
            assert len(res_p2.items) == 2
            assert [m.full_name for m in res_p2.items] == ["David Lopez", "Elena Fernandez"]

            # Sort by joined_on desc
            res_date = list_members(session, page=1, limit=10, sort_by="joined_on", sort_dir="desc")
            assert [m.member_number for m in res_date.items] == [
                "SOC-0005", "SOC-0003", "SOC-0002", "SOC-0001", "SOC-0004"
            ]

            # Sort by member_number asc
            res_num = list_members(session, page=1, limit=10, sort_by="member_number", sort_dir="asc")
            assert [m.member_number for m in res_num.items] == [
                "SOC-0001", "SOC-0002", "SOC-0003", "SOC-0004", "SOC-0005"
            ]
    finally:
        engine.dispose()


def test_list_members_query_search_and_status(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        _seed_sample_members(factory)
        with factory() as session:
            # Search by name (case-insensitive)
            res_name = list_members(session, search="cArLoS")
            assert res_name.total == 1
            assert res_name.items[0].member_number == "SOC-0001"

            # Search by phone
            res_phone = list_members(session, search="555-1003")
            assert res_phone.total == 1
            assert res_phone.items[0].full_name == "Beatriz Ramirez"

            # Search by member_number
            res_num = list_members(session, search="SOC-0005")
            assert res_num.total == 1
            assert res_num.items[0].full_name == "Elena Fernandez"

            # Filter by status
            res_status = list_members(session, status="active")
            assert res_status.total == 2
            assert {m.member_number for m in res_status.items} == {"SOC-0001", "SOC-0002"}

            # Search + status combined
            res_both = list_members(session, search="Ana", status="active")
            assert res_both.total == 1
            assert res_both.items[0].full_name == "Ana Martinez"

            # No match
            res_none = list_members(session, search="NonExistentName")
            assert res_none.total == 0
            assert res_none.pages == 1
            assert len(res_none.items) == 0
    finally:
        engine.dispose()


def test_list_members_query_invalid_arguments(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        with factory() as session:
            with pytest.raises(ValueError, match="Invalid sort field"):
                list_members(session, sort_by="unsupported_column")
            with pytest.raises(ValueError, match="Invalid sort direction"):
                list_members(session, sort_dir="sideways")
            with pytest.raises(ValueError, match="page must be >= 1"):
                list_members(session, page=0)
            with pytest.raises(ValueError, match="limit must be >= 1"):
                list_members(session, limit=0)
    finally:
        engine.dispose()


def test_get_member_by_id_query(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        members = _seed_sample_members(factory)
        target = members[0]
        with factory() as session:
            found = get_member_by_id(session, target.id)
            assert found is not None
            assert found.id == target.id
            assert found.member_number == "SOC-0001"

            # Using string UUID
            found_str = get_member_by_id(session, str(target.id))
            assert found_str is not None
            assert found_str.id == target.id

            # Non-existent
            assert get_member_by_id(session, uuid4()) is None
            assert get_member_by_id(session, "invalid-uuid-string") is None
    finally:
        engine.dispose()


# -------------------------------------------------------------------------
# API Contract & Authorization Integration Tests
# -------------------------------------------------------------------------

def test_members_api_unauthenticated_and_invalid_bearer(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, token = _seed_receptionist(factory, branch_id)
        members = _seed_sample_members(factory)
        member_id = members[0].id
        app = create_app(configured_settings(url))

        with TestClient(app) as client:
            mutation_payload = {
                "member_number": "AUTH-DENIED-01",
                "full_name": "Unauthorized Create",
                "phone": "555-000-0000",
            }
            member_path = f"/api/v1/members/{member_id}"

            # Missing and invalid credentials must not create or update members.
            for headers in (None, {"Authorization": "Bearer not-a-valid-token"}):
                create_response = client.post("/api/v1/members", headers=headers, json=mutation_payload)
                assert create_response.status_code == 401
                patch_response = client.patch(member_path, headers=headers, json={"full_name": "Unauthorized Update"})
                assert patch_response.status_code == 401

            with factory() as session:
                assert session.scalar(select(func.count()).select_from(Member)) == len(members)
                unchanged = session.get(Member, member_id)
                assert unchanged.full_name == "Carlos Gomez"

            # 1. No Authorization header -> 401
            assert client.get("/api/v1/members").status_code == 401
            assert client.get(f"/api/v1/members/{member_id}").status_code == 401

            # 2. Non-bearer scheme -> 401
            assert client.get("/api/v1/members", headers={"Authorization": f"Basic {token}"}).status_code == 401

            # 3. Invalid token -> 401
            assert client.get("/api/v1/members", headers={"Authorization": "Bearer not-a-valid-token"}).status_code == 401

            # 4. Revoked session token -> 401
            revoke_session(factory, token)
            revoked_headers = {"Authorization": f"Bearer {token}"}
            assert client.get("/api/v1/members", headers=revoked_headers).status_code == 401
            assert client.get(f"/api/v1/members/{member_id}", headers=revoked_headers).status_code == 401

            create_response = client.post("/api/v1/members", headers=revoked_headers, json=mutation_payload)
            assert create_response.status_code == 401
            patch_response = client.patch(member_path, headers=revoked_headers, json={"full_name": "Revoked Update"})
            assert patch_response.status_code == 401
            with factory() as session:
                assert session.scalar(select(func.count()).select_from(Member)) == len(members)
                unchanged = session.get(Member, member_id)
                assert unchanged.full_name == "Carlos Gomez"
    finally:
        engine.dispose()


def test_members_api_pagination_and_query_parameters(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, token = _seed_receptionist(factory, branch_id)
        _seed_sample_members(factory)
        app = create_app(configured_settings(url))

        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            # Default pagination (page 1, limit 20)
            res = client.get("/api/v1/members", headers=headers)
            assert res.status_code == 200
            data = res.json()
            assert data["total"] == 5
            assert data["page"] == 1
            assert data["limit"] == 20
            assert data["pages"] == 1
            assert len(data["items"]) == 5

            # Custom page & limit
            res_paginated = client.get("/api/v1/members?page=2&limit=2", headers=headers)
            assert res_paginated.status_code == 200
            p_data = res_paginated.json()
            assert p_data["total"] == 5
            assert p_data["page"] == 2
            assert p_data["limit"] == 2
            assert p_data["pages"] == 3
            assert len(p_data["items"]) == 2

            # Search parameter
            res_search = client.get("/api/v1/members?search=gomez", headers=headers)
            assert res_search.status_code == 200
            s_data = res_search.json()
            assert s_data["total"] == 1
            assert s_data["items"][0]["full_name"] == "Carlos Gomez"

            # Status filter
            res_status = client.get("/api/v1/members?status=suspended", headers=headers)
            assert res_status.status_code == 200
            st_data = res_status.json()
            assert st_data["total"] == 1
            assert st_data["items"][0]["status"] == "suspended"

            # Sort parameters
            res_sort = client.get("/api/v1/members?sort_by=member_number&sort_dir=desc", headers=headers)
            assert res_sort.status_code == 200
            sort_items = res_sort.json()["items"]
            assert [m["member_number"] for m in sort_items] == [
                "SOC-0005", "SOC-0004", "SOC-0003", "SOC-0002", "SOC-0001"
            ]

            # Validation errors: invalid sort_by -> 422
            bad_sort = client.get("/api/v1/members?sort_by=password", headers=headers)
            assert bad_sort.status_code == 422

            # Validation errors: invalid sort_dir -> 422
            bad_dir = client.get("/api/v1/members?sort_dir=upward", headers=headers)
            assert bad_dir.status_code == 422

            # Validation errors: invalid limit -> 422
            bad_limit = client.get("/api/v1/members?limit=200", headers=headers)
            assert bad_limit.status_code == 422
    finally:
        engine.dispose()


def test_get_member_detail_and_404_not_found(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, token = _seed_receptionist(factory, branch_id)
        members = _seed_sample_members(factory)
        target = members[0]
        app = create_app(configured_settings(url))

        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            # 200 Found
            res = client.get(f"/api/v1/members/{target.id}", headers=headers)
            assert res.status_code == 200
            data = res.json()
            assert data["id"] == str(target.id)
            assert data["member_number"] == "SOC-0001"
            assert data["full_name"] == "Carlos Gomez"
            assert data["phone"] == "555-1001"
            assert data["email"] == "carlos@example.com"
            assert data["birth_date"] == "1990-05-15"
            assert data["emergency_contact_name"] == "Maria Gomez"
            assert data["emergency_contact_phone"] == "555-9001"
            assert data["status"] == "active"
            assert data["joined_on"] == "2026-01-10"
            assert data["credit_balance_minor"] == 15000
            assert data["photo_url"] == "https://images.example.com/carlos.jpg"

            # 404 Not Found for non-existent member
            random_id = uuid4()
            res_404 = client.get(f"/api/v1/members/{random_id}", headers=headers)
            assert res_404.status_code == 404
            assert res_404.json()["error"]["message"] == "The requested resource was not found."

            # 422 Invalid UUID
            res_422 = client.get("/api/v1/members/not-a-uuid", headers=headers)
            assert res_422.status_code == 422
    finally:
        engine.dispose()


def test_d012_staff_access_scope_notes_redaction_vs_admin_access(tmp_path):
    """D-012: Receptionist visibility is restricted to the operational profile.

    Sensitive fields like internal notes are strictly reserved for Admin actors.
    Receptionist receives notes=None; Admin receives full member notes.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, recep_token = _seed_receptionist(factory, branch_id)
        admin_id = seed_admin(factory, "owner@example.invalid", "super-secret-password")
        members = _seed_sample_members(factory)
        # SOC-0002 has confidential notes: "VIP gold tier member; confidential medical note."
        vip_member = members[1]
        assert vip_member.notes is not None

        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "owner@example.invalid", "super-secret-password")
            # 1. Receptionist request -> notes must be null
            recep_res = client.get(
                f"/api/v1/members/{vip_member.id}",
                headers={"Authorization": f"Bearer {recep_token}"},
            )
            assert recep_res.status_code == 200
            recep_data = recep_res.json()
            assert recep_data["member_number"] == "SOC-0002"
            assert recep_data["full_name"] == "Ana Martinez"
            assert recep_data["notes"] is None, "D-012: Receptionist must not see sensitive member notes"

            # 2. Admin request -> notes must be fully visible
            admin_res = client.get(
                f"/api/v1/members/{vip_member.id}",
                headers=admin_headers,
            )
            assert admin_res.status_code == 200
            admin_data = admin_res.json()
            assert admin_data["member_number"] == "SOC-0002"
            assert admin_data["notes"] == "VIP gold tier member; confidential medical note."

            # 3. Admin listing members
            admin_list = client.get(
                "/api/v1/members",
                headers=admin_headers,
            )
            assert admin_list.status_code == 200
            assert admin_list.json()["total"] == 5
    finally:
        engine.dispose()


# -------------------------------------------------------------------------
# BK-016: Member Notes and Eligibility Records Tests
# -------------------------------------------------------------------------


def test_member_preferred_name_and_birth_date_optionality_and_uniqueness(tmp_path):
    """Verify preferred_name and birth_date optionality and member_number uniqueness constraint."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        m1_id = uuid4()
        m2_id = uuid4()
        with factory.begin() as session:
            # 1. Member with both optional fields populated
            m1 = Member(
                id=m1_id,
                member_number="MEM-OPT-001",
                full_name="Guillermo del Toro",
                preferred_name="Memo",
                phone="555-1111",
                birth_date=date(1964, 10, 9),
            )
            # 2. Member with optional fields omitted (None)
            m2 = Member(
                id=m2_id,
                member_number="MEM-OPT-002",
                full_name="Alfonso Cuaron",
                preferred_name=None,
                phone="555-2222",
                birth_date=None,
            )
            session.add_all([m1, m2])

        with factory() as session:
            found1 = session.get(Member, m1_id)
            assert found1 is not None
            assert found1.preferred_name == "Memo"
            assert found1.birth_date == date(1964, 10, 9)

            found2 = session.get(Member, m2_id)
            assert found2 is not None
            assert found2.preferred_name is None
            assert found2.birth_date is None

        # 3. Uniqueness constraint: inserting duplicate member_number must fail
        with pytest.raises(IntegrityError):
            with factory.begin() as session:
                duplicate = Member(
                    id=uuid4(),
                    member_number="MEM-OPT-001",  # Same number as m1
                    full_name="Duplicate Number User",
                    phone="555-3333",
                )
                session.add(duplicate)
    finally:
        engine.dispose()


def test_member_notes_queries_and_voiding(tmp_path):
    """Verify note creation, listing (excluding voided by default), and soft-deletion / voiding."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, _token = _seed_receptionist(factory, branch_id)
        members = _seed_sample_members(factory)
        member = members[0]

        with factory() as session:
            # Create two notes
            n1 = add_member_note(session, member.id, staff_id, "First operational note")
            session.commit()
            n2 = add_member_note(session, member.id, staff_id, "Second VIP incident note")
            session.commit()

            assert n1.id is not None
            assert n1.is_voided is False
            assert n2.id is not None
            assert n2.is_voided is False

            # List notes without voided
            active_notes = list_member_notes(session, member.id, include_voided=False)
            assert len(active_notes) == 2
            assert {n.body for n in active_notes} == {"First operational note", "Second VIP incident note"}

            # Void n1
            voided = void_member_note(session, n1.id, voided_by=staff_id)
            session.commit()
            assert voided is not None
            assert voided.is_voided is True
            assert voided.voided_at is not None
            assert voided.voided_by == staff_id

            # List active only: should now only contain n2
            active_after = list_member_notes(session, member.id, include_voided=False)
            assert len(active_after) == 1
            assert active_after[0].id == n2.id

            # List with include_voided=True: should contain both
            all_notes = list_member_notes(session, member.id, include_voided=True)
            assert len(all_notes) == 2
            assert any(n.id == n1.id and n.is_voided for n in all_notes)

            # Voiding non-existent note returns None
            assert void_member_note(session, uuid4(), staff_id) is None
    finally:
        engine.dispose()


def test_member_notes_api_endpoints_and_access_control(tmp_path):
    """Verify note access control: Receptionist forbidden (403), Admin allowed."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, recep_token = _seed_receptionist(factory, branch_id)
        seed_admin(factory, "owner@example.invalid", "super-secret-password")
        members = _seed_sample_members(factory)
        member = members[0]
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        recep_headers = {"Authorization": f"Bearer {recep_token}"}

        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "owner@example.invalid", "super-secret-password")
            # 1. Receptionist is forbidden from accessing note endpoints (403)
            res_r_get = client.get(f"/api/v1/members/{member.id}/notes", headers=recep_headers)
            assert res_r_get.status_code == 403

            res_r_post = client.post(
                f"/api/v1/members/{member.id}/notes",
                headers=recep_headers,
                json={"body": "Receptionist note attempt"},
            )
            assert res_r_post.status_code == 403

            # 2. Admin can create a note (201 Created)
            res_a_post = client.post(
                f"/api/v1/members/{member.id}/notes",
                headers=admin_headers,
                json={"body": "Confidential management note."},
            )
            assert res_a_post.status_code == 201
            note_data = res_a_post.json()
            assert note_data["body"] == "Confidential management note."
            assert note_data["member_id"] == str(member.id)
            assert note_data["is_voided"] is False
            note_id = note_data["id"]

            # 3. Receptionist cannot void a note (403)
            res_r_void = client.post(
                f"/api/v1/members/{member.id}/notes/{note_id}/void",
                headers=recep_headers,
            )
            assert res_r_void.status_code == 403

            # 4. Admin can list notes (200)
            res_a_get = client.get(f"/api/v1/members/{member.id}/notes", headers=admin_headers)
            assert res_a_get.status_code == 200
            assert len(res_a_get.json()) == 1

            # 5. Admin can void a note (200)
            res_a_void = client.post(
                f"/api/v1/members/{member.id}/notes/{note_id}/void",
                headers=admin_headers,
            )
            assert res_a_void.status_code == 200
            assert res_a_void.json()["is_voided"] is True
            assert res_a_void.json()["voided_at"] is not None

            # 6. Admin listing notes without include_voided returns empty list
            res_a_get2 = client.get(f"/api/v1/members/{member.id}/notes", headers=admin_headers)
            assert res_a_get2.status_code == 200
            assert len(res_a_get2.json()) == 0

            # 7. Admin listing notes with include_voided=True returns the voided note
            res_a_get_all = client.get(f"/api/v1/members/{member.id}/notes?include_voided=true", headers=admin_headers)
            assert res_a_get_all.status_code == 200
            assert len(res_a_get_all.json()) == 1
            assert res_a_get_all.json()[0]["is_voided"] is True

            # 8. Note operations on non-existent member -> 404
            fake_member_id = uuid4()
            assert client.get(f"/api/v1/members/{fake_member_id}/notes", headers=admin_headers).status_code == 404
            assert client.post(
                f"/api/v1/members/{fake_member_id}/notes",
                headers=admin_headers,
                json={"body": "Hello"},
            ).status_code == 404
    finally:
        engine.dispose()


def test_member_eligibility_queries_and_revocation(tmp_path):
    """Verify eligibility creation, active vs expired/revoked filtering, and revocation."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, _token = _seed_receptionist(factory, branch_id)
        members = _seed_sample_members(factory)
        member = members[0]

        with factory() as session:
            # 1. Active record (future expiration)
            rec_active = add_member_eligibility(
                session,
                member.id,
                eligibility_type="student_discount",
                verified_by=staff_id,
                valid_until=date.today() + timedelta(days=60),
                notes="University student ID valid for fall semester.",
            )
            # 2. Expired record (past expiration)
            rec_expired = add_member_eligibility(
                session,
                member.id,
                eligibility_type="corporate_partner",
                verified_by=staff_id,
                valid_until=date.today() - timedelta(days=5),
                notes="Expired corporate agreement.",
            )
            # 3. Indefinite active record (no expiration date)
            rec_indefinite = add_member_eligibility(
                session,
                member.id,
                eligibility_type="veteran_status",
                verified_by=staff_id,
                valid_until=None,
            )
            session.commit()

            # Active records check
            active_list = list_member_eligibility(session, member.id, only_active=True)
            active_types = {r.eligibility_type for r in active_list}
            assert "student_discount" in active_types
            assert "veteran_status" in active_types
            assert "corporate_partner" not in active_types
            assert len(active_list) == 2

            # All records check (only_active=False)
            all_list = list_member_eligibility(session, member.id, only_active=False)
            assert len(all_list) == 3

            # Revoke student_discount
            revoked = revoke_member_eligibility(session, rec_active.id, revoked_by=staff_id)
            session.commit()
            assert revoked is not None
            assert revoked.revoked_at is not None
            assert revoked.is_valid is False

            # Active list now only contains the indefinite record
            active_after = list_member_eligibility(session, member.id, only_active=True)
            assert len(active_after) == 1
            assert active_after[0].eligibility_type == "veteran_status"

            # Revoking non-existent record returns None
            assert revoke_member_eligibility(session, uuid4(), staff_id) is None
    finally:
        engine.dispose()


def test_member_eligibility_api_endpoints_and_access_control(tmp_path):
    """Verify eligibility read access by Receptionist, but creation/revocation restricted to Admin."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, recep_token = _seed_receptionist(factory, branch_id)
        seed_admin(factory, "owner@example.invalid", "super-secret-password")
        members = _seed_sample_members(factory)
        member = members[0]
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        recep_headers = {"Authorization": f"Bearer {recep_token}"}

        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "owner@example.invalid", "super-secret-password")
            # 1. Receptionist cannot create eligibility records (403 Forbidden)
            res_r_create = client.post(
                f"/api/v1/members/{member.id}/eligibility",
                headers=recep_headers,
                json={"eligibility_type": "student_discount", "valid_until": "2026-12-31"},
            )
            assert res_r_create.status_code == 403

            # 2. Admin can create eligibility records (201 Created)
            res_a_create = client.post(
                f"/api/v1/members/{member.id}/eligibility",
                headers=admin_headers,
                json={
                    "eligibility_type": "student_discount",
                    "valid_until": "2026-12-31",
                    "notes": "Verified student credentials.",
                },
            )
            assert res_a_create.status_code == 201
            elig_data = res_a_create.json()
            assert elig_data["eligibility_type"] == "student_discount"
            assert elig_data["is_valid"] is True
            record_id = elig_data["id"]

            # 3. Receptionist CAN read eligibility records (200 OK)
            res_r_list = client.get(f"/api/v1/members/{member.id}/eligibility", headers=recep_headers)
            assert res_r_list.status_code == 200
            assert len(res_r_list.json()) == 1
            assert res_r_list.json()[0]["eligibility_type"] == "student_discount"

            # 4. Receptionist cannot revoke eligibility records (403 Forbidden)
            res_r_revoke = client.post(
                f"/api/v1/members/{member.id}/eligibility/{record_id}/revoke",
                headers=recep_headers,
            )
            assert res_r_revoke.status_code == 403

            # 5. Admin can revoke eligibility record (200 OK)
            res_a_revoke = client.post(
                f"/api/v1/members/{member.id}/eligibility/{record_id}/revoke",
                headers=admin_headers,
            )
            assert res_a_revoke.status_code == 200
            assert res_a_revoke.json()["is_valid"] is False
            assert res_a_revoke.json()["revoked_at"] is not None

            # 6. Active listing (default) is now empty
            res_active = client.get(f"/api/v1/members/{member.id}/eligibility", headers=recep_headers)
            assert res_active.status_code == 200
            assert len(res_active.json()) == 0

            # 7. Listing with only_active=false shows the revoked record
            res_all = client.get(f"/api/v1/members/{member.id}/eligibility?only_active=false", headers=recep_headers)
            assert res_all.status_code == 200
            assert len(res_all.json()) == 1
            assert res_all.json()[0]["is_valid"] is False

            # 8. Non-existent member -> 404
            fake_id = uuid4()
            assert client.get(f"/api/v1/members/{fake_id}/eligibility", headers=admin_headers).status_code == 404
            assert client.post(
                f"/api/v1/members/{fake_id}/eligibility",
                headers=admin_headers,
                json={"eligibility_type": "promo"},
            ).status_code == 404
    finally:
        engine.dispose()


def test_member_preferred_name_in_api(tmp_path):
    """Verify preferred_name is exposed on member list and member detail endpoints."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            member = Member(
                id=uuid4(),
                member_number="SOC-PREF-01",
                full_name="Alejandro Gonzalez Inarritu",
                preferred_name="Negro",
                phone="555-4321",
            )
            session.add(member)
            m_id = member.id

        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            # 1. In list endpoint
            res_list = client.get("/api/v1/members", headers=headers)
            assert res_list.status_code == 200
            items = res_list.json()["items"]
            assert len(items) == 1
            assert items[0]["preferred_name"] == "Negro"

            # 2. In detail endpoint
            res_detail = client.get(f"/api/v1/members/{m_id}", headers=headers)
            assert res_detail.status_code == 200
            assert res_detail.json()["preferred_name"] == "Negro"
    finally:
        engine.dispose()


# -------------------------------------------------------------------------
# BK-018: Member Create / Update / Search Flows Tests
# -------------------------------------------------------------------------


def test_create_member_with_full_data_and_admin_notes(tmp_path):
    """Admin creates a member with all fields populated; notes and initial MemberNote are persisted."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        seed_admin(factory, "admin@example.invalid", "super-secret-password")
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        payload = {
            "member_number": "MEM-FULL-01",
            "full_name": "Alfonso Cuaron",
            "preferred_name": "Poncho",
            "phone": "555-888-0001",
            "email": "poncho@example.com",
            "birth_date": "1961-11-28",
            "emergency_contact_name": "Mariana Cuaron",
            "emergency_contact_phone": "555-888-9999",
            "photo_url": "https://example.com/poncho.jpg",
            "joined_on": "2026-05-01",
            "initial_notes": "VIP gold member; confidential medical note.",
        }

        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "admin@example.invalid", "super-secret-password")
            res = client.post("/api/v1/members", headers=admin_headers, json=payload)
            assert res.status_code == 201
            data = res.json()
            assert data["member_number"] == "MEM-FULL-01"
            assert data["full_name"] == "Alfonso Cuaron"
            assert data["preferred_name"] == "Poncho"
            assert data["phone"] == "555-888-0001"
            assert data["email"] == "poncho@example.com"
            assert data["birth_date"] == "1961-11-28"
            assert data["emergency_contact_name"] == "Mariana Cuaron"
            assert data["emergency_contact_phone"] == "555-888-9999"
            assert data["photo_url"] == "https://example.com/poncho.jpg"
            assert data["joined_on"] == "2026-05-01"
            assert data["notes"] == "VIP gold member; confidential medical note."
            assert data["status"] == "active"
            assert data["credit_balance_minor"] == 0
            member_id = UUID(data["id"])

        with factory() as session:
            db_member = session.get(Member, member_id)
            assert db_member is not None
            assert db_member.notes == "VIP gold member; confidential medical note."
            notes = list_member_notes(session, member_id)
            assert len(notes) == 1
            assert notes[0].body == "VIP gold member; confidential medical note."
    finally:
        engine.dispose()


def test_create_member_minimal_data_receptionist_and_notes_redaction(tmp_path):
    """Receptionist creates member with minimal data; initial_notes are rejected/ignored and notes are null."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, recep_token = _seed_receptionist(factory, branch_id)

        app = create_app(configured_settings(url))
        recep_headers = {"Authorization": f"Bearer {recep_token}"}

        payload = {
            "member_number": "MEM-MIN-01",
            "full_name": "Guillermo Del Toro",
            "phone": "555-888-0002",
            "initial_notes": "Attempted receptionist note.",
        }

        with TestClient(app) as client:
            res = client.post("/api/v1/members", headers=recep_headers, json=payload)
            assert res.status_code == 201
            data = res.json()
            assert data["member_number"] == "MEM-MIN-01"
            assert data["full_name"] == "Guillermo Del Toro"
            assert data["preferred_name"] is None
            assert data["phone"] == "555-888-0002"
            assert data["email"] is None
            assert data["birth_date"] is None
            assert data["emergency_contact_name"] is None
            assert data["emergency_contact_phone"] is None
            assert data["photo_url"] is None
            assert data["joined_on"] == date.today().isoformat()
            assert data["notes"] is None  # D-012: receptionist receives null notes
            assert data["status"] == "active"
            assert data["credit_balance_minor"] == 0
            member_id = UUID(data["id"])

        with factory() as session:
            db_member = session.get(Member, member_id)
            assert db_member is not None
            assert db_member.notes is None
            notes = list_member_notes(session, member_id)
            assert len(notes) == 0
    finally:
        engine.dispose()


def test_create_member_duplicate_number_conflict_409(tmp_path):
    """Attempting to create a member with an existing member_number returns 409 Conflict."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, token = _seed_receptionist(factory, branch_id)

        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}

        payload1 = {
            "member_number": "DUP-999",
            "full_name": "First Member",
            "phone": "555-0001",
        }
        payload2 = {
            "member_number": " DUP-999 ",
            "full_name": "Second Member With Same Number",
            "phone": "555-0002",
        }

        with TestClient(app) as client:
            res1 = client.post("/api/v1/members", headers=headers, json=payload1)
            assert res1.status_code == 201

            res2 = client.post("/api/v1/members", headers=headers, json=payload2)
            assert res2.status_code == 409
            assert res2.json()["error"]["message"] == "The request could not be completed."
    finally:
        engine.dispose()


def test_create_member_shared_natural_identifiers_allowed(tmp_path):
    """Two distinct members sharing the same full_name, phone, and email can both be created without conflict."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, token = _seed_receptionist(factory, branch_id)

        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}

        member_a = {
            "member_number": "FAM-001",
            "full_name": "Familia Perez",
            "phone": "555-444-1234",
            "email": "familia.perez@example.com",
        }
        member_b = {
            "member_number": "FAM-002",
            "full_name": "Familia Perez",
            "phone": "555-444-1234",
            "email": "familia.perez@example.com",
        }

        with TestClient(app) as client:
            res_a = client.post("/api/v1/members", headers=headers, json=member_a)
            assert res_a.status_code == 201
            data_a = res_a.json()
            assert data_a["member_number"] == "FAM-001"
            assert data_a["full_name"] == "Familia Perez"

            res_b = client.post("/api/v1/members", headers=headers, json=member_b)
            assert res_b.status_code == 201
            data_b = res_b.json()
            assert data_b["member_number"] == "FAM-002"
            assert data_b["full_name"] == "Familia Perez"

            assert data_a["id"] != data_b["id"]
    finally:
        engine.dispose()


def test_search_members_by_preferred_name(tmp_path):
    """Members can be searched by preferred_name across query and API endpoint."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, token = _seed_receptionist(factory, branch_id)

        with factory.begin() as session:
            m1 = Member(
                id=uuid4(),
                member_number="SEARCH-01",
                full_name="Ignacio Lopez Tarso",
                preferred_name="Nacho",
                phone="555-777-0001",
            )
            m2 = Member(
                id=uuid4(),
                member_number="SEARCH-02",
                full_name="Pedro Armendariz",
                preferred_name="Peter",
                phone="555-777-0002",
            )
            session.add_all([m1, m2])

        # 1. Query unit check
        with factory() as session:
            res = list_members(session, search="nAcHo")
            assert res.total == 1
            assert res.items[0].member_number == "SEARCH-01"

            res2 = list_members(session, search="peter")
            assert res2.total == 1
            assert res2.items[0].member_number == "SEARCH-02"

        # 2. API integration check
        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            api_res = client.get("/api/v1/members?search=nacho", headers=headers)
            assert api_res.status_code == 200
            items = api_res.json()["items"]
            assert len(items) == 1
            assert items[0]["member_number"] == "SEARCH-01"
            assert items[0]["preferred_name"] == "Nacho"
    finally:
        engine.dispose()


def test_update_member_patch_endpoint(tmp_path):
    """PATCH /api/v1/members/{member_id} updates demographic/operational fields and enforces validation."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, recep_token = _seed_receptionist(factory, branch_id)
        seed_admin(factory, "admin@example.invalid", "super-secret-password")
        m_id = uuid4()
        with factory.begin() as session:
            member = Member(
                id=m_id,
                member_number="UP-001",
                full_name="Original Name",
                preferred_name="OrigNick",
                phone="555-123-0000",
                email="orig@example.com",
                status="active",
                notes="Confidential member note.",
            )
            session.add(member)

        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)
        recep_headers = {"Authorization": f"Bearer {recep_token}"}

        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "admin@example.invalid", "super-secret-password")
            # 1. Receptionist updates full_name, phone, and status
            patch_data = {
                "full_name": "Updated Name",
                "phone": "555-999-8888",
                "status": "suspended",
            }
            res_r = client.patch(f"/api/v1/members/{m_id}", headers=recep_headers, json=patch_data)
            assert res_r.status_code == 200
            data_r = res_r.json()
            assert data_r["full_name"] == "Updated Name"
            assert data_r["phone"] == "555-999-8888"
            assert data_r["status"] == "suspended"
            assert data_r["preferred_name"] == "OrigNick"  # Unchanged
            assert data_r["notes"] is None  # D-012: Receptionist receives null notes

            # 2. Admin updates preferred_name -> Admin receives populated notes
            patch_admin = {"preferred_name": "NewNick"}
            res_a = client.patch(f"/api/v1/members/{m_id}", headers=admin_headers, json=patch_admin)
            assert res_a.status_code == 200
            data_a = res_a.json()
            assert data_a["preferred_name"] == "NewNick"
            assert data_a["notes"] == "Confidential member note."

            # 3. Nonexistent member returns 404 Not Found
            random_id = uuid4()
            res_404 = client.patch(f"/api/v1/members/{random_id}", headers=recep_headers, json={"full_name": "Nobody"})
            assert res_404.status_code == 404
            assert res_404.json()["error"]["message"] == "The requested resource was not found."

            # 4. Invalid status value returns 422 Unprocessable Entity
            res_422 = client.patch(f"/api/v1/members/{m_id}", headers=recep_headers, json={"status": "invalid_status"})
            assert res_422.status_code == 422
    finally:
        engine.dispose()


def test_member_queries_create_and_update_unit(tmp_path):
    """Direct unit tests for create_member and update_member query functions."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        actor_id = uuid4()
        with factory() as session:
            # 1. create_member
            dto = CreateMemberDTO(
                member_number="UNIT-001",
                full_name="Unit Test Member",
                phone="555-1212",
                initial_notes="Admin secret",
            )
            created = create_member(session, dto, actor_id=actor_id, is_admin=True)
            session.commit()
            assert created.id is not None
            assert created.member_number == "UNIT-001"
            assert created.notes == "Admin secret"

            # 2. Duplicate create raises DuplicateMemberNumberError
            with pytest.raises(DuplicateMemberNumberError):
                create_member(session, dto, actor_id=actor_id, is_admin=True)

            # 3. update_member
            up_dto = UpdateMemberDTO(full_name="New Unit Name", status="inactive")
            updated = update_member(session, created.id, up_dto)
            session.commit()
            assert updated is not None
            assert updated.full_name == "New Unit Name"
            assert updated.status == "inactive"

            # 4. update_member with nonexistent UUID returns None
            assert update_member(session, uuid4(), up_dto) is None

            # 5. update_member with invalid string returns None
            assert update_member(session, "not-a-valid-uuid", up_dto) is None
    finally:
        engine.dispose()


@pytest.fixture
def member_mutation_case(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            member = Member(member_number="NORMALIZATION-BASE", full_name="Original Person", phone="555-0100",
                            preferred_name="Original Alias", birth_date=date(2000, 1, 2))
            session.add(member)
            session.flush()
            member_id = member.id
        with TestClient(create_app(configured_settings(url))) as client:
            yield client, factory, {"Authorization": f"Bearer {token}"}, member_id
    finally:
        engine.dispose()


@pytest.mark.parametrize("field", ["member_number", "full_name", "phone"])
@pytest.mark.parametrize("value", [" \t\n ", None])
def test_member_required_text_create_rejects_blank_or_null_without_writes(member_mutation_case, field, value):
    client, factory, headers, _ = member_mutation_case
    payload = {"member_number": "NEW-MEMBER", "full_name": "New Person", "phone": "555-0200", field: value}
    response = client.post("/api/v1/members", headers=headers, json=payload)
    assert response.status_code == 422, response.text
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Member)) == 1


@pytest.mark.parametrize("field", ["full_name", "phone"])
@pytest.mark.parametrize("value", [" \t\n ", None])
def test_member_required_text_patch_rejects_blank_or_null_without_writes(member_mutation_case, field, value):
    client, factory, headers, member_id = member_mutation_case
    response = client.patch(f"/api/v1/members/{member_id}", headers=headers, json={field: value})
    assert response.status_code == 422, response.text
    with factory() as session:
        member = session.get(Member, member_id)
        assert (member.member_number, member.full_name, member.phone, member.preferred_name, member.birth_date) == (
            "NORMALIZATION-BASE", "Original Person", "555-0100", "Original Alias", date(2000, 1, 2),
        )


def test_member_required_text_normalization_preserves_formats_and_validated_length(member_mutation_case):
    client, factory, headers, member_id = member_mutation_case
    payload = {"member_number": "  " + "M" * 32 + "  ", "full_name": "  New  Person  ",
               "phone": "  +52 555-0200  ", "preferred_name": "  Alias  "}
    response = client.post("/api/v1/members", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["member_number"] == "M" * 32
    assert response.json()["full_name"] == "New  Person"
    assert response.json()["phone"] == "+52 555-0200"
    assert response.json()["preferred_name"] == "Alias"
    updated = client.patch(f"/api/v1/members/{member_id}", headers=headers, json={
        "full_name": "  Updated  Person  ", "phone": "  +52 555-0300  ",
    })
    assert updated.status_code == 200, updated.text
    with factory() as session:
        member = session.get(Member, member_id)
        assert (member.member_number, member.full_name, member.phone, member.preferred_name) == (
            "NORMALIZATION-BASE", "Updated  Person", "+52 555-0300", "Original Alias",
        )


def test_member_birth_date_patch_presence_preserves_updates_and_clears(member_mutation_case):
    client, factory, headers, member_id = member_mutation_case
    path = f"/api/v1/members/{member_id}"
    omitted = client.patch(path, headers=headers, json={})
    assert omitted.status_code == 200
    assert omitted.json()["birth_date"] == "2000-01-02"
    updated = client.patch(path, headers=headers, json={"birth_date": "2001-02-03"})
    assert updated.status_code == 200
    assert updated.json()["birth_date"] == "2001-02-03"
    cleared = client.patch(path, headers=headers, json={"birth_date": None})
    assert cleared.status_code == 200
    assert cleared.json()["birth_date"] is None
    invalid = client.patch(path, headers=headers, json={"birth_date": "not-a-date"})
    assert invalid.status_code == 422
    with factory() as session:
        member = session.get(Member, member_id)
        assert member.birth_date is None
        assert member.preferred_name == "Original Alias"




def test_create_member_note_rejects_whitespace_body(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        seed_admin(factory, "owner@example.invalid", "super-secret-password")
        members = _seed_sample_members(factory)
        member = members[0]
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)
        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "owner@example.invalid", "super-secret-password")
            response = client.post(
                f"/api/v1/members/{member.id}/notes",
                headers=admin_headers,
                json={"body": "   "},
            )
            assert response.status_code == 422
            with factory() as session:
                assert session.scalar(select(func.count()).select_from(MemberNote)) == 0
    finally:
        engine.dispose()
