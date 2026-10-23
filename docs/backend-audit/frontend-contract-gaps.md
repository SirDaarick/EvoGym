# Frontend/backend contract gaps

**Historical 2026-10-22 R5 snapshot:** FE01/FE02 and compiler acceptance were fixed in observed R1/R1a commits; focused clean proofs passed. At clean R5, full API verification passed **335 tests/17 PG skips**, typecheck/build passed, but the full frontend suite recorded **2 failed/471 passed**. Earlier dirty 578-frontend/367-API passes are different-snapshot history, not clean R5 or current HEAD results. See the [R5 receipt](delivery-notes.md); original source-line annotations describe that audit snapshot.

**Current source delta (baseline `3996c62acfeac8c7f367032a61bf95f331ccf1b8`, tree `7d44e28bbbaf9ed0db54d732a3821f1a16604427`):** later commits add staff scheduling (`b8c973f`), finance visuals (`2dcecfc`), a plan editor (`e76be10`), reception operations (`9cc2767`), and member/staff operational screens (`53867b5`). These commits change the source/UI inventory, not the proof boundary: application checks at this source baseline are pending; a screen or demo flow alone does not establish live API integration. FE03–FE12 below remain scoped integration gaps unless stated otherwise. See the [post-audit reconciliation](post-audit-reconciliation.md).

## Clean-suite follow-ups, not implemented in this delivery

- **Owner keyboard focus, baseline-reproduced:** [Owner test](../../frontend/src/features/owner/Owner.test.tsx), line 51, expected `Desde` after 20 tabs and failed under the same filtered command at both clean R5 and baseline. Inspect actual keyboard/tab order and the static 20-tab assumption before choosing a correction; do not weaken accessibility assertions or assume the production focus order is wrong without evidence.
- **Members mount/loading timeout, cause unresolved:** [Members test](../../frontend/src/features/members/Members.test.tsx), line 10, timed out in the full clean run but passed in the R5/baseline filtered comparison. Reproduce under comparable load and inspect the ready boundary before changing timeouts or component behavior; load/timing is a hypothesis, not an established root cause.
- **Acceptance for either future fix:** retain the original failed full-run receipt, establish the relevant focused regression, then run affected focused checks and the complete suite without concealing earlier failures. No full retry was performed here because the Owner focused prerequisite remained failing; no UI fix or unrelated dirty frontend change was adopted.

| ID | Capability and current integration state | Priority / dependency |
|---|---|---|
| FE01 | Plan/register-list array contract and typed current version repaired in R1 | Focused tests/typecheck pass; full integration pending |
| FE02 | Client now matches current-shift `cash_register_id` in R1 | Matching/missing/mismatched shift tests pass |
| FE03 | Real session APIs coexist with demo role/PIN/device state | P1; explicit live/demo boundary |
| FE04 | Generic string errors and incomplete retry reconciliation | P1; B05/B06 |
| FE05 | Live member lookup exists; detail/history/entitlement read contracts incomplete | P2; authorized read DTOs/privacy |
| FE06 | Repayment, voucher review and pending-money backend exist; finance UI demo | P2; FE05 order/debt identifiers |
| FE07 | Shift API exists; opening/closing UI uses demo operations | P1; B01 + snapshot contract |
| FE08 | Online membership/sample check-in exists; live checkout assumes period | P2; FE05 + B05 |
| FE09 | Roster/attendance exist; weekly schedules/occurrences/exceptions are now in current backend. New staff UI exists; live binding is unverified. Occurrence-linked attendance and offline flow remain pending. | P2; STAFF-2/3 and current local verification |
| FE10 | Stock foundations exist; product POS/refunds and other domains incomplete | Backend-first; policy D-015 |
| FE11 | Immutable plan publication exists; owner catalog uses local plans | P2; H02 |
| FE12 | Local-first, provider, reporting, notifications and Gimi unfinished cross-stack | Phased; owner decisions |

## FE01 — Match actual array responses

