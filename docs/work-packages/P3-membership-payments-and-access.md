# P3 — Membership, payments, and member access

**Primary owner:** unfinished BK-023–030 only; preserve existing partial work.
**Contributors:** P1 principal/transport; P2 stable reload IDs and member-read contract; P5 published catalog and purchase-screen contribution; P7 future queue/replay integration; P9 external provider adapters. Contributors do not take ledger ownership.
**Suggested assignee:** Backend engineer experienced with transactional APIs, SQLAlchemy, idempotent writes and synthetic integration tests; bring in a frontend reviewer only for a specifically delegated P2/P5 consumer slice.
**State:** Planning only. Source evidence is at baseline `3996c62acfeac8c7f367032a61bf95f331ccf1b8`; no new P3 runtime proof. No implementation is authorized by this card.

## Objective and readiness

Complete bounded, server-authoritative member transactions and access flows while keeping an immutable financial event trail. A completed write must return stable identifiers that survive reload through P2. Cash/transfer collection and internal payment state stay distinct from external provider authorization/settlement owned by P9. A warning about debt is not an automatic denial rule.

| Subdelivery | Readiness | Required gate |
|---|---|---|
| Existing order/payment flow and idempotency inventory | Local-ready, read-only | Synthetic fixtures; record what exists before extending |
| Internal cash/transfer membership sale residuals | Contract-ready | P1 actor/branch and P5 immutable published-plan snapshot |
| Cross-channel replay/collision | Decision-sensitive | D-023 is unresolved; do not assume shared or independent idempotency keys across channels |
| Debt warning/payment/reconciliation rules | Decision-sensitive | Do not infer denial, automatic repayment, or collection ordering |
| Membership period/access decisions | Contract-blocked | Stable period identifiers from P2; approved access decision rules |
| Member check-in and sample eligibility | Local-ready after policy review | P2 stable member/entitlement IDs; no cross-branch dedup |
| External gateway/callback/refund | P9-owned | Explicit provider and permission gate; never fold into P3 |
| Offline transaction queue | P7-owned | P3 supplies event/idempotency requirements only |

## Boundaries and data contract

**In:** BK-023–030 residuals: internal order/payment, debt/repayment, membership periods/access, check-in and sample use. Preserve stable member/order/payment/period/visit/sample IDs, idempotency, snapshot prices/terms, actor/branch scope, timestamps, audit history and safe replay results. Work one end-to-end subdelivery at a time.

**Out:** provider SDKs/webhooks/settlement (P9); catalog publishing/revisions (P5); offline queue, bootstrap or grants (P7); P2 read projection ownership; staff attendance BK-031/040 (P6); bulk migration or policy invention.

| Invariant | Acceptance meaning |
|---|---|
| Server is authoritative | Every command rechecks actor, role, branch, current state and allowed transition; hidden UI does not authorize. |
| Idempotent financial write | Same key and same semantic payload returns the original order/payment/result; changed payload with same key is a safe conflict, not a second charge. |
| Immutable purchase terms | Store the exact published plan/version/price snapshot on the order; later catalog edits never rewrite an existing purchase. |
| Payment state | Pending, under-review, received, failed, refunded and other states use documented contract values; “warning” does not mean denial or revenue. |
| Append-only evidence | Corrections/voids/refunds add linked events and actors/times; do not rewrite or delete settled history. |
| Access decision | Period/access state is tied to an identified period and reason; the policy for expiry, late/partial payment, refund and repayment remains gated where D-024 is unresolved. |
| Check-in/sample | Member and branch IDs are server-resolved. Sample use is once per eligible entitlement, denied attempts do not consume it, and result IDs reload through P2. |

## Existing seams and proposed paths

Existing API paths: `api/app/api/sales.py`, `api/app/api/membership_access.py`, `api/app/api/member_check_ins.py`, `api/app/sales/`, `api/app/members/`, `api/app/db/models/`. Existing API tests: `api/tests/test_sales.py`, `test_membership_access.py`, `test_member_check_ins.py`, `test_membership_entitlements.py`. FE/API seams: `frontend/src/api/membershipCheckoutApi.ts`, `frontend/src/features/reception/LiveMembershipCheckout.tsx` and its test, member views listed in P2, and catalog owner UI listed in P5.

