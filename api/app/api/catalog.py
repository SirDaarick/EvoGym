"""Catalog HTTP transport: parse the request, call one `app.catalog.service` function, shape the response."""
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from sqlalchemy.exc import InterfaceError, OperationalError, TimeoutError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.catalog import service
from app.catalog.schemas import (
    CreatePlanDTO,
    CreateServiceDTO,
    PatchPlanDTO,
    PlanDTO,
    PlanVersionDTO,
    PublishPlanVersionDTO,
    ServiceDTO,
)
from app.api.deps import SessionFactoryDep

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


@router.get("/services", response_model=list[ServiceDTO])
def list_services_endpoint(
    status: str | None = Query(None, pattern="^(active|inactive)$"),
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
    *, factory: SessionFactoryDep,
) -> list[ServiceDTO]:
    """List commercial services. Accessible by Staff or Admin."""
    return service.list_services(factory, status)


@router.post("/services", response_model=ServiceDTO, status_code=201)
def create_service_endpoint(
    payload: CreateServiceDTO,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
    *, factory: SessionFactoryDep,
) -> ServiceDTO:
    """Create a commercial service. Admin only."""
    return service.create_service(factory, principal, payload)


@router.get("/plans", response_model=list[PlanDTO])
def list_plans_endpoint(
    kind: str | None = Query(None, pattern="^(membership|visit)$"),
    status: str | None = Query(None, pattern="^(active|inactive|archived)$"),
    eligibility_type: str | None = Query(None, max_length=64),
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
    *, factory: SessionFactoryDep,
) -> list[PlanDTO]:
    """List commercial plans with filtering. Accessible by Staff or Admin."""
    return service.list_plans(factory, kind, status, eligibility_type)


@router.post("/plans", response_model=PlanDTO, status_code=201)
def create_plan_endpoint(
    payload: CreatePlanDTO,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
    *, factory: SessionFactoryDep,
) -> PlanDTO:
    """Create a commercial plan with optional initial version. Admin only."""
    return service.create_plan(factory, principal, payload)


@router.get("/plans/{plan_id}", response_model=PlanDTO)
def get_plan_endpoint(
    plan_id: UUID,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
    *, factory: SessionFactoryDep,
) -> PlanDTO:
    """Retrieve detailed plan by ID including version history. Accessible by Staff or Admin."""
    return service.get_plan(factory, plan_id)


@router.patch("/plans/{plan_id}", response_model=PlanDTO)
def patch_plan_endpoint(
    plan_id: UUID,
    payload: PatchPlanDTO,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
    *, factory: SessionFactoryDep,
) -> PlanDTO:
    """Update plan display name or active status. Admin only."""
    return service.patch_plan(factory, principal, plan_id, payload)


@router.post("/plans/{plan_id}/versions", response_model=PlanVersionDTO, status_code=201)
def publish_plan_version_endpoint(
    plan_id: UUID,
    payload: PublishPlanVersionDTO,
    principal: CatalogActorPrincipal = Depends(get_catalog_actor_principal),
    *, factory: SessionFactoryDep,
) -> PlanVersionDTO:
    """Publish a new immutable version for an existing plan. Admin only."""
    return service.publish_plan_version(factory, principal, plan_id, payload)
