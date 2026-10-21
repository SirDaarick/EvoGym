from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import event, select

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
        from datetime import time
        for profile in (active, unmarked, other_branch, inactive):
            profile.expected_entry_time = time(9, 0)
            profile.grace_tolerance_minutes = 0
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
            assert page.json()["items"][0]["status"] == "late"
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


def test_schedule_classification_timezone_and_append_only_checkout(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    profile_id, late_profile_id, *_ = _create_profiles(factory, branch_a_id, branch_a_id)
    with factory.begin() as session:
        profile = session.get(StaffRosterProfile, profile_id)
        profile.expected_entry_time = datetime.strptime("21:00", "%H:%M").time()
        profile.grace_tolerance_minutes = 15
    monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 21, 3, 15, tzinfo=timezone.utc))
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}
            entry = client.post(f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}", headers=desk, json={})
            assert entry.status_code == 201
            item = entry.json()
            assert item["status"] == "present"
            assert item["expected_entry_time"] == "21:00:00" and item["grace_tolerance_minutes"] == 15
            checkout = client.post(f"/api/v1/staff-attendance/{item['id']}/checkout", headers=desk, json={})
            assert checkout.status_code == 201, checkout.text
            assert client.post(f"/api/v1/staff-attendance/{item['id']}/checkout", headers=desk, json={}).json() == checkout.json()
            checkin_replay = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}", headers=desk, json={}
            )
            listed = client.get("/api/v1/staff-attendance", headers=desk).json()["items"]
            listed_entry = next(row for row in listed if row["id"] == item["id"])
            assert checkin_replay.status_code == 200
            assert checkin_replay.json()["checkout_at"] == listed_entry["checkout_at"] == checkout.json()["occurred_at"]
            assert checkin_replay.json()["checkout_recorded_by"] == listed_entry["checkout_recorded_by"]
            assert client.post(f"/api/v1/staff-attendance/{UUID(int=1)}/checkout", headers=desk, json={}).status_code == 404
            monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 21, 3, 16, tzinfo=timezone.utc))
            with factory.begin() as session:
                late_profile = session.get(StaffRosterProfile, late_profile_id)
                late_profile.expected_entry_time = datetime.strptime("21:00", "%H:%M").time()
                late_profile.grace_tolerance_minutes = 15
            late = client.post(f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{late_profile_id}", headers=desk, json={})
            assert late.status_code == 201 and late.json()["status"] == "late"
    finally:
        engine.dispose()


def test_attendance_list_batches_checkout_lookup(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    with factory.begin() as session:
        profiles = [
            StaffRosterProfile(branch_id=branch_a_id, full_name=f"Batch Cleaner {index}", position="Cleaning")
            for index in range(3)
        ]
        for profile in profiles:
            profile.expected_entry_time = datetime.strptime("09:00", "%H:%M").time()
            profile.grace_tolerance_minutes = 0
        session.add_all(profiles)
        session.flush()
        profile_ids = [profile.id for profile in profiles]
    monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 21, 15, 0, tzinfo=timezone.utc))
    checkout_selects = []

    def record_checkout_select(_connection, _cursor, statement, _parameters, _context, _executemany):
        if "staff_attendance_checkouts" in statement.lower() and statement.lstrip().lower().startswith("select"):
            checkout_selects.append(statement)

    app = create_app(configured_settings(url))
    observed_engine = None
    try:
        with TestClient(app) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}
            for profile_id in profile_ids:
                entry = client.post(
                    f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}", headers=desk, json={}
                )
                assert entry.status_code == 201, entry.text
            observed_engine = app.state.database_engine
            event.listen(observed_engine, "before_cursor_execute", record_checkout_select)
            result = client.get("/api/v1/staff-attendance", headers=desk)
            assert result.status_code == 200 and len(result.json()["items"]) == 3
            assert len(checkout_selects) == 1
    finally:
        if observed_engine is not None:
            event.remove(observed_engine, "before_cursor_execute", record_checkout_select)
        engine.dispose()


def test_attendance_requires_complete_schedule(tmp_path):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    profile_id, *_ = _create_profiles(factory, branch_a_id, branch_a_id)
    with factory.begin() as session:
        profile = session.get(StaffRosterProfile, profile_id)
        profile.expected_entry_time = None
        profile.grace_tolerance_minutes = None
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            result = client.post(f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                                 headers={"Authorization": f"Bearer {desk_token}"}, json={})
            assert result.status_code == 409
            assert result.status_code == 409
    finally:
        engine.dispose()
