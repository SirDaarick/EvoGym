from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker

from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import Branch, RoleGrant, StaffCredential, StaffRosterProfile, StaffScheduleException, StaffScheduleSeries, StaffUser
from app.main import create_app
from test_admin_auth import configured_settings, seed_admin


def _setup(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'staff-schedules.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    seed_admin(factory)
    with factory.begin() as session:
        branch_a = Branch(code="schedule-a", name="Schedule A", timezone="America/Mexico_City")
        branch_b = Branch(code="schedule-b", name="Schedule B", timezone="America/Mexico_City")
        admin = StaffUser(login_identifier="schedule-admin@example.invalid")
        receptionist = StaffUser(login_identifier="schedule-desk@example.invalid")
        session.add_all([branch_a, branch_b, admin, receptionist])
        session.flush()
        profile_a = StaffRosterProfile(branch_id=branch_a.id, full_name="Ana", position="Coach")
        profile_b = StaffRosterProfile(branch_id=branch_b.id, full_name="Ana", position="Coach")
        session.add_all([profile_a, profile_b])
        session.flush()
        session.add_all([
            RoleGrant(staff_id=admin.id, role="admin", scope_kind="organization"),
            StaffCredential(staff_id=admin.id, method="pin", secret_hash=hash_pin("1357")),
            RoleGrant(staff_id=receptionist.id, role="receptionist", scope_kind="branch", branch_id=branch_a.id),
            StaffCredential(staff_id=receptionist.id, method="pin", secret_hash=hash_pin("2468")),
        ])
        branch_a_id, branch_b_id = branch_a.id, branch_b.id
        profile_a_id, profile_b_id = profile_a.id, profile_b.id
    admin_session = issue_session(factory, "schedule-admin@example.invalid", "1357", branch_a_id,
                                   datetime.now(timezone.utc) + timedelta(hours=1))
    desk_session = issue_session(factory, "schedule-desk@example.invalid", "2468", branch_a_id,
                                  datetime.now(timezone.utc) + timedelta(hours=1))
    return url, engine, factory, branch_a_id, branch_b_id, profile_a_id, profile_b_id, admin_session.token, desk_session.token


def test_weekly_schedule_expands_in_branch_wall_time_and_supports_skip_and_override(tmp_path):
    url, engine, _factory, branch_id, _other, profile_id, _other_profile, admin_token, _desk = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {admin_token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch_id}/profiles/{profile_id}", headers=headers, json={
                "start_date": "2026-10-26", "weekdays": [0, 2], "start_time": "22:00", "end_time": "02:00",
                "end_date": "2026-11-10",
            })
            assert created.status_code == 201, created.text
            series_id = created.json()["id"]
            occurrences = client.get(f"/api/v1/staff-schedules/{series_id}/occurrences", headers=headers,
                                     params={"from_date": "2026-10-26", "to_date": "2026-11-10"})
            assert occurrences.status_code == 200, occurrences.text
            assert [item["local_start"] for item in occurrences.json()] == [
                "2026-10-26T22:00:00", "2026-10-28T22:00:00", "2026-11-02T22:00:00",
                "2026-11-04T22:00:00", "2026-11-09T22:00:00",
            ]
            skipped = client.put(f"/api/v1/staff-schedules/{series_id}/occurrences/2026-10-28", headers=headers,
                                 json={"action": "skip"})
            assert skipped.status_code == 200, skipped.text
            overridden = client.put(f"/api/v1/staff-schedules/{series_id}/occurrences/2026-11-02", headers=headers,
                                    json={"action": "override", "start_time": "21:30", "end_time": "23:30"})
            assert overridden.status_code == 200, overridden.text
            visible = client.get(f"/api/v1/staff-schedules/{series_id}/occurrences", headers=headers,
                                 params={"from_date": "2026-10-26", "to_date": "2026-11-10"}).json()
            assert len(visible) == 4
            assert all(item["local_start"] != "2026-10-28T22:00:00" for item in visible)
            assert next(item for item in visible if item["local_start"].startswith("2026-11-02"))["local_start"] == "2026-11-02T21:30:00"
    finally:
        engine.dispose()