**Remediation R1/R1a, 2026-10-22:** plan/register GET boundaries consume bare arrays and validate consumed identifiers/commercial values while preserving additive fields. Unpublished current versions remain null; zero-price/single-entry plans with null duration remain valid; historical versions are never substituted. The current-version DTO preserves a validated string ID; the clock fixture supplies `sameMonotonicOrigin: true`. Dirty regression RED was **24 failed/16 passed**, then **64 focused passes**. R1a separately removed two unsupported baseline finance-fixture properties without changing refund-ledger assertions; the committed R1 family then passed clean API 30, focused frontend 73 and typecheck. Clean R5 full frontend remains partial as recorded above; browser/server E2E and documentation commits remain pending.

Evidence: [client](../../frontend/src/api/membershipCheckoutApi.ts), lines 122–124/165–167, expects `{items}`; [catalog](../../api/app/api/catalog.py), lines 135–149, and [shifts](../../api/app/api/shifts.py), lines 171–195, return bare arrays. [Live checkout](../../frontend/src/features/reception/LiveMembershipCheckout.tsx), lines 68–73, then calls `.filter` on `undefined`. [Mocks](../../frontend/src/api/membershipCheckoutApi.test.ts), lines 71–79, match the wrong wrapper and conceal the mismatch.

1. Adopt the implemented array DTOs or explicitly version an agreed replacement; remove unvalidated casts and share real serialized fixtures with backend contract tests.
2. Test live nonempty/empty arrays and malformed bodies through the actual transport, not wrapper-only mocks.
3. Fix the `plan_version_id: unknown` compiler error at checkout line 124 using a validated typed DTO, not `as string`.

**Acceptance:** typecheck passes and actual-shape responses render/select a plan without crashing. Historical baseline: 24 focused passing tests coexisted with two compile errors, including missing `sameMonotonicOrigin` at `offlineClock.test.ts:40`; R1 supplies that fixture and resolves the typed plan-ID error with passing focused/typecheck evidence above.

## FE02 — Preserve current-shift register identity

**Remediation R1, 2026-10-22:** response DTO and checkout comparison now use `cash_register_id`; request query parameter `register_id` remains unchanged. A matching current shift enables checkout, while an unrelated/missing shift leaves both sale buttons disabled. No shift `branch_id` is invented; existing server authority remains necessary. Covered in the same 64-test focused run; full browser/server integration is not claimed.

Evidence: [client DTO](../../frontend/src/api/membershipCheckoutApi.ts), lines 21–24, and [lookup](../../frontend/src/features/reception/LiveMembershipCheckout.tsx), lines 83–84, use `register_id`; [server schema](../../api/app/shifts/schemas.py), line 85, and [projection](../../api/app/shifts/queries.py), lines 415–418, use `cash_register_id`.

1. Align the DTO and lookup to `cash_register_id`; retain branch/register matching rather than enabling checkout for any open shift.
2. Add contract fixtures from real shift serialization and tests for matching register, mismatched register/branch and no current shift.

**Acceptance:** a genuine current shift enables only its authorized register, and an unrelated shift remains rejected.

## FE03 — Make demo and authenticated operational modes explicit

Evidence: [App](../../frontend/src/app/App.tsx), lines 142/248, derives demo role from URL and exposes `/reception/live`; [reception transport](../../frontend/src/api/receptionApi.ts), lines 57–64, uses a real bearer. Untracked Login (`frontend/src/features/auth/Login.tsx`; untracked dirty-snapshot evidence), lines 98–142, uses local PIN/default `1234`; device store (`frontend/src/features/staff/devicePairingStore.ts`; untracked dirty-snapshot evidence), lines 122–141, creates local random pairing codes. These are **not demonstrated backend authorization bypasses**.

1. Introduce an explicit demo/live mode boundary and server-derived principal/session state; never infer backend authority from URL/local role.
2. Connect implemented [admin authentication](../../api/app/api/admin_auth.py) lines 76/94/113/124, [sessions](../../api/app/api/admin_sessions.py) lines 28/41, [enrollment](../../api/app/api/admin_enrollment.py) lines 36/68/95, [device pairing](../../api/app/api/device_pairing.py) lines 62/90/115/132, and staff PIN issuance through typed transports.
3. Keep roster identities distinct from credentialed accounts. Add session expiry/revocation, direct-URL access, branch restrictions and cross-browser real-pairing tests.

**Acceptance:** operational data requires server authority even on direct navigation; demo credentials/codes never enter live flows. Existing backend auth branches still require deeper security testing.

