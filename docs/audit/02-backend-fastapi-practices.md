# 02 — Backend: FastAPI practices, security, performance, tests

Scope: `api/`. Guides: official `fastapi` skill, `ponytail-review`.
Assumed load: one gym with a few concurrent receptionists.
Not checked: the full test run, the real deploy topology (there is no API Dockerfile), and the contents of `api/.env`.

## Summary

The backend is **security-careful**:

- Argon2id passwords, bcrypt PINs, hashed opaque tokens, `compare_digest`.
- Strict cookies and an explicit CORS allowlist.
- 222 `with_for_update` and idempotency on every money path.
- A sanitized error envelope.
- 514 tests that go through `TestClient(create_app())`.

The weak points:

- Four real defects (P1–P4).
- FastAPI idioms are not used: 0 of 149 routes use `Annotated`, and dependencies are copy-pasted.
- No lint, type-check, lockfile or API container.

## Must fix

### P1. The mock card terminal is the silent fallback in every environment — VERIFIED

- **Where:** `app/sales/point.py:259-268`.
- **Problem:** `get_point_client()` returns `MockPointTerminalClient` whenever Mercado Pago is not configured, including in production. The mock reports `PROCESSED` ("VISA 4242") on the first poll. A production deploy with a missing or mistyped token records card payments that never happened. The mock is also process-global, so it breaks with more than one worker.
- **Fix:** Only build the mock when `settings.environment in {"development", "test"}` (or an explicit `EVOGYM_POINT_MOCK=true`). Otherwise raise a 503 "card terminal not configured".

### P2. Unreachable `except IntegrityError` plus a debug print — VERIFIED

- **Where:** `app/api/staff_attendance.py:641-650`.
- **Problem:** `except Exception: traceback.print_exc(); raise` comes before `except IntegrityError`. Two concurrent clock-ins for the same day return **500** instead of 409. `print_exc` also bypasses the safe-logging policy.
- **Fix:** Delete the `except Exception` block. One-line diff. Add a test for a duplicate clock-in that expects 409.

### P3. Blocking bcrypt and DB calls inside `async def`

- **Where:**
  - `api/profile_access.py:181-219`
  - `api/reception_auth.py:34-62`
  - `api/admin_auth.py:182-249`
- **Problem:** bcrypt at 12 rounds takes about 250 ms and runs on the event loop, together with synchronous SQLAlchemy. Every PIN login freezes **all** requests for that time.
- **Fix:** Make these routes plain `def` with the Pydantic body as a parameter. The FastAPI skill says: "In case of doubt, or by default, use regular `def`". `_AuthBodyLimitMiddleware` already bounds the body size, so `await request.body()` is not needed.

### P4. Card intent holds DB locks during a 15-second external HTTP call

- **Where:** `api/sales.py:225-243` and `sales/point.py:176`.
- **Problem:** The session stays open, with `with_for_update` on `RoleGrant`, while `urllib` calls Mercado Pago with `timeout=15`. The pool is size 5 with `max_overflow=0` and `pool_timeout=3` (`main.py:181-189`). Five slow terminal calls exhaust the pool, and every other endpoint fails.
- **Fix:** Check access, then close the session. Call the terminal outside any transaction. Then open a new session to persist the result. Make `pool_size` a setting.

## Should fix

### P5. No `Annotated`, no shared dependencies (0/149 routes)

- **Evidence:**
  - About 8 principal dependencies, each with its own `_bearer`/`_principal`.
  - 60 routes open `request.app.state.session_factory()` by hand.
  - `if factory is None: raise HTTPException(500)` is repeated.
