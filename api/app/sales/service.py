"""Sales use cases: permissions, orchestration, commits and idempotency reconciliation.

SQL lives in `app.sales.queries`; HTTP transport lives in `app.api.sales`. Failures are
raised as typed `AppError`s (never HTTPException). Rule: a use case takes a `factory` when it
may need a second transaction (idempotency reconciliation, the Point terminal call between DB
steps); read-only or single-shot ones take a `session`.
"""
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.credit.queries import CreditConflictError, credit_applied_for_order, ensure_credit_available
from app.db.models import ProductSaleIntent, ProductSaleResolution
from app.errors import AppError, HttpStatusError, http_errors
from app.sales import queries as q
from app.sales.point import PointTerminalUnavailable, get_point_client
from app.sales.queries import (
    CashSaleAccessDenied, CashSaleConflictError, CashSaleNotFoundError, InvalidBranchTimezoneError,
    ProductReturnNotFoundError, ProductSaleIdempotencyConflict, ProductSaleRejected,
)
from app.sales.schemas import (
    CardIntentResponse, CashMembershipSaleDTO, CashProductSaleDTO, CashProductSaleRequest, CashSaleItemDTO, CashSaleOrderDTO,
    CashSalePaymentDTO, ClassSampleEntitlementDTO, MembershipDebtPaymentDTO, MembershipPeriodDTO,
    ProductRefundDTO, ProductSaleItemDTO, ProductSaleOrderDTO, ProductSalePaymentDTO,
)


class Principal(Protocol):
    staff_id: UUID
    branch_id: UUID
    is_admin: bool


_SALE_ERRORS = (
    (CashSaleNotFoundError, 404), (CashSaleAccessDenied, 403), (CashSaleConflictError, 409),
    (CreditConflictError, 409), (InvalidBranchTimezoneError, 409), (ValueError, 422),
)
_PRODUCT_ERRORS = ((CashSaleNotFoundError, 404), (AppError, None), (CreditConflictError, 409), (ValueError, 422))
_RETURN_ERRORS = ((ProductReturnNotFoundError, 404), (InvalidBranchTimezoneError, 409))


# --- shared guards -------------------------------------------------------------------------

def _require_product_sales_access(session, principal: Principal) -> None:
    if not principal.is_admin and q.lock_receptionist_grant(
        session, staff_id=principal.staff_id, branch_id=principal.branch_id
    ) is None:
        raise HttpStatusError(403)


def _require_register(session, principal: Principal, register_id: UUID):
    register = q.get_register(session, register_id)
    if register is None:
        raise HttpStatusError(404)
    if not principal.is_admin and register.branch_id != principal.branch_id:
        raise HttpStatusError(403)
    return register


def _authorized_branch(principal: Principal):
    return None if principal.is_admin else principal.branch_id


def _intent_response(intent):
    return None if intent is None else {"key": intent.idempotency_key,
        "registerId": str(intent.register_id), "payload": intent.payload}


# --- DTO assembly ----------------------------------------------------------------------------

def _product_sale_dto(order, session) -> CashProductSaleDTO:
    return CashProductSaleDTO(
        order=ProductSaleOrderDTO.model_validate(order),
        items=[ProductSaleItemDTO.model_validate(item) for item in order.items],
        payment=ProductSalePaymentDTO.model_validate(order.payment),
        credit_applied_minor=credit_applied_for_order(session, order.id),
    )


