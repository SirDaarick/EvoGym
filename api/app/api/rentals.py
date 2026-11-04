"""Rental HTTP transport: parse the request, call one `app.rentals.service` function, shape the response."""
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from app.api.deps import RawFactoryDep as Factory, SettingsDep
from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.rentals import service
from app.rentals.schemas import (
    CardAttemptDTO, CardAttemptInput, CancellationInput, CancellationPreviewDTO, MemberReceivablePage,
    ReceivablePaymentDTO, ReceivablePaymentInput, RentalAlertPage, RentalAssetDTO, RentalAssetInput,
    RentalAssetPage, RentalAssetPatch, RentalCancellationDTO, RentalCreateInput, RentalDTO, RentalEndInput, RentalPage,
    RentalRenewalInput, RentalTransferReviewDTO, TransferReviewInput,
)

router = APIRouter(prefix="/api/v1/rentals", tags=["rentals"])

def _injected_point_client(request: Request):
    return getattr(request.app.state, "rental_point_client", None)


PointClient = Annotated[object, Depends(_injected_point_client)]
Principal = Annotated[ShiftActorPrincipal, Depends(get_shift_actor_principal)]
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key")]

def _status(response: Response, replayed: bool) -> None:
    response.status_code = 200 if replayed else 201


@router.get("/assets", response_model=RentalAssetPage)
def list_assets(
    branch_id: UUID, principal: Principal, factory: Factory,
    kind: Literal["glove", "locker"] | None = None,
    offset: int = Query(0, ge=0, le=2**63 - 1), limit: int = Query(50, ge=1, le=100),
):
    return service.list_assets(factory, principal, branch_id, kind, offset, limit)


@router.post("/assets", response_model=RentalAssetDTO, status_code=201)
def create_asset(payload: RentalAssetInput, principal: Principal, factory: Factory):
    return service.create_asset(factory, principal, payload)


@router.patch("/assets/{asset_id}", response_model=RentalAssetDTO)
def update_asset(asset_id: UUID, payload: RentalAssetPatch, principal: Principal, factory: Factory):
    return service.update_asset(factory, principal, asset_id, payload)


@router.post("/gloves", response_model=RentalDTO)
def rent_glove(payload: RentalCreateInput, response: Response, principal: Principal, factory: Factory,
               idempotency_key: IdempotencyKey):
    dto, replayed = service.create_rental(factory, principal, "glove", payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.post("/lockers", response_model=RentalDTO)
def assign_locker(payload: RentalCreateInput, response: Response, principal: Principal, factory: Factory,
                  idempotency_key: IdempotencyKey):
    dto, replayed = service.create_rental(factory, principal, "locker", payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.get("/alerts", response_model=RentalAlertPage)
def list_rental_alerts(branch_id: UUID, principal: Principal, factory: Factory):
    return service.list_rental_alerts(factory, principal, branch_id)


@router.post("/alerts/{cancellation_id}/review", response_model=RentalCancellationDTO)
def review_rental_alert(cancellation_id: UUID, principal: Principal, factory: Factory):
    return service.review_rental_alert(factory, principal, cancellation_id)


@router.get("/card-attempts/{attempt_id}", response_model=CardAttemptDTO)
def read_card_attempt(attempt_id: UUID, settings: SettingsDep, client: PointClient,
                      principal: Principal, factory: Factory):
    return service.read_card_attempt(factory, settings, client, principal, attempt_id)


@router.post("/receivables/{payment_id}/review", response_model=RentalTransferReviewDTO)
def review_rental_transfer(payment_id: UUID, payload: TransferReviewInput, principal: Principal,
                           factory: Factory, idempotency_key: IdempotencyKey):
    return service.review_rental_transfer(factory, principal, payment_id, payload.status, idempotency_key)


@router.get("/members/{member_id}/receivables", response_model=MemberReceivablePage)
def member_rental_receivables(member_id: UUID, branch_id: UUID, principal: Principal, factory: Factory):
    return service.member_rental_receivables(factory, principal, member_id, branch_id)


@router.get("", response_model=RentalPage)
def list_rentals(
    branch_id: UUID, principal: Principal, factory: Factory,
    status: Literal["active", "returned", "released", "cancelled"] | None = None,
    kind: Literal["glove", "locker"] | None = None,
    member_id: UUID | None = None,
):
    return service.list_rentals(factory, principal, branch_id, status, kind, member_id)


@router.get("/{rental_id}", response_model=RentalDTO)
def read_rental(rental_id: UUID, principal: Principal, factory: Factory):
    return service.read_rental(factory, principal, rental_id)


@router.post("/{rental_id}/renewals", response_model=RentalDTO)
def renew_rental(rental_id: UUID, payload: RentalRenewalInput, response: Response, principal: Principal,
                 factory: Factory, idempotency_key: IdempotencyKey):
    dto, replayed = service.renew_rental(factory, principal, rental_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.post("/{rental_id}/return", response_model=RentalDTO)
def return_gloves(rental_id: UUID, principal: Principal, factory: Factory, idempotency_key: IdempotencyKey,
                  payload: RentalEndInput | None = None):
    return service.end_rental(factory, principal, rental_id, "return", payload, idempotency_key)


@router.post("/{rental_id}/release", response_model=RentalDTO)
def release_locker(rental_id: UUID, principal: Principal, factory: Factory, idempotency_key: IdempotencyKey,
                   payload: RentalEndInput | None = None):
    return service.end_rental(factory, principal, rental_id, "release", payload, idempotency_key)


@router.post("/{rental_id}/receivable-payments", response_model=ReceivablePaymentDTO)
def record_rental_repayment(rental_id: UUID, payload: ReceivablePaymentInput, response: Response,
                            principal: Principal, factory: Factory, idempotency_key: IdempotencyKey):
    dto, replayed = service.record_rental_repayment(factory, principal, rental_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.get("/{rental_id}/cancellation-preview", response_model=CancellationPreviewDTO)
def preview_rental_cancellation(rental_id: UUID, principal: Principal, factory: Factory):
    return service.preview_rental_cancellation(factory, principal, rental_id)


@router.post("/{rental_id}/cancellation", response_model=RentalCancellationDTO)
def cancel_locker_rental(rental_id: UUID, payload: CancellationInput, response: Response,
                         principal: Principal, factory: Factory, idempotency_key: IdempotencyKey):
    dto, replayed = service.cancel_locker_rental(factory, principal, rental_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.post("/{rental_id}/charges/{charge_id}/card-attempts", response_model=CardAttemptDTO)
def begin_rental_card_attempt(rental_id: UUID, charge_id: UUID, payload: CardAttemptInput, response: Response,
                              settings: SettingsDep, client: PointClient, principal: Principal,
                              factory: Factory, idempotency_key: IdempotencyKey):
    dto, replayed = service.begin_rental_card_attempt(
        factory, settings, client, principal, rental_id, charge_id, payload, idempotency_key)
    _status(response, replayed)
    return dto
