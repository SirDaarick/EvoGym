"""Conversational Chat Orchestrator for Gimi Assistant.

Orchestrates the entire lifecycle:
1. Jev Decision Routing (System 1 fast classification)
2. Domain Dispatcher Execution (RBAC, Draft & Confirm, Domain Services)
3. OpenRouter Generative Synthesis (Warm, natural presentation to user)
"""
from dataclasses import dataclass, field
import os
import re
from typing import Any
import httpx
from sqlalchemy.orm import Session

from app.gimi.dispatcher import DispatchResult, DispatchStatus, GimiActor, GimiDispatcher
from app.gimi.jev_router import JevRouteDecision, JevRouter
from app.gimi.tool_definitions import GimiRole
from app.settings import Settings, get_settings

SYSTEM_PROMPT = """Eres Gimi, el asistente inteligente oficial de EvoGym.
Tu personalidad es profesional, cálida, concisa y orientada a la solución.
No inventes información, precios ni operaciones: básate estrictamente en el contexto y los datos verificados del sistema que recibas.
Responde de forma concisa en español neutral."""


@dataclass
class GimiOrchestratorResponse:
    reply_text: str
    tool_called: str
    status: DispatchStatus
    confidence: float
    needs_confirmation: bool = False
    draft_action: dict[str, Any] | None = None
    data: dict[str, Any] = field(default_factory=dict)


class GimiOrchestrator:
    """End-to-end conversational agent coordinating Jev routing, Domain Dispatch, and OpenRouter LLM."""

    def __init__(
        self,
        router: JevRouter | None = None,
        dispatcher: GimiDispatcher | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.router = router or JevRouter(api_key=os.getenv("JEV_API_KEY"))
        self.dispatcher = dispatcher or GimiDispatcher()

    def _extract_parameters(self, tool_name: str, text: str) -> dict[str, Any]:
        """Extract structured parameters from natural language for common command tools."""
        params: dict[str, Any] = {}
        if tool_name == "staff_record_expense":
            # Match numeric amount
            amt_match = re.search(r"\b(\d+)\s*(?:pesos|mxn|\$)?\b", text, re.IGNORECASE)
            params["amount_minor"] = (int(amt_match.group(1)) * 100) if amt_match else 10000

            # Match category
            categories = ("consumibles", "limpieza", "mantenimiento_piso", "mantenimiento_peso", "mantenimiento_cardio", "mantenimiento_box", "servicios", "general")
            found_cat = "general"
            for cat in categories:
                if cat in text.lower():
                    found_cat = cat
                    break
            params["category"] = found_cat
            params["concept"] = text[:100]

        elif tool_name == "staff_record_checkin":
            match = re.search(r"\b(?:socio|numero|entrada a|para)\s+([A-Za-z0-9\s]+)", text, re.IGNORECASE)
            params["member_identifier"] = match.group(1).strip() if match else text.strip()

        elif tool_name in ("staff_record_shrinkage", "staff_restock_product"):
            qty_match = re.search(r"\b(\d+)\s*(?:unidades|piezas|pzas|botes)?\b", text, re.IGNORECASE)
            params["quantity"] = int(qty_match.group(1)) if qty_match else 1
            params["product_name_or_code"] = text[:80]
            params["reason"] = "Merma por bot" if tool_name == "staff_record_shrinkage" else "Reabastecimiento"

        elif tool_name == "gym_faq_and_rules":
            params["query"] = text

        return params

    def _resolve_openrouter_key(self) -> str | None:
        if self.settings.openrouter_api_key:
            return self.settings.openrouter_api_key.get_secret_value()
        return os.getenv("OPENROUTER_API_KEY")

    def interact(
        self,
        session: Session,
        actor: GimiActor,
        message: str,
        confirmed: bool = False,
        cached_draft: dict[str, Any] | None = None,
        cached_tool: str | None = None,
    ) -> GimiOrchestratorResponse:
        clean_text = message.strip()
        lowered = clean_text.lower()

        # Check for explicit confirmation of a prior draft
        affirmative_words = ("si", "sí", "confirmo", "adelante", "proceder", "dale", "ok", "correcto", "de acuerdo")
        is_confirming = confirmed or (
            cached_draft is not None and any(word in lowered for word in affirmative_words)
        )

        # 1. Jev Routing (or resume cached tool if confirming)
        if is_confirming and cached_tool:
            decision = JevRouteDecision(
                tool_name=cached_tool,
                confidence=1.0,
                is_ambiguous=False,
                required_threshold=0.85,
            )
            raw_params = cached_draft or {}
        else:
            decision = self.router.route_intent(clean_text, role=actor.role)
            raw_params = self._extract_parameters(decision.tool_name, clean_text)

        # 2. Execution Dispatcher
        dispatch_res = self.dispatcher.dispatch(
            session=session,
            decision=decision,
            actor=actor,
            raw_params=raw_params,
            confirmed=is_confirming,
        )

        # 3. Conversational Synthesis via OpenRouter
        reply_text = self._synthesize_response(clean_text, decision, dispatch_res)

        return GimiOrchestratorResponse(
            reply_text=reply_text,
            tool_called=dispatch_res.tool_name,
            status=dispatch_res.status,
            confidence=decision.confidence,
            needs_confirmation=(dispatch_res.status == DispatchStatus.NEEDS_CONFIRMATION),
            draft_action=dispatch_res.draft_action,
            data=dispatch_res.data,
        )

    def _synthesize_response(
        self,
        user_message: str,
        decision: JevRouteDecision,
        dispatch_res: DispatchResult,
    ) -> str:
        api_key = self._resolve_openrouter_key()

        # Deterministic fallback when no API key is configured or offline
        if not api_key:
            if dispatch_res.status == DispatchStatus.AMBIGUOUS:
                return (
                    "No logré identificar con claridad tu solicitud. ¿Podrías indicarme si deseas consultar tu "
                    "membresía, revisar adeudos, o consultar el reglamento de EvoGym?"
                )
            if dispatch_res.status == DispatchStatus.NEEDS_CONFIRMATION:
                return f"{dispatch_res.summary_for_llm} ¿Deseas proceder? (Responde Sí para confirmar)."
            return dispatch_res.summary_for_llm

        # Call OpenRouter LLM for natural, formatted response
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Mensaje del usuario: \"{user_message}\"\n\n"
                    f"Estatus del sistema: {dispatch_res.status.value}\n"
                    f"Herramienta ejecutada: {dispatch_res.tool_name}\n"
                    f"Resumen verificado del sistema:\n{dispatch_res.summary_for_llm}\n\n"
                    "Redacta una respuesta natural, profesional y concisa dirigida al usuario respondiendo exactamente "
                    "a su mensaje a partir del resumen verificado."
                ),
            },
        ]

        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://evogym.app",
            "X-Title": "EvoGym Gimi Assistant",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.openrouter_chat_model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 400,
        }

        try:
            with httpx.Client(timeout=6.0) as client:
                res = client.post(
                    f"{self.settings.openrouter_base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )
                res.raise_for_status()
                data = res.json()
                content = data["choices"][0]["message"]["content"]
                return content.strip()
        except Exception:
            # Graceful degradation on network/API failure
            return dispatch_res.summary_for_llm
