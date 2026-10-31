from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select

from app.db.models import (
    Branch, CashRegister, Member, Order, OrderItem, Payment, Product,
    ProductRefund, StockInitialization, StockMovement,
)
from app.inventory.queries import get_on_hand_stock
from app.main import create_app
from app.shifts.queries import create_cash_register, expected_cash_for_shift
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift, close_shift


def _seed_products_and_member(session, branch_id, staff_id):
    member = Member(member_number=f"SOC-{uuid4().hex[:6]}", full_name="Eligible Client", phone="5550123")
    product1 = Product(code="water", name="Water 500ml", price_minor=1200, created_by=staff_id)
    product2 = Product(code="bar", name="Protein Bar", price_minor=800, created_by=staff_id)
    session.add_all([member, product1, product2])
    session.flush()
    for product in (product1, product2):
        session.add(StockInitialization(branch_id=branch_id, product_id=product.id, quantity=5, initialized_by=staff_id))
    session.flush()
    return member, product1, product2


def test_product_return_happy_path_restock_and_replay(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-returns", "Returns Register")
            shift = open_shift(
                session, register_id=register.id, opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 2}]
            )
            member, product1, product2 = _seed_products_and_member(session, branch_id, staff_id)
            register_id = register.id
            shift_id = shift.id
            member_id = member.id
            p1_id = str(product1.id)

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-1"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            # 1. Sale: 2 units of water (total 2400)
            sale_payload = {
                "member_id": str(member_id),
                "items": [{"product_id": p1_id, "quantity": 2}],
                "expected_total_minor": 2400,
            }
            client.post(f"/api/v1/registers/{register_id}/product-sale-intent", headers=headers, json=sale_payload)
            sale_res = client.post(f"/api/v1/registers/{register_id}/product-sales", headers=headers, json=sale_payload)
            assert sale_res.status_code == 201
            order_item_id = sale_res.json()["items"][0]["id"]

            with factory.begin() as session:
                shift = session.get(type(shift), shift_id)
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=UUID(p1_id)) == 3
                assert expected_cash_for_shift(session, shift) == 200 + 2400

            # 2. Check eligible returns endpoint
            get_res = client.get(
                f"/api/v1/registers/{register_id}/members/{member_id}/eligible-product-returns",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert get_res.status_code == 200
            eligible_items = get_res.json()
            assert len(eligible_items) == 1
            assert eligible_items[0]["order_item_id"] == order_item_id
            assert eligible_items[0]["quantity"] == 2
            assert eligible_items[0]["line_total_minor"] == 2400
            assert eligible_items[0]["original_payment_method"] == "cash"

            # 3. Submit return with restock and cash payout
            return_payload = {
                "order_item_id": order_item_id,
                "reason": "Cliente cambió de opinión",
                "disposition": "restock",
                "payout_method": "cash",
            }
            return_headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "return-1"}
            post_return_res = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers=return_headers,
                json=return_payload,
            )
            assert post_return_res.status_code == 201, post_return_res.text
            refund_dto = post_return_res.json()
            assert refund_dto["order_item_id"] == order_item_id
            assert refund_dto["disposition"] == "restock"
            assert refund_dto["payout_method"] == "cash"
            assert refund_dto["amount_minor"] == 2400
            assert refund_dto["quantity"] == 2

            # 4. Idempotent replay with same key
            replay_res = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers=return_headers,
                json=return_payload,
            )
            assert replay_res.status_code == 200
            assert replay_res.json() == refund_dto

            # 5. Check stock restored and shift cash reduced
            with factory.begin() as session:
                shift = session.get(type(shift), shift_id)
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=UUID(p1_id)) == 5
                assert expected_cash_for_shift(session, shift) == 200

                # Check movement record
                mov = session.scalar(
                    select(StockMovement).where(StockMovement.idempotency_key == f"return:{refund_dto['id']}")
                )
                assert mov is not None
                assert mov.kind == "return"
                assert mov.quantity == 2
                assert mov.reason == "Return: Cliente cambió de opinión"

            # 6. Eligible returns now empty for this item
            get_res2 = client.get(
                f"/api/v1/registers/{register_id}/members/{member_id}/eligible-product-returns",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert get_res2.status_code == 200
            assert get_res2.json() == []
    finally:
        engine.dispose()


def test_product_return_happy_path_waste_and_card_payout(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-waste", "Waste Register")
            shift = open_shift(
                session, register_id=register.id, opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 1}]
            )
            member, product1, _ = _seed_products_and_member(session, branch_id, staff_id)
            register_id = register.id
            shift_id = shift.id
            member_id = member.id
            p1_id = str(product1.id)

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-waste"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            sale_payload = {
                "member_id": str(member_id),
                "items": [{"product_id": p1_id, "quantity": 1}],
                "expected_total_minor": 1200,
            }
            client.post(f"/api/v1/registers/{register_id}/product-sale-intent", headers=headers, json=sale_payload)
            sale_res = client.post(f"/api/v1/registers/{register_id}/product-sales", headers=headers, json=sale_payload)
            assert sale_res.status_code == 201
            order_item_id = sale_res.json()["items"][0]["id"]

            # Return with waste and card payout
            return_payload = {
                "order_item_id": order_item_id,
                "reason": "Empaque roto y producto contaminado",
                "disposition": "waste",
                "payout_method": "card",
            }
            return_headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "return-waste"}
            post_return_res = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers=return_headers,
                json=return_payload,
            )
            assert post_return_res.status_code == 201
            refund_dto = post_return_res.json()
            assert refund_dto["disposition"] == "waste"
            assert refund_dto["payout_method"] == "card"

            with factory.begin() as session:
                shift = session.get(type(shift), shift_id)
                # Stock should NOT be returned into available stock
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=UUID(p1_id)) == 3
                # Card payout does NOT reduce cash expected closing cash
                assert expected_cash_for_shift(session, shift) == 100 + 1200

                # Check waste movement record
                mov = session.scalar(
                    select(StockMovement).where(StockMovement.idempotency_key == f"return:{refund_dto['id']}")
                )
                assert mov is not None
                assert mov.kind == "waste"
                assert mov.quantity == 1
                assert mov.reason == "Return waste: Empaque roto y producto contaminado"
    finally:
        engine.dispose()