def test_weekly_overlap_is_profile_scoped_and_admin_only(tmp_path):
    url, engine, _factory, branch_a, branch_b, profile_a, profile_b, admin_token, desk_token = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            admin = {"Authorization": f"Bearer {admin_token}"}
            desk = {"Authorization": f"Bearer {desk_token}"}
            payload = {"start_date": "2026-10-26", "weekdays": [0], "start_time": "09:00", "end_time": "10:00"}
            first = client.post(f"/api/v1/staff-schedules/branches/{branch_a}/profiles/{profile_a}", headers=admin, json=payload)
            assert first.status_code == 201, first.text
            overlap = client.post(f"/api/v1/staff-schedules/branches/{branch_a}/profiles/{profile_a}", headers=admin,
                                  json={**payload, "start_time": "09:30", "end_time": "10:30"})
            assert overlap.status_code == 409
            other_branch = client.post(f"/api/v1/staff-schedules/branches/{branch_b}/profiles/{profile_b}", headers=admin, json=payload)
            assert other_branch.status_code == 201
            denied = client.post(f"/api/v1/staff-schedules/branches/{branch_a}/profiles/{profile_a}", headers=desk, json=payload)
            assert denied.status_code == 403
    finally:
        engine.dispose()


def test_schedule_can_end_by_occurrence_count_and_edit_future_without_rewriting_past(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, admin_token, _desk = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {admin_token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-26", "weekdays": [0], "start_time": "09:00", "end_time": "10:00", "occurrence_count": 4,
            })
            assert created.status_code == 201, created.text
            series_id = created.json()["id"]
            future = client.patch(f"/api/v1/staff-schedules/{series_id}/edit", headers=headers, json={
                "effective_date": "2026-11-09", "scope": "this_and_future", "start_time": "11:00", "end_time": "12:00",
            })
            assert future.status_code == 201, future.text
            old = client.get(f"/api/v1/staff-schedules/{series_id}/occurrences", headers=headers,
                             params={"from_date": "2026-10-26", "to_date": "2026-11-30"}).json()
            new_id = future.json()["id"]
            upcoming = client.get(f"/api/v1/staff-schedules/{new_id}/occurrences", headers=headers,
                                  params={"from_date": "2026-10-26", "to_date": "2026-11-30"}).json()
            assert [item["local_start"] for item in old] == ["2026-10-26T09:00:00", "2026-11-02T09:00:00"]
            assert [item["local_start"] for item in upcoming] == ["2026-11-09T11:00:00", "2026-11-16T11:00:00"]
    finally:
        engine.dispose()










def test_edit_before_first_occurrence_updates_series_without_invalid_empty_history(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, admin_token, _desk = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {admin_token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-26", "weekdays": [0], "start_time": "09:00", "end_time": "10:00", "occurrence_count": 4,
            })
            assert created.status_code == 201, created.text
            series_id = created.json()["id"]
            edited = client.patch(f"/api/v1/staff-schedules/{series_id}/edit", headers=headers, json={
                "effective_date": "2026-10-26", "scope": "series", "start_time": "11:00", "end_time": "12:00",
            })
            assert edited.status_code == 201, edited.text
            assert edited.json()["id"] == series_id
            assert edited.json()["occurrence_count"] == 4
    finally:
        engine.dispose()


def test_weekly_occurrences_keep_branch_wall_time_across_dst(tmp_path):
    url, engine, factory, branch, _other, profile, _other_profile, admin_token, _desk = _setup(tmp_path)
    try:
        with factory.begin() as session:
            session.get(Branch, branch).timezone = "America/New_York"
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {admin_token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-03-01", "weekdays": [6], "start_time": "09:00", "end_time": "10:00",
                "end_date": "2026-03-15",
            })
            assert created.status_code == 201, created.text
            rows = client.get(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences", headers=headers,
                              params={"from_date": "2026-03-01", "to_date": "2026-03-15"}).json()
            assert [row["local_start"] for row in rows] == [
                "2026-03-01T09:00:00", "2026-03-08T09:00:00", "2026-03-15T09:00:00",
            ]
            assert [row["starts_at"] for row in rows] == [
                "2026-03-01T14:00:00+00:00", "2026-03-08T13:00:00+00:00", "2026-03-15T13:00:00+00:00",
            ]
            with factory() as session:
                prior_digest = session.scalar(select(StaffScheduleSeries.timezone_rules_digest).where(StaffScheduleSeries.id == UUID(created.json()["id"])))
            with factory.begin() as session:
                session.get(Branch, branch).timezone = "America/Chicago"
            rechecked = client.get(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences", headers=headers,
                                  params={"from_date": "2026-03-01", "to_date": "2026-03-15"})
            assert rechecked.status_code == 200, rechecked.text
            with factory() as session:
                current_digest = session.scalar(select(StaffScheduleSeries.timezone_rules_digest).where(StaffScheduleSeries.id == UUID(created.json()["id"])))
            assert current_digest != prior_digest
    finally:
        engine.dispose()


