# BK-028 - Live API membership registration and checkout

Connect new-member registration and existing-member membership purchase through the authenticated backend, beginning in the live reception path. Keep demo-backed screens separate. Complete these membership flows before Mercado Pago, which remains the final integration in this sequence.

## Problem and outcome

The standard frontend registration and checkout read and write demo state, while the backend exposes authenticated member, plan, register/shift, and membership-sale APIs. This feature keeps the live API flow separate from demo records and uses backend UUIDs and server payment/entitlement outcomes.

## Scope and constraints

- **Included:** live operational member lookup; new-member registration with an automatically generated unique member number; active published membership plan and open register/shift data; cash and bank-transfer membership sale; exact retry/reconciliation; distinct payment and membership status presentation.
- **Excluded for this sequence:** DemoProvider-backed pages, Mercado Pago/card-provider integration until the final step, offline queue/sync, and changing backend membership business rules.
- Transfer sales must use the transfer endpoint and remain pending review until an authorized Admin decision. Cash and transfer outcomes must not be conflated.
- Use the authenticated `/reception/live` path and its configured branch/session. Never substitute demo IDs for backend UUIDs.
- Preserve all pre-existing dirty frontend files. Do not edit `MemberDetail`, `Members`, `NewMemberRegistration`, `ReceptionHome`, `CurrentPurchaseCard`, `DemoProvider`, or demo operations in this feature. New registration belongs only in the authenticated live reception flow.
- Delivery strategy: `single-pr` on the existing `codex/backend-foundation` branch, matching the user's existing-branch preference. Commits remain task-sized; no push or PR creation is authorized.
- Forecast: approximately 900 authored changed lines across member API, live registration/checkout UI/tests, and task/plan docs; generated files excluded. Work-unit commits remain separate and reviewable.

## Tasks

### BK-028-T1 - Authenticated checkout API boundary

- [x] Add and test typed API calls for active published membership plans, registers/open shifts, and cash/transfer membership sales using the existing operational token/config.
- [x] Preserve the caller-provided `Idempotency-Key` exactly and distinguish HTTP failures from unknown network outcomes; the UI must retain the same key and payload for retry.
- [x] Update the task ledger and phase card to record the API boundary as partial progress without claiming UI integration.
- **Authorized surfaces:** `frontend/src/api/membershipCheckoutApi.ts`, `frontend/src/api/membershipCheckoutApi.test.ts`, `odd/tasks/backend-implementation.md`, `docs/backend-plan/04-implementation-phases.md`, and this file.
- **Checks:** `npm test -- --run src/api/membershipCheckoutApi.test.ts` from `frontend`; `git diff --check`.
- **Runtime harness:** Mocked `fetch` tests cover auth, lookups, distinct sale routes, exact idempotency header, server DTO passthrough including a nullable membership period, HTTP errors, and network uncertainty; no live backend credentials or network calls.
- **Rollback:** revert only the API client, its focused tests, and T1 documentation.
- **Route:** Delegated direct. Trigger evidence: multi-file API boundary, mocked tests, and synchronized backend/task documentation required reading that prepared the implementation.

### BK-028-T2 - Existing-member live checkout UI

- [x] Add a visible purchase/renewal action and checkout experience to the authenticated live reception member flow, using only backend member/plan/register/shift identifiers.
- [x] Show distinct pending-transfer, confirmed payment, membership activation, and unknown network outcome states; exact retry must reuse its idempotency key. A null period is explicitly not presented as activated.
- [x] Verify cash and transfer route selection, partial-cash warning behavior supported by the API, validation/error states, and that no DemoProvider operation runs for this flow.
- [x] Update the task ledger and phase card; state explicitly that new-member registration and Mercado Pago are separate follow-up work.
- **Authorized surfaces:** `frontend/src/features/reception/LiveMemberLookup.tsx`, `frontend/src/features/reception/LiveMemberLookup.test.tsx`, `frontend/src/features/reception/LiveMembershipCheckout.tsx`, `frontend/src/features/reception/LiveMembershipCheckout.test.tsx`, `odd/tasks/backend-implementation.md`, `docs/backend-plan/04-implementation-phases.md`, and this file.
- **Checks:** focused checkout/API tests and `git diff --check`.
- **Runtime harness:** component tests with mocked API calls; no live backend/payment request.
- **Rollback:** revert only the live checkout UI and T2 documentation; T1 API client may remain independently useful.
- **Route:** Delegated direct. Trigger evidence: reading that prepared a 4-file UI/test change across multiple non-trivial components, plus focused command verification. Implementation was confined to the listed T2 paths; no excluded demo/new-member screen was edited.

### BK-028-T3 - Authenticated member creation and generated identifier

