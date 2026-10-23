# P10 — Notifications, reporting and Gimi

**Primary owner:** unfinished BK-042–047 residuals. BK-042-S1 is already Done and is reusable evidence, not a new P10 row or work item.
**Contributors:** P1 principal/authorization/audit; P3/P4/P8 event-source owners; P9 provider link capability for the renewal join; P11 local/PG proof coordination; P12 eventual release gate. Contributors keep their own ownership.
**Suggested assignee:** Backend engineer experienced with authorization, event-driven reporting/outbox and sensitive-data minimization, paired with a React engineer only for one assigned dashboard/widget integration.
**Helpful skills:** access-control matrices, privacy/redaction, transactional outbox, source-to-report reconciliation, typed tool contracts and React component testing.
**State:** Planning only. Existing audit/observability and frontend Gimi/reporting components are visible at source baseline; no notification outbox, reporting backend or Gimi domain-safe API is claimed as implemented by this card.

## Objective and readiness

Deliver scoped operational reports, notification outbox/delivery and consent-safe Gimi actions as separate capabilities. Reports derive from named event sources and reconcile to source records; pending money is not revenue. Gimi may invoke only approved, purpose-limited domain operations and must use the same service authorization/audit boundaries as human requests—never direct persistence access. Notification retries must not create duplicate side effects or disclose sensitive fields.

| Subdelivery | Readiness | Gate |
|---|---|---|
| Reuse BK-042-S1 pending-money API | Done/reuse | Verify source contract; do not redo or call pending money received revenue |
| Gimi identity, allowlist and permission matrix | Contract-ready; execution permission blocked | D-016 scope confirmed, tool/content permissions unresolved; D-012/D-020 projection |
| Core notification outbox | Design-ready | D-012 actor/role, D-016 permission, D-020 sensitive content and delivery destination authorization |
| Event-source report definitions | Contract-blocked per source | P3/P4/P8 event schemas and D-013/D-014 partial business rules |
| Report UI integration | Contract-blocked | Accepted report DTO, role/scope and time-window semantics |
| Gimi renewal link delivery/UI | Milestone-blocked | D-022 verified phone match + P10.1 permission -> P9.5 provider link capability -> P10.2 disclosure/delivery UI |
| Live email/WhatsApp or Gimi provider operations | Permission-blocked | Exact destination, operation and authorized session; no default sandbox/live permission |

## Boundaries and safety contract

**In:** BK-042 source-based operational/financial reports, BK-043 incremental frontend/report integration, BK-044 Gimi read/write permissions/disclosure, BK-045 domain-safe Gimi queries/actions and audit, BK-046 idempotent notification outbox/delivery lifecycle, BK-047 consent/error-state UI integration.

**Out:** provider payment creation/settlement (P9); P3 member/payment policy; source event mutation in P3/P4/P8; P12 import implementation and P11 PostgreSQL execution; direct ORM/database tool for Gimi; hidden or unapproved notifications; credential/session reuse; production report publication, live delivery or provider calls without separate permission.

| Rule | Acceptance meaning |
|---|---|
| Report from source of truth | Define source event, scope, time zone/window, status inclusion and sum/count formula. Include an explainable reconciliation to source IDs. |
| Money classification | Settled/received amount is not conflated with pending transfer, debt, unknown payment or refund; BK-042-S1 provides pending-money data only. |
| Access | Server authorizes each query/action at the time of use by actor, role, branch and data class; visible UI/tool choice does not grant access. |
| Gimi tool allowlist | Inputs/outputs are typed and purpose-limited. No arbitrary SQL, ORM persistence, shell, broad search, or implicit member data export. |
| Consent and identity | Obtain required human consent before disclosure/action; D-022 phone must be verified and match registered mobile before renewal quote/link disclosure. |
| Minimal data | Return only fields needed for the task; D-020 gates only data classified sensitive and its access/retention/export, not every operational aggregate. |
| Outbox | Enqueue transactionally with causal domain record; stable notification ID, recipient/destination, approved template version, safe payload reference, status and attempts. |
| Retry | Retries use the same idempotency identity and documented bounded policy; unknown provider outcome is reconciled, not blindly duplicated. |
| Audit/redaction | Append actor/purpose/action/result/request ID; redact tokens, full phone, sensitive message body and provider secrets from logs. |

## Existing seams and proposed paths

Existing API seams include `api/app/audit.py`, `api/app/observability/`, `api/app/api/sales.py`, `api/app/api/shifts.py`, `api/app/api/inventory.py`, and the Done BK-042-S1 read at `api/app/api/pending_money.py` (test: `api/tests/test_pending_money.py`). Existing API tests `api/tests/test_audit.py`, `test_observability.py`, and source-event test suites are available; they do not prove report/outbox/Gimi implementation. Existing FE paths/tests include `frontend/src/features/gimi/GimiDashboard.tsx` and `GimiDashboard.test.tsx`, `GimiChatWidget.tsx` and `GimiChatWidget.test.tsx`, `frontend/src/features/owner/AlertCenter.tsx` and `AlertCenter.test.tsx`, and `frontend/src/features/owner/ExpenseReport.tsx` and `ExpenseReport.test.tsx`. Existing UI components are not evidence of live backend binding.

