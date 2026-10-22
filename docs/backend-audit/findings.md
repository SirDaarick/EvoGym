# Backend findings and repair recipes

The original audit prioritized **B01–B03**, then error/DTO correctness and current PostgreSQL proof. `P1` means high operational impact, `P2` a correctness/maintainability priority; these are audit priorities, not a native review risk assessment. **Reproduced** means an isolated/local test observed it; **static** means the inspected path supports it but the full scenario was not executed; **hypothesis** requires proof; **policy** requires an owner decision. Dated remediation notes distinguish subsequent implementation from the original audit evidence; unmentioned findings are not thereby closed.

**Current committed proof, 2026-10-22:** observed R1/R1a–R5 commits pass their focused clean checks; clean R5 full API is **335 passed/17 PG skips/18 warnings**, typecheck/build pass, and full frontend is **2 failed/471 passed**, not green. Owner's filtered failure reproduces at baseline; Members' full timeout did not reproduce focused and load/timing remains a hypothesis. Earlier dirty 367/578 passes are separate evidence. See the [committed receipt](delivery-notes.md) and [frontend follow-ups](frontend-contract-gaps.md). B05 mapping is partial, E01 lacks PG execution, H01/H02 remain hypotheses, H03 owner policy, E02 partial recurrence work and E03 private-file classification/cleanup unperformed; no production certificate follows.

## Foundations to preserve

Synchronous `def` handlers with synchronous SQLAlchemy are appropriate; converting them mechanically to `async def` would not make blocking I/O asynchronous. Preserve opaque token digests, current grants, bounded hash work/lockouts, and `no-store`; server-priced integer minor-unit snapshots and idempotency; frozen shift cuts, integer bounds and unique active shifts; append-only access/review records and unique sample consumption; explicit sessions, lifespan disposal, and bounded readiness. Existing tests provide useful scoped evidence, not end-to-end production assurance.

## B01 — Browser CORS blocks implemented operations

**Remediation R1, 2026-10-22:** the working tree now explicitly permits GET/POST/PATCH/PUT/DELETE and `Idempotency-Key`, exposing only `X-Request-ID` for correlation. Exact origin allowlisting and no-credentials behavior remain. Regression RED: 5 failed/11 passed in `test_app.py`; after implementation, `test_app.py` + `test_settings.py` passed **30 tests**. Allowed-operation/header preflights, denied origin/method/header cases and actual-response exposure are covered. Focused clean checkout/API proof passes; current clean full frontend is partial. Browser E2E/PG proof remain pending; the source commit is recorded in delivery notes; see [remediation tracking](../../odd/tasks/backend-audit-remediation.md).

**P1 · reproduced.** Evidence: [application CORS](../../api/app/main.py), lines 199–200, permits only GET/POST and Authorization/Content-Type; [sale endpoint](../../api/app/api/sales.py), lines 93–98, requires `Idempotency-Key`. Allowed-origin preflights returned 400 `Disallowed CORS headers` for that header and 400 `Disallowed CORS method` for PATCH. This prevents legitimate browser requests despite functioning direct API tests. The restricted configuration exists in the tracked base; `main.py` also has unrelated working-tree changes.

1. Inventory actual browser-facing methods and headers from implemented routes; add only those needed, including `Idempotency-Key` and applicable PATCH/DELETE operations.
2. Decide whether clients need to read `X-Request-ID`; if so expose it explicitly. Keep exact origin allowlisting and existing credential restrictions.
3. Add parameterized preflight and actual-request tests per supported method/header; test disallowed origins, headers and methods remain denied.

**Acceptance:** a real browser can perform the live sale and implemented edits/deletes; origins are not broadened to `*`. Dependency: FE01/FE02 must also be fixed for checkout to work.

## B02 — Schedule deletion can violate its own database constraints

**Draft-only status after evolution:** cancellation representation/tests were corrected through other work and participated in the earlier dirty 367-pass API suite; they are not adopted into clean R5's 0029 graph. This writer did not implement them. The reproduction/recipe below describe the older draft, not newly reproduced current failure; retain boundary regressions and separately accept broader STAFF-1/overlap/PG behavior.

