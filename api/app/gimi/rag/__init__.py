"""Gimi RAG (read-only knowledge retrieval). Adapters are FAKE: no network, no credentials.

EMBEDDING_DIM is the width of `gimi_knowledge_chunks.embedding` (`vector(N)` on PostgreSQL, migration 0056).
Changing embedding model/dimension requires: a new migration altering the column, re-embedding every chunk
(`ingest_*` re-embeds automatically when `embedding_model` differs) and rebuilding the HNSW index.

PENDING (needs credentials / product decision): real EmbeddingProvider (e.g. OpenAI/Voyage/Cohere), an LLM that
composes answers from retrieved chunks, and wiring `knowledge_search` into the WhatsApp intent router.
"""
EMBEDDING_DIM = 64
