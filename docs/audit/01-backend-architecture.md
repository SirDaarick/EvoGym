# 01 — Backend: architecture and reusability

Scope: `api/app` (FastAPI + SQLAlchemy + Alembic). Guides: `architecture-patterns`, `ponytail-review`.
Method: a computed import graph plus targeted reads. Tests were not reviewed here.
Earlier correctness findings (B01–E03) live in [../backend-audit/findings.md](../backend-audit/findings.md) and are not repeated.

## Current shape

```text
api/app/
├── main.py            app factory, lifespan engine, 24 hand-listed routers, rate limiter, CORS
├── settings.py        one flat Settings class (DB, auth, CORS, Mercado Pago)
├── errors.py          public error envelope; DomainCode = 5 gym codes
├── audit.py           append-only audit
├── db/models/         33 model files for ALL contexts, re-exported by __init__
├── api/               23 routers (~7,000 lines) — includes business logic
├── auth/ catalog/ inventory/ members/ memberships/ rentals/ sales/ shifts/
│                      each: schemas.py + queries.py (no service layer)
├── observability/     logging, metrics, request id, security log
└── expenses/          ONLY a stale __pycache__ (source is gone)
```

## What to keep

- **Clean HTTP boundary:** domain/query modules import no FastAPI or Starlette.
- **No cycles:** the context import graph is acyclic (`sales → inventory`, `shifts → inventory`, `members → rentals/memberships`).
- **Money:** integer minor units everywhere (57 `_minor` columns, a `MAX_MINOR` guard).
- **Time:** all 103 datetimes are `DateTime(timezone=True)`.
- **Ports where they matter:** `sales/point.py` (`PointTerminalClient` Protocol) is a real port for the card terminal.
- **Errors and audit:**
  - Error sanitization happens in one place.
  - Docs and debug are gated by environment.
  - Audit and security logs are append-only.
- **Concurrency is deliberate:** ordered `with_for_update`, idempotency keys and fingerprints.
- **Migrations:** one linear Alembic chain (0001–0048).

## Verdict on Clean/Hexagonal

`Session` is passed everywhere, there are no repository ports, and query modules import ORM models. For this project that is **acceptable pragmatism**, not a defect. The business rules depend on row locks, lock ordering and unique-constraint replays. An in-memory repository would not reproduce those, so a port layer would add code without adding reuse.

What actually blocks reuse is findings A1, A2, A4 and A5: logic in routers, scattered auth, errors coupled to message strings, and one shared model package. Add ports only for external providers (SMS, email, payments), as `point.py` already does.

## Must fix (biggest reuse blockers)

### A1. Routers hold the business logic; there is no service layer

- **Evidence:**
  - `api/sales.py:121-181` checks the role grant, locks staff, compares idempotency intent, commits, maps DTOs and replays on `IntegrityError`. The file has 19 `select(`, 10 commits and 88 `HTTPException`.
  - Similar weight in `admin_role_management.py` (22 selects, 13 locks), `staff_attendance.py` (22), `staff_schedules.py` (20) and `admin_staff_accounts.py` (22).
  - Staff, attendance, schedules, roster, roles and security alerts have **no module outside `api/`**. Their rules exist only as HTTP handlers.
- **Fix:** When you next touch a feature, move the transaction body into `app/<ctx>/service.py` as `def post_x(session, cmd) -> Result`. The router then only parses, calls and maps. Start with `sales.py:121-181`.
- **Reuse:** HIGH. Staff, attendance and roles are the most reusable parts and are currently the least reusable.

### A2. Auth principal/resolver copy-pasted about 9 times inside routers

- **Evidence:**
  - `AdminPrincipal` is defined 3 times (verified): `admin_role_management.py:28`, `admin_security_alerts.py:30`, `admin_staff_accounts.py:44`.
  - `ShiftActorPrincipal` (`shifts.py:59`) and `MemberActorPrincipal` (`members.py:44`) are identical in shape, and other contexts have their own variants.
  - Routers import auth from other routers: `sales.py:11` and `rentals.py:11` import from `api.shifts`, `member_check_ins.py:12` imports from `api.members`.
  - `_staff_rate_limit` and `_bounded_body` are duplicated in `admin_auth.py:74-100` and `staff_credentials.py:18`.
  - The copies already drift: `getattr(settings, ..., None)` in one, direct access in another.
- **Fix:** One `app/auth/deps.py` with a single `ActorPrincipal` and `require(permission)` returning `Annotated[ActorPrincipal, Depends(...)]`. Delete the copies.
- **Reuse:** HIGH. RBAC cannot be lifted out while its dependencies are scattered.

### A3. Near-copy of the product sale transaction (money path)

- **Evidence:** `sales/queries.py:59-129` (cash) and `:132-231` (card) repeat the lock order, idempotency check, shift lookup, product loop, stock validation and `MAX_MINOR` check.
- **Problem:** A fix to one path, for example the overtime rule, will silently miss the other.
- **Fix:** Extract `_build_product_order(session, register, items, payment_method)`. Only the Payment row and the status differ between the two.

### A4. Domain errors mapped to HTTP by comparing message strings

- **Evidence:**
  - `sales.py:159-161` compares `str(exc) == "Idempotency key was already used for a different request."`.
  - `ValueError` is caught as 422 and is also the base of `CashSaleConflictError`, `ProductReturnConflictError` and `RentalConflictError`.
  - The receptionist-grant query is repeated inline in 9+ places (for example `sales.py:58`, `:134`, `:194`, `shifts.py:194`, `inventory.py:219`, `rentals.py:57`), although `authorize()` exists.
