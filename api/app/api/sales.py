"""Cash membership-sale posting endpoint."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.db.models import Branch, CashRegister, Member, MembershipPeriod, Order, OrderItem, Payment
from app.sales.queries import (
    CashSaleAccessDenied,
    CashSaleConflictError,
    CashSaleNotFoundError,
    InvalidBranchTimezoneError,
    post_membership_cash_sale,
    review_membership_transfer,
)
from app.sales.schemas import (
    CashMembershipSaleDTO,
    CashMembershipSaleRequest,
    CashSaleItemDTO,
    CashSaleOrderDTO,
    CashSalePaymentDTO,
    MembershipPeriodDTO,
    TransferReviewRequest,
)

router = APIRouter(prefix="/api/v1/registers", tags=["sales"])


def _sale_dto(order: Order, item: OrderItem, payment: Payment, membership: MembershipPeriod | None) -> CashMembershipSaleDTO:
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
            duration_value=item.duration_value, duration_unit=item.duration_unit, quantity=item.quantity,
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
    )


@router.post("/{register_id}/membership-sales", response_model=CashMembershipSaleDTO, status_code=201)
def post_cash_membership_sale_endpoint(
    register_id: UUID,
    payload: CashMembershipSaleRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(
        ..., alias="Idempotency-Key", min_length=1, max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> CashMembershipSaleDTO:
    """Post one published-plan membership purchase to the live open cash shift."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    try:
        with factory() as session:
            register = session.scalar(select(CashRegister).where(CashRegister.id == register_id))
            if register is None:
                raise HTTPException(404, "Cash register not found.")
            if not principal.is_admin and register.branch_id != principal.branch_id:
                raise HTTPException(403, "Access restricted to staff branch.")

            result = post_membership_cash_sale(
                session,
                register_id=register_id,
                actor_id=principal.staff_id,
                authorized_branch_id=principal.branch_id if not principal.is_admin else None,
                member_id=payload.member_id,
                plan_version_id=payload.plan_version_id,
                idempotency_key=idempotency_key,
                source_shift_id=payload.source_shift_id,
            )
            session.commit()
            if result.replayed:
                response.status_code = 200
            return _sale_dto(result.order, result.item, result.payment, result.membership)
    except HTTPException:
        raise
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleAccessDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    except CashSaleConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except InvalidBranchTimezoneError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except IntegrityError as exc:
        # Only resolve a possible concurrent idempotency-key insert; unrelated DB errors
        # remain visible to the normal sanitized error handler.
        with factory() as session:
            register = session.scalar(select(CashRegister).where(CashRegister.id == register_id))
            if register is None:
                raise
            existing = session.scalar(select(Order).where(
                Order.branch_id == register.branch_id,
                Order.seller_id == principal.staff_id,
                Order.idempotency_key == idempotency_key,
            ))
            if existing is None:
                raise
            from app.sales.queries import _fingerprint, _load_result

            if existing.request_fingerprint != _fingerprint(
                register_id, payload.member_id, payload.plan_version_id, payload.source_shift_id
            ):
                raise HTTPException(409, "Idempotency key was already used for a different request.") from exc
            result = _load_result(session, existing, replayed=True)
            response.status_code = 200
            return _sale_dto(result.order, result.item, result.payment, result.membership)


@router.post("/{register_id}/membership-transfer-sales", response_model=CashMembershipSaleDTO, status_code=201)
def post_membership_transfer_endpoint(
    register_id: UUID,
    payload: CashMembershipSaleRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(
        ..., alias="Idempotency-Key", min_length=1, max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> CashMembershipSaleDTO:
    """Record a bank transfer as pending without settlement or activation."""
    if payload.source_shift_id is not None:
        raise HTTPException(422, "Pending transfers do not accept a source shift.")
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            register = session.scalar(select(CashRegister).where(CashRegister.id == register_id))
            if register is None:
                raise HTTPException(404, "Cash register not found.")
            if not principal.is_admin and register.branch_id != principal.branch_id:
                raise HTTPException(403, "Access restricted to staff branch.")
            result = post_membership_cash_sale(
                session,
                register_id=register_id,
                actor_id=principal.staff_id,
                authorized_branch_id=principal.branch_id if not principal.is_admin else None,
                member_id=payload.member_id,
                plan_version_id=payload.plan_version_id,
                idempotency_key=idempotency_key,
                payment_method="transfer",
            )
            session.commit()
            if result.replayed:
                response.status_code = 200
            return _sale_dto(result.order, result.item, result.payment, result.membership)
    except HTTPException:
        raise
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleAccessDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    except CashSaleConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except InvalidBranchTimezoneError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except IntegrityError as exc:
        with factory() as session:
            register = session.scalar(select(CashRegister).where(CashRegister.id == register_id))
            if register is None:
                raise
            existing = session.scalar(select(Order).where(
                Order.branch_id == register.branch_id,
                Order.seller_id == principal.staff_id,
                Order.idempotency_key == idempotency_key,
            ))
            if existing is None:
                raise
            from app.sales.queries import _fingerprint, _load_result
            if existing.request_fingerprint != _fingerprint(
                register_id, payload.member_id, payload.plan_version_id, payment_method="transfer"
            ):
                raise HTTPException(409, "Idempotency key was already used for a different request.") from exc
            result = _load_result(session, existing, replayed=True)
            if result.payment.method != "transfer":
                raise HTTPException(409, "Idempotency key was already used for a different request.") from exc
            response.status_code = 200
            return _sale_dto(result.order, result.item, result.payment, result.membership)


@router.post("/transfer-payments/{payment_id}/review", response_model=CashMembershipSaleDTO)
def review_membership_transfer_endpoint(
    payment_id: UUID,
    payload: TransferReviewRequest,
    request: Request,
    idempotency_key: str = Header(
        ..., alias="Idempotency-Key", min_length=1, max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> CashMembershipSaleDTO:
    """Record an authorized bank-transfer review decision for its linked membership period."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            payment = session.scalar(select(Payment).where(Payment.id == payment_id))
            if payment is None or payment.method != "transfer":
                raise HTTPException(404, "Transfer payment not found.")
            order = session.get(Order, payment.order_id)
            if order is None:
                raise HTTPException(404, "Transfer payment not found.")
            # Match the sale/review lock order before checking scoped authority so
            # unauthorized requests cannot learn idempotency or voucher-history state.
            register = session.scalar(
                select(CashRegister).where(CashRegister.id == order.register_id).with_for_update()
            )
            member = session.scalar(
                select(Member).where(Member.id == order.member_id).with_for_update()
            )
            if register is None or member is None:
                raise HTTPException(404, "Transfer payment not found.")
            try:
                authorize(session, principal.staff_id, Permission.TRANSFER_REVIEW, order.branch_id)
            except AuthorizationDenied as exc:
                raise HTTPException(403, "Transfer review requires an active scoped administrator grant.") from exc
            result = review_membership_transfer(
                session, payment_id=payment_id, actor_id=principal.staff_id,
                status=payload.status, idempotency_key=idempotency_key,
            )
            session.commit()
            return _sale_dto(result.order, result.item, result.payment, result.membership)
    except HTTPException:
        raise
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
