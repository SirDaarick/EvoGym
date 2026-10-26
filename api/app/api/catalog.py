"""Catalog API router for services, plans, and version publishing."""
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError, TimeoutError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.catalog.queries import (
    create_plan,
    create_service,
    get_plan_by_id,
    get_service_by_id,
    list_plans,
    list_services,
    publish_plan_version,
    to_plan_dto,
    to_plan_version_dto,
    to_service_dto,
)
from app.catalog.schemas import (
    CreatePlanDTO,
    CreateServiceDTO,
    PlanDTO,
    PlanVersionDTO,
    PublishPlanVersionDTO,
    ServiceDTO,
)

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class CatalogActorPrincipal:
    """Authenticated actor principal for catalog operations."""

    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


def get_catalog_actor_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CatalogActorPrincipal:
    """Authenticate either an Admin or Staff actor with catalog read access."""
    factory = request.app.state.session_factory
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")

    token = credentials.credentials

    # 1. Check if Admin Bearer only when token verification is configured.
    settings = request.app.state.settings
    if settings.admin_auth_configured and settings.admin_token_signing_configured:
        try:
            staff_id, _session_id = validate_admin_session(
                factory, token, settings.admin_token_signing_secret.get_secret_value()
            )
            return CatalogActorPrincipal(staff_id=staff_id, is_admin=True, branch_id=None)
        except AuthorizationDenied:
            pass
        except (OperationalError, InterfaceError, TimeoutError):
            raise HTTPException(503, "Authentication service unavailable.") from None

    # 2. Check if Staff Bearer with Permission.MEMBER_OPERATIONAL_READ
    try:
        principal = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        return CatalogActorPrincipal(
            staff_id=principal.staff_id,
            is_admin=False,
            branch_id=principal.branch_id,
        )
    except AuthorizationDenied:
        pass
    except (OperationalError, InterfaceError, TimeoutError):
        raise HTTPException(503, "Authentication service unavailable.") from None

    raise HTTPException(401, "Authentication failed.")


# ==============================================================================
# Services
# ==============================================================================


@router.get("/services", response_model=list[ServiceDTO])
def list_services_endpoint(
    request: Request,
    status: str | None = Query(None, pattern="^(active|inactive)$"),
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
) -> list[ServiceDTO]:
    """List commercial services. Accessible by Staff or Admin."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        services = list_services(session, status=status)
        return [to_service_dto(s) for s in services]


@router.post("/services", response_model=ServiceDTO, status_code=201)
def create_service_endpoint(
    payload: CreateServiceDTO,
    request: Request,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
) -> ServiceDTO:
    """Create a commercial service. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    try:
        with factory() as session:
            service = create_service(
                session,
                code=payload.code,
                name=payload.name,
                status=payload.status,
            )
            session.commit()
            return to_service_dto(service)
    except IntegrityError:
        raise HTTPException(409, f"A service with code '{payload.code}' already exists.")


# ==============================================================================
# Plans & Plan Versions
# ==============================================================================


@router.get("/plans", response_model=list[PlanDTO])
def list_plans_endpoint(
    request: Request,
    kind: str | None = Query(None, pattern="^(membership|visit)$"),
    status: str | None = Query(None, pattern="^(active|inactive|archived)$"),
    eligibility_type: str | None = Query(None, max_length=64),
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
) -> list[PlanDTO]:
    """List commercial plans with filtering. Accessible by Staff or Admin."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        plans = list_plans(session, kind=kind, status=status, eligibility_type=eligibility_type)
        return [to_plan_dto(p) for p in plans]


@router.post("/plans", response_model=PlanDTO, status_code=201)
def create_plan_endpoint(
    payload: CreatePlanDTO,
    request: Request,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
) -> PlanDTO:
    """Create a commercial plan with optional initial version. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    try:
        with factory() as session:
            plan = create_plan(
                session,
                code=payload.code,
                name=payload.name,
                kind=payload.kind,
                initial_version=payload.initial_version,
            )
            session.commit()
            return to_plan_dto(plan)
    except IntegrityError:
        raise HTTPException(409, f"A plan with code '{payload.code}' already exists.")
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/plans/{plan_id}", response_model=PlanDTO)
def get_plan_endpoint(
    plan_id: UUID,
    request: Request,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
) -> PlanDTO:
    """Retrieve detailed plan by ID including version history. Accessible by Staff or Admin."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        plan = get_plan_by_id(session, plan_id)
        if plan is None:
            raise HTTPException(404, "The requested resource was not found.")
        return to_plan_dto(plan)


@router.post("/plans/{plan_id}/versions", response_model=PlanVersionDTO, status_code=201)
def publish_plan_version_endpoint(
    plan_id: UUID,
    payload: PublishPlanVersionDTO,
    request: Request,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
) -> PlanVersionDTO:
    """Publish a new immutable version for an existing plan. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    try:
        with factory() as session:
            plan = get_plan_by_id(session, plan_id)
            if plan is None:
                raise HTTPException(404, "The requested resource was not found.")

            version = publish_plan_version(
                session,
                plan_id=plan_id,
                version_data=payload,
                services=payload.services,
            )
            session.commit()
            return to_plan_version_dto(version)
    except IntegrityError as exc:
        raise HTTPException(409, f"Could not publish plan version: {exc}")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
