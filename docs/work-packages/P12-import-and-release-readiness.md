# P12 — Import and release readiness

**Primary owner:** unfinished BK-048–052, BK-075 and BK-076. This package owns import/runbook/release gates, not import implementation hidden in another package.
**Contributors:** P2/P3/P5 member, order and catalog contracts; P7 local queue/receipt protocol; P8 stock events; P9 provider evidence; P10 reports/outbox; P11 crosscut proof. Each keeps its own work and acceptance.
**Suggested assignee:** Data-migration/reliability engineer experienced in deterministic ETL, provenance, backup/restore and reversible release gates; no one may inspect private input without separate explicit authorization.
**Helpful skills:** schema mapping, deterministic dry-runs, provenance/reconciliation, recovery-runbook design, synthetic fixture generation and evidence-led release checklists.
**State:** Planning only. No actual workbook, notebook, customer file, production database, backup target or queue data was accessed. No import, restore, release or deployment was performed.

## Objective and readiness

Prepare a reproducible, provenance-preserving migration and rollback/recovery plan that can be rehearsed on synthetic data first. Release readiness must be an evidence bundle over named package contracts and gates—not a claim that a test suite, migration graph or checklist proves production safety. This card documents future authorized subdeliveries only.

| Subdelivery | Readiness | Gate |
|---|---|---|
| Legacy mapping specification and synthetic generator | Local-ready, metadata/schema-only | No private file or personal dataset read; D-018 provenance/cutover unresolved |
| Dry-run validator/provenance pipeline | Contract-ready | Stable mapping rules and reject/reconcile report; no target writes |
| Backup/PITR/restore design | Decision/permission-blocked | D-029 RPO/RTO/retention unresolved; exact disposable restore target permission required |
| Migration rehearsal | Permission-blocked | D-018, D-020, D-029 and explicit data/target/operation approval; use synthetic data unless separately approved |
| Local-first/device-loss recovery | Decision-blocked | D-030 device/queue retention/quota/loss policies unresolved; P7 receipt boundary required |
| Production release gate | Blocked pending all evidence | BK-052 criteria; no deploy/production permission from this plan |
| Contingency Mode rollout | Reliability-gated | BK-076 requires P7/P11 evidence for queue throughput, hotspot recovery and cash discrepancy/loss; no invented threshold |

## Scope and safety boundary

**In:** BK-048 deterministic legacy-store inventory and mapping; BK-049 dry-run import validation/provenance/rejection/reconciliation; BK-050 backup/restore runbook and non-production rehearsal design; BK-051 explicitly authorized synthetic/approved-data migration rehearsal; BK-052 release readiness/observability/rollback gate; BK-075 backup/PITR and unflushed device-queue loss runbook; BK-076 gate Contingency Mode production rollout on reliability proof.

**Out:** reading/copying private workbooks or notebook; actual migration or production DB; choosing mapping, deletion, deduplication, cutoff or overwrite policy not resolved in D-018; inventing RPO/RTO, retention, backup frequency, quota or device recovery guarantees; hosted CI, PG target, deployment, customer data, provider credentials, remote transfers or cleanup. E03 private-file classification/ignore is a separate permissioned task, not a reason to inspect or auto-ignore anything.

| Evidence property | Required contract |
|---|---|
| Input provenance | Synthetic generator/version and source-schema description; any approved external source requires explicit owner, exact file/target, purpose and authorization. |
| Determinism | Same authorized input/schema/rules produce stable counts, IDs or documented non-deterministic fields; mapping revision is recorded. |
| Dry-run | Read/validate/transform to an isolated report; no writes to target or source, no network, no ambient DB credential fallback. |
| Reconciliation | Count accepted/rejected/skipped/duplicate candidates and explain totals by entity; balances/stock/periods reconcile only under approved rules. |
| Idempotence | Repeated rehearsal under same idempotency boundary cannot duplicate rows; changed mapping revision is explicit and does not silently overwrite. |
| Rollback/restore | Named target identity, snapshot/checksum, restore point, verification queries, operator/approver and stop criteria; D-029 values remain unset until approved. |
| Queue boundary | Distinguish server accepted receipts from pending/unknown local queue events; device destruction scenario must not claim zero loss without P7/P11 proof and D-030 policy. |
| Release evidence | Exact commit/tree, package proofs, migrations/backup result, required decisions/permissions, known skips, human approver; checklist does not grant deployment authority. |

