"""Automated smoke checks for OpenAPI schema/contract, DTO field whitelists, and database migrations (BK-015)."""
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, inspect, text

from app.main import create_app
from app.members.schemas import (
    MemberDetailDTO,
    MemberListItemDTO,
    MemberListResponseDTO,
)
from app.settings import Settings

API_DIR = Path(__file__).resolve().parents[1]

EXPECTED_CORE_API_ENDPOINTS = {
    "/api/v1/auth/sessions": {"POST"},
    "/api/v1/auth/recovery/start": {"POST"},
    "/api/v1/auth/recovery/complete": {"POST"},
    "/api/v1/admin/sessions": {"GET"},
    "/api/v1/admin/sessions/{session_id}/revoke": {"POST"},
    "/api/v1/admin/enrollment-codes": {"POST", "GET"},
    "/api/v1/admin/enrollment-codes/{code_id}/revoke": {"POST"},
    "/api/v1/admin/staff/{staff_id}/device-pairing": {"POST"},
    "/api/v1/admin/devices": {"GET"},
    "/api/v1/admin/devices/{device_id}/revoke": {"POST"},
    "/api/v1/auth/devices/pair": {"POST"},
    "/api/v1/members": {"GET", "POST"},
    "/api/v1/members/{member_id}": {"GET", "PATCH"},
    "/api/v1/members/{member_id}/notes": {"GET", "POST"},
    "/api/v1/members/{member_id}/notes/{note_id}/void": {"POST"},
    "/api/v1/members/{member_id}/eligibility": {"GET", "POST"},
    "/api/v1/members/{member_id}/eligibility/{record_id}/revoke": {"POST"},
    "/api/v1/catalog/services": {"GET", "POST"},
    "/api/v1/catalog/plans": {"GET", "POST"},
    "/api/v1/catalog/plans/{plan_id}": {"GET"},
    "/api/v1/catalog/plans/{plan_id}/versions": {"POST"},
    "/api/v1/terminals": {"GET", "POST"},
    "/api/v1/registers": {"GET", "POST"},
    "/api/v1/registers/{register_id}/inventory-snapshots": {"POST"},
    "/api/v1/registers/{register_id}/inventory-snapshots/{snapshot_id}": {"GET"},
    "/api/v1/registers/{register_id}/membership-sales": {"POST"},
    "/api/v1/registers/{register_id}/membership-debt-payments": {"POST"},
    "/api/v1/shifts/current": {"GET"},
    "/api/v1/shifts/open": {"POST"},
    "/api/v1/shifts/{shift_id}/close": {"POST"},
    "/api/v1/shifts/{shift_id}": {"GET"},
    "/api/v1/inventory/products": {"GET", "POST"},
    "/api/v1/inventory/branches/{branch_id}/initializations": {"POST"},
    "/api/v1/inventory/branches/{branch_id}/stock": {"GET"},
}

EXPECTED_HEALTH_ENDPOINTS = {
    "/health/live": {"GET"},
    "/health/ready": {"GET"},
}

EXPECTED_MEMBER_LIST_FIELDS = {
    "id",
    "member_number",
    "full_name",
    "preferred_name",
    "phone",
    "status",
    "joined_on",
    "credit_balance_minor",
    "emergency_contact_name",
    "emergency_contact_phone",
    "photo_url",
}

EXPECTED_MEMBER_DETAIL_FIELDS = EXPECTED_MEMBER_LIST_FIELDS | {
    "email",
    "birth_date",
    "notes",
    "pending_balance_minor",
    "has_pending_balance",
}

FORBIDDEN_SECRET_FIELDS = {
    "password_hash",
    "secret_hash",
    "token_digest",
    "code_hash",
    "device_identifier_hash",
}

