"""Catalog use cases: admin guard, commits and error mapping.

SQL lives in `app.catalog.queries`; HTTP transport lives in `app.api.catalog`. Failures are
raised as typed `AppError`s (never HTTPException). Every use case takes the session `factory`.
"""
from typing import Protocol
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.catalog import queries as q
from app.catalog.schemas import PlanDTO, PlanVersionDTO, ServiceDTO
from app.errors import HttpStatusError, http_errors


class Principal(Protocol):
    is_admin: bool


def _require_admin(principal: Principal) -> None:
    if not principal.is_admin:
        raise HttpStatusError(403)


def list_services(factory, status: str | None) -> list[ServiceDTO]:
    with factory() as session:
        return [q.to_service_dto(s) for s in q.list_services(session, status=status)]


def create_service(factory, principal: Principal, payload) -> ServiceDTO:
    _require_admin(principal)
    with http_errors((IntegrityError, 409)), factory() as session:
        service = q.create_service(session, code=payload.code, name=payload.name, status=payload.status)
        session.commit()
        return q.to_service_dto(service)


def list_plans(factory, kind: str | None, status: str | None, eligibility_type: str | None) -> list[PlanDTO]:
    with factory() as session:
        plans = q.list_plans(session, kind=kind, status=status, eligibility_type=eligibility_type)
        return [q.to_plan_dto(p) for p in plans]


def create_plan(factory, principal: Principal, payload) -> PlanDTO:
    _require_admin(principal)
    with http_errors((IntegrityError, 409), (ValueError, 400)), factory() as session:
        plan = q.create_plan(
            session, code=payload.code, name=payload.name, kind=payload.kind,
            initial_version=payload.initial_version,
        )
        session.commit()
        return q.to_plan_dto(plan)


def get_plan(factory, plan_id: UUID) -> PlanDTO:
    with factory() as session:
        plan = q.get_plan_by_id(session, plan_id)
        if plan is None:
            raise HttpStatusError(404)
        return q.to_plan_dto(plan)


def patch_plan(factory, principal: Principal, plan_id: UUID, payload) -> PlanDTO:
    _require_admin(principal)
    with http_errors((ValueError, 400)), factory() as session:
        plan = q.update_plan(session, plan_id, payload)
        if plan is None:
            raise HttpStatusError(404)
        session.commit()
        return q.to_plan_dto(plan)


def publish_plan_version(factory, principal: Principal, plan_id: UUID, payload) -> PlanVersionDTO:
    _require_admin(principal)
    with http_errors((IntegrityError, 409), (ValueError, 400)), factory() as session:
        if q.get_plan_by_id(session, plan_id) is None:
            raise HttpStatusError(404)
        version = q.publish_plan_version(
            session, plan_id=plan_id, version_data=payload, services=payload.services,
        )
        session.commit()
        return q.to_plan_version_dto(version)