def test_overnight_weekly_shifts_overlap_the_following_local_day(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, admin_token, _desk = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {admin_token}"}
            sunday = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-25", "weekdays": [6], "start_time": "22:00", "end_time": "02:00",
            })
            assert sunday.status_code == 201, sunday.text
            monday = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-25", "weekdays": [0], "start_time": "01:00", "end_time": "03:00",
            })
            assert monday.status_code == 409
    finally:
        engine.dispose()

def test_full_series_edit_changes_all_future_occurrences_and_keeps_history(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, admin_token, _desk = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {admin_token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-12", "weekdays": [0], "start_time": "09:00", "end_time": "10:00",
            })
            assert created.status_code == 201, created.text
            series_id = created.json()["id"]
            edited = client.patch(f"/api/v1/staff-schedules/{series_id}/edit", headers=headers, json={
                "effective_date": "2026-11-02", "scope": "series", "start_time": "11:00", "end_time": "12:00",
            })
            assert edited.status_code == 201, edited.text
            old = client.get(f"/api/v1/staff-schedules/{series_id}/occurrences", headers=headers,
                             params={"from_date": "2026-10-12", "to_date": "2026-11-02"}).json()
            new = client.get(f"/api/v1/staff-schedules/{edited.json()['id']}/occurrences", headers=headers,
                             params={"from_date": "2026-10-12", "to_date": "2026-11-02"}).json()
            assert [item["local_start"] for item in old] == ["2026-10-12T09:00:00", "2026-10-19T09:00:00"]
            assert [item["local_start"] for item in new] == ["2026-10-26T11:00:00", "2026-11-02T11:00:00"]
    finally:
        engine.dispose()




def _next_weekday(target, *, days_ahead=0):
    today = date.today() + timedelta(days=days_ahead)
    return today + timedelta(days=(target - today.weekday()) % 7)


def test_empty_weekdays_are_rejected_by_portable_model_constraint(tmp_path):
    from sqlalchemy.exc import IntegrityError
    import pytest

    _url, engine, factory, branch, _other, profile, _other_profile, _token, _desk = _setup(tmp_path)
    try:
        with factory() as session:
            actor = session.scalar(select(StaffUser).where(StaffUser.login_identifier == "schedule-admin@example.invalid"))
            actor_id = actor.id
        with pytest.raises(IntegrityError):
            with factory.begin() as session:
                session.add(StaffScheduleSeries(profile_id=profile, branch_id=branch, start_date=date(2026, 10, 26),
                    weekdays=[], start_time=datetime.min.time(), end_time=datetime.min.time(), created_by=actor_id))
    finally:
        engine.dispose()


def test_lone_schedule_rejects_nonexistent_wall_time_and_fold_uses_earlier_occurrence(tmp_path):
    url, engine, factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        with factory.begin() as session:
            session.get(Branch, branch).timezone = "America/New_York"
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            gap = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-03-08", "weekdays": [6], "start_time": "02:30", "end_time": "03:30", "end_date": "2026-03-08"})
            assert gap.status_code == 422, gap.text
            fold = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-11-01", "weekdays": [6], "start_time": "01:30", "end_time": "02:30", "end_date": "2026-11-01"})
            assert fold.status_code == 201, fold.text
            rows = client.get(f"/api/v1/staff-schedules/{fold.json()['id']}/occurrences", headers=headers,
                              params={"from_date": "2026-11-01", "to_date": "2026-11-01"})
            assert rows.status_code == 200, rows.text
            assert rows.json()[0]["starts_at"] == "2026-11-01T05:30:00+00:00"
    finally:
        engine.dispose()


