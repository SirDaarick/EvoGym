"""WhatsApp Cloud webhook logic: signature check over the raw body, inbox dedupe, exact member match, read-only reply.

No network calls: replies are enqueued into the notification outbox and delivered by the (fake/unconfigured) adapter.
"""
import hashlib
import hmac
import json
import re

from sqlalchemy import select
from uuid import uuid4

from app.db.models import Member
from app.db.models.notifications import WhatsappInboxMessage
from app.errors import HttpStatusError
from app.gimi import domain_tools
from app.gimi.permissions import ToolDenied
from app.notifications.outbox import enqueue, insert_ignore

GENERIC_UNVERIFIED = "No pudimos verificar tu número. Acércate a recepción para recibir ayuda."
HELP_TEXT = "Hola. Puedo ayudarte con: 'adeudo' (saldo pendiente) o 'membresía' (vigencia). Escribe una de las dos."
_E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")
_ID_OK = re.compile(r"^[A-Za-z0-9._=:+-]{1,128}$")


def normalize_e164(raw: object) -> str | None:
    """WhatsApp `from` ids are digits without '+'. Accept '+', spaces, dashes and parentheses; reject anything else."""
    if not isinstance(raw, str):
        return None
    cleaned = re.sub(r"[\s\-().]", "", raw)
    if not cleaned.startswith("+"):
        cleaned = "+" + cleaned
    return cleaned if _E164.match(cleaned) else None


def signature_valid(app_secret: str, raw_body: bytes, header: str | None) -> bool:
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256="):].strip().lower())


def verify_subscription(settings, mode, token, challenge) -> str:
    if not settings.whatsapp_webhook_configured:
        raise HttpStatusError(503)
    expected = settings.whatsapp_verify_token.get_secret_value()
    if mode != "subscribe" or not isinstance(token, str) or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HttpStatusError(403)
    if not challenge or len(challenge) > 256:
        raise HttpStatusError(400)
    return challenge


def match_member(session, e164: str) -> Member | None:
    """Exact match against the stored phone; unknown or ambiguous (more than one member) -> None."""
    rows = session.scalars(select(Member).where(Member.phone == e164).limit(2)).all()
    return rows[0] if len(rows) == 1 else None


def choose_tool(text: str | None) -> str | None:
    lowered = (text or "").lower()
    if any(word in lowered for word in ("adeudo", "debo", "saldo", "pendiente")):
        return "member_pending_balance"
    if any(word in lowered for word in ("membres", "vigen", "vence", "estatus")):
        return "member_membership_status"
    return None


def _messages(payload: object):
    if not isinstance(payload, dict):
        return
    for entry in payload.get("entry") or []:
        for change in (entry or {}).get("changes") or []:
            for message in ((change or {}).get("value") or {}).get("messages") or []:
                if isinstance(message, dict):
                    yield message


def _process(factory, message: dict) -> None:
    message_id = message.get("id")
    e164 = normalize_e164(message.get("from"))
    if not isinstance(message_id, str) or not _ID_OK.match(message_id) or e164 is None:
        return
    kind = str(message.get("type") or "unknown")[:24]
    sender_hash = hashlib.sha256(e164.encode()).hexdigest()
    with factory.begin() as session:
        inbox_id = uuid4()
        inserted = insert_ignore(session, WhatsappInboxMessage, dict(
            id=inbox_id, provider_message_id=message_id, sender_hash=sender_hash, message_type=kind,
            outcome="ignored"), "provider_message_id")
        if not inserted:
            return  # duplicate delivery of the same message id
        inbox = session.get(WhatsappInboxMessage, inbox_id)
        if kind != "text":
            return
        member = match_member(session, e164)
        tool, reply, outcome = None, GENERIC_UNVERIFIED, "unverified"
        if member is not None:
            outcome = "answered"
            tool = choose_tool(((message.get("text") or {}).get("body")) if isinstance(message.get("text"), dict) else None)
            try:
                reply = domain_tools.invoke(tool, session, member.id) if tool else HELP_TEXT
            except ToolDenied:
                reply, tool = HELP_TEXT, None
            inbox.member_id = member.id
        inbox.outcome, inbox.tool = outcome, tool
        inbox.reply_outbox_id = enqueue(
            session, idempotency_key=f"wa-reply:{message_id}", channel="whatsapp", kind="gimi_reply",
            recipient=e164, body=reply)


def handle_webhook(settings, factory, raw_body: bytes, signature_header: str | None) -> dict:
    """Authenticate the raw body first; only then parse. Always acknowledges 200 for authentic payloads."""
    if not settings.whatsapp_webhook_configured:
        raise HttpStatusError(503)
    if not signature_valid(settings.whatsapp_app_secret.get_secret_value(), raw_body, signature_header):
        raise HttpStatusError(401)
    if factory is None:
        raise HttpStatusError(503)
    try:
        payload = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError):
        raise HttpStatusError(400) from None
    for message in _messages(payload):
        _process(factory, message)
    return {"status": "ok"}
