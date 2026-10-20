from uuid import uuid4
from time import perf_counter
import logging
import json

from app.observability.logging import log_request, request_context
from app.observability.metrics import RequestMetrics


class RequestIdMiddleware:
    """Pure ASGI middleware that assigns a server-owned correlation identifier."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        identifier = str(uuid4())
        scope.setdefault("state", {})["request_id"] = identifier

        async def send_with_identifier(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers = [(key, value) for key, value in headers if key.lower() != b"x-request-id"]
                headers.append((b"x-request-id", identifier.encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        started = perf_counter()
        status_code = 500
        with request_context(identifier):
            response_started = False
            response_complete = False
            send_failure = None

            async def observe_send(message):
                nonlocal status_code, response_started, response_complete, send_failure
                if message["type"] == "http.response.start":
                    status_code = message["status"]
                    response_started = True
                if message["type"] == "http.response.body" and not message.get("more_body", False):
                    response_complete = True
                try:
                    await send_with_identifier(message)
                except Exception as exc:
                    send_failure = exc
                    raise

            try:
                await self.app(scope, receive, observe_send)
            except Exception as exc:
                # Never propagate application exception text/tracebacks into the
                # server logger. Cancellation is not an Exception on supported runtimes.
                if exc is send_failure:
                    raise
                if not response_started:
                    body = json.dumps({"error": {
                        "code": "internal_error",
                        "message": "An internal error occurred.",
                        "request_id": identifier,
                    }}, separators=(",", ":")).encode("utf-8")
                    status_code = 500
                    await send_with_identifier({
                        "type": "http.response.start", "status": 500,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode("ascii"))],
                    })
                    response_started = True
                    await send({"type": "http.response.body", "body": body, "more_body": False})
                    response_complete = True
                elif not response_complete:
                    # Complete an already-started stream without a second start.
                    await send({"type": "http.response.body", "body": b"", "more_body": False})
            finally:
                elapsed_ms = (perf_counter() - started) * 1000
                route_object = scope.get("route")
                route = getattr(route_object, "path", "unmatched")
                method = scope.get("method", "OTHER")
                application = scope.get("app")
                metrics = getattr(application.state, "request_metrics", None) if application else None
                if isinstance(metrics, RequestMetrics):
                    metrics.observe(method, route, status_code, elapsed_ms)
                log_request(logging.getLogger("evogym.api"), method, route, status_code, elapsed_ms)
