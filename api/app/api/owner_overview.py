"""Owner overview HTTP transport: parse the request, call `app.finance.overview`."""
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select

from app.api.deps import FinancePrincipal, RawFactoryDep, _bearer, _principal
from app.db.models import (
    Branch,
    Member,
    MemberCheckIn,
    MembershipDebt,
    MembershipDebtPayment,
    Order,
    OrderItem,
    Payment,
    Product,
    ProductRefund,
    ProductSaleCancellation,
    StaffAttendanceCorrection,
    StaffAttendanceRecord,
    StaffRosterProfile,
    StaffUser,
    StockMovement,
)
from app.finance import overview

router = APIRouter(prefix="/api/v1/owner/overview", tags=["owner-overview"])


def _overview_principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> FinancePrincipal:
    try:
        return _principal(request, credentials)
    except HTTPException as exc:
        if exc.status_code == 401:
            raise HTTPException(403, "Finance access denied.") from None
        raise


def _staff_display_names(session, staff_ids: set[UUID]) -> dict[UUID, str]:
    if not staff_ids:
        return {}
    names = {
        uid: name
        for uid, name in session.execute(
            select(StaffRosterProfile.staff_user_id, StaffRosterProfile.full_name)
            .where(StaffRosterProfile.staff_user_id.in_(staff_ids))
        )
        if uid is not None
    }
    missing = staff_ids - names.keys()
    if missing:
        for uid, login in session.execute(
            select(StaffUser.id, StaffUser.login_identifier).where(StaffUser.id.in_(missing))
        ):
            names[uid] = login
    return names


@router.get("")
def owner_overview(
    factory: RawFactoryDep,
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    branch_id: UUID | None = None,
    principal: FinancePrincipal = Depends(_overview_principal),
):
    return overview.owner_overview(factory, principal, from_date, to_date, branch_id)


