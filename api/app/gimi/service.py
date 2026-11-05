"""Service layer for Gimi knowledge vault, WhatsApp metrics, and outbox delivery."""
from uuid import UUID

from sqlalchemy import func, select

from app.db.models.gimi import GimiKnowledgeChunk
from app.db.models.notifications import NotificationOutbox, WhatsappInboxMessage
from app.errors import HttpStatusError, session_factory
from app.gimi.rag.document_ingest import ingest_document
from app.gimi.rag.ingest import Rule, ingest_rules
from app.gimi.schemas import DeliverBatchInput, KnowledgeRuleInput
from app.notifications.delivery import FakeDeliveryAdapter, NotConfiguredDeliveryAdapter, deliver_batch


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


def trigger_outbox_delivery(factory, principal, payload: DeliverBatchInput, settings=None) -> dict:
    _require_admin(principal)
    # If production and not configured, use NotConfiguredDeliveryAdapter; otherwise allow FakeDeliveryAdapter
    is_prod = getattr(settings, "environment", "development") == "production"
    adapter = NotConfiguredDeliveryAdapter() if is_prod else FakeDeliveryAdapter()
    attempted = deliver_batch(factory, adapter, batch_size=payload.batch_size)
    return {"attempted": attempted}
