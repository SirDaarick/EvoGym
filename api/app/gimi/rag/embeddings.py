"""Embedding providers. Only a deterministic offline fake exists; real providers are pending credentials."""
import hashlib
import math
import re
import unicodedata
from collections.abc import Sequence
from typing import Protocol

from app.gimi.rag import EMBEDDING_DIM


class EmbeddingProvider(Protocol):
    model_name: str
    dimensions: int

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


def _tokens(text: str) -> list[str]:
    folded = unicodedata.normalize("NFKD", text.lower())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9]+", folded)


class FakeEmbeddingProvider:
    """Hashed bag-of-words, L2-normalised. Same text -> same vector; shared words -> higher cosine. No network."""

    model_name = "fake-hash-bow-v1"
    dimensions = EMBEDDING_DIM

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * self.dimensions
        for token in _tokens(text):
            digest = hashlib.sha256(token.encode()).digest()
            idx = int.from_bytes(digest[:4], "big") % self.dimensions
            vec[idx] += 1.0 if digest[4] & 1 else -1.0
        norm = math.sqrt(sum(v * v for v in vec))
        if norm == 0.0:
            vec[0] = 1.0  # empty/untokenisable text still yields a unit vector (pgvector cosine rejects zero vectors)
            return vec
        return [v / norm for v in vec]


def get_default_provider() -> EmbeddingProvider:
    """TODO(real provider): select by settings once credentials exist. Today always the offline fake."""
    return FakeEmbeddingProvider()
