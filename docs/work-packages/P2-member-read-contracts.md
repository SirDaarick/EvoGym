# P2 — Member-read contracts

**Primary owner:** FE05 read-contract work; no exclusive BK row.
**Contributors:** P3 member transactions/check-in, P5 catalog/profile UI, P7 offline projection, P1 server authority/transport. They retain their own BK ownership.
**State:** Planning only. Current source proof is recorded at 3996c62acfeac8c7f367032a61bf95f331ccf1b8; no new P2 runtime proof. RDD clone-local off.

## Current state and readiness

Existing member search and mutation are not the same as reloadable detail/history reads. FE05 says live lookup covers search/balance/register/sale; the current member summary lacks period/order/sample IDs; sale responses contain sale-time identifiers but do not provide durable reload history. Proposed reads must be designed and authorized, not inferred from current DTOs. D-001 permits organization-shared member profiles; D-012 constrains role projection. That does not grant access to another organization or branch-isolated cash, stock, visits, transaction history, or actions. A route's branch context cannot create authority. The minimal permitted profile read is not blocked by D-020 alone; only data actually classified as sensitive—such as restricted history, notes, uploaded evidence, retention/export—requires the D-020 review and any necessary policy decision.

| Subdelivery | Readiness | Gate |
|---|---|---|
| Inventory search/detail DTO and role visibility | Local-ready, read-only | Synthetic source only |
| Draft period/entitlement/order/debt ID projection | Contract-ready | P3 agreement on stable IDs/state |
| Protected endpoint/query | Contract-blocked on P1 principal | Contract approval before implementation |
| History/notes/eligibility evidence | Decision-sensitive | D-020 and D-012 role projection |
| Browser reload/detail integration | Contract-blocked | Accepted DTO and P1 transport |
| Shared-profile and scoped-data authorization proof | Local-ready with synthetic fixtures | Distinguish permitted shared profile from unauthorized organization or branch-specific records; PG proof remains separate |

## Objective and response projection

Define the smallest safe read contract allowing an authorized operator to reload a member and obtain stable identifiers required by an approved action. Use an explicit DTO/projection. Do not return ORM objects, serialize relationships by accident, infer actions from ID visibility or expose administrative finance fields to Reception.

| Response area | Required semantics |
|---|---|
| Operational profile | D-001 organization-shared profile visibility plus D-012 role allowlist; stable member ID and status |
| Entitlement summary | Only authorized branch-scoped state and stable opaque period/entitlement IDs; no eligibility inference from dates alone |
| Purchase/payment references | Only needed IDs/state; distinguish pending money from received revenue |
| Permitted history | Field allowlist, stable event IDs, time semantics, bounded pagination and retention class |
| Action boundary | Read never grants write; every command rechecks actor, branch, state and idempotency |

Final schema must specify pagination/order, empty/null semantics, request-ID/errors, date/timezone representation, branch access and additive evolution. Reception/Admin projections must be separately tested. The schema is proposed until reviewed.

## Scope

**In:** FE05 contract design; current member-summary/sale-response comparison; minimal protected query/route seam after P1/P3 contract alignment; synthetic tests for D-001 shared-profile visibility, D-012 role projection, unauthorized organization/branch-specific data denial, reload and stable IDs.

**Out:** BK-023–030 transaction implementation, repayments, access writes, check-in, samples or providers (P3); whole offline cache/bootstrap/outbox or BK-014 (P7); member create/update/catalog publication; notes/files/unrestricted finance history/exports/retention without D-020; UI action availability based solely on client state.

## Existing seams and proposed paths

Existing paths verified: api/app/api/members.py; api/app/members/schemas.py; api/app/members/queries.py; api/app/api/membership_access.py; api/app/api/member_check_ins.py; api/app/api/sales.py; api/app/sales/schemas.py. FE consumers: frontend/src/features/members/MemberDetail.tsx, Members.tsx, frontend/src/features/reception/LiveMemberLookup.tsx, frontend/src/api/membershipCheckoutApi.ts.

Existing API tests: api/tests/test_members.py, test_membership_access.py, test_member_check_ins.py, test_membership_entitlements.py. Existing FE tests: frontend/src/features/members/MemberDetail.test.tsx, Members.test.tsx, frontend/src/features/reception/LiveMemberLookup.test.tsx, LiveMembershipCheckout.test.tsx.

**PROPOSED, conditional paths:** api/app/members/read_schemas.py; api/app/members/read_queries.py; api/app/api/member_reads.py; frontend/src/api/memberReadsApi.ts and memberReadsApi.test.ts only if current transport is not accepted. Router registration in api/app/main.py is integrator-owned. Existing api/app/api/members.py is shared with P3 member-write work; avoid simultaneous edits or name one integrator and serialize changes. Do not create unnecessary files.

## Subpackages

| ID | Deliverable | Dependency | Limit |
|---|---|---|---|
| P2.1 | Current read-contract inventory | Existing DTOs and FE05 | Matrix current vs absent fields and consumer; no code |
| P2.2 | Member reload DTO specification | P1 principal draft; P2.1 current/absent field inventory | Draft the versionable projection, pagination/null/security rules from existing IDs and DTO evidence; P3 reviews consumer fit at K-02 acceptance, without waiting for P3 implementation |
| P2.3 | Protected query/API | P2.2 approved and P1 principal available | Read-only projected data; bounded query |
| P2.4 | Detail/reload consumer | Accepted P2.2 contract and P1 transport | One FE consumer slice; no localStorage as server truth |
| P2.5 | Verification handoff | P2.3/P2.4 candidate | Local synthetic result separate from PG/browser proof |

