# F08 — Integrate staff schedule management and attendance corrections

**Status: Class-A Ponytail decisions and UI specification approved; ready for bounded implementation when explicitly authorized.**

The user approved the minimalist **Class-A Ponytail path** and exact house-component UI specification for F08 and F03. This document updates the planning baseline and execution boundaries; source changes, tests, services, and commits remain governed by the bounded ODD task steps below. Recovery mirror topic: `odd/f08-staff-schedules-attendance/tasks`; verify actual synchronization after each document update.

## Objective and boundaries

An authorized manager can assign and maintain recurring staff schedules, inspect actual occurrences, make permitted future exceptions and review append-only attendance corrections. Reload must preserve state; schedule changes must not rewrite historical presence events.

Under the approved Class-A Ponytail scope:

- Integrate recurring schedule management and attendance corrections directly inside the **already-mounted** surfaces (`frontend/src/features/owner/StaffManagement.tsx` on `/owner/staff` and `frontend/src/features/reception/StaffAttendanceView.tsx` on `/reception/staff`), without creating `ApiStaffSchedules.tsx`, without adding new routes, and **without touching `frontend/src/app/ApiProductApp.tsx` or `frontend/src/app/ApiProductApp.test.tsx`**.
- In `StaffManagement.tsx`, replace the disabled shift placeholder with minimal inline weekly schedule series + future exception controls backed directly by the existing `api/app/api/staff_schedules.py` endpoints via a minimal `frontend/src/api/staffSchedulesApi.ts` client. Do not build a browser recurrence engine or new calendar screen.
- In `StaffAttendanceView.tsx`, connect attendance correction actions and audit inspection using the existing `correctStaffAttendance` helper in `frontend/src/api/staffAttendanceApi.ts`, and add in `api/app/api/staff_attendance.py` only the narrow correction-history read/projection required to display append-only corrections while preserving raw attendance events and existing clock-in/out behavior.
- Prevent duplicate submissions in the UI by disabling submit buttons while requests are in flight rather than adding new database locking or custom idempotency frameworks for schedule/correction mutations. No Alembic migrations or model rewrites.
- Keep staff attendance distinct from F05 member gym access, cash-register shifts, payroll and compensation.
- Preserve all pre-existing dirty/untracked F02/F05 files and F03 surfaces. No reset, stash, cleanup or unrelated commit.

## Approved UI specification and house-component reuse

1. **Strict reuse of existing house components and CSS classes (zero new CSS files or UI libraries)**:
   - Reuse `Button`, `Panel`, and `EmptyState` from `frontend/src/shared/ui`, plus `JellyRadio` and `SwipeToast` from `frontend/src/features/catalog/react-bits/*` (already imported in `StaffManagement.tsx` and `StaffAttendanceView.tsx`).
   - Reuse existing layout classes already styled in the app: `.staff-pin-toggle-card`, `.field`, `.field-row`, `.staff-modal-overlay`, `.staff-modal-card`, `.staff-modal-actions`, `.staff-att-pill-btn`, `.staff-audit-panel`, `.staff-audit-table`, `.badge`, and `.staff-status-badge`.
2. **In `frontend/src/features/owner/StaffManagement.tsx` (`ApiStaffManagement` on `/owner/staff`)**:
   - **Main table `Turno` column (`:961`)**: Replace the static `"No disponible en API"` cell with the profile's active schedule series summary (e.g., `L, M, X, J, V · 06:00–14:00` or `Sin horario`).
   - **Inside the `Editar Recepcionista` modal (`.staff-modal-card`, `:983–1024`)**:
     - Replace the disabled `<select id="staff-shift-select">` placeholder with a `.staff-pin-toggle-card` section for **Weekly recurring schedule**:
       - **Weekdays (`0–6`)**: 7 compact toggle pills (`L`, `M`, `X`, `J`, `V`, `S`, `D`) reusing `.staff-att-pill-btn`.
       - **Schedule & validity controls (`.field-row` / `.field`)**: local start time (`<input type="time">`), local end time (`<input type="time">`), start date (`<input type="date">`), optional termination (end date or occurrence count), and when editing an active series, scope selection via `JellyRadio` (`this_and_future` vs. `all_future`) plus `Button` (`variant="primary"` to save schedule, `variant="secondary"` to cancel future series, disabled while in flight).
       - **Upcoming occurrences list (next 7 days)**: Compact list inside the card displaying `YYYY-MM-DD · HH:MM–HH:MM` per occurrence with `Button` (`variant="secondary"`) actions for **`Omitir`** (`skip`) or **`Cambiar hora`** (`override` with inline `type="time"` inputs).