**PROPOSED only if an accepted subtask requires it:** a narrow module such as `api/app/sales/payment_commands.py`, `api/app/sales/access_commands.py`, or `api/app/api/member_transactions.py`; choose at most one boundary from the approved contract. Never create them just to match this example. Existing `api/app/api/sales.py`, member routes, model registry, `api/app/main.py`, migration chain, frontend route registry, lockfiles and BK ledger require named serialized owners. No `api/app/**` or `frontend/src/**` blanket surface is allowed.

## Subdelivery sequence

| ID | Deliverable | Depends on | Narrow ownership and stop condition |
|---|---|---|---|
| P3.1 | Read-only current-flow inventory | None; existing source/ledger | List current partial outcomes, IDs, transaction boundaries and tests. Supply member-domain evidence to P6.7's BK-029/BK-031 dependency reconciliation; stop if ledger/task evidence conflicts. |
| P3.2 | Purchase/order contract | P1 actor scope; P5 immutable published-plan snapshot | Specify request, response, state transitions and idempotency before code. Stop on unresolved price/expiry/payment policy. |
| P3.3 | Internal cash/transfer sale residual | P3.2 accepted; P5 contract; exact route/file reservation | One sale flow, synthetic tests and P2 reload projection handoff. No external gateway. |
| P3.4 | Debt/repayment residual | P3.1 and explicit D-024 rules for each disputed consequence | Warnings are not denial. Stop before changing automatic eligibility or collection semantics without a decision. |
| P3.5 | Period/access decisions | P3.2 stable order/period linkage; P2 ID projection; P1 scope | Add only approved state transitions; preserve append-only decision events. |
| P3.6 | Member check-in/sample | P1 branch authority; P2 member/entitlement IDs; P3 entitlement state | Enforce one-use, denied-does-not-consume and idempotent replay; no global member dedupe. |
| P3.7 | P2/P5/P7/P9 and P6.7 integration evidence | Accepted individual API contract(s), including C-16 only for final BK-029/BK-031 integration closure | Provide projections/event requirements and record the accepted C-16 boundary or unresolved policy gap. This join does not block independent P3 online access implementation. Do not edit other packages' queue, catalog, provider or shared registration files concurrently. |

P3.3 may proceed before P3.4; sample/check-in need only their entitlement and P2 identifier contracts, not all debt work. Provider online/offline settlement is specifically P9/P7, not a late P3 subtask. BK-029's ledger relationship to BK-031 is resolved only by the bounded, read-only P6.7/P3.7 C-16 handoff; it does not imply staff attendance is required for member entry or block independent online slices. A dependency on a contract does not require waiting for its entire owning package.

## Acceptance and fault matrix

- [ ] Same idempotency key and equivalent body returns the same order/payment/period IDs; same key with changed member, amount or plan returns conflict without a second financial event.
- [ ] A concurrent duplicate has one durable financial effect; no assumption based only on in-process locking.
- [ ] The stored order snapshot remains unchanged after plan revision or deactivation.
- [ ] Member/order/branch mismatch and unauthorized staff action are rejected server-side without leaking protected details.
- [ ] Debt warning is shown as warning only unless an approved explicit rule says otherwise; no implied payment denial.
- [ ] Pending or under-review transfer is not counted as received cash/revenue and does not create an access decision unless policy explicitly permits it.
- [ ] Access change names a period, reason, actor and time; replay and correction retain original evidence.
- [ ] Sample entitlement can be consumed only once; denied/ineligible requests leave it unconsumed; a retry returns original result.
- [ ] Check-in outcome survives a hard reload with stable member, visit/check-in, entitlement and branch IDs projected by P2.
- [ ] Corrections, cancellation, refund and repayment are append-only and obey approved D-024 decisions; unresolved cases stay pending.
- [ ] Every fixture is generated synthetic data; no real member or payment records.

| Fault/injection | Expected behavior |
|---|---|
| Response lost after committed sale | Retry with same idempotency key returns original receipt, not a second order. |
| Same key with altered amount | Conflict, no extra payment/order. |
| Catalog plan changes after purchase | Existing order retains recorded plan/version/price snapshot. |
| Transfer remains pending/under review | Not silently treated as settled revenue or eligibility. |
| Sample already consumed | Deny without creating another entitlement event. |
| Denied sample attempt retried | Same safe denial semantics; entitlement remains available if denial is not a consumption event. |
| Member shared across branches | Shared profile visibility follows D-001/D-012; branch transaction/access remains server-authorized and isolated. |
| Provider callback, timeout or unknown settlement | Handoff to P9; do not invent provider state or issue blind retry. |

