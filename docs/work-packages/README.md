# Work-package coordination guide

## Quick start

This plan defines assignable work packages, not implementation authorization. Before taking one:

1. Read this guide, the selected package card, the authoritative BK ledger, and applicable decision rows.
2. Verify the worktree and source baseline. Recorded runtime proof applies to source commit 3996c62acfeac8c7f367032a61bf95f331ccf1b8 and tree 7d44e28bbbaf9ed0db54d732a3821f1a16604427, not documentation HEAD.
3. Obtain explicit authorization for implementation and exact source edit paths. A checkbox, this plan, local green tests, or RDD status grants no implementation or external-system permission.
4. Take one bounded subpackage, preserve shared-file ownership, run only authorized checks, and report observed evidence, skipped gates, and rollback boundary.

The only BK status ledger is odd/tasks/backend-implementation.md. Recompute status before work; do not maintain parallel status checkboxes here.

## Source documents

- [Current-source reconciliation and verification limits](../backend-audit/post-audit-reconciliation.md)
- [Authoritative business decisions](../backend-plan/02-business-rules-and-decisions.md)
- [Master BK ledger](../../odd/tasks/backend-implementation.md)
- [Frontend/backend contract gaps](../backend-audit/frontend-contract-gaps.md)
- [Backend phase acceptance cards](../backend-plan/04-implementation-phases.md)

## Source baseline and status

Documentation HEAD at planning start: a80e05f20d90fc0f65cc712ae1e502430330f25a, tree b775df59ecfe656d5c38bdf1b61c60fca8c7c9da. Runtime source baseline: 3996c62acfeac8c7f367032a61bf95f331ccf1b8, tree 7d44e28bbbaf9ed0db54d732a3821f1a16604427. Runtime details and limitations are in docs/backend-audit/post-audit-reconciliation.md; retain historical R5 receipts unchanged.

The ledger contains 76 main rows: 18 Done, 18 Partial, and 40 Not started. BK-042-S1 is a separate completed subtask. P0 reconciliation is complete. This is not a percentage-complete claim. The completed main rows are BK-001–009, BK-013, BK-015–018, BK-020, BK-059–061. Do not assign them as unfinished. BK-059/060 are reusable enrollment/device prerequisites; BK-061 ratifies the offline capability matrix but implements no offline queue or sync.

At the source baseline, recorded local proof is API 367 passed/17 skipped/19 warnings; focused FE 24 passed; full FE 578 passed; typecheck/build passed; Alembic head 0030_staff_schedules. This is historical baseline evidence, not fresh package proof, PostgreSQL/hosted CI/browser E2E/security/deployment evidence, or production readiness.

## Package index and primary ownership

Each unfinished main BK row has one primary owner. Cross-package contributions do not transfer that ownership.

| Package | Primary rows | Card |
|---|---|---|
| P1 Identity and transport | BK-010/011/012/058 | [docs/work-packages/P1-identity-and-transport.md](P1-identity-and-transport.md) |
| P2 Member-read contracts | FE05, no exclusive BK | [docs/work-packages/P2-member-read-contracts.md](P2-member-read-contracts.md) |
| P3 Membership, payments, access | BK-023–030 | [docs/work-packages/P3-membership-payments-and-access.md](P3-membership-payments-and-access.md) |
| P4 Shifts and cash | BK-021/022/035 | [docs/work-packages/P4-shifts-and-cash.md](P4-shifts-and-cash.md) |
| P5 Published catalog | BK-019 | [docs/work-packages/P5-published-catalog.md](P5-published-catalog.md) |
| P6 Staff schedules and attendance | BK-031/040 | [docs/work-packages/P6-staff-schedules-and-attendance.md](P6-staff-schedules-and-attendance.md) |
| P7 Local-first and sync | BK-014, BK-062–074 | [docs/work-packages/P7-local-first-and-sync.md](P7-local-first-and-sync.md) |
| P8 Commercial operations | BK-032/033/034/036/037/038/039/041 | [docs/work-packages/P8-commercial-operations.md](P8-commercial-operations.md) |
| P9 External payments | BK-053–057 | [docs/work-packages/P9-external-payments.md](P9-external-payments.md) |
| P10 Notifications, reporting, Gimi | BK-042–047 | [docs/work-packages/P10-notifications-reporting-and-gimi.md](P10-notifications-reporting-and-gimi.md) |
| P11 PostgreSQL and quality proof | Cross-cut verification, no primary BK | [docs/work-packages/P11-postgresql-and-quality-proof.md](P11-postgresql-and-quality-proof.md) |
| P12 Import and release readiness | BK-048–052/075/076 | [docs/work-packages/P12-import-and-release-readiness.md](P12-import-and-release-readiness.md) |

All twelve cards now exist at their linked paths. P2 owns FE05 contract design only; P7 owns all of local-first BK-014. P11 coordinates proof, not import work. BK-029/030 are member access/check-in/sample tasks in P3, not staff tasks. BK-057 is primarily P9's provider/Gimi checkout-link join; P10 contributes identity permission and delivery/UI.

### Coverage by primary owner

- P1: BK-010, BK-011, BK-012, BK-058.
- P2: FE05 only; contributes read contract to P3/P5/P7 without acquiring their BK ownership.
- P3: BK-023, BK-024, BK-025, BK-026, BK-027, BK-028, BK-029, BK-030.
- P4: BK-021, BK-022, BK-035.
- P5: BK-019.
- P6: BK-031, BK-040.
- P7: BK-014, BK-062, BK-063, BK-064, BK-065, BK-066, BK-067, BK-068, BK-069, BK-070, BK-071, BK-072, BK-073, BK-074.
- P8: BK-032, BK-033, BK-034, BK-036, BK-037, BK-038, BK-039, BK-041.
- P9: BK-053, BK-054, BK-055, BK-056, BK-057.
- P10: BK-042, BK-043, BK-044, BK-045, BK-046, BK-047.
- P11: proof coordination only.
- P12: BK-048, BK-049, BK-050, BK-051, BK-052, BK-075, BK-076.

Coverage totals 58 unfinished main rows exactly once; excludes all 18 Done rows and separate BK-042-S1. Recompute if the ledger changes.

## Frontend, staffing and audit follow-up crosswalk

This is a planning crosswalk from the current audit snapshot, not a runtime progress tracker. The FE identifiers remain historical audit labels; assigning their residual does not claim a gap is fixed.