- [x] Extend the authenticated frontend API boundary to create a member using the backend `POST /api/v1/members` contract.
- [x] Generate a stable unique member number for each registration intent; the caller retains it and the exact request body across uncertain retries. On 409, search by that exact number: an exact number/name/phone match reconciles success, a verified number with different name/phone is a definite collision, and absent/incomplete/failed lookup remains unknown.
- [x] Preserve backend field validation, duplicate-number response, and permission behavior; phone is not treated as unique.
- [x] Update backend plan/task documentation with the actual generated-number and retry contract.
- **Authorized surfaces:** `frontend/src/api/membershipCheckoutApi.ts`, `frontend/src/api/membershipCheckoutApi.test.ts`, `odd/tasks/backend-implementation.md`, `docs/backend-plan/04-implementation-phases.md`, and this file.
- **Checks:** focused API client tests with mocked responses; applicable member API tests only if the backend contract changes; scoped `git diff --check`.
- **Runtime harness:** Mocked API responses only; no live backend or payment calls.
- **Rollback:** revert only the member-create API addition and T3 documentation.
- **Route:** Delegated direct. Trigger evidence: API client, tests, and plan updates span multiple files; preparation requires reading backend DTO/auth/duplicate behavior.
- **T3 route evidence:** Implemented as the single authorized bounded T3 work unit on the existing feature branch; inspected `CreateMemberDTO` (32-character member number, required full name/phone, optional email), `POST /api/v1/members` (201; duplicate number returns 409), authenticated `GET /api/v1/members` search, and the unique member-number index. No backend or demo files changed.

### BK-028-T4 - New-member live registration and checkout handoff

- [x] Add a new-member form to authenticated live reception using backend-required full name and phone, optional email, and a system-generated member number; do not change demo registration.
- [x] On successful member creation, use the returned backend member UUID to open the existing live membership checkout; do not create a sale before a member exists.
- [x] Clearly preserve the partial outcome: member creation is a separate API transaction from sale. If checkout is cancelled or fails, show the created member number and allow lookup/checkout later; never imply the account was rolled back.
- [x] Cover validation, duplicate/retried creation, response uncertainty, cash/transfer handoff, and ensure no DemoProvider operation runs.
- [x] Update the task ledger and phase card. Mercado Pago remains explicitly last and is not implemented in T3/T4.
- **Authorized surfaces:** `frontend/src/features/reception/LiveMemberLookup.tsx`, `frontend/src/features/reception/LiveMemberLookup.test.tsx`, `frontend/src/features/reception/LiveMemberRegistration.tsx`, `frontend/src/features/reception/LiveMemberRegistration.test.tsx`, `odd/tasks/backend-implementation.md`, `docs/backend-plan/04-implementation-phases.md`, and this file.
- **Checks:** focused API and live registration/checkout tests; scoped `git diff --check`.
- **Runtime harness:** Component tests with mocked API calls; no live backend/payment request.
- **Rollback:** revert only the live new-member form/handoff and T4 documentation; T3 API client may remain independently useful.
- **Route:** Delegated direct. Trigger evidence: multi-component, API-integrated behavior with tests and docs.

## Acceptance criteria

- A selected member, membership plan version, register, and shift all come from the authenticated backend; no demo IDs cross the API boundary.
- New live registrations get a system-generated unique member number and backend UUID; a repeated/uncertain request does not create a second member.
- Member creation and sale are separate backend transactions. If sale does not complete, the member remains registered and the UI exposes a safe path to find and continue checkout.
- Cash and bank transfer use their distinct backend endpoints. Pending transfer is never shown as confirmed or settled; payment status and membership period are shown separately.
- Repeated submission or retry cannot create a second order: an exact retry uses the original idempotency key and request payload; a changed payload requires a new intent.
- Unknown network outcome is visible and retryable without blind creation. The screen does not report success until a server response is received.
- The standard demo UI remains unchanged; no offline support or Mercado Pago integration is claimed before the final sequence step.

## Progress

