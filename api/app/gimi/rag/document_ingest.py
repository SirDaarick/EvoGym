"""Document parsing, chunking, and vector ingestion pipeline for Gimi RAG.

Extracts text from PDF, Markdown, and TXT files, chunks with overlap, and
indexes embeddings into `gimi_knowledge_chunks` with pgvector.
"""
from dataclasses import dataclass
import io
from pathlib import Path
import re
from typing import Any

import pymupdf
from sqlalchemy.orm import Session

from app.gimi.rag.embeddings import EmbeddingProvider, get_default_provider
from app.gimi.rag.ingest import CATEGORIES, Rule, ingest_rules

DEFAULT_CHUNK_CHARS = 800
DEFAULT_OVERLAP_CHARS = 120


def extract_text_from_pdf(file_bytes: bytes) -> tuple[str, str]:
    """Extract text and metadata title from a PDF document using PyMuPDF."""
    doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    pages_text: list[str] = []

    doc_title = (doc.metadata.get("title") or "").strip()

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text").strip()
        if text:
            pages_text.append(text)

    full_text = "\n\n".join(pages_text)

    # If metadata title is empty, look for the first non-empty line as title
    if not doc_title and full_text:
        first_line = full_text.split("\n")[0].strip()
        doc_title = first_line[:120] if len(first_line) > 3 else "Documento PDF"

    return doc_title or "Documento PDF", full_text


def extract_text_from_markdown(content_str: str) -> tuple[str, str]:
    """Extract title from first # heading if present, and clean text."""
    lines = content_str.strip().split("\n")
    title = "Documento Markdown"

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# "):
            title = stripped[2:].strip()[:120]
            break

    return title, content_str.strip()


def parse_document(file_bytes: bytes, filename: str) -> tuple[str, str]:
    """Parse incoming document bytes based on file extension."""
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        return extract_text_from_pdf(file_bytes)

    # Text / Markdown
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = file_bytes.decode("latin-1", errors="replace")

    if ext in (".md", ".markdown"):
        title, clean_text = extract_text_from_markdown(text)
        return title or Path(filename).stem, clean_text

    # Default .txt or other
    first_line = text.strip().split("\n")[0][:120] if text.strip() else Path(filename).stem
    return first_line or Path(filename).stem, text.strip()


def chunk_text(
    text: str,
    max_chars: int = DEFAULT_CHUNK_CHARS,
    overlap: int = DEFAULT_OVERLAP_CHARS,
) -> list[str]:
    """Split text into semantic chunks with a sliding overlap."""
    clean = re.sub(r"\r\n|\r", "\n", text).strip()
    if not clean:
        return []

    if len(clean) <= max_chars:
        return [clean]

    # Split by paragraphs first
    paragraphs = [p.strip() for p in clean.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current_chunk = ""

    for para in paragraphs:
        if not current_chunk:
            current_chunk = para
        elif len(current_chunk) + len(para) + 2 <= max_chars:
            current_chunk += "\n\n" + para
        else:
            chunks.append(current_chunk.strip())
            # Overlap: keep last few characters/sentences for continuity
            if overlap > 0 and len(current_chunk) > overlap:
                current_chunk = current_chunk[-overlap:] + "\n\n" + para
            else:
                current_chunk = para

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


def ingest_document(
    session: Session,
    file_bytes: bytes,
    filename: str,
    category: str = "regulations",
    title_override: str | None = None,
    provider: EmbeddingProvider | None = None,
) -> dict[str, Any]:
    """Parse, chunk, and index document into `gimi_knowledge_chunks` with pgvector."""
    if category not in CATEGORIES:
        raise ValueError(f"Invalid category '{category}'. Allowed: {', '.join(CATEGORIES)}")

    extracted_title, full_text = parse_document(file_bytes, filename)
    doc_title = title_override.strip() if title_override and title_override.strip() else extracted_title

    if not full_text.strip():
        return {
            "filename": filename,
            "title": doc_title,
            "category": category,
            "chunks_count": 0,
            "total_chars": 0,
            "status": "empty_document",
        }

    chunks = chunk_text(full_text)
    file_slug = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(filename).stem).lower()[:40]

    rules: list[Rule] = []
    for idx, chunk_content in enumerate(chunks, start=1):
        chunk_title = f"{doc_title} (Parte {idx}/{len(chunks)})" if len(chunks) > 1 else doc_title
        rules.append(
            Rule(
                ref=f"{file_slug}_p{idx}",
                category=category,
                title=chunk_title,
                content=chunk_content,
            )
        )

    stats = ingest_rules(session, rules, provider=provider or get_default_provider())

    return {
        "filename": filename,
        "title": doc_title,
        "category": category,
        "chunks_count": len(chunks),
        "total_chars": len(full_text),
        "sync_stats": stats,
        "status": "indexed",
    }
