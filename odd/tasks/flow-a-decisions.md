# Flow A decisions
Branch: `feat/flow-a-decisions`; delivery: ask-on-risk; runners: API pytest (SQLite + PostgreSQL) and frontend Vitest + `tsc --noEmit`.
Forecast: over 400 authored lines; preserve the original worktree and coordinate shared Flow B work.

## Specs

- S1: «pero es que al ser pago de nomina, no sale de la caja, sale pues de la cuenta del dueño»; «si, salen de la cuenta del dueño»; «tambien pueden hacerse en efectivo, hay que dejar claro eso para que se puedan de ambas formas».
- S2: «si» to the administrator alert when reception exceptionally authorizes entry despite debt.
- S3: «yo digo que el recepcionista pueda, pero de igual manera se haga una alerta al admin para que el sepa que paso».
- S4: «si» to excluding inactive plans from new sales and preserving history; «no quiero es que aparezcan mil planes ahi»; «a los que ya tenian la anterior version del plan, respetarles el precio y todo»; «solo durante la vigencia que ya pagaron»; «si me parece bien» to active/inactive without an archive option.
- S5: «si asi esta bien» to permitted administrators seeing audit flags from all branches; «si asi esta bien de momento» to administrator device provisioning across branches; «si» to retaining the 30-day idle timeout for now.
- S6: «si el corte es igual pues no efectuar una alerta pero si cambia pues si».
- S7: «puedes comenzar con la verificacion y la implementacion? pero en un worktree para no pisar otros cambios?»; verify pending Flow A review items documented in `docs/flows/a-review-notes.md`.

## Tasks

- [x] T1 (S1): payroll advances implemented (`cash` and `transfer` from owner's account with `shift_id = None`, projected as `advance_payment_method` in weekly & history views); verified on SQLite, live PostgreSQL, and frontend Vitest; Risk: item 3 (shared financial behavior).
- [x] T2 (S2): debt authorization alert coordinated with Flow B T3 (`debt_override_checkin` in `GET /api/v1/owner/overview/alerts` and `GET /api/v1/member-check-ins/branches/{branch_id}/debt-alerts` with `authorized_by_user_id` and `authorized_by_name`, consumed in `AlertCenter.tsx`); Risk: item 2 (authorization).
- [x] T3 (S3): attendance correction alerts (`attendance_correction` in `GET /api/v1/owner/overview/alerts` with `corrected_by_name`, `staff_member_name`, `reason`, and `details`, consumed in `AlertCenter.tsx`; append-only invariant verified); Risk: item 2 (permissions).
- [x] T4 (S4): catalog behavior and verification (one current offer per plan, inactive plans excluded from new sales while preserving historical versions and existing paid memberships, `active`/`inactive` toggle without archive option); Risk: item 3 (existing plan contracts).
- [x] T5 (S5): verify retained behavior (permitted admin reads audit flags across branches while receptionists receive 401; admin provisions sync devices across branches; `ADMIN_IDLE_SECONDS == 30 * 24 * 60 * 60`).
- [x] T6 (S6): offline close replay (`shift.arqueo_close` on an already-closed shift of the same branch accepts identical close as idempotent retry without creating an `AuditFlag`, and flags differing close with `orphan_shift_reference`); Risk: item 4 (sync ordering).
- [x] T7 (S7): reconciled migration chain (`0062`..`0065`), verified SQLite + live PostgreSQL migrations & concurrency suites (`test_payroll_postgres.py`, `test_credentials_postgres.py`, `test_authorization_postgres.py`, `test_migrations_postgres.py`), and verified unified E2E suite (`test_flow_a_e2e.py`).

## Log

- L1: «puedes comenzar con la verificacion y la implementacion? pero en un worktree para no pisar otros cambios?»
- Created worktree at `EvoGym-worktrees/flow-a-decisions` from `9010b11`; original worktree has uncommitted Flow A and Flow B changes. Copied the existing untracked Flow A review notes to retain the agreed decisions without altering the original.
- Reconciled missing migration chain `0062_member_phone_key`, `0063_member_credit_nonnegative`, `0064_unique_card_intent` (offline SQL guard), and `0065_shared_member_phones` so full SQLite and PostgreSQL migration lifecycle checks pass.
- T1 (D-A1): Payroll payments and advances record `Expense(shift_id=None, payment_method=...)` from the owner's account without reducing the open shift's expected cash; `payroll_week` and `payroll_history` project `advance_payment_method` consumed by `PayrollDialog.tsx` and `LivePayrollView.tsx`.
- T2 & T3 (D-A2, D-A3): `GET /api/v1/owner/overview/alerts` and `owner_overview` surface `debt_override_checkin` (with authorizer identity) and `attendance_correction` (with corrector identity, staff member name, and reason/details), rendered live in `AlertCenter.tsx`.
- T4 (D-A4): `list_plans` and `LiveMembershipCheckout.tsx` expose one current offer per active plan, excluding inactive plans from new sales while retaining historical versions; `PlanCatalog.tsx` uses active/inactive status without an archive option.
- T5 (D-A5, D-A6, D-A7): Verified cross-branch admin audit flag access (and 401 rejection for receptionists), cross-branch sync device provisioning, and 30-day `ADMIN_IDLE_SECONDS`.
- T6 (D-A8): `reconcile.py` delegates `shift.arqueo_close` on an already-closed shift of the same branch to `close_shift`; identical closes return `replayed=True` and are accepted without raising an `AuditFlag`, while differing closes raise `ShiftCloseConflictError` and are flagged `orphan_shift_reference`.
- T7 (S7): Parent review (`ponytail-review`) removed redundant route aliases in `owner_overview.py`/`main.py`, eliminated N+1 staff name queries in `list_owner_alerts` and `list_debt_alerts`, and connected `advance_payment_method` in `payroll_week`/`payroll_history`. Verified with `tests/test_flow_a_e2e.py` (6 passed), PostgreSQL concurrency & migration suites (`test_payroll_postgres.py`, `test_credentials_postgres.py`, `test_authorization_postgres.py`, `test_migrations_postgres.py` — 12 passed), and frontend Vitest + `tsc --noEmit` (40 focused tests passed, 0 type errors).
