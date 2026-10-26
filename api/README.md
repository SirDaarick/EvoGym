# EvoGym API

The API is a service boundary under `api/` and does not read or write the root `backend/` notebook/private-data workspace. It contains staff PIN/session authorization, Admin authentication/enrollment/recovery and device-pairing routes, member and membership-payment workflows, piece-only inventory foundations, shift opening/review and cash-cut APIs, online access/sample flows, roster/attendance, health endpoints, and a transaction-owned audit append primitive. Database/session helpers and explicit migrations are available. A partial live reception frontend exists; it is not complete production integration.

**Current committed evidence (2026-10-22):** source R5 `f1153da6ef5718a64cd8480a69f107699ac4ebea` passed **335 API tests with 17 PostgreSQL skips/18 warnings**, typecheck and production/PWA build; the full clean frontend run recorded **2 failed/471 passed**, so overall frontend proof is partial. Focused R1/R1a–R5 checks pass; earlier dirty 367-API/578-frontend passes are separate history. Read the [committed receipt](../docs/backend-audit/delivery-notes.md), [audit](../docs/backend-audit/README.md), [findings](../docs/backend-audit/findings.md), [frontend follow-ups](../docs/backend-audit/frontend-contract-gaps.md), and [roadmap](../docs/backend-audit/roadmap.md). Clean graph head is `0029_class_sample_check_ins`; uncommitted 0030 schedules are not delivered or PG-proven. Local `auto-chain` / `feature-branch-chain` is approved; source commits exist, D1–D3 docs remain pending, and no PR/push/publication is authorized. PG/hosted execution remains unverified.

## Local development

From the repository root in PowerShell:

```powershell
C:\Python314\python.exe -m venv api/.venv
.\api\.venv\Scripts\python.exe -m pip install -e 'api[test]'
Copy-Item api/.env.example api/.env
Set-Location api
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --no-access-log
```

The server binds to loopback only. In development, visit `http://127.0.0.1:8000/docs`; `/health/live` is independent of the database and `/health/ready` returns a generic 503 when no configured database is available. Stop it with `Ctrl+C`.

### Cash shift lifecycle

- `POST /api/v1/shifts/open` opens a shift with mandatory denomination counts and the authorized inventory snapshot/review. Opening links any pending post-cut overtime membership cash sales to the new financial shift; those proceeds are already part of the physical opening count.
- `POST /api/v1/shifts/{shift_id}/close` freezes mandatory denomination counts, the server-derived expected cash, counted cash, difference, actor, and close time. An identical count retry returns the frozen close; changed counts conflict.
- Cash membership sales use `POST /api/v1/registers/{register_id}/membership-sales`. After a cut, a sale may cite the latest closed `source_shift_id`; its seller and source shift remain historical attribution, while proceeds go to the successor open shift or remain pending until it opens. The register lock serializes posting, opening, and closing.
- Example: if an opening count of 1,000 already includes 200 pending overtime cash, expected cash remains 1,000 with no later drawer movements, not 1,200. This API slice handles membership cash sales only; it is not a general financial-history/reporting or discrepancy-attribution system.

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

Browser clients are cross-origin only when `EVOGYM_CORS_ALLOWED_ORIGINS` is explicitly configured as a comma-separated allowlist of exact HTTP(S) origins (scheme and host/port only). Wildcards, credentials, paths, queries, fragments, and duplicate origins are rejected. Configured CORS permits `GET`/`POST`/`PATCH`/`PUT`/`DELETE` and `Authorization`/`Content-Type`/`Idempotency-Key`, exposes `X-Request-ID`, and never enables cookies or credentialed browser requests. B01 regression tests cover allowed and rejected preflights. When unset, no cross-origin CORS headers are emitted. Configure development and production origins intentionally rather than using `*`; real browser E2E remains unverified.

| Setting | Default | Effect |
|---|---|---|
| `EVOGYM_ENV` | `development` | Selects validated environment behavior |
| `EVOGYM_CORS_ALLOWED_ORIGINS` | unset | Optional comma-separated exact HTTP(S) browser origins; unset disables CORS |
| `EVOGYM_DEBUG` | `false` | Validated development/test flag; framework exception-detail pages remain disabled |
| `EVOGYM_DATABASE_URL` | unset | Optional `SecretStr`; an engine is created only during app lifespan when configured, and connects only for readiness or explicit database work |
| `EVOGYM_STAFF_SESSION_TTL_SECONDS` | unset | Required for staff PIN sessions; server-owned expiry bounded to 60–86400 seconds |

