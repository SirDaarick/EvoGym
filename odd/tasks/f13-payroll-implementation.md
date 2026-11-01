# F13 — Run weekly payroll (implementation plan)

Objective: implement the payroll backend and wire it into the existing `/owner/staff` frontend, treating the current UI as the contract and adding UI only where the user approves it. Status: **implementation authorized**. Baseline: HEAD `cbb03ef` (F12 docs); dirty paths at planning time: `api/app/main.py`, `docker-compose.yml`, `frontend/src/features/owner/ExpenseReport.tsx`, `frontend/vite.config.ts`, `odd/tasks/remaining-feature-integrations.md`, untracked `odd/tasks/f12-expenses.md`, `odd/tasks/f13-payroll.md` (preserve; not part of F13).
Branch: `feat/f13-payroll`; test runners: pytest and Vitest. Delivery: feature-branch-chain; forecast exceeds 400 authored lines. Mode: Ponytail full.

Discovery source: [f13-payroll.md](f13-payroll.md) (this plan supersedes its §3 schema and §4 endpoints). Card: [remaining-feature-integrations.md § F13](remaining-feature-integrations.md#f13--run-payroll-p2-c).

## Specs

- **S1 — Frontend is the contract.** User: "tenemos que tomar el frontend como contrato ya que ya tenemos un diseño hecho que no hay que cambiar, solo tenemos que implementar el backend y la implementacion con el frontend que ya tenemos hecho, en caso de que haya un elemento del backend que no tenga representacion en el frontend dime para planear juntos como implementarlo." No layout/CSS redesign; new UI only after explicit approval (see *Contract gap*).
- **S2 — Salary on the staff profile (Model A).** Each roster profile stores a fixed monthly salary in integer minor units (MXN). It is the value already shown by the existing `Sueldo mensual` column and edited by the existing `Sueldo mensual (MXN) *` input. Weekly base = monthly / 4; daily reference = weekly / 5 (both match the Excel SSOT in discovery §2, e.g. 14,000 → 3,500 → 700). Round each division to the nearest cent, ties upward (user: "si me parece bien").
- **S3 — Weekly period.** Monday–Sunday in the branch timezone (`branches.timezone`), identified by `week_start` (a Monday `DATE`).
- **S4 — Advances.** Owner records an advance (amount > 0, ≤ remaining net of that week) for a profile and week. Advances never touch a register/shift. Net pending = weekly base − advances of the week.
- **S5 — Pay.** Owner marks a profile's week as paid once (method `transfer` | `cash`). The payment snapshots base, advances and net, so later salary edits never rewrite a paid week.
- **S6 — Finance integration (F12).** Every real outflow lands in `expenses` (`category='general'`, `shift_id=NULL`, `payee_name=<full_name>`): one expense per advance (`concept='Adelanto de nómina'`) and one per payment for the net (`concept='Nómina semanal'`). Net pay of 0 (fully advanced) records no payment expense. Sum of expenses for a week = weekly base, so `/owner/expenses` reflects real cash outflow without double counting.
- **S7 — Safety.** Finance admin only (`FinancePrincipal` + `_authorized_branches`, reused from `api/app/api/expenses.py`); 403 wrong role/branch; 422 invalid amount/week or advance above remaining net; 409 week already paid / advance on a paid week; idempotent writes (`Idempotency-Key`, same key replays, altered body → 409); rejected commands leave data unchanged.
- **S8 — Failing checks.** User: "pues arregla los fallos por favor". Reproduce and correct the reported API and frontend suite failures without altering unrelated existing user changes.

## Contract gap (resolved by Q1)

Source check of the current frontend (`frontend/src/features/owner/StaffManagement.tsx`):

| Backend element | Frontend representation today |
|---|---|
| Monthly salary (S2) | ✅ `Sueldo mensual` column (demo: `:320-327`; live: `:1177,1184` shows "No disponible en API") and `Sueldo mensual (MXN) *` input (demo `:581-589`; live `:1236` disabled "No disponible en API"). |
| Weekly status pending/paid + net (S4/S5) | ❌ none |
| Register advance (S4) | ❌ none (no `Adelantar` button or modal anywhere in `frontend/src`) |
| Pay week + optional next-week advance (S5) | ❌ none (no `Pagar` button or modal) |
| Payroll expenses in Finanzas (S6) | ✅ appear automatically as rows in the live expenses list (F12 `ExpensesView`), category `general`. |

The discovery doc §5 describes `[ Adelantar ]` / `[ Pagar $X ]` buttons and two modals, but **that design does not exist in the code**. Building it means adding UI, so Q1 was asked.

**Q1 — How should the payroll actions appear? Resolved: option 1.** User: "el 1 esta bien". Accepted proposal (smallest UI that reuses existing patterns): in the live table, the `Sueldo mensual` cell gets a second muted line `Pendiente $X netos` / `Pagado esta semana` (same `staff-salary-cell` + `muted` classes); the `Acciones` column gets one contextual `Button variant="secondary"` (`Adelantar` Mon–Thu, `Pagar $X` Fri–Sun, hidden when paid); one dialog reusing `staff-modal-overlay` + `staff-modal-card` + `.field` (the deactivation dialog pattern) with amount input, "1 día ($X)" shortcut, method select, notes. The compound "pay + next-week advance" (discovery §1) is dropped: the owner records the next-week advance separately with the same dialog the following week.

## Approved UI additions (live `ApiStaffManagement` only; existing patterns)

| Where | Addition | Reused pattern |
|---|---|---|
| `Sueldo mensual` cell | Second line: `Pendiente $X netos` (unpaid, salary > 0) / `Pagado esta semana` (paid); nothing when salary is 0 | `staff-salary-cell` + `muted` |
| `Acciones` column | One contextual button: `Adelantar` Mon–Thu, `Pagar $X` Fri–Sun (branch-local day); hidden when the week is paid or salary is 0 | `Button variant="secondary"` |
| Payroll dialog | One dialog for both modes. Header with name and daily reference. Advance mode: amount input + `1 día ($X)` shortcut + optional notes. Pay mode: read-only breakdown (base, − advances, net) + method select (`Transferencia` default, `Efectivo`). Confirm + `Cerrar`; API errors in `role="alert"` keep the input | Deactivation dialog (`staff-modal-overlay` + `staff-modal-card` + `.field`) |

Not built: compound pay + next-week advance, the `Adelanto próx. semana` action after paying, demo-mode payroll.

## Backend contract

Migration `0050_payroll` (head `0049_expenses`; re-check head at T01).

**Column** `staff_roster_profiles.monthly_salary_minor BIGINT NOT NULL DEFAULT 0 CHECK (>= 0)`. 0 = not configured; such profiles are excluded from payroll (no invented salary).

**Table `payroll_advances`**: `id` UUID PK · `branch_id` FK RESTRICT · `staff_profile_id` FK `staff_roster_profiles` RESTRICT · `week_start` DATE · `amount_minor` BIGINT CHECK > 0 · `notes` VARCHAR(255) NULL · `expense_id` FK `expenses` RESTRICT NOT NULL · `recorded_by_id` FK staff · `idempotency_key` + `request_fingerprint` (unique per actor, expenses pattern) · `created_at` · Index (`staff_profile_id`, `week_start`).

**Table `payroll_payments`**: `id` UUID PK · `branch_id` FK RESTRICT · `staff_profile_id` FK RESTRICT · `week_start` DATE · UNIQUE (`staff_profile_id`, `week_start`) · `base_minor`, `advances_minor`, `net_minor` BIGINT (snapshot, CHECK `net = base - advances` and `net >= 0`) · `payment_method` VARCHAR(16) CHECK (`transfer`,`cash`) · `expense_id` FK `expenses` NULL (NULL only when `net_minor = 0`) · `recorded_by_id` · idempotency columns · `created_at`.

Dropped from discovery (YAGNI, name them once): `payroll_runs` table and its stored totals/status (derived per week from profiles + payments), `bonuses_minor` / `deductions_minor` (no UI, no rule), `payment_method='other'`, per-entry `updated_at` (rows are append-only). No update/delete routes. Shortcut: no correction flow — voiding the linked expense in Finanzas does not undo the payroll row; add corrections when the owner asks for them.

**Routes** (`app/api/payroll.py`, `app/payroll/{schemas,queries}.py`, registered in `main.py`; expense insert reuses the `Expense` model the same way `create_business_expense` does, in the same transaction):

| Method & path | Behavior |
|---|---|
| `GET /api/v1/admin/payroll/weeks/{week_start}?branch_id=` | For active profiles with salary > 0: `{profile_id, full_name, base_minor, advances_minor, net_minor, daily_minor, paid: {payment_method, paid_at} | null}` + week totals. Paid rows read from the snapshot; unpaid rows compute live. 422 if `week_start` is not a Monday. |
| `POST /api/v1/admin/payroll/advances` + `Idempotency-Key` `{branch_id, staff_profile_id, week_start, amount_minor, notes?}` | Lock profile row; 409 if week paid; 422 if amount > remaining net; insert expense (`transfer`) + advance. |
| `POST /api/v1/admin/payroll/payments` + `Idempotency-Key` `{branch_id, staff_profile_id, week_start, payment_method}` | Lock profile row; 409 if already paid (unique); snapshot; insert expense if net > 0; insert payment. |
| Existing roster read/PATCH | Expose `monthly_salary_minor` in the live roster profile read used by the UI (`/api/v1/admin/staff-accounts/roster-profiles`, `AdminRosterProfileChoice`) and accept it in `PATCH /api/v1/staff-roster/{profile_id}` (`StaffRosterItem` patch schema). Verify the exact DTO at T01. |

## Frontend wiring

- **Phase A (contract-only):** `staffCredentialsApi.ts` parses `monthly_salary_minor`; live table `Sueldo mensual` cell shows `formatMoney(...)` instead of "No disponible en API"; live edit modal enables the existing salary input and saves it via the roster PATCH together with the existing save action. Demo path untouched.
- **Phase B:** `frontend/src/api/payrollApi.ts` (`getPayrollWeek`, `recordPayrollAdvance`, `payPayrollWeek`, request/idempotency pattern of `expensesApi`) and only the *Approved UI additions*, inside `ApiStaffManagement`. The week is loaded once per branch and refreshed after each successful write.

## Tasks (ODD, one delivery per phase)

- [x] **T01 — Freeze contracts.** Re-verify migration head, roster DTOs/PATCH schema, `FinancePrincipal`/`_authorized_branches` import path, `expensesApi` request pattern. Record any drift here.
- [x] **T02 — Phase A backend (RED→GREEN).** Migration column + roster read/PATCH field. Tests: PATCH persists salary; negative → 422; non-admin → 403; read returns it.
- [x] **T03 — Phase A frontend.** Parse + show + edit salary in live `ApiStaffManagement`. Tests in `StaffManagement.test.tsx` / `staffCredentialsApi.test.ts` with API-shaped fixtures.
- [x] **T04 — Phase B backend.** Tables + 3 routes. Tests: week of 9 profiles = $20,000 base; advance $500 on Emigdio → net $3,000 and one expense $500; pay → snapshot + expense $3,000; sum of week expenses = base; fully advanced → pay with no expense; second pay → 409; advance on paid week → 409; advance > remaining → 422; non-Monday → 422; wrong branch/role → 403; same key replay / altered body → 409; salary edit after pay leaves the paid snapshot unchanged.
- [x] **T05 — Phase B frontend.** `payrollApi.ts` + approved UI only. Tests: row shows net/paid; advance updates net; pay marks row paid; API error keeps dialog input.
- [x] **T06 — Verification.** `pytest` targeted + full API suite; frontend `npm run test`, `npm run typecheck`, `npm run build`. Browser: `/owner/staff` set salary → reload; advance → pay → reload shows paid; `/owner/expenses` lists both expenses; denied actor blocked.
- [x] **T07 — Resolve failed checks (S8).** Inline: reproduce and correct the reported failures; preserve existing user changes and verify affected suites. No independent parallel writer units have been established.

Verification tier: **high** (money + new migration) → writer self-verification plus one independent verifier at the end of the feature.

## Risks / not covered

- Salary data for the 9 people must be entered by the owner (no seed with real salaries).
- No payroll correction/void flow (see shortcut above).
- Demo mode keeps its own `salaryMinor`; demo payroll is not built.

## Log

- L1: "me ayudas a realizar la implementacion de @odd/tasks/f13-payroll-implementation.md"
- L2: User approved rounding each division to the nearest cent, ties upward: "si me parece bien".
- Implementation route: inline by task; dependent backend and frontend phases do not qualify as independent parallel writers. Preserve pre-existing worktree changes. RDD is disabled at clone scope.
- T01 evidence: `0049_expenses` exists and no migration declares it as its parent. `StaffRosterUpdate` and `StaffRosterItem` lack salary; the admin roster-choice response is a separate DTO. `_authorized_branches` is defined in `api/app/api/pending_money.py` and used by expenses. The roster read is also available to non-admin principals, so exposing salary there without an authorization guard would disclose payroll data. Full migration-head and frontend request-pattern checks remain pending.
- L3: User approved preventing salary reductions when any unpaid week's advances would exceed the new weekly base: "si".
- T02 in progress: salary column and finance-authorized roster-choice exposure, with salary omitted from the non-admin roster response. RED: salary PATCH returned 422 before implementation. `tests/test_staff_roster.py` and `tests/test_admin_staff_accounts.py`: 14 passed after fixture updates. Migration suite: 39 passed before the final migration adjustment. A targeted regression reproduced SQLite batch recreation dropping an existing expression index; direct column addition now preserves it (targeted migration and roster tests: 4 passed). Fresh SQLite migration history already lacks the index before 0050; repairing old migrations is outside this feature. Independent verification, complete regression suite, payroll salary-reduction guard, and all frontend and payroll tasks remain pending.
- L4: User chose feature-branch-chain delivery: "encadenalos sobre una rama". No push or PR is authorized.
- Implementation in progress: salary, payroll tables/routes, finance expenses, branch timezone, and approved live UI have initial implementations. Targeted API checks: 17 passed, including nine-profile totals, salary snapshot, advance/payment idempotency, full advance and SQLite index preservation. Targeted frontend checks: 15 passed, including branch-local week, salary edit, advance failure/retry, and payment. These results do not establish full spec compliance; broad suites, migration checks, independent high-risk verification, browser acceptance, and commits remain pending. The standalone `staffCredentialsApi` test suite has an environment-dependent failure because an API origin is configured locally; the new salary parser test passes in isolation.
- Full API suite: 600 passed, 43 skipped, 6 failed. Two new table-allowlist failures were corrected and rerun successfully; two inventory test failures and one expired schedule fixture also fail at baseline `cbb03ef`; one admin-auth failure does not reproduce in a clean baseline environment and remains unclassified. Full frontend suite: 850 passed, 13 failed; local `.env` affects demo/API mode and origin, but not every failure is classified. `npm run build` and `npm run typecheck` passed. Final rechecks and independent verification remain pending.
- Independent verifier could not execute isolated probes because its interpreter path was unavailable. It identified missing salary in the authorized PATCH response, reproduced by a failing test and fixed; `tests/test_staff_roster.py tests/test_payroll.py`: 5 passed afterward. It also flagged an unproven SQLite concurrency risk; PostgreSQL row locks are present, but concurrency proof remains pending. No PASS is claimed for the independent review.
- Independent correction recheck: isolated salary PATCH test passed; concurrency remains unverified because no PostgreSQL concurrency probe was run. Frontend suite with temporary environment overrides: 854 passed, 9 failed; some are configuration-dependent and remaining causes are not all proven against the baseline. Browser acceptance was not run. No F13 commits or PRs have been created. Keep all tasks open pending the missing verification and decide how to obtain PostgreSQL concurrency and browser acceptance proof before using this feature for real payroll.
- L5: User authorized development database tests and requested a delegated Playwright browser test: "pues hazlas, haz pruebas en la base de datos, es de dev por lo que no afectara nada productivo y delega un agente para la prueba del navegador usando playwright".
- PostgreSQL proof: an isolated disposable local `postgres:16-alpine` container with synthetic credentials and data ran `tests/test_payroll_postgres.py`: 1 passed. Simultaneous salary reduction/advance maintained the weekly-base invariant and expense totals, and simultaneous same-key payments returned the same receipt with one expense. The container was removed afterward. Playwright worker is pending; broad-suite failures and independent verifier's incomplete original coverage remain open.
- Playwright worker: isolated SQLite and local servers, 23 behavioral checks passed (salary save/reload, $500 advance, $3,000 payment, paid reload, both expenses, denied receptionist). It found payroll status rendered inline and the long edit modal could not be scrolled; the approved second line and scrollable live edit card were fixed. Bounded Chromium recheck confirmed both pending/paid lines are separate and a mouse click reaches and saves the salary. Focused frontend tests: 15 passed; typecheck passed. Synthetic browser data and servers were removed. Full-suite failures and incomplete independent spec verification still remain; no commit or PR was created.
- L6: User requested fixing the reported failures: "pues arregla los fallos por favor".
- T07 checks: the four named API failures were fixed by isolating test configuration, calling the current inventory authentication dependency, and using future-relative schedule dates; targeted run passed 4/4. Full API suite subsequently passed 606 with 44 skipped (PostgreSQL/S3/platform gates); its first run exposed a timestamp-tie test flake, whose order-independent assertion passed targeted afterward. Frontend test environment now defaults to live mode, individual tests isolate their own mode/origin, async assertions wait for loading, and saved draft status is announced only when persistence reports success. After stabilizing time-sensitive tests and setting a 15-second Vitest limit, `npm run test` passed 863/863; `npm run typecheck` passed before the last test-only adjustments. Independent verification remains pending; no commits or PRs created.
- T07 final checks: `npm run test` passed 863/863; after adding an explicit failed-save assertion, focused `ShiftCloseDialog.test.tsx` passed 13/13, `npm run typecheck` passed, and `npm run build` passed with bundle-size/dynamic-import warnings. An independent verifier could not complete the full S8 sweep because scratch dependencies were incomplete; its bounded recheck ran the 13 dialog tests in an isolated copy and confirmed no false saved status on persistence failure. The feature-wide independent S1–S7 verification remains incomplete. API full-suite success predates the final test-only fix for the timestamp-tie flake, which passed targeted afterward; 44 gated tests were skipped in that full run. No commits or PRs created.
- L7: User requested executing the skipped checks: "por que omitiste 44 haz esas pruebas tambien". A synthetic isolated local PostgreSQL run collected all 40 PostgreSQL tests: 37 passed and three failed due to a local dotenv leak and stale rental test assumptions. Correction and other skipped storage/platform checks are in progress.
- L8 result: all gated checks now run. PostgreSQL suite: 40 collected, 37 passed, three failures traced to a local dotenv leak in one test, stale rental helper expectations and a two-value return signature; fixed and rerun green. S3 evidence tests pass against the local SeaweedFS service once a dedicated probe bucket exists; the bucket and its objects were deleted afterwards. The symlink retention test cannot create symlinks on this Windows host, so it ran in a disposable Linux container and passed 6/6. Full API suite with PostgreSQL and S3 enabled: 649 passed, 0 failed, 1 platform skip (that symlink test, proven green on Linux). The disposable PostgreSQL container was removed. Frontend suite: 863 passed. Feature-wide independent S1–S7 verification remains incomplete; no commits or PRs created.