def _sale_dto(result) -> CashMembershipSaleDTO:
    order, item, payment = result.order, result.item, result.payment
    membership, sample_entitlement = result.membership, result.sample_entitlement
    return CashMembershipSaleDTO(
        order=CashSaleOrderDTO(
            id=order.id, branch_id=order.branch_id, register_id=order.register_id,
            shift_id=order.shift_id, member_id=order.member_id, seller_id=order.seller_id,
            financial_shift_id=order.financial_shift_id, is_overtime=order.is_overtime,
            cash_included_in_opening=order.cash_included_in_opening,
            currency=order.currency, total_minor=order.total_minor, created_at=order.created_at,
        ),
        item=CashSaleItemDTO(
            id=item.id, plan_version_id=item.plan_version_id, description_snapshot=item.description_snapshot,
            duration_value=item.duration_value, duration_unit=item.duration_unit,
            entitlement_mode=item.entitlement_mode, quantity=item.quantity,
            unit_amount_minor=item.unit_amount_minor, line_total_minor=item.line_total_minor,
        ),
        payment=CashSalePaymentDTO(
            id=payment.id, method=payment.method, status=payment.status, amount_minor=payment.amount_minor,
            received_by=payment.received_by, received_at=payment.received_at,
        ),
        membership=MembershipPeriodDTO(
            id=membership.id, member_id=membership.member_id, plan_version_id=membership.plan_version_id,
            starts_on=membership.starts_on, ends_on=membership.ends_on, activated_by=membership.activated_by,
            created_at=membership.created_at,
        ) if membership is not None else None,
        sample_entitlement=ClassSampleEntitlementDTO(
            id=sample_entitlement.id, member_id=sample_entitlement.member_id,
            order_item_id=sample_entitlement.order_item_id, plan_version_id=sample_entitlement.plan_version_id,
            created_at=sample_entitlement.created_at,
        ) if sample_entitlement is not None else None,
        credit_applied_minor=result.credit_applied_minor,
    )


def _debt_payment_dto(receipt) -> MembershipDebtPaymentDTO:
    return MembershipDebtPaymentDTO(
        id=receipt.id, debt_id=receipt.debt_id, order_id=receipt.order_id, member_id=receipt.member_id,
        branch_id=receipt.branch_id, register_id=receipt.register_id, shift_id=receipt.shift_id,
        amount_minor=receipt.amount_minor, credit_minor=receipt.credit_minor,
        remaining_after_minor=receipt.remaining_after_minor,
        received_by=receipt.received_by, created_at=receipt.created_at,
    )


def _card_intent_response(intent) -> CardIntentResponse:
    return CardIntentResponse(
        id=intent.id, payment_intent_id=intent.id, device_id=intent.device_id,
        amount_minor=intent.amount_minor, status=intent.status,
        authorization_code=intent.authorization_code, card_brand=intent.card_brand,
        last_four_digits=intent.last_four_digits,
    )


def _replay_winner(factory, register_id, find, expected_fingerprint, build):
    """Call from `except IntegrityError`: replay the row that won the idempotency key, else 409.

    `find(session, register)` returns the winner (or None); `build(session, row)` makes the
    replay result and may raise. Re-raises the IntegrityError when there is no winner.
    """
    with factory() as session:
        register = q.get_register(session, register_id)
        if register is None:
            raise
        row = find(session, register)
        if row is None:
            raise
        if row.request_fingerprint != expected_fingerprint:
            raise HttpStatusError(409) from None
        return build(session, row), True


def _find_order(principal, idempotency_key):
    return lambda session, register: q.find_order_by_key(
        session, branch_id=register.branch_id, seller_id=principal.staff_id, idempotency_key=idempotency_key)


# --- cash product sales ------------------------------------------------------------------------

def get_product_sale_intent(factory, principal: Principal):
    with factory() as session:
        _require_product_sales_access(session, principal)
        return _intent_response(session.get(ProductSaleIntent, principal.staff_id))


def _cash_amount_args(payload: CashProductSaleRequest) -> tuple[int | None, bool]:
    provided = "cash_amount_minor" in payload.model_fields_set
    if provided and payload.cash_amount_minor is None:
        raise HttpStatusError(422)
    return payload.cash_amount_minor, provided


def prepare_product_sale(factory, principal: Principal, register_id: UUID, payload, idempotency_key: str):
    cash_amount_minor, cash_amount_provided = _cash_amount_args(payload)
    with http_errors((CashSaleNotFoundError, 404), (CashSaleConflictError, 409), (ValueError, 422)):
        with factory() as session:
            _require_product_sales_access(session, principal)
            intent = q.prepare_product_sale(
                session, register_id=register_id, actor_id=principal.staff_id, member_id=payload.member_id,
                items=payload.items, expected_total_minor=payload.expected_total_minor,
                idempotency_key=idempotency_key, credit_minor=payload.credit_minor,
                cash_amount_minor=cash_amount_minor, cash_amount_provided=cash_amount_provided)
            result = _intent_response(intent)
            session.commit()
            return result


