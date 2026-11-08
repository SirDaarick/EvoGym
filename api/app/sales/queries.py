"""Transactional, server-priced membership cash-sale posting."""
from calendar import monthrange
from dataclasses import dataclass
from enum import StrEnum
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, null, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import (
    Branch, CashRegister, ClassSampleEntitlement, Member, MembershipPeriod, Order, OrderItem, Payment,
    MembershipDebt, MembershipDebtPayment, PaymentReviewEvent, Plan, PlanVersion, Shift,
    Product, StockInitialization, StockMovement, ProductRefund, ProductSaleCancellation, ProductSaleIntent, StaffUser,
    PaymentTerminal, RoleGrant,
)
from app.credit.queries import apply_credit, credit_applied_for_order, lock_member
from app.errors import AppError
from app.inventory.queries import get_on_hand_stock
from app.sales.schemas import EligibleProductReturnDTO, ProductCartLineRequest, RegisterMemberOpenDebtDTO

MAX_MINOR = 2**63 - 1


def product_sale_fingerprint(register_id, member_id, items, expected_total_minor, credit_minor=0):
    lines = sorted((str(item.product_id), item.quantity) for item in items)
    parts = (str(register_id), str(member_id), lines, expected_total_minor)
    # Credit-free requests keep the original canonical form so earlier idempotency keys still match.
    return sha256(repr(parts + (credit_minor,) if credit_minor else parts).encode()).hexdigest()


def _validate_sale_credit(credit_minor, total, member_id) -> None:
    """Credit pays part of a product sale: it needs a member and cannot exceed the total."""
    if type(credit_minor) is not int or not 0 <= credit_minor <= total:
        raise ProductSaleRejected("Credit amount must be between zero and the sale total.")
    if credit_minor and member_id is None:
        raise ProductSaleRejected("Saldo a favor requires an assigned member.")


def get_product_sale_intent(session, *, actor_id):
    return session.get(ProductSaleIntent, actor_id)


def prepare_product_sale(session, *, register_id, actor_id, member_id, items, expected_total_minor, idempotency_key,
                         credit_minor=0):
    seller = session.scalar(select(StaffUser).where(StaffUser.id == actor_id).with_for_update(key_share=True))
    if seller is None or not seller.is_active:
        raise CashSaleConflictError("Staff account is inactive.")
    register = session.get(CashRegister, register_id)
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    fingerprint = product_sale_fingerprint(register_id, member_id, items, expected_total_minor, credit_minor)
    existing = session.get(ProductSaleIntent, actor_id)
    if existing:
        if existing.register_id != register_id or existing.idempotency_key != idempotency_key or existing.request_fingerprint != fingerprint:
            raise CashSaleConflictError("Another product sale intent is unresolved.")
        return existing
    if session.get(ProductSaleCancellation, (actor_id, register.branch_id, idempotency_key)):
        raise CashSaleConflictError("Product sale intent was cancelled.")
    if session.scalar(select(Order.id).where(Order.seller_id == actor_id, Order.branch_id == register.branch_id,
                                             Order.idempotency_key == idempotency_key)):
        raise CashSaleConflictError("Product sale intent was already completed.")
    intent = ProductSaleIntent(seller_id=actor_id, register_id=register_id, idempotency_key=idempotency_key,
        request_fingerprint=fingerprint, payload={"member_id": str(member_id) if member_id else None,
        "items": [{"product_id": str(item.product_id), "quantity": item.quantity} for item in items],
        "expected_total_minor": expected_total_minor, **({"credit_minor": credit_minor} if credit_minor else {})})
    session.add(intent)
    session.flush()
    return intent


class SalePolicy(StrEnum):
    ONLINE = "online"
    CONTINGENCY = "contingency"


@dataclass(frozen=True)
class ContingencySaleResult:
    order: Order
    replayed: bool
    # [{product_id, on_hand_before, quantity, on_hand_after}] for every line whose resulting stock is < 0.
    variances: list[dict]
    # [{product_id, device_unit_price_minor, server_unit_price_minor}] where the device price differed.
    price_drifts: list[dict]


def post_cash_product_sale(session, *, register_id, actor_id, member_id, items, expected_total_minor, idempotency_key,
                           credit_minor=0):
    """Online sale: server-priced, rejects insufficient or uninitialized stock.

    `credit_minor` of the total is drawn from the member's saldo a favor; cash covers the rest.
    """
    order, replayed, _, _ = _post_cash_sale(
        session, register_id=register_id, actor_id=actor_id, member_id=member_id, items=items,
        expected_total_minor=expected_total_minor, idempotency_key=idempotency_key, policy=SalePolicy.ONLINE,
        credit_minor=credit_minor)
    return order, replayed


def post_contingency_cash_sale(
    session, *, register_id, actor_id, member_id, items, expected_total_minor, idempotency_key,
    occurred_at: datetime | None = None, unit_prices: dict[UUID, int] | None = None,
    offline_receipt_number: str | None = None, shift_id: UUID | None = None,
) -> ContingencySaleResult:
    """Offline-replayed cash sale: device prices, no sale intent, negative stock allowed (reported as variances).

    `shift_id` pins the sale to a specific (open) shift of the register instead of the register's current one.
    """
    order, replayed, variances, drifts = _post_cash_sale(
        session, register_id=register_id, actor_id=actor_id, member_id=member_id, items=items,
        expected_total_minor=expected_total_minor, idempotency_key=idempotency_key,
        policy=SalePolicy.CONTINGENCY, occurred_at=occurred_at, unit_prices=unit_prices,
        offline_receipt_number=offline_receipt_number, shift_id=shift_id)
    return ContingencySaleResult(order, replayed, variances, drifts)


