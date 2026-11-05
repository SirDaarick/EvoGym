"""Jev Decision Model router integration for Gimi Assistant.

Uses TypeSafe AI's Jev (System 1 calibrated decision model) to route user messages
to the exact allowlisted tool based on the caller's role.
"""
from dataclasses import dataclass
import os
from typing import Any
import httpx
from pydantic import BaseModel, Field

from app.gimi.tool_definitions import GimiRole, get_jev_choices_for_role


@dataclass(frozen=True)
class JevRouteDecision:
    tool_name: str
    confidence: float
    is_ambiguous: bool
    explanation: str | None = None


class JevRouter:
    """Client for routing user messages using Jev's System 1 Decision Model."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://api.typesafe.ai/v1",
        default_threshold: float = 0.85,
    ) -> None:
        self.api_key = api_key or os.getenv("JEV_API_KEY")
        self.base_url = base_url.rstrip("/")
        self.default_threshold = default_threshold

    def route_intent(
        self,
        message: str,
        role: GimiRole,
        threshold: float | None = None,
    ) -> JevRouteDecision:
        """Route an incoming message to a registered tool for the specified role.

        If no JEV_API_KEY is configured in the environment, it uses a local
        deterministic classifier so unit tests and offline environments work seamlessly.
        """
        active_threshold = threshold if threshold is not None else self.default_threshold
        choices = get_jev_choices_for_role(role)
        allowed_values = [c["value"] for c in choices]

        # 1. Live Jev API call when credentials exist
        if self.api_key:
            return self._call_jev_api(message, choices, active_threshold)

        # 2. Deterministic local evaluator (fallback / local dev)
        return self._local_evaluate(message, role, allowed_values, active_threshold)

    def _call_jev_api(
        self,
        message: str,
        choices: list[dict[str, str]],
        threshold: float,
    ) -> JevRouteDecision:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "state": message,
            "questions": {
                "intent": {
                    "type": "choice",
                    "options": choices,
                }
            },
        }

        try:
            with httpx.Client(timeout=3.0) as client:
                res = client.post(f"{self.base_url}/evaluate", json=payload, headers=headers)
                res.raise_for_status()
                data = res.json()

            answer = data.get("answers", {}).get("intent", {})
            choice = answer.get("choice", "unrecognized_intent")
            confidence = float(answer.get("confidence", 0.0))

            return JevRouteDecision(
                tool_name=choice,
                confidence=confidence,
                is_ambiguous=(confidence < threshold or choice == "unrecognized_intent"),
                explanation=answer.get("explanation"),
            )
        except Exception:
            # On network or API failure, flag as ambiguous for graceful degradation
            return JevRouteDecision(
                tool_name="unrecognized_intent",
                confidence=0.0,
                is_ambiguous=True,
                explanation="Jev API unavailable or timed out.",
            )

    def _local_evaluate(
        self,
        message: str,
        role: GimiRole,
        allowed_values: list[str],
        threshold: float,
    ) -> JevRouteDecision:
        """Deterministic semantic matcher for dev/test environments."""
        text = message.lower().strip()

        # Check-in action (Staff / Owner)
        if any(w in text for w in ("asistencia", "pase", "llegada", "check in", "checkin", "registra entrada")):
            choice = "staff_record_checkin"
            conf = 0.96 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Expense action (Staff / Owner)
        if any(w in text for w in ("gasto", "compramos", "salida de dinero", "pago limpieza", "pague")):
            choice = "staff_record_expense"
            conf = 0.95 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Shrinkage action (Staff / Owner)
        if any(w in text for w in ("merma", "caducado", "roto", "abierto", "se derramo", "tirar")):
            choice = "staff_record_shrinkage"
            conf = 0.93 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Restock action (Staff / Owner)
        if any(w in text for w in ("surtir", "llegaron", "reabastecer", "nuevo stock", "añadir inventario")):
            choice = "staff_restock_product"
            conf = 0.91 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Financial Overview (Owner only)
        if any(w in text for w in ("corte", "finanzas", "ingresos", "ventas del mes", "resumen financiero")):
            choice = "owner_financial_overview"
            conf = 0.94 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Attendance Analytics (Owner only)
        if any(w in text for w in ("hora pico", "aforo", "ocupacion", "visitas del mes", "afluencia")):
            choice = "owner_attendance_analytics"
            conf = 0.92 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Alerts (Owner only)
        if any(w in text for w in ("alertas", "discrepancias", "pendientes criticos")):
            choice = "owner_active_alerts"
            conf = 0.90 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Member Status (All roles)
        if any(w in text for w in ("membresia", "vence", "vigencia", "mi plan", "cuando se me acaba")):
            choice = "member_membership_status"
            conf = 0.95 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Member Balance (All roles)
        if any(w in text for w in ("debo", "saldo", "adeudo", "deuda", "cuanto debo")):
            choice = "member_pending_balance"
            conf = 0.95 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Member Locker (All roles)
        if any(w in text for w in ("casillero", "locker", "mi candado")):
            choice = "member_locker_status"
            conf = 0.92 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Gym FAQ / Rules (All roles)
        if any(w in text for w in ("horario", "reglamento", "toalla", "precio", "cuanto cuesta", "costo", "clases")):
            choice = "gym_faq_and_rules"
            conf = 0.88 if choice in allowed_values else 0.0
            return JevRouteDecision(choice, conf, conf < threshold)

        # Low confidence fallback
        return JevRouteDecision(
            tool_name="unrecognized_intent",
            confidence=0.35,
            is_ambiguous=True,
            explanation="No matching intent detected with high confidence.",
        )
