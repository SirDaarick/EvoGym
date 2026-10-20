"""Tests for catalog services, plans, plan versions, and immutability (BK-017)."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.auth.admin import authenticate_admin
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import (
    Branch,
    Plan,
    PlanVersion,
    PlanVersionService,
    RoleGrant,
    Service,
    StaffCredential,
    StaffUser,
)
from app.catalog.queries import (
    create_plan,
    create_service,
    get_plan_by_id,
    get_service_by_id,
    list_plans,
    list_services,
    publish_plan_version,
)
from app.catalog.schemas import (
    PlanVersionServiceCreateDTO,
    PublishPlanVersionDTO,
)
from app.main import create_app
from test_admin_auth import configured_settings, seed_admin


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'catalog-test.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    return url, engine, factory


def _seed_branch(factory, code="central", name="Central Branch") -> UUID:
    with factory.begin() as session:
        branch = Branch(code=code, name=name)
        session.add(branch)
        session.flush()
        return branch.id


def _seed_receptionist(factory, branch_id: UUID, login="receptionist@evogym.com", pin="1234") -> tuple[UUID, str]:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch_id),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin(pin)),
        ])
        staff_id = staff.id

    now = datetime.now(timezone.utc)
    issued = issue_session(factory, login, pin, branch_id, now + timedelta(hours=1))
    return staff_id, issued.token


def test_service_creation_and_duplicate_rejection(tmp_path):
    """Verify service creation and duplicate code integrity rejection."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        with factory() as session:
            s1 = create_service(session, code="gym", name="Gym Area", status="active")
            session.commit()
            assert s1.id is not None
            assert s1.code == "gym"
            assert s1.name == "Gym Area"
            assert s1.status == "active"

            # Duplicate code in database must fail
            with pytest.raises(IntegrityError):
                create_service(session, code="gym", name="Duplicate Gym")
                session.commit()
            session.rollback()

            # Query list
            services = list_services(session)
            assert len(services) == 1
            assert services[0].code == "gym"
    finally:
        engine.dispose()


def test_plan_creation_with_and_without_initial_version(tmp_path):
    """Verify plan creation with and without an initial published version."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        with factory() as session:
            svc_gym = create_service(session, code="gym", name="Gym Area")
            svc_box = create_service(session, code="box", name="Boxing Ring")
            session.commit()

            # 1. Plan without initial version
            p_empty = create_plan(session, code="plan_empty", name="Empty Plan", kind="membership")
            session.commit()
            assert p_empty.id is not None
            assert p_empty.code == "plan_empty"
            assert len(p_empty.versions) == 0
            assert p_empty.current_version is None

            # 2. Plan with initial version
            initial_v = PublishPlanVersionDTO(
                name="Gym Monthly Standard",
                price_minor=65000,
                currency="MXN",
                reference_amount_minor=75000,
                duration_value=1,
                duration_unit="month",
                eligibility_type=None,
                restriction_notes="Standard access hours 6am-11pm",
                services=[
                    PlanVersionServiceCreateDTO(service_id=str(svc_gym.id), session_limit=None),
                    PlanVersionServiceCreateDTO(service_id=str(svc_box.id), session_limit=8),
                ],
            )
            p_with_v = create_plan(
                session,
                code="gym_monthly",
                name="Gym Monthly",
                kind="membership",
                initial_version=initial_v,
            )
            session.commit()

            assert p_with_v.id is not None
            assert len(p_with_v.versions) == 1
            v1 = p_with_v.current_version
            assert v1 is not None
            assert v1.version_number == 1
            assert v1.price_minor == 65000
            assert v1.reference_amount_minor == 75000
            assert len(v1.services) == 2
            svc_map = {str(s.service_id): s.session_limit for s in v1.services}
            assert svc_map[str(svc_gym.id)] is None
            assert svc_map[str(svc_box.id)] == 8

            # 3. Duplicate code integrity rejection
            with pytest.raises(IntegrityError):
                create_plan(session, code="gym_monthly", name="Duplicate Plan")
                session.commit()
            session.rollback()
    finally:
        engine.dispose()


def test_publish_incremental_plan_versions(tmp_path):
    """Verify incremental version numbering and version history order."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        with factory() as session:
            svc = create_service(session, code="gym", name="Gym Area")
            session.commit()

            plan = create_plan(session, code="gym_flex", name="Gym Flex")
            session.commit()

            # Publish version 1
            v1_dto = PublishPlanVersionDTO(
                name="Gym Flex 2025",
                price_minor=50000,
                duration_value=1,
                duration_unit="month",
                services=[PlanVersionServiceCreateDTO(service_id=str(svc.id))],
            )
            v1 = publish_plan_version(session, plan.id, v1_dto)
            session.commit()
            assert v1.version_number == 1
            assert v1.price_minor == 50000

            # Publish version 2
            v2_dto = PublishPlanVersionDTO(
                name="Gym Flex 2026 Price Adjustment",
                price_minor=55000,
                duration_value=1,
                duration_unit="month",
                services=[PlanVersionServiceCreateDTO(service_id=str(svc.id))],
            )
            v2 = publish_plan_version(session, plan.id, v2_dto)
            session.commit()
            assert v2.version_number == 2
            assert v2.price_minor == 55000

            # Re-read plan from db
            refreshed = get_plan_by_id(session, plan.id)
            assert refreshed is not None
            assert len(refreshed.versions) == 2
            assert [v.version_number for v in refreshed.versions] == [1, 2]
            assert refreshed.current_version.version_number == 2
            assert refreshed.current_version.price_minor == 55000
    finally:
        engine.dispose()


