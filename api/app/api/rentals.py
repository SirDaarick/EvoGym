"""Authenticated rental assets and lifecycle routes."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.db.models import Branch
from app.db.models.rentals import RentalAsset
from app.rentals.schemas import RentalAssetDTO, RentalAssetInput, RentalAssetPage, RentalAssetPatch

router = APIRouter(prefix="/api/v1/rentals", tags=["rentals"])


def _factory(request: Request):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    return factory


def _branch(session, branch_id: UUID, principal: ShiftActorPrincipal):
    if not principal.is_admin and principal.branch_id != branch_id:
        raise HTTPException(403, "Access restricted to authorized branch.")
    branch = session.get(Branch, branch_id)
    if branch is None or not branch.is_active:
        raise HTTPException(404, "Branch not found.")
    return branch


def _admin(principal: ShiftActorPrincipal):
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")


@router.get("/assets", response_model=RentalAssetPage)
def list_assets(
    request: Request, branch_id: UUID,
    kind: Literal["glove", "locker"] | None = None,
    offset: int = Query(0, ge=0, le=2**63 - 1), limit: int = Query(50, ge=1, le=100),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    with _factory(request)() as session:
        _branch(session, branch_id, principal)
        filters = [RentalAsset.branch_id == branch_id]
        if kind is not None:
            filters.append(RentalAsset.kind == kind)
        total = session.scalar(select(func.count()).select_from(RentalAsset).where(*filters))
        rows = session.scalars(select(RentalAsset).where(*filters)
                               .order_by(RentalAsset.code, RentalAsset.id).offset(offset).limit(limit)).all()
        return RentalAssetPage(items=[RentalAssetDTO.model_validate(row) for row in rows], total=total)


@router.post("/assets", response_model=RentalAssetDTO, status_code=201)
def create_asset(payload: RentalAssetInput, request: Request,
                 principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    _admin(principal)
    try:
        with _factory(request).begin() as session:
            _branch(session, payload.branch_id, principal)
            row = RentalAsset(**payload.model_dump(), created_by=principal.staff_id)
            session.add(row)
            session.flush()
            return RentalAssetDTO.model_validate(row)
    except IntegrityError:
        raise HTTPException(409, "Rental asset code or locker number already exists in this branch.") from None



@router.patch("/assets/{asset_id}", response_model=RentalAssetDTO)
def update_asset(asset_id: UUID, payload: RentalAssetPatch, request: Request,
                 principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    _admin(principal)
    try:
        with _factory(request).begin() as session:
            row = session.scalar(select(RentalAsset).where(RentalAsset.id == asset_id).with_for_update())
            if row is None:
                raise HTTPException(404, "Rental asset not found.")
            _branch(session, row.branch_id, principal)
            validated = RentalAssetInput.model_validate({
                **RentalAssetDTO.model_validate(row).model_dump(exclude={"id"}),
                **payload.model_dump(exclude_unset=True),
            })
            for key in payload.model_fields_set:
                setattr(row, key, getattr(validated, key))
            session.flush()
            return RentalAssetDTO.model_validate(row)
    except IntegrityError:
        raise HTTPException(409, "Rental asset code or locker number already exists in this branch.") from None
    except ValidationError:
        raise HTTPException(422, "Rental asset attributes are invalid for this asset kind.") from None
