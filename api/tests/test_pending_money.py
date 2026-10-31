from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db.models import (
    Member, MembershipDebt, MembershipDebtPayment, Payment, PaymentReviewEvent, Plan, PlanVersion,
    RoleGrant, StaffCredential, StaffUser,
)
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_admin_pending_money_lists_pending_transfers_and_outstanding_debt(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "pending-money", "Pending Money")
        other_branch_id = _seed_branch(factory, "pending-money-other", "Other Pending Money")
        staff_id, staff_token = _seed_receptionist(factory, branch_id)
        other_staff_id, other_staff_token = _seed_receptionist(factory, other_branch_id, "other-receptionist@example.invalid")
        branch_admin_login = "branch-admin@example.invalid"
        with factory.begin() as session:
            branch_admin = StaffUser(login_identifier=branch_admin_login)
            session.add(branch_admin)
            session.flush()
            session.add_all([
                RoleGrant(staff_id=branch_admin.id, role="admin", scope_kind="branch", branch_id=branch_id),
                StaffCredential(staff_id=branch_admin.id, method="pin", secret_hash=hash_pin("2468")),
            ])
            branch_admin_id = branch_admin.id
        branch_admin_session = issue_session(
            factory, branch_admin_login, "2468", branch_id, datetime.now(timezone.utc) + timedelta(hours=1),
        )
        seed_admin(factory)
        with factory.begin() as session:
            session.add_all([
                Member(member_number="SOC-PM-1", full_name="Transfer Member", phone="5551001"),
                Member(member_number="SOC-PM-2", full_name="Debt Member", phone="5551002"),
                Member(member_number="SOC-PM-3", full_name="Repaid Debt Member", phone="5551003"),
                Member(member_number="SOC-PM-4", full_name="Other Branch Member", phone="5551004"),
                Plan(code="pm-plan", name="Pending Money Plan", kind="membership", status="active"),
            ])
            session.flush()
            members = session.query(Member).order_by(Member.member_number).all()
            plan = session.query(Plan).filter_by(code="pm-plan").one()
            version = PlanVersion(
                plan_id=plan.id, version_number=1, name="PM v1", price_minor=12000,
                currency="MXN", duration_value=1, duration_unit="month", is_active=True,
            )
            session.add(version)
            from app.shifts.queries import create_cash_register
            register = create_cash_register(session, branch_id, "pm-register", "Pending money")
            other_register = create_cash_register(session, other_branch_id, "pm-other-register", "Other pending money")
            open_shift(session, register_id=register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            open_shift(session, register_id=other_register.id, opened_by=other_staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_transfer_id, member_debt_id, member_repaid_id, member_other_id, version_id, register_id, other_register_id = (
                members[0].id, members[1].id, members[2].id, members[3].id, version.id, register.id, other_register.id,
            )

        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)
        with TestClient(app) as client:
            assert client.get("/api/v1/admin/pending-money").status_code == 401
            denied = client.get("/api/v1/admin/pending-money", headers={"Authorization": f"Bearer {staff_token}"})
            assert denied.status_code == 403
            admin_headers = approved_admin_headers(client, delivery)
            other_transfer = client.post(
                f"/api/v1/registers/{other_register_id}/membership-transfer-sales",
                headers={"Authorization": f"Bearer {other_staff_token}", "Idempotency-Key": "pm-other-transfer"},
                json={"member_id": str(member_other_id), "plan_version_id": str(version_id)},
            )
            assert other_transfer.status_code == 201, other_transfer.text
            transfer = client.post(
                f"/api/v1/registers/{register_id}/membership-transfer-sales",
                headers={"Authorization": f"Bearer {staff_token}", "Idempotency-Key": "pm-transfer"},
                json={"member_id": str(member_transfer_id), "plan_version_id": str(version_id)},
            )
            assert transfer.status_code == 201, transfer.text
            pending_transfer = client.post(
                f"/api/v1/registers/{register_id}/membership-transfer-sales",
                headers={"Authorization": f"Bearer {staff_token}", "Idempotency-Key": "pm-transfer-pending"},
                json={"member_id": str(member_transfer_id), "plan_version_id": str(version_id)},
            )
            assert pending_transfer.status_code == 201, pending_transfer.text
            confirmed_transfer = client.post(
                f"/api/v1/registers/{register_id}/membership-transfer-sales",
                headers={"Authorization": f"Bearer {staff_token}", "Idempotency-Key": "pm-transfer-confirmed"},
                json={"member_id": str(member_transfer_id), "plan_version_id": str(version_id)},
            )
            assert confirmed_transfer.status_code == 201, confirmed_transfer.text
            for sale, status, key in (
                (pending_transfer, "pending", "pm-review-pending"),
                (confirmed_transfer, "confirmed", "pm-review-confirmed"),
            ):
                reviewed = client.post(
                    f"/api/v1/registers/transfer-payments/{sale.json()['payment']['id']}/review",
                    headers={**admin_headers, "Idempotency-Key": key},
                    json={"status": status},
                )
                assert reviewed.status_code == 200, reviewed.text
            debt_sale = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {staff_token}", "Idempotency-Key": "pm-debt"},
                json={"member_id": str(member_debt_id), "plan_version_id": str(version_id), "cash_amount_minor": 5000},
            )
            assert debt_sale.status_code == 201, debt_sale.text
            debt_payment = client.post(
                f"/api/v1/registers/{register_id}/membership-debt-payments",
                headers={"Authorization": f"Bearer {staff_token}", "Idempotency-Key": "pm-repayment"},
                json={"order_id": debt_sale.json()["order"]["id"], "amount_minor": 2000},
            )
            assert debt_payment.status_code == 201, debt_payment.text
            second_debt_payment = client.post(
                f"/api/v1/registers/{register_id}/membership-debt-payments",
                headers={"Authorization": f"Bearer {staff_token}", "Idempotency-Key": "pm-repayment-second"},
                json={"order_id": debt_sale.json()["order"]["id"], "amount_minor": 1500},
            )
            assert second_debt_payment.status_code == 201, second_debt_payment.text
            repaid_sale = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {staff_token}", "Idempotency-Key": "pm-fully-repaid-debt"},
                json={"member_id": str(member_repaid_id), "plan_version_id": str(version_id), "cash_amount_minor": 3000},
            )
            assert repaid_sale.status_code == 201, repaid_sale.text
            full_repayment = client.post(
                f"/api/v1/registers/{register_id}/membership-debt-payments",
                headers={"Authorization": f"Bearer {staff_token}", "Idempotency-Key": "pm-full-repayment"},
                json={"order_id": repaid_sale.json()["order"]["id"], "amount_minor": 9000},
            )
            assert full_repayment.status_code == 201, full_repayment.text

            response = client.get("/api/v1/admin/pending-money", headers=admin_headers)
            assert response.status_code == 200, response.text
            payload = response.json()
            assert payload["total_pending_minor"] == 12000 * 3 + 3500
            assert {item["item_type"] for item in payload["items"]} == {"pending_transfer", "membership_debt"}
            transfer_items = [item for item in payload["items"] if item["item_type"] == "pending_transfer"]
            assert {item["status"] for item in transfer_items} == {"under_review", "pending"}
            assert {item["source_event_id"] for item in transfer_items} == {
                transfer.json()["payment"]["id"], pending_transfer.json()["payment"]["id"],
                other_transfer.json()["payment"]["id"],
            }
            assert all(item["amount_minor"] == 12000 for item in transfer_items)
            assert all(item["status_event_id"] for item in transfer_items)
            assert all("rental_id" not in item and "rental_charge_id" not in item
                       for item in payload["items"])
            debt_item = next(item for item in payload["items"] if item["item_type"] == "membership_debt")
            assert debt_item["amount_minor"] == 3500
            assert debt_item["initial_amount_minor"] == 7000
            assert debt_item["paid_amount_minor"] == 3500
            assert debt_item["source_event_id"] == debt_payment.json()["debt_id"]
            assert debt_item["order_id"] == debt_sale.json()["order"]["id"]
            assert debt_item["branch_id"] == str(branch_id)
            assert debt_item["member_id"] == str(member_debt_id)
            assert debt_item["status"] == "outstanding"
            assert all(item["member_id"] != str(member_repaid_id) for item in payload["items"])
            branch_admin_headers = {"Authorization": f"Bearer {branch_admin_session.token}"}
            branch_scoped = client.get("/api/v1/admin/pending-money", headers=branch_admin_headers)
            assert branch_scoped.status_code == 200, branch_scoped.text
            assert {item["branch_id"] for item in branch_scoped.json()["items"]} == {str(branch_id)}
            cross_branch = client.get(
                f"/api/v1/admin/pending-money?branch_id={other_branch_id}", headers=branch_admin_headers,
            )
            assert cross_branch.status_code == 403
            with factory() as session:
                before_counts = (
                    session.query(Payment).count(), session.query(MembershipDebt).count(),
                    session.query(MembershipDebtPayment).count(), session.query(PaymentReviewEvent).count(),
                )
            repeated = client.get("/api/v1/admin/pending-money", headers=admin_headers)
            assert repeated.status_code == 200
            with factory() as session:
                after_counts = (
                    session.query(Payment).count(), session.query(MembershipDebt).count(),
                    session.query(MembershipDebtPayment).count(), session.query(PaymentReviewEvent).count(),
                )
            assert after_counts == before_counts
    finally:
        engine.dispose()
