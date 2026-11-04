"""Gimi RAG knowledge chunks. `embedding` is `vector(N)` on PostgreSQL (pgvector) and JSON text elsewhere."""
import json
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint, DateTime, Index, String, Text, UniqueConstraint, Uuid, cast, func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator, UserDefinedType

from app.db.base import Base
from app.gimi.rag import EMBEDDING_DIM


def _to_literal(value) -> str | None:
    return None if value is None else "[" + ",".join(repr(float(v)) for v in value) + "]"


class _PgVector(UserDefinedType):
    cache_ok = True

    def __init__(self, dim: int):
        self.dim = dim

    def get_col_spec(self, **kw) -> str:
        return f"vector({self.dim})"

    def bind_processor(self, dialect):
        return _to_literal

    def bind_expression(self, bindvalue):
        return cast(bindvalue, self)

    def column_expression(self, col):
        return cast(col, Text)

    def result_processor(self, dialect, coltype):
        return lambda v: None if v is None else json.loads(v)


class Embedding(TypeDecorator):
    """list[float] <-> `vector(N)` (PostgreSQL) or JSON text (SQLite). No `pgvector` Python package required."""

    impl = Text
    cache_ok = True

    def __init__(self, dim: int = EMBEDDING_DIM):
        super().__init__()
        self.dim = dim

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(_PgVector(self.dim))
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect):
        if dialect.name == "postgresql":
            return value  # _PgVector renders the literal
        return None if value is None else json.dumps([float(v) for v in value])

    def process_result_value(self, value, dialect):
        if dialect.name == "postgresql":
            return value
        return None if value is None else json.loads(value)


class GimiKnowledgeChunk(Base):
    __tablename__ = "gimi_knowledge_chunks"
    __table_args__ = (
        CheckConstraint("source_kind IN ('rule', 'plan')", name="ck_gimi_knowledge_source_kind"),
        UniqueConstraint("source_kind", "source_ref", "content_hash", name="uq_gimi_knowledge_source_hash"),
        Index("ix_gimi_knowledge_source", "source_kind", "source_ref"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    source_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Embedding(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
