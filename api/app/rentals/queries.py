"""Transactional rental lifecycle commands and projections."""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Branch, CashRegister, Member, Payment, PaymentReviewEvent, Rental, RentalAsset,
    RentalCancellation, RentalCardAttempt, RentalCharge, RentalReceipt, StaffUser,
)
from app.rentals.payments import (
    MAX_MINOR, RentalAccessDenied, RentalConflictError, RentalNotFoundError,
    active_rental_id, cancel_pending_card_attempts, cancellation_facts, charge_collectable_minor,
    charge_outstanding_minor, charges_for_rental, clean_idempotency_key, charge_settled_minor,
    fingerprint, lock_asset, lock_branch, lock_member, lock_register, month_end,
    oldest_open_charge, open_shift, pending_transfer_exists, record_components,
    rental_outstanding_minor, rental_paid_minor, settle_card_attempt, staff_display_name,
)
from app.rentals.schemas import (
    CancellationPeriodDTO, CancellationPreviewDTO, CardAttemptDTO, MemberReceivableDTO,
    ReceivableAllocationDTO, ReceivablePaymentDTO, RentalCancellationDTO, RentalChargeDTO, RentalDTO,
)


def _charge_dto(session: Session, charge: RentalCharge) -> RentalChargeDTO:
    return RentalChargeDTO(
        id=charge.id, charge_kind=charge.charge_kind, amount_minor=charge.amount_minor,
        starts_on=charge.starts_on, ends_on=charge.ends_on,
        outstanding_minor=charge_outstanding_minor(session, charge),
    )


def rental_dto(session: Session, rental: Rental) -> RentalDTO:
    charges = charges_for_rental(session, rental.id)
    cancellation = session.scalar(select(RentalCancellation).where(RentalCancellation.rental_id == rental.id))
    member = session.get(Member, rental.member_id)
    asset = session.get(RentalAsset, rental.asset_id)
    if member is None or asset is None:
        raise RentalNotFoundError("Rental identity is unavailable.")
    return RentalDTO(
        id=rental.id, branch_id=rental.branch_id, asset_id=rental.asset_id,
        asset_code=asset.code,
        member_id=rental.member_id,
        member_name=member.full_name,
        member_number=member.member_number,
        kind=rental.kind, status=rental.status, starts_on=rental.starts_on, ends_on=rental.ends_on,
        paid_minor=rental_paid_minor(session, rental),
        outstanding_minor=rental_outstanding_minor(session, rental),
        cancelled_debt_minor=cancellation.cancelled_debt_minor if cancellation else 0,
        assigned_by_name=staff_display_name(session, rental.actor_id, rental.branch_id),
        charges=[_charge_dto(session, charge) for charge in charges],
        created_at=rental.created_at or datetime.now(timezone.utc),
    )


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def cancellation_dto(session: Session, cancellation: RentalCancellation) -> RentalCancellationDTO:
    member = session.get(Member, cancellation.member_id)
    asset = session.get(RentalAsset, cancellation.asset_id)
    if member is None or asset is None:
        raise RentalNotFoundError("Cancellation identity is unavailable.")
    return RentalCancellationDTO(
        id=cancellation.id, rental_id=cancellation.rental_id, member_id=cancellation.member_id,
        member_name=member.full_name, member_number=member.member_number,
        asset_id=cancellation.asset_id, asset_code=asset.code,
        actor_id=cancellation.actor_id, actor_name=cancellation.actor_name,
        reason=cancellation.reason,
        refund_method=cancellation.refund_method, refund_amount_minor=cancellation.refund_amount_minor,
        suggested_refund_minor=cancellation.suggested_refund_minor, settled_minor=cancellation.settled_minor,
        cancelled_debt_minor=cancellation.cancelled_debt_minor,
        reviewed=cancellation.reviewed_at is not None,
        reviewed_by=cancellation.reviewed_by, reviewed_by_name=cancellation.reviewed_by_name,
        reviewed_at=_utc(cancellation.reviewed_at),
        created_at=_utc(cancellation.created_at) or datetime.now(timezone.utc),
    )


