# F02 — Register and Maintain a Member (Ponytail + ODD)

**Status:** Completed and verified under Ponytail and ODD rules. All targeted test suites pass, zero slop, and F05 check-in preserved.

## 1. Objective and Approved Product Flow

Connect the authenticated member directory and detail screens (`ApiProductApp.tsx`, `ApiMembers.tsx`, `Members.tsx`, `MemberDetail.tsx`) to the real member lifecycle endpoints without redesigning existing visuals or pulling in `F04` membership checkout/sales:

`Authenticated Directory → New Member (/members/new) → Save Profile (POST) → Paginated Live Directory → Member Detail → Edit Allowed Profile Fields (PATCH) / Admin-Only Notes (GET/POST /notes) → Hard Reload`

## 2. Baseline, Preservation, and Definition of Ready (DoR)

- **Base commit:** `4f8d3e5` on `codex/f01-cash-shift-lifecycle`.
- **Preserved dirty/untracked paths:**
  - Modified by `F05` (must be preserved or committed first without regression): `api/tests/test_member_check_ins.py`, `frontend/src/api/memberReadsApi.ts`, `frontend/src/app/ApiMembers.tsx`, `frontend/src/features/members/Members.test.tsx`, `frontend/src/features/members/Members.tsx`, `odd/tasks/f05-member-check-in.md`.
  - Pre-existing workspace paths (do not stage or revert): `frontend/vite.config.ts`, `skills-lock.json`, `.agents/skills/`, `=ro`, `api/dev.db`, `api/run_dev_server.py`, `api/seed_dev.py`, `backend/`, `odd/tasks/remaining-feature-integrations.md`, `output/`, `tmp/`.
- **Live consumer routes:**
  - Reception: `/reception/members`, `/reception/members/new`, `/reception/members/:memberId`
  - Owner: `/owner/members`, `/owner/members/new`, `/owner/members/:memberId`
- **Selected API and schema contracts:**
  - `GET /api/v1/members` (`api/app/api/members.py:147-189`, `MemberListResponse`)
  - `POST /api/v1/members` (`api/app/api/members.py:192-218`, `CreateMemberDTO` → `MemberDetailDTO`)
  - `GET /api/v1/members/{member_id}` (`api/app/api/members.py:221-240`, `MemberDetailDTO`)
  - `PATCH /api/v1/members/{member_id}` (`api/app/api/members.py:243-264`, `UpdateMemberDTO` → `MemberDetailDTO`)
  - `GET /api/v1/members/{member_id}/notes` & `POST /api/v1/members/{member_id}/notes` (`api/app/api/members.py:268-311`, `MemberNoteListResponse`, `CreateMemberNoteDTO` → `MemberNoteDTO`, restricted to `admin` permission)
  - `GET /api/v1/members/{member_id}/reload` (`api/app/api/members.py:314-337`, `MemberReloadDTO`)

## Allowed edit surfaces

api/app/members/schemas.py
api/tests/test_members.py
frontend/src/api/membersApi.ts
frontend/src/api/membersApi.test.ts
frontend/src/app/ApiProductApp.tsx
frontend/src/app/ApiProductApp.test.tsx
frontend/src/app/ApiMembers.tsx
frontend/src/features/members/Members.tsx
frontend/src/features/members/MemberDetail.tsx
frontend/src/features/members/Members.test.tsx
odd/tasks/f02-members-lifecycle.md

## 3. Ponytail Minimal Design & Cross-Feature Alignment

1. **Zero backend churn on `phone` (protects `F04` and existing suite):**
   - Keep `full_name` and `phone` required (`email` optional) in the live profile form, matching `LiveMemberRegistration.tsx:86-91` (`F04`) and `api/app/members/schemas.py:121-154`. Do not weaken database/schema constraints or break the 4 blank-phone tests in `api/tests/test_members.py:1220-1241`.
2. **Reuse existing `409` idempotent create reconciliation (protects `F04`):**
   - `POST /api/v1/members` returns `409` without a `member_id` (`api/app/api/members.py:216-218`). Reuse the exact client-generated `member_number` (`M` + 31 hex chars) and `GET /api/v1/members?page=1&limit=100&search=${member_number}&sort_by=member_number&sort_dir=asc` reconciliation pattern from `frontend/src/api/membershipCheckoutApi.ts:163-199` over `AuthenticatedRequest` in `frontend/src/api/membersApi.ts`.
   - If the existing record matches `member_number`, `full_name`, and `phone`, treat the retry as the completed creation; if another member holds that number, preserve form inputs and allow retrying with a new number.