### Staff PIN sessions

`POST /api/v1/auth/staff/sessions` accepts only `login_identifier`, `pin`, and an explicit `branch_id` UUID. The API derives expiry from `EVOGYM_STAFF_SESSION_TTL_SECONDS`; client-selected expiry is rejected. It returns an opaque bearer token once with `Cache-Control: no-store`. Missing TTL, required auth configuration, or session factory fails closed with 503. Invalid PIN, inactive staff, locked credentials, and inactive or unauthorized branches return a generic authentication failure. The route uses the shared auth rate limiter, bounded PIN-hash concurrency, and auth request-body limit; credential and token values are excluded from logs. It does not provision staff, branches, or grants.

### Request safety and diagnostics

Every HTTP response, including framework errors, receives a server-generated UUID in `X-Request-ID`. The JSON error envelope includes that ID. Unknown HTTP/auth/internal errors remain generic; wired period/sample check-in denials expose only closed public codes/metadata. Validation issues expose at most 20 fixed source/type classifications without user-controlled field keys, submitted values or context. See B05 for mapped scope; other business errors/OpenAPI overrides and frontend error transport remain follow-ups. Structured request logs include only the ID, bounded method, route template (or `unmatched`), status class, and duration. Raw paths, query strings, headers, bodies, credentials, and exception text are excluded. Unexpected failures before response headers produce the same correlated generic 500; a failure after streaming starts ends the body without a second response start or exposing the exception. Run Uvicorn with `--no-access-log`: its default access log includes the request target, which can contain query parameters. In-process metrics cap series at 128 (overflow is aggregated) and are neither durable nor multiprocess metrics; there is no public scrape endpoint.

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

This remains a backend foundation, not a deployed or domain-approved service. `staff_users` stores an organization-global normalized login identifier and active flag; `staff_credentials` stores a salted bcrypt PIN hash and independent lockout state. Each fifth consecutive failed PIN starts a five-minute lock; correct PINs are refused while locked, and a successful PIN after expiry resets the failure count. The transaction also records one durable `security_events` row with pending Admin delivery. This alert is not sent. BK-011 adds an internal role/scope foundation and opaque revocable sessions: branch-level receptionist grants, an explicit organization-scoped Admin grant, and current staff/branch/grant checks on every authorization. Receptionists cannot access unassigned branches or finance, staff compensation, or admin-audit permissions. The staff PIN session API authenticates through the internal issuance service, requires an aware future expiry derived from the server-owned `EVOGYM_STAFF_SESSION_TTL_SECONDS`, and stores only a SHA-256 digest of a 256-bit random token; revocation and current grants are checked at each validation. PIN verification and session persistence use separate transactions; issuance rechecks active staff, the current PIN hash, and lock state under row locks before storing a session. This prevents a rotated or newly locked credential from minting a session. The API does not provision roles or branches. Admin password verification, enrollment/recovery and device-pairing routes now exist; deeper branch coverage and operational rollout remain incomplete (see the dated audit). Pending security events are not proof of alert delivery. PostgreSQL row locks serialize concurrent guesses; SQLite proves state transitions only. BK-012 adds correlated generic errors, allowlisted logs, bounded dependency readiness, finite in-process metrics, and a transaction-owned audit append primitive; not every action is wired to audit. Audit retention/access and database-administrator tamper resistance are unresolved. The opt-in PostgreSQL tests require an explicitly supplied disposable `EVOGYM_TEST_POSTGRES_URL`. Do not put notebooks, datasets, or private workbooks in this service package.


Migration 0003 downgrade drops `branches`, `staff_role_grants`, and `staff_sessions`; it is destructive to those records. No production downgrade is authorized—preserve backups and prefer a forward repair if data exists. Authorization/session verification uses synthetic SQLite by default. Live PostgreSQL coverage is opt-in with an explicitly supplied disposable `EVOGYM_TEST_POSTGRES_URL`; it is skipped otherwise.