def test_override_checks_previous_overnight_occurrence_of_same_series(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        saturday = _next_weekday(5, days_ahead=1)
        sunday = saturday + timedelta(days=1)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": saturday.isoformat(), "weekdays": [0, 1, 2, 3, 4, 5, 6],
                "start_time": "22:00", "end_time": "02:00", "end_date": (saturday + timedelta(days=6)).isoformat()})
            assert created.status_code == 201, created.text
            changed = client.put(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences/{sunday.isoformat()}", headers=headers,
                                 json={"action": "override", "start_time": "00:00", "end_time": "03:00"})
            assert changed.status_code == 409, changed.text
    finally:
        engine.dispose()


def test_future_exception_moves_before_replacement_overlap_validation(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        monday = _next_weekday(0, days_ahead=14)
        prior_monday = monday - timedelta(days=14)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            first = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": prior_monday.isoformat(), "weekdays": [0], "start_time": "09:00", "end_time": "10:00"})
            assert first.status_code == 201, first.text
            exception = client.put(f"/api/v1/staff-schedules/{first.json()['id']}/occurrences/{monday.isoformat()}", headers=headers,
                                   json={"action": "skip"})
            assert exception.status_code == 200, exception.text
            peer = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": monday.isoformat(), "weekdays": [0], "start_time": "11:00", "end_time": "12:00", "end_date": monday.isoformat()})
            assert peer.status_code == 201, peer.text
            edited = client.patch(f"/api/v1/staff-schedules/{first.json()['id']}/edit", headers=headers, json={
                "effective_date": monday.isoformat(), "scope": "this_and_future", "start_time": "11:00", "end_time": "12:00", "end_date": monday.isoformat()})
            assert edited.status_code == 201, edited.text
            visible = client.get(f"/api/v1/staff-schedules/{edited.json()['id']}/occurrences", headers=headers,
                                 params={"from_date": monday.isoformat(), "to_date": monday.isoformat()})
            assert visible.status_code == 200, visible.text
            assert visible.json() == []
    finally:
        engine.dispose()


def test_cancel_before_first_occurrence_preserves_history_without_zero_count(tmp_path):
    url, engine, factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        start = _next_weekday(0, days_ahead=7)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": start.isoformat(), "weekdays": [0], "start_time": "09:00", "end_time": "10:00", "occurrence_count": 1})
            assert created.status_code == 201, created.text
            deleted = client.delete(f"/api/v1/staff-schedules/{created.json()['id']}", headers=headers)
            assert deleted.status_code == 204, deleted.text
            rows = client.get(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences", headers=headers,
                              params={"from_date": start.isoformat(), "to_date": start.isoformat()})
            assert rows.status_code == 200, rows.text
            assert rows.json() == []
            with factory() as session:
                row = session.get(StaffScheduleSeries, UUID(created.json()["id"]))
                assert row.cancelled_from == start
    finally:
        engine.dispose()


def test_series_edit_revalidates_weekdays_and_offsetless_times(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        monday = _next_weekday(0, days_ahead=7)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": monday.isoformat(), "weekdays": [0], "start_time": "09:00", "end_time": "10:00"})
            assert created.status_code == 201, created.text
            invalid_rules = [
                {"weekdays": [7]},
                {"start_time": "09:00+00:00"},
                {"end_date": (monday - timedelta(days=1)).isoformat()},
                {"end_date": monday.isoformat(), "occurrence_count": 3},
            ]
            for patch in invalid_rules:
                edited = client.patch(f"/api/v1/staff-schedules/{created.json()['id']}/edit", headers=headers, json={
                    "effective_date": monday.isoformat(), "scope": "series", **patch})
                assert edited.status_code == 422, edited.text
    finally:
        engine.dispose()


def test_canonical_models_module_has_no_utf8_bom():
    from pathlib import Path

    path = Path(__file__).parents[1] / "app" / "db" / "models" / "__init__.py"
    assert not path.read_bytes().startswith(b"\xef\xbb\xbf")


def test_timezone_loader_uses_current_file_bytes_not_zoneinfo_cache(tmp_path, monkeypatch):
    from importlib.resources import files
    import app.api.staff_schedules as schedule_api

    zone_path = tmp_path / "Test" / "City"
    zone_path.parent.mkdir()
    ny = files("tzdata.zoneinfo").joinpath("America", "New_York").read_bytes()
    chicago = files("tzdata.zoneinfo").joinpath("America", "Chicago").read_bytes()
    zone_path.write_bytes(ny)
    monkeypatch.setattr(schedule_api, "TZPATH", (str(tmp_path),))
    before, digest_before = schedule_api._load_zone("Test/City")
    zone_path.write_bytes(chicago)
    after, digest_after = schedule_api._load_zone("Test/City")
    assert before.utcoffset(datetime(2026, 1, 1)) != after.utcoffset(datetime(2026, 1, 1))
    assert digest_before != digest_after



def test_edit_series_refreshes_state_after_profile_lock(tmp_path, monkeypatch):
    import app.api.staff_schedules as schedule_api

    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        monday = _next_weekday(0, days_ahead=7)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": monday.isoformat(), "weekdays": [0], "start_time": "09:00", "end_time": "10:00"})
            assert created.status_code == 201, created.text
            original_lock = schedule_api._lock_profile
            mutated = False

            def update_before_lock(session, profile_id):
                nonlocal mutated
                if not mutated:
                    session.execute(update(StaffScheduleSeries).where(
                        StaffScheduleSeries.id == UUID(created.json()["id"])
                    ).values(start_time=datetime.strptime("08:00", "%H:%M").time()), execution_options={"synchronize_session": False})
                    mutated = True
                return original_lock(session, profile_id)

            monkeypatch.setattr(schedule_api, "_lock_profile", update_before_lock)
            edited = client.patch(f"/api/v1/staff-schedules/{created.json()['id']}/edit", headers=headers, json={
                "effective_date": monday.isoformat(), "scope": "series"})
            assert edited.status_code == 201, edited.text
            assert edited.json()["start_time"] == "08:00:00"
    finally:
        engine.dispose()



def test_timezone_rule_file_replacement_revalidates_existing_schedule_in_process(tmp_path, monkeypatch):
    from importlib.resources import files
    import app.api.staff_schedules as schedule_api

    url, engine, factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    rule_root = tmp_path / "tzrules"
    zone_path = rule_root / "America" / "New_York"
    zone_path.parent.mkdir(parents=True)
    zone_path.write_bytes(files("tzdata.zoneinfo").joinpath("America", "New_York").read_bytes())
    monkeypatch.setattr(schedule_api, "TZPATH", (str(rule_root),))
    try:
        with factory.begin() as session:
            session.get(Branch, branch).timezone = "America/New_York"
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-11-01", "weekdays": [6], "start_time": "09:00", "end_time": "10:00",
                "end_date": "2026-11-01"})
            assert created.status_code == 201, created.text
            url_path = f"/api/v1/staff-schedules/{created.json()['id']}/occurrences"
            params = {"from_date": "2026-11-01", "to_date": "2026-11-01"}
            first = client.get(url_path, headers=headers, params=params)
            assert first.status_code == 200, first.text
            assert first.json()[0]["starts_at"] == "2026-11-01T14:00:00+00:00"
            zone_path.write_bytes(files("tzdata.zoneinfo").joinpath("America", "Chicago").read_bytes())
            after = client.get(url_path, headers=headers, params=params)
            assert after.status_code == 200, after.text
            assert after.json()[0]["starts_at"] == "2026-11-01T15:00:00+00:00"
    finally:
        engine.dispose()


