"""End-to-End verification of Flow C: Shifts, Cash & Inventory Discrepancies (S4).

Rules covered:
1. Cash difference (shortage or surplus) at opening or closing does not prevent the shift operation.
   A comment is required and persisted in DB; surfaces in admin alerts.
2. Next shift's expected opening cash takes the previous counted closing amount and intervening
   overtime cash sales into account. Opening count compares against expected without double-counting.
3. Shift opening inventory count: unchanged quantities require no adjustment; shortage or surplus
   requires a reason, automatically adjusts stock via StockMovement (open_in / open_out), and records
   an observation surfaced as an admin alert.
4. Direct DB row inspection and frontend read endpoint verification.
"""

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from admin_session_helpers import approved_admin_headers
from app.db.models import (
    Branch,
    CashRegister,
    Order,
    OrderItem,
    Payment,
    Product,
    RoleGrant,
    Shift,
    ShiftInventoryObservation,
    ShiftInventoryReview,
    StaffCredential,
    StaffUser,
    StockInitialization,
    StockMovement,
)
from app.inventory.queries import capture_register_inventory_snapshot, get_on_hand_stock
from app.main import create_app
from app.sales.queries import post_cash_product_sale
from app.sales.schemas import ProductCartLineRequest
from app.shifts.queries import (
    close_shift,
    create_cash_register,
    expected_opening_cash_for_register,
)
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_flow_c_shifts_cash_and_inventory_discrepancies_e2e(tmp_path):
    """Full lifecycle: Open Shift 1 -> In-shift cash sale -> Close with shortage (alert) ->
    Overtime cash sale -> Open Shift 2 with surplus & stock discrepancy -> Verify no double-counting ->
    Clean Shift 2 close -> Verify DB rows & read endpoints."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        # ---------------------------------------------------------------------
        # 0. Setup: Branch, Receptionist, Admin, Register, and Inventory Product
        # ---------------------------------------------------------------------
        branch_id = _seed_branch(factory, "flow-c-central", "Central Flow C Branch")
        staff_id, recep_token = _seed_receptionist(factory, branch_id, "receptionist@evogym.com")
        seed_admin(factory, "admin@evogym.com", "admin-password-123")
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        recep_headers = {"Authorization": f"Bearer {recep_token}"}

        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-flow-c-01", "Caja Principal")
            reg_id = str(register.id)

            # Product: Energy drink ($50.00 = 5000 minor)
            drink = Product(
                code="flow-c-drink",
                name="Bebida Energetica 355ml",
                price_minor=5000,
                cost_minor=2500,
                created_by=staff_id,
            )
            session.add(drink)
            session.flush()
            drink_id = drink.id

            # Initial stock: 20 pieces
            session.add(StockInitialization(
                branch_id=branch_id,
                product_id=drink_id,
                quantity=20,
                initialized_by=staff_id,
            ))

        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "admin@evogym.com", "admin-password-123")

            # Verify initial inventory stock via query
            with factory() as session:
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=drink_id) == 20

            # -----------------------------------------------------------------
            # 1. Phase 1: Open Shift 1 (First shift on register, initial float $1,000.00 = 100000 minor)
            # -----------------------------------------------------------------
            with factory() as session:
                snap1 = capture_register_inventory_snapshot(session, register_id=UUID(reg_id), actor_id=staff_id)
                session.commit()
                snap1_id = str(snap1.id)

            res_open1 = client.post(
                "/api/v1/shifts/open",
                headers=recep_headers,
                json={
                    "cash_register_id": reg_id,
                    "inventory_snapshot_id": snap1_id,
                    "opening_cash_minor": 100000,
                    "denomination_counts": [{"denomination_minor": 100, "quantity": 1000}],
                },
            )
            assert res_open1.status_code == 201, res_open1.text
            shift1_data = res_open1.json()
            shift1_id = shift1_data["id"]
            assert shift1_data["status"] == "open"
            assert shift1_data["opening_cash_minor"] == 100000
            assert shift1_data["expected_opening_cash_minor"] is None
            assert shift1_data["opening_difference_minor"] is None

            # Read endpoint verification: GET /api/v1/shifts/current
            res_curr = client.get(f"/api/v1/shifts/current?register_id={reg_id}", headers=recep_headers)
            assert res_curr.status_code == 200
            assert res_curr.json()["id"] == shift1_id
            assert res_curr.json()["current_expected_cash_minor"] == 100000

            # -----------------------------------------------------------------
            # 2. Phase 2: In-Shift Cash Sale (2 drinks @ $50.00 = $100.00 / 10000 minor)
            # -----------------------------------------------------------------
            sale1_headers = {**recep_headers, "Idempotency-Key": str(uuid4())}
            sale1_payload = {
                "member_id": None,
                "items": [{"product_id": str(drink_id), "quantity": 2}],
                "expected_total_minor": 10000,
                "credit_minor": 0,
            }
            res_intent1 = client.post(
                f"/api/v1/registers/{reg_id}/product-sale-intent",
                headers=sale1_headers,
                json=sale1_payload,
            )
            assert res_intent1.status_code == 200, res_intent1.text

            res_sale1 = client.post(
                f"/api/v1/registers/{reg_id}/product-sales",
                headers=sale1_headers,
                json=sale1_payload,
            )
            assert res_sale1.status_code == 201, res_sale1.text
            assert client.post(
                f"/api/v1/registers/{reg_id}/product-sales/resolve",
                headers=sale1_headers,
                json=sale1_payload,
            ).status_code == 200

            # Stock should now be 18
            with factory() as session:
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=drink_id) == 18

            # Live expected cash in drawer is now 100000 + 10000 = 110000 minor
            res_curr_live = client.get(f"/api/v1/shifts/current?register_id={reg_id}", headers=recep_headers)
            assert res_curr_live.status_code == 200
            assert res_curr_live.json()["current_expected_cash_minor"] == 110000

            # -----------------------------------------------------------------
            # 3. Phase 3: Shift 1 Close with Cash Discrepancy (Shortage of $50.00 / 5000 minor)
            # -----------------------------------------------------------------
            # Counted cash is 105000 minor ($1,050.00), expected is 110000 minor.
            # Attempt to close without comment -> 422
            res_close_no_comment = client.post(
                f"/api/v1/shifts/{shift1_id}/close",
                headers=recep_headers,
                json={"counted_cash_minor": 105000},
            )
            assert res_close_no_comment.status_code == 422

            # Close WITH comment -> 201 (does NOT prevent shift operation)
            res_close1 = client.post(
                f"/api/v1/shifts/{shift1_id}/close",
                headers=recep_headers,
                json={
                    "counted_cash_minor": 105000,
                    "closing_notes": "Faltante de 50 pesos por error en cambio al cliente",
                },
            )
            assert res_close1.status_code == 201, res_close1.text
            closed1 = res_close1.json()
            assert closed1["status"] == "closed"
            assert closed1["expected_cash_at_close_minor"] == 110000
            assert closed1["counted_cash_minor"] == 105000
            assert closed1["difference_minor"] == -5000
            assert "Faltante de 50 pesos" in closed1["closing_notes"]
            assert "Faltante de 50 pesos" in closed1["notes"]

            # Direct DB Inspection: Shift 1
            with factory() as session:
                s1_db = session.get(Shift, UUID(shift1_id))
                assert s1_db is not None
                assert s1_db.status == "closed"
                assert s1_db.expected_cash_at_close_minor == 110000
                assert s1_db.counted_cash_minor == 105000
                assert s1_db.difference_minor == -5000
                assert "Faltante de 50 pesos" in s1_db.closing_notes

            # Read Endpoint Verification: GET /api/v1/shifts/{id} and summary
            res_s1_get = client.get(f"/api/v1/shifts/{shift1_id}", headers=recep_headers)
            assert res_s1_get.status_code == 200
            assert res_s1_get.json()["difference_minor"] == -5000

            res_s1_sum = client.get(f"/api/v1/shifts/{shift1_id}/summary", headers=recep_headers)
            assert res_s1_sum.status_code == 200
            assert res_s1_sum.json()["confirmed_cash_minor"] == 10000
            assert res_s1_sum.json()["expected_cash_minor"] == 110000

            # Admin Alert Center read endpoint: GET /api/v1/owner/overview
            res_overview1 = client.get(f"/api/v1/owner/overview?branch_id={branch_id}", headers=admin_headers)
            assert res_overview1.status_code == 200, res_overview1.text
            overview1_data = res_overview1.json()
            shift_disc = overview1_data["finances"]["shift_discrepancies"]
            assert any(item["shift_id"] == shift1_id and item["difference_minor"] == -5000 for item in shift_disc)
            alert_categories1 = {c["category"]: c["count"] for c in overview1_data["alerts"]["category_counts"]} if "alerts" in overview1_data and "category_counts" in overview1_data["alerts"] else {}
            assert overview1_data["pulse"]["alerts_count"] >= 1

            # -----------------------------------------------------------------
            # 4. Phase 4: Overtime Cash Sale Between Shifts ($50.00 / 5000 minor)
            # -----------------------------------------------------------------
            # When register has NO open shift, a sale is recorded as overtime
            ot_headers = {**recep_headers, "Idempotency-Key": str(uuid4())}
            ot_payload = {
                "member_id": None,
                "items": [{"product_id": str(drink_id), "quantity": 1}],
                "expected_total_minor": 5000,
                "credit_minor": 0,
            }
            res_ot_intent = client.post(
                f"/api/v1/registers/{reg_id}/product-sale-intent",
                headers=ot_headers,
                json=ot_payload,
            )
            assert res_ot_intent.status_code == 200, res_ot_intent.text

            res_overtime_sale = client.post(
                f"/api/v1/registers/{reg_id}/product-sales",
                headers=ot_headers,
                json=ot_payload,
            )
            assert res_overtime_sale.status_code == 201, res_overtime_sale.text
            assert client.post(
                f"/api/v1/registers/{reg_id}/product-sales/resolve",
                headers=ot_headers,
                json=ot_payload,
            ).status_code == 200
            overtime_order_id = UUID(res_overtime_sale.json()["order"]["id"])

            # Direct DB Inspection: Overtime order
            with factory() as session:
                ot_order = session.get(Order, overtime_order_id)
                assert ot_order is not None
                assert ot_order.is_overtime is True
                assert ot_order.financial_shift_id is None
                assert ot_order.cash_included_in_opening is False

                # Expected opening cash for register now equals:
                # counted_cash_minor of shift 1 (105000) + overtime cash (5000) = 110000
                expected_opening, has_baseline = expected_opening_cash_for_register(session, UUID(reg_id))
                assert has_baseline is True
                assert expected_opening == 110000

                # On-hand stock is now 18 - 1 = 17
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=drink_id) == 17

            # -----------------------------------------------------------------
            # 5. Phase 5: Open Shift 2 with Cash Discrepancy & Inventory Discrepancy
            # -----------------------------------------------------------------
            # Expected opening cash: 110000. Physical cash counted in drawer: 112000 (surplus of 2000 minor).
            # Expected stock: 17. Physical stock counted on shelf: 15 (shortage of 2 pieces).
            with factory() as session:
                snap2 = capture_register_inventory_snapshot(session, register_id=UUID(reg_id), actor_id=staff_id)
                session.commit()
                snap2_id = str(snap2.id)

            # 5a. Attempt opening with cash difference without notes -> 422
            res_open2_no_notes = client.post(
                "/api/v1/shifts/open",
                headers=recep_headers,
                json={
                    "cash_register_id": reg_id,
                    "inventory_snapshot_id": snap2_id,
                    "opening_cash_minor": 112000,
                    "denomination_counts": [{"denomination_minor": 100, "quantity": 1120}],
                },
            )
            assert res_open2_no_notes.status_code == 422

            # 5b. Attempt opening with inventory difference without reason -> 422
            res_open2_no_reason = client.post(
                "/api/v1/shifts/open",
                headers=recep_headers,
                json={
                    "cash_register_id": reg_id,
                    "inventory_snapshot_id": snap2_id,
                    "opening_cash_minor": 112000,
                    "denomination_counts": [{"denomination_minor": 100, "quantity": 1120}],
                    "notes": "20 pesos de propina dejados en caja",
                    "inventory_observations": [
                        {"product_id": str(drink_id), "physical_quantity": 15}  # missing reason
                    ],
                },
            )
            assert res_open2_no_reason.status_code == 422

            # 5c. Open Shift 2 with BOTH required comments -> 201
            res_open2 = client.post(
                "/api/v1/shifts/open",
                headers=recep_headers,
                json={
                    "cash_register_id": reg_id,
                    "inventory_snapshot_id": snap2_id,
                    "opening_cash_minor": 112000,
                    "denomination_counts": [{"denomination_minor": 100, "quantity": 1120}],
                    "notes": "20 pesos de propina dejados en caja",
                    "inventory_observations": [
                        {
                            "product_id": str(drink_id),
                            "physical_quantity": 15,
                            "reason": "2 latas encontradas abolladas y descartadas",
                        }
                    ],
                },
            )
            assert res_open2.status_code == 201, res_open2.text
            shift2_data = res_open2.json()
            shift2_id = shift2_data["id"]

            assert shift2_data["status"] == "open"
            assert shift2_data["opening_cash_minor"] == 112000
            assert shift2_data["expected_opening_cash_minor"] == 110000
            assert shift2_data["opening_difference_minor"] == 2000
            assert "20 pesos de propina" in shift2_data["notes"]

            # Direct DB Inspection: Shift 2 & Overtime Order & StockMovement
            with factory() as session:
                s2_db = session.get(Shift, UUID(shift2_id))
                assert s2_db is not None
                assert s2_db.opening_cash_minor == 112000
                assert s2_db.closing_notes == "20 pesos de propina dejados en caja"

                # Overtime order was linked to Shift 2 and marked cash_included_in_opening
                ot_order_updated = session.get(Order, overtime_order_id)
                assert ot_order_updated.financial_shift_id == UUID(shift2_id)
                assert ot_order_updated.cash_included_in_opening is True

                # StockMovement was automatically created for the shortage of 2 pieces
                stock_mv = session.scalars(
                    select(StockMovement).where(
                        StockMovement.product_id == drink_id,
                        StockMovement.kind == "open_out",
                    )
                ).all()
                assert len(stock_mv) == 1
                assert stock_mv[0].quantity == 2
                assert stock_mv[0].reason == "2 latas encontradas abolladas y descartadas"

                # On-hand stock was adjusted from 17 down to 15!
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=drink_id) == 15

                # ShiftInventoryObservation row
                obs = session.scalars(
                    select(ShiftInventoryObservation).where(ShiftInventoryObservation.reason.is_not(None))
                ).all()
                assert len(obs) == 1
                assert obs[0].physical_quantity == 15
                assert obs[0].reason == "2 latas encontradas abolladas y descartadas"

            # -----------------------------------------------------------------
            # 6. Verify Overtime Cash is NOT Double-Counted in Current Shift
            # -----------------------------------------------------------------
            # Live expected cash in drawer for Shift 2 should be exactly opening_cash_minor (112000),
            # NOT 112000 + 5000 overtime cash.
            res_curr2 = client.get(f"/api/v1/shifts/current?register_id={reg_id}", headers=recep_headers)
            assert res_curr2.status_code == 200
            curr2_data = res_curr2.json()
            assert curr2_data["opening_cash_minor"] == 112000
            assert curr2_data["expected_opening_cash_minor"] == 110000
            assert curr2_data["opening_difference_minor"] == 2000
            assert curr2_data["current_expected_cash_minor"] == 112000

            # Admin Alert Center check: Inventory discrepancy is surfaced!
            res_overview2 = client.get(f"/api/v1/owner/overview?branch_id={branch_id}", headers=admin_headers)
            assert res_overview2.status_code == 200
            overview2_data = res_overview2.json()
            count_discrepancies = overview2_data["finances"]["count_discrepancies"]
            assert any(
                item["shift_id"] == shift2_id
                and item["product"] == "Bebida Energetica 355ml"
                and item["physical_quantity"] == 15
                and item["expected_quantity"] == 17
                for item in count_discrepancies
            )

            # -----------------------------------------------------------------
            # 7. Phase 7: Clean Shift 2 Close (Zero Cash Difference)
            # -----------------------------------------------------------------
            # Counted cash is exactly 112000 (diff == 0). No closing comment required.
            res_close2 = client.post(
                f"/api/v1/shifts/{shift2_id}/close",
                headers=recep_headers,
                json={"counted_cash_minor": 112000},
            )
            assert res_close2.status_code == 201, res_close2.text
            closed2 = res_close2.json()
            assert closed2["status"] == "closed"
            assert closed2["expected_cash_at_close_minor"] == 112000
            assert closed2["counted_cash_minor"] == 112000
            assert closed2["difference_minor"] == 0

            # DB verification: Shift 2 difference_minor is 0
            with factory() as session:
                s2_final = session.get(Shift, UUID(shift2_id))
                assert s2_final.difference_minor == 0
                assert s2_final.expected_cash_at_close_minor == 112000

            # Shifts history page: GET /api/v1/shifts?register_id=...
            res_shifts = client.get(f"/api/v1/shifts?register_id={reg_id}", headers=recep_headers)
            assert res_shifts.status_code == 200
            items = res_shifts.json()["items"]
            assert len(items) == 2
            # Both shifts present with opening and closing fields intact
            assert items[0]["id"] == shift2_id
            assert items[0]["expected_opening_cash_minor"] == 110000
            assert items[0]["opening_difference_minor"] == 2000
            assert items[1]["id"] == shift1_id
            assert items[1]["difference_minor"] == -5000
    finally:
        engine.dispose()
