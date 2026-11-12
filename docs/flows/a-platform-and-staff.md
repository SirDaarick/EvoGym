# EvoGym application flows - A. Platform and staff

How each end-to-end flow should ideally work, plus its current implementation status.
Rule ids (D-xxx, R-xxx, BK-xxx) refer to `docs/backend-plan/02-business-rules-and-decisions.md`.
API paths omit the `/api/v1` prefix. Code paths are relative to the repository root.

## Roles

| Role | Access | Notes |
| --- | --- | --- |
| Owner / admin | Email + password | `is_owner` unlocks Permissions; `can_manage_employees` unlocks Staff and Alerts. |
| Receptionist | PIN on the shared reception PC (kiosk) or a paired personal phone | Cannot see financial history, payroll or audit logs (D-011, D-012). |

## Live vs demo screens

A screen is **live** when it calls the API and **demo** when it runs on fake data in
`frontend/src/demo` (enabled with `evogym:demo-mode` in sessionStorage). Live screens are
selected in `frontend/src/app/ApiProductApp.tsx:116-151`; any route not listed there shows
an "API not connected" page.

Status values used below: **Live**, **Partial** (mixed live/demo), **Demo-only**, **Missing UI**
(API exists, no screen), **Missing** (neither).

---

## 1. Auth, identity and device pairing

### 1.1 Admin login, refresh and logout
- **Actor:** owner/admin. **Status:** Live.
- **Ideal flow:**
  1. Admin enters email + password.
  2. On a new device, the API sends an approval email link; the login screen polls until approved.
  3. A session with refresh tokens is issued; logout revokes it.
- **Code:** `features/auth/AdminAccessApp.tsx`, `AdminSessionProvider.tsx` — `api/app/api/admin_auth.py:112-183`.

### 1.2 Admin recovery
- **Actor:** admin. **Status:** Live.
- **Ideal flow:** start recovery, receive a link, complete with the token. Responses must never reveal whether an account exists.
- **Gap:** account-existence policy is unresolved (D-025).
- **Code:** `features/auth/AdminRecoveryPage.tsx` — `admin_auth.py:134,141`.

### 1.3 Kiosk profile pick + PIN
- **Actor:** receptionist (admin unlocks the PC first). **Status:** Live.
- **Ideal flow:**
  1. Admin unlocks the reception PC.
  2. Receptionist picks their profile and enters the PIN.
  3. Only branches assigned by the admin are accessible.
- **Rules:** 5 failed attempts lock the profile for 5 minutes and raise an admin security alert.
- **Code:** `features/staff/StaffProfileSelection.tsx`, `features/auth/OperationalLogin.tsx` — `reception_auth.py:32,41`, `profile_access.py:152-223`.

### 1.4 First PIN change
- **Actor:** receptionist. **Status:** Live.
- **Ideal flow:** after an admin issues or resets a PIN, the first login forces a PIN change before anything else.
- **Code:** `features/auth/FirstPinChangePage.tsx` (`/staff/first-pin-change`) — `staff_credentials.py:37,48`.

### 1.5 Phone pairing
- **Actor:** admin issues, employee pairs. **Status:** Live.
- **Ideal flow:**
  1. Admin issues a 6-digit code valid for 15 minutes (server default 900 s, accepted range 60 s to 24 h; the frontend sends no TTL).
  2. Employee enters it on their phone.
  3. One phone per receptionist; admin can revoke, the employee can unlink their own.
- **Code:** `features/staff/DevicePairingView.tsx`, `features/auth/AdminStaffDevices.tsx` — `device_pairing.py:58-117`.

### 1.6 Reception stations, enrollment codes, admin sessions
- **Status:** stations/sessions — API only; enrollment codes — **Missing UI** (no frontend calls them).
- **Code:** `admin_staff_accounts.py:34-46`, `admin_enrollment.py:38-94`, `admin_sessions.py:28-46`.

### 1.7 Roles and permissions
- **Actor:** owner only. **Status:** Live.
- **Ideal flow:** manage permission bundles, assign them, grant admin/reception access per branch.
- **Code:** `features/auth/OwnerManagementPage.tsx` — `admin_role_management.py:13-78`.

## 2. Security and operational alerts
- **Actor:** admin with `can_manage_employees` / organization admin. **Status:** Live.
- **Ideal flow:** alerts (PIN lockouts, access overrides with debt, and receptionist attendance corrections) appear in `AlertCenter` and `AdminSecurityAlerts`; admin reviews them with full actor attribution.
- **Current behavior (verified in `feat/flow-a-decisions`):**
  - PIN lockouts are surfaced via `admin_security_alerts.py` (`features/auth/AdminSecurityAlerts.tsx` and `AlertCenter.tsx`).
  - Exceptional member entry overrides with debt (`outstanding_balance` + `outstanding_balance_confirmed`) record the authorizing staff member (`recorded_by`) and surface `debt_override_checkin` alerts in `GET /api/v1/owner/overview/alerts` and `GET /api/v1/member-check-ins/branches/{branch_id}/debt-alerts`, rendered live in `features/owner/AlertCenter.tsx` (D-A2).
  - Staff attendance corrections remain append-only and surface `attendance_correction` alerts in `GET /api/v1/owner/overview/alerts` with corrector identity, staff member name, and reason/details, rendered live in `features/owner/AlertCenter.tsx` (D-A3).

