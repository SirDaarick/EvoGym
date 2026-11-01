"""Private S3-compatible storage for expense evidence."""


class EvidenceStorage:
    def __init__(self, settings):
        import boto3
        from botocore.config import Config

        options = {
            "aws_access_key_id": settings.evidence_s3_access_key.get_secret_value(),
            "aws_secret_access_key": settings.evidence_s3_secret_key.get_secret_value(),
            "region_name": "auto",
            "config": Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        }
        self.bucket = settings.evidence_s3_bucket
        self.internal = boto3.client("s3", endpoint_url=settings.evidence_s3_endpoint, **options)
        self.public = boto3.client("s3", endpoint_url=settings.evidence_public_endpoint, **options)

    def presign_put(self, key: str, content_type: str, size: int) -> str:
        return self.public.generate_presigned_url("put_object", Params={"Bucket": self.bucket, "Key": key,
            "ContentType": content_type, "ContentLength": size}, ExpiresIn=300)

    def presign_get(self, key: str) -> str:
        return self.public.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=300)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError
        try:
            obj = self.internal.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return 0 < obj["ContentLength"] <= 1048576 and obj.get("ContentType") == "image/webp"


def get_evidence_storage(request):
    injected = getattr(request.app.state, "evidence_storage", None)
    if injected is not None:
        return injected
    settings = request.app.state.settings
    if not all((settings.evidence_s3_endpoint, settings.evidence_public_endpoint, settings.evidence_s3_bucket,
                settings.evidence_s3_access_key, settings.evidence_s3_secret_key)):
        return None
    return EvidenceStorage(settings)
