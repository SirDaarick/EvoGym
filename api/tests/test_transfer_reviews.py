from datetime import date, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

from app.db.models import (
    Member, MemberAccessDecision, MembershipPeriod, Order, OrderItem, Payment, PaymentReviewEvent, Plan, PlanVersion,
)
from app.memberships.eligibility import MembershipAccessStatus, evaluate_membership_access, is_membership_period_eligible
from app.main import create_app
from test_admin_auth import configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_voucher_transfer_creates_under_review_period_and_admin_review_controls_eligibility(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "review-branch", "Review Branch")
        receptionist_id, receptionist_token = _seed_receptionist(factory, branch_id)
        admin_id = seed_admin(factory)
        with factory.begin() as session:
            member = Member(member_number="SOC-REVIEW", full_name="Review Member", phone="5550123")
            plan = Plan(code="review-plan", name="Review Plan", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(
                plan_id=plan.id, version_number=1, name="Review Plan v1", price_minor=12000,
                currency="MXN", duration_value=1, duration_unit="month", is_active=True,
            )
            session.add(version)
            session.flush()
            from app.shifts.queries import create_cash_register

            register = create_cash_register(session, branch_id, "review-register", "Review Register")
            shift = open_shift(
                session, register_id=register.id, opened_by=receptionist_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            member_id, version_id, register_id, shift_id = member.id, version.id, register.id, shift.id

        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/sessions",
                json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"},
            )
            assert login.status_code == 201, login.text
            admin_token = login.json()["access_token"]
            sale_path = f"/api/v1/registers/{register_id}/membership-transfer-sales"
            receipt = client.post(
                sale_path,
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "voucher-001"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert receipt.status_code == 201, receipt.text
            initial = receipt.json()
            assert initial["payment"]["status"] == "under_review"
            assert initial["membership"] is not None
            payment_id = initial["payment"]["id"]
            membership_id = initial["membership"]["id"]
            starts_on = initial["membership"]["starts_on"]
            ends_on = initial["membership"]["ends_on"]
            first_payment_received_at = initial["payment"]["received_at"]
            first_order = initial["order"]
            first_item = initial["item"]
            receipt_replay = client.post(
                sale_path,
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "voucher-001"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert receipt_replay.status_code == 200
            assert receipt_replay.json()["membership"]["id"] == membership_id

            cash = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "paid-unrelated"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert cash.status_code == 201, cash.text
            cash_period_id = cash.json()["membership"]["id"]

            review_path = f"/api/v1/registers/transfer-payments/{payment_id}/review"
            denied = client.post(
                review_path,
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "review-denied"},
                json={"status": "confirmed"},
            )
            assert denied.status_code == 403

            with factory() as session:
                assert is_membership_period_eligible(session, UUID(membership_id), date.fromisoformat(starts_on))
                decision = evaluate_membership_access(session, UUID(membership_id), date.fromisoformat(starts_on), branch_id)
                assert decision.allowed and decision.reason == "valid"
                assert "transfer_under_review" in decision.warnings
                assert evaluate_membership_access(session, UUID(membership_id), date.fromisoformat(starts_on), UUID(int=0)).status is MembershipAccessStatus.WRONG_BRANCH
                assert evaluate_membership_access(session, UUID(membership_id), date.fromisoformat(ends_on), branch_id).status is MembershipAccessStatus.EXPIRED
                assert is_membership_period_eligible(
                    session, UUID(membership_id), date.fromisoformat(starts_on) + timedelta(days=1)
                )

            confirm = client.post(
                review_path,
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "decision-confirm"},
                json={"status": "confirmed"},
            )
            assert confirm.status_code == 200, confirm.text
            assert confirm.json()["payment"]["status"] == "confirmed"
            receptionist_reused_key = client.post(
                review_path,
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "decision-confirm"},
                json={"status": "confirmed"},
            )
            assert receptionist_reused_key.status_code == 403
            assert confirm.json()["membership"]["id"] == membership_id
            assert confirm.json()["membership"]["starts_on"] == starts_on
            assert confirm.json()["membership"]["ends_on"] == ends_on
            with factory() as session:
                assert is_membership_period_eligible(session, UUID(membership_id), date.fromisoformat(starts_on))

            pending = client.post(
                review_path,
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "decision-pending"},
                json={"status": "pending"},
            )
            assert pending.status_code == 200, pending.text
            assert pending.json()["payment"]["status"] == "pending"
            with factory() as session:
                assert not is_membership_period_eligible(session, UUID(membership_id), date.fromisoformat(starts_on))
                decision = evaluate_membership_access(session, UUID(membership_id), date.fromisoformat(starts_on), branch_id)
                assert not decision.allowed and decision.status is MembershipAccessStatus.BLOCKED_MISSING_FUNDS
                assert is_membership_period_eligible(
                    session, UUID(cash_period_id), date.fromisoformat(cash.json()["membership"]["starts_on"])
                )

            access_path = f"/api/v1/membership-access/periods/{membership_id}/decisions"
            receptionist_denied = client.post(access_path,
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "receptionist-restore"},
                json={"action": "restore", "reason": "Not authorized"})
            assert receptionist_denied.status_code == 403
            restore = client.post(access_path,
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "restore-missing-transfer"},
                json={"action": "restore", "reason": "Admin verified the member payment evidence"})
            assert restore.status_code == 201, restore.text
            replay = client.post(access_path,
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "restore-missing-transfer"},
                json={"action": "restore", "reason": "Admin verified the member payment evidence"})
            assert replay.status_code == 200 and replay.json()["replayed"] is True
            with factory() as session:
                restored = evaluate_membership_access(session, UUID(membership_id), date.fromisoformat(starts_on), branch_id)
                assert restored.allowed and restored.reason == "valid"
                assert evaluate_membership_access(session, UUID(membership_id), date.fromisoformat(ends_on), branch_id).status is MembershipAccessStatus.EXPIRED
                assert evaluate_membership_access(session, UUID(membership_id), date.fromisoformat(starts_on), UUID(int=0)).status is MembershipAccessStatus.WRONG_BRANCH
                audit = session.scalar(select(MemberAccessDecision).where(
                    MemberAccessDecision.period_id == UUID(membership_id),
                ))
                assert audit is not None and audit.action == "restore"
                with pytest.raises(ValueError, match="append-only"):
                    audit.action = "restrict"
                    session.flush()

            reconfirm = client.post(
                review_path,
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "decision-reconfirm"},
                json={"status": "confirmed"},
            )
            assert reconfirm.status_code == 200, reconfirm.text
            assert reconfirm.json()["payment"]["status"] == "confirmed"
            assert reconfirm.json()["membership"]["id"] == membership_id
            assert reconfirm.json()["membership"]["starts_on"] == starts_on
            assert reconfirm.json()["membership"]["ends_on"] == ends_on
            with factory() as session:
                assert is_membership_period_eligible(session, UUID(membership_id), date.fromisoformat(starts_on))
            duplicate = client.post(
                review_path,
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "decision-reconfirm"},
                json={"status": "confirmed"},
            )
            assert duplicate.status_code == 200
            assert duplicate.json() == reconfirm.json()
            mismatch = client.post(
                review_path,
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "decision-reconfirm"},
                json={"status": "pending"},
            )
            assert mismatch.status_code == 409
            final_receipt_replay = client.post(
                sale_path,
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "voucher-001"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert final_receipt_replay.status_code == 200
            assert final_receipt_replay.json()["payment"]["status"] == "confirmed"
            assert final_receipt_replay.json()["order"] == first_order
            assert final_receipt_replay.json()["item"] == first_item
            assert final_receipt_replay.json()["payment"]["received_at"] == first_payment_received_at

            with factory.begin() as session:
                legacy_order = Order(
                    branch_id=UUID(first_order["branch_id"]), register_id=register_id, shift_id=shift_id,
                    member_id=member_id, seller_id=receptionist_id, idempotency_key="legacy-transfer",
                    request_fingerprint="e" * 64, total_minor=12000,
                )
                session.add(legacy_order)
                session.flush()
                legacy_item = OrderItem(
                    order_id=legacy_order.id, plan_version_id=version_id, line_number=1,
                    description_snapshot="Legacy Review Plan", duration_value=1, duration_unit="month",
                    quantity=1, unit_amount_minor=12000, line_total_minor=12000,
                )
                legacy_payment = Payment(
                    order_id=legacy_order.id, method="transfer", status="pending", amount_minor=12000,
                    received_by=receptionist_id,
                )
                session.add_all([legacy_item, legacy_payment])
                session.flush()
                legacy_payment_id = legacy_payment.id
            legacy_review = client.post(
                f"/api/v1/registers/transfer-payments/{legacy_payment_id}/review",
                headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": "legacy-review"},
                json={"status": "confirmed"},
            )
            assert legacy_review.status_code == 409
            legacy_receptionist_review = client.post(
                f"/api/v1/registers/transfer-payments/{legacy_payment_id}/review",
                headers={"Authorization": f"Bearer {receptionist_token}", "Idempotency-Key": "legacy-review"},
                json={"status": "confirmed"},
            )
            assert legacy_receptionist_review.status_code == 403

        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 3
            assert session.scalar(select(func.count()).select_from(Payment)) == 3
            assert session.scalar(select(func.count()).select_from(MembershipPeriod)) == 2
            assert session.scalar(select(func.count()).select_from(PaymentReviewEvent)) == 4
            events = session.scalars(
                select(PaymentReviewEvent).where(PaymentReviewEvent.payment_id == UUID(payment_id))
                .order_by(PaymentReviewEvent.created_at, PaymentReviewEvent.id)
            ).all()
            assert [(event.from_status, event.to_status) for event in events] == [
                (None, "under_review"), ("under_review", "confirmed"),
                ("confirmed", "pending"), ("pending", "confirmed"),
            ]
            assert events[0].actor_id == receptionist_id
            assert all(event.actor_id == admin_id for event in events[1:])
            assert all(event.created_at is not None for event in events)
            reviewed_order = session.scalar(select(Order).where(Order.id == UUID(first_order["id"])))
            assert reviewed_order.financial_shift_id is None
            initial_event = events[0]
            with pytest.raises(ValueError, match="append-only"):
                initial_event.to_status = "pending"
                session.flush()
    finally:
        engine.dispose()
