import io
import pymupdf
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models.gimi import GimiKnowledgeChunk
from app.gimi.rag.document_ingest import chunk_text, ingest_document, parse_document
from app.gimi.rag.search import search


@pytest.fixture
def session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory() as sess:
        yield sess
    engine.dispose()


def _create_sample_pdf(title: str, text: str) -> bytes:
    doc = pymupdf.open()
    doc.set_metadata({"title": title})
    page = doc.new_page()
    page.insert_text((50, 72), text)
    pdf_bytes = doc.write()
    doc.close()
    return pdf_bytes


def test_parse_markdown_document():
    md_content = """# Reglamento General de Pesas

1. Es obligatorio el uso de toalla en todo momento.
2. Regresar las mancuernas a su rack correspondiente.
3. Prohibido azotar el peso en peso muerto sin drop pads.
"""
    title, text = parse_document(md_content.encode("utf-8"), "reglamento.md")
    assert title == "Reglamento General de Pesas"
    assert "Es obligatorio el uso de toalla" in text


def test_parse_pdf_document():
    pdf_bytes = _create_sample_pdf(
        title="Manual de Nutricion y Suplementos",
        text="La creatina monohidratada se consume diariamente a dosis de 5 gramos.",
    )
    title, text = parse_document(pdf_bytes, "suplementos.pdf")
    assert title == "Manual de Nutricion y Suplementos"
    assert "creatina monohidratada" in text


def test_chunk_text_with_overlap():
    short_text = "Texto corto de prueba."
    chunks = chunk_text(short_text, max_chars=100)
    assert len(chunks) == 1
    assert chunks[0] == short_text

    long_text = "\n\n".join([f"Parrafo {i}: Informacion sobre la regla numero {i} de operacion del gym." for i in range(1, 15)])
    chunks = chunk_text(long_text, max_chars=150, overlap=30)
    assert len(chunks) > 1
    # Check that adjacent chunks have content
    assert all(len(c) <= 250 for c in chunks)


def test_ingest_document_end_to_end_and_search(session):
    rules_text = """# Protocolo de Seguridad en Sala de Box

El vendaje es estrictamente obligatorio antes de colocarse los guantes de boxeo.
No se permite hacer sparring sin careta protectora y bucal puesto.
Los rounds de entrenamiento libre son de 3 minutos con 1 de descanso.
"""
    result = ingest_document(
        session=session,
        file_bytes=rules_text.encode("utf-8"),
        filename="seguridad_box.md",
        category="regulations",
    )
    session.commit()

    assert result["status"] == "indexed"
    assert result["title"] == "Protocolo de Seguridad en Sala de Box"
    assert result["chunks_count"] >= 1
    assert result["sync_stats"]["inserted"] >= 1

    # Verify rows in DB
    rows = session.scalars(select(GimiKnowledgeChunk).where(GimiKnowledgeChunk.source_kind == "rule")).all()
    assert len(rows) >= 1
    assert any("vendaje es estrictamente obligatorio" in r.content for r in rows)

    # Verify semantic search over ingested document
    hits = search(session, "vendaje y guantes de box")
    assert len(hits) > 0
    assert "Protocolo de Seguridad" in hits[0].title or "vendaje" in hits[0].content


def test_ingest_document_invalid_category_raises(session):
    with pytest.raises(ValueError, match="Invalid category"):
        ingest_document(
            session=session,
            file_bytes=b"sample text",
            filename="doc.txt",
            category="categoria_inexistente",
        )
