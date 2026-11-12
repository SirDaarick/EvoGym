"""Finance SQL: branch scope, pending-money projections, payroll rows and owner-overview reads."""
from sqlalchemy import func, select

from app.db.models import (
    Branch, CashRegister, ClassSampleCheckIn, Member, MemberCheckIn, MemberCreditMovement, MembershipDebt, MembershipDebtPayment,
    MembershipPeriod, Order, OrderItem, Payment, PaymentReviewEvent, PayrollAdvance, PayrollPayment, Product,
    PaymentTerminal, ProductRefund, ProductSaleCancellation, RegisterInventorySnapshotItem, Rental, RentalCancellation, RentalCharge, RentalDepositMovement, Shift,
    ShiftInventoryObservation, ShiftInventoryReview, StaffAttendanceCheckout, StaffAttendanceCorrection, StaffAttendanceRecord,
    StaffRosterProfile, StaffScheduleSeries, StockInitialization, StockMovement,
)


# --- shared ----------------------------------------------------------------------------------

def get_branch(session, branch_id):
    return session.get(Branch, branch_id)


def active_branches(session):
    return session.scalars(select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.id)).all()


def add(session, row):
    session.add(row)
    session.flush()
    return row


def prior_by_key(session, model, *, branch_id, staff_id, key, lock=False):
    query = select(model).where(model.branch_id == branch_id, model.recorded_by_id == staff_id,
                                model.idempotency_key == key)
    return session.scalar(query.with_for_update() if lock else query)


# --- pending money ---------------------------------------------------------------------------

def pending_order_transfers(session, branch_ids):
    return session.execute(
        select(Payment, Order, Member)
        .join(Order, Payment.order_id == Order.id)
        .join(Member, Order.member_id == Member.id)
        .where(Order.branch_id.in_(branch_ids), Payment.method == "transfer",
               Payment.status.in_(("under_review", "pending")))
        .order_by(Payment.received_at, Payment.id)
    ).all()


def latest_review_event(session, payment_id):
    return session.scalar(
        select(PaymentReviewEvent).where(PaymentReviewEvent.payment_id == payment_id)
        .order_by(PaymentReviewEvent.created_at.desc(), PaymentReviewEvent.id.desc()).limit(1))


def open_debts(session, branch_ids):
    return session.execute(
        select(MembershipDebt, Order, Member, func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0))
        .join(Order, MembershipDebt.order_id == Order.id)
        .join(Member, MembershipDebt.member_id == Member.id)
        .outerjoin(MembershipDebtPayment, MembershipDebtPayment.debt_id == MembershipDebt.id)
        .where(Order.branch_id.in_(branch_ids))
        .group_by(MembershipDebt.id, Order.id, Member.id)
        .having(MembershipDebt.initial_outstanding_minor > func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0))
        .order_by(MembershipDebt.created_at, MembershipDebt.id)
    ).all()


def last_debt_payment(session, debt_id):
    return session.scalar(
        select(MembershipDebtPayment).where(MembershipDebtPayment.debt_id == debt_id)
        .order_by(MembershipDebtPayment.created_at.desc(), MembershipDebtPayment.id.desc()).limit(1))


def billable_rentals(session, branch_ids):
    return session.execute(
        select(Rental, Member).join(Member, Rental.member_id == Member.id)
        .where(Rental.branch_id.in_(branch_ids), Rental.status.in_(("active", "returned", "released")))
        .order_by(Rental.created_at, Rental.id)
    ).all()


def pending_rental_transfers(session, branch_ids):
    return session.execute(
        select(Payment, Rental, Member)
        .join(RentalCharge, RentalCharge.id == Payment.rental_charge_id)
        .join(Rental, Rental.id == RentalCharge.rental_id)
        .join(Member, Rental.member_id == Member.id)
        .where(Rental.branch_id.in_(branch_ids), Payment.method == "transfer",
               Payment.status.in_(("under_review", "pending")))
        .order_by(Payment.received_at, Payment.id)
    ).all()


# --- payroll ---------------------------------------------------------------------------------

def lock_profile(session, profile_id, branch_id):
    return session.scalar(select(StaffRosterProfile).where(
        StaffRosterProfile.id == profile_id, StaffRosterProfile.branch_id == branch_id).with_for_update())


def payroll_profiles(session, branch_id):
    return session.scalars(select(StaffRosterProfile).where(
        StaffRosterProfile.branch_id == branch_id, StaffRosterProfile.is_active.is_(True),
        StaffRosterProfile.monthly_salary_minor > 0)
        .order_by(StaffRosterProfile.full_name, StaffRosterProfile.id)).all()


def advances_total(session, profile_id, week):
    return session.scalar(select(func.coalesce(func.sum(PayrollAdvance.amount_minor), 0)).where(
        PayrollAdvance.staff_profile_id == profile_id, PayrollAdvance.week_start == week))


