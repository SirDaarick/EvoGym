"""Comprehensive unit and integration tests for Card Payment with Mercado Pago Point (D08)."""
import json
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.db.models import Member, Order, OrderItem, Payment, PaymentTerminal, Product, ProductRefund, StockInitialization, StockMovement
from app.inventory.queries import get_on_hand_stock
from app.main import create_app
from app.sales.point import (
    MercadoPagoPointHttpClient,
    MockPointTerminalClient,
    PointPaymentIntentDTO,
    get_mock_point_client,
    get_point_client,
)
from app.sales.queries import post_card_product_sale
from app.sales.schemas import ProductCartLineRequest
from app.settings import Settings
from app.shifts.queries import create_cash_register, create_payment_terminal
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_mock_point_terminal_client_lifecycle():
    client = MockPointTerminalClient()
    client.reset()

    # 1. Create intent -> ON_TERMINAL
    intent = client.create_payment_intent(device_id="DEV_123", amount_minor=2500, external_reference="ref-1")
    assert intent.device_id == "DEV_123"
    assert intent.amount_minor == 2500
    assert intent.status == "ON_TERMINAL"
    assert intent.authorization_code is None

    # 2. Query status -> transitions to PROCESSED
    processed = client.get_payment_intent_status(device_id="DEV_123", payment_intent_id=intent.id)
    assert processed.status == "PROCESSED"
    assert processed.authorization_code == "AUTH-841203"
    assert processed.card_brand == "VISA"
    assert processed.last_four_digits == "4242"

    # 3. Create another intent and cancel it
    intent2 = client.create_payment_intent(device_id="DEV_123", amount_minor=1000, external_reference="ref-2")
    cancelled = client.cancel_payment_intent(device_id="DEV_123", payment_intent_id=intent2.id)
    assert cancelled is True

    # 4. Inactive intent cancel returns False
    assert client.cancel_payment_intent(device_id="DEV_123", payment_intent_id="unknown") is False

    # 5. Non-existent intent raises ValueError on status
    with pytest.raises(ValueError):
        client.get_payment_intent_status("DEV_123", "nonexistent")


def test_point_client_factory_resolution():
    # Unset token -> MockPointTerminalClient
    settings_mock = Settings(
        database_url=SecretStr("sqlite+pysqlite:///:memory:"),
        environment="test",
    )
    client_mock = get_point_client(settings_mock)
    assert isinstance(client_mock, MockPointTerminalClient)

    # Configured token -> MercadoPagoPointHttpClient
    settings_mp = Settings(
        database_url=SecretStr("sqlite+pysqlite:///:memory:"),
        environment="test",
        mercado_pago_access_token=SecretStr("APP_USR-test-token-12345"),
    )
    client_mp = get_point_client(settings_mp)
    assert isinstance(client_mp, MercadoPagoPointHttpClient)
    assert client_mp.access_token == "APP_USR-test-token-12345"


