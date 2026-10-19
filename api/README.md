# EvoGym API

The API is a new service boundary under `api/`. It does not read or write the root `backend/` notebook workspace and currently has no domain routes, authentication, database, migrations, or frontend integration.

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

Only `EVOGYM_ENV` and `EVOGYM_DEBUG` are read. The environment is validated as `development`, `test`, `staging`, or `production`; debug mode is rejected outside development/test. Interactive docs and the OpenAPI endpoint are disabled in staging/production. `.env` is local-only and ignored by git; `.env.example` contains non-sensitive values only. No credential, database URL, token, or secret setting is needed for this scaffold.

| Setting | Default | Effect |
|---|---|---|
| `EVOGYM_ENV` | `development` | Selects validated environment behavior |
| `EVOGYM_DEBUG` | `false` | Enables framework debug only in development/test |

## Compatibility and dependency choices

The isolated environment was installed and exercised with CPython 3.14.5 on Windows. `requires-python = ">=3.12,<3.15"` is the declared portable range; other versions in that range were not tested here. At scaffold creation the resolved versions were FastAPI 0.149.0, Pydantic Settings 2.16.0, Uvicorn 0.54.0, pytest 9.1.1, and HTTPX 0.28.1. Bounds in `pyproject.toml` allow compatible updates without committing a generated lockfile.

- FastAPI provides the ASGI application and supports disabling docs/OpenAPI URLs per environment: [conditional OpenAPI docs](https://fastapi.tiangolo.com/how-to/conditional-openapi/), [FastAPI reference](https://fastapi.tiangolo.com/reference/fastapi/).
- Pydantic Settings provides typed validation and prefixed environment/`.env` sources: [Pydantic Settings documentation](https://docs.pydantic.dev/latest/concepts/pydantic_settings/).
- Uvicorn is the local ASGI server: [Uvicorn settings](https://www.uvicorn.org/settings/).

## Scope boundary

This is only the service/configuration foundation. Authentication, authorization, persistence, migration lifecycle, health/error contracts, request IDs, audit, CI, local-first sync, and all operational/domain behavior remain future work. Do not put notebooks, datasets, or private workbooks in this service package.
