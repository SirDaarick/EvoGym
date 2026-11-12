from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
import app.memberships.service as check_in_api

from app.db.models import Branch, Member, MembershipPeriod, MemberCheckIn, Plan, PlanVersion
from app.main import create_app
from app.shifts.queries import create_cash_register
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def _local_today(factory, branch_id):
    with factory() as session:
        return datetime.now(ZoneInfo(session.get(Branch, branch_id).timezone)).date()


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
                period.starts_on = _local_today(factory, branch_id) - timedelta(days=30)
                period.ends_on = _local_today(factory, branch_id)  # end-exclusive: the last day is already expired
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


def test_member_checkin_denies_future_period_and_records_no_event(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "member-checkin-future", "Future Checkin")
        receptionist_id, token = _seed_receptionist(factory, branch_id)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, receptionist_id, "FUTURE")
        with TestClient(create_app(configured_settings(url))) as client:
            sale = client.post(f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "future-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)})
            period_id = UUID(sale.json()["membership"]["id"])
            with factory.begin() as session:
                period = session.get(MembershipPeriod, period_id)
                period.starts_on = _local_today(factory, branch_id) + timedelta(days=2)
                period.ends_on = period.starts_on + timedelta(days=30)
            response = client.post(f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "future-checkin"})
            assert response.status_code == 409
            assert response.json()["error"]["metadata"] == {"status": "not_yet_valid", "reason": "period_not_started"}
            with factory() as session:
                assert session.scalar(select(MemberCheckIn.id).where(MemberCheckIn.period_id == period_id)) is None
    finally:
        engine.dispose()


def test_member_checkin_with_outstanding_debt_requires_confirmation(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "member-checkin-debt", "Debt Checkin")
        receptionist_id, token = _seed_receptionist(factory, branch_id)
        seed_admin(factory)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, receptionist_id, "DEBT")
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            sale = client.post(f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "debt-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id), "cash_amount_minor": 4000})
            assert sale.status_code == 201, sale.text
            period_id = sale.json()["membership"]["id"]
            path = f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}"
            headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "debt-checkin"}
            denied = client.post(path, headers=headers)
            assert denied.status_code == 409
            with factory() as session:
                assert session.scalar(select(MemberCheckIn.id).where(MemberCheckIn.member_id == member_id)) is None
            response = client.post(path, headers=headers, json={"confirm_outstanding_balance": True})
            assert response.status_code == 201, response.text
            assert response.json()["access_reason"] == "valid_with_outstanding_balance"
            assert "outstanding_balance" in response.json()["access_warnings"]
            replay = client.post(path, headers=headers, json={"confirm_outstanding_balance": True})
            assert replay.status_code == 200
            assert replay.json()["id"] == response.json()["id"]
            assert client.post(path, headers=headers).status_code == 409
            alert_path = f"/api/v1/member-check-ins/branches/{branch_id}/debt-alerts"
            assert client.get(alert_path, headers={"Authorization": f"Bearer {token}"}).status_code == 403
            alerts = client.get(alert_path, headers=approved_admin_headers(client, delivery))
            assert alerts.status_code == 200
            assert [item["id"] for item in alerts.json()] == [response.json()["id"]]
            with factory() as session:
                event = session.scalar(select(MemberCheckIn).where(MemberCheckIn.member_id == member_id))
                assert event is not None and "outstanding_balance" in event.access_warnings
    finally:
        engine.dispose()


def test_checkin_requires_confirmation_for_debt_from_another_membership(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "other-debt", "Other debt")
        staff_id, token = _seed_receptionist(factory, branch_id)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, staff_id, "OTHERDEBT")
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            path = f"/api/v1/registers/{register_id}/membership-sales"
            body = {"member_id": str(member_id), "plan_version_id": str(version_id)}
            first = client.post(path, headers={**headers, "Idempotency-Key": "first"}, json={**body, "cash_amount_minor": 4000})
            assert first.status_code == 201
            second = client.post(path, headers={**headers, "Idempotency-Key": "second"}, json=body)
            assert second.status_code == 201
            period = second.json()["membership"]["id"]
            with factory.begin() as session:
                current = session.get(MembershipPeriod, UUID(period))
                current.starts_on = _local_today(factory, branch_id) - timedelta(days=1)
                current.ends_on = _local_today(factory, branch_id) + timedelta(days=29)
            checkin = client.post(f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period}", headers={**headers, "Idempotency-Key": "other-debt-checkin"})
            assert checkin.status_code == 409
            assert checkin.json()["error"]["code"] == "debt_confirmation_required"
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


