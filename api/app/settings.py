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

    @model_validator(mode="after")
    def reject_debug_outside_local_environments(self) -> "Settings":
        if self.debug and self.environment not in {"development", "test"}:
            raise ValueError("debug is only allowed in development and test environments")
        return self

    @property
    def docs_enabled(self) -> bool:
        return self.environment in {"development", "test"}

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
