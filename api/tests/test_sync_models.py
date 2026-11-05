"""Phase 5 B1: canonical JSON, envelope, sync devices, clock classification and sync schema."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import (
    Branch, ContingencyEvent, Order, Product, StaffUser, SyncAuditFlag, SyncDevice,
)
from app.errors import PublicDomainError, install_error_handlers
from app.sync.clock import classify_clock
from app.sync.devices import get_sync_device, provision_device, revoke_device, token_digest
from app.sync.envelope import (
    ArqueoClosePayload, CashSalePayload, CheckInPayload, ContingencyEventIn, ShiftOpenPayload,
    canonical_json, parse_payload, payload_hash,
)
from app.settings import Settings

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "docs/work-packages/contracts/F5-canonical-json-vectors.json").read_text("utf-8")
)["vectors"]
NOW = datetime(2026, 11, 5, 18, 0, tzinfo=timezone.utc)


def _db(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'sync.db').as_posix()}")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(engine)


def _seed(factory):
    with factory.begin() as session:
        branch = Branch(code="b1", name="B1")
        staff = StaffUser(login_identifier="admin@example.invalid")
        session.add_all([branch, staff])
        session.flush()
        return branch.id, staff.id


# ---- canonical JSON -------------------------------------------------------------------------------------

@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_canonical_json_matches_shared_vectors(vector):
    assert canonical_json(vector["input"]) == vector["canonical"]
    assert payload_hash(vector["input"]) == vector["sha256"]


@pytest.mark.parametrize("bad", [{"a": 1.5}, {"a": [1.0]}, {"a": float("nan")}, {"a": float("inf")}, {1: "x"}, {"a": object()}])
def test_canonical_json_rejects_floats_nan_and_foreign_types(bad):
    with pytest.raises(ValueError):
        canonical_json(bad)


# ---- envelope -------------------------------------------------------------------------------------------

def _envelope(**over):
    base = {
        "event_id": "REC-SUR1-00123", "seq": 123, "event_type": "attendance.check_in", "schema_version": 1,
        "actor_staff_id": str(uuid4()), "payload": {}, "payload_hash": "a" * 64,
        "client_recorded_at": "2026-11-05T18:04:05.123Z",
    }
    return {**base, **over}


def test_envelope_accepts_valid_and_requires_aware_timestamps():
    event = ContingencyEventIn.model_validate(_envelope(clock_anchor_utc="2026-11-05T18:00:00Z", clock_monotonic_delta_ms=5))
    assert event.device_prefix == "REC-SUR1"
    with pytest.raises(ValidationError):
        ContingencyEventIn.model_validate(_envelope(client_recorded_at="2026-11-05T18:04:05"))


@pytest.mark.parametrize("over", [
    {"event_id": "rec-sur1-00123"}, {"event_id": "REC-SUR1-123"}, {"event_id": "REC-S-00123"},
    {"event_id": "REC-SUR1-00123; DROP"}, {"seq": 0}, {"event_type": "membership.cash_renewal"},
    {"payload_hash": "A" * 64}, {"payload_hash": "a" * 63}, {"extra": 1},
])
def test_envelope_rejects_invalid_fields(over):
    with pytest.raises(ValidationError):
        ContingencyEventIn.model_validate(_envelope(**over))


def _sale(**over):
    base = {
        "register_id": str(uuid4()), "local_shift_ref": "REC-SUR1-00007",
        "items": [{"product_id": str(uuid4()), "quantity": 2, "unit_price_minor": 2500}], "total_minor": 5000,
    }
    return {**base, **over}


def test_payload_models_validate_each_type():
    assert isinstance(parse_payload("pos.cash_sale", _sale(online_idempotency_key="k-1:a.b")), CashSalePayload)
    assert isinstance(parse_payload("attendance.check_in", {
        "member_id": str(uuid4()), "period_id": str(uuid4()), "branch_id": str(uuid4()), "local_access_decision": "valid",
    }), CheckInPayload)
    assert isinstance(parse_payload("shift.open", {"register_id": str(uuid4()), "opening_cash_minor": 100}), ShiftOpenPayload)
    assert isinstance(parse_payload("shift.arqueo_close", {
        "shift_ref": "REC-SUR1-00001", "denomination_counts": [{"denomination_minor": 100, "quantity": 3}],
        "voucher_count": 0, "closing_notes": "ok",
    }), ArqueoClosePayload)


@pytest.mark.parametrize("payload", [
    _sale(extra=1), _sale(items=[]), _sale(total_minor=-1), _sale(online_idempotency_key="bad key!"),
    _sale(items=[{"product_id": str(uuid4()), "quantity": 0, "unit_price_minor": 1}]),
    _sale(items=[{"product_id": str(uuid4()), "quantity": 1, "unit_price_minor": -1}]),
    _sale(items=[{"product_id": str(uuid4()), "quantity": 1, "unit_price_minor": 1.5}]),
    {k: v for k, v in _sale().items() if k != "register_id"},
])
def test_cash_sale_payload_is_strict(payload):
    with pytest.raises(ValidationError):
        parse_payload("pos.cash_sale", payload)


def test_parse_payload_rejects_extra_fields_and_unknown_type():
    with pytest.raises(ValidationError):
        parse_payload("shift.open", {"register_id": str(uuid4()), "opening_cash_minor": 1, "x": 1})
    with pytest.raises(ValueError):
        parse_payload("nope", {})


# ---- clock ----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("offset_s,expected", [
    (0, "within_tolerance"), (299, "within_tolerance"), (300, "within_tolerance"), (-300, "within_tolerance"),
    (301, "clock_skew"), (-301, "clock_skew"),
])
def test_classify_clock_boundaries(offset_s, expected):
    anchor = NOW
    delta_ms = 60_000
    recorded = anchor + timedelta(milliseconds=delta_ms, seconds=offset_s)
    assert classify_clock(recorded, anchor, delta_ms) == expected


def test_classify_clock_unverified_without_anchor_or_valid_delta():
    assert classify_clock(NOW, None, 0) == "unverified_clock"
    assert classify_clock(NOW, NOW, None) == "unverified_clock"
    assert classify_clock(NOW, NOW, -1) == "unverified_clock"
    assert classify_clock(NOW, NOW, 0, tolerance_s=10) == "within_tolerance"
    assert classify_clock(NOW + timedelta(seconds=11), NOW, 0, tolerance_s=10) == "clock_skew"


# ---- devices --------------------------------------------------------------------------------------------

def test_provision_stores_only_digest_and_rotation_revokes_and_keeps_sequence(tmp_path):
    engine, factory = _db(tmp_path)
    try:
        branch_id, staff_id = _seed(factory)
        with factory.begin() as session:
            first, token = provision_device(
                session, branch_id=branch_id, station_code="sur1", reception_station_id=None,
                provisioned_by=staff_id, ttl_days=30, rotate=False, now=NOW)
            assert first.device_prefix == "REC-SUR1"
            assert first.token_digest == token_digest(token) and token not in first.token_digest
            assert len(token) >= 43
            assert first.expires_at == NOW + timedelta(days=30)
            first.last_ingested_seq = 122
            first_id = first.id
        with factory.begin() as session:
            second, token2 = provision_device(
                session, branch_id=branch_id, station_code="SUR1", reception_station_id=None,
                provisioned_by=staff_id, ttl_days=30, rotate=True, now=NOW + timedelta(hours=1))
            assert token2 != token
            assert second.last_ingested_seq == 122  # next seq = 123
            assert session.get(SyncDevice, first_id).revoked_at is not None
            assert second.revoked_at is None
        with factory() as session:
            raw = [row.token_digest for row in session.scalars(select(SyncDevice))]
            assert token not in raw and token2 not in raw
        with pytest.raises(ValueError):
            with factory.begin() as session:
                provision_device(session, branch_id=branch_id, station_code="x", reception_station_id=None,
                                 provisioned_by=staff_id, ttl_days=1, rotate=False)
    finally:
        engine.dispose()


def test_station_code_cannot_cross_branches(tmp_path):
    engine, factory = _db(tmp_path)
    try:
        branch_id, staff_id = _seed(factory)
        with factory.begin() as session:
            other = Branch(code="b2", name="B2")
            session.add(other)
            session.flush()
            provision_device(session, branch_id=branch_id, station_code="SUR1", reception_station_id=None,
                             provisioned_by=staff_id, ttl_days=1, rotate=False)
            with pytest.raises(ValueError):
                provision_device(session, branch_id=other.id, station_code="SUR1", reception_station_id=None,
                                 provisioned_by=staff_id, ttl_days=1, rotate=False)
    finally:
        engine.dispose()


def _auth_app(factory):
    app = FastAPI()
    install_error_handlers(app)
    app.state.session_factory = factory

    @app.get("/probe")
    def probe(device: SyncDevice = Depends(get_sync_device)):
        return {"prefix": device.device_prefix}

    return app


def test_get_sync_device_authentication_cases(tmp_path):
    engine, factory = _db(tmp_path)
    try:
        branch_id, staff_id = _seed(factory)
        with factory.begin() as session:
            live, live_token = provision_device(
                session, branch_id=branch_id, station_code="LIVE", reception_station_id=None,
                provisioned_by=staff_id, ttl_days=30, rotate=False)
            dead, dead_token = provision_device(
                session, branch_id=branch_id, station_code="DEAD", reception_station_id=None,
                provisioned_by=staff_id, ttl_days=30, rotate=False)
            old, old_token = provision_device(
                session, branch_id=branch_id, station_code="OLD1", reception_station_id=None,
                provisioned_by=staff_id, ttl_days=30, rotate=False)
            old.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            dead_id = dead.id
        with factory.begin() as session:
            revoke_device(session, dead_id)
        client = TestClient(_auth_app(factory))
        assert client.get("/probe", headers={"Authorization": f"Bearer {live_token}"}).json() == {"prefix": "REC-LIVE"}
        assert client.get("/probe").status_code == 401
        assert client.get("/probe", headers={"Authorization": "Bearer nope"}).status_code == 401
        assert client.get("/probe", headers={"Authorization": f"Basic {live_token}"}).status_code == 401
        revoked = client.get("/probe", headers={"Authorization": f"Bearer {dead_token}"})
        assert revoked.status_code == 401 and revoked.json()["error"]["code"] == "sync_device_revoked"
        expired = client.get("/probe", headers={"Authorization": f"Bearer {old_token}"})
        assert expired.status_code == 401 and expired.json()["error"]["code"] == "sync_device_expired"
    finally:
        engine.dispose()


def test_new_domain_error_codes_have_messages():
    for code, status in (("sync_device_revoked", 401), ("sync_device_expired", 401),
                         ("sync_snapshot_required", 409), ("sync_batch_too_large", 413)):
        error = PublicDomainError(code)
        assert error.status == status and error.message


def test_sync_settings_defaults():
    s = Settings(_env_file=None)
    assert (s.sync_device_token_ttl_days, s.sync_offline_grant_ttl_hours, s.sync_batch_max_events,
            s.sync_batch_max_bytes, s.sync_delta_page_size, s.sync_delta_max_age_days,
            s.sync_clock_skew_tolerance_seconds) == (30, 24, 100, 262144, 500, 7, 300)


# ---- schema ---------------------------------------------------------------------------------------------

def _event(device_id, staff_id, event_id="REC-SUR1-00001", seq=1, **over):
    return ContingencyEvent(
        device_id=device_id, event_id=event_id, seq=seq, event_type="shift.open", schema_version=1,
        actor_staff_id=staff_id, payload={}, payload_hash="a" * 64, client_recorded_at=NOW, status="accepted", **over)


def test_contingency_event_uniqueness_and_flag_constraints(tmp_path):
    engine, factory = _db(tmp_path)
    try:
        branch_id, staff_id = _seed(factory)
        with factory.begin() as session:
            device, _ = provision_device(session, branch_id=branch_id, station_code="SUR1", reception_station_id=None,
                                         provisioned_by=staff_id, ttl_days=1, rotate=False)
            device_id = device.id
            row = _event(device_id, staff_id)
            session.add(row)
            session.flush()
            session.add(SyncAuditFlag(event_row_id=row.id, branch_id=branch_id, kind="clock_skew", details={"s": 1}))
        with pytest.raises(IntegrityError):
            with factory.begin() as session:
                session.add(_event(device_id, staff_id, seq=2))  # duplicate event_id
        with pytest.raises(IntegrityError):
            with factory.begin() as session:
                session.add(_event(device_id, staff_id, event_id="REC-SUR1-00009", seq=1))  # duplicate (device, seq)
        with pytest.raises(IntegrityError):
            with factory.begin() as session:
                session.add(_event(device_id, staff_id, event_id="REC-SUR1-00010", seq=10, ) )
                session.flush()
                session.add(SyncAuditFlag(event_row_id=session.scalar(select(ContingencyEvent.id).where(
                    ContingencyEvent.seq == 10)), branch_id=branch_id, kind="bogus", details={}))
    finally:
        engine.dispose()


def _order(branch_id, staff_id, key, **over):
    return Order(branch_id=branch_id, register_id=uuid4(), shift_id=uuid4(), seller_id=staff_id,
                 idempotency_key=key, request_fingerprint="b" * 64, total_minor=100, order_kind="product", **over)


def test_order_origin_defaults_online_and_receipt_number_is_unique_and_checked(tmp_path):
    engine, factory = _db(tmp_path)  # SQLite does not enforce FKs here, so random ids are fine
    try:
        branch_id, staff_id = _seed(factory)
        with factory.begin() as session:
            plain, second_plain = _order(branch_id, staff_id, "k1"), _order(branch_id, staff_id, "k2")
            session.add_all([plain, second_plain, _order(branch_id, staff_id, "k3", origin="contingency",
                                                         offline_receipt_number="REC-SUR1-00001")])
            session.flush()
            session.refresh(plain)
            assert plain.origin == "online" and plain.offline_receipt_number is None
            assert second_plain.offline_receipt_number is None  # multiple NULLs allowed
        with pytest.raises(IntegrityError):
            with factory.begin() as session:
                session.add(_order(branch_id, staff_id, "k4", offline_receipt_number="REC-SUR1-00001"))
        with pytest.raises(IntegrityError):
            with factory.begin() as session:
                session.add(_order(branch_id, staff_id, "k5", origin="martian"))
    finally:
        engine.dispose()


def test_product_updated_at_set_and_bumped_on_update(tmp_path):
    engine, factory = _db(tmp_path)
    try:
        _branch_id, staff_id = _seed(factory)
        with factory.begin() as session:
            product = Product(code="p", name="P", created_by=staff_id)
            session.add(product)
            session.flush()
            session.refresh(product)
            assert product.updated_at is not None
            product_id = product.id
        with factory.begin() as session:
            session.get(Product, product_id).price_minor = 5
        with factory() as session:
            assert session.get(Product, product_id).price_minor == 5
    finally:
        engine.dispose()