**PROPOSED conditional paths:** one additive backend module per chosen seam, e.g. `api/app/notifications/outbox.py`, `api/app/notifications/delivery.py`, `api/app/reporting/definitions.py`, `api/app/gimi/permissions.py`, `api/app/gimi/domain_tools.py`, and a narrow `api/app/api/reports.py` or `api/app/api/notifications.py`. Choose only after the contract/role review. A report may be read-only and need no migration; an outbox needs an explicit schema design. Any tests for new proposed modules are also proposed, not current files.

Shared `api/app/main.py`, model registry, migration chain, FE App route registry, lockfiles, CI and BK ledger are owned by a named serialized integrator. Do not allow concurrent registration edits or `api/app/**`/`frontend/src/**` wildcards.

## Subdelivery DAG

| ID | Rows | Deliverable | Depends on / boundary |
|---|---|---|---|
| P10.1 | BK-044 | Gimi identity, purpose, read/write allowlist and permission/disclosure matrix; no provider operation | D-016 scope + D-012/D-020/D-022; policy/permission review before execution |
| P10.2 | BK-047 renewal-link UI slice + BK-057 contribution | Consume a typed P9.5 link and present verified-member consent/error states; P9 remains BK-057 primary | P10.1 + P9.5 typed capability + verified D-022 match; no payment/link generation here |
| P10.3 | BK-046 | Durable transactional outbox, retry/result states, redaction and delivery adapter interface | D-016 permission and specific destination authorization; independent of reports and P9 outside the link join |
| P10.4 | BK-042 | Define event-backed report formulas, scope and reconciliation; reuse BK-042-S1 pending-money evidence | Accepted P3/P4/P8 event contracts; D-013/D-014 for disputed policy categories |
| P10.5 | BK-043 | Integrate one report view at a time with role, period and source identity | P10.4 DTO + P1 authorization; not all-report mega-screen |
| P10.6 | BK-045 | Expose approved domain-safe Gimi reads/actions, append audit and enforce same server policies | P10.1 allowlist + each owning service contract; no direct persistence bypass |
| P10.7 | BK-047 notification UI remainder | Integrate notification/Gimi consent, delivery, error and idempotent status UI | P10.1 + P10.3; P9.5 only for renewal-link flow |
| P10.8 | Crosscut proof | Synthetic local evidence and separately gated delivery/PG evidence | Candidate-specific P11 protocol; does not alter package ownership |

DAG for the P9/P10 join remains **P10.1 → P9.5 → P10.2**. P9 provider work does not wait for all of P10; only the Gimi identity/permission contract precedes its link capability. P10.3 outbox and P10.4 report contracts can be designed independently, then depend on the specific domain source contracts. P10.5 waits for its report DTO, and P10.6 for the named domain service; neither blocks provider lanes. Do not introduce a package-level P9↔P10 cycle.

## Acceptance and failure scenarios

- [ ] Every report names source events, event state/time window, currency/unit, role/scope filter and formula; source rows reconcile to aggregates.
- [ ] Pending, unknown, expired, debt, refund and settled/received amounts remain distinct; reuse BK-042-S1 without reimplementing it.
- [ ] Branch filter is server-authorized; organization-shared member profile does not widen cash/stock/visit/report access.
- [ ] Outbox insert is atomic with source command; duplicate source event yields one notification identity.
- [ ] Delivery retry does not duplicate a side effect; pending/unknown/failed states are visible and redacted.
- [ ] Gimi has a deny-by-default typed tool allowlist, no SQL/ORM bypass, least fields, scoped actor and audit evidence.
- [ ] Sensitive data is excluded unless D-020 classification and permission explicitly allow it; no blanket denial of harmless aggregate or minimal profile projection.
- [ ] D-022 verified WhatsApp number exactly matches registered mobile before quote/link disclosure; no fuzzy lookup or inferred identity.
- [ ] User consent/disclosure and provider delivery permissions are distinct and required where applicable; tool availability is not consent.
- [ ] P10.2 only consumes P9.5 output; the UI never fabricates a provider link or payment status.
- [ ] Local fixtures use synthetic records; provider/live communication is not run by default.

| Fault | Expected result |
|---|---|
| Duplicate source event/outbox enqueue | Return same notification ID, no duplicate delivery command. |
| Provider accepted send but response was lost | Keep unknown and reconcile by original identity; no blind retry with a new ID. |
| User denies consent or number mismatch | No disclosure/delivery; record minimal safe result only. |
| Gimi asks for unallowlisted query/action | Deny and audit safely; no DB or shell fallback. |
| Report source page unavailable/stale | Mark report incomplete with source/time boundary; never synthesize zero. |
| Pending-money event included in totals | Test fails; pending is not received revenue. |
| Branch context changed after page load | Server rechecks authorization; deny or refetch under valid scope. |

