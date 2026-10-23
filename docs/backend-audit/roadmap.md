# Route from the current backend to completion

**Next bounded work:** first collect the pending current-HEAD local verification in the [post-audit reconciliation](post-audit-reconciliation.md). The clean R5 receipt remains historical: **335 API passed/17 PG skips**, typecheck/build passed, and full frontend **2 failed/471 passed**. Later source commits are outside that receipt; current failures, if any, must be observed before selecting a fix. D1–D3 documentation closure is recorded by `cbe4d8a`; no PostgreSQL/hosted proof, push/PR, or production certificate is implied.

## Current scoped capability versus completion

| Capability | Current evidence | Still needed |
|---|---|---|
| API/environment/session foundation | Historical R5 API suite 335 passed/17 PG skips; bounded check-in errors and three principal fallbacks repaired | Current HEAD verification pending; broader B05 mapping/typed frontend errors, deeper auth audit, PG/production operations |
| Member/catalog/eligibility | Reads/mutations and immutable versions exist; later commits expand member and catalog UI | H02/H03, proposed member reload/history/itemized read contracts, verified live owner UI |
| Membership sale/debt/transfer | Server-priced minor units, idempotency and B01/FE01/FE02 live contract repairs exist | Real browser integration, PostgreSQL concurrency proof, broader policy/domains |
| Shift cash/opening inventory review | Snapshot/count/review, overtime handoff and frozen cut exist | Live frontend flow, current PG proof, non-membership ledger/reporting |
| Online access/sample | Period access, fixed-window duplicate visits and unique sample consumption exist | Reload DTOs, offline queue/revalidation, policy boundary |
| Roster/attendance | Current HEAD includes STAFF-1 weekly schedule series/occurrences/exceptions and BK040-S3 schedule classification/checkout; current HEAD test proof pending | Same-profile/branch recurrence acceptance and PG proof, STAFF-2 occurrence attendance, STAFF-3 offline |
| Inventory/POS/expenses/rentals/payroll | Piece-only stock/catalog foundations plus later committed demo/UI changes; UI presence is not live API integration | Remaining transactional domains and verified operational UI |
| Local-first/providers/notifications/Gimi/import/operations | Designs and partial prerequisites | End-to-end implementation, decisions and production exit evidence |

The current master ledger contains **76 main BK tasks: 18 Done, 18 Partial, 40 Not started**, plus the separate completed BK-042-S1 subtask. Older 18/17/41 counts remain historical. Labels are not a completion percentage. BK-042-S1 pending-money read is done; its broader domain remains partial. STAFF-1 schedules are implemented, while STAFF-2/3 remain pending. Do not repeat an obsolete blanket “no ready task” or debt-policy gate: ready bounded integrations coexist with scoped policy decisions.

## 1. Stabilize contracts, safety and PostgreSQL proof

**Dependencies:** existing live reception slice; no new business policy needed for matching current DTOs.

1. **Implemented/scoped proof passed:** B01/FE01/FE02, clock fixture and typed plan ID; R1a fixes two unsupported baseline finance-fixture properties. Focused clean tests/typecheck/build pass, while full clean frontend remains partial. Do not redo repaired contracts; separately investigate Owner's baseline keyboard failure and Members' non-reproduced timeout before full-suite retry, then add real browser/server E2E.
2. **Implemented within bounded scope:** B05 period/sample typed denials and safe validation, B06 three principal resolvers, B07 normalization/birth-date null semantics. Extend deliberately mapped errors/OpenAPI and typed frontend recovery as needed; do not claim every route or auth architecture is consolidated.
3. **Selection/contract fixed, execution pending:** E01 now selects current PG modules and derives expected head. Once a disposable target is authorized, execute fresh/populated upgrades, existing migration/financial/shift cases and separately scoped missing append-only/H01/H02 cases; SQLite and opt-in skips do not prove them.
4. Define authorized member-level reads for reloadable period/sample/order/debt identifiers and permitted history, then integrate FE04–FE06 with hard-reload, permission, retry and reconciliation tests. These proposed endpoints are not already delivered.

**Remaining exit:** resolve the [bounded frontend follow-ups](frontend-contract-gaps.md), obtain an honest complete-suite result, prove browser/reload recovery and record authorized PG results. Compiler/API/focused tests and build pass; original clean full frontend failure, 17 PG skips and policy/service gaps remain explicit.

## 2. Finish schedules and occurrence-aware attendance

**Dependencies:** approved recurrence/timezone/scope semantics and B02–B04/E02.

1. Preserve and review the **evolved** STAFF-1 cancellation/future-lookup/shared-validation corrections and tests already present; do not replay old B02–B04 failures as current proof or overwrite other work. Reconfirm first-occurrence/long-future/replay/exception/rollback acceptance. Overlap scope is the same branch roster profile; profiles in different branches are independent under the user's confirmed policy and are not globally linked or cross-checked.
2. Complete separately accepted recurrence CPU/query bounds and benchmarks under E02, plus any remaining listing/scope contract work; never silently truncate correctness. Current green tests do not establish all recurrence edge cases or PG behavior.
3. Complete STAFF-2 occurrence-to-attendance mapping with server timestamps, explicit nullable classification and append-only history; connect FE09 roster/attendance contracts.
4. Complete STAFF-3 only after the local-first queue/grant/receipt foundation below; separate “recorded locally” from accepted attendance.

**Exit:** recurrence lifecycle and historical evidence pass synthetic and current PostgreSQL checks; live UI reflects the same semantics. No fabricated absence classification or account/roster identity equivalence.

## 3. Deliver local-first BK-062–BK-074 by dependency

