from datetime import date
from uuid import UUID

import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.membership_access import AccessDecisionRequest
from app.db.models import Member, MemberAccessDecision, MembershipPeriod, PaymentReviewEvent, Plan, PlanVersion
from app.memberships.eligibility import MembershipAccessStatus, evaluate_membership_access
from app.main import create_app
from app.shifts.queries import create_cash_register
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_admin_access_decision_requires_payment_reason_and_known_action():
    assert AccessDecisionRequest(action="restore", reason="Payment receipt verified").action == "restore"
    with pytest.raises(ValidationError):
        AccessDecisionRequest(action="override_expiry", reason="Not allowed")
    with pytest.raises(ValidationError):
        AccessDecisionRequest(action="restrict", reason="")


def test_restore_binds_to_the_current_transfer_review_and_new_pending_review_restricts_again(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "access-binding", "Access Binding")
        receptionist_id, receptionist_token = _seed_receptionist(factory, branch_id)
        seed_admin(factory)
        with factory.begin() as session:
            member = Member(member_number="SOC-BINDING", full_name="Binding Member", phone="5550199")
            plan = Plan(code="binding-plan", name="Binding Plan", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Binding v1", price_minor=12000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            session.flush()
            register = create_cash_register(session, branch_id, "binding-register", "Binding Register")
            open_shift(session, register_id=register.id, opened_by=receptionist_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_id, version_id, register_id = member.id, version.id, register.id

        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            admin_headers = approved_admin_headers(client, delivery)
            sale = client.post(f"/api/v1/registers/{register_id}/membership-transfer-sales",
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "binding-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)})
            assert sale.status_code == 201, sale.text
            period_id = UUID(sale.json()["membership"]["id"])
            payment_id = UUID(sale.json()["payment"]["id"])
            starts_on = date.fromisoformat(sale.json()["membership"]["starts_on"])
            access_path = f"/api/v1/membership-access/periods/{period_id}/decisions"
            review_path = f"/api/v1/registers/transfer-payments/{payment_id}/review"
            preemptive = client.post(access_path,
                headers={**admin_headers, "Idempotency-Key": "preemptive"},
                json={"action": "restore", "reason": "No active restriction"})
            assert preemptive.status_code == 409

            pending = client.post(review_path,
                headers={**admin_headers, "Idempotency-Key": "review-pending-1"},
                json={"status": "pending"})
            assert pending.status_code == 200, pending.text
            with factory() as session:
                pending_event = session.scalar(select(PaymentReviewEvent).where(
                    PaymentReviewEvent.payment_id == payment_id,
                    PaymentReviewEvent.to_status == "pending",
                ).order_by(PaymentReviewEvent.created_at.desc(), PaymentReviewEvent.id.desc()).limit(1))
                assert pending_event is not None
                pending_event_id = pending_event.id
            restricted = client.post(access_path,
                headers={**admin_headers, "Idempotency-Key": "restrict-pending-1"},
                json={"action": "restrict", "reason": "Review requires restriction"})
            assert restricted.status_code == 201, restricted.text
            restored = client.post(access_path,
                headers={**admin_headers, "Idempotency-Key": "restore-pending-1"},
                json={"action": "restore", "reason": "Admin verified the evidence"})
            assert restored.status_code == 201, restored.text
            assert restored.json()["lifted_payment_review_id"] == str(pending_event_id)
            with factory() as session:
                decisions = session.scalars(select(MemberAccessDecision)
                    .where(MemberAccessDecision.period_id == period_id)
                    .order_by(MemberAccessDecision.decision_order)).all()
                assert [decision.decision_order for decision in decisions] == [1, 2]
                assert decisions[0].created_at == decisions[1].created_at
                assert restored.json()["id"] == str(decisions[1].id)
                assert evaluate_membership_access(session, period_id, starts_on, branch_id).allowed
            stale_restore = client.post(access_path,
                headers={**admin_headers, "Idempotency-Key": "restore-stale"},
                json={"action": "restore", "reason": "No new restriction exists"})
            assert stale_restore.status_code == 409

            renewed_restriction = client.post(access_path,
                headers={**admin_headers, "Idempotency-Key": "restrict-again"},
                json={"action": "restrict", "reason": "New restriction supersedes restoration"})
            assert renewed_restriction.status_code == 201, renewed_restriction.text
            with factory() as session:
                decision = evaluate_membership_access(session, period_id, starts_on, branch_id)
                assert not decision.allowed and decision.status is MembershipAccessStatus.BLOCKED_MISSING_FUNDS
            restored_again = client.post(access_path,
                headers={**admin_headers, "Idempotency-Key": "restore-again"},
                json={"action": "restore", "reason": "Admin confirmed current restriction"})
            assert restored_again.status_code == 201, restored_again.text

            confirmed = client.post(review_path,
                headers={**admin_headers, "Idempotency-Key": "review-confirm-1"},
                json={"status": "confirmed"})
            assert confirmed.status_code == 200, confirmed.text
            later_pending = client.post(review_path,
                headers={**admin_headers, "Idempotency-Key": "review-pending-2"},
                json={"status": "pending"})
            assert later_pending.status_code == 200, later_pending.text
            with factory() as session:
                decision = evaluate_membership_access(session, period_id, starts_on, branch_id)
                assert not decision.allowed and decision.status is MembershipAccessStatus.BLOCKED_MISSING_FUNDS
    finally:
        engine.dispose()
