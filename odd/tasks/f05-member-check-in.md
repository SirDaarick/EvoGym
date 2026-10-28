# F05 — Record a Member Access / Check-in Event (Ponytail + ODD)

## Objective

Connect the authenticated Member Detail UI (`Members.tsx` / `ApiMembers.tsx`) to the persisted member check-in endpoint (`POST /api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}`) under Option A (entry-only check-in) per Ponytail principles:
1. Zero UI redesign: Reuse existing hero action layout (`.member-attendance-action`, `.member-attendance-btn`, `.member-attendance-feedback`), default to `Mostrador` tab rendering `MemberCounterView`, and provide standard accessible status feedback.
2. Entry-only access events (Option A): Persist check-in without inventing check-out hardware events, map `observedCheckOut: visit.occurred_at` with explicit shortcut comment.
3. Branch context resolution: Use receptionist's active branch from `useProductAccess().principal.branch.branch_id` or fallback to membership period / home branch for owner.
4. Idempotency safety: Maintain stable idempotency key across retry attempts for the same target period/branch.

## Allowed edit surfaces

frontend/src/api/memberReadsApi.ts
frontend/src/app/ApiMembers.tsx
frontend/src/features/members/Members.tsx
frontend/src/features/members/Members.test.tsx
api/tests/test_member_check_ins.py
odd/tasks/f05-member-check-in.md

## Ponytail Rules

- The best code is the code never written. Solve the whole problem with the least new code.
- Zero unnecessary abstractions or wrappers.
- Reuse house components and existing CSS patterns (`.member-attendance-action`, `.member-attendance-btn`, `.member-attendance-feedback`).
- Explicit shortcut comment: `// shortcut: entry-only check-in, add exit event when turnstile hardware contract exists`.

## Work Units

- [x] **F05-01 (Task & Contract):** Create `odd/tasks/f05-member-check-in.md` and export `MemberCheckInResponse` in `frontend/src/api/memberReadsApi.ts`.
- [x] **F05-02 (RED - Backend Test):** Add integration test `test_member_checkin_immediately_reflects_in_member_reload` in `api/tests/test_member_check_ins.py` verifying that check-in immediately reflects in `GET /api/v1/members/{member_id}/reload`.
- [x] **F05-03 (RED - Frontend Tests):** Add unit/integration tests in `frontend/src/features/members/Members.test.tsx` verifying default Mostrador view, successful check-in flow, idempotency reuse on retry, and ineligible period disabling.
- [x] **F05-04 (GREEN - Frontend Implementation):**
  - Update `LiveMemberDetail` in `frontend/src/features/members/Members.tsx` to default to `Mostrador`, render `MemberCounterView` with reload data, and render `Registrar entrada` with feedback.
  - Implement `onCheckIn` callback and `pendingKeyRef` idempotency in `frontend/src/app/ApiMembers.tsx`.
- [x] **F05-05 (Verification):** Run verification commands:
  - `python -m pytest api/tests/test_member_check_ins.py`
  - `npm --prefix frontend run test -- src/features/members/Members.test.tsx`
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run build`

## Verification Results

1. **Backend Tests (Pytest)**:
   - Command: `python -m pytest api/tests/test_member_check_ins.py`
   - Result: `4 passed, 1 warning in 11.60s` (all check-in tests including new immediate reload reflection test passed).
2. **Frontend Tests (Vitest)**:
   - Command: `npm --prefix frontend run test -- src/features/members/Members.test.tsx`
   - Result: `1 passed (1), 23 passed (23) in 18.67s` (all 19 baseline tests + 4 new F05 tests passed).
3. **TypeScript Typecheck**:
   - Command: `npm --prefix frontend run typecheck`
   - Result: `tsc -b --pretty false` exited 0 (clean, no errors).
4. **Production Build**:
   - Command: `npm --prefix frontend run build`
   - Result: `tsc -b && vite build` built in 2.02s with PWA precache generation (clean).
