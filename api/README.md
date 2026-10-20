# EvoGym API

The API is a new service boundary under `api/`. It does not read or write the root `backend/` notebook workspace and currently has no domain routes, HTTP authentication, authorization, or frontend integration. It contains an internal staff PIN verification primitive and minimal credential persistence; no provisioning or Admin login workflow is exposed. Database/session helpers and explicit migrations are available.

## Local development

From the repository root in PowerShell:

```powershell
C:\Python314\python.exe -m venv api/.venv
.\api\.venv\Scripts\python.exe -m pip install -e 'api[test]'
Copy-Item api/.env.example api/.env
Set-Location api
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The server binds to loopback only. In development, visit `http://127.0.0.1:8000/docs`; no business endpoints are implemented yet. Stop it with `Ctrl+C`.

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

`EVOGYM_ENV` and `EVOGYM_DEBUG` control application behavior. The environment is validated as `development`, `test`, `staging`, or `production`; debug mode is rejected outside development/test. Interactive docs and the OpenAPI endpoint are disabled in staging/production. `.env` is local-only and ignored by git; `.env.example` contains non-sensitive values only.

| Setting | Default | Effect |
|---|---|---|
| `EVOGYM_ENV` | `development` | Selects validated environment behavior |
| `EVOGYM_DEBUG` | `false` | Enables framework debug only in development/test |
| `EVOGYM_DATABASE_URL` | unset | Optional `SecretStr`; no engine or connection is created unless a caller explicitly requests database work |

### Database and migrations

PostgreSQL is the selected runtime database, using `postgresql+psycopg://`. There is deliberately no localhost URL or credential default. Importing the API works without `EVOGYM_DATABASE_URL`; explicit engine construction and Alembic commands fail clearly if it is missing. Only an explicitly configured `test` environment permits `sqlite+pysqlite://` URLs for synthetic tests.

Supply the database URL through a protected process environment or secret store, then run migrations manually from `api/`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

`api/alembic.ini` contains no database URL; Alembic loads validated settings at command time. Startup never creates an engine, runs migrations, calls `metadata.create_all()`, or commits automatically. `0001_baseline` establishes Alembic revision tracking; `0002_staff_credentials` adds only minimal staff identity, PIN credential, and pending security-event tables. Synthetic SQLite tests cover fresh/repeated migration and a test-only predecessor-to-head upgrade. Offline PostgreSQL SQL generation is also exercised without connecting. The app does not own an engine yet; explicit callers own its lifecycle and must dispose it. The Alembic command disposes its temporary engine when it finishes. Future data-bearing migrations must document compatibility and recovery; destructive downgrades require an explicit reviewed data-loss plan and verified backup.

SQLite and offline SQL tests alone do not prove a live PostgreSQL connection. Independent verification on 2026-10-19 additionally exercised PostgreSQL 18.6 through psycopg in a disposable loopback-only container: fresh/repeated baseline upgrades, a temporary test-only predecessor upgrade preserving data, and normal/error-path session rollback passed. The container was removed afterward; no persistent database is configured. The session generator takes an explicit session factory and is not yet wired as a FastAPI dependency.

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

This remains a backend foundation, not a deployed or domain-approved service. `staff_users` stores an organization-global normalized login identifier and active flag; `staff_credentials` stores a salted bcrypt PIN hash and independent lockout state. Each fifth consecutive failed PIN starts a five-minute lock; correct PINs are refused while locked, and a successful PIN after expiry resets the failure count. The transaction also records one durable `security_events` row with pending Admin delivery. This alert is not sent. BK-011 adds an internal role/scope foundation and opaque revocable sessions: branch-level receptionist grants, an explicit organization-scoped Admin grant, and current staff/branch/grant checks on every authorization. Receptionists cannot access unassigned branches or finance, staff compensation, or admin-audit permissions. Session creation authenticates PIN internally, requires an aware future expiry supplied by server-owned policy, and stores only a SHA-256 digest of a 256-bit random token; revocation and current grants are checked at each validation. PIN verification and session persistence use separate transactions; issuance rechecks active staff, the current PIN hash, and lock state under row locks before storing a session. This prevents a rotated or newly locked credential from minting a session. This is not a public login/API, does not provision roles or branches, and does not set a production session TTL. Admin recovery/enrollment and kiosk/device proof remain unresolved (D-025); no password verifier, public endpoint, audit pipeline, or alert delivery exists. PostgreSQL row locks serialize concurrent guesses; SQLite proves state transitions only. The opt-in PostgreSQL test requires an explicitly supplied disposable `EVOGYM_TEST_POSTGRES_URL`. Do not put notebooks, datasets, or private workbooks in this service package.


Migration 0003 downgrade drops `branches`, `staff_role_grants`, and `staff_sessions`; it is destructive to those records. No production downgrade is authorized—preserve backups and prefer a forward repair if data exists. Authorization/session verification uses synthetic SQLite by default. Live PostgreSQL coverage is opt-in with an explicitly supplied disposable `EVOGYM_TEST_POSTGRES_URL`; it is skipped otherwise.
