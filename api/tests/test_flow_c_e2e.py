"""Unified Flow C End-to-End Test Suite:
Action -> Business Rule -> DB Row Inspection -> Frontend Read Contracts

Covers the complete, integrated Flow C business rules end-to-end:
1. Shift 1 Open & Inventory Purchase from Drawer (S3 + S4)
2. Product Sale & Mistaken Purchase Cancellation Guard (L16)
3. Shift 1 Close Discrepancy -> Overtime Cash Sale -> Shift 2 Open with Cash & Stock Discrepancies (S4)
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
    Expense,
    InventoryPurchase,
    Order,
    OrderItem,
    Payment,
    Product,
    Shift,
    ShiftInventoryObservation,
    ShiftInventoryReview,
    StockInitialization,
    StockMovement,
)
from app.inventory.queries import capture_register_inventory_snapshot, get_on_hand_stock
from app.main import create_app
from app.shifts.queries import (
    create_cash_register,
    expected_cash_for_shift,
    expected_opening_cash_for_register,
)
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db


def test_flow_c_unified_end_to_end_scenario(tmp_path):
    """Verify complete integrated Flow C end-to-end lifecycle across all 3 phases:
    1. Shift 1 Open, purchase cash drawer guard, rounded reference costs, DB rows, frontend read contracts.
    2. Stock-bounded sale, drawer cash update, L16 post-sale void block, clean void for unconsumed purchase.
    3. Shift 1 closing discrepancy (-5000), overtime cash sale (+5000), Shift 2 opening cash & stock
       discrepancies (+1000 & -1 piece) with automatic stock adjustment and no double-counting in live cash.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        # =====================================================================
        # 0. Initial Setup: Branch, Receptionist, Admin, Register & Initial Stock
        # =====================================================================
        branch_id = _seed_branch(factory, "flow-c-unified", "Flow C Unified Branch")
        staff_id, recep_token = _seed_receptionist(factory, branch_id, "receptionist@evogym.com")
        seed_admin(factory, "admin@evogym.com", "admin-pass-123")
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        recep_headers = {"Authorization": f"Bearer {recep_token}"}

        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-flow-c-unified", "Caja Principal")
            reg_id = str(register.id)

            # Product A: $150.00 sale price, $20.00 initial cost (2000 minor)
            prod_a = Product(
                code="prod-a",
                name="Product A Energy Drink",
                category="Bebidas",
                price_minor=15000,
                cost_minor=2000,
                is_active=True,
                created_by=staff_id,
            )
            # Product B: $200.00 sale price, $80.00 initial cost (8000 minor)
            prod_b = Product(
                code="prod-b",
                name="Product B Protein Bar",
                category="Snacks",
                price_minor=20000,
                cost_minor=8000,
                is_active=True,
                created_by=staff_id,
            )
            # Product C: $50.00 sale price, $10.00 initial cost (1000 minor)
            prod_c = Product(
                code="prod-c",
                name="Product C Water Bottle",
                category="Bebidas",
                price_minor=5000,
                cost_minor=1000,
                is_active=True,
                created_by=staff_id,
            )
            session.add_all([prod_a, prod_b, prod_c])
            session.flush()

            prod_a_id = prod_a.id
            prod_b_id = prod_b.id
            prod_c_id = prod_c.id

            # Initial stock: 10 units of A, 10 units of B, 5 units of C
            session.add(StockInitialization(branch_id=branch_id, product_id=prod_a_id, quantity=10, initialized_by=staff_id))
            session.add(StockInitialization(branch_id=branch_id, product_id=prod_b_id, quantity=10, initialized_by=staff_id))
            session.add(StockInitialization(branch_id=branch_id, product_id=prod_c_id, quantity=5, initialized_by=staff_id))

        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "admin@evogym.com", "admin-pass-123")

            # Verify initial stocks in DB
            with factory() as session:
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_a_id) == 10
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_b_id) == 10
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_c_id) == 5

            # =====================================================================
            # 1. Phase 1: Shift 1 Open & Inventory Purchase from Drawer (S3 + S4)
            # =====================================================================

            # 1a. Open Shift 1 with $1,000.00 (100000 minor) cash float
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
            shift1_id = res_open1.json()["id"]

            # Live drawer cash is 100000 minor
            res_curr1 = client.get(f"/api/v1/shifts/current?register_id={reg_id}", headers=recep_headers)
            assert res_curr1.status_code == 200
            assert res_curr1.json()["current_expected_cash_minor"] == 100000

            # 1b. Attempt grouped inventory purchase paid from drawer for $1,200.00 (120000 minor)
            # Rejected with 409 inventory_purchase_rejected because drawer only has $1,000.00
            rejected_purchase_payload = {
                "items": [{"product_id": str(prod_a_id), "quantity": 10, "cost_minor": 120000}],
                "pay_from_drawer": True,
                "register_id": reg_id,
            }
            res_rejected = client.post(
                f"/api/v1/inventory/branches/{branch_id}/purchases",
                headers={**recep_headers, "Idempotency-Key": "rejected-drawer-purchase"},
                json=rejected_purchase_payload,
            )
            assert res_rejected.status_code == 409
            assert res_rejected.json()["error"]["code"] == "inventory_purchase_rejected"

            # Verify in DB: 0 purchases, 0 expenses, and 0 restock movements were created
            with factory() as session:
                assert session.scalar(select(InventoryPurchase)) is None
                assert session.scalar(select(Expense)) is None
                assert session.scalars(select(StockMovement).where(StockMovement.kind == "restock")).all() == []
                s1 = session.get(Shift, UUID(shift1_id))
                assert expected_cash_for_shift(session, s1) == 100000

            # 1c. Confirm grouped inventory purchase paid from drawer:
            # 3 units of Product A at $100.00 total (10000 minor -> unit reference cost rounded to 3333 minor)
            # 2 units of Product B at $200.00 total (20000 minor)
            # Total purchase = 30000 minor ($300.00)
            valid_purchase_payload = {
                "items": [
                    {"product_id": str(prod_a_id), "quantity": 3, "cost_minor": 10000},
                    {"product_id": str(prod_b_id), "quantity": 2, "cost_minor": 20000},
                ],
                "pay_from_drawer": True,
                "register_id": reg_id,
            }
            res_purchase1 = client.post(
                f"/api/v1/inventory/branches/{branch_id}/purchases",
                headers={**recep_headers, "Idempotency-Key": "purchase-one-funded"},
                json=valid_purchase_payload,
            )
            assert res_purchase1.status_code == 201, res_purchase1.text
            purchase1_data = res_purchase1.json()
            purchase1_id = purchase1_data["id"]
            expense1_id = purchase1_data["expense_id"]
            assert purchase1_data["total_minor"] == 30000

            # 1d. DB Inspection: InventoryPurchase, Expense, StockMovement, Product, and drawer expected cash
            with factory() as session:
                purchases = session.scalars(select(InventoryPurchase)).all()
                assert len(purchases) == 1
                assert purchases[0].total_minor == 30000
                assert purchases[0].expense_id == UUID(expense1_id)

                expenses = session.scalars(select(Expense)).all()
                assert len(expenses) == 1
                assert expenses[0].amount_minor == 30000
                assert expenses[0].shift_id == UUID(shift1_id)
                assert expenses[0].voided_at is None

                prod_a_db = session.get(Product, prod_a_id)
                assert prod_a_db.cost_minor == 3333  # 10000 / 3 = 3333.33 -> 3333

                s1 = session.get(Shift, UUID(shift1_id))
                assert expected_cash_for_shift(session, s1) == 70000  # 100000 - 30000

                # 2 restock movements created (3 for A, 2 for B)
                movements = session.scalars(select(StockMovement).where(StockMovement.kind == "restock")).all()
                assert len(movements) == 2
                assert {m.product_id: m.quantity for m in movements} == {prod_a_id: 3, prod_b_id: 2}

            # 1e. Frontend Read Endpoints Verification
            # GET /api/v1/inventory/branches/{branch_id}/stock reflects new quantities and cost_minor == 3333
            res_stock = client.get(f"/api/v1/inventory/branches/{branch_id}/stock", headers=recep_headers)
            assert res_stock.status_code == 200
            stock_items = {item["product_id"]: item for item in res_stock.json()["items"]}
            assert stock_items[str(prod_a_id)]["quantity"] == 13  # 10 + 3
            assert stock_items[str(prod_a_id)]["cost_minor"] == 3333
            assert stock_items[str(prod_b_id)]["quantity"] == 12  # 10 + 2

            # GET /api/v1/inventory/branches/{branch_id}/purchase-cost-alerts
            # Denies Reception (403) and returns alerts to Admin (200)
            assert client.get(f"/api/v1/inventory/branches/{branch_id}/purchase-cost-alerts", headers=recep_headers).status_code == 403
            res_alerts = client.get(f"/api/v1/inventory/branches/{branch_id}/purchase-cost-alerts", headers=admin_headers)
            assert res_alerts.status_code == 200
            alert_items = res_alerts.json()["items"]
            assert any(a["product_id"] == str(prod_a_id) and a["previous_cost_minor"] == 2000 and a["unit_cost_minor"] == 3333 for a in alert_items)

            # Expenses read endpoint lists the linked expense
            res_expenses = client.get(f"/api/v1/registers/{reg_id}/expenses", headers=recep_headers)
            assert res_expenses.status_code == 200
            exp_data = res_expenses.json()
            assert exp_data["total_minor"] == 30000
            assert any(e["id"] == expense1_id and e["amount_minor"] == 30000 for e in exp_data["items"])

            res_admin_expenses = client.get(
                f"/api/v1/admin/expenses?from=2000-01-01&to=2100-01-01&branch_id={branch_id}",
                headers=admin_headers,
            )
            assert res_admin_expenses.status_code == 200
            assert any(e["id"] == expense1_id for e in res_admin_expenses.json()["items"])

            # =====================================================================
            # 2. Phase 2: Product Sale & Mistaken Purchase Cancellation Guard (L16)
            # =====================================================================

            # 2a. Attempt sale exceeding available stock (sell 100 units of Product A when 13 are in stock) -> 409
            excess_key = str(uuid4())
            excess_sale_payload = {
                "member_id": None,
                "items": [{"product_id": str(prod_a_id), "quantity": 100}],
                "expected_total_minor": 15000 * 100,
                "credit_minor": 0,
            }
            res_excess = client.post(
                f"/api/v1/registers/{reg_id}/product-sales",
                headers={**recep_headers, "Idempotency-Key": excess_key},
                json=excess_sale_payload,
            )
            assert res_excess.status_code == 409
            assert res_excess.json()["error"]["code"] == "product_sale_rejected"

            # 2b. Valid cash sale of 1 unit of Product A ($150.00 / 15000 minor)
            sale1_key = str(uuid4())
            sale1_payload = {
                "member_id": None,
                "items": [{"product_id": str(prod_a_id), "quantity": 1}],
                "expected_total_minor": 15000,
                "credit_minor": 0,
            }
            res_intent1 = client.post(
                f"/api/v1/registers/{reg_id}/product-sale-intent",
                headers={**recep_headers, "Idempotency-Key": sale1_key},
                json=sale1_payload,
            )
            assert res_intent1.status_code == 200

            res_sale1 = client.post(
                f"/api/v1/registers/{reg_id}/product-sales",
                headers={**recep_headers, "Idempotency-Key": sale1_key},
                json=sale1_payload,
            )
            assert res_sale1.status_code == 201, res_sale1.text
            assert client.post(
                f"/api/v1/registers/{reg_id}/product-sales/resolve",
                headers={**recep_headers, "Idempotency-Key": sale1_key},
                json=sale1_payload,
            ).status_code == 200

            # DB verification: StockMovement(kind='sale') and updated drawer expected cash
            with factory() as session:
                sales = session.scalars(
                    select(StockMovement).where(
                        StockMovement.product_id == prod_a_id,
                        StockMovement.kind == "sale",
                    )
                ).all()
                assert len(sales) == 1
                assert sales[0].quantity == 1
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_a_id) == 12  # 13 - 1

                s1 = session.get(Shift, UUID(shift1_id))
                assert expected_cash_for_shift(session, s1) == 85000  # 70000 + 15000

            res_curr_sale = client.get(f"/api/v1/shifts/current?register_id={reg_id}", headers=recep_headers)
            assert res_curr_sale.status_code == 200
            assert res_curr_sale.json()["current_expected_cash_minor"] == 85000

            # 2c. Admin attempts to void purchase 1's linked expense -> rejected with 409
            # purchase_cancellation_requires_review because 1 unit of Product A was already sold!
            res_void_blocked = client.post(
                f"/api/v1/expenses/{expense1_id}/void",
                headers=admin_headers,
                json={"reason": "Mistaken purchase of Product A"},
            )
            assert res_void_blocked.status_code == 409
            assert res_void_blocked.json()["error"]["code"] == "purchase_cancellation_requires_review"

            # DB inspection: Expense.voided_at remains None and stock was not altered
            with factory() as session:
                exp1 = session.get(Expense, UUID(expense1_id))
                assert exp1.voided_at is None
                assert exp1.void_reason is None
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_a_id) == 12

            # 2d. Second purchase whose products have NOT been sold CAN be voided by Admin
            # Purchase 2 units of Product C for 3000 minor ($30.00 -> unit cost 1500 > initial 1000)
            res_purchase2 = client.post(
                f"/api/v1/inventory/branches/{branch_id}/purchases",
                headers={**recep_headers, "Idempotency-Key": "purchase-two-unconsumed"},
                json={
                    "items": [{"product_id": str(prod_c_id), "quantity": 2, "cost_minor": 3000}],
                    "pay_from_drawer": False,
                },
            )
            assert res_purchase2.status_code == 201
            expense2_id = res_purchase2.json()["expense_id"]

            with factory() as session:
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_c_id) == 7  # 5 + 2
                assert session.get(Product, prod_c_id).cost_minor == 1500

            # Cost alert for Product C appears
            res_alerts_before_void = client.get(f"/api/v1/inventory/branches/{branch_id}/purchase-cost-alerts", headers=admin_headers)
            assert any(a["product_id"] == str(prod_c_id) and a["unit_cost_minor"] == 1500 for a in res_alerts_before_void.json()["items"])

            # Admin voids the second purchase's expense
            res_void2 = client.post(
                f"/api/v1/expenses/{expense2_id}/void",
                headers=admin_headers,
                json={"reason": "Incorrect purchase entry for Product C"},
            )
            assert res_void2.status_code == 200

            # DB verification: StockMovement(kind='waste') reverses stock, Product.cost_minor restored
            with factory() as session:
                exp2 = session.get(Expense, UUID(expense2_id))
                assert exp2.voided_at is not None
                assert exp2.void_reason == "Incorrect purchase entry for Product C"

                # Stock reversed back to 5 via StockMovement(kind='waste')
                waste_mv = session.scalars(
                    select(StockMovement).where(
                        StockMovement.product_id == prod_c_id,
                        StockMovement.kind == "waste",
                    )
                ).all()
                assert len(waste_mv) == 1
                assert waste_mv[0].quantity == 2
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_c_id) == 5

                # Product cost restored back to 1000
                assert session.get(Product, prod_c_id).cost_minor == 1000

            # Cost alert for Product C is removed
            res_alerts_after_void = client.get(f"/api/v1/inventory/branches/{branch_id}/purchase-cost-alerts", headers=admin_headers)
            assert not any(a["product_id"] == str(prod_c_id) for a in res_alerts_after_void.json()["items"])

            # =====================================================================
            # 3. Phase 3: Shift 1 Close Discrepancy -> Overtime Cash Sale -> Shift 2 Open (S4)
            # =====================================================================

            # 3a. Close Shift 1 with counted cash 80000 (shortage of -5000 against expected 85000)
            # Omitting closing_notes returns 422
            res_close_no_notes = client.post(
                f"/api/v1/shifts/{shift1_id}/close",
                headers=recep_headers,
                json={"counted_cash_minor": 80000},
            )
            assert res_close_no_notes.status_code == 422

            # Providing closing_notes succeeds (201)
            res_close1 = client.post(
                f"/api/v1/shifts/{shift1_id}/close",
                headers=recep_headers,
                json={
                    "counted_cash_minor": 80000,
                    "closing_notes": "Faltante de 50 pesos al cuadre de turno 1",
                },
            )
            assert res_close1.status_code == 201, res_close1.text
            closed1_data = res_close1.json()
            assert closed1_data["status"] == "closed"
            assert closed1_data["expected_cash_at_close_minor"] == 85000
            assert closed1_data["counted_cash_minor"] == 80000
            assert closed1_data["difference_minor"] == -5000

            # DB verification: Shift 1 difference_minor persists
            with factory() as session:
                s1_db = session.get(Shift, UUID(shift1_id))
                assert s1_db.status == "closed"
                assert s1_db.difference_minor == -5000
                assert s1_db.expected_cash_at_close_minor == 85000
                assert s1_db.counted_cash_minor == 80000

            # Surfaces in GET /api/v1/owner/overview (finances.shift_discrepancies)
            res_overview1 = client.get(f"/api/v1/owner/overview?branch_id={branch_id}", headers=admin_headers)
            assert res_overview1.status_code == 200
            overview1_discrepancies = res_overview1.json()["finances"]["shift_discrepancies"]
            assert any(item["shift_id"] == shift1_id and item["difference_minor"] == -5000 for item in overview1_discrepancies)

            # 3b. Record overtime cash sale (5000 minor) while no shift is open
            ot_key = str(uuid4())
            ot_payload = {
                "member_id": None,
                "items": [{"product_id": str(prod_c_id), "quantity": 1}],
                "expected_total_minor": 5000,
                "credit_minor": 0,
            }
            res_ot_intent = client.post(
                f"/api/v1/registers/{reg_id}/product-sale-intent",
                headers={**recep_headers, "Idempotency-Key": ot_key},
                json=ot_payload,
            )
            assert res_ot_intent.status_code == 200

            res_ot_sale = client.post(
                f"/api/v1/registers/{reg_id}/product-sales",
                headers={**recep_headers, "Idempotency-Key": ot_key},
                json=ot_payload,
            )
            assert res_ot_sale.status_code == 201, res_ot_sale.text
            assert client.post(
                f"/api/v1/registers/{reg_id}/product-sales/resolve",
                headers={**recep_headers, "Idempotency-Key": ot_key},
                json=ot_payload,
            ).status_code == 200
            overtime_order_id = UUID(res_ot_sale.json()["order"]["id"])

            # DB verification: Order.is_overtime is True and expected opening cash is 80000 + 5000 = 85000
            with factory() as session:
                ot_order = session.get(Order, overtime_order_id)
                assert ot_order.is_overtime is True
                assert ot_order.financial_shift_id is None
                assert ot_order.cash_included_in_opening is False

                expected_opening, has_baseline = expected_opening_cash_for_register(session, UUID(reg_id))
                assert has_baseline is True
                assert expected_opening == 85000  # 80000 previous close + 5000 overtime sale

                # Product C on hand is now 5 - 1 = 4
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_c_id) == 4

            # 3c. Open Shift 2:
            # Expected opening cash: 85000. Counted opening cash: 86000 (surplus +1000).
            # Expected Product B stock: 12. Reported physical count: 11 (shortage 1 piece).
            with factory() as session:
                snap2 = capture_register_inventory_snapshot(session, register_id=UUID(reg_id), actor_id=staff_id)
                session.commit()
                snap2_id = str(snap2.id)

            # Omitting opening notes returns 422
            res_open2_no_notes = client.post(
                "/api/v1/shifts/open",
                headers=recep_headers,
                json={
                    "cash_register_id": reg_id,
                    "inventory_snapshot_id": snap2_id,
                    "opening_cash_minor": 86000,
                    "denomination_counts": [{"denomination_minor": 100, "quantity": 860}],
                    "inventory_observations": [
                        {"product_id": str(prod_b_id), "physical_quantity": 11, "reason": "Empaque roto"}
                    ],
                },
            )
            assert res_open2_no_notes.status_code == 422

            # Omitting observation reason returns 422
            res_open2_no_reason = client.post(
                "/api/v1/shifts/open",
                headers=recep_headers,
                json={
                    "cash_register_id": reg_id,
                    "inventory_snapshot_id": snap2_id,
                    "opening_cash_minor": 86000,
                    "denomination_counts": [{"denomination_minor": 100, "quantity": 860}],
                    "notes": "Sobrante de 10 pesos dejado en caja",
                    "inventory_observations": [
                        {"product_id": str(prod_b_id), "physical_quantity": 11}  # Missing reason
                    ],
                },
            )
            assert res_open2_no_reason.status_code == 422

            # Providing both succeeds (201)
            res_open2 = client.post(
                "/api/v1/shifts/open",
                headers=recep_headers,
                json={
                    "cash_register_id": reg_id,
                    "inventory_snapshot_id": snap2_id,
                    "opening_cash_minor": 86000,
                    "denomination_counts": [{"denomination_minor": 100, "quantity": 860}],
                    "notes": "Sobrante de 10 pesos dejado en caja",
                    "inventory_observations": [
                        {
                            "product_id": str(prod_b_id),
                            "physical_quantity": 11,
                            "reason": "1 empaque roto descartado",
                        }
                    ],
                },
            )
            assert res_open2.status_code == 201, res_open2.text
            shift2_data = res_open2.json()
            shift2_id = shift2_data["id"]
            assert shift2_data["opening_cash_minor"] == 86000
            assert shift2_data["expected_opening_cash_minor"] == 85000
            assert shift2_data["opening_difference_minor"] == 1000

            # DB verification:
            # - Creates StockMovement(kind='open_out', quantity=1) in DB adjusting on-hand stock automatically
            # - Links overtime order (cash_included_in_opening=True)
            with factory() as session:
                s2_db = session.get(Shift, UUID(shift2_id))
                assert s2_db.opening_cash_minor == 86000

                ot_order_linked = session.get(Order, overtime_order_id)
                assert ot_order_linked.financial_shift_id == UUID(shift2_id)
                assert ot_order_linked.cash_included_in_opening is True

                open_out_mv = session.scalars(
                    select(StockMovement).where(
                        StockMovement.product_id == prod_b_id,
                        StockMovement.kind == "open_out",
                    )
                ).all()
                assert len(open_out_mv) == 1
                assert open_out_mv[0].quantity == 1
                assert open_out_mv[0].reason == "1 empaque roto descartado"

                # On-hand stock automatically adjusted from 12 down to 11
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=prod_b_id) == 11

                # ShiftInventoryObservation persisted
                obs = session.scalars(
                    select(ShiftInventoryObservation).where(ShiftInventoryObservation.reason.is_not(None))
                ).all()
                assert any(o.physical_quantity == 11 and o.reason == "1 empaque roto descartado" for o in obs)

            # Verification that overtime cash is NOT double-counted:
            # current_expected_cash_minor is exactly opening_cash_minor (86000), NOT 86000 + 5000
            res_curr2 = client.get(f"/api/v1/shifts/current?register_id={reg_id}", headers=recep_headers)
            assert res_curr2.status_code == 200
            assert res_curr2.json()["current_expected_cash_minor"] == 86000

            # Owner overview surfaces both the shift discrepancy and the inventory count discrepancy
            res_overview2 = client.get(f"/api/v1/owner/overview?branch_id={branch_id}", headers=admin_headers)
            assert res_overview2.status_code == 200
            overview2_data = res_overview2.json()

            # Shift discrepancy from Shift 1 (-5000)
            shift_discrepancies = overview2_data["finances"]["shift_discrepancies"]
            assert any(item["shift_id"] == shift1_id and item["difference_minor"] == -5000 for item in shift_discrepancies)

            # Inventory count discrepancy from Shift 2 (expected 12, physical 11)
            count_discrepancies = overview2_data["finances"]["count_discrepancies"]
            assert any(
                item["shift_id"] == shift2_id
                and item["product"] == "Product B Protein Bar"
                and item["expected_quantity"] == 12
                and item["physical_quantity"] == 11
                for item in count_discrepancies
            )
    finally:
        engine.dispose()