**Historical P1 · reproduced in the original untracked STAFF-1 draft.** Schedule truncation (`api/app/api/staff_schedules.py`; untracked dirty-snapshot evidence), lines 386–408, creates `occurrence_count=0` or `end_date < start_date` before the first occurrence; model constraints (`api/app/db/models/staff_schedules.py`; untracked dirty-snapshot evidence), lines 20–21, reject these states. Isolated SQLite future-first indefinite and count-limited series returned create 201, DELETE 500, with occurrences unchanged. Related edit predecessor logic at lines 361–367 is a **static concern**, not a reproduced failure.

1. Define explicit cancellation/truncation semantics when no preceding occurrence exists; do not synthesize an invalid predecessor or silently erase historical evidence.
2. Apply the same valid boundary representation to delete and `this_and_future` edits; preserve completed history and reconcile exception ownership atomically.
3. Regress before/exactly/after first occurrence, indefinite/count/end-date series, prior exceptions, rollback and repeated requests; run PostgreSQL variants too.

**Acceptance:** valid cancellation never returns 500, produces no future occurrence, and preserves prior occurrences/attendance evidence. Current draft/test progress does not by itself close all STAFF-1 scope or PostgreSQL proof.

## B03 — Schedule deletion searches only thirteen days ahead

**Draft-only status after evolution:** future-occurrence lookup/cancellation corrections/tests exist through other work and passed within the earlier dirty API suite, not the clean owned 0029 prefix. Do not reimplement or present the older +30-day reproduction as current failure without new evidence; retain long-future/replay coverage and remaining recurrence acceptance.

**Historical P1 · reproduced in the original untracked STAFF-1 draft.** Delete lookup (`api/app/api/staff_schedules.py`; untracked dirty-snapshot evidence), lines 396–403, does no mutation when its now-plus-13-day scan finds nothing. A series starting 30 days ahead returned create 201 and DELETE 204, but three future occurrences remained.

1. Derive the next eligible occurrence from the recurrence rule and termination conditions rather than a fixed lookahead window.
2. Return cancellation semantics consistent with B02, including exhausted/already cancelled rules.
3. Test starts at +30/+365 days, sparse weekdays, bounded/exhausted rules, timezone boundaries and replay.

**Acceptance:** 204 cannot leave future occurrences that the requested operation was meant to cancel. Dependency: agree the same recurrence contract used by B02/B04.

## B04 — Schedule edits have weaker validation and unclear scope

**Draft-only status after evolution:** shared validation and related draft corrections/tests supersede older probes and participated in the dirty green API suite, outside the clean owned source chain. This is not blanket overlap/scope correctness or completed STAFF-1/STAFF-2/STAFF-3. Preserve other work and resolve separately accepted remaining edges rather than replaying an obsolete recipe.

**Historical P2 · schema probes + static behavior in the original draft.** Schedule schemas/routes (`api/app/api/staff_schedules.py`; untracked dirty-snapshot evidence), lines 28–85 and 339–382: create validates unique weekdays 0–6 and offset-free wall time, while edit accepts `[7]`, `[0,0]`, and `09:00+02:00`; edit ignores the scope distinction. Empty weekdays are **already rejected** by `min_length` and are not a finding.

1. Reuse one recurrence/wall-time validator across create, series edit and occurrence overrides.
2. Implement genuinely distinct `series`/`this_and_future` semantics, or remove unsupported choices from the API contract after compatibility review.
3. Revalidate overlap and reattached exceptions, add explicit response DTOs and bounded listing/pagination, and document timezone/DST behavior.
4. Test each invalid input returns 422 without writes; test overrides/history survive supported scope edits and conflicting intervals are rejected.

**Acceptance:** equivalent input constraints apply to every mutation and each advertised scope has independently tested semantics.

## B05 — Generic error sanitization discards useful domain outcomes