def _fingerprint_of(register_id, payload):
    cash_amount_minor, _ = _cash_amount_args(payload)
    return q.product_sale_fingerprint(
        register_id, payload.member_id, payload.items, payload.expected_total_minor, payload.credit_minor,
        cash_amount_minor)


def post_cash_product_sale(factory, principal: Principal, register_id: UUID, payload, idempotency_key: str):
    """Returns (dto, replayed)."""
    cash_amount_minor, cash_amount_provided = _cash_amount_args(payload)
    try:
        with http_errors(*_PRODUCT_ERRORS):
            with factory() as session:
                _require_product_sales_access(session, principal)
                q.lock_staff_key_share(session, principal.staff_id)
                intent = session.get(ProductSaleIntent, principal.staff_id)
                fingerprint = _fingerprint_of(register_id, payload)
                if (intent is not None and intent.idempotency_key == idempotency_key
                        and (intent.register_id != register_id or intent.request_fingerprint != fingerprint)):
                    raise ProductSaleIdempotencyConflict
                if intent is None or intent.register_id != register_id or intent.idempotency_key != idempotency_key:
                    raise ProductSaleRejected
                order, replayed = q.post_cash_product_sale(
                    session, register_id=register_id, actor_id=principal.staff_id, member_id=payload.member_id,
                    items=payload.items, expected_total_minor=payload.expected_total_minor,
                    idempotency_key=idempotency_key, credit_minor=payload.credit_minor,
                    cash_amount_minor=cash_amount_minor, cash_amount_provided=cash_amount_provided)
                session.commit()
                return _product_sale_dto(order, session), replayed
    except IntegrityError:
        def build(session, order):
            if order.order_kind != "product":
                raise HttpStatusError(409) from None
            return _product_sale_dto(order, session)
        return _replay_winner(factory, register_id, _find_order(principal, idempotency_key),
                              _fingerprint_of(register_id, payload), build)


def resolve_product_sale(factory, principal: Principal, register_id: UUID, payload, idempotency_key: str):
    cash_amount_minor, cash_amount_provided = _cash_amount_args(payload)
    with http_errors((CashSaleNotFoundError, 404), (CashSaleConflictError, 409), (ValueError, 422)):
        with factory() as session:
            _require_product_sales_access(session, principal)
            order = q.resolve_product_sale(
                session, register_id=register_id, actor_id=principal.staff_id, member_id=payload.member_id,
                items=payload.items, expected_total_minor=payload.expected_total_minor,
                idempotency_key=idempotency_key, credit_minor=payload.credit_minor,
                cash_amount_minor=cash_amount_minor, cash_amount_provided=cash_amount_provided)
            intent = session.get(ProductSaleIntent, principal.staff_id)
            if (intent is not None and intent.register_id == register_id
                    and intent.idempotency_key == idempotency_key
                    and intent.request_fingerprint == _fingerprint_of(register_id, payload)):
                session.delete(intent)
            result = {"status": "cancelled"} if order is None else {
                "status": "completed", "order_id": str(order.id), "total_minor": order.total_minor}
            session.commit()
            return result


def resolve_intent_as_admin(session, admin_id: UUID, seller_id: UUID, intent: ProductSaleIntent) -> dict:
    """Admin resolution of a seller's pending intent inside the caller's transaction (caller commits)."""
    payload = CashProductSaleRequest.model_validate(intent.payload)
    cash_amount_minor, cash_amount_provided = _cash_amount_args(payload)
    order = q.resolve_product_sale(
        session, register_id=intent.register_id, actor_id=seller_id, member_id=payload.member_id,
        items=payload.items, expected_total_minor=payload.expected_total_minor,
        idempotency_key=intent.idempotency_key, credit_minor=payload.credit_minor,
        cash_amount_minor=cash_amount_minor, cash_amount_provided=cash_amount_provided)
    result = "completed" if order is not None else "cancelled"
    session.add(ProductSaleResolution(actor_id=admin_id, seller_id=seller_id, register_id=intent.register_id,
                                      idempotency_key=intent.idempotency_key, result=result))
    session.delete(intent)
    return {"status": result, "order_id": str(order.id) if order else None}


# --- card (Mercado Pago Point) flow --------------------------------------------------------------

