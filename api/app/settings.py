from typing import Literal
from urllib.parse import urlsplit
from pathlib import Path

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "api/.env"),
        env_file_encoding="utf-8",
        env_prefix="EVOGYM_",
        extra="ignore",
        hide_input_in_errors=True,
        populate_by_name=True,
    )

    environment: Literal["development", "test", "staging", "production"] = Field(
        default="development",
        validation_alias="EVOGYM_ENV",
    )
    debug: bool = False
    database_url: SecretStr | None = None
    admin_token_signing_secret: SecretStr | None = None
    admin_session_ttl_seconds: int | None = Field(default=None, ge=60, le=86400)
    staff_session_ttl_seconds: int | None = Field(default=None, ge=60, le=86400)
    admin_lockout_attempts: int | None = Field(default=None, ge=1, le=5)
    admin_lockout_seconds: int | None = Field(default=None, ge=60, le=86400)
    auth_rate_limit_window_seconds: int | None = Field(default=None, ge=1, le=3600)
    auth_rate_limit_requests: int | None = Field(default=None, ge=1, le=10000)
    auth_request_max_bytes: int | None = Field(default=None, ge=256, le=65536)
    auth_max_concurrent_hashes: int | None = Field(default=None, ge=1, le=32)
    admin_recovery_ttl_seconds: int | None = Field(default=None, ge=1800, le=1800)
    admin_recovery_base_url: str | None = None
    cors_allowed_origins: str | None = Field(default=None)
    operational_security_log_directory: Path | None = Field(default=None)
    mercado_pago_access_token: SecretStr | None = None
    whatsapp_app_secret: SecretStr | None = None
    whatsapp_verify_token: SecretStr | None = None
    whatsapp_webhook_max_bytes: int = Field(default=65536, ge=1024, le=1048576)
    evidence_s3_endpoint: str | None = None
    evidence_public_endpoint: str | None = None
    evidence_s3_bucket: str | None = None
    evidence_s3_access_key: SecretStr | None = None
    evidence_s3_secret_key: SecretStr | None = None
    sync_device_token_ttl_days: int = Field(default=30, ge=1, le=365)
    sync_offline_grant_ttl_hours: int = Field(default=24, ge=1, le=168)
    sync_batch_max_events: int = Field(default=100, ge=1, le=1000)
    sync_batch_max_bytes: int = Field(default=262144, ge=1024, le=4194304)
    sync_delta_page_size: int = Field(default=500, ge=1, le=5000)
    sync_delta_max_age_days: int = Field(default=7, ge=1, le=90)
    sync_clock_skew_tolerance_seconds: int = Field(default=300, ge=0, le=3600)
    openrouter_api_key: SecretStr | None = None
    openrouter_base_url: str = 'https://openrouter.ai/api/v1'
    openrouter_chat_model: str = 'google/gemini-2.0-flash-001'

    @model_validator(mode="after")
    def reject_debug_outside_local_environments(self) -> "Settings":
        if self.debug and self.environment not in {"development", "test"}:
            raise ValueError("debug is only allowed in development and test environments")
        return self

    @property
    def docs_enabled(self) -> bool:
        return self.environment in {"development", "test"}

    @property
    def point_mock_allowed(self) -> bool:
        return self.environment in {"development", "test"}

    @property
    def admin_auth_configured(self) -> bool:
        return self.database_url is not None and all(value is not None for value in (
            self.admin_session_ttl_seconds, self.admin_lockout_attempts,
            self.admin_lockout_seconds, self.auth_rate_limit_window_seconds,
            self.auth_rate_limit_requests, self.auth_request_max_bytes,
            self.auth_max_concurrent_hashes,
        ))

    @property
    def admin_token_signing_configured(self) -> bool:
        return self.admin_token_signing_secret is not None and len(self.admin_token_signing_secret.get_secret_value()) >= 32

    @property
    def admin_recovery_configured(self) -> bool:
        return self.admin_auth_configured and self.admin_recovery_ttl_seconds is not None and self.admin_recovery_base_url is not None

    @property
    def openrouter_api_key_configured(self) -> bool:
        return (
            self.openrouter_api_key is not None
            and len(self.openrouter_api_key.get_secret_value().strip()) > 0
        )

    @property
    def mercado_pago_configured(self) -> bool:
        return (
            self.mercado_pago_access_token is not None
            and len(self.mercado_pago_access_token.get_secret_value().strip()) > 0
        )

    @property
    def whatsapp_webhook_configured(self) -> bool:
        """Webhook stays disabled (503) unless both the app secret and verify token are set."""
        return all(
            value is not None and len(value.get_secret_value().strip()) > 0
            for value in (self.whatsapp_app_secret, self.whatsapp_verify_token)
        )

    @model_validator(mode="after")
    def validate_recovery_url(self) -> "Settings":
        if self.admin_recovery_base_url is not None:
            from urllib.parse import urlsplit
            parts = urlsplit(self.admin_recovery_base_url)
            if parts.scheme not in {"https", "http"} or not parts.netloc or parts.username or parts.password or parts.query or parts.fragment:
                raise ValueError("EVOGYM_ADMIN_RECOVERY_BASE_URL must be a trusted absolute HTTP(S) URL without credentials, query, or fragment")
            if self.environment == "production" and parts.scheme != "https":
                raise ValueError("EVOGYM_ADMIN_RECOVERY_BASE_URL must use HTTPS in production")
        return self

    @model_validator(mode="after")
    def validate_cors_origins(self) -> "Settings":
        if self.cors_allowed_origins is None:
            return self
        origins = [item.strip() for item in self.cors_allowed_origins.split(",")]
        if not origins or any(not item or "*" in item for item in origins):
            raise ValueError("EVOGYM_CORS_ALLOWED_ORIGINS must contain explicit HTTP(S) origins and cannot use a wildcard")
        normalized = []
        for origin in origins:
            parts = urlsplit(origin)
            if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password or parts.path not in {"", "/"} or parts.query or parts.fragment:
                raise ValueError("EVOGYM_CORS_ALLOWED_ORIGINS entries must be HTTP(S) origins without credentials, paths, queries, or fragments")
            try:
                parts.port
            except ValueError:
                raise ValueError("EVOGYM_CORS_ALLOWED_ORIGINS contains an invalid port") from None
            normalized.append(f"{parts.scheme.lower()}://{parts.netloc.lower()}")
        if len(set(normalized)) != len(normalized):
            raise ValueError("EVOGYM_CORS_ALLOWED_ORIGINS cannot contain duplicate origins")
        self.cors_allowed_origins = ",".join(normalized)
        return self

    @property
    def cors_origin_allowlist(self) -> tuple[str, ...]:
        if self.cors_allowed_origins is None:
            return ()
        return tuple(self.cors_allowed_origins.split(","))

    def require_database_url(self) -> str:
        if self.database_url is None:
            raise RuntimeError("Database configuration is missing; set EVOGYM_DATABASE_URL explicitly")

        value = self.database_url.get_secret_value()
        try:
            url = make_url(value)
        except (ArgumentError, TypeError, ValueError):
            raise RuntimeError("EVOGYM_DATABASE_URL must be a valid SQLAlchemy URL") from None

        if url.drivername == "postgresql+psycopg" and url.database:
            return value
        if url.drivername == "sqlite+pysqlite" and self.environment == "test":
            return value
        raise RuntimeError("EVOGYM_DATABASE_URL must use PostgreSQL; SQLite is allowed only in test")


def get_settings() -> Settings:
    return Settings()
