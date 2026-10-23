# P4 — Shifts and cash reconciliation

**Primary owner:** unfinished BK-021, BK-022 and BK-035 residuals only.
**Contributors:** P1 server principal/branch authority; P3 creates member-sale transaction facts; P8 contributes inventory/POS/expense event facts; P6 contributes staff attendance separately. These packages retain their own rows and events.
**Suggested assignee:** Backend engineer comfortable with transaction ordering, cash-ledger projections and incomplete-source handling; include a frontend engineer only for the delegated live-view subtask.
**State:** Planning only; current UI/API evidence is at source baseline `3996c62acfeac8c7f367032a61bf95f331ccf1b8`. The UI contains demo state and is not proof of live binding.

## Objective and readiness

Make opening, active-shift operations and close reconciliation server-backed, branch-scoped and explainable without silently adjusting inventory or financial history. Cash is an amount of physical tender—not a transfer, card payment or non-cash ledger movement. Shift totals are projections from identified source events; opening cash and close counts are separate evidence.

| Subdelivery | Readiness | Gate |
|---|---|---|
| Inventory current shift/open/close UI and API seams | Local-ready, read-only | Synthetic state; document current demo vs live API |
| Opening-cash snapshot and shift identity | Contract-ready | P1 actor/branch scope and exact register/shift ownership |
| Cash expected-vs-counted close projection | Contract-blocked on P3/P8 event contracts | Missing event source is unknown, never zero |
| Stale/missing source-event reconciliation | Local-ready contract design | Explicitly surface incomplete evidence; no auto-adjustment |
| Live FE shift UI | Contract-blocked | Accepted API and P1 transport; UI can use current demo until assigned |
| PostgreSQL overlap/concurrency proof | Permission-blocked | Named disposable PostgreSQL target and explicit authorization |

## Scope and invariants

**In:** BK-021 opening/shift lifecycle residual, BK-022 close evidence/reconciliation residual and BK-035 cash/shift audit residual. Include local shift UI contribution only after API contract acceptance.

**Out:** payment capture/idempotency owned by P3/P9; inventory count/adjustment or auto-reconciliation and general expense posting owned by P8; staff roster/attendance BK-031/040 owned by P6; offline queue/receipt owned by P7; all-shift rewrite or assumed opening schedule policy.

| Invariant | Requirement |
|---|---|
| Opening | Record actor, branch/register, exact shift identity, server time, opening counted cash and denomination evidence if required. Missing opening count is not zero. |
| Expected close | Derive only from known, accepted, shift-linked events and explicit rules; source unknown/incomplete/stale stays visibly unknown or review-required. |
| Tender type | Cash, card, transfer and provider states remain separate. Pending transfer is not cash. |
| Close | Record counted cash, expected amount, variance, denominations, actor, server time and reason. Close is an immutable event; corrections append a linked correction. |
| Replay/sequence | Idempotent exact retry returns same result; double open/close or stale expected revision is conflict, never a second close. |
| Overtime | Apply only the ratified overtime sequence/behavior; broader attribution or automatic cross-shift classification remains under partial D-014, not inferred by the reconciliation view. |
| Inventory | Cash mismatch must not automatically adjust stock, sales, or source events. |
| Scope | Server derives actor and branch authority; selecting a branch in the UI adds no rights. |

## Existing seams and proposed paths

Existing API seam: `api/app/api/shifts.py` exposes register/shift operations; `api/tests/test_shifts.py` exists. Existing UI/demo paths: `frontend/src/features/shifts/Shifts.tsx`, `ShiftOpenModal.tsx`, related `ShiftOpenModal.test.tsx`, `frontend/src/demo/shiftOperations.ts`, `frontend/src/demo/DemoProvider.tsx`, `frontend/src/domain/models.ts`, `frontend/src/api/membershipCheckoutApi.ts` (current register/shift client seam). Current shift UI reads `useDemo()` and local operation state; do not call it live API proof.

**PROPOSED, conditional future path:** one additive `api/app/shifts/reconciliation.py` or `api/app/api/shift_reconciliation.py` only if the existing shift service cannot express the accepted projection; select one after contract design. Any model change requires a reserved migration. The existing shift router/service, `api/app/main.py`, model registry, migration chain, FE `App.tsx` route wiring, client files and ledger are shared; use a named integrator and serialize each exact file. Never allow `api/app/**` or `frontend/src/**` as a wildcard.

## Subdelivery sequence

| ID | Deliverable | Dependency | Exact stop boundary |
|---|---|---|---|
| P4.1 | Current shift/event-source inventory | None; read only | List each included/excluded source, null/unknown handling and current demo dependencies. |
| P4.2 | Opening snapshot contract | P1 actor scope; P4.1 | Define register, branch, shift, actor, server time and counted cash. Stop if register/shift authority ambiguous. |
| P4.3 | Accepted source-event projection | P3 accepted order/payment event contract and P8 event contribution; P4.2 | Define cash-only components and event completeness. Do not assume missing source equals zero. |
| P4.4 | Close/reconciliation command | P4.2/P4.3 approved; exact route/service reservation | Persist close/count/variance atomically and replay safely. No stock adjustment. |
| P4.5 | FE live shift projection | P4.2/P4.4 API DTO plus P1 transport | One assigned view; server response is source of truth, demo fallback not a production proof. |
| P4.6 | Verification/handoff | Candidate changed | Synthetic tests, exact API/frontend results, PG and production limits. |

