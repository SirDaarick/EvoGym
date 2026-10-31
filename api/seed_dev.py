import sys
from pathlib import Path
from uuid import UUID, uuid4
from datetime import date, timedelta, datetime, timezone

# Add api directory to sys.path
api_dir = Path(__file__).resolve().parent
if str(api_dir) not in sys.path:
    sys.path.insert(0, str(api_dir))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import Branch, StaffUser, StaffCredential, RoleGrant, StaffRosterProfile, CashRegister, Plan, PlanVersion, Member, AdminPasswordCredential, Product, StockInitialization
from app.auth.hashing import hash_pin
from app.auth.passwords import hash_admin_password
from app.auth.devices import issue_device_pairing_code
from app.shifts.queries import create_cash_register, open_shift
from app.inventory.queries import capture_register_inventory_snapshot
from app.main import create_app
from app.settings import get_settings, Settings
from fastapi.testclient import TestClient

settings = get_settings()
db_url = settings.require_database_url()
engine = create_engine(db_url)

if engine.dialect.name == "postgresql":
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE TABLE branches, staff_users, members, plans, products CASCADE;"))
else:
    db_file = api_dir / "dev.db"
    if db_file.exists():
        db_file.unlink()
    Base.metadata.create_all(engine)

factory = sessionmaker(engine)

# 1. Seed Branch
with factory.begin() as session:
    branch = Branch(code="central", name="Sucursal Centro", timezone="America/Mexico_City", is_active=True)
    session.add(branch)
    session.flush()
    branch_id = branch.id

    # 2. Seed Receptionist and Admin
    staff = StaffUser(login_identifier="recepcion")
    admin_user = StaffUser(login_identifier="admin@evogym.com")
    session.add_all([staff, admin_user])
    session.flush()
    staff_id = staff.id
    admin_id = admin_user.id

    grant = RoleGrant(staff_id=staff_id, role="receptionist", scope_kind="branch", branch_id=branch_id)
    cred = StaffCredential(staff_id=staff_id, method="pin", secret_hash=hash_pin("123456"))
    profile = StaffRosterProfile(branch_id=branch_id, staff_user_id=staff_id, full_name="Recepcionista Centro", position="Recepción")
    
    admin_grant = RoleGrant(staff_id=admin_id, role="admin", scope_kind="organization")
    admin_cred = AdminPasswordCredential(
        staff_id=admin_id, password_hash=hash_admin_password("Admin1234!"),
        recovery_email="admin@evogym.com", recovery_email_verified_at=datetime.now(timezone.utc),
        is_owner=True
    )
    session.add_all([grant, cred, profile, admin_grant, admin_cred])
    session.flush()

    # 3. Seed Cash Register
    register = create_cash_register(session, branch_id, "caja-1", "Caja Principal")
    register_id = register.id
    snapshot = capture_register_inventory_snapshot(session, register_id=register_id, actor_id=staff_id)
    open_shift(
        session,
        register_id=register_id,
        opened_by=staff_id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 10}],
        opening_cash_minor=1000,
        inventory_snapshot_id=snapshot.id
    )

    # 4. Seed Membership Plan
    plan = Plan(code="mensual", name="Plan Mensual Libre", kind="membership", status="active")
    session.add(plan)
    session.flush()

    version = PlanVersion(
        plan_id=plan.id,
        version_number=1,
        name="Plan Mensual v1",
        price_minor=50000,
        currency="MXN",
        duration_value=1,
        duration_unit="month",
        is_active=True
    )
    session.add(version)
    session.flush()
    version_id = version.id

    # 5. Seed Members
    # Member 1: Active & Eligible
    m1 = Member(member_number="SOC-001", full_name="Carlos Gomez", preferred_name="Carlos", phone="5551234567", status="active")
    # Member 2: Inactive/Expired
    m2 = Member(member_number="SOC-002", full_name="Lucia Morales", preferred_name="Lucia", phone="5559876543", status="inactive")
    session.add_all([m1, m2])
    session.flush()
    m1_id = m1.id
    m2_id = m2.id

    # 6. Seed Sample Products and Initial Stock
    p1 = Product(code="agua-1l", name="Agua Natural 1L", category="Bebidas", price_minor=2000, cost_minor=1000, is_active=True, unit="piece", created_by=admin_id)
    p2 = Product(code="isotonica", name="Bebida Isotónica", category="Bebidas", price_minor=3500, cost_minor=1800, is_active=True, unit="piece", created_by=admin_id)
    session.add_all([p1, p2])
    session.flush()

    s1 = StockInitialization(branch_id=branch_id, product_id=p1.id, quantity=20, initialized_by=admin_id)
    s2 = StockInitialization(branch_id=branch_id, product_id=p2.id, quantity=15, initialized_by=admin_id)
    session.add_all([s1, s2])
    session.flush()

# 6. Issue reception session and buy membership for Member 1 using TestClient
from app.auth.sessions import issue_session
issued = issue_session(factory, login_identifier="recepcion", pin="123456", branch_id=branch_id, expires_at=datetime.now(timezone.utc) + timedelta(days=1))
token = issued.token

app = create_app(settings)
with TestClient(app) as client:
    # Sell membership to Member 1
    resp = client.post(
        f"/api/v1/registers/{register_id}/membership-sales",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "seed-sale-m1"},
        json={"member_id": str(m1_id), "plan_version_id": str(version_id)}
    )
    assert resp.status_code == 201, resp.text
    membership_period_id = resp.json()["membership"]["id"]

# 7. Seed Additional Receptionists & Schedules
from seed_receptionists import seed as seed_more_staff
seed_more_staff(session_factory=factory)

issued_pairing = issue_device_pairing_code(factory, admin_id, staff_id, ttl_seconds=86400)

print("=" * 60)
print("SEED COMPLETE ON POSTGRESQL")
print(f"Branch ID: {branch_id}")
print(f"Staff Token: {token}")
print(f"Pairing Code: {issued_pairing.raw_code}")
print(f"Admin Login: admin@evogym.com / Admin1234!")
print(f"Receptionist PIN: 123456")
print(f"Member 1 (Eligible): {m1_id} (Carlos Gomez)")
print(f"Member 2 (Ineligible): {m2_id} (Lucia Morales)")
print(f"Membership Period ID: {membership_period_id}")
print("=" * 60)
