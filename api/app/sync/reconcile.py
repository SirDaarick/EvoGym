"""Domain effect executors for offline contingency events (T5.7, T5.8)."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.authorization import RoleGrant
from app.db.models.shifts import CashRegister, Shift
from app.db.models.staff import StaffUser
from app.db.models.sync import ContingencyEvent, SyncAuditFlag, SyncDevice
from app.inventory.queries import capture_register_inventory_snapshot
from app.memberships.service import apply_member_check_in
from app.sales.queries import post_contingency_cash_sale
from app.sales.schemas import ProductCartLineRequest
from app.settings import Settings
from app.shifts.queries import close_shift, open_shift
from app.sync.clock import classify_clock
from app.sync.envelope import (
    ArqueoClosePayload,
    CashSalePayload,
    CheckInPayload,
    ShiftOpenPayload,
    parse_payload,
)
from app.sync.flags import raise_flag


def check_staff_branch_authorization(session: Session, staff_id: UUID, branch_id: UUID) -> bool:
    staff = session.get(StaffUser, staff_id)
    if staff is None or not staff.is_active:
        return False
    grants = session.scalars(
        select(RoleGrant).where(RoleGrant.staff_id == staff_id, RoleGrant.is_active.is_(True))
    ).all()
    if not grants:
        return True  # If no RBAC grants seeded, active staff is permitted
    for g in grants:
        if g.scope_kind == "organization" or g.branch_id == branch_id:
            return True
    return False


def reconcile_event(
    session: Session,
    device: SyncDevice,
    event_row: ContingencyEvent,
    settings: Settings,
    now: datetime | None = None,
) -> list[SyncAuditFlag]:
    flags: list[SyncAuditFlag] = []
    current_time = now or datetime.now(timezone.utc)

    # 1. Clock classification check
    clock_skew_tolerance = getattr(settings, "sync_clock_skew_tolerance_seconds", 300)
    clock_status = classify_clock(
        event_row.client_recorded_at,
        event_row.clock_anchor_utc,
        event_row.clock_monotonic_delta_ms,
        tolerance_s=clock_skew_tolerance,
    )
    if clock_status != "within_tolerance":
        flags.append(
            raise_flag(
                session,
                event_row_id=event_row.id,
                branch_id=device.branch_id,
                shift_id=None,
                kind=clock_status,
                details={
                    "client_recorded_at": event_row.client_recorded_at.isoformat(),
                    "clock_anchor_utc": event_row.clock_anchor_utc.isoformat() if event_row.clock_anchor_utc else None,
                    "clock_monotonic_delta_ms": event_row.clock_monotonic_delta_ms,
                },
                now=current_time,
            )
        )

    # 2. Actor authorization check
    is_authorized = check_staff_branch_authorization(session, event_row.actor_staff_id, device.branch_id)
    if not is_authorized:
        flags.append(
            raise_flag(
                session,
                event_row_id=event_row.id,
                branch_id=device.branch_id,
                shift_id=None,
                kind="actor_not_authorized",
                details={"actor_staff_id": str(event_row.actor_staff_id), "branch_id": str(device.branch_id)},
                now=current_time,
            )
        )

    # 3. Domain dispatch by event_type
    if event_row.event_type == "attendance.check_in":
        payload = parse_payload(event_row.event_type, event_row.payload)
        assert isinstance(payload, CheckInPayload)
        import hashlib
        fingerprint = hashlib.sha256(f"contingency:{event_row.event_id}:{payload.member_id}".encode()).hexdigest()
        res = apply_member_check_in(
            session,
            branch_id=device.branch_id,
            period_id=payload.period_id,
            actor_id=event_row.actor_staff_id,
            occurred_at=event_row.client_recorded_at,
            idempotency_key=f"contingency:{event_row.event_id}",
            request_fingerprint=fingerprint,
            enforce_access=False,
        )
        event_row.result_check_in_id = res.check_in.id
        if res.linked_to_existing_visit and not res.replayed:
            flags.append(
                raise_flag(
                    session,
                    event_row_id=event_row.id,
                    branch_id=device.branch_id,
                    shift_id=None,
                    kind="linked_check_in",
                    details={"visit_id": str(res.visit.id) if res.visit else None},
                    now=current_time,
                )
            )
        if res.access_decision is not None and not res.access_decision.allowed:
            flags.append(
                raise_flag(
                    session,
                    event_row_id=event_row.id,
                    branch_id=device.branch_id,
                    shift_id=None,
                    kind="entitlement_denied_on_sync",
                    details={
                        "reason": res.access_decision.reason,
                        "status": res.access_decision.status.value,
                    },
                    now=current_time,
                )
            )

    elif event_row.event_type == "pos.cash_sale":
        payload = parse_payload(event_row.event_type, event_row.payload)
        assert isinstance(payload, CashSalePayload)
        cart_lines = [
            ProductCartLineRequest(product_id=it.product_id, quantity=it.quantity)
            for it in payload.items
        ]
        unit_prices = {it.product_id: it.unit_price_minor for it in payload.items}

        # Resolve shift
        target_shift_id: UUID | None = None
        orphan_detected = False
        try:
            target_shift_id = UUID(payload.local_shift_ref)
            shift = session.get(Shift, target_shift_id)
            if shift is None or shift.cash_register_id != payload.register_id or shift.status != "open":
                orphan_detected = True
                target_shift_id = None
        except (ValueError, TypeError):
            orphan_detected = True
            target_shift_id = None

        sale_result = post_contingency_cash_sale(
            session,
            register_id=payload.register_id,
            actor_id=event_row.actor_staff_id,
            member_id=payload.member_id,
            items=cart_lines,
            expected_total_minor=payload.total_minor,
            idempotency_key=f"contingency:{event_row.event_id}",
            occurred_at=event_row.client_recorded_at,
            unit_prices=unit_prices,
            offline_receipt_number=event_row.event_id,
            shift_id=target_shift_id,
        )
        event_row.result_order_id = sale_result.order.id
        event_row.result_shift_id = sale_result.order.shift_id

        if orphan_detected:
            flags.append(
                raise_flag(
                    session,
                    event_row_id=event_row.id,
                    branch_id=device.branch_id,
                    shift_id=sale_result.order.shift_id,
                    kind="orphan_shift_reference",
                    details={
                        "local_shift_ref": payload.local_shift_ref,
                        "reconciled_shift_id": str(sale_result.order.shift_id) if sale_result.order.shift_id else None,
                    },
                    now=current_time,
                )
            )
        if sale_result.variances:
            flags.append(
                raise_flag(
                    session,
                    event_row_id=event_row.id,
                    branch_id=device.branch_id,
                    shift_id=sale_result.order.shift_id,
                    kind="inventory_variance",
                    details={"variances": [str(v) for v in sale_result.variances]},
                    now=current_time,
                )
            )
        if sale_result.price_drifts:
            flags.append(
                raise_flag(
                    session,
                    event_row_id=event_row.id,
                    branch_id=device.branch_id,
                    shift_id=sale_result.order.shift_id,
                    kind="price_drift",
                    details={"price_drifts": [str(d) for d in sale_result.price_drifts]},
                    now=current_time,
                )
            )

    elif event_row.event_type == "shift.open":
        payload = parse_payload(event_row.event_type, event_row.payload)
        assert isinstance(payload, ShiftOpenPayload)
        existing_shift = session.scalar(
            select(Shift).where(
                Shift.cash_register_id == payload.register_id,
                Shift.status.in_(["open", "closing"]),
            )
        )
        if existing_shift is not None:
            event_row.result_shift_id = existing_shift.id
            flags.append(
                raise_flag(
                    session,
                    event_row_id=event_row.id,
                    branch_id=device.branch_id,
                    shift_id=existing_shift.id,
                    kind="cash_discrepancy",
                    details={
                        "reason": "shift_already_open",
                        "opening_cash_minor": payload.opening_cash_minor,
                        "existing_opening_cash_minor": existing_shift.opening_cash_minor,
                    },
                    now=current_time,
                )
            )
        else:
            snapshot = capture_register_inventory_snapshot(
                session, register_id=payload.register_id, actor_id=event_row.actor_staff_id
            )
            counts = [
                {"denomination_minor": d.denomination_minor, "quantity": d.quantity}
                for d in payload.denomination_counts
            ]
            shift = open_shift(
                session,
                register_id=payload.register_id,
                opened_by=event_row.actor_staff_id,
                denomination_counts=counts,
                inventory_snapshot_id=snapshot.id,
                opening_cash_minor=payload.opening_cash_minor,
                now=event_row.client_recorded_at,
            )
            event_row.result_shift_id = shift.id

    elif event_row.event_type == "shift.arqueo_close":
        payload = parse_payload(event_row.event_type, event_row.payload)
        assert isinstance(payload, ArqueoClosePayload)
        shift = None
        try:
            target_shift_id = UUID(payload.shift_ref)
            shift = session.get(Shift, target_shift_id)
        except (ValueError, TypeError):
            shift = session.scalar(
                select(Shift)
                .join(CashRegister, CashRegister.id == Shift.cash_register_id)
                .where(CashRegister.branch_id == device.branch_id, Shift.status == "open")
                .order_by(Shift.opened_at.desc())
            )

        if shift is None:
            flags.append(
                raise_flag(
                    session,
                    event_row_id=event_row.id,
                    branch_id=device.branch_id,
                    shift_id=None,
                    kind="orphan_shift_reference",
                    details={"shift_ref": payload.shift_ref},
                    now=current_time,
                )
            )
        else:
            event_row.result_shift_id = shift.id
            counts = (
                [{"denomination_minor": d.denomination_minor, "quantity": d.quantity} for d in payload.denomination_counts]
                if payload.denomination_counts
                else None
            )
            total_counted = (
                sum(d.denomination_minor * d.quantity for d in payload.denomination_counts)
                if payload.denomination_counts
                else 0
            )
            close_res = close_shift(
                session,
                shift_id=shift.id,
                closed_by=event_row.actor_staff_id,
                denomination_counts=counts,
                counted_cash_minor=total_counted if counts is None else None,
                closing_notes=payload.closing_notes,
                now=event_row.client_recorded_at,
            )
            if close_res.shift.difference_minor != 0:
                flags.append(
                    raise_flag(
                        session,
                        event_row_id=event_row.id,
                        branch_id=device.branch_id,
                        shift_id=close_res.shift.id,
                        kind="cash_discrepancy",
                        details={
                            "difference_minor": close_res.shift.difference_minor,
                            "expected_minor": close_res.shift.expected_cash_at_close_minor,
                            "counted_minor": close_res.shift.counted_cash_minor,
                        },
                        now=current_time,
                    )
                )

    # 4. Finalize event status
    if flags:
        event_row.status = "flagged_audit"
        event_row.reason_code = flags[0].kind
    else:
        event_row.status = "accepted"
        event_row.reason_code = None

    session.flush()
    return flags