- **Problem:** Rewording a message silently changes the API response. Any stray `ValueError` becomes a 422.
- **Fix:** Add an `AppError(code, http_status)` hierarchy (`NotFound`, `Conflict`, `Forbidden`) with one handler per base class in `errors.py`. Replace the inline grant queries with `authorize(session, staff_id, Permission.X, branch_id)`.

## Should fix

### A5. One shared model package welds every context together

- **Evidence:**
  - `db/models/__init__.py` exports about 70 models.
  - `sales/queries.py:12-16` imports 20 of them and mentions Membership 79 times.
  - The organization is a singleton: `OrganizationOwner.id == 1` and `_DEFAULT_ORG_ID` hardcoded at `members/read_queries.py:30`.
- **Fix (no rewrite):**
  1. Move each model file next to its context (`app/inventory/models.py`). Keep `db/models/__init__.py` as the re-export list for Alembic.
  2. Split `sales/queries.py` (943 lines) into a generic `pos/` (orders, payments, returns, idempotency) and a gym `membership_sales` that depends on it.

### A6. Inconsistent module and error shapes

- **Module shapes differ:**
  - `memberships/` has only `eligibility.py`.
  - `members/` splits `queries`/`read_queries`/`read_schemas`.
  - Staff areas have no context module at all.
- **Error shapes differ:**
  - `sales.py:162` returns `{"error": {code, message, request_id}}`.
  - Most other paths return `HTTPException(409, str(exc))`, which ends up as `code: http_error`.
- **Fix:** Use the A4 `AppError` and one module template per context: `models.py`, `schemas.py`, `service.py`, `queries.py`, `router.py`.

### A7. Small helpers duplicated across contexts

- **`utc_now`:** 3 copies (`member_check_ins.py:49`, `staff_attendance.py:26`, `auth/admin.py:49`).
- **Branch-local date:** `ZoneInfo(branch.timezone)` is inlined 7 times, although `rentals/payments.py:208` already has `local_today(branch)`.
- **Fingerprints:** 5 sha256 fingerprints built from `repr()` tuples (`rentals/payments.py:31`, `sales/queries.py:23,257,543,880`). `repr()` is a brittle hash input.
- **Fix:** Add `app/core/time.py` (`utc_now`, `local_date`) and `app/core/idempotency.py` (`fingerprint(*parts)` with canonical JSON). These are the cheapest extractions.

### A8. Status values are free strings checked only in SQL

- **Evidence:** 27 `CheckConstraint("... IN (...)")`, no SQLAlchemy `Enum`, and literal comparisons such as `register.status != "active"`.
- **Fix:** Add a `StrEnum` per status that controls branching, and build the CHECK text from the enum in one helper.

### A9. Session plumbing repeated in every handler

- **Evidence:** `factory = request.app.state.session_factory; if factory is None: raise ...; with factory() as session: ...; session.commit()` is repeated in every handler. `db/session.py:get_session` exists but is unused as a dependency.
- **Fix:** Add `SessionDep = Annotated[Session, Depends(get_session)]` and a unit-of-work dependency that commits on success.

### A10. `main.py` owns reusable infrastructure

- **Evidence:**
  - There are two engine builders: the `lifespan` one in `main.py:175-189` and `db/engine.py:create_engine_from_settings`, with different pool options.
  - The rate limiter is in-memory and per process.
  - The CORS subclass, the readiness probe and a 24-line router list all live in `main.py`.
- **Fix:**
  1. Make `lifespan` call `create_engine_from_settings`.
  2. Move the limiter and CORS into `app/core/http.py`.
  3. Keep one `ROUTERS` tuple.

## Nice to have

- **Settings:** Split `Settings` into `CoreSettings`, `AuthSettings` and `PaymentsSettings` (`settings.py:40-113`).
- **Currency:** MXN is hard-wired in CHECK constraints (`orders.py:34`, `rentals.py:244`). Leave it until a second currency is real, but put `MAX_MINOR` and `sum_minor()` in `core/money.py` now.
- **Small cleanups:**
  - `admin_auth.py` uses an inline `__import__("uuid")`.
  - `members/` and `catalog/` re-export from `__init__`, the other contexts do not. Pick one convention.
- **Stale `expenses/`:** It has no source (verified: only `.pyc`). Delete it, or restore it if it was lost (decision D4 in [06](06-reuse-roadmap.md)).

## Reuse extraction candidates

| Module | Generic? | Blockers | Effort |
|---|---|---|---|
| `observability/` | Yes | None significant | S |
| `errors.py` | Partly | Closed gym `DomainCode` | S |
| `settings`, `db/{base,engine,session}` | Mostly | Mixed settings, two engine builders | S |
| `core/time`, `core/idempotency`, `core/money` (new) | Yes | Scattered today | S |
| `audit` | Mostly | Gym actions (`member_read`), FKs to staff/branches | S |
| `auth/` (sessions, PIN, devices, recovery) | Yes | Deps live in routers (A2), shared models (A5) | M |
| RBAC (`auth/authorization.py`) | Mostly | Gym permissions, receptionist hardcoded in `_permits`, singleton owner | M |
| `inventory/` | Yes | Branch-scoped only | S |
| `shifts/` + cash register | Yes (any POS) | Logic in routers, membership mentions | M |
| `sales/` POS core | Core yes | Mixed with memberships in one 943-line file (A3, A5) | L |
| `rentals/` | Semi | Reads `Member` | M |
| Staff roster / attendance / schedules | Generic HR | No context module (A1) | L |
| `catalog`, `members`, `memberships`, check-ins | Gym-specific | — | keep in app |
