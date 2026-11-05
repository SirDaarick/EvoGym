"""Typed tool definitions and RBAC metadata for Gimi Assistant.

Provides strict Pydantic schemas for domain queries and commands, role-based
filtering for Jev router choice evaluation, and confirmation requirements.
"""
from datetime import date
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GimiRole(str, Enum):
    MEMBER = "member"
    STAFF = "staff"
    OWNER = "owner"


class ToolKind(str, Enum):
    QUERY = "query"        # Safe, read-only lookup
    COMMAND = "command"    # State mutation, potential side-effects


# ---------------------------------------------------------------------------
# Parameter Schemas for Queries and Commands
# ---------------------------------------------------------------------------

class MemberSelfStatusParams(BaseModel):
    """Scoped automatically to the authenticated member session or verified phone."""
    model_config = ConfigDict(extra="forbid")


class GymFaqRulesParams(BaseModel):
    """Semantic question regarding gym schedules, tariffs, promotions, or regulations."""
    query: str = Field(min_length=2, max_length=500, description="User question or topic to search in regulations.")


class StaffMemberLookupParams(BaseModel):
    """Search for a specific member profile, debt, or access history."""
    query: str = Field(min_length=1, max_length=160, description="Member full name, phone number or member number.")


class StaffInventoryStockParams(BaseModel):
    """Query current on-hand stock and low stock warnings."""
    product_query: str | None = Field(default=None, max_length=100, description="Optional product name or code filter.")


class StaffLockerStatusParams(BaseModel):
    """Query locker occupancy, rental status, or assignments."""
    locker_number: int | None = Field(default=None, ge=1, le=200, description="Specific locker number or None for overview.")


class RecordCheckInParams(BaseModel):
    """Register attendance check-in for an arriving member."""
    member_identifier: str = Field(min_length=1, max_length=160, description="Member number, phone, or name.")


class RecordExpenseParams(BaseModel):
    """Register an operating cash expense from current shift drawer."""
    amount_minor: int = Field(gt=0, description="Amount in minor units (cents, e.g. 5000 = $50.00 MXN).")
    concept: str = Field(min_length=3, max_length=255, description="Description of the expense.")
    category: str = Field(
        default="general",
        pattern="^(consumibles|limpieza|mantenimiento_piso|mantenimiento_peso|mantenimiento_cardio|mantenimiento_box|servicios|general)$",
        description="Allowed business expense category.",
    )
    payee_name: str = Field(default="Mostrador", min_length=2, max_length=160, description="Vendor or person paid.")
    payment_method: Literal["cash", "transfer", "card"] = Field(default="cash")


class RecordShrinkageParams(BaseModel):
    """Record damaged, expired or lost stock item (merma)."""
    product_name_or_code: str = Field(min_length=1, max_length=160, description="Product code or name.")
    quantity: int = Field(gt=0, description="Quantity to register as waste.")
    reason: str = Field(min_length=3, max_length=255, description="Explanation for the shrinkage.")


class RestockProductParams(BaseModel):
    """Add incoming inventory units to branch stock."""
    product_name_or_code: str = Field(min_length=1, max_length=160, description="Product code or name.")
    quantity: int = Field(gt=0, description="Quantity received.")
    reason: str = Field(default="Reabastecimiento regular", min_length=3, max_length=255)


class OwnerFinancialOverviewParams(BaseModel):
    """Query revenue, shifts, and cash reconciliation summary."""
    from_date: date | None = Field(default=None, description="Start date (inclusive, YYYY-MM-DD).")
    to_date: date | None = Field(default=None, description="End date (inclusive, YYYY-MM-DD).")


class OwnerAttendanceAnalyticsParams(BaseModel):
    """Query live occupancy, peak hours, and attendance trends."""
    period: Literal["today", "7d", "30d"] = Field(default="today", description="Time window for attendance aggregation.")


class OwnerActiveAlertsParams(BaseModel):
    """Query operational alerts (shift discrepancies, debt thresholds, stock shortages)."""
    severity: Literal["all", "high", "critical"] = Field(default="all")


class OwnerCreateTicketParams(BaseModel):
    """Create an operational or maintenance support ticket."""
    title: str = Field(min_length=4, max_length=160, description="Short summary of the issue.")
    description: str = Field(min_length=10, max_length=2000, description="Full details of the issue.")
    priority: Literal["low", "medium", "high", "urgent"] = Field(default="medium")


# ---------------------------------------------------------------------------
# Tool Definition Metadata
# ---------------------------------------------------------------------------

class ToolDefinition(BaseModel):
    name: str
    description: str
    kind: ToolKind
    allowed_roles: set[GimiRole]
    requires_confirmation: bool
    params_schema: type[BaseModel] | None = None


# ---------------------------------------------------------------------------
# Central Tool Registry
# ---------------------------------------------------------------------------

