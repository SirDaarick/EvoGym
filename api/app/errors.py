from contextlib import contextmanager
from typing import Literal, get_args

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.observability.logging import request_id


DomainCode = Literal[
    "membership_access_denied", "debt_confirmation_required", "class_sample_already_used", "class_sample_payment_unavailable",
    "class_sample_payment_not_received", "wrong_branch", "member_phone_exists",
    "sync_device_revoked", "sync_device_expired", "sync_snapshot_required", "sync_batch_too_large",
]


class MembershipDenialMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["not_found", "wrong_branch", "expired", "not_yet_valid", "blocked_missing_funds"]
    reason: Literal[
        "membership_not_found", "wrong_branch", "period_expired", "period_not_started",
        "transfer_not_received", "transfer_missing_funds", "admin_payment_restriction",
    ]

    @model_validator(mode="after")
    def require_matching_reason(self):
        reasons = {
            "not_found": {"membership_not_found"}, "wrong_branch": {"wrong_branch"},
            "expired": {"period_expired"}, "not_yet_valid": {"period_not_started"},
            "blocked_missing_funds": {"transfer_not_received", "transfer_missing_funds", "admin_payment_restriction"},
        }
        if self.reason not in reasons[self.status]:
            raise ValueError("Public denial status and reason must match.")
        return self


class PublicDomainPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: DomainCode
    metadata: MembershipDenialMetadata | None = None

    @model_validator(mode="after")
    def require_declared_metadata(self):
        if (self.code == "membership_access_denied") != (self.metadata is not None):
            raise ValueError("Only membership denials require declared metadata.")
        return self


class AppError(Exception):
    """Typed error rendered as the envelope. Subclasses fix code/status/message; args stay internal."""

    code = "app_error"
    status = 500
    message = "An internal error occurred."
    metadata: MembershipDenialMetadata | None = None


_HTTP_MESSAGES = {404: "The requested resource was not found.", 405: "The request method is not allowed."}


def http_error_message(status: int) -> str:
    return _HTTP_MESSAGES.get(status, "The request could not be completed.")


class HttpStatusError(AppError):
    """Service-side stand-in for HTTPException(status): same wire output as the http_error handler."""

    code = "http_error"

    def __init__(self, status: int):
        self.status = status
        super().__init__(status)

    @property
    def message(self):
        return http_error_message(self.status)


@contextmanager
def http_errors(*mapping):
    """Translate domain exceptions to HttpStatusError, first match wins; status None re-raises as is."""
    try:
        yield
    except Exception as exc:
        for kind, status in mapping:
            if isinstance(exc, kind):
                if status is None:
                    raise
                raise HttpStatusError(status) from exc
        raise


class PublicDomainError(AppError):
    """Explicit internal boundary; arbitrary HTTPException details never enter it."""

    status = 409  # All currently admitted business denials are conflicts.

    def __init__(self, code: str, *, metadata: dict | None = None):
        self.payload = PublicDomainPayload.model_validate({"code": code, "metadata": metadata})
        self.status = _STATUS_OVERRIDES.get(self.payload.code, 409)
        super().__init__(self.payload.code)

    @property
    def code(self):
        return self.payload.code

    @property
    def message(self):
        return _PUBLIC_MESSAGES[self.payload.code]

    @property
    def metadata(self):
        return self.payload.metadata


class PublicDomainErrorBody(PublicDomainPayload):
    message: str
    request_id: str


class GenericHttpErrorBody(BaseModel):
    code: Literal["http_error"]
    message: str
    request_id: str


class CheckInConflictResponse(BaseModel):
    error: PublicDomainErrorBody | GenericHttpErrorBody


class ValidationIssue(BaseModel):
    location: list[Literal["body", "query", "path", "header", "cookie"]] = Field(max_length=1)
    type: Literal[
        "missing", "int_parsing", "int_type", "string_type", "bool_parsing", "uuid_parsing",
        "extra_forbidden", "json_invalid", "greater_than", "greater_than_equal", "less_than",
        "less_than_equal", "string_too_short", "string_too_long", "string_pattern_mismatch",
        "literal_error", "invalid",
    ]