**Remediation R2, 2026-10-22:** period/sample check-ins now raise an explicit validated `PublicDomainError`, not a trusted arbitrary `HTTPException.detail`. All admitted codes map deliberately to HTTP **409**, with `error.code`, fixed public `message`, correlated `request_id`, and membership-only `metadata`. The closed code set is `membership_access_denied`, `class_sample_already_used`, `class_sample_payment_unavailable`, `class_sample_payment_not_received`, and `wrong_branch`. Unknown codes, extra metadata and mismatched status/reason pairs are rejected at construction; ordinary HTTP details remain generic.

| Membership denial status | Allowed reason values |
|---|---|
| `not_found` | `membership_not_found` |
| `wrong_branch` | `wrong_branch` |
| `expired` | `period_expired` |
| `not_yet_valid` | `period_not_started` |
| `blocked_missing_funds` | `transfer_not_received`, `transfer_missing_funds`, `admin_payment_restriction` |

Validation responses retain `validation_error` and add at most 20 `issues`, each containing only `location` (empty or one fixed source: body/query/path/header/cookie) and a closed `type` classification; unknown types become `invalid`. Field names, nested/user dictionary keys, messages, input values and context are deliberately omitted. Both check-in POST operations explicitly document their domain-or-generic 409 and safe 422 Pydantic schemas in OpenAPI; other endpoints' validation-schema overrides remain a follow-up. Unmapped idempotency strings, other route/business errors, authentication and unexpected failures remain generic; frontend typed-error transport and broader domain mapping are **not** completed by R2.

Observed regression RED: **15 failed/15 passed**; final focused GREEN: **32 passed, 1 existing Starlette/httpx warning** across error/period/sample tests. Actual expired-period denial and already-used sample outcomes are verified, alongside allowlist rejection, arbitrary-detail redaction, coarse bounded validation diagnostics and OpenAPI shape. Clean API/focused source checks pass; current clean full frontend is partial. PG proof/documentation closure remain pending; observed source commits are in delivery notes; see [remediation tracking](../../odd/tasks/backend-audit-remediation.md).

**Original audit evidence, P2 · reproduced handler behavior before R2 wiring.** [Error handler](../../api/app/errors.py), lines 36–44, replaces HTTP details with `http_error`; [check-in denial](../../api/app/api/member_check_ins.py), lines 245–252, supplies a structured access-denied code/status/reason that is discarded. An isolated 409 carrying a dictionary became generic `http_error`. This proves this handler loses those details, not that every possible response code is removed.

1. Define an allowlisted public error schema: stable domain code, safe metadata, request ID, and validation location/type without rejected values.
2. Map known business exceptions to it; retain generic authentication/internal failures and never echo arbitrary HTTP exception dictionaries.
3. Publish typed OpenAPI examples; integrate FE04 handling by status/code rather than parsing messages.
4. Regress membership denial, conflict, invalid input, rate limit and DB failure; assert password, token, DSN, raw input and exception details never leak.

**Acceptance:** clients can distinguish actionable business denial from unavailable service without expanding sensitive error disclosure.

## B06 — Authentication fallbacks hide infrastructure failures

**Remediation R3, 2026-10-22:** the member/catalog/shift principal resolvers now fall back from Admin to staff only on the validators' expected `AuthorizationDenied`. SQLAlchemy `OperationalError`, `InterfaceError`, and pool `TimeoutError` during either validator stop resolution and return HTTP **503** with the existing generic `http_error` envelope/request ID; no raw driver message or automatic retry is returned. Unexpected `RuntimeError`, `ValueError`, `ProgrammingError`, and `IntegrityError` are not caught as credential/availability failures and reach the generic **500** boundary without selecting another authenticator. Invalid/revoked credentials remain generic **401**. Existing missing-factory handling and other routes are unchanged; this is not a service-wide database-error policy or principal-architecture redesign.

Corrected regression RED: **42 failed/6 passed**, after aligning an empty-list pagination fixture to its existing one-page contract. Final GREEN: **104 passed, 1 existing Starlette/httpx warning** across fault injection plus member/catalog/shift suites. Tests assert exact validator calls, no fallback after infrastructure/programming failure, successful staff business reads through real handlers, real token revocation, safe logs/body and correlated request IDs. Shared principal consolidation remains an optional follow-up, not a prerequisite for this bounded fix. Clean API/focused source checks pass; clean full frontend is partial. PG proof/documentation closure remain pending; source commits are observed.

