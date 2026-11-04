"""Owner history use case: a read-only, keyset-paginated union ledger of money, visits, stock and shifts."""
import base64
import json
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.db.models import (
    CashRegister, Member, MemberCheckIn, Order, Payment, Product, RegisterInventorySnapshotItem, Shift,
    ShiftInventoryObservation, ShiftInventoryReview, StaffRosterProfile, StaffUser, StockMovement,
)
from app.errors import HttpStatusError, session_factory
from app.finance.service import authorized_branches

CATEGORIES = ("membership", "product", "visit", "restock", "waste", "count", "shift")
METHODS = ("cash", "card", "transfer")
MAX_LIMIT = 200


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _encode(at, row_id):
    return base64.urlsafe_b64encode(json.dumps([at.isoformat(), row_id]).encode()).decode()


def _decode(cursor):
    try:
        at, row_id = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        return _utc(datetime.fromisoformat(at)), str(row_id)
    except Exception:
        raise HttpStatusError(422) from None


def _page(session, stmt, column, at_of, start, end, cursor, limit):
    """Rows of one source at or before the cursor time, newest first; rows tied at the cut-off are kept whole."""
    base = stmt.where(column >= start, column < end)
    tied = []
    if cursor is not None:
        # +-1s slack: SQLite stores server-default timestamps without microseconds, so equality alone can miss ties.
        low, high = cursor[0] - timedelta(seconds=1), cursor[0] + timedelta(seconds=1)
        tied = session.execute(base.where(column >= low, column < high)).all()
        base = base.where(column < low)
    rows = session.execute(base.order_by(column.desc()).limit(limit)).all()
    if len(rows) == limit:
        oldest = at_of(rows[-1])
        rows = session.execute(base.where(column >= oldest).order_by(column.desc())).all()
    return [*tied, *rows]