def _utc_dt(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _utc_iso(value: datetime) -> str:
    return _utc_dt(value).isoformat()


def _order_items_summary(order: Order) -> str:
    summary = ", ".join(
        item.description_snapshot if item.quantity == 1 else f"{item.description_snapshot} x{item.quantity}"
        for item in order.items
    )
    if summary:
        return summary
    return "Membresía" if order.order_kind == "membership" else "Venta de productos"


def _build_sales_alerts(
    branches: dict[UUID, str],
    staff_names: dict[UUID, str],
    open_debt_rows,
    order_payment_rows,
    refund_rows,
    sale_cancel_rows,
) -> list[dict]:
    alerts: list[dict] = []

    for debt, order, member, paid_amount in open_debt_rows:
        remaining_minor = int(debt.initial_outstanding_minor) - int(paid_amount)
        paid_total_minor = max(0, int(order.total_minor) - remaining_minor)
        alerts.append({
            "id": f"sale-debt-{debt.id}",
            "category": "sales",
            "subtype": "pending_payment",
            "subtype_label": "Pago pendiente",
            "branch_id": str(order.branch_id),
            "branch_name": branches.get(order.branch_id),
            "order_id": str(order.id),
            "order_kind": order.order_kind,
            "member_id": str(member.id),
            "member_name": member.full_name,
            "member_number": member.member_number,
            "items_summary": _order_items_summary(order),
            "amount_minor": remaining_minor,
            "total_minor": int(order.total_minor),
            "paid_minor": paid_total_minor,
            "payment_method": order.payment.method if order.payment else "cash",
            "payment_status": "outstanding",
            "payout_method": None,
            "disposition": None,
            "reason": "Saldo pendiente por liquidar",
            "recorded_by_id": str(order.seller_id),
            "recorded_by_name": staff_names.get(order.seller_id, str(order.seller_id)),
            "occurred_at": _utc_iso(debt.created_at),
        })

    for payment, order, member in order_payment_rows:
        is_transfer = payment.method == "transfer"
        reason = (
            ("En revisión bancaria" if payment.status == "under_review" else "Transferencia por conciliar")
            if is_transfer
            else "Cobro con tarjeta fallido"
        )
        alerts.append({
            "id": f"sale-{'transfer' if is_transfer else 'failed'}-{payment.id}",
            "category": "sales",
            "subtype": "pending_transfer" if is_transfer else "failed_payment",
            "subtype_label": "Transferencia pendiente" if is_transfer else "Cobro fallido",
            "branch_id": str(order.branch_id),
            "branch_name": branches.get(order.branch_id),
            "order_id": str(order.id),
            "order_kind": order.order_kind,
            "member_id": str(member.id) if member else None,
            "member_name": member.full_name if member else None,
            "member_number": member.member_number if member else None,
            "items_summary": _order_items_summary(order),
            "amount_minor": int(payment.amount_minor),
            "total_minor": int(order.total_minor),
            "paid_minor": None,
            "payment_method": payment.method,
            "payment_status": payment.status,
            "payout_method": None,
            "disposition": None,
            "reason": reason,
            "recorded_by_id": str(payment.received_by),
            "recorded_by_name": staff_names.get(payment.received_by, str(payment.received_by)),
            "occurred_at": _utc_iso(payment.received_at),
        })

    for refund, order_item, order, member in refund_rows:
        item_label = (
            order_item.description_snapshot
            if refund.quantity == 1
            else f"{order_item.description_snapshot} x{refund.quantity}"
        )
        alerts.append({
            "id": f"sale-refund-{refund.id}",
            "category": "sales",
            "subtype": "product_refund",
            "subtype_label": "Devolución",
            "branch_id": str(refund.branch_id),
            "branch_name": branches.get(refund.branch_id),
            "order_id": str(order.id),
            "order_kind": "product",
            "member_id": str(member.id) if member else None,
            "member_name": member.full_name if member else None,
            "member_number": member.member_number if member else None,
            "items_summary": item_label,
            "product_name": order_item.description_snapshot,
            "quantity": int(refund.quantity),
            "amount_minor": int(refund.amount_minor),
            "total_minor": int(order.total_minor),
            "paid_minor": None,
            "payment_method": order.payment.method if order.payment else None,
            "payment_status": "refunded",
            "payout_method": refund.payout_method,
            "disposition": refund.disposition,
            "reason": refund.reason,
            "recorded_by_id": str(refund.actor_id),
            "recorded_by_name": staff_names.get(refund.actor_id, str(refund.actor_id)),
            "occurred_at": _utc_iso(refund.created_at),
        })

    for cancel in sale_cancel_rows:
        alerts.append({
            "id": f"sale-cancel-{cancel.seller_id}-{cancel.branch_id}-{cancel.idempotency_key}",
            "category": "sales",
            "subtype": "sale_cancellation",
            "subtype_label": "Venta cancelada",
            "branch_id": str(cancel.branch_id),
            "branch_name": branches.get(cancel.branch_id),
            "order_id": None,
            "order_kind": "product",
            "member_id": None,
            "member_name": None,
            "member_number": None,
            "items_summary": "Venta interrumpida cancelada",
            "amount_minor": 0,
            "total_minor": None,
            "paid_minor": None,
            "payment_method": None,
            "payment_status": "cancelled",
            "payout_method": None,
            "disposition": None,
            "reason": "Cancelada antes de confirmar cobro",
            "recorded_by_id": str(cancel.seller_id),
            "recorded_by_name": staff_names.get(cancel.seller_id, str(cancel.seller_id)),
            "occurred_at": _utc_iso(cancel.created_at),
        })

    return alerts


@router.get("/alerts")
def list_owner_alerts(
    request: Request,
    branch_id: UUID | None = None,
    principal: FinancePrincipal = Depends(_overview_principal),
):
    if not principal.organization_admin:
        raise HTTPException(403, "Finance access denied.")
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")

    with factory() as session:
        branches = {b.id: b.name for b in session.scalars(select(Branch)).all()}

        # 1. Debt override check-ins
        checkin_query = (
            select(MemberCheckIn, Member.full_name, Member.member_number)
            .join(Member, Member.id == MemberCheckIn.member_id)
        )
        if branch_id is not None:
            checkin_query = checkin_query.where(MemberCheckIn.branch_id == branch_id)
        checkin_query = checkin_query.order_by(MemberCheckIn.occurred_at.desc(), MemberCheckIn.id.desc())

        checkin_rows = [
            (event, name, number)
            for event, name, number in session.execute(checkin_query)
            if "outstanding_balance_confirmed" in (event.access_warnings or ())
            and "outstanding_balance" in (event.access_warnings or ())
        ]

        # 2. Staff attendance corrections
        corr_query = (
            select(StaffAttendanceCorrection, StaffAttendanceRecord, StaffRosterProfile)
            .join(StaffAttendanceRecord, StaffAttendanceCorrection.attendance_id == StaffAttendanceRecord.id)
            .join(StaffRosterProfile, StaffAttendanceRecord.profile_id == StaffRosterProfile.id)
        )
        if branch_id is not None:
            corr_query = corr_query.where(StaffAttendanceRecord.branch_id == branch_id)
        corr_query = corr_query.order_by(StaffAttendanceCorrection.corrected_at.desc(), StaffAttendanceCorrection.id.desc())
        corr_rows = list(session.execute(corr_query))

        # 3. Inventory waste movements
        waste_query = (
            select(StockMovement, Product)
            .join(Product, Product.id == StockMovement.product_id)
            .where(StockMovement.kind == "waste")
        )
        if branch_id is not None:
            waste_query = waste_query.where(StockMovement.branch_id == branch_id)
        waste_query = waste_query.order_by(StockMovement.recorded_at.desc(), StockMovement.id.desc())
        waste_rows = list(session.execute(waste_query))

        # 4. Sales alerts: open partial payments, pending transfers, failed card charges, product refunds, cancellations
        debt_sales_query = (
            select(
                MembershipDebt,
                Order,
                Member,
                func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0),
            )
            .join(Order, MembershipDebt.order_id == Order.id)
            .join(Member, MembershipDebt.member_id == Member.id)
            .outerjoin(MembershipDebtPayment, MembershipDebtPayment.debt_id == MembershipDebt.id)
        )
        if branch_id is not None:
            debt_sales_query = debt_sales_query.where(Order.branch_id == branch_id)
        debt_sales_query = (
            debt_sales_query
            .group_by(MembershipDebt.id, Order.id, Member.id)
            .having(MembershipDebt.initial_outstanding_minor > func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0))
            .order_by(MembershipDebt.created_at.desc(), MembershipDebt.id.desc())
        )
        open_debt_rows = list(session.execute(debt_sales_query))

        order_payment_query = (
            select(Payment, Order, Member)
            .join(Order, Payment.order_id == Order.id)
            .outerjoin(Member, Order.member_id == Member.id)
            .where(
                Payment.order_id.is_not(None),
                (
                    ((Payment.method == "transfer") & Payment.status.in_(("pending", "under_review")))
                    | ((Payment.method == "card") & (Payment.status == "failed"))
                ),
            )
        )
        if branch_id is not None:
            order_payment_query = order_payment_query.where(Order.branch_id == branch_id)
        order_payment_query = order_payment_query.order_by(Payment.received_at.desc(), Payment.id.desc())
        order_payment_rows = list(session.execute(order_payment_query))

        refund_query = (
            select(ProductRefund, OrderItem, Order, Member)
            .join(OrderItem, ProductRefund.order_item_id == OrderItem.id)
            .join(Order, OrderItem.order_id == Order.id)
            .outerjoin(Member, Order.member_id == Member.id)
        )
        if branch_id is not None:
            refund_query = refund_query.where(ProductRefund.branch_id == branch_id)
        refund_query = refund_query.order_by(ProductRefund.created_at.desc(), ProductRefund.id.desc())
        refund_rows = list(session.execute(refund_query))

        sale_cancel_query = select(ProductSaleCancellation)
        if branch_id is not None:
            sale_cancel_query = sale_cancel_query.where(ProductSaleCancellation.branch_id == branch_id)
        sale_cancel_query = sale_cancel_query.order_by(
            ProductSaleCancellation.created_at.desc(),
            ProductSaleCancellation.idempotency_key.desc(),
        )
        sale_cancel_rows = list(session.scalars(sale_cancel_query))

        staff_names = _staff_display_names(
            session,
            {event.recorded_by for event, _, _ in checkin_rows}
            | {corr.corrected_by for corr, _, _ in corr_rows}
            | {mov.recorded_by for mov, _ in waste_rows}
            | {order.seller_id for _, order, _, _ in open_debt_rows}
            | {payment.received_by for payment, _, _ in order_payment_rows}
            | {refund.actor_id for refund, _, _, _ in refund_rows}
            | {cancel.seller_id for cancel in sale_cancel_rows},
        )

        sales_alerts = _build_sales_alerts(
            branches,
            staff_names,
            open_debt_rows,
            order_payment_rows,
            refund_rows,
            sale_cancel_rows,
        )

        debt_alerts = [
            {
                "id": str(event.id),
                "category": "debt_override_checkin",
                "branch_id": str(event.branch_id),
                "branch_name": branches.get(event.branch_id),
                "member_id": str(event.member_id),
                "member_name": name,
                "member_number": number,
                "authorized_by_id": str(event.recorded_by),
                "authorized_by_user_id": str(event.recorded_by),
                "authorized_by_name": staff_names.get(event.recorded_by, str(event.recorded_by)),
                "occurred_at": event.occurred_at.isoformat(),
                "notes": "Excepción autorizada con adeudo de mensualidad",
                "reason_codes": event.access_warnings or [],
            }
            for event, name, number in checkin_rows
        ]

        correction_alerts = []
        for corr, record, profile in corr_rows:
            if corr.field_name in ("clock_in_at", "clock_out_at"):
                details = f"Ajustado de {corr.original_value} a {corr.corrected_value}"
            else:
                details = f"Campo: {corr.field_name}, valor: {corr.corrected_value}"

            correction_alerts.append({
                "id": str(corr.id),
                "category": "attendance_correction",
                "branch_id": str(record.branch_id),
                "branch_name": branches.get(record.branch_id),
                "attendance_id": str(record.id),
                "staff_profile_id": str(record.profile_id),
                "staff_member_name": profile.full_name,
                "corrected_by_id": str(corr.corrected_by),
                "corrected_by_user_id": str(corr.corrected_by),
                "corrected_by_name": staff_names.get(corr.corrected_by, str(corr.corrected_by)),
                "field_name": corr.field_name,
                "original_value": corr.original_value,
                "corrected_value": corr.corrected_value,
                "reason": corr.reason,
                "details": details,
                "occurred_at": corr.corrected_at.isoformat(),
            })

        waste_alerts = [
            {
                "id": str(mov.id),
                "category": "inventory_waste",
                "branch_id": str(mov.branch_id),
                "branch_name": branches.get(mov.branch_id),
                "product_id": str(mov.product_id),
                "product_name": product.name,
                "product_unit": product.unit,
                "quantity": mov.quantity,
                "unit_cost_minor": product.cost_minor,
                "unit_price_minor": product.price_minor,
                "total_cost_minor": product.cost_minor * mov.quantity,
                "total_price_minor": product.price_minor * mov.quantity,
                "reason": mov.reason,
                "recorded_by_id": str(mov.recorded_by),
                "recorded_by_name": staff_names.get(mov.recorded_by, str(mov.recorded_by)),
                "occurred_at": mov.recorded_at.isoformat(),
            }
            for mov, product in waste_rows
        ]

        all_alerts = sorted(
            debt_alerts + correction_alerts + waste_alerts + sales_alerts,
            key=lambda a: _utc_dt(datetime.fromisoformat(a["occurred_at"])),
            reverse=True,
        )
        return {
            "alerts": all_alerts,
            "total": len(all_alerts),
            "debt_override_count": len(debt_alerts),
            "attendance_correction_count": len(correction_alerts),
            "inventory_waste_count": len(waste_alerts),
            "sales_count": len(sales_alerts),
        }

