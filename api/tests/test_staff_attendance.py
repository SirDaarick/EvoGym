from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, select

from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.models import (
    RoleGrant,
    StaffCredential,
    StaffRosterProfile,
    StaffScheduleException,
    StaffScheduleSeries,
    StaffUser,
)
from app.db.models.staff_attendance import StaffAttendanceCorrection, StaffAttendanceRecord
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings
from admin_session_helpers import approved_admin_headers
from test_staff_roster import _setup


def _create_profiles(factory, branch_a_id, branch_b_id):
    with factory.begin() as session:
        active = StaffRosterProfile(branch_id=branch_a_id, full_name="Daily Cleaner", position="Cleaning")
        unmarked = StaffRosterProfile(branch_id=branch_a_id, full_name="Unmarked Reception", position="Reception")
        other_branch = StaffRosterProfile(branch_id=branch_b_id, full_name="North Cleaner", position="Cleaning")
        inactive = StaffRosterProfile(branch_id=branch_a_id, full_name="Inactive Cleaner", position="Cleaning", is_active=False)
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
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            admin = approved_admin_headers(client, delivery)
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
    finally:
        engine.dispose()


def test_scheduled_occurrence_check_in_present_vs_late_and_override(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    with factory.begin() as session:
        receptionist_id = session.scalar(select(StaffUser.id).where(StaffUser.login_identifier == "roster-desk@example.invalid"))
        profile = StaffRosterProfile(branch_id=branch_a_id, full_name="Scheduled Coach", position="Trainer")
        profile.expected_entry_time = time(9, 0)
        profile.grace_tolerance_minutes = 15
        session.add(profile)
        session.flush()
        profile_id = profile.id

        series = StaffScheduleSeries(
            profile_id=profile_id,
            branch_id=branch_a_id,
            start_date=date(2026, 10, 1),
            weekdays=[4],  # Friday
            start_time=time(9, 0),
            end_time=time(17, 0),
            created_by=receptionist_id,
            timezone_rules_digest="test-digest",
        )
        session.add(series)
        session.flush()
        series_id = series.id

    try:
        with TestClient(create_app(configured_settings(url))) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}
            # Shift is 09:00 local time (15:00 UTC in Mexico City UTC-6) on 2026-10-23
            # Case 1: On-time entry at 09:10 local (15:10 UTC) <= 09:15 cutoff -> "present"
            monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 23, 15, 10, tzinfo=timezone.utc))
            res = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json={
                    "series_id": str(series_id),
                    "occurrence_date": "2026-10-23",
                    "device_captured_at": "2026-10-23T15:10:00Z",
                    "idempotency_key": "idemp-tc-01",
                },
            )
            assert res.status_code == 201, res.text
            body = res.json()
            assert body["status"] == "present"
            assert body["scheduled_start_time"] == "09:00:00"
            assert body["scheduled_end_time"] == "17:00:00"
            assert body["clock_validation_status"] == "trusted"
            assert body["review_required"] is False
            assert body["schedule_conflict"] is False

            # Create another profile for late check-in on the same shift series definition
            with factory.begin() as session:
                late_prof = StaffRosterProfile(branch_id=branch_a_id, full_name="Late Coach", position="Trainer")
                late_prof.expected_entry_time = time(9, 0)
                late_prof.grace_tolerance_minutes = 15
                session.add(late_prof)
                session.flush()
                late_prof_id = late_prof.id
                late_series = StaffScheduleSeries(
                    profile_id=late_prof_id,
                    branch_id=branch_a_id,
                    start_date=date(2026, 10, 1),
                    weekdays=[4],
                    start_time=time(9, 0),
                    end_time=time(17, 0),
                    created_by=receptionist_id,
                    timezone_rules_digest="test-digest",
                )
                session.add(late_series)
                session.flush()
                late_series_id = late_series.id

            # Case 2: Late entry at 09:20 local (15:20 UTC) > 09:15 cutoff -> "late"
            monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 23, 15, 20, tzinfo=timezone.utc))
            res_late = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{late_prof_id}",
                headers=desk,
                json={
                    "series_id": str(late_series_id),
                    "occurrence_date": "2026-10-23",
                    "device_captured_at": "2026-10-23T15:20:00Z",
                    "idempotency_key": "idemp-tc-02",
                },
            )
            assert res_late.status_code == 201, res_late.text
            assert res_late.json()["status"] == "late"

            # Case 3: Exception override changes start_time from 09:00 to 10:00 on 2026-10-30
            with factory.begin() as session:
                exc = StaffScheduleException(
                    series_id=late_series_id,
                    local_date=date(2026, 10, 30),
                    action="override",
                    original_start_time=time(9, 0),
                    original_end_time=time(17, 0),
                    override_start_time=time(10, 0),
                    override_end_time=time(18, 0),
                    recorded_by=receptionist_id,
                )
                session.add(exc)

            # Entry at 10:10 local (16:10 UTC) -> with 15m tolerance cutoff is 10:15 -> "present"
            monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 30, 16, 10, tzinfo=timezone.utc))
            res_override = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{late_prof_id}",
                headers=desk,
                json={
                    "series_id": str(late_series_id),
                    "occurrence_date": "2026-10-30",
                    "device_captured_at": "2026-10-30T16:10:00Z",
                    "idempotency_key": "idemp-tc-03",
                },
            )
            assert res_override.status_code == 201, res_override.text
            assert res_override.json()["status"] == "present"
            assert res_override.json()["scheduled_start_time"] == "10:00:00"
            assert res_override.json()["scheduled_end_time"] == "18:00:00"
    finally:
        engine.dispose()