| Audit item | Current audit meaning | Primary package / bounded destination | Contributors / gate |
|---|---|---|---|
| FE03 | Authenticated sessions coexist with demo role/PIN/device state | P1.2/P1.3 | P2/P3/P4/P6 consumers; explicit live/demo split |
| FE04 | Generic errors and uncertain-write reconciliation | P1.3 | P3/P7 typed domain outcomes |
| FE05 | Detail/history/entitlement reads incomplete | P2.1–P2.4 | Current-source IDs/DTO inventory; P3/P5 consumer sign-off at K-02 acceptance, not a prerequisite on P3 implementation; D-020 only for data classified sensitive |
| FE06 | Debt receipts/transfer review UI remains demo-bound | P3.4; P2 read projection contributes | D-013/D-024 policy for disputed consequences |
| FE07 | Shift API exists; opening/closing UI uses demo operations | P4.1–P4.5 | P1 transport, P3/P8 source contracts |
| FE08 | Membership/sample access contract and live checkout assumption | P3.5/P3.6 | P2 IDs and P5 published plan projection |
| FE09 | Staff roster/schedule source exists; live UI linkage and occurrence attendance remain | P6.2–P6.5; P7.7 attendance adapter | P1 authority, P7 receipt/grant substrate; do not equate source existence with live binding |
| FE10 | Inventory foundations exist; POS/refunds and other domains incomplete | P8.1–P8.7 | P3 payment, P4 shift, P9 external reversal |
| FE11 | Immutable plan publication exists; owner editor is local/demo-bound | P5.1–P5.4 | P2 member read and P3 purchase contracts |
| FE12 | Offline, provider, reporting, notification and Gimi cross-stack work remains | P7, P9, P10; proof/release P11/P12 | Specific contracts and permissions; not one mega-package |
| STAFF-1 residual | Schedule/occurrence implementation evolved; CPU/query bounds and remaining acceptance not fully proven | P6.1 | D-032 independent branch profiles; E02 remains partial |
| STAFF-2 | Occurrence-linked online attendance and corrections | P6.2/P6.3 | P1 principal/branch authority |
| STAFF-3 | Offline attendance adapter | P6.5 + P7.7-attendance | P7 queue/grant/receipt milestones; no queue duplicate in P6 |
| H01 | Migration/concurrency hypothesis, not a verified defect | P11.2/P11.3 | Disposable authorized PG target only |
| H02 | Owner/catalog behavior hypothesis, not a verified defect | P5.1/P5.2 | Do not label a bug absent a reproduction |
| H03 | Member-status/eligibility policy question | P3.4/P3.5 | Business decision required for affected outcome only |
| E01 | CI selection/head derivation changed; hosted run remains unproven | P11.4/P12.6 | Hosted execution separately authorized |
| E02 | Recurrence bounds/benchmark evidence partial | P6.1/P11.4 | Local synthetic benchmark can be specified; no truncation of correctness |
| E03 | Private-file classification/ignore/cleanup | Outside these packages | Separate explicit owner permission; no workbook/notebook access or cleanup from this plan |

## Decision gates and exact ownership

The decision register remains authoritative. A confirmed rule is not reopened as a question; a pending item gates only the affected subdelivery where safe isolation exists. “Next question” is for the eventual owner to route to the business decision-maker if that work slice cannot proceed, not a request to answer now.

| Gate | Current status | Affected owner/slices | Next question or action when that slice is selected |
|---|---|---|---|
| D-013 | Partial | P3.4; P10.4 disputed report categories | Ask the owner to define remaining broader credit/access behavior; keep already-decided warnings distinct from denial. |
| D-014 | Partial | P4.3/P4.4; P8.8; P10.4 | Ask only for unsettled discrepancy/expense attribution; do not delay unrelated cash/event inventory. |
| D-015 | Unresolved | P8.1/P8.2/P8.3 stock mutation and valuation | Decide valuation, negative stock, adjustment and concurrency semantics before those writes. |
| D-016 | Scope confirmed; permissions unresolved | P10.1/P10.3/P10.6/P10.7; P9.5 join | Confirm Gimi/notification identity, permissions, allowed actions/content and delivery destination before any account or recipient operation. |
| D-017 | Unresolved | P9.1/P9.2/P9.3/P9.5 | Bind provider/merchant contract and permitted channel before implementation; official docs reading is not account execution permission. |
| D-018 | Unresolved | P12.1/P12.2/P12.4 | Approve provenance, mapping/cutover rules before any real-source import; synthetic planning may continue. |
| D-019 | Confirmed | P3.6 | Apply paid-single-entry rule; do not re-ask or broaden sample use. |
| D-020 | Unresolved for sensitive data classification/access/retention | P2 sensitive history; P1 redaction/retention; P10 payloads; P12 import fields | Classify only affected fields/data and decide their access/retention/export; minimal permitted profile reads are not blanket-blocked. |
| D-021 | Confirmed scope | P9 channel availability/P3 checkout | Both required payment channels remain in scope; provider execution still needs separate permission. |
| D-022 | Confirmed | P3 member matching; P9.5/P10.2 renewal link | Match only exact verified phone; no loose phone guess. |
| D-023 | Unresolved | P9.4 | Decide cross-channel collision/one-winner rule before settlement implementation. |
| D-024 | Unresolved | P3.4/P3.5; P8.6; P9.3/P9.4 | Decide only the affected expiry, late/partial payment and monetary reversal consequence before that state transition. |
| D-025 | Unresolved | P1.4/P1.2 Admin recovery/provisioning | Confirm recovery, expiry, MFA and provisioning behavior before expanding current bounded recovery. |
| D-026 | Confirmed architecture | P7.1–P7.8 | Use store-and-forward architecture; this does not authorize new offline operation classes. |
| D-027 | Confirmed operation classes | P7.7 adapters, P9 | Apply approved class per action; external payment/provider attempts stay online-only. |
| D-028 | Unresolved | P7.5/P7.6, P6.5 | Decide stale-grant/revocation consequence before offline rights implementation. |
| D-029 | Unresolved | P12.3/P12.5, P11 target proof | Decide backup retention/RPO/RTO before objectives or real backup operations; none are inferred. |
| D-030 | Unresolved | P7.2/P7.5/P12.5 | Decide local retention/quota/device-loss recovery before destructive cleanup or loss claims. |
| D-031 | Confirmed | P3.4/P3.5 and P2 projection | Apply documented member-balance/access behavior; no re-ask. |
| D-032 | Confirmed | P6.1–P6.5 | Branch roster profiles are independent; no global link/dedup/cross-branch overlap check. Same-profile checks remain. |
| D-033 | Confirmed | P6.3/P6.5/P7.4/P7.6 | Preserve replay/clock integrity rules; no re-ask. |

## Cross-package contract registry

Contract records are proposed interface artifacts until accepted by the named signers. Each must be versioned/additive, state null/unknown/error meanings, and have synthetic contract fixtures. Each `K-xx` node below is a separate draft/acceptance checkpoint; implementation nodes depend on the accepted node, never on informal prose or whole-package completion. This registry gives each handoff a producer and consumer; it does not assert that every named route or API already exists.