3. **3-line backend note validation, zero DTO bloat (protects `F14`):**
   - Apply `normalize_required_text` to `CreateMemberNoteDTO.body` in `api/app/members/schemas.py:74-78` so whitespace-only notes return `422` without writing to the database.
   - Keep `MemberNoteDTO` (`id`, `member_id`, `author_id`, `body`, `created_at`) unchanged so `F14` (member history) and existing note tests (`api/tests/test_members.py:625-751`) require zero changes.
4. **Route precedence & live profile form (`ApiProductApp.tsx`, `ApiMembers.tsx`, `Members.tsx`):**
   - In `frontend/src/app/ApiProductApp.tsx:109-112`, match `/reception/members/new` and `/owner/members/new` before `/reception/members/:memberId` and `/owner/members/:memberId` so `'new'` is never passed as `memberId` to `ApiMemberDetail`.
   - In `frontend/src/features/members/Members.tsx:198`, keep both `"Nuevo socio"` and `"Actualizar"` available in live mode when `onNewMember` and `onRefresh` are provided.
   - Populate the edit form from legal `full_name` (`MemberDetailDTO.full_name`), never `preferred_name`, and send `PATCH /api/v1/members/{member_id}` with `{ full_name, phone, email: email.trim() || null }`.
5. **Eliminate `DemoProvider` from live detail while preserving `F05` check-in (`Members.tsx`, `MemberDetail.tsx`):**
   - In `frontend/src/features/members/MemberDetail.tsx:562`, `MemberCounterView` currently calls `useDemo()` unconditionally only to read/write `state.memberNotes`.
   - Make demo context access optional in `MemberCounterView` when live note props (`liveNotes`, `onAddLiveNote`, `noteSubmitting`, `noteError`) are provided, and remove `<DemoProvider>` from `LiveMemberDetail` (`frontend/src/features/members/Members.tsx:329`).
   - Only `OWNER`/`ADMIN` calls `GET /api/v1/members/{id}/notes` and renders the note composer/list; `RECEPTION` neither requests `/notes` nor sees admin note controls (`D-012`).
   - Keep `F05`'s `reloadState` and `onCheckIn` props (`Registrar entrada`) untouched.

## 4. Work Units (Cohesive ODD Execution)

- [x] **F02-01 (Backend Whitespace Note Guard — RED → GREEN):**
  - Add 1 test in `api/tests/test_members.py` asserting `POST /api/v1/members/{id}/notes` with `"   "` returns `422` and writes zero `MemberNote` rows.
  - Add `@field_validator("body")` reusing `normalize_required_text` on `CreateMemberNoteDTO` in `api/app/members/schemas.py`.
- [x] **F02-02 (Frontend Live Lifecycle Adapter — RED → GREEN):**
  - Extend `frontend/src/api/membersApi.ts` with `createMemberNumber`, `createMember` (including `409` search reconciliation), `updateMember`, `listMemberNotes`, and `createMemberNote` using `AuthenticatedRequest` and explicit `Content-Type: application/json`.
  - Wire `/reception/members/new` and `/owner/members/new` in `ApiProductApp.tsx` and `ApiMembers.tsx`.
  - Mount live `"Nuevo socio"`, profile edit form (`PATCH`), and admin-only live notes in `Members.tsx` / `MemberDetail.tsx`, removing `<DemoProvider>` from `LiveMemberDetail`.
