# EvoGym API

The API is a new service boundary under `api/`. It does not read or write the root `backend/` notebook workspace and has no domain routes, HTTP authentication, or frontend integration. It contains internal staff PIN/session authorization foundations, health endpoints, and a transaction-owned audit append primitive; no provisioning or Admin login workflow is exposed. Database/session helpers and explicit migrations are available.

## Local development

From the repository root in PowerShell:

```powershell
C:\Python314\python.exe -m venv api/.venv
.\api\.venv\Scripts\python.exe -m pip install -e 'api[test]'
Copy-Item api/.env.example api/.env
Set-Location api
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --no-access-log
```

The server binds to loopback only. In development, visit `http://127.0.0.1:8000/docs`; `/health/live` is independent of the database and `/health/ready` returns a generic 503 when no configured database is available. No business endpoints are implemented yet. Stop it with `Ctrl+C`.

Run the deterministic in-process suite from the repository root:

```powershell
.\api\.venv\Scripts\python.exe -m pytest -q api/tests
.\api\.venv\Scripts\python.exe -m pip check
```

Or, from `api/`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests
```

## Configuration and safety

`EVOGYM_ENV` and `EVOGYM_DEBUG` are validated settings. The environment is one of `development`, `test`, `staging`, or `production`; enabling the debug setting outside development/test is rejected. Framework debug pages remain disabled in every environment so exceptions cannot expose details. Interactive docs and the OpenAPI endpoint are disabled in staging/production. `.env` is local-only and ignored by git; `.env.example` contains non-sensitive values only.

| Setting | Default | Effect |
|---|---|---|
| `EVOGYM_ENV` | `development` | Selects validated environment behavior |
| `EVOGYM_DEBUG` | `false` | Validated development/test flag; framework exception-detail pages remain disabled |
| `EVOGYM_DATABASE_URL` | unset | Optional `SecretStr`; an engine is created only during app lifespan when configured, and connects only for readiness or explicit database work |

### Request safety and diagnostics

Every HTTP response, including framework errors, receives a server-generated UUID in `X-Request-ID`. The JSON error envelope includes that ID and a stable generic message; validation inputs and exception details are not returned. Structured request logs include only the ID, bounded method, route template (or `unmatched`), status class, and duration. Raw paths, query strings, headers, bodies, credentials, and exception text are excluded. Unexpected failures before response headers produce the same correlated generic 500; a failure after streaming starts ends the body without a second response start or exposing the exception. Run Uvicorn with `--no-access-log`: its default access log includes the request target, which can contain query parameters. In-process metrics cap series at 128 (overflow is aggregated) and are neither durable nor multiprocess metrics; there is no public scrape endpoint.

Readiness performs only a bounded `SELECT 1` against the configured database (2-second PostgreSQL connect/statement bounds and a 3-second pool wait); it runs in a dedicated one-worker executor with at most one queued probe and a 2.5-second response deadline. Timed-out driver work retains its bounded slot until it actually finishes, and saturation returns generic 503 rather than building an unbounded queue. Liveness does no dependency work. No database engine connects during import/startup. The application disposes its engine on lifespan shutdown. Health never returns driver errors or database URLs.

`append_audit_event` accepts only an internal `SessionPrincipal`, checks current persisted authorization and appends only supported read actions (`member_read`, `finance_read`) with actor/branch/request-ID/time to the caller's transaction. Mutating action labels are rejected until their own authorization policy is implemented. It does not commit, accept arbitrary payloads, expose an audit browser, or claim database-administrator tamper resistance. Audit retention/access policy remains unresolved; not every operation is wired to this service.

### Database and migrations

PostgreSQL is the selected runtime database, using `postgresql+psycopg://`. There is deliberately no localhost URL or credential default. Importing the API works without `EVOGYM_DATABASE_URL`; explicit engine construction and Alembic commands fail clearly if it is missing. Only an explicitly configured `test` environment permits `sqlite+pysqlite://` URLs for synthetic tests.

Supply the database URL through a protected process environment or secret store, then run migrations manually from `api/`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