def _lock_actor(session: Session, actor_id: UUID) -> None:
    session.scalar(select(StaffUser.id).where(StaffUser.id == actor_id).with_for_update(key_share=True))


def _locked_rental(session: Session, rental_id: UUID) -> Rental:
    rental = session.scalar(select(Rental).where(Rental.id == rental_id).with_for_update())
    if rental is None:
        raise RentalNotFoundError("Rental not found.")
    return rental


def _rental_branch(session: Session, rental: Rental, authorized_branch_id: UUID | None) -> Branch:
    if authorized_branch_id is not None and rental.branch_id != authorized_branch_id:
        raise RentalAccessDenied("Access restricted to staff branch.")
    branch = session.get(Branch, rental.branch_id)
    if branch is None or not branch.is_active:
        raise RentalNotFoundError("Branch not found.")
    return branch


def _component_fingerprint(register_id: UUID, components) -> list[tuple[str, int]]:
    return [(component.method, component.amount_minor) for component in components]


def _validate_checkout(price_minor: int, expected_total_minor: int,
                       accepted_shortfall_minor: int, components) -> None:
    if expected_total_minor != price_minor:
        raise RentalConflictError("Rental price changed; review the current price.")
    offered = sum(component.amount_minor for component in components)
    if offered > price_minor:
        raise RentalConflictError("Tender cannot exceed the charge amount.")
    if price_minor - offered != accepted_shortfall_minor:
        raise RentalConflictError("Shortfall acceptance does not match the server calculation.")


def create_rental(
    session: Session, *, kind: str, branch_id: UUID, asset_id: UUID, member_id: UUID,
    register_id: UUID, actor_id: UUID, authorized_branch_id: UUID | None,
    components, expected_total_minor: int, accepted_shortfall_minor: int,
    idempotency_key: str,
) -> tuple[Rental, bool]:
    clean_idempotency_key(idempotency_key)
    _lock_actor(session, actor_id)
    register = lock_register(session, register_id, branch_id)
    branch = lock_branch(session, branch_id, authorized_branch_id)
    member = lock_member(session, member_id)
    contents = _component_fingerprint(register_id, components)
    request_fingerprint = fingerprint(branch_id, kind, str(asset_id), str(member_id), str(register_id), contents)
    existing = session.scalar(select(Rental).where(
        Rental.actor_id == actor_id, Rental.branch_id == branch_id, Rental.idempotency_key == idempotency_key,
    ).with_for_update())
    if existing is not None:
        if existing.request_fingerprint != request_fingerprint or existing.kind != kind:
            raise RentalConflictError("Idempotency key was already used for a different request.")
        return existing, True
    asset = lock_asset(session, asset_id, branch_id, kind)
    _validate_checkout(asset.price_minor, expected_total_minor, accepted_shortfall_minor, components)
    if active_rental_id(session, asset.id) is not None:
        raise RentalConflictError("Rental asset is already occupied by an active rental.")
    charge_start = cancellation_facts_today(branch)
    starts_on = ends_on = None
    if kind == "locker":
        starts_on = charge_start
        ends_on = month_end(starts_on)
    rental = Rental(
        branch_id=branch_id, asset_id=asset.id, member_id=member.id, kind=kind, status="active",
        starts_on=starts_on, ends_on=ends_on, actor_id=actor_id,
        idempotency_key=idempotency_key, request_fingerprint=request_fingerprint,
    )
    session.add(rental)
    session.flush()
    shift = open_shift(session, register_id)
    charge = RentalCharge(
        rental_id=rental.id, branch_id=branch_id, charge_kind="initial",
        amount_minor=asset.price_minor, starts_on=charge_start,
        ends_on=ends_on or charge_start, idempotency_key=idempotency_key,
        request_fingerprint=request_fingerprint, created_by=actor_id,
    )
    session.add(charge)
    session.flush()
    record_components(session, rental=rental, charge=charge, register=register, shift=shift,
                      actor_id=actor_id, components=components)
    session.flush()
    return rental, False


def cancellation_facts_today(branch: Branch):
    from app.rentals.payments import local_today
    return local_today(branch)


