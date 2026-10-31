"""Authenticated rental assets and lifecycle routes."""
from contextlib import contextmanager
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.db.models import Branch, PaymentTerminal, RoleGrant
from app.db.models.rentals import RentalAsset
from app.rentals import queries
from app.rentals.payments import (
    RentalAccessDenied, RentalConflictError, RentalNotFoundError,
    RentalProviderUnavailableError, active_rental_id,
)
from app.rentals.schemas import (
    CardAttemptDTO, CardAttemptInput, CancellationInput, CancellationPreviewDTO, MemberReceivablePage,
    ReceivablePaymentDTO, ReceivablePaymentInput, RentalAlertPage, RentalAssetDTO, RentalAssetInput,
    RentalAssetPage, RentalAssetPatch, RentalCancellationDTO, RentalCreateInput, RentalDTO, RentalPage,
    RentalRenewalInput, RentalTransferReviewDTO, TransferReviewInput,
)
from app.sales.point import MercadoPagoPointHttpClient, PointTerminalClient

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


def _receptionist(session, branch_id: UUID, principal: ShiftActorPrincipal) -> None:
    if principal.is_admin:
        return
    if principal.branch_id != branch_id:
        raise HTTPException(403, "Access restricted to authorized branch.")
    grant = session.scalar(select(RoleGrant.id).where(
        RoleGrant.staff_id == principal.staff_id, RoleGrant.role == "receptionist",
        RoleGrant.scope_kind == "branch", RoleGrant.branch_id == branch_id,
        RoleGrant.is_active.is_(True),
    ))
    if grant is None:
        raise HTTPException(403, "Access restricted to reception staff or admin.")


def _require_rental_receptionist(session, rental_id: UUID, principal: ShiftActorPrincipal):
    rental = session.get(queries.Rental, rental_id)
    if rental is None:
        raise HTTPException(404, "Rental not found.")
    _receptionist(session, rental.branch_id, principal)
    return rental


@contextmanager
def _errors():
    try:
        yield
    except RentalNotFoundError as exc:
        raise HTTPException(404, str(exc)) from None
    except RentalAccessDenied as exc:
        raise HTTPException(403, str(exc)) from None
    except RentalConflictError as exc:
        raise HTTPException(409, str(exc)) from None
    except RentalProviderUnavailableError as exc:
        raise HTTPException(503, str(exc)) from None
    except IntegrityError:
        raise HTTPException(409, "The rental command conflicts with existing data.") from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


def _point_client(request: Request) -> PointTerminalClient:
    injected = getattr(request.app.state, "rental_point_client", None)
    if injected is not None:
        return injected
    settings = request.app.state.settings
    if not settings.mercado_pago_configured:
        raise RentalProviderUnavailableError("Card terminal provider is not configured.")
    return MercadoPagoPointHttpClient(
        access_token=settings.mercado_pago_access_token.get_secret_value()
    )