**Original audit evidence, P2 · static before R3.** Broad `except Exception: pass` in [members](../../api/app/api/members.py), lines 68/81, [catalog](../../api/app/api/catalog.py), lines 66/79, and [shifts](../../api/app/api/shifts.py), lines 79/92, can turn bearer/database failures into fallback 401 responses. A database outage is not evidence of invalid credentials.

1. Consolidate principal resolution in a shared dependency compatible with existing admin/staff flows.
2. Catch only expected authentication failures for fallback; classify infrastructure failure as sanitized 503/500 according to a documented availability policy.
3. Preserve current branch/grant revalidation, add safe metrics, and test invalid/revoked credentials return 401 while storage failure does not masquerade as 401.

**Acceptance:** consistent auth/availability behavior across routes, with no exception text or credential logging. No outage reproduction is claimed here.

## B07 — Member normalization and explicit null semantics diverge

**Remediation R4, 2026-10-22:** create identity/name/phone and supported PATCH name/phone values are trimmed before length/nonblank validation. Whitespace-only required values and explicit null required PATCH values return 422 without writes; surrounding whitespace is normalized without changing internal spacing, phone format or natural-identifier semantics. Member number remains create-only, not a newly editable PATCH field. Queries persist the already-validated required DTO values rather than trimming them into potentially invalid stored values. Birth-date omission preserves the date, a valid supplied date updates it, and explicit null clears it through `model_fields_set`. Other nullable-field/preferred-name behavior remains unchanged.

Observed route-level RED: **9 failed/3 passed**, then full member-module GREEN: **33 passed, 1 existing Starlette/httpx warning**. Tests verify unchanged rows/counts on rejection, normalized-length boundaries, preserved formatting/aliases, and birth-date omission/update/clear/invalid-date behavior. Existing records were **not** backfilled; no new database constraint/migration, status/eligibility policy or privacy/retention change is included. Clean API/focused source checks pass; clean full frontend is partial. PG proof/documentation closure remain pending; source commits are observed.

**Original audit evidence, P2 · static before R4 route regressions.** [Input schemas](../../api/app/members/schemas.py), lines 115–154, validate raw lengths before [queries](../../api/app/members/queries.py), lines 174–197/249–258, strip values. Whitespace can become empty required identity/name/phone; PATCH `birth_date: null` is ignored instead of distinguished from omission.

1. Normalize before length/nonblank validation while preserving intentional field formats; add database invariants only with migration/backfill analysis.
2. Use field-presence tracking (`model_fields_set`) to distinguish omitted fields from explicitly nullable clears.
3. Add route-level tests: whitespace-only required values return 422 with no row change; omission preserves birth date, explicit null clears it if the contract permits.

**Acceptance:** stored values satisfy the same documented invariants as accepted DTOs; nullable PATCH semantics are explicit.

## H01 — Financial/check-in lock order may form a PostgreSQL deadlock

**P1 hypothesis · not reproduced on PostgreSQL.** [Sale queries](../../api/app/sales/queries.py), lines 148–150/210–212/240–242, lock register → member → branch; [authorization](../../api/app/auth/authorization.py), lines 28–34, locks staff → branch → grants before [check-in](../../api/app/api/member_check_ins.py), lines 223/254, locks the member. [Transfer flow](../../api/app/api/sales.py), lines 335–344, also locks register/member before authorization. A sale waiting for branch while check-in waits for member is a plausible cycle, not an observed incident.

1. Inventory lock acquisition across sale, repayment, check-in, voucher review and access mutations; document one consistent ordering with transaction boundaries.
2. Build a barrier-controlled two-connection PostgreSQL regression with distinct actors sharing branch/member; establish whether the cycle is reachable.
3. If confirmed, reorder locks without weakening atomic authorization, then add bounded retry only for explicitly classified retryable database errors and idempotent operations.