def advance_payment_method(session, profile_id, week):
    from app.db.models import Expense
    return session.scalar(
        select(Expense.payment_method)
        .join(PayrollAdvance, PayrollAdvance.expense_id == Expense.id)
        .where(PayrollAdvance.staff_profile_id == profile_id, PayrollAdvance.week_start == week)
        .order_by(PayrollAdvance.created_at.desc(), PayrollAdvance.id.desc())
        .limit(1)
    )


def expense_payment_methods(session, expense_ids):
    from app.db.models import Expense
    ids = [eid for eid in expense_ids if eid is not None]
    return {eid: method for eid, method in session.execute(
        select(Expense.id, Expense.payment_method).where(Expense.id.in_(ids))
    )} if ids else {}


def week_payment(session, profile_id, week):
    return session.scalar(select(PayrollPayment).where(
        PayrollPayment.staff_profile_id == profile_id, PayrollPayment.week_start == week))


def payroll_activity(session, branch_id, first_week, last_week):
    """Advances and payments of one branch whose week_start lies in [first_week, last_week] (read-only)."""
    advances = session.scalars(select(PayrollAdvance).where(
        PayrollAdvance.branch_id == branch_id, PayrollAdvance.week_start >= first_week,
        PayrollAdvance.week_start <= last_week)).all()
    payments = session.scalars(select(PayrollPayment).where(
        PayrollPayment.branch_id == branch_id, PayrollPayment.week_start >= first_week,
        PayrollPayment.week_start <= last_week)).all()
    return advances, payments


def profiles_by_ids(session, profile_ids):
    ids = list(profile_ids)
    return {p.id: p for p in session.scalars(select(StaffRosterProfile).where(StaffRosterProfile.id.in_(ids)))} if ids else {}


# --- owner overview --------------------------------------------------------------------------

def branch_shifts(session, branch_id):
    return session.scalars(select(Shift).join(CashRegister).where(CashRegister.branch_id == branch_id)).all()


def overtime_payments(session, branch_id, start, end):
    return session.scalars(select(Payment).join(Order, Payment.order_id == Order.id).where(
        Order.branch_id == branch_id, Order.financial_shift_id.is_(None), Payment.method.in_(("cash", "card")),
        Payment.received_at >= start, Payment.received_at < end)).all()


def product_refunds(session, branch_id, start, end):
    return session.scalars(select(ProductRefund).where(ProductRefund.branch_id == branch_id,
        ProductRefund.created_at >= start, ProductRefund.created_at < end)).all()


def payment_terminal_ids(session, payment_ids):
    """Map payment id -> terminal id for payments settled on a Point terminal."""
    ids = list(payment_ids)
    return {pid: tid for pid, tid in session.execute(select(Payment.id, Payment.terminal_id).where(
        Payment.id.in_(ids), Payment.terminal_id.is_not(None)))} if ids else {}


def terminal_names(session, terminal_ids):
    ids = list(terminal_ids)
    return {tid: name for tid, name in session.execute(select(PaymentTerminal.id, PaymentTerminal.name).where(
        PaymentTerminal.id.in_(ids)))} if ids else {}


def product_sale_cancellations(session, branch_id, start, end):
    return session.scalars(select(ProductSaleCancellation).where(ProductSaleCancellation.branch_id == branch_id,
        ProductSaleCancellation.created_at >= start, ProductSaleCancellation.created_at < end)).all()


def rental_cancellations(session, branch_id, start, end):
    return session.scalars(select(RentalCancellation).where(RentalCancellation.branch_id == branch_id,
        RentalCancellation.created_at >= start, RentalCancellation.created_at < end)).all()


def deposit_movements(session, branch_id, start, end):
    return session.scalars(select(RentalDepositMovement).where(RentalDepositMovement.branch_id == branch_id,
        RentalDepositMovement.created_at >= start, RentalDepositMovement.created_at < end)).all()


def credit_deposit_ids(session, branch_id, start, end):
    return set(session.scalars(select(MemberCreditMovement.id).where(
        MemberCreditMovement.branch_id == branch_id, MemberCreditMovement.kind == "deposit",
        MemberCreditMovement.created_at >= start, MemberCreditMovement.created_at < end)))


def register_names(session, branch_id):
    return {rid: name for rid, name in session.execute(select(CashRegister.id, CashRegister.name).where(CashRegister.branch_id == branch_id))}


def count_discrepancies(session, branch_id, start, end):
    return session.execute(select(ShiftInventoryObservation, RegisterInventorySnapshotItem, ShiftInventoryReview)
        .join(RegisterInventorySnapshotItem, RegisterInventorySnapshotItem.id == ShiftInventoryObservation.snapshot_item_id)
        .join(ShiftInventoryReview, ShiftInventoryReview.id == ShiftInventoryObservation.review_id)
        .join(Shift, Shift.id == ShiftInventoryReview.shift_id).join(CashRegister)
        .where(CashRegister.branch_id == branch_id, ShiftInventoryReview.confirmed_at >= start,
               ShiftInventoryReview.confirmed_at < end,
               ShiftInventoryObservation.physical_quantity != RegisterInventorySnapshotItem.expected_quantity)).all()