def test_multi_shift_same_day_across_different_series_and_adhoc(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    with factory.begin() as session:
        receptionist_id = session.scalar(select(StaffUser.id).where(StaffUser.login_identifier == "roster-desk@example.invalid"))
        profile = StaffRosterProfile(branch_id=branch_a_id, full_name="Multi-Shift Coach", position="Trainer")
        profile.expected_entry_time = time(8, 0)
        profile.grace_tolerance_minutes = 15
        session.add(profile)
        session.flush()
        profile_id = profile.id

        series_morning = StaffScheduleSeries(
            profile_id=profile_id,
            branch_id=branch_a_id,
            start_date=date(2026, 10, 1),
            weekdays=[4],
            start_time=time(8, 0),
            end_time=time(12, 0),
            created_by=receptionist_id,
        )
        series_evening = StaffScheduleSeries(
            profile_id=profile_id,
            branch_id=branch_a_id,
            start_date=date(2026, 10, 1),
            weekdays=[4],
            start_time=time(16, 0),
            end_time=time(20, 0),
            created_by=receptionist_id,
        )
        session.add_all([series_morning, series_evening])
        session.flush()
        s1_id, s2_id = series_morning.id, series_evening.id

    try:
        with TestClient(create_app(configured_settings(url))) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}
            monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 23, 14, 0, tzinfo=timezone.utc))

            # 1. Morning shift check-in
            r1 = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json={"series_id": str(s1_id), "occurrence_date": "2026-10-23", "idempotency_key": "shift-1-key"},
            )
            assert r1.status_code == 201, r1.text

            # 2. Evening shift check-in on the SAME day for the SAME profile
            r2 = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json={"series_id": str(s2_id), "occurrence_date": "2026-10-23", "idempotency_key": "shift-2-key"},
            )
            assert r2.status_code == 201, r2.text

            # 3. Ad-hoc shift check-in on the SAME day for the SAME profile
            r3 = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json={"idempotency_key": "shift-adhoc-key"},
            )
            assert r3.status_code == 201, r3.text

            # Verify all three distinct records exist
            page = client.get(f"/api/v1/staff-attendance?branch_id={branch_a_id}&business_date=2026-10-23", headers=desk)
            assert page.status_code == 200
            assert page.json()["total"] == 3

            # 4. Attempt duplicate check-in for morning shift with a DIFFERENT key -> 409 Conflict
            r_dup = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json={"series_id": str(s1_id), "occurrence_date": "2026-10-23", "idempotency_key": "different-key"},
            )
            assert r_dup.status_code == 409
    finally:
        engine.dispose()


