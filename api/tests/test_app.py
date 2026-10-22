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


def test_app_stores_typed_configuration():
    app = create_test_app(Settings(environment="development", debug=False, _env_file=None))

    assert isinstance(app.state.settings, Settings)
    assert app.state.settings.environment == "development"


def test_cors_requires_narrow_explicit_origin_allowlist_and_never_enables_credentials():
    allowed_origin = "https://reception.example"
    settings = Settings(environment="test", debug=False, cors_allowed_origins=allowed_origin, _env_file=None)
    app = create_test_app(settings)

    async def cors_requests():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            allowed = await client.options("/api/v1/members", headers={
                "Origin": allowed_origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            })
            denied = await client.get("/health/live", headers={"Origin": "https://other.example"})
        return allowed, denied

    allowed, denied = asyncio.run(cors_requests())
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == allowed_origin
    assert "authorization" in allowed.headers["access-control-allow-headers"].lower()
    assert "content-type" in allowed.headers["access-control-allow-headers"].lower()
    assert set(allowed.headers["access-control-allow-methods"].split(", ")) == {"GET", "POST", "PATCH", "PUT", "DELETE"}
    assert "access-control-allow-credentials" not in allowed.headers
    assert "access-control-allow-origin" not in denied.headers


def test_cors_configuration_fails_closed_for_unset_or_wildcard_allowlist():
    app = create_test_app(Settings(environment="test", debug=False, _env_file=None))
    no_cors = request_with_origin(app, "/health/live", "https://reception.example")
    assert no_cors.status_code == 200
    assert "access-control-allow-origin" not in no_cors.headers
    with pytest.raises(ValueError):
        Settings(environment="test", cors_allowed_origins="*", _env_file=None)
    for invalid_origin in ("https://reception.example/path", "https://user:password@reception.example", "https://reception.example,https://reception.example"):
        with pytest.raises(ValueError):
            Settings(environment="test", cors_allowed_origins=invalid_origin, _env_file=None)


@pytest.mark.parametrize("method", ["POST", "PATCH", "PUT", "DELETE"])
def test_cors_allows_implemented_browser_methods_and_idempotency_header(method):
    origin = "https://reception.example"
    app = create_test_app(Settings(environment="test", cors_allowed_origins=origin, _env_file=None))

    async def preflight():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.options("/api/v1/members", headers={
                "Origin": origin,
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": "Authorization,Content-Type,Idempotency-Key",
            })

    response = asyncio.run(preflight())
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "idempotency-key" in response.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in response.headers


@pytest.mark.parametrize(("origin", "method", "headers"), [
    ("https://other.example", "POST", "Authorization"),
    ("https://reception.example", "TRACE", "Authorization"),
    ("https://reception.example", "POST", "X-Unapproved-Header"),
])
def test_cors_rejects_unapproved_origins_methods_and_headers(origin, method, headers):
    app = create_test_app(Settings(environment="test", cors_allowed_origins="https://reception.example", _env_file=None))

    async def preflight():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.options("/api/v1/members", headers={
                "Origin": origin,
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": headers,
            })

    response = asyncio.run(preflight())
    assert response.status_code == 400
    assert "access-control-allow-credentials" not in response.headers
    if origin != "https://reception.example":
        assert "access-control-allow-origin" not in response.headers


def test_cors_exposes_only_request_correlation_on_actual_responses():
    origin = "https://reception.example"
    app = create_test_app(Settings(environment="test", cors_allowed_origins=origin, _env_file=None))
    response = request_with_origin(app, "/health/live", origin)
    assert response.status_code == 200
    assert response.headers["access-control-expose-headers"] == "X-Request-ID"
    assert response.headers["x-request-id"]
    assert "access-control-allow-credentials" not in response.headers


def request_with_origin(app, path, origin):
    async def get_response():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get(path, headers={"Origin": origin})

    return asyncio.run(get_response())


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