def _post_cash_sale(session, *, register_id, actor_id, member_id, items, expected_total_minor, idempotency_key,
                    policy, occurred_at=None, unit_prices=None, offline_receipt_number=None, shift_id=None,
                    credit_minor=0):
    contingency = policy is SalePolicy.CONTINGENCY
    unit_prices = unit_prices or {}
    # Keep seller serialization compatible with shift-close foreign key checks.
    session.scalar(select(StaffUser.id).where(StaffUser.id == actor_id).with_for_update(key_share=True))
    register = session.scalar(select(CashRegister).where(CashRegister.id == register_id).with_for_update())
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    if contingency and credit_minor:
        raise ProductSaleRejected("Saldo a favor cannot be used in offline sales.")
    fingerprint = product_sale_fingerprint(register_id, member_id, items, expected_total_minor, credit_minor)
    cancellation = session.get(ProductSaleCancellation, (actor_id, register.branch_id, idempotency_key))
    if cancellation is not None:
        raise ProductSaleRejected("Product sale intent was cancelled.")
    existing = session.scalar(select(Order).where(Order.seller_id == actor_id, Order.branch_id == register.branch_id,
                                                  Order.idempotency_key == idempotency_key).with_for_update())
    if existing:
        if existing.request_fingerprint != fingerprint or existing.order_kind != "product":
            raise ProductSaleIdempotencyConflict("Idempotency key was already used for a different request.")
        return existing, True, [], []
    if register.status != "active":
        raise ProductSaleRejected("Cash register is not active.")
    branch = session.get(Branch, register.branch_id)
    if branch is None or not branch.is_active:
        raise ProductSaleRejected("Branch is not active.")
    shift_filter = [Shift.cash_register_id == register_id, Shift.status == "open"]
    if shift_id is not None:
        shift_filter.append(Shift.id == shift_id)
    shift = session.scalar(select(Shift).where(*shift_filter).with_for_update())
    is_overtime = shift is None
    if is_overtime:
        shift = session.scalar(select(Shift).where(
            Shift.cash_register_id == register_id, Shift.status == "closed", Shift.closed_at.is_not(None)
        ).order_by(Shift.closed_at.desc(), Shift.id.desc()).limit(1).with_for_update())
        if shift is None:
            raise FirstShiftRequired("Open the first shift before making a sale.")
    if member_id is not None and session.get(Member, member_id) is None:
        raise CashSaleNotFoundError("Member not found.")
    if len({item.product_id for item in items}) != len(items):
        raise ProductSaleRejected("Each product may occur only once.")
    rows = []
    variances = []
    price_drifts = []
    total = 0
    for item in sorted(items, key=lambda line: str(line.product_id)):
        product = session.scalar(select(Product).where(Product.id == item.product_id).with_for_update())
        if product is None or not (product.is_active or contingency):
            raise CashSaleNotFoundError("Active product not found.")
        unit_price = product.price_minor
        if contingency:
            on_hand = get_on_hand_stock(session, branch_id=register.branch_id, product_id=product.id)
            if item.product_id in unit_prices and unit_prices[item.product_id] != product.price_minor:
                unit_price = unit_prices[item.product_id]
                price_drifts.append({"product_id": product.id, "device_unit_price_minor": unit_price,
                                     "server_unit_price_minor": product.price_minor})
            if on_hand - item.quantity < 0:
                variances.append({"product_id": product.id, "on_hand_before": on_hand,
                                  "quantity": item.quantity, "on_hand_after": on_hand - item.quantity})
        initialization = session.scalar(select(StockInitialization).where(
            StockInitialization.branch_id == register.branch_id, StockInitialization.product_id == product.id
        ).with_for_update())
        if not contingency and (initialization is None or get_on_hand_stock(
                session, branch_id=register.branch_id, product_id=product.id) < item.quantity):
            raise ProductSaleRejected("Product stock is not initialized or insufficient.")
        line_total = unit_price * item.quantity
        total += line_total
        if total > MAX_MINOR:
            raise ValueError("Sale total exceeds supported minor units.")
        rows.append((product, item.quantity, line_total, unit_price))
    if total != expected_total_minor:
        raise ProductSaleRejected("Product prices changed; review the total.")
    _validate_sale_credit(credit_minor, total, member_id)
    order = Order(branch_id=register.branch_id, register_id=register_id, shift_id=shift.id,
                  financial_shift_id=None if is_overtime else shift.id, is_overtime=is_overtime,
                  member_id=member_id, seller_id=actor_id, order_kind="product", idempotency_key=idempotency_key,
                  request_fingerprint=fingerprint, total_minor=total)
    if occurred_at is not None:
        order.created_at = occurred_at
    if contingency:
        order.origin = "contingency"
    if offline_receipt_number is not None:
        order.offline_receipt_number = offline_receipt_number
    session.add(order)
    session.flush()
    for number, (product, quantity, line_total, unit_price) in enumerate(rows, 1):
        line = OrderItem(order_id=order.id, product_id=product.id, plan_version_id=None,
                         item_kind="product", entitlement_mode=null(), line_number=number,
                         description_snapshot=product.name, quantity=quantity,
                         unit_amount_minor=unit_price, line_total_minor=line_total)
        session.add(line)
        session.flush()
        movement = StockMovement(branch_id=register.branch_id, product_id=product.id, kind="sale",
                                 quantity=quantity, recorded_by=actor_id, order_item_id=line.id,
                                 idempotency_key=f"sale:{line.id}")
        if occurred_at is not None:
            movement.recorded_at = occurred_at
        session.add(movement)
    payment = Payment(order_id=order.id, method="cash", status="confirmed", amount_minor=total - credit_minor,
                      received_by=actor_id)
    if occurred_at is not None:
        payment.created_at = occurred_at
    session.add(payment)
    session.flush()
    if credit_minor:
        apply_credit(session, member=lock_member(session, member_id), register=register, shift=shift,
                     actor_id=actor_id, amount_minor=credit_minor, order_id=order.id)
    session.refresh(order, ["items", "payment"])
    return order, False, variances, price_drifts


