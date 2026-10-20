import asyncio

import httpx
import pytest

from app.settings import Settings


@pytest.fixture(autouse=True)
def clear_settings_environment(monkeypatch, tmp_path):
    monkeypatch.delenv("EVOGYM_ENV", raising=False)
    monkeypatch.delenv("EVOGYM_DEBUG", raising=False)
    monkeypatch.delenv("EVOGYM_DATABASE_URL", raising=False)
    monkeypatch.chdir(tmp_path)


def request(app, path):
    async def get_response():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path)

    return asyncio.run(get_response())


def create_test_app(settings):
    from app.main import create_app

    return create_app(settings)


def test_development_app_exposes_docs_and_openapi():
    app = create_test_app(Settings(environment="development", debug=False, _env_file=None))

    docs_response = request(app, "/docs")
    openapi_response = request(app, "/openapi.json")

    assert docs_response.status_code == 200
    assert openapi_response.status_code == 200
    assert openapi_response.json()["info"]["title"] == "EvoGym API"


def test_production_app_disables_docs_and_openapi():
    app = create_test_app(Settings(environment="production", debug=False, _env_file=None))

    assert request(app, "/docs").status_code == 404
    assert request(app, "/openapi.json").status_code == 404


def test_app_does_not_expose_configuration_values():
    app = create_test_app(Settings(environment="development", debug=False, _env_file=None))

    assert not hasattr(app.state, "settings")


def test_debug_setting_never_enables_exception_detail_pages():
    app = create_test_app(Settings(environment="test", debug=True, _env_file=None))
    assert app.debug is False


def test_app_lifespan_context_is_entered_in_process():
    app = create_test_app(Settings(environment="test", debug=False, _env_file=None))

    async def run_lifespan():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                return await client.get("/openapi.json")

    response = asyncio.run(run_lifespan())

    assert response.status_code == 200


def test_health_responses_are_correlated_and_readiness_fails_closed_without_database():
    app = create_test_app(Settings(environment="test", debug=False, _env_file=None))

    live = request(app, "/health/live")
    ready = request(app, "/health/ready")
    missing = request(app, "/never-existed")

    assert live.status_code == 200 and live.json() == {"status": "ok"}
    assert ready.status_code == 503 and ready.json() == {"status": "unavailable"}
    for response in (live, ready, missing):
        assert response.headers["x-request-id"]
        assert response.headers["x-request-id"] == response.json().get("request_id", response.headers["x-request-id"])
    assert app.state.request_metrics.snapshot()