| Contract | Status and producer | Consumer(s) | Required fields/invariants and security | Version / synthetic acceptance / signer |
|---|---|---|---|---|
| C-01 Principal and typed transport | Existing auth/session/request-ID seams; proposed acceptance in P1.1/P1.3 | P2.3; P3; P4; P6; P8/P10 | Server-resolved actor, role/action and organization/branch scope; typed status/code/request ID; no client role authority or secret logging | Additive schema; invalid/revoked/insufficient-scope fixtures; P1 + API integrator |
| C-02 Member read projection | Proposed P2.2 | P3.5/P3.6, P5.3, P7.3 | Stable member/period/entitlement IDs, role projection, bounded pagination; org-shared minimal profile allowed under D-001/D-012, branch transactions/history/visits remain scoped | Versioned DTO; same-org shared profile and unauthorized-record fixtures; P2 + P1 + domain consumers |
| C-03 Internal order/payment/access | Existing partial sales; proposed P3.2 | P4.3, P5.3, P8.2a/P8.2b/P8.6, P9.1–4, P10.4 | Stable order/payment/item IDs, immutable quote/snapshot, idempotency, explicit pending/accepted/unknown/refunded states; pending != received revenue | Additive states; replay and unknown-response fixtures; P3 + P5 + P1 |
| C-04 Published plan snapshot | Existing versioned catalog; proposed accepted P5.2 | P3.2/P3.3, P5.3, P9.2/P9.5 | Immutable selected version/price/terms ID; server revalidates publication; no client-priced authority | Versioned snapshot; publish/change-after-quote fixture; P5 + P3 |
| C-05a Register/opening snapshot | Existing partial shift API; proposed P4.2 | P8.2a/P4.4 | Register/branch/shift IDs, opening snapshot identity, actor/time; branch scope enforced | Versioned contract; wrong-branch/stale-snapshot synthetic fixture; P4 + P1 |
| C-05b Shift cash-source projection | Proposed P4.3 | P4.4/P8.8/P10.4 | Source completeness and tender classification; absent != zero and transfers != cash | Versioned projection; missing source/pending transfer fixtures; P4 + P3/P8 contributors |
| C-06 Stock movement | Existing inventory foundation; proposed P8.1a | P8.1b/P8.2a/P8.3/P8.6, P4.3, P7.7-stock, P10.4 | Immutable movement ID, product/branch, signed quantity/unit, source/reason, actor/time/revision; no second writer | Additive event; duplicate/conflict/concurrent revision fixtures; P8 stock owner + consumers |
| C-07 Staff occurrence attendance | Existing schedule/attendance seams; proposed P6.2 | P6.3/P6.4/P6.5, P8.8, P10.4, P7.7-attendance | Roster profile + occurrence ID, raw capture and server receipt times, actor/device, replay key, review state; profiles independent by branch | Versioned event; same-profile overlap and cross-branch-independence fixtures; P6 + P1 |
| C-08 Offline envelope/receipt | Proposed P7.1/P7.4 | P7.2–7.7, P6.5, P8 stock adapter | Stable event/device/grant/branch/schema/idempotency IDs; `pending/accepted/rejected/unknown`; server revalidates grant; no grant implies provider authority | Versioned envelope; restart/replay/lost-response/branch-switch fixtures; P7 + P1 + domain producer |
| C-09 Provider attempt/settlement result | Proposed P9.1–P9.3 | P3 settlement; P9.4/P9.5; P10.2 | Internal attempt/order IDs, provider reference, typed state, authenticated callback identity/time; one internal settlement, no raw credential/body exposure | Provider-specific version after official contract validation; duplicate/out-of-order/unknown fixture; P9 + P3 |
| C-10 Gimi identity/permission | Proposed P10.1 | P9.5, P10.6, P10.2/P10.7 | Verified member identity (D-022), explicit purpose/role/action/consent and disclosure; no direct DB bypass or loose match | Additive allowlist version; denied/ambiguous/unverified fixtures; business owner + P10 + P1 |
| C-11 Outbox/delivery result | Proposed P10.3 | P10.7, P12.6 | Redacted notification ID, approved destination reference, idempotency and queued/sent/failed/unknown state; delivery never silently duplicates | Versioned state; lost response/retry/redaction fixture; P10 + authorized destination owner |
| C-12 Report definition/projection | Proposed P10.4 | P10.5, P12.6 | Formula/version, date window, branch scope, source IDs and reconciliation; pending money excluded from collected revenue | Versioned definition; reconciliation/missing-source fixture; P10 + P3/P4/P8 signers |
| C-13 Import provenance/dry-run | Proposed P12.1/P12.2 | P12.4/P12.6 | Mapping version, source classification, synthetic input identity, accepted/rejected counts, reconciliation and no-write mode | Versioned mapping; deterministic synthetic fixture; P12 + data owner (real data separately gated) |
| C-14 Proof record | Proposed P11.1/P11.4 | P12.6/P12.7 and package owners | Commit/source baseline, exact command, environment boundary, raw result counts, skips/failures, evidence class and owner | Candidate-specific record; no fabricated pass; P11 + candidate owner |
| C-15 POS command/result | Proposed P8.2a | P8.2b, P4.3, P8.3, P10.4 | Stable POS request/order/line/event IDs, register/shift/branch, product and quantity, server-accepted price/snapshot, idempotency and unknown result; order/payment/stock effects are one DB transaction | Versioned contract; duplicate/changed key, stale/missing stock, rollback and unknown-response fixtures; P8 + P3/P4 + integrator |
| C-16 BK-029/BK-031 integration boundary | Proposed read-only P6.7 using P3.1/P6.1 evidence | P3.7/P6.6 final integration closure only | Record the concrete shared auth/actor/branch/event seam if evidence supports one, otherwise the exact legacy-policy gap and ledger-owner follow-up; member entry does not acquire a staff-attendance prerequisite, and staff profiles remain independent across branches | Proposed decision record with source/ledger citations, producer-consumer direction, unresolved owner question and synthetic contract fixture only if a shared runtime seam is accepted; P3 + P6 + P1 auth reviewer |

### Separate contract-draft and acceptance nodes

