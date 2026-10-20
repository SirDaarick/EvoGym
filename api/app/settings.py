from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
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
    admin_session_ttl_seconds: int | None = Field(default=None, ge=60, le=86400)
    admin_lockout_attempts: int | None = Field(default=None, ge=1, le=5)
    admin_lockout_seconds: int | None = Field(default=None, ge=60, le=86400)
    auth_rate_limit_window_seconds: int | None = Field(default=None, ge=1, le=3600)
    auth_rate_limit_requests: int | None = Field(default=None, ge=1, le=10000)
    auth_request_max_bytes: int | None = Field(default=None, ge=256, le=65536)
    auth_max_concurrent_hashes: int | None = Field(default=None, ge=1, le=32)
    admin_recovery_ttl_seconds: int | None = Field(default=None, ge=60, le=86400)
    admin_recovery_base_url: str | None = None

    @model_validator(mode="after")
    def reject_debug_outside_local_environments(self) -> "Settings":
        if self.debug and self.environment not in {"development", "test"}:
            raise ValueError("debug is only allowed in development and test environments")
        return self

    @property
    def docs_enabled(self) -> bool:
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
    def admin_recovery_configured(self) -> bool:
        return self.admin_auth_configured and self.admin_recovery_ttl_seconds is not None and self.admin_recovery_base_url is not None

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