## Verification plan — commands are planned, not run

From `api` (all listed test files exist at the source baseline):

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_sales.py tests/test_membership_access.py tests/test_member_check_ins.py tests/test_membership_entitlements.py

From `frontend` for the existing checkout/member consumers:

    npm.cmd test -- --run src/features/reception/LiveMembershipCheckout.test.tsx src/features/members/MemberDetail.test.tsx src/features/members/Members.test.tsx --maxWorkers=2
    npm.cmd run typecheck

Run focused tests first, then the full API/FE suites after shared contracts or routes change. The current 367-pass API and 578-pass FE receipts are historical source-baseline context, not proof of a new P3 candidate. PostgreSQL concurrency, provider sandbox, browser E2E, hosted CI and production evidence remain separately gated. Never let a test fall back to ambient DB credentials; use a fresh temp-contained SQLite database and synthetic records for local API proof.

## Effort, rollback and handoff

Effort: **M** for one existing transaction residual with stable IDs; **L** for multiple access/payment state transitions or schema changes. Re-estimate each subdelivery after contract review. Rollback only the exact new additive behavior/files or an approved forward migration. Never delete orders, payments, periods, check-ins, samples or audit events; never erase a consumed sample or rewrite purchase snapshots. Migration rollback is not authorization to erase financial evidence.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P3.1 | No runtime writes; flow inventory only | `docs/work-packages/contracts/P3.1-flow-inventory.md` (PROPOSED) | Read-only map; do not edit member route shared with P2. |
| P3.2 | No runtime writes; contract draft only | `docs/work-packages/contracts/P3.2-order-payment.md` (PROPOSED) | P1/P5 inputs; owner accepts idempotency/state contract. |
| P3.3 | `api/app/api/sales.py`; `api/app/sales/queries.py`; `api/tests/test_sales.py`; `frontend/src/api/membershipCheckoutApi.ts`; `frontend/src/api/membershipCheckoutApi.test.ts` | `api/app/sales/payment_commands.py`; `api/tests/test_membership_sale_commands.py` (PROPOSED only if reserved) | Sales router/shared client reservation; model/migration/router registration to named integrator. |
| P3.4 | `api/app/api/sales.py`; `api/app/sales/queries.py`; `api/tests/test_sales.py` | `api/app/sales/debt_commands.py`; `api/tests/test_debt_commands.py` (PROPOSED) | Stop before eligibility/collection changes until D-013/D-024 decisions. |
| P3.5 | `api/app/api/membership_access.py`; `api/app/members/queries.py`; `api/tests/test_membership_access.py`; `api/tests/test_membership_entitlements.py` | `api/app/sales/access_commands.py`; `api/tests/test_access_commands.py` (PROPOSED) | No history rewrite; serialize overlap with P2 member reads. |
| P3.6 | `api/app/api/member_check_ins.py`; `api/tests/test_member_check_ins.py`; `api/tests/test_membership_entitlements.py` | No new paths unless named by accepted design | Member check-in/sample only; not P6 staff attendance. |
| P3.7 | No runtime writes; integration handoff only | `docs/work-packages/contracts/P3.7-integration-handoff.md` (PROPOSED) | Consumers own their source files; one integrator accepts contract handoff. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Copy-paste assignment brief**

> Take only **P3 subtask [P3.x: name and one-sentence objective]**, not all of P3. Primary rows are only its listed BK-023–030 residual. Allowed edits: [verbatim candidate paths from the selected subdelivery row above]. Read this card, the specific BK tasks and relevant D-001/D-012/D-024 decisions. P1 owns server principal; P2 owns read-contract projection; P5 owns catalog publishing; P7 owns offline sync; P9 owns external providers. Preserve idempotency, append-only financial evidence and immutable plan snapshots. Use synthetic fixtures and prove that no ambient DB is used. Stop on unresolved debt/access/expiry/refund policy or unassigned shared registration/migration files. Return subtask ID, files, test command/results, failure/skips, integration handoff, proof limits and rollback boundary. No remote, provider, PostgreSQL, private data, install or release without separate explicit authorization.

Evidence: [BK ledger](../../odd/tasks/backend-implementation.md); [business decisions](../backend-plan/02-business-rules-and-decisions.md); [member-read contract](P2-member-read-contracts.md); [catalog package](P5-published-catalog.md); [source reconciliation](../backend-audit/post-audit-reconciliation.md).