def test_member_checkin_immediately_reflects_in_member_reload(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "member-checkin-reload", "Reload Checkin")
        receptionist_id, token = _seed_receptionist(factory, branch_id)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, receptionist_id, "RELOAD")
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            initial_reload = client.get(f"/api/v1/members/{member_id}/reload", headers=headers)
            assert initial_reload.status_code == 200
            assert initial_reload.json()["recent_visits"] == []

            sale = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={**headers, "Idempotency-Key": "reload-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert sale.status_code == 201
            period_id = UUID(sale.json()["membership"]["id"])

            checkin = client.post(
                f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}",
                headers={**headers, "Idempotency-Key": "reload-checkin"},
            )
            assert checkin.status_code == 201
            checkin_data = checkin.json()

            reload_after = client.get(f"/api/v1/members/{member_id}/reload", headers=headers)
            assert reload_after.status_code == 200
            visits = reload_after.json()["recent_visits"]
            assert len(visits) == 1
            assert visits[0]["id"] == checkin_data["id"]
            assert visits[0]["visit_id"] == checkin_data["visit_id"]
            assert visits[0]["period_id"] == str(period_id)
            assert visits[0]["branch_id"] == str(branch_id)
    finally:
        engine.dispose()


def test_checkin_without_debt_even_with_confirmation_does_not_alert_admin(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "no-debt-checkin", "No Debt Checkin")
        receptionist_id, token = _seed_receptionist(factory, branch_id)
        seed_admin(factory)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, receptionist_id, "NODEBT")
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            sale = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "nodebt-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert sale.status_code == 201, sale.text
            period_id = sale.json()["membership"]["id"]
            path = f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}"
            headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "nodebt-checkin"}
            response = client.post(path, headers=headers, json={"confirm_outstanding_balance": True})
            assert response.status_code == 201
            assert response.json()["access_reason"] == "valid"
            assert "outstanding_balance" not in response.json()["access_warnings"]
            alert_path = f"/api/v1/member-check-ins/branches/{branch_id}/debt-alerts"
            alerts = client.get(alert_path, headers=approved_admin_headers(client, delivery))
            assert alerts.status_code == 200
            assert alerts.json() == []
    finally:
        engine.dispose()


def test_debt_alerts_include_reconciled_offline_confirmed_checkins_only(tmp_path):
    from hashlib import sha256
    from datetime import timezone
    from app.sync.reconcile import reconcile_event
    from app.db.models import ContingencyEvent, SyncDevice
    from app.settings import Settings

    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "offline-alerts-branch", "Offline Alerts Branch")
        receptionist_id, token = _seed_receptionist(factory, branch_id)
        seed_admin(factory)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, receptionist_id, "OFFALERT")
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            sale = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "off-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id), "cash_amount_minor": 3000},
            )
            assert sale.status_code == 201
            period_id = UUID(sale.json()["membership"]["id"])

            device = SyncDevice(
                branch_id=branch_id,
                device_prefix="OFF-ALERT",
                token_digest=sha256(b"token").hexdigest(),
                provisioned_by=receptionist_id,
                issued_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            )
            with factory.begin() as session:
                session.add(device)
                session.flush()
                device_id = device.id
                ev_unconfirmed = ContingencyEvent(
                    device_id=device_id,
                    event_id="OFF-ALERT-00001",
                    seq=1,
                    event_type="attendance.check_in",
                    schema_version=1,
                    actor_staff_id=receptionist_id,
                    payload={
                        "member_id": str(member_id),
                        "period_id": str(period_id),
                        "branch_id": str(branch_id),
                        "local_access_decision": "valid",
                        "confirm_outstanding_balance": False,
                    },
                    payload_hash="0" * 64,
                    client_recorded_at=datetime.now(timezone.utc),
                    status="accepted",
                )
                session.add(ev_unconfirmed)
                session.flush()
                reconcile_event(session, device, ev_unconfirmed, Settings(environment="test", debug=True, _env_file=None))

            admin_headers = approved_admin_headers(client, delivery)
            alert_path = f"/api/v1/member-check-ins/branches/{branch_id}/debt-alerts"
            alerts = client.get(alert_path, headers=admin_headers)
            assert alerts.status_code == 200
            assert alerts.json() == []

            with factory.begin() as session:
                d = session.get(SyncDevice, device_id)
                ev_confirmed = ContingencyEvent(
                    device_id=device_id,
                    event_id="OFF-ALERT-00002",
                    seq=2,
                    event_type="attendance.check_in",
                    schema_version=1,
                    actor_staff_id=receptionist_id,
                    payload={
                        "member_id": str(member_id),
                        "period_id": str(period_id),
                        "branch_id": str(branch_id),
                        "local_access_decision": "valid_with_outstanding_balance",
                        "confirm_outstanding_balance": True,
                    },
                    payload_hash="0" * 64,
                    client_recorded_at=datetime.now(timezone.utc) + timedelta(minutes=10),
                    status="accepted",
                )
                session.add(ev_confirmed)
                session.flush()
                reconcile_event(session, d, ev_confirmed, Settings(environment="test", debug=True, _env_file=None))
                confirmed_check_in_id = str(ev_confirmed.result_check_in_id)

            alerts2 = client.get(alert_path, headers=admin_headers)
            assert alerts2.status_code == 200
            assert len(alerts2.json()) == 1
            assert alerts2.json()[0]["id"] == confirmed_check_in_id
    finally:
        engine.dispose()

