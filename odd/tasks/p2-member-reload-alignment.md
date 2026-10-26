# P2 — Member Reload Alignment (Ponytail + ODD)

## Objective

Align Package P2 implementation in worktree B (`front-b-contracts`) with the architecture of Package P1 in worktree A (`front-a-contracts`) and eliminate visual slop/overengineering per Ponytail principles:
1. Zero visual redesign: Hydrate native `MemberCounterView` and `MemberDetailSections` directly with `reloadState` data (membership, attendance, balance/debts) instead of inserting the extraneous `MemberReloadSection` panel.
2. In-memory token alignment: Enable `Members.tsx` to resolve tokens from P1 in-memory providers (`ProductAccessProvider` / `AdminSessionProvider`) with graceful fallback to `sessionStorage`.
3. Backend auth alignment: Align `get_member_actor_principal` in `api/app/api/members.py` to support `signing_secret` parameter when configured, preventing `TypeError` on future merge with worktree A.

## Allowed edit surfaces

api/app/api/members.py
frontend/src/features/members/MemberDetail.tsx
frontend/src/features/members/MemberDetail.test.tsx
frontend/src/features/members/Members.tsx
frontend/src/features/members/Members.test.tsx
odd/tasks/p2-member-reload-alignment.md

## Ponytail Rules

- The best code is the code never written.
- Deletion beats addition: eliminate `MemberReloadSection` and its ad-hoc styles.
- Reuse existing cards: Card 1 (Membresía & Cobranza) and Card 2 (Asistencia) receive reload data seamlessly.
- Shortest working diff wins.

## Work Units

- [x] **MRA-01 (RED - TDD):** Update `MemberDetail.test.tsx` and `Members.test.tsx` to assert that native cards (`counter-card-membership`, `counter-card-attendance`, etc.) render reload data and remove expectations for `MemberReloadSection`. (Observed 4 test failures across suites).
- [x] **MRA-02 (GREEN - Ponytail):** Delete `MemberReloadSection` from `MemberDetail.tsx`. Map `reloadState` directly into existing props and views in `MemberDetail.tsx` and `Members.tsx`.
- [x] **MRA-03 (Backend Alignment):** Align `get_member_actor_principal` in `api/app/api/members.py` to support `signing_secret` when configured.
- [x] **MRA-04 (Verification):** Run full test suites: Pytest on `test_member_reads.py`, Vitest on frontend member suites, and `tsc --noEmit`.

## Verification Results

1. **Backend Tests (Pytest)**:
   - Command: `python.exe -m pytest tests/test_member_reads.py`
   - Result: 12 passed, 1 warning in 21.40s.
2. **Frontend Tests (Vitest)**:
   - Command: `npm test -- --run src/features/members/MemberDetail.test.tsx src/features/members/Members.test.tsx src/api/memberReadsApi.test.ts`
   - Result: 3 test files passed, 45 tests passed in 21.69s.
3. **TypeScript Typecheck**:
   - Command: `npx tsc --noEmit`
   - Result: Exit code 0, clean with no errors.
