# P8 — Commercial operations

**Primary owner:** unfinished BK-032/033/034/036/037/038/039/041 residuals only. BK-032 is partial; retain its implemented piece-only catalog and immutable branch initialization.
**Contributors:** P1 authorization, P3 order/payment/refund event contract, P4 shift/register context, P5 published membership catalog only where a UI consumer overlaps, P6 attendance input for compensation, P7 later offline event transport, P10 reporting consumers. Contributions do not transfer ledger rows.
**Suggested assignee:** A backend engineer comfortable with inventory invariants, atomic transactions and immutable ledgers, plus a frontend engineer only for an explicitly selected UI subdelivery. Do not assign one person the full package as a single unreviewable unit.
**Helpful skills:** relational transaction design, idempotent commands, inventory ledger/reconciliation, React testing for the FE slice, and scoped API authorization.
**State:** Planning only. Existing routes/tests are current at source baseline `3996c62acfeac8c7f367032a61bf95f331ccf1b8`; this card provides no new runtime proof.

## Objective and readiness

Make each commercial operation independently traceable, idempotent and branch-scoped. Separate product/stock events, order/payment events, supplement conversion, rental asset lifecycle, physical return/disposition, monetary refund, and expenses/compensation. Do not create a second stock ledger or payment writer when an existing owner already supplies the source event.

| Subdelivery | Readiness | Gate |
|---|---|---|
| BK-032 piece-only product/initialization inventory | Local-ready, read-only | Current implementation is partial; list residual movement ledger/non-piece units exactly |
| Online product POS contract | Contract-ready | P3 order/payment idempotency, P4 shift/register context, P1 authorization |
| Supplement conversion | Decision/contract-sensitive | Existing product/order semantics and approved conversion; no guessed conversion ratio |
| Rental asset/rate lifecycle | Contract-ready for discovery | Rate, deposit, return and exception rules must be explicit before writes |
| Partial return and physical disposition | Policy-blocked in part | D-024 refund/expiry outcomes; monetary reversal is a separate P3/P9 event |
| Commercial FE integration | Contract-blocked | Accepted API events/DTOs; P3/P4 own financial/shift contracts |
| Compensation, expenses, extras and budgets | Decision-sensitive | BK-041 scope unchanged; attendance from P6 is input only; D-014 attribution remains partial |
| Inventory valuation, negative stock and concurrency | Decision-sensitive | D-015 unresolved; it blocks affected choices, not read-only catalog or unrelated work |
| Offline commercial operations | P7 contract-blocked | P8 supplies event schema; P7 owns queue, replay and ingestion |

## Ownership and invariants

| BK | Primary P8 slice | Cross-package contract boundary |
|---|---|---|
| BK-032 | Residual stock movement ledger/non-piece units after existing piece-only product and initial-stock work | P5 owns membership plans; P8 owns physical item catalog and stock events |
| BK-033 | Product POS sale and atomic stock deduction | P3 order/payment event contract; P4 shift/register contract |
| BK-034 | Supplement-serving/conversion and its distinct line/history/report type | Must agree exact approved conversion before implementation |
| BK-036 | Frontend POS/stock/shift integration residual | P8 UI adapter only; no duplicate P3/P4 posting or shared route owner |
| BK-037 | Rental assets, rates, checkout/return lifecycle | Separate physical asset status from money/order events |
| BK-038 | Partial return, refund and disposition | P3/P9 money reversal contract; P8 owns physical disposition event |
| BK-039 | FE rental/return/refund workflow integration | P8 consumer only; retain server-sourced result and unknown outcome |
| BK-041 | Compensation, expenses, extras, budgets | P6 staff attendance can provide verified input; no new payroll/compensation rule |

Core invariants:

- Internal order and stock-movement writes commit atomically under the approved contract; link the accepted P3 payment state without pretending an external provider call is part of one database transaction. Retries cannot sell or deduct twice.
- A product movement is append-only, branch-scoped and references its causal order, count, initialization, return or adjustment. A refund does not itself decide what happens to a returned item.
- Inventory counts, expected stock and adjustments remain distinct. Missing/stale baseline is not zero. No automatic correction from a cash variance or report mismatch.
- D-015 remains open for valuation, negative stock, adjustments and concurrency; avoid claiming a policy for any affected decision. Read-only product/catalog design can continue.
- Supplement conversion is explicit in units and its own event/line/report type; never silently convert fractional units or infer a ratio.
- A rental's asset reservation, due/returned/exception state and charge/refund are linked but separate events; late, loss, damage, deposits and partial refund remain unresolved unless specifically approved.
- Financial reversal is a separate immutable P3/P9 event with amount, reason, actor/time and idempotency; physical disposition is a P8 event with condition/location/next state. Neither rewrites the original sale.
- Compensation/expense postings are distinct movement classes, authorized by role/grant, and attendance is only a P6-sourced input. Do not calculate salary, overtime pay or budget policy from schedule data.
- D-001/D-012 apply to organization-shared member profiles; cash, stock, visits, orders and branch operations remain branch-scoped.