def test_date_and_occurrence_boundaries_fail_with_validation_not_overflow(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            far = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "9700-01-01", "weekdays": [0], "start_time": "09:00", "end_time": "10:00"})
            assert far.status_code == 422, far.text
            overnight = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "9999-12-31", "weekdays": [4], "start_time": "22:00", "end_time": "02:00",
                "end_date": "9999-12-31"})
            assert overnight.status_code == 422, overnight.text
            empty_max = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "9999-12-31", "weekdays": [0], "start_time": "09:00", "end_time": "10:00",
                "end_date": "9999-12-31"})
            assert empty_max.status_code == 422, empty_max.text
            too_wide = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-26", "weekdays": [0], "start_time": "09:00", "end_time": "10:00",
                "end_date": "2426-10-26"})
            assert too_wide.status_code == 422, too_wide.text
            count_too_wide = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-26", "weekdays": [0], "start_time": "09:00", "end_time": "10:00",
                "occurrence_count": 20872})
            assert count_too_wide.status_code == 422, count_too_wide.text
            minimum = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "0001-01-01", "weekdays": [0], "start_time": "09:00", "end_time": "10:00",
                "end_date": "0001-01-01"})
            assert minimum.status_code == 201, minimum.text
            minimum_peer = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "0001-01-01", "weekdays": [0], "start_time": "11:00", "end_time": "12:00",
                "end_date": "0001-01-01"})
            assert minimum_peer.status_code == 201, minimum_peer.text
            maximum = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "9999-12-31", "weekdays": [4], "start_time": "09:00", "end_time": "10:00",
                "end_date": "9999-12-31"})
            assert maximum.status_code == 201, maximum.text
            max_rows = client.get(f"/api/v1/staff-schedules/{maximum.json()['id']}/occurrences", headers=headers,
                                  params={"from_date": "9999-12-31", "to_date": "9999-12-31"})
            assert max_rows.status_code == 200, max_rows.text
            assert len(max_rows.json()) == 1
    finally:
        engine.dispose()



