"""Mercado Pago Point terminal integration (Decision D08) - Port and Adapters."""
from __future__ import annotations

import json
from typing import Any, Protocol
import urllib.error
import urllib.request
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from app.settings import Settings


class PointPaymentIntentDTO(BaseModel):
    """Normalized DTO representing a payment intent on a Point terminal."""

    model_config = ConfigDict(extra="ignore")

    id: str
    device_id: str
    amount_minor: int
    status: str  # 'OPEN' | 'ON_TERMINAL' | 'PROCESSING' | 'PROCESSED' | 'CANCELED' | 'ABANDONED'
    authorization_code: str | None = None
    card_brand: str | None = None
    last_four_digits: str | None = None


class PointTerminalClient(Protocol):
    """Port for Point terminal interactions."""

    def create_payment_intent(
        self, device_id: str, amount_minor: int, external_reference: str
    ) -> PointPaymentIntentDTO:
        """Create a payment intent on the specified device."""
        ...

    def get_payment_intent_status(
        self, device_id: str, payment_intent_id: str
    ) -> PointPaymentIntentDTO:
        """Retrieve the status and authorization details of a payment intent."""
        ...

    def cancel_payment_intent(
        self, device_id: str, payment_intent_id: str
    ) -> bool:
        """Cancel a pending payment intent on the device."""
        ...

    def get_account_info(self) -> dict[str, Any]:
        """Query authenticated user account info to verify access token validity."""
        ...

    def list_devices(self) -> list[dict[str, Any]]:
        """List Point terminals registered under the authenticated Mercado Pago account."""
        ...


class MockPointTerminalClient:
    """In-memory emulator of Mercado Pago Point terminal for dev and test environments."""

    def __init__(self, auto_process: bool = True) -> None:
        self._intents: dict[str, PointPaymentIntentDTO] = {}
        self.auto_process = auto_process

    def reset(self) -> None:
        """Clear all stored intents in the emulator."""
        self._intents.clear()

    def create_payment_intent(
        self, device_id: str, amount_minor: int, external_reference: str
    ) -> PointPaymentIntentDTO:
        intent_id = f"mock-intent-{uuid4().hex[:12]}"
        dto = PointPaymentIntentDTO(
            id=intent_id,
            device_id=device_id.strip(),
            amount_minor=amount_minor,
            status="ON_TERMINAL",
            authorization_code=None,
            card_brand=None,
            last_four_digits=None,
        )
        self._intents[intent_id] = dto
        return dto

    def get_payment_intent_status(
        self, device_id: str, payment_intent_id: str
    ) -> PointPaymentIntentDTO:
        dto = self._intents.get(payment_intent_id)
        if dto is None:
            raise ValueError(f"Payment intent {payment_intent_id} not found on mock terminal.")
        if dto.status == "ON_TERMINAL" and self.auto_process:
            # Simulate terminal payment authorization
            dto = PointPaymentIntentDTO(
                id=dto.id,
                device_id=dto.device_id,
                amount_minor=dto.amount_minor,
                status="PROCESSED",
                authorization_code="AUTH-841203",
                card_brand="VISA",
                last_four_digits="4242",
            )
            self._intents[payment_intent_id] = dto
        return dto

    def cancel_payment_intent(
        self, device_id: str, payment_intent_id: str
    ) -> bool:
        dto = self._intents.get(payment_intent_id)
        if dto is None:
            return False
        if dto.status != "PROCESSED":
            updated = PointPaymentIntentDTO(
                id=dto.id,
                device_id=dto.device_id,
                amount_minor=dto.amount_minor,
                status="CANCELED",
                authorization_code=None,
                card_brand=None,
                last_four_digits=None,
            )
            self._intents[payment_intent_id] = updated
            return True
        return False

    def get_account_info(self) -> dict[str, Any]:
        return {
            "id": 999999999,
            "nickname": "EVOGYM_MOCK_ACCOUNT",
            "email": "dev@evogym.internal",
            "site_id": "MLM",
        }

    def list_devices(self) -> list[dict[str, Any]]:
        return [
            {
                "id": "MOCK-POINT-DEVICE-01",
                "operating_mode": "PDV",
                "pos_id": 1001,
                "store_id": 2001,
                "external_pos_id": "caja-1",
            }
        ]