- Read-only mapping confirmed the backend routes and live authentication path; the normal demo checkout is not an API client. The existing-member scope was explicitly approved by the user.
- T1 supplies the authenticated plans/registers/shifts and sale API calls; T2 uses those in the live existing-member checkout.
- BK-028 T1/T2 existing-member checkout is complete. T3 member API boundary is ready: generated numbers use `M` plus 31 UUID hexadecimal characters, and 409 reconciliation requires exact member number, full name, and phone. T4 live registration UI remains open; Mercado Pago is reserved as the final sequence step.
- T1 proof: RED was observed before the client existed (Vitest could not resolve `./membershipCheckoutApi`); initial GREEN had 4 tests, then parent review found backend `membership` is nullable and correction `e5e1fa5` added a null pass-through case. Final focused suite: `npm test -- --run src/api/membershipCheckoutApi.test.ts` (5 passed). Scoped `git diff --check` passed for implementation commits. The whole-worktree check reports pre-existing whitespace in unrelated dirty files, including `frontend/src/features/reception/ReceptionHome.test.tsx:282`. The writer's `npm run typecheck` attempt reported an unrelated `offlineClock.test.ts` fixture missing `sameMonotonicOrigin`; not re-run in this task. No live backend/payment request was made.
- T1 work-unit commit: `183a79b` (`feat(frontend): agregar cliente de API para ventas de membresía`).
- T1 contract correction: `e5e1fa5` (`fix(frontend): admitir membresía nula en DTO de venta`).
- T2 RED/GREEN proof: RED `npm test -- --run src/features/reception/LiveMembershipCheckout.test.tsx` failed because the component did not yet exist. GREEN `npm test -- --run src/api/membershipCheckoutApi.test.ts src/features/reception/LiveMemberLookup.test.tsx src/features/reception/LiveMembershipCheckout.test.tsx` (3 files, 14 tests passed). Tests use mocked API calls; no live backend/payment request was made. `git diff --check` is scoped to the staged T2 paths. Full build/typecheck were not run by instruction.
- T2 outcome at that task boundary: existing-member live checkout acceptance is complete. No demo operation is wired into the live checkout. The user later authorized T3/T4 and requested Mercado Pago last.
- T2 work-unit commit: `34aa27a` (`feat(frontend): integrar venta de membresías en recepción operativa`).
- T3 RED: `npm test -- --run src/api/membershipCheckoutApi.test.ts` failed on the four new member API/generator cases because `createMember` and `createMemberNumber` were not implemented; five existing API tests passed. T3 GREEN: the same focused command passed (1 file, 9 tests). Mocked cases cover member number length, authenticated POST body, verified 409 reconciliation, and preserving 409 for identity mismatch.
- T3 work-unit commit: `580083e` (`feat(frontend): agregar alta de socios en API`).
- T4 live registration is implemented in authenticated reception. DemoProvider-backed screens remain untouched; Mercado Pago is explicitly the final integration step and was not implemented in T4.

### BK-028-T4 implementation proof

- **Route:** Delegated direct. Trigger evidence: live lookup integration, registration form, focused tests, and synchronized plan/task documentation span multiple non-trivial files; existing API/checkout behavior was read before implementation.
- **RED:** `npm test -- --run src/features/reception/LiveMemberRegistration.test.tsx` failed because `LiveMemberRegistration` did not exist.
- **GREEN:** `npm test -- --run src/api/membershipCheckoutApi.test.ts src/features/reception/LiveMemberLookup.test.tsx src/features/reception/LiveMemberRegistration.test.tsx` — 18 tests passed. Mocked API calls verify generated number/payload, backend UUID handoff, and stable retry payload after unknown create outcome; no live API/payment calls.
- **Whitespace:** `git diff --check` scoped to the seven T4 paths passed.
- **Behavior:** Unknown create outcome locks edits and prevents leaving the live registration flow until retry resolves the original request; successful creation remains visible if checkout closes and supports later lookup. Cash/transfer remain the existing checkout's distinct paths.
- **Exclusions:** No demo registration/provider, normal members pages, or Mercado Pago code changed. Mercado Pago remains the final integration step.
- **Work-unit commit:** `30518dc2b341d078d158e4afc8445fc90d35c2d3` (`feat(frontend): registrar socios en recepcion operativa`).

### BK-028-T3/T4 retry-safety correction

- **Finding:** A POST 409 followed by an absent, incomplete, or failed search cannot prove that the earlier create failed; clearing the UI intent could allow a second member number while the first profile already exists.
- **Correction:** Only an exact-number/name/phone match resolves success; only a verified same-number/different-identity row is a definite collision. All other reconciliation outcomes remain unknown, keep the original payload/number locked, and retry that same request. A new number is offered only after the UI receives the definite collision result and the operator explicitly selects recovery.
- **RED/GREEN:** RED was observed in three new API regressions (wrong prior 409 contract, empty search, and failed search). Final focused command `npm test -- --run src/api/membershipCheckoutApi.test.ts src/features/reception/LiveMemberLookup.test.tsx src/features/reception/LiveMemberRegistration.test.tsx` — 23 passed, including incomplete search response, parent flow lock, exact retry, and explicit collision recovery.
- **Scoped `git diff --check`:** pending.
- **Correction work-unit commit:** pending.

## Next step

Next: plan Mercado Pago as the final integration step; T3/T4 registration and checkout remain mocked-test verified and make no live provider calls.