| Node | Contract | Draft producer | Acceptance/signers | Unblocks (specific consumer nodes) |
|---|---|---|---|---|
| K-01 | C-01 principal/transport | P1.1/P1.3 | P1 owner + API integrator; consumer owners confirm fields | P1.2, P2.3, P3.2, P4.2, P6.3, P7.1, P9.1, P10.5 |
| K-02 | C-02 member read projection | P2.2 | P2 + P1 + P3/P5 consumer reviewers | P2.3, P3.5, P3.6, P5.3, P7.3 |
| K-03 | C-03 internal order/payment/access | P3.2 | P3 + P1 + P5 | P3.3, P4.3, P5.3, P8.2a, P9.1, P9.2, P10.4 |
| K-04 | C-04 published plan snapshot | P5.2 | P5 + P3 | P3.2, P5.3, P9.2 |
| K-05a | C-05a register/opening snapshot | P4.2 | P4 + P1 | P4.4, P8.2a |
| K-05b | C-05b accepted cash-source projection | P4.3 | P4 + P3/P8 source contributors | P4.4, P8.8, P10.4 |
| K-06 | C-06 stock movement | P8.1a | P8 stock owner + P4/P7/P10 consumers | P8.1b, P8.2a, P8.3, P7.4, P7.7-stock, P10.4 |
| K-15 | C-15 online POS command/result | P8.2a | P8 + P3 + P4 + integration owner | P8.2b, P8.3, P4.3, P10.4 |
| K-07 | C-07 staff occurrence attendance | P6.2 | P6 + P1 + P7/P8/P10 consumers | P6.3, P6.4, P6.5, P7.4, P8.8, P10.4 |
| K-08 | C-08 offline envelope/receipt | P7.1/P7.4 | P7 + P1 + event producer owners | P7.2, P7.3, P7.4, P7.5, P6.5, P7.7-attendance, P7.7-stock |
| K-09 | C-09 provider attempt/settlement result | P9.1–P9.3 | P9 + P3 internal settlement owner; official provider semantics verified when authorized | P9.4, P9.5, P10.2 |
| K-10 | C-10 Gimi identity/permission | P10.1 | Business permission owner + P10 + P1 security reviewer | P9.5, P10.2, P10.6, P10.7 |
| K-11 | C-11 outbox/delivery result | P10.3 | P10 + separately authorized destination owner | P10.7, P10.8 |
| K-12 | C-12 report definition/projection | P10.4 | P10 + P3/P4/P8 source owners | P10.5, P10.8, P12.6 |
| K-13 | C-13 import provenance/dry-run | P12.1/P12.2 | P12 + data owner; synthetic-only acceptance does not authorize real data | P12.4, P12.6 |
| K-14 | C-14 proof record | P11.1/P11.4 | P11 + candidate owner; evidence class and skips acknowledged | P12.6, P12.7 |
| K-16 | C-16 BK-029/BK-031 integration boundary | P6.7 with P3.1/P6.1 evidence | P3 + P6 owners and P1 auth reviewer; ledger owner resolves any business-policy gap | P3.7, P6.6 final integration closure only; does not gate independent online implementation |

Acceptance means named signers confirm required fields, invariants, version, error/unknown meanings, data class, synthetic fixture and rollback/compatibility behavior. If a required signer is unavailable, the downstream implementation remains contract-blocked; no worker can self-approve an interface it consumes.

## Machine-readable subdelivery dependency edges

Each row is one directed prerequisite edge between exact node IDs defined by package tables above. A row means the consumer waits for the named deliverable or accepted contract, not for the producer's whole package. `gate` text is an acceptance condition and never implies access permission. Keep this table synchronized with card IDs; D4 structural check validates every endpoint and topological order.

| From node | To node | Required output/condition |
|---|---|---|
| P1.1 | P1.2 | Principal/scope contract |
| P1.1 | P1.3 | Typed transport contract |
| P1.1 | P1.4 | Current recovery boundary |
| P1.1 | P1.5 | Local observability/CI definition |
| P1.1 | P2.2 | Principal field contract |
| P1.1 | P6.2 | Actor/time boundary |
| P2.1 | P2.2 | Current/absent field inventory |
| P2.2 | P2.3 | Accepted read projection |
| P1.1 | P2.3 | Protected authority |
| P2.3 | P2.4 | Read DTO / errors |
| P2.4 | P2.5 | Candidate consumer |
| P3.1 | P3.2 | Existing ID/transaction inventory |
| P5.2 | P3.2 | Immutable plan snapshot contract |
| P1.1 | P3.2 | Actor and branch authority |
| P3.2 | P3.3 | Sale/idempotency contract |
| P3.1 | P3.4 | Existing debt state inventory |
| P3.2 | P3.5 | Stable order/period linkage |
| P2.2 | P3.5 | Readable IDs |
| P3.5 | P3.6 | Entitlement state |
| P2.2 | P3.6 | Member identifiers |
| P3.3 | P3.7 | Internal sale output |
| P2.1 | P5.2 | Catalog inventory |
| P1.3 | P5.2 | Authenticated transport |
| P2.2 | P5.3 | Member projection |
| P3.2 | P5.3 | Order/snapshot/idempotency |
| P5.2 | P5.3 | Published-version contract |
| P5.3 | P5.4 | Accepted UI contract |
| P5.4 | P5.5 | Candidate UI |
| P6.1 | P6.6 | Residual acceptance evidence |
| P3.1 | P6.7 | Existing member check-in actor/branch/event and ledger inventory; no P3 implementation prerequisite |
| P6.1 | P6.7 | Existing staff occurrence/actor/branch/event and residual inventory; no P6 implementation prerequisite |
| P6.7 | K-16 | Proposed C-16 evidence-based boundary or named unresolved-policy record |
| K-16 | P3.7 | Accepted boundary for final reciprocal BK-029/BK-031 integration handoff; independent online P3 work remains unblocked |
| K-16 | P6.6 | Accepted boundary for final reciprocal BK-029/BK-031 proof handoff; independent online P6 work remains unblocked |
| P6.2 | P6.3 | Occurrence linkage contract |
| P1.1 | P6.3 | Server authority |
| P6.2 | P6.4 | Attendance DTO |
| P1.3 | P6.4 | Transport errors/session |
| P7.1 | P6.5 | Offline envelope |
| P7.4 | P6.5 | Ingestion receipt |
| P7.6 | P6.5 | Unknown/replay resolution |
| P6.3 | P6.6 | Candidate API |
| P6.4 | P6.6 | Candidate UI |
| P6.5 | P6.6 | Adapter contract |
| P1.1 | P7.1 | Actor/device scope |
| P7.1 | P7.2 | Envelope schema |
| P7.1 | P7.3 | Event identity/version |
| P1.1 | P7.3 | Grant scope |
| P2.2 | P7.3 | Bootstrap projection |
| P7.1 | P7.4 | Envelope contract |
| P7.3 | P7.4 | Cursor/grant contract |
| P3.2 | P7.4 | P3 event envelope |
| P4.3 | P7.4 | P4 event envelope |
| P6.2 | P7.4 | P6 event envelope |
| P7.2 | P7.5 | Durable queue |
| P7.4 | P7.5 | Receipt semantics |
| P7.5 | P7.6 | Flush/reconciliation state |
| P7.4 | P7.6 | Server receipt lookup |
| P7.6 | P7.7-attendance | Safe adapter/replay API |
| P7.6 | P7.7-stock | Safe adapter/replay API |
| P6.2 | P7.7-attendance | Attendance event contract |
| P7.7-attendance | P7.8 | Local adapter candidate |
| P7.7-stock | P7.8 | Local adapter candidate |
| P4.1 | P4.2 | Event-source inventory |
| P1.1 | P4.2 | Actor/register scope |
| P4.2 | P4.3 | Opening/shift contract |
| P3.2 | P4.3 | Payment event fields |
| P4.3 | P4.4 | Accepted projection |
| P4.2 | P4.4 | Opening snapshot |
| P4.4 | P4.5 | Close DTO |
| P1.3 | P4.5 | Shared transport |
| P4.5 | P4.6 | Candidate FE proof |
| P5.1 | P5.2 | Current live/demo inventory |
| P3.2 | P8.2a | Internal order/payment contract |
| P4.2 | P8.2a | Register/shift contract |
| P1.3 | P8.4 | Transport boundary |
| P8.5 | P8.6 | Rental/asset identity |
| P3.3 | P8.6 | Internal reversal contract where applicable |
| P9.3 | P8.6 | Provider refund status where applicable |
| P8.5 | P8.7 | Rental UI DTO |
| P8.6 | P8.7 | Return/refund states |
| P6.3 | P8.8 | Attendance evidence input |
| P4.3 | P8.8 | Cash/expense projection contract |
| P1.1 | P9.1 | Principal and branch scope |
| P3.2 | P9.1 | Payment/order contract |
| P4.2 | P9.1 | Register/shift context |
| P3.2 | P9.2 | Quote/order contract |
| P5.2 | P9.2 | Published plan snapshot |
| P9.1 | P9.3 | Point attempt contract |
| P9.2 | P9.3 | Checkout contract |
| P3.2 | P9.3 | Internal settlement boundary |
| P9.3 | P9.4 | Verified provider-state inputs |
| P3.2 | P9.4 | Settlement method |
| P10.1 | P9.5 | Gimi identity/permission contract |
| P9.2 | P9.5 | Link capability |
| P9.3 | P9.5 | Link status/callback result |
| P9.2 | P9.6 | Synthetic provider-contract fixture |
| P9.3 | P9.6 | Callback/reconciliation candidate |
| P10.1 | P10.2 | Approved disclosure/identity |
| P9.5 | P10.2 | Typed renewal link |
| P10.1 | P10.3 | Purpose/redaction contract |
| P10.3 | P10.7 | Outbox state |
| P10.1 | P10.6 | Tool/action allowlist |
| P3.2 | P10.6 | Service-owned transaction action |
| P3.2 | P10.4 | Payment event/source fields |
| P4.3 | P10.4 | Shift/cash event fields |
| P10.4 | P10.5 | Report definition/DTO |
| P1.1 | P10.5 | Role authorization |
| P10.2 | P10.8 | Renewal join candidate |
| P10.3 | P10.8 | Notification candidate |
| P10.4 | P10.8 | Report candidate |
| P10.6 | P10.8 | Gimi action candidate |
| P10.7 | P10.8 | UI candidate |
| P11.1 | P11.2 | Safe local harness rules |
| P11.2 | P11.4 | Graph/test result envelope |
| P11.3 | P11.4 | Explicitly authorized PG result only; otherwise pending |
| P11.4 | P12.6 | Candidate evidence classification |
| P2.2 | P12.1 | Member field schema |
| P3.2 | P12.1 | Order/financial schema |
| P5.2 | P12.1 | Catalog schema |
| K-06 | P12.1 | Stock schema |
| P12.1 | P12.2 | Mapping version |
| P12.2 | P12.4 | Synthetic validation report |
| P12.3 | P12.4 | Recovery/rehearsal design |
| P7.6 | P12.5 | Queue receipt states |
| P12.3 | P12.5 | Approved backup objective before execution |
| P9.6 | P12.6 | Provider evidence class |
| P10.8 | P12.6 | Service/report evidence class |
| P12.5 | P12.6 | Recovery evidence or pending gate |
| P7.8 | P12.7 | Offline reliability evidence |
| P11.3 | P12.7 | Authorized PG proof or explicit pending state |
| P12.5 | P12.7 | Recovery procedure |

