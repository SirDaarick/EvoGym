# EvoGym API

The API is a new service boundary under `api/`. It does not read or write the root `backend/` notebook workspace and currently has no domain routes, authentication, domain persistence, or frontend integration. Database/session helpers and an explicit empty Alembic baseline are available.

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

`api/alembic.ini` contains no database URL; Alembic loads validated settings at command time. Startup never creates an engine, runs migrations, calls `metadata.create_all()`, or commits automatically. The initial `0001_baseline` revision only establishes Alembic version tracking; no business tables exist yet. Synthetic SQLite tests cover fresh/repeated migration and a test-only predecessor-to-baseline upgrade. Offline PostgreSQL SQL generation is also exercised without connecting. The app does not own an engine yet; explicit callers own its lifecycle and must dispose it. The Alembic command disposes its temporary engine when it finishes. Future data-bearing migrations must document compatibility and recovery; destructive downgrades require an explicit reviewed data-loss plan and verified backup.

SQLite and offline SQL tests alone do not prove a live PostgreSQL connection. Independent verification on 2026-10-19 additionally exercised PostgreSQL 18.6 through psycopg in a disposable loopback-only container: fresh/repeated baseline upgrades, a temporary test-only predecessor upgrade preserving data, and normal/error-path session rollback passed. The container was removed afterward; no persistent database is configured. The session generator takes an explicit session factory and is not yet wired as a FastAPI dependency.

## Compatibility and dependency choices

The isolated environment was installed and exercised with CPython 3.14.5 on Windows. `requires-python = ">=3.12,<3.15"` is the declared portable range; other versions in that range were not tested here. At BK-009 installation the resolved versions were SQLAlchemy 2.1.5, Alembic 1.20.0, psycopg 3.3.6 (binary wheel), FastAPI 0.149.0, Pydantic Settings 2.16.0, Uvicorn 0.54.0, pytest 9.1.1, and HTTPX 0.28.1. Bounds in `pyproject.toml` allow compatible updates without committing a generated lockfile.

- FastAPI provides the ASGI application and supports disabling docs/OpenAPI URLs per environment: [conditional OpenAPI docs](https://fastapi.tiangolo.com/how-to/conditional-openapi/), [FastAPI reference](https://fastapi.tiangolo.com/reference/fastapi/).
- Pydantic Settings provides typed validation and prefixed environment/`.env` sources: [Pydantic Settings documentation](https://docs.pydantic.dev/latest/concepts/pydantic_settings/).
- SQLAlchemy provides the engine and request-scoped `Session` pattern; uncommitted work is rolled back on close and commits remain explicit: [Session basics](https://docs.sqlalchemy.org/en/21/orm/session_basics.html), [transactions](https://docs.sqlalchemy.org/en/21/orm/session_transaction.html).
- Alembic provides explicit online/offline migration execution: [Alembic tutorial](https://alembic.sqlalchemy.org/en/latest/tutorial.html), [offline SQL](https://alembic.sqlalchemy.org/en/latest/offline.html).
- Psycopg 3 supports Windows and Python 3.14 per its current system support list; the installed binary wheel was exercised locally: [installation and supported systems](https://www.psycopg.org/psycopg3/docs/basic/install.html).
- Uvicorn is the local ASGI server: [Uvicorn settings](https://www.uvicorn.org/settings/).

## Scope boundary

This is only the service/configuration and migration-baseline foundation; live PostgreSQL baseline integration was verified in an isolated synthetic target, not a deployment or domain-schema approval. Authentication, authorization, domain schema/persistence, migrations beyond the empty baseline, health/error contracts, request IDs, audit, CI, local-first sync, and all operational/domain behavior remain future work. Do not put notebooks, datasets, or private workbooks in this service package.
