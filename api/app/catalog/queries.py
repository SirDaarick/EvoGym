"""Catalog query and mutation operations."""
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalog.schemas import (
    CreatePlanDTO,
    PlanDTO,
    PlanServiceLinkDTO,
    PlanVersionDTO,
    PlanVersionServiceCreateDTO,
    PublishPlanVersionDTO,
    ServiceDTO,
)
from app.db.models.catalog import Plan, PlanVersion, PlanVersionService, Service


def to_service_dto(service: Service) -> ServiceDTO:
    """Convert Service model to DTO."""
    return ServiceDTO(
        id=str(service.id),
        code=service.code,
        name=service.name,
        status=service.status,
        created_at=service.created_at,
        updated_at=service.updated_at,
    )


def to_plan_service_link_dto(link: PlanVersionService) -> PlanServiceLinkDTO:
    """Convert PlanVersionService model to DTO."""
    return PlanServiceLinkDTO(
        service_id=str(link.service_id),
        service_code=link.service.code if link.service else "",
        service_name=link.service.name if link.service else "",
        session_limit=link.session_limit,
    )


def to_plan_version_dto(pv: PlanVersion) -> PlanVersionDTO:
    """Convert PlanVersion model to DTO."""
    return PlanVersionDTO(
        id=str(pv.id),
        plan_id=str(pv.plan_id),
        version_number=pv.version_number,
        name=pv.name,
        price_minor=pv.price_minor,
        currency=pv.currency,
        reference_amount_minor=pv.reference_amount_minor,
        duration_value=pv.duration_value,
        duration_unit=pv.duration_unit,
        eligibility_type=pv.eligibility_type,
        restriction_notes=pv.restriction_notes,
        is_active=pv.is_active,
        published_at=pv.published_at,
        services=[to_plan_service_link_dto(s) for s in pv.services],
    )


def to_plan_dto(plan: Plan) -> PlanDTO:
    """Convert Plan model to DTO."""
    version_dtos = [to_plan_version_dto(v) for v in plan.versions]
    current = to_plan_version_dto(plan.current_version) if plan.current_version else None
    return PlanDTO(
        id=str(plan.id),
        code=plan.code,
        name=plan.name,
        kind=plan.kind,
        status=plan.status,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        current_version=current,
        versions=version_dtos,
    )


def create_service(
    session: Session,
    code: str,
    name: str,
    status: str = "active",
) -> Service:
    """Create a new commercial service."""
    service = Service(
        id=uuid4(),
        code=code.strip(),
        name=name.strip(),
        status=status,
    )
    session.add(service)
    session.flush()
    return service


def list_services(
    session: Session,
    status: str | None = None,
) -> list[Service]:
    """List commercial services, optionally filtered by status."""
    stmt = select(Service)
    if status is not None:
        stmt = stmt.where(Service.status == status)
    stmt = stmt.order_by(Service.code.asc())
    return list(session.scalars(stmt).all())


def get_service_by_id(
    session: Session,
    service_id: UUID | str,
) -> Service | None:
    """Retrieve service by primary key UUID."""
    if isinstance(service_id, str):
        service_id = UUID(service_id)
    return session.get(Service, service_id)


def get_service_by_code(
    session: Session,
    code: str,
) -> Service | None:
    """Retrieve service by unique code."""
    return session.scalar(select(Service).where(Service.code == code.strip()))


def publish_plan_version(
    session: Session,
    plan_id: UUID | str,
    version_data: PublishPlanVersionDTO | dict,
    services: list[PlanVersionServiceCreateDTO] | None = None,
) -> PlanVersion:
    """Publish a new immutable version for a commercial plan."""
    if isinstance(plan_id, str):
        plan_id = UUID(plan_id)

    plan = session.get(Plan, plan_id)
    if plan is None:
        raise ValueError(f"Plan with id '{plan_id}' does not exist.")

    # Calculate next version number
    max_v = session.scalar(
        select(func.coalesce(func.max(PlanVersion.version_number), 0)).where(
            PlanVersion.plan_id == plan_id
        )
    )
    version_number = (max_v or 0) + 1

    if isinstance(version_data, PublishPlanVersionDTO):
        v_dict = version_data.model_dump()
        service_entries = version_data.services if services is None else services
    else:
        v_dict = dict(version_data)
        service_entries = v_dict.get("services", []) if services is None else services

    pv = PlanVersion(
        id=uuid4(),
        plan_id=plan_id,
        version_number=version_number,
        name=v_dict["name"].strip(),
        price_minor=v_dict["price_minor"],
        currency=v_dict.get("currency", "MXN"),
        reference_amount_minor=v_dict.get("reference_amount_minor"),
        duration_value=v_dict["duration_value"],
        duration_unit=v_dict["duration_unit"],
        eligibility_type=v_dict.get("eligibility_type"),
        restriction_notes=v_dict.get("restriction_notes"),
        is_active=v_dict.get("is_active", True),
    )
    session.add(pv)
    session.flush()

    for s in service_entries:
        if isinstance(s, PlanVersionServiceCreateDTO):
            svc_id = UUID(s.service_id) if isinstance(s.service_id, str) else s.service_id
            limit = s.session_limit
        else:
            svc_id = UUID(s["service_id"]) if isinstance(s["service_id"], str) else s["service_id"]
            limit = s.get("session_limit")

        svc = session.get(Service, svc_id)
        if svc is None:
            raise ValueError(f"Service with ID '{svc_id}' does not exist.")

        link = PlanVersionService(
            plan_version_id=pv.id,
            service_id=svc_id,
            session_limit=limit,
        )
        session.add(link)

    session.flush()
    session.refresh(pv)
    return pv


def create_plan(
    session: Session,
    code: str,
    name: str,
    kind: str = "membership",
    initial_version: PublishPlanVersionDTO | None = None,
) -> Plan:
    """Create a commercial plan, optionally publishing an initial version."""
    plan = Plan(
        id=uuid4(),
        code=code.strip(),
        name=name.strip(),
        kind=kind,
        status="active",
    )
    session.add(plan)
    session.flush()

    if initial_version is not None:
        publish_plan_version(
            session=session,
            plan_id=plan.id,
            version_data=initial_version,
            services=initial_version.services,
        )
        session.flush()
        session.refresh(plan)

    return plan


def get_plan_by_id(
    session: Session,
    plan_id: UUID | str,
) -> Plan | None:
    """Retrieve plan by primary key UUID."""
    if isinstance(plan_id, str):
        plan_id = UUID(plan_id)
    return session.get(Plan, plan_id)


def get_plan_by_code(
    session: Session,
    code: str,
) -> Plan | None:
    """Retrieve plan by unique code."""
    return session.scalar(select(Plan).where(Plan.code == code.strip()))


def list_plans(
    session: Session,
    kind: str | None = None,
    status: str | None = None,
    eligibility_type: str | None = None,
) -> list[Plan]:
    """List commercial plans with optional filters."""
    stmt = select(Plan)
    if kind is not None:
        stmt = stmt.where(Plan.kind == kind)
    if status is not None:
        stmt = stmt.where(Plan.status == status)
    if eligibility_type is not None:
        stmt = stmt.join(Plan.versions).where(PlanVersion.eligibility_type == eligibility_type)

    stmt = stmt.order_by(Plan.code.asc())
    return list(session.scalars(stmt).unique().all())