class MercadoPagoPointHttpClient:
    """Production HTTP adapter calling Mercado Pago Point Integration API."""

    def __init__(self, access_token: str, base_url: str = "https://api.mercadopago.com") -> None:
        self.access_token = access_token.strip()
        self.base_url = base_url.rstrip("/")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def create_payment_intent(
        self, device_id: str, amount_minor: int, external_reference: str
    ) -> PointPaymentIntentDTO:
        url = f"{self.base_url}/point/integration-api/devices/{device_id}/payment-intents"
        # In Mercado Pago Point API, amount is represented in major currency decimal units (e.g. 10.50)
        # or integer if exact. Here amount_minor / 100.0 is used.
        payload = {
            "amount": round(amount_minor / 100.0, 2),
            "additional_info": {
                "external_reference": external_reference,
                "print_on_terminal": True,
            },
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8")
            raise RuntimeError(f"Mercado Pago API error ({exc.code}): {err_body}") from exc

        return PointPaymentIntentDTO(
            id=str(result.get("id")),
            device_id=device_id,
            amount_minor=amount_minor,
            status=str(result.get("status", "OPEN")),
        )

    def get_payment_intent_status(
        self, device_id: str, payment_intent_id: str
    ) -> PointPaymentIntentDTO:
        url = f"{self.base_url}/point/integration-api/payment-intents/{payment_intent_id}"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8")
            raise RuntimeError(f"Mercado Pago API error ({exc.code}): {err_body}") from exc

        status = str(result.get("status", "OPEN"))
        payment_info = result.get("payment") or {}
        card_info = payment_info.get("card") or {}

        # Parse amount back to minor units
        raw_amount = result.get("amount") or 0
        amount_minor = round(float(raw_amount) * 100)

        return PointPaymentIntentDTO(
            id=str(result.get("id", payment_intent_id)),
            device_id=device_id,
            amount_minor=amount_minor,
            status=status,
            authorization_code=payment_info.get("authorization_code"),
            card_brand=card_info.get("brand"),
            last_four_digits=card_info.get("last_four_digits"),
        )

    def cancel_payment_intent(
        self, device_id: str, payment_intent_id: str
    ) -> bool:
        url = f"{self.base_url}/point/integration-api/devices/{device_id}/payment-intents/{payment_intent_id}"
        req = urllib.request.Request(url, headers=self._headers(), method="DELETE")
        try:
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                return resp.status in (200, 204)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return False
            err_body = exc.read().decode("utf-8")
            raise RuntimeError(f"Mercado Pago cancel error ({exc.code}): {err_body}") from exc

    def get_account_info(self) -> dict[str, Any]:
        """Query authenticated user account info to verify access token validity."""
        url = f"{self.base_url}/users/me"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8")
            raise RuntimeError(f"Mercado Pago authentication error ({exc.code}): {err_body}") from exc

    def list_devices(self) -> list[dict[str, Any]]:
        """List Point terminals registered under the authenticated Mercado Pago account."""
        url = f"{self.base_url}/point/integration-api/devices"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("devices", [])
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8")
            raise RuntimeError(f"Mercado Pago devices query error ({exc.code}): {err_body}") from exc


_global_mock_client: MockPointTerminalClient | None = None


def get_point_client(settings: Settings | None = None) -> PointTerminalClient:
    """Factory resolving the active Point terminal client."""
    global _global_mock_client
    if settings is not None and settings.mercado_pago_configured:
        token = settings.mercado_pago_access_token.get_secret_value()  # type: ignore[union-attr]
        return MercadoPagoPointHttpClient(access_token=token)
    if _global_mock_client is None:
        _global_mock_client = MockPointTerminalClient()
    return _global_mock_client


def get_mock_point_client() -> MockPointTerminalClient:
    """Helper for testing to inspect or mutate mock terminal state."""
    global _global_mock_client
    if _global_mock_client is None:
        _global_mock_client = MockPointTerminalClient()
    return _global_mock_client