EXPECTED_DATABASE_TABLES = {
    "branches",
    "staff_users",
    "staff_credentials",
    "staff_role_grants",
    "staff_sessions",
    "security_events",
    "admin_password_credentials",
    "admin_recovery_tokens",
    "admin_auth_events",
    "audit_events",
    "staff_enrollment_codes",
    "staff_device_pairing_codes",
    "staff_paired_devices",
    "members",
    "member_notes",
    "member_eligibility_records",
    "services",
    "plans",
    "plan_versions",
    "plan_version_services",
    "payment_terminals",
    "cash_registers",
    "shifts",
    "shift_denomination_counts",
    "shift_closing_denomination_counts",
    "products",
    "stock_initializations",
    "register_inventory_snapshots",
    "register_inventory_snapshot_items",
    "shift_inventory_reviews",
    "shift_inventory_observations",
    "orders",
    "order_items",
    "payments",
    "payment_review_events",
    "membership_periods",
    "membership_debts",
    "membership_debt_payments",
    "member_access_decisions",
    "member_check_ins",
    "staff_roster_profiles",
    "staff_attendance_records",
    "staff_attendance_checkouts",
}


def _get_app_registered_routes(app) -> dict[str, set[str]]:
    """Extract all routes and their HTTP methods from a FastAPI app instance."""
    routes: dict[str, set[str]] = {}

    def extract(route_list):
        for route in route_list:
            if hasattr(route, "path") and hasattr(route, "methods"):
                routes.setdefault(route.path, set()).update(route.methods)
            elif hasattr(route, "original_router") and hasattr(route.original_router, "routes"):
                extract(route.original_router.routes)
            elif hasattr(route, "routes"):
                extract(route.routes)

    extract(app.routes)
    return routes


def test_openapi_schema_generation_and_standards():
    """Verify that OpenAPI schema generates correctly, adheres to 3.x standards, and contains core metadata."""
    settings = Settings(environment="development", debug=False, _env_file=None)
    assert settings.docs_enabled is True

    app = create_app(settings)
    schema = app.openapi()

    assert isinstance(schema, dict), "OpenAPI schema must be a dictionary"
    assert "openapi" in schema, "OpenAPI version missing"
    assert schema["openapi"].startswith("3."), f"Expected OpenAPI 3.x, got {schema['openapi']}"

    assert "info" in schema, "OpenAPI info block missing"
    assert schema["info"].get("title") == "EvoGym API"
    assert schema["info"].get("version") == "0.1.0"

    assert "paths" in schema, "OpenAPI paths block missing"
    assert isinstance(schema["paths"], dict)

    assert "components" in schema, "OpenAPI components block missing"
    assert "schemas" in schema["components"], "OpenAPI schemas block missing"


def test_core_endpoints_registered_in_contract_and_app_router():
    """Verify that all core functional and operational endpoints are registered in OpenAPI and App Router."""
    settings = Settings(environment="development", debug=False, _env_file=None)
    app = create_app(settings)
    schema = app.openapi()
    open_api_paths = schema["paths"]

    # 1. Assert core business API paths and their methods are exposed in OpenAPI
    for path, expected_methods in EXPECTED_CORE_API_ENDPOINTS.items():
        assert path in open_api_paths, f"Expected endpoint path '{path}' missing from OpenAPI paths"
        actual_methods = {m.upper() for m in open_api_paths[path].keys() if m.lower() != "parameters"}
        for method in expected_methods:
            assert method in actual_methods, f"Method {method} missing for path '{path}' in OpenAPI"

    # 2. Assert health endpoints are registered on the application router
    registered_routes = _get_app_registered_routes(app)
    for path, expected_methods in EXPECTED_HEALTH_ENDPOINTS.items():
        assert path in registered_routes, f"Health endpoint '{path}' missing from application routes"
        for method in expected_methods:
            assert method in registered_routes[path], f"Method {method} missing for health path '{path}'"

    # 3. HTTP smoke checks
    client = TestClient(app)
    live_resp = client.get("/health/live")
    assert live_resp.status_code == 200
    assert live_resp.json() == {"status": "ok"}

    ready_resp = client.get("/health/ready")
    assert ready_resp.status_code == 503
    assert ready_resp.json() == {"status": "unavailable"}

    unauth_member_resp = client.get("/api/v1/members")
    assert unauth_member_resp.status_code == 401