def test_mercadopago_http_client_operations():
    client = MercadoPagoPointHttpClient(access_token="TEST_TOKEN")

    # Test create_payment_intent
    mock_resp_create = MagicMock()
    mock_resp_create.read.return_value = json.dumps({"id": "mp-intent-001", "status": "OPEN", "amount": 15.00}).encode("utf-8")
    mock_resp_create.__enter__.return_value = mock_resp_create

    with patch("urllib.request.urlopen", return_value=mock_resp_create) as mock_urlopen:
        dto = client.create_payment_intent(device_id="DEVICE_01", amount_minor=1500, external_reference="ref-abc")
        assert dto.id == "mp-intent-001"
        assert dto.status == "OPEN"
        assert dto.amount_minor == 1500
        mock_urlopen.assert_called_once()

    # Test get_payment_intent_status
    mock_resp_status = MagicMock()
    mock_resp_status.read.return_value = json.dumps({
        "id": "mp-intent-001",
        "status": "PROCESSED",
        "amount": 15.00,
        "payment": {
            "authorization_code": "MP-AUTH-999",
            "card": {"brand": "MASTERCARD", "last_four_digits": "1111"},
        },
    }).encode("utf-8")
    mock_resp_status.__enter__.return_value = mock_resp_status

    with patch("urllib.request.urlopen", return_value=mock_resp_status):
        status_dto = client.get_payment_intent_status(device_id="DEVICE_01", payment_intent_id="mp-intent-001")
        assert status_dto.status == "PROCESSED"
        assert status_dto.authorization_code == "MP-AUTH-999"
        assert status_dto.card_brand == "MASTERCARD"
        assert status_dto.last_four_digits == "1111"

    # Test cancel_payment_intent
    mock_resp_del = MagicMock()
    mock_resp_del.status = 200
    mock_resp_del.__enter__.return_value = mock_resp_del

    with patch("urllib.request.urlopen", return_value=mock_resp_del):
        assert client.cancel_payment_intent("DEVICE_01", "mp-intent-001") is True

    # Test get_account_info
    mock_resp_user = MagicMock()
    mock_resp_user.read.return_value = json.dumps({"id": 12345, "nickname": "GYM_OWNER", "email": "gym@example.com", "site_id": "MLM"}).encode("utf-8")
    mock_resp_user.__enter__.return_value = mock_resp_user

    with patch("urllib.request.urlopen", return_value=mock_resp_user):
        account = client.get_account_info()
        assert account["id"] == 12345
        assert account["nickname"] == "GYM_OWNER"
        assert account["site_id"] == "MLM"

    # Test list_devices
    mock_resp_devices = MagicMock()
    mock_resp_devices.read.return_value = json.dumps({"devices": [{"id": "POINT_SMART_01", "operating_mode": "PDV"}]}).encode("utf-8")
    mock_resp_devices.__enter__.return_value = mock_resp_devices

    with patch("urllib.request.urlopen", return_value=mock_resp_devices):
        devices = client.list_devices()
        assert len(devices) == 1
        assert devices[0]["id"] == "POINT_SMART_01"
        assert devices[0]["operating_mode"] == "PDV"