def membership_periods(session, branch_id):
    return session.scalars(select(MembershipPeriod).join(OrderItem).join(Order)
                           .where(Order.branch_id == branch_id)).all()


def members_by_ids(session, member_ids):
    return session.scalars(select(Member).where(Member.id.in_(member_ids))).all()


def member_check_ins(session, branch_id, start, end):
    return session.scalars(select(MemberCheckIn).where(MemberCheckIn.branch_id == branch_id,
        MemberCheckIn.occurred_at >= start, MemberCheckIn.occurred_at < end)).all()


def class_sample_check_ins(session, branch_id, start, end):
    return session.scalars(select(ClassSampleCheckIn).where(ClassSampleCheckIn.branch_id == branch_id,
        ClassSampleCheckIn.occurred_at >= start, ClassSampleCheckIn.occurred_at < end)).all()


def recent_member_ids(session, branch_id, start, now):
    return session.scalars(select(MemberCheckIn.member_id).where(MemberCheckIn.branch_id == branch_id,
        MemberCheckIn.occurred_at >= start, MemberCheckIn.occurred_at <= now)).all()


def recent_sample_member_ids(session, branch_id, start, now):
    return session.scalars(select(ClassSampleCheckIn.member_id).where(ClassSampleCheckIn.branch_id == branch_id,
        ClassSampleCheckIn.occurred_at >= start, ClassSampleCheckIn.occurred_at <= now)).all()


def active_products(session):
    return session.scalars(select(Product).where(Product.is_active.is_(True))).all()


def initial_stock(session, branch_id):
    return dict(session.execute(select(StockInitialization.product_id, StockInitialization.quantity)
        .where(StockInitialization.branch_id == branch_id)).all())


def stock_movement_totals(session, branch_id):
    return session.execute(select(StockMovement.product_id, StockMovement.kind, func.sum(StockMovement.quantity))
        .where(StockMovement.branch_id == branch_id).group_by(StockMovement.product_id, StockMovement.kind)).all()


def retail_totals(session, branch_id, start, end):
    return session.execute(select(func.coalesce(func.sum(OrderItem.quantity), 0),
        func.coalesce(func.sum(OrderItem.line_total_minor), 0)).join(Order).join(Payment, Payment.order_id == Order.id).where(
        Order.branch_id == branch_id, Payment.status == "confirmed",
        OrderItem.item_kind == "product", Order.created_at >= start, Order.created_at < end)).one()


def overdue_lockers(session, branch_id, today):
    return session.scalar(select(func.count()).select_from(Rental).where(Rental.branch_id == branch_id,
        Rental.kind == "locker", Rental.status == "active", Rental.ends_on < today)) or 0


def unreviewed_cancellations(session, branch_id):
    return session.scalar(select(func.count()).select_from(RentalCancellation).where(
        RentalCancellation.branch_id == branch_id, RentalCancellation.reviewed_at.is_(None))) or 0


def active_profiles(session, branch_id):
    return session.scalars(select(StaffRosterProfile).where(StaffRosterProfile.branch_id == branch_id,
        StaffRosterProfile.is_active.is_(True))).all()


def attendance_entries(session, branch_id, day):
    return session.scalars(select(StaffAttendanceRecord).where(StaffAttendanceRecord.branch_id == branch_id,
        StaffAttendanceRecord.business_date == day)).all()


def checkout_attendance_ids(session, attendance_ids):
    return set(session.scalars(select(StaffAttendanceCheckout.attendance_id).where(
        StaffAttendanceCheckout.attendance_id.in_(attendance_ids))).all())


def schedule_series(session, branch_id, profile_ids):
    return session.scalars(select(StaffScheduleSeries).where(StaffScheduleSeries.branch_id == branch_id,
        StaffScheduleSeries.profile_id.in_(profile_ids))).all()


def attendance_corrections_count(session, branch_id, start, end):
    return session.scalar(
        select(func.count())
        .select_from(StaffAttendanceCorrection)
        .join(StaffAttendanceRecord, StaffAttendanceCorrection.attendance_id == StaffAttendanceRecord.id)
        .where(StaffAttendanceRecord.branch_id == branch_id,
               StaffAttendanceCorrection.corrected_at >= start,
               StaffAttendanceCorrection.corrected_at < end)
    ) or 0




def waste_movements_count(session, branch_id, start, end):
    return session.scalar(
        select(func.count())
        .select_from(StockMovement)
        .where(
            StockMovement.branch_id == branch_id,
            StockMovement.kind == "waste",
            StockMovement.recorded_at >= start,
            StockMovement.recorded_at < end,
        )
    ) or 0
