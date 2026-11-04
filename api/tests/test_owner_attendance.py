from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.db.models import Member, MemberCheckIn, Plan, PlanVersion
from app.db.models.member_check_ins import MemberCheckInVisit
from app.finance.attendance import build_bins
from app.main import create_app
from admin_session_helpers import approved_admin_headers
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db
from test_shifts import open_shift
from app.shifts.queries import create_cash_register
from app.sales.queries import post_membership_cash_sale


def test_build_bins_uses_branch_timezone_and_unions_sources():
    zone = ZoneInfo("America/Mexico_City")  # UTC-6 in October 2026
    # 2026-10-05 is a Monday. 01:30 UTC Tuesday == 19:30 Monday local.
    rows = [datetime(2026, 10, 6, 1, 30, tzinfo=timezone.utc), datetime(2026, 10, 6, 1, 45, tzinfo=timezone.utc),
            datetime(2026, 10, 5, 15, 0)]  # naive treated as UTC -> 09:00 Monday local
    hours, days = build_bins(rows, zone)
    assert hours == {19: 2, 9: 1}
    assert days == {0: 3}


def test_owner_attendance_auth_validation_and_bins(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, reception_token = _seed_receptionist(factory, branch)
        seed_admin(factory)
        now = datetime.now(timezone.utc)
        with factory.begin() as session:
            member = Member(member_number="MEM-ATT", full_name="Att Member", phone="5550199")
            plan = Plan(code="att-plan", name="Att Plan", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Att Plan", price_minor=12000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            register = create_cash_register(session, branch, "att-reg", "Att")
            session.flush()
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            sale = post_membership_cash_sale(session, register_id=register.id, actor_id=actor, authorized_branch_id=branch,
                member_id=member.id, plan_version_id=version.id, idempotency_key="att-sale", cash_amount_minor=12000,
                cash_amount_provided=True)
            for index, when in enumerate([datetime(2026, 10, 5, 15, 0, tzinfo=timezone.utc),   # Mon 09:00 local
                                          datetime(2026, 10, 5, 15, 30, tzinfo=timezone.utc),  # Mon 09:30 local
                                          datetime(2026, 10, 6, 1, 30, tzinfo=timezone.utc),   # Mon 19:30 local
                                          now]):
                visit = MemberCheckInVisit(member_id=member.id, started_at=when)
                session.add(visit)
                session.flush()
                session.add(MemberCheckIn(visit_id=visit.id, member_id=member.id, period_id=sale.membership.id,
                    branch_id=branch, recorded_by=actor, idempotency_key=f"att-{index}", request_fingerprint="d" * 64,
                    access_reason="valid", access_warnings=[], occurred_at=when))
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            assert client.get("/api/v1/owner/attendance").status_code == 403
            headers = approved_admin_headers(client, delivery)
            base = f"/api/v1/owner/attendance?branch_id={branch}"
            assert client.get(base, headers={"Authorization": f"Bearer {reception_token}"}).status_code == 403
            assert client.get(f"{base}&from=2026-10-02&to=2026-10-01", headers=headers).status_code == 422
            response = client.get(f"{base}&from=2026-10-05&to=2026-10-05", headers=headers)
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["total_check_ins"] == 3
            assert len(body["hourly_bins"]) == 24 and len(body["day_of_week_bins"]) == 7
            by_hour = {b["hour"]: b["raw_visits"] for b in body["hourly_bins"]}
            assert by_hour[9] == 2 and by_hour[19] == 1
            assert body["peak_hour"] == {"hour": 9, "label": "09:00", "visits": 2}
            assert body["valley_hour"] == {"hour": 19, "label": "19:00", "visits": 1}
            assert body["busiest_day"]["day_index"] == 0 and body["busiest_day"]["visits"] == 3
            assert body["day_of_week_bins"][0]["percent"] == 100.0
            assert body["gym_capacity"] == 50
            empty = client.get(f"{base}&from=2020-01-01&to=2020-01-01", headers=headers).json()
            assert empty["total_check_ins"] == 0 and empty["peak_hour"] is None and empty["busiest_day"] is None
            live = client.get(base, headers=headers).json()
            assert live["live_occupancy_count"] == 1 and live["live_occupancy_percent"] == 2
    finally:
        engine.dispose()