## Existing seams and proposed paths

Existing API source: `api/app/api/inventory.py`, `api/app/inventory/`, `api/app/api/sales.py`, `api/app/sales/`, `api/app/api/shifts.py`, `api/app/api/catalog.py`. The existing inventory/catalog API includes product listing/creation and initial stock initialization; `api/tests/test_inventory.py`, `test_inventory_reviews.py`, `test_inventory_snapshots.py`, `test_sales.py`, `test_shifts.py`, and `test_catalog.py` exist. FE paths include `frontend/src/features/inventory/Inventory.tsx`, `Inventory.test.tsx`, `frontend/src/features/owner/InventoryAnalytics.tsx` and its test, `frontend/src/features/sales/Sales.tsx` and its test, `frontend/src/features/shifts/Shifts.tsx`, and `ShiftFlow.test.tsx`. Existing tests for rentals/returns/supplement conversion are not claimed here.

**PROPOSED conditional future paths (choose narrowly per subdelivery):** `api/app/inventory/movements.py` for a new movement domain only if existing `api/app/inventory/` cannot host it; `api/app/api/product_sales.py` for a separately reserved product-sale route; `api/app/commercial/supplements.py`; `api/app/rentals/` for asset lifecycle; `api/app/finance/expenses.py` for approved expense/compensation command model; and FE `frontend/src/features/rentals/` or `frontend/src/features/supplements/` only if existing screens are absent and their design is accepted. Planned tests may be added only at exact authorized files; no nonexistent new test path is represented as an existing runner. Existing `api/app/api/sales.py` and `api/app/inventory/` may be shared with other units—reserve exact files and serialize same-file work.

Shared integration owner required for `api/app/main.py`, `api/app/db/models/__init__.py`, `api/migrations/versions/*`, `frontend/src/app/App.tsx`, lockfiles, CI and BK ledger. Domain workers submit route/model/migration/FE registration patches to that owner; never concurrently edit shared registration. No `api/app/**` or `frontend/src/**` wildcard.

## Independently assignable subdeliveries

| ID | Primary rows | Deliverable and input/output contract | Dependencies/readiness |
|---|---|---|---|
| P8.1 Stock ledger residual | BK-032 | Document implemented product/initialization behavior; propose immutable movement event with product, branch, quantity/unit, source/reason, actor/time and resulting revision. No silent opening-balance default. | Starts read-only now. Mutation blocked only for unresolved D-015 choices. |
| P8.2 Online product POS | BK-033 | Product/quantity + register/shift + idempotency input; one order/payment reference and one atomic stock deduction output. | P3 internal payment/order and P4 shift contract; provider attempts stay P9; online work does not wait for P7. |
| P8.3 Supplement conversion | BK-034 | Explicit source/converted quantities, unit, conversion rule version, order line and distinct report event. | P8.1/P8.2 product contracts; approved conversion rule. |
| P8.4 POS/stock/shift UI integration | BK-036 | FE sends one command and renders server result; does not post stock/payment locally a second time. | P8.2 contract + P1 transport; exact FE files reserved. |
| P8.5 Rental lifecycle | BK-037 | Asset, reservation, rate snapshot, due/return timestamps, condition and exceptions with stable IDs. | Discovery now; pricing/deposit/exception rules before writes. |
| P8.6 Return/refund/disposition | BK-038 | Separate partial quantity/condition disposition from the linked monetary refund request/result and original order. | P8.5 or P8.2 source sale; P3/P9 reversal contract and D-024 decisions. |
| P8.7 Rental/return workflow UI | BK-039 | FE workflow shows accepted/pending/unknown refund separately from physical asset result. | P8.5/P8.6 contracts and P1 transport; no independent refund posting. |
| P8.8 Expenses/compensation | BK-041 | Distinct expense/extra/compensation event classes, authorized actor, amount/reason/period and reporting handoff. | P6 attendance input only; decisions on D-014 attribution before disputed rules. |

Subtask dependencies are milestone-level: P8.1 contract → P8.2 stock-aware sale; P3/P4 contracts → P8.2; P8.2 + approved conversion → P8.3; P8.2 contract → P8.4. P8.5 can proceed independently from product POS; P8.6 depends on the specific sold asset/order and refund contract, not on all of P8; P8.7 follows its own two API contracts. P8.8 can inventory/report existing expense types while attendance from P6 remains an input contract. P7 integration is a later adapter only, never a prerequisite for online P8 work. P4 needs only P8's accepted event schema for close projection; it does not need the entire package.