def renew_rental(
    session: Session, *, rental_id: UUID, register_id: UUID, actor_id: UUID,
    authorized_branch_id: UUID | None, components, expected_total_minor: int,
    accepted_shortfall_minor: int, idempotency_key: str,
) -> tuple[Rental, bool]:
    clean_idempotency_key(idempotency_key)
    _lock_actor(session, actor_id)
    rental = _locked_rental(session, rental_id)
    branch = _rental_branch(session, rental, authorized_branch_id)
    if rental.kind != "locker":
        raise RentalConflictError("Only locker rentals can be renewed.")
    if rental.status != "active":
        raise RentalConflictError("Only active locker rentals can be renewed.")
    register = lock_register(session, register_id, rental.branch_id)
    shift = open_shift(session, register_id)
    contents = _component_fingerprint(register_id, components)
    request_fingerprint = fingerprint(str(rental.id), str(register_id), contents)
    existing = session.scalar(select(RentalCharge).where(
        RentalCharge.rental_id == rental.id, RentalCharge.idempotency_key == idempotency_key,
    ).with_for_update())
    if existing is not None:
        if existing.request_fingerprint != request_fingerprint:
            raise RentalConflictError("Idempotency key was already used for a different renewal.")
        return rental, True
    asset = lock_asset(session, rental.asset_id, rental.branch_id, rental.kind)
    _validate_checkout(asset.price_minor, expected_total_minor, accepted_shortfall_minor, components)
    period_start = rental.ends_on
    if period_start is None:
        raise RentalConflictError("Locker rental has no renewable period.")
    starts_on = max(period_start, cancellation_facts_today(branch))
    ends_on = month_end(starts_on)
    charge = RentalCharge(
        rental_id=rental.id, branch_id=rental.branch_id, charge_kind="renewal",
        amount_minor=asset.price_minor, starts_on=starts_on, ends_on=ends_on,
        idempotency_key=idempotency_key, request_fingerprint=request_fingerprint, created_by=actor_id,
    )
    session.add(charge)
    session.flush()
    record_components(session, rental=rental, charge=charge, register=register, shift=shift,
                      actor_id=actor_id, components=components)
    if starts_on > period_start:
        rental.starts_on = starts_on
    rental.ends_on = ends_on
    session.flush()
    return rental, False


def end_rental(session: Session, *, rental_id: UUID, actor_id: UUID,
               authorized_branch_id: UUID | None, action: str) -> Rental:
    _lock_actor(session, actor_id)
    rental = _locked_rental(session, rental_id)
    _rental_branch(session, rental, authorized_branch_id)
    expected_kind = "glove" if action == "return" else "locker"
    finished_status = "returned" if action == "return" else "released"
    if rental.kind != expected_kind:
        raise RentalConflictError(f"{action.title()} is not allowed for this rental kind.")
    if rental.status == finished_status:
        return rental
    if rental.status != "active":
        raise RentalConflictError("Only active rentals can be ended.")
    rental.status = finished_status
    rental.ended_by = actor_id
    rental.ended_at = datetime.now(timezone.utc)
    session.flush()
    return rental


