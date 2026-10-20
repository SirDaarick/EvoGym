from contextlib import contextmanager
from contextvars import ContextVar
import json
import logging
import re

_REQUEST_ID: ContextVar[str] = ContextVar("evogym_request_id", default="")
_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"})
_ROUTE = re.compile(r"^/[A-Za-z0-9_/{}/.-]{0,160}$")


def request_id() -> str:
    return _REQUEST_ID.get()


@contextmanager
def request_context(identifier: str):
    token = _REQUEST_ID.set(identifier)
    try:
        yield
    finally:
        _REQUEST_ID.reset(token)


def safe_dimensions(method: object, route: object, status: object) -> tuple[str, str, str]:
    normalized_method = method if isinstance(method, str) and method in _METHODS else "OTHER"
    normalized_route = route if isinstance(route, str) and len(route) <= 160 and _ROUTE.fullmatch(route) else "unmatched"
    try:
        numeric_status = int(status)
    except (ValueError, TypeError, OverflowError):
        numeric_status = 0
    status_class = f"{numeric_status // 100}xx" if 100 <= numeric_status <= 599 else "other"
    return normalized_method, normalized_route, status_class


def install_safe_logging(logger: logging.Logger) -> None:
    """Keep logger configuration app-scoped; do not mutate root handlers."""
    logger.setLevel(logging.INFO)


def log_request(logger: logging.Logger, method: object, route: object, status: object, duration_ms: object) -> None:
    safe_method, safe_route, safe_status = safe_dimensions(method, route, status)
    try:
        status_code = int(status)
    except (ValueError, TypeError, OverflowError):
        status_code = 0
    if not 100 <= status_code <= 599:
        status_code = 0
    try:
        duration = float(duration_ms)
    except (ValueError, TypeError, OverflowError):
        duration = 0.0
    if not 0 <= duration <= 3_600_000:
        duration = 0.0
    logger.info(json.dumps({
        "event": "request.complete",
        "request_id": request_id(),
        "method": safe_method,
        "route": safe_route,
        "status": status_code,
        "status_class": safe_status,
        "duration_ms": round(duration, 3),
    }, ensure_ascii=True, separators=(",", ":")))