## FE04 — Use typed errors and reconcile uncertain writes

Evidence: [reception transport](../../frontend/src/api/receptionApi.ts), line 53, and [checkout errors](../../frontend/src/api/membershipCheckoutApi.ts), lines 108–117, expose strings; [checkout retry](../../frontend/src/features/reception/LiveMembershipCheckout.tsx), lines 103–109, preserves intent identity only for network errors. B05 now preserves explicitly wired period/sample denial codes/metadata, but this typed frontend integration remains missing; other domain/idempotency mappings are still generic.

1. After B05/B06, carry status, stable domain code and request ID through one typed transport; define safe 401 recovery without logging PII/tokens.
2. Preserve the same idempotent intent until a write's unknown outcome is reconciled; changing payment method/retrying must not manufacture a second charge.
3. Test 401/403/409/422/429, network loss before/after acceptance, retry/reconciliation and safe diagnostics.

**Acceptance:** actionable recovery messages and exactly-once logical payment outcomes, without parsing arbitrary server text.

## FE05 — Add missing member read contracts before wiring rich details

Evidence: live lookup currently covers search/balance/register/sale. [Member routes](../../api/app/api/members.py), lines 234/259/281/304/330/349/379, support editing, notes and eligibility; [access restrictions](../../api/app/api/membership_access.py), lines 24–58, exist. [Member summary](../../api/app/members/schemas.py), lines 29–36, lacks period/order/sample IDs; [sale response](../../api/app/sales/schemas.py), lines 45–104, only provides sale-time identifiers, not reload history.

1. Design **proposed, not existing** authorized member-level reads for periods, entitlements, order/debt identifiers and permitted history; apply role-specific field projections and D-020 retention/privacy.
2. Then integrate member edits, notes, eligibility evidence and access-restriction actions using server IDs, not inferred/demo IDs.
3. Test hard reload preserves selectable identifiers, reception/admin visibility differences, cross-branch denial and append-only history.

**Acceptance:** refresh/re-entry works without relying on a previous sale response or exposing administrative finance data to reception.

## FE06 — Connect debt receipts, transfer review and pending money

Evidence: [sale routes](../../api/app/api/sales.py), lines 172/310, expose repayment and voucher review; [pending money](../../api/app/api/pending_money.py), lines 108–114, is implemented. Live lookup shows aggregate balance; [owner balance screen](../../frontend/src/features/owner/finance/BalanceView.tsx), lines 3–5/55–56, remains demo-driven.

1. Complete FE05 itemized debt/order reads, then wire explicit order-specific cash repayments, authorized voucher review and the Admin pending-money list.
2. Show cash received, unpaid amounts and voucher provenance separately; never count pending money as received revenue.
3. Test partial/multiple collection, identical retry, overpayment rejection, Admin permissions, review/access effects and disappearance when fully settled.

**Acceptance:** server receipts drive balances exactly once; UI cannot allocate aggregate debt by guesswork.

## FE07 — Replace demo shift transitions with server evidence

Evidence: [Shifts](../../frontend/src/features/shifts/Shifts.tsx), lines 23–39, and [App](../../frontend/src/app/App.tsx), lines 388–395, use demo state; [shift routes](../../api/app/api/shifts.py), lines 247/273/324/366/388/417, exist. [Opening queries](../../api/app/shifts/queries.py), lines 219–260, require inventory snapshot/review, not cash alone.

1. Read register/current-shift and immutable inventory snapshot; send denomination counts plus authorized physical observations/review on opening.
2. Wire server close computation and frozen replay, explicitly handling stale snapshots and overtime handoff.
3. Test missing versus explicit zero/empty state, stale snapshot rejection, repeated identical/changed close, and transfers excluded from cash.

**Acceptance:** opening/closing survives reload and matches backend cash evidence without a local fallback pretending acceptance.

## FE08 — Separate membership-period and sample entitlement access

Evidence: [online check-ins](../../api/app/api/member_check_ins.py), lines 106/205, exist; [sale DTO](../../api/app/sales/schemas.py), lines 99–104, exposes `sample_entitlement`. [Live checkout](../../frontend/src/features/reception/LiveMembershipCheckout.tsx), lines 138–142, treats null membership as generic missing period and ignores sample entitlement.

