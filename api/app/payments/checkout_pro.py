"""Mercado Pago Checkout Pro (Preferences API) integration for EvoGym.

Generates secure, unique, expiring payment links for membership renewals,
debt settlements, and online checkouts with auto-reconciliation webhooks.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import logging
import urllib.request
import urllib.error
from uuid import uuid4

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PaymentPreferenceDTO:
    preference_id: str
    init_point: str
    sandbox_init_point: str | None
    amount_minor: int
    external_reference: str
    expires_at: datetime


class MercadoPagoCheckoutClient:
    """Production client calling Mercado Pago Preferences API (Checkout Pro)."""

    def __init__(self, access_token: str | None = None, base_url: str = "https://api.mercadopago.com") -> None:
        self.access_token = (access_token or "").strip()
        self.base_url = base_url.rstrip("/")

    def create_preference(
        self,
        title: str,
        amount_minor: int,
        external_reference: str,
        payer_email: str | None = None,
        payer_name: str | None = None,
        expiration_hours: int = 24,
        webhook_url: str = "https://evogym.app/api/v1/payments/mercadopago/webhook",
    ) -> PaymentPreferenceDTO:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=expiration_hours)
        expiration_iso = expires_at.strftime("%Y-%m-%dT%H:%M:%S.000%z")

        # Fallback deterministic preview link when token is unconfigured (offline / demo / tests)
        if not self.access_token or self.access_token.startswith("mock_") or "fake" in self.access_token:
            pref_id = f"pref_mock_{uuid4().hex[:12]}"
            return PaymentPreferenceDTO(
                preference_id=pref_id,
                init_point=f"https://mpago.la/pos_{pref_id[:8]}",
                sandbox_init_point=f"https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id={pref_id}",
                amount_minor=amount_minor,
                external_reference=external_reference,
                expires_at=expires_at,
            )

        url = f"{self.base_url}/checkout/preferences"
        payload = {
            "items": [
                {
                    "title": title[:255],
                    "quantity": 1,
                    "currency_id": "MXN",
                    "unit_price": round(amount_minor / 100.0, 2),
                }
            ],
            "external_reference": external_reference,
            "expires": True,
            "expiration_date_to": expiration_iso,
            "back_urls": {
                "success": "https://evogym.app/payment/success",
                "pending": "https://evogym.app/payment/pending",
                "failure": "https://evogym.app/payment/failure",
            },
            "auto_return": "approved",
            "notification_url": webhook_url,
            "statement_descriptor": "EVOGYM",
        }

        if payer_email:
            payload["payer"] = {"email": payer_email}
            if payer_name:
                payload["payer"]["name"] = payer_name

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=12.0) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8")
            logger.error("Mercado Pago Preference API error %d: %s", exc.code, err_body)
            raise RuntimeError(f"Mercado Pago Preference API error ({exc.code}): {err_body}") from exc

        return PaymentPreferenceDTO(
            preference_id=str(result.get("id")),
            init_point=str(result.get("init_point")),
            sandbox_init_point=result.get("sandbox_init_point"),
            amount_minor=amount_minor,
            external_reference=external_reference,
            expires_at=expires_at,
        )