def record_receivable_payment(
    session: Session, *, rental_id: UUID, register_id: UUID, actor_id: UUID,
    authorized_branch_id: UUID | None, method: str, amount_minor: int, idempotency_key: str,
) -> tuple[RentalReceipt, bool]:
    clean_idempotency_key(idempotency_key)
    if method not in ("cash", "transfer"):
        raise ValueError("Card payments require a server-bound terminal attempt.")
    if type(amount_minor) is not int or not 0 < amount_minor <= MAX_MINOR:
        raise ValueError("Repayment amount must be a positive signed 64-bit integer.")
    _lock_actor(session, actor_id)
    rental = _locked_rental(session, rental_id)
    _rental_branch(session, rental, authorized_branch_id)
    request_fingerprint = fingerprint(str(rental.id), str(register_id), method, amount_minor)
    existing = session.scalar(select(RentalReceipt).where(
        RentalReceipt.received_by == actor_id,
        RentalReceipt.idempotency_key == idempotency_key,
    ).with_for_update())
    if existing is not None:
        if existing.request_fingerprint != request_fingerprint:
            raise RentalConflictError("Idempotency key was already used for a different payment.")
        return existing, True
    if rental.status == "cancelled":
        raise RentalConflictError("Cancelled rental debt cannot be collected.")
    register = lock_register(session, register_id, rental.branch_id)
    shift = open_shift(session, register_id)
    charges = charges_for_rental(session, rental.id)
    collectable = sum(charge_collectable_minor(session, charge) for charge in charges)
    if collectable <= 0:
        raise RentalConflictError("Rental has no collectable outstanding balance.")
    if amount_minor > collectable:
        raise RentalConflictError("Repayment cannot exceed the collectable rental balance.")
    remaining = max(0, rental_outstanding_minor(session, rental) - (
        amount_minor if method == "cash" else 0))
    receipt = RentalReceipt(
        rental_id=rental.id, branch_id=rental.branch_id, register_id=register.id,
        shift_id=shift.id, method=method, status="confirmed" if method == "cash" else "pending",
        amount_minor=amount_minor, remaining_minor=remaining,
        idempotency_key=idempotency_key, request_fingerprint=request_fingerprint,
        received_by=actor_id,
    )
    session.add(receipt)
    session.flush()
    left = amount_minor
    for charge in charges:
        if left == 0:
            break
        take = min(left, charge_collectable_minor(session, charge))
        if take <= 0:
            continue
        session.add(Payment(
            rental_charge_id=charge.id, rental_receipt_id=receipt.id, register_id=register.id,
            shift_id=shift.id, method=method, status=receipt.status,
            amount_minor=take, received_by=actor_id,
        ))
        left -= take
        session.flush()
    if left != 0:
        raise RentalConflictError("Repayment could not be allocated across rental periods.")
    session.flush()
    return receipt, False


def receivable_dto(session: Session, receipt: RentalReceipt) -> ReceivablePaymentDTO:
    allocations = session.scalars(
        select(Payment)
        .outerjoin(RentalCharge, Payment.rental_charge_id == RentalCharge.id)
        .where(Payment.rental_receipt_id == receipt.id)
        .order_by(RentalCharge.starts_on, RentalCharge.created_at, Payment.received_at, Payment.id)
    ).all()
    if not allocations:
        raise RentalNotFoundError("Rental receipt allocations are unavailable.")
    return ReceivablePaymentDTO(
        id=receipt.id, rental_id=receipt.rental_id, charge_id=allocations[0].rental_charge_id,
        method=receipt.method, status=receipt.status, amount_minor=receipt.amount_minor,
        remaining_minor=receipt.remaining_minor,
        allocations=[ReceivableAllocationDTO(charge_id=payment.rental_charge_id,
                                             amount_minor=payment.amount_minor)
                     for payment in allocations],
    )


def preview_cancellation(session: Session, *, rental_id: UUID,
                         authorized_branch_id: UUID | None) -> CancellationPreviewDTO:
    rental = _locked_rental(session, rental_id)
    branch = _rental_branch(session, rental, authorized_branch_id)
    facts = cancellation_facts(session, rental, branch)
    can_cancel = (rental.kind == "locker" and rental.status == "active"
                  and not pending_transfer_exists(session, rental))
    return CancellationPreviewDTO(
        can_cancel=can_cancel, preview_token=facts["preview_token"],
        settled_minor=facts["settled_minor"], max_refundable_minor=facts["settled_minor"],
        suggested_refund_minor=facts["suggested_refund_minor"],
        outstanding_minor=facts["outstanding_minor"],
        cancelled_debt_minor=facts["outstanding_minor"],
        periods=[CancellationPeriodDTO(
            charge_id=charge.id, amount_minor=charge.amount_minor,
            starts_on=charge.starts_on, ends_on=charge.ends_on,
            outstanding_minor=charge_outstanding_minor(session, charge),
        ) for charge in facts["charges"]],
    )


