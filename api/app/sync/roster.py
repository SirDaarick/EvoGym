"""Roster projection and delta queries for contingency sync (T5.4, T5.6)."""

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.authorization import Branch
from app.db.models.inventory import Product
from app.db.models.membership_debt_payments import MembershipDebtPayment
from app.db.models.membership_debts import MembershipDebt
from app.db.models.memberships import MembershipPeriod
from app.db.models.members import Member
from app.db.models.orders import Order, OrderItem
from app.db.models.shifts import CashRegister, Shift
from app.inventory.queries import get_on_hand_stock


class ActivePeriodDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period_id: str
    starts_on: str
    ends_on: str
    access: str  # "valid" | "valid_with_outstanding_balance" | "denied"


class RosterRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    member_id: str
    member_number: str
    full_name: str
    phone_last4: str
    photo_hash: str | None = None
    status: str
    active_periods: list[ActivePeriodDTO] = Field(default_factory=list)
    has_debt: bool = False
    changed_at: str


class CatalogItemDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str
    code: str | None = None
    name: str
    unit: str
    price_minor: int
    is_active: bool
    on_hand: int


class OpenShiftDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shift_id: str
    opened_at: str
    opening_cash_minor: int


class RegisterDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    register_id: str
    name: str
    open_shift: OpenShiftDTO | None = None


def _aware_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _phone_last4(phone: str) -> str:
    cleaned = "".join(ch for ch in phone if ch.isdigit())
    return cleaned[-4:] if len(cleaned) >= 4 else cleaned


def get_member_debt(session: Session, member_id: UUID) -> tuple[bool, int, datetime | None]:
    debts = session.scalars(select(MembershipDebt).where(MembershipDebt.member_id == member_id)).all()
    if not debts:
        return False, 0, None
    debt_ids = [d.id for d in debts]
    payments = session.scalars(
        select(MembershipDebtPayment).where(MembershipDebtPayment.debt_id.in_(debt_ids))
    ).all()
    payments_sum = sum(p.amount_minor for p in payments)
    total_initial = sum(d.initial_outstanding_minor for d in debts)
    latest_dt = max(
        [d.created_at for d in debts] + ([p.created_at for p in payments] if payments else [])
    )
    remaining = total_initial - payments_sum
    return remaining > 0, remaining, latest_dt


def get_member_active_periods(
    session: Session, member_id: UUID, branch_id: UUID, today: date, has_debt: bool
) -> tuple[list[ActivePeriodDTO], datetime | None]:
    cutoff = today - timedelta(days=7)
    rows = session.execute(
        select(MembershipPeriod)
        .join(OrderItem, OrderItem.id == MembershipPeriod.order_item_id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            MembershipPeriod.member_id == member_id,
            Order.branch_id == branch_id,
            MembershipPeriod.ends_on >= cutoff,
        )
        .order_by(MembershipPeriod.starts_on.desc())
    ).scalars().all()

    periods: list[ActivePeriodDTO] = []
    latest_dt: datetime | None = None
    for p in rows:
        if latest_dt is None or p.created_at > latest_dt:
            latest_dt = p.created_at
        is_current = p.starts_on <= today < p.ends_on
        if is_current:
            access = "valid_with_outstanding_balance" if has_debt else "valid"
        else:
            access = "denied"
        periods.append(
            ActivePeriodDTO(
                period_id=str(p.id),
                starts_on=p.starts_on.isoformat(),
                ends_on=p.ends_on.isoformat(),
                access=access,
            )
        )
    return periods, latest_dt


def build_roster_row(
    session: Session, member: Member, branch_id: UUID, today: date
) -> tuple[RosterRow | None, datetime]:
    has_debt, _, debt_dt = get_member_debt(session, member.id)
    periods, period_dt = get_member_active_periods(session, member.id, branch_id, today, has_debt)

    dates = [member.updated_at or member.created_at]
    if debt_dt:
        dates.append(debt_dt)
    if period_dt:
        dates.append(period_dt)
    max_dt = _aware_utc(max(dates))

    # In the roster for this branch, member must have active or upcoming/grace periods, or be active
    if not periods and member.status != "active":
        return None, max_dt

    row = RosterRow(
        member_id=str(member.id),
        member_number=member.member_number,
        full_name=member.full_name,
        phone_last4=_phone_last4(member.phone),
        photo_hash=None,
        status=member.status,
        active_periods=periods,
        has_debt=has_debt,
        changed_at=max_dt.isoformat(),
    )
    return row, max_dt


def get_branch_catalog(session: Session, branch_id: UUID) -> list[CatalogItemDTO]:
    products = session.scalars(
        select(Product).where(Product.is_active.is_(True)).order_by(Product.name, Product.id)
    ).all()
    items = []
    for p in products:
        on_hand = get_on_hand_stock(session, branch_id=branch_id, product_id=p.id)
        items.append(
            CatalogItemDTO(
                product_id=str(p.id),
                code=p.code,
                name=p.name,
                unit=p.unit,
                price_minor=p.price_minor,
                is_active=p.is_active,
                on_hand=on_hand,
            )
        )
    return items


def get_branch_registers(session: Session, branch_id: UUID) -> list[RegisterDTO]:
    registers = session.scalars(
        select(CashRegister)
        .where(CashRegister.branch_id == branch_id, CashRegister.status == "active")
        .order_by(CashRegister.name, CashRegister.id)
    ).all()
    results = []
    for r in registers:
        shift = session.scalar(
            select(Shift).where(Shift.cash_register_id == r.id, Shift.closed_at.is_(None)).order_by(Shift.opened_at.desc())
        )
        open_shift = None
        if shift:
            open_shift = OpenShiftDTO(
                shift_id=str(shift.id),
                opened_at=_aware_utc(shift.opened_at).isoformat(),
                opening_cash_minor=shift.opening_cash_minor,
            )
        results.append(RegisterDTO(register_id=str(r.id), name=r.name, open_shift=open_shift))
    return results
