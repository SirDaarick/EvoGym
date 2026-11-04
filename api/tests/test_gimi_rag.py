import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import Plan, PlanVersion, PlanVersionService, Service
from app.db.models.gimi import GimiKnowledgeChunk
from app.gimi import domain_tools
from app.gimi.permissions import ALLOWED_TOOLS, ToolDenied, authorize_tool
from app.gimi.rag import EMBEDDING_DIM
from app.gimi.rag.embeddings import FakeEmbeddingProvider
from app.gimi.rag.ingest import Rule, ingest_plans, ingest_rules, rule_chunks
from app.gimi.rag.search import search

API_DIR = Path(__file__).resolve().parents[1]

RULES = [
    Rule("toalla", "regulations", "Uso de toalla", "Es obligatorio usar toalla en las maquinas de pesas."),
    Rule("horario", "schedules_classes", "Horario del gimnasio", "Abrimos de lunes a viernes de 6 a 22 horas."),
    Rule("proteina", "supplements_store", "Suplementos", "Vendemos proteina y creatina en recepcion."),
]


class OtherModel(FakeEmbeddingProvider):
    model_name = "fake-other-v2"


@pytest.fixture
def factory(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'rag.db').as_posix()}")
    Base.metadata.create_all(engine)
    yield sessionmaker(engine)
    engine.dispose()


def _make_plan(session, code="gym_month", name="Gym Mensual", price=65000, active=True, notes=None):
    plan = Plan(code=code, name=name, kind="membership", status="active")
    session.add(plan)
    session.flush()
    service = Service(code=f"svc_{code}", name="Acceso a pesas", status="active")
    session.add(service)
    session.flush()
    version = PlanVersion(plan_id=plan.id, version_number=1, name=name, price_minor=price, currency="MXN",
                          duration_value=1, duration_unit="month", entitlement_mode="period",
                          is_active=active, restriction_notes=notes)
    session.add(version)
    session.flush()
    session.add(PlanVersionService(plan_version_id=version.id, service_id=service.id))
    session.flush()
    session.expire(plan)
    return plan


def test_fake_provider_is_deterministic_unit_and_offline():
    p = FakeEmbeddingProvider()
    a, b = p.embed(["Hola mundo"])[0], p.embed(["hola  MUNDO"])[0]
    assert a == b and len(a) == EMBEDDING_DIM
    assert abs(sum(x * x for x in a) - 1.0) < 1e-9
    assert abs(sum(x * x for x in p.embed([""])[0]) - 1.0) < 1e-9


def test_rule_ingest_is_idempotent_and_syncs_changes(factory):
    with factory.begin() as s:
        assert ingest_rules(s, RULES) == {"inserted": 3, "re_embedded": 0, "unchanged": 0, "deleted": 0}
    with factory.begin() as s:
        assert ingest_rules(s, RULES) == {"inserted": 0, "re_embedded": 0, "unchanged": 3, "deleted": 0}
    changed = [Rule("toalla", "regulations", "Uso de toalla", "Toalla obligatoria siempre."), *RULES[1:2]]
    with factory.begin() as s:
        assert ingest_rules(s, changed) == {"inserted": 1, "re_embedded": 0, "unchanged": 1, "deleted": 2}
        assert s.scalar(select(text("count(*)")).select_from(GimiKnowledgeChunk)) == 2


def test_reembeds_when_model_changes_without_new_rows(factory):
    with factory.begin() as s:
        ingest_rules(s, RULES)
    with factory.begin() as s:
        stats = ingest_rules(s, RULES, OtherModel())
        assert stats["re_embedded"] == 3 and stats["inserted"] == 0
        assert {c.embedding_model for c in s.scalars(select(GimiKnowledgeChunk))} == {"fake-other-v2"}


def test_long_rule_is_split_and_unknown_category_rejected():
    long = Rule("x", "regulations", "Largo", "\n".join(f"Linea numero {i} " + "a" * 100 for i in range(40)))
    assert len(rule_chunks([long])) > 1
    with pytest.raises(ValueError):
        rule_chunks([Rule("x", "nope", "t", "c")])


