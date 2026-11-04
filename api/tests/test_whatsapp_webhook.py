import hashlib
import hmac
import json
from datetime import date, timedelta, timezone, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import (
    Branch, Member, MembershipDebt, MembershipPeriod, NotificationOutbox, Order, WhatsappInboxMessage,
)
from app.gimi import domain_tools
from app.gimi.permissions import ToolDenied, authorize_tool
from app.gimi.whatsapp import GENERIC_UNVERIFIED, normalize_e164
from app.main import create_app
from app.notifications.delivery import FakeDeliveryAdapter, deliver_batch
from app.settings import Settings

SECRET = "synthetic-whatsapp-app-secret"
TOKEN = "synthetic-verify-token"
PATH = "/api/v1/webhooks/whatsapp"
KNOWN = "+5215512345678"


def _settings(url, **extra):
    return Settings(environment="test", database_url=url, _env_file=None, **extra)


def _sign(body: bytes, secret=SECRET) -> dict:
    return {"X-Hub-Signature-256": "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(),
            "Content-Type": "application/json"}


def _payload(message_id="wamid.1", sender="5215512345678", text="adeudo", kind="text"):
    message = {"from": sender, "id": message_id, "type": kind}
    if kind == "text":
        message["text"] = {"body": text}
    return json.dumps({"object": "whatsapp_business_account",
                       "entry": [{"changes": [{"value": {"messages": [message]}}]}]}).encode()


