"""Mercado Pago Point mock must never be reachable outside development/test."""
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from pydantic import SecretStr

from app.main import create_app
from app.sales.point import (
    MercadoPagoPointHttpClient,
    MockPointTerminalClient,
    PointTerminalUnavailable,
    get_point_client,
)
from app.settings import Settings
from app.shifts.queries import create_cash_register, create_payment_terminal
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db


def _settings(environment, **extra):
    return Settings(database_url=SecretStr("sqlite+pysqlite:///:memory:"), environment=environment, **extra)


@pytest.mark.parametrize("environment", ["development", "test"])
def test_mock_allowed_in_dev_and_test(environment):
    settings = _settings(environment)
    assert settings.point_mock_allowed is True
    assert isinstance(get_point_client(settings), MockPointTerminalClient)


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_mock_refused_outside_dev_and_test(environment):
    settings = _settings(environment)
    assert settings.point_mock_allowed is False
    with pytest.raises(PointTerminalUnavailable):
        get_point_client(settings)
    configured = _settings(environment, mercado_pago_access_token=SecretStr("APP_USR-token"))
    assert isinstance(get_point_client(configured), MercadoPagoPointHttpClient)


def test_missing_settings_never_yield_mock():
    with pytest.raises(PointTerminalUnavailable):
        get_point_client(None)


@pytest.mark.parametrize("environment", ["staging", "production"])
@pytest.mark.parametrize("with_terminal", [True, False])
def test_point_endpoints_return_503_without_terminal_config(tmp_path, environment, with_terminal):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "front", "Front")
            if with_terminal:
                terminal = create_payment_terminal(session, branch_id, "T01", "Terminal 01", "DEV-POS-01")
                register.default_terminal_id = terminal.id
            register_id = register.id
        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "k-1"}
        app = create_app(configured_settings(url))
        app.state.settings = app.state.settings.model_copy(update={"environment": environment})
        sale = {"member_id": None, "items": [{"product_id": str(uuid4()), "quantity": 1}], "expected_total_minor": 1000, "card_intent_id": "x"}
        with TestClient(app) as client:
            base = f"/api/v1/registers/{register_id}"
            responses = [
                client.post(f"{base}/card-intent", headers=headers, json={"amount_minor": 1000, "external_reference": "r"}),
                client.get(f"{base}/card-intent/abc", headers=headers),
                client.delete(f"{base}/card-intent/abc", headers=headers),
                client.post(f"{base}/product-sales/card", headers=headers, json=sale),
            ]
        for res in responses:
            assert res.status_code == 503, res.text
        with factory() as session:
            from sqlalchemy import func, select
            from app.db.models import PaymentTerminal
            expected = 1 if with_terminal else 0
            assert session.scalar(select(func.count()).select_from(PaymentTerminal)) == expected
    finally:
        engine.dispose()
