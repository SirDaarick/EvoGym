from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app.api import deps
from app.api.deps import AdminDep, SessionDep
from app.auth.authorization import AuthorizationDenied
from app.db.session import create_session_factory


def _app(factory, settings=None):
    app = FastAPI()
    app.state.session_factory = factory
    app.state.settings = settings
    return app


def test_missing_session_factory_returns_500():
    app = _app(None)

    @app.get("/x")
    def route(session: SessionDep):
        return {}

    response = TestClient(app).get("/x")
    assert response.status_code == 500
    assert response.json()["detail"] == "Database session factory not configured."


def test_session_is_closed_and_uncommitted_work_rolled_back_after_request():
    engine = create_engine("sqlite+pysqlite:///:memory:", poolclass=StaticPool, connect_args={"check_same_thread": False})
    with engine.begin() as connection:
        connection.execute(text("create table sample (value text)"))
    factory = create_session_factory(engine)
    seen = []
    app = _app(factory)

    @app.get("/x")
    def route(session: SessionDep):
        seen.append(session)
        session.execute(text("insert into sample values ('x')"))
        return {}

    assert TestClient(app).get("/x").status_code == 200
    assert not seen[0].in_transaction()
    with factory() as check:
        assert check.execute(text("select count(*) from sample")).scalar_one() == 0
    engine.dispose()


class _Settings:
    admin_auth_configured = True
    admin_token_signing_configured = True

    class admin_token_signing_secret:
        @staticmethod
        def get_secret_value():
            return "secret"


def test_admin_resolver_accepts_and_denies(monkeypatch):
    staff_id, session_id = uuid4(), uuid4()

    def fake_validate(factory, token, secret):
        if token != "good":
            raise AuthorizationDenied("no")
        return staff_id, session_id

    monkeypatch.setattr(deps, "validate_admin_session", fake_validate)
    app = _app(object(), _Settings)

    @app.get("/me")
    def me(principal: AdminDep):
        return {"staff": str(principal.staff_id), "session": str(principal.session_id)}

    client = TestClient(app)
    ok = client.get("/me", headers={"Authorization": "Bearer good"})
    assert ok.status_code == 200 and ok.json() == {"staff": str(staff_id), "session": str(session_id)}
    for headers in ({}, {"Authorization": "Bearer bad"}, {"Authorization": "Basic good"}):
        denied = client.get("/me", headers=headers)
        assert denied.status_code == 401 and denied.json()["detail"] == "Authentication failed."
    app.state.session_factory = None
    assert client.get("/me", headers={"Authorization": "Bearer good"}).status_code == 401
