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

from pydantic import ValidationError
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
from app.db.models.catalog import Plan, PlanVersion
from app.db.models.expenses import Expense
from app.db.models.member_check_ins import MemberCheckInVisit
from app.db.models.notifications import NotificationOutbox
from app.gimi import domain_tools
from app.gimi.jev_router import JevRouteDecision
from app.gimi.rag.search import search as rag_search
from app.gimi.tool_definitions import (
    GimiRole,
    TOOL_REGISTRY,
    ToolKind,
    validate_tool_params,
)
from app.payments.checkout_pro import MercadoPagoCheckoutClient
from app.settings import get_settings


class DispatchStatus(str, Enum):
    SUCCESS = "success"
    AMBIGUOUS = "ambiguous"
    NEEDS_CONFIRMATION = "needs_confirmation"
    NEEDS_PARAMETERS = "needs_parameters"
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


def _format_money(minor: Any) -> str:
    cents = int(minor or 0)
    return f"${cents // 100:,}.{cents % 100:02d} MXN"


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
        except ValidationError as exc:
            missing_fields = [err["loc"][0] for err in exc.errors() if err.get("type") in ("missing", "value_error")]
            clarification_msg = self._build_parameter_clarification(tool.name, missing_fields)
            return DispatchResult(
                status=DispatchStatus.NEEDS_PARAMETERS,
                tool_name=tool.name,
                summary_for_llm=clarification_msg,
                data={"missing_fields": [str(f) for f in missing_fields], "raw_params": params_dict},
            )
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

    @staticmethod
    def _build_parameter_clarification(tool_name: str, missing_fields: list[Any]) -> str:
        fields_set = set(str(f) for f in missing_fields)
        if tool_name == "staff_record_expense":
            if "amount_minor" in fields_set and "concept" in fields_set:
                return "Para registrar el gasto necesito saber el monto (en pesos) y el concepto del gasto."
            if "amount_minor" in fields_set:
                return "¿De cuánto fue el gasto (monto en pesos) para poder registrarlo?"
            if "concept" in fields_set:
                return "¿Cuál es el concepto o motivo del gasto para registrarlo?"
        elif tool_name == "staff_record_shrinkage":
            return "Para reportar la merma necesito el nombre o código del producto y la cantidad de piezas dañadas o perdidas."
        elif tool_name == "staff_restock_product":
            return "Para registrar el reabastecimiento necesito el nombre del producto y cuántas unidades ingresaron."
        elif tool_name == "staff_record_checkin":
            return "Para registrar la entrada indica el nombre, número de socio o teléfono de la persona."
        elif tool_name == "owner_create_ticket":
            return "Para crear el ticket se requiere un título y una descripción del problema."
        return f"Faltan datos requeridos para completar la acción: {', '.join(str(f) for f in missing_fields)}."

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

    def _handle_member_request_human_support(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        ticket_code = uuid4().hex[:8].upper()
        reason = getattr(params, "reason", None) or "Atención personalizada solicitada en chat"

        if actor.member_id:
            member = session.get(Member, actor.member_id)
            member_desc = f"{member.full_name} (#{member.member_number}, tel: {member.phone})" if member else str(actor.member_id)
        else:
            member_desc = "Usuario o prospecto no registrado"

        outbox_entry = NotificationOutbox(
            id=uuid4(),
            idempotency_key=f"handoff_{ticket_code}",
            channel="whatsapp",
            kind="staff_human_handoff",
            recipient="reception_desk",
            body=f"SOLICITUD DE ATENCIÓN HUMANA (Ticket #{ticket_code})\nSocio: {member_desc}\nMotivo: {reason}",
            status="pending",
        )
        session.add(outbox_entry)
        session.flush()

        summary = (
            f"Solicitud transferida exitosamente al equipo de recepción (Ticket #{ticket_code}). "
            "Un recepcionista tomará el control de este chat a la brevedad para atenderte personalmente."
        )

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="member_request_human_support",
            summary_for_llm=summary,
            data={"ticket_code": ticket_code, "escalated": True, "reason": reason},
        )

    def _handle_member_generate_payment_link(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        if not actor.member_id:
            return DispatchResult(
                status=DispatchStatus.SUCCESS,
                tool_name="member_generate_payment_link",
                summary_for_llm=(
                    "Para generar tu link de pago seguro de renovación, por favor escribe desde el número de "
                    "WhatsApp registrado en tu membresía o acércate al mostrador de recepción."
                ),
                data={"link_generated": False},
            )

        member = session.get(Member, actor.member_id)
        if not member:
            return DispatchResult(
                status=DispatchStatus.EXECUTION_ERROR,
                tool_name="member_generate_payment_link",
                summary_for_llm="No se localizó el registro del socio en la base de datos.",
            )

        purpose = getattr(params, "purpose", "renewal")
        if purpose == "debt":
            from app.finance import queries as fq
            from app.rentals.payments import charge_collectable_minor, charges_for_rental

            branch_ids = [b.id for b in fq.active_branches(session)]
            total_debt = 0
            if branch_ids:
                total_debt += sum(p.amount_minor for p, _o, m in fq.pending_order_transfers(session, branch_ids) if m.id == actor.member_id)
                total_debt += sum(d.initial_outstanding_minor - paid for d, _o, m, paid in fq.open_debts(session, branch_ids) if m.id == actor.member_id)
                for rental, m in fq.billable_rentals(session, branch_ids):
                    if m.id == actor.member_id:
                        total_debt += sum(charge_collectable_minor(session, c) for c in charges_for_rental(session, rental.id))
                total_debt += sum(p.amount_minor for p, _r, m in fq.pending_rental_transfers(session, branch_ids) if m.id == actor.member_id)

            if total_debt <= 0:
                return DispatchResult(
                    status=DispatchStatus.SUCCESS,
                    tool_name="member_generate_payment_link",
                    summary_for_llm=f"Hola {member.full_name}, no tienes ningún saldo pendiente por liquidar. ¡Tu cuenta está al corriente!",
                    data={"total_debt_minor": 0},
                )
            amount_minor = total_debt
            item_title = f"Liquidación de saldo pendiente - {member.full_name}"
        else:
            # Renewal
            last_period = session.scalar(
                select(MembershipPeriod)
                .where(MembershipPeriod.member_id == member.id)
                .order_by(MembershipPeriod.ends_on.desc())
                .limit(1)
            )
            plan_ver = session.get(PlanVersion, last_period.plan_version_id) if last_period else None
            plan = session.get(Plan, plan_ver.plan_id) if plan_ver else None

            if plan and plan_ver:
                plan_name = plan.name
                amount_minor = plan_ver.price_minor
            else:
                default_pv = session.scalar(select(PlanVersion).where(PlanVersion.is_active == True).limit(1))
                plan_name = default_pv.name if default_pv else "Membresía Mensual"
                amount_minor = default_pv.price_minor if default_pv else 65000

            item_title = f"Renovación {plan_name} - {member.full_name}"

        settings = get_settings()
        token = settings.mercado_pago_access_token.get_secret_value() if settings.mercado_pago_access_token else None
        client = MercadoPagoCheckoutClient(access_token=token)
        ext_ref = f"renew_{member.id}_{uuid4().hex[:8]}"

        pref = client.create_preference(
            title=item_title,
            amount_minor=amount_minor,
            external_reference=ext_ref,
            payer_name=member.full_name,
        )

        summary = (
            f"Link de pago seguro de Mercado Pago generado por {_format_money(amount_minor)} para {item_title}. "
            f"Enlace de pago único (válido 24h): {pref.init_point}. "
            "Acepta tarjeta de crédito, débito y transferencia SPEI con conciliación y renovación automática."
        )

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="member_generate_payment_link",
            summary_for_llm=summary,
            data={
                "payment_url": pref.init_point,
                "amount_minor": amount_minor,
                "preference_id": pref.preference_id,
                "external_reference": ext_ref,
                "expires_at": pref.expires_at.isoformat(),
            },
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
        session.flush()

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
        session.flush()

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
        session.flush()

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
        session.flush()

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
        # Aggregated stats with optional date range
        from app.db.models import Order, Payment

        base_filter = [Payment.status == "confirmed"]
        date_label = "acumulado histórico"

        from_date = getattr(params, "from_date", None)
        to_date = getattr(params, "to_date", None)

        if from_date:
            start_dt = datetime.combine(from_date, time.min, tzinfo=timezone.utc)
            base_filter.append(Payment.received_at >= start_dt)
        if to_date:
            end_dt = datetime.combine(to_date, time.max, tzinfo=timezone.utc)
            base_filter.append(Payment.received_at <= end_dt)

        if from_date and to_date:
            if from_date == to_date:
                date_label = f"del {from_date.isoformat()}"
            else:
                date_label = f"del {from_date.isoformat()} al {to_date.isoformat()}"
        elif from_date:
            date_label = f"desde el {from_date.isoformat()}"
        elif to_date:
            date_label = f"hasta el {to_date.isoformat()}"

        total_sales = session.scalar(select(func.sum(Payment.amount_minor)).where(*base_filter)) or 0
        total_payments = session.scalar(select(func.count(Payment.id)).where(*base_filter)) or 0

        cash_sum = session.scalar(
            select(func.sum(Payment.amount_minor)).where(*base_filter, Payment.method == "cash")
        ) or 0
        card_sum = session.scalar(
            select(func.sum(Payment.amount_minor)).where(*base_filter, Payment.method == "card")
        ) or 0
        transfer_sum = session.scalar(
            select(func.sum(Payment.amount_minor)).where(*base_filter, Payment.method == "transfer")
        ) or 0

        summary = (
            f"Resumen financiero ({date_label}): {_format_money(total_sales)} confirmados ({total_payments} operaciones). "
            f"Efectivo: {_format_money(cash_sum)}, Tarjeta: {_format_money(card_sum)}, Transferencia: {_format_money(transfer_sum)}."
        )

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="owner_financial_overview",
            summary_for_llm=summary,
            data={
                "from_date": from_date.isoformat() if from_date else None,
                "to_date": to_date.isoformat() if to_date else None,
                "total_sales_minor": total_sales,
                "total_orders": total_payments,
                "cash_minor": cash_sum,
                "card_minor": card_sum,
                "transfer_minor": transfer_sum,
            },
        )

    def _handle_owner_attendance_analytics(self, session: Session, actor: GimiActor, params) -> DispatchResult:
        now_utc = datetime.now(timezone.utc)
        period = getattr(params, "period", "today")

        if period == "today":
            today_start = datetime.combine(now_utc.date(), time.min, tzinfo=timezone.utc)
            period_label = "hoy"
            period_filter = MemberCheckIn.occurred_at >= today_start
        elif period == "7d":
            period_label = "últimos 7 días"
            period_filter = MemberCheckIn.occurred_at >= (now_utc - timedelta(days=7))
        elif period == "30d":
            period_label = "últimos 30 días"
            period_filter = MemberCheckIn.occurred_at >= (now_utc - timedelta(days=30))
        else:
            period_label = "histórico"
            period_filter = True

        visits_in_period = session.scalar(select(func.count(MemberCheckIn.id)).where(period_filter)) or 0
        all_time_visits = session.scalar(select(func.count(MemberCheckIn.id))) or 0

        recent_checkins = session.scalar(
            select(func.count(MemberCheckIn.id)).where(
                MemberCheckIn.occurred_at >= now_utc - timedelta(hours=2)
            )
        ) or 0

        capacity = 50
        occupancy_pct = round((recent_checkins / capacity) * 100)

        summary = (
            f"Aforo actual en sala (últimas 2h): {recent_checkins}/{capacity} socios ({occupancy_pct}% de capacidad). "
            f"Visitas registradas ({period_label}): {visits_in_period}. Total histórico acumulado: {all_time_visits} visitas."
        )

        return DispatchResult(
            status=DispatchStatus.SUCCESS,
            tool_name="owner_attendance_analytics",
            summary_for_llm=summary,
            data={
                "period": period,
                "visits_in_period": visits_in_period,
                "current_occupancy": recent_checkins,
                "capacity": capacity,
                "total_visits": all_time_visits,
            },
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
