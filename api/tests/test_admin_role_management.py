from sqlalchemy import create_engine
from sqlalchemy import select

import pytest

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.base import Base
from app.db.models import Branch, OrganizationOwner, RoleBundle, RoleBundlePermission, RoleBundleAssignment, RoleGrant, StaffUser
from app.db.session import create_session_factory


@pytest.fixture
def role_store(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'roles.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with factory.begin() as session:
        owner = StaffUser(login_identifier="owner@example.test")
        admin = StaffUser(login_identifier="admin@example.test")
        reception = StaffUser(login_identifier="desk@example.test")
        a, b = Branch(code="a", name="A"), Branch(code="b", name="B")
        session.add_all([owner, admin, reception, a, b])
        session.flush()
        session.add_all([
            RoleGrant(staff_id=owner.id, role="admin", scope_kind="organization"),
            RoleGrant(staff_id=admin.id, role="admin", scope_kind="organization"),
            RoleGrant(staff_id=reception.id, role="receptionist", scope_kind="branch", branch_id=a.id),
        ])
        session.flush()
        session.add(OrganizationOwner(id=1, staff_id=owner.id))
        bundle = RoleBundle(name="Branch inventory", normalized_name="branch inventory")
        session.add(bundle)
        session.flush()
        session.add(RoleBundlePermission(bundle_id=bundle.id, permission="finance_read"))
        session.add(RoleBundleAssignment(staff_id=admin.id, bundle_id=bundle.id, scope_kind="branch", branch_id=a.id))
        ids = {"owner": owner.id, "admin": admin.id, "reception": reception.id, "a": a.id, "b": b.id, "bundle": bundle.id}
    yield factory, ids
    engine.dispose()


def test_live_role_bundle_grants_permission_only_in_assigned_branch(role_store):
    factory, ids = role_store
    with factory() as session:
        authorize(session, ids["admin"], Permission.FINANCE_READ, ids["a"])
        with pytest.raises(AuthorizationDenied):
            authorize(session, ids["admin"], Permission.FINANCE_READ, ids["b"])
        with pytest.raises(AuthorizationDenied):
            authorize(session, ids["admin"], Permission.TRANSFER_REVIEW, ids["a"])


def test_assignments_from_multiple_bundles_combine_live_permissions(role_store):
    factory, ids = role_store
    with factory.begin() as session:
        bundle = RoleBundle(name="Roster access", normalized_name="roster access")
        session.add(bundle)
        session.flush()
        session.add(RoleBundlePermission(bundle_id=bundle.id, permission=Permission.STAFF_ROSTER_READ.value))
        session.add(RoleBundleAssignment(staff_id=ids["admin"], bundle_id=bundle.id,
                                         scope_kind="organization", branch_id=None))
    with factory() as session:
        authorize(session, ids["admin"], Permission.FINANCE_READ, ids["a"])
        authorize(session, ids["admin"], Permission.STAFF_ROSTER_READ, ids["b"])
        with pytest.raises(AuthorizationDenied):
            authorize(session, ids["admin"], Permission.FINANCE_READ, ids["b"])


def test_owner_can_use_branch_permissions_without_an_admin_bundle(role_store):
    factory, ids = role_store
    with factory() as session:
        authorize(session, ids["owner"], Permission.MEMBER_OPERATIONAL_READ, ids["a"])
        authorize(session, ids["owner"], Permission.STAFF_ROSTER_MANAGE, ids["b"])


def test_inactive_bundle_assignment_loses_authority_immediately(role_store):
    factory, ids = role_store
    with factory.begin() as session:
        assignment = session.query(RoleBundleAssignment).filter_by(staff_id=ids["admin"]).one()
        assignment.is_active = False
    with factory() as session, pytest.raises(AuthorizationDenied):
        authorize(session, ids["admin"], Permission.FINANCE_READ, ids["a"])


def test_receptionist_branch_roles_do_not_inherit_admin_permissions(role_store):
    factory, ids = role_store
    with factory() as session:
        authorize(session, ids["reception"], Permission.MEMBER_OPERATIONAL_READ, ids["a"])
        with pytest.raises(AuthorizationDenied):
            authorize(session, ids["reception"], Permission.FINANCE_READ, ids["a"])


def test_employee_management_is_explicitly_organization_scoped(role_store):
    factory, ids = role_store
    with factory() as session, pytest.raises(AuthorizationDenied):
        authorize(session, ids["admin"], Permission.STAFF_EMPLOYEE_MANAGE, ids["a"])


def test_legacy_authz_fixtures_keep_existing_admin_behavior_without_owner(role_store):
    factory, ids = role_store
    with factory.begin() as session:
        session.query(OrganizationOwner).delete()
    with factory() as session:
        authorize(session, ids["admin"], Permission.MEMBER_OPERATIONAL_READ, ids["b"])


def test_owner_manages_bundles_and_nonowner_admin_requires_employee_bundle(tmp_path):
    from fastapi.testclient import TestClient
    from app.db.models import StaffSession
    from app.main import create_app
    from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin

    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'role-api.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    owner_id = seed_admin(factory, is_owner=True)
    admin_id = seed_admin(factory, "manager@example.invalid")
    with factory.begin() as session:
        session.add(OrganizationOwner(id=1, staff_id=owner_id))
        branch = Branch(code="api-branch", name="API Branch")
        session.add(branch)
        session.flush()
        branch_id = branch.id
    url = f"sqlite+pysqlite:///{(tmp_path / 'role-api.db').as_posix()}"
    delivery = FakeRecoveryDelivery()
    client = TestClient(create_app(configured_settings(url), recovery_delivery=delivery))
    client.__enter__()
    try:
        owner_login = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
        owner_headers = {"Authorization": f"Bearer {owner_login.json()['access_token']}"}
        admin_login = complete_device_login(client, delivery, "manager@example.invalid", "synthetic-admin-password")
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

        assert client.get("/api/v1/admin/role-management/me", headers=owner_headers).json()["is_owner"] is True
        assert client.get("/api/v1/admin/role-management/me", headers=admin_headers).json()["is_owner"] is False
        assert client.get("/api/v1/admin/role-management/bundles", headers=admin_headers).status_code == 403
        assert client.get("/api/v1/admin/staff-accounts/branches", headers=admin_headers).status_code == 403

        invalid = client.post("/api/v1/admin/role-management/bundles", headers=owner_headers,
                              json={"name": "Bad", "permissions": ["made_up"]})
        assert invalid.status_code == 422
        bundle_response = client.post("/api/v1/admin/role-management/bundles", headers=owner_headers,
            json={"name": "Employee operations", "permissions": ["staff_employee_manage", "finance_read"]})
        assert bundle_response.status_code == 201, bundle_response.text
        bundle_id = bundle_response.json()["id"]

        branch_assignment = client.post("/api/v1/admin/role-management/assignments", headers=owner_headers,
            json={"staff_id": str(admin_id), "bundle_id": bundle_id, "scope_kind": "branch", "branch_id": str(branch_id)})
        assert branch_assignment.status_code == 201, branch_assignment.text
        assert client.get("/api/v1/admin/staff-accounts/branches", headers=admin_headers).status_code == 403

        organization_assignment = client.post("/api/v1/admin/role-management/assignments", headers=owner_headers,
            json={"staff_id": str(admin_id), "bundle_id": bundle_id, "scope_kind": "organization", "branch_id": None})
        assert organization_assignment.status_code == 201, organization_assignment.text
        assert client.get("/api/v1/admin/staff-accounts/branches", headers=admin_headers).status_code == 200
        assert client.get("/api/v1/admin/role-management/bundles", headers=admin_headers).status_code == 403

        with factory() as session:
            active_admin_sessions = session.scalars(select(StaffSession).where(
                StaffSession.staff_id == admin_id, StaffSession.revoked_at.is_(None)
            )).all()
            assert active_admin_sessions
        response = client.delete(f"/api/v1/admin/role-management/staff/{admin_id}/admin", headers=owner_headers)
        assert response.status_code == 200, response.text
        with factory() as session:
            assert not session.scalars(select(StaffSession).where(
                StaffSession.staff_id == admin_id, StaffSession.revoked_at.is_(None)
            )).all()
        assert client.get("/api/v1/admin/staff-accounts/branches", headers=admin_headers).status_code == 401
    finally:
        client.close()
        engine.dispose()