| From node | To node | Required output/condition |
|---|---|---|
| P1.1 | K-01 | Principal/scope draft |
| P1.3 | K-01 | Typed transport draft |
| K-01 | P1.2 | Accepted authority boundary |
| K-01 | P2.3 | Protected read authorization |
| K-01 | P3.2 | Actor/branch contract accepted |
| K-01 | P4.2 | Register/actor scope accepted |
| K-01 | P6.3 | Server authority accepted |
| K-01 | P7.1 | Device/grant scope accepted |
| K-01 | P9.1 | Provider attempt actor scope accepted |
| P2.2 | K-02 | Member projection draft from P2.1/current-source IDs; P3/P5 contribute consumer review at acceptance, not an implementation prerequisite |
| K-02 | P2.3 | Accepted DTO and privacy projection |
| K-02 | P3.5 | Stable entitlement IDs |
| K-02 | P3.6 | Stable member/entitlement IDs |
| K-02 | P5.3 | Shared profile/read projection |
| K-02 | P7.3 | Bootstrap read projection |
| P3.2 | K-03 | Internal order/payment draft |
| K-03 | P3.3 | Accepted internal sale semantics |
| K-03 | P4.3 | Accepted source-event fields |
| K-03 | P5.3 | Accepted purchase-screen mutation outcome |
| K-03 | P8.2a | Accepted internal order/payment contract |
| K-03 | P9.1 | Internal settlement boundary |
| K-03 | P9.2 | Immutable internal quote |
| K-03 | P10.4 | Source-state classification |
| P5.2 | K-04 | Published-version draft |
| K-04 | P3.2 | Accepted selected-plan snapshot |
| K-04 | P5.3 | Published version accepted |
| K-04 | P9.2 | Quote snapshot accepted |
| P4.2 | K-05a | Shift snapshot/register draft |
| K-05a | P4.4 | Accepted opening/register contract |
| K-05a | P8.2a | Register/shift interface accepted |
| P4.3 | K-05b | Cash projection draft |
| K-05b | P4.4 | Accepted source-completeness contract |
| K-05b | P8.8 | Cash/expense event projection accepted |
| K-05b | P10.4 | Shift event source accepted |
| P8.1a | K-06 | Stock event draft before mutation work |
| K-06 | P8.1b | Accepted contract before ledger mutation |
| K-06 | P8.2a | Stock interface contract input accepted |
| P8.2a | K-15 | POS command/result draft |
| K-15 | P8.2b | Accepted contract before POS mutation |
| K-15 | P4.3 | POS cash event contract accepted |
| K-15 | P8.3 | Product/order event contract accepted |
| K-15 | P10.4 | POS event source contract accepted |
| P8.2b | P8.4 | POS API result accepted |
| K-06 | P8.3 | Conversion event contract accepted |
| K-06 | P7.4 | Stock ingestion envelope accepted |
| K-06 | P7.7-stock | Stock adapter contract accepted |
| K-06 | P10.4 | Stock source definition accepted |
| P6.2 | K-07 | Attendance occurrence draft |
| K-07 | P6.3 | Occurrence linkage contract accepted |
| K-07 | P6.4 | Attendance DTO accepted |
| K-07 | P6.5 | Adapter event accepted |
| K-07 | P7.4 | P6 event envelope accepted |
| K-07 | P8.8 | Attendance input accepted |
| K-07 | P10.4 | Attendance source accepted |
| P7.1 | K-08 | Envelope draft |
| K-08 | P7.2 | Local envelope/schema accepted |
| K-08 | P7.3 | Bootstrap version accepted |
| K-08 | P7.4 | Ingestion envelope accepted |
| K-08 | P7.5 | Grant/receipt state accepted |
| K-08 | P6.5 | Staff offline contract accepted |
| K-08 | P7.7-attendance | Adapter/receipt interface accepted |
| K-08 | P7.7-stock | Adapter/receipt interface accepted |
| P9.1 | K-09 | Point attempt draft |
| P9.2 | K-09 | Hosted checkout draft |
| P9.3 | K-09 | Callback/reconciliation draft |
| K-09 | P9.4 | Provider state accepted; D-023 gate still applies |
| K-09 | P9.5 | Typed provider link/status accepted |
| K-09 | P10.2 | Consumer uses typed link result |
| P10.1 | K-10 | Gimi identity/permissions draft |
| K-10 | P9.5 | Provider-link identity/permission accepted |
| K-10 | P10.2 | Disclosure/consent contract accepted |
| K-10 | P10.6 | Tool/action allowlist accepted |
| K-10 | P10.7 | Notification/Gimi display policy accepted |
| P10.3 | K-11 | Outbox/delivery result draft |
| K-11 | P10.7 | Delivery state contract accepted |
| K-11 | P10.8 | Outbox proof candidate |
| P10.4 | K-12 | Report definition draft |
| K-12 | P10.5 | Report DTO/formula accepted |
| K-12 | P10.8 | Report proof candidate |
| K-12 | P12.6 | Report evidence scope accepted |
| P12.2 | K-13 | Synthetic import mapping/dry-run contract |
| K-13 | P12.4 | Rehearsal mapping accepted |
| K-13 | P12.6 | Import readiness evidence scope |
| P11.1 | K-14 | Local test proof protocol |
| P11.4 | K-14 | Candidate evidence record draft |
| K-14 | P12.6 | Proof evidence class accepted |
| K-14 | P12.7 | Proof status explicit, including pending PG lane |