**Acceptance:** concurrent tests complete with correct financial/access invariants and bounded deadlines. SQLite results cannot close this finding.

## H02 — Concurrent catalog publications can conflict

**P2 hypothesis/contract choice.** [Catalog publication](../../api/app/catalog/queries.py), lines 137–147, reads parent/max version without `FOR UPDATE`; uniqueness prevents duplicate versions, while [route handling](../../api/app/api/catalog.py), line 229, can return 409 to a legitimate concurrent publisher.

1. Decide between documented optimistic conflict/reload and serialized parent publication; neither automatically means corrupted data.
2. Test with two independent PostgreSQL connections; assert unique monotonically assigned versions or an explicit recoverable 409 contract.
3. Keep published versions immutable and verify prior sales retain their snapshots.

**Acceptance:** concurrent outcome matches the chosen contract and FE11 can explain/recover from conflict.

## H03 — Member status and eligibility meaning needs owner policy

**Policy; no exploit demonstrated.** [Sale eligibility path](../../api/app/sales/queries.py), lines 210–259, does not use `Member.status` or plan `eligibility_type`; [membership eligibility](../../api/app/memberships/eligibility.py), lines 34–121, and [check-in](../../api/app/api/member_check_ins.py), lines 234–254, evaluate dates/payment/access. The attempted exploratory probe instead hit the immutable-plan guard, which is a successful safeguard—not suspended-member evidence.

1. Ask the owner what suspended/inactive status and student/senior eligibility mean for sale, existing entitlement and access; record exceptions/evidence requirements in the decision register.
2. Define the transaction-time revocation/revalidation boundary consistently across mutations.
3. Only then implement decision-table tests and concurrent revoke/write tests; do not infer denial policy from a label or frontend demo.

**Acceptance:** approved policy maps to explicit endpoint behavior, with current entitlement and role/privacy implications documented.

## E01 — Current PostgreSQL suites are not all selected by CI

**Remediation R5, 2026-10-22 — CI selection/test contract fixed; PostgreSQL execution unverified:** the existing ephemeral-service job now explicitly selects `test_migrations_postgres.py`, `test_sales_postgres.py`, and `test_shifts_postgres.py` in one 15-minute-bounded step; the job is bounded to 30 minutes. Original steps, permissions, trigger filters, service/environment and the main suite's PostgreSQL opt-out are preserved. After the parent authorized the narrow migration-test extension, exactly four after-`head` comparisons now derive the expected revision from Alembic `ScriptDirectory`, retaining actual database-version equality and every historical upgrade/downgrade/data assertion. Static AST normalization verifies the remaining migration-test logic is unchanged.

Read-only structural RED detected four old-head contradictions; structural GREEN confirmed the helper resolves `0030_staff_schedules`, exact module selection and workflow isolation. Running the migration module with database URLs absent collected successfully and produced **4 skipped**, not migration passes. No PostgreSQL/Docker/hosted execution occurred; fresh/repeated head, width evolution, predecessor/scoped downgrade, and cash-field backfill/reversal remain the four selected migration case boundaries. Other append-only/H01/H02 proof still needs separately scoped cases and actual execution. E01 remains open for PostgreSQL/hosted proof, not for missing module selection.

**Historical R5 preflight, 2026-10-22 — scope blocked before workflow edits:** all three proposed modules existed and used opt-in loopback-only disposable PostgreSQL targets with random private schemas. Static AST/graph inspection found four stale exact-head assertions in `api/tests/test_migrations_postgres.py` (then lines 88/111/156/204), expecting `0020_membership_debt_payments` after upgrading to `head` despite graph head `0030_staff_schedules`. The test file was initially outside the assigned edit surfaces and left unchanged until the parent authorized its narrow extension; selection was not claimed fixed during that blocked phase.

Installed PyYAML parsed the workflow; read-only permissions, ephemeral-service loopback target and the main suite's empty PostgreSQL opt-in variable were verified structurally. The three modules contain 4 migration, 5 sale-concurrency and 4 shift/snapshot tests; these are not comprehensive append-only/H01/H02 coverage.

