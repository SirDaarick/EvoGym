"""Owner Gimi and Notifications HTTP transport: call app.gimi.service."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile

from app.api.deps import FinancePrincipal, RawFactoryDep, SettingsDep, _bearer, _principal
from app.gimi import service
from app.gimi.schemas import DeliverBatchInput, KnowledgeRuleInput

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