def test_clock_integrity_d033(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    profile_id, *_ = _create_profiles(factory, branch_a_id, branch_a_id)

    # Server receives payload at 12:00:00 UTC
    server_time = datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: server_time)

    try:
        with TestClient(create_app(configured_settings(url))) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}

            # Case A: Exactly 300 seconds skew (5 minutes) -> trusted
            dev_300 = datetime(2026, 10, 23, 11, 55, 0, tzinfo=timezone.utc).isoformat()
            res_300 = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json={"device_captured_at": dev_300, "idempotency_key": "clock-skew-300"},
            )
            assert res_300.status_code == 201, res_300.text
            body_300 = res_300.json()
            assert body_300["clock_validation_status"] == "trusted"
            assert body_300["review_required"] is False
            assert body_300["clock_skew_seconds"] == 300
            assert body_300["device_captured_at"] == "2026-10-23T11:55:00Z"
            assert body_300["server_received_at"] == "2026-10-23T12:00:00Z"

            # Create another profile for excessive skew test
            with factory.begin() as session:
                prof2 = StaffRosterProfile(branch_id=branch_a_id, full_name="Skewed Profile", position="Staff")
                prof2.expected_entry_time = time(9, 0)
                prof2.grace_tolerance_minutes = 15
                session.add(prof2)
                session.flush()
                prof2_id = prof2.id

            # Case B: 301 seconds skew (> 300s) -> review_required
            dev_301 = datetime(2026, 10, 23, 11, 54, 59, tzinfo=timezone.utc).isoformat()
            res_301 = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{prof2_id}",
                headers=desk,
                json={"device_captured_at": dev_301, "idempotency_key": "clock-skew-301"},
            )
            assert res_301.status_code == 201, res_301.text
            body_301 = res_301.json()
            assert body_301["clock_validation_status"] == "review_required"
            assert body_301["review_required"] is True
            assert body_301["clock_skew_seconds"] == 301
            assert body_301["device_captured_at"] == "2026-10-23T11:54:59Z"
            assert body_301["server_received_at"] == "2026-10-23T12:00:00Z"
    finally:
        engine.dispose()


def test_idempotency_replay_and_conflict(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    profile_id, prof2_id, *_ = _create_profiles(factory, branch_a_id, branch_a_id)
    monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 23, 15, 0, tzinfo=timezone.utc))

    try:
        with TestClient(create_app(configured_settings(url))) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}
            payload = {
                "idempotency_key": "idem-key-999",
                "device_captured_at": "2026-10-23T15:00:00Z",
            }
            # First submission -> 201
            first = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json=payload,
            )
            assert first.status_code == 201
            first_data = first.json()

            # Exact replay -> 200 with identical record
            replay = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json=payload,
            )
            assert replay.status_code == 200
            assert replay.json() == first_data

            # Conflicting submission with same key but different profile -> 409
            conflict = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{prof2_id}",
                headers=desk,
                json=payload,
            )
            assert conflict.status_code == 409
    finally:
        engine.dispose()


def test_missing_and_early_checkout(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    profile_id, *_ = _create_profiles(factory, branch_a_id, branch_a_id)
    monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 23, 14, 0, tzinfo=timezone.utc))

    try:
        with TestClient(create_app(configured_settings(url))) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}
            entry = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json={"device_captured_at": "2026-10-23T14:00:00Z"},
            )
            assert entry.status_code == 201
            entry_id = entry.json()["id"]

            # 1. Missing checkout remains None
            page = client.get(f"/api/v1/staff-attendance?branch_id={branch_a_id}", headers=desk)
            item = next(i for i in page.json()["items"] if i["id"] == entry_id)
            assert item["checkout_at"] is None

            # 2. Early checkout recorded with actual exit timestamp, without altering status
            monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 23, 18, 30, tzinfo=timezone.utc))
            checkout = client.post(
                f"/api/v1/staff-attendance/{entry_id}/checkout",
                headers=desk,
                json={"device_captured_at": "2026-10-23T18:30:00Z"},
            )
            assert checkout.status_code == 201
            assert checkout.json()["occurred_at"] == "2026-10-23T18:30:00Z"

            # Entry status remains unchanged
            page_after = client.get(f"/api/v1/staff-attendance?branch_id={branch_a_id}", headers=desk)
            item_after = next(i for i in page_after.json()["items"] if i["id"] == entry_id)
            assert item_after["status"] == item["status"]
            assert item_after["checkout_at"] == "2026-10-23T18:30:00Z"
    finally:
        engine.dispose()


