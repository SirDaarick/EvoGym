"""Opt-in proof of the expense evidence flow against a real S3-compatible server.

Set EVOGYM_EVIDENCE_S3_ENDPOINT, EVOGYM_EVIDENCE_PUBLIC_ENDPOINT,
EVOGYM_EVIDENCE_S3_BUCKET, EVOGYM_EVIDENCE_S3_ACCESS_KEY and
EVOGYM_EVIDENCE_S3_SECRET_KEY to run it against a local MinIO.
"""
import os
import urllib.request

import pytest
from fastapi.testclient import TestClient

from app.expenses.storage import EvidenceStorage
from app.main import create_app
from app.settings import Settings
from app.shifts.queries import create_cash_register
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift

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

    request = urllib.request.Request(upload_url, data=body, method="PUT", headers={"Content-Type": "image/webp"})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 200

    assert storage.exists(key) is True
    read_url = storage.presign_get(key)
    with urllib.request.urlopen(read_url, timeout=30) as response:
        assert response.status == 200
        assert response.read() == body


def test_expense_keeps_the_key_private_and_reads_through_a_signed_url(tmp_path):
    """A receipt is stored by key and only exposed as a short-lived signed URL."""
    settings = _settings()
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "live", "Live Register")
            register_id = register.id
            open_shift(session, register_id=register_id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 2}])
        app = create_app(configured_settings(
            url,
            evidence_s3_endpoint=settings.evidence_s3_endpoint,
            evidence_public_endpoint=settings.evidence_public_endpoint,
            evidence_s3_bucket=settings.evidence_s3_bucket,
            evidence_s3_access_key=settings.evidence_s3_access_key,
            evidence_s3_secret_key=settings.evidence_s3_secret_key,
        ))
        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "live-evidence"}
        with TestClient(app) as client:
            upload = client.post("/api/v1/expenses/evidence-uploads", headers=headers,
                                 json={"branch_id": str(branch_id), "content_type": "image/webp", "file_size_bytes": 18})
            assert upload.status_code == 200, upload.text
            evidence_key = upload.json()["evidence_key"]
            body = b"fake-webp-payload"
            request = urllib.request.Request(upload.json()["upload_url"], data=body, method="PUT",
                                             headers={"Content-Type": "image/webp"})
            with urllib.request.urlopen(request, timeout=30) as response:
                assert response.status == 200
            created = client.post(f"/api/v1/registers/{register_id}/expenses", headers=headers,
                                  json={"category": "limpieza", "concept": "Jabón", "payee_name": "Proveedor",
                                        "amount_minor": 15000, "evidence_key": evidence_key})
            assert created.status_code == 201, created.text
            # The raw object path is never a field: only a signed, expiring URL is exposed.
            assert "evidence_key" not in created.json()
            assert created.json()["evidence_url"].startswith("http")
            assert "X-Amz-Signature" in created.json()["evidence_url"]
            assert "X-Amz-Expires=300" in created.json()["evidence_url"]
            listed = client.get(f"/api/v1/registers/{register_id}/expenses", headers=headers).json()
            signed = listed["items"][0]["evidence_url"]
            assert signed and evidence_key in signed and "X-Amz-Signature" in signed
            with urllib.request.urlopen(signed, timeout=30) as response:
                assert response.read() == body
    finally:
        engine.dispose()