## 10. Staff schedules and attendance

### 10.1 Roster and schedules
- **Actor:** admin. **Status:** Live.
- **Ideal flow:** repeating shifts; edits apply to one occurrence, this and future, or the whole series.
- **Code:** `owner/staff/ScheduleSection.tsx`, `useStaffSchedule.ts` — `staff_roster.py`, `staff_schedules.py:14-43`.

### 10.2 Clock-in, clock-out, corrections
- **Actor:** receptionist; admin for corrections. **Status:** Partial (mixed with demo).
- **Ideal flow:** present or late against a tolerance; a missing exit is never filled in automatically; every correction is audited (D-032); should work offline.
- **Gap:** no offline sync event for staff attendance.
- **Current behavior:** corrections are append-only audit rows (the original record is never rewritten); a receptionist with the attendance permission can also correct records of their own branch. See `a-review-notes.md` D-A3.
- **Code:** `app/ApiStaffAttendance.tsx`, `reception/StaffAttendanceView.tsx`, `UnscheduledClockInModal.tsx` — `staff_attendance.py:22-89`.

### 10.3 Account link, deactivate, PIN reset
- **Actor:** admin. **Status:** Live.
- **Code:** `owner/staff/ApiStaffManagement.tsx`, `IssuedPinDialog.tsx` — `admin_staff_accounts.py:17,62,67`.

## 11. Payroll
- **Actor:** admin. **Status:** Live.
- **Ideal flow:** compute weekly payroll, record advances (`cash` or `transfer`), pay the week (idempotency key required), review history. All payroll payments and advances come from the owner's account (`Expense.shift_id = NULL`) and never reduce the shift cash drawer's expected cash (D-A1).
- **Code:** `owner/finance/LivePayrollView.tsx`, `owner/staff/PayrollDialog.tsx`, `owner/staff/usePayroll.ts` — `payroll.py:15-32`, `finance/service.py`.

## 12. Catalog and plans
- **Actor:** admin. **Status:** Live.
- **Ideal flow:** create services and plans; published plan versions are immutable (R-003); one current offer is shown per active plan (inactive plans are excluded from new sales while historical versions and existing members' paid periods are preserved; `active`/`inactive` status is used without an archive option, D-A4). Online only.
- **Code:** `owner/PlanCatalog.tsx`, `PlanEditor.tsx`, `reception/LiveMembershipCheckout.tsx`, `api/catalogApi.ts` — `catalog.py:78-141`, `catalog/queries.py`.

## 13. Sync, local-first and contingency mode
- **Ideal flow:** bootstrap local data, show sync status, pull roster deltas, push a queue of append-only offline events; admin resolves audit flags (inventory variance, cash discrepancy, clock skew).
- **Code:** `offline/SyncProvider`, `syncApi.ts`, `capabilities.ts` — `sync/bootstrap.py:67,101`, `delta.py:14`, `events.py:13`, `audit.py:51,64`.
- **Rules enforced:** audit flags are readable and resolvable only by an admin session or staff with `admin_audit_read`/`finance_read` across all branches (D-A5, never by reception permissions); any admin may provision a sync device for any branch (D-A6); `ADMIN_IDLE_SECONDS` is 30 days (D-A7); an offline `shift.arqueo_close` for an already-closed shift of the same branch is accepted without an audit flag when the close payload is identical, and flagged `orphan_shift_reference` when the close differs or targets a closing/foreign/missing shift (D-A8); an actor without an active grant is flagged `actor_not_authorized`.
- **Gaps:**
  - Offline cash renewals and quick registration are allowed by D-027, but the frontend marks `membership.sale` online-only (`capabilities.ts:14,50`) and the server accepts only 4 event types (`db/models/sync.py:12`).
  - No staff attendance event type (D-032).
  - No screen to resolve audit flags.


## Gaps summary

| # | Gap | Where |
| --- | --- | --- |
| 1 | Two alert systems (demo AlertCenter vs live security alerts) | `features/owner/AlertCenter.tsx`, `features/auth/AdminSecurityAlerts.tsx` |
| 3 | No UI for enrollment codes, registers/terminals, eligibility records, access decisions, sync audit flags | `admin_enrollment.py`, `shifts.py:77-100`, `members.py:146-162`, `membership_access.py:16`, `sync/audit.py` |
| 4 | Offline renewal / quick registration not supported (D-027) | `offline/capabilities.ts:14,50`, `db/models/sync.py:12` |
| 5 | Staff clock-in has no offline event (D-032) | `db/models/sync.py:12` |
| 9 | Unresolved decisions | D-015, D-017, D-021, D-023, D-024, D-025 |

Gap numbers match the original index. Gap 3 spans parts A, B and C and is listed here only.
