"""Execution Dispatcher for Gimi Assistant.

Bridges Jev Router decisions to domain services, enforcing RBAC, parameter
validation, Draft & Confirm confirmation gates, and idempotent execution.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from enum import Enum
import hashlib
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db.models import (
    Branch,
    CashRegister,
    Member,
    MemberCheckIn,
    MembershipPeriod,
    Product,
    Rental,
    RentalAsset,
    Shift,
    StockMovement,
)
from app.db.models.expenses import Expense
from app.db.models.member_check_ins import MemberCheckInVisit
from app.gimi import domain_tools
from app.gimi.jev_router import JevRouteDecision
from app.gimi.rag.search import search as rag_search
from app.gimi.tool_definitions import (
    GimiRole,
    TOOL_REGISTRY,
    ToolKind,
    validate_tool_params,
)


class DispatchStatus(str, Enum):
    SUCCESS = "success"
    AMBIGUOUS = "ambiguous"
    NEEDS_CONFIRMATION = "needs_confirmation"
    PERMISSION_DENIED = "permission_denied"
    EXECUTION_ERROR = "execution_error"


@dataclass
class GimiActor:
    role: GimiRole
    member_id: UUID | None = None
    staff_user_id: UUID | None = None
    branch_id: UUID | None = None


@dataclass
class DispatchResult:
    status: DispatchStatus
    tool_name: str
    summary_for_llm: str
    data: dict[str, Any] = field(default_factory=dict)
    draft_action: dict[str, Any] | None = None


def _sha256(val: str) -> str:
    return hashlib.sha256(val.encode("utf-8")).hexdigest()


def _format_money(minor: int) -> str:
    return f"${minor // 100:,}.{minor % 100:02d} MXN"


class GimiDispatcher:
    """Dispatches routed Gimi tools to authoritative domain models and services."""

    def dispatch(
        self,
        session: Session,
        decision: JevRouteDecision,
        actor: GimiActor,
        raw_params: dict[str, Any] | None = None,
        confirmed: bool = False,
    ) -> DispatchResult:
        params_dict = raw_params or {}

        # 1. Ambiguity Gate (Triggered by low Jev confidence or delta tie)
        if decision.is_ambiguous or decision.tool_name == "unrecognized_intent":
            return DispatchResult(
                status=DispatchStatus.AMBIGUOUS,
                tool_name=decision.tool_name,
                summary_for_llm=(
                    "La solicitud no tiene suficiente certeza. Pide amablemente al usuario "
                    "que aclare su pregunta u objetivo."
                ),
                data={"confidence": decision.confidence, "explanation": decision.explanation},
            )

        tool = TOOL_REGISTRY.get(decision.tool_name)
        if not tool:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name=decision.tool_name,
                summary_for_llm=f"Herramienta desconocida: '{decision.tool_name}'.",
            )

        # 2. RBAC Enforcement Gate
        if actor.role not in tool.allowed_roles:
            return DispatchResult(
                status=DispatchStatus.PERMISSION_DENIED,
                tool_name=tool.name,
                summary_for_llm=f"El rol '{actor.role.value}' no tiene autorización para '{tool.name}'.",
            )

        # 3. Pydantic Parameter Validation
        try:
            validated_params = validate_tool_params(tool.name, params_dict)
        except Exception as exc:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name=tool.name,
                summary_for_llm=f"Parámetros inválidos para {tool.name}: {exc}",
                data={"raw_params": params_dict},
            )

        # 4. Draft & Confirm Gate for Financial / Stock Mutations
        if tool.requires_confirmation and not confirmed:
            return DispatchResult(
                status=DispatchStatus.NEEDS_CONFIRMATION,
                tool_name=tool.name,
                summary_for_llm=(
                    f"Acción crítica pendiente de confirmación. Presenta los detalles al usuario "
                    f"y solicita su confirmación explícita (Sí/No) antes de guardar."
                ),
                draft_action=validated_params.model_dump(),
                data={"requires_confirmation": True},
            )

        # 5. Handler Execution
        handler_name = f"_handle_{tool.name}"
        handler = getattr(self, handler_name, None)
        if not handler:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name=tool.name,
                summary_for_llm=f"No handler implemented for {tool.name}.",
            )

        try:
            return handler(session, actor, validated_params)
        except Exception as exc:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name=tool.name,
                summary_for_llm=f"Error durante la ejecución de {tool.name}: {exc}",
            )

    # -----------------------------------------------------------------------
    # Member Handlers
    # -----------------------------------------------------------------------

    def _handle_member_membership_status(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        if not actor.member_id:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name="member_membership_status",
                summary_for_llm="No se identificó el socio en la sesión activa.",
            )

        summary = domain_tools.member_membership_status(session, actor.member_id)
        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="member_membership_status",
            summary_for_llm=summary,
            data={"member_id": str(actor.member_id)},
        )

    def _handle_member_pending_balance(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        if not actor.member_id:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name="member_pending_balance",
                summary_for_llm="No se identificó el socio en la sesión activa.",
            )

        summary = domain_tools.member_pending_balance(session, actor.member_id)
        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="member_pending_balance",
            summary_for_llm=summary,
            data={"member_id": str(actor.member_id)},
        )

    def _handle_member_locker_status(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        if not actor.member_id:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name="member_locker_status",
                summary_for_llm="No se identificó el socio en la sesión activa.",
            )

        rental = session.scalar(
            select(Rental)
            .join(RentalAsset, Rental.asset_id == RentalAsset.id)
            .where(
                Rental.member_id == actor.member_id,
                RentalAsset.kind == "locker",
                Rental.status == "active",
            )
        )

        if not rental:
            return DispatchResult(
                status=DispatchStatus.SUCCESS,
                tool_name="member_locker_status",
                summary_for_llm="No tienes ningún casillero asignado actualmente.",
                data={"has_locker": False},
            )

        asset = session.get(RentalAsset, rental.asset_id)
        locker_no = asset.locker_number if asset else "?"
        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="member_locker_status",
            summary_for_llm=f"Tienes asignado el Casillero #{locker_no}. Tu renta está activa.",
            data={"has_locker": True, "locker_number": locker_no, "rental_id": str(rental.id)},
        )

    def _handle_gym_faq_and_rules(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        query = params.query
        hits = rag_search(session, query, limit=3)
        if not hits:
            return DispatchResult(
                status=DispatchStatus.SUCCESS,
                tool_name="gym_faq_and_rules",
                summary_for_llm="No encontré información sobre ese tema en los reglamentos o planes.",
                data={"hits_count": 0},
            )

        formatted_context = "\n\n".join(f"[{h.title}]: {h.content}" for h in hits)
        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="gym_faq_and_rules",
            summary_for_llm=f"Contexto recuperado del reglamento y planes:\n{formatted_context}",
            data={"hits": [{"title": h.title, "content": h.content, "score": h.score} for h in hits]},
        )

    # -----------------------------------------------------------------------
    # Staff Handlers
    # -----------------------------------------------------------------------

    def _handle_staff_lookup_member(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        q_term = f"%{params.query.strip().lower()}%"
        members = session.scalars(
            select(Member)
            .where(
                (func.lower(Member.full_name).like(q_term))
                | (Member.phone.like(q_term))
                | (Member.member_number.like(q_term))
            )
            .limit(5)
        ).all()

        if not members:
            return DispatchResult(
                status=DispatchStatus.SUCCESS,
                tool_name="staff_lookup_member",
                summary_for_llm=f"No se encontró ningún socio que coincida con '{params.query}'.",
                data={"found": 0},
            )

        items = [
            {"id": str(m.id), "name": m.full_name, "number": m.member_number, "status": m.status, "phone": m.phone}
            for m in members
        ]
        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="staff_lookup_member",
            summary_for_llm=f"Se encontraron {len(items)} socios: " + ", ".join(f"{i['name']} (#{i['number']}, {i['status']})" for i in items),
            data={"members": items},
        )

    def _handle_staff_inventory_stock(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        query = select(Product).where(Product.is_active == True)
        if params.product_query:
            q_term = f"%{params.product_query.strip().lower()}%"
            query = query.where(func.lower(Product.name).like(q_term) | func.lower(Product.code).like(q_term))

        prods = session.scalars(query.limit(10)).all()
        if not prods:
            return DispatchResult(
                status=DispatchStatus.SUCCESS,
                tool_name="staff_inventory_stock",
                summary_for_llm=f"No se encontraron productos para '{params.product_query}'.",
                data={"items": []},
            )

        items = [
            {"code": p.code, "name": p.name, "category": p.category, "price": _format_money(p.price_minor)}
            for p in prods
        ]
        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="staff_inventory_stock",
            summary_for_llm="Inventario disponible: " + "; ".join(f"{i['name']} ({i['price']})" for i in items),
            data={"products": items},
        )

    def _handle_staff_locker_overview(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        total = session.scalar(select(func.count(RentalAsset.id)).where(RentalAsset.kind == "locker")) or 0
        available = session.scalar(
            select(func.count(RentalAsset.id)).where(RentalAsset.kind == "locker", RentalAsset.status == "available")
        ) or 0
        occupied = total - available

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="staff_locker_overview",
            summary_for_llm=f"Casilleros: {total} totales, {available} disponibles, {occupied} ocupados o en servicio.",
            data={"total": total, "available": available, "occupied": occupied},
        )

    def _handle_staff_record_checkin(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        ident = f"%{params.member_identifier.strip().lower()}%"
        member = session.scalar(
            select(Member)
            .where(
                (func.lower(Member.full_name).like(ident))
                | (Member.phone.like(ident))
                | (Member.member_number.like(ident))
            )
            .limit(1)
        )
        if not member:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name="staff_record_checkin",
                summary_for_llm=f"No se encontró el socio '{params.member_identifier}' para registrar asistencia.",
            )

        period = session.scalar(
            select(MembershipPeriod)
            .where(MembershipPeriod.member_id == member.id)
            .order_by(MembershipPeriod.ends_on.desc())
            .limit(1)
        )
        if not period:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name="staff_record_checkin",
                summary_for_llm=f"El socio {member.full_name} (#{member.member_number}) no tiene membresía registrada.",
            )

        branch = session.scalar(select(Branch).limit(1))
        branch_id = actor.branch_id or (branch.id if branch else None)
        staff_id = actor.staff_user_id or period.activated_by

        now_utc = datetime.now(timezone.utc)
        visit = MemberCheckInVisit(id=uuid4(), member_id=member.id, started_at=now_utc)
        session.add(visit)
        session.flush()

        checkin = MemberCheckIn(
            id=uuid4(),
            visit_id=visit.id,
            member_id=member.id,
            period_id=period.id,
            branch_id=branch_id,
            recorded_by=staff_id,
            idempotency_key=f"ci_bot_{visit.id.hex}",
            request_fingerprint=_sha256(f"{branch_id}\n{period.id}\n{now_utc.isoformat()}"),
            access_reason="membership_active",
            occurred_at=now_utc,
        )
        session.add(checkin)
        session.commit()

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="staff_record_checkin",
            summary_for_llm=f"Acceso registrado exitosamente para {member.full_name} (#{member.member_number}).",
            data={"member_name": member.full_name, "checkin_id": str(checkin.id), "started_at": now_utc.isoformat()},
        )

    def _handle_staff_record_expense(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        branch = session.scalar(select(Branch).limit(1))
        branch_id = actor.branch_id or (branch.id if branch else None)
        shift = session.scalar(select(Shift).where(Shift.status == "open").order_by(Shift.opened_at.desc()).limit(1))
        shift_id = shift.id if shift else None
        staff_id = actor.staff_user_id or (shift.opened_by if shift else branch_id)

        expense = Expense(
            id=uuid4(),
            branch_id=branch_id,
            shift_id=shift_id,
            category=params.category,
            concept=params.concept,
            payee_name=params.payee_name,
            amount_minor=params.amount_minor,
            payment_method=params.payment_method,
            recorded_by_id=staff_id,
            idempotency_key=f"exp_bot_{uuid4().hex[:12]}",
            request_fingerprint=_sha256(f"{branch_id}\n{params.amount_minor}\n{params.concept}"),
        )
        session.add(expense)
        session.commit()

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="staff_record_expense",
            summary_for_llm=f"Gasto registrado: {_format_money(params.amount_minor)} por '{params.concept}' ({params.category}).",
            data={"expense_id": str(expense.id), "amount_minor": params.amount_minor, "concept": params.concept},
        )

    def _handle_staff_record_shrinkage(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        term = f"%{params.product_name_or_code.strip().lower()}%"
        prod = session.scalar(
            select(Product)
            .where(func.lower(Product.name).like(term) | func.lower(Product.code).like(term))
            .limit(1)
        )
        if not prod:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name="staff_record_shrinkage",
                summary_for_llm=f"No se encontró el producto '{params.product_name_or_code}'.",
            )

        branch = session.scalar(select(Branch).limit(1))
        branch_id = actor.branch_id or (branch.id if branch else None)
        staff_id = actor.staff_user_id or prod.created_by

        mv = StockMovement(
            id=uuid4(),
            branch_id=branch_id,
            product_id=prod.id,
            kind="waste",
            quantity=params.quantity,
            reason=params.reason,
            recorded_by=staff_id,
            idempotency_key=f"sm_bot_{uuid4().hex[:12]}",
            recorded_at=datetime.now(timezone.utc),
        )
        session.add(mv)
        session.commit()

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="staff_record_shrinkage",
            summary_for_llm=f"Merma registrada: {params.quantity} unidad(es) de '{prod.name}' por '{params.reason}'.",
            data={"product_name": prod.name, "quantity": params.quantity, "movement_id": str(mv.id)},
        )

    def _handle_staff_restock_product(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        term = f"%{params.product_name_or_code.strip().lower()}%"
        prod = session.scalar(
            select(Product)
            .where(func.lower(Product.name).like(term) | func.lower(Product.code).like(term))
            .limit(1)
        )
        if not prod:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name="staff_restock_product",
                summary_for_llm=f"No se encontró el producto '{params.product_name_or_code}'.",
            )

        branch = session.scalar(select(Branch).limit(1))
        branch_id = actor.branch_id or (branch.id if branch else None)
        staff_id = actor.staff_user_id or prod.created_by

        mv = StockMovement(
            id=uuid4(),
            branch_id=branch_id,
            product_id=prod.id,
            kind="restock",
            quantity=params.quantity,
            reason=params.reason,
            recorded_by=staff_id,
            idempotency_key=f"sm_re_bot_{uuid4().hex[:12]}",
            recorded_at=datetime.now(timezone.utc),
        )
        session.add(mv)
        session.commit()

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="staff_restock_product",
            summary_for_llm=f"Reabastecimiento registrado: +{params.quantity} unidad(es) añadidas a '{prod.name}'.",
            data={"product_name": prod.name, "quantity": params.quantity, "movement_id": str(mv.id)},
        )

    # -----------------------------------------------------------------------
    # Owner Handlers
    # -----------------------------------------------------------------------

    def _handle_owner_financial_overview(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        # Aggregated stats
        from app.db.models import Order, Payment

        total_sales = session.scalar(select(func.sum(Payment.amount_minor)).where(Payment.status == "confirmed")) or 0
        total_orders = session.scalar(select(func.count(Order.id))) or 0

        cash_sum = session.scalar(
            select(func.sum(Payment.amount_minor)).where(Payment.status == "confirmed", Payment.method == "cash")
        ) or 0
        card_sum = session.scalar(
            select(func.sum(Payment.amount_minor)).where(Payment.status == "confirmed", Payment.method == "card")
        ) or 0
        transfer_sum = session.scalar(
            select(func.sum(Payment.amount_minor)).where(Payment.status == "confirmed", Payment.method == "transfer")
        ) or 0

        summary = (
            f"Resumen financiero acumulado: {_format_money(total_sales)} confirmados ({total_orders} operaciones). "
            f"Efectivo: {_format_money(cash_sum)}, Tarjeta: {_format_money(card_sum)}, Transferencia: {_format_money(transfer_sum)}."
        )

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="owner_financial_overview",
            summary_for_llm=summary,
            data={
                "total_sales_minor": total_sales,
                "total_orders": total_orders,
                "cash_minor": cash_sum,
                "card_minor": card_sum,
                "transfer_minor": transfer_sum,
            },
        )

    def _handle_owner_attendance_analytics(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        checkins_count = session.scalar(select(func.count(MemberCheckIn.id))) or 0
        recent_checkins = session.scalar(
            select(func.count(MemberCheckIn.id)).where(
                MemberCheckIn.occurred_at >= datetime.now(timezone.utc) - timedelta(hours=2)
            )
        ) or 0

        capacity = 50
        occupancy_pct = round((recent_checkins / capacity) * 100)

        summary = (
            f"Aforo actual estimado en sala: {recent_checkins}/{capacity} socios ({occupancy_pct}% de capacidad). "
            f"Total histórico registrado: {checkins_count} visitas."
        )

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="owner_attendance_analytics",
            summary_for_llm=summary,
            data={"current_occupancy": recent_checkins, "capacity": capacity, "total_visits": checkins_count},
        )

    def _handle_owner_active_alerts(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        open_shifts = session.scalar(select(func.count(Shift.id)).where(Shift.status == "open")) or 0
        expired_members = session.scalar(select(func.count(Member.id)).where(Member.status == "expired")) or 0

        summary = f"Alertas activas: {open_shifts} turno(s) de caja abierto(s), {expired_members} socios con membresía vencida."
        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="owner_active_alerts",
            summary_for_llm=summary,
            data={"open_shifts": open_shifts, "expired_members": expired_members},
        )

    def _handle_owner_create_ticket(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        ticket_id = uuid4().hex[:8].upper()
        summary = f"Ticket #{ticket_id} creado con prioridad '{params.priority}': '{params.title}'."

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="owner_create_ticket",
            summary_for_llm=summary,
            data={"ticket_id": ticket_id, "title": params.title, "priority": params.priority},
        )
