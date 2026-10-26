from datetime import datetime, timedelta, timezone
import hashlib

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_reception_session, validate_session
from app.db.base import Base
from app.db.models import (
    AdminTrustedDevice, Branch, ReceptionStation, RoleGrant, StaffCredential,
    StaffRosterProfile, StaffUser,
)


@pytest.fixture
def station_store(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'mapped-reception-station.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    now = datetime.now(timezone.utc)
    admin_id = None
    with factory.begin() as session:
        admin = StaffUser(login_identifier="trusted-admin@example.invalid")
        employee = StaffUser(login_identifier="employee@example.invalid")
        branch = Branch(code="mapped-branch", name="Mapped Branch")
        session.add_all([admin, employee, branch])
        session.flush()
        profile = StaffRosterProfile(branch_id=branch.id, staff_user_id=employee.id,
                                     full_name="Employee", position="Reception")
        device = AdminTrustedDevice(
            staff_id=admin.id, category="computer", cookie_digest=hashlib.sha256(b"trusted").hexdigest(),
            created_at=now, last_used_at=now,
        )
        session.add_all([
            profile, device,
            RoleGrant(staff_id=employee.id, role="receptionist", scope_kind="branch", branch_id=branch.id),
            StaffCredential(staff_id=employee.id, method="pin", secret_hash=hash_pin("246810")),
        ])
        session.flush()
        station_secret = "s" * 43
        mapped = ReceptionStation(
            branch_id=branch.id, created_by=admin.id, source_admin_device_id=device.id,
            credential_digest=hashlib.sha256(station_secret.encode()).hexdigest(),
            created_at=now, expires_at=now + timedelta(days=90),
        )
        manual_secret = "m" * 43
        manual = ReceptionStation(
            branch_id=branch.id, created_by=admin.id,
            credential_digest=hashlib.sha256(manual_secret.encode()).hexdigest(),
            created_at=now, expires_at=now + timedelta(days=90),
        )
        session.add_all([mapped, manual])
        session.flush()
        ids = {
            "admin": admin.id, "employee": employee.id, "branch": branch.id,
            "profile": profile.id, "device": device.id,
            "mapped_station": mapped.id, "manual_station": manual.id,
            "mapped_secret": station_secret, "manual_secret": manual_secret,
        }
    yield factory, ids, now
    engine.dispose()


def test_revoked_or_wrong_category_admin_device_invalidates_mapped_station_sessions(station_store):
    factory, ids, now = station_store
    session = issue_reception_session(factory, ids["mapped_secret"], ids["profile"], "246810", clock=lambda: now)
    validate_session(factory, session.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now + timedelta(days=1))

    with factory.begin() as db:
        db.get(AdminTrustedDevice, ids["device"]).revoked_at = now + timedelta(days=2)
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, session.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now + timedelta(days=3))

    second = issue_reception_session(factory, ids["mapped_secret"], ids["profile"], "246810", clock=lambda: now + timedelta(days=4))
    with factory.begin() as db:
        device = db.get(AdminTrustedDevice, ids["device"])
        device.revoked_at = None
        device.category = "phone"
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, second.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now + timedelta(days=5))


def test_manual_reception_station_remains_usable_without_admin_device_mapping(station_store):
    factory, ids, now = station_store
    session = issue_reception_session(factory, ids["manual_secret"], ids["profile"], "246810", clock=lambda: now)
    validate_session(factory, session.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now + timedelta(days=1))


def test_one_active_admin_device_station_mapping_per_branch(station_store):
    factory, ids, now = station_store
    with pytest.raises(IntegrityError):
        with factory.begin() as db:
            db.add(ReceptionStation(
                branch_id=ids["branch"], created_by=ids["admin"], source_admin_device_id=ids["device"],
                credential_digest=hashlib.sha256(b"another").hexdigest(),
                created_at=now, expires_at=now + timedelta(days=90),
            ))
