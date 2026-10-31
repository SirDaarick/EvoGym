"""Cash membership-sale posting endpoint."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.observability.logging import request_id
from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.db.models import (
    Branch, CashRegister, Member, MembershipDebtPayment, MembershipPeriod, Order, OrderItem, Payment, PaymentTerminal, ProductRefund, RoleGrant, ProductSaleIntent, StaffUser,
)
from app.sales.point import get_point_client
from app.sales.queries import (
    CashSaleAccessDenied,
    CashSaleConflictError,
    CashSaleNotFoundError,
    InvalidBranchTimezoneError,
    list_register_member_open_debts,
    post_membership_debt_payment,
    post_membership_cash_sale,
    review_membership_transfer,
    post_cash_product_sale,
    post_card_product_sale,
    resolve_product_sale,
    product_sale_fingerprint,
    prepare_product_sale,
    list_eligible_product_returns,
    post_product_return,
    product_return_fingerprint,
    ProductReturnNotFoundError,
    ProductReturnConflictError,
)
from app.sales.schemas import (
    CashMembershipSaleDTO,
    CashMembershipSaleRequest,
    CashSaleItemDTO,
    CashSaleOrderDTO,
    CashSalePaymentDTO,
    ClassSampleEntitlementDTO,
    MembershipDebtPaymentDTO,
    MembershipDebtPaymentRequest,
    MembershipPeriodDTO,
    RegisterMemberOpenDebtDTO,
    TransferReviewRequest,
    CashProductSaleRequest, CashProductSaleDTO, ProductSaleOrderDTO, ProductSaleItemDTO, ProductSalePaymentDTO,
    CardProductSaleRequest, CreateCardIntentRequest, CardIntentResponse,
    EligibleProductReturnDTO, ProductRefundDTO, ProductReturnRequest,
)

router = APIRouter(prefix="/api/v1/registers", tags=["sales"])


def _product_sales_access(session, principal):
    if not principal.is_admin and session.scalar(select(RoleGrant.id).where(
        RoleGrant.staff_id == principal.staff_id, RoleGrant.role == "receptionist",
        RoleGrant.is_active.is_(True), RoleGrant.scope_kind == "branch",
        RoleGrant.branch_id == principal.branch_id,
    ).with_for_update()) is None:
        raise HTTPException(403, "Product sales require receptionist access.")


def _intent_response(intent):
    return None if intent is None else {"key": intent.idempotency_key,
        "registerId": str(intent.register_id), "payload": intent.payload}


def _get_or_create_terminal_for_register(session, register: CashRegister) -> PaymentTerminal:
    terminal = register.default_terminal
    if terminal is None:
        terminal = session.scalar(
            select(PaymentTerminal).where(
                PaymentTerminal.branch_id == register.branch_id,
                PaymentTerminal.status == "active",
            ).order_by(PaymentTerminal.code.asc())
        )
    if terminal is None:
        terminal = PaymentTerminal(
            branch_id=register.branch_id,
            code="POINT-01",
            name="Terminal Mostrador 01",
            device_id="GERTEC_MP35P__8701012345",
            provider="mercado_pago",
            status="active",
        )
        session.add(terminal)
        session.flush()
        register.default_terminal_id = terminal.id
        session.flush()
    return terminal


@router.get("/product-sale-intent")
def get_product_sale_intent_endpoint(request: Request, principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    with request.app.state.session_factory() as session:
        _product_sales_access(session, principal)
        return _intent_response(session.get(ProductSaleIntent, principal.staff_id))


@router.post("/{register_id}/product-sale-intent")
def prepare_product_sale_endpoint(register_id: UUID, payload: CashProductSaleRequest, request: Request,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    try:
        with request.app.state.session_factory() as session:
            _product_sales_access(session, principal)
            intent = prepare_product_sale(session, register_id=register_id, actor_id=principal.staff_id,
                member_id=payload.member_id, items=payload.items, expected_total_minor=payload.expected_total_minor,
                idempotency_key=idempotency_key)
            result = _intent_response(intent)
            session.commit()
            return result
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleConflictError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{register_id}/product-sales", response_model=CashProductSaleDTO, status_code=201)
def post_cash_product_sale_endpoint(
    register_id: UUID, payload: CashProductSaleRequest, request: Request, response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128,
                                  pattern=r"^[A-Za-z0-9._:-]+$"),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> CashProductSaleDTO:
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            if not principal.is_admin and session.scalar(select(RoleGrant.id).where(
                RoleGrant.staff_id == principal.staff_id, RoleGrant.role == "receptionist",
                RoleGrant.is_active.is_(True), RoleGrant.scope_kind == "branch",
                RoleGrant.branch_id == principal.branch_id,
            ).with_for_update()) is None:
                raise HTTPException(403, "Product sales require receptionist access.")
            session.scalar(select(StaffUser.id).where(StaffUser.id == principal.staff_id).with_for_update(key_share=True))
            intent = session.get(ProductSaleIntent, principal.staff_id)
            fingerprint = product_sale_fingerprint(register_id, payload.member_id, payload.items, payload.expected_total_minor)
            if intent is not None and intent.idempotency_key == idempotency_key and (intent.register_id != register_id or intent.request_fingerprint != fingerprint):
                raise CashSaleConflictError("Idempotency key was already used for a different request.")
            if intent is None or intent.register_id != register_id or intent.idempotency_key != idempotency_key:
                raise CashSaleConflictError("Product sale intent is missing or different.")
            order, replayed = post_cash_product_sale(
                session, register_id=register_id, actor_id=principal.staff_id, member_id=payload.member_id,
                items=payload.items, expected_total_minor=payload.expected_total_minor, idempotency_key=idempotency_key,
            )
            session.commit()
            if replayed:
                response.status_code = 200
            return CashProductSaleDTO(order=ProductSaleOrderDTO.model_validate(order),
                                      items=[ProductSaleItemDTO.model_validate(item) for item in order.items],
                                      payment=ProductSalePaymentDTO.model_validate(order.payment))
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleConflictError as exc:
        code = ("idempotency_conflict" if str(exc) == "Idempotency key was already used for a different request."
                else "first_shift_required" if str(exc) == "Open the first shift before making a sale."
                else "product_sale_rejected")
        return JSONResponse(status_code=409, content={"error": {"code": code, "message": "The request could not be completed.", "request_id": request_id()}})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except IntegrityError as exc:
        with factory() as session:
            register = session.get(CashRegister, register_id)
            if register is None:
                raise
            order = session.scalar(select(Order).where(Order.branch_id == register.branch_id,
                                   Order.seller_id == principal.staff_id, Order.idempotency_key == idempotency_key))
            if order is None:
                raise
            if order.order_kind != "product" or order.request_fingerprint != product_sale_fingerprint(
                register_id, payload.member_id, payload.items, payload.expected_total_minor
            ):
                raise HTTPException(409, "Idempotency key was already used for a different request.") from exc
            response.status_code = 200
            return CashProductSaleDTO(order=ProductSaleOrderDTO.model_validate(order),
                                      items=[ProductSaleItemDTO.model_validate(item) for item in order.items],
                                      payment=ProductSalePaymentDTO.model_validate(order.payment))


@router.post("/{register_id}/product-sales/resolve")
def resolve_product_sale_endpoint(register_id: UUID, payload: CashProductSaleRequest, request: Request,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            if not principal.is_admin and session.scalar(select(RoleGrant.id).where(
                RoleGrant.staff_id == principal.staff_id, RoleGrant.role == "receptionist",
                RoleGrant.is_active.is_(True), RoleGrant.scope_kind == "branch",
                RoleGrant.branch_id == principal.branch_id,
            ).with_for_update()) is None:
                raise HTTPException(403, "Product sales require receptionist access.")
            order = resolve_product_sale(session, register_id=register_id, actor_id=principal.staff_id,
                member_id=payload.member_id, items=payload.items, expected_total_minor=payload.expected_total_minor,
                idempotency_key=idempotency_key)
            intent = session.get(ProductSaleIntent, principal.staff_id)
            if intent is not None and intent.register_id == register_id and intent.idempotency_key == idempotency_key and intent.request_fingerprint == product_sale_fingerprint(register_id, payload.member_id, payload.items, payload.expected_total_minor):
                session.delete(intent)
            result = {"status": "cancelled"} if order is None else {
                "status": "completed", "order_id": str(order.id), "total_minor": order.total_minor}
            session.commit()
            return result
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleConflictError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{register_id}/card-intent", response_model=CardIntentResponse, status_code=201)
def create_card_intent_endpoint(
    register_id: UUID,
    payload: CreateCardIntentRequest,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> CardIntentResponse:
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        _product_sales_access(session, principal)
        register = session.get(CashRegister, register_id)
        if register is None:
            raise HTTPException(404, "Cash register not found.")
        if not principal.is_admin and register.branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")
        terminal = _get_or_create_terminal_for_register(session, register)
        settings = getattr(request.app.state, "settings", None)
        client = get_point_client(settings)
        try:
            intent = client.create_payment_intent(
                device_id=terminal.device_id,
                amount_minor=payload.amount_minor,
                external_reference=payload.external_reference,
            )
        except Exception as exc:
            raise HTTPException(502, f"Failed to create terminal payment intent: {exc}") from exc
        session.commit()
        return CardIntentResponse(
            id=intent.id,
            payment_intent_id=intent.id,
            device_id=intent.device_id,
            amount_minor=intent.amount_minor,
            status=intent.status,
            authorization_code=intent.authorization_code,
            card_brand=intent.card_brand,
            last_four_digits=intent.last_four_digits,
        )


@router.get("/{register_id}/card-intent/{intent_id}", response_model=CardIntentResponse)
def get_card_intent_status_endpoint(
    register_id: UUID,
    intent_id: str,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> CardIntentResponse:
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        _product_sales_access(session, principal)
        register = session.get(CashRegister, register_id)
        if register is None:
            raise HTTPException(404, "Cash register not found.")
        if not principal.is_admin and register.branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")
        terminal = _get_or_create_terminal_for_register(session, register)
        settings = getattr(request.app.state, "settings", None)
        client = get_point_client(settings)
        try:
            intent = client.get_payment_intent_status(
                device_id=terminal.device_id,
                payment_intent_id=intent_id,
            )
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, f"Failed to query terminal payment intent: {exc}") from exc
        return CardIntentResponse(
            id=intent.id,
            payment_intent_id=intent.id,
            device_id=intent.device_id,
            amount_minor=intent.amount_minor,
            status=intent.status,
            authorization_code=intent.authorization_code,
            card_brand=intent.card_brand,
            last_four_digits=intent.last_four_digits,
        )


@router.delete("/{register_id}/card-intent/{intent_id}")
def cancel_card_intent_endpoint(
    register_id: UUID,
    intent_id: str,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        _product_sales_access(session, principal)
        register = session.get(CashRegister, register_id)
        if register is None:
            raise HTTPException(404, "Cash register not found.")
        if not principal.is_admin and register.branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")
        terminal = _get_or_create_terminal_for_register(session, register)
        settings = getattr(request.app.state, "settings", None)
        client = get_point_client(settings)
        try:
            cancelled = client.cancel_payment_intent(
                device_id=terminal.device_id,
                payment_intent_id=intent_id,
            )
        except Exception as exc:
            raise HTTPException(502, f"Failed to cancel terminal payment intent: {exc}") from exc
        return {"cancelled": cancelled, "payment_intent_id": intent_id}


@router.post("/{register_id}/product-sales/card", response_model=CashProductSaleDTO, status_code=201)
def post_card_product_sale_endpoint(
    register_id: UUID,
    payload: CardProductSaleRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> CashProductSaleDTO:
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            _product_sales_access(session, principal)
            register = session.get(CashRegister, register_id)
            if register is None:
                raise HTTPException(404, "Cash register not found.")
            if not principal.is_admin and register.branch_id != principal.branch_id:
                raise HTTPException(403, "Access restricted to staff branch.")

            # Check idempotency replay before consulting terminal
            fingerprint = product_sale_fingerprint(
                register_id, payload.member_id, payload.items, payload.expected_total_minor
            )
            existing_order = session.scalar(
                select(Order).where(
                    Order.seller_id == principal.staff_id,
                    Order.branch_id == register.branch_id,
                    Order.idempotency_key == idempotency_key,
                )
            )
            if existing_order is not None:
                if (
                    existing_order.request_fingerprint != fingerprint
                    or existing_order.order_kind != "product"
                ):
                    raise CashSaleConflictError("Idempotency key was already used for a different request.")
                response.status_code = 200
                return CashProductSaleDTO(
                    order=ProductSaleOrderDTO.model_validate(existing_order),
                    items=[ProductSaleItemDTO.model_validate(item) for item in existing_order.items],
                    payment=ProductSalePaymentDTO.model_validate(existing_order.payment),
                )

            terminal = _get_or_create_terminal_for_register(session, register)
            settings = getattr(request.app.state, "settings", None)
            client = get_point_client(settings)
            try:
                intent_dto = client.get_payment_intent_status(
                    terminal.device_id, payload.card_intent_id
                )
            except ValueError as exc:
                raise HTTPException(404, f"Card intent not found: {exc}") from exc
            except Exception as exc:
                raise HTTPException(502, f"Failed to verify card intent on terminal: {exc}") from exc

            if intent_dto.status != "PROCESSED":
                raise HTTPException(
                    409, f"Payment intent is not processed (status: {intent_dto.status})."
                )
            if intent_dto.amount_minor != payload.expected_total_minor:
                raise HTTPException(
                    409,
                    f"Payment intent amount ({intent_dto.amount_minor}) does not match expected total ({payload.expected_total_minor}).",
                )

            order, replayed = post_card_product_sale(
                session,
                register_id=register_id,
                actor_id=principal.staff_id,
                member_id=payload.member_id,
                items=payload.items,
                expected_total_minor=payload.expected_total_minor,
                idempotency_key=idempotency_key,
                card_intent_id=payload.card_intent_id,
                terminal_id=terminal.id,
                card_brand=intent_dto.card_brand,
                card_last_four=intent_dto.last_four_digits,
                authorization_code=intent_dto.authorization_code,
            )
            seller_intent = session.get(ProductSaleIntent, principal.staff_id)
            if seller_intent is not None and seller_intent.idempotency_key == idempotency_key:
                session.delete(seller_intent)
            session.commit()
            if replayed:
                response.status_code = 200
            return CashProductSaleDTO(
                order=ProductSaleOrderDTO.model_validate(order),
                items=[ProductSaleItemDTO.model_validate(item) for item in order.items],
                payment=ProductSalePaymentDTO.model_validate(order.payment),
            )
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleConflictError as exc:
        code = (
            "idempotency_conflict"
            if str(exc) == "Idempotency key was already used for a different request."
            else "first_shift_required"
            if str(exc) == "Open the first shift before making a sale."
            else "product_sale_rejected"
        )
        return JSONResponse(
            status_code=409,
            content={
                "error": {
                    "code": code,
                    "message": "The request could not be completed.",
                    "request_id": request_id(),
                }
            },
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/{register_id}/members/{member_id}/eligible-product-returns", response_model=list[EligibleProductReturnDTO])
def get_eligible_product_returns_endpoint(
    register_id: UUID,
    member_id: UUID,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> list[EligibleProductReturnDTO]:
    """Retrieve product order items from same-day confirmed member sales eligible for return."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            register = session.get(CashRegister, register_id)
            if register is None:
                raise HTTPException(404, "Cash register not found.")
            if not principal.is_admin and register.branch_id != principal.branch_id:
                raise HTTPException(403, "Access restricted to staff branch.")
            _product_sales_access(session, principal)
            return list_eligible_product_returns(session, register_id=register_id, member_id=member_id)
    except ProductReturnNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ProductReturnConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except InvalidBranchTimezoneError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{register_id}/product-returns", response_model=ProductRefundDTO, status_code=201)