def test_card_intent_endpoints(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "front", "Front")
            terminal = create_payment_terminal(session, branch_id, "T01", "Terminal 01", "DEV-POS-01")
            register.default_terminal_id = terminal.id
            register_id = register.id

        headers = {"Authorization": f"Bearer {token}"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            # 1. Create card intent
            res_create = client.post(
                f"/api/v1/registers/{register_id}/card-intent",
                headers=headers,
                json={"amount_minor": 4500, "external_reference": "ref-unit-1"},
            )
            assert res_create.status_code == 201, res_create.text
            intent_data = res_create.json()
            intent_id = intent_data["payment_intent_id"]
            assert intent_data["amount_minor"] == 4500
            assert intent_data["device_id"] == "DEV-POS-01"

            # 2. Get card intent status
            res_status = client.get(
                f"/api/v1/registers/{register_id}/card-intent/{intent_id}",
                headers=headers,
            )
            assert res_status.status_code == 200
            assert res_status.json()["status"] == "PROCESSED"
            assert res_status.json()["authorization_code"] == "AUTH-841203"
            assert res_status.json()["card_brand"] == "VISA"
            assert res_status.json()["last_four_digits"] == "4242"

            # 3. Create another intent to cancel
            res_create2 = client.post(
                f"/api/v1/registers/{register_id}/card-intent",
                headers=headers,
                json={"amount_minor": 1200, "external_reference": "ref-unit-2"},
            )
            intent_id2 = res_create2.json()["payment_intent_id"]

            res_cancel = client.delete(
                f"/api/v1/registers/{register_id}/card-intent/{intent_id2}",
                headers=headers,
            )
            assert res_cancel.status_code == 200
            assert res_cancel.json()["cancelled"] is True

            # 4. Unknown register returns 404
            res_bad_reg = client.post(
                f"/api/v1/registers/{uuid4()}/card-intent",
                headers=headers,
                json={"amount_minor": 1000, "external_reference": "ref-bad"},
            )
            assert res_bad_reg.status_code == 404
    finally:
        engine.dispose()


def test_card_product_sale_atomic_and_replayable(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "pos", "POS")
            shift = open_shift(
                session,
                register_id=register.id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            shift_id = shift.id
            p1 = Product(code="towel", name="Gym Towel", price_minor=2000, created_by=staff_id)
            p2 = Product(code="protein", name="Protein Shake", price_minor=3500, created_by=staff_id)
            session.add_all([p1, p2])
            session.flush()
            session.add(StockInitialization(branch_id=branch_id, product_id=p1.id, quantity=10, initialized_by=staff_id))
            session.add(StockInitialization(branch_id=branch_id, product_id=p2.id, quantity=10, initialized_by=staff_id))
            register_id = register.id
            p1_id, p2_id = str(p1.id), str(p2.id)

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "card-cart-1"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            # 1. Create intent for total 2000*2 + 3500*1 = 7500
            total_minor = 7500
            res_intent = client.post(
                f"/api/v1/registers/{register_id}/card-intent",
                headers=headers,
                json={"amount_minor": total_minor, "external_reference": "card-sale-1"},
            )
            assert res_intent.status_code == 201
            card_intent_id = res_intent.json()["payment_intent_id"]

            sale_payload = {
                "member_id": None,
                "items": [
                    {"product_id": p1_id, "quantity": 2},
                    {"product_id": p2_id, "quantity": 1},
                ],
                "expected_total_minor": total_minor,
                "card_intent_id": card_intent_id,
            }

            # 2. Submit card sale
            res_sale = client.post(
                f"/api/v1/registers/{register_id}/product-sales/card",
                headers=headers,
                json=sale_payload,
            )
            assert res_sale.status_code == 201, res_sale.text
            sale_data = res_sale.json()
            assert sale_data["order"]["total_minor"] == total_minor
            assert sale_data["payment"]["method"] == "card"
            assert sale_data["payment"]["status"] == "confirmed"
            assert sale_data["payment"]["amount_minor"] == total_minor
            assert sale_data["payment"]["card_brand"] == "VISA"
            assert sale_data["payment"]["card_last_four"] == "4242"
            assert sale_data["payment"]["authorization_code"] == "AUTH-841203"

            # 3. Idempotent replay with status 200
            res_replay = client.post(
                f"/api/v1/registers/{register_id}/product-sales/card",
                headers=headers,
                json=sale_payload,
            )
            assert res_replay.status_code == 200
            assert res_replay.json() == sale_data

            # 4. Check stock decremented
            with factory() as session:
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=UUID(p1_id)) == 8
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=UUID(p2_id)) == 9
                assert session.scalar(select(func.count()).select_from(Order)) == 1
                assert session.scalar(select(func.count()).select_from(OrderItem)) == 2
                assert session.scalar(select(func.count()).select_from(Payment)) == 1

            # 5. Shift summary reflects card payment in confirmed_minor but NOT in cash
            res_summary = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers)
            assert res_summary.status_code == 200
            summary = res_summary.json()
            assert summary["confirmed_minor"] == 7500
            assert summary["confirmed_cash_minor"] == 0  # Card does not affect physical drawer cash!
            assert any(m["method"] == "card" and m["amount_minor"] == 7500 for m in summary["payment_methods"])
    finally:
        engine.dispose()


