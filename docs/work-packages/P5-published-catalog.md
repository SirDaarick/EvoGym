# P5 — Published catalog and member purchase UI

**Primary owner:** unfinished BK-019 catalog/member UI integration residual.
**Contributors:** P2 owns member/profile read contract; P3 owns purchase/order semantics and payment; P1 owns protected transport. Contributors retain their rows and APIs.
**Suggested assignee:** Full-stack React/TypeScript engineer able to consume versioned API contracts; backend catalog changes require a separate named API owner, and purchase/payment work stays with P3.
**State:** Planning only; current source baseline `3996c62acfeac8c7f367032a61bf95f331ccf1b8`. A frontend editor or checkout screen is not proof of a live catalog/API adapter.

## Objective and readiness

Connect approved, published catalog versions to a purchase workflow without letting a draft, mutable UI object or later edit rewrite the terms already sold. Separate presentation from catalog truth: the UI displays current published state and snapshots the selected immutable version into a P3 order. P5 coordinates the member-facing flow but does not absorb P2/P3 files or policies.

| Subdelivery | Readiness | Gate |
|---|---|---|
| Existing catalog API/FE demo comparison | Local-ready, read-only | Synthetic source; state explicitly which paths are demo-backed |
| Published-version read DTO and editor workflow | Contract-ready | Catalog publication/version invariant and P1 transport |
| Purchase screen integration | Contract-blocked | P2 member read identity plus P3 order/price snapshot contract |
| H02 suspected catalog drift | Hypothesis only | H02 is unproven, not an accepted bug or implementation instruction |
| H03 member status | Decision-sensitive | Policy question is not resolved by adding a UI condition |
| Real provider, PG or release | Permission-blocked | Separate permission/target; not needed for local design |

## Scope and invariants

**In:** BK-019 published catalog/member purchase UI residual; one approved editor and/or reception purchase path, only where existing FE contract gaps support it. Define draft/publish/version semantics and consumer-facing contract; coordinate with P2/P3 for profile, plan, snapshot and result projections.

**Out:** BK-019 does not own all of P2/P3; no edits to their member-read/auth/payment logic without separate handoff. No new pricing, expiry, eligibility, refund or debt policy; no unproven H02 repair; no H03 decision by UI; no product stock/POS (P8), external provider (P9) or offline cache (P7).

| Invariant | Acceptance meaning |
|---|---|
| Draft vs published | A draft is not purchasable. Publication creates a stable version/revision; UI clearly distinguishes it from draft state. |
| Immutable purchase terms | Order captures plan/version, name/description, amount, duration and applicable conditions actually offered; future edit/unpublish does not mutate prior order. |
| Server revalidation | Checkout submits IDs and allowed choices; server rechecks active published version, member, branch, price and permissions. Client display is not authority. |
| P2 read boundary | Stable member/profile/entitlement IDs arrive through P2 projection; P5 does not create duplicate reader DTO ownership. |
| P3 write boundary | Order/payment/access outcome and idempotency use P3 contract; UI never claims success until server acceptance is known. |
| Evidence classification | Only sensitive fields actually returned/read are subject to D-020 review; do not blanket-block minimal profile/purchase fields or expose sensitive data by default. |

## Existing seams and proposed paths

Existing API path: `api/app/api/catalog.py`; API test `api/tests/test_catalog.py`. Existing FE demo/source paths include `frontend/src/demo/plans.ts`, `frontend/src/features/owner/PlanEditor.tsx` and `PlanEditor.test.tsx`, `frontend/src/features/reception/LiveMembershipCheckout.tsx` and its test, `frontend/src/api/membershipCheckoutApi.ts`, and `frontend/src/app/App.tsx`. Current FE may show editor/checkout flows, but each must be classified live-vs-demo before integration claims.

**PROPOSED conditional paths:** `frontend/src/api/publishedCatalogApi.ts` plus its exact test only if current transport cannot represent the accepted DTO; `api/app/catalog/read_schemas.py` or a dedicated publication module only if an accepted server contract needs it. Choose one boundary, avoid duplicate abstractions, and do not create files merely because named here. API router registration in `api/app/main.py`, FE page/route registration in `frontend/src/app/App.tsx`, model registry, migration chain, lockfiles and ledger require a named serial integrator. Do not grant broad source globs.

## Subdelivery sequence

| ID | Deliverable | Depends on | Limit and owner boundary |
|---|---|---|---|
| P5.1 | Existing live/demo catalog inventory | None; read-only | List available API payload, current PlanEditor data source, version fields and checkout calls. Do not call H02 a defect. |
| P5.2 | Published version contract | P1 principal/transport; existing API inventory | Define lifecycle, version fields and publish validation without inventing business price/expiry policy. |
| P5.3 | Member purchase-screen contract | P2 shared-profile/read DTO; P3 order/snapshot/idempotency contract | Agree stable IDs, errors, pending/unknown outcomes, role projection; P5 owns presentation only. |
| P5.4 | One frontend adapter/view slice | P5.2/P5.3 accepted; exact frontend paths reserved | One screen/test pair; no edits to shared `App.tsx` unless integrator-owned. |
| P5.5 | End-to-end synthetic proof handoff | API and FE candidate available | Verify published version displayed and selected version captured by P3; do not use live member/payment data. |