def test_timezone_rule_change_rejects_newly_nonexistent_existing_occurrence(tmp_path, monkeypatch):
    from importlib.resources import files
    import app.api.staff_schedules as schedule_api

    url, engine, factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    rule_root = tmp_path / "tzrules"
    zone_path = rule_root / "America" / "New_York"
    zone_path.parent.mkdir(parents=True)
    zone_path.write_bytes(files("tzdata.zoneinfo").joinpath("Etc", "UTC").read_bytes())
    monkeypatch.setattr(schedule_api, "TZPATH", (str(rule_root),))
    try:
        with factory.begin() as session:
            session.get(Branch, branch).timezone = "America/New_York"
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2027-03-14", "weekdays": [6], "start_time": "02:30", "end_time": "03:30",
                "end_date": "2027-03-14"})
            assert created.status_code == 201, created.text
            zone_path.write_bytes(files("tzdata.zoneinfo").joinpath("America", "New_York").read_bytes())
            invalidated = client.get(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences", headers=headers,
                                     params={"from_date": "2027-03-14", "to_date": "2027-03-14"})
            assert invalidated.status_code == 409, invalidated.text
    finally:
        engine.dispose()


def test_indefinite_overlap_checks_far_future_exception_dates(tmp_path):
    import app.api.staff_schedules as schedule_api

    _url, engine, factory, branch, _other, profile, _other_profile, _token, _desk = _setup(tmp_path)
    try:
        with factory.begin() as session:
            actor = session.scalar(select(StaffUser).where(StaffUser.login_identifier == "schedule-admin@example.invalid"))
            zone, digest = schedule_api._zone_for_branch(session.get(Branch, branch))
            first = StaffScheduleSeries(profile_id=profile, branch_id=branch, start_date=date(2026, 10, 26),
                weekdays=[0], start_time=datetime.strptime("09:00", "%H:%M").time(),
                end_time=datetime.strptime("10:00", "%H:%M").time(), created_by=actor.id, timezone_rules_digest=digest)
            peer = StaffScheduleSeries(profile_id=profile, branch_id=branch, start_date=date(2026, 10, 26),
                weekdays=[0], start_time=datetime.strptime("11:00", "%H:%M").time(),
                end_time=datetime.strptime("12:00", "%H:%M").time(), created_by=actor.id, timezone_rules_digest=digest)
            session.add_all([first, peer])
            session.flush()
            far_day = date(3000, 1, 1) + timedelta(days=(0 - date(3000, 1, 1).weekday()) % 7)
            session.add(StaffScheduleException(series_id=first.id, local_date=far_day, action="override",
                original_start_time=first.start_time, original_end_time=first.end_time,
                override_start_time=datetime.strptime("11:30", "%H:%M").time(),
                override_end_time=datetime.strptime("12:30", "%H:%M").time(), recorded_by=actor.id))
            session.flush()
            assert schedule_api._overlaps(session, first, peer) is True
    finally:
        engine.dispose()


