# P1 — Identity and transport

**Primary owner:** residuals of BK-010, BK-011, BK-012, BK-058.
**Contributors:** P2–P10 consume stable principal/session/error contracts; they retain their own BK ownership.
**State:** Planning only. No P1-specific runtime proof. Source baseline for previous receipts: 3996c62acfeac8c7f367032a61bf95f331ccf1b8. RDD is clone-local off; do not start/toggle review.

## Current state and readiness

BK-010 has bcrypt/PIN and rate-limit foundation; password/login/recovery/alert residuals remain bounded by D-025. BK-011 has internal branch/session grants and authorization; broader expiry/device/security proof remains pending. BK-012 has request correlation, safe errors/logging, bounded health, audit and metrics; retention/access/production operations and hosted CI remain pending. BK-058 has bounded Admin password login/recovery and own-session list/revoke, verified synthetic-only; broader recovery/provisioning and PostgreSQL proof remain open. BK-059/060 enrollment/device-code work is Done and reusable, not redo scope.

| Subdelivery | Readiness | Gate |
|---|---|---|
| Map current auth/session principal and route contract | Local-ready, read-only | No credentials, .env or private data |
| Draft typed transport errors/request-ID contract | Contract-ready | API contract approval before code |
| Extend protected routes and branch/action checks | Local-ready after explicit authorization | Allow organization-shared member profiles only under D-001/D-012; separately authorize branch transactions, cash, stock and visits |
| Expand Admin recovery/expiry/provisioning | Decision-blocked | D-025; no inferred TTL, MFA or recovery approval |
| Alert/email delivery or sensitive retention | Decision/permission-blocked | D-020 and explicit destination authorization |
| PostgreSQL auth concurrency proof | Permission-blocked | Named disposable PG target |

Local baseline evidence in docs/backend-audit/post-audit-reconciliation.md is historical. It does not prove these future changes.

## Objective and contract

Make protected API identity server-derived and reusable across frontend transports without trusting local/demo role, URL, PIN state, or device code. Each request resolves principal, session and branch/action scope. A typed client failure preserves HTTP status, stable domain code where defined, request ID and safe user message. Never log bearer tokens, raw PINs, recovery codes, unnecessary PII, stack traces, SQL or unsafe provider body text.

Proposed transport behavior, subject to contract review:

| Failure | Required client treatment |
|---|---|
| 401 invalid/revoked session | Clear affected operational session; explicit reauthentication; retain write intent if outcome unknown |
| 403 insufficient action/branch scope | Deny without changing role or revealing protected record existence |
| 409 known domain conflict | Preserve stable recovery state; do not mint a second operation |
| 429 authentication limit | Safe retry-later response without exposing limiter key |
| Network loss after write | Preserve original idempotency key and reconcile before retry |
| 5xx/validation | Safe request ID and structured issue, not arbitrary response-text parsing |

This is a contract proposal, not proof every route follows it. Keep generic transport separate from P2 member DTOs and P3-specific recovery UX.

## Scope

**In:** bounded BK-010/011/012/058 residuals; synthetic auth, revoked-session, branch-scope, rate-limit, redaction and request-ID cases; transport contribution to other packages.

**Out:** redo BK-059/060; new roles or public endpoints without authorization; live email/provider setup; PostgreSQL, hosted CI or production; all-route rewrite; payment/member UI workflows; client-side authority; inferred D-025/D-020 choices.

## Existing seams and proposed paths

Existing API paths verified: api/app/auth/admin.py, sessions.py, authorization.py, enrollment.py, devices.py; routers api/app/api/admin_auth.py, admin_sessions.py, admin_enrollment.py, device_pairing.py, staff_roster.py, members.py; observability api/app/observability/request_id.py. Existing FE transport candidates: frontend/src/api/receptionApi.ts and membershipCheckoutApi.ts; login candidate frontend/src/features/auth/OperationalLogin.tsx.

Existing tests: api/tests/test_admin_auth.py, test_admin_sessions.py, test_authentication_failures.py, test_staff_auth.py, test_authorization.py, test_enrollment.py, test_devices.py; FE frontend/src/features/auth/OperationalLogin.test.tsx.

