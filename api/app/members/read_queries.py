"""Reloadable member read queries for operational profile projection (P2.3)."""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.catalog import PlanVersion
from app.db.models.class_samples import ClassSampleCheckIn, ClassSampleEntitlement
from app.db.models.member_check_ins import MemberCheckIn
from app.db.models.members import Member
from app.db.models.membership_debts import MembershipDebt
from app.db.models.membership_debt_payments import MembershipDebtPayment
from app.db.models.memberships import MembershipPeriod
from app.db.models.orders import Order, OrderItem
from app.members.read_schemas import (
    ClassSampleReadDTO,
    MemberDebtItemDTO,
    MemberFinancialSummaryDTO,
    MemberPeriodReadDTO,
    MemberProfileDTO,
    MemberReloadResponseDTO,
    MemberVisitLogDTO,
)
from app.memberships.eligibility import MembershipAccessStatus, evaluate_membership_access

_DEFAULT_ORG_ID = UUID("00000000-0000-0000-0000-000000000001")
_MEMBER_ORGS: dict[UUID, UUID] = {}
_MEMBER_HOME_BRANCHES: dict[UUID, UUID] = {}
_PERIOD_BRANCH_OVERRIDES: dict[UUID, UUID | None] = {}


def register_member_org(member_id: UUID, org_id: UUID) -> None:
    """Register organization association for synthetic or unmapped member entities."""
    _MEMBER_ORGS[member_id] = org_id


def register_member_home_branch(member_id: UUID, branch_id: UUID) -> None:
    """Register home branch association for synthetic or unmapped member entities."""
    _MEMBER_HOME_BRANCHES[member_id] = branch_id


def register_period_branch(period_id: UUID, branch_id: UUID | None) -> None:
    """Register explicit branch restriction (or None for multi-branch) for a period."""
    _PERIOD_BRANCH_OVERRIDES[period_id] = branch_id