def test_append_only_correction_rbac_and_immutability(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    profile_id, *_ = _create_profiles(factory, branch_a_id, branch_b_id)

    # Create a receptionist for Branch B
    with factory.begin() as session:
        desk_b = StaffUser(login_identifier="roster-desk-b@example.invalid")
        session.add(desk_b)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=desk_b.id, role="receptionist", scope_kind="branch", branch_id=branch_b_id),
            StaffCredential(staff_id=desk_b.id, method="pin", secret_hash=hash_pin("9999")),
        ])
    desk_b_session = issue_session(
        factory, "roster-desk-b@example.invalid", "9999", branch_b_id,
        datetime.now(timezone.utc) + timedelta(hours=1),
    )
    desk_b_token = desk_b_session.token

    monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 23, 14, 0, tzinfo=timezone.utc))

    try:
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            desk_a = {"Authorization": f"Bearer {desk_token}"}
            desk_b = {"Authorization": f"Bearer {desk_b_token}"}
            admin_token = complete_device_login(
                client, delivery, "owner@example.invalid", "synthetic-admin-password"
            ).json()["access_token"]
            admin = {"Authorization": f"Bearer {admin_token}"}

            # Create record in Branch A
            entry = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk_a,
                json={},
            )
            assert entry.status_code == 201
            entry_id = entry.json()["id"]

            correction_payload = {
                "field_name": "status",
                "corrected_value": "present",
                "reason": "Supervisor confirmed terminal was offline during start time",
            }

            # 1. Receptionist from Branch B attempts correction on Branch A record -> 403 Forbidden
            r_b = client.post(f"/api/v1/staff-attendance/{entry_id}/corrections", headers=desk_b, json=correction_payload)
            assert r_b.status_code == 403

            # 2. Receptionist from Branch A corrects record in their own branch -> 201 Created
            r_a = client.post(f"/api/v1/staff-attendance/{entry_id}/corrections", headers=desk_a, json=correction_payload)
            assert r_a.status_code == 201
            corr_a = r_a.json()
            assert corr_a["field_name"] == "status"
            assert corr_a["corrected_value"] == "present"
            assert corr_a["attendance_id"] == entry_id

            # 3. Administrator corrects record in Branch A -> 201 Created
            admin_corr_payload = {
                "field_name": "status",
                "corrected_value": "late",
                "reason": "Audit review determined badge was swiped late by colleague",
            }
            r_admin = client.post(f"/api/v1/staff-attendance/{entry_id}/corrections", headers=admin, json=admin_corr_payload)
            assert r_admin.status_code == 201

            # 4. Verify DB immutability: StaffAttendanceRecord remains unmodified
            with factory() as session:
                db_record = session.get(StaffAttendanceRecord, UUID(entry_id))
                assert db_record.status == entry.json()["status"]  # Original value preserved!

                corrections = session.scalars(
                    select(StaffAttendanceCorrection).where(StaffAttendanceCorrection.attendance_id == UUID(entry_id))
                ).all()
                assert len(corrections) == 2

            # 5. Direct mutation of correction record is blocked by event listener
            with factory.begin() as session:
                corr_row = session.get(StaffAttendanceCorrection, UUID(corr_a["id"]))
                corr_row.reason = "Mutated reason attempt"
                with pytest.raises(ValueError, match="Staff attendance corrections are append-only"):
                    session.flush()
    finally:
        engine.dispose()


def test_offline_event_against_cancelled_series(tmp_path, monkeypatch):
    url, engine, factory, branch_a_id, _branch_b_id, desk_token, _admin_token = _setup(tmp_path)
    with factory.begin() as session:
        receptionist_id = session.scalar(select(StaffUser.id).where(StaffUser.login_identifier == "roster-desk@example.invalid"))
        profile = StaffRosterProfile(branch_id=branch_a_id, full_name="Cancelled Shift Staff", position="Front Desk")
        session.add(profile)
        session.flush()
        profile_id = profile.id

        # Series cancelled starting from 2026-10-20
        series = StaffScheduleSeries(
            profile_id=profile_id,
            branch_id=branch_a_id,
            start_date=date(2026, 10, 1),
            weekdays=[4],
            start_time=time(9, 0),
            end_time=time(17, 0),
            cancelled_from=date(2026, 10, 20),
            created_by=receptionist_id,
        )
        session.add(series)
        session.flush()
        series_id = series.id

    monkeypatch.setattr("app.api.staff_attendance.utc_now", lambda: datetime(2026, 10, 23, 15, 0, tzinfo=timezone.utc))

    try:
        with TestClient(create_app(configured_settings(url))) as client:
            desk = {"Authorization": f"Bearer {desk_token}"}
            # Clock-in recorded offline against cancelled series on 2026-10-23
            res = client.post(
                f"/api/v1/staff-attendance/branches/{branch_a_id}/profiles/{profile_id}",
                headers=desk,
                json={
                    "series_id": str(series_id),
                    "occurrence_date": "2026-10-23",
                    "device_captured_at": "2026-10-23T15:00:00Z",
                    "idempotency_key": "offline-cancelled-mark",
                },
            )
            assert res.status_code == 201, res.text
            data = res.json()
            # Retains and stores mark, but flags conflict and review required
            assert data["schedule_conflict"] is True
            assert data["review_required"] is True

            with factory() as session:
                rec = session.get(StaffAttendanceRecord, UUID(data["id"]))
                assert rec is not None
                assert rec.schedule_conflict is True
                assert rec.review_required is True
    finally:
        engine.dispose()