def confirm_cancellation(
    session: Session, *, rental_id: UUID, register_id: UUID, actor_id: UUID,
    authorized_branch_id: UUID | None, preview_token: str, refund_amount_minor: int,
    refund_method: str, reason: str, idempotency_key: str,
) -> tuple[RentalCancellation, bool]:
    clean_idempotency_key(idempotency_key)
    if type(refund_amount_minor) is not int or not 0 <= refund_amount_minor <= MAX_MINOR:
        raise ValueError("Refund amount must be a nonnegative signed 64-bit integer.")
    if refund_method not in ("cash", "card"):
        raise ValueError("Refund method must be cash or card.")
    _lock_actor(session, actor_id)
    rental = _locked_rental(session, rental_id)
    branch = _rental_branch(session, rental, authorized_branch_id)
    register = lock_register(session, register_id, rental.branch_id)
    shift = open_shift(session, register_id)
    request_fingerprint = fingerprint(str(rental.id), str(register_id), preview_token,
                                      refund_amount_minor, refund_method, reason)
    existing = session.scalar(select(RentalCancellation).where(
        RentalCancellation.actor_id == actor_id, RentalCancellation.branch_id == rental.branch_id,
        RentalCancellation.idempotency_key == idempotency_key,
    ).with_for_update())
    if existing is not None:
        if existing.request_fingerprint != request_fingerprint:
            raise RentalConflictError("Idempotency key was already used for a different cancellation.")
        return existing, True
    if rental.kind != "locker":
        raise RentalConflictError("Only locker rentals can be cancelled.")
    if rental.status != "active":
        raise RentalConflictError("Only active locker rentals can be cancelled.")
    if pending_transfer_exists(session, rental):
        raise RentalConflictError("Resolve pending transfer payments before cancelling.")
    facts = cancellation_facts(session, rental, branch)
    if preview_token != facts["preview_token"]:
        raise RentalConflictError("Cancellation preview is stale; review the updated facts.")
    if refund_amount_minor > facts["settled_minor"]:
        raise RentalConflictError("Refund cannot exceed the settled amount.")
    cancellation = RentalCancellation(
        rental_id=rental.id, branch_id=rental.branch_id, member_id=rental.member_id,
        asset_id=rental.asset_id, actor_id=actor_id,
        actor_name=staff_display_name(session, actor_id, rental.branch_id),
        register_id=register.id, shift_id=shift.id,
        reason=reason, refund_method=refund_method, refund_amount_minor=refund_amount_minor,
        suggested_refund_minor=facts["suggested_refund_minor"],
        settled_minor=facts["settled_minor"], cancelled_debt_minor=facts["outstanding_minor"],
        preview_token=preview_token, idempotency_key=idempotency_key,
        request_fingerprint=request_fingerprint,
    )
    session.add(cancellation)
    rental.status = "cancelled"
    rental.ended_by = actor_id
    rental.ended_at = datetime.now(timezone.utc)
    cancel_pending_card_attempts(session, rental.id)
    session.flush()
    return cancellation, False


def list_alerts(session: Session, *, branch_id: UUID, authorized_branch_id: UUID | None) -> list[RentalCancellation]:
    if authorized_branch_id is not None and branch_id != authorized_branch_id:
        raise RentalAccessDenied("Access restricted to staff branch.")
    return session.scalars(select(RentalCancellation).where(
        RentalCancellation.branch_id == branch_id
    ).order_by(RentalCancellation.created_at.desc(), RentalCancellation.id.desc())).all()


def review_alert(session: Session, *, cancellation_id: UUID, actor_id: UUID) -> RentalCancellation:
    cancellation = session.scalar(select(RentalCancellation).where(
        RentalCancellation.id == cancellation_id).with_for_update())
    if cancellation is None:
        raise RentalNotFoundError("Rental cancellation alert not found.")
    if cancellation.reviewed_at is None:
        display_name = staff_display_name(session, actor_id, cancellation.branch_id)
        cancellation.reviewed_by = actor_id
        cancellation.reviewed_by_name = display_name
        cancellation.reviewed_at = datetime.now(timezone.utc)
        session.flush()
    return cancellation