@pytest.fixture
def env(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'wa.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory.begin() as session:
        session.add_all([
            Member(member_number="WA-1", full_name="Ana Lopez", phone=KNOWN),
            Member(member_number="WA-2", full_name="Dup One", phone="+5215500000001"),
            Member(member_number="WA-3", full_name="Dup Two", phone="+5215500000001"),
            Member(member_number="WA-4", full_name="Near Miss", phone="+5215512345679"),
        ])
    app = create_app(_settings(url, whatsapp_app_secret=SECRET, whatsapp_verify_token=TOKEN))
    with TestClient(app) as client:
        yield client, factory
    engine.dispose()


def _outbox(factory):
    with factory() as session:
        return session.scalars(select(NotificationOutbox).order_by(NotificationOutbox.created_at)).all()


def test_normalize_e164():
    assert normalize_e164("5215512345678") == "+5215512345678"
    assert normalize_e164("+52 (155) 1234-5678") == "+5215512345678"
    for bad in ("", "abc", "0123456789", "12", "+" + "1" * 16, None, 5512345678):
        assert normalize_e164(bad) is None


def test_get_verification(env):
    client, _ = env
    ok = client.get(PATH, params={"hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "12345"})
    assert ok.status_code == 200 and ok.text == "12345"
    assert client.get(PATH, params={"hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "1"}).status_code == 403
    assert client.get(PATH, params={"hub.mode": "unsubscribe", "hub.verify_token": TOKEN, "hub.challenge": "1"}).status_code == 403
    assert client.get(PATH).status_code == 403


def test_disabled_without_secret_returns_503(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'off.db').as_posix()}"
    Base.metadata.create_all(create_engine(url))
    with TestClient(create_app(_settings(url))) as client:
        body = _payload()
        assert client.post(PATH, content=body, headers=_sign(body)).status_code == 503
        assert client.get(PATH, params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1"}).status_code == 503


def test_signature_missing_invalid_and_wrong_secret_are_rejected(env):
    client, factory = env
    body = _payload()
    assert client.post(PATH, content=body, headers={"Content-Type": "application/json"}).status_code == 401
    assert client.post(PATH, content=body, headers={"X-Hub-Signature-256": "sha256=deadbeef"}).status_code == 401
    assert client.post(PATH, content=body, headers={"X-Hub-Signature-256": "deadbeef"}).status_code == 401
    assert client.post(PATH, content=body, headers=_sign(body, "other-secret")).status_code == 401
    assert client.post(PATH, content=body + b" ", headers=_sign(body)).status_code == 401  # signed bytes differ
    assert _outbox(factory) == []
    with factory() as session:
        assert session.scalars(select(WhatsappInboxMessage)).all() == []


def test_signature_is_checked_before_parsing(env):
    client, _ = env
    assert client.post(PATH, content=b"{not json", headers={"X-Hub-Signature-256": "sha256=00"}).status_code == 401
    body = b"{not json"
    assert client.post(PATH, content=body, headers=_sign(body)).status_code == 400


def test_oversized_body_rejected(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'big.db').as_posix()}"
    Base.metadata.create_all(create_engine(url))
    app = create_app(_settings(url, whatsapp_app_secret=SECRET, whatsapp_verify_token=TOKEN, whatsapp_webhook_max_bytes=1024))
    with TestClient(app) as client:
        body = b"x" * 2048
        assert client.post(PATH, content=body, headers=_sign(body)).status_code == 413


def test_known_member_gets_reply_enqueued_and_duplicate_is_deduped(env):
    client, factory = env
    body = _payload(text="¿Cuál es mi adeudo?")
    assert client.post(PATH, content=body, headers=_sign(body)).json() == {"status": "ok"}
    assert client.post(PATH, content=body, headers=_sign(body)).status_code == 200  # provider retry
    rows = _outbox(factory)
    assert len(rows) == 1
    assert rows[0].recipient == KNOWN and rows[0].channel == "whatsapp" and rows[0].idempotency_key == "wa-reply:wamid.1"
    assert "Ana" in rows[0].body and "adeudos pendientes" in rows[0].body
    with factory() as session:
        inbox = session.scalars(select(WhatsappInboxMessage)).all()
        assert len(inbox) == 1 and inbox[0].outcome == "answered" and inbox[0].tool == "member_pending_balance"
        assert KNOWN not in inbox[0].sender_hash and inbox[0].reply_outbox_id == rows[0].id
    fake = FakeDeliveryAdapter()
    assert deliver_batch(factory, fake, now=datetime.now(timezone.utc) + timedelta(minutes=1)) == 1
    assert fake.sent[0].recipient == KNOWN


@pytest.mark.parametrize("sender", ["5215599999999", "5215500000001", "5215512345670", "5512345678"])
def test_unknown_ambiguous_or_inexact_numbers_get_identical_generic_reply(env, sender):
    client, factory = env
    body = _payload(sender=sender)
    assert client.post(PATH, content=body, headers=_sign(body)).status_code == 200
    rows = _outbox(factory)
    assert len(rows) == 1 and rows[0].body == GENERIC_UNVERIFIED
    with factory() as session:
        inbox = session.scalars(select(WhatsappInboxMessage)).one()
        assert inbox.outcome == "unverified" and inbox.member_id is None


def test_exact_match_does_not_pick_neighbor_number(env):
    client, factory = env
    body = _payload(sender="5215512345679")  # belongs to "Near Miss", not Ana
    client.post(PATH, content=body, headers=_sign(body))
    assert "Near" in _outbox(factory)[0].body and "Ana" not in _outbox(factory)[0].body


def test_unrecognised_text_and_non_text(env):
    client, factory = env
    body = _payload(message_id="wamid.help", text="hola")
    client.post(PATH, content=body, headers=_sign(body))
    body = _payload(message_id="wamid.img", kind="image")
    client.post(PATH, content=body, headers=_sign(body))
    rows = _outbox(factory)
    assert len(rows) == 1 and "adeudo" in rows[0].body  # help text; image ignored
    with factory() as session:
        assert {m.outcome for m in session.scalars(select(WhatsappInboxMessage))} == {"answered", "ignored"}


def test_tools_are_deny_by_default():
    assert authorize_tool("member_pending_balance") == "member_pending_balance"
    for name in ("delete_member", "raw_sql", "", None, "member_pending_balance; drop"):
        with pytest.raises(ToolDenied):
            authorize_tool(name)
    with pytest.raises(ToolDenied):
        domain_tools.invoke("record_payment", None, None)


def test_pending_balance_reports_open_debt_and_membership_status(env):
    client, factory = env
    from uuid import uuid4
    with factory.begin() as session:
        member = session.scalar(select(Member).where(Member.member_number == "WA-1"))
        other = session.scalar(select(Member).where(Member.member_number == "WA-4"))
        branch = Branch(code="wa-b", name="WA Branch")
        session.add(branch)
        session.flush()
        member_id = member.id
        for owner, amount, key in ((member, 12550, "k1"), (other, 99900, "k2")):
            order = Order(branch_id=branch.id, register_id=uuid4(), shift_id=uuid4(), member_id=owner.id,
                          seller_id=uuid4(), idempotency_key=key, request_fingerprint="a" * 64, total_minor=amount)
            session.add(order)
            session.flush()
            session.add(MembershipDebt(order_id=order.id, member_id=owner.id, initial_outstanding_minor=amount))
    with factory() as session:
        text = domain_tools.invoke("member_pending_balance", session, member_id)
        assert "$125.50 MXN" in text and "999" not in text  # only this member's debt
        assert "No encontramos" in domain_tools.invoke("member_membership_status", session, member_id)
    with factory.begin() as session:
        session.add(MembershipPeriod(
            member_id=member_id, order_item_id=uuid4(), plan_version_id=uuid4(), activated_by=uuid4(),
            starts_on=date.today() - timedelta(days=5), ends_on=date.today() + timedelta(days=25)))
    with factory() as session:
        assert "vigente" in domain_tools.invoke("member_membership_status", session, member_id)
    body = _payload(message_id="wamid.debt", text="saldo")
    client.post(PATH, content=body, headers=_sign(body))
    assert "$125.50 MXN" in _outbox(factory)[0].body