def test_unassigned_sale_cannot_be_returned(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-unassigned", "Unassigned Register")
            open_shift(
                session, register_id=register.id, opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 1}]
            )
            _, product1, _ = _seed_products_and_member(session, branch_id, staff_id)
            register_id = register.id
            p1_id = str(product1.id)

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-anon"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            sale_payload = {
                "member_id": None,
                "items": [{"product_id": p1_id, "quantity": 1}],
                "expected_total_minor": 1200,
            }
            client.post(f"/api/v1/registers/{register_id}/product-sale-intent", headers=headers, json=sale_payload)
            sale_res = client.post(f"/api/v1/registers/{register_id}/product-sales", headers=headers, json=sale_payload)
            assert sale_res.status_code == 201
            order_item_id = sale_res.json()["items"][0]["id"]

            return_payload = {
                "order_item_id": order_item_id,
                "reason": "Intento de devolución sin socio",
                "disposition": "restock",
                "payout_method": "cash",
            }
            res = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "ret-anon"},
                json=return_payload,
            )
            assert res.status_code == 409
            assert "Unassigned sales cannot be returned" in res.text
    finally:
        engine.dispose()


def test_cross_branch_return_rejected(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch1_id = _seed_branch(factory, code="b1", name="Branch 1")
        branch2_id = _seed_branch(factory, code="b2", name="Branch 2")
        staff_id, token = _seed_receptionist(factory, branch1_id)
        # Give receptionist role on branch 2 as well
        with factory.begin() as session:
            reg1 = create_cash_register(session, branch1_id, "reg-b1", "B1 Register")
            reg2 = create_cash_register(session, branch2_id, "reg-b2", "B2 Register")
            open_shift(session, register_id=reg1.id, opened_by=staff_id, denomination_counts=[{"denomination_minor": 100, "quantity": 1}])
            open_shift(session, register_id=reg2.id, opened_by=staff_id, denomination_counts=[{"denomination_minor": 100, "quantity": 1}])
            member, product1, _ = _seed_products_and_member(session, branch1_id, staff_id)
            reg1_id = reg1.id
            reg2_id = reg2.id
            p1_id = str(product1.id)
            member_id = member.id

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-b1"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            sale_payload = {
                "member_id": str(member_id),
                "items": [{"product_id": p1_id, "quantity": 1}],
                "expected_total_minor": 1200,
            }
            client.post(f"/api/v1/registers/{reg1_id}/product-sale-intent", headers=headers, json=sale_payload)
            sale_res = client.post(f"/api/v1/registers/{reg1_id}/product-sales", headers=headers, json=sale_payload)
            assert sale_res.status_code == 201
            order_item_id = sale_res.json()["items"][0]["id"]

            # Attempt return at branch 2 register
            return_payload = {
                "order_item_id": order_item_id,
                "reason": "Devolución en otra sucursal",
                "disposition": "restock",
                "payout_method": "cash",
            }
            res = client.post(
                f"/api/v1/registers/{reg2_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "ret-cross"},
                json=return_payload,
            )
            # Fails with 403 or 409 cross-branch denial
            assert res.status_code in (403, 409)
    finally:
        engine.dispose()