def begin_card_attempt(
    session: Session, *, rental_id: UUID, charge_id: UUID, register_id: UUID, actor_id: UUID,
    authorized_branch_id: UUID | None, amount_minor: int, terminal_id: UUID | None,
    idempotency_key: str,
) -> tuple[RentalCardAttempt, bool]:
    clean_idempotency_key(idempotency_key)
    if type(amount_minor) is not int or not 0 < amount_minor <= MAX_MINOR:
        raise ValueError("Card attempt amount must be a positive signed 64-bit integer.")
    _lock_actor(session, actor_id)
    rental = _locked_rental(session, rental_id)
    _rental_branch(session, rental, authorized_branch_id)
    if rental.status == "cancelled":
        raise RentalConflictError("Cancelled rental cannot start a card attempt.")
    register = lock_register(session, register_id, rental.branch_id)
    shift = open_shift(session, register_id)
    charge = session.scalar(select(RentalCharge).where(RentalCharge.id == charge_id).with_for_update())
    if charge is None or charge.rental_id != rental.id:
        raise RentalNotFoundError("Rental charge not found.")
    request_fingerprint = fingerprint(str(rental.id), str(charge.id), str(register_id), amount_minor)
    existing = session.scalar(select(RentalCardAttempt).where(
        RentalCardAttempt.created_by == actor_id,
        RentalCardAttempt.idempotency_key == idempotency_key,
    ).with_for_update())
    if existing is not None:
        if existing.request_fingerprint != request_fingerprint:
            raise RentalConflictError("Idempotency key was already used for a different card attempt.")
        return existing, True
    if amount_minor > charge_outstanding_minor(session, charge):
        raise RentalConflictError("Card attempt cannot exceed the charge outstanding balance.")
    attempt = RentalCardAttempt(
        rental_id=rental.id, charge_id=charge.id, branch_id=rental.branch_id,
        member_id=rental.member_id, asset_id=rental.asset_id, register_id=register.id,
        shift_id=shift.id, terminal_id=terminal_id, amount_minor=amount_minor,
        status="pending", idempotency_key=idempotency_key,
        request_fingerprint=request_fingerprint, created_by=actor_id,
    )
    session.add(attempt)
    session.flush()
    return attempt, False


def get_card_attempt(session: Session, *, attempt_id: UUID,
                     authorized_branch_id: UUID | None) -> RentalCardAttempt:
    attempt = session.scalar(select(RentalCardAttempt).where(RentalCardAttempt.id == attempt_id))
    if attempt is None:
        raise RentalNotFoundError("Card attempt not found.")
    if authorized_branch_id is not None and attempt.branch_id != authorized_branch_id:
        raise RentalAccessDenied("Access restricted to staff branch.")
    return attempt


def card_attempt_dto(attempt: RentalCardAttempt) -> CardAttemptDTO:
    return CardAttemptDTO(
        id=attempt.id, rental_id=attempt.rental_id, charge_id=attempt.charge_id,
        amount_minor=attempt.amount_minor, status=attempt.status, payment_id=attempt.payment_id,
        failure_reason=attempt.failure_reason,
        created_at=attempt.created_at or datetime.now(timezone.utc),
    )


def apply_card_attempt(
    session: Session, *, attempt_id: UUID, provider_status: str,
    authorization_code: str | None = None, card_brand: str | None = None,
    card_last_four: str | None = None, provider_payment_id: str | None = None,
    provider_amount_minor: int | None = None,
) -> RentalCardAttempt:
    attempt = session.scalar(select(RentalCardAttempt).where(
        RentalCardAttempt.id == attempt_id).with_for_update())
    if attempt is None:
        raise RentalNotFoundError("Card attempt not found.")
    settle_card_attempt(session, attempt, provider_status, authorization_code,
                        card_brand, card_last_four, provider_payment_id,
                        provider_amount_minor=provider_amount_minor)
    session.flush()
    return attempt


