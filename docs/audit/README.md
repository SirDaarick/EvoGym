# Code audit — 2026-11-01

Full audit of architecture, practices and reuse readiness for EvoGym, on branch `integration/frontend-design` (commit `330ebf5`).
Goal: keep the code modular and reusable for future apps of other businesses.

## Reading order

| Doc | Topic | Must fix |
|---|---|---|
| [01-backend-architecture.md](01-backend-architecture.md) | Layering, coupling, bounded contexts, reuse candidates | 4 |
| [02-backend-fastapi-practices.md](02-backend-fastapi-practices.md) | FastAPI idioms, security, performance, tests, CI, hygiene | 4 |
| [03-frontend-architecture.md](03-frontend-architecture.md) | Folder structure, dependency direction, data layer, reuse candidates | 3 |
| [04-frontend-react-quality.md](04-frontend-react-quality.md) | Effects, re-renders, bundle, fetching, types | 2 |
| [05-ui-ux.md](05-ui-ux.md) | Accessibility, design tokens, interaction states, UI kit proposal | 6 |
| [06-reuse-roadmap.md](06-reuse-roadmap.md) | Phased plan and **owner decisions (D1–D10)** | — |

Start with **06** for the plan, then open the area you will work on.

## Verdict in one paragraph

**The strengths:**

- Strong security and concurrency primitives.
- Integer-cent money and timezone-aware datetimes.
- No framework leakage into backend domain code.
- Clean leaf layers (`shared/`, `domain/`) in the frontend.
- Behavior-focused tests.

**What blocks reuse:**

- Duplication: auth dependencies, HTTP clients, dialogs, colors.
- Logic placement: business rules in routers and in 1k-line components.
- A fake demo backend that doubles as the frontend's shared kernel.
- Hardcoded business identity: MXN, es-MX, Mexico City, brand.

**The fix is "consolidate, then move", not "add more layers".**

## Verified defects (fix first)

1. The mock card terminal auto-approves payments when Mercado Pago is not configured, in any environment (`api/app/sales/point.py:259`).
2. A dead `except IntegrityError` turns duplicate clock-ins into a 500 instead of a 409 (`api/app/api/staff_attendance.py:641`).
3. The frontend computes "today" in UTC in 12 places, so the evening shift sees tomorrow's date.
4. The staff session TTL is hardcoded to 90 days and ignores its setting (`api/app/api/admin_auth.py:141`).

## Method

- Five read-only Sonnet agents, one per area:
  - backend architecture
  - FastAPI and security
  - frontend architecture
  - React quality
  - UI/UX
- They used CodeGraph, import-graph scripts and targeted reads.
- The orchestrator re-checked every Must-fix and headline metric in the source before writing.
- Skills used: `ponytail`, `ponytail-review`, `fastapi` (official), `architecture-patterns`, `vercel-react-best-practices`, `web-design-guidelines`, `redesign-existing-projects`, `frontend-design`.

**Not run:** full test suites, typecheck, lint, production build, a rendered-DOM contrast check, and a load test. Counts are static greps and may be off by a few.

Earlier correctness audit: [../backend-audit/README.md](../backend-audit/README.md). This audit does not repeat its B01–E03 findings.