def test_dimension_mismatch_rejected(factory):
    class Wrong(FakeEmbeddingProvider):
        dimensions = 8
    with factory.begin() as s, pytest.raises(ValueError):
        ingest_rules(s, RULES, Wrong())


def test_plan_ingest_uses_published_active_plans_only(factory):
    with factory.begin() as s:
        _make_plan(s, notes="Solo mayores de 15 anos")
        _make_plan(s, code="old", name="Plan viejo", active=False)
        assert ingest_plans(s)["inserted"] == 1
        chunk = s.scalars(select(GimiKnowledgeChunk)).one()
        assert chunk.source_kind == "plan" and chunk.source_ref == "gym_month"
        assert "$650.00 MXN" in chunk.content and "Acceso a pesas" in chunk.content and "mayores de 15" in chunk.content
    with factory.begin() as s:
        assert ingest_plans(s)["unchanged"] == 1


def test_search_orders_by_cosine_and_filters(factory):
    with factory.begin() as s:
        ingest_rules(s, RULES)
        _make_plan(s)
        ingest_plans(s)
    with factory.begin() as s:
        hits = search(s, "a que horas abren de lunes a viernes", limit=3)
        assert hits[0].source_ref == "schedules_classes/horario"
        assert [h.score for h in hits] == sorted((h.score for h in hits), reverse=True)
        assert search(s, "cuanto cuesta el plan mensual precio", limit=1)[0].source_kind == "plan"
        assert {h.source_kind for h in search(s, "toalla", source_kind="rule", limit=10)} == {"rule"}
        assert search(s, "   ") == []
        assert search(s, "toalla", OtherModel()) == []  # chunks embedded with another model are not comparable


def test_knowledge_search_tool_is_allowlisted_and_read_only(factory):
    assert "knowledge_search" in ALLOWED_TOOLS and authorize_tool("knowledge_search") == "knowledge_search"
    with factory.begin() as s:
        ingest_rules(s, RULES)
    with factory.begin() as s:
        text_out = domain_tools.invoke("knowledge_search", s, query="proteina creatina")
        assert "Suplementos" in text_out
        assert domain_tools.invoke("knowledge_search", s, query=None).startswith("Dime")
        before = s.scalar(select(text("count(*)")).select_from(GimiKnowledgeChunk))
        domain_tools.invoke("knowledge_search", s, query="'; DROP TABLE gimi_knowledge_chunks; --")
        assert s.scalar(select(text("count(*)")).select_from(GimiKnowledgeChunk)) == before


@pytest.mark.parametrize("name", ["knowledge_search; drop", "KNOWLEDGE_SEARCH", "raw_sql", "", None, 7])
def test_tool_denied_outside_allowlist(name, factory):
    with factory() as s, pytest.raises(ToolDenied):
        domain_tools.invoke(name, s, query="x")


def test_migration_0056_upgrades_and_downgrades_on_sqlite(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    url = f"sqlite+pysqlite:///{(tmp_path / 'rag-migration.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0056_gimi_knowledge")
    engine = create_engine(url)
    try:
        insp = inspect(engine)
        cols = {c["name"] for c in insp.get_columns("gimi_knowledge_chunks")}
        assert cols == {"id", "source_kind", "source_ref", "title", "content", "content_hash",
                        "embedding_model", "embedding", "created_at", "updated_at"}
        assert any(u["name"] == "uq_gimi_knowledge_source_hash" for u in insp.get_unique_constraints("gimi_knowledge_chunks"))
        # ORM round trip against the migrated schema (JSON text embedding)
        with sessionmaker(engine).begin() as s:
            ingest_rules(s, RULES)
            assert search(s, "toalla pesas", limit=1)[0].source_ref == "regulations/toalla"
        with engine.connect() as c:
            raw = c.execute(text("select embedding from gimi_knowledge_chunks limit 1")).scalar_one()
            assert len(json.loads(raw)) == EMBEDDING_DIM
        command.downgrade(config, "0055_notification_outbox")
        assert "gimi_knowledge_chunks" not in inspect(engine).get_table_names()
        command.upgrade(config, "head")
        assert "gimi_knowledge_chunks" in inspect(engine).get_table_names()
    finally:
        engine.dispose()
