# BK-028 - Existing-member membership purchase through the live API

Connect one complete existing-member membership purchase flow to the authenticated backend, beginning in the live reception path. Keep demo-backed screens and new-member registration separate until their own slices are ready.

## Problem and outcome

The standard frontend checkout reads and writes demo state, while the backend already exposes authenticated member, plan, register/shift, and membership-sale APIs. This slice uses backend UUIDs and server payment/entitlement outcomes end to end for an existing member; it must not mix demo records with API records.

## Scope and constraints

- **Included:** live operational member selection; active published membership plan and open register/shift data; cash and bank-transfer membership sale; API-owned idempotency; distinct payment and membership status presentation; unknown-result retry using the same idempotency key.
- **Excluded:** new-member signup, DemoProvider-backed pages, external Mercado Pago/card payments, offline queue/sync, and changing backend business rules.
- Transfer sales must use the transfer endpoint and remain pending review until an authorized Admin decision. Cash and transfer outcomes must not be conflated.
- Use the authenticated `/reception/live` path and its configured branch/session. Never substitute demo IDs for backend UUIDs.
- Preserve all pre-existing dirty frontend files. Do not edit `MemberDetail`, `Members`, `NewMemberRegistration`, `ReceptionHome`, `CurrentPurchaseCard`, `DemoProvider`, or demo operations in this feature.
- Delivery strategy: `single-pr` on the existing `codex/backend-foundation` branch, matching the user's existing-branch preference. Commits remain task-sized; no push or PR creation is authorized.
- Forecast: approximately 520 authored changed lines across API client/tests, live checkout UI/tests, and task/plan docs; generated files excluded. Work-unit commits remain separate and reviewable.

## Tasks

### BK-028-T1 - Authenticated checkout API boundary

- [x] Add and test typed API calls for active published membership plans, registers/open shifts, and cash/transfer membership sales using the existing operational token/config.
- [x] Preserve the caller-provided `Idempotency-Key` exactly and distinguish HTTP failures from unknown network outcomes; the UI must retain the same key and payload for retry.
- [x] Update the task ledger and phase card to record the API boundary as partial progress without claiming UI integration.
- **Authorized surfaces:** `frontend/src/api/membershipCheckoutApi.ts`, `frontend/src/api/membershipCheckoutApi.test.ts`, `odd/tasks/backend-implementation.md`, `docs/backend-plan/04-implementation-phases.md`, and this file.
- **Checks:** `npm test -- --run src/api/membershipCheckoutApi.test.ts` from `frontend`; `git diff --check`.
- **Runtime harness:** Mocked `fetch` tests cover auth, lookups, distinct sale routes, exact idempotency header, server DTO passthrough, HTTP errors, and network uncertainty; no live backend credentials or network calls.
- **Rollback:** revert only the API client, its focused tests, and T1 documentation.

### BK-028-T2 - Existing-member live checkout UI

- [ ] Add a visible purchase/renewal action and checkout experience to the authenticated live reception member flow, using only backend member/plan/register/shift identifiers.
- [ ] Show distinct pending-transfer, confirmed payment, membership activation, and unknown network outcome states; exact retry must reuse its idempotency key.
- [ ] Verify cash and transfer route selection, partial-cash warning behavior supported by the API, validation/error states, and that no DemoProvider operation runs for this flow.
- [ ] Update the task ledger and phase card; state explicitly that new-member registration and Mercado Pago are separate follow-up work.
- **Authorized surfaces:** `frontend/src/features/reception/LiveMemberLookup.tsx`, `frontend/src/features/reception/LiveMemberLookup.test.tsx`, `frontend/src/features/reception/LiveMembershipCheckout.tsx`, `frontend/src/features/reception/LiveMembershipCheckout.test.tsx`, `odd/tasks/backend-implementation.md`, `docs/backend-plan/04-implementation-phases.md`, and this file.
- **Checks:** focused checkout/API tests and `git diff --check`.
- **Runtime harness:** component tests with mocked API calls; no live backend/payment request.
- **Rollback:** revert only the live checkout UI and T2 documentation; T1 API client may remain independently useful.

## Acceptance criteria

- A selected member, membership plan version, register, and shift all come from the authenticated backend; no demo IDs cross the API boundary.
- Cash and bank transfer use their distinct backend endpoints. Pending transfer is never shown as confirmed or settled; payment status and membership period are shown separately.
- Repeated submission or retry cannot create a second order: an exact retry uses the original idempotency key and request payload; a changed payload requires a new intent.
- Unknown network outcome is visible and retryable without blind creation. The screen does not report success until a server response is received.
- The standard demo UI and new-member signup remain unchanged; no offline or Mercado Pago support is claimed.

## Progress

- Read-only mapping confirmed the backend routes and live authentication path; the normal demo checkout is not an API client. The existing-member scope was explicitly approved by the user.
- The live path already supports authenticated member search. Frontend checkout still needs backend plan-version and open register/shift reads plus sale API calls.
- BK-028 is Partial after T1: the authenticated API boundary is implemented and tested, but no checkout UI is integrated; BK-028-T2 remains open.
- T1 proof: RED was observed before the client existed (Vitest could not resolve `./membershipCheckoutApi`); GREEN is `npm test -- --run src/api/membershipCheckoutApi.test.ts` (4 tests passed). `git diff --check` passed. No live backend/payment request was made.
- T1 work-unit commit: `183a79b` (`feat(frontend): agregar cliente de API para ventas de membresía`).
- New-member registration, DemoProvider-backed screens, and Mercado Pago remain explicitly deferred.

## Next step

Implement BK-028-T2: integrate the live reception checkout UI and its tests without changing the deferred demo/new-member/Mercado Pago flows.
