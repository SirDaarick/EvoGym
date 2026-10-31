from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.hashing import hash_pin
from app.db.base import Base
from app.db.models import (Branch, OrganizationOwner, ReceptionStation, RoleGrant, StaffCredential, StaffDevicePairingCode,
                           StaffPairedDevice, StaffRosterProfile, StaffSession, StaffUser)
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin


def _setup(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'admin-staff-accounts.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    admin_id = seed_admin(factory)
    with factory.begin() as session:
        branch_a = Branch(code="account-a", name="Account A")
        branch_b = Branch(code="account-b", name="Account B")
        inactive_branch = Branch(code="account-disabled", name="Account Disabled", is_active=False)
        employee = StaffUser(login_identifier="employee@example.invalid")
        other = StaffUser(login_identifier="other@example.invalid")
        inactive_account = StaffUser(login_identifier="inactive@example.invalid", is_active=False)
        branch_admin = StaffUser(login_identifier="branch-admin@example.invalid")
        receptionist = StaffUser(login_identifier="reception@example.invalid")
        session.add_all([branch_a, branch_b, inactive_branch, employee, other, inactive_account, branch_admin, receptionist])
        session.flush()
        session.add_all([
            StaffCredential(staff_id=employee.id, method="pin", secret_hash=hash_pin("2468")),
            StaffCredential(staff_id=other.id, method="pin", secret_hash=hash_pin("1357")),
            StaffCredential(staff_id=inactive_account.id, method="pin", secret_hash=hash_pin("9876")),
            RoleGrant(staff_id=employee.id, role="receptionist", scope_kind="branch", branch_id=branch_a.id),
            RoleGrant(staff_id=employee.id, role="receptionist", scope_kind="branch", branch_id=branch_b.id),
            RoleGrant(staff_id=other.id, role="receptionist", scope_kind="branch", branch_id=branch_a.id),
            RoleGrant(staff_id=branch_admin.id, role="admin", scope_kind="branch", branch_id=branch_a.id),
            StaffCredential(staff_id=branch_admin.id, method="pin", secret_hash=hash_pin("2468")),
            RoleGrant(staff_id=receptionist.id, role="receptionist", scope_kind="branch", branch_id=branch_a.id),
            StaffCredential(staff_id=receptionist.id, method="pin", secret_hash=hash_pin("2222")),
        ])
        profile_a = StaffRosterProfile(branch_id=branch_a.id, full_name="Employee A", position="Coach")
        profile_b = StaffRosterProfile(branch_id=branch_b.id, full_name="Employee B", position="Coach")
        profile_a_duplicate = StaffRosterProfile(branch_id=branch_a.id, full_name="Employee A2", position="Coach")
        inactive_profile = StaffRosterProfile(branch_id=branch_a.id, full_name="Inactive Profile", position="Coach", is_active=False)
        disabled_branch_profile = StaffRosterProfile(branch_id=inactive_branch.id, full_name="Disabled Branch", position="Coach")
        session.add_all([profile_a, profile_b, profile_a_duplicate, inactive_profile, disabled_branch_profile])
        session.flush()
        ids = {
            "admin": admin_id,
            "branch_a": branch_a.id,
            "branch_b": branch_b.id,
            "inactive_branch": inactive_branch.id,
            "employee": employee.id,
            "other": other.id,
            "inactive_account": inactive_account.id,
            "profile_a": profile_a.id,
            "profile_b": profile_b.id,
            "profile_a_duplicate": profile_a_duplicate.id,
            "inactive_profile": inactive_profile.id,
            "disabled_branch_profile": disabled_branch_profile.id,
            "branch_admin": branch_admin.id,
            "receptionist": receptionist.id,
        }
    return url, engine, factory, ids


def _client(url):
    delivery = FakeRecoveryDelivery()
    client = TestClient(create_app(configured_settings(url), recovery_delivery=delivery))
    client.__enter__()
    login = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
    assert login.status_code == 200
    return client, {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_admin_account_directory_is_minimal_branch_aware_and_requires_admin(tmp_path):
    url, engine, _factory, ids = _setup(tmp_path)
    try:
        client, admin = _client(url)
        path = f"/api/v1/admin/staff-accounts?branch_id={ids['branch_a']}"
        response = client.get(path, headers=admin)
        assert response.status_code == 200, response.text
        rows = response.json()["accounts"]
        employee = next(row for row in rows if row["id"] == str(ids["employee"]))
        assert employee == {
            "id": str(ids["employee"]),
            "login_identifier": "employee@example.invalid",
            "is_active": True,
            "link_state": "unlinked",
            "linked_profile_id": None,
        }
        assert any(row["id"] == str(ids["inactive_account"]) and not row["is_active"] for row in rows)
        assert not any("password" in key or "credential" in key or "secret" in key for row in rows for key in row)
        assert client.get(path).status_code == 401

        from app.auth.sessions import issue_session
        receptionist = issue_session(_factory, "reception@example.invalid", "2222", ids["branch_a"],
                                     datetime.now(timezone.utc) + timedelta(hours=1))
        assert client.get(path, headers={"Authorization": f"Bearer {receptionist.token}"}).status_code == 401
    finally:
        client.close()
        engine.dispose()


def test_admin_links_one_account_across_branches_without_grant_changes_or_roster_leak(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        client, admin = _client(url)
        before = client.get(f"/api/v1/staff-roster?branch_id={ids['branch_a']}", headers=admin).json()
        assert before["items"][0]["id"] == str(ids["profile_a"])
        assert "staff_user_id" not in before["items"][0]

        for profile_id in (ids["profile_a"], ids["profile_b"]):
            response = client.post(f"/api/v1/admin/staff-accounts/roster-profiles/{profile_id}/link", headers=admin,
                                   json={"staff_user_id": str(ids["employee"])})
            assert response.status_code == 200, response.text
            assert response.json() == {"profile_id": str(profile_id), "staff_user_id": str(ids["employee"]), "link_state": "linked"}

        with factory() as session:
            grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == ids["employee"]).order_by(RoleGrant.branch_id)).all()
            assert {(grant.role, grant.scope_kind, grant.branch_id, grant.is_active) for grant in grants} == {
                ("receptionist", "branch", ids["branch_a"], True),
                ("receptionist", "branch", ids["branch_b"], True),
            }
            assert session.get(StaffRosterProfile, ids["profile_a"]).staff_user_id == ids["employee"]
            assert session.get(StaffRosterProfile, ids["profile_b"]).staff_user_id == ids["employee"]

        after = client.get(f"/api/v1/staff-roster?branch_id={ids['branch_a']}", headers=admin).json()
        before_item = next(row for row in before["items"] if row["id"] == str(ids["profile_a"]))
        after_item = next(row for row in after["items"] if row["id"] == str(ids["profile_a"]))
        assert after_item.keys() == before_item.keys()
        assert "staff_user_id" not in after_item
        assert {key: value for key, value in after_item.items() if key != "updated_at"} == {
            key: value for key, value in before_item.items() if key != "updated_at"
        }
        lookup = client.get(f"/api/v1/admin/staff-accounts?branch_id={ids['branch_a']}", headers=admin).json()
        assert next(row for row in lookup["accounts"] if row["id"] == str(ids["employee"]))["link_state"] == "linked"
        from app.auth.sessions import issue_session
        employee_session = issue_session(factory, "employee@example.invalid", "2468", ids["branch_a"],
                                          datetime.now(timezone.utc) + timedelta(hours=1))
        employee_headers = {"Authorization": f"Bearer {employee_session.token}"}
        assert client.get(f"/api/v1/admin/staff-accounts?branch_id={ids['branch_a']}", headers=employee_headers).status_code == 401
    finally:
        client.close()
        engine.dispose()


def test_link_is_idempotent_but_reassignment_and_ineligible_rows_conflict_or_hide(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        client, admin = _client(url)
        path = f"/api/v1/admin/staff-accounts/roster-profiles/{ids['profile_a']}/link"
        assert client.post(path, headers=admin, json={"staff_user_id": str(ids["employee"])}).status_code == 200
        assert client.post(path, headers=admin, json={"staff_user_id": str(ids["employee"])}).status_code == 200
        assert client.post(path, headers=admin, json={"staff_user_id": str(ids["other"])}).status_code == 409
        assert client.post(path, headers=admin, json={"staff_user_id": str(ids["inactive_account"])}).status_code == 404
        assert client.post(
            f"/api/v1/admin/staff-accounts/roster-profiles/{ids['profile_a_duplicate']}/link",
            headers=admin,
            json={"staff_user_id": str(ids["employee"])},
        ).status_code == 409
        assert client.post(f"/api/v1/admin/staff-accounts/roster-profiles/{ids['inactive_profile']}/link", headers=admin,
                           json={"staff_user_id": str(ids["other"])}).status_code == 404
        assert client.post(f"/api/v1/admin/staff-accounts/roster-profiles/{ids['disabled_branch_profile']}/link", headers=admin,
                           json={"staff_user_id": str(ids["other"])}).status_code == 404
        assert client.post(path, headers=admin, json={"staff_user_id": str(UUID(int=0))}).status_code == 404

        duplicate_path = f"/api/v1/admin/staff-accounts/roster-profiles/{ids['profile_a']}/link"
        assert client.post(duplicate_path, headers=admin, json={"staff_user_id": str(ids["employee"])}).status_code == 200
        with factory() as session:
            assert session.get(StaffRosterProfile, ids["profile_a"]).staff_user_id == ids["employee"]
            assert session.get(StaffRosterProfile, ids["profile_a_duplicate"]).staff_user_id is None
    finally:
        client.close()
        engine.dispose()


def test_branch_admin_with_roster_manage_permission_cannot_link_accounts(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        from app.auth.sessions import issue_session

        session = issue_session(factory, "branch-admin@example.invalid", "2468", ids["branch_a"],
                                datetime.now(timezone.utc) + timedelta(hours=1))
        client, _admin = _client(url)
        headers = {"Authorization": f"Bearer {session.token}"}
        path = f"/api/v1/admin/staff-accounts/roster-profiles/{ids['profile_a']}/link"
        response = client.post(path, headers=headers, json={"staff_user_id": str(ids["employee"])})
        assert response.status_code == 401
        assert client.get(f"/api/v1/admin/staff-accounts?branch_id={ids['branch_a']}", headers=headers).status_code == 401
    finally:
        client.close()
        engine.dispose()


def test_revoked_organization_admin_cannot_link_accounts(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        client, admin = _client(url)
        with factory.begin() as session:
            grant = session.scalar(select(RoleGrant).where(
                RoleGrant.staff_id == ids["admin"], RoleGrant.role == "admin", RoleGrant.scope_kind == "organization"
            ))
            grant.is_active = False
        path = f"/api/v1/admin/staff-accounts/roster-profiles/{ids['profile_a']}/link"
        assert client.post(path, headers=admin, json={"staff_user_id": str(ids["employee"])}).status_code == 401
        with factory() as session:
            assert session.get(StaffRosterProfile, ids["profile_a"]).staff_user_id is None
    finally:
        client.close()
        engine.dispose()


def test_admin_pin_choices_are_branch_scoped_minimal_and_require_admin(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        client, admin = _client(url)
        branches = client.get("/api/v1/admin/staff-accounts/branches", headers=admin)
        assert branches.status_code == 200, branches.text
        assert branches.json() == {"branches": [
            {"id": str(ids["branch_a"]), "code": "account-a", "name": "Account A"},
            {"id": str(ids["branch_b"]), "code": "account-b", "name": "Account B"},
        ]}

        profiles = client.get(f"/api/v1/admin/staff-accounts/roster-profiles?branch_id={ids['branch_a']}", headers=admin)
        assert profiles.status_code == 200, profiles.text
        assert profiles.json() == {"profiles": [
            {"id": str(ids["profile_a"]), "full_name": "Employee A", "position": "Coach",
             "is_active": True, "staff_user_id": None},
            {"id": str(ids["profile_a_duplicate"]), "full_name": "Employee A2", "position": "Coach",
             "is_active": True, "staff_user_id": None},
        ]}
        assert client.get(f"/api/v1/admin/staff-accounts/roster-profiles?branch_id={ids['branch_b']}", headers=admin).json() == {
            "profiles": [{"id": str(ids["profile_b"]), "full_name": "Employee B", "position": "Coach",
                          "is_active": True, "staff_user_id": None}]
        }
        assert client.get(f"/api/v1/admin/staff-accounts/roster-profiles?branch_id={ids['inactive_branch']}", headers=admin).status_code == 404
        assert client.get("/api/v1/admin/staff-accounts/branches").status_code == 401
        assert client.get(f"/api/v1/admin/staff-accounts/roster-profiles?branch_id={ids['branch_a']}").status_code == 401

        from app.auth.sessions import issue_session
        receptionist = issue_session(factory, "reception@example.invalid", "2222", ids["branch_a"],
                                     datetime.now(timezone.utc) + timedelta(hours=1))
        headers = {"Authorization": f"Bearer {receptionist.token}"}
        assert client.get("/api/v1/admin/staff-accounts/branches", headers=headers).status_code == 401
        assert client.get(f"/api/v1/admin/staff-accounts/roster-profiles?branch_id={ids['branch_a']}", headers=headers).status_code == 401
    finally:
        client.close()
        engine.dispose()


def test_account_directory_returns_only_the_explicit_profile_link_for_selected_branch(tmp_path):
    url, engine, _factory, ids = _setup(tmp_path)
    try:
        client, admin = _client(url)
        link_path = f"/api/v1/admin/staff-accounts/roster-profiles/{ids['profile_a']}/link"
        linked = client.post(link_path, headers=admin, json={"staff_user_id": str(ids["employee"])})
        assert linked.status_code == 200, linked.text

        branch_a = client.get(f"/api/v1/admin/staff-accounts?branch_id={ids['branch_a']}", headers=admin).json()["accounts"]
        branch_b = client.get(f"/api/v1/admin/staff-accounts?branch_id={ids['branch_b']}", headers=admin).json()["accounts"]
        assert next(row for row in branch_a if row["id"] == str(ids["employee"]))["linked_profile_id"] == str(ids["profile_a"])
        assert next(row for row in branch_b if row["id"] == str(ids["employee"]))["linked_profile_id"] is None
    finally:
        client.close()
        engine.dispose()


def test_reception_station_secret_is_one_time_and_scoped_to_linked_branch_profile(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        client, admin = _client(url)
        link = client.post(f"/api/v1/admin/staff-accounts/roster-profiles/{ids['profile_a']}/link",
                           headers=admin, json={"staff_user_id": str(ids["employee"])})
        assert link.status_code == 200
        issued = client.post("/api/v1/admin/staff-accounts/reception-stations", headers=admin,
                             json={"branch_id": str(ids["branch_a"])})
        assert issued.status_code == 201, issued.text
        assert issued.headers["cache-control"] == "no-store"
        secret = issued.json()["station_credential"]
        station_id = issued.json()["id"]
        assert len(secret) == 43
        listed = client.get(f"/api/v1/admin/staff-accounts/reception-stations?branch_id={ids['branch_a']}", headers=admin)
        assert listed.status_code == 200
        assert "station_credential" not in str(listed.json())
        station_headers = {"Authorization": f"ReceptionStation {secret}"}
        profiles = client.post("/api/v1/auth/reception/profiles", headers=station_headers)
        assert profiles.status_code == 200, profiles.text
        assert profiles.json() == {"profiles": [{"id": str(ids["profile_a"]), "full_name": "Employee A", "position": "Coach"}]}
        entered = client.post("/api/v1/auth/reception/sessions", headers=station_headers,
                              json={"profile_id": str(ids["profile_a"]), "pin": "2468"})
        assert entered.status_code == 201, entered.text
        employee_token = entered.json()["access_token"]
        assert entered.headers["cache-control"] == "no-store"
        revoked = client.post(f"/api/v1/admin/staff-accounts/reception-stations/{station_id}/revoke?branch_id={ids['branch_a']}",
                              headers=admin)
        assert revoked.status_code == 204
        from app.auth.sessions import validate_session
        from app.auth.authorization import AuthorizationDenied, Permission
        with pytest.raises(AuthorizationDenied):
            validate_session(factory, employee_token, Permission.MEMBER_OPERATIONAL_READ)
    finally:
        client.close()
        engine.dispose()


def test_global_deactivation_revokes_only_target_account_trust_and_protects_owner(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        from app.auth.sessions import issue_session, validate_session
        from app.auth.authorization import AuthorizationDenied, Permission
        from app.db.models import AdminPasswordCredential

        with factory.begin() as session:
            session.add(OrganizationOwner(staff_id=ids["admin"]))

        client, admin = _client(url)
        now = datetime.now(timezone.utc)
        employee_session = issue_session(factory, "employee@example.invalid", "2468", ids["branch_a"], now + timedelta(days=1))
        other_session = issue_session(factory, "other@example.invalid", "1357", ids["branch_a"], now + timedelta(days=1))
        with factory.begin() as session:
            session.add_all([
                StaffPairedDevice(staff_id=ids["employee"], device_identifier_hash="a" * 64,
                                  device_name="Synthetic phone", paired_at=now, last_seen_at=now),
                StaffDevicePairingCode(staff_id=ids["employee"], code_hash="b" * 64, created_by=ids["admin"],
                                       created_at=now, expires_at=now + timedelta(minutes=10)),
            ])
        denied_owner = client.post(f"/api/v1/admin/staff-accounts/deactivate/{ids['admin']}", headers=admin)
        assert denied_owner.status_code == 409
        response = client.post(f"/api/v1/admin/staff-accounts/deactivate/{ids['employee']}", headers=admin)
        assert response.status_code == 204, response.text
        with factory() as session:
            assert session.get(StaffUser, ids["employee"]).is_active is False
            employee_row = session.scalar(select(StaffSession).where(StaffSession.token_digest == __import__("hashlib").sha256(employee_session.token.encode()).hexdigest()))
            assert employee_row.revoked_at is not None
            assert session.scalar(select(StaffPairedDevice).where(StaffPairedDevice.staff_id == ids["employee"])).revoked_at is not None
            assert session.scalar(select(StaffDevicePairingCode).where(StaffDevicePairingCode.staff_id == ids["employee"])).revoked_at is not None
        with pytest.raises(AuthorizationDenied):
            validate_session(factory, employee_session.token, Permission.MEMBER_OPERATIONAL_READ)
        validate_session(factory, other_session.token, Permission.MEMBER_OPERATIONAL_READ)
    finally:
        client.close()
        engine.dispose()


def test_phone_staff_login_assigns_purpose_server_side_and_rejects_client_purpose(tmp_path):
    url, engine, _factory, ids = _setup(tmp_path)
    delivery = FakeRecoveryDelivery()
    with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
        body = {"login_identifier": "reception@example.invalid", "pin": "2222", "branch_id": str(ids["branch_a"])}
        issued = client.post("/api/v1/auth/staff/sessions", json=body)
        assert issued.status_code == 201, issued.text
        assert issued.headers["cache-control"] == "no-store"
        from app.auth.sessions import _digest
        with _factory() as session:
            row = session.scalar(select(StaffSession).where(StaffSession.token_digest == _digest(issued.json()["access_token"])))
            assert row.employee_purpose == "phone"
            assert row.reception_station_id is None
            assert row.absolute_expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc) + timedelta(days=90)
        forged = client.post("/api/v1/auth/staff/sessions", json={**body, "purpose": "reception"})
        assert forged.status_code == 422
    engine.dispose()


def test_admin_resolves_pending_sale_before_deactivation(tmp_path):
    from app.db.models import CashRegister, ProductSaleIntent, ProductSaleResolution
    url, engine, factory, ids = _setup(tmp_path)
    client = None
    try:
        from app.sales.schemas import CashProductSaleRequest
        from app.sales.queries import product_sale_fingerprint
        payload = {'member_id': None, 'items': [{'product_id': str(UUID(int=1)), 'quantity': 1}], 'expected_total_minor': 0}
        with factory.begin() as session:
            register = CashRegister(branch_id=ids['branch_a'], code='pending', name='Pending')
            session.add(register)
            session.flush()
            register_id = register.id
            session.add(ProductSaleIntent(seller_id=ids['employee'], register_id=register.id,
                idempotency_key='pending-test', request_fingerprint=product_sale_fingerprint(register.id, None, CashProductSaleRequest(**payload).items, 0),
                payload=payload))
        client, admin = _client(url)
        base = f"/api/v1/admin/staff-accounts/{ids['employee']}/product-sale-intent"
        assert client.get(base).status_code == 401
        assert client.post(f"/api/v1/admin/staff-accounts/deactivate/{ids['employee']}", headers=admin).status_code == 409
        pending = client.get(base, headers=admin)
        assert pending.status_code == 200
        assert pending.json()['key'] == 'pending-test'
        assert client.post(base + '/resolve', headers=admin, json={'key': 'different'}).status_code == 409
        assert client.get(base, headers=admin).json()['key'] == 'pending-test'
        resolved = client.post(base + '/resolve', headers=admin, json={'key': 'pending-test'})
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()['status'] == 'cancelled'
        with factory() as session:
            record = session.scalar(select(ProductSaleResolution))
            assert record.actor_id == ids['admin'] and record.seller_id == ids['employee']
            assert record.idempotency_key == 'pending-test' and record.result == 'cancelled'
        assert client.post(f"/api/v1/admin/staff-accounts/deactivate/{ids['employee']}", headers=admin).status_code == 204
        assert client.get(base, headers=admin).json() is None
        with factory.begin() as session:
            session.add(ProductSaleIntent(seller_id=ids['employee'], register_id=register_id,
                idempotency_key='legacy-pending', request_fingerprint=product_sale_fingerprint(register_id, None, CashProductSaleRequest(**payload).items, 0),
                payload=payload))
        assert client.get(base, headers=admin).json()['key'] == 'legacy-pending'
        assert client.post(base + '/resolve', headers=admin, json={'key': 'legacy-pending'}).json()['status'] == 'cancelled'
    finally:
        if client is not None: client.close()
        engine.dispose()