def post_card_product_sale(
    session: Session,
    *,
    register_id: UUID,
    actor_id: UUID,
    member_id: UUID | None,
    items: list[ProductCartLineRequest],
    expected_total_minor: int,
    idempotency_key: str,
    card_intent_id: str,
    terminal_id: UUID | None = None,
    card_brand: str | None = None,
    card_last_four: str | None = None,
    authorization_code: str | None = None,
    mp_payment_id: str | None = None,
    credit_minor: int = 0,
) -> tuple[Order, bool]:
    """Post a Point card product sale; `credit_minor` of the total is drawn from saldo a favor (the card
    was charged only the remainder)."""
    # Keep seller serialization compatible with shift-close foreign key checks.
    session.scalar(select(StaffUser.id).where(StaffUser.id == actor_id).with_for_update(key_share=True))
    register = session.scalar(select(CashRegister).where(CashRegister.id == register_id).with_for_update())
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    fingerprint = product_sale_fingerprint(register_id, member_id, items, expected_total_minor, credit_minor)
    cancellation = session.get(ProductSaleCancellation, (actor_id, register.branch_id, idempotency_key))
    if cancellation is not None:
        raise ProductSaleRejected("Product sale intent was cancelled.")
    existing = session.scalar(select(Order).where(Order.seller_id == actor_id, Order.branch_id == register.branch_id,
                                                  Order.idempotency_key == idempotency_key).with_for_update())
    if existing:
        if existing.request_fingerprint != fingerprint or existing.order_kind != "product":
            raise ProductSaleIdempotencyConflict("Idempotency key was already used for a different request.")
        return existing, True
    if session.scalar(select(Payment.id).where(Payment.mp_payment_intent_id == card_intent_id)) is not None:
        raise ProductSaleRejected("Card payment intent was already used.")
    if register.status != "active":
        raise ProductSaleRejected("Cash register is not active.")
    branch = session.get(Branch, register.branch_id)
    if branch is None or not branch.is_active:
        raise ProductSaleRejected("Branch is not active.")
    shift = session.scalar(select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open").with_for_update())
    is_overtime = shift is None
    if is_overtime:
        shift = session.scalar(select(Shift).where(
            Shift.cash_register_id == register_id, Shift.status == "closed", Shift.closed_at.is_not(None)
        ).order_by(Shift.closed_at.desc(), Shift.id.desc()).limit(1).with_for_update())
        if shift is None:
            raise FirstShiftRequired("Open the first shift before making a sale.")
    if member_id is not None and session.get(Member, member_id) is None:
        raise CashSaleNotFoundError("Member not found.")
    if len({item.product_id for item in items}) != len(items):
        raise ProductSaleRejected("Each product may occur only once.")
    rows = []
    total = 0
    for item in sorted(items, key=lambda line: str(line.product_id)):
        product = session.scalar(select(Product).where(Product.id == item.product_id).with_for_update())
        if product is None or not product.is_active:
            raise CashSaleNotFoundError("Active product not found.")
        initialization = session.scalar(select(StockInitialization).where(
            StockInitialization.branch_id == register.branch_id, StockInitialization.product_id == product.id
        ).with_for_update())
        if initialization is None or get_on_hand_stock(session, branch_id=register.branch_id, product_id=product.id) < item.quantity:
            raise ProductSaleRejected("Product stock is not initialized or insufficient.")
        line_total = product.price_minor * item.quantity
        total += line_total
        if total > MAX_MINOR:
            raise ValueError("Sale total exceeds supported minor units.")
        rows.append((product, item.quantity, line_total))
    if total != expected_total_minor:
        raise ProductSaleRejected("Product prices changed; review the total.")
    _validate_sale_credit(credit_minor, total, member_id)
    if credit_minor == total:
        raise ProductSaleRejected("A sale fully covered by credit does not use the card terminal.")
    order = Order(branch_id=register.branch_id, register_id=register_id, shift_id=shift.id,
                  financial_shift_id=None if is_overtime else shift.id, is_overtime=is_overtime,
                  member_id=member_id, seller_id=actor_id, order_kind="product", idempotency_key=idempotency_key,
                  request_fingerprint=fingerprint, total_minor=total)
    session.add(order)
    session.flush()
    for number, (product, quantity, line_total) in enumerate(rows, 1):
        line = OrderItem(order_id=order.id, product_id=product.id, plan_version_id=None,
                         item_kind="product", entitlement_mode=null(), line_number=number,
                         description_snapshot=product.name, quantity=quantity,
                         unit_amount_minor=product.price_minor, line_total_minor=line_total)
        session.add(line)
        session.flush()
        session.add(StockMovement(branch_id=register.branch_id, product_id=product.id, kind="sale",
                                  quantity=quantity, recorded_by=actor_id, order_item_id=line.id,
                                  idempotency_key=f"sale:{line.id}"))
    payment = Payment(
        order_id=order.id,
        method="card",
        status="confirmed",
        amount_minor=total - credit_minor,
        received_by=actor_id,
        terminal_id=terminal_id,
        mp_payment_intent_id=card_intent_id,
        mp_payment_id=mp_payment_id,
        card_brand=card_brand,
        card_last_four=card_last_four,
        authorization_code=authorization_code,
    )
    session.add(payment)
    try:
        session.flush()
    except IntegrityError as exc:  # concurrent sale won the unique mp_payment_intent_id; the caller rolls back
        raise ProductSaleRejected("Card payment intent was already used.") from exc
    if credit_minor:
        apply_credit(session, member=lock_member(session, member_id), register=register, shift=shift,
                     actor_id=actor_id, amount_minor=credit_minor, order_id=order.id)
    session.refresh(order, ["items", "payment"])
    return order, False


def resolve_product_sale(session, *, register_id, actor_id, member_id, items, expected_total_minor, idempotency_key,
                         credit_minor=0):
    # Both operations lock the seller first so cancellation cannot race a delayed POST.
    session.scalar(select(StaffUser.id).where(StaffUser.id == actor_id).with_for_update(key_share=True))
    register = session.scalar(select(CashRegister).where(CashRegister.id == register_id).with_for_update())
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    fingerprint = product_sale_fingerprint(register_id, member_id, items, expected_total_minor, credit_minor)
    order = session.scalar(select(Order).where(Order.seller_id == actor_id, Order.branch_id == register.branch_id,
                                               Order.idempotency_key == idempotency_key))
    if order is not None:
        if order.order_kind != "product" or order.request_fingerprint != fingerprint:
            raise ProductSaleIdempotencyConflict("Idempotency key was already used for a different request.")
        return order
    cancellation = session.get(ProductSaleCancellation, (actor_id, register.branch_id, idempotency_key))
    if cancellation is not None:
        if cancellation.request_fingerprint != fingerprint:
            raise ProductSaleIdempotencyConflict("Idempotency key was already used for a different request.")
        return None
    session.add(ProductSaleCancellation(seller_id=actor_id, branch_id=register.branch_id,
                                        idempotency_key=idempotency_key, request_fingerprint=fingerprint))
    session.flush()
    return None


def product_return_fingerprint(register_id, order_item_id, reason, disposition, payout_method):
    return sha256(repr((str(register_id), str(order_item_id), reason.strip(), disposition, payout_method)).encode()).hexdigest()


class ProductReturnNotFoundError(LookupError):
    """A requested member, register, order item, or shift is unavailable."""


_PUBLIC_RETURN_MESSAGES = frozenset({
    "Branch is not active.",
    "Cash register is not active.",
    "Cross-branch returns are not allowed.",
    "Idempotency key was already used for a different request.",
    "Only orders with confirmed payment can be returned.",
    "Only product order items can be returned.",
    "Only product orders can be returned.",
    "Orders paid with saldo a favor cannot be returned yet.",
    "Open the first shift before recording a return.",
    "Returns are only allowed on the same calendar day of purchase.",
    "Staff account is inactive.",
    "This product order item has already been returned.",
    "Unassigned sales cannot be returned.",
})


class ProductReturnConflictError(AppError):
    """A return request conflicts with eligibility, idempotency, or current state."""

    code, status = "product_return_rejected", 409

    @property
    def message(self):  # Only vetted literals reach the client; anything else is generic.
        return str(self) if str(self) in _PUBLIC_RETURN_MESSAGES else "The request could not be completed."


class ProductReturnIdempotencyConflict(ProductReturnConflictError):
    code = "idempotency_conflict"


def list_eligible_product_returns(
    session: Session,
    *,
    register_id: UUID,
    member_id: UUID,
) -> list[EligibleProductReturnDTO]:
    register = session.get(CashRegister, register_id)
    if register is None:
        raise ProductReturnNotFoundError("Cash register not found.")
    member = session.get(Member, member_id)
    if member is None:
        raise ProductReturnNotFoundError("Member not found.")
    branch = session.get(Branch, register.branch_id)
    if branch is None:
        raise ProductReturnNotFoundError("Branch not found.")

    try:
        branch_zone = ZoneInfo(branch.timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise InvalidBranchTimezoneError("Branch timezone is invalid.") from exc

    today = datetime.now(timezone.utc).astimezone(branch_zone).date()

    orders = session.scalars(
        select(Order)
        .where(
            Order.member_id == member_id,
            Order.branch_id == register.branch_id,
            Order.order_kind == "product",
        )
        .order_by(Order.created_at.desc(), Order.id.desc())
    ).all()

    eligible: list[EligibleProductReturnDTO] = []
    for order in orders:
        if not order.payment or order.payment.status != "confirmed":
            continue
        if credit_applied_for_order(session, order.id):
            continue  # a refund would pay out cash for money the member paid from saldo a favor
        order_created = order.created_at if order.created_at.tzinfo is not None else order.created_at.replace(tzinfo=timezone.utc)
        if order_created.astimezone(branch_zone).date() != today:
            continue

        for item in order.items:
            if item.item_kind != "product" or item.product_id is None:
                continue
            is_refunded = session.scalar(
                select(ProductRefund.id).where(ProductRefund.order_item_id == item.id)
            ) is not None
            if is_refunded:
                continue
            eligible.append(
                EligibleProductReturnDTO(
                    order_item_id=item.id,
                    order_id=order.id,
                    product_id=item.product_id,
                    product_name=item.description_snapshot,
                    quantity=item.quantity,
                    unit_amount_minor=item.unit_amount_minor,
                    line_total_minor=item.line_total_minor,
                    original_payment_method=order.payment.method,
                    created_at=order.created_at,
                )
            )
    return eligible


def post_product_return(
    session: Session,
    *,
    register_id: UUID,
    actor_id: UUID,
    order_item_id: UUID,
    reason: str,
    disposition: str,
    payout_method: str,
    idempotency_key: str,
) -> tuple[ProductRefund, bool]:
    clean_reason = reason.strip() if isinstance(reason, str) else ""
    if not clean_reason or len(clean_reason) > 240:
        raise ValueError("Reason must be between 1 and 240 characters.")
    if disposition not in ("restock", "waste"):
        raise ValueError("Disposition must be 'restock' or 'waste'.")
    if payout_method not in ("cash", "card"):
        raise ValueError("Payout method must be 'cash' or 'card'.")

    actor = session.scalar(select(StaffUser).where(StaffUser.id == actor_id).with_for_update(key_share=True))
    if actor is None or not actor.is_active:
        raise ProductReturnConflictError("Staff account is inactive.")

    register = session.scalar(select(CashRegister).where(CashRegister.id == register_id).with_for_update())
    if register is None:
        raise ProductReturnNotFoundError("Cash register not found.")
    if register.status != "active":
        raise ProductReturnConflictError("Cash register is not active.")

    branch = session.get(Branch, register.branch_id)
    if branch is None or not branch.is_active:
        raise ProductReturnConflictError("Branch is not active.")

    fingerprint = product_return_fingerprint(register_id, order_item_id, clean_reason, disposition, payout_method)

    existing = session.scalar(
        select(ProductRefund).where(
            ProductRefund.actor_id == actor_id,
            ProductRefund.branch_id == register.branch_id,
            ProductRefund.idempotency_key == idempotency_key,
        ).with_for_update()
    )
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise ProductReturnIdempotencyConflict("Idempotency key was already used for a different request.")
        return existing, True

    shift = session.scalar(
        select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open").with_for_update()
    )
    is_overtime = shift is None
    if is_overtime:
        shift = session.scalar(
            select(Shift).where(
                Shift.cash_register_id == register_id, Shift.status == "closed", Shift.closed_at.is_not(None)
            ).order_by(Shift.closed_at.desc(), Shift.id.desc()).limit(1).with_for_update()
        )
        if shift is None:
            raise ProductReturnConflictError("Open the first shift before recording a return.")

    order_item = session.scalar(select(OrderItem).where(OrderItem.id == order_item_id).with_for_update())
    if order_item is None:
        raise ProductReturnNotFoundError("Order item not found.")
    if order_item.item_kind != "product" or order_item.product_id is None:
        raise ProductReturnConflictError("Only product order items can be returned.")

    order = session.scalar(select(Order).where(Order.id == order_item.order_id).with_for_update())
    if order is None:
        raise ProductReturnNotFoundError("Order not found.")
    if order.order_kind != "product":
        raise ProductReturnConflictError("Only product orders can be returned.")
    if order.member_id is None:
        raise ProductReturnConflictError("Unassigned sales cannot be returned.")
    if order.branch_id != register.branch_id:
        raise ProductReturnConflictError("Cross-branch returns are not allowed.")
    if order.payment is None or order.payment.status != "confirmed":
        raise ProductReturnConflictError("Only orders with confirmed payment can be returned.")
    if payout_method != order.payment.method:
        raise ProductReturnConflictError("Refund must use the original payment method.")
    if credit_applied_for_order(session, order.id):
        raise ProductReturnConflictError("Orders paid with saldo a favor cannot be returned yet.")

    try:
        branch_zone = ZoneInfo(branch.timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise InvalidBranchTimezoneError("Branch timezone is invalid.") from exc

    effective_at = datetime.now(timezone.utc)
    local_today = effective_at.astimezone(branch_zone).date()
    order_created_at = order.created_at if order.created_at.tzinfo is not None else order.created_at.replace(tzinfo=timezone.utc)
    if order_created_at.astimezone(branch_zone).date() != local_today:
        raise ProductReturnConflictError("Returns are only allowed on the same calendar day of purchase.")

    already_refunded = session.scalar(
        select(ProductRefund.id).where(ProductRefund.order_item_id == order_item.id).with_for_update()
    )
    if already_refunded is not None:
        raise ProductReturnConflictError("This product order item has already been returned.")

    session.scalar(
        select(StockInitialization).where(
            StockInitialization.branch_id == register.branch_id,
            StockInitialization.product_id == order_item.product_id,
        ).with_for_update()
    )

    refund_id = uuid4()
    refund = ProductRefund(
        id=refund_id,
        order_item_id=order_item.id,
        branch_id=register.branch_id,
        register_id=register_id,
        shift_id=shift.id,
        financial_shift_id=None if is_overtime else shift.id,
        actor_id=actor_id,
        reason=clean_reason,
        disposition=disposition,
        payout_method=payout_method,
        amount_minor=order_item.line_total_minor,
        quantity=order_item.quantity,
        idempotency_key=idempotency_key,
        request_fingerprint=fingerprint,
    )
    session.add(refund)

    if disposition == "restock":
        movement = StockMovement(
            branch_id=register.branch_id,
            product_id=order_item.product_id,
            kind="return",
            quantity=order_item.quantity,
            reason=f"Return: {clean_reason}",
            recorded_by=actor_id,
            order_item_id=None,
            idempotency_key=f"return:{refund_id}",
        )
        session.add(movement)
    elif disposition == "waste":
        movement = StockMovement(
            branch_id=register.branch_id,
            product_id=order_item.product_id,
            kind="waste",
            quantity=order_item.quantity,
            reason=f"Return waste: {clean_reason}",
            recorded_by=actor_id,
            order_item_id=None,
            idempotency_key=f"return:{refund_id}",
        )
        session.add(movement)

    session.flush()
    return refund, False


class CashSaleNotFoundError(LookupError):
    """A requested member, register, plan version, or shift is unavailable."""


class CashSaleConflictError(ValueError):
    """A request conflicts with current state or an existing idempotency key."""


class ProductSaleRejected(CashSaleConflictError, AppError):
    """Product-sale precondition failed; internal text stays in args."""

    code, status, message = "product_sale_rejected", 409, "The request could not be completed."


class ProductSaleIdempotencyConflict(ProductSaleRejected):
    code = "idempotency_conflict"


class FirstShiftRequired(ProductSaleRejected):
    code = "first_shift_required"


class InvalidBranchTimezoneError(ValueError):
    """A branch's stored timezone cannot safely determine its operational date."""


class CashSaleAccessDenied(PermissionError):
    """The locked register is outside the authenticated staff branch."""


@dataclass(frozen=True)
class CashMembershipSaleResult:
    order: Order
    item: OrderItem
    payment: Payment
    membership: MembershipPeriod | None
    sample_entitlement: ClassSampleEntitlement | None
    replayed: bool
    credit_applied_minor: int = 0


@dataclass(frozen=True)
class MembershipDebtPaymentResult:
    receipt: MembershipDebtPayment
    replayed: bool


def _add_months(value: date, count: int) -> date:
    absolute_month = value.year * 12 + (value.month - 1) + count
    year, zero_month = divmod(absolute_month, 12)
    month = zero_month + 1
    if not 1 <= year <= 9999:
        raise ValueError("Membership end date exceeds supported calendar range.")
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def _add_duration(value: date, count: int, unit: str) -> date:
    if type(count) is not int or count <= 0:
        raise ValueError("Published membership duration must be a positive integer.")
    try:
        if unit == "day":
            return value + timedelta(days=count)
        if unit == "month":
            return _add_months(value, count)
        if unit == "year":
            target_year = value.year + count
            if target_year > 9999:
                raise ValueError("Membership end date exceeds supported calendar range.")
            return date(target_year, value.month, min(value.day, monthrange(target_year, value.month)[1]))
    except OverflowError as exc:
        raise ValueError("Membership end date exceeds supported calendar range.") from exc
    raise ValueError("Published membership duration unit is unsupported.")


def membership_sale_fingerprint(
    register_id: UUID,
    member_id: UUID,
    plan_version_id: UUID,
    source_shift_id: UUID | None = None,
    payment_method: str = "cash",
    cash_amount_minor: int | None = None,
    cash_amount_provided: bool = False,
    credit_minor: int = 0,
) -> str:
    canonical = f"{register_id}\n{member_id}\n{plan_version_id}"
    if source_shift_id is not None:
        canonical += f"\n{source_shift_id}"
    if payment_method != "cash":
        canonical += f"\n{payment_method}"
    if cash_amount_provided:
        canonical += f"\ncash_amount_minor:{cash_amount_minor}"
    if credit_minor:
        canonical += f"\ncredit_minor:{credit_minor}"
    payload = canonical.encode("ascii")
    return sha256(payload).hexdigest()


def load_sale_result(session: Session, order: Order, replayed: bool) -> CashMembershipSaleResult:
    items = list(order.items)
    if len(items) != 1 or order.payment is None:
        raise RuntimeError("Persisted membership cash sale is incomplete.")
    item = items[0]
    membership = session.scalar(select(MembershipPeriod).where(MembershipPeriod.order_item_id == item.id))
    sample_entitlement = session.scalar(select(ClassSampleEntitlement).where(ClassSampleEntitlement.order_item_id == item.id))
    if item.entitlement_mode == "period" and order.payment.method == "cash" and membership is None:
        raise RuntimeError("Persisted membership cash sale has no activation period.")
    if item.entitlement_mode == "period" and order.payment.method == "transfer" and order.payment.status in {"under_review", "confirmed"} and membership is None:
        raise RuntimeError("Voucher-backed membership transfer has no membership period.")
    if item.entitlement_mode == "single_entry" and sample_entitlement is None:
        raise RuntimeError("Persisted class sample sale has no retained entitlement.")
    return CashMembershipSaleResult(order, item, order.payment, membership, sample_entitlement, replayed,
                                    credit_applied_for_order(session, order.id))


def post_membership_cash_sale(
    session: Session,
    *,
    register_id: UUID,
    actor_id: UUID,
    authorized_branch_id: UUID | None,
    member_id: UUID,
    plan_version_id: UUID,
    idempotency_key: str,
    source_shift_id: UUID | None = None,
    now: datetime | None = None,
    payment_method: str = "cash",
    cash_amount_minor: int | None = None,
    cash_amount_provided: bool = False,
    credit_minor: int = 0,
) -> CashMembershipSaleResult:
    """Persist a cash membership sale or an unsettled transfer atomically.

    `credit_minor` of the price is drawn from the member's saldo a favor; cash (or the transfer)
    covers the rest and any cash shortfall becomes the membership debt.

    The caller owns commit/rollback. Register and member row locks serialize same-drawer
    posting and concurrent renewals; the function never performs external payment I/O.
    """
    if payment_method not in {"cash", "transfer"}:
        raise ValueError("Unsupported membership payment method.")
    if payment_method == "transfer" and cash_amount_provided:
        raise CashSaleConflictError("Partial cash amount is not supported for transfers.")
    if cash_amount_provided and (type(cash_amount_minor) is not int or cash_amount_minor <= 0):
        raise ValueError("Cash amount must be a positive integer number of minor units.")
    if not cash_amount_provided and cash_amount_minor is not None:
        raise ValueError("Cash amount must be explicitly marked as provided.")
    if type(credit_minor) is not int or not 0 <= credit_minor <= MAX_MINOR:
        raise ValueError("Credit amount must be a non-negative signed 64-bit integer.")
    if payment_method == "transfer" and source_shift_id is not None:
        raise CashSaleConflictError("Pending transfers require the current open shift.")
    if not isinstance(idempotency_key, str) or not idempotency_key or len(idempotency_key) > 128:
        raise ValueError("Idempotency key must contain between 1 and 128 characters.")

    register = session.scalar(
        select(CashRegister).where(CashRegister.id == register_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    if authorized_branch_id is not None and register.branch_id != authorized_branch_id:
        raise CashSaleAccessDenied("Access restricted to staff branch.")

    fingerprint = membership_sale_fingerprint(
        register_id, member_id, plan_version_id, source_shift_id, payment_method,
        cash_amount_minor, cash_amount_provided, credit_minor,
    )
    existing = session.scalar(
        select(Order).where(
            Order.seller_id == actor_id,
            Order.branch_id == register.branch_id,
            Order.idempotency_key == idempotency_key,
        ).with_for_update()
    )
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise CashSaleConflictError("Idempotency key was already used for a different request.")
        return load_sale_result(session, existing, replayed=True)

    if register.status != "active":
        raise CashSaleConflictError("Cash register is not active.")

    successor = session.scalar(
        select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open")
        .execution_options(populate_existing=True).with_for_update()
    )
    if source_shift_id is None:
        if successor is None:
            raise CashSaleConflictError("An open shift is required for a cash sale.")
        source_shift = successor
        financial_shift_id = successor.id if payment_method == "cash" else None
        is_overtime = False
    else:
        source_shift = session.scalar(
            select(Shift).where(
                Shift.id == source_shift_id,
                Shift.cash_register_id == register_id,
                Shift.status == "closed",
                Shift.closed_at.is_not(None),
            ).execution_options(populate_existing=True).with_for_update()
        )
        if source_shift is None:
            raise CashSaleConflictError("Overtime source must be a closed shift on this register.")
        predecessor_query = select(Shift.id).where(
            Shift.cash_register_id == register_id,
            Shift.status == "closed",
            Shift.closed_at.is_not(None),
        )
        predecessor_id = session.scalar(
            predecessor_query.order_by(Shift.closed_at.desc(), Shift.id.desc()).limit(1)
        )
        if predecessor_id != source_shift.id:
            raise CashSaleConflictError("Overtime source must be the latest closed shift on this register.")
        financial_shift_id = successor.id if successor is not None else None
        is_overtime = True

    member = session.scalar(
        select(Member).where(Member.id == member_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if member is None:
        raise CashSaleNotFoundError("Member not found.")

    plan_row = session.execute(
        select(PlanVersion, Plan)
        .join(Plan, Plan.id == PlanVersion.plan_id)
        .where(PlanVersion.id == plan_version_id)
        .execution_options(populate_existing=True).with_for_update()
    ).one_or_none()
    if plan_row is None:
        raise CashSaleNotFoundError("Published membership plan version not found.")
    version, plan = plan_row
    if plan.kind != "membership" or plan.status != "active" or not version.is_active:
        raise CashSaleNotFoundError("Published membership plan version not found.")
    if version.currency != "MXN":
        raise CashSaleConflictError("Only MXN membership plans can be sold for cash.")
    if type(version.price_minor) is not int or not 0 <= version.price_minor <= MAX_MINOR:
        raise ValueError("Published membership price is outside signed 64-bit minor units.")
    if credit_minor > version.price_minor:
        raise ValueError("Credit amount must not exceed the published membership price.")
    payable_minor = version.price_minor - credit_minor  # what cash (or the transfer) must cover
    if payment_method == "transfer" and payable_minor == 0:
        raise CashSaleConflictError("A price fully covered by credit must be sold as a cash sale.")
    received_minor = payable_minor if not cash_amount_provided else cash_amount_minor
    if type(received_minor) is not int or received_minor < 0 or received_minor > payable_minor:
        raise ValueError("Cash amount must not exceed the published membership price.")
    if version.entitlement_mode == "single_entry" and session.scalar(
        select(ClassSampleEntitlement.id).where(ClassSampleEntitlement.member_id == member_id).with_for_update()
    ) is not None:
        raise CashSaleConflictError("Member already has a class-sample entitlement.")

    branch = session.scalar(
        select(Branch).where(Branch.id == register.branch_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if branch is None:
        raise CashSaleNotFoundError("Branch not found.")
    starts_on = ends_on = None
    if version.entitlement_mode == "period" and payment_method in {"cash", "transfer"}:
        try:
            branch_zone = ZoneInfo(branch.timezone)
        except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
            raise InvalidBranchTimezoneError("Branch timezone is invalid; membership sale was not posted.") from exc

        effective_at = now or datetime.now(timezone.utc)
        if effective_at.tzinfo is None or effective_at.utcoffset() is None:
            raise ValueError("Sale timestamp must be timezone-aware.")
        local_today = effective_at.astimezone(branch_zone).date()
        latest_period = session.scalar(
            select(MembershipPeriod)
            .where(MembershipPeriod.member_id == member_id, MembershipPeriod.ends_on > local_today)
            .order_by(MembershipPeriod.ends_on.desc(), MembershipPeriod.id.desc())
            .limit(1).with_for_update()
        )
        starts_on = latest_period.ends_on if latest_period is not None else local_today
        ends_on = _add_duration(starts_on, version.duration_value, version.duration_unit)

    order = Order(
        id=uuid4(), branch_id=register.branch_id, register_id=register.id, shift_id=source_shift.id,
        financial_shift_id=financial_shift_id, is_overtime=is_overtime,
        member_id=member.id, seller_id=actor_id, idempotency_key=idempotency_key,
        request_fingerprint=fingerprint, currency="MXN", total_minor=version.price_minor,
    )
    item = OrderItem(
        id=uuid4(), order_id=order.id, plan_version_id=version.id, line_number=1,
        item_kind="membership", description_snapshot=version.name, duration_value=version.duration_value,
        duration_unit=version.duration_unit, entitlement_mode=version.entitlement_mode,
        quantity=1, unit_amount_minor=version.price_minor,
        line_total_minor=version.price_minor,
    )
    payment = Payment(
        id=uuid4(), order_id=order.id, method=payment_method,
        status="confirmed" if payment_method == "cash" else "under_review",
        amount_minor=received_minor, received_by=actor_id,
    )
    membership = None
    sample_entitlement = None
    if version.entitlement_mode == "period" and payment_method in {"cash", "transfer"}:
        membership = MembershipPeriod(
            id=uuid4(), member_id=member.id, order_item_id=item.id, plan_version_id=version.id,
            starts_on=starts_on, ends_on=ends_on, activated_by=actor_id,
        )
    session.add(order)
    session.flush()
    session.add_all([item, payment])
    session.flush()
    if version.entitlement_mode == "single_entry":
        sample_entitlement = ClassSampleEntitlement(
            id=uuid4(), member_id=member.id, order_item_id=item.id, plan_version_id=version.id,
        )
        session.add(sample_entitlement)
        session.flush()
    if membership is not None:
        session.add(membership)
        session.flush()
    if payment_method == "transfer":
        review_fingerprint = sha256(f"{payment.id}\nunder_review\n{actor_id}".encode("ascii")).hexdigest()
        session.add(PaymentReviewEvent(
            payment_id=payment.id, actor_id=actor_id, from_status=None, to_status="under_review",
            idempotency_key=None, request_fingerprint=review_fingerprint, created_at=datetime.now(timezone.utc),
        ))
        session.flush()
    elif payment_method == "cash" and received_minor < payable_minor:
        session.add(MembershipDebt(
            id=uuid4(), order_id=order.id, member_id=member.id,
            initial_outstanding_minor=payable_minor - received_minor,
        ))
        session.flush()
    if credit_minor:
        # An overtime sale is counted in the successor shift, like its cash.
        credit_shift = successor if is_overtime and successor is not None else source_shift
        apply_credit(session, member=member, register=register, shift=credit_shift, actor_id=actor_id,
                     amount_minor=credit_minor, order_id=order.id)
    return CashMembershipSaleResult(order, item, payment, membership, sample_entitlement, replayed=False,
                                    credit_applied_minor=credit_minor)


@dataclass(frozen=True)
class TransferReviewResult:
    order: Order
    item: OrderItem
    payment: Payment
    membership: MembershipPeriod | None
    sample_entitlement: ClassSampleEntitlement | None
    replayed: bool
    credit_applied_minor: int = 0


def review_membership_transfer(
    session: Session,
    *,
    payment_id: UUID,
    actor_id: UUID,
    status: str,
    idempotency_key: str,
) -> TransferReviewResult:
    """Append an authorized voucher review decision without changing sold period dates."""
    if status not in {"confirmed", "pending"}:
        raise ValueError("Transfer review status must be confirmed or pending.")
    if not isinstance(idempotency_key, str) or not idempotency_key or len(idempotency_key) > 128:
        raise ValueError("Idempotency key must contain between 1 and 128 characters.")

    observed_payment = session.scalar(select(Payment).where(Payment.id == payment_id))
    if observed_payment is None:
        raise CashSaleNotFoundError("Transfer payment not found.")
    observed_order = session.get(Order, observed_payment.order_id)
    if observed_order is None or observed_payment.method != "transfer":
        raise CashSaleNotFoundError("Transfer payment not found.")

    register = session.scalar(
        select(CashRegister).where(CashRegister.id == observed_order.register_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    member = session.scalar(
        select(Member).where(Member.id == observed_order.member_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if member is None:
        raise CashSaleNotFoundError("Member not found.")
    order = session.scalar(
        select(Order).where(Order.id == observed_order.id)
        .execution_options(populate_existing=True).with_for_update()
    )
    payment = session.scalar(
        select(Payment).where(Payment.id == payment_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    items = list(order.items)
    if len(items) != 1:
        raise CashSaleConflictError("Transfer order has no unambiguous membership item.")
    item = items[0]
    membership = session.scalar(
        select(MembershipPeriod).where(MembershipPeriod.order_item_id == item.id)
        .execution_options(populate_existing=True).with_for_update()
    )
    sample_entitlement = session.scalar(
        select(ClassSampleEntitlement).where(ClassSampleEntitlement.order_item_id == item.id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if item.entitlement_mode == "period" and membership is None:
        raise CashSaleConflictError("Legacy transfer has no voucher-backed membership period.")
    if item.entitlement_mode == "single_entry" and sample_entitlement is None:
        raise CashSaleConflictError("Class-sample transfer has no retained entitlement.")
    initial_event = session.scalar(select(PaymentReviewEvent).where(
        PaymentReviewEvent.payment_id == payment.id,
        PaymentReviewEvent.from_status.is_(None),
        PaymentReviewEvent.to_status == "under_review",
    ))
    if initial_event is None:
        raise CashSaleConflictError("Transfer has no voucher review history.")

    fingerprint = sha256(f"{payment.id}\n{status}\n{actor_id}".encode("ascii")).hexdigest()
    prior = session.scalar(select(PaymentReviewEvent).where(
        PaymentReviewEvent.payment_id == payment.id,
        PaymentReviewEvent.idempotency_key == idempotency_key,
    ).with_for_update())
    if prior is not None:
        if prior.request_fingerprint != fingerprint:
            raise CashSaleConflictError("Review idempotency key was already used for a different decision.")
        return TransferReviewResult(order, item, payment, membership, sample_entitlement, replayed=True,
                                    credit_applied_minor=credit_applied_for_order(session, order.id))

    if payment.status not in {"under_review", "pending", "confirmed"}:
        raise CashSaleConflictError("Transfer payment cannot be reviewed from its current state.")
    session.add(PaymentReviewEvent(
        payment_id=payment.id, actor_id=actor_id, from_status=payment.status, to_status=status,
        idempotency_key=idempotency_key, request_fingerprint=fingerprint, created_at=datetime.now(timezone.utc),
    ))
    payment.status = status
    session.flush()
    return TransferReviewResult(order, item, payment, membership, sample_entitlement, replayed=False,
                                credit_applied_minor=credit_applied_for_order(session, order.id))


def debt_payment_fingerprint(register_id: UUID, order_id: UUID, amount_minor: int, credit_minor: int = 0) -> str:
    # Credit-free requests keep the original canonical form so earlier idempotency keys still replay.
    suffix = f"\ncredit={credit_minor}" if credit_minor else ""
    canonical = f"{register_id}\n{order_id}\n{amount_minor}{suffix}".encode("ascii")
    return sha256(canonical).hexdigest()


def post_membership_debt_payment(
    session: Session,
    *,
    register_id: UUID,
    actor_id: UUID,
    authorized_branch_id: UUID | None,
    order_id: UUID,
    amount_minor: int,
    idempotency_key: str,
    credit_minor: int = 0,
) -> MembershipDebtPaymentResult:
    """Append one repayment to an explicit membership debt and open branch shift.

    `credit_minor` of `amount_minor` is drawn from the member's saldo a favor (no cash moves);
    the remainder is cash received on the shift.
    """
    if type(amount_minor) is not int or not 0 < amount_minor <= MAX_MINOR:
        raise ValueError("Repayment amount must be a positive signed 64-bit integer.")
    if type(credit_minor) is not int or not 0 <= credit_minor <= amount_minor:
        raise ValueError("Credit amount must be between zero and the repayment amount.")
    if not isinstance(idempotency_key, str) or not idempotency_key or len(idempotency_key) > 128:
        raise ValueError("Idempotency key must contain between 1 and 128 characters.")

    register = session.scalar(
        select(CashRegister).where(CashRegister.id == register_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    if authorized_branch_id is not None and register.branch_id != authorized_branch_id:
        raise CashSaleAccessDenied("Access restricted to staff branch.")

    fingerprint = debt_payment_fingerprint(register_id, order_id, amount_minor, credit_minor)
    existing = session.scalar(
        select(MembershipDebtPayment).where(
            MembershipDebtPayment.branch_id == register.branch_id,
            MembershipDebtPayment.received_by == actor_id,
            MembershipDebtPayment.idempotency_key == idempotency_key,
        ).with_for_update()
    )
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise CashSaleConflictError("Idempotency key was already used for a different request.")
        return MembershipDebtPaymentResult(existing, replayed=True)

    if register.status != "active":
        raise CashSaleConflictError("Cash register is not active.")
    shift = session.scalar(
        select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open")
        .execution_options(populate_existing=True).with_for_update()
    )
    if shift is None:
        raise CashSaleConflictError("An open shift is required for a debt repayment.")

    order = session.scalar(select(Order).where(Order.id == order_id))
    if order is None or order.branch_id != register.branch_id:
        raise CashSaleNotFoundError("Membership debt not found.")
    observed_debt = session.scalar(select(MembershipDebt).where(MembershipDebt.order_id == order_id))
    if observed_debt is None or observed_debt.member_id != order.member_id:
        raise CashSaleNotFoundError("Membership debt not found.")

    member = session.scalar(
        select(Member).where(Member.id == order.member_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if member is None:
        raise CashSaleNotFoundError("Membership debt not found.")
    debt = session.scalar(
        select(MembershipDebt).where(MembershipDebt.id == observed_debt.id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if debt is None or debt.member_id != member.id or debt.order_id != order.id:
        raise CashSaleNotFoundError("Membership debt not found.")

    paid_total = 0
    for prior_amount in session.scalars(
        select(MembershipDebtPayment.amount_minor).where(MembershipDebtPayment.debt_id == debt.id)
    ):
        if type(prior_amount) is not int or not 0 < prior_amount <= MAX_MINOR or paid_total > MAX_MINOR - prior_amount:
            raise ValueError("Recorded repayments exceed supported minor-unit bounds.")
        paid_total += prior_amount
    if type(debt.initial_outstanding_minor) is not int or not 0 < debt.initial_outstanding_minor <= MAX_MINOR:
        raise ValueError("Initial membership debt is outside supported minor-unit bounds.")
    if paid_total > debt.initial_outstanding_minor:
        raise ValueError("Recorded repayments exceed the initial membership debt.")
    remaining = debt.initial_outstanding_minor - paid_total
    if remaining == 0:
        raise CashSaleConflictError("Membership debt is already fully repaid.")
    if amount_minor > remaining:
        raise CashSaleConflictError("Repayment cannot exceed the remaining membership debt.")

    receipt = MembershipDebtPayment(
        debt_id=debt.id,
        order_id=order.id,
        member_id=member.id,
        branch_id=register.branch_id,
        register_id=register.id,
        shift_id=shift.id,
        amount_minor=amount_minor,
        credit_minor=credit_minor,
        remaining_after_minor=remaining - amount_minor,
        received_by=actor_id,
        idempotency_key=idempotency_key,
        request_fingerprint=fingerprint,
    )
    session.add(receipt)
    session.flush()
    if credit_minor:
        apply_credit(session, member=member, register=register, shift=shift, actor_id=actor_id,
                     amount_minor=credit_minor, debt_id=debt.id)
    return MembershipDebtPaymentResult(receipt, replayed=False)


def list_register_member_open_debts(
    session: Session,
    *,
    register_id: UUID,
    member_id: UUID,
    authorized_branch_id: UUID | None = None,
) -> list[RegisterMemberOpenDebtDTO]:
    """List open membership debts for a member on the specified active branch register."""
    register = session.scalar(select(CashRegister).where(CashRegister.id == register_id))
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    if authorized_branch_id is not None and register.branch_id != authorized_branch_id:
        raise CashSaleAccessDenied("Access restricted to staff branch.")
    if register.status != "active":
        raise CashSaleConflictError("Cash register is not active.")

    member = session.scalar(select(Member).where(Member.id == member_id))
    if member is None:
        raise CashSaleNotFoundError("Member not found.")

    rows = session.execute(
        select(
            MembershipDebt,
            Order,
            OrderItem.description_snapshot,
            func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0).label("paid_minor"),
        )
        .join(Order, Order.id == MembershipDebt.order_id)
        .outerjoin(OrderItem, (OrderItem.order_id == Order.id) & (OrderItem.line_number == 1))
        .outerjoin(MembershipDebtPayment, MembershipDebtPayment.debt_id == MembershipDebt.id)
        .where(
            MembershipDebt.member_id == member.id,
            Order.branch_id == register.branch_id,
        )
        .group_by(MembershipDebt.id, Order.id, OrderItem.description_snapshot)
        .order_by(Order.created_at.asc(), MembershipDebt.created_at.asc(), MembershipDebt.id.asc())
    ).all()

    open_debts: list[RegisterMemberOpenDebtDTO] = []
    for debt, order, description_snapshot, paid_minor in rows:
        paid = int(paid_minor or 0)
        remaining = debt.initial_outstanding_minor - paid
        if remaining > 0:
            open_debts.append(
                RegisterMemberOpenDebtDTO(
                    debt_id=debt.id,
                    order_id=order.id,
                    member_id=member.id,
                    branch_id=order.branch_id,
                    currency=order.currency,
                    description_snapshot=description_snapshot or "Membresía",
                    initial_outstanding_minor=debt.initial_outstanding_minor,
                    paid_amount_minor=paid,
                    remaining_balance_minor=remaining,
                    created_at=debt.created_at,
                )
            )
    return open_debts



# --- lookups used by app.sales.service (SQL only; callers decide what a miss means) ---

def lock_receptionist_grant(session: Session, *, staff_id: UUID, branch_id: UUID):
    """Row-lock the staff's active receptionist grant for the branch; None when absent."""
    return session.scalar(select(RoleGrant.id).where(
        RoleGrant.staff_id == staff_id, RoleGrant.role == "receptionist",
        RoleGrant.is_active.is_(True), RoleGrant.scope_kind == "branch",
        RoleGrant.branch_id == branch_id,
    ).with_for_update())


def lock_staff_key_share(session: Session, staff_id: UUID) -> None:
    session.scalar(select(StaffUser.id).where(StaffUser.id == staff_id).with_for_update(key_share=True))


def get_register(session: Session, register_id: UUID):
    return session.scalar(select(CashRegister).where(CashRegister.id == register_id))


def find_order_by_key(session: Session, *, branch_id: UUID, seller_id: UUID, idempotency_key: str):
    return session.scalar(select(Order).where(
        Order.branch_id == branch_id, Order.seller_id == seller_id, Order.idempotency_key == idempotency_key))


def find_refund_by_key(session: Session, *, branch_id: UUID, actor_id: UUID, idempotency_key: str):
    return session.scalar(select(ProductRefund).where(
        ProductRefund.branch_id == branch_id, ProductRefund.actor_id == actor_id,
        ProductRefund.idempotency_key == idempotency_key))


def find_debt_payment_by_key(session: Session, *, branch_id: UUID, received_by: UUID, idempotency_key: str):
    return session.scalar(select(MembershipDebtPayment).where(
        MembershipDebtPayment.branch_id == branch_id, MembershipDebtPayment.received_by == received_by,
        MembershipDebtPayment.idempotency_key == idempotency_key))


def find_active_terminal(session: Session, register: CashRegister):
    """The register's default terminal, else the branch's first active one (by code)."""
    return register.default_terminal or session.scalar(
        select(PaymentTerminal).where(
            PaymentTerminal.branch_id == register.branch_id, PaymentTerminal.status == "active",
        ).order_by(PaymentTerminal.code.asc()))


def create_mock_terminal(session: Session, register: CashRegister) -> PaymentTerminal:
    terminal = PaymentTerminal(
        branch_id=register.branch_id, code="POINT-01", name="Terminal Mostrador 01",
        device_id="GERTEC_MP35P__8701012345", provider="mercado_pago", status="active",
    )
    session.add(terminal)
    session.flush()
    register.default_terminal_id = terminal.id
    session.flush()
    return terminal


def load_transfer_review_order(session: Session, payment_id: UUID):
    """Transfer order for a review, with register and member row-locked in sale/review lock order."""
    payment = session.scalar(select(Payment).where(Payment.id == payment_id))
    if payment is None or payment.method != "transfer":
        return None
    order = session.get(Order, payment.order_id)
    if order is None:
        return None
    register = session.scalar(select(CashRegister).where(CashRegister.id == order.register_id).with_for_update())
    member = session.scalar(select(Member).where(Member.id == order.member_id).with_for_update())
    return None if register is None or member is None else order