## Verification plan — commands are planned, not run

From `api` for existing audit/observability seams:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_audit.py tests/test_observability.py

From `frontend` for existing Gimi/report consumers:

    npm.cmd test -- --run src/features/gimi/GimiDashboard.test.tsx src/features/gimi/GimiChatWidget.test.tsx src/features/owner/AlertCenter.test.tsx src/features/owner/ExpenseReport.test.tsx --maxWorkers=2
    npm.cmd run typecheck

Current API suite and FE suite receipts are historical source-baseline context. Use the P11 safe temp-contained synthetic SQLite setup; no ambient credentials or DB/network fallback. Add tests on exact approved paths for report formulas, outbox atomicity/replay, policy deny, user consent, role/branch filtering, redaction and unknown delivery reconciliation. Test doubles are not live permission/delivery proof. PostgreSQL, Gimi/provider calls, WhatsApp/email destinations, hosted CI and production remain explicitly unauthorized.

## Effort, rollback and handoff

Effort: **M** for one source-bound report or allowlist contract; **L** for durable outbox plus retries or multiple source systems; **L/XL** for cross-provider delivery and sensitive-data review. Keep P10.1/3/4 contracts separate from integrations. Rollback only the exact read view, tool capability or outbox adapter slice; never delete audit/delivery evidence or pretend a possibly delivered message was not sent.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P10.1 | No runtime writes; Gimi purpose/permission contract only | `docs/work-packages/contracts/P10.1-gimi-permissions.md` (PROPOSED) | Human scope/permission signer required; no tool or account call. |
| P10.2 | `frontend/src/features/gimi/GimiDashboard.tsx`; `frontend/src/features/gimi/GimiDashboard.test.tsx` | `frontend/src/features/gimi/renewalLink.ts`; `frontend/src/features/gimi/renewalLink.test.ts` (PROPOSED) | P9.5 produces link; P10 owns disclosure/delivery UI only. |
| P10.3 | `api/app/audit.py`; `api/app/observability/logging.py`; `api/app/observability/metrics.py`; `api/tests/test_audit.py`; `api/tests/test_observability.py` | `api/app/notifications/outbox.py`; `api/app/notifications/delivery.py`; `api/tests/test_notification_outbox.py` (PROPOSED) | Delivery adapter has no actual destination until separately approved; model/migration registry to integrator. |
| P10.4 | `api/app/api/pending_money.py`; `api/tests/test_pending_money.py`; `api/app/api/sales.py`; `api/app/api/shifts.py` | `docs/work-packages/contracts/P10.4-report-definitions.md` (PROPOSED) | Reuse BK-042-S1; pending money not revenue; event fields signed by P3/P4/P8. |
| P10.5 | `frontend/src/features/owner/ExpenseReport.tsx`; `frontend/src/features/owner/ExpenseReport.test.tsx` | No new path unless one exact report view is approved | P10.4 read DTO required; no duplicate report formula. |
| P10.6 | `api/app/api/sales.py`; `api/app/api/membership_access.py`; `api/tests/test_sales.py`; `api/tests/test_membership_access.py` | `api/app/gimi/permissions.py`; `api/app/gimi/domain_tools.py`; `api/tests/test_gimi_permissions.py`; `api/tests/test_gimi_domain_tools.py` (PROPOSED) | Call domain-owned services only; never add direct persistence bypass. |
| P10.7 | `frontend/src/features/gimi/GimiChatWidget.tsx`; `frontend/src/features/gimi/GimiChatWidget.test.tsx`; `frontend/src/features/owner/AlertCenter.tsx`; `frontend/src/features/owner/AlertCenter.test.tsx` | No new path until accepted UI contract | No real notification/recipient call; App route to integrator. |
| P10.8 | No runtime writes; proof report only | No additional runtime path | P11 candidate proof plan; P12 reads accepted evidence only. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Copy-paste assignment brief**

> Take only **P10 subtask [P10.x: exact read/report/outbox/Gimi deliverable]**, not all P10. Allowed candidate paths: copy the selected subdelivery row above verbatim; obtain separate human authorization before source edits. Read this card, the matching BK row and D-012/D-016/D-020/D-022. P1 owns auth/audit boundary, P3/P4/P8 source events, P9 owns BK-057 provider link, P10 owns only identity/permission, delivery and UI join. Use synthetic data. Never add a DB/ORM bypass, infer consent, reveal sensitive payload, include pending money as revenue, or call provider/recipient without explicit destination/operation/session authorization. Stop on unresolved policy/permission or shared-file ownership. Return formula/tool contract, data classification, exact tests/results, failed/skipped/pending proofs, integration dependency and rollback boundary.

Evidence: [BK ledger](../../odd/tasks/backend-implementation.md); [business decisions](../backend-plan/02-business-rules-and-decisions.md); [source reconciliation](../backend-audit/post-audit-reconciliation.md); [P9 provider join](P9-external-payments.md); [P11 proof protocol](P11-postgresql-and-quality-proof.md).
