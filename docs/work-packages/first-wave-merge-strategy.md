# First-Wave Merge Strategy: Packages P1, P2, and P6

## 1. Executive Summary & Objective

This document defines the exact, dependency-aware integration sequence to merge the three completed first-wave worktrees into trunk (`codex/backend-foundation`):
- **Worktree A (`front-a-contracts`)**: Package P1 — Identity, Sessions, Devices & Transport
- **Worktree B (`front-b-contracts`)**: Package P2 — Member Read Contracts & FE05 Reload
- **Worktree C (`front-c-contracts`)**: Package P6 — Staff Occurrence Attendance & Roster Residuals

All three packages have been aligned and verified locally under **Ponytail** (leanest diff, zero visual redesign) and **ODD** principles. This strategy ensures zero migration conflicts, no signature mismatches, and complete contract compatibility.

---

## 2. Integration Dependency Architecture

```
                    [ Trunk: codex/backend-foundation ]
                     (Alembic baseline: 0030_staff_schedules)
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │ Step 1: Merge Worktree A (Package P1)                  │
       │ - Migrations: 0031_admin_session_policy ->             │
       │               0037_paired_profile_access               │
       │ - Auth providers, in-memory tokens, session lifecycle  │
       └────────────────────────────┬───────────────────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │ Step 2: Merge Worktree B (Package P2)                  │
       │ - Zero new migrations                                  │
       │ - Member read contracts & FE05 reload endpoint         │
       │ - Consumes P1 in-memory tokens & adaptive auth         │
       └────────────────────────────┬───────────────────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │ Step 3: Re-chain & Merge Worktree C (Package P6)       │
       │ - Re-chain migration: 0031 -> 0038                     │
       │   (down_revision = '0037_paired_profile_access')       │
       │ - Staff attendance endpoints & roster alignment        │
       └────────────────────────────┬───────────────────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │ Step 4: Consolidated Trunk Verification Gate          │
       │ - alembic heads (1 single head: 0038)                  │
       │ - Full backend pytest suite                            │
       │ - Full frontend vitest suite & tsc --noEmit            │
       └────────────────────────────────────────────────────────┘
```

---

## 3. Pre-Resolved Shared Surface Analysis

During alignment, cross-package collisions were pre-emptively reconciled:

| Shared Surface | Packages Involved | Conflict Risk | Pre-Resolved Status |
|---|---|---|---|
| `api/migrations/versions/` | P1 vs P6 | Collision on revision ID `0031` | **Resolved by spec**: P6 renumbers `0031_staff_occurrence_attendance.py` to `0038` chaining onto P1's `0037_paired_profile_access`. |
| `api/app/auth/admin.py` vs `staff_roster.py` | P1 vs C | `validate_admin_session` signature difference (`signing_secret`) | **Resolved in C**: `_principal` in `staff_roster.py` inspects `admin_token_signing_secret` adaptively. |
| `api/app/api/members.py` | P1 vs B | Route authority vs reload endpoint FE05 | **Resolved in B**: `get_member_actor_principal` supports signing secret adaptively; FE05 cleanly isolated. |
| In-Memory Session Tokens | P1 vs B / C | Frontend views falling back to Demo mode if tokens only in memory | **Resolved in B & C**: `resolveOperationalToken()` and `receptionApi.ts` read `__EVOGYM_*__` runtime providers with zero visual JSX modifications. |

---

## 4. Step-by-Step Execution Protocol

### Step 1: Merge Worktree A (Package P1) into Trunk

1. **Staging & Commit on Worktree A**:
   - Ensure all work in `front-a-contracts` is committed using standard conventional commits.
2. **Fast-forward / Merge into Trunk**:
   ```powershell
   git checkout codex/backend-foundation
   git merge front-a-contracts --no-ff -m "feat(auth): integrate package p1 identity, session lifecycle and devices"
   ```
3. **Verification**:
   ```powershell
   cd api
   ..\.venv\Scripts\python.exe -m pytest tests/test_admin_auth.py tests/test_devices.py tests/test_migrations.py
   cd ..\frontend
   npm test -- --run src/features/auth/AdminSessionProvider.test.tsx
   npx tsc --noEmit
   ```

### Step 2: Merge Worktree B (Package P2) into Trunk

1. **Merge Worktree B into Trunk**:
   ```powershell
   git merge front-b-contracts --no-ff -m "feat(members): integrate package p2 member-read contracts and reload endpoint"
   ```
2. **Verification**:
   ```powershell
   cd api
   ..\.venv\Scripts\python.exe -m pytest tests/test_member_reads.py
   cd ..\frontend
   npm test -- --run src/features/members/MemberDetail.test.tsx src/features/members/Members.test.tsx
   npx tsc --noEmit
   ```

### Step 3: Re-Chain & Merge Worktree C (Package P6) into Trunk

1. **Re-chain Alembic Migration in Worktree C before merge**:
   - Rename:
     `api/migrations/versions/0031_staff_occurrence_attendance.py` $\rightarrow$ `api/migrations/versions/0038_staff_occurrence_attendance.py`
   - Inside `0038_staff_occurrence_attendance.py`, update:
     ```python
     revision: str = '0038_staff_occurrence_attendance'
     down_revision: Union[str, None] = '0037_paired_profile_access'
     ```
   - Commit the renumbering in Worktree C.
2. **Merge Worktree C into Trunk**:
   ```powershell
   git merge front-c-contracts --no-ff -m "feat(staff): integrate package p6 staff attendance and occurrence scheduling"
   ```
3. **Verification**:
   ```powershell
   cd api
   alembic heads # Verify single head 0038_staff_occurrence_attendance
   ..\.venv\Scripts\python.exe -m pytest tests/test_staff_attendance.py tests/test_migrations.py
   cd ..\frontend
   npm test -- --run src/features/reception/StaffAttendanceView.test.tsx src/api/staffAttendanceApi.test.ts
   npx tsc --noEmit
   ```

---

## 5. Consolidated Post-Merge Verification Gate

Run from repository root after completing Steps 1–3:

1. **Alembic Migration Integrity**:
   ```powershell
   cd api
   alembic check
   alembic heads # Exactly one head: 0038_staff_occurrence_attendance
   ```
2. **Full Backend Test Suite**:
   ```powershell
   cd api
   ..\.venv\Scripts\pytest.exe -q
   ```
3. **Full Frontend Test Suite & Typecheck**:
   ```powershell
   cd frontend
   npm test -- --run
   npx tsc --noEmit
   ```

---

## 6. Rollback & Recovery Boundary

If any integration step fails:
- **Phase 1 failure**: Revert merge commit via `git reset --hard ORIG_HEAD`. Worktree A remains isolated.
- **Phase 2 failure**: Revert to post-P1 commit. Worktree B remains isolated.
- **Phase 3 failure**: Revert to post-P2 commit. Worktree C remains isolated and can adjust migration sequencing without affecting P1 or P2.
