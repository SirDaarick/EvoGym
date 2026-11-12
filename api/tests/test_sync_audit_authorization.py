"""Sync audit flags are for admins: a receptionist session must not list or resolve them (D-011, D-012)."""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings
from test_staff_roster import _setup


def test_receptionist_cannot_list_or_resolve_audit_flags_but_admin_can(tmp_path):
    url, engine, _factory, _branch, _other, desk_token, _branch_admin = _setup(tmp_path)
    try:
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            admin_token = complete_device_login(client, delivery, 'owner@example.invalid', 'synthetic-admin-password').json()['access_token']
            desk = {'Authorization': f'Bearer {desk_token}'}
            admin = {'Authorization': f'Bearer {admin_token}'}
            assert client.get('/api/v1/sync/audit-flags', headers=desk).status_code == 401
            assert client.post(f'/api/v1/sync/audit-flags/{uuid4()}/resolve', headers=desk).status_code == 401
            listed = client.get('/api/v1/sync/audit-flags', headers=admin)
            assert listed.status_code == 200 and listed.json() == []
    finally:
        engine.dispose()