def _device_id(session, terminal_id: UUID | None, branch_id: UUID) -> str:
    if terminal_id is None:
        return "rental-terminal"
    terminal = session.get(PaymentTerminal, terminal_id)
    if terminal is None or terminal.branch_id != branch_id:
        raise RentalNotFoundError("Payment terminal not found.")
    return terminal.device_id


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
        occupied = queries.active_rentals_by_asset(session, [row.id for row in rows])
        return RentalAssetPage(items=[
            RentalAssetDTO.model_validate(row).model_copy(update={"active_rental_id": occupied.get(row.id)})
            for row in rows
        ], total=total)


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
            if active_rental_id(session, row.id) is not None and payload.model_fields_set - {"price_minor"}:
                raise HTTPException(409, "Occupied rental assets only allow price changes.")
            validated = RentalAssetInput.model_validate({
                **RentalAssetDTO.model_validate(row).model_dump(exclude={"id", "active_rental_id"}),
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


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


def _create_rental(request: Request, payload: RentalCreateInput, kind: str, response: Response,
                   principal: ShiftActorPrincipal, idempotency_key: str) -> RentalDTO:
    with _errors(), _factory(request).begin() as session:
        _receptionist(session, payload.branch_id, principal)
        rental, replayed = queries.create_rental(
            session, kind=kind, branch_id=payload.branch_id, asset_id=payload.asset_id,
            member_id=payload.member_id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            components=payload.components,
            expected_total_minor=payload.expected_total_minor,
            accepted_shortfall_minor=payload.accepted_shortfall_minor,
            idempotency_key=idempotency_key,
        )
        response.status_code = 200 if replayed else 201
        return queries.rental_dto(session, rental)


@router.post("/gloves", response_model=RentalDTO)
def rent_glove(payload: RentalCreateInput, request: Request, response: Response,
               principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
               idempotency_key: str = Header(..., alias="Idempotency-Key")):
    return _create_rental(request, payload, "glove", response, principal, idempotency_key)


@router.post("/lockers", response_model=RentalDTO)
def assign_locker(payload: RentalCreateInput, request: Request, response: Response,
                  principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
                  idempotency_key: str = Header(..., alias="Idempotency-Key")):
    return _create_rental(request, payload, "locker", response, principal, idempotency_key)


@router.get("/alerts", response_model=RentalAlertPage)
def list_rental_alerts(
    request: Request, branch_id: UUID,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    _admin(principal)
    with _errors(), _factory(request)() as session:
        _branch(session, branch_id, principal)
        rows = queries.list_alerts(session, branch_id=branch_id, authorized_branch_id=principal.branch_id)
        return RentalAlertPage(items=[queries.cancellation_dto(session, row) for row in rows], total=len(rows))


@router.post("/alerts/{cancellation_id}/review", response_model=RentalCancellationDTO)
def review_rental_alert(
    cancellation_id: UUID, request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    _admin(principal)
    with _errors(), _factory(request).begin() as session:
        cancellation = queries.review_alert(
            session, cancellation_id=cancellation_id, actor_id=principal.staff_id)
        _branch(session, cancellation.branch_id, principal)
        return queries.cancellation_dto(session, cancellation)


@router.get("/card-attempts/{attempt_id}", response_model=CardAttemptDTO)
def read_card_attempt(
    attempt_id: UUID, request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    factory = _factory(request)
    with _errors(), factory() as session:
        attempt = queries.get_card_attempt(
            session, attempt_id=attempt_id, authorized_branch_id=principal.branch_id)
        _receptionist(session, attempt.branch_id, principal)
        snapshot = queries.card_attempt_dto(attempt)
        provider_intent_id = attempt.provider_intent_id
        device_id = _device_id(session, attempt.terminal_id, attempt.branch_id)
    if snapshot.status != "pending" or not provider_intent_id:
        return snapshot
    with _errors():
        client = _point_client(request)
    provider = client.get_payment_intent_status(device_id, provider_intent_id)
    with _errors(), factory.begin() as session:
        attempt = queries.apply_card_attempt(
            session, attempt_id=attempt_id, provider_status=provider.status,
            authorization_code=provider.authorization_code, card_brand=provider.card_brand,
            card_last_four=provider.last_four_digits, provider_payment_id=provider.id,
            provider_amount_minor=provider.amount_minor,
        )
        return queries.card_attempt_dto(attempt)


@router.post("/receivables/{payment_id}/review", response_model=RentalTransferReviewDTO)
def review_rental_transfer(
    payment_id: UUID, payload: TransferReviewInput, request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    _admin(principal)
    with _errors(), _factory(request).begin() as session:
        payment, rental_id, replayed = queries.review_rental_transfer(
            session, payment_id=payment_id, actor_id=principal.staff_id,
            status=payload.status, idempotency_key=idempotency_key,
        )
        return RentalTransferReviewDTO(
            payment_id=payment.id,
            rental_id=rental_id,
            status=payment.status,
            amount_minor=payment.amount_minor,
        )


@router.get("/members/{member_id}/receivables", response_model=MemberReceivablePage)
def member_rental_receivables(
    member_id: UUID, request: Request, branch_id: UUID,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    with _errors(), _factory(request)() as session:
        _receptionist(session, branch_id, principal)
        items = queries.member_receivables(
            session, member_id=member_id, branch_id=branch_id,
            authorized_branch_id=principal.branch_id)
        return MemberReceivablePage(
            items=items, total_outstanding_minor=sum(item.outstanding_minor for item in items))


@router.get("", response_model=RentalPage)
def list_rentals(
    request: Request, branch_id: UUID,
    status: Literal["active", "returned", "released", "cancelled"] | None = None,
    kind: Literal["glove", "locker"] | None = None,
    member_id: UUID | None = None,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    with _errors(), _factory(request)() as session:
        _receptionist(session, branch_id, principal)
        rows = queries.list_rentals(
            session, branch_id=branch_id, status=status, kind=kind, member_id=member_id,
            authorized_branch_id=principal.branch_id)
        return RentalPage(items=[queries.rental_dto(session, row) for row in rows], total=len(rows))


@router.get("/{rental_id}", response_model=RentalDTO)
def read_rental(
    rental_id: UUID, request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    with _errors(), _factory(request)() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        return queries.rental_dto(session, rental)


@router.post("/{rental_id}/renewals", response_model=RentalDTO)
def renew_rental(
    rental_id: UUID, payload: RentalRenewalInput, request: Request, response: Response,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    with _errors(), _factory(request).begin() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        rental, replayed = queries.renew_rental(
            session, rental_id=rental.id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            components=payload.components,
            expected_total_minor=payload.expected_total_minor,
            accepted_shortfall_minor=payload.accepted_shortfall_minor,
            idempotency_key=idempotency_key,
        )
        response.status_code = 200 if replayed else 201
        return queries.rental_dto(session, rental)


@router.post("/{rental_id}/return", response_model=RentalDTO)
def return_gloves(
    rental_id: UUID, request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    with _errors(), _factory(request).begin() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        rental = queries.end_rental(
            session, rental_id=rental.id, actor_id=principal.staff_id,
            authorized_branch_id=principal.branch_id, action="return")
        return queries.rental_dto(session, rental)


@router.post("/{rental_id}/release", response_model=RentalDTO)
def release_locker(
    rental_id: UUID, request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    with _errors(), _factory(request).begin() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        rental = queries.end_rental(
            session, rental_id=rental.id, actor_id=principal.staff_id,
            authorized_branch_id=principal.branch_id, action="release")
        return queries.rental_dto(session, rental)


@router.post("/{rental_id}/receivable-payments", response_model=ReceivablePaymentDTO)
def record_rental_repayment(
    rental_id: UUID, payload: ReceivablePaymentInput, request: Request, response: Response,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    with _errors(), _factory(request).begin() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        receipt, replayed = queries.record_receivable_payment(
            session, rental_id=rental.id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            method=payload.method, amount_minor=payload.amount_minor,
            idempotency_key=idempotency_key,
        )
        response.status_code = 200 if replayed else 201
        return queries.receivable_dto(session, receipt)


@router.get("/{rental_id}/cancellation-preview", response_model=CancellationPreviewDTO)
def preview_rental_cancellation(
    rental_id: UUID, request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    with _errors(), _factory(request)() as session:
        _require_rental_receptionist(session, rental_id, principal)
        return queries.preview_cancellation(
            session, rental_id=rental_id, authorized_branch_id=principal.branch_id)


@router.post("/{rental_id}/cancellation", response_model=RentalCancellationDTO)
def cancel_locker_rental(
    rental_id: UUID, payload: CancellationInput, request: Request, response: Response,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    with _errors(), _factory(request).begin() as session:
        _require_rental_receptionist(session, rental_id, principal)
        cancellation, replayed = queries.confirm_cancellation(
            session, rental_id=rental_id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            preview_token=payload.preview_token, refund_amount_minor=payload.refund_amount_minor,
            refund_method=payload.refund_method, reason=payload.reason,
            idempotency_key=idempotency_key,
        )
        response.status_code = 200 if replayed else 201
        return queries.cancellation_dto(session, cancellation)


@router.post("/{rental_id}/charges/{charge_id}/card-attempts", response_model=CardAttemptDTO)
def begin_rental_card_attempt(
    rental_id: UUID, charge_id: UUID, payload: CardAttemptInput, request: Request, response: Response,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    with _errors():
        client = _point_client(request)
    factory = _factory(request)
    with _errors(), factory() as session:
        _require_rental_receptionist(session, rental_id, principal)
        attempt, replayed = queries.begin_card_attempt(
            session, rental_id=rental_id, charge_id=charge_id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            amount_minor=payload.amount_minor, terminal_id=payload.terminal_id,
            idempotency_key=idempotency_key,
        )
        device_id = _device_id(session, attempt.terminal_id, attempt.branch_id)
        attempt_id = attempt.id
        attempted_amount = attempt.amount_minor
        already_bound = attempt.provider_intent_id is not None
        snapshot = queries.card_attempt_dto(attempt)
        session.commit()
    if replayed and already_bound:
        response.status_code = 200
        return snapshot
    try:
        provider = client.create_payment_intent(device_id, attempted_amount, f"rental:{attempt_id}")
    except Exception:
        with factory.begin() as session:
            queries.apply_card_attempt(
                session, attempt_id=attempt_id, provider_status="FAILED")
        raise HTTPException(502, "Card terminal provider did not accept the attempt.") from None
    with factory.begin() as session:
        bound = session.get(queries.RentalCardAttempt, attempt_id)
        if bound is not None:
            bound.provider_intent_id = provider.id
            session.flush()
        response.status_code = 200 if replayed else 201
        return queries.card_attempt_dto(bound)