@dataclass(frozen=True)
class _CardContext:
    """Plain values copied out of the short phase-A session (no ORM objects)."""
    device_id: str
    terminal_id: UUID | None
    replay: CashProductSaleDTO | None = None


def _point_client(settings):
    try:
        return get_point_client(settings)
    except PointTerminalUnavailable:
        raise HttpStatusError(503) from None


def _terminal_for_register(session, register, settings):
    terminal = q.find_active_terminal(session, register)
    if terminal is None:
        if settings is None or not settings.point_mock_allowed:
            raise HttpStatusError(503)
        terminal = q.create_mock_terminal(session, register)
    return terminal


def _load_card_context(factory, settings, principal: Principal, register_id: UUID, replay_check=None) -> _CardContext:
    """Phase A: short session that validates access/register/terminal, then closes.

    Nothing (connection, transaction, row lock) stays open once this returns, so the
    caller can talk to Mercado Pago without holding database resources.
    """
    with factory() as session:
        _require_product_sales_access(session, principal)
        register = _require_register(session, principal, register_id)
        replay = replay_check(session, register) if replay_check is not None else None
        if replay is not None:
            return _CardContext(device_id="", terminal_id=None, replay=replay)
        terminal = _terminal_for_register(session, register, settings)
        context = _CardContext(device_id=terminal.device_id, terminal_id=terminal.id)
        session.commit()
        return context


def create_card_intent(factory, settings, principal: Principal, register_id: UUID, payload) -> CardIntentResponse:
    context = _load_card_context(factory, settings, principal, register_id)
    client = _point_client(settings)
    try:
        intent = client.create_payment_intent(
            device_id=context.device_id, amount_minor=payload.amount_minor,
            external_reference=payload.external_reference)
    except Exception as exc:
        raise HttpStatusError(502) from exc
    return _card_intent_response(intent)


def get_card_intent_status(factory, settings, principal: Principal, register_id: UUID, intent_id: str) -> CardIntentResponse:
    context = _load_card_context(factory, settings, principal, register_id)
    client = _point_client(settings)
    try:
        intent = client.get_payment_intent_status(device_id=context.device_id, payment_intent_id=intent_id)
    except ValueError as exc:
        raise HttpStatusError(404) from exc
    except Exception as exc:
        raise HttpStatusError(502) from exc
    return _card_intent_response(intent)


def cancel_card_intent(factory, settings, principal: Principal, register_id: UUID, intent_id: str) -> dict:
    context = _load_card_context(factory, settings, principal, register_id)
    client = _point_client(settings)
    try:
        cancelled = client.cancel_payment_intent(device_id=context.device_id, payment_intent_id=intent_id)
    except Exception as exc:
        raise HttpStatusError(502) from exc
    return {"cancelled": cancelled, "payment_intent_id": intent_id}


def post_card_product_sale(factory, settings, principal: Principal, register_id: UUID, payload, idempotency_key: str):
    """Returns (dto, replayed). Three phases so no DB resource is held across the terminal call."""
    def replay_check(session, register):
        existing = q.find_order_by_key(session, branch_id=register.branch_id, seller_id=principal.staff_id,
                                       idempotency_key=idempotency_key)
        if existing is None:
            if payload.credit_minor:  # fail before the card is charged, not after
                ensure_credit_available(session, payload.member_id, payload.credit_minor)
            return None
        if existing.request_fingerprint != _fingerprint_of(register_id, payload) or existing.order_kind != "product":
            raise ProductSaleIdempotencyConflict("Idempotency key was already used for a different request.")
        return _product_sale_dto(existing, session)

    with http_errors(*_PRODUCT_ERRORS):
        if payload.credit_minor >= payload.expected_total_minor > 0 or (
                payload.credit_minor and payload.expected_total_minor == 0):
            raise HttpStatusError(409)  # credit covering the whole total needs no card charge
        # Phase A: short session, closed before any Mercado Pago call.
        context = _load_card_context(factory, settings, principal, register_id, replay_check)
        if context.replay is not None:
            return context.replay, True

        # Phase B0: terminal verification with no DB session or lock held.
        client = _point_client(settings)
        try:
            intent_dto = client.get_payment_intent_status(context.device_id, payload.card_intent_id)
        except ValueError as exc:
            raise HttpStatusError(404) from exc
        except Exception as exc:
            raise HttpStatusError(502) from exc
        if (intent_dto.status != "PROCESSED"
                or intent_dto.amount_minor != payload.expected_total_minor - payload.credit_minor):
            raise HttpStatusError(409)

        # Phase B: fresh atomic session; re-authorize and post the sale.
        with factory() as session:
            _require_product_sales_access(session, principal)
            order, replayed = q.post_card_product_sale(
                session, register_id=register_id, actor_id=principal.staff_id, member_id=payload.member_id,
                items=payload.items, expected_total_minor=payload.expected_total_minor,
                idempotency_key=idempotency_key, card_intent_id=payload.card_intent_id,
                terminal_id=context.terminal_id, card_brand=intent_dto.card_brand,
                card_last_four=intent_dto.last_four_digits, authorization_code=intent_dto.authorization_code,
                credit_minor=payload.credit_minor)
            seller_intent = session.get(ProductSaleIntent, principal.staff_id)
            if seller_intent is not None and seller_intent.idempotency_key == idempotency_key:
                session.delete(seller_intent)
            session.commit()
            return _product_sale_dto(order, session), replayed