- **Fix:** Create `app/api/deps.py`:

  ```python
  SessionDep = Annotated[Session, Depends(get_db)]          # yield, rollback, close
  def require(permission: Permission) -> ...                # one RBAC factory
  StaffDep = Annotated[ActorPrincipal, Depends(require_staff)]
  ```

  Declare shared dependencies on each `APIRouter(dependencies=[...])`. This is the same work as [01 A2/A9](01-backend-architecture.md#a2-auth-principalresolver-copy-pasted-about-9-times-inside-routers) and the first step toward a reusable core.

### P6. Error envelope loses domain codes

- **Where:** `errors.py:143-147`.
- **Problem:** Every `HTTPException` becomes `code: "http_error"`. Only 5 `DomainCode`s survive, and `sales.py:162` builds a second envelope shape by hand. Codes come from message text (`sales.py:159-161`).
- **Fix:** Introduce an `AppError` hierarchy with stable `code`s, and have one handler emit `{error: {code, message, request_id}}`. See [01 A4](01-backend-architecture.md#a4-domain-errors-mapped-to-http-by-comparing-message-strings).

### P7. Unexpected 500s leave no trace

- **Where:** `observability/request_id.py:54-58`, `errors.py:163`.
- **Problem:** Nothing logs the exception type or stack. Operators only see `route, 500, ms`.
- **Fix:** Log `type(exc).__name__` and a stack trace (without local variables), server-side only, tagged with the `request_id`.

### P8. Rate limiter is per IP, shared by all auth routes, and per process

- **Where:** `api/admin_auth.py:69-100`, `main.py:46`.
- **Problem:** Behind a proxy without `--proxy-headers`, the whole gym shares one key, so a few failed logins lock out everyone. With 2 or more workers, the limit multiplies.
- **Fix:**
  1. Key on `(ip, route_group)`.
  2. Deploy with `--proxy-headers --forwarded-allow-ips`.
  3. Move to the proxy or Redis if you run multiple workers.

### P9. Staff session TTL ignores its setting — VERIFIED

- **Where:** `api/admin_auth.py:141`.
- **Problem:** The TTL is hardcoded as `timedelta(days=90)`. `staff_session_ttl_seconds` (max 86400) is only checked for `is not None`, so a stolen phone bearer token lives 90 days.
- **Fix:** Use the setting, or delete it if 90 days is the intended policy (decision D6).

### P10. CI skips the newest PostgreSQL concurrency tests

- **Where:** `.github/workflows/api.yml:56-85`.
- **Problem:** These suites never run in CI:
  - `test_rentals_postgres.py`
  - `test_card_sales_postgres.py`
  - `test_product_sales_postgres.py`
  - `test_product_returns_postgres.py`

  CI uses Postgres 18, while compose uses 16.
- **Fix:** Add those files to the PostgreSQL step and align the versions.

### P11. No lint, type-check, lockfile or API container

- **Where:** `pyproject.toml:27-33` only configures pytest. `docker-compose.prod.yml` runs only Postgres.
- **Fix:**
  - Add `[tool.ruff]` and `ty` (or mypy) and run them in CI.
  - Commit `uv.lock`.
  - Add `[tool.fastapi] entrypoint`.
  - Write an `api/Dockerfile` that runs as non-root and uses `fastapi run --proxy-headers`.

### P12. Business constants hardcoded in the API

- **Currency:** `currency="MXN"` in `pending_money.py:218,243`, `members/read_queries.py`, `read_schemas.py:73` (`Literal["MXN"]`) and `sales/schemas.py`.
- **Fake terminal provisioning:** `_get_or_create_terminal_for_register` (`sales.py:80-86`) creates a terminal row with the fake device `GERTEC_MP35P__8701012345` as a side effect of a card-intent POST.
- **Cookie name:** `evogym_profile_access`.
- **Fix:** Move currency and the cookie prefix into settings or the Branch row. Return 409 when a register has no configured terminal.

### P13. Dev scripts have no environment guard

- **Where:**
  - `run_dev_server.py:18-28` auto-approves admin device logins.
  - `seed_receptionists.py:47-117` sets PIN `123456` for every user.
- **Fix:** At the top of both, exit unless `environment in {"development", "test"}`. Move the stray root scripts into `api/scripts/` or `app/cli/`.

## Nice to have

- **Return types:** 61/149 routes have no return type or `response_model` (for example `sales.py:95,102,184`, the auth token responses). Add Pydantic return models; this also gives the frontend generated types.
- **Duplicates:**
  - `db/engine.py:create_engine_from_settings` is duplicated inline in `main.py:180-189`.
  - `__import__("uuid")` and `__import__("time")` are used inline; use normal imports.
  - `staff_attendance.py:788-789` stacks two `@router.get` decorators on one function.
- **Member search:** `members/queries.py:66-72` uses `ilike('%q%')` without escaping `%` or `_`, so a search for `%` returns every row. Escape the wildcards; consider `pg_trgm` only if the table grows large.
- **Indexes:** Postgres does not index foreign keys automatically. Add `ix_payments_shift_id` and `ix_orders_shift_id` if `EXPLAIN` on shift close shows scans.
- **Tests:** There is no `api/tests/conftest.py`. `_setup_db` is defined 6 times, `_seed_branch` 5 times and `_seed_receptionist` 4 times. Extract shared fixtures and a `postgres` marker.
- **PII:** `members.py:124-143` gives any receptionist the member's email, birth date and emergency contact. Confirm this is intended (decision D7).
- **N+1 queries:** `rentals/queries.py:270,290` calls `charge_collectable_minor` once per charge. Low impact at the current scale.
- **Git:** `backend/membresias.ipynb` is tracked even though `.gitignore` excludes it. Run `git rm --cached`.

## Unauthenticated endpoints (by design — verify)

- **Rate- and body-limited:**
  - The `admin_auth.py` routes: sessions, staff sessions, recovery, device approve/poll, refresh, logout.
  - The `profile_access.py` routes, protected by a pairing cookie and a CSRF-style check.
- **Station credential:** `reception_auth.py` requires the `ReceptionStation` header.
- **No limiter at all:** `POST /api/v1/auth/devices/pair` (`device_pairing.py:134`) authenticates only with the enrollment code in the body. **Add rate limiting.**
- Every other route carries a principal dependency (AST scan).

## Repo hygiene

No `.env`, `dev.db`, spreadsheets, `tmp/` or `output/` are tracked, and the `.gitignore` rules cover them.

## What to keep

- Security primitives (listed above) and environment-gated docs and debug.
- `pydantic-settings` with `SecretStr`; SQLite refused outside tests.
- A documented lock order and idempotency fingerprints.
- Every router sets `prefix` and `tags`; most list endpoints are paginated with bounded `Query`.
- PostgreSQL concurrency tests: last unit, concurrent repayment, close-vs-sale.
