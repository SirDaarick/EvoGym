import asyncio
import httpx
import pytest

from app.main import create_app
from app.settings import Settings


@pytest.fixture
def test_app():
    settings = Settings(
        environment="development",
        debug=False,
        _env_file=None,
    )
    return create_app(settings)


def test_security_headers_present_on_health_live(test_app):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=test_app), base_url="http://test") as client:
            return await client.get("/health/live")

    response = asyncio.run(run())
    assert response.status_code == 200
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert response.headers.get("strict-transport-security") == "max-age=63072000; includeSubDomains"


def test_security_headers_present_on_not_found_endpoint(test_app):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=test_app), base_url="http://test") as client:
            return await client.get("/non-existent-endpoint")

    response = asyncio.run(run())
    assert response.status_code == 404
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert response.headers.get("strict-transport-security") == "max-age=63072000; includeSubDomains"
