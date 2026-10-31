"""Rental tender, charge-state, and card-attempt helpers."""
from datetime import date, datetime, timezone
from hashlib import sha256
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Branch, CashRegister, Member, Payment, RentalAsset, Shift, StaffRosterProfile, StaffUser
from app.db.models.rentals import Rental, RentalCardAttempt, RentalCharge

MAX_MINOR = 2**63 - 1


class RentalNotFoundError(LookupError):
    """A requested rental, charge, register, member, or asset is unavailable."""


class RentalConflictError(ValueError):
    """A rental command conflicts with current state, idempotency, or limits."""


class RentalAccessDenied(PermissionError):
    """The authenticated actor cannot act on the requested branch."""


class RentalProviderUnavailableError(RuntimeError):
    """No configured Point terminal client can process a rental card attempt."""


def fingerprint(*parts) -> str:
    return sha256(repr(parts).encode()).hexdigest()


def clean_idempotency_key(value: str | None) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise ValueError("Idempotency key must contain between 1 and 128 characters.")
    return value


def lock_branch(session: Session, branch_id: UUID, authorized_branch_id: UUID | None) -> Branch:
    if authorized_branch_id is not None and branch_id != authorized_branch_id:
        raise RentalAccessDenied("Access restricted to staff branch.")
    branch = session.scalar(select(Branch).where(Branch.id == branch_id).with_for_update())
    if branch is None or not branch.is_active:
        raise RentalNotFoundError("Branch not found.")
    return branch


def lock_register(session: Session, register_id: UUID, branch_id: UUID) -> CashRegister:
    register = session.scalar(select(CashRegister).where(CashRegister.id == register_id).with_for_update())
    if register is None or register.branch_id != branch_id:
        raise RentalNotFoundError("Cash register not found.")
    if register.status != "active":
        raise RentalConflictError("Cash register is not active.")
    return register


def open_shift(session: Session, register_id: UUID) -> Shift:
    shift = session.scalar(
        select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open").with_for_update()
    )
    if shift is None:
        raise RentalConflictError("An open shift is required for rental cash operations.")
    return shift


def lock_member(session: Session, member_id: UUID) -> Member:
    member = session.scalar(select(Member).where(Member.id == member_id).with_for_update())
    if member is None:
        raise RentalNotFoundError("Member not found.")
    return member


def lock_asset(session: Session, asset_id: UUID, branch_id: UUID, kind: str) -> RentalAsset:
    asset = session.scalar(select(RentalAsset).where(RentalAsset.id == asset_id).with_for_update())
    if asset is None or asset.branch_id != branch_id:
        raise RentalNotFoundError("Rental asset not found.")
    if asset.kind != kind:
        raise RentalConflictError("Rental asset kind does not match the requested operation.")
    if asset.status != "available":
        raise RentalConflictError("Rental asset is not available for assignment.")
    return asset


def staff_display_name(session: Session, staff_id: UUID, branch_id: UUID) -> str:
    """Return a real roster name, falling back to the staff login identifier."""
    profile = session.scalar(
        select(StaffRosterProfile.full_name).where(
            StaffRosterProfile.staff_user_id == staff_id,
            StaffRosterProfile.branch_id == branch_id,
            StaffRosterProfile.is_active.is_(True),
        ).order_by(StaffRosterProfile.id)
    )
    if profile:
        return profile
    login = session.scalar(select(StaffUser.login_identifier).where(StaffUser.id == staff_id))
    if not login:
        raise RentalNotFoundError("Staff identity not found.")
    return login


def active_rental_id(session: Session, asset_id: UUID) -> UUID | None:
    return session.scalar(select(Rental.id).where(Rental.asset_id == asset_id, Rental.status == "active"))


