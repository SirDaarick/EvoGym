# 06 — Reuse roadmap and decisions

Goal: make EvoGym modular enough that a second business app can reuse auth, staff, cash shift, POS, inventory, UI kit and infrastructure without starting from zero.

## Key insight

The code is **not** badly layered in the textbook sense:

- Backend domain modules import no FastAPI.
- `shared/` and `domain/` import nothing.
- There are no backend cycles.

Reuse is blocked by **duplication and placement**, not by missing abstraction layers:

| Blocker | Backend | Frontend |
|---|---|---|
| Logic in the wrong place | Business rules live in routers ([01 A1](01-backend-architecture.md#a1-routers-hold-the-business-logic-there-is-no-service-layer)) | Data, state and UI live in 1k-line components ([03 F4](03-frontend-architecture.md#f4-giant-components-that-mix-data-state-and-ui)) |
| Copy-pasted plumbing | About 9 auth principals, 60 hand-opened sessions ([02 P5](02-backend-fastapi-practices.md#p5-no-annotated-no-shared-dependencies-0149-routes)) | 7 `Request` types, about 15 error classes, 30 dialogs ([03 F3](03-frontend-architecture.md#f3-no-central-http-client), [05 U1](05-ui-ux.md#u1-dialogs-have-no-focus-management-30-hand-rolled-copies)) |
| Shared kernel in the wrong place | One `db/models` package for all contexts ([01 A5](01-backend-architecture.md#a5-one-shared-model-package-welds-every-context-together)) | `demo/` holds live utilities and types ([03 F1](03-frontend-architecture.md#f1-demo-fake-and-live-code-are-interleaved-demo-is-the-de-facto-shared-kernel)) |
| Hardcoded business identity | MXN, the singleton org, the cookie name, the terminal id | es-MX, Mexico City time, Spanish copy, brand colors, the EvoGym manifest |

So the plan is **consolidate, then move**. It is NOT "add hexagonal layers everywhere". Adding ports over SQLAlchemy would cost a lot and buy no reuse, because the rules depend on row locks.

## Target module map

```text
core (reusable, business-agnostic)
  backend:  core/{errors, time, money, idempotency, http}, auth (+ deps), rbac, audit, observability, settings, db
  frontend: core/{http, ui, i18n/format, auth, config}

modules (reusable business modules, configurable)
  staff (accounts, roster, schedules, attendance), cash-shift, pos (orders, payments, returns, card terminal port), inventory, alerts

gym app (EvoGym-specific)
  members, memberships & plans, check-ins, class samples, rentals (gloves/lockers), Gimi
```

Dependency rule: `app → gym features → modules → core`. Enforce it with lint: `eslint-plugin-boundaries` on the frontend and `import-linter` on the backend. Without enforcement, the boundaries will erode again.

## Phases

Each phase is shippable on its own and keeps behavior unchanged, except where the phase fixes a defect.

### Phase 0 — Fix real defects (days)

| # | Item | Doc |
|---|---|---|
| 1 | Mock card terminal guarded by environment (allowed only in `development`, `test`, `demo`) | [02 P1](02-backend-fastapi-practices.md#p1-the-mock-card-terminal-is-the-silent-fallback-in-every-environment--verified) |
| 2 | Remove the dead `except` in attendance (500 → 409) | [02 P2](02-backend-fastapi-practices.md#p2-unreachable-except-integrityerror-plus-a-debug-print--verified) |
| 3 | `def` instead of `async def` for bcrypt routes | [02 P3](02-backend-fastapi-practices.md#p3-blocking-bcrypt-and-db-calls-inside-async-def) |
| 4 | No DB locks held during the terminal HTTP call | [02 P4](02-backend-fastapi-practices.md#p4-card-intent-holds-db-locks-during-a-15-second-external-http-call) |
| 5 | UTC "today" → business date (12 sites) | [04 R1](04-frontend-react-quality.md#r1-today-is-the-utc-date-not-the-gyms-business-date) |
| 6 | Swallowed errors in attendance loads | [04 R2](04-frontend-react-quality.md#r2-secondary-loads-swallow-errors-no-request-cancellation) |
| 7 | Environment guard on dev seed scripts (the demo gets its own fake-data seed); rate-limit device pairing | [02 P13](02-backend-fastapi-practices.md#p13-dev-scripts-have-no-environment-guard) |
| 8 | Add the four skipped PostgreSQL suites to CI | [02 P10](02-backend-fastapi-practices.md#p10-ci-skips-the-newest-postgresql-concurrency-tests) |

### Phase 1 — Guardrails (about 1 week)

- **Backend:** ruff + ty in CI, `uv.lock`, an API Dockerfile.
- **Frontend:** ESLint with `react-hooks`, boundaries and `no-explicit-any`, plus Stylelint (no hex outside tokens).
- Add stricter `tsconfig` flags.
- Write a `CONTRIBUTING` note with the dependency rule.

### Phase 2 — Consolidate plumbing (1–2 weeks)

- **Backend:**
  - `app/api/deps.py`: `SessionDep`, one `ActorPrincipal`, `require(permission)`.
  - An `AppError` hierarchy plus one error envelope.
  - `core/time` and `core/idempotency`.
- **Frontend:**
  - `api/http.ts` (one client, one error base, one token provider).
  - Move `formatMoney`/`Plan`/`memberStatus` out of `demo/`.
  - `shared/routing` (breaks the `app ↔ features` cycle).
  - `businessDate`/`useClock`.

### Phase 3 — Design system (2–3 weeks, incremental)

- Semantic tokens, including `primary-ink` and status colors.
- Native `Dialog` + `ConfirmDialog`, then migrate the 30 dialogs.
- `DataTable`, `Combobox`, `Tabs`, `useSubmitLock`.
- `createFormat()` + `appConfig`.

See the [05 kit proposal](05-ui-ux.md#proposal-a-reusable-ui-kit-coreui).

### Phase 4 — Move logic to where it belongs (per feature, as touched)

- **Backend:** Move transaction bodies into `<ctx>/service.py`. Start with sales: dedupe cash/card first (A3), then split POS from membership sales. Create real `staff/` contexts out of the staff routers.
- **Frontend:**
  - Container/presentational splits, starting with `StaffManagement`, `CasillerosModal`/`GuantesModal` and `ReceptionHome`.
  - Adopt TanStack Query.
  - Generate DTO types from OpenAPI.
- **Demo (D1):** a fake-data seed and an `environment=demo` deployment. Delete each `demo/` branch once its live screen exists.

### Phase 5 — Extract (only when the second app is real)

Turn `core` and `modules` into workspace packages, or a shared repo, depending on D2. Move model files next to their contexts (A5). Do NOT do this earlier: the boundaries must be stable first, and Phase 1 lint proves that they are.

## Decisions taken (2026-11-01)

| ID | Decision | Consequence for the plan |
|---|---|---|
| D1 | Keep a demo to show prospective clients, with no real gym data. | **Recommended:** run the demo as its own deployment of the real API with a fake-data seed (`environment=demo`, reset on a schedule). Retire the frontend `demo/` fake backend once the live app covers every screen (Overview, History, Attendance and Gimi are demo-only today). Components then lose their demo branches (F1, R6, R7) and there is one app to maintain. **Alternative, only if the demo must work offline:** a fake `request` that implements the API contract from local data. Still one app, but the fake must follow every API change. |
| D3 | One installation and one Docker deployment per client; clients never share data. | No multi-tenancy: the singleton org stays and no `organization_id` work is needed. Business identity (brand, locale, currency, time zone, card terminal) becomes per-deployment configuration: settings/env in the API, and a runtime `config.json` in the frontend so one image serves every client. |
| D2 (partial) | Reuse targets other business types, not only other gyms. | Confirms the `core` / `modules` / gym `features` split. How to package it stays open until a second app is real (Phase 5). |

## Decisions needed from the owner

These change priorities. The audit could not decide them from the code.

| ID | Question | Why it matters |
|---|---|---|
| D2 | How will the second app reuse code: fork/copy, shared packages in this monorepo, or a separate shared repo? | Decides whether Phase 5 is folders + lint or real packages. |
| D4 | `api/app/expenses/` has no source, only `.pyc`. Removed on purpose or lost? | Delete or restore. |
| D5 | Is Spanish/MXN/Mexico City fixed for future products? | Decides between a format layer only and a full i18n message catalog. |
| D6 | Is the 90-day staff session lifetime intended? | P9. |
| D7 | Should receptionists see member email, birth date and emergency contact? | PII exposure (02, nice-to-have). |
| D8 | Light or dark by default on the counter tablet? | U5. |
| D9 | Stay on Tailwind v4 `@theme` with plain CSS, or move to CSS Modules? | Shapes the UI kit (U9). |
| D10 | Single uvicorn worker or several? Behind a reverse proxy? | P1 and P8 (in-process state), `--proxy-headers`. |