# --- product returns ----------------------------------------------------------------------------

def list_eligible_product_returns(session, principal: Principal, register_id: UUID, member_id: UUID):
    with http_errors(*_RETURN_ERRORS):
        _require_register(session, principal, register_id)
        _require_product_sales_access(session, principal)
        return q.list_eligible_product_returns(session, register_id=register_id, member_id=member_id)


def post_product_return(factory, principal: Principal, register_id: UUID, payload, idempotency_key: str):
    """Returns (dto, replayed)."""
    try:
        with http_errors(*_RETURN_ERRORS, (ValueError, 422)):
            with factory() as session:
                _require_register(session, principal, register_id)
                _require_product_sales_access(session, principal)
                refund, replayed = q.post_product_return(
                    session, register_id=register_id, actor_id=principal.staff_id,
                    order_item_id=payload.order_item_id, reason=payload.reason, disposition=payload.disposition,
                    payout_method=payload.payout_method, idempotency_key=idempotency_key)
                session.commit()
                return ProductRefundDTO.model_validate(refund), replayed
    except IntegrityError:
        return _replay_winner(
            factory, register_id,
            lambda session, register: q.find_refund_by_key(
                session, branch_id=register.branch_id, actor_id=principal.staff_id, idempotency_key=idempotency_key),
            q.product_return_fingerprint(
                register_id, payload.order_item_id, payload.reason.strip(), payload.disposition, payload.payout_method),
            lambda _session, refund: ProductRefundDTO.model_validate(refund))


# --- membership sales ------------------------------------------------------------------------------

def post_cash_membership_sale(factory, principal: Principal, register_id: UUID, payload, idempotency_key: str):
    """Returns (dto, replayed). Post one published-plan membership purchase to the live open cash shift."""
    cash_amount_provided = "cash_amount_minor" in payload.model_fields_set
    if cash_amount_provided and payload.cash_amount_minor is None:
        raise HttpStatusError(422)
    try:
        with http_errors(*_SALE_ERRORS):
            with factory() as session:
                _require_register(session, principal, register_id)
                result = q.post_membership_cash_sale(
                    session, register_id=register_id, actor_id=principal.staff_id,
                    authorized_branch_id=_authorized_branch(principal), member_id=payload.member_id,
                    plan_version_id=payload.plan_version_id, idempotency_key=idempotency_key,
                    source_shift_id=payload.source_shift_id, cash_amount_minor=payload.cash_amount_minor,
                    cash_amount_provided=cash_amount_provided, credit_minor=payload.credit_minor)
                session.commit()
                return _sale_dto(result), result.replayed
    except IntegrityError:
        # Only resolve a possible concurrent idempotency-key insert; unrelated DB errors
        # remain visible to the normal sanitized error handler.
        return _replay_winner(
            factory, register_id, _find_order(principal, idempotency_key),
            q.membership_sale_fingerprint(
                register_id, payload.member_id, payload.plan_version_id, payload.source_shift_id,
                cash_amount_minor=payload.cash_amount_minor, cash_amount_provided=cash_amount_provided,
                credit_minor=payload.credit_minor),
            lambda session, existing: _sale_dto(q.load_sale_result(session, existing, replayed=True)))