def test_card_product_sale_mismatches_and_rejections(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "pos", "POS")
            shift = open_shift(
                session,
                register_id=register.id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            p = Product(code="bar", name="Energy Bar", price_minor=500, created_by=staff_id)
            session.add(p)
            session.flush()
            session.add(StockInitialization(branch_id=branch_id, product_id=p.id, quantity=3, initialized_by=staff_id))
            register_id = register.id
            p_id = str(p.id)

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "card-reject-1"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            # 1. Create intent for 1000
            res_intent = client.post(
                f"/api/v1/registers/{register_id}/card-intent",
                headers=headers,
                json={"amount_minor": 1000, "external_reference": "ref-mismatch"},
            )
            intent_id = res_intent.json()["payment_intent_id"]

            # Cart expected total 500 does not match intent 1000 -> 409
            mismatch_payload = {
                "member_id": None,
                "items": [{"product_id": p_id, "quantity": 1}],
                "expected_total_minor": 500,
                "card_intent_id": intent_id,
            }
            res_mismatch = client.post(
                f"/api/v1/registers/{register_id}/product-sales/card",
                headers=headers,
                json=mismatch_payload,
            )
            assert res_mismatch.status_code == 409

            # 2. Cancel a fresh intent, then attempt sale -> rejected with 409
            res_intent_to_cancel = client.post(
                f"/api/v1/registers/{register_id}/card-intent",
                headers=headers,
                json={"amount_minor": 1000, "external_reference": "ref-cancel"},
            )
            cancel_intent_id = res_intent_to_cancel.json()["payment_intent_id"]
            client.delete(f"/api/v1/registers/{register_id}/card-intent/{cancel_intent_id}", headers=headers)
            res_cancelled = client.post(
                f"/api/v1/registers/{register_id}/product-sales/card",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "card-reject-cancel"},
                json={
                    "member_id": None,
                    "items": [{"product_id": p_id, "quantity": 2}],
                    "expected_total_minor": 1000,
                    "card_intent_id": cancel_intent_id,
                },
            )
            assert res_cancelled.status_code == 409

            # 3. Insufficient stock
            res_intent_large = client.post(
                f"/api/v1/registers/{register_id}/card-intent",
                headers=headers,
                json={"amount_minor": 5000, "external_reference": "ref-stock"},
            )
            large_intent_id = res_intent_large.json()["payment_intent_id"]
            res_stock = client.post(
                f"/api/v1/registers/{register_id}/product-sales/card",
                headers=headers,
                json={
                    "member_id": None,
                    "items": [{"product_id": p_id, "quantity": 10}],
                    "expected_total_minor": 5000,
                    "card_intent_id": large_intent_id,
                },
            )
            assert res_stock.status_code == 409
    finally:
        engine.dispose()


def test_card_product_sale_eligible_for_return(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            member = Member(
                member_number=f"SOC-{uuid4().hex[:6]}",
                full_name="Carlos Cardona",
                phone="5551234567",
            )
            session.add(member)
            session.flush()
            member_id = member.id
            register = create_cash_register(session, branch_id, "pos", "POS")
            shift = open_shift(
                session,
                register_id=register.id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            p = Product(code="mat", name="Yoga Mat", price_minor=3000, created_by=staff_id)
            session.add(p)
            session.flush()
            session.add(StockInitialization(branch_id=branch_id, product_id=p.id, quantity=5, initialized_by=staff_id))
            register_id = register.id
            product_id = p.id

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "card-return-1"}
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            # 1. Create card intent
            intent = client.post(
                f"/api/v1/registers/{register_id}/card-intent",
                headers=headers,
                json={"amount_minor": 3000, "external_reference": "ref-ret"},
            ).json()

            # 2. Make card sale to member
            sale = client.post(
                f"/api/v1/registers/{register_id}/product-sales/card",
                headers=headers,
                json={
                    "member_id": str(member_id),
                    "items": [{"product_id": str(product_id), "quantity": 1}],
                    "expected_total_minor": 3000,
                    "card_intent_id": intent["payment_intent_id"],
                },
            )
            assert sale.status_code == 201

            # 3. Check eligible returns for member
            res_eligible = client.get(
                f"/api/v1/registers/{register_id}/members/{member_id}/eligible-product-returns",
                headers=headers,
            )
            assert res_eligible.status_code == 200
            eligible_items = res_eligible.json()
            assert len(eligible_items) == 1
            assert eligible_items[0]["product_id"] == str(product_id)
            assert eligible_items[0]["original_payment_method"] == "card"

            # 4. Process refund payout
            order_item_id = eligible_items[0]["order_item_id"]
            res_refund = client.post(
                f"/api/v1/registers/{register_id}/product-returns",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "refund-card-1"},
                json={
                    "order_item_id": order_item_id,
                    "reason": "Customer returned unopened mat",
                    "disposition": "restock",
                    "payout_method": "card",
                },
            )
            assert res_refund.status_code == 201
            assert res_refund.json()["amount_minor"] == 3000
            assert res_refund.json()["payout_method"] == "card"
    finally:
        engine.dispose()
