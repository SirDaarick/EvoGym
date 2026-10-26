# Package P2 — Applied Changes & Technical Audit

**Worktree:** `front-b-contracts`  
**Package:** P2 (Member Read Contracts & FE05 Reload)  
**Baseline:** `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (Alembic `0030_staff_schedules`)  
**Primary Ownership:** FE05 member-read contracts (no exclusive DB migrations)  

---

## 1. Architectural Strategy (Ponytail + ODD)

Worktree B implements the member-read contracts and the FE05 reload flow under strict **Ponytail** principles:
- **Zero Schema Migrations**: Relies cleanly on existing database models.
- **Deletion over Addition**: Deleted redundant duplicate widgets (`MemberReloadSection`) and hydrated the native member detail view directly (-69 net lines).
- **Zero Visual Redesign**: Kept 100% of existing visual design, typography, card layout, and badge indicators intact. Only dynamic data bindings were connected.
- **Pre-emptive P1 Alignment**: Fully aligned with Package P1's in-memory token architecture and signing-secret authentication.

---

## 2. Backend Changes (`api/app/api/members.py`)

1. **FE05 Reload Endpoint (`GET /api/v1/members/{member_id}/reload`)**:
   - Exposes member profile refresh returning:
     - Member status and validity dates.
     - Pending debt balance in minor units (centavos), exposed to Admins per decision D-012.
     - `recent_visits` (last 5 check-ins).
     - `active_periods` (membership period range and plan details).
     - `class_samples` (attendance records for group classes).
2. **Adaptive Auth Principal (`get_member_actor_principal`)**:
   - Inspects `request.app.state.settings`:
     - If `admin_token_signing_configured` is enabled (Worktree A / P1), invokes `validate_admin_session(factory, token, signing_secret)`.
     - If signing is not configured, invokes `validate_admin_session(factory, token)`.
   - Prevents `TypeError` upon merging into trunk alongside Worktree A.

---

## 3. Frontend Changes (`frontend/src/features/members/`)

1. **Native Card Hydration in `MemberDetail.tsx`**:
   - **Card 1 (`counter-card-membership`)**: Dynamically binds plan name, renewal date, status badge, and debt alert/amount (admin-only centavos to pesos conversion).
   - **Card 2 (`counter-card-attendance`)**: Displays last visit timestamp from `recent_visits[0]`.
   - **Expediente Tab (`MemberDetailSections`)**: Populates active periods, recent visits list, and class attendance directly into native accordion/list items.
2. **Elimination of UI Slop**:
   - Completely removed `MemberReloadSection` (-194 lines), eliminating duplicated cards and unnatural floating UI elements.
3. **In-Memory Token Resolution in `Members.tsx`**:
   - Implemented `resolveOperationalToken()`:
     ```typescript
     function resolveOperationalToken(): string | null {
       if (typeof window !== 'undefined') {
         const customWindow = window as unknown as {
           __EVOGYM_OPERATIONAL_SESSION__?: string;
           __EVOGYM_ADMIN_SESSION__?: string;
           __EVOGYM_TOKEN__?: string;
         };
         if (customWindow.__EVOGYM_OPERATIONAL_SESSION__) return customWindow.__EVOGYM_OPERATIONAL_SESSION__;
         if (customWindow.__EVOGYM_ADMIN_SESSION__) return customWindow.__EVOGYM_ADMIN_SESSION__;
         if (customWindow.__EVOGYM_TOKEN__) return customWindow.__EVOGYM_TOKEN__;
       }
       return readOperationalToken();
     }
     ```
   - Automatically retrieves live session tokens provided by P1's `ProductAccessProvider` and `AdminSessionProvider` without falling back to demo mode.

---

## 4. Verification Evidence

1. **Backend Tests**:
   - Command: `pytest tests/test_member_reads.py`
   - Result: **12 passed, 1 warning** (100%).
2. **Frontend Tests**:
   - Command: `npm test -- --run src/features/members/MemberDetail.test.tsx src/features/members/Members.test.tsx src/api/memberReadsApi.test.ts`
   - Result: **45 passed across 3 test files** (100%).
3. **TypeScript Typecheck**:
   - Command: `npx tsc --noEmit`
   - Result: **Clean exit code 0, 0 errors**.
4. **Git Diff Footprint**:
   - 5 files changed, 149 insertions(+), 218 deletions(-) (net -69 lines).
