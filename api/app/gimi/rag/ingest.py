"""Chunking + idempotent ingestion of gym rules and published plans into `gimi_knowledge_chunks`."""
import hashlib
from dataclasses import dataclass

from sqlalchemy import select

from app.db.models import Plan
from app.db.models.gimi import GimiKnowledgeChunk
from app.gimi.rag import EMBEDDING_DIM
from app.gimi.rag.embeddings import EmbeddingProvider, get_default_provider

MAX_CHUNK_CHARS = 1200


@dataclass(frozen=True)
class Rule:
    """A gym rule/policy. `category` mirrors frontend `KnowledgeCategory`."""
    ref: str
    category: str
    title: str
    content: str


@dataclass(frozen=True)
class Chunk:
    source_kind: str
    source_ref: str
    title: str
    content: str

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(f"{self.title}\n{self.content}".encode()).hexdigest()


CATEGORIES = ("tariffs_promos", "schedules_classes", "regulations", "supplements_store")


def _split(text: str) -> list[str]:
    text = text.strip()
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    parts, current = [], ""
    for para in text.split("\n"):
        if current and len(current) + len(para) + 1 > MAX_CHUNK_CHARS:
            parts.append(current.strip())
            current = ""
        while len(para) > MAX_CHUNK_CHARS:
            parts.append(para[:MAX_CHUNK_CHARS])
            para = para[MAX_CHUNK_CHARS:]
        current += para + "\n"
    if current.strip():
        parts.append(current.strip())
    return parts


def rule_chunks(rules: list[Rule]) -> list[Chunk]:
    out = []
    for rule in rules:
        if rule.category not in CATEGORIES:
            raise ValueError(f"unknown rule category: {rule.category}")
        for part in _split(rule.content):
            out.append(Chunk("rule", f"{rule.category}/{rule.ref}", rule.title, part))
    return out


def _money(minor: int, currency: str) -> str:
    return f"${minor // 100:,}.{minor % 100:02d} {currency}"


def plan_chunks(session) -> list[Chunk]:
    """One chunk per active plan whose latest published version is active."""
    out = []
    plans = session.scalars(select(Plan).where(Plan.status == "active").order_by(Plan.code)).all()
    for plan in plans:
        version = plan.current_version
        if version is None or not version.is_active:
            continue
        lines = [f"Plan {version.name} ({plan.code}). Precio: {_money(version.price_minor, version.currency)}."]
        if version.entitlement_mode == "period":
            lines.append(f"Vigencia: {version.duration_value} {version.duration_unit}.")
        else:
            lines.append("Acceso de una sola entrada.")
        services = sorted(link.service.name for link in version.services if link.service)
        if services:
            lines.append("Incluye: " + ", ".join(services) + ".")
        if version.eligibility_type:
            lines.append(f"Elegibilidad: {version.eligibility_type}.")
        if version.restriction_notes:
            lines.append(f"Restricciones: {version.restriction_notes}")
        out.append(Chunk("plan", plan.code, version.name, "\n".join(lines)))
    return out


def _sync(session, kind: str, chunks: list[Chunk], provider: EmbeddingProvider) -> dict[str, int]:
    if provider.dimensions != EMBEDDING_DIM:
        raise ValueError(f"provider dimension {provider.dimensions} != column dimension {EMBEDDING_DIM}")
    existing = {(r.source_ref, r.content_hash): r
                for r in session.scalars(select(GimiKnowledgeChunk).where(GimiKnowledgeChunk.source_kind == kind))}
    wanted = {(c.source_ref, c.content_hash): c for c in chunks}
    stats = {"inserted": 0, "re_embedded": 0, "unchanged": 0, "deleted": 0}
    for key, row in existing.items():
        if key not in wanted:
            session.delete(row)
            stats["deleted"] += 1
    to_embed = []
    for key, chunk in wanted.items():
        row = existing.get(key)
        if row is None:
            to_embed.append((chunk, None))
        elif row.embedding_model != provider.model_name:
            to_embed.append((chunk, row))
        else:
            stats["unchanged"] += 1
    if to_embed:
        vectors = provider.embed([f"{c.title}\n{c.content}" for c, _ in to_embed])
        for (chunk, row), vector in zip(to_embed, vectors, strict=True):
            if row is None:
                session.add(GimiKnowledgeChunk(
                    source_kind=kind, source_ref=chunk.source_ref, title=chunk.title, content=chunk.content,
                    content_hash=chunk.content_hash, embedding_model=provider.model_name, embedding=vector))
                stats["inserted"] += 1
            else:
                row.embedding, row.embedding_model = vector, provider.model_name
                stats["re_embedded"] += 1
    session.flush()
    return stats


def ingest_rules(session, rules: list[Rule], provider: EmbeddingProvider | None = None) -> dict[str, int]:
    return _sync(session, "rule", rule_chunks(rules), provider or get_default_provider())


def ingest_plans(session, provider: EmbeddingProvider | None = None) -> dict[str, int]:
    return _sync(session, "plan", plan_chunks(session), provider or get_default_provider())
