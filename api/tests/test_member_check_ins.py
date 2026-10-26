from datetime import date, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
import app.api.member_check_ins as check_in_api

from app.db.models import Member, MembershipPeriod, MemberCheckIn, Plan, PlanVersion
from app.main import create_app
from app.shifts.queries import create_cash_register
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def _seed_membership(factory, branch_id, receptionist_id, code):
    with factory.begin() as session:
        member = Member(member_number=f"SOC-{code}", full_name=f"Member {code}", phone="5550100")
        plan = Plan(code=f"plan-{code}", name=f"Plan {code}", kind="membership", status="active")
        session.add_all([member, plan])
        session.flush()
        version = PlanVersion(plan_id=plan.id, version_number=1, name=f"Plan {code} v1", price_minor=10000,
                              currency="MXN", duration_value=1, duration_unit="month", is_active=True)
        session.add(version)
        session.flush()
        register = create_cash_register(session, branch_id, f"register-{code}", f"Register {code}")
        open_shift(session, register_id=register.id, opened_by=receptionist_id,
                   denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
        return member.id, version.id, register.id


def test_member_checkin_is_branch_scoped_and_exact_request_replay_is_idempotent(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "member-checkin", "Member Checkin")
        other_branch_id = _seed_branch(factory, "member-checkin-other", "Other Branch")
        receptionist_id, receptionist_token = _seed_receptionist(factory, branch_id)
        admin_id = seed_admin(factory)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, receptionist_id, "CHECKIN")
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            admin_headers = approved_admin_headers(client, delivery)
            sale = client.post(f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "checkin-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)})
            assert sale.status_code == 201, sale.text
            period_id = UUID(sale.json()["membership"]["id"])
            path = f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}"
            headers = {"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "checkin-once"}
            recorded = client.post(path, headers=headers)
            assert recorded.status_code == 201, recorded.text
            replay = client.post(path, headers=headers)
            assert replay.status_code == 200, replay.text
            assert replay.json()["id"] == recorded.json()["id"]
            assert replay.json()["replayed"] is True

            conflicting_key_use = client.post(
                f"/api/v1/member-check-ins/branches/{branch_id}/periods/{uuid4()}", headers=headers)
            assert conflicting_key_use.status_code == 409
            wrong_branch = client.post(
                f"/api/v1/member-check-ins/branches/{other_branch_id}/periods/{period_id}",
                headers={**admin_headers, "Idempotency-Key": "wrong-branch"})
            assert wrong_branch.status_code == 409
            unauthenticated = client.post(path, headers={"Idempotency-Key": "anonymous"})
            assert unauthenticated.status_code == 401

            admin_checkin = client.post(path, headers={
                **admin_headers, "Idempotency-Key": "admin-checkin",
            })
            assert admin_checkin.status_code == 201, admin_checkin.text
            with factory() as session:
                events = session.scalars(select(MemberCheckIn).where(MemberCheckIn.period_id == period_id)).all()
                assert len(events) == 2
                assert all(event.branch_id == branch_id for event in events)
                assert {event.recorded_by for event in events} == {receptionist_id, admin_id}
    finally:
        engine.dispose()


def test_member_checkin_denies_expired_membership_and_records_no_event(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "member-checkin-expired", "Expired Checkin")
        receptionist_id, receptionist_token = _seed_receptionist(factory, branch_id)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, receptionist_id, "EXPIRED")
        with TestClient(create_app(configured_settings(url))) as client:
            sale = client.post(f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "expired-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)})
            assert sale.status_code == 201, sale.text
            period_id = UUID(sale.json()["membership"]["id"])
            with factory.begin() as session:
                period = session.get(MembershipPeriod, period_id)
                period.starts_on = date.today() - timedelta(days=30)
                period.ends_on = date.today()
            response = client.post(f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}",
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "expired-checkin"})
            assert response.status_code == 409
            assert response.json()["error"]["code"] == "membership_access_denied"
            assert response.json()["error"]["metadata"] == {"status": "expired", "reason": "period_expired"}
            assert response.json()["error"]["request_id"] == response.headers["x-request-id"]
            with factory() as session:
                assert session.scalar(select(MemberCheckIn.id).where(MemberCheckIn.period_id == period_id)) is None
                from app.db.models.member_check_ins import MemberCheckInVisit
                assert session.scalar(select(MemberCheckInVisit.id).where(MemberCheckInVisit.member_id == member_id)) is None
    finally:
        engine.dispose()


def test_distinct_checkins_link_to_fixed_five_minute_visit_root(tmp_path, monkeypatch):
    from datetime import datetime, timezone

    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "member-checkin-window", "Window Checkin")
        receptionist_id, token = _seed_receptionist(factory, branch_id)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, receptionist_id, "WINDOW")
        base = datetime.now(timezone.utc)
        instants = iter([base, base + timedelta(minutes=4), base + timedelta(minutes=5), base + timedelta(minutes=9)])
        monkeypatch.setattr(check_in_api, "utc_now", lambda: next(instants))
        with TestClient(create_app(configured_settings(url))) as client:
            sale = client.post(f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "window-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)})
            period_id = UUID(sale.json()["membership"]["id"])
            path = f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}"

            def post(key):
                return client.post(path, headers={"Authorization": f"Bearer {token}", "Idempotency-Key": key})

            root = post("window-root")
            duplicate = post("window-duplicate")
            exact_edge = post("window-edge")
            next_visit = post("window-next")
            assert root.status_code == duplicate.status_code == exact_edge.status_code == next_visit.status_code == 201
            assert root.json()["visit_id"] == duplicate.json()["visit_id"]
            assert exact_edge.json()["visit_id"] != root.json()["visit_id"]
            assert next_visit.json()["visit_id"] == exact_edge.json()["visit_id"]
            replay = post("window-duplicate")
            assert replay.status_code == 200 and replay.json()["id"] == duplicate.json()["id"]
            assert replay.json()["visit_id"] == root.json()["visit_id"]
            with factory() as session:
                events = session.scalars(select(MemberCheckIn).where(MemberCheckIn.member_id == member_id)).all()
                assert len(events) == 4
    finally:
        engine.dispose()
