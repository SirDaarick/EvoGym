import asyncio
import logging

import httpx
import pytest
from fastapi import Body, FastAPI, HTTPException
from pydantic import BaseModel

from app.errors import install_error_handlers
from app.observability.request_id import RequestIdMiddleware


class Payload(BaseModel):
    value: int


def run(app, method="GET", path="/", **kwargs):
    async def request():
        raise_server_exceptions = kwargs.pop("raise_server_exceptions", True)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=raise_server_exceptions), base_url="http://test") as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(request())


def app_with_routes():
    app = FastAPI()
    install_error_handlers(app)
    app.add_middleware(RequestIdMiddleware)

    @app.get("/secret")
    def secret():
        raise HTTPException(status_code=403, detail="Bearer raw-token secret-pin")

    @app.post("/payload")
    def payload(body: Payload = Body(...)):
        return body

    @app.get("/crash")
    def crash():
        raise RuntimeError("private DSN password=not-for-output")

    @app.get("/bad-allow")
    def bad_allow():
        raise HTTPException(status_code=405, detail="secret", headers={
            "Allow": "GET, POST", "X-Sensitive": "header-secret", "Set-Cookie": "token=secret",
        })

    return app


def test_http_error_is_generic_and_correlated(caplog):
    caplog.set_level(logging.INFO, logger="evogym.api")
    response = run(app_with_routes(), path="/secret?token=query-secret", headers={"Authorization": "Bearer header-secret"})
    assert response.status_code == 403
    assert response.headers["x-request-id"]
    assert response.json() == {"error": {"code": "http_error", "message": "The request could not be completed.", "request_id": response.headers["x-request-id"]}}
    assert "raw-token" not in response.text
    assert "header-secret" not in caplog.text and "query-secret" not in caplog.text


def test_validation_does_not_echo_submitted_secret():
    response = run(app_with_routes(), "POST", "/payload", json={"value": "pin-777"})
    assert response.status_code == 422
    assert "pin-777" not in response.text
    assert response.json()["error"]["code"] == "validation_error"


def test_unhandled_error_is_generic_even_when_test_client_does_not_raise(caplog):
    caplog.set_level(logging.INFO, logger="evogym.api")
    response = run(app_with_routes(), path="/crash", raise_server_exceptions=False)
    assert response.status_code == 500
    assert "not-for-output" not in response.text
    assert "private DSN" not in caplog.text


def test_unhandled_error_is_correlated_without_propagating_secret(caplog):
    caplog.set_level(logging.INFO)
    response = run(app_with_routes(), path="/crash?token=query-secret", raise_server_exceptions=True)
    assert response.status_code == 500
    assert response.headers["x-request-id"] == response.json()["error"]["request_id"]
    application_logs = "\n".join(record.getMessage() for record in caplog.records if record.name == "evogym.api")
    assert "private DSN" not in application_logs and "query-secret" not in application_logs


def test_unhandled_asgi_exception_gets_correlated_safe_response_without_server_rethrow():
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/raw-crash")
    def raw_crash():
        raise RuntimeError("password=private-secret")

    response = run(app, path="/raw-crash?token=query-secret", raise_server_exceptions=True)
    assert response.status_code == 500
    assert response.headers["x-request-id"] == response.json()["error"]["request_id"]
    assert "private-secret" not in response.text and "query-secret" not in response.text


def test_method_not_allowed_preserves_only_validated_allow_header():
    response = run(app_with_routes(), method="POST", path="/secret")
    assert response.status_code == 405
    assert response.headers["allow"]

    explicit = run(app_with_routes(), path="/bad-allow")
    assert explicit.headers["allow"] == "GET, POST"
    assert "x-sensitive" not in explicit.headers and "set-cookie" not in explicit.headers


def test_stream_exception_does_not_emit_second_response_start():
    app = app_with_routes()
    from fastapi.responses import StreamingResponse

    @app.get("/stream")
    async def stream():
        async def chunks():
            yield b"first"
            raise RuntimeError("stream secret")
        return StreamingResponse(chunks())

    response = run(app, path="/stream", raise_server_exceptions=True)
    assert response.status_code == 200
    assert response.content.startswith(b"first")
    assert "stream secret" not in response.text
