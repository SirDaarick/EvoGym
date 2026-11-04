"""Sales HTTP transport: parse the request, call one `app.sales.service` function, shape the response."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response

from app.api.deps import SessionDep, SessionFactoryDep, SettingsDep
from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.sales import service
from app.sales.schemas import (
    CardIntentResponse, CardProductSaleRequest, CashMembershipSaleDTO, CashMembershipSaleRequest,
    CashProductSaleDTO, CashProductSaleRequest, CreateCardIntentRequest, EligibleProductReturnDTO,
    MembershipDebtPaymentDTO, MembershipDebtPaymentRequest, ProductRefundDTO, ProductReturnRequest,
    RegisterMemberOpenDebtDTO, TransferReviewRequest,
)

router = APIRouter(prefix="/api/v1/registers", tags=["sales"])

IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128,
                                       pattern=r"^[A-Za-z0-9._:-]+$")]
Principal = Annotated[ShiftActorPrincipal, Depends(get_shift_actor_principal)]


def _status(response: Response, replayed: bool) -> None:
    if replayed:
        response.status_code = 200


@router.get("/product-sale-intent")
def get_product_sale_intent_endpoint(principal: Principal, *, factory: SessionFactoryDep):
    return service.get_product_sale_intent(factory, principal)


@router.post("/{register_id}/product-sale-intent")
def prepare_product_sale_endpoint(
    register_id: UUID, payload: CashProductSaleRequest, idempotency_key: IdempotencyKey,
    principal: Principal, *, factory: SessionFactoryDep,
):
    return service.prepare_product_sale(factory, principal, register_id, payload, idempotency_key)


@router.post("/{register_id}/product-sales", response_model=CashProductSaleDTO, status_code=201)
def post_cash_product_sale_endpoint(
    register_id: UUID, payload: CashProductSaleRequest, response: Response, idempotency_key: IdempotencyKey,
    principal: Principal, *, factory: SessionFactoryDep,
) -> CashProductSaleDTO:
    dto, replayed = service.post_cash_product_sale(factory, principal, register_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.post("/{register_id}/product-sales/resolve")
def resolve_product_sale_endpoint(
    register_id: UUID, payload: CashProductSaleRequest, idempotency_key: IdempotencyKey,
    principal: Principal, *, factory: SessionFactoryDep,
):
    return service.resolve_product_sale(factory, principal, register_id, payload, idempotency_key)


@router.post("/{register_id}/card-intent", response_model=CardIntentResponse, status_code=201)
def create_card_intent_endpoint(
    register_id: UUID, payload: CreateCardIntentRequest, settings: SettingsDep,
    principal: Principal, *, factory: SessionFactoryDep,
) -> CardIntentResponse:
    return service.create_card_intent(factory, settings, principal, register_id, payload)


@router.get("/{register_id}/card-intent/{intent_id}", response_model=CardIntentResponse)
def get_card_intent_status_endpoint(
    register_id: UUID, intent_id: str, settings: SettingsDep, principal: Principal, *, factory: SessionFactoryDep,
) -> CardIntentResponse:
    return service.get_card_intent_status(factory, settings, principal, register_id, intent_id)


@router.delete("/{register_id}/card-intent/{intent_id}")
def cancel_card_intent_endpoint(
    register_id: UUID, intent_id: str, settings: SettingsDep, principal: Principal, *, factory: SessionFactoryDep,
):
    return service.cancel_card_intent(factory, settings, principal, register_id, intent_id)


@router.post("/{register_id}/product-sales/card", response_model=CashProductSaleDTO, status_code=201)
def post_card_product_sale_endpoint(
    register_id: UUID, payload: CardProductSaleRequest, settings: SettingsDep, response: Response,
    idempotency_key: IdempotencyKey, principal: Principal, *, factory: SessionFactoryDep,
) -> CashProductSaleDTO:
    dto, replayed = service.post_card_product_sale(factory, settings, principal, register_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.get("/{register_id}/members/{member_id}/eligible-product-returns", response_model=list[EligibleProductReturnDTO])
def get_eligible_product_returns_endpoint(
    register_id: UUID, member_id: UUID, principal: Principal, *, session: SessionDep,
) -> list[EligibleProductReturnDTO]:
    """Retrieve product order items from same-day confirmed member sales eligible for return."""
    return service.list_eligible_product_returns(session, principal, register_id, member_id)


@router.post("/{register_id}/product-returns", response_model=ProductRefundDTO, status_code=201)
def post_product_return_endpoint(
    register_id: UUID, payload: ProductReturnRequest, response: Response, idempotency_key: IdempotencyKey,
    principal: Principal, *, factory: SessionFactoryDep,
) -> ProductRefundDTO:
    """Record a compensating product line refund and adjust stock and shift totals."""
    dto, replayed = service.post_product_return(factory, principal, register_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.post("/{register_id}/membership-sales", response_model=CashMembershipSaleDTO, status_code=201)
def post_cash_membership_sale_endpoint(
    register_id: UUID, payload: CashMembershipSaleRequest, response: Response, idempotency_key: IdempotencyKey,
    principal: Principal, *, factory: SessionFactoryDep,
) -> CashMembershipSaleDTO:
    """Post one published-plan membership purchase to the live open cash shift."""
    dto, replayed = service.post_cash_membership_sale(factory, principal, register_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.get("/{register_id}/members/{member_id}/debts", response_model=list[RegisterMemberOpenDebtDTO])
def list_register_member_open_debts_endpoint(
    register_id: UUID, member_id: UUID, principal: Principal, *, session: SessionDep,
) -> list[RegisterMemberOpenDebtDTO]:
    """List open membership debts for a member on the specified active branch register."""
    return service.list_register_member_open_debts(session, principal, register_id, member_id)


@router.post("/{register_id}/membership-debt-payments", response_model=MembershipDebtPaymentDTO, status_code=201)
def post_membership_debt_payment_endpoint(
    register_id: UUID, payload: MembershipDebtPaymentRequest, response: Response, idempotency_key: IdempotencyKey,
    principal: Principal, *, factory: SessionFactoryDep,
) -> MembershipDebtPaymentDTO:
    """Collect an explicit membership debt abono to the current open branch shift."""
    dto, replayed = service.post_membership_debt_payment(factory, principal, register_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.post("/{register_id}/membership-transfer-sales", response_model=CashMembershipSaleDTO, status_code=201)
def post_membership_transfer_endpoint(
    register_id: UUID, payload: CashMembershipSaleRequest, response: Response, idempotency_key: IdempotencyKey,
    principal: Principal, *, factory: SessionFactoryDep,
) -> CashMembershipSaleDTO:
    """Record a bank transfer as pending without settlement or activation."""
    dto, replayed = service.post_membership_transfer(factory, principal, register_id, payload, idempotency_key)
    _status(response, replayed)
    return dto


@router.post("/transfer-payments/{payment_id}/review", response_model=CashMembershipSaleDTO)
def review_membership_transfer_endpoint(
    payment_id: UUID, payload: TransferReviewRequest, idempotency_key: IdempotencyKey,
    principal: Principal, *, session: SessionDep,
) -> CashMembershipSaleDTO:
    """Record an authorized bank-transfer review decision for its linked membership period."""
    return service.review_membership_transfer(session, principal, payment_id, payload, idempotency_key)