- [x] **F02-03 (Verification & Disposable-DB Browser Proof):**
  - Run targeted backend/frontend suites, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`, and execute the 5 end-to-end verification flows below against a disposable SQLite database.

## 5. High-Value Test Criteria (Anti-Slop Gate)

Every test added for `F02` must pass these 4 quality gates before being accepted:

1. **Zero duplication of existing backend coverage:**
   - `api/tests/test_members.py` already covers member creation (`:879-975`), `409` duplicate `member_number` (`:978-1007`), shared natural identifiers (`:1010-1048`), `PATCH` partial updates and `404`/`422` (`:1099-1159`), blank required text (`:1220-1241`), and `GET/POST /notes` role enforcement (`:625-751`). Do **not** re-write those tests.
   - Only **1 backend test** is authorized: rejecting whitespace-only `body` in `POST /api/v1/members/{id}/notes` (`422`).
2. **Deterministic RED before GREEN:**
   - Each new test must fail before implementation for the exact missing behavior (e.g., `/reception/members/new` erroneously calling `GET /api/v1/members/new`, or `LiveMemberDetail` failing when `DemoProvider` is removed).
3. **Contract-faithful assertions (no mock-to-mock tautologies):**
   - Frontend tests must inspect the outgoing wire request (`method`, path, `Content-Type: application/json`, and serialized JSON payload) and use API-shaped response fixtures matching `MemberDetailDTO`, `MemberReloadDTO`, and `MemberNoteListResponse`.
4. **High-value frontend test matrix (5 focused tests):**
   - `ApiProductApp.test.tsx`: `/reception/members/new` and `/owner/members/new` render the live creation form instead of treating `'new'` as a `:memberId` lookup.
   - `membersApi.test.ts`: `createMember` sends `POST /api/v1/members` with `Content-Type: application/json`, reconciles an identical retry on `409` via `GET /api/v1/members?search=...`, and throws a conflict error when the number belongs to a different member.
   - `Members.test.tsx` (Create & Edit): Live directory shows both `"Nuevo socio"` and `"Actualizar"`; submitting create navigates to detail; editing pre-fills legal `full_name` (not `preferred_name`), sends `PATCH /api/v1/members/{id}`, and updates the detail view.
   - `Members.test.tsx` (Error preservation): `422` / `409` / `500` on create or edit surfaces an alert, keeps the user's typed values in the inputs, and never fabricates a saved state.
   - `Members.test.tsx` (Role-scoped notes, zero `DemoProvider`, & `F05` non-regression): `OWNER` loads and posts durable notes via `/api/v1/members/{id}/notes` with zero `DemoProvider` mounted; `RECEPTION` does not request `/notes` and cannot see note controls; `F05` `"Registrar entrada"` continues to work.

## 6. Verification Flows (How to Prove Correct Operation)

### 6.1 Automated Verification Commands

Run in this exact order:
1. `python -m pytest api/tests/test_members.py api/tests/test_member_check_ins.py -q`
2. `npm --prefix frontend run test -- src/api/membersApi.test.ts src/app/ApiProductApp.test.tsx src/features/members/Members.test.tsx`
3. `npm --prefix frontend run typecheck`
4. `npm --prefix frontend run build`

### 6.2 Real-Browser End-to-End Acceptance Flows (Disposable DB)

Start the API against a disposable SQLite database and the frontend dev server with `VITE_DEMO_MODE=false`. Execute and record evidence for these 5 flows:

1. **Flow 1 — Route Precedence & New Member Registration (Receptionist):**
   - Sign in as receptionist (`recepcion`). Open `/reception/members`.
   - Click `"Nuevo socio"` (or navigate directly to `/reception/members/new` and hard-reload). Verify no `GET /api/v1/members/new` (`404`) occurs and the registration form renders.
   - Submit `full_name: "Elena Morales"`, `phone: "5551112233"`, `email: "elena@example.com"`.
   - Verify `POST /api/v1/members` returns `201`, detail renders, hard browser reload (`F5`) preserves the member, and searching `"Elena Morales"` in `/reception/members` lists the persisted row.
2. **Flow 2 — Profile Edit & Legal Name Fidelity + Hard Reload:**
   - From Elena's detail view, open `"Editar datos"`. Verify inputs are pre-populated with legal `full_name`, `phone`, and `email`.
   - Update `phone` to `"5559998877"` and `email` to `""` (cleared). Submit.
   - Verify `PATCH /api/v1/members/{id}` returns `200` with `phone: "5559998877"` and `email: null`. Hard-reload the browser and confirm the updated fields persist.
3. **Flow 3 — Role-Scoped Notes (`RECEPTION` Denied/Hidden vs `OWNER` Durable CRUD):**
   - While logged in as `recepcion` on Elena's detail view, verify no `/api/v1/members/{id}/notes` request is fired in the network tab and no note form or note content is visible.
   - Sign in as owner (`admin`), open Elena's detail view (`/owner/members/{id}`), and verify `GET /api/v1/members/{id}/notes` returns `200`.
   - Attempt to submit a whitespace-only note (`"   "`) and verify it is blocked or rejected (`422`) without adding a note.
   - Submit `"Socio solicita factura mensual"`. Verify `POST /api/v1/members/{id}/notes` returns `201`, the note renders immediately, and survives a hard browser reload (`F5`).
4. **Flow 4 — Failure Recovery & Draft Preservation (`422` / `409`):**
   - Trigger an invalid update or duplicate `member_number` conflict (`409` with different member data).
   - Verify the error alert is displayed, typed form values remain intact in the inputs, and no false success toast or navigation occurs.
5. **Flow 5 — Cross-Feature Non-Regression (`F05` Check-in & Zero `DemoProvider`):**
   - On a member with an eligible active membership period, click `"Registrar entrada"` from the `Mostrador` tab in `LiveMemberDetail` and confirm `POST /api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}` succeeds alongside the new `F02` edit/note wiring.