`api/alembic.ini` contains no database URL; Alembic loads validated settings at command time. Startup never connects to the database, runs migrations, calls `metadata.create_all()`, or commits automatically. `0001_baseline` establishes Alembic revision tracking; `0002_staff_credentials` adds staff identity, PIN credential, and pending security-event tables; `0003_authorization_sessions` adds branch grants and opaque sessions; `0004_audit_events` adds minimal audit records. Synthetic SQLite tests cover fresh/repeated migration and a test-only predecessor-to-head upgrade. Offline PostgreSQL SQL generation is also exercised without connecting. The app owns and disposes a lazy engine only when a database URL is configured. The Alembic command disposes its temporary engine when it finishes. Future data-bearing migrations must document compatibility and recovery; destructive downgrades require an explicit reviewed data-loss plan and verified backup.

Alembic version tracking uses `VARCHAR(128)` so all published revision IDs fit, including the 35-character `0010_registers_terminals_and_shifts`; revision IDs are never renamed or truncated to fit. PostgreSQL migration startup widens an existing shorter `alembic_version.version_num` column before any revision update, preserving its current value. Offline PostgreSQL SQL emits the same safe widening before Alembic creates or updates the table. SQLite migrations remain supported; its existing short `VARCHAR(32)` tracking tables are not rebuilt.

SQLite and offline SQL tests alone do not prove a live PostgreSQL connection. Independent verification on 2026-10-19 additionally exercised PostgreSQL 18.6 through psycopg in a disposable loopback-only container: fresh/repeated baseline upgrades, a temporary test-only predecessor upgrade preserving data, and normal/error-path session rollback passed. The container was removed afterward; no persistent database is configured. On 2026-10-20, a fresh full-chain PostgreSQL upgrade first reproduced the old width failure at revision `0008_member_notes_and_eligibility`; after widening, the opt-in migration suite verified fresh/repeated head, existing `VARCHAR(32)` evolution, predecessor shift/count preservation, and scoped downgrade/re-upgrade. The synthetic container was removed afterward. The session generator takes an explicit session factory and is not yet wired as a FastAPI dependency.

## Compatibility and dependency choices

The isolated environment was installed and exercised with CPython 3.14.5 on Windows. `requires-python = ">=3.12,<3.15"` is the declared portable range; other versions in that range were not tested here. At BK-009 installation the resolved versions were SQLAlchemy 2.1.5, Alembic 1.20.0, psycopg 3.3.6 (binary wheel), FastAPI 0.149.0, Pydantic Settings 2.16.0, Uvicorn 0.54.0, pytest 9.1.1, and HTTPX 0.28.1. BK-010 added bcrypt 5.0.0, installed and exercised on CPython 3.14.5. Bounds in `pyproject.toml` allow compatible updates without committing a generated lockfile.

