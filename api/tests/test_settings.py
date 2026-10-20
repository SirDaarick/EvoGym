from pydantic import ValidationError
import pytest

from app.settings import Settings


@pytest.fixture(autouse=True)
def clear_settings_environment(monkeypatch):
    monkeypatch.delenv("EVOGYM_ENV", raising=False)
    monkeypatch.delenv("EVOGYM_DEBUG", raising=False)
    monkeypatch.delenv("EVOGYM_DATABASE_URL", raising=False)
    for key in (
        "EVOGYM_ADMIN_SESSION_TTL_SECONDS", "EVOGYM_ADMIN_LOCKOUT_ATTEMPTS",
        "EVOGYM_ADMIN_LOCKOUT_SECONDS", "EVOGYM_AUTH_RATE_LIMIT_WINDOW_SECONDS",
        "EVOGYM_AUTH_RATE_LIMIT_REQUESTS", "EVOGYM_AUTH_REQUEST_MAX_BYTES",
        "EVOGYM_AUTH_MAX_CONCURRENT_HASHES", "EVOGYM_ADMIN_RECOVERY_TTL_SECONDS",
        "EVOGYM_ADMIN_RECOVERY_BASE_URL",
    ):
        monkeypatch.delenv(key, raising=False)


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


def test_database_url_is_optional_and_required_only_by_explicit_db_operations():
    settings = Settings(_env_file=None)

    assert settings.database_url is None
    with pytest.raises(RuntimeError, match="EVOGYM_DATABASE_URL"):
        settings.require_database_url()


def test_database_url_secret_is_redacted_from_settings_repr():
    url = "postgresql+psycopg://test_user:synthetic-only@db.example.invalid/test_db"

    settings = Settings(database_url=url, _env_file=None)

    assert settings.require_database_url() == url
    assert "synthetic-only" not in repr(settings)


def test_database_url_uses_prefixed_environment_variable(monkeypatch):
    monkeypatch.setenv(
        "EVOGYM_DATABASE_URL",
        "postgresql+psycopg://test_user:synthetic-only@db.example.invalid/test_db",
    )

    settings = Settings(_env_file=None)

    assert settings.database_url is not None
    assert "synthetic-only" not in repr(settings.database_url)


@pytest.mark.parametrize("url", ["mysql://user:secret@db.invalid/test", "not-a-url"])
def test_unsupported_database_url_is_rejected_without_leaking_input(url):
    settings = Settings(database_url=url, _env_file=None)

    with pytest.raises(RuntimeError) as error:
        settings.require_database_url()
    assert url not in str(error.value)


def test_sqlite_url_is_allowed_only_for_explicit_test_environment():
    test_settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        _env_file=None,
    )

    assert test_settings.require_database_url() == "sqlite+pysqlite:///:memory:"

    production_settings = Settings(
        environment="production",
        database_url="sqlite+pysqlite:///:memory:",
        _env_file=None,
    )
    with pytest.raises(RuntimeError, match="SQLite is allowed only in test"):
        production_settings.require_database_url()


def test_admin_access_settings_fail_closed_without_explicit_deadline_and_rate_policy():
    settings = Settings(database_url="sqlite+pysqlite:///:memory:", environment="test", _env_file=None)
    assert settings.admin_auth_configured is False
    assert settings.admin_recovery_configured is False


def test_admin_access_settings_load_prefixed_values_and_validate_recovery_url(monkeypatch):
    monkeypatch.setenv("EVOGYM_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_ADMIN_SESSION_TTL_SECONDS", "3600")
    monkeypatch.setenv("EVOGYM_ADMIN_LOCKOUT_ATTEMPTS", "5")
    monkeypatch.setenv("EVOGYM_ADMIN_LOCKOUT_SECONDS", "300")
    monkeypatch.setenv("EVOGYM_AUTH_RATE_LIMIT_WINDOW_SECONDS", "60")
    monkeypatch.setenv("EVOGYM_AUTH_RATE_LIMIT_REQUESTS", "20")
    monkeypatch.setenv("EVOGYM_AUTH_REQUEST_MAX_BYTES", "4096")
    monkeypatch.setenv("EVOGYM_AUTH_MAX_CONCURRENT_HASHES", "2")
    monkeypatch.setenv("EVOGYM_ADMIN_RECOVERY_TTL_SECONDS", "1800")
    monkeypatch.setenv("EVOGYM_ADMIN_RECOVERY_BASE_URL", "https://example.invalid/recover")
    settings = Settings(_env_file=None)
    assert settings.admin_auth_configured is True
    assert settings.admin_recovery_configured is True

    with pytest.raises(ValidationError):
        Settings(environment="production", admin_recovery_base_url="http://example.invalid/recover", _env_file=None)