def test_return_rejected_for_sale_from_previous_day(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-yesterday", "Yesterday Register")
            open_shift(session, register_id=register.id, opened_by=staff_id, denomination_counts=[{"denomination_minor": 100, "quantity": 1}])
            member, product1, _ = _seed_products_and_member(session, branch_id, staff_id)
            register_id = register.id
            member_id = member.id
            p1_id = str(product1.id)

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-yest"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            sale_payload = {
                "member_id": str(member_id),
                "items": [{"product_id": p1_id, "quantity": 1}],
                "expected_total_minor": 1200,
            }
            client.post(f"/api/v1/registers/{register_id}/product-sale-intent", headers=headers, json=sale_payload)
            sale_res = client.post(f"/api/v1/registers/{register_id}/product-sales", headers=headers, json=sale_payload)
            assert sale_res.status_code == 201
            order_id = UUID(sale_res.json()["order"]["id"])
            order_item_id = sale_res.json()["items"][0]["id"]

            # Artificially shift order created_at to 2 days ago
            with factory.begin() as session:
                order = session.get(Order, order_id)
                order.created_at = datetime.now(timezone.utc) - timedelta(days=2)

            # Eligible returns should be empty
            get_res = client.get(
                f"/api/v1/registers/{register_id}/members/{member_id}/eligible-product-returns",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert get_res.status_code == 200
            assert get_res.json() == []

            # Post return directly -> 409 rejected
            return_payload = {
                "order_item_id": order_item_id,
                "reason": "Devolución tardía",
                "disposition": "restock",
                "payout_method": "cash",
            }
            res = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "ret-yest"},
                json=return_payload,
            )
            assert res.status_code == 409
            assert "same calendar day" in res.text
    finally:
        engine.dispose()