def post_product_return_endpoint(
    register_id: UUID,
    payload: ProductReturnRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> ProductRefundDTO:
    """Record a compensating product line refund and adjust stock and shift totals."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            register = session.get(CashRegister, register_id)
            if register is None:
                raise HTTPException(404, "Cash register not found.")
            if not principal.is_admin and register.branch_id != principal.branch_id:
                raise HTTPException(403, "Access restricted to staff branch.")
            _product_sales_access(session, principal)

            refund, replayed = post_product_return(
                session,
                register_id=register_id,
                actor_id=principal.staff_id,
                order_item_id=payload.order_item_id,
                reason=payload.reason,
                disposition=payload.disposition,
                payout_method=payload.payout_method,
                idempotency_key=idempotency_key,
            )
            session.commit()
            if replayed:
                response.status_code = 200
            return ProductRefundDTO.model_validate(refund)
    except ProductReturnNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ProductReturnConflictError as exc:
        code = "idempotency_conflict" if "Idempotency key was already used" in str(exc) else "product_return_rejected"
        return JSONResponse(
            status_code=409,
            content={"error": {"code": code, "message": str(exc), "request_id": request_id()}},
        )
    except InvalidBranchTimezoneError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except IntegrityError as exc:
        with factory() as session:
            register = session.get(CashRegister, register_id)
            if register is None:
                raise
            refund = session.scalar(
                select(ProductRefund).where(
                    ProductRefund.branch_id == register.branch_id,
                    ProductRefund.actor_id == principal.staff_id,
                    ProductRefund.idempotency_key == idempotency_key,
                )
            )
            if refund is None:
                raise
            fingerprint = product_return_fingerprint(
                register_id, payload.order_item_id, payload.reason.strip(), payload.disposition, payload.payout_method
            )
            if refund.request_fingerprint != fingerprint:
                raise HTTPException(409, "Idempotency key was already used for a different request.") from exc
            response.status_code = 200
            return ProductRefundDTO.model_validate(refund)


def _sale_dto(order: Order, item: OrderItem, payment: Payment, membership: MembershipPeriod | None,
              sample_entitlement=None) -> CashMembershipSaleDTO:
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
    )


def _debt_payment_dto(receipt: MembershipDebtPayment) -> MembershipDebtPaymentDTO:
    return MembershipDebtPaymentDTO(
        id=receipt.id,
        debt_id=receipt.debt_id,
        order_id=receipt.order_id,
        member_id=receipt.member_id,
        branch_id=receipt.branch_id,
        register_id=receipt.register_id,
        shift_id=receipt.shift_id,
        amount_minor=receipt.amount_minor,
        remaining_after_minor=receipt.remaining_after_minor,
        received_by=receipt.received_by,
        created_at=receipt.created_at,
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
    cash_amount_provided = "cash_amount_minor" in payload.model_fields_set
    if cash_amount_provided and payload.cash_amount_minor is None:
        raise HTTPException(422, "cash_amount_minor must be a positive integer when supplied.")

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
                cash_amount_minor=payload.cash_amount_minor,
                cash_amount_provided=cash_amount_provided,
            )
            session.commit()
            if result.replayed:
                response.status_code = 200
            return _sale_dto(result.order, result.item, result.payment, result.membership, result.sample_entitlement)


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
                register_id, payload.member_id, payload.plan_version_id, payload.source_shift_id,
                cash_amount_minor=payload.cash_amount_minor,
                cash_amount_provided=cash_amount_provided,
            ):
                raise HTTPException(409, "Idempotency key was already used for a different request.") from exc
            result = _load_result(session, existing, replayed=True)
            response.status_code = 200
            return _sale_dto(result.order, result.item, result.payment, result.membership, result.sample_entitlement)


@router.get("/{register_id}/members/{member_id}/debts", response_model=list[RegisterMemberOpenDebtDTO])
def list_register_member_open_debts_endpoint(
    register_id: UUID,
    member_id: UUID,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> list[RegisterMemberOpenDebtDTO]:
    """List open membership debts for a member on the specified active branch register."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            return list_register_member_open_debts(
                session,
                register_id=register_id,
                member_id=member_id,
                authorized_branch_id=principal.branch_id if not principal.is_admin else None,
            )
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleAccessDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    except CashSaleConflictError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{register_id}/membership-debt-payments", response_model=MembershipDebtPaymentDTO, status_code=201)
def post_membership_debt_payment_endpoint(
    register_id: UUID,
    payload: MembershipDebtPaymentRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(
        ..., alias="Idempotency-Key", min_length=1, max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> MembershipDebtPaymentDTO:
    """Collect an explicit membership debt abono to the current open branch shift."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    try:
        with factory() as session:
            result = post_membership_debt_payment(
                session,
                register_id=register_id,
                actor_id=principal.staff_id,
                authorized_branch_id=principal.branch_id if not principal.is_admin else None,
                order_id=payload.order_id,
                amount_minor=payload.amount_minor,
                idempotency_key=idempotency_key,
            )
            session.commit()
            if result.replayed:
                response.status_code = 200
            return _debt_payment_dto(result.receipt)
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleAccessDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    except CashSaleConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except IntegrityError as exc:
        # A concurrent request may win the actor/branch idempotency key on another register.
        with factory() as session:
            register = session.scalar(select(CashRegister).where(CashRegister.id == register_id))
            if register is None:
                raise
            if not principal.is_admin and register.branch_id != principal.branch_id:
                raise HTTPException(403, "Access restricted to staff branch.") from exc
            existing = session.scalar(select(MembershipDebtPayment).where(
                MembershipDebtPayment.branch_id == register.branch_id,
                MembershipDebtPayment.received_by == principal.staff_id,
                MembershipDebtPayment.idempotency_key == idempotency_key,
            ))
            if existing is None:
                raise
            from app.sales.queries import _debt_payment_fingerprint
            if existing.request_fingerprint != _debt_payment_fingerprint(
                register_id, payload.order_id, payload.amount_minor,
            ):
                raise HTTPException(409, "Idempotency key was already used for a different request.") from exc
            response.status_code = 200
            return _debt_payment_dto(existing)
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
    if "cash_amount_minor" in payload.model_fields_set:
        raise HTTPException(422, "Bank transfers do not accept a partial cash amount.")
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
            return _sale_dto(result.order, result.item, result.payment, result.membership, result.sample_entitlement)
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
            return _sale_dto(result.order, result.item, result.payment, result.membership, result.sample_entitlement)


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
            return _sale_dto(result.order, result.item, result.payment, result.membership, result.sample_entitlement)
    except HTTPException:
        raise
    except CashSaleNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashSaleConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
