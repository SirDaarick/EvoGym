"""Opt-in: needs EVOGYM_TEST_POSTGRES_URL pointing at a disposable loopback PostgreSQL WITH the pgvector extension
available (e.g. `pgvector/pgvector:pg16`)."""
import os
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.gimi.rag import EMBEDDING_DIM
from app.gimi.rag.ingest import Rule, ingest_rules
from app.gimi.rag.search import search

API_DIR = os.path.dirname(os.path.dirname(__file__))
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


@pytest.fixture
def pg(monkeypatch):
    configured = os.getenv("EVOGYM_TEST_POSTGRES_URL")
    if not configured:
        pytest.skip("Set EVOGYM_TEST_POSTGRES_URL to a disposable local PostgreSQL instance with pgvector.")
    base = make_url(configured)
    if not base.drivername.startswith("postgresql+") or base.host not in LOOPBACK_HOSTS:
        pytest.fail("PostgreSQL tests require a loopback-only disposable target.")
    schema = f"rag_proof_{uuid4().hex}"
    admin = create_engine(base)
    try:
        with admin.begin() as c:
            c.execute(text(f'CREATE SCHEMA "{schema}"'))
        url = base.update_query_dict({"options": f"-csearch_path={schema},public"})
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", url.render_as_string(hide_password=False))
        yield url, schema
    finally:
        with admin.begin() as c:
            c.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()


def test_pgvector_extension_hnsw_index_and_ann_query(pg):
    url, schema = pg
    command.upgrade(Config(os.path.join(API_DIR, "alembic.ini")), "head")
    engine = create_engine(url)
    try:
        with engine.connect() as c:
            assert c.execute(text("select 1 from pg_extension where extname='vector'")).first()
            col = c.execute(text(
                "select format_type(a.atttypid, a.atttypmod) from pg_attribute a "
                "where a.attrelid = to_regclass('gimi_knowledge_chunks') and a.attname='embedding'")).scalar_one()
            assert col == f"vector({EMBEDDING_DIM})"
            idx = c.execute(text(
                "select indexdef from pg_indexes where tablename='gimi_knowledge_chunks' "
                "and indexname='ix_gimi_knowledge_chunks_embedding_hnsw'")).scalar_one()
            assert "hnsw" in idx and "vector_cosine_ops" in idx
        rules = [Rule("toalla", "regulations", "Uso de toalla", "Es obligatorio usar toalla en las maquinas."),
                 Rule("horario", "schedules_classes", "Horario", "Abrimos de lunes a viernes de 6 a 22 horas."),
                 Rule("proteina", "supplements_store", "Suplementos", "Vendemos proteina y creatina.")]
        with sessionmaker(engine).begin() as s:
            assert ingest_rules(s, rules)["inserted"] == 3
            assert ingest_rules(s, rules)["unchanged"] == 3
        with sessionmaker(engine).begin() as s:
            hits = search(s, "a que horas abren de lunes a viernes", limit=3)
            assert hits[0].source_ref == "schedules_classes/horario"
            assert [h.score for h in hits] == sorted((h.score for h in hits), reverse=True)
            # force the planner onto the HNSW index to prove the operator class matches the query operator
            s.execute(text("set local enable_seqscan = off"))
            plan = "\n".join(r[0] for r in s.execute(text(
                "explain select id from gimi_knowledge_chunks order by embedding <=> "
                f"'[{','.join(['0.1'] * EMBEDDING_DIM)}]'::vector limit 2")))
            assert "ix_gimi_knowledge_chunks_embedding_hnsw" in plan
        command.downgrade(Config(os.path.join(API_DIR, "alembic.ini")), "0055_notification_outbox")
        with engine.connect() as c:
            assert c.execute(text("select to_regclass('gimi_knowledge_chunks')")).scalar_one() is None
    finally:
        engine.dispose()
