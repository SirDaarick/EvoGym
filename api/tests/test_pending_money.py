from fastapi.testclient import TestClient

from app.db.models import Member, MembershipDebt, MembershipDebtPayment, Payment, PaymentReviewEvent, Plan, PlanVersion
from app.main import create_app
from test_admin_auth import configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_admin_pending_money_lists_pending_transfers_and_outstanding_debt(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "pending-money", "Pending Money")
        staff_id, staff_token = _seed_receptionist(factory, branch_id)
        seed_admin(factory)
        with factory.begin() as session:
            session.add_all([
                Member(member_number="SOC-PM-1", full_name="Transfer Member", phone="5551001"),
                Member(member_number="SOC-PM-2", full_name="Debt Member", phone="5551002"),
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
            open_shift(session, register_id=register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_transfer_id, member_debt_id, version_id, register_id = (
                members[0].id, members[1].id, version.id, register.id,
            )

        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            assert client.get("/api/v1/admin/pending-money").status_code == 401
            denied = client.get("/api/v1/admin/pending-money", headers={"Authorization": f"Bearer {staff_token}"})
            assert denied.status_code == 403
            admin_login = client.post("/api/v1/auth/sessions", json={
                "login_identifier": "owner@example.invalid", "password": "synthetic-admin-password",
            })
            assert admin_login.status_code == 201, admin_login.text
            admin_token = admin_login.json()["access_token"]
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
                    headers={"Authorization": f"Bearer {admin_token}", "Idempotency-Key": key},
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

            response = client.get("/api/v1/admin/pending-money", headers={"Authorization": f"Bearer {admin_token}"})
            assert response.status_code == 200, response.text
            payload = response.json()
            assert payload["total_pending_minor"] == 12000 * 2 + 5000
            assert {item["item_type"] for item in payload["items"]} == {"pending_transfer", "membership_debt"}
            transfer_items = [item for item in payload["items"] if item["item_type"] == "pending_transfer"]
            assert {item["status"] for item in transfer_items} == {"under_review", "pending"}
            assert {item["source_event_id"] for item in transfer_items} == {
                transfer.json()["payment"]["id"], pending_transfer.json()["payment"]["id"],
            }
            assert all(item["amount_minor"] == 12000 for item in transfer_items)
            assert all(item["status_event_id"] for item in transfer_items)
            debt_item = next(item for item in payload["items"] if item["item_type"] == "membership_debt")
            assert debt_item["amount_minor"] == 5000
            assert debt_item["initial_amount_minor"] == 7000
            assert debt_item["source_event_id"] == debt_payment.json()["debt_id"]
            assert debt_item["order_id"] == debt_sale.json()["order"]["id"]
            assert debt_item["branch_id"] == str(branch_id)
            assert debt_item["member_id"] == str(member_debt_id)
            assert debt_item["status"] == "outstanding"
            with factory() as session:
                before_counts = (
                    session.query(Payment).count(), session.query(MembershipDebt).count(),
                    session.query(MembershipDebtPayment).count(), session.query(PaymentReviewEvent).count(),
                )
            repeated = client.get("/api/v1/admin/pending-money", headers={"Authorization": f"Bearer {admin_token}"})
            assert repeated.status_code == 200
            with factory() as session:
                after_counts = (
                    session.query(Payment).count(), session.query(MembershipDebt).count(),
                    session.query(MembershipDebtPayment).count(), session.query(PaymentReviewEvent).count(),
                )
            assert after_counts == before_counts
    finally:
        engine.dispose()
