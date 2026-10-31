"""Opt-in proof of the expense evidence flow against a real S3-compatible server.

Set EVOGYM_EVIDENCE_S3_ENDPOINT, EVOGYM_EVIDENCE_PUBLIC_ENDPOINT,
EVOGYM_EVIDENCE_S3_BUCKET, EVOGYM_EVIDENCE_S3_ACCESS_KEY and
EVOGYM_EVIDENCE_S3_SECRET_KEY to run it against a local MinIO.
"""
import os

import pytest

from app.expenses.storage import EvidenceStorage
from app.settings import Settings

REQUIRED = (
    "EVOGYM_EVIDENCE_S3_ENDPOINT", "EVOGYM_EVIDENCE_PUBLIC_ENDPOINT",
    "EVOGYM_EVIDENCE_S3_BUCKET", "EVOGYM_EVIDENCE_S3_ACCESS_KEY",
    "EVOGYM_EVIDENCE_S3_SECRET_KEY",
)


def _settings():
    missing = [name for name in REQUIRED if not os.getenv(name)]
    if missing:
        pytest.skip("Missing evidence settings: " + ", ".join(missing))
    return Settings(_env_file=None)


def test_presigned_upload_and_read_work_against_a_real_server():
    settings = _settings()
    storage = EvidenceStorage(settings)
    key = f"expenses/probe/{os.urandom(8).hex()}.webp"
    body = b"fake-webp-payload"

    upload_url = storage.presign_put(key, "image/webp", len(body))
    assert "X-Amz-Signature" in upload_url or "Signature" in upload_url
    assert storage.exists(key) is False

    import urllib.request

    request = urllib.request.Request(upload_url, data=body, method="PUT", headers={"Content-Type": "image/webp"})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 200

    assert storage.exists(key) is True
    read_url = storage.presign_get(key)
    with urllib.request.urlopen(read_url, timeout=30) as response:
        assert response.status == 200
        assert response.read() == body
