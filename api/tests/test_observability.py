import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.observability.request_id import RequestIdMiddleware
from app.observability.logging import install_safe_logging, log_request, request_context


def test_ids_are_server_generated_for_normal_and_non_http_asgi():
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