P4.1–P4.2 can start locally. P4.3 needs source contracts but not full completion of all P3/P8 work: each named producer can agree its minimal event fields first. The FE does not wait for P2 as a whole; it needs the shift DTO and P1 transport. Keep STAFF-2 attendance out of cash reconciliation.

## Acceptance and failure matrix

- [ ] Opening count, shift/register/branch IDs, actor and server timestamp are durable and auditable.
- [ ] Opening evidence that was not captured is reported missing/review-required, not converted to zero.
- [ ] Expected close includes only documented accepted cash events; transfer/card/pending provider events are not physical cash.
- [ ] A stale event source, missing producer, incomplete page or unmapped payment stays visibly incomplete; no inferred zero or silent exclusion.
- [ ] Counted cash and expected cash remain separately visible with denomination detail and a signed/actor-linked difference.
- [ ] Close and close correction are append-only; replay does not create a second close; stale expected revision is rejected safely.
- [ ] Missing opening or stale cash snapshot triggers a review path, not an auto-adjustment.
- [ ] Variance never mutates inventory, payments, or order totals.
- [ ] FE role/branch behavior follows server authority; selected branch cannot bypass it.
- [ ] All test data is synthetic; each event maps to a stable producer ID and source package.

| Fault | Expected result |
|---|---|
| One contributing API is unavailable | Mark projection incomplete/unknown; do not claim zero activity. |
| Duplicate close request, same key/body | Return prior close record. |
| Same key but changed count or shift | Safe conflict; no second close. |
| Out-of-sequence close after source-event update | Conflict or explicit stale revision response; operator reloads and reconciles. |
| Pending transfer or provider payment | Remains non-cash and excluded from physical tender total. |
| Cash variance | Persist variance and review requirement; never auto-correct sales or stock. |

## Verification plan — commands are planned, not run

From `api`:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_shifts.py

From `frontend` after assigned UI integration:

    npm.cmd test -- --run src/features/shifts/ShiftOpenModal.test.tsx --maxWorkers=2
    npm.cmd run typecheck

The focused FE test may not cover all shift dashboard behavior; add a new test only in an exact authorized path if the owner accepts that gap. Run full API/FE suites for shared service/route changes. Existing source-baseline test receipts are historical only. PostgreSQL concurrency and hosted CI remain pending; browser/manual production proof needs separate authorization. Use a new temp-contained SQLite DB and synthetic rows, never ambient DB configuration.

## Effort, rollback and handoff

Effort: **M** for one contract-backed existing route/UI residual; **L** if new event aggregation, migration, correction history or multiple producer integrations are needed. Roll back only the exact additive projection/command/UI unit. Do not delete shift, payment, cash-count or correction evidence; do not rewrite event history to make a close balance. A migration must have a separately approved reversible/forward-repair plan.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P4.1 | No runtime writes; source inventory only | `docs/work-packages/contracts/P4.1-event-inventory.md` (PROPOSED) | Read-only inventory. |
| P4.2 | No runtime writes; contract draft only | `docs/work-packages/contracts/P4.2-opening-snapshot.md` (PROPOSED) | P1 actor scope; contract signer confirms source completeness semantics. |
| P4.3 | No runtime writes; cash projection contract only | `docs/work-packages/contracts/P4.3-cash-projection.md` (PROPOSED) | Do not edit sales queries concurrently with P3/P8; reservation required. |
| P4.4 | `api/app/api/shifts.py`; `api/tests/test_shifts.py` | `api/app/shifts/reconciliation.py`; `api/tests/test_shift_reconciliation.py` (PROPOSED, choose one service boundary) | No stock adjustments; router/model/migration wiring to integrator. |
| P4.5 | `frontend/src/features/shifts/Shifts.tsx`; `frontend/src/features/shifts/ShiftOpenModal.tsx`; `frontend/src/features/shifts/ShiftOpenModal.test.tsx` | No new route; only exact reserved view/test paths | P1 transport required; `App.tsx` belongs to frontend integrator. |
| P4.6 | No runtime writes; report only | No additional paths | P11 owns proof plan/PG boundary; no independent broad suite task. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Copy-paste assignment brief**

> Take only **P4 subtask [P4.x: exact deliverable]**. Primary ownership is only BK-021/022/035 residual scope. Allowed edits: [verbatim candidate paths from the selected subdelivery row above]. Read this card, the named existing BK task(s), P1 identity contract, and P3/P8 event contracts for the selected slice. Do not equate missing events with zero, conflate transfers with cash, or change inventory/payment history on variance. Use synthetic data; no .env, private files, PG, hosted CI or remote. Stop on unknown source completeness, disputed policy, or unassigned migration/router/model registration. Report subtask, contract, paths, exact focused results, proof limits, outstanding producer dependencies and rollback boundary.

Evidence: [BK ledger](../../odd/tasks/backend-implementation.md); [backend phase cards](../backend-plan/04-implementation-phases.md); [P1 identity](P1-identity-and-transport.md); [source reconciliation](../backend-audit/post-audit-reconciliation.md).
