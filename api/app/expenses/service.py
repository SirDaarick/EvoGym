"""Expense use cases: register/branch scope, idempotent creation, voiding and evidence uploads.

SQL lives in `app.expenses.queries`; HTTP transport in `app.api.expenses`. Failures are `HttpStatusError`s.
`storage` and `resolve_finance` are lazy callables supplied by the router (evidence storage / finance
principal), because they must run at the same point of the flow as before.
"""
from datetime import date, datetime, time, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError

from app.db.models import Expense, ShiftCashContribution
from app.errors import HttpStatusError
from app.expenses import queries as q
from app.finance import queries as fq
from app.finance.service import authorized_branches
from app.rentals.payments import clean_idempotency_key, fingerprint, staff_display_name
from app.rentals.service import require_receptionist, session_factory
from app.shifts.queries import expected_cash_for_shift
from app.shifts.schemas import _serialize_datetime


def _register(session, register_id, principal, *, lock=False):
    register = q.get_register(session, register_id, lock=lock)
    if register is None:
        raise HttpStatusError(404)
    require_receptionist(session, register.branch_id, principal)
    return register


def _dto(session, row, storage):
    base = {"id": row.id, "shift_id": row.shift_id, "concept": row.concept,
            "amount_minor": row.amount_minor, "recorded_by_name": staff_display_name(session, row.recorded_by_id, row.branch_id),
            "recorded_at": _serialize_datetime(row.created_at)}
    if isinstance(row, Expense):
        store = storage() if row.evidence_key else None
        base.update(branch_id=row.branch_id, category=row.category, payee_name=row.payee_name,
                    payment_method=row.payment_method, voucher_reference=row.voucher_reference,
                    evidence_url=store.presign_get(row.evidence_key) if store else None, voided_at=_serialize_datetime(row.voided_at),
                    voided_by_name=staff_display_name(session, row.voided_by_id, row.branch_id) if row.voided_by_id else None,
                    void_reason=row.void_reason)
    else:
        base["contributor_name"] = row.contributor_name
    return base


def _clean_key(key):
    try:
        clean_idempotency_key(key)
    except ValueError:
        raise HttpStatusError(422) from None


def _validate_evidence(storage, branch_id, key):
    if key is None:
        return
    if not key.startswith(f"expenses/{branch_id}/"):
        raise HttpStatusError(422)
    store = storage()
    if store is None:
        raise HttpStatusError(501)
    if not store.exists(key):
        raise HttpStatusError(422)


def _create(factory, storage, register_id, principal, payload, key, model):
    _clean_key(key)
    values = payload.model_dump()
    request_hash = fingerprint(str(register_id), values)
    try:
        with session_factory(factory).begin() as session:
            register = _register(session, register_id, principal, lock=True)
            prior = fq.prior_by_key(session, model, branch_id=register.branch_id,
                                    staff_id=principal.staff_id, key=key, lock=True)
            if prior is not None:
                if prior.request_fingerprint != request_hash:
                    raise HttpStatusError(409)
                return _dto(session, prior, storage)
            shift = q.open_shift(session, register_id, lock=True)
            if shift is None:
                raise HttpStatusError(409)
            _validate_evidence(storage, register.branch_id, values.get("evidence_key"))
            if model is Expense:
                values["payment_method"] = "cash"
            row = fq.add(session, model(
                **values, branch_id=register.branch_id, shift_id=shift.id,
                recorded_by_id=principal.staff_id, idempotency_key=key, request_fingerprint=request_hash,
                created_at=datetime.now(timezone.utc)))
            try:
                expected_cash_for_shift(session, shift)
            except ValueError:
                raise HttpStatusError(422) from None
            return _dto(session, row, storage)
    except IntegrityError:
        raise HttpStatusError(409) from None


def _list(factory, storage, register_id, principal, model):
    with session_factory(factory)() as session:
        _register(session, register_id, principal)
        shift = q.open_shift(session, register_id)
        rows = [] if shift is None else q.movements_for_shift(session, model, shift.id)
        return {"items": [_dto(session, row, storage) for row in rows],
                "total_minor": sum(row.amount_minor for row in rows if not isinstance(row, Expense) or row.voided_at is None)}