def review_rental_transfer(
    session: Session, *, payment_id: UUID, actor_id: UUID, status: str,
    idempotency_key: str,
) -> tuple[Payment, UUID, bool]:
    clean_idempotency_key(idempotency_key)
    if status not in ("confirmed", "pending"):
        raise ValueError("Transfer review status must be confirmed or pending.")
    _lock_actor(session, actor_id)
    payment = session.scalar(select(Payment).where(Payment.id == payment_id).with_for_update())
    if payment is None or payment.rental_charge_id is None or payment.method != "transfer":
        raise RentalNotFoundError("Rental transfer payment not found.")
    charge = session.get(RentalCharge, payment.rental_charge_id)
    if charge is None:
        raise RentalNotFoundError("Rental charge not found.")
    rental = session.scalar(select(Rental).where(Rental.id == charge.rental_id).with_for_update())
    if rental is None:
        raise RentalNotFoundError("Rental not found.")
    if rental.status == "cancelled":
        raise RentalConflictError("Cancelled rental transfers cannot be reviewed.")
    req_fingerprint = fingerprint(str(payment_id), status, str(actor_id))
    prior = session.scalar(select(PaymentReviewEvent).where(
        PaymentReviewEvent.payment_id == payment.id,
        PaymentReviewEvent.idempotency_key == idempotency_key,
    ).with_for_update())
    if prior is not None:
        if prior.request_fingerprint != req_fingerprint:
            raise RentalConflictError("Review idempotency key was already used for a different decision.")
        return payment, rental.id, True
    if payment.status not in ("under_review", "pending", "confirmed"):
        raise RentalConflictError("Transfer payment cannot be reviewed from its current state.")
    session.add(PaymentReviewEvent(
        payment_id=payment.id, actor_id=actor_id, from_status=payment.status, to_status=status,
        idempotency_key=idempotency_key, request_fingerprint=req_fingerprint,
        created_at=datetime.now(timezone.utc),
    ))
    payment.status = status
    session.flush()
    return payment, rental.id, False


def list_rentals(session: Session, *, branch_id: UUID, status: str | None,
                 kind: str | None, member_id: UUID | None,
                 authorized_branch_id: UUID | None) -> list[Rental]:
    if authorized_branch_id is not None and branch_id != authorized_branch_id:
        raise RentalAccessDenied("Access restricted to staff branch.")
    filters = [Rental.branch_id == branch_id]
    if status is not None:
        filters.append(Rental.status == status)
    if kind is not None:
        filters.append(Rental.kind == kind)
    if member_id is not None:
        filters.append(Rental.member_id == member_id)
    return session.scalars(select(Rental).where(*filters)
                           .order_by(Rental.created_at.desc(), Rental.id.desc())).all()


def member_receivables(session: Session, *, member_id: UUID, branch_id: UUID,
                       authorized_branch_id: UUID | None) -> list[MemberReceivableDTO]:
    if authorized_branch_id is not None and branch_id != authorized_branch_id:
        raise RentalAccessDenied("Access restricted to staff branch.")
    if session.get(Member, member_id) is None:
        raise RentalNotFoundError("Member not found.")
    rows = session.execute(
        select(Rental, RentalAsset).join(RentalAsset, RentalAsset.id == Rental.asset_id)
        .where(Rental.member_id == member_id, Rental.branch_id == branch_id,
               Rental.status.in_(("active", "returned", "released")))
        .order_by(Rental.created_at.desc(), Rental.id.desc())
    ).all()
    items = []
    for rental, asset in rows:
        outstanding = rental_outstanding_minor(session, rental)
        if outstanding > 0:
            items.append(MemberReceivableDTO(
                rental_id=rental.id, branch_id=rental.branch_id, kind=rental.kind,
                asset_code=asset.code, outstanding_minor=outstanding,
                created_at=rental.created_at or datetime.now(timezone.utc),
            ))
    return items


def active_rentals_by_asset(session: Session, asset_ids: list[UUID]) -> dict[UUID, UUID]:
    if not asset_ids:
        return {}
    rows = session.execute(select(Rental.asset_id, Rental.id).where(
        Rental.asset_id.in_(asset_ids), Rental.status == "active")).all()
    return {asset_id: rental_id for asset_id, rental_id in rows}
