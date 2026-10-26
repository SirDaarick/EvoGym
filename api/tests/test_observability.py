import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.observability.metrics import RequestMetrics
from app.observability.request_id import RequestIdMiddleware
from app.observability.logging import install_safe_logging, log_request, request_context, request_id


def test_ids_are_server_generated_for_http_requests():
    async def run():
        async def app(scope, receive, send):
            if scope["type"] == "http":
                await send({"type": "http.response.start", "status": 204, "headers": []})
                await send({"type": "http.response.body", "body": b""})
        wrapped = RequestIdMiddleware(app)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrapped), base_url="http://test") as client:
            first = await client.get("/x", headers={"X-Request-ID": "evil\r\nInjected: yes"})
            second = await client.get("/x", headers={"X-Request-ID": "same"})
        return first, second
    first, second = asyncio.run(run())
    assert first.headers["x-request-id"] != second.headers["x-request-id"]
    assert "\r" not in first.headers["x-request-id"]
    from uuid import UUID
    UUID(first.headers["x-request-id"])
    UUID(second.headers["x-request-id"])


def test_non_http_lifespan_scope_is_passed_through_unchanged(caplog):
    async def run():
        scope = {"type": "lifespan", "asgi": {"version": "3.0"}, "state": {"sentinel": object()}}
        original_state = scope["state"].copy()
        metrics = RequestMetrics()
        application = type("Application", (), {"state": type("State", (), {"request_metrics": metrics})()})()
        scope["app"] = application
        received = []
        sent = []

        async def receive():
            message = {"type": "lifespan.startup"}
            received.append(message)
            return message

        async def send(message):
            sent.append(message)

        async def app(actual_scope, actual_receive, actual_send):
            assert actual_scope is scope
            assert actual_receive is receive
            assert actual_send is send
            observed_request_ids.append(request_id())
            message = await actual_receive()
            await actual_send({"type": "lifespan.startup.complete", "message": message["type"]})

        wrapped = RequestIdMiddleware(app)
        before_metrics = metrics.snapshot()
        before_request_id = request_id()
        observed_request_ids = []
        await wrapped(scope, receive, send)
        return scope, original_state, received, sent, before_metrics, metrics.snapshot(), before_request_id, observed_request_ids

    logger = logging.getLogger("evogym.api")
    with caplog.at_level(logging.INFO, logger="evogym.api"):
        scope, original_state, received, sent, before_metrics, after_metrics, before_request_id, observed_request_ids = asyncio.run(run())
    assert scope["state"] == original_state
    assert received == [{"type": "lifespan.startup"}]
    assert sent == [{"type": "lifespan.startup.complete", "message": "lifespan.startup"}]
    assert after_metrics == before_metrics
    assert observed_request_ids == [before_request_id]
    assert request_id() == before_request_id
    assert not [record for record in caplog.records if record.name == "evogym.api"]


def test_non_http_websocket_scope_and_messages_are_passed_through_unchanged(caplog):
    async def run():
        scope = {"type": "websocket", "asgi": {"version": "3.0"}, "path": "/socket", "state": {"sentinel": object()}}
        original_state = scope["state"].copy()
        metrics = RequestMetrics()
        application = type("Application", (), {"state": type("State", (), {"request_metrics": metrics})()})()
        scope["app"] = application
        received = []
        sent = []
        incoming = {"type": "websocket.connect"}
        outgoing = {"type": "websocket.accept", "subprotocol": "unchanged"}

        async def receive():
            received.append(incoming)
            return incoming

        async def send(message):
            sent.append(message)

        async def app(actual_scope, actual_receive, actual_send):
            assert actual_scope is scope
            assert actual_receive is receive
            assert actual_send is send
            observed_request_ids.append(request_id())
            await actual_receive()
            await actual_send(outgoing)

        wrapped = RequestIdMiddleware(app)
        before_metrics = metrics.snapshot()
        before_request_id = request_id()
        observed_request_ids = []
        await wrapped(scope, receive, send)
        return scope, original_state, received, sent, incoming, outgoing, before_metrics, metrics.snapshot(), before_request_id, observed_request_ids

    logger = logging.getLogger("evogym.api")
    with caplog.at_level(logging.INFO, logger="evogym.api"):
        scope, original_state, received, sent, incoming, outgoing, before_metrics, after_metrics, before_request_id, observed_request_ids = asyncio.run(run())
    assert scope["state"] == original_state
    assert received == [incoming] and received[0] is incoming
    assert sent == [outgoing] and sent[0] is outgoing
    assert "headers" not in sent[0]
    assert after_metrics == before_metrics
    assert observed_request_ids == [before_request_id]
    assert request_id() == before_request_id
    assert not [record for record in caplog.records if record.name == "evogym.api"]


def test_request_context_is_isolated_between_concurrent_requests():
    async def run():
        async def app(scope, receive, send):
            if scope["type"] == "http":
                from app.observability.logging import request_id
                body = request_id().encode("ascii")
                await asyncio.sleep(0)
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": body})
        wrapped = RequestIdMiddleware(app)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrapped), base_url="http://test") as client:
            return await asyncio.gather(client.get("/one"), client.get("/two"))
    first, second = asyncio.run(run())
    assert first.text == first.headers["x-request-id"]
    assert second.text == second.headers["x-request-id"]
    assert first.text != second.text

def test_structured_logs_use_allowlisted_fields_only(caplog):
    logger = logging.getLogger("evogym.test")
    install_safe_logging(logger)
    with caplog.at_level(logging.INFO, logger="evogym.test"), request_context("00000000-0000-4000-8000-000000000001"):
        log_request(logger, "GET", "/members/{id}", 200, 3.25)
        log_request(logger, "GET", "/members/123?pin=secret", 200, 3)
    records = [json.loads(record.getMessage()) for record in caplog.records if record.name == "evogym.test"]
    assert len(records) == 2
    assert records[0]["request_id"] == "00000000-0000-4000-8000-000000000001"
    assert records[1]["route"] == "unmatched"
    assert all("secret" not in json.dumps(record) and "123" not in json.dumps(record) for record in records)