## Existing seams and proposed paths

Existing technical verification paths include `api/migrations/env.py`, `api/migrations/versions/`, `api/tests/test_migrations.py`, `api/tests/test_migrations_postgres.py`, and `api/pyproject.toml`; `frontend/package.json` defines local typecheck/build runners. `api/tests/test_migrations.py` and graph inspection are local evidence only; the PostgreSQL test module is not authorized to run in this documentation phase. No import or backup service path is claimed as implemented.

**PROPOSED conditional paths:** `api/app/importing/mapping.py`, `validator.py`, `provenance.py`, and `api/app/ops/backup/restore_runbook.md` only after an authorized synthetic-import/ops design. Exact proposed tests are added with the subtask, e.g. a narrowly scoped `api/tests/test_import_mapping.py`; this file does not exist now. Do not read real input when implementing these paths; synthetic fixtures/generators only. Any migration revision requires a reserved slot in `api/migrations/versions/` plus explicit target policy.

Shared migration chain, `api/app/main.py`, model registry, lockfiles, CI and BK ledger require a named serialized integration owner. A package worker may prepare the migration/runbook specification and a diff proposal, but cannot concurrently allocate migration revisions or edit global registration. Never authorize repository-root or `api/**` wildcard paths.

## Subdelivery sequence

| ID | Rows | Deliverable | Dependency and gate |
|---|---|---|---|
| P12.1 | BK-048 | Metadata-only inventory, entity map and deterministic synthetic input generator | P2/P3/P5/P8 schemas as available; D-018 blocks real provenance/cutover choice. |
| P12.2 | BK-049 | Pure validation/mapping dry-run report with provenance, rejects and reconciliation counts | P12.1 mapping version; no target writes. |
| P12.3 | BK-050 | Backup/restore design and recovery rehearsal steps | D-029 approval required for objective/frequency/retention; no actual target now. |
| P12.4 | BK-051 | Synthetic migration rehearsal with snapshots, matched balances, rollback trigger | P12.2/P12.3; separate explicit authorization for exact non-production target and data. |
| P12.5 | BK-075 | Backup/PITR + unflushed device queue-loss runbook | P7 receipt/queue state; D-029/D-030, no invented RPO/RTO/retention. |
| P12.6 | BK-052 | Release evidence checklist and rollback readiness | P9/P10/P11 and required BK rows; identifies blockers without granting deployment. |
| P12.7 | BK-076 | Contingency Mode reliability/rollout gate | P7 durable-sync, P11 authorized PG/quality proof, P12.5 recovery; human release decision. |

P12.1/P12.2 can progress with generated synthetic data and current approved schema contracts. P12.4 cannot touch any data/target until an explicit authorization names the data/target/operation/session. P12.5 waits for exact P7 queue states and decisions, not for importing private files. P12.6 consumes evidence from the named P9/P10/P11 subdeliverables and must report missing evidence as blocked; it cannot certify production. P12.7 depends on reliability proof before any launch but the numeric criteria require user/business approval.

## Acceptance and failure scenarios

- [ ] Dry run opens only generated synthetic input and a new temp-contained local target; environment has no ambient production/PG URL and any unexpected DB/network attempt fails closed.
- [ ] Report includes mapping version, entity counts, accepted/rejected/skipped/duplicates, reason codes and reconciliation totals.
- [ ] Same input/mapping is deterministic and rerunnable; duplicate prevention is demonstrated without overwriting unrelated existing data.
- [ ] Invalid references, malformed dates/amounts, unknown enum, duplicate natural key and inconsistent totals are rejected or staged for review per approved rules.
- [ ] No choice of dedupe, member cross-branch identity, catalog price, stock opening value, payment state or cutover date is inferred from synthetic success.
- [ ] Backup/restore procedure names exact artifact/checksum/target and actor, verifies restored events/audit, and leaves unresolved D-029 targets unfilled rather than fabricated.
- [ ] Queue recovery distinguishes accepted, rejected, pending and unknown; no assertion of zero loss absent a proven authorized test.
- [ ] Release checklist links every proof to exact source commit/tree and identifies skipped/failed/pending checks and human approver.
- [ ] Deploy/release gate remains informational; no runbook or package plan authorizes production mutation.
- [ ] E03 private file classification/cleanup remains separate; no content was accessed or deletion/ignore rule inferred.

