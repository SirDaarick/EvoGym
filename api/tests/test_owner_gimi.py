from fastapi.testclient import TestClient

from admin_session_helpers import approved_admin_headers
from app.main import create_app
from app.notifications.outbox import enqueue
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db


def test_owner_gimi_authorization_enforcement(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        _, reception_token = _seed_receptionist(factory, branch)
        seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            assert client.get("/api/v1/owner/gimi/overview").status_code == 401
            assert client.get("/api/v1/owner/gimi/overview", headers={"Authorization": f"Bearer {reception_token}"}).status_code == 403

            headers = approved_admin_headers(client, delivery)
            response = client.get("/api/v1/owner/gimi/overview", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert "kpis" in data
            assert data["kpis"]["total_conversations"] == 0
            assert data["kpis"]["autonomous_rate"] == 100
    finally:
        engine.dispose()


def test_owner_gimi_knowledge_vault_crud(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            headers = approved_admin_headers(client, delivery)

            # 1. Initially empty
            res = client.get("/api/v1/owner/gimi/knowledge", headers=headers)
            assert res.status_code == 200
            assert res.json() == []

            # 2. Add rule
            payload = {
                "ref": "general-rules",
                "category": "regulations",
                "title": "Reglamento General de Instalaciones",
                "content": "Uso obligatorio de toalla personal y calzado deportivo adecuado dentro del área de pesas.",
            }
            create_res = client.post("/api/v1/owner/gimi/knowledge", json=payload, headers=headers)
            assert create_res.status_code == 201
            stats = create_res.json()
            assert stats["inserted"] == 1

            # 3. List knowledge
            list_res = client.get("/api/v1/owner/gimi/knowledge", headers=headers)
            assert list_res.status_code == 200
            items = list_res.json()
            assert len(items) == 1
            chunk_id = items[0]["id"]
            assert items[0]["title"] == payload["title"]
            assert items[0]["source_kind"] == "rule"

            # 4. Filter by source_kind
            res_rules = client.get("/api/v1/owner/gimi/knowledge?source_kind=rule", headers=headers)
            assert len(res_rules.json()) == 1
            res_plans = client.get("/api/v1/owner/gimi/knowledge?source_kind=plan", headers=headers)
            assert len(res_plans.json()) == 0

            # 5. Delete chunk
            del_res = client.delete(f"/api/v1/owner/gimi/knowledge/{chunk_id}", headers=headers)
            assert del_res.status_code == 200
            assert del_res.json() == {"ok": True}

            # 6. Delete again -> 404
            del_again = client.delete(f"/api/v1/owner/gimi/knowledge/{chunk_id}", headers=headers)
            assert del_again.status_code == 404
    finally:
        engine.dispose()


def test_owner_gimi_outbox_notifications_and_delivery(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        seed_admin(factory)
        with factory.begin() as session:
            enqueue(
                session,
                idempotency_key="test:welcome:001",
                channel="whatsapp",
                kind="welcome",
                recipient="+525512345678",
                body="Bienvenido a EvoGym!",
            )

        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            headers = approved_admin_headers(client, delivery)

            # List outbox
            list_res = client.get("/api/v1/owner/gimi/notifications", headers=headers)
            assert list_res.status_code == 200
            rows = list_res.json()
            assert len(rows) == 1
            assert rows[0]["status"] == "pending"
            assert rows[0]["recipient"] == "+525512345678"

            # Deliver batch
            deliver_res = client.post(
                "/api/v1/owner/gimi/notifications/deliver",
                json={"batch_size": 10},
                headers=headers,
            )
            assert deliver_res.status_code == 200
            assert deliver_res.json() == {"attempted": 1}

            # Verify status updated to sent
            after_res = client.get("/api/v1/owner/gimi/notifications", headers=headers)
            after_rows = after_res.json()
            assert len(after_rows) == 1
            assert after_rows[0]["status"] == "sent"
            assert after_rows[0]["provider_message_id"] is not None
    finally:
        engine.dispose()
