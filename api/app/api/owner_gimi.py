"""Owner Gimi and Notifications HTTP transport: call app.gimi.service."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile

from app.api.deps import FinancePrincipal, RawFactoryDep, SettingsDep, _bearer, _principal
from app.gimi import service
from app.gimi.dispatcher import GimiActor
from app.gimi.orchestrator import GimiOrchestrator
from app.gimi.schemas import DeliverBatchInput, GimiChatRequest, GimiChatResponse, KnowledgeRuleInput
from app.gimi.tool_definitions import GimiRole

router = APIRouter(prefix="/api/v1/owner/gimi", tags=["owner-gimi"])


def _gimi_principal(request: Request, credentials=Depends(_bearer)) -> FinancePrincipal:
    return _principal(request, credentials)


Principal = Annotated[FinancePrincipal, Depends(_gimi_principal)]


@router.get("/overview")
def get_overview(factory: RawFactoryDep, principal: Principal):
    return service.get_gimi_overview(factory, principal)


@router.get("/knowledge")
def list_knowledge(
    factory: RawFactoryDep,
    principal: Principal,
    source_kind: str | None = Query(None),
):
    return service.list_knowledge_chunks(factory, principal, source_kind=source_kind)


@router.post("/knowledge", status_code=201)
def create_knowledge_rule(
    payload: KnowledgeRuleInput,
    factory: RawFactoryDep,
    principal: Principal,
):
    return service.create_knowledge_rule(factory, principal, payload)


@router.post("/knowledge/upload", status_code=201)
async def upload_knowledge_document(
    factory: RawFactoryDep,
    principal: Principal,
    file: UploadFile = File(...),
    category: str = Form("regulations"),
    title: str | None = Form(None),
):
    content = await file.read()
    return service.upload_knowledge_document(
        factory,
        principal,
        file_bytes=content,
        filename=file.filename or "document.txt",
        category=category,
        title=title,
    )


@router.delete("/knowledge/{chunk_id}")
def delete_knowledge(
    chunk_id: UUID,
    factory: RawFactoryDep,
    principal: Principal,
):
    return service.delete_knowledge_chunk(factory, principal, chunk_id)


@router.get("/notifications")
def list_notifications(
    factory: RawFactoryDep,
    principal: Principal,
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
):
    return service.list_outbox_notifications(factory, principal, status=status, limit=limit)


@router.post("/notifications/deliver")
def deliver_notifications(
    payload: DeliverBatchInput,
    factory: RawFactoryDep,
    principal: Principal,
    settings: SettingsDep,
):
    return service.trigger_outbox_delivery(factory, principal, payload, settings=settings)


@router.post("/chat", response_model=GimiChatResponse)
def chat_with_gimi(
    payload: GimiChatRequest,
    factory: RawFactoryDep,
    principal: Principal,
    settings: SettingsDep,
):
    orchestrator = GimiOrchestrator(settings=settings)
    actor = GimiActor(
        role=GimiRole.OWNER,
        staff_user_id=principal.staff_id,
        branch_id=principal.branch_id,
    )
    with factory() as session:
        res = orchestrator.interact(
            session=session,
            actor=actor,
            message=payload.message,
            confirmed=payload.confirmed,
            cached_draft=payload.cached_draft,
            cached_tool=payload.cached_tool,
        )
        return GimiChatResponse(
            reply_text=res.reply_text,
            tool_called=res.tool_called,
            status=res.status.value,
            confidence=res.confidence,
            needs_confirmation=res.needs_confirmation,
            draft_action=res.draft_action,
            data=res.data,
        )


from app.gimi.schemas import WhatsappSimulateInput, WhatsappSimulateResponse

@router.post("/whatsapp/simulate", response_model=WhatsappSimulateResponse)
def simulate_whatsapp(
    payload: WhatsappSimulateInput,
    factory: RawFactoryDep,
    principal: Principal,
    settings: SettingsDep,
):
    return service.simulate_whatsapp_inbound(factory, principal, payload, settings=settings)
