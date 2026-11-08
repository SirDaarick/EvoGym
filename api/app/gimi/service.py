"""Service layer for Gimi knowledge vault, WhatsApp metrics, and outbox delivery."""
from uuid import UUID

from sqlalchemy import func, select

from app.db.models.gimi import GimiKnowledgeChunk
from app.db.models.notifications import NotificationOutbox, WhatsappInboxMessage
from app.errors import HttpStatusError, session_factory
from app.gimi.rag.document_ingest import ingest_document
from app.gimi.rag.ingest import Rule, ingest_rules
from app.gimi.schemas import DeliverBatchInput, KnowledgeRuleInput
from app.notifications.delivery import NotConfiguredDeliveryAdapter, deliver_batch


def _require_admin(principal) -> None:
    if not getattr(principal, "organization_admin", False):
        raise HttpStatusError(403)


def get_gimi_overview(factory, principal) -> dict:
    _require_admin(principal)
    with session_factory(factory)() as session:
        inbound_total = session.scalar(select(func.count(WhatsappInboxMessage.id))) or 0
        outcomes_rows = session.execute(
            select(WhatsappInboxMessage.outcome, func.count(WhatsappInboxMessage.id)).group_by(WhatsappInboxMessage.outcome)
        ).all()
        outcome_counts = {str(k): int(v) for k, v in outcomes_rows}

        tools_rows = session.execute(
            select(WhatsappInboxMessage.tool, func.count(WhatsappInboxMessage.id))
            .where(WhatsappInboxMessage.tool.isnot(None))
            .group_by(WhatsappInboxMessage.tool)
        ).all()
        tool_counts = {str(k): int(v) for k, v in tools_rows}

        recent_inbound = session.scalars(
            select(WhatsappInboxMessage).order_by(WhatsappInboxMessage.received_at.desc()).limit(20)
        ).all()

        outbox_total = session.scalar(select(func.count(NotificationOutbox.id))) or 0
        outbox_rows = session.execute(
            select(NotificationOutbox.status, func.count(NotificationOutbox.id)).group_by(NotificationOutbox.status)
        ).all()
        outbox_status_counts = {str(k): int(v) for k, v in outbox_rows}

        knowledge_count = session.scalar(select(func.count(GimiKnowledgeChunk.id))) or 0

        answered = outcome_counts.get("answered", 0)
        autonomous_rate = round((answered / inbound_total) * 100) if inbound_total > 0 else 100

        return {
            "kpis": {
                "total_conversations": inbound_total,
                "whatsapp_count": inbound_total,
                "web_count": 0,
                "pending_alerts": outbox_status_counts.get("failed", 0) + outbox_status_counts.get("dead", 0),
                "autonomous_rate": autonomous_rate,
                "knowledge_chunks_count": knowledge_count,
            },
            "outcomes": outcome_counts,
            "intents": tool_counts,
            "outbox": {
                "total": outbox_total,
                "statuses": outbox_status_counts,
            },
            "recent_messages": [
                {
                    "id": str(msg.id),
                    "provider_message_id": msg.provider_message_id,
                    "message_type": msg.message_type,
                    "outcome": msg.outcome,
                    "tool": msg.tool,
                    "received_at": msg.received_at.isoformat() if msg.received_at else None,
                }
                for msg in recent_inbound
            ],
        }


