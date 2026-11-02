# F15 — Review owner daily operations summary (implementation plan)

Objective: implement the owner operations summary backend and wire it into the existing `/owner/overview` frontend (`Overview.tsx`), treating the current UI as the contract and adding or adjusting UI elements only where explicitly approved by the user. Status: **implementation — option 1 approved**. Baseline: HEAD `c2b9a69`; untracked paths at planning time: `.agents/skills/architecture-patterns/`, `.agents/skills/fastapi/`, `.agents/skills/web-design-guidelines/`, `.claude/`, `docs/audit/`, `odd/tasks/f15-daily-operations-summary.md` (preserve; do not modify unrelated paths).
Tracker branch: `feat/f15-daily-operations-summary`; test runners: pytest and Vitest. Mode: Ponytail full (zero new DB tables/migrations; single read-only aggregation endpoint). Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain` (user selected). Local slices: backend, then frontend; PR creation and push remain unauthorized. The cohesive backend endpoint and its regression tests exceed the advisory 400-line budget and require a size exception rather than splitting behavior from tests.

Discovery source: [f15-daily-operations-summary.md](f15-daily-operations-summary.md). Card: [remaining-feature-integrations.md § F15](remaining-feature-integrations.md#f15--review-one-named-owner-daily-operations-summary-p2-c).

## Specs

- **S1 — Frontend is the contract.** Keep the existing visual design, CSS classes (`bento-grid`, `executive-pulse-bar`, `clay-card`, `overview-pillar-card`), and `PeriodFields` (`from` / `to` date inputs) in `frontend/src/features/owner/Overview.tsx`. Live mode (`apiRequest` provided) must never read `DemoProvider`, `useDemo()`, or `localStorage` Gimi demo stores.
- **S2 — Date window and branch scope.** Query accepts `from` and `to` (`YYYY-MM-DD`, defaulting to today in `branch.timezone`, default `America/Mexico_City`) plus optional `branch_id` (defaults to the first authorized active branch). Rejects `to < from` with `422`.
- **S3 — Finance & Shift reconciliation.** Reuses the canonical formula in `api/app/shifts/queries.py` (`shift_financial_summary`) across the date window for `branch_id`: confirmed `cash_minor` and `card_minor` (orders + rentals + membership debt payments minus product refunds and rental cancellation refunds), `confirmed_count`, pending transfers (`Payment.method == 'transfer'` and `status IN ('under_review', 'pending')`), closed shift cash discrepancies (`Shift.status == 'closed'` and `difference_minor != 0`), and shift inventory count discrepancies (`ShiftInventoryObservation.physical_quantity != expected_quantity`).
- **S4 — Members & Attendance.** Computes member base KPIs (`total_members`, `active_members`, `active_percent`, `median_tenure_months`, `expiring_soon_count` within 7 days, `expired_count`) from `Member` + `MembershipPeriod`, and attendance KPIs (`live_occupancy_count` from distinct check-ins within the last 90 minutes on the branch's current day, `gym_capacity = 50`, `peak_hour`, `valley_hour`, `total_check_ins`, `memberships_sold_count`, `memberships_renewed_count`) from `MemberCheckIn`, `ClassSampleCheckIn`, and `MembershipPeriod`.
- **S5 — Inventory, Operations & Staff.** Computes active products count, low-stock count (`on_hand <= 5` via `list_branch_stock` logic in `api/app/inventory/queries.py`), retail units sold and retail revenue (`OrderItem` for product sales in period), operational alerts count + category breakdown (shift cash discrepancies, inventory count discrepancies, low stock, overdue lockers from `Rental`, unreviewed rental cancellations from `RentalCancellation`), and staff/payroll summary (`next_payday`, `days_until_payday`, `estimated_payroll_minor` via `weekly_base` from `api/app/api/payroll.py`, `staff_on_duty_count`, `staff_absent_count` from `StaffAttendanceRecord`).
- **S6 — Safety & Authorization.** Protected by `FinancePrincipal` and `_authorized_branches` (reused from `api/app/api/pending_money.py`). Returns `403` for unauthorized roles (`RECEPTION`, unauthenticated) or unauthorized `branch_id`. Read-only endpoint leaves database state untouched.

## Contract gap (option 1 approved)

Comparing the existing UI in `frontend/src/features/owner/Overview.tsx` against the backend domain and `odd/tasks/f15-daily-operations-summary.md`:

| Element | In `f15-daily-operations-summary.md` (Backend/Discovery) | In `Overview.tsx` (Current Frontend UI) | Status |
|---|---|---|---|
| **1. Period filter** | Single `date` param (`YYYY-MM-DD`) | `PeriodFields` range (`from`, `to`) defaulting to today | Backend can accept `from` & `to` (defaulting both to today) so `PeriodFields` works with zero UI change. |
| **2. Equipo y Nómina (Pilar 3 in discovery)** | `next_payday`, `days_until_payday`, `estimated_payroll_minor`, `staff_on_duty_count`, `staff_absent_count` + link `/owner/staff` | ❌ **No card or section exists in `Overview.tsx`** | **Gap A (Backend element with no UI)** |
| **3. Check-ins totales y ventas/renovaciones de membresía** | `total_check_ins`, `memberships_sold_today`, `memberships_renewed_today` | ❌ **Not shown** (`Overview.tsx` shows `Hora pico`, `Hora valle`, `Duración promedio` in Attendance, and `Permanencia`, `Por vencer`, `Vencidas` in Members) | **Gap B (Backend elements with no UI; conversely `Duración promedio` has no checkout timestamp in DB)** |
| **4. Casilleros vencidos (`overdue_lockers_count`)** | Dedicated line in Pilar 4 (`1 casillero vencido sin desalojo`) | Shown only indirectly if included as a category tag inside `Operaciones, alertas y Gimi AI` (`alertsResult.categoryCounts`) | **Gap C (Can map into `categoryCounts` or add a stat box)** |
| **5. Gimi AI stats (`totalConversations`, `resolutionRate`)** | Not in F15 backend (Gimi is deferred in `remaining-feature-integrations.md:271`) | Shown in Pulse bar subtext (`Gimi AI: X% resuelto`) and in Card 6 (`Conversaciones Gimi`, `Resolución autónoma`, link `/owner/gimi`) | **Gap D (Frontend element with no backend in scope)** |

### Proposed Minimalist Resolution (Ponytail)

- **Option 1 (Strict UI preservation + 1 new Staff card):** Keep all existing cards in `Overview.tsx` intact; add one `overview-pillar-card` for **Equipo y nómina** (`Próximo pago`, `Nómina semanal estimada`, `Staff en turno / ausencias`, link `/owner/staff`) using the exact same `Panel className="clay-card overview-pillar-card"` structure; in Attendance, replace `Duración promedio` (uncomputable without check-out timestamps) with `Visitas en el periodo` (`total_check_ins`) and show `Nuevas / Renovaciones` in the subtitle; include `Casilleros vencidos` as a category in `categoryCounts`; hide or show `No disponible` for Gimi AI metrics in live mode since Gimi is deferred.
- **Option 2 (Zero JSX layout additions):** Do not add the Staff & Payroll card to `Overview.tsx`; only wire the existing cards in `Overview.tsx` to the backend and omit `staff` from the UI until a later task.

## Backend contract

No migration required (reads existing tables).

**Route** (`api/app/api/owner_overview.py`, registered in `api/app/main.py`):

| Method & path | Behavior |
|---|---|
| `GET /api/v1/owner/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&branch_id=UUID` | Defaults `from` and `to` to current date in branch timezone. Returns aggregated DTO covering `period`, `pulse`, `finances` (totals + `shift_discrepancies[]` + `count_discrepancies[]`), `members`, `attendance`, `inventory`, `staff`, and `alerts` (`total_count` + `category_counts[]`). |

## Frontend wiring

- **`frontend/src/api/ownerOverviewApi.ts`**: `getOwnerOverview(request, { from, to, branchId })` returning typed `OwnerOverviewResponse`.
- **`frontend/src/features/owner/Overview.tsx`**:
  - Export `Overview({ apiRequest }: { apiRequest?: AuthenticatedRequest } = {})` following the house dispatcher pattern (`PlanCatalog.tsx`, `ExpenseReport.tsx`):
    - When `apiRequest` is omitted: renders `DemoOverview` (existing `useDemo()` path, preserving all existing demo tests).
    - When `apiRequest` is provided: renders `LiveOverview`, fetching `GET /api/v1/owner/overview?from=...&to=...` whenever valid `period` changes, and passing data into the shared presentational view.
- **`frontend/src/app/ApiProductApp.tsx`**:
  - Mount `<Overview apiRequest={apiRequest} />` when `pathname === '/owner/overview' && isAdmin && admin.status === 'authenticated'`.

## Tasks (ODD, one delivery per phase)

- [x] **T01 — Freeze contract & resolve Q1.** User approved option 1: staff card, period visits and new/renewed memberships, overdue lockers as an alert category, and unavailable Gimi metrics in live mode.
- [x] **T02 — Backend aggregation endpoint (RED→GREEN; inline; commit `4b90f96`).** Create `api/app/api/owner_overview.py` and register in `api/app/main.py`. Write `api/tests/test_owner_overview.py` testing:
  - `200 OK` with persisted fixture across shifts, cash/card sales, pending transfers, member check-ins, memberships, inventory low stock, staff attendance/payroll, and overdue lockers.
  - Cash/card totals reconcile with shift financial summary.
  - Timezone boundary (`America/Mexico_City`) and date range filtering (`from > to` → `422`).
  - Zero/empty branch state returns clean zeros without errors.
  - Non-admin (`RECEPTION`) and wrong-branch callers receive `403 Forbidden`.
- [x] **T03 — Frontend live adapter & route mount (inline; commit pending).** Create `frontend/src/api/ownerOverviewApi.ts`, split `Overview.tsx` into `LiveOverview` / `DemoOverview` sharing the Bento layout, and mount `/owner/overview` in `ApiProductApp.tsx`. Live behavior tests and existing demo tests pass; RED was not observed before the frontend implementation.
- [x] **T04 — Verification & Browser Acceptance (inline and per-action worker; independent verification passed on retry; commit pending).** Targeted and affected backend `pytest` suites, `npm run test`, `npm run typecheck`, `npm run build`, and Playwright acceptance were run. Two suite failures reproduced on baseline and remain documented below.

Verification tier: **medium** (read-only aggregation, no schema migration or money mutation) → writer self-verification + parent spot check.

## Risks / not covered

- `MemberCheckIn` has no check-out timestamp; live occupancy in room is approximated by distinct check-ins in the last 90 minutes on the current branch date, and average session duration is not stored in DB.
- `Product` has no per-item reorder threshold column in DB; low-stock count uses the existing `<= 5` threshold from `inventoryAnalyticsSelector.ts`.
- Gimi AI is deferred in `remaining-feature-integrations.md:271` and has no backend persistence.

## Log

- L1: User requested an ODD + Ponytail implementation plan for F15 (`odd/tasks/f15-daily-operations-summary.md` / `remaining-feature-integrations.md`), treating the existing frontend (`Overview.tsx`) as the contract and flagging any backend elements without frontend representation so we can decide together how to implement them.
- L2: User requested: “me ayudas a implementar @odd/tasks/f15-daily-operations-summary-implementation.md”.
- L3: User approved option 1: “si autorizo la opcion 1”.
- L4: Implementation investigation: staff attendance records represent affirmative presence; scheduled shifts are stored separately and can have exceptions. The plan did not define when an unrecorded scheduled employee becomes absent. Engram feature-document mirror pending.
- L5: User confirmed “si”: consider an employee absent only if a scheduled shift has started and the employee has not checked in, respecting schedule exceptions.
- L6: Created branch `feat/f15-daily-operations-summary` from `c2b9a69`. Added an initial endpoint test in `api/tests/test_owner_overview.py`; `api/.venv/Scripts/python.exe -m pytest tests/test_owner_overview.py -q` is RED because the route does not exist (404). System Python could not collect the test because `argon2` is not installed. T02–T04 remain open; no endpoint or frontend integration is implemented yet.
- L7: Added the owner overview endpoint, live UI adapter and route mount. Focused backend checks: 5 passed including cash sale, stock, scoped authorization, and absence schedule exceptions; focused frontend checks: 12 passed and typecheck passed. Affected backend suite: 32 passed before the latest additional tests. Full frontend suite: 865 passed, one failure in `ApiProductApp.test.tsx:266`; the same failure was reproduced on baseline `c2b9a69`. Independent verifier confirmed focused tests (5 passed) in an isolated copy. Playwright acceptance, full transaction/attendance edge coverage, shared presentation and final verification remain pending. Engram feature-document mirror pending.
- L8: Added coverage for branch-timezone midnight boundaries and an overtime cash sale; the overtime test failed before the fix and passed afterward. Seven focused backend tests passed before the last expiration-boundary adjustment. Playwright is not installed locally; browser acceptance remains pending. Engram mirror is being synchronized.
- L9: Playwright and Chromium were found globally. Disposable SQLite + FastAPI + Vite + Playwright acceptance: 12/12 checks passed after the shared-view refactor, with only the device-approval email delivery substituted by an auto-approval stub. Local processes stopped and scratch removed. Owner endpoint tests: 11 passed; focused Overview frontend tests: 13 passed; frontend typecheck and build passed. Affected backend suite: 76 passed and one rental migration assertion failed; the same failure reproduced on baseline `c2b9a69`. Full frontend suite: 867 passed and one member-history assertion failed; the same failure reproduced on baseline. The final independent verifier for shared demo/live behavior timed out preparing its isolated copy and supplied no independent runtime verdict; T04 remains open. No commits have been created. RDD is clone-disabled.
- L10: User requested an independent-verification retry: “puedes intentarla de nuevo?”. In bounded isolated candidate and baseline copies, the verifier observed 11/11 owner endpoint tests, 13/13 live/demo Overview tests, the live route-mount test, and 10/10 baseline demo Overview tests passing. No candidate-caused blocker was reproduced. Scratch copies were removed and workspace dependencies preserved. Delivery strategy remains `ask-on-risk`; the >400-line forecast requires a chain-strategy decision before work-unit commits.
- L11: User selected “Cadena de feature” for local delivery organization. No push or PR creation was authorized. Backend endpoint and regression tests form one cohesive slice exceeding the advisory review budget; retain all required coverage and recommend a size exception.
- L12: Backend slice `feat/f15-daily-operations-summary-api` committed as `4b90f96` (559 insertions; endpoint and tests together). The prior boundary is tracker `feat/f15-daily-operations-summary` at `c2b9a69`; the frontend slice builds on this commit. No push or PR was created.
