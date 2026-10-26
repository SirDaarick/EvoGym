# Package P6 — Applied Changes & Technical Audit

**Worktree:** `front-c-contracts`  
**Package:** P6 (Staff Schedules & Occurrence Attendance)  
**Baseline:** `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (Alembic `0030_staff_schedules`)  
**Primary Ownership:** BK-031 / BK-040 residuals (STAFF-1, STAFF-2, STAFF-3)  

---

## 1. Architectural Strategy (Ponytail + ODD)

Worktree C implements branch-scoped staff occurrence attendance, checkout tracking, and clock validation integrity (decision D-033) under strict **Ponytail** principles:
- **Smallest Complete Working Diff**: Token resolution was enhanced centrally in `receptionApi.ts`, so all reception views transparently gain in-memory session capability without touching component markup.
- **Zero Visual Redesign**: Kept 100% of existing visual design, badge statuses, clock action buttons, and responsive grid in `StaffAttendanceView.tsx`.
- **Pre-emptive P1 Alignment**: Aligned backend roster authentication with Worktree A's token signing secrets.
- **Linear Migration Path**: Explicit re-chaining specification documented for seamless integration after P1 (`0031` $\rightarrow$ `0038`).

---

## 2. Database Schema (Alembic Migration)

- **`api/migrations/versions/0031_staff_occurrence_attendance.py`**:
  - Adds tables:
    - `staff_schedule_series`: Recurring schedule templates with days of week and time windows.
    - `staff_schedule_exceptions`: Date-specific schedule exceptions and overrides.
    - `staff_attendance_records`: Affirmative clock-in events capturing `profile_id`, `branch_id`, `occurred_at`, `business_date`, `device_captured_at`, `server_received_at`, `clock_skew_seconds`, `clock_validation_status`, `review_required`, and `schedule_conflict`.
    - `staff_attendance_checkouts`: Affirmative clock-out events.
    - `staff_attendance_corrections`: Append-only supervisor audit corrections.
- **Re-chaining Specification for Merge**:
  - In `front-c-contracts`, it chains off baseline `0030_staff_schedules`.
  - When merging into trunk after Worktree A (which adds `0031`–`0037`), it will be renamed to `0038_staff_occurrence_attendance.py` with `down_revision = '0037_paired_profile_access'`.

---

## 3. Backend Implementation

1. **Staff Occurrence Attendance API (`api/app/api/staff_attendance.py`)**:
   - `GET /api/v1/staff-attendance?business_date=YYYY-MM-DD`: Lists all active records and schedule states for the branch.
   - `POST /api/v1/staff-attendance`: Records affirmative clock-in with idempotency key protection and D-033 clock skew validation.
   - `POST /api/v1/staff-attendance/{id}/checkout`: Records affirmative clock-out.
   - `POST /api/v1/staff-attendance/{id}/corrections`: Append-only correction log for auditability.
2. **Clock Validation Integrity (Decision D-033)**:
   - Compares client device timestamp with server received timestamp.
   - Flags clock skew exceeding tolerance as `review_required = True`.
   - Rechecks roster profiles to ensure check-in conforms to active branch permissions.
3. **Adaptive Auth Principal (`api/app/api/staff_roster.py`)**:
   - Updated `_principal` to inspect `request.app.state.settings`:
     - If `admin_token_signing_configured` is present, passes secret to `validate_admin_session(factory, token, secret)`.
     - Otherwise falls back to unsigned validation `validate_admin_session(factory, token)`.
   - Prevents `TypeError` upon merging into trunk alongside Worktree A.

---

## 4. Frontend Implementation

1. **Central In-Memory Token Resolution (`frontend/src/api/receptionApi.ts`)**:
   - Enhanced `readOperationalToken()`:
     ```typescript
     export function readOperationalToken(): string | null {
       if (typeof window !== 'undefined') {
         const customWindow = window as unknown as {
           __EVOGYM_OPERATIONAL_SESSION__?: string;
           __EVOGYM_ADMIN_SESSION__?: string;
           __EVOGYM_TOKEN__?: string;
         };
         if (customWindow.__EVOGYM_OPERATIONAL_SESSION__) return customWindow.__EVOGYM_OPERATIONAL_SESSION__;
         if (customWindow.__EVOGYM_ADMIN_SESSION__) return customWindow.__EVOGYM_ADMIN_SESSION__;
         if (customWindow.__EVOGYM_TOKEN__) return customWindow.__EVOGYM_TOKEN__;
         return window.sessionStorage.getItem(TOKEN_KEY);
       }
       return null;
     }

     export const resolveOperationalToken = readOperationalToken;
     ```
   - Automatically supports P1's `ProductAccessProvider` tokens without requiring changes across individual views.
2. **Staff Attendance View (`frontend/src/features/reception/StaffAttendanceView.tsx`)**:
   - Uses `readOperationalToken()` to dynamically connect to the live attendance endpoints.
   - Displays real-time employee attendance status, check-in timestamps, and clock-out actions.
   - Retains 100% of existing CSS classes, badge layouts, and interactive toast feedback.
3. **Typed API Client (`frontend/src/api/staffAttendanceApi.ts`)**:
   - Complete typed contract for attendance retrieval, check-in, check-out, and corrections with robust error mapping (`OperationalApiHttpError`, `OperationalApiNetworkError`).

---

## 5. Verification Evidence

1. **Backend Tests**:
   - Command: `pytest tests/test_staff_attendance.py`
   - Result: **12 passed, 1 warning** (100%).
2. **Frontend Tests**:
   - Command: `npm test -- --run src/api/staffAttendanceApi.test.ts src/features/reception/StaffAttendanceView.test.tsx`
   - Result: **20 passed across 2 test files** (100%).
3. **TypeScript Typecheck**:
   - Command: `npx tsc --noEmit`
   - Result: **Clean exit code 0, 0 errors**.
4. **Git Diff Footprint**:
   - `api/app/api/staff_roster.py`: +15, -1
   - `frontend/src/api/receptionApi.ts`: +15, -1
