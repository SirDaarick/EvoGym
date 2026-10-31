"""Create the private expense evidence bucket in a local S3-compatible server.

Usage (from api/):
    .\.venv\Scripts\python.exe scripts/bootstrap_evidence_bucket.py

Reads the same EVOGYM_EVIDENCE_* settings as the API, so the bucket, region and
credentials always match the ones the API will use.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from botocore.config import Config  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402

from app.settings import get_settings  # noqa: E402


def main() -> int:
    settings = get_settings()
    missing = [
        name for name in (
            "evidence_s3_endpoint", "evidence_s3_bucket",
            "evidence_s3_access_key", "evidence_s3_secret_key",
        ) if getattr(settings, name) is None
    ]
    if missing:
        print("Missing evidence settings: " + ", ".join(f"EVOGYM_{name.upper()}" for name in missing))
        return 1
    import boto3

    client = boto3.client(
        "s3",
        endpoint_url=settings.evidence_s3_endpoint,
        aws_access_key_id=settings.evidence_s3_access_key.get_secret_value(),
        aws_secret_access_key=settings.evidence_s3_secret_key.get_secret_value(),
        region_name="auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    bucket = settings.evidence_s3_bucket
    try:
        client.head_bucket(Bucket=bucket)
        print(f"Bucket {bucket} already exists.")
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") not in {"404", "NoSuchBucket", "NotFound"}:
            print(f"Bucket {bucket} is not reachable: {exc}")
            return 1
        client.create_bucket(Bucket=bucket)
        print(f"Bucket {bucket} created.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