def test_plan_version_immutability_enforcement(tmp_path):
    """Verify that published plan versions reject updates via SQLAlchemy before_update listener."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        with factory() as session:
            svc = create_service(session, code="gym", name="Gym Area")
            session.commit()

            v_dto = PublishPlanVersionDTO(
                name="General Monthly",
                price_minor=60000,
                duration_value=1,
                duration_unit="month",
                services=[PlanVersionServiceCreateDTO(service_id=str(svc.id))],
            )
            plan = create_plan(session, code="gym_gen", name="Gym General", initial_version=v_dto)
            session.commit()

            # Attempt to modify commercial terms of published version
            version = plan.current_version
            assert version is not None
            version.price_minor = 45000

            with pytest.raises(ValueError, match="Published plan versions are immutable"):
                session.commit()
            session.rollback()

            # Verify original price is untouched
            refreshed = get_plan_by_id(session, plan.id)
            assert refreshed.current_version.price_minor == 60000
    finally:
        engine.dispose()


def test_plan_listing_and_filtering(tmp_path):
    """Verify querying plans with kind, status, and eligibility_type filters."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        with factory() as session:
            svc = create_service(session, code="gym", name="Gym Area")
            session.commit()

            # Membership regular
            p1 = create_plan(
                session,
                code="gym_m",
                name="Gym Membership",
                kind="membership",
                initial_version=PublishPlanVersionDTO(
                    name="Standard Member",
                    price_minor=60000,
                    duration_value=1,
                    duration_unit="month",
                    eligibility_type=None,
                    services=[PlanVersionServiceCreateDTO(service_id=str(svc.id))],
                ),
            )
            # Membership student
            p2 = create_plan(
                session,
                code="gym_student",
                name="Gym Student Membership",
                kind="membership",
                initial_version=PublishPlanVersionDTO(
                    name="Student Discount Member",
                    price_minor=45000,
                    duration_value=1,
                    duration_unit="month",
                    eligibility_type="student",
                    services=[PlanVersionServiceCreateDTO(service_id=str(svc.id))],
                ),
            )
            # Visit single
            p3 = create_plan(
                session,
                code="gym_visit",
                name="Single Day Visit",
                kind="visit",
                initial_version=PublishPlanVersionDTO(
                    name="Day Pass",
                    price_minor=10000,
                    duration_value=1,
                    duration_unit="day",
                    eligibility_type=None,
                    services=[PlanVersionServiceCreateDTO(service_id=str(svc.id))],
                ),
            )
            session.commit()

            # Filter by kind="visit"
            visits = list_plans(session, kind="visit")
            assert len(visits) == 1
            assert visits[0].code == "gym_visit"

            # Filter by kind="membership"
            memberships = list_plans(session, kind="membership")
            assert len(memberships) == 2

            # Filter by eligibility_type="student"
            students = list_plans(session, eligibility_type="student")
            assert len(students) == 1
            assert students[0].code == "gym_student"
    finally:
        engine.dispose()


