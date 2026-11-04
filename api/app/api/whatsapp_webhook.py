"""Public WhatsApp webhook transport: size-bounded raw body, delegate to `app.gimi.whatsapp`."""
from fastapi import APIRouter, Query, Request
from fastapi.responses import PlainTextResponse
from starlette.concurrency import run_in_threadpool

from app.errors import HttpStatusError
from app.gimi import whatsapp

router = APIRouter(prefix="/api/v1/webhooks/whatsapp", tags=["whatsapp"])


@router.get("", response_class=PlainTextResponse)
def verify(
    request: Request,
    mode: str | None = Query(default=None, alias="hub.mode"),
    verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    challenge: str | None = Query(default=None, alias="hub.challenge"),
) -> str:
    return whatsapp.verify_subscription(request.app.state.settings, mode, verify_token, challenge)


@router.post("")
async def receive(request: Request) -> dict:
    settings = request.app.state.settings
    limit = settings.whatsapp_webhook_max_bytes
    declared = request.headers.get("content-length")
    if declared is not None and (not declared.isdigit() or int(declared) > limit):
        raise HttpStatusError(413)
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HttpStatusError(413)
        chunks.append(chunk)
    raw = b"".join(chunks)
    return await run_in_threadpool(
        whatsapp.handle_webhook, settings, request.app.state.session_factory, raw,
        request.headers.get("x-hub-signature-256"))