def owner_history(factory, principal, from_date, to_date, category, method, branch_id, cursor, limit):
    if category is not None and category not in CATEGORIES:
        raise HttpStatusError(422)
    if method is not None and method not in METHODS:
        raise HttpStatusError(422)
    if not 1 <= limit <= MAX_LIMIT:
        raise HttpStatusError(422)
    if from_date and to_date and to_date < from_date:
        raise HttpStatusError(422)
    after = _decode(cursor) if cursor else None
    with session_factory(factory)() as session:
        if not principal.organization_admin:
            raise HttpStatusError(403)
        try:
            branches = authorized_branches(session, principal, branch_id)
        except HttpStatusError as exc:
            if exc.status == 404:
                raise HttpStatusError(403) from None
            raise
        if not branches:
            raise HttpStatusError(403)
        zone = ZoneInfo(branches[0].timezone or "America/Mexico_City")
        today = datetime.now(timezone.utc).astimezone(zone).date()
        first, last = from_date or today, to_date or today
        start = datetime.combine(first, time.min, zone).astimezone(timezone.utc)
        end = datetime.combine(last + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
        ids = [branch.id for branch in branches]
        want = lambda name: category is None or category == name
        take = limit + 1
        events = []

        def emit(at, row_id, **fields):
            at = _utc(at)
            if after is None or (at, row_id) < after:
                events.append({"id": row_id, "occurred_at": at, **fields})

        # Money: order payments (membership / product).
        if want("membership") or want("product"):
            stmt = (select(Payment, Order, Member).join(Order, Payment.order_id == Order.id)
                    .outerjoin(Member, Order.member_id == Member.id).where(Order.branch_id.in_(ids)))
            if method:
                stmt = stmt.where(Payment.method == method)
            if category in ("membership", "product"):
                stmt = stmt.where(Order.order_kind == category)
            for payment, order, member in _page(session, stmt, Payment.received_at, lambda r: _utc(r[0].received_at),
                                                start, end, after, take):
                items = ", ".join(item.description_snapshot if item.quantity == 1 else f"{item.description_snapshot} x{item.quantity}"
                                  for item in order.items)
                emit(payment.received_at, f"payment:{payment.id}", category=order.order_kind, branch_id=order.branch_id,
                     shift_id=payment.shift_id or order.shift_id, description=items, status=payment.status,
                     amount_minor=payment.amount_minor, method=payment.method, actor_id=payment.received_by,
                     member_id=member.id if member else None, member_name=member.full_name if member else None,
                     detail="Pago de membresía." if order.order_kind == "membership" else "Venta de producto.")
        if not method:
            if want("visit"):
                stmt = select(MemberCheckIn, Member).join(Member, MemberCheckIn.member_id == Member.id).where(MemberCheckIn.branch_id.in_(ids))
                for check_in, member in _page(session, stmt, MemberCheckIn.occurred_at, lambda r: _utc(r[0].occurred_at),
                                              start, end, after, take):
                    emit(check_in.occurred_at, f"visit:{check_in.id}", category="visit", branch_id=check_in.branch_id,
                         shift_id=None, description=member.full_name, status="recorded", amount_minor=None, method=None,
                         actor_id=check_in.recorded_by, member_id=member.id, member_name=member.full_name,
                         detail=f"Acceso: {check_in.access_reason}.")
            for kind in ("restock", "waste"):
                if want(kind):
                    stmt = (select(StockMovement, Product).join(Product, StockMovement.product_id == Product.id)
                            .where(StockMovement.branch_id.in_(ids), StockMovement.kind == kind))
                    for movement, product in _page(session, stmt, StockMovement.recorded_at, lambda r: _utc(r[0].recorded_at),
                                                   start, end, after, take):
                        reason = f" Motivo: {movement.reason}." if movement.reason else ""
                        emit(movement.recorded_at, f"{kind}:{movement.id}", category=kind, branch_id=movement.branch_id,
                             shift_id=None, description=product.name, status="recorded", amount_minor=None, method=None,
                             actor_id=movement.recorded_by, member_id=None, member_name=None,
                             detail=f"{movement.quantity} unidades. Movimiento de cantidad, no un gasto.{reason}")
            if want("count"):
                stmt = (select(ShiftInventoryObservation, RegisterInventorySnapshotItem, ShiftInventoryReview, Shift, CashRegister)
                        .join(RegisterInventorySnapshotItem, RegisterInventorySnapshotItem.id == ShiftInventoryObservation.snapshot_item_id)
                        .join(ShiftInventoryReview, ShiftInventoryReview.id == ShiftInventoryObservation.review_id)
                        .join(Shift, Shift.id == ShiftInventoryReview.shift_id)
                        .join(CashRegister, CashRegister.id == Shift.cash_register_id)
                        .where(CashRegister.branch_id.in_(ids)))
                for obs, item, review, shift, register in _page(session, stmt, ShiftInventoryReview.confirmed_at,
                                                                lambda r: _utc(r[2].confirmed_at), start, end, after, take):
                    expected = item.expected_quantity
                    variance = None if expected is None else obs.physical_quantity - expected
                    emit(review.confirmed_at, f"count:{obs.id}", category="count", branch_id=register.branch_id,
                         shift_id=shift.id, description=item.name, status="observed" if variance else "recorded",
                         amount_minor=None, method=None, actor_id=review.confirmed_by, member_id=None, member_name=None,
                         detail=f"Esperado: {expected if expected is not None else 'sin inicializar'} · Contado: {obs.physical_quantity}"
                                f" · Diferencia: {variance if variance is not None else 'n/d'}. Sin corrección de stock.")
            if want("shift"):
                base = select(Shift, CashRegister).join(CashRegister, CashRegister.id == Shift.cash_register_id).where(CashRegister.branch_id.in_(ids))
                for shift, register in _page(session, base, Shift.opened_at, lambda r: _utc(r[0].opened_at), start, end, after, take):
                    emit(shift.opened_at, f"shift-open:{shift.id}", category="shift", branch_id=register.branch_id,
                         shift_id=shift.id, description=f"Apertura {register.name}", status="opened", amount_minor=None,
                         method=None, actor_id=shift.opened_by, member_id=None, member_name=None,
                         detail=f"Fondo inicial: {shift.opening_cash_minor / 100:.2f} MXN · No es ingreso.")
                closed = base.where(Shift.closed_at.is_not(None))
                for shift, register in _page(session, closed, Shift.closed_at, lambda r: _utc(r[0].closed_at), start, end, after, take):
                    money = lambda v: "Sin registrar" if v is None else f"{v / 100:.2f} MXN"
                    emit(shift.closed_at, f"shift-close:{shift.id}", category="shift", branch_id=register.branch_id,
                         shift_id=shift.id, description=f"Cierre {register.name}", status="closed", amount_minor=None,
                         method=None, actor_id=shift.closed_by or shift.opened_by, member_id=None, member_name=None,
                         detail=f"Esperado: {money(shift.expected_cash_at_close_minor)} · Contado: {money(shift.counted_cash_minor)}"
                                f" · Diferencia: {money(shift.difference_minor)}. Comparación manual.")

        events.sort(key=lambda e: (e["occurred_at"], e["id"]), reverse=True)
        page, more = events[:limit], len(events) > limit
        actor_ids = {e["actor_id"] for e in page if e["actor_id"]}
        names = {}
        if actor_ids:
            names = {row.id: row.login_identifier for row in session.scalars(select(StaffUser).where(StaffUser.id.in_(actor_ids)))}
            names.update({row.staff_user_id: row.full_name for row in session.scalars(
                select(StaffRosterProfile).where(StaffRosterProfile.staff_user_id.in_(actor_ids)))})
        for event in page:
            event["actor_name"] = names.get(event["actor_id"])
        return {
            "period": {"from": first, "to": last, "timezone": str(zone)},
            "items": page,
            "next_cursor": _encode(page[-1]["occurred_at"], page[-1]["id"]) if more else None,
        }
