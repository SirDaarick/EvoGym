"""Credit use cases: branch authorization, commit and idempotency reconciliation."""
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.credit import queries as q
from app.credit.schemas import MemberCreditMovementDTO, MemberCreditMovementPage
from app.errors import HttpStatusError, http_errors

_ERRORS = ((q.CreditNotFoundError, 404), (q.CreditAccessDenied, 403), (q.CreditConflictError, 409), (ValueError, 422))


def _authorized_branch(principal):
    return None if principal.is_admin else principal.branch_id


def post_credit_deposit(factory, principal, register_id: UUID, payload, idempotency_key: str):
    """Returns (dto, replayed). Collect cash into a member's saldo a favor on the open shift."""
    try:
        with http_errors(*_ERRORS):
            with factory() as session:
                result = q.post_credit_deposit(
                    session, register_id=register_id, actor_id=principal.staff_id,
                    authorized_branch_id=_authorized_branch(principal), member_id=payload.member_id,
                    amount_minor=payload.amount_minor, idempotency_key=idempotency_key)
                session.commit()
                return MemberCreditMovementDTO.model_validate(result.movement), result.replayed
    except IntegrityError:
        # A concurrent request may win the actor/branch idempotency key on another register.
        with factory() as session:
            register = session.get(q.CashRegister, register_id)
            if register is None:
                raise
            if not principal.is_admin and register.branch_id != principal.branch_id:
                raise HttpStatusError(403) from None
            row = q.find_deposit_by_key(session, branch_id=register.branch_id, received_by=principal.staff_id,
                                        idempotency_key=idempotency_key)
            if row is None:
                raise
            if row.request_fingerprint != q.credit_deposit_fingerprint(register_id, payload.member_id, payload.amount_minor):
                raise HttpStatusError(409) from None
            return MemberCreditMovementDTO.model_validate(row), True


def list_credit_movements(session, principal, member_id: UUID, offset: int, limit: int) -> MemberCreditMovementPage:
    with http_errors(*_ERRORS):
        total, rows = q.list_credit_movements(
            session, member_id=member_id, branch_id=_authorized_branch(principal), offset=offset, limit=limit)
    return MemberCreditMovementPage(
        total_items=total, items=[MemberCreditMovementDTO.model_validate(row) for row in rows])