Catalog/editor work can start independently as contract/inventory. Purchase integration waits only on P2/P3 contracts needed by that screen, not full completion of their packages. P5 must send any API/schema change proposal to the named integrator.

## Acceptance and failure matrix

- [ ] A draft, inactive, or superseded version cannot be selected for a new purchase unless an approved rule explicitly allows it.
- [ ] Selected published version and displayed price/terms agree with server response; stale version produces a safe reload/conflict.
- [ ] Existing order snapshot remains unchanged after version edit, unpublish, or price update.
- [ ] No business rule is inferred from H02; evidence and decision owner are named before any repair.
- [ ] H03 remains a decision question; no UI interpretation silently adds a membership-status rule.
- [ ] P2 controls which member fields are visible and returns stable identity after reload; P5 does not read private fields from local/demo state as server truth.
- [ ] P3 owns order, payment, access and idempotency; duplicate submit does not produce two purchase effects.
- [ ] Unknown network outcome is shown as unknown/reload-required, not success or safe-to-resubmit with a new key.
- [ ] Synthetic tests distinguish draft, published, changed, inactive and stale-version cases; no real payment data.

| Fault | Expected result |
|---|---|
| Catalog version changed between list and purchase | Server rejects stale version or returns explicit accepted snapshot; no silent price substitution. |
| Draft ID supplied | Reject; never sell a draft. |
| UI refreshed after successful sale | P2/P3 stable response IDs recover purchase state; no dependence on transient component state. |
| Timeout after server may have accepted | Preserve original idempotency intent and expose unknown state; P3 resolves safely. |
| Editor save/publish conflicts | Show version conflict and require explicit reload/reconciliation; do not overwrite another revision. |

## Verification plan — commands are planned, not run

From `api`:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_catalog.py

From `frontend`:

    npm.cmd test -- --run src/features/owner/PlanEditor.test.tsx src/features/reception/LiveMembershipCheckout.test.tsx --maxWorkers=2
    npm.cmd run typecheck

The named test files exist at the baseline; add a new test only on a separately authorized exact path if required. Run the full suites when API, shared transport or global FE routing changes. Current test receipts are historical. All fixtures must be synthetic, and no ambient database/provider/network fallback is allowed. Browser E2E, provider sandbox, hosted CI, PG and production release remain pending separate authorization.

## Effort, rollback and handoff

Effort: **M** for an accepted published-version DTO and one consumer; **L** if publication/version migration, multi-screen integration or policy changes are proposed. Rollback only the exact additive adapter/view. Never rewrite published purchase snapshots, orders or payments; never delete a previously published version to hide a conflict.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P5.1 | No runtime writes; live/demo inventory only | `docs/work-packages/contracts/P5.1-live-demo-inventory.md` (PROPOSED) | Read-only inventory; H02 remains hypothesis. |
| P5.2 | No runtime writes; contract draft only | `docs/work-packages/contracts/P5.2-published-version.md` (PROPOSED) | No business price/expiry defaults. |
| P5.3 | No runtime writes; contract draft only | `docs/work-packages/contracts/P5.3-purchase-screen.md` (PROPOSED) | Depends on P2/P3 contract signatures; presentation only. |
| P5.4 | `frontend/src/features/owner/PlanEditor.tsx`; `frontend/src/features/owner/PlanEditor.test.tsx`; `frontend/src/features/reception/LiveMembershipCheckout.tsx`; `frontend/src/features/reception/LiveMembershipCheckout.test.tsx` | `frontend/src/api/publishedCatalogApi.ts`; `frontend/src/api/publishedCatalogApi.test.ts` (PROPOSED only if needed) | Do not edit `App.tsx`; avoid P3 checkout file concurrency. |
| P5.5 | No runtime writes; proof report only | No additional paths | P11 verification; synthetic-only and separate runtime evidence. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Copy-paste assignment brief**

> Take only **P5 subtask [P5.x: exact output]**, not P2 or P3. P5 owns BK-019 only. Allowed edits: [verbatim candidate paths from the selected subdelivery row above]. First classify which existing catalog/editor/checkout data is live vs demo. Read this card, FE gaps, D-001/D-012 and any relevant catalog rules. Preserve immutable published terms. P2 owns member read/profile fields; P3 owns order/payment/access and idempotency; P1 owns authority/transport. H02 is a hypothesis, not a bug finding; H03 remains policy-gated. Use synthetic fixtures only. Stop at missing product policy, unassigned shared registration/migration file, or changed source contract. Return exact subtask, paths, tests/results, demo/live boundary, unresolved gates, integration handoff and rollback.

Evidence: [catalog contract gaps](../backend-audit/frontend-contract-gaps.md); [current catalog API test](../../api/tests/test_catalog.py); [P2 member reads](P2-member-read-contracts.md); [P3 transaction owner](P3-membership-payments-and-access.md); [business decisions](../backend-plan/02-business-rules-and-decisions.md).