def test_catalog_rbac_receptionist_vs_admin(tmp_path):
    """Verify RBAC: Receptionist gets 200 on GET, 403 on POST; Admin gets 200/201 on all."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _staff_id, recep_token = _seed_receptionist(factory, branch_id)
        seed_admin(factory, "owner@example.invalid", "super-secret-password")
        admin_token_obj = authenticate_admin(factory, "owner@example.invalid", "super-secret-password", 3600, uuid4())
        admin_token = admin_token_obj.token

        app = create_app(configured_settings(url))

        recep_headers = {"Authorization": f"Bearer {recep_token}"}
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        with TestClient(app) as client:
            # 1. Unauthenticated gets 401
            assert client.get("/api/v1/catalog/services").status_code == 401
            assert client.get("/api/v1/catalog/plans").status_code == 401

            # 2. Receptionist cannot create a service (403)
            res_r_svc = client.post(
                "/api/v1/catalog/services",
                headers=recep_headers,
                json={"code": "gym", "name": "Gym Area"},
            )
            assert res_r_svc.status_code == 403

            # 3. Admin can create services (201)
            res_a_s1 = client.post(
                "/api/v1/catalog/services",
                headers=admin_headers,
                json={"code": "gym", "name": "Gym Area"},
            )
            assert res_a_s1.status_code == 201
            s1_data = res_a_s1.json()
            assert s1_data["code"] == "gym"
            svc_gym_id = s1_data["id"]

            res_a_s2 = client.post(
                "/api/v1/catalog/services",
                headers=admin_headers,
                json={"code": "box", "name": "Boxing Ring"},
            )
            assert res_a_s2.status_code == 201
            svc_box_id = res_a_s2.json()["id"]

            # Admin creating duplicate service code -> 409
            res_a_dup_svc = client.post(
                "/api/v1/catalog/services",
                headers=admin_headers,
                json={"code": "gym", "name": "Another Gym"},
            )
            assert res_a_dup_svc.status_code == 409

            # 4. Receptionist can list services (200)
            res_r_list_svc = client.get("/api/v1/catalog/services", headers=recep_headers)
            assert res_r_list_svc.status_code == 200
            assert len(res_r_list_svc.json()) == 2

            # 5. Receptionist cannot create a plan (403)
            res_r_plan = client.post(
                "/api/v1/catalog/plans",
                headers=recep_headers,
                json={"code": "gym_m", "name": "Gym Month"},
            )
            assert res_r_plan.status_code == 403

            # 6. Admin can create a plan with initial version (201)
            res_a_plan = client.post(
                "/api/v1/catalog/plans",
                headers=admin_headers,
                json={
                    "code": "gym_m",
                    "name": "Gym Month",
                    "kind": "membership",
                    "initial_version": {
                        "name": "Monthly General 2026",
                        "price_minor": 65000,
                        "currency": "MXN",
                        "duration_value": 1,
                        "duration_unit": "month",
                        "services": [
                            {"service_id": svc_gym_id, "session_limit": None},
                            {"service_id": svc_box_id, "session_limit": 10},
                        ],
                    },
                },
            )
            assert res_a_plan.status_code == 201
            plan_data = res_a_plan.json()
            plan_id = plan_data["id"]
            assert plan_data["code"] == "gym_m"
            assert plan_data["current_version"]["version_number"] == 1
            assert len(plan_data["current_version"]["services"]) == 2

            # 7. Receptionist can get plan details (200) and list plans (200)
            res_r_get_plan = client.get(f"/api/v1/catalog/plans/{plan_id}", headers=recep_headers)
            assert res_r_get_plan.status_code == 200
            assert res_r_get_plan.json()["id"] == plan_id

            res_r_list_plans = client.get("/api/v1/catalog/plans", headers=recep_headers)
            assert res_r_list_plans.status_code == 200
            assert len(res_r_list_plans.json()) == 1

            # 8. Receptionist cannot publish a plan version (403)
            res_r_pub = client.post(
                f"/api/v1/catalog/plans/{plan_id}/versions",
                headers=recep_headers,
                json={
                    "name": "Monthly General 2027",
                    "price_minor": 70000,
                    "duration_value": 1,
                    "duration_unit": "month",
                    "services": [{"service_id": svc_gym_id}],
                },
            )
            assert res_r_pub.status_code == 403

            # 9. Admin can publish next plan version (201)
            res_a_pub = client.post(
                f"/api/v1/catalog/plans/{plan_id}/versions",
                headers=admin_headers,
                json={
                    "name": "Monthly General 2027",
                    "price_minor": 70000,
                    "duration_value": 1,
                    "duration_unit": "month",
                    "services": [{"service_id": svc_gym_id}],
                },
            )
            assert res_a_pub.status_code == 201
            v2_data = res_a_pub.json()
            assert v2_data["version_number"] == 2
            assert v2_data["price_minor"] == 70000

            # 10. Check plan history now has 2 versions
            res_get_history = client.get(f"/api/v1/catalog/plans/{plan_id}", headers=recep_headers)
            assert res_get_history.status_code == 200
            history_data = res_get_history.json()
            assert len(history_data["versions"]) == 2
            assert history_data["current_version"]["version_number"] == 2
            assert history_data["current_version"]["price_minor"] == 70000

            # 11. Publishing version with non-existent service ID -> 400
            fake_svc_id = str(uuid4())
            res_bad_svc = client.post(
                f"/api/v1/catalog/plans/{plan_id}/versions",
                headers=admin_headers,
                json={
                    "name": "Invalid Service Version",
                    "price_minor": 80000,
                    "duration_value": 1,
                    "duration_unit": "month",
                    "services": [{"service_id": fake_svc_id}],
                },
            )
            assert res_bad_svc.status_code == 400

            # 12. Publishing version on non-existent plan -> 404
            fake_plan_id = str(uuid4())
            res_bad_plan = client.post(
                f"/api/v1/catalog/plans/{fake_plan_id}/versions",
                headers=admin_headers,
                json={
                    "name": "Ghost Plan Version",
                    "price_minor": 80000,
                    "duration_value": 1,
                    "duration_unit": "month",
                    "services": [],
                },
            )
            assert res_bad_plan.status_code == 404
    finally:
        engine.dispose()