def test_dto_field_whitelists_and_secret_protection():
    """Assert field whitelists on DTO schemas and guarantee no internal secrets/hashes leak."""
    settings = Settings(environment="development", debug=False, _env_file=None)
    app = create_app(settings)
    schema = app.openapi()
    schemas = schema["components"]["schemas"]

    # 1. Assert MemberListItemDTO whitelist in OpenAPI schema & Pydantic model
    assert "MemberListItemDTO" in schemas, "MemberListItemDTO missing from OpenAPI schemas"
    item_props = set(schemas["MemberListItemDTO"]["properties"].keys())
    assert item_props == EXPECTED_MEMBER_LIST_FIELDS, (
        f"MemberListItemDTO OpenAPI properties mismatch: {item_props ^ EXPECTED_MEMBER_LIST_FIELDS}"
    )
    assert set(MemberListItemDTO.model_fields.keys()) == EXPECTED_MEMBER_LIST_FIELDS

    # 2. Assert MemberDetailDTO whitelist in OpenAPI schema & Pydantic model
    assert "MemberDetailDTO" in schemas, "MemberDetailDTO missing from OpenAPI schemas"
    detail_props = set(schemas["MemberDetailDTO"]["properties"].keys())
    assert detail_props == EXPECTED_MEMBER_DETAIL_FIELDS, (
        f"MemberDetailDTO OpenAPI properties mismatch: {detail_props ^ EXPECTED_MEMBER_DETAIL_FIELDS}"
    )
    assert set(MemberDetailDTO.model_fields.keys()) == EXPECTED_MEMBER_DETAIL_FIELDS

    # 3. Assert MemberListResponseDTO contains items, total, page, limit, pages
    assert "MemberListResponseDTO" in schemas
    response_props = set(schemas["MemberListResponseDTO"]["properties"].keys())
    assert response_props == {"items", "total", "page", "limit", "pages"}
    assert set(MemberListResponseDTO.model_fields.keys()) == {"items", "total", "page", "limit", "pages"}

    # 4. Strict Secret Protection Check: internal hash or digest fields must never be exposed
    for schema_name, schema_def in schemas.items():
        properties = schema_def.get("properties", {})
        for prop in properties:
            for forbidden in FORBIDDEN_SECRET_FIELDS:
                assert forbidden not in prop.lower(), (
                    f"Forbidden secret field '{prop}' found in OpenAPI schema '{schema_name}'"
                )


