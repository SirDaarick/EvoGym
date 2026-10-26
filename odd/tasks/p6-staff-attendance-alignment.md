# P6 — Staff Attendance Alignment (Ponytail + ODD)

## Objective

Align Package P6 implementation in worktree C (`front-c-contracts`) with the architecture of Package P1 in worktree A (`front-a-contracts`) and prepare for clean, zero-conflict merge:
1. Backend auth alignment: Align `_principal` in `api/app/api/staff_roster.py` to support `signing_secret` when configured, preventing `TypeError` upon merging with Worktree A.
2. In-memory token alignment: Enable `readOperationalToken` in `frontend/src/api/receptionApi.ts` to transparently resolve in-memory session tokens from P1 runtime providers, preventing silent fallback to demo mode in production.
3. Document Migration Merge Chain: Record the renumbering specification for `0031_staff_occurrence_attendance.py` -> `0038_staff_occurrence_attendance.py` with `down_revision = "0037_paired_profile_access"` to be executed when integrating with Worktree A.

## Allowed edit surfaces

api/app/api/staff_roster.py
frontend/src/api/receptionApi.ts
frontend/src/features/reception/StaffAttendanceView.tsx
odd/tasks/p6-staff-attendance-alignment.md

## Ponytail Rules

- The best code is the code never written.
- Smallest complete working diff: enhance token resolution centrally in `receptionApi.ts` so all reception views benefit automatically without modifying component JSX or layouts.
- Zero visual changes: maintain existing styled cards, badge indicators, and clock actions.

## Work Units

- [x] **SAA-01 (Backend Auth Alignment):** Update `_principal` in `api/app/api/staff_roster.py` to check `admin_token_signing_secret` and adaptively pass it to `validate_admin_session`.
- [x] **SAA-02 (Frontend In-Memory Token Resolution):** Enhance `readOperationalToken()` in `frontend/src/api/receptionApi.ts` to check in-memory token from global/provider scope before falling back to `sessionStorage`.
- [x] **SAA-03 (Migration Merge Documentation):** Document the Alembic migration rechaining specification for integration with Worktree A (P1).
- [x] **SAA-04 (Verification):** Run Pytest (`test_staff_attendance.py`), Vitest (`StaffAttendanceView.test.tsx`, `staffAttendanceApi.test.ts`), and `tsc --noEmit`.

## Alembic Migration Rechaining Specification

- Current state in `front-c-contracts`:
  - `api/alembic/versions/0031_staff_occurrence_attendance.py` currently chains off `down_revision = '0030_staff_schedules'`.
- Trunk / Worktree A state:
  - Worktree A contains migrations `0031_admin_auth_events.py` through `0037_paired_profile_access.py`.
- Re-chaining plan on final merge into trunk:
  1. Rename `api/alembic/versions/0031_staff_occurrence_attendance.py` to `api/alembic/versions/0038_staff_occurrence_attendance.py`.
  2. Inside `0038_staff_occurrence_attendance.py`, update:
     - `revision: str = '0038_staff_occurrence_attendance'`
     - `down_revision: Union[str, None] = '0037_paired_profile_access'`
  3. Verify with `alembic heads` (single head expected).

## Verification Results

1. **Backend Tests (Pytest)**:
   - Command: `pytest tests/test_staff_attendance.py`
   - Result: 12 passed, 1 warning.
2. **Frontend Tests (Vitest)**:
   - Command: `npm test -- --run src/api/staffAttendanceApi.test.ts src/features/reception/StaffAttendanceView.test.tsx`
   - Result: 2 test files passed, 20 tests passed.
3. **TypeScript Typecheck**:
   - Command: `npx tsc --noEmit`
   - Result: Exit code 0, 0 errors.