def post_membership_transfer(factory, principal: Principal, register_id: UUID, payload, idempotency_key: str):
    """Returns (dto, replayed). Record a bank transfer as pending without settlement or activation."""
    if "cash_amount_minor" in payload.model_fields_set or payload.source_shift_id is not None:
        raise HttpStatusError(422)
    try:
        with http_errors(*_SALE_ERRORS):
            with factory() as session:
                _require_register(session, principal, register_id)
                result = q.post_membership_cash_sale(
                    session, register_id=register_id, actor_id=principal.staff_id,
                    authorized_branch_id=_authorized_branch(principal), member_id=payload.member_id,
                    plan_version_id=payload.plan_version_id, idempotency_key=idempotency_key,
                    payment_method="transfer", credit_minor=payload.credit_minor)
                session.commit()
                return _sale_dto(result), result.replayed
    except IntegrityError:
        def build(session, existing):
            result = q.load_sale_result(session, existing, replayed=True)
            if result.payment.method != "transfer":
                raise HttpStatusError(409) from None
            return _sale_dto(result)
        return _replay_winner(
            factory, register_id, _find_order(principal, idempotency_key),
            q.membership_sale_fingerprint(register_id, payload.member_id, payload.plan_version_id,
                                          payment_method="transfer", credit_minor=payload.credit_minor), build)


def review_membership_transfer(session, principal: Principal, payment_id: UUID, payload, idempotency_key: str):
    """Record an authorized bank-transfer review decision for its linked membership period."""
    with http_errors((CashSaleNotFoundError, 404), (CashSaleConflictError, 409), (ValueError, 422)):
        order = q.load_transfer_review_order(session, payment_id)
        if order is None:
            raise HttpStatusError(404)
        try:
            authorize(session, principal.staff_id, Permission.TRANSFER_REVIEW, order.branch_id)
        except AuthorizationDenied as exc:
            raise HttpStatusError(403) from exc
        result = q.review_membership_transfer(
            session, payment_id=payment_id, actor_id=principal.staff_id,
            status=payload.status, idempotency_key=idempotency_key)
        session.commit()
        return _sale_dto(result)


# --- membership debts --------------------------------------------------------------------------------

def list_register_member_open_debts(session, principal: Principal, register_id: UUID, member_id: UUID):
    with http_errors((CashSaleNotFoundError, 404), (CashSaleAccessDenied, 403), (CashSaleConflictError, 409)):
        return q.list_register_member_open_debts(
            session, register_id=register_id, member_id=member_id, authorized_branch_id=_authorized_branch(principal))


def post_membership_debt_payment(factory, principal: Principal, register_id: UUID, payload, idempotency_key: str):
    """Returns (dto, replayed). Collect an explicit membership debt abono to the current open branch shift."""
    try:
        with http_errors((CashSaleNotFoundError, 404), (CashSaleAccessDenied, 403),
                          (CashSaleConflictError, 409), (CreditConflictError, 409), (ValueError, 422)):
            with factory() as session:
                result = q.post_membership_debt_payment(
                    session, register_id=register_id, actor_id=principal.staff_id,
                    authorized_branch_id=_authorized_branch(principal), order_id=payload.order_id,
                    amount_minor=payload.amount_minor, credit_minor=payload.credit_minor,
                    idempotency_key=idempotency_key)
                session.commit()
                return _debt_payment_dto(result.receipt), result.replayed
    except IntegrityError:
        # A concurrent request may win the actor/branch idempotency key on another register.
        def find(session, register):
            if not principal.is_admin and register.branch_id != principal.branch_id:
                raise HttpStatusError(403) from None
            return q.find_debt_payment_by_key(session, branch_id=register.branch_id,
                                              received_by=principal.staff_id, idempotency_key=idempotency_key)
        return _replay_winner(factory, register_id, find,
                              q.debt_payment_fingerprint(register_id, payload.order_id, payload.amount_minor,
                                                         payload.credit_minor),
                              lambda _session, existing: _debt_payment_dto(existing))