P2.1/P2.2 can start as contract work using current-source ID/DTO inventory; they do not depend on P3.1 or any P3 implementation. P3/P5 consumer review is captured at K-02 contract acceptance before protected consumers rely on the projection. P2.3 needs server authority. P2.4 need not wait for all P3 purchases.

## Acceptance and failure matrix

- [ ] Missing token is rejected; route does not trust URL, local role, PIN or hidden UI.
- [ ] Reception receives only D-012 operational projection; admin-only finance/audit fields are absent server-side.
- [ ] Organization-shared member profile read is allowed only to an authorized role; data from another organization and unauthorized branch-specific transaction/history/visit reads are denied without revealing protected existence.
- [ ] Branch selection or an organization-shared profile does not grant cash, stock, visit, payment, or mutation authority outside the actor's scoped grant.
- [ ] Hard reload returns stable member/period/entitlement/order IDs; no previous sale response is required.
- [ ] Empty collection, missing member, nullable field, pagination and stale entitlement semantics are explicit.
- [ ] Large history is bounded and ordered.
- [ ] Unknown/additive fields follow contract evolution; malformed required fields fail safely.
- [ ] Notes/files/sensitive history cannot appear without explicit field and role policy.
- [ ] Read availability grants no mutation authority; every write reauthorizes on server.
- [ ] All fixtures are synthetic.

| Fault | Expected outcome |
|---|---|
| Missing token | Safe 401 and no member data |
| Valid actor requests a shared profile from another branch in the same organization | Return only the approved organization-level profile projection; no branch-scoped records implied |
| Actor lacks organization membership or requests unauthorized branch transaction/history | Deny or safe not-found per established API |
| Member state changes between list/detail | Explicit current unavailable/state response |
| Missing durable identifier after refresh | Contract/test failure; do not guess from dates/balance/list order |
| Large history | Bounded page |
| Role changes while tab is open | Server remains authoritative |
| API unavailable | Do not call cached data live/current absent approved cache semantics |

## Verification commands — planned, not run

From api:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_members.py tests/test_membership_access.py tests/test_member_check_ins.py tests/test_membership_entitlements.py

From frontend:

    npm.cmd test -- --run src/features/members/MemberDetail.test.tsx src/features/members/Members.test.tsx src/features/reception/LiveMemberLookup.test.tsx src/features/reception/LiveMembershipCheckout.test.tsx --maxWorkers=2

Typecheck from frontend: npm.cmd run typecheck. Full suites remain necessary after changes to shared contracts/consumers; current receipts are historical only. Use synthetic data. PG authorization races need a separately authorized disposable target. Component tests are not browser E2E proof.

## Effort, rollback and handoff

Effort: **M** for explicit read DTO and one consumer; **L** if retention, extensive history or multiple roles/screens enter scope. Re-estimate after contract review.

Rollback only exact additive read/schema/consumer files. Never delete member, order, attendance or audit history; never revert unrelated P3 write behavior. Keep versioning/backward compatibility explicit.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P2.1 | No runtime writes; inventory only | `docs/work-packages/contracts/P2.1-read-inventory.md` (PROPOSED) | Read-only inventory; no source write. |
| P2.2 | No runtime writes; contract draft only | `docs/work-packages/contracts/P2.2-member-read-dto.md` (PROPOSED) | Draft from current-source IDs; P3/P5 review is acceptance input at K-02, not a dependency on their implementation. No broad member visibility grant. |
| P2.3 | `api/app/members/schemas.py`; `api/app/members/queries.py`; `api/tests/test_members.py` | `api/app/members/read_schemas.py`; `api/app/members/read_queries.py`; `api/app/api/member_reads.py`; `api/tests/test_member_reads.py` (PROPOSED) | `api/app/main.py` router integration not included; if existing `members.py` needed, reserve with P3 and serialize. |
| P2.4 | `frontend/src/features/members/MemberDetail.tsx`; `frontend/src/features/members/MemberDetail.test.tsx` | `frontend/src/api/memberReadsApi.ts`; `frontend/src/api/memberReadsApi.test.ts` (PROPOSED, if existing client is insufficient) | No `App.tsx` route edit; P1 shared transport contract required. |
| P2.5 | No runtime writes; report only | No additional paths | P11 integrator owns cross-cut proof; no proof-only code changes. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Assignment brief**

> Take only P2 subtask [P2.x], FE05. P2 has no exclusive BK row. P3 owns BK-023–030; P5 owns BK-019; P7 owns full local-first BK-014. Obtain explicit implementation authorization and exact paths. Preserve D-001 organization-shared member-profile visibility, D-012 role projection, and server-enforced branch/organization scope: do not globally deny the shared profile or expose branch-isolated cash, stock, visit, transaction-history, or action authority. D-020 gates only data classified sensitive and its retention/export policy; do not invent a blanket block on minimal permitted reads. Use synthetic data only; no private files, .env, PostgreSQL or remote. Return contract, changed paths, exact tests/results, pending gates and rollback boundary. Stop rather than infer a missing field or policy.

Evidence: [FE05/FE06 contract gaps](../backend-audit/frontend-contract-gaps.md); [decision register](../backend-plan/02-business-rules-and-decisions.md) D-012/D-020; [source-baseline reconciliation](../backend-audit/post-audit-reconciliation.md); [BK ledger](../../odd/tasks/backend-implementation.md).