def record_components(
    session: Session,
    *,
    rental: Rental,
    charge: RentalCharge,
    register: CashRegister,
    shift: Shift,
    actor_id: UUID,
    components,
) -> int:
    """Persist each mixed-tender component; returns the offered total."""
    offered = 0
    for component in components:
        if component.method not in ("cash", "transfer"):
            raise ValueError("Card payments require a server-bound terminal attempt.")
        amount = component.amount_minor
        if type(amount) is not int or amount <= 0 or amount > MAX_MINOR:
            raise ValueError("Tender amount must be a positive signed 64-bit integer.")
        if offered > MAX_MINOR - amount:
            raise ValueError("Tender total exceeds supported minor units.")
        offered += amount
    if offered > charge.amount_minor:
        raise RentalConflictError("Tender cannot exceed the charge amount.")
    for component in components:
        session.add(Payment(
            rental_charge_id=charge.id,
            register_id=register.id,
            shift_id=shift.id,
            method=component.method,
            status="pending" if component.method == "transfer" else "confirmed",
            amount_minor=component.amount_minor,
            received_by=actor_id,
        ))
    session.flush()
    return offered


def _payments_for_charge(session: Session, charge_id: UUID) -> list[Payment]:
    return session.scalars(
        select(Payment).where(Payment.rental_charge_id == charge_id).order_by(Payment.received_at, Payment.id)
    ).all()


def charge_paid_minor(session: Session, charge: RentalCharge) -> int:
    """Confirmed settlement only; pending promises stay outstanding."""
    return charge_settled_minor(session, charge)


def charge_settled_minor(session: Session, charge: RentalCharge) -> int:
    return sum(payment.amount_minor for payment in _payments_for_charge(session, charge.id)
               if payment.status == "confirmed")


def charge_reserved_minor(session: Session, charge: RentalCharge) -> int:
    """Pending transfers and card attempts reserve debt against new receipts."""
    transfers = sum(payment.amount_minor for payment in _payments_for_charge(session, charge.id)
                    if payment.method == "transfer" and payment.status in ("pending", "under_review"))
    cards = sum(attempt.amount_minor for attempt in session.scalars(
        select(RentalCardAttempt).where(
            RentalCardAttempt.charge_id == charge.id, RentalCardAttempt.status == "pending")
    ))
    return transfers + cards


def charge_collectable_minor(session: Session, charge: RentalCharge) -> int:
    return max(0, charge.amount_minor - charge_settled_minor(session, charge)
               - charge_reserved_minor(session, charge))


def charge_outstanding_minor(session: Session, charge: RentalCharge) -> int:
    return max(0, charge.amount_minor - charge_settled_minor(session, charge))


def charges_for_rental(session: Session, rental_id: UUID) -> list[RentalCharge]:
    return session.scalars(
        select(RentalCharge).where(RentalCharge.rental_id == rental_id)
        .order_by(RentalCharge.starts_on, RentalCharge.created_at, RentalCharge.id)
    ).all()


def rental_paid_minor(session: Session, rental: Rental) -> int:
    return sum(charge_paid_minor(session, charge) for charge in charges_for_rental(session, rental.id))


def rental_settled_minor(session: Session, rental: Rental) -> int:
    return sum(charge_settled_minor(session, charge) for charge in charges_for_rental(session, rental.id))


def rental_outstanding_minor(session: Session, rental: Rental) -> int:
    if rental.status == "cancelled":
        return 0
    return sum(charge_outstanding_minor(session, charge) for charge in charges_for_rental(session, rental.id))


def oldest_open_charge(session: Session, rental: Rental) -> RentalCharge | None:
    for charge in charges_for_rental(session, rental.id):
        if charge_outstanding_minor(session, charge) > 0:
            return charge
    return None


