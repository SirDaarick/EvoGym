import re

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.observability.logging import request_id


def _response(status_code: int, code: str, message: str, request: Request) -> JSONResponse:
    identifier = request_id()
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "request_id": identifier}},
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
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        messages = {404: "The requested resource was not found.", 405: "The request method is not allowed."}
        response = _response(exc.status_code, "http_error", messages.get(exc.status_code, "The request could not be completed."), request)
        response.headers.update(_safe_protocol_headers(exc))
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, _exc: RequestValidationError) -> JSONResponse:
        return _response(422, "validation_error", "The request is invalid.", request)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, _exc: Exception) -> JSONResponse:
        return _response(500, "internal_error", "An internal error occurred.", request)