def create_shift_expense(factory, storage, register_id, principal, payload, key):
    return _create(factory, storage, register_id, principal, payload, key, Expense)


def list_shift_expenses(factory, storage, register_id, principal):
    return _list(factory, storage, register_id, principal, Expense)


def create_contribution(factory, storage, register_id, principal, payload, key):
    return _create(factory, storage, register_id, principal, payload, key, ShiftCashContribution)


def list_contributions(factory, storage, register_id, principal):
    return _list(factory, storage, register_id, principal, ShiftCashContribution)


def create_business_expense(factory, storage, principal, payload, key):
    _clean_key(key)
    values = payload.model_dump()
    request_hash = fingerprint(values)
    try:
        with session_factory(factory).begin() as session:
            authorized_branches(session, principal, payload.branch_id)
            prior = fq.prior_by_key(session, Expense, branch_id=payload.branch_id,
                                    staff_id=principal.staff_id, key=key, lock=True)
            if prior:
                if prior.request_fingerprint != request_hash:
                    raise HttpStatusError(409)
                return _dto(session, prior, storage)
            _validate_evidence(storage, payload.branch_id, values.get("evidence_key"))
            row = fq.add(session, Expense(
                **values, recorded_by_id=principal.staff_id, idempotency_key=key,
                request_fingerprint=request_hash, created_at=datetime.now(timezone.utc)))
            return _dto(session, row, storage)
    except IntegrityError:
        raise HttpStatusError(409) from None


def list_admin_expenses(factory, storage, principal, from_date, to_date, branch_id):
    if to_date < from_date or to_date == date.max:
        raise HttpStatusError(422)
    with session_factory(factory)() as session:
        branches = authorized_branches(session, principal, branch_id)
        rows = []
        for branch in branches:
            zone = ZoneInfo(branch.timezone)
            start = datetime.combine(from_date, time.min, zone).astimezone(timezone.utc)
            end = datetime.combine(to_date + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
            rows.extend(q.expenses_between(session, branch.id, start, end))
        rows.sort(key=lambda row: (row.created_at, str(row.id)), reverse=True)
        return {"items": [_dto(session, row, storage) for row in rows],
                "branches": [{"id": branch.id, "name": branch.name} for branch in branches]}


def void_expense(factory, storage, resolve_finance, expense_id, principal, payload):
    with session_factory(factory).begin() as session:
        row = q.get_expense(session, expense_id)
        if row is None:
            raise HttpStatusError(404)
        if principal.is_admin or row.shift_id is None:
            authorized_branches(session, resolve_finance(), row.branch_id)
        else:
            require_receptionist(session, row.branch_id, principal)
        if row.shift_id is not None:
            _register(session, q.shift_register_id(session, row.shift_id), principal, lock=True)
            shift = q.lock_shift(session, row.shift_id)
            if shift is None or shift.status != "open":
                raise HttpStatusError(409)
        row = q.lock_expense(session, expense_id)
        if row.voided_at is not None:
            if row.void_reason == payload.reason:
                return _dto(session, row, storage)
            raise HttpStatusError(409)
        row.voided_at = datetime.now(timezone.utc)
        row.voided_by_id = principal.staff_id
        row.void_reason = payload.reason
        session.flush()
        return _dto(session, row, storage)


def request_evidence_upload(factory, storage, resolve_finance, principal, payload):
    with session_factory(factory)() as session:
        if principal.is_admin:
            authorized_branches(session, resolve_finance(), payload.branch_id)
        else:
            require_receptionist(session, payload.branch_id, principal)
    store = storage()
    if store is None:
        raise HttpStatusError(501)
    key = f"expenses/{payload.branch_id}/{uuid4()}.webp"
    return {"upload_url": store.presign_put(key, payload.content_type, payload.file_size_bytes), "evidence_key": key}