def list_knowledge_chunks(factory, principal, source_kind: str | None = None) -> list[dict]:
    _require_admin(principal)
    with session_factory(factory)() as session:
        query = select(GimiKnowledgeChunk).order_by(GimiKnowledgeChunk.source_kind, GimiKnowledgeChunk.title)
        if source_kind:
            query = query.where(GimiKnowledgeChunk.source_kind == source_kind)
        chunks = session.scalars(query).all()
        return [
            {
                "id": str(c.id),
                "source_kind": c.source_kind,
                "source_ref": c.source_ref,
                "title": c.title,
                "content": c.content,
                "content_hash": c.content_hash,
                "embedding_model": c.embedding_model,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in chunks
        ]


def create_knowledge_rule(factory, principal, payload: KnowledgeRuleInput) -> dict:
    _require_admin(principal)
    with session_factory(factory)() as session:
        rule = Rule(
            ref=payload.ref,
            category=payload.category,
            title=payload.title,
            content=payload.content,
        )
        stats = ingest_rules(session, [rule])
        session.commit()
        return stats


def upload_knowledge_document(
    factory,
    principal,
    file_bytes: bytes,
    filename: str,
    category: str = "regulations",
    title: str | None = None,
) -> dict:
    _require_admin(principal)
    with session_factory(factory)() as session:
        result = ingest_document(
            session=session,
            file_bytes=file_bytes,
            filename=filename,
            category=category,
            title_override=title,
        )
        session.commit()
        return result


def delete_knowledge_chunk(factory, principal, chunk_id: UUID) -> dict:
    _require_admin(principal)
    with session_factory(factory)() as session:
        chunk = session.get(GimiKnowledgeChunk, chunk_id)
        if chunk is None:
            raise HttpStatusError(404)
        session.delete(chunk)
        session.commit()
        return {"ok": True}


def list_outbox_notifications(factory, principal, status: str | None = None, limit: int = 50) -> list[dict]:
    _require_admin(principal)
    with session_factory(factory)() as session:
        query = select(NotificationOutbox).order_by(NotificationOutbox.created_at.desc()).limit(limit)
        if status:
            query = query.where(NotificationOutbox.status == status)
        rows = session.scalars(query).all()
        return [
            {
                "id": str(row.id),
                "idempotency_key": row.idempotency_key,
                "channel": row.channel,
                "kind": row.kind,
                "recipient": row.recipient,
                "body": row.body,
                "status": row.status,
                "attempts": row.attempts,
                "max_attempts": row.max_attempts,
                "next_attempt_at": row.next_attempt_at.isoformat() if row.next_attempt_at else None,
                "sent_at": row.sent_at.isoformat() if row.sent_at else None,
                "provider_message_id": row.provider_message_id,
                "last_error": row.last_error,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]


def trigger_outbox_delivery(factory, principal, payload: DeliverBatchInput, adapter=None) -> dict:
    _require_admin(principal)
    # Never fake delivery: without a configured adapter rows stay pending.
    attempted = deliver_batch(factory, adapter or NotConfiguredDeliveryAdapter(), batch_size=payload.batch_size)
    return {"attempted": attempted}


def simulate_whatsapp_inbound(factory, principal, payload: "WhatsappSimulateInput", settings=None) -> "WhatsappSimulateResponse":
    _require_admin(principal)
    from uuid import uuid4
    from app.db.models import Member
    from app.gimi import whatsapp
    from app.gimi.schemas import WhatsappSimulateResponse

    clean_phone = whatsapp.normalize_e164(payload.phone)
    if not clean_phone:
        raise HttpStatusError(400, "Formato de teléfono inválido (debe ser E.164, ej. +525500005606)")

    sim_id = f"wamid.sim_{uuid4().hex[:12]}"
    raw_digits = clean_phone.replace("+", "")
    message_payload = {
        "id": sim_id,
        "from": raw_digits,
        "type": "text",
        "text": {"body": payload.message},
    }

    whatsapp._process(factory, message_payload, settings=settings)

    with session_factory(factory)() as session:
        inbox = session.scalar(
            select(WhatsappInboxMessage).where(WhatsappInboxMessage.provider_message_id == sim_id)
        )
        outbox = session.scalar(
            select(NotificationOutbox).where(NotificationOutbox.idempotency_key == f"wa-reply:{sim_id}")
        )
        member = session.get(Member, inbox.member_id) if inbox and inbox.member_id else None

        return WhatsappSimulateResponse(
            phone=clean_phone,
            message=payload.message,
            member_found=member is not None,
            member_name=member.full_name if member else None,
            member_number=member.member_number if member else None,
            outcome=inbox.outcome if inbox else "ignored",
            tool_called=inbox.tool if inbox else None,
            reply_text=outbox.body if outbox else "No se generó respuesta.",
            outbox_id=str(outbox.id) if outbox else None,
        )