| Fault | Expected result |
|---|---|
| Duplicate input ID | Report duplicate/reject count and stable reason; no double import. |
| Invalid reference or malformed field | Reject/stage for review; never coerce to guessed value. |
| Mapping revision changes after rehearsal | New report version and comparison; no silent overwrite of previous target evidence. |
| Dry run sees DB/network credential unexpectedly | Fail closed; stop and preserve environment; do not retry against ambient target. |
| Restore verification mismatch | Block rehearsal/release; retain source snapshot and diagnostic evidence. |
| Device queue contains `unknown` event | Report unresolved event and owner; no “accepted” inference or data deletion. |
| Required PG/hosted/provider/deploy gate unavailable | Keep the corresponding release criterion pending; do not replace it with SQLite/typecheck evidence. |

## Verification plan — commands are planned, not run

From `api` with P11's fail-closed synthetic local harness:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_migrations.py
    .\.venv\Scripts\python.exe -m alembic heads
    .\.venv\Scripts\python.exe -m pip check

From `frontend` for release compilation only after authorized package changes:

    npm.cmd run typecheck
    npm.cmd run build

Migration graph is not database migration proof. `test_migrations_postgres.py`, any PG-backed suite, provider/hosted CI, backups, restore, import target, release/deploy are NOT run or authorized by this plan. Existing baseline suite receipts are historical and do not establish a release. Any future DB test must use an explicitly named disposable target after separate permission; local import dry-run uses generated synthetic data and a fresh temp-contained SQLite file only.

## Effort, rollback and handoff

Effort: **M** for schema map and pure synthetic validator; **L** for restore/rehearsal/queue-loss proof; **XL** when import, backups, providers, frontend and production readiness are bundled. Keep P12.x isolated. Rollback means stop/restore only the specifically named disposable target from verified snapshot; never delete source evidence, private files, accepted events or audit history. Production data correction/recovery requires its own human decision and authorized runbook.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P12.1 | No runtime writes; synthetic mapping contract only | `docs/work-packages/contracts/P12.1-import-map.md`; `api/app/importing/mapping.py` (PROPOSED) | Synthetic schema inventory; never inspect real workbook/notebook. |
| P12.2 | No runtime writes | `api/app/importing/validator.py`; `api/app/importing/provenance.py`; `api/tests/test_import_mapping.py` (PROPOSED) | Pure deterministic synthetic dry run only. |
| P12.3 | No runtime writes | `api/app/ops/backup/restore_runbook.md` (PROPOSED) | No actual backups or target operations; D-029 unresolved. |
| P12.4 | No runtime writes before explicit exact target permission | `api/tests/test_import_rehearsal.py` (PROPOSED) | Synthetic-only local rehearsal by default; any DB target requires separate explicit authorization. |
| P12.5 | No runtime writes | `api/app/ops/backup/queue-recovery.md` (PROPOSED) | D-029/D-030 block objectives/retention; no production/device data. |
| P12.6 | No runtime writes | `docs/work-packages/contracts/P12.6-release-evidence.md` (PROPOSED) | Checklist only; cannot authorize deploy/release. |
| P12.7 | No runtime writes | `docs/work-packages/contracts/P12.7-contingency-gate.md` (PROPOSED) | Depends exact P7/P11 evidence and human release decision; no rollout. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Copy-paste assignment brief**

> Take only **P12 subtask [P12.x: exact deliverable]**. Allowed edits: [exact selected files; never broad `api/**`]. Read this card and D-018/D-020/D-029/D-030 plus the P7/P11 evidence boundary. Do not access private workbook/notebook data, `.env`, production DB, remote, provider, backup target or hosted CI. Generate synthetic input and use a fresh temp-contained local SQLite target only unless the human separately authorizes exact data, target, operation and session. Do not invent provenance, dedupe, cutover, retention, quota, RPO/RTO or zero-loss claim. Return mapping version, counts/reconciliation, exact commands/results, failed/skipped/pending criteria, restore/rollback trigger and blockers. No deployment/release or data transfer.

Evidence: [BK ledger](../../odd/tasks/backend-implementation.md); [decision register](../backend-plan/02-business-rules-and-decisions.md); [P7 local-first boundary](P7-local-first-and-sync.md); [P11 proof protocol](P11-postgresql-and-quality-proof.md); [source-baseline reconciliation](../backend-audit/post-audit-reconciliation.md).