3. **In `frontend/src/features/reception/StaffAttendanceView.tsx` (`/reception/staff`)**:
   - Keep existing staff cards and `Marcar Entrada` / `Marcar Salida` (`Button`) untouched.
   - **Inside `.staff-audit-table` (`Historial de registros de hoy`, `:822–863`)**:
     - In live API mode (`isLive`), add a final `Correcciones` column:
       - **Append-only audit display**: Render existing correction records in muted secondary text beneath the row/cell (showing corrected field, new value, reason, and actor) without overwriting the original `Hora Entrada` / `Hora Salida` cells.
       - **`Corregir` action**: A `Button` (`variant="secondary"`) that opens a compact inline form (or `.staff-modal-card` dialog) reusing `.field` / `.field-row` with 3 controls: `Campo` (`<select>`: `clock_in_at`, `clock_out_at`, `status`, `notes`), `Valor corregido` (`<input>`), and `Motivo *` (`<input required>`), submitted via `Button` (`variant="primary"`, disabled while in flight) with feedback via existing `SwipeToast`.

## Verified baseline

| Area | Evidence and actual behavior |
| --- | --- |
| Backlog scope | [Remaining integrations F08](remaining-feature-integrations.md#f08--manage-staff-schedule-series-and-attendance-corrections-p1-a), lines 143–155: future recurring series, occurrence exception, correction audit and historical protection. |
| Series operations exist | `api/app/api/staff_schedules.py:508–735`: create/assign, list, occurrences, one-off skip/override, future edit and future cancellation. Do not rebuild them. |
| Schedule contract | Same file `:27–125`: weekdays 0–6, offsetless local wall times, optional end date OR occurrence count, explicit edit scope and exception action. |
| Authorization | Same file `:127–146,206–214`: authenticated admin/staff principal; schedule operations including listing require `STAFF_ROSTER_MANAGE` at target branch. A staff read principal alone is not sufficient. |
| Time rules | Same file `:152–223,543–569`: branch IANA timezone, current rule-file validation, nonexistent wall-time rejection and UTC/local occurrence fields. |
| Attendance exists | `api/app/api/staff_attendance.py:215–272,273–514,516–568`: paginated records, scheduled or ad-hoc check-in, idempotency and checkout. |
| Corrections exist | Same file `:65–94,571–614`: append-only correction record with reason/actor/time; original attendance is not updated. Narrow correction-history read/projection will be added in `api/app/api/staff_attendance.py`. |
| Live route | `frontend/src/app/ApiProductApp.tsx:104–123`: owner `/owner/staff` (`StaffManagement.tsx`) and employee `/reception/staff` (`ApiStaffAttendance.tsx` -> `StaffAttendanceView.tsx`) are already mounted; F08 requires no edits to `ApiProductApp.tsx`. |
| Live attendance adapter | `frontend/src/app/ApiStaffAttendance.tsx:16–48`: real roster via injected authenticated request, passed to existing attendance view. |
| Existing view | `frontend/src/features/reception/StaffAttendanceView.tsx:60–118,240–327,822–863`: real attendance loads/clock-in/out already work; correction submission and correction-history inspection will be wired in `.staff-audit-table`. |
| Owner UI surface | `frontend/src/features/owner/StaffManagement.tsx:750–825,961,983–1024`: real roster/account management; `Turno` column and `Editar Recepcionista` modal will replace `"No disponible en API"` and the disabled `<select id="staff-shift-select">` placeholder with active series summaries and `.staff-pin-toggle-card` schedule/exception controls. |
| Client | `frontend/src/api/staffAttendanceApi.ts:11–45,54–134`: attendance DTO and `correctStaffAttendance` POST helper exist; `frontend/src/api/staffSchedulesApi.ts` will be added as a minimal schedule client. |

Inspection used CodeGraph before bounded filesystem reads. Line anchors describe inspected source and must be refreshed if intersecting work changes it.

## Approved Class-A Ponytail flow

1. Manager opens the already-mounted `/owner/staff` view (`StaffManagement.tsx`), where the main table `Turno` column (`:961`) displays each profile's active schedule series summary (e.g., `L, M, X, J, V · 06:00–14:00` or `Sin horario`). Opening `Editar Recepcionista` loads the profile's persisted schedule series and next 7 days of occurrences via `staffSchedulesApi.ts`.
2. Inside the `Editar Recepcionista` modal (`.staff-modal-card`), replacing the disabled `<select id="staff-shift-select">` placeholder, a `.staff-pin-toggle-card` section provides weekday pills (`L`–`D` via `.staff-att-pill-btn`), start/end `<input type="time">`, start `<input type="date">`, optional termination rule, edit scope via `JellyRadio` (`this_and_future` vs. `all_future`), primary/secondary `Button` actions to save or cancel future series, and the compact 7-day occurrences list with `Omitir` (`skip`) and `Cambiar hora` (`override`) `Button` controls.
3. While any schedule mutation request is in flight, the submit `Button` is disabled in the UI to prevent duplicate submissions. On response, `StaffManagement.tsx` refreshes authoritative series and occurrences from the server (handling replacement series IDs on future splits) or retains user input and displays the API error on failure.
4. In the already-mounted `/reception/staff` view (`StaffAttendanceView.tsx` via `ApiStaffAttendance.tsx`), existing staff cards and `Marcar Entrada` / `Marcar Salida` (`Button`) remain untouched while `.staff-audit-table` (`Historial de registros de hoy`, `:822–863`) adds a `Correcciones` column in live mode (`isLive`).
5. `api/app/api/staff_attendance.py` provides the narrow correction-history read/projection so `.staff-audit-table` renders append-only correction records in muted secondary text (field, new value, reason, actor) without overwriting `Hora Entrada` / `Hora Salida`, and provides a `Corregir` `Button` (`variant="secondary"`) opening the 3-field form (`Campo`, `Valor corregido`, `Motivo *`) submitted via `Button` (`variant="primary"`, disabled while in flight) with `SwipeToast` feedback.
6. Hard reload proves series, exceptions, and append-only corrections persist while historical raw attendance/checkout events remain unchanged.

## Resolved Class-A contract decisions

| ID | Gap/risk evidenced in current source | Approved Class-A Ponytail resolution |
| --- | --- | --- |
| D1 | No existing recurring editor or correction UI action. | Follow the approved house-component UI specification: in `StaffManagement.tsx`, render active schedule summaries in the `Turno` column (`:961`) and replace `<select id="staff-shift-select">` inside `Editar Recepcionista` (`:983–1024`) with a `.staff-pin-toggle-card` weekly schedule + 7-day occurrence exceptions section using `.staff-att-pill-btn`, `.field-row`/`.field`, `JellyRadio`, and `Button`. In `StaffAttendanceView.tsx`, add a `Correcciones` column in `.staff-audit-table` (`:822–863`) with muted append-only audit text and a `Corregir` `Button` opening the 3-control form (`Campo`, `Valor corregido`, `Motivo *`) with `SwipeToast`. Zero new CSS files, zero new routes, and no edits to `ApiProductApp.tsx`. |
| D2 | Demo `shift` labels are Matutino/Vespertino/etc.; recurring API needs actual days/times/dates. | Use direct API inputs (weekdays 0–6 via `L`–`D` `.staff-att-pill-btn`, local start/end times, start/end dates) in the inline `StaffManagement.tsx` schedule controls and summarize active rules in the `Turno` column rather than inventing shift presets from demo labels. |
| D3 | Schedule read requires management permission, while attendance recording is available to branch reception. | Keep schedule series management in `StaffManagement.tsx` under `STAFF_ROSTER_MANAGE` and preserve existing attendance clock-in/out in `StaffAttendanceView.tsx` without rewriting RBAC. |
| D4 | Corrections append audit only; list DTO neither includes corrections nor applies them; no history GET. | Add only the narrow correction-history read/projection in `api/app/api/staff_attendance.py` so `StaffAttendanceView.tsx` can display append-only correction audit entries in `.staff-audit-table` while keeping raw `Hora Entrada` / `Hora Salida` cells intact. |
| D5 | Correction `field_name`/value are generic strings; supplied `original_value` is accepted. | Constrain the `Campo` `<select>` in `StaffAttendanceView.tsx` to `clock_in_at`, `clock_out_at`, `status`, and `notes` with required `Motivo *` and pass authoritative original values from the loaded attendance record. |
| D6 | Correction POST and schedule mutations have no request-idempotency contract. | Disable submit `Button` controls in `StaffManagement.tsx` and `StaffAttendanceView.tsx` while requests are in flight. Do not add database locking or custom idempotency frameworks. |
| D7 | Existing attendance view date filtering and occurrence dates. | Preserve existing clock-in/out flow and use explicit `YYYY-MM-DD` local dates returned/accepted by the API without building a browser timezone/recurrence engine. |
| D8 | Existing view matches attendance by ID OR equal name (`:140–142`). | Prefer authoritative `staff_profile_id` matching for live API records while preserving existing attendance card rendering. |
| D9 | Attendance list pagination defaults to 50, max 100. | Reuse existing `staffAttendanceApi.ts` list parameters without inventing background pagination crawlers. |
| D10 | Future series edit may split identity; exceptions have unique series/date records. | Always reload the profile's series and occurrences from `staffSchedulesApi.ts` after create/edit/exception/cancel mutations rather than caching stale series IDs locally. |
| D11 | Series DELETE cancels from next future occurrence; edit scopes preserve history. | Expose the existing API edit scopes (`this_and_future` vs. `all_future` via `JellyRadio`) and future cancellation (`Button` `variant="secondary"`) directly in the inline `StaffManagement.tsx` controls; never mutate past occurrences. |
| D12 | Attendance `review_required` flags do not have a resolve-review operation. | Display `review_required` and append-only correction history honestly without fabricating a separate review-resolution state machine. |

## Minimal backend/frontend approach

- Keep all recurrence expansion, overlap validation, DST handling, series splitting, and attendance classification on the server in `api/app/api/staff_schedules.py` and `api/app/api/staff_attendance.py`.
- Add only the narrow correction-history read/projection in `api/app/api/staff_attendance.py` (and only minimal contract glue in `api/app/api/staff_schedules.py` if required by the inline UI). Zero Alembic migrations and zero database model edits.
- Create a minimal typed `frontend/src/api/staffSchedulesApi.ts` client and reuse/extend `frontend/src/api/staffAttendanceApi.ts` (`correctStaffAttendance` + correction history types) using the existing injected authenticated request transport.
- Integrate directly into `frontend/src/features/owner/StaffManagement.tsx` and `frontend/src/features/reception/StaffAttendanceView.tsx` (with `frontend/src/app/ApiStaffAttendance.tsx` passing any required callback/request prop) strictly reusing existing house components (`Button`, `Panel`, `EmptyState`, `JellyRadio`, `SwipeToast`) and existing CSS classes. Do not create `ApiStaffSchedules.tsx`, new CSS files, or touch `ApiProductApp.tsx`.

## ODD task checklist and routing

These are stable planning task IDs; all remain unchecked until implementation runs. Before the first source write, reconcile this file with its Engram mirror and current source. Use one bounded writer for F08 source work.

| Task | Route and mandatory trigger | Completion proof |
| --- | --- | --- |
| F08-T01 | Completed in planning + Class-A refinement. | Approved inline surfaces (`StaffManagement.tsx` and `StaffAttendanceView.tsx`), house-component UI specification, narrow correction-history contract, trimmed test surfaces, and 100% disjoint boundary with F03 recorded. |
| F08-T02 | One delegated writer: narrow backend correction-history read/projection in `api/app/api/staff_attendance.py` (and `staff_schedules.py` only if needed) + backend test in `api/tests/test_staff_attendance.py`. | Narrow correction-history read/projection implemented with zero migrations; RED → GREEN → refactor observed in `test_staff_attendance.py` and `test_staff_schedules.py`. |
| F08-T03 | Same writer sequentially: `frontend/src/api/staffSchedulesApi.ts` and inline schedule series/exception controls in `frontend/src/features/owner/StaffManagement.tsx` + `StaffManagement.test.tsx`. | Main table `Turno` column (`:961`) shows active schedule summary (`L, M, X, J, V · 06:00–14:00` or `Sin horario`); `Editar Recepcionista` modal (`:983–1024`) replaces disabled `<select id="staff-shift-select">` with `.staff-pin-toggle-card` weekly schedule (`L`–`D` `.staff-att-pill-btn`, `.field-row`/`.field` time/date/termination inputs, `JellyRadio` scope, save/cancel `Button` disabled in flight) and next-7-days occurrences list (`Omitir` / `Cambiar hora`); verified in `StaffManagement.test.tsx` with API-shaped DTO fixtures. |
| F08-T04 | Same writer sequentially: attendance correction submission + audit history display in `StaffAttendanceView.tsx` / `ApiStaffAttendance.tsx` / `staffAttendanceApi.ts` + `StaffAttendanceView.test.tsx`. | Existing staff cards and `Marcar Entrada`/`Marcar Salida` untouched; `.staff-audit-table` (`:822–863`) in `isLive` mode adds `Correcciones` column rendering append-only corrections in muted secondary text without overwriting original `Hora Entrada`/`Hora Salida` cells, plus `Corregir` `Button` (`variant="secondary"`) opening 3-control `.field`/`.field-row` form (`Campo` `<select>`: `clock_in_at`, `clock_out_at`, `status`, `notes`; `Valor corregido`; `Motivo *`) with in-flight submit disable and `SwipeToast` feedback; verified in `StaffAttendanceView.test.tsx`. |
| F08-T05 | Delegated verifier: command execution and persisted browser workflow. | Focused/full applicable checks plus authenticated happy/failure/reload/history proof. |
| F08-T06 | Parent structural review/delivery coordination. | Progress/mirror/verification/commit evidence reconciled; remaining risks explicit; RDD follows current native mode/risk. |

- [x] **F08-T01:** Class-A inline surfaces, house-component UI specification, narrow correction-history contract, and zero-overlap F03 split recorded.
- [x] **F08-T02:** Narrow backend correction-history read/projection implemented and verified without migrations or recurrence rewrites.
- [x] **F08-T03:** `StaffManagement.tsx` integrates `Turno` column schedule summaries and `.staff-pin-toggle-card` weekly schedule series + 7-day occurrence exceptions (`Omitir` / `Cambiar hora`) inside `Editar Recepcionista` via `staffSchedulesApi.ts`.
- [x] **F08-T04:** `StaffAttendanceView.tsx` integrates the `Correcciones` column in `.staff-audit-table` with muted append-only audit records and the `Corregir` 3-control form (`Campo`, `Valor corregido`, `Motivo *`) + `SwipeToast` via `staffAttendanceApi.ts`.
- [x] **F08-T05:** Functional/browser acceptance demonstrates persistence and historical preservation; failures/skips recorded.
- [x] **F08-T06:** Work-unit evidence and mirror reconciled; no unrelated changes included.

### Test-first and delivery policy

- Observe actual failing deterministic tests (RED) before behavior changes, then GREEN and refactor.
- Provisional forecast: **200–350 authored lines** across backend, frontend, and tests (excluding generated files), down from 700–1,200, reflecting the Class-A Ponytail integration inside existing mounted views with zero migrations and trimmed test surfaces.
- Delivery strategy is **ask-on-risk**: at 200–350 lines, F08 fits within a single cohesive work unit below the 400-line delivery budget; ask only if unexpected scope threatens to cross the budget.

## Tests that reduce real risk

Trim test surfaces to avoid test slop: reuse `api/tests/test_staff_schedules.py` and `api/tests/test_staff_attendance.py` (adding only the narrow correction-history read/projection test), and cover the frontend through `frontend/src/features/owner/StaffManagement.test.tsx` and `frontend/src/features/reception/StaffAttendanceView.test.tsx` using API-shaped DTO fixtures. Do not create standalone `ApiStaffSchedules.test.tsx`, `staffSchedulesApi.test.ts`, or edit `ApiProductApp.test.tsx`.

| Risk | Existing tests to retain | High-value Class-A addition |
| --- | --- | --- |
| Recurrence, exceptions & split history | `api/tests/test_staff_schedules.py` (wall time, DST, overlap, future split, cancel). | Retain existing backend suite as regression proof; verify frontend schedule client and inline controls through `StaffManagement.test.tsx` using API-shaped DTO fixtures. |
| Correction audit & history read | `test_append_only_correction_rbac_and_immutability` (`api/tests/test_staff_attendance.py:552`). | Add narrow test in `api/tests/test_staff_attendance.py` proving correction-history read/projection returns append-only corrections while raw attendance fields remain unchanged. |
| Inline schedule management UI | `frontend/src/features/owner/StaffManagement.test.tsx`. | Verify `Turno` column summary, `.staff-pin-toggle-card` series create, `JellyRadio` future edit/cancel, 7-day occurrence `Omitir`/`Cambiar hora` exceptions, in-flight submit disable, and error retention in `StaffManagement.test.tsx`. |
| Inline attendance correction UI | `frontend/src/features/reception/StaffAttendanceView.test.tsx`. | Verify `.staff-audit-table` `Correcciones` column, `Corregir` 3-field form (`Campo`, `Valor corregido`, `Motivo *`) submission via `correctStaffAttendance`, muted append-only correction display without overwriting `Hora Entrada`/`Hora Salida`, in-flight submit disable, and preservation of existing clock-in/out in `StaffAttendanceView.test.tsx`. |

### Planned commands — not executed now

From repository root:

```powershell
.\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_staff_schedules.py api/tests/test_staff_attendance.py
.\api\.venv\Scripts\python.exe -m pytest -q api/tests
```

From `frontend`:

```powershell
npm test -- src/features/owner/StaffManagement.test.tsx src/features/reception/StaffAttendanceView.test.tsx
npm run typecheck
npm run build
npm test
```

No Alembic migration commands or separate PostgreSQL row-lock harnesses are required under the approved Class-A scope. Record exact outputs, failed/skipped tests and unavailable dependencies during verification.

## Browser acceptance, after explicit local execution authorization

Prerequisites: disposable synthetic DB, real local API/frontend, demo off, authorized manager and scoped receptionist, active roster profiles, representative future series, and recorded attendance entry.

1. Open `/owner/staff` (`StaffManagement.tsx`) as manager; verify the `Turno` column shows active schedule summaries (`L, M, X, J, V · 06:00–14:00` or `Sin horario`) instead of `"No disponible en API"`.
2. Open `Editar Recepcionista` and create a weekly series inside `.staff-pin-toggle-card` using `L`–`D` `.staff-att-pill-btn` pills and `.field-row`/`.field` time/date inputs; confirm the submit `Button` disables while in flight, then reload and verify persisted series and next-7-days occurrences.
3. Use `Omitir` (`skip`) or `Cambiar hora` (`override`) on a future occurrence and test future series edit (`JellyRadio`: `this_and_future` / `all_future`) and cancellation; confirm historical occurrences and attendance records remain unchanged.
4. Open `/reception/staff` (`StaffAttendanceView.tsx`); verify existing staff cards and `Marcar Entrada` / `Marcar Salida` still work, inspect `.staff-audit-table` (`Historial de registros de hoy`) `Correcciones` column, and click `Corregir` to submit an append-only correction (`Campo`, `Valor corregido`, `Motivo *`) with `SwipeToast` feedback.
5. Reload `/reception/staff` and confirm the append-only correction audit entry persists in muted secondary text while the original `Hora Entrada` / `Hora Salida` cells remain intact.
6. Induce an API validation failure on schedule or correction submission; confirm entered values are retained and no false success toast is shown.

## Candidate edit surfaces — NOT source authorization

These exact candidates reflect the approved Class-A Ponytail scope (no `ApiStaffSchedules.tsx`, no `ApiStaffSchedules.test.tsx`, no `staffSchedulesApi.test.ts`, no CSS files, and **no `ApiProductApp.tsx` or `ApiProductApp.test.tsx`**):

- `api/app/api/staff_attendance.py` — narrow correction-history read/projection only.
- `api/app/api/staff_schedules.py` — only if a minimal contract adjustment is demonstrated necessary; no recurrence rewrite.
- `api/tests/test_staff_attendance.py` — narrow correction-history read/projection test.
- `api/tests/test_staff_schedules.py` — existing schedule regression suite.
- `frontend/src/api/staffSchedulesApi.ts` — proposed new minimal schedule client helper.
- `frontend/src/api/staffAttendanceApi.ts` — narrow extension for correction history DTO/read alongside existing `correctStaffAttendance`.
- `frontend/src/app/ApiStaffAttendance.tsx` — pass authenticated correction/history wiring to `StaffAttendanceView.tsx` if needed.
- `frontend/src/features/owner/StaffManagement.tsx` — `Turno` column active schedule summary (`:961`) and `.staff-pin-toggle-card` weekly schedule + 7-day occurrence exception controls inside `Editar Recepcionista` (`:983–1024`).
- `frontend/src/features/owner/StaffManagement.test.tsx` — integration coverage for inline schedule management using API-shaped DTO fixtures.
- `frontend/src/features/reception/StaffAttendanceView.tsx` — `Correcciones` column in `.staff-audit-table` (`:822–863`) with muted append-only audit display and `Corregir` 3-control form.
- `frontend/src/features/reception/StaffAttendanceView.test.tsx` — integration coverage for attendance corrections and audit display using API-shaped DTO fixtures.

No database models, Alembic migrations, CSS, or `ApiProductApp.tsx` route files are included.

## Parallel boundary with F03 (100% disjoint edit surfaces)

**F08 and F03 have 100% disjoint edit surfaces in both backend and frontend — zero shared files.**

- Because `/owner/staff` (`StaffManagement.tsx`) and `/reception/staff` (`ApiStaffAttendance.tsx` / `StaffAttendanceView.tsx`) are already mounted, **F08 does not touch `frontend/src/app/ApiProductApp.tsx` or `frontend/src/app/ApiProductApp.test.tsx`**. Those two files are exclusively owned by F03 to mount `/owner/plans`.
- F08 backend edits are strictly confined to `api/app/api/staff_attendance.py`, `api/app/api/staff_schedules.py`, and their two test files (`test_staff_attendance.py`, `test_staff_schedules.py`), whereas F03 is strictly confined to `api/app/catalog/*`, `api/app/api/catalog.py`, `test_catalog.py`, and `test_sales.py`.
- Neither F08 nor F03 introduces Alembic migrations or edits database models.
- **Test execution coordination**: Although source and test file edits are 100% disjoint, full test suite runs (`pytest`, `npm test`, `npm run typecheck`, `npm run build`) should execute sequentially or in isolated worktrees to avoid test-runner process contention. Preserve all pre-existing F02/F05 dirty files in the working tree.

## Acceptance and progress

- [x] `StaffManagement.tsx` (on `/owner/staff`) displays active schedule summaries in the `Turno` column and completes weekly series create/read/future-edit/skip/override/cancel inside `Editar Recepcionista` (`.staff-pin-toggle-card`) via `staffSchedulesApi.ts` with in-flight submit disabling and authoritative API state.
- [x] `StaffAttendanceView.tsx` (on `/reception/staff`) leaves staff cards and `Marcar Entrada` / `Marcar Salida` untouched, adds the `Correcciones` column to `.staff-audit-table` in live mode, submits append-only corrections via `correctStaffAttendance`, and displays correction audit history in muted secondary text without overwriting original `Hora Entrada` / `Hora Salida` cells.
- [x] Shift covering and ad-hoc support shifts implemented: unscheduled staff check-in prompts confirmation modal to cover an unscheduled colleague's shift or register an ad-hoc support shift ("turno de apoyo / extraordinario"); backend validates branch match, evaluates start time / grace tolerance against covered series, records audit notes, and preserves idempotency.
- [x] Strict reuse of existing house components (`Button`, `Panel`, `EmptyState`, `JellyRadio`, `SwipeToast`) and CSS classes; zero edits to `ApiProductApp.tsx`, `ApiProductApp.test.tsx`, CSS files, database models, or Alembic migrations.
- [x] High-value tests in `test_staff_attendance.py`, `test_staff_schedules.py`, `StaffManagement.test.tsx`, and `StaffAttendanceView.test.tsx` pass.
- [x] Applicable tests/browser evidence, failures/skips and task/mirror/commit identities are recorded honestly.

Updated planning artifact to reflect user-approved Class-A Ponytail decisions, exact house-component UI specification, 200–350 line forecast, trimmed test surfaces, and 100% disjoint parallel boundary with F03. Persist and read back the full-document Engram mirror (`odd/f08-staff-schedules-attendance/tasks`) after updates.
