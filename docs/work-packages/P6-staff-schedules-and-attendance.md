# P6 — Staff schedules and attendance

**Primary owner:** residuals of BK-031 and BK-040.
**Contributors:** P1 supplies principal/transport; P7 owns offline infrastructure and staff offline adapter; P3 owns member BK-029/030.
**State:** Planning only. No new P6 runtime proof. Baseline is source commit 3996c62acfeac8c7f367032a61bf95f331ccf1b8.

## Current state and policy

STAFF-1 branch roster/schedule series, recurrence, exceptions, history-preserving edits, and same-profile overlap checks exist in the source baseline. Do not redo them or claim blanket STAFF-1 completion: residual edge-case, query-bound, public UI binding, PostgreSQL and integration proof remain. BK-040 attendance marks and BK040-S3 schedule configuration/classification/checkout exist, but attendance is not linked to weekly occurrences. Correction history and offline queue/sync remain. The ledger also records a BK-029/BK-031 integration dependency; P6.7 with P3.7 reconciles its actual contract/policy meaning without coupling member entry to staff attendance or merging identities.

D-032 is confirmed: each branch roster profile is an independent identity. Do not globally link/deduplicate profiles or check overlap across branches. Prevent overlap only within one branch roster profile. Schedules may have multiple separately tracked shifts/day, recurrence and exceptions; future edits do not rewrite past occurrences or attendance. Preserve actual entry/exit; do not infer a missing exit. D-033 requires raw device time and server-received time to remain separate, uses a shared monotonic origin only when verified, and retains untrusted events for review without auto-correction. Apply these rules to staff events. Do not re-ask the owner.

## Readiness by subdelivery

| Subdelivery | Readiness | Gate |
|---|---|---|
| Review existing STAFF-1 recurrence behavior | Local-ready, read-only | Synthetic data; no rewrite of prior work |
| Link occurrence to attendance event | Contract-ready/local after authorization | Define occurrence identity, timezone, exception/cancellation handling |
| Correction workflow and audit | Policy/permission-sensitive | D-032/D-033 and existing RBAC; no inferred permissions |
| FE09 roster/attendance binding | Contract-blocked | P1 principal and accepted typed DTO |
| Offline staff marks | Blocked on P7 sequence | Local capture is not server acceptance |
| PostgreSQL recurrence/race proof | Permission-blocked | Explicit disposable PG target |
| STAFF-3 end-to-end offline reconciliation | Cross-package blocked | P7 ingestion/grant/review state required |

## Objective and event contract

Deliver occurrence-aware staff attendance while preserving schedule and attendance history. A mark must identify branch roster profile and concrete scheduled occurrence, actor/device context where allowed, raw capture time and server receipt time, request idempotency key, and schedule-aware status/review classification. Final schema is a reviewed contract, not assumed from this card.

Do not equate roster profile with credentialed employee account. Staff without app accounts remain representable; actor authority remains server-derived. Missing check-out remains missing. Early exit records actual time but does not invent a new status. Stale offline events are retained and marked for review, not discarded or attached to another occurrence.

## Scope

**In:** STAFF-1 residual edge/query bounds; STAFF-2 occurrence-linked attendance; BK-040 schedule/attendance residuals; FE09 live roster/attendance contribution; STAFF-3 offline event requirements contract for later P7 integration.

**Out:** BK-029/030 member check-in/sample and member visit dedupe (P3); queue, grants, ingestion and receipt infrastructure (P7); payroll/compensation BK-041 (P8); global cross-branch identity or overlap policy; device enrollment BK-059/060; private/real staff data, PostgreSQL, hosted CI, or production.

## Existing seams and proposed paths

Existing API paths verified: api/app/api/staff_roster.py, staff_schedules.py, staff_attendance.py; model exports api/app/db/models/__init__.py. FE: frontend/src/features/staff/staffStore.ts, frontend/src/features/reception/StaffAttendanceView.tsx, frontend/src/features/attendance/AttendanceCalendar.tsx, frontend/src/features/owner/StaffManagement.tsx. Current local staff store/views do not prove live API binding.

Existing tests: api/tests/test_staff_roster.py, test_staff_schedules.py, test_staff_attendance.py, test_staff_auth.py; FE tests frontend/src/features/reception/StaffAttendanceView.test.tsx, frontend/src/features/attendance/AttendanceCalendar.test.tsx, frontend/src/features/owner/StaffManagement.test.tsx. Detailed task evidence: odd/tasks/bk-040-staff-labor-attendance.md, odd/tasks/bk-027-031-business-rules.md and odd/tasks/bk-029-member-checkin.md.

