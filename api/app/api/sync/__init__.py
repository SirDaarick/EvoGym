"""Phase 5 contingency sync API: aggregates the sub-routers so main.py registers a single router."""

from fastapi import APIRouter

from app.api.sync.audit import router as audit_router
from app.api.sync.bootstrap import router as bootstrap_router
from app.api.sync.delta import router as delta_router
from app.api.sync.events import router as events_router

router = APIRouter()
for _sub in (bootstrap_router, events_router, delta_router, audit_router):
    router.include_router(_sub)
