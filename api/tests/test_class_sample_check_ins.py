from uuid import UUID
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import ClassSampleEntitlement
from app.main import create_app
from app.api.member_check_ins import _resolve_sample_checkin_conflict
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db


def test_conflict_resolution_prefers_matching_idempotency_key_to_consumed_entitlement():
    replay_event = SimpleNamespace(request_fingerprint="same-request")
    prior_use = SimpleNamespace(request_fingerprint="other-request")
    event, replayed = _resolve_sample_checkin_conflict(
        key_event=replay_event, entitlement_event=prior_use, fingerprint="same-request",
    )
    assert event is replay_event
    assert replayed is True


def test_conflict_resolution_rejects_key_reuse_with_different_fingerprint():
    replay_event = SimpleNamespace(request_fingerprint="first-request")
    with pytest.raises(HTTPException, match="different check-in"):
        _resolve_sample_checkin_conflict(
            key_event=replay_event, entitlement_event=None, fingerprint="different-request",
        )


def test_sample_checkin_consumes_once_and_retry_returns_original_event(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "sample-check-in", "Sample Check-in")
        staff_id, token = _seed_receptionist(factory, branch_id)
        # Build a paid sample through the normal sale flow.
        from app.db.models import Member, Plan, PlanVersion
        from app.shifts.queries import create_cash_register
        from test_shifts import open_shift
        with factory.begin() as session:
            member = Member(member_number="SOC-SAMPLE-CI", full_name="Sample Member", phone="5550100")
            plan = Plan(code="sample-ci", name="Sample", kind="membership", status="active")
            session.add_all([member, plan]); session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Sample v1", price_minor=100,
                currency="MXN", duration_value=None, duration_unit=None, entitlement_mode="single_entry", is_active=True)
            session.add(version); session.flush()
            register = create_cash_register(session, branch_id, "sample-ci-register", "Sample CI")
            open_shift(session, register_id=register.id, opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_id, version_id, register_id = member.id, version.id, register.id
        with TestClient(create_app(configured_settings(url))) as client:
            sale = client.post(f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "sample-ci-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)})
            assert sale.status_code == 201, sale.text
            entitlement = sale.json()["sample_entitlement"]
            path = f"/api/v1/member-check-ins/branches/{branch_id}/samples/{entitlement['id']}"
            headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "sample-ci-once"}
            first = client.post(path, headers=headers)
            assert first.status_code == 201, first.text
            replay = client.post(path, headers=headers)
            assert replay.status_code == 200 and replay.json()["id"] == first.json()["id"]
            denied_reentry = client.post(path, headers={**headers, "Idempotency-Key": "sample-ci-again"})
            assert denied_reentry.status_code == 409
            with factory() as session:
                assert session.scalar(select(ClassSampleEntitlement.id).where(
                    ClassSampleEntitlement.id == UUID(entitlement["id"]))) is not None
                from app.db.models.class_samples import ClassSampleCheckIn
                events = session.scalars(select(ClassSampleCheckIn).where(
                    ClassSampleCheckIn.entitlement_id == UUID(entitlement["id"]))).all()
                assert len(events) == 1
    finally:
        engine.dispose()
