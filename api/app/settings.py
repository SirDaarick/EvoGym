from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="EVOGYM_",
        extra="ignore",
        populate_by_name=True,
    )

    environment: Literal["development", "test", "staging", "production"] = Field(
        default="development",
        validation_alias="EVOGYM_ENV",
    )
    debug: bool = False

    @model_validator(mode="after")
    def reject_debug_outside_local_environments(self) -> "Settings":
        if self.debug and self.environment not in {"development", "test"}:
            raise ValueError("debug is only allowed in development and test environments")
        return self

    @property
    def docs_enabled(self) -> bool:
        return self.environment in {"development", "test"}


def get_settings() -> Settings:
    return Settings()