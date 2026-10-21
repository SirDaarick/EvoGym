from datetime import date, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import Member, MembershipPeriod, MemberCheckIn, Plan, PlanVersion
from app.main import create_app
from app.shifts.queries import create_cash_register
from test_admin_auth import configured_settings, seed_admin
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
        with TestClient(create_app(configured_settings(url))) as client:
            admin_login = client.post("/api/v1/auth/sessions", json={
                "login_identifier": "owner@example.invalid", "password": "synthetic-admin-password",
            })
            assert admin_login.status_code == 201, admin_login.text
            admin_token = admin_login.json()["access_token"]
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
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "wrong-branch"})
            assert wrong_branch.status_code == 409
            unauthenticated = client.post(path, headers={"Idempotency-Key": "anonymous"})
            assert unauthenticated.status_code == 401

            admin_checkin = client.post(path, headers={
                "Authorization": f"Bearer {admin_token}", "Idempotency-Key": "admin-checkin",
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
            with factory() as session:
                assert session.scalar(select(MemberCheckIn.id).where(MemberCheckIn.period_id == period_id)) is None
    finally:
        engine.dispose()