FastAPI error handlers use registered exception types and return generic output; request IDs are provided by pure-ASGI middleware: [error handling](https://fastapi.tiangolo.com/tutorial/handling-errors/), [middleware](https://fastapi.tiangolo.com/advanced/middleware/).

### Opening a cash shift

`POST /api/v1/shifts/open` requires `denomination_counts` and a server-captured `inventory_snapshot_id` for every new shift. Each cash item uses integer `denomination_minor` (centavos) and nonnegative integer `quantity`; duplicate denominations are rejected. The server derives `opening_cash_minor` from these counts. A supplied compatibility total must exactly match. A zero-cash opening is represented by a nonempty list whose quantities are all zero. The response and current/detail shift reads return saved cash evidence and review provenance; older shifts can legitimately have no inventory review because evidence is never backfilled. Opening consumes the exact current snapshot atomically with the shift. A stale snapshot returns 409 and must be captured again.

Opening itself records the authorized receptionist's global acceptance of the presented inventory. An empty `inventory_observations` list means `no_changes_declared`; it does not claim a physical recount. Missing initial quantities remain unknown and do not block opening. Optional entries contain only `product_id` and a strict nonnegative `physical_quantity`; they record reported physical observations without initializing or adjusting stock. An actually captured `empty_catalog` is recorded as that source state, while database or snapshot unavailability is an error, never an empty success. Piece-counted products are currently supported; fractional inventory is not.

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

### Register opening inventory observations

`POST /api/v1/registers/{register_id}/inventory-snapshots` captures the complete ordered piece catalog and that register's branch initialization state in one catalog query. The response stores copied product code/name/unit, expected quantity, and initialization provenance with server-derived actor/time, plus item and missing counts. `GET /api/v1/registers/{register_id}/inventory-snapshots/{snapshot_id}` returns those historical values even if the product catalog or initialization later changes. Both routes authenticate an Admin or operational staff member and check the live register branch on every call; a snapshot ID is not an authorization grant.

`source_state` describes the captured source: `empty_catalog`, `missing_initializations`, or `all_initialized`. Unknown initialization is `initialized=false` with `expected_quantity=null`; explicit zero is `initialized=true` with `expected_quantity=0`. Opening accepts the full presented snapshot globally; no per-product recount is required, and physical exceptions are optional. Review records preserve actor/time and do not alter stock.

### Cash membership sale posting

`POST /api/v1/registers/{register_id}/membership-sales` posts one membership plan version for an existing member to the authorized register's currently open shift. The caller supplies only `member_id` and `plan_version_id`, plus an `Idempotency-Key` header; amount, seller, branch, source shift, item snapshot, and payment status are server-derived. Published MXN price is final. A successful sale persists an order, immutable plan item snapshot, confirmed cash payment, and branch-neutral membership date period in one transaction. Repeating the same actor/branch/key and request returns the original result; conflicting reuse returns 409. Membership dates use the branch IANA timezone; existing branches receive the D-004 `America/Mexico_City` default. The period records dates only and does not itself implement cross-branch entitlement or check-in access.

### Operational security logs

Operational security records are separate from `audit_events`, `security_events`, and Admin lockout history. They are disabled unless `EVOGYM_OPERATIONAL_SECURITY_LOG_DIRECTORY` explicitly names a new absolute directory whose parent already exists. Startup creates a versioned ownership marker only in that new namespace; an unmarked existing path is rejected rather than adopted. Records use a closed typed schema with UTC event time, event type, outcome, and nullable server-validated employee, device, initiating-actor, and request UUIDs. Raw credentials, tokens, pairing codes, cookies, authorization headers, bodies, query strings, PII and exception text are not schema fields. Events queued with a database mutation are emitted only after that transaction commits; rolled-back events are discarded. No HTTP route exposes these logs.

Run the retention command from the `api` package with the same explicit store path. It validates the ownership marker, stable lock file, and regular-file paths, refuses symlinks/unmanaged or malformed stores, and previews before mutating. Append and retention share an OS-level lock held across the complete read/rewrite window; a crashed process releases its lock, and acquisition fails closed after a bounded timeout. The expiry comparison is strict (`occurred_at < UTC now - 90 days`), so a record exactly at the cutoff is retained. The command touches only the managed operational JSONL file; it never reads or deletes database audit/security history. This serializes cooperating application writers and retention but is not a cross-host log service; deployments with multiple hosts must provide shared storage with verified lock semantics or an external operational log service. For disposable local verification, point an isolated test configuration at a fresh synthetic directory, then run `python -m app.observability.expire_operational_logs --store <absolute-store-path>` to preview and add `--apply` only for synthetic records.

Deployment operators must provision OS-level permissions separately: grant authorized developers read-only access and reserve write permission to the application/retention identities, using distinct identities where supported. The retention identity also needs read/delete permission for the managed file. This implementation does not configure or claim Windows ACLs, container/cloud access controls, an external log provider, scheduled retention, or production revocation propagation. Configure and verify those boundaries in the selected deployment before claiming developer-only enforcement.
