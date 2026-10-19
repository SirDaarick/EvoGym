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
