"""Read-only domain tools for Gimi. No free SQL/ORM access is exposed: each tool is a fixed function over
existing finance/membership readers, scoped to one already-verified member id, returning minimal text."""
from datetime import date
from uuid import UUID

from sqlalchemy import func, select

from app.db.models import Member, MembershipPeriod
from app.finance import queries as q
from app.gimi.permissions import authorize_tool
from app.gimi.rag.search import search as _rag_search
from app.rentals.payments import charge_collectable_minor, charges_for_rental


def _money(minor: int) -> str:
    return f"${minor // 100:,}.{minor % 100:02d} MXN"


def _greeting(member: Member) -> str:
    name = (member.preferred_name or member.full_name or "").strip().split(" ")[0]
    return f"Hola {name}." if name else "Hola."


def member_pending_balance(session, member_id: UUID) -> str:
    """Unsettled money for the member (pending transfers, open membership debt, rental receivables)."""
    member = session.get(Member, member_id)
    branch_ids = [branch.id for branch in q.active_branches(session)]
    total = 0
    if branch_ids:
        total += sum(p.amount_minor for p, _o, m in q.pending_order_transfers(session, branch_ids) if m.id == member_id)
        total += sum(d.initial_outstanding_minor - paid for d, _o, m, paid in q.open_debts(session, branch_ids)
                     if m.id == member_id)
        for rental, m in q.billable_rentals(session, branch_ids):
            if m.id == member_id:
                total += sum(charge_collectable_minor(session, c) for c in charges_for_rental(session, rental.id))
        total += sum(p.amount_minor for p, _r, m in q.pending_rental_transfers(session, branch_ids)
                     if m.id == member_id)
    if total <= 0:
        return f"{_greeting(member)} No tienes adeudos pendientes."
    return f"{_greeting(member)} Tu saldo pendiente es de {_money(total)}. Acércate a recepción para regularizarlo."


def member_membership_status(session, member_id: UUID) -> str:
    member = session.get(Member, member_id)
    ends_on = session.scalar(select(func.max(MembershipPeriod.ends_on)).where(MembershipPeriod.member_id == member_id))
    if ends_on is None:
        return f"{_greeting(member)} No encontramos una membresía registrada."
    if ends_on >= date.today():
        return f"{_greeting(member)} Tu membresía está vigente hasta el {ends_on.isoformat()}."
    return f"{_greeting(member)} Tu membresía venció el {ends_on.isoformat()}."


MAX_QUERY_CHARS = 300


def knowledge_search(session, query: object, provider=None) -> str:
    """Read-only semantic lookup over published rules and plans. Not member-scoped: chunks are public gym info."""
    if not isinstance(query, str) or not query.strip():
        return "Dime qué quieres saber sobre el gimnasio."
    hits = _rag_search(session, query.strip()[:MAX_QUERY_CHARS], provider, limit=3)
    if not hits:
        return "No encontré información sobre eso. Acércate a recepción."
    return "\n\n".join(f"{h.title}: {h.content}" for h in hits)


_TOOLS = {
    "member_pending_balance": member_pending_balance,
    "member_membership_status": member_membership_status,
}
_QUERY_TOOLS = {"knowledge_search": knowledge_search}


def invoke(name: str, session, member_id: UUID | None = None, *, query: str | None = None) -> str:
    """Run an allowlisted tool; unknown names raise `ToolDenied`. Query tools take free text, never SQL."""
    name = authorize_tool(name)
    if name in _QUERY_TOOLS:
        return _QUERY_TOOLS[name](session, query)
    return _TOOLS[name](session, member_id)
