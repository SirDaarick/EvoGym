"""Rental use cases: branch/receptionist checks, orchestration, commits and the card-terminal flow.

SQL lives in `app.rentals.queries`; HTTP transport lives in `app.api.rentals`. Failures are raised as
`AppError`s (never HTTPException). Use cases take the session `factory` (None when the database is
not configured -> 503) because each opens its own transaction(s).
"""
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.errors import HttpStatusError, http_errors, session_factory
from app.rentals import queries as q
from app.rentals.payments import (
    RentalAccessDenied, RentalConflictError, RentalNotFoundError, RentalProviderUnavailableError,
    active_rental_id,
)
from app.rentals.schemas import (
    CardAttemptDTO, MemberReceivablePage, RentalAlertPage, RentalAssetDTO, RentalAssetInput,
    RentalAssetPage, RentalPage, RentalTransferReviewDTO,
)
from app.sales.point import MercadoPagoPointHttpClient, PointTerminalClient

_ERRORS = (
    (RentalNotFoundError, 404), (RentalAccessDenied, 403), (RentalConflictError, 409),
    (RentalProviderUnavailableError, 503), (IntegrityError, 409), (ValueError, 422),
)


def _branch(session, branch_id: UUID, principal):
    if not principal.is_admin and principal.branch_id != branch_id:
        raise HttpStatusError(403)
    branch = q.get_branch(session, branch_id)
    if branch is None or not branch.is_active:
        raise HttpStatusError(404)
    return branch


def _admin(principal) -> None:
    if not principal.is_admin:
        raise HttpStatusError(403)


def require_receptionist(session, branch_id: UUID, principal) -> None:
    if principal.is_admin:
        return
    if principal.branch_id != branch_id:
        raise HttpStatusError(403)
    if q.receptionist_grant_id(session, staff_id=principal.staff_id, branch_id=branch_id) is None:
        raise HttpStatusError(403)


def _require_rental_receptionist(session, rental_id: UUID, principal):
    rental = q.get_rental(session, rental_id)
    if rental is None:
        raise HttpStatusError(404)
    require_receptionist(session, rental.branch_id, principal)
    return rental


def _point_client(settings, injected) -> PointTerminalClient:
    if injected is not None:
        return injected
    if settings is None or not settings.mercado_pago_configured:
        raise RentalProviderUnavailableError("Card terminal provider is not configured.")
    return MercadoPagoPointHttpClient(access_token=settings.mercado_pago_access_token.get_secret_value())


def _device_id(session, terminal_id: UUID | None, branch_id: UUID) -> str:
    if terminal_id is None:
        return "rental-terminal"
    terminal = q.get_terminal(session, terminal_id)
    if terminal is None or terminal.branch_id != branch_id:
        raise RentalNotFoundError("Payment terminal not found.")
    return terminal.device_id


# --- assets ----------------------------------------------------------------------------------

def list_assets(factory, principal, branch_id: UUID, kind, offset: int, limit: int) -> RentalAssetPage:
    with session_factory(factory)() as session:
        _branch(session, branch_id, principal)
        rows, total = q.list_assets(session, branch_id=branch_id, kind=kind, offset=offset, limit=limit)
        occupied = q.active_rentals_by_asset(session, [row.id for row in rows])
        return RentalAssetPage(items=[
            RentalAssetDTO.model_validate(row).model_copy(update={"active_rental_id": occupied.get(row.id)})
            for row in rows
        ], total=total)


def create_asset(factory, principal, payload) -> RentalAssetDTO:
    _admin(principal)
    try:
        with session_factory(factory).begin() as session:
            _branch(session, payload.branch_id, principal)
            row = q.add_asset(session, values=payload.model_dump(), created_by=principal.staff_id)
            return RentalAssetDTO.model_validate(row)
    except IntegrityError:
        raise HttpStatusError(409) from None


def update_asset(factory, principal, asset_id: UUID, payload) -> RentalAssetDTO:
    _admin(principal)
    try:
        with session_factory(factory).begin() as session:
            row = q.lock_asset_row(session, asset_id)
            if row is None:
                raise HttpStatusError(404)
            _branch(session, row.branch_id, principal)
            if active_rental_id(session, row.id) is not None and payload.model_fields_set - {"price_minor"}:
                raise HttpStatusError(409)
            validated = RentalAssetInput.model_validate({
                **RentalAssetDTO.model_validate(row).model_dump(exclude={"id", "active_rental_id"}),
                **payload.model_dump(exclude_unset=True),
            })
            for key in payload.model_fields_set:
                setattr(row, key, getattr(validated, key))
            session.flush()
            return RentalAssetDTO.model_validate(row)
    except IntegrityError:
        raise HttpStatusError(409) from None
    except ValidationError:
        raise HttpStatusError(422) from None


