"""Cosine-similarity search. PostgreSQL uses pgvector's `<=>` (HNSW-indexable); other dialects fall back to Python."""
import math
from dataclasses import dataclass

from sqlalchemy import Float, select

from app.db.models.gimi import GimiKnowledgeChunk
from app.gimi.rag.embeddings import EmbeddingProvider, get_default_provider


@dataclass(frozen=True)
class KnowledgeHit:
    source_kind: str
    source_ref: str
    title: str
    content: str
    score: float  # cosine similarity, 1.0 = identical direction


def _cosine(a: list[float], b: list[float]) -> float:
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(x * x for x in b))
    return 0.0 if na == 0 or nb == 0 else sum(x * y for x, y in zip(a, b)) / (na * nb)


def search(session, query: str, provider: EmbeddingProvider | None = None, *, limit: int = 3,
           source_kind: str | None = None) -> list[KnowledgeHit]:
    if not isinstance(query, str) or not query.strip():
        return []
    limit = max(1, min(int(limit), 10))
    provider = provider or get_default_provider()
    vector = provider.embed([query])[0]
    C = GimiKnowledgeChunk
    filters = [C.embedding_model == provider.model_name]
    if source_kind:
        filters.append(C.source_kind == source_kind)
    if session.get_bind().dialect.name == "postgresql":
        distance = C.embedding.op("<=>", return_type=Float)(vector)
        rows = session.execute(select(C, distance.label("d")).where(*filters).order_by(distance).limit(limit)).all()
        return [KnowledgeHit(c.source_kind, c.source_ref, c.title, c.content, 1.0 - float(d)) for c, d in rows]
    scored = [(_cosine(vector, c.embedding), c) for c in session.scalars(select(C).where(*filters))]
    scored.sort(key=lambda s: (-s[0], s[1].source_kind, s[1].source_ref))
    return [KnowledgeHit(c.source_kind, c.source_ref, c.title, c.content, s) for s, c in scored[:limit]]