## Contract-before-mutation split for shared POS/stock interfaces

The following stable substeps separate interface acceptance from implementation. They retain the same P8 primary BK ownership; the contract rows do not transfer the row to consumers.

| Stable subtask | Output | Dependency / acceptance | Implementation boundary |
|---|---|---|---|
| P8.1a | Stock movement contract (C-06) | Draft product/branch/unit/source/reason/actor/time/revision and unknown-baseline semantics; signed by P8 stock owner plus P4/P7/P10 consumers | No runtime movement writes. |
| P8.1b | Stock ledger residual implementation | Depends on K-06 accepted contract and separately authorized exact paths | Exclusive P8 movement writer; append-only; D-015 blocks disputed valuation/negative-stock decisions only. |
| P8.2a | Online POS command/result contract (C-15) | Depends on accepted C-03 internal sale, C-05a register/shift and C-06 stock contracts; integrator and P3/P4 reviewers sign atomicity/event output | Contract only; no writes. |
| P8.2b | Online product POS implementation | Depends on K-15 accepted contract and explicit exact path authorization | One API transaction boundary; P3 order/payment and P4 shift remain their owners; no provider/offline implementation. |

P8.3 conversion design consumes C-06/C-15 and separately approved conversion rules; it does not wait for all POS UI work. P8.4 UI consumes P8.2b’s accepted result and never posts a second mutation.

## Acceptance and failure scenarios

- [ ] Concurrent movements preserve the explicitly approved D-015 negative-stock policy; until that policy is decided, no implementation silently assumes a universal allow or deny rule.
- [ ] Initializations and movement events are immutable and branch-scoped; same request replay is idempotent; changed-body key reuse conflicts.
- [ ] Product POS order/payment/stock event are one all-or-nothing logical result; forced failure rolls back all parts.
- [ ] Missing or stale stock baseline yields explicit unknown/review, not zero or silently available stock.
- [ ] Supplement conversion has a versioned approved ratio/unit and its own order line/history/report category.
- [ ] Rental rate/terms snapshot are stable after checkout; return, damage, lost, late and disputed outcomes follow explicit rules.
- [ ] Partial return does not exceed sold/refundable quantity/amount; each disposition is independent from accepted, pending, failed or unknown monetary refund.
- [ ] A pending refund is never represented as completed. A timeout is resolved by original idempotency key/result lookup, not a new refund attempt.
- [ ] Expenses, extras, compensation and inventory movements have distinct event classes and permissions; P6 attendance data is not silently treated as compensation authorization.
- [ ] FE renders server-accepted vs pending/unknown results and refreshes from stable IDs; no double local/backend posting on retry.
- [ ] All records are synthetic; no real member, stock, rental or expense data.

| Fault | Expected result |
|---|---|
| Concurrent last-unit sale | One accepted sale/deduction; other request conflicts or returns safe insufficient-stock result. |
| Crash between order and stock write | Transaction rolls back or durable saga state is explicit; no paid order without reconciled stock effect. |
| Stock baseline missing | Unknown/review path; no “available = 0” assertion or inferred initialization. |
| Return event accepted but refund pending | Asset disposition recorded separately; money remains pending. |
| Refund timeout | `unknown` until lookup/reconciliation; never blind duplicate. |
| D-024 or D-015 policy unavailable | Stop only affected subtask; continue independent read-only/catalog/rental contract work. |
| Attendance record missing/disputed | Expense workflow does not invent compensation; report missing input and ask decision owner through parent. |

## Verification plan — commands are planned, not run

From `api` (all named files exist at baseline):

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_inventory.py tests/test_inventory_reviews.py tests/test_inventory_snapshots.py tests/test_sales.py tests/test_shifts.py tests/test_catalog.py

From `frontend`:

    npm.cmd test -- --run src/features/inventory/Inventory.test.tsx src/features/owner/InventoryAnalytics.test.tsx src/features/sales/Sales.test.tsx src/features/shifts/ShiftFlow.test.tsx --maxWorkers=2
    npm.cmd run typecheck

Use the P11 safe local API harness: new temp-contained SQLite, synthetic rows, ambient DB variables removed and fail-closed connection assertions. These commands do not prove PostgreSQL race behavior, provider refunds, device offline sync, hosted CI or production. No tests for proposed new rental/refund/supplement files exist yet; their focused tests are part of the authorized subdelivery, not runnable now.

## Effort, rollback and handoff

