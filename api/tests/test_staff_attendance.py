from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import StaffRosterProfile, StaffUser
from app.main import create_app
from test_admin_auth import configured_settings
from test_staff_roster import _setup


def _create_profiles(factory, branch_a_id, branch_b_id):
    with factory.begin() as session:
        active = StaffRosterProfile(branch_id=branch_a_id, full_name="Daily Cleaner", position="Cleaning")
        unmarked = StaffRosterProfile(branch_id=branch_a_id, full_name="Unmarked Reception", position="Reception")
        other_branch = StaffRosterProfile(branch_id=branch_b_id, full_name="North Cleaner", position="Cleaning")
        inactive = StaffRosterProfile(branch_id=branch_a_id, full_name="Inactive Cleaner", position="Cleaning", is_active=False)
        session.add_all([active, unmarked, other_branch, inactive])
        session.flush()
        return active.id, unmarked.id, other_branch.id, inactive.id


def test_receptionist_marks_present_once_with_server_time_and_local_date(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, branch_b_id, desk_token, branch_admin_token = _setup(tmp_path)
    profile_id, unmarked_id, other_profile_id, inactive_id = _create_profiles(factory, branch_a_id, branch_b_id)
    with factory() as session:
        receptionist_id = session.scalar(select(StaffUser.id).where(StaffUser.login_identifier == "roster-desk@example.invalid"))
    monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 21, 2, 30, tzinfo=timezone.utc))
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}
            assert client.get("/api/v1/staff-attendance", headers=desk).status_code == 200
            empty = client.get(f"/api/v1/staff-attendance?branch_id={branch_a_id}", headers=desk)
            assert empty.json() == {"items": [], "total": 0}

            marked = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}", headers=desk, json={},
            )
            assert marked.status_code == 201
            first = marked.json()
            replay = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}", headers=desk, json={},
            )
            assert replay.status_code == 200 and replay.json() == first
            with factory.begin() as session:
                profile = session.get(StaffRosterProfile, profile_id)
                profile.is_active = False
            replay_after_deactivation = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}", headers=desk, json={},
            )
            assert replay_after_deactivation.status_code == 200 and replay_after_deactivation.json() == first
            observed_at = datetime.fromisoformat(first["occurred_at"])
            assert observed_at.utcoffset().total_seconds() == 0
            assert first["business_date"] == "2026-10-20"
            assert first["recorded_by"] == str(receptionist_id)

            page = client.get(
                f"/api/v1/staff-attendance?branch_id={branch_a_id}&business_date={first['business_date']}", headers=desk,
            )
            assert page.status_code == 200 and page.json()["total"] == 1
            assert [item["profile_id"] for item in page.json()["items"]] == [str(profile_id)]
            assert "status" not in page.json()["items"][0]
            assert client.get(f"/api/v1/staff-attendance?branch_id={branch_b_id}", headers=desk).status_code == 404
            assert client.post(
                f"/api/v1/staff-attendance/branches/{branch_b_id}/profiles/{other_profile_id}", headers=desk, json={},
            ).status_code == 404
            assert client.patch(f"/api/v1/staff-attendance/{first['id']}", headers=desk, json={}).status_code == 404
            assert client.delete(f"/api/v1/staff-attendance/{first['id']}", headers=desk).status_code == 404
            assert unmarked_id != profile_id and inactive_id != profile_id
    finally:
        engine.dispose()


def test_attendance_authority_and_inactive_roster_protection(tmp_path):
    url, engine, factory, branch_a_id, branch_b_id, desk_token, branch_admin_token = _setup(tmp_path)
    profile_id, unmarked_id, other_profile_id, inactive_id = _create_profiles(factory, branch_a_id, branch_b_id)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            admin_token = client.post("/api/v1/auth/sessions", json={
                "login_identifier": "owner@example.invalid", "password": "synthetic-admin-password",
            }).json()["access_token"]
            admin = {"Authorization": f"Bearer {admin_token}"}
            branch_admin = {"Authorization": f"Bearer {branch_admin_token}"}
            desk = {"Authorization": f"Bearer {desk_token}"}
            mark = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}", headers=desk, json={},
            )
            assert mark.status_code == 201
            assert client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{unmarked_id}", headers=branch_admin, json={},
            ).status_code == 403
            assert client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{unmarked_id}", headers=admin, json={},
            ).status_code == 403
            assert client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{inactive_id}", headers=desk, json={},
            ).status_code == 409
            assert client.get(f"/api/v1/staff-attendance?branch_id={branch_a_id}", headers=branch_admin).status_code == 200
            assert client.get(f"/api/v1/staff-attendance?branch_id={branch_b_id}", headers=branch_admin).status_code == 404
            all_records = client.get("/api/v1/staff-attendance", headers=admin)
            assert all_records.status_code == 200 and all_records.json()["total"] == 1
            assert all_records.json()["items"][0]["branch_id"] == str(branch_a_id)
            assert client.get("/api/v1/staff-attendance").status_code == 401
    finally:
        engine.dispose()
