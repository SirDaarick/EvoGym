"""Fault classification at the three Admin-to-staff bearer boundaries."""
import logging
from unittest.mock import MagicMock, Mock
from uuid import uuid4
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError, ProgrammingError, TimeoutError
from pydantic import SecretStr

from app.api import catalog, members, shifts
from app.api import (
    admin_enrollment, device_pairing, inventory, membership_access,
    pending_money, staff_roster, staff_schedules,
)
from app.auth.authorization import AuthorizationDenied
from app.auth.sessions import SessionPrincipal, revoke_session
from app.main import create_app
from app.settings import Settings
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin
from test_members import _seed_branch, _seed_receptionist, _setup_db


ENDPOINTS = [
    pytest.param(members, "/api/v1/members", id="members"),
    pytest.param(catalog, "/api/v1/catalog/plans", id="catalog"),
    pytest.param(shifts, "/api/v1/registers", id="registers"),
]
SECRET = "postgresql://private-user:private-password@private-host/private-db raw-token"
ADMIN_SIGNING_SECRET = "synthetic-test-signing-secret-at-least-32-bytes"


def _configured_admin_test_settings():
    return SimpleNamespace(
        admin_auth_configured=True,
        admin_token_signing_configured=True,
        admin_token_signing_secret=SecretStr(ADMIN_SIGNING_SECRET),
    )


def _failure(kind):
    if kind is TimeoutError:
        return TimeoutError(SECRET)
    if kind in {RuntimeError, ValueError}:
        return kind(SECRET)
    return kind("SELECT private_statement", {"password": "private-password"}, RuntimeError(SECRET))


def _assert_safe(response, expected_status, caplog):
    assert response.status_code == expected_status, response.text
    error = response.json()["error"]
    assert error["code"] == ("internal_error" if expected_status == 500 else "http_error")
    assert error["request_id"] == response.headers["x-request-id"]
    for secret in ("private-user", "private-password", "private-host", "private_statement", "raw-token"):
        assert secret not in response.text
        assert secret not in caplog.text


@pytest.mark.parametrize(("module", "path"), ENDPOINTS)
@pytest.mark.parametrize("stage", ["admin", "staff"])
@pytest.mark.parametrize("kind", [OperationalError, InterfaceError, TimeoutError])
def test_validator_storage_unavailability_is_503_without_auth_fallback(module, path, stage, kind, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="evogym.api")
    admin = Mock(side_effect=_failure(kind) if stage == "admin" else AuthorizationDenied("invalid"))
    staff = Mock(side_effect=_failure(kind) if stage == "staff" else AuthorizationDenied("invalid"))
    monkeypatch.setattr(module, "validate_admin_session", admin)
    monkeypatch.setattr(module, "validate_session", staff)
    with TestClient(create_app(Settings(environment="test", _env_file=None))) as client:
        client.app.state.settings = _configured_admin_test_settings()
        factory = Mock(name="must_not_open_a_database")
        client.app.state.session_factory = factory
        response = client.get(path, headers={"Authorization": "Bearer raw-token"})
    _assert_safe(response, 503, caplog)
    assert admin.call_count == 1
    assert staff.call_count == (1 if stage == "staff" else 0)
    factory.assert_not_called()
    factory.begin.assert_not_called()


@pytest.mark.parametrize(("module", "path"), ENDPOINTS)
@pytest.mark.parametrize("stage", ["admin", "staff"])
@pytest.mark.parametrize("kind", [RuntimeError, ValueError, ProgrammingError, IntegrityError])
def test_unexpected_validator_errors_are_500_and_never_select_another_authenticator(module, path, stage, kind, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="evogym.api")
    admin = Mock(side_effect=_failure(kind) if stage == "admin" else AuthorizationDenied("invalid"))
    staff = Mock(side_effect=_failure(kind) if stage == "staff" else AuthorizationDenied("invalid"))
    monkeypatch.setattr(module, "validate_admin_session", admin)
    monkeypatch.setattr(module, "validate_session", staff)
    with TestClient(create_app(Settings(environment="test", _env_file=None))) as client:
        client.app.state.settings = _configured_admin_test_settings()
        factory = Mock(name="must_not_open_a_database")
        client.app.state.session_factory = factory
        response = client.get(path, headers={"Authorization": "Bearer raw-token"})
    _assert_safe(response, 500, caplog)
    assert admin.call_count == 1
    assert staff.call_count == (1 if stage == "staff" else 0)
    factory.assert_not_called()