def test_edit_rejects_transferred_exception_that_collides_with_new_adjacent_occurrence(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        monday = _next_weekday(0, days_ahead=14)
        tuesday = monday + timedelta(days=1)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": monday.isoformat(), "weekdays": [0, 1, 2, 3, 4, 5, 6],
                "start_time": "10:00", "end_time": "11:00"})
            assert created.status_code == 201, created.text
            override = client.put(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences/{tuesday.isoformat()}",
                                  headers=headers, json={"action": "override", "start_time": "22:00", "end_time": "02:00"})
            assert override.status_code == 200, override.text
            edited = client.patch(f"/api/v1/staff-schedules/{created.json()['id']}/edit", headers=headers, json={
                "effective_date": tuesday.isoformat(), "scope": "this_and_future", "start_time": "01:00", "end_time": "03:00"})
            assert edited.status_code == 409, edited.text
    finally:
        engine.dispose()


def test_in_place_edit_rejects_exception_colliding_with_new_adjacent_occurrence(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        monday = _next_weekday(0, days_ahead=14)
        tuesday = monday + timedelta(days=1)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": monday.isoformat(), "weekdays": [0, 1, 2, 3, 4, 5, 6],
                "start_time": "10:00", "end_time": "11:00"})
            assert created.status_code == 201, created.text
            override = client.put(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences/{monday.isoformat()}",
                                  headers=headers, json={"action": "override", "start_time": "22:00", "end_time": "02:00"})
            assert override.status_code == 200, override.text
            edited = client.patch(f"/api/v1/staff-schedules/{created.json()['id']}/edit", headers=headers, json={
                "effective_date": monday.isoformat(), "scope": "series", "start_time": "01:00", "end_time": "03:00"})
            assert edited.status_code == 409, edited.text
    finally:
        engine.dispose()


def test_edit_rejects_weekday_change_that_would_orphan_retained_exception(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        monday = _next_weekday(0, days_ahead=14)
        wednesday = monday + timedelta(days=2)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": monday.isoformat(), "weekdays": [0, 2], "start_time": "10:00", "end_time": "11:00"})
            assert created.status_code == 201, created.text
            skipped = client.put(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences/{wednesday.isoformat()}",
                                 headers=headers, json={"action": "skip"})
            assert skipped.status_code == 200, skipped.text
            edited = client.patch(f"/api/v1/staff-schedules/{created.json()['id']}/edit", headers=headers, json={
                "effective_date": monday.isoformat(), "scope": "this_and_future", "weekdays": [0]})
            assert edited.status_code == 409, edited.text
    finally:
        engine.dispose()


def test_in_place_edit_rejects_weekday_change_that_would_orphan_exception(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        monday = _next_weekday(0, days_ahead=14)
        wednesday = monday + timedelta(days=2)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": monday.isoformat(), "weekdays": [0, 2], "start_time": "10:00", "end_time": "11:00"})
            assert created.status_code == 201, created.text
            skipped = client.put(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences/{wednesday.isoformat()}",
                                 headers=headers, json={"action": "skip"})
            assert skipped.status_code == 200, skipped.text
            edited = client.patch(f"/api/v1/staff-schedules/{created.json()['id']}/edit", headers=headers, json={
                "effective_date": monday.isoformat(), "scope": "series", "weekdays": [0]})
            assert edited.status_code == 409, edited.text
    finally:
        engine.dispose()


def test_single_count_occurrence_on_maximum_date_is_not_bounded_as_indefinite(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}",
                headers={"Authorization": f"Bearer {token}"}, json={"start_date": "9999-12-31", "weekdays": [4],
                    "start_time": "00:00", "end_time": "01:00", "occurrence_count": 1})
            assert created.status_code == 201, created.text
    finally:
        engine.dispose()


def test_indefinite_schedule_is_compared_with_finite_peer_after_400_year_sample(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        far_monday = date(2450, 1, 1) + timedelta(days=(0 - date(2450, 1, 1).weekday()) % 7)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            indefinite = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-26", "weekdays": [0], "start_time": "09:00", "end_time": "10:00"})
            assert indefinite.status_code == 201, indefinite.text
            finite = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": far_monday.isoformat(), "weekdays": [0], "start_time": "09:30", "end_time": "10:30",
                "end_date": far_monday.isoformat()})
            assert finite.status_code == 409, finite.text
    finally:
        engine.dispose()