- FastAPI provides the ASGI application and supports disabling docs/OpenAPI URLs per environment: [conditional OpenAPI docs](https://fastapi.tiangolo.com/how-to/conditional-openapi/), [FastAPI reference](https://fastapi.tiangolo.com/reference/fastapi/).
- Pydantic Settings provides typed validation and prefixed environment/`.env` sources: [Pydantic Settings documentation](https://docs.pydantic.dev/latest/concepts/pydantic_settings/).
- Python `secrets.token_urlsafe(32)` generates the session bearer token from 32 random bytes (256 bits); only its SHA-256 digest is stored: [Python secrets](https://docs.python.org/3/library/secrets.html).
- SQLAlchemy `Session.begin()` owns commit/rollback and `SELECT FOR UPDATE` serializes state changes: [transactions](https://docs.sqlalchemy.org/en/21/orm/session_transaction.html), [row locking](https://docs.sqlalchemy.org/en/20/core/selectable.html#sqlalchemy.sql.expression.Select.with_for_update). Existing engine configuration disables SQL echo and parameter display.
- SQLAlchemy provides the engine and request-scoped `Session` pattern; uncommitted work is rolled back on close and commits remain explicit: [Session basics](https://docs.sqlalchemy.org/en/21/orm/session_basics.html), [transactions](https://docs.sqlalchemy.org/en/21/orm/session_transaction.html), and [SELECT FOR UPDATE](https://docs.sqlalchemy.org/en/20/core/selectable.html#sqlalchemy.sql.expression.Select.with_for_update).
- Alembic provides explicit online/offline migration execution: [Alembic tutorial](https://alembic.sqlalchemy.org/en/latest/tutorial.html), [offline SQL](https://alembic.sqlalchemy.org/en/latest/offline.html).
- bcrypt 5.0.0 supports Python 3.14 and rejects inputs longer than 72 bytes rather than truncating them; the helper rejects overlong UTF-8 PINs and malformed stored hashes fail closed: [bcrypt changelog](https://github.com/pyca/bcrypt/blob/5.0.0/CHANGELOG.rst), [bcrypt usage](https://github.com/pyca/bcrypt/blob/5.0.0/README.rst).
- Psycopg 3 supports Windows and Python 3.14 per its current system support list; the installed binary wheel was exercised locally: [installation and supported systems](https://www.psycopg.org/psycopg3/docs/basic/install.html).
- Uvicorn is the local ASGI server: [Uvicorn settings](https://www.uvicorn.org/settings/).

## Scope boundary

This remains a backend foundation, not a deployed or domain-approved service. `staff_users` stores an organization-global normalized login identifier and active flag; `staff_credentials` stores a salted bcrypt PIN hash and independent lockout state. Each fifth consecutive failed PIN starts a five-minute lock; correct PINs are refused while locked, and a successful PIN after expiry resets the failure count. The transaction also records one durable `security_events` row with pending Admin delivery. This alert is not sent. BK-011 adds an internal role/scope foundation and opaque revocable sessions: branch-level receptionist grants, an explicit organization-scoped Admin grant, and current staff/branch/grant checks on every authorization. Receptionists cannot access unassigned branches or finance, staff compensation, or admin-audit permissions. Session creation authenticates PIN internally, requires an aware future expiry supplied by server-owned policy, and stores only a SHA-256 digest of a 256-bit random token; revocation and current grants are checked at each validation. PIN verification and session persistence use separate transactions; issuance rechecks active staff, the current PIN hash, and lock state under row locks before storing a session. This prevents a rotated or newly locked credential from minting a session. This is not a public login/API, does not provision roles or branches, and does not set a production session TTL. Admin recovery/enrollment and kiosk/device proof remain unresolved (D-025); no password verifier, public auth endpoint, or alert delivery exists. PostgreSQL row locks serialize concurrent guesses; SQLite proves state transitions only. BK-012 adds correlated generic errors, allowlisted logs, bounded dependency readiness, finite in-process metrics, and a transaction-owned audit append primitive; not every action is wired to audit. Audit retention/access and database-administrator tamper resistance are unresolved. The opt-in PostgreSQL tests require an explicitly supplied disposable `EVOGYM_TEST_POSTGRES_URL`. Do not put notebooks, datasets, or private workbooks in this service package.


Migration 0003 downgrade drops `branches`, `staff_role_grants`, and `staff_sessions`; it is destructive to those records. No production downgrade is authorized—preserve backups and prefer a forward repair if data exists. Authorization/session verification uses synthetic SQLite by default. Live PostgreSQL coverage is opt-in with an explicitly supplied disposable `EVOGYM_TEST_POSTGRES_URL`; it is skipped otherwise.

FastAPI error handlers use registered exception types and return generic output; request IDs are provided by pure-ASGI middleware: [error handling](https://fastapi.tiangolo.com/tutorial/handling-errors/), [middleware](https://fastapi.tiangolo.com/advanced/middleware/).

### Opening a cash shift

`POST /api/v1/shifts/open` requires `denomination_counts` for every new shift. Each item uses integer `denomination_minor` (centavos) and nonnegative integer `quantity`; duplicate denominations are rejected. The server derives `opening_cash_minor` from these counts. A supplied compatibility total must exactly match. A zero-cash opening is represented by a nonempty list whose quantities are all zero. The response and current/detail shift reads return the saved counts; older shifts can legitimately return an empty list because historical counts are not backfilled. These records are observations only and do not adjust inventory.

```json
{
  "cash_register_id": "<register-uuid>",
  "denomination_counts": [
    { "denomination_minor": 10000, "quantity": 2 },
    { "denomination_minor": 500, "quantity": 4 }
  ]
}
```

The repository workflow at .github/workflows/api.yml runs Python 3.14 tests, dependency checks, and fresh PostgreSQL migration smoke against an ephemeral synthetic service. It was locally reviewed only; hosted GitHub Actions were not executed.

### Inventory starter

The Admin-only /api/v1/inventory API registers piece-counted products and records one explicit immutable starting quantity per product and branch. Product catalog pages are shared across branches. Branch stock pages include every product: initialized=false and quantity=null means no starting count was entered, while initialized=true and quantity=0 is an explicit zero count. These values are initialization baselines, not live balances. This starter has no movement, sales, adjustment, fractional-unit, or full-snapshot acceptance API and does not seed products or quantities.