| From node | To node | Required output/condition |
|---|---|---|
| P8.1b | P8.3 | Movement ledger implementation for conversion |

### Valid first-wave lanes and assignment examples

“Can start” means bounded inventory/contract work only where stated; it is not implementation authorization. Contract acceptance and implementation are separate assignment nodes. The DAG above allows these independent starts:

| Lane | Safe first slice | What it does not wait for | Remaining gate |
|---|---|---|---|
| Identity | P1.1 inventory/contract | Domain implementations | P1.2+ source changes need exact paths/authorization; D-025 gates recovery expansion |
| Member reads | P2.1/P2.2 inventory/DTO design | P1 code completion or P3 package completion | P2.3 protected endpoint requires accepted P1 principal and explicit authorization |
| Staff | P6.1 residual acceptance, P6.2 contract design, and read-only P6.7 ledger-dependency analysis from P3.1/P6.1 evidence | P3 implementation or P7 completion | Attendance implementation requires P1 authority; STAFF-3 waits P7; C-16/K-16 is only for final BK-029/BK-031 integration closure; D-032 is fixed, not a gate |
| Proof | P11.1 local proof protocol and P11.2 graph-only review | A PG target | P11.3 needs a named disposable target and explicit operation/session permission |
| Catalog | P5.1 live/demo inventory | P2/P3 implementation | Purchase UI waits only on accepted P2/P3 contracts |

Example with **two people**: person A is the coordinator/integrator and drafts P1.1; person B drafts P2.1/P2.2. No shared client or route registration is edited. At acceptance, A signs C-01 and B signs C-02; P2.3 remains blocked until P1.2 authority is accepted.

Example with **three people total**: one person serves as integrator while drafting P1.1/P1.3; the other two draft P6.1/P6.2 and P11.1/P11.2. The integrator reserves shared runtime files but does not edit them during contract drafting. P6.3/P2.3 and PG proof remain gated.

Example with **four people total**: one person is named integrator and drafts P1 contract inventory; the other three handle P2 read-contract design, P6 schedule/attendance residuals, and P11 local proof prep. Shared route/model/migration/lock/ledger changes remain serialized for that integrator after exact reservation. This is the maximum recommended first-wave parallelism; it does not imply three implementation lanes are unblocked.

## Assignment and worktree handoff checklist

Effort estimates are relative S/M/L slices, not calendar commitments; re-estimate after the selected contract, exact path set and gates are known.


Before delegating one row, coordinator and assignee record: package/subdelivery ID; exact task purpose; baseline commit/tree; accepted upstream contracts and signer; primary BK owner/contributors; exact candidate path subset copied from its card; named shared-file integrator and reservation response; local/decision/contract/permission/proof readiness; allowed synthetic fixtures; exact planned commands and safety environment; stop conditions; rollback boundary; expected report template. If any field is unknown, assign a read-only contract/inventory task or ask the relevant owner; do not fill gaps with guessed policy.

A future isolated worktree is a human-approved operational choice, not granted by this plan. Use a home-directory sibling under the repository parent, initialize its own CodeGraph index, and never reuse another checkout's index. Multiple worktrees isolate bytes but do not resolve shared-file or financial semantic conflicts: same API sales query, model, migration, test fixture, or UI route still requires named reservation/serialization. Domain workers submit a patch proposal for shared integration files; package completion remains pending until integrator accepts and verifies that patch.

For future code work, use a meaningful deterministic RED when an existing/runnable test has an expected outcome; then GREEN and refactor. Contract-only documentation and unavailable/permission-gated checks are not fabricated RED tests. Each handoff reports exact commands/results, failed/skipped/pending checks, evidence class, changed paths, accepted contract version, open decisions, ownership handoffs, and rollback trigger. “Done” means only that selected row's acceptance is observed and the integrating consumer has a path to verify it; it does not mean the whole BK row/package is Done if a named contributor remains.

## Standard copyable delegation brief