**PROPOSED conditional future paths:** existing staff router/query/schema/model files only as selected by an authorized subtask. A migration at api/migrations/versions/<revision>_staff_occurrence_attendance.py is proposed only if approved occurrence contract requires schema change and the serialized migration steward assigns a slot. No standalone frontend/src/api staff client was verified; do not assume or create one before transport approval.

Shared api/app/main.py, api/app/db/models/__init__.py, migrations, frontend/src/app/App.tsx and ledger require named integrator/owner. Do not authorize api/app/** or frontend/src/**.

## Subpackages

| ID | Deliverable | Depends on | Limit |
|---|---|---|---|
| P6.1 | STAFF-1 residual acceptance | Existing recurrence implementation and D-032 | Name remaining edge cases; no rewrite |
| P6.2 | Occurrence-attendance contract | P1 principal; existing occurrence IDs | Define relation, captured/server times, correction model and replay key |
| P6.3 | STAFF-2 API linkage | P6.2 accepted; P1 actor/branch authority | Online marks/check-out/corrections; preserve original rows |
| P6.4 | FE09 live view | P6.2 DTO and P1 transport | One bounded screen; server-accepted state only |
| P6.5 | STAFF-3 adapter contract | P7 receipt/grant milestones and D-033 | Specify event/review states; no P7 queue implementation |
| P6.6 | Proof handoff | Changed subdeliverable | Synthetic local evidence; PG/device proof separate |
| P6.7 | BK-029/BK-031 dependency reconciliation (read-only contract analysis) | P3.1 member-flow inventory + P6.1 staff residual inventory | Trace the reciprocal ledger references to an existing auth/actor/branch/event contract or a named legacy-policy gap; publish proposed C-16 boundary with P3 review. Do not make either online implementation wait for the other. |

Recurrence review can proceed independent of P3 member check-in. P6.3 online marking need not wait for P7. P6.5 does wait for P7. P6.7 is a local-ready documentation analysis, not a staff/member feature coupling; its accepted boundary is required for final reciprocal-ledger integration closure only. Do not block all staff work on offline behavior.

**P6.7 decision record:** Compare the actual BK-029 member check-in/sample actor, branch authority and event evidence with BK-031 staff integration evidence. Inputs are the P3.1/P6.1 source/ledger inventories and existing P1 principal contract; output is proposed `docs/work-packages/contracts/member-staff-integration-boundary.md` (not created by this planning task), reviewed by P3 and P6. Record either (a) the concrete shared auth/actor/branch/event seam and producer/consumer invariants or (b) that no runtime join is evidenced, with the precise legacy-policy gap and a recommendation for the ledger owner to reconcile the reciprocal dependency. Do not invent a requirement for staff schedules/attendance to authorize member entry, global member identity, cross-branch roster deduplication, or a member/staff shared record. Any unresolved business meaning returns to its owner before implementation. Conditional tests are proposed only if an accepted shared seam exists; they are not claims about existing tests. This analysis may run alongside independent P3/P6 online slices; the final integrated BK-029/BK-031 closure waits for the accepted record.

## Acceptance and failure matrix

- [ ] Every mark links to correct branch profile and scheduled occurrence, including multiple shifts/day.
- [ ] Same-profile overlap is rejected; other-branch profile is not globally matched or overlap-checked.
- [ ] Future-only schedule edits preserve historical occurrences, actual marks and correction history.
- [ ] One-occurrence exception/cancellation is respected; stale captured mark is retained for review.
- [ ] Absence remains schedule classification until check-in; exact tolerance boundary is present, late begins only after it.
- [ ] Missing exit is not inferred; early exit stores actual time only.
- [ ] Correction preserves original and corrected values plus authorized actor/time.
- [ ] Exact idempotent retry returns original mark; changed payload with same key is safe conflict.
- [ ] Invalid/different monotonic origin or missing anchor requires review; raw capture and server times remain separate.
- [ ] Reception is branch-scoped; Admin visibility/correction follows RBAC; roster identity does not imply account.
- [ ] FE shows server-accepted marks only; pending/offline is visibly distinct.
- [ ] No test asserts cross-branch deduplication or overlap.

| Fault | Expected result |
|---|---|
| Schedule changed after offline capture | Retain event against cached occurrence and flag review |
| DST nonexistent time/fold | Existing timezone policy applies; no silent wall-time shift |
| Timezone rule replacement | Revalidate schedule; preserve prior marks |
| Same key/same event | Replay original result |
| Same key/changed event | Reject conflict; no second mark |
| Unauthorized branch correction | Deny; preserve original |
| Series cancelled after past mark | Past evidence stays immutable |
| Untrusted clock | Review; never auto-adjust |

## Verification commands — planned, not run

From api:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_staff_roster.py tests/test_staff_schedules.py tests/test_staff_attendance.py tests/test_staff_auth.py

From frontend:

    npm.cmd test -- --run src/features/reception/StaffAttendanceView.test.tsx src/features/attendance/AttendanceCalendar.test.tsx src/features/owner/StaffManagement.test.tsx --maxWorkers=2

FE typecheck from frontend: npm.cmd run typecheck. API full suite is required after shared API changes; current baseline results are historical. PostgreSQL authorization/schedule concurrency tests remain unavailable until an explicitly authorized disposable target exists. D-033 helper tests do not prove offline queue integration. No hosted CI, live staff data, device enrollment or production connection.

## Effort, rollback and handoff

Effort: **M** if current schema suffices for online occurrence linkage; **L** if schema changes, correction history, recurrence bounds or P7 reconciliation are included. Re-estimate after scope approval.

Rollback only exact authorized additive linkage/DTO/view files. Never delete attendance, rewrite historical schedules/marks, clear correction audit, or overwrite prior STAFF-1 work. Any migration needs an agreed forward-repair/rollback policy.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P6.1 | `api/app/api/staff_schedules.py`; `api/tests/test_staff_schedules.py`; `odd/tasks/bk-040-staff-labor-attendance.md` | `docs/work-packages/contracts/P6.1-staff1-residual.md` (PROPOSED) | No rewrite; D-032 confirmed independent branch profiles. |
| P6.2 | No runtime writes; contract draft only | `docs/work-packages/contracts/P6.2-occurrence-attendance.md` (PROPOSED) | P1 actor/time contract; occurrence ID semantics. |
| P6.3 | `api/app/api/staff_attendance.py`; `api/app/api/staff_schedules.py`; `api/tests/test_staff_attendance.py`; `api/tests/test_staff_schedules.py` | `api/tests/test_staff_occurrence_attendance.py` (PROPOSED); migration only by steward | Existing model registry and migration chain reserved; no P3 check-in edits. |
| P6.4 | `frontend/src/features/reception/StaffAttendanceView.tsx`; `frontend/src/features/reception/StaffAttendanceView.test.tsx` | No new client path until P1 transport approval | No global `App.tsx` route edit. |
| P6.5 | No runtime writes; event adapter contract only | `docs/work-packages/contracts/P6.5-offline-attendance.md` (PROPOSED) | P7.1/P7.4/P7.6 exact receipts; queue implementation is P7. |
| P6.6 | Exact accepted changed paths only | No additional paths | P11 proof; PG/device checks remain permission-gated. |
| P6.7 | No runtime writes; read-only evidence analysis and contract draft | `docs/work-packages/contracts/member-staff-integration-boundary.md` (PROPOSED); conditional synthetic contract test only if the accepted boundary establishes a shared runtime seam (test path must then be separately approved) | P3.1 + P6.1 inventories; P3 reviews member evidence and P6 owns staff evidence. Documentation only until a human accepts C-16 and separately authorizes source paths. No member/staff feature coupling is assumed. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Assignment brief**

> Take only P6 subtask [P6.x]. For P6.7, use its exact docs-only path row and pair with the named P3 reviewer: trace BK-029/BK-031 evidence, record the concrete contract seam or unresolved legacy-policy gap, and do not invent staff-attendance prerequisites for member entry or any cross-branch identity rule. For other subtasks, P6 owns staff BK-031/040 residuals; BK-029/030 member check-in/sample belong to P3, and offline queue belongs to P7. Read this card, the BK-040 task, and D-032/D-033. Obtain separate human implementation authorization before runtime edits. Keep branch profiles independent and check overlap only within one profile. Preserve actual/raw/server times and correction history. STAFF-1 schedule work already exists; do not overwrite it or claim blanket completion. Use synthetic records; no private data, .env, PostgreSQL, hosted CI, or remote. Return focused results, pending proof, paths and rollback. Stop at unapproved policy or shared-file ownership gap.

Evidence: [decision register](../backend-plan/02-business-rules-and-decisions.md) D-032/D-033; [current roadmap](../backend-audit/roadmap.md); [FE09 contract gap](../backend-audit/frontend-contract-gaps.md); [BK-040 task](../../odd/tasks/bk-040-staff-labor-attendance.md); [BK ledger](../../odd/tasks/backend-implementation.md).
