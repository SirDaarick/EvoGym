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


@pytest.mark.parametrize(("code", "metadata"), [
    ("membership_access_denied", {"status": "expired", "reason": "period_expired"}),
    ("class_sample_already_used", None),
    ("class_sample_payment_unavailable", None),
    ("class_sample_payment_not_received", None),
    ("wrong_branch", None),
])
def test_trusted_domain_errors_preserve_only_declared_codes_and_metadata(code, metadata):
    from app.errors import PublicDomainError

    app = app_with_routes()

    @app.get("/domain")
    def domain():
        raise PublicDomainError(code, metadata=metadata)

    response = run(app, path="/domain")
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == code
    assert error["request_id"] == response.headers["x-request-id"]
    assert error.get("metadata") == metadata


@pytest.mark.parametrize(("code", "metadata"), [
    ("password=secret", None),
    ("membership_access_denied", {"status": "expired", "reason": "Bearer raw-token"}),
    ("membership_access_denied", {"status": "expired", "reason": "period_expired", "password": "secret"}),
    ("membership_access_denied", {"status": "expired", "reason": "transfer_missing_funds"}),
    ("membership_access_denied", None),
    ("class_sample_already_used", {"dsn": "postgresql://secret"}),
])
def test_trusted_domain_boundary_rejects_undeclared_values(code, metadata):
    from app.errors import PublicDomainError

    with pytest.raises(ValueError):
        PublicDomainError(code, metadata=metadata)


@pytest.mark.parametrize("detail", [
    {"code": "class_sample_already_used"},
    {"code": "membership_access_denied", "status": "expired", "reason": "period_expired"},
    {"code": "unknown", "password": "secret", "dsn": "postgresql://secret"},
    "Bearer raw-token password=secret",
])
def test_arbitrary_http_details_never_become_trusted_domain_errors(detail):
    app = app_with_routes()

    @app.get("/untrusted")
    def untrusted():
        raise HTTPException(409, detail)

    response = run(app, path="/untrusted")
    assert response.json()["error"]["code"] == "http_error"
    assert "metadata" not in response.json()["error"]
    assert "secret" not in response.text and "raw-token" not in response.text


def test_validation_exposes_only_closed_types_and_coarse_locations():
    response = run(app_with_routes(), "POST", "/payload", json={"value": "pin-777"})
    assert response.json()["error"]["issues"] == [{"location": ["body"], "type": "int_parsing"}]
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]


def test_validation_never_reflects_user_dictionary_keys_context_or_unknown_types():
    from fastapi.exceptions import RequestValidationError

    app = app_with_routes()

    @app.get("/validation-secrets")
    def validation_secrets():
        raise RequestValidationError([
            {"type": "int_parsing", "loc": ("body", "values", "Bearer raw-token"), "input": "password=secret", "ctx": {"dsn": "postgresql://secret"}},
            {"type": "extra_forbidden", "loc": ("body", "password=secret"), "input": "secret"},
            {"type": "password=secret", "loc": ("Bearer raw-token",), "input": "secret"},
        ])

    response = run(app, path="/validation-secrets")
    assert response.status_code == 422
    assert response.json()["error"]["issues"] == [
        {"location": ["body"], "type": "int_parsing"},
        {"location": ["body"], "type": "extra_forbidden"},
        {"location": [], "type": "invalid"},
    ]
    assert all(secret not in response.text for secret in ("password", "secret", "raw-token", "postgresql"))


def test_validation_issue_output_is_bounded():
    from fastapi.exceptions import RequestValidationError

    app = app_with_routes()

    @app.get("/many-errors")
    def many_errors():
        raise RequestValidationError([{"type": "missing", "loc": ("body", "private-field")} for _ in range(100)])

    response = run(app, path="/many-errors")
    assert len(response.json()["error"]["issues"]) == 20
    assert "private-field" not in response.text


def test_checkin_openapi_declares_domain_conflicts_and_safe_validation_responses():
    from app.main import create_app
    from app.settings import Settings

    schema = create_app(Settings(environment="test", _env_file=None)).openapi()
    for suffix in ("periods/{period_id}", "samples/{entitlement_id}"):
        responses = schema["paths"][f"/api/v1/member-check-ins/branches/{{branch_id}}/{suffix}"]["post"]["responses"]
        assert responses["409"]["content"]["application/json"]["schema"]["$ref"].endswith("/CheckInConflictResponse")
        assert responses["422"]["content"]["application/json"]["schema"]["$ref"].endswith("/ValidationErrorResponse")
    definitions = schema["components"]["schemas"]
    assert set(definitions["PublicDomainErrorBody"]["properties"]["code"]["enum"]) == {
        "membership_access_denied", "class_sample_already_used", "class_sample_payment_unavailable",
        "class_sample_payment_not_received", "wrong_branch",
    }
    assert definitions["ValidationIssue"]["properties"]["location"]["maxItems"] == 1


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