Use the existing [local-first design](../backend-plan/08-local-first-and-sync.md) and [task ledger](../../odd/tasks/backend-implementation.md) for exact task definitions; the range is verified, not a declaration that every task is ready.

1. Build the application shell and durable IndexedDB state/operation queue with explicit schema migration, client identity and bootstrap boundaries.
2. Implement transactional server ingestion, idempotent operation receipts and change/delta reads; atomically associate receipts with business results.
3. Add scoped/fresh grants, reconnect flushing, deterministic conflict/rejection presentation and recoverable retry; obtain D-028/D-030 choices before claiming safe stale access or loss recovery.
4. Test offline startup, accepted-but-response-lost, duplicated/out-of-order deliveries, reconnect revocation, schema/client mismatch, quota exhaustion, device loss and restore/replay.

**Exit:** pending/accepted/rejected/conflicted states survive reload; replay never duplicates money/access/stock, and ingestion revalidates authorization/entitlement. A monotonic-clock helper alone does not close this phase; offline finance requires domain proof too.

## 4. Complete operational domains and real frontend workflows

**Dependencies:** D-013/D-014 remaining policy, D-015 inventory decisions, stable receipts/transaction boundaries.

1. Finish stock receipt/movement/count/adjustment and product/supplement units/valuation contracts; preserve the distinction between observation and stock mutation.
2. Implement product POS, explicit payment/refund and stock-disposition atomicity, then extras, expenses and rentals with their own identity/idempotency/lifecycle contracts.
3. Complete staff finance/payroll and permission-scoped reporting/reconciliation across cash, transfer, pending money and refunds; do not count unreceived money as revenue or infer discrepancy blame.
4. Connect FE05–FE11 incrementally: member reads/details, collections/review, shift flows, access/sample, attendance and immutable catalog. Keep each behavior's tests/docs with its work-unit commit.

**Exit:** each domain has current schema/API contracts, positive/negative/concurrent regressions, complete role/branch boundaries and a live frontend flow or explicit non-UI contract. Demo coverage is not integration proof.

## 5. Integrate provider payments, notifications and Gimi

**Dependencies:** D-017/D-023/D-024 provider decisions and D-020 data policy; external account/session/destination authorization before any real integration work.

1. Bind provider account, branch/terminal and channel mapping; verify current provider APIs and sandbox credentials/configuration without live charges.
2. Implement authenticated webhook ingestion, deduplication, unknown-outcome reconciliation and permitted expiry/method-switch/refund/chargeback state transitions.
3. Add durable notification outbox/delivery/retry/deduplication and administrative security-alert delivery; distinguish stored pending events from sent messages.
4. Implement Gimi identity/permission/retrieval and audited data access against approved knowledge/PII retention policy; restrict answers/actions to authorized capabilities.

**Exit:** sandbox race/fault/replay tests prove exactly-once logical settlement/activation and observable notification outcomes; sensitive retrieval and cross-member access are tested. Live setup/charges remain separately authorized.

## 6. Import, operate, and prove production readiness

**Dependencies:** D-018 import, D-020 retention/privacy, D-029 recovery and D-030 local-data policy.

1. Approve import sources/classification/deduplication/provenance and cutover; dry-run synthetic/redacted data with reconciliation and rollback before any authorized private-source processing.
2. Complete deployment/secrets/TLS/origin configuration, bounded diagnostics, capacity/query budgets, dependency vulnerability scanning and role-safe operational runbooks.
3. Establish encrypted backup/PITR and restore/replay drills including receipts/change log/outbox consistency; use owner-selected RPO/RTO, not invented targets.
4. Rehearse forward repair/rollback, incident response, device loss and degraded provider/database operation in isolated staging; define release/rollback ownership.

**Exit:** signed-off migration/import and restore evidence, passing current PostgreSQL/contract/security/functional checks, no unresolved blocking findings, and owner acceptance of remaining limitations. Production deployment is a separate human decision.

## Owner decision queue

| Decision | Required answer before affected work |
|---|---|
| D-013 / D-014, partially resolved | Remaining credit/refund/non-cash partial-payment and discrepancy/reporting policy; preserve already-approved partial cash/overtime behavior |
| D-015 | Inventory valuation, adjustment, negative-stock/concurrency and deactivation policy |
| D-017 / D-023 / D-024 | Provider binding, competing payment attempts, expiry/late/partial outcomes and reconciliation |
| D-018 | Import provenance, deduplication, cutover and source access |
| D-020 | Retention/deletion/export/access by sensitive data class |
| D-028 | Offline grant freshness, shared-device lock and reauthentication/revocation exposure |
| D-029 | Backup retention, recovery point/time objectives and restore cadence |
| D-030 | Local retention/quota/client support and unsynced device-loss recovery |

The [decision register](../backend-plan/02-business-rules-and-decisions.md) remains authoritative. H03 adds a focused member-status/eligibility clarification; do not invent an answer or block unrelated ready fixes.

## Backend completion checklist

- [ ] Agreed domains, role/branch/privacy policy and API contracts are implemented, not merely modeled or listed.
- [ ] Current PostgreSQL migrations, constraints, append-only invariants and concurrency tests pass in isolated CI; restore and populated upgrade are proven.
- [ ] Financial/access/stock retries and reconciliation preserve invariants through offline, crash and provider faults.
- [ ] Frontend live flows match real DTOs and server authority; typecheck, complete tests/build and contract integration checks pass.
- [ ] Security, dependency, capacity and operational checks have recorded outcomes; all skipped/pending checks and accepted residual risks are explicit.
- [ ] Import, backup/recovery, retention, monitoring and incident runbooks meet owner-approved objectives with no unauthorized live operation.

Documentation completion checks off none of these runtime criteria. Continue with the bounded contract unit, not a broad rewrite or automatic cleanup of the dirty tree.