ALL_TOOLS: list[ToolDefinition] = [
    # --- MEMBER TOOLS ---
    ToolDefinition(
        name="member_membership_status",
        description="Consultar vigencia de membresía, fecha de corte y estatus de renovación del socio.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.MEMBER, GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=MemberSelfStatusParams,
    ),
    ToolDefinition(
        name="member_pending_balance",
        description="Consultar adeudos pendientes, transferencias por validar y saldo a favor del socio.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.MEMBER, GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=MemberSelfStatusParams,
    ),
    ToolDefinition(
        name="member_locker_status",
        description="Consultar asignación de casillero propio, fecha de vigencia de renta y número de locker.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.MEMBER, GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=MemberSelfStatusParams,
    ),
    ToolDefinition(
        name="gym_faq_and_rules",
        description="Responder dudas generales del gimnasio: precios, planes, promociones, horarios de clases y reglamento interno.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.MEMBER, GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=GymFaqRulesParams,
    ),

    # --- STAFF TOOLS ---
    ToolDefinition(
        name="staff_lookup_member",
        description="Buscar el expediente de un socio por nombre, teléfono o número para ver su estatus, deudas y notas.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=StaffMemberLookupParams,
    ),
    ToolDefinition(
        name="staff_inventory_stock",
        description="Consultar existencias de productos en piso, bebidas, suplementos y advertencias de stock bajo.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=StaffInventoryStockParams,
    ),
    ToolDefinition(
        name="staff_locker_overview",
        description="Consultar casilleros disponibles, asignados y casilleros por vencer.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=StaffLockerStatusParams,
    ),
    ToolDefinition(
        name="staff_record_checkin",
        description="Registrar la entrada / acceso de asistencia de un socio en recepción.",
        kind=ToolKind.COMMAND,
        allowed_roles={GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=False,  # High-frequency operational action
        params_schema=RecordCheckInParams,
    ),
    ToolDefinition(
        name="staff_record_expense",
        description="Registrar una salida de efectivo de caja por gastos de operación (limpieza, insumos, mantenimiento).",
        kind=ToolKind.COMMAND,
        allowed_roles={GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=True,   # Financial action: Draft & Confirm
        params_schema=RecordExpenseParams,
    ),
    ToolDefinition(
        name="staff_record_shrinkage",
        description="Registrar merma o pérdida de inventario por producto dañado, abierto o caducado.",
        kind=ToolKind.COMMAND,
        allowed_roles={GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=True,   # Stock impact: Draft & Confirm
        params_schema=RecordShrinkageParams,
    ),
    ToolDefinition(
        name="staff_restock_product",
        description="Registrar entrada de mercancía o reabastecimiento de productos al inventario.",
        kind=ToolKind.COMMAND,
        allowed_roles={GimiRole.STAFF, GimiRole.OWNER},
        requires_confirmation=True,   # Stock impact: Draft & Confirm
        params_schema=RestockProductParams,
    ),

    # --- OWNER TOOLS ---
    ToolDefinition(
        name="owner_financial_overview",
        description="Consultar el resumen ejecutivo del negocio: ingresos confirmados por método, cobros de mostrador y nómina.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=OwnerFinancialOverviewParams,
    ),
    ToolDefinition(
        name="owner_attendance_analytics",
        description="Consultar aforo en tiempo real, horas pico, horas valle y analítica de afluencia semanal o mensual.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=OwnerAttendanceAnalyticsParams,
    ),
    ToolDefinition(
        name="owner_active_alerts",
        description="Consultar alertas operativas abiertas, discrepancias de cortes de caja o socios en riesgo.",
        kind=ToolKind.QUERY,
        allowed_roles={GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=OwnerActiveAlertsParams,
    ),
    ToolDefinition(
        name="owner_create_ticket",
        description="Crear un ticket de soporte, mantenimiento o incidencia operativa para seguimiento.",
        kind=ToolKind.COMMAND,
        allowed_roles={GimiRole.OWNER},
        requires_confirmation=False,
        params_schema=OwnerCreateTicketParams,
    ),
]

TOOL_REGISTRY: dict[str, ToolDefinition] = {t.name: t for t in ALL_TOOLS}


# ---------------------------------------------------------------------------
# Router & RBAC Helpers
# ---------------------------------------------------------------------------

def get_tools_for_role(role: GimiRole) -> list[ToolDefinition]:
    """Return all tools accessible by the specified role."""
    return [t for t in ALL_TOOLS if role in t.allowed_roles]


def get_jev_choices_for_role(role: GimiRole) -> list[dict[str, str]]:
    """Format allowed tools as categorical choices for Jev Decision Model.

    Returns a list of options with exact tool keys and concise operational
    descriptions for Jev's System 1 calibrated classification.
    """
    tools = get_tools_for_role(role)
    choices = [
        {"value": t.name, "description": t.description}
        for t in tools
    ]
    # Always include a fallback option when the user intent is not a tool call
    choices.append({
        "value": "unrecognized_intent",
        "description": "El mensaje no corresponde a ninguna acción o consulta de gimnasio conocida.",
    })
    return choices


def validate_tool_params(tool_name: str, raw_params: dict) -> BaseModel:
    """Validate raw extracted parameters against the tool's registered Pydantic schema."""
    tool = TOOL_REGISTRY.get(tool_name)
    if not tool:
        raise ValueError(f"Unknown tool: '{tool_name}'")
    if not tool.params_schema:
        return BaseModel()
    return tool.params_schema.model_validate(raw_params)
