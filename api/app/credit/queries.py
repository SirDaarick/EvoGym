"""Member credit (saldo a favor): the only writers of `members.credit_balance_minor` and its ledger.

A deposit is cash received into the open shift but is a liability, not sales. An application pays
part of a sale or debt from the balance and moves no cash. Callers own commit/rollback and must hold
the member row lock (`lock_member`) before calling `deposit_credit` / `apply_credit`.
"""
from dataclasses import dataclass
from hashlib import sha256
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import CashRegister, Member, MemberCreditMovement, Shift

MAX_MINOR = 2**63 - 1


class CreditNotFoundError(LookupError):
    """A requested member or register is unavailable."""


class CreditConflictError(ValueError):
    """A request conflicts with current state, balance or an existing idempotency key."""


class CreditAccessDenied(PermissionError):
    """The locked register is outside the authenticated staff branch."""


@dataclass(frozen=True)
class CreditMovementResult:
    movement: MemberCreditMovement
    replayed: bool


def credit_deposit_fingerprint(register_id: UUID, member_id: UUID, amount_minor: int) -> str:
    return sha256(f"{register_id}\n{member_id}\n{amount_minor}".encode("ascii")).hexdigest()


def lock_member(session: Session, member_id: UUID) -> Member:
    member = session.scalar(
        select(Member).where(Member.id == member_id).execution_options(populate_existing=True).with_for_update()
    )
    if member is None:
        raise CreditNotFoundError("Member not found.")
    return member


def _record(session: Session, *, kind: str, member: Member, register: CashRegister, shift: Shift,
            actor_id: UUID, amount_minor: int, **refs) -> MemberCreditMovement:
    if type(amount_minor) is not int or not 0 < amount_minor <= MAX_MINOR:
        raise ValueError("Credit amount must be a positive signed 64-bit integer.")
    balance = member.credit_balance_minor
    if type(balance) is not int or balance < 0:
        raise ValueError("Member credit balance is outside supported minor-unit bounds.")
    if kind == "apply":
        if amount_minor > balance:
            raise CreditConflictError("Credit amount exceeds the member's available balance.")
        balance -= amount_minor
    else:
        if amount_minor > MAX_MINOR - balance:
            raise ValueError("Credit balance exceeds supported minor-unit bounds.")
        balance += amount_minor
    member.credit_balance_minor = balance
    movement = MemberCreditMovement(
        member_id=member.id, branch_id=register.branch_id, register_id=register.id, shift_id=shift.id,
        kind=kind, amount_minor=amount_minor, balance_after_minor=balance, received_by=actor_id, **refs,
    )
    session.add(movement)
    session.flush()
    return movement


def deposit_credit(session: Session, *, member: Member, register: CashRegister, shift: Shift,
                   actor_id: UUID, amount_minor: int, **refs) -> MemberCreditMovement:
    """Add cash received on the open shift to the member balance."""
    return _record(session, kind="deposit", member=member, register=register, shift=shift,
                   actor_id=actor_id, amount_minor=amount_minor, **refs)


def apply_credit(session: Session, *, member: Member, register: CashRegister, shift: Shift,
                 actor_id: UUID, amount_minor: int, **refs) -> MemberCreditMovement:
    """Draw part of a sale, rental charge or debt from the member balance; rejects overdraft."""
    return _record(session, kind="apply", member=member, register=register, shift=shift,
                   actor_id=actor_id, amount_minor=amount_minor, **refs)


def ensure_credit_available(session: Session, member_id: UUID | None, amount_minor: int) -> None:
    """Fail fast before an irreversible step (a card charge) when the balance cannot cover `amount_minor`."""
    member = session.get(Member, member_id) if member_id is not None else None
    if member is None:
        raise CreditNotFoundError("Member not found.")
    if amount_minor > member.credit_balance_minor:
        raise CreditConflictError("Credit amount exceeds the member's available balance.")


def credit_applied_for_order(session: Session, order_id: UUID) -> int:
    """Total member credit drawn to pay one order (zero when it was paid without credit)."""
    return session.scalar(
        select(func.coalesce(func.sum(MemberCreditMovement.amount_minor), 0)).where(
            MemberCreditMovement.order_id == order_id, MemberCreditMovement.kind == "apply")
    ) or 0


def find_deposit_by_key(session: Session, *, branch_id: UUID, received_by: UUID, idempotency_key: str):
    return session.scalar(
        select(MemberCreditMovement).where(
            MemberCreditMovement.branch_id == branch_id,
            MemberCreditMovement.received_by == received_by,
            MemberCreditMovement.idempotency_key == idempotency_key,
        )
    )


def post_credit_deposit(
    session: Session, *, register_id: UUID, actor_id: UUID, authorized_branch_id: UUID | None,
    member_id: UUID, amount_minor: int, idempotency_key: str,
) -> CreditMovementResult:
    """Record one cash deposit into a member balance on the register's open shift."""
    if type(amount_minor) is not int or not 0 < amount_minor <= MAX_MINOR:
        raise ValueError("Deposit amount must be a positive signed 64-bit integer.")
    if not isinstance(idempotency_key, str) or not idempotency_key or len(idempotency_key) > 128:
        raise ValueError("Idempotency key must contain between 1 and 128 characters.")

    register = session.scalar(
        select(CashRegister).where(CashRegister.id == register_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if register is None:
        raise CreditNotFoundError("Cash register not found.")
    if authorized_branch_id is not None and register.branch_id != authorized_branch_id:
        raise CreditAccessDenied("Access restricted to staff branch.")

    fingerprint = credit_deposit_fingerprint(register_id, member_id, amount_minor)
    existing = find_deposit_by_key(
        session, branch_id=register.branch_id, received_by=actor_id, idempotency_key=idempotency_key)
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise CreditConflictError("Idempotency key was already used for a different request.")
        return CreditMovementResult(existing, replayed=True)

    if register.status != "active":
        raise CreditConflictError("Cash register is not active.")
    shift = session.scalar(
        select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open")
        .execution_options(populate_existing=True).with_for_update()
    )
    if shift is None:
        raise CreditConflictError("An open shift is required for a credit deposit.")

    member = lock_member(session, member_id)
    movement = deposit_credit(
        session, member=member, register=register, shift=shift, actor_id=actor_id, amount_minor=amount_minor,
        idempotency_key=idempotency_key, request_fingerprint=fingerprint,
    )
    return CreditMovementResult(movement, replayed=False)


def list_credit_movements(
    session: Session, *, member_id: UUID, branch_id: UUID | None, offset: int = 0, limit: int = 50,
) -> tuple[int, list[MemberCreditMovement]]:
    """Newest-first ledger page; `branch_id` restricts non-admin staff to their own branch."""
    if session.get(Member, member_id) is None:
        raise CreditNotFoundError("Member not found.")
    filters = [MemberCreditMovement.member_id == member_id]
    if branch_id is not None:
        filters.append(MemberCreditMovement.branch_id == branch_id)
    total = session.scalar(select(func.count()).select_from(MemberCreditMovement).where(*filters)) or 0
    rows = session.scalars(
        select(MemberCreditMovement).where(*filters)
        .order_by(MemberCreditMovement.created_at.desc(), MemberCreditMovement.id.desc())
        .offset(offset).limit(limit)
    ).all()
    return total, list(rows)