def test_cannot_return_same_item_twice_or_conflict_idempotency(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-twice", "Twice Register")
            open_shift(session, register_id=register.id, opened_by=staff_id, denomination_counts=[{"denomination_minor": 100, "quantity": 1}])
            member, product1, _ = _seed_products_and_member(session, branch_id, staff_id)
            register_id = register.id
            member_id = member.id
            p1_id = str(product1.id)

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-twice"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            sale_payload = {
                "member_id": str(member_id),
                "items": [{"product_id": p1_id, "quantity": 1}],
                "expected_total_minor": 1200,
            }
            client.post(f"/api/v1/registers/{register_id}/product-sale-intent", headers=headers, json=sale_payload)
            sale_res = client.post(f"/api/v1/registers/{register_id}/product-sales", headers=headers, json=sale_payload)
            order_item_id = sale_res.json()["items"][0]["id"]

            return_payload = {
                "order_item_id": order_item_id,
                "reason": "Primera devolución",
                "disposition": "restock",
                "payout_method": "cash",
            }
            res1 = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "ret-key-1"},
                json=return_payload,
            )
            assert res1.status_code == 201

            # 1. Attempt to return same item with different idempotency key
            res2 = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "ret-key-2"},
                json=return_payload,
            )
            assert res2.status_code == 409
            assert "already been returned" in res2.text

            # 2. Replay with same key but different reason -> conflict
            res3 = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "ret-key-1"},
                json={**return_payload, "reason": "Motivo alterado"},
            )
            assert res3.status_code == 409
            assert res3.json()["error"]["code"] == "idempotency_conflict"
    finally:
        engine.dispose()


def test_overtime_return_without_open_shift(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-ot", "OT Register")
            shift = open_shift(session, register_id=register.id, opened_by=staff_id, denomination_counts=[{"denomination_minor": 100, "quantity": 1}])
            member, product1, _ = _seed_products_and_member(session, branch_id, staff_id)
            register_id = register.id
            member_id = member.id
            p1_id = str(product1.id)
            shift_id = shift.id

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-ot"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            sale_payload = {
                "member_id": str(member_id),
                "items": [{"product_id": p1_id, "quantity": 1}],
                "expected_total_minor": 1200,
            }
            client.post(f"/api/v1/registers/{register_id}/product-sale-intent", headers=headers, json=sale_payload)
            sale_res = client.post(f"/api/v1/registers/{register_id}/product-sales", headers=headers, json=sale_payload)
            order_item_id = sale_res.json()["items"][0]["id"]

            # Now close the shift
            with factory.begin() as session:
                shift = session.get(type(shift), shift_id)
                close_shift(session, shift_id=shift_id, closed_by=staff_id, denomination_counts=[{"denomination_minor": 100, "quantity": 13}])

            # Post return during overtime (no open shift)
            return_payload = {
                "order_item_id": order_item_id,
                "reason": "Devolución horas extra",
                "disposition": "restock",
                "payout_method": "cash",
            }
            res = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "ret-ot"},
                json=return_payload,
            )
            assert res.status_code == 201
            dto = res.json()
            assert dto["financial_shift_id"] is None
            assert dto["shift_id"] == str(shift_id)
    finally:
        engine.dispose()


def test_return_rejected_when_no_shifts_ever_opened(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            reg_active = create_cash_register(session, branch_id, "reg-act", "Act Register")
            reg_noshift = create_cash_register(session, branch_id, "reg-no", "No Shift Register")
            open_shift(session, register_id=reg_active.id, opened_by=staff_id, denomination_counts=[{"denomination_minor": 100, "quantity": 1}])
            member, product1, _ = _seed_products_and_member(session, branch_id, staff_id)
            reg_act_id = reg_active.id
            reg_no_id = reg_noshift.id
            p1_id = str(product1.id)
            member_id = member.id

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-noshift"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            sale_payload = {
                "member_id": str(member_id),
                "items": [{"product_id": p1_id, "quantity": 1}],
                "expected_total_minor": 1200,
            }
            client.post(f"/api/v1/registers/{reg_act_id}/product-sale-intent", headers=headers, json=sale_payload)
            sale_res = client.post(f"/api/v1/registers/{reg_act_id}/product-sales", headers=headers, json=sale_payload)
            order_item_id = sale_res.json()["items"][0]["id"]

            return_payload = {
                "order_item_id": order_item_id,
                "reason": "Sin turno previo",
                "disposition": "restock",
                "payout_method": "cash",
            }
            res = client.post(
                f"/api/v1/registers/{reg_no_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "ret-noshift"},
                json=return_payload,
            )
            assert res.status_code == 409
            assert "Open the first shift" in res.text
    finally:
        engine.dispose()
