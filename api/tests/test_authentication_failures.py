"""Fault classification at the three Admin-to-staff bearer boundaries."""
import logging
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError, ProgrammingError, TimeoutError

from app.api import catalog, members, shifts
from app.auth.authorization import AuthorizationDenied
from app.auth.sessions import SessionPrincipal, revoke_session
from app.main import create_app
from app.settings import Settings
from test_members import _seed_branch, _seed_receptionist, _setup_db


ENDPOINTS = [
    pytest.param(members, "/api/v1/members", id="members"),
    pytest.param(catalog, "/api/v1/catalog/plans", id="catalog"),
    pytest.param(shifts, "/api/v1/registers", id="registers"),
]
SECRET = "postgresql://private-user:private-password@private-host/private-db raw-token"


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
            client.app.state.session_factory = factory
            response = client.get(path, headers={"Authorization": "Bearer synthetic-staff-token"})
        assert response.status_code == 200, response.text
        assert response.json() == ({"items": [], "total": 0, "page": 1, "limit": 20, "pages": 1} if module is members else [])
        admin.assert_called_once_with(factory, "synthetic-staff-token")
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
            client.app.state.session_factory = factory
            for rejected in ("raw-token", token):
                response = client.get(path, headers={"Authorization": f"Bearer {rejected}"})
                _assert_safe(response, 401, caplog)
                assert rejected not in response.text and rejected not in caplog.text
    finally:
        engine.dispose()