1. Add FE05 reload reads, then branch explicitly between period and sample flows with typed warnings/denials from B05.
2. Retain idempotency and online duplicate-visit behavior; do not infer full offline access support from the local clock helper.
3. Test sample consumption once, identical replay, subsequent use denied, expired period, and sample success without a membership period.

**Acceptance:** valid sample sales are not rendered as missing-membership errors and cannot be consumed twice.

## FE09 — Integrate roster/attendance without assuming schedule completion

Evidence at current HEAD: branch-scoped [roster](../../api/app/api/staff_roster.py), [attendance](../../api/app/api/staff_attendance.py), and weekly [schedule](../../api/app/api/staff_schedules.py) APIs are committed. The committed [staff attendance view](../../frontend/src/features/reception/StaffAttendanceView.tsx) reads `useDemo()` state and records through demo operations; it is not a live schedule/attendance adapter. STAFF-1 schedule series/occurrences/exceptions are implemented; the same branch roster profile is the overlap scope, and different-branch profiles remain independent. PostgreSQL proof, STAFF-2 occurrence-linked attendance, and STAFF-3 offline flow remain pending. Current HEAD tests have not run yet; the detailed R5 suite counts below this section remain historical.

1. Map roster IDs separately from login accounts; wire server timestamps/timezones and append-only checkout evidence.
2. Preserve nullable classification rather than inventing absence; stabilize STAFF-1 before adding occurrence-aware attendance, then queue/offline semantics.
3. Test duplicate check-in/out, timezone boundaries, authorization, historical immutability and schedule exceptions.

**Acceptance:** server attendance, not mutable demo state, is authoritative; unsupported schedule/offline behavior remains explicit.

## FE10 — Complete backend transactional domains before demo POS integration

Evidence: Sales/Inventory screens and untracked returns modal (`frontend/src/features/reception/DevolucionesModal.tsx`; untracked dirty-snapshot evidence), lines 128–135, use demo data. Stock initialization/catalog foundations exist, but product POS, movement ledger, supplement conversion, expenses, extras, rentals and refunds remain backend-first work in [phase plan](../backend-plan/04-implementation-phases.md), lines 117–134.

1. Resolve applicable D-015 policies, then implement transactional sale/payment/stock movement and explicit refund quantity/money/disposition invariants.
2. Add versioned DTOs/endpoints and rollback/concurrency tests before connecting each UI flow; integrate domains incrementally, not by replacing demo persistence wholesale.
3. Test stock/payment atomic rollback, duplicate retries, conversion precision, refund bounds and inventory disposition independent of money reversal.

**Acceptance:** UI shows server-accepted stock/financial results; unsupported flows stay visibly unavailable in live mode.

## FE11 — Publish plans through immutable backend versions

Evidence: [owner catalog](../../frontend/src/features/owner/PlanCatalog.tsx), lines 19–26/434, edits local plans; [publication endpoint](../../api/app/api/catalog.py), lines 200–228, creates immutable versions.

1. Read/publish through typed API adapters with authorized branch/catalog scope and history; never mutate a sold plan version.
2. Implement the H02 conflict contract and refresh behavior; test prior sales keep original prices/terms after publication and unauthorized changes fail.

**Acceptance:** subsequent sales select the new version while historical snapshots remain unchanged.

## FE12 — Finish local-first and later service domains jointly

Evidence: [phase plan](../backend-plan/04-implementation-phases.md), lines 113–115/155–161, and [local-first design](../backend-plan/08-local-first-and-sync.md) describe unfinished cross-stack capabilities. Local clock/testing primitives are not the complete offline system.

1. Follow BK-062–BK-074 in dependency order: durable local queue/bootstrap, ingestion/receipts/deltas, grants, retries/conflicts and fault tests; obtain D-028/D-030 decisions.
2. Keep local pending distinct from server accepted. Revalidate grants/entitlements at ingestion; test reconnect, stale authorization, duplicate delivery, conflict and browser/device loss before offline finance.
3. Then integrate provider payments, notifications, reports and Gimi against completed backend contracts and sandbox proof; see [roadmap](roadmap.md).

**Acceptance:** every queued operation has a visible, durable acceptance/rejection/reconciliation state; no unsupported zero-loss or instant offline-revocation promise.
