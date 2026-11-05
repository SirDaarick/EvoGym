"""Jev Decision Model router integration for Gimi Assistant.

Uses TypeSafe AI's Jev (System 1 calibrated decision model) to route user messages
to the exact allowlisted tool based on the caller's role. Applies asymmetric
thresholds (Queries: 0.68 vs Commands: 0.85) and confidence delta margin checks.
"""
from dataclasses import dataclass
import os
from typing import Any
import httpx

from app.gimi.tool_definitions import GimiRole, TOOL_REGISTRY, ToolKind, get_jev_choices_for_role

DEFAULT_QUERY_THRESHOLD = 0.68
DEFAULT_COMMAND_THRESHOLD = 0.85
DEFAULT_MIN_DELTA = 0.15


@dataclass(frozen=True)
class JevRouteDecision:
    tool_name: str
    confidence: float
    is_ambiguous: bool
    required_threshold: float
    runner_up_name: str | None = None
    runner_up_confidence: float | None = None
    delta: float | None = None
    explanation: str | None = None


class JevRouter:
    """Client for routing user messages using Jev's System 1 Decision Model with asymmetric risk thresholds."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://api.typesafe.ai/v1",
        query_threshold: float = DEFAULT_QUERY_THRESHOLD,
        command_threshold: float = DEFAULT_COMMAND_THRESHOLD,
        min_delta: float = DEFAULT_MIN_DELTA,
    ) -> None:
        self.api_key = api_key or os.getenv("JEV_API_KEY")
        self.base_url = base_url.rstrip("/")
        self.query_threshold = query_threshold
        self.command_threshold = command_threshold
        self.min_delta = min_delta

    def get_threshold_for_tool(self, tool_name: str) -> float:
        """Asymmetric threshold: Commands (mutations) require 0.85, Queries (reads) require 0.68."""
        tool = TOOL_REGISTRY.get(tool_name)
        if tool and tool.kind == ToolKind.COMMAND:
            return self.command_threshold
        return self.query_threshold

    def route_intent(
        self,
        message: str,
        role: GimiRole,
    ) -> JevRouteDecision:
        """Route an incoming message to a registered tool for the specified role.

        If no JEV_API_KEY is configured in the environment, it uses a local
        deterministic classifier with calibrated scores so unit tests and offline environments work seamlessly.
        """
        choices = get_jev_choices_for_role(role)
        allowed_values = [c["value"] for c in choices]

        # 1. Live Jev API call when credentials exist
        if self.api_key:
            return self._call_jev_api(message, choices)

        # 2. Deterministic local evaluator (fallback / local dev)
        return self._local_evaluate(message, role, allowed_values)

    def _call_jev_api(
        self,
        message: str,
        choices: list[dict[str, str]],
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

            runner_up_name = answer.get("runner_up")
            runner_up_conf = float(answer.get("runner_up_confidence", 0.0)) if runner_up_name else None
            delta = (confidence - runner_up_conf) if runner_up_conf is not None else None

            required_thresh = self.get_threshold_for_tool(choice)
            is_below_thresh = confidence < required_thresh
            is_tie = (delta is not None and delta < self.min_delta)
            is_unrecognized = choice == "unrecognized_intent"

            return JevRouteDecision(
                tool_name=choice,
                confidence=confidence,
                is_ambiguous=(is_below_thresh or is_tie or is_unrecognized),
                required_threshold=required_thresh,
                runner_up_name=runner_up_name,
                runner_up_confidence=runner_up_conf,
                delta=delta,
                explanation=answer.get("explanation"),
            )
        except Exception:
            # On network or API failure, flag as ambiguous for graceful degradation
            return JevRouteDecision(
                tool_name="unrecognized_intent",
                confidence=0.0,
                is_ambiguous=True,
                required_threshold=self.query_threshold,
                explanation="Jev API unavailable or timed out.",
            )

    def _local_evaluate(
        self,
        message: str,
        role: GimiRole,
        allowed_values: list[str],
    ) -> JevRouteDecision:
        """Deterministic semantic matcher with asymmetric thresholds for dev/test environments."""
        text = message.lower().strip()

        # Check-in action (Staff / Owner) - Command
        if any(w in text for w in ("asistencia", "pase", "llegada", "check in", "checkin", "registra entrada")):
            choice = "staff_record_checkin"
            conf = 0.96 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Expense action (Staff / Owner) - Command
        if any(w in text for w in ("gasto", "compramos", "salida de dinero", "pago limpieza", "pague")):
            choice = "staff_record_expense"
            conf = 0.95 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Shrinkage action (Staff / Owner) - Command
        if any(w in text for w in ("merma", "caducado", "roto", "abierto", "se derramo", "tirar")):
            choice = "staff_record_shrinkage"
            conf = 0.93 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Restock action (Staff / Owner) - Command
        if any(w in text for w in ("surtir", "llegaron", "reabastecer", "nuevo stock", "añadir inventario")):
            choice = "staff_restock_product"
            conf = 0.91 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Financial Overview (Owner only) - Query
        if any(w in text for w in ("corte", "finanzas", "ingreso", "ingresos", "venta", "ventas", "vendio", "vendió", "vendimos", "cobro", "cobros", "facturacion", "resumen financiero", "ganancia", "cuanto dinero")):
            choice = "owner_financial_overview"
            conf = 0.94 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Attendance Analytics (Owner only) - Query
        if any(w in text for w in ("hora pico", "aforo", "ocupacion", "ocupación", "visita", "visitas", "asistencia", "afluencia", "gente", "personas en sala")):
            choice = "owner_attendance_analytics"
            conf = 0.92 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Alerts (Owner only) - Query
        if any(w in text for w in ("alerta", "alertas", "discrepancia", "discrepancias", "urgente", "pendientes criticos", "problemas")):
            choice = "owner_active_alerts"
            conf = 0.90 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Member Status (All roles) - Query (Calibrated around 0.72 - 0.95)
        if any(w in text for w in ("membresia", "vence", "vigencia", "mi plan", "cuando se me acaba")):
            choice = "member_membership_status"
            conf = 0.75 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Member Balance (All roles) - Query
        if any(w in text for w in ("debo", "saldo", "adeudo", "deuda", "cuanto debo")):
            choice = "member_pending_balance"
            conf = 0.78 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Member Locker (All roles) - Query
        if any(w in text for w in ("casillero", "locker", "mi candado")):
            choice = "member_locker_status"
            conf = 0.74 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # Gym FAQ / Rules (All roles) - Query
        if any(w in text for w in ("horario", "reglamento", "toalla", "precio", "cuanto cuesta", "costo", "clases")):
            choice = "gym_faq_and_rules"
            conf = 0.72 if choice in allowed_values else 0.0
            req_thresh = self.get_threshold_for_tool(choice)
            return JevRouteDecision(choice, conf, conf < req_thresh, req_thresh)

        # OpenRouter fallback classification if API key is present
        openrouter_key = os.getenv("OPENROUTER_API_KEY")
        if openrouter_key and allowed_values:
            or_choice = self._classify_with_openrouter(message, allowed_values, openrouter_key)
            if or_choice and or_choice in allowed_values and or_choice != "unrecognized_intent":
                req_thresh = self.get_threshold_for_tool(or_choice)
                return JevRouteDecision(
                    tool_name=or_choice,
                    confidence=0.88,
                    is_ambiguous=False,
                    required_threshold=req_thresh,
                    explanation="Classified via OpenRouter fallback model.",
                )

        # Low confidence fallback
        req_thresh = self.query_threshold
        return JevRouteDecision(
            tool_name="unrecognized_intent",
            confidence=0.35,
            is_ambiguous=True,
            required_threshold=req_thresh,
            explanation="No matching intent detected with high confidence.",
        )

    def _classify_with_openrouter(self, message: str, allowed_values: list[str], api_key: str) -> str | None:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://evogym.app",
            "X-Title": "EvoGym Jev Classifier",
            "Content-Type": "application/json",
        }
        prompt = (
            f"Classify the following user message for a gym management app into EXACTLY ONE of the allowed tools:\n"
            f"{allowed_values}\n\n"
            f"If it doesn't match any tool, respond with 'unrecognized_intent'.\n"
            f"Respond with ONLY the exact tool name, nothing else."
        )
        payload = {
            "model": "google/gemini-2.5-flash",
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": message},
            ],
            "temperature": 0.0,
            "max_tokens": 30,
        }
        try:
            with httpx.Client(timeout=3.0) as client:
                res = client.post("https://openrouter.ai/api/v1/chat/completions", json=payload, headers=headers)
                if res.status_code == 200:
                    tool = res.json()["choices"][0]["message"]["content"].strip().strip("\"'`")
                    if tool in allowed_values:
                        return tool
        except Exception:
            return None
        return None
