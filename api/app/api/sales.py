"""Cash membership-sale posting endpoint."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.db.models import Branch, CashRegister, MembershipPeriod, Order, OrderItem, Payment
from app.sales.queries import (
    CashSaleAccessDenied,
    CashSaleConflictError,
    CashSaleNotFoundError,
    InvalidBranchTimezoneError,
    post_membership_cash_sale,
)
from app.sales.schemas import (
    CashMembershipSaleDTO,
    CashMembershipSaleRequest,
    CashSaleItemDTO,
    CashSaleOrderDTO,
    CashSalePaymentDTO,
    MembershipPeriodDTO,
)

router = APIRouter(prefix="/api/v1/registers", tags=["sales"])


def _sale_dto(order: Order, item: OrderItem, payment: Payment, membership: MembershipPeriod) -> CashMembershipSaleDTO:
    return CashMembershipSaleDTO(
        order=CashSaleOrderDTO(
            id=order.id, branch_id=order.branch_id, register_id=order.register_id,
            shift_id=order.shift_id, member_id=order.member_id, seller_id=order.seller_id,
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
        ),
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

            if existing.request_fingerprint != _fingerprint(register_id, payload.member_id, payload.plan_version_id):
                raise HTTPException(409, "Idempotency key was already used for a different request.") from exc
            result = _load_result(session, existing, replayed=True)
            response.status_code = 200
            return _sale_dto(result.order, result.item, result.payment, result.membership)