@pytest.mark.parametrize(("module", "path"), ENDPOINTS)
def test_expected_admin_credential_failure_allows_a_valid_staff_business_read(module, path, monkeypatch, tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    admin = Mock(side_effect=AuthorizationDenied("not an admin token"))
    staff = Mock(return_value=SessionPrincipal(uuid4(), uuid4()))
    monkeypatch.setattr(module, "validate_admin_session", admin)
    monkeypatch.setattr(module, "validate_session", staff)
    try:
        with TestClient(create_app(Settings(environment="test", _env_file=None))) as client:
            client.app.state.settings = _configured_admin_test_settings()
            client.app.state.session_factory = factory
            response = client.get(path, headers={"Authorization": "Bearer synthetic-staff-token"})
        assert response.status_code == 200, response.text
        assert response.json() == ({"items": [], "total": 0, "page": 1, "limit": 20, "pages": 1} if module is members else [])
        admin.assert_called_once_with(factory, "synthetic-staff-token", ADMIN_SIGNING_SECRET)
        staff.assert_called_once_with(factory, "synthetic-staff-token", module.Permission.MEMBER_OPERATIONAL_READ)
    finally:
        engine.dispose()


@pytest.mark.parametrize(("module", "path"), ENDPOINTS)
def test_real_invalid_and_revoked_tokens_remain_generic_401(module, path, tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="evogym.api")
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _, token = _seed_receptionist(factory, branch_id)
        assert revoke_session(factory, token)
        with TestClient(create_app(Settings(environment="test", _env_file=None))) as client:
            client.app.state.settings = _configured_admin_test_settings()
            client.app.state.session_factory = factory
            for rejected in ("raw-token", token):
                response = client.get(path, headers={"Authorization": f"Bearer {rejected}"})
                _assert_safe(response, 401, caplog)
                assert rejected not in response.text and rejected not in caplog.text
    finally:
        engine.dispose()


def test_real_signed_admin_token_authenticates_then_revocation_is_generic_401(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="evogym.api")
    url, engine, factory = _setup_db(tmp_path)
    seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    try:
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            login = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password").json()
            headers = {"Authorization": f"Bearer {login['access_token']}"}
            valid = client.get("/api/v1/members", headers=headers)
            assert valid.status_code == 200, valid.text

            invalid = client.get("/api/v1/members", headers={"Authorization": "Bearer raw-token"})
            _assert_safe(invalid, 401, caplog)

            sessions = client.get("/api/v1/admin/sessions", headers=headers)
            session_id = sessions.json()["sessions"][0]["id"]
            assert client.post(f"/api/v1/admin/sessions/{session_id}/revoke", headers=headers).json() == {"revoked": True}
            revoked = client.get("/api/v1/members", headers=headers)
            _assert_safe(revoked, 401, caplog)
    finally:
        engine.dispose()


ADMIN_CONSUMERS = [
    pytest.param(members, members.get_member_actor_principal, id="members"),
    pytest.param(catalog, catalog.get_catalog_actor_principal, id="catalog"),
    pytest.param(shifts, shifts.get_shift_actor_principal, id="shifts"),
    pytest.param(admin_enrollment, admin_enrollment._principal, id="admin-enrollment"),
    pytest.param(device_pairing, device_pairing._admin_principal, id="device-pairing"),
    pytest.param(inventory, inventory._admin, id="inventory"),
    pytest.param(membership_access, membership_access.record_access_decision, id="membership-access"),
    pytest.param(pending_money, pending_money._principal, id="pending-money"),
    pytest.param(staff_roster, staff_roster._principal, id="staff-roster"),
    pytest.param(staff_schedules, staff_schedules._principal, id="staff-schedules"),
]


@pytest.mark.parametrize(("module", "consumer"), ADMIN_CONSUMERS)
def test_configured_admin_secret_is_passed_to_every_consumer(module, consumer, monkeypatch):
    from fastapi import Request, Response
    from fastapi.security import HTTPAuthorizationCredentials
    from pydantic import SecretStr

    signing_secret = "synthetic-admin-signing-secret-that-is-long-enough"
    factory = MagicMock()
    staff_id, session_id = uuid4(), uuid4()
    app = SimpleNamespace(state=SimpleNamespace(
        settings=SimpleNamespace(
            admin_auth_configured=True,
            admin_token_signing_configured=True,
            admin_token_signing_secret=SecretStr(signing_secret),
        ),
        session_factory=factory,
    ))
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "app": app})
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="synthetic-admin-token")
    validator = Mock(return_value=(staff_id, session_id))
    monkeypatch.setattr(module, "validate_admin_session", validator)
    if consumer is membership_access.record_access_decision:
        factory.begin.return_value.__enter__.return_value.execute.return_value.one_or_none.return_value = None
        with pytest.raises(Exception) as error:
            consumer(uuid4(), membership_access.AccessDecisionRequest(action="restrict", reason="test"), request,
                     Response(), idempotency_key="synthetic-key", credentials=credentials)
        assert getattr(error.value, "status_code", None) == 404
    else:
        consumer(request, credentials)
    validator.assert_called_once_with(factory, "synthetic-admin-token", signing_secret)


