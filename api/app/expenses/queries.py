"""Expense and cash-contribution SQL."""
from sqlalchemy import select

from app.db.models import CashRegister, Expense, Shift


def get_register(session, register_id, *, lock=False):
    query = select(CashRegister).where(CashRegister.id == register_id)
    if lock:
        query = query.execution_options(populate_existing=True).with_for_update()
    return session.scalar(query)


def open_shift(session, register_id, *, lock=False):
    query = select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open")
    if lock:
        query = query.execution_options(populate_existing=True).with_for_update()
    return session.scalar(query)


def movements_for_shift(session, model, shift_id):
    return list(session.scalars(select(model).where(model.shift_id == shift_id)
                                .order_by(model.created_at.desc(), model.id.desc())))


def expenses_between(session, branch_id, start, end):
    return session.scalars(select(Expense).where(Expense.branch_id == branch_id,
        Expense.created_at >= start, Expense.created_at < end)).all()


def get_expense(session, expense_id):
    return session.get(Expense, expense_id)


def lock_expense(session, expense_id):
    return session.scalar(select(Expense).where(Expense.id == expense_id)
                          .execution_options(populate_existing=True).with_for_update())


def shift_register_id(session, shift_id):
    return session.scalar(select(Shift.cash_register_id).where(Shift.id == shift_id))


def lock_shift(session, shift_id):
    return session.scalar(select(Shift).where(Shift.id == shift_id)
                          .execution_options(populate_existing=True).with_for_update())
