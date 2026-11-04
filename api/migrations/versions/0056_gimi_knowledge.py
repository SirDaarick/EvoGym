"""Gimi RAG knowledge chunks (pgvector on PostgreSQL, JSON text on SQLite).

EMBEDDING_DIM (64) is frozen here on purpose. Changing embedding model/dimension needs a NEW migration that
alters the column, a re-embed (`app.gimi.rag.ingest` re-embeds when `embedding_model` changes) and an index rebuild.
Downgrade keeps the `vector` extension installed (it may be shared); chunks are derived data and are dropped.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.types import UserDefinedType

revision = "0056_gimi_knowledge"
down_revision = "0055_notification_outbox"
branch_labels = None
depends_on = None

EMBEDDING_DIM = 64
HNSW_INDEX = "ix_gimi_knowledge_chunks_embedding_hnsw"


class _Vector(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kw) -> str:
        return f"vector({EMBEDDING_DIM})"


def upgrade() -> None:
    postgres = op.get_bind().dialect.name == "postgresql"
    if postgres:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "gimi_knowledge_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("source_ref", sa.String(160), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("embedding_model", sa.String(64), nullable=False),
        sa.Column("embedding", _Vector() if postgres else sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("source_kind IN ('rule', 'plan')", name="ck_gimi_knowledge_source_kind"),
        sa.UniqueConstraint("source_kind", "source_ref", "content_hash", name="uq_gimi_knowledge_source_hash"),
    )
    op.create_index("ix_gimi_knowledge_source", "gimi_knowledge_chunks", ["source_kind", "source_ref"])
    if postgres:
        op.execute(
            f"CREATE INDEX {HNSW_INDEX} ON gimi_knowledge_chunks USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(f"DROP INDEX IF EXISTS {HNSW_INDEX}")
    op.drop_index("ix_gimi_knowledge_source", table_name="gimi_knowledge_chunks")
    op.drop_table("gimi_knowledge_chunks")