MIXED_CONSUMERS = [
    pytest.param(members, members.get_member_actor_principal, id="members"),
    pytest.param(catalog, catalog.get_catalog_actor_principal, id="catalog"),
    pytest.param(shifts, shifts.get_shift_actor_principal, id="shifts"),
    pytest.param(membership_access, membership_access.record_access_decision, id="membership-access"),
    pytest.param(pending_money, pending_money._principal, id="pending-money"),
    pytest.param(staff_roster, staff_roster._principal, id="staff-roster"),
    pytest.param(staff_schedules, staff_schedules._principal, id="staff-schedules"),
]


@pytest.mark.parametrize(("module", "consumer"), MIXED_CONSUMERS)
def test_missing_admin_signing_secret_preserves_staff_fallback(module, consumer, monkeypatch):
    from fastapi import Request, Response
    from fastapi.security import HTTPAuthorizationCredentials

    factory = MagicMock()
    staff_principal = SessionPrincipal(uuid4(), uuid4())
    app = SimpleNamespace(state=SimpleNamespace(
        settings=SimpleNamespace(admin_auth_configured=True, admin_token_signing_configured=False,
                                 admin_token_signing_secret=None),
        session_factory=factory,
    ))
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "app": app})
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="synthetic-staff-token")
    admin_validator = Mock(side_effect=AssertionError("Admin validation must be skipped without a usable secret"))
    staff_validator = Mock(return_value=staff_principal)
    monkeypatch.setattr(module, "validate_admin_session", admin_validator)
    monkeypatch.setattr(module, "validate_session", staff_validator)
    if consumer is membership_access.record_access_decision:
        factory.begin.return_value.__enter__.return_value.execute.return_value.one_or_none.return_value = None
        with pytest.raises(Exception) as error:
            consumer(uuid4(), membership_access.AccessDecisionRequest(action="restrict", reason="test"), request,
                     Response(), idempotency_key="synthetic-key", credentials=credentials)
        assert getattr(error.value, "status_code", None) == 404
    else:
        result = consumer(request, credentials)
        assert getattr(result, "staff_id", None) == staff_principal.staff_id
    admin_validator.assert_not_called()
    staff_validator.assert_called_once()


@pytest.mark.parametrize(("module", "consumer"), [
    pytest.param(admin_enrollment, admin_enrollment._principal, id="admin-enrollment"),
    pytest.param(device_pairing, device_pairing._admin_principal, id="device-pairing"),
    pytest.param(inventory, inventory._admin, id="inventory"),
])
def test_missing_admin_signing_secret_fails_closed_for_admin_only_consumers(module, consumer, monkeypatch):
    from fastapi import HTTPException, Request
    from fastapi.security import HTTPAuthorizationCredentials

    app = SimpleNamespace(state=SimpleNamespace(
        settings=SimpleNamespace(admin_auth_configured=True, admin_token_signing_configured=False,
                                 admin_token_signing_secret=None),
        session_factory=MagicMock(),
    ))
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "app": app})
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="synthetic-token")
    validator = Mock(side_effect=AssertionError("Admin validation must be skipped without a usable secret"))
    monkeypatch.setattr(module, "validate_admin_session", validator)
    with pytest.raises(HTTPException) as error:
        consumer(request, credentials)
    assert error.value.status_code == 401
    assert error.value.detail == "Authentication failed."
    validator.assert_not_called()