> **Task:** `<package/subdelivery ID>` — `<one deliverable>` only. **Purpose:** `<one-sentence outcome>`. **Baseline:** `<commit/tree>`; read its package card, primary BK row, decision rows, and producer/consumer contract. **Primary ownership:** `<BK row or cross-cut only>`; **contributors:** `<IDs>`. **Candidate path subset (copy verbatim from this card's selected row):** `<exact existing paths>`; **proposed new files:** `<exact filenames, explicitly proposed>`; **shared handoff/exclusions:** `<integrator and paths>`. This plan does not authorize implementation: obtain separate explicit approval for exact paths, target, operations and session before source/external work. **Readiness:** `<local/contract/decision/permission/proof>` with named blockers. Use synthetic fixtures only; no private data, ambient credentials, provider/network, PG, hosted CI, production or release unless separately authorized. **Acceptance:** `<selected row's observable checks>`; **rollback:** `<exact additive slice and recovery trigger>`. Return task ID, contract/version/signers, changed paths, exact commands and outcomes, failures/skips/pending gates, evidence class, risks, rollback, and integrator handoff. Stop on any unapproved decision, unreserved shared file, scope expansion, unsafe DB/network fallback, or path outside the authorized set.

## Package-specific brief selection

Every package card's assignment brief now requires the coordinator to select one concrete subdelivery row and copy that row's exact candidate path subset and shared-file reservation into the standard brief. A package-level assignment without a subdelivery ID and exact path set is incomplete; the assignee must not derive a wider surface from examples elsewhere in a card.

## Readiness vocabulary

Assign readiness per subdelivery, never as a blanket package label:

- Local-ready: can be specified/tested with local code and synthetic data; implementation still needs explicit authorization.
- Contract-blocked: waits for another package's API/event/projection contract; independent contract drafting may proceed.
- Decision-blocked: waits for owner-approved policy; do not invent a default.
- Permission-blocked: needs explicit authorization for a remote/provider, disposable database, private source, deployment, or external destination.
- Proof-pending: implementation may exist, but a required evidence class was not run or is unavailable.

A gate blocks only affected behavior where safe isolation is possible. A local-ready design and permission-blocked production proof can coexist.

## Dependency graph: milestones, not whole-package cycles

P1 auth/session boundary
- P1.1 contract supports P2 protected read implementation (P2 contract design can start now).
- P1 supports P3 protected member transactions/access.
- P1 supports P4 shift server/UI boundary.
- P1 supports P5 authorized catalog UI.
- P1 supports P6 staff schedule/attendance residuals.
- P1 supports P10 outbox actor authorization.

P2 shared member-profile/read projection contract -> the minimum P3/P5 member consumer and P7 bootstrap projection. D-001/D-012 do not make cash, stock, visits or branch transactions organization-wide.
P1 actor/branch contract + P5 published-plan snapshot + P2 stable IDs -> P3 internal order/payment/access slices. P3.3 internal sale does not wait for unresolved P3.4 debt semantics; P9 owns external provider adapters, and P7 owns offline queuing.
P4.2 opening/register contract + P3.2 purchase contract + P5.2 published-plan contract are the handshake inputs to P8 online POS contract/implementation. P8's minimal stock/payment event schema is a separately reviewable contract output; it feeds P4.3 cash projection without requiring P8 online POS implementation first. Thus the apparent P4/P8 reciprocal dependency is contract-first and the implementation edge is acyclic.
P2 stable profile/read contract + P3.2 order/snapshot/idempotency contract -> P5 member purchase UI; P5.2 published-plan and P3.2 order contracts are aligned at a named handshake before either dependent implementation, so neither package waits on the other's full completion. The UI contribution does not own P2/P3 API or transaction logic.
P3 order/payment/access + P4 shift + P5 published catalog contracts -> P8 POS lanes. P8 online POS may proceed without P7; only P8 offline stock reconciliation waits for P8 stock-event IDs and P7 ingestion/replay milestones.
P6 occurrence-attendance contract -> P7 offline staff adapter.
P1 + stable domain command contracts -> P7 queue/bootstrap -> ingestion/receipts/deltas -> grants/retry/conflict states -> per-domain offline adapters.
P3 order contract + decisions/permission -> P9 provider lanes.
P10.1 Gimi identity/permission contract -> P9.5 provider link capability -> P10.2 delivery/UI join. P10.3 outbox and P10.4 report definitions are separate source/permission lanes; P10.5 report UI and P10.7 Gimi/notification UI depend only on their matching accepted DTOs.
P3/P4/P8 source events -> P10.4 reporting contract -> P10.5 report integration. P10.6 Gimi domain actions depend on P10.1 and the specific owning service contract.
P8/P9/P10 evidence + P7/P1 proof + D-029 decision -> P12 readiness.
P11 local proof preparation runs alongside; package PostgreSQL checks require an authorized target.

Resolve P9/P10's Gimi join as distinct milestones, not mutual whole-package dependency: P10.1 supplies approved identity/permission contract; P9.5 supplies the provider checkout-link operation and settlement result; P10.2 consumes that typed result for delivery/UI. Provider work can proceed independently of the Gimi join where allowed. The dependency is acyclic: P10.1 -> P9.5 -> P10.2.

The BK ledger expresses reciprocal integration dependencies between BK-029 and BK-031. Preserve those rows while separating milestones: existing member-flow inventory (P3.1) and staff residual inventory (P6.1) feed the read-only P6.7 analysis; its proposed C-16 boundary is accepted at K-16; P3.7/P6.6 consume that record for final integrated closure. This join does not assert that staff attendance is needed for member entry, merge identities, or block independent online member/staff implementation. If evidence shows no shared runtime seam, record the evidence and the specific legacy-policy gap for the ledger owner; do not silently remove a reciprocal dependency.

P7 internal order is durable client envelope/queue; bootstrap/cursor projection; authenticated ingestion and idempotent receipts/deltas; scoped grants/flush/multitab; unknown-result resolution; then domain adapters. P6's offline attendance adapter waits only for the named P7 envelope/ingestion/replay contracts; P8 stock reconciliation waits only for its stock event contract plus P7 ingestion/replay. P3/P4 online behavior does not wait for P7. Offline infrastructure progress alone does not make every operation safe offline.

## Decisions and safety gates

The authoritative register is docs/backend-plan/02-business-rules-and-decisions.md.

- Confirmed by user: D-019 paid single-entry sample; D-021 both payment channels required (scope only); D-022 verified WhatsApp phone match; D-026/D-027 store-and-forward architecture and operation classes; D-031 member balance/access behavior; D-032 staff recurrence/attendance with branch-independent profiles; D-033 replay and clock integrity.
- Confirmed/documented but not fully permissioned: D-016 Gimi/notifications are in scope; tool permissions/content disclosure remain unresolved.
- Partially resolved: D-013 broader credit/access policy; D-014 general reporting/discrepancy attribution beyond the ratified cash/overtime behavior.
- Unresolved: D-015 inventory valuation/adjustment/negative-stock/concurrency; D-017 provider binding; D-018 import provenance/cutover; D-020 data retention/access; D-023 cross-channel payment collision; D-024 expiry/late/partial/refund outcomes; D-025 broader Admin recovery/provisioning; D-028 stale offline grants/revocation; D-029 backup retention/RPO/RTO; D-030 local retention/quota/device-loss recovery.
- H01/H02 are unproven PostgreSQL hypotheses; H03 is a member-status policy question. E01 CI selection changed but execution remains unproven; E02 recurrence bounds remain partial. E03 private-file classification/ignore/cleanup is separately gated, never permission to inspect private data or perform cleanup.

D-032 means profiles are independent across branches: no global linking/deduplication/cross-branch overlap check; recurrence overlap checks apply within the same branch roster profile. Correct older contradictory text only on an explicitly authorized documentation surface. No TTL, quota, RPO/RTO, retention period, provider account, collision, or import rule may be inferred.

D-001/D-012 separately permit organization-shared member profiles subject to role projection. Do not turn branch-isolated cash, stock, visits, transaction history or actions into organization-wide data, and do not deny the shared profile merely because an operator is working in another branch of the same organization. Branch selection is not an authorization grant. D-020 applies only to data classified sensitive and its associated access/retention/export questions; it is not a blanket hold on minimal operational profile reads.

## Shared-file ownership

Before implementation, name one integrator for each shared file. Until then, domain workers send patch proposals and do not edit these surfaces concurrently.

| Surface | Single owner | Worker contribution |
|---|---|---|
| api/app/main.py router/lifespan | Named API integrator | Request exact router-registration patch |
| api/app/db/models/__init__.py | Model-registration integrator | Send import/metadata delta |
| api/migrations/versions/* and api/migrations/env.py | Serialized migration steward | Request slot; do not rename/rebase revisions independently |
| frontend/src/app/App.tsx route registry | Named frontend integrator | Send route/role-state mapping |
| Package lockfiles | Dependency owner | No install/update/regeneration absent explicit need |
| CI workflow | CI owner coordinated with P11 | Submit narrow proposed delta; hosted run remains separate |
| odd/tasks/backend-implementation.md | One ledger maintainer | Submit evidence/status proposal, no concurrent edits |

Every package authorization names exact allowed paths. Never allow api/app/**, frontend/src/**, repository root, all tests, all migrations, or similarly broad globs. Mark every not-yet-existing path PROPOSED.

### Domain-file reservations that need serialization

These are known semantic conflicts beyond global registration files. A reservation is one named owner/sequence window for the exact file set; separate worktrees do not make concurrent edits to shared transactions safe. Tests and fixtures are shared surfaces too.

| Exact existing path | Overlapping lanes | Required coordination |
|---|---|---|
| `api/app/api/sales.py` | P3 internal sales/debt; P8 POS/refund source; P9 attempts/callback settlement; P10 Gimi/report consumer | Reserve by route/domain slice; one transaction integrator merges sequential proposals. |
| `api/app/sales/queries.py` | P3 sale/debt/access; P8 commerce; P9 settlement | One financial write owner at a time; do not parallel-edit transaction/locking helpers. |
| `api/tests/test_sales.py` | P3/P4/P8/P9/P10 | Each contributor proposes isolated case; one test-file integrator rebases/merges. |
| `api/app/api/inventory.py` | P8 stock/POS; P7 stock ingestion contribution | P8 owns stock mutations; P7 contributes adapter contract; reserve one router editor. |
| `api/app/inventory/queries.py` | P8 stock ledger/snapshot; P8 POS; P7 read/adapter consumers | Stock ledger is exclusive P8 ownership; no second movement writer. |
| `api/tests/test_inventory.py` | P8 stock/POS; P7 stock boundary | Serialize fixture/database setup changes; keep each test focused. |
| `api/app/api/members.py` | P1 auth boundary, P2 reads, P3 member writes | P2 proposes read module; avoid shared route-file edits unless one integrator reserves it. |
| `api/app/members/queries.py` | P2 read projection; P3 member state/access | Separate read and write query boundaries or serialize this file; no broad module ownership. |
| `frontend/src/api/membershipCheckoutApi.ts` | P1 transport, P3 membership checkout, P5 catalog | One shared client owner or separate versioned modules after contract approval. |
| `frontend/src/features/reception/LiveMembershipCheckout.tsx` and its test | P3 checkout; P5 catalog; P9/P10 status display contributors | P3 owns command UX; contributors provide typed patch contracts; serialize component edits. |
| `api/app/api/shifts.py` and `api/tests/test_shifts.py` | P4 shift/cash; P8/P9/P10 event consumers | P4 owns shift writes; consumers submit source-field proposals. |
| `api/app/db/models/__init__.py`, `api/app/main.py`, `frontend/src/app/App.tsx`, migration files, lockfiles, CI, ledger | Multiple packages | Named integrator/steward; reserve one exact change at a time, never use as package-worker wildcard. |

The allowlist table in each package is a candidate subset, not a lock reservation. Before source work, coordinator records the reservation owner and serial window in the task handoff. If any accepted subtask discovers a same-file conflict, stop that slice and submit a patch proposal; do not widen its path list.

## Assignment and verification protocol

A package owner receives its card, source baseline, one stable subtask ID, one primary owner row or cross-cut label, accepted dependencies, exact allowed paths, named integrator, environment boundary, acceptance cases, rollback boundary and report template. Explicit implementation authorization is still required. A copied task brief does not create authority.

Future worktrees should be explicitly approved and located in the repository's home-directory sibling area, not a temp directory. Each checkout needs its own CodeGraph index. Preserve existing untracked/private files.

RDD reads clone-local off; do not toggle/start review. For code, observe meaningful test RED before behavior changes where a deterministic test applies, then GREEN/refactor; state when no meaningful RED applies. Never claim unobserved commands/results.

Baseline commands recorded in the reconciliation are not rerun here. From api, local full tests are .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests; from frontend, full Vitest is npm.cmd test -- --maxWorkers=2 --reporter=dot, typecheck npm.cmd run typecheck, build npm.cmd run build. .\.venv\Scripts\python.exe -m alembic heads from api reads the revision graph without connecting to PostgreSQL; it is not database migration proof. API local tests must use test mode, synthetic file-backed SQLite in a new temp directory, expected app import path, and no PG URL; never fall back to ambient DB. Detailed runner conditions belong to P11.

PostgreSQL requires explicit authorization naming disposable target, credential/session, operation and cleanup boundary. Hosted CI, provider sandbox, browser E2E, security scans, deployment, production and private import sources each require separate permission. A skipped/unavailable check stays pending.

## Plan status and delivery

The initial 1,000–1,500 authored-line forecast is historical and was superseded by the detailed plan. All twelve cards exist; D1–D4 content is accepted and independently validated. Four documentation findings were corrected and targeted revalidation passed; parent content review is accepted. The 2,131-line count is the pre-metadata baseline; final authored additions/deletions are recorded in the tracker. The human authorized nine local `feature-branch-chain` documentation commits on `codex/backend-foundation`; this does not authorize tracker/child PR creation, push, or other remote operations. See the [authorized local commit sequence](../../odd/tasks/parallel-work-packages.md#authorized-local-commit-sequence). Record exact local commit identities in the tracker and use the final committed plan receipt as the baseline for first-wave assignments. No package implementation is started by this plan. RDD is off; no native review or approval was started.

This guide is not runtime work authorization. No P1–P12 implementation is marked complete or started by this documentation plan.

## Next action

Use the final committed plan receipt as the baseline for first-wave assignments; separately authorize any implementation scope and exact source edit paths before code work begins.