**PROPOSED conditional future paths:** frontend/src/api/operationalTransport.ts and operationalTransport.test.ts only if the accepted design needs a separate shared transport boundary. Existing router/schema files must be selected one at a time. Frontend route registration and API router registration are integrator-owned. Do not authorize api/app/**, frontend/src/**, every auth route or every test.

Shared files excluded from parallel edits: api/app/main.py, api/app/db/models/__init__.py, frontend/src/app/App.tsx, migration chain, CI, lockfiles and ledger. A worker submits a patch request to the assigned owner.

## Subpackages

| ID | Deliverable | Dependency | Limit |
|---|---|---|---|
| P1.1 | Principal/session contract inventory | Existing auth; confirmed D-011/D-012 | Document fields/scope/unknowns; no source change |
| P1.2 | Protected API authority residual | P1.1 and exact authorized routes | One route family per unit; preserve branch scope/revocation |
| P1.3 | Typed transport failure mapping | P1.1 contract; P2/P3/P4/P6 consumers | General errors/request ID only; not business UI |
| P1.4 | Admin recovery/session residual | P1.1; D-025 for open rules | Reuse bounded behavior; no real mail |
| P1.5 | Observability/CI-definition residual | P1.1 and named CI owner | Local proof/workflow definition only; no hosted proof |

P1.1/P1.3 contract work can start while protected route implementation is pending. P2 design need not wait for all P1 code. Shared DTO/client transport requires a single integrator window.

## Acceptance and failure matrix

- [ ] Missing, invalid, revoked or inactive credentials cannot read protected data or mutate state.
- [ ] Organization-shared member profile reads follow D-001/D-012; unauthorized organization reads and branch-specific transaction/history/visit data or actions are denied without existence leaks. Selecting a branch does not grant additional authority.
- [ ] Revocation applies on next protected request; no client fallback to demo authority.
- [ ] Request ID and typed safe error survive parsing; logs omit tokens, PINs, secrets and unnecessary PII.
- [ ] Retry after accepted-but-response-lost write preserves idempotency key and reconciles before resubmission.
- [ ] Rate limit is bounded and does not expose limiter key.
- [ ] Existing enrollment/device tests remain valid without duplicate BK-059/060 work.
- [ ] Admin recovery does not infer permanent expiry, MFA, destination, recovery authorization or email behavior.
- [ ] Tests use synthetic identities only.

| Condition | Expected evidence |
|---|---|
| Revoked token / insufficient branch grant | Safe denial; no protected data or mutation |
| Same idempotency key and body | Original/replay result; no second transaction |
| Same key with changed body | Safe conflict |
| Missing request ID or malformed error body | Safe typed fallback |
| Auth failure log snapshot | Secret redaction assertion passes |
| Unconfigured recovery destination | Safe unavailable result; no ambient-service fallback |

## Verification commands — planned, not run

From api, focused synthetic API tests:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_admin_auth.py tests/test_admin_sessions.py tests/test_authentication_failures.py tests/test_staff_auth.py tests/test_authorization.py tests/test_enrollment.py tests/test_devices.py

From frontend, if login/transport consumers change:

    npm.cmd test -- --run src/features/auth/OperationalLogin.test.tsx src/api/receptionApi.test.ts --maxWorkers=2

Typecheck from frontend: npm.cmd run typecheck. Full API/FE checks are candidate-level checks, not run for this planning card. API tests must run in test mode with synthetic fixtures and isolated DB configuration; remove all PG/provider URLs. If resolution is not demonstrably test-only, stop. PG tests require separate authorized disposable target. No hosted CI, mail, provider, remote or production call.

## Effort, rollback and handoff

Effort: **M** for one bounded transport/session slice; **L** if approved policy or many route families change. Re-estimate after contract agreement.

Rollback only exact authorized paths. Do not delete auth audit history, revoke real users, reset credentials, rewrite session history, or revert unrelated identity work. Use approved recovery for any migration.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P1.1 | No runtime writes; contract draft only | `docs/work-packages/contracts/P1.1-principal-session.md` (PROPOSED) | No route/auth edits; P1 reviewer signs principal/branch fields. |
| P1.2 | `api/app/auth/authorization.py`; `api/app/api/members.py`; `api/tests/test_authorization.py` | No new path unless exact route/schema need is approved | `api/app/api/members.py` is shared with P2/P3: reserve serially; router wiring to integrator. |
| P1.3 | `frontend/src/api/receptionApi.ts`; `frontend/src/api/membershipCheckoutApi.ts`; `frontend/src/features/auth/OperationalLogin.tsx`; `frontend/src/features/auth/OperationalLogin.test.tsx` | `frontend/src/api/operationalTransport.ts`; `frontend/src/api/operationalTransport.test.ts` (PROPOSED, only after contract) | One transport integrator owns shared client consolidation; no route registry. |
| P1.4 | `api/app/auth/admin.py`; `api/app/auth/sessions.py`; `api/app/api/admin_auth.py`; `api/app/api/admin_sessions.py`; `api/tests/test_admin_auth.py`; `api/tests/test_admin_sessions.py` | `api/tests/test_admin_recovery_delivery.py` (PROPOSED; exact initial candidate) | No real email/recovery destination; D-025 blocks disputed policy. |
| P1.5 | `api/app/observability/request_id.py`; `api/tests/test_observability.py`; `api/tests/test_authentication_failures.py` | `docs/work-packages/contracts/P1.5-observability.md` (PROPOSED) | CI workflow changes reserved to CI integrator; hosted proof separate. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Assignment brief**

> Take only P1 subtask [P1.x]. Scope is the listed BK-010/011/012/058 residual. Do not redo Done BK-059/060. Read this card and the decision register. Obtain explicit implementation authorization and the selected subdelivery row’s exact candidate paths and separate authorization before edits. Preserve server-derived identity, branch scope, revocation, redaction and idempotency. No .env, credentials, private files, PostgreSQL, hosted CI, remote/provider/mail or production. Return changed paths, exact focused commands/results, skipped proof, open D-025/D-020 gates and rollback boundary. Stop if shared-file ownership is missing or behavior needs an unapproved decision.

Evidence: [source-baseline reconciliation](../backend-audit/post-audit-reconciliation.md); [decision register](../backend-plan/02-business-rules-and-decisions.md) D-011/D-012/D-020/D-025; [BK ledger](../../odd/tasks/backend-implementation.md).