Effort by subdelivery: **S/M** for residual read/catalog contract, **M/L** for atomic online sale or rental lifecycle, **L** for stock concurrency, multi-source refunds or expense/compensation rules. Re-estimate after contract review; do not implement P8 as a monolith. Roll back only the specific new event/command/UI unit. Never erase stock, sale, refund, physical disposition, expense or audit events to balance totals; migrations need an explicit additive/forward-repair plan.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P8.1a | No runtime writes; contract draft only | `docs/work-packages/contracts/P8.1a-stock-movement.md` (PROPOSED) | Contract and sign-off only; P8 stock owner signs, P4/P7/P10 consumers review. |
| P8.1b | `api/app/api/inventory.py`; `api/app/inventory/queries.py`; `api/app/inventory/schemas.py`; `api/app/db/models/inventory.py`; `api/tests/test_inventory.py`; `api/tests/test_inventory_snapshots.py` | `api/app/inventory/movements.py`; `api/tests/test_inventory_movements.py` (PROPOSED) | Exclusive stock-ledger writer; report/API consumers get event contract only. |
| P8.2a | No runtime writes; POS command contract only | `docs/work-packages/contracts/P8.2a-product-pos.md` (PROPOSED) | P3/P4/P8 source contracts accepted before implementation. |
| P8.2b | `api/app/api/sales.py`; `api/app/api/inventory.py`; `api/app/inventory/queries.py`; `api/app/sales/queries.py`; `api/tests/test_sales.py`; `api/tests/test_inventory.py` | `api/app/api/product_sales.py`; `api/tests/test_product_sales.py` (PROPOSED, only if reserved) | P3 payment and P4 shift integrations are contract handoffs; serialize shared sales queries. |
| P8.3 | `api/app/api/inventory.py`; `api/app/inventory/queries.py`; `api/app/api/sales.py`; `api/app/sales/queries.py`; `api/tests/test_inventory.py`; `api/tests/test_sales.py` | `api/app/commercial/supplements.py`; `api/tests/test_supplement_conversion.py` (PROPOSED) | No second stock writer; P8.1 owns movement implementation. |
| P8.4 | `frontend/src/features/sales/Sales.tsx`; `frontend/src/features/sales/Sales.test.tsx`; `frontend/src/features/inventory/Inventory.tsx` | New test only at exact reserved existing feature test | P8.2 command owns mutation; frontend route registration to integrator. |
| P8.5 | No existing write path; rental service is new and proposed | `api/app/rentals/assets.py`; `api/tests/test_rentals.py` (PROPOSED) | No stock/financial sale mutation outside approved rental contract. |
| P8.6 | `api/app/api/sales.py`; `api/app/api/inventory.py`; `api/tests/test_sales.py`; `api/tests/test_inventory_reviews.py` | `api/app/rentals/returns.py`; `api/tests/test_rental_returns.py` (PROPOSED) | Separate physical disposition from P3/P9 monetary reversal; no refund-posting duplicate. |
| P8.7 | No existing write path before DTO acceptance | `frontend/src/features/rentals/RentalWorkflow.tsx`; `frontend/src/features/rentals/RentalWorkflow.test.tsx` (PROPOSED) | Only named exact component files later; no feature-directory wildcard in authorization. |
| P8.8 | No existing write path until event contract is accepted | `api/app/finance/expenses.py`; `api/tests/test_expenses.py` (PROPOSED) | P6 supplies attendance evidence, no payroll policy invented; P4 cash projection consumes approved events. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Copy-paste assignment brief**

> Take only **P8 subtask [P8.x: exact row and deliverable]**, not all commercial operations. Primary rows are that subtask's listed BK-032/033/034/036/037/038/039/041 residual only. Allowed candidate paths: copy the selected subdelivery row above verbatim; obtain separate human authorization before source edits. Read the named row in the ledger and this card. P3 owns payment/order semantics; P4 shift/register; P5 published membership plans; P7 offline queue; P6 attendance evidence; P10 reporting consumer. Keep stock movements single-owner, financial refund separate from physical disposition, and all events append-only/idempotent. Stop at D-015/D-024/D-014 policy uncertainty, missing source event or shared-file reservation. Use synthetic data and P11 safe temp-SQLite harness only; no private data, .env, provider, PG, hosted CI, remote or production. Return contract, paths, exact commands/results, failed/skipped/pending proof, owner handoffs and rollback boundary.

Evidence: [BK ledger](../../odd/tasks/backend-implementation.md); [decision register](../backend-plan/02-business-rules-and-decisions.md); [P3 order/payment](P3-membership-payments-and-access.md); [P4 shifts/cash](P4-shifts-and-cash.md); [P5 catalog](P5-published-catalog.md); [P7 offline sync](P7-local-first-and-sync.md); [P11 proof protocol](P11-postgresql-and-quality-proof.md).