# --- lifecycle -------------------------------------------------------------------------------

def create_rental(factory, principal, kind: str, payload, idempotency_key: str):
    with http_errors(*_ERRORS), session_factory(factory).begin() as session:
        require_receptionist(session, payload.branch_id, principal)
        rental, replayed = q.create_rental(
            session, kind=kind, branch_id=payload.branch_id, asset_id=payload.asset_id,
            member_id=payload.member_id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            components=payload.components,
            expected_total_minor=payload.expected_total_minor,
            accepted_shortfall_minor=payload.accepted_shortfall_minor,
            expected_deposit_minor=payload.expected_deposit_minor,
            idempotency_key=idempotency_key,
        )
        return q.rental_dto(session, rental), replayed


def list_rental_alerts(factory, principal, branch_id: UUID) -> RentalAlertPage:
    _admin(principal)
    with http_errors(*_ERRORS), session_factory(factory)() as session:
        _branch(session, branch_id, principal)
        rows = q.list_alerts(session, branch_id=branch_id, authorized_branch_id=principal.branch_id)
        return RentalAlertPage(items=[q.cancellation_dto(session, row) for row in rows], total=len(rows))


def review_rental_alert(factory, principal, cancellation_id: UUID):
    _admin(principal)
    with http_errors(*_ERRORS), session_factory(factory).begin() as session:
        cancellation = q.review_alert(session, cancellation_id=cancellation_id, actor_id=principal.staff_id)
        _branch(session, cancellation.branch_id, principal)
        return q.cancellation_dto(session, cancellation)


def read_card_attempt(factory, settings, injected_client, principal, attempt_id: UUID) -> CardAttemptDTO:
    factory = session_factory(factory)
    with http_errors(*_ERRORS), factory() as session:
        attempt = q.get_card_attempt(session, attempt_id=attempt_id, authorized_branch_id=principal.branch_id)
        require_receptionist(session, attempt.branch_id, principal)
        snapshot = q.card_attempt_dto(attempt)
        provider_intent_id = attempt.provider_intent_id
        device_id = _device_id(session, attempt.terminal_id, attempt.branch_id)
    if snapshot.status != "pending" or not provider_intent_id:
        return snapshot
    with http_errors(*_ERRORS):
        client = _point_client(settings, injected_client)
    provider = client.get_payment_intent_status(device_id, provider_intent_id)
    with http_errors(*_ERRORS), factory.begin() as session:
        attempt = q.apply_card_attempt(
            session, attempt_id=attempt_id, provider_status=provider.status,
            authorization_code=provider.authorization_code, card_brand=provider.card_brand,
            card_last_four=provider.last_four_digits, provider_payment_id=provider.id,
            provider_amount_minor=provider.amount_minor,
        )
        return q.card_attempt_dto(attempt)


def review_rental_transfer(factory, principal, payment_id: UUID, status, idempotency_key: str):
    _admin(principal)
    with http_errors(*_ERRORS), session_factory(factory).begin() as session:
        payment, rental_id, _replayed = q.review_rental_transfer(
            session, payment_id=payment_id, actor_id=principal.staff_id,
            status=status, idempotency_key=idempotency_key,
        )
        return RentalTransferReviewDTO(
            payment_id=payment.id, rental_id=rental_id, status=payment.status,
            amount_minor=payment.amount_minor,
        )


def member_rental_receivables(factory, principal, member_id: UUID, branch_id: UUID) -> MemberReceivablePage:
    with http_errors(*_ERRORS), session_factory(factory)() as session:
        require_receptionist(session, branch_id, principal)
        items = q.member_receivables(
            session, member_id=member_id, branch_id=branch_id, authorized_branch_id=principal.branch_id)
        return MemberReceivablePage(
            items=items, total_outstanding_minor=sum(item.outstanding_minor for item in items))


def list_rentals(factory, principal, branch_id: UUID, status, kind, member_id):
    with http_errors(*_ERRORS), session_factory(factory)() as session:
        require_receptionist(session, branch_id, principal)
        rows = q.list_rentals(
            session, branch_id=branch_id, status=status, kind=kind, member_id=member_id,
            authorized_branch_id=principal.branch_id)
        return RentalPage(items=[q.rental_dto(session, row) for row in rows], total=len(rows))