**Original audit evidence, P1 verification gap · static.** At the audited baseline, [CI workflow](../../.github/workflows/api.yml), then lines 52–77, cleared the PostgreSQL opt-in URL for the main suite and explicitly ran only observability 0003→0004, authorization and credentials checks. Current migration, sale and shift PostgreSQL suites were not selected. Older historical PostgreSQL results do not prove today's head or untracked migration 0030.

1. Add isolated disposable-database jobs for fresh/repeated full-chain upgrade, populated predecessor evolution and append-only constraints.
2. Explicitly select current financial/shift PostgreSQL tests and H01/H02 concurrency regressions; preserve separate schema/database ownership and bounded lock/statement timeouts.
3. Verify hosted execution and record command/revision/results; failure must remain visible rather than falling back to SQLite.

**Acceptance:** current-head PG migration and invariant suites execute without skips in CI. Running migrations against live environments is a separate authorized operation.

## E02 — Schedule recurrence work is insufficiently bounded

**Current status:** recurrence CPU/query-bound optimization is partial in the evolved draft and needs separately accepted correctness/benchmark evidence. The original expansion/query-shape observation below is historical; current green functional tests do not prove worst-case CPU/latency, and no production incident is inferred.

**Historical P2 static shape; production latency unmeasured.** Schedule overlap/listing (`api/app/api/staff_schedules.py`; untracked dirty-snapshot evidence), lines 204–207/278, expands a 146,096-day horizon per overlap pair, queries exceptions per rule/date, and lists branch series without pagination.

1. Benchmark adversarial rule/date cardinality and count SQL statements on synthetic fixtures before claiming a production performance incident.
2. Under the agreed recurrence contract, use finite/mathematical intersection, preload exception sets, and bound query windows/pages; never silently truncate correctness to speed up checks.
3. Regress query-count/work bounds, overlap equivalence, sparse/long-lived rules and timezone boundaries.

**Acceptance:** documented worst-case bounds and deterministic correctness checks, not merely faster average timing.

## E03 — Documentation, status counts, and private workspace boundaries drift

**Current status:** entry points, dated remediation and recovery navigation are reconciled with current independent proof. Private/source/generated classification, ignore changes, destructive cleanup and bulk ledger/encoding rewrites were **not** performed. The ledger evolved through other work; the original 76-row enumeration below is historical, not a freshly recounted completion measure.

**Historical P2 reproduced documentation inconsistencies.** [Historical ledger](../../odd/tasks/backend-implementation.md), lines 94/200, has competing summaries; its 76 status rows were counted at the original audit as 18 Done, 17 Partial, 41 Not started. These are historical labels, **not a verified completion percentage**. BK-042-S1 is delivered while the broader domain is partial. STAFF-1 exists untracked despite unchecked workflow metadata. The historical ledger also contains literal mojibake; bulk re-encoding could damage unrelated text.

1. Use this audit as the dated entry point; reconcile individual ledger rows only against source/test/commit evidence and owner decisions, preserving history.
2. Keep documentation delivery separate from fixing findings. Repair encoding narrowly after checking actual bytes; do not mass-format historical files.
3. Inventory source/generated/private ownership before proposing ignore rules or cleanup; never publish private notebook/workbook names or delete untracked content automatically.

**Acceptance:** each new completion claim names scope/proof, current navigation is clear, and private data remains outside API artifacts.

## Framework references and remaining limits

Official references consulted for the audit, accessed **2026-10-22**: [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/), [FastAPI sync/async](https://fastapi.tiangolo.com/async/), [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), [SQLAlchemy session basics](https://docs.sqlalchemy.org/en/21/orm/session_basics.html). These explain principles, not proof of this application. Post-commit DTO reloads under `expire_on_commit=True` are an optional measured optimization; changing expiry trades round trips against stale-state risk and is not an automatic fix.

Not exhaustively audited: all admin recovery/enrollment/device branches, inventory algorithms, every migration downgrade, attendance/payroll, deployment configuration, or dependency vulnerabilities. See [verification limitations](README.md) and [completion roadmap](roadmap.md).