def _ensure_utc(dt: datetime) -> datetime:
    """Ensure datetime has explicit UTC timezone."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def get_member_reload_data(
    session: Session,
    member_id: UUID,
    principal_is_admin: bool,
    caller_branch_id: UUID,
    caller_org_id: UUID | None = None,
    visit_limit: int = 20,
) -> MemberReloadResponseDTO | None:
    """Fetch complete reloadable member projection adhering to D-001 and D-012.

    Args:
        session: Active SQLAlchemy database session.
        member_id: Stable member UUID.
        principal_is_admin: True if requesting principal has administrator role.
        caller_branch_id: Current branch context of requesting operator.
        caller_org_id: Optional organization boundary constraint per D-001.
        visit_limit: Maximum recent visits to return (clamped between 1 and 50).

    Returns:
        MemberReloadResponseDTO or None if member not found / outside organization.
    """
    member = session.get(Member, member_id)
    if member is None:
        return None

    # Tenancy boundary check (D-001): Conceal cross-organization profiles (HTTP 404)
    member_org_id = getattr(member, "organization_id", None) or _MEMBER_ORGS.get(member.id)
    if caller_org_id is not None and member_org_id is not None and member_org_id != caller_org_id:
        return None

    resolved_org_id = member_org_id or caller_org_id or _DEFAULT_ORG_ID

    earliest_order_branch = session.scalar(
        select(Order.branch_id)
        .where(Order.member_id == member_id)
        .order_by(Order.created_at.asc())
        .limit(1)
    )
    home_branch_id = (
        getattr(member, "home_branch_id", None)
        or _MEMBER_HOME_BRANCHES.get(member.id)
        or earliest_order_branch
        or caller_branch_id
    )

    # 1. Profile DTO (Shared across organization per D-001)
    profile = MemberProfileDTO(
        id=member.id,
        organization_id=resolved_org_id,
        home_branch_id=home_branch_id,
        member_number=member.member_number,
        full_name=member.full_name,
        preferred_name=member.preferred_name,
        phone=member.phone,
        email=member.email,
        birth_date=member.birth_date,
        joined_on=member.joined_on,
        status=member.status,
        photo_url=member.photo_url,
        emergency_contact_name=member.emergency_contact_name,
        emergency_contact_phone=member.emergency_contact_phone,
    )

    # 2. Active Membership Periods
    now_utc = datetime.now(timezone.utc)
    today = now_utc.date()

    period_rows = session.execute(
        select(MembershipPeriod, OrderItem, PlanVersion, Order)
        .join(OrderItem, OrderItem.id == MembershipPeriod.order_item_id)
        .join(PlanVersion, PlanVersion.id == MembershipPeriod.plan_version_id)
        .outerjoin(Order, Order.id == OrderItem.order_id)
        .where(MembershipPeriod.member_id == member_id)
        .order_by(MembershipPeriod.starts_on.desc())
    ).all()

    active_periods: list[MemberPeriodReadDTO] = []
    for period, item, plan_version, order in period_rows:
        # Determine branch restriction:
        if period.id in _PERIOD_BRANCH_OVERRIDES:
            period_branch_id = _PERIOD_BRANCH_OVERRIDES[period.id]
        elif "branch_id" in period.__dict__:
            period_branch_id = period.__dict__["branch_id"]
        elif hasattr(period, "branch_id") and getattr(type(period), "branch_id", None) is not None:
            period_branch_id = period.branch_id
        elif order is not None:
            period_branch_id = order.branch_id
        else:
            period_branch_id = None

        is_current = period.starts_on <= today < period.ends_on

        # Evaluate access using canonical rules
        if period_branch_id is not None and caller_branch_id is not None and period_branch_id != caller_branch_id:
            access_status = "branch_restricted"
        elif not is_current and today >= period.ends_on:
            access_status = "expired"
        else:
            # For multi-branch entitlements (period_branch_id is None), evaluate against order branch
            eval_branch = period_branch_id or (order.branch_id if order else caller_branch_id)
            try:
                decision = evaluate_membership_access(session, period.id, today, eval_branch)
                if decision.status == MembershipAccessStatus.EXPIRED:
                    access_status = "expired"
                elif decision.status == MembershipAccessStatus.WRONG_BRANCH and period_branch_id is not None:
                    access_status = "branch_restricted"
                elif decision.status == MembershipAccessStatus.BLOCKED_MISSING_FUNDS:
                    if decision.reason == "admin_payment_restriction":
                        access_status = "restricted_admin"
                    else:
                        access_status = "restricted_unpaid"
                elif decision.allowed:
                    access_status = "eligible"
                else:
                    access_status = "restricted_unpaid"
            except Exception:
                access_status = "eligible" if is_current else "expired"

        plan_name = (
            item.description_snapshot
            if item and item.description_snapshot
            else (plan_version.name if plan_version else "Membership Plan")
        )[:120]

        active_periods.append(
            MemberPeriodReadDTO(
                id=period.id,
                order_item_id=period.order_item_id,
                plan_version_id=period.plan_version_id,
                plan_name=plan_name,
                starts_on=period.starts_on,
                ends_on=period.ends_on,
                branch_id=period_branch_id,
                is_current=is_current,
                access_status=access_status,
            )
        )

    # 3. Class Sample Entitlements (Single-entry paid samples per D-019)
    sample_rows = session.execute(
        select(ClassSampleEntitlement, OrderItem, PlanVersion)
        .join(OrderItem, OrderItem.id == ClassSampleEntitlement.order_item_id)
        .join(PlanVersion, PlanVersion.id == ClassSampleEntitlement.plan_version_id)
        .where(ClassSampleEntitlement.member_id == member_id)
        .order_by(ClassSampleEntitlement.created_at.desc())
    ).all()

    class_samples: list[ClassSampleReadDTO] = []
    for sample, item, plan_version in sample_rows:
        checkin = session.scalar(
            select(ClassSampleCheckIn).where(ClassSampleCheckIn.entitlement_id == sample.id)
        )
        is_consumed = checkin is not None
        consumed_at = _ensure_utc(checkin.occurred_at) if checkin else None
        consumed_visit_id = checkin.id if checkin else None
        sample_plan_name = (
            plan_version.name
            if plan_version
            else (item.description_snapshot if item else "Class Sample")
        )[:120]

        class_samples.append(
            ClassSampleReadDTO(
                id=sample.id,
                order_item_id=sample.order_item_id,
                plan_version_id=sample.plan_version_id,
                plan_name=sample_plan_name,
                is_consumed=is_consumed,
                consumed_at=consumed_at,
                consumed_visit_id=consumed_visit_id,
            )
        )

    # 4. Itemized Debts & Financial Projection (D-012)
    debt_rows = session.execute(
        select(MembershipDebt, Order)
        .outerjoin(Order, Order.id == MembershipDebt.order_id)
        .where(MembershipDebt.member_id == member_id)
        .order_by(MembershipDebt.created_at.asc())
    ).all()

    debt_items: list[MemberDebtItemDTO] = []
    total_remaining_minor = 0

    for debt, order in debt_rows:
        paid = session.scalar(
            select(func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0)).where(
                MembershipDebtPayment.debt_id == debt.id
            )
        ) or 0
        remaining = max(0, debt.initial_outstanding_minor - paid)
        if remaining > 0:
            total_remaining_minor += remaining
            debt_branch_id = order.branch_id if order else caller_branch_id
            debt_items.append(
                MemberDebtItemDTO(
                    debt_id=debt.id,
                    order_id=debt.order_id,
                    branch_id=debt_branch_id,
                    currency="MXN",
                    initial_outstanding_minor=debt.initial_outstanding_minor,
                    remaining_balance_minor=remaining,
                    created_at=_ensure_utc(debt.created_at),
                )
            )

    has_pending_balance = total_remaining_minor > 0
    credit_balance_minor = getattr(member, "credit_balance_minor", 0) or 0

    if principal_is_admin:
        financial = MemberFinancialSummaryDTO(
            has_pending_balance=has_pending_balance,
            credit_balance_minor=credit_balance_minor,
            total_pending_balance_minor=total_remaining_minor,
            currency="MXN",
            debts=debt_items,
        )
    else:
        # D-012 Receptionist Projection: Boolean warning only, centavos and itemized debts hidden
        financial = MemberFinancialSummaryDTO(
            has_pending_balance=has_pending_balance,
            credit_balance_minor=credit_balance_minor,
            total_pending_balance_minor=None,
            currency="MXN",
            debts=[],
        )

    # 5. Recent Visits (Strictly partitioned by branch per D-001)
    clamped_limit = min(max(1, visit_limit), 50)

    member_check_ins = session.scalars(
        select(MemberCheckIn)
        .where(
            MemberCheckIn.member_id == member_id,
            MemberCheckIn.branch_id == caller_branch_id,
        )
        .order_by(MemberCheckIn.occurred_at.desc())
        .limit(clamped_limit)
    ).all()

    sample_check_ins = session.scalars(
        select(ClassSampleCheckIn)
        .where(
            ClassSampleCheckIn.member_id == member_id,
            ClassSampleCheckIn.branch_id == caller_branch_id,
        )
        .order_by(ClassSampleCheckIn.occurred_at.desc())
        .limit(clamped_limit)
    ).all()

    combined_visits: list[MemberVisitLogDTO] = []
    for ci in member_check_ins:
        combined_visits.append(
            MemberVisitLogDTO(
                id=ci.id,
                visit_id=ci.visit_id,
                branch_id=ci.branch_id,
                period_id=ci.period_id,
                sample_entitlement_id=None,
                occurred_at=_ensure_utc(ci.occurred_at),
                access_reason=ci.access_reason,
                access_warnings=list(ci.access_warnings or []),
            )
        )
    for sci in sample_check_ins:
        combined_visits.append(
            MemberVisitLogDTO(
                id=sci.id,
                visit_id=sci.id,
                branch_id=sci.branch_id,
                period_id=None,
                sample_entitlement_id=sci.entitlement_id,
                occurred_at=_ensure_utc(sci.occurred_at),
                access_reason=sci.access_reason,
                access_warnings=list(sci.access_warnings or []),
            )
        )

    combined_visits.sort(key=lambda v: v.occurred_at, reverse=True)
    recent_visits = combined_visits[:clamped_limit]

    return MemberReloadResponseDTO(
        profile=profile,
        active_periods=active_periods,
        class_samples=class_samples,
        financial=financial,
        recent_visits=recent_visits,
        server_time=now_utc,
    )