def read_rental(factory, principal, rental_id: UUID):
    with http_errors(*_ERRORS), session_factory(factory)() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        return q.rental_dto(session, rental)


def renew_rental(factory, principal, rental_id: UUID, payload, idempotency_key: str):
    with http_errors(*_ERRORS), session_factory(factory).begin() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        rental, replayed = q.renew_rental(
            session, rental_id=rental.id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            components=payload.components,
            expected_total_minor=payload.expected_total_minor,
            accepted_shortfall_minor=payload.accepted_shortfall_minor,
            idempotency_key=idempotency_key,
        )
        return q.rental_dto(session, rental), replayed


def end_rental(factory, principal, rental_id: UUID, action: str, payload=None, idempotency_key: str | None = None):
    with http_errors(*_ERRORS), session_factory(factory).begin() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        rental = q.end_rental(
            session, rental_id=rental.id, actor_id=principal.staff_id,
            authorized_branch_id=principal.branch_id, action=action,
            register_id=payload.register_id if payload else None,
            deposit_refund_minor=payload.deposit_refund_minor if payload else None,
            reason=payload.reason if payload else None, idempotency_key=idempotency_key)
        return q.rental_dto(session, rental)


def record_rental_repayment(factory, principal, rental_id: UUID, payload, idempotency_key: str):
    with http_errors(*_ERRORS), session_factory(factory).begin() as session:
        rental = _require_rental_receptionist(session, rental_id, principal)
        receipt, replayed = q.record_receivable_payment(
            session, rental_id=rental.id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            method=payload.method, amount_minor=payload.amount_minor,
            idempotency_key=idempotency_key,
        )
        return q.receivable_dto(session, receipt), replayed


def preview_rental_cancellation(factory, principal, rental_id: UUID):
    with http_errors(*_ERRORS), session_factory(factory)() as session:
        _require_rental_receptionist(session, rental_id, principal)
        return q.preview_cancellation(session, rental_id=rental_id, authorized_branch_id=principal.branch_id)


def cancel_locker_rental(factory, principal, rental_id: UUID, payload, idempotency_key: str):
    with http_errors(*_ERRORS), session_factory(factory).begin() as session:
        _require_rental_receptionist(session, rental_id, principal)
        cancellation, replayed = q.confirm_cancellation(
            session, rental_id=rental_id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            preview_token=payload.preview_token, refund_amount_minor=payload.refund_amount_minor,
            refund_method=payload.refund_method, reason=payload.reason,
            idempotency_key=idempotency_key,
        )
        return q.cancellation_dto(session, cancellation), replayed


def begin_rental_card_attempt(factory, settings, injected_client, principal, rental_id: UUID,
                              charge_id: UUID, payload, idempotency_key: str):
    """Returns (dto, replayed); three transactions around the terminal call keep the original boundaries."""
    with http_errors(*_ERRORS):
        client = _point_client(settings, injected_client)
    factory = session_factory(factory)
    with http_errors(*_ERRORS), factory() as session:
        _require_rental_receptionist(session, rental_id, principal)
        attempt, replayed = q.begin_card_attempt(
            session, rental_id=rental_id, charge_id=charge_id, register_id=payload.register_id,
            actor_id=principal.staff_id, authorized_branch_id=principal.branch_id,
            amount_minor=payload.amount_minor, terminal_id=payload.terminal_id,
            idempotency_key=idempotency_key,
        )
        device_id = _device_id(session, attempt.terminal_id, attempt.branch_id)
        attempt_id = attempt.id
        attempted_amount = attempt.amount_minor
        already_bound = attempt.provider_intent_id is not None
        snapshot = q.card_attempt_dto(attempt)
        session.commit()
    if replayed and already_bound:
        return snapshot, True
    try:
        provider = client.create_payment_intent(device_id, attempted_amount, f"rental:{attempt_id}")
    except Exception:
        with factory.begin() as session:
            q.apply_card_attempt(session, attempt_id=attempt_id, provider_status="FAILED")
        raise HttpStatusError(502) from None
    with factory.begin() as session:
        bound = q.bind_provider_intent(session, attempt_id=attempt_id, provider_intent_id=provider.id)
        return q.card_attempt_dto(bound), replayed