def test_fresh_db_migration_smoke_and_seed(tmp_path, monkeypatch):
    """Test spinning up a fresh database, running Alembic to head, and executing smoke queries."""
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'fresh_smoke.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)

    config = Config(str(API_DIR / "alembic.ini"))

    # Upgrade to Alembic head revision
    command.upgrade(config, "head")

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            table_names = set(inspector.get_table_names())

            # 1. Assert all expected tables exist
            assert table_names == EXPECTED_DATABASE_TABLES | {"alembic_version"}, (
                f"Table mismatch. Missing: {EXPECTED_DATABASE_TABLES - table_names}, "
                f"Unexpected: {table_names - EXPECTED_DATABASE_TABLES - {'alembic_version'}}"
            )

            # Per D-001 single-organization architecture, assert no separate organizations table was created
            assert "organizations" not in table_names

            # 2. Assert Alembic revision reached the current backend head
            head_version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            assert head_version == "0026_member_check_ins"

            branch_columns = {column["name"] for column in inspector.get_columns("branches")}
            assert "timezone" in branch_columns

            # 3. Assert member columns exist
            member_columns = {c["name"] for c in inspector.get_columns("members")}
            expected_member_columns = {
                "id",
                "member_number",
                "full_name",
                "preferred_name",
                "phone",
                "email",
                "birth_date",
                "emergency_contact_name",
                "emergency_contact_phone",
                "photo_url",
                "notes",
                "status",
                "joined_on",
                "credit_balance_minor",
                "created_at",
                "updated_at",
            }
            assert member_columns == expected_member_columns

        # 4. Seed minimal valid operational data and perform smoke queries
        branch_id = uuid4()
        staff_id = uuid4()
        cred_id = uuid4()
        grant_id = uuid4()
        member_id = uuid4()
        now_iso = datetime.now(timezone.utc).isoformat()

        with engine.begin() as connection:
            # Seed branch
            connection.execute(
                text("INSERT INTO branches (id, code, name, is_active) VALUES (:id, :code, :name, true)"),
                {"id": str(branch_id), "code": "smoke-branch", "name": "Smoke Test Branch"},
            )
            # Seed staff user
            connection.execute(
                text("INSERT INTO staff_users (id, login_identifier, is_active) VALUES (:id, :login, true)"),
                {"id": str(staff_id), "login": "smoke.admin@example.invalid"},
            )
            # Seed staff credentials
            connection.execute(
                text(
                    "INSERT INTO staff_credentials (id, staff_id, method, secret_hash, failed_attempts) "
                    "VALUES (:id, :staff_id, 'pin', :hash, 0)"
                ),
                {"id": str(cred_id), "staff_id": str(staff_id), "hash": "$2b$12$" + "x" * 53},
            )
            # Seed staff role grant
            connection.execute(
                text(
                    "INSERT INTO staff_role_grants (id, staff_id, role, scope_kind, branch_id, is_active) "
                    "VALUES (:id, :staff_id, 'admin', 'organization', NULL, true)"
                ),
                {"id": str(grant_id), "staff_id": str(staff_id)},
            )
            # Seed member
            connection.execute(
                text(
                    "INSERT INTO members ("
                    "  id, member_number, full_name, phone, email, birth_date, "
                    "  emergency_contact_name, emergency_contact_phone, photo_url, "
                    "  notes, status, joined_on, credit_balance_minor, created_at, updated_at"
                    ") VALUES ("
                    "  :id, :member_number, :full_name, :phone, :email, :birth_date, "
                    "  :emergency_contact_name, :emergency_contact_phone, :photo_url, "
                    "  :notes, :status, :joined_on, :credit_balance_minor, :created_at, :updated_at"
                    ")"
                ),
                {
                    "id": str(member_id),
                    "member_number": "MEM-SMOKE-001",
                    "full_name": "Valeria Smoke Member",
                    "phone": "555-987-6543",
                    "email": "smoke.member@example.invalid",
                    "birth_date": "1992-08-24",
                    "emergency_contact_name": "Emergency Contact",
                    "emergency_contact_phone": "555-000-1111",
                    "photo_url": "https://example.invalid/photos/smoke.jpg",
                    "notes": "Smoke test notes",
                    "status": "active",
                    "joined_on": "2026-10-20",
                    "credit_balance_minor": 0,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                },
            )

        # 5. Smoke read queries
        with engine.connect() as connection:
            branch_count = connection.execute(text("SELECT count(*) FROM branches")).scalar_one()
            assert branch_count == 1

            staff_count = connection.execute(text("SELECT count(*) FROM staff_users")).scalar_one()
            assert staff_count == 1

            # Read back member with filter
            member_row = connection.execute(
                text(
                    "SELECT id, member_number, full_name, phone, status, joined_on, credit_balance_minor, notes "
                    "FROM members WHERE member_number = :num"
                ),
                {"num": "MEM-SMOKE-001"},
            ).mappings().one()

            assert member_row["id"] == str(member_id)
            assert member_row["member_number"] == "MEM-SMOKE-001"
            assert member_row["full_name"] == "Valeria Smoke Member"
            assert member_row["status"] == "active"
            assert member_row["credit_balance_minor"] == 0
            assert member_row["notes"] == "Smoke test notes"

            # Verify join query between staff_users and staff_role_grants
            grant_row = connection.execute(
                text(
                    "SELECT u.login_identifier, g.role, g.scope_kind "
                    "FROM staff_users u JOIN staff_role_grants g ON u.id = g.staff_id "
                    "WHERE u.id = :staff_id"
                ),
                {"staff_id": str(staff_id)},
            ).mappings().one()

            assert grant_row["login_identifier"] == "smoke.admin@example.invalid"
            assert grant_row["role"] == "admin"
            assert grant_row["scope_kind"] == "organization"

    finally:
        engine.dispose()