def local_today(branch: Branch) -> date:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        zone = ZoneInfo(branch.timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise RentalConflictError("Branch timezone is invalid.") from exc
    return datetime.now(timezone.utc).astimezone(zone).date()


def month_end(value: date, count: int = 1) -> date:
    from calendar import monthrange
    absolute = value.year * 12 + (value.month - 1) + count
    year, zero_month = divmod(absolute, 12)
    month = zero_month + 1
    if not 1 <= year <= 9999:
        raise ValueError("Rental period exceeds the supported calendar range.")
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def cancellation_facts(session: Session, rental: Rental, branch: Branch) -> dict:
    charges = charges_for_rental(session, rental.id)
    today = local_today(branch)
    settled = sum(charge_settled_minor(session, charge) for charge in charges)
    outstanding = sum(charge_outstanding_minor(session, charge) for charge in charges)
    suggested = 0
    for charge in charges:
        period_days = (charge.ends_on - charge.starts_on).days
        remaining = max(0, min(period_days, (charge.ends_on - today).days))
        if period_days > 0 and remaining > 0:
            suggested += charge.amount_minor * remaining // period_days
    suggested = min(settled, suggested)
    facts = (str(rental.id), rental.status, settled, outstanding, today.isoformat(),
             tuple((str(charge.id), charge.amount_minor, charge.starts_on.isoformat(),
                    charge.ends_on.isoformat()) for charge in charges))
    return {
        "charges": charges,
        "today": today,
        "settled_minor": settled,
        "outstanding_minor": outstanding,
        "suggested_refund_minor": suggested,
        "preview_token": fingerprint(facts),
    }


def pending_transfer_exists(session: Session, rental: Rental) -> bool:
    charge_ids = [charge.id for charge in charges_for_rental(session, rental.id)]
    if not charge_ids:
        return False
    return session.scalar(
        select(Payment.id).where(
            Payment.rental_charge_id.in_(charge_ids),
            Payment.method == "transfer",
            Payment.status.in_(("pending", "under_review")),
        ).limit(1)
    ) is not None


def cancel_pending_card_attempts(session: Session, rental_id: UUID) -> None:
    for attempt in session.scalars(select(RentalCardAttempt).where(
        RentalCardAttempt.rental_id == rental_id, RentalCardAttempt.status == "pending"
    ).with_for_update()).all():
        if attempt.provider_intent_id is None:
            attempt.status = "cancelled"
            attempt.failure_reason = "Rental was cancelled before a card intent was created."
        else:
            attempt.status = "unknown"
            attempt.failure_reason = "Rental was cancelled after the card intent was created; verify the terminal."


def settle_card_attempt(session: Session, attempt: RentalCardAttempt, status: str,
                        authorization_code: str | None = None, card_brand: str | None = None,
                        card_last_four: str | None = None, provider_payment_id: str | None = None,
                        provider_amount_minor: int | None = None) -> None:
    """Apply one provider result without resurrecting a cancelled rental."""
    if attempt.status != "pending":
        return
    if status != "PROCESSED":
        if status in ("CANCELED", "ABANDONED", "REJECTED", "FAILED"):
            attempt.status = "failed"
            attempt.failure_reason = f"Provider status {status}."
        return
    if provider_amount_minor is not None and provider_amount_minor != attempt.amount_minor:
        attempt.status = "failed"
        attempt.failure_reason = "Provider amount does not match the attempt amount."
        return
    rental = session.scalar(select(Rental).where(Rental.id == attempt.rental_id).with_for_update())
    if rental is None or rental.status == "cancelled":
        attempt.status = "cancelled"
        attempt.failure_reason = "Rental was cancelled before the card result arrived."
        return
    charge = session.scalar(select(RentalCharge).where(RentalCharge.id == attempt.charge_id).with_for_update())
    if charge is None:
        attempt.status = "failed"
        attempt.failure_reason = "Rental charge no longer exists."
        return
    reserved_elsewhere = charge_reserved_minor(session, charge) - attempt.amount_minor
    collectable = max(0, charge.amount_minor - charge_settled_minor(session, charge) - reserved_elsewhere)
    if attempt.amount_minor > collectable:
        attempt.status = "unknown"
        attempt.failure_reason = "Card result exceeds the remaining charge; verify the terminal."
        return
    payment = Payment(
        rental_charge_id=charge.id,
        register_id=attempt.register_id,
        shift_id=attempt.shift_id,
        method="card",
        status="confirmed",
        amount_minor=attempt.amount_minor,
        received_by=attempt.created_by,
        terminal_id=attempt.terminal_id,
        mp_payment_intent_id=attempt.provider_intent_id,
        mp_payment_id=provider_payment_id,
        card_brand=card_brand,
        card_last_four=card_last_four,
        authorization_code=authorization_code,
    )
    session.add(payment)
    session.flush()
    attempt.status = "confirmed"
    attempt.payment_id = payment.id
    attempt.authorization_code = authorization_code
    attempt.card_brand = card_brand
    attempt.card_last_four = card_last_four
    session.flush()
