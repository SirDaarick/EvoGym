# Flow A review notes

Result of the Flow A audit (auth, alerts, schedules and attendance, payroll, catalog, sync).
All items below have been implemented and verified end-to-end across SQLite, PostgreSQL, and frontend Vitest suites.

## Fixed

| Id | Change | Evidence |
| --- | --- | --- |
| F-A1 | `GET /sync/audit-flags` and `POST /sync/audit-flags/{id}/resolve` no longer accept `member_operational_read`, which every receptionist holds. | `tests/test_sync_audit_authorization.py`, `tests/test_flow_a_e2e.py` |
| F-A2 | `check_staff_branch_authorization` no longer treats an actor with no active grants as authorized. | `test_actor_without_active_grants_is_flagged_not_authorized` |
| F-A3 | Offline `shift.arqueo_close` only closes an open shift of the device's own branch. A differing closed, closing or foreign shift is journaled and flagged `orphan_shift_reference` instead of failing the batch with a 500. | `tests/test_sync_reconcile.py`, `tests/test_flow_a_e2e.py` |
| F-A4 | `GET /catalog/plans?eligibility_type=` matches only the latest plan version. | `test_eligibility_filter_matches_only_the_current_version` |
| F-A5 | Attendance correction input shows the expected format per field (ISO with offset, `present`/`late`). | `StaffAttendanceView.tsx`, frontend suite passes |
| F-A6 | Flow doc: pairing code TTL is 15 min, live alerts include security lockouts, debt-override check-ins, and attendance corrections, plus audit-flag rules. | `docs/flows/a-platform-and-staff.md` |
| T-A1 | Added tests that pin payroll behavior: non-admin writes, missing `Idempotency-Key`, non-Monday week, zero amount, inactive profile, and cash/transfer advances outside shift drawer. | `tests/test_payroll.py`, `tests/test_payroll_postgres.py`, `tests/test_flow_a_e2e.py` |
| T-A2 | Added `LivePayrollView` and `PayrollManagement` tests (totals, paid/pending rows, advance payment method badges, owner-account notice, empty and error states). | `LivePayrollView.test.tsx`, `PayrollManagement.test.tsx` |

Side effect of F-A2: the sync reconcile test fixture now seeds a receptionist grant for its staff user.

## Owner decisions (Implemented & Verified)

- **D-A1 Payroll cash handling — implemented & verified.** Payroll payments and advances come from the owner's account (`Expense.shift_id = NULL`), not the shift's cash drawer, and never reduce its expected cash. Advances can be paid in `cash` or `transfer`, the chosen method is recorded on the linked `Expense` and projected as `advance_payment_method` in `payroll_week` and `payroll_history`, and both `PayrollDialog.tsx` and `LivePayrollView.tsx` display the owner-account notice and recorded payment method (`test_payroll.py`, `test_payroll_postgres.py`, `test_flow_a_e2e.py`, `PayrollManagement.test.tsx`, `LivePayrollView.test.tsx`).
- **D-A2 Alerts on member entry with debt — implemented & verified.** When reception exceptionally authorizes entry for a member with debt (`outstanding_balance` + `outstanding_balance_confirmed`), the authorizer (`recorded_by`) is resolved to `authorized_by_user_id` and `authorized_by_name` and surfaced in `GET /api/v1/owner/overview/alerts` (`category = "debt_override_checkin"`), `GET /api/v1/owner/overview` (`"Entradas con adeudo"`), and `GET /api/v1/member-check-ins/branches/{branch_id}/debt-alerts`, and rendered live in `AlertCenter.tsx` (`test_flow_a_e2e.py`, `AlertCenterLive.test.tsx`).
- **D-A3 Attendance corrections — implemented & verified.** Authorized receptionists may record append-only attendance corrections for their branch; every correction is surfaced to administrators in `GET /api/v1/owner/overview/alerts` (`category = "attendance_correction"`) and `GET /api/v1/owner/overview` (`"Correcciones de asistencia"`) with `corrected_by_name`, `staff_member_name`, `reason`, and `details`, and rendered live in `AlertCenter.tsx` (`test_flow_a_e2e.py`, `AlertCenterLive.test.tsx`).
- **D-A4 Catalog — implemented & verified.** `GET /api/v1/catalog/plans` and `LiveMembershipCheckout.tsx` present one current offer per active plan, excluding inactive plans from new sales while preserving historical versions. Changing a published plan's price or terms creates a new immutable `PlanVersion`; existing members retain their purchased version for the period already paid, and renewals use the current active offer. `PlanCatalog.tsx` uses `active`/`inactive` status without an archive option (`test_catalog.py`, `test_flow_a_e2e.py`, `LiveMembershipCheckout.test.tsx`, `PlanCatalog.test.tsx`).
- **D-A5 Audit flag scope — retained & verified.** Permitted administrators may read sync audit flags across all branches, while receptionists are rejected with 401 (`test_sync_audit_authorization.py`, `test_flow_a_e2e.py`).
- **D-A6 Sync auth — retained & verified.** Any administrator may provision a sync device for any branch (`test_flow_a_e2e.py`).
- **D-A7 Admin idle timeout — retained & verified.** `ADMIN_IDLE_SECONDS` is retained at 30 days (`2,592,000` seconds) (`test_flow_a_e2e.py`).
- **D-A8 Closed-shift replay — implemented & verified.** When an offline `shift.arqueo_close` is resent after the same shift was already closed in the same branch, an identical close is accepted as an idempotent retry (`status = "accepted"`, no `SyncAuditFlag` created), whereas a differing close raises `ShiftCloseConflictError` and is flagged `orphan_shift_reference` for administrator review (`test_sync_reconcile.py`, `test_flow_a_e2e.py`).

## Catalog technical observations

- Immutability of published versions is enforced by an SQLAlchemy `before_update` listener, not a database trigger.
- `current_version` is the latest version even when it is inactive.
- Plan terms (expiry rule, eligibility notes) are JSON stored inside `restriction_notes` with a `evogym-plan-terms:v1:` prefix.
- `archived` exists in the database but no endpoint sets it; the owner did not request an archive option.

## Verified on PostgreSQL & E2E

- PostgreSQL concurrency and migration suites (`test_payroll_postgres.py`, `test_credentials_postgres.py`, `test_authorization_postgres.py`, `test_migrations_postgres.py`) executed and passed against live PostgreSQL (`127.0.0.1:5433`).
- Unified Flow A E2E suite (`tests/test_flow_a_e2e.py`) executed and passed (6/6 scenarios verifying API action -> DB persistence -> frontend read endpoints).
- Remaining known backlog gaps (offline membership renewals, offline staff attendance sync events, dedicated audit-flag screen) remain tracked in `docs/flows/a-platform-and-staff.md`.