class ValidationErrorBody(BaseModel):
    code: Literal["validation_error"]
    message: str
    request_id: str
    issues: list[ValidationIssue] = Field(max_length=20)


class ValidationErrorResponse(BaseModel):
    error: ValidationErrorBody


_STATUS_OVERRIDES = {"sync_device_revoked": 401, "sync_device_expired": 401, "sync_batch_too_large": 413}
_PUBLIC_MESSAGES = {
    "membership_access_denied": "Membership access was denied.",
    "debt_confirmation_required": "Confirm entry despite the outstanding balance.",
    "class_sample_already_used": "The class sample has already been used.",
    "class_sample_payment_unavailable": "The class sample payment is unavailable.",
    "class_sample_payment_not_received": "The class sample payment has not been received.",
    "wrong_branch": "The entitlement belongs to another branch.",
    "member_phone_exists": "Another member already uses this phone number.",
    "sync_device_revoked": "The device was revoked; sync again from a session with internet access.",
    "sync_device_expired": "The device authorization expired; sync again with internet access.",
    "sync_snapshot_required": "A full data download (bootstrap) is required before continuing.",
    "sync_batch_too_large": "The event batch exceeds the allowed size.",
}
_VALIDATION_TYPES = set(get_args(ValidationIssue.model_fields["type"].annotation))
_VALIDATION_SOURCES = {"body", "query", "path", "header", "cookie"}


def _response(status_code: int, code: str, message: str, request: Request, *,
              metadata: MembershipDenialMetadata | None = None, issues: list[ValidationIssue] | None = None) -> JSONResponse:
    identifier = request_id()
    error = {"code": code, "message": message, "request_id": identifier}
    if metadata is not None:
        error["metadata"] = metadata.model_dump(mode="json")
    if issues is not None:
        error["issues"] = [issue.model_dump(mode="json") for issue in issues]
    return JSONResponse(
        status_code=status_code,
        content={"error": error},
        headers={"X-Request-ID": identifier},
    )


def _safe_protocol_headers(exc: StarletteHTTPException) -> dict[str, str]:
    """Preserve only a validated Allow header needed for 405 responses."""
    if exc.status_code != 405 or not isinstance(exc.headers, dict):
        return {}
    raw = exc.headers.get("Allow") or exc.headers.get("allow")
    if not isinstance(raw, str) or len(raw) > 128:
        return {}
    allowed_methods = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
    methods = [part.strip().upper() for part in raw.split(",")]
    if not methods or any(method not in allowed_methods for method in methods):
        return {}
    return {"Allow": ", ".join(dict.fromkeys(methods))}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError) -> JSONResponse:
        return _response(exc.status, exc.code, exc.message, request, metadata=exc.metadata)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        response = _response(exc.status_code, "http_error", http_error_message(exc.status_code), request)
        response.headers.update(_safe_protocol_headers(exc))
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        issues = []
        for error in exc.errors()[:20]:
            location = error.get("loc", ())
            source = location[0] if location else None
            kind = error.get("type")
            # Nested keys, extra-field names, messages, inputs and ctx may contain secrets.
            issues.append(ValidationIssue(
                location=[source] if isinstance(source, str) and source in _VALIDATION_SOURCES else [],
                type=kind if isinstance(kind, str) and kind in _VALIDATION_TYPES else "invalid",
            ))
        return _response(422, "validation_error", "The request is invalid.", request, issues=issues)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, _exc: Exception) -> JSONResponse:
        return _response(500, "internal_error", "An internal error occurred.", request)


def session_factory(factory):
    """Shared by services: a missing DB factory is a 503. Lives here beside HttpStatusError, which it raises."""
    if factory is None:
        raise HttpStatusError(503)
    return factory
