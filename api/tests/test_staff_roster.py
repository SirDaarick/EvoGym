from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import Branch, RoleGrant, StaffCredential, StaffUser
from app.main import create_app
from test_admin_auth import configured_settings, seed_admin


def _setup(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'staff-roster.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    seed_admin(factory)
    with factory.begin() as session:
        branch_a = Branch(code="roster-a", name="Roster A")
        branch_b = Branch(code="roster-b", name="Roster B")
        receptionist = StaffUser(login_identifier="roster-desk@example.invalid")
        branch_admin = StaffUser(login_identifier="roster-admin@example.invalid")
        session.add_all([branch_a, branch_b, receptionist, branch_admin])
        session.flush()
        session.add_all([
            RoleGrant(staff_id=receptionist.id, role="receptionist", scope_kind="branch", branch_id=branch_a.id),
            StaffCredential(staff_id=receptionist.id, method="pin", secret_hash=hash_pin("2468")),
            RoleGrant(staff_id=branch_admin.id, role="admin", scope_kind="branch", branch_id=branch_a.id),
            StaffCredential(staff_id=branch_admin.id, method="pin", secret_hash=hash_pin("1357")),
        ])
        branch_a_id, branch_b_id = branch_a.id, branch_b.id
    receptionist_session = issue_session(
        factory, "roster-desk@example.invalid", "2468", branch_a_id,
        datetime.now(timezone.utc) + timedelta(hours=1),
    )
    branch_admin_session = issue_session(
        factory, "roster-admin@example.invalid", "1357", branch_a_id,
        datetime.now(timezone.utc) + timedelta(hours=1),
    )
    return url, engine, factory, branch_a_id, branch_b_id, receptionist_session.token, branch_admin_session.token


def test_roster_is_branch_scoped_admin_managed_and_supports_inactive_profiles(tmp_path):
    url, engine, factory, branch_a_id, branch_b_id, desk_token, branch_admin_token = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            admin_token = client.post("/api/v1/auth/sessions", json={
                "login_identifier": "owner@example.invalid", "password": "synthetic-admin-password",
            }).json()["access_token"]
            admin = {"Authorization": f"Bearer {admin_token}"}
            desk = {"Authorization": f"Bearer {desk_token}"}
            assert client.get("/api/v1/staff-roster", headers=admin).status_code == 200
            created = client.post(f"/api/v1/staff-roster/branches/{branch_a_id}", headers=admin,
                                  json={"full_name": "  Ana PÃ©rez ", "position": "Limpieza"})
            assert created.status_code == 201, created.text
            profile = created.json()
            assert profile["full_name"] == "Ana PÃ©rez" and profile["is_active"] is True
            assert client.get(f"/api/v1/staff-roster?branch_id={branch_b_id}", headers=admin).json()["items"] == []

            duplicate = client.post(f"/api/v1/staff-roster/branches/{branch_a_id}", headers=admin,
                                    json={"full_name": "ana pÃ©rez", "position": "RecepciÃ³n"})
            assert duplicate.status_code == 409
            invalid = client.post(f"/api/v1/staff-roster/branches/{branch_a_id}", headers=admin,
                                  json={"full_name": "   ", "position": "Limpieza"})
            assert invalid.status_code == 422
            cross_branch = client.patch(f"/api/v1/staff-roster/{profile['id']}", headers=admin,
                                        json={"branch_id": str(branch_b_id), "position": "Auxiliar"})
            assert cross_branch.status_code == 422

            listed = client.get(f"/api/v1/staff-roster?branch_id={branch_a_id}", headers=desk)
            assert listed.status_code == 200 and listed.json()["items"][0]["id"] == profile["id"]
            denied_write = client.patch(f"/api/v1/staff-roster/{profile['id']}", headers=desk,
                                        json={"position": "Auxiliar"})
            assert denied_write.status_code == 403
            deactivated = client.patch(f"/api/v1/staff-roster/{profile['id']}", headers=admin,
                                       json={"is_active": False})
            assert deactivated.status_code == 200 and deactivated.json()["is_active"] is False
            assert client.get(f"/api/v1/staff-roster?branch_id={branch_a_id}&include_inactive=true", headers=desk).json()["items"][0]["is_active"] is False
    finally:
        engine.dispose()
