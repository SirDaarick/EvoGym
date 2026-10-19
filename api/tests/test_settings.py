from pydantic import ValidationError
import pytest

from app.settings import Settings


def test_defaults_to_safe_development_configuration(monkeypatch):
    monkeypatch.delenv("EVOGYM_ENV", raising=False)
    monkeypatch.delenv("EVOGYM_DEBUG", raising=False)

    settings = Settings(_env_file=None)

    assert settings.environment == "development"
    assert settings.debug is False
    assert settings.docs_enabled is True


def test_prefixed_environment_overrides_defaults(monkeypatch):
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "true")

    settings = Settings(_env_file=None)

    assert settings.environment == "test"
    assert settings.debug is True


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_non_development_environment_disables_debug_and_docs(environment, monkeypatch):
    monkeypatch.setenv("EVOGYM_ENV", environment)
    monkeypatch.delenv("EVOGYM_DEBUG", raising=False)

    settings = Settings(_env_file=None)

    assert settings.debug is False
    assert settings.docs_enabled is False


def test_non_development_rejects_debug_override(monkeypatch):
    monkeypatch.setenv("EVOGYM_ENV", "production")
    monkeypatch.setenv("EVOGYM_DEBUG", "true")

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_invalid_environment_is_rejected(monkeypatch):
    monkeypatch.setenv("EVOGYM_ENV", "prod-ish")

    with pytest.raises(ValidationError):
        Settings(_env_file=None)