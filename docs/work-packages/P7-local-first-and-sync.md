# P7 — Local-first persistence and synchronization

**Primary owner:** BK-014 plus unfinished BK-062–074, including the entire local-first substrate; no other package owns BK-014 completion.
**Contributors:** P1 identity/grant contract; P2 member read projection; P3 transaction event/idempotency contract; P4 shift/source events; P6 staff event adapter; P8 stock event contract; P9 provider state remains online-only. Contributions do not transfer rows.
**Suggested assignee:** Platform/full-stack engineer experienced in browser persistence, durable event queues, API idempotency, concurrency and authorization boundaries; each subdelivery still needs a small owner rather than one person implementing the entire substrate unchecked.
**State:** Planning only. Current offline clock helper and demo persistence do not prove durable offline command queue, server ingestion, grants, or production reconciliation. Baseline source `3996c62acfeac8c7f367032a61bf95f331ccf1b8`; no new P7 runtime proof.

## Objective and readiness

Build a local-first substrate as ordered, separately verifiable capabilities: durable local queue and device identity; authorized bootstrap; event ingestion and delta/replay; expiring grants with server revalidation; flush, multitab coordination and reconciliation; then domain-specific adapters. Persist command outcomes as `pending`, `accepted`, `rejected`, or `unknown` so refresh/restart does not erase state. An offline screen, PWA shell, localStorage persistence, or clock helper alone is not end-to-end offline capability.

| Subdelivery | Readiness | Gate |
|---|---|---|
| Inventory current local persistence and offline-clock helper | Local-ready, read-only | Synthetic state; distinguish demo from server-authoritative data |
| Durable queue/event envelope contract | Contract-ready | P1 device/principal and event-idempotency agreement; no production queue yet |
| Bootstrap/ingestion/delta local service | Contract-blocked on event and grant contracts | Separate exact auth for any PG/hosted target |
| Grant, refresh and replay/reconciliation | Policy-blocked in parts | D-028 stale grant/revocation remains unresolved; do not invent TTL or offline rights |
| Member/staff/shift/stock adapters | Contract-blocked per domain | P2/P3/P4/P6/P8 event projections; stock reconciliation waits for P8 stock events |
| Device-loss/retention/quota recovery | Decision-sensitive | D-030 unresolved; E03 private-file classification is not blanket cleanup permission |
| Backup/restore and recovery objectives | Decision-sensitive | D-029 retention/RPO/RTO unresolved; use no guessed objective and no real backup target |

## Contract and sequence

Each event needs stable event ID, device ID, actor/grant reference, branch/entity scope, schema version, captured device UTC, monotonic reading/origin, last trusted server UTC+monotonic anchor, idempotency key and typed payload. Server-issued `accepted/rejected` result is authoritative; transport timeout is `unknown` until safely reconciled. Keep raw capture time and server acceptance time separately. Never manufacture event time, silently drop a command, or trust a client-selected branch/role.

Implement the approved store-and-forward architecture and operation classes in D-026/D-027; do not expand offline eligibility to a new operation simply because the queue can represent it. The exact decision-register operations must be copied into each adapter's contract during its own authorization.

| ID | Subdelivery | Depends on | Output and boundary |
|---|---|---|---|
| P7.1 | Device/event envelope and durable queue schema | P1 principal/device/grant proposal; event IDs from domain owners | Versioned local-only envelope and schema contract; no server sync. |
| P7.2 | Local persistence, transaction and recovery adapter | P7.1 plus local storage design review | Atomic append/read/restart contract and corruption state; no quota or retention value invented. |
| P7.3 | Bootstrap and cursor/delta API contract | P7.1, P1 grant scope, P2 read projections | Cursor/version/error semantics and branch/org scope; no whole-package P2 wait. |
| P7.4 | Server ingestion, idempotency and receipt | P7.1 and accepted P3/P4/P6/P8 event envelope contracts | Validate grant again per write; persist exact result and replay deterministically. |
| P7.5 | Grant lifecycle, flush and multitab coordination | P7.2–P7.4; D-028 for authority consequences | Serialize claims, prevent duplicate flush, survive focus/reload; disputed stale grant policy remains blocked. |
| P7.6 | Reconciliation and unknown-result resolution | P7.4 receipt + P7.5 | Accepted/rejected/unknown remain durable; safe query resolves unknown without blind replay. |
| P7.7 | Domain adapters in isolated units | P7.1–P7.6; respective producer contract | P6 attendance and P8 stock each get a separate adapter task; P3/P4 only if explicitly authorized. |
| P7.8 | Release/offline proof | Candidate paths and exact synthetic boundary | Local simulation proof first; device/browser/PG/hosted checks remain separately gated. |

The prerequisite graph is sequence-local: P7.1 → P7.2 and P7.3; P7.1+P7.3 → P7.4; P7.2+P7.4 → P7.5 → P7.6 → P7.7 → P7.8. P7.3 may be designed while persistence implementation proceeds. P6 offline attendance adapter waits only for P7.1/P7.4/P7.6 contracts, not P7.8. P8 stock reconciliation waits for P8 stock event IDs plus P7 ingestion/replay contract; online POS work need not wait for P7. P9 external payment authorization/callback remains online-only; no cached grant creates provider authority.

## Existing seams and proposed paths

Existing FE files include `frontend/src/demo/DemoProvider.tsx`, `frontend/src/demo/adapter.ts`, `frontend/src/features/checkIns/offlineClock.ts` and its test, `frontend/src/demo/staffAttendanceOperations.ts` and its test, plus device enrollment UI under `frontend/src/features/staff/DevicePairingModal.tsx`. They are persistence/demo/clock helpers, not the complete server sync substrate. Existing API seams include `api/app/auth/` and `api/app/api/device_pairing.py`; no complete offline server-sync package was found. Existing tests are selected only after inspecting the exact subtask; do not guess a migration or offline test name.

**PROPOSED and conditional:** one versioned module per accepted boundary, e.g. `frontend/src/offline/eventEnvelope.ts`, `frontend/src/offline/localEventStore.ts`, `frontend/src/offline/syncClient.ts`, `api/app/offline/events.py`, `api/app/offline/grants.py`, and a dedicated versioned migration only where an approved schema requires it. These are examples, not pre-approved files. Narrow a future delegation to one subdelivery and exact paths. `api/app/main.py`, model registry, migration chain, FE `App.tsx`, lockfiles, CI and ledger require a named serialized integrator; do not use `api/app/**` or `frontend/src/**` wildcard authority.

## Invariants, acceptance and failure matrix

- [ ] Queue append is durable/atomic before the UI reports pending; browser restart returns exact event ID and state.
- [ ] Duplicate key/same payload returns the same server result; same key/different payload is conflict and never duplicates a financial or attendance/stock event.
- [ ] Server revalidates grant, actor, branch, event schema and domain state at ingestion. Offline authorization is never inferred from cached role/UI.
- [ ] Bootstrap/delta is bounded, cursor-based and scoped; deleted/changed entities have explicit tombstone/revision semantics.
- [ ] `accepted`, `rejected` and `unknown` survive reload. Timeout does not silently become accepted or safe-to-resubmit with a new key.
- [ ] Multitab writers coordinate claims; a crashed owner expires only through an approved lease rule and cannot lose queued data.
- [ ] Raw device time, monotonic source, anchor and server time remain distinct. Existing `offlineClock.ts` helper's five-minute tolerance is not an approved global TTL or authorization policy.
- [ ] Missing anchor, changed monotonic origin, clock skew or invalid wall time is flagged for review; raw event remains available.
- [ ] Grant expiration/revocation behavior honors an approved D-028 rule; until then, affected write rights are blocked from policy claims.
- [ ] Queue quota, retention, device loss, backup and restore do not assume values while D-030 remains open.
- [ ] Member/profile bootstrap follows D-001/D-012; branch-specific cash, stock, visits and transactions stay scoped.
- [ ] Stock domain reconciliation never overwrites physical count or movement evidence; P8 owns stock semantics.
- [ ] All local/backend fixtures use synthetic data and never read real private workbooks or ambient credentials.

| Failure | Required result |
|---|---|
| Process/tab stops after local append | On restart same event returns pending and can be safely claimed; no event lost. |
| Server accepted event but response was lost | State stays unknown until receipt/query resolves; no blind second effect. |
| Grant expires/revokes while offline | Follow approved D-028 behavior; do not invent immediate or grace-period access. Preserve event for review where policy requires. |
| Two tabs flush same batch | One claim/receipt per event; second observes current status. |
| Local storage corrupt/full | Explicit blocked/recovery-required result; preserve recoverable data; no auto-delete. |
| Device clock reset / monotonic source differs | Preserve raw capture and mark time unverified for review. |
| Delta cursor expires or branch changes | Safe bootstrap/re-scope only with authorized grant; never mix branches. |

## Existing verification and planned commands

Existing offline helper unit test (FE):

    npm.cmd test -- --run src/features/checkIns/offlineClock.test.ts src/demo/staffAttendanceOperations.test.ts --maxWorkers=2

Check paths before using any additional command; P7 queue/API tests above are proposed future tests and must not be presented as existing. FE typecheck from `frontend`:

    npm.cmd run typecheck

API local suite from `api` when API code changes:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests

Migration graph from `api` is graph-only and makes no database connection:

    .\.venv\Scripts\python.exe -m alembic heads

Keep API tests on fresh temp-contained SQLite with ambient DB variables removed. All commands are plans, not run for this card.

Functional quality proof must add synthetic scenario tests at each accepted subdelivery: persist/restart; duplicate/same and changed payload; lost response/unknown resolution; overlapping tabs; expired/revoked grant; malformed/version-forward event; cursor mismatch/branch switch; local storage failure; clock skew/anchor failure; accepted/rejected receipt persistence; domain idempotent application. PostgreSQL execution, browser E2E, real devices, provider/hosted CI, external target and production remain separately authorized gates.

## Effort, rollback and handoff

Effort: **L** for the full substrate; each P7.x must be independently estimated as **S/M/L** after its exact event/storage boundary is selected. Do not deliver this as one giant work unit. Rollback only the last additive local adapter/schema/API slice; never silently delete a queue, clear unknown/accepted events, revoke production grants, or erase receipts. Data recovery/retention choices wait for D-030 and explicit permissions.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P7.1 | No runtime writes; schema/contract draft only | `docs/work-packages/contracts/P7.1-event-envelope.md` (PROPOSED) | P1/domain producer review; event fields must be accepted. |
| P7.2 | No runtime writes until storage choice approved | `frontend/src/offline/localEventStore.ts`; `frontend/src/offline/localEventStore.test.ts` (PROPOSED) | Exact FE store files only; no unrelated app storage. |
| P7.3 | No runtime writes; bootstrap contract only | `docs/work-packages/contracts/P7.3-bootstrap-cursor.md` (PROPOSED) | P1 grant/P2 read projection; no API route wiring. |
| P7.4 | `api/app/auth/authorization.py`; `api/app/api/device_pairing.py` | `api/app/offline/events.py`; `api/tests/test_offline_events.py` (PROPOSED) | Registration/model/migration are integrator-reserved; P3/P4/P6/P8 producer envelopes signed first. |
| P7.5 | `frontend/src/features/staff/DevicePairingModal.tsx` | `frontend/src/offline/syncClient.ts`; `frontend/src/offline/syncClient.test.ts` (PROPOSED) | D-028 policy blocks disputed grant consequence; no locks/storage-wide rewrite. |
| P7.6 | No runtime writes until receipt/query contract accepted | `docs/work-packages/contracts/P7.6-reconciliation.md` (PROPOSED) | Consumes original key and exact P7.4 receipt; never blind replays. |
| P7.7-attendance | `frontend/src/demo/staffAttendanceOperations.ts`; `frontend/src/demo/staffAttendanceOperations.test.ts` | `frontend/src/offline/staffAttendanceAdapter.ts`; `frontend/src/offline/staffAttendanceAdapter.test.ts` (PROPOSED) | Separate P6 event adapter; exact queue API reservation. |
| P7.7-stock | `frontend/src/features/inventory/Inventory.tsx`; `api/app/api/inventory.py`; `api/tests/test_inventory.py` | `frontend/src/offline/stockAdapter.ts`; `frontend/src/offline/stockAdapter.test.ts` (PROPOSED) | P8 stock contract only; stock ledger mutations remain P8. |
| P7.8 | No runtime writes; proof report only | No additional runtime paths | P11 local proof coordination; device/browser/PG separately gated. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Copy-paste assignment brief**

> Take only **P7 subtask [P7.x: name, e.g. durable local append + restart contract]**. Primary scope is BK-014 and its named BK-062–074 slice only. Allowed edits: [exact paths for the selected subtask, no wildcard]. State what is already present vs proposed. Read this card and the relevant P1/P2/domain event contract. No production implementation is authorized by this document; obtain separate explicit authorization, isolated worktree and chain decision before source edits. Use synthetic records and a temp-contained SQLite harness only; remove ambient DB vars and fail closed on DB/network access. Do not infer TTL, RPO/RTO, quota, retention or stale-grant rights. Stop for D-028/D-030, missing P1 grant, unassigned migration/shared registry or external target. Return subtask ID, event schema, exact paths/commands/results, accepted/rejected/unknown behavior, unresolved gates and rollback boundary. No provider call, PG, hosted CI, remote, private data or release.

Evidence: [source reconciliation](../backend-audit/post-audit-reconciliation.md); [decision register](../backend-plan/02-business-rules-and-decisions.md); [P1 identity](P1-identity-and-transport.md); [P2 member reads](P2-member-read-contracts.md); [P6 staff schedule/attendance](P6-staff-schedules-and-attendance.md); [P11 proof protocol](P11-postgresql-and-quality-proof.md).