def test_finite_sunday_overnight_overlaps_finite_monday_start_at_boundary(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        sunday = _next_weekday(6, days_ahead=14)
        monday = sunday + timedelta(days=1)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            sunday_series = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": sunday.isoformat(), "weekdays": [6], "start_time": "22:00", "end_time": "02:00",
                "end_date": sunday.isoformat()})
            assert sunday_series.status_code == 201, sunday_series.text
            monday_series = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": monday.isoformat(), "weekdays": [0], "start_time": "01:00", "end_time": "03:00",
                "end_date": monday.isoformat()})
            assert monday_series.status_code == 409, monday_series.text
    finally:
        engine.dispose()


def test_future_split_checks_overnight_collision_across_segment_boundary(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        monday = _next_weekday(0, days_ahead=14)
        sunday = monday - timedelta(days=1)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            series = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": sunday.isoformat(), "weekdays": [0, 1, 2, 3, 4, 5, 6],
                "start_time": "22:00", "end_time": "02:00"})
            assert series.status_code == 201, series.text
            edited = client.patch(f"/api/v1/staff-schedules/{series.json()['id']}/edit", headers=headers, json={
                "effective_date": monday.isoformat(), "scope": "this_and_future", "weekdays": [0],
                "start_time": "01:00", "end_time": "03:00"})
            assert edited.status_code == 409, edited.text
    finally:
        engine.dispose()


def test_timezone_revalidation_checks_far_future_override_wall_time(tmp_path, monkeypatch):
    from importlib.resources import files
    import app.api.staff_schedules as schedule_api

    url, engine, factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    rules = tmp_path / "tzrules-future-exception"
    zone_file = rules / "America" / "New_York"
    zone_file.parent.mkdir(parents=True)
    utc_bytes = files("tzdata.zoneinfo").joinpath("Etc", "UTC").read_bytes()
    ny_bytes = files("tzdata.zoneinfo").joinpath("America", "New_York").read_bytes()
    zone_file.write_bytes(utc_bytes)
    monkeypatch.setattr(schedule_api, "TZPATH", (str(rules),))
    try:
        with factory.begin() as session:
            session.get(Branch, branch).timezone = "America/New_York"
        far_day = date(3000, 3, 8)
        far_day += timedelta(days=(6 - far_day.weekday()) % 7)
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            created = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-25", "weekdays": [6], "start_time": "01:30", "end_time": "01:45"})
            assert created.status_code == 201, created.text
            exception = client.put(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences/{far_day.isoformat()}",
                headers=headers, json={"action": "override", "start_time": "02:30", "end_time": "03:30"})
            assert exception.status_code == 200, exception.text
            with factory() as session:
                initial_digest = session.scalar(select(StaffScheduleSeries.timezone_rules_digest).where(
                    StaffScheduleSeries.id == UUID(created.json()["id"])))
            zone_file.write_bytes(ny_bytes)
            revalidated = client.get(f"/api/v1/staff-schedules/{created.json()['id']}/occurrences", headers=headers,
                params={"from_date": far_day.isoformat(), "to_date": far_day.isoformat()})
            assert revalidated.status_code == 409, revalidated.text
            with factory() as session:
                after_digest = session.scalar(select(StaffScheduleSeries.timezone_rules_digest).where(
                    StaffScheduleSeries.id == UUID(created.json()["id"])))
            assert after_digest == initial_digest
    finally:
        engine.dispose()


def test_far_overnight_exception_overlaps_peer_starting_next_local_day(tmp_path):
    url, engine, _factory, branch, _other, profile, _other_profile, token, _desk = _setup(tmp_path)
    try:
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            sunday = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-10-25", "weekdays": [6], "start_time": "09:00", "end_time": "10:00"})
            assert sunday.status_code == 201, sunday.text
            exception = client.put(f"/api/v1/staff-schedules/{sunday.json()['id']}/occurrences/2026-11-01", headers=headers,
                                   json={"action": "override", "start_time": "22:00", "end_time": "02:00"})
            assert exception.status_code == 200, exception.text
            monday = client.post(f"/api/v1/staff-schedules/branches/{branch}/profiles/{profile}", headers=headers, json={
                "start_date": "2026-11-02", "weekdays": [0], "start_time": "01:00", "end_time": "03:00"})
            assert monday.status_code == 409, monday.text
    finally:
        engine.dispose()
