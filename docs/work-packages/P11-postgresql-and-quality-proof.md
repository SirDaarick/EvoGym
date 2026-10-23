# P11 — PostgreSQL and quality proof

**Package role:** Cross-cut verification service; no primary BK row. P11 does not implement/import BK-048–052 (P12), change domain code for another package, or certify every behavior from one suite. It runs only checks authorized for the candidate and states exactly what evidence covers.

## Baseline and evidence limits

Source baseline: 3996c62acfeac8c7f367032a61bf95f331ccf1b8, tree 7d44e28bbbaf9ed0db54d732a3821f1a16604427. Recorded in docs/backend-audit/post-audit-reconciliation.md:

- API full suite: 367 passed, 17 PG opt-in skips, 19 warnings, exit 0, synthetic file-backed SQLite.
- The rejected first in-memory SQLite attempt had 318 pass/49 fail/17 skip; the harness selected SingletonThreadPool, which rejected pool_timeout/max_overflow. It was not a product regression. The corrected safe run is the valid baseline.
- Focused Owner/Members frontend: 24 pass; full frontend: 578 pass across 74 files.
- Typecheck/build, pip check and database-free Alembic graph check passed; migration head 0030_staff_schedules.
- No PostgreSQL runtime, hosted CI, browser E2E, security scan, deployment or production proof ran.

These are baseline facts, not fresh P11 or package verification. Preserve historical R5 receipts unchanged. SQLite does not prove PG locks, partial indexes, triggers, migrations, query plans, CI, browser, provider, or production behavior.

## Readiness classes

| Proof activity | Readiness | Condition |
|---|---|---|
| Read-only runner inventory and Alembic graph | Local-ready | No private data or secrets |
| Synthetic local API/FE tests | Local-ready when exact package command authorized | Test-only config, isolated fixtures, no PG/provider URL |
| Typecheck/build | Local-ready after relevant FE changes | Generated build artifacts are not source changes |
| PG migrations/concurrency | Permission-blocked | Explicit disposable target and credential/session |
| Hosted CI | Permission-blocked | Explicit workflow and hosted destination authorization |
| Provider sandbox | Permission-blocked | Explicit account/session and sandbox operation |
| E2E/security/deploy/production | Permission-blocked | Separate target/tool/operation permission |
| Proof without implementation candidate | Not applicable | Planning card is not runtime validation |

## Scope and boundary

**In:** per-package proof matrix; exact command, cwd, fixture/database, result, skips and evidence identity; local synthetic checks after authorized implementation; read-only Alembic graph/workflow checks; PG test plan after authorization; distinguish pre-existing from candidate-caused failure.

**Out:** application behavior/migrations/import implementation; selecting or creating a PostgreSQL target; ambient credentials; Docker/hosted CI absent permission; private workbooks/production data; interpreting a skip or SQLite pass as PG proof; rerunning suites merely because this documentation is authored.

## Existing runners and planned commands

Paths verified at baseline: api/pyproject.toml, api/migrations/env.py, api/migrations/versions/, api/tests/test_migrations.py, test_migrations_postgres.py, test_contract_smoke.py, frontend/package.json, local Vitest/tsc/Vite executables.

Planned, not run for P11. Working directory is part of the command:

| Check | CWD and command | Proves |
|---|---|---|
| Full API suite | api: .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests | Local tests/configured fixtures |
| API targeted module | api: .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/<authorized_module>.py | Named module only |
| Dependency consistency | api: .\.venv\Scripts\python.exe -m pip check | Installed requirement consistency |
| Migration graph | api: .\.venv\Scripts\python.exe -m alembic heads | Graph/head without DB connection |
| Full FE Vitest | frontend: npm.cmd test -- --maxWorkers=2 --reporter=dot | Local FE unit/component suite |
| Focused FE Vitest | frontend: npm.cmd test -- --run <authorized test paths> --maxWorkers=2 | Named tests only |
| Typecheck | frontend: npm.cmd run typecheck | TS compile only |
| Build | frontend: npm.cmd run build | Bundler/PWA build only |

For local API tests, use test mode and synthetic file-backed SQLite URL with sqlite+pysqlite driver in a new temporary directory; assert imported app.main is under repository api root; remove EVOGYM_TEST_POSTGRES_URL and all provider/ambient DB URLs. Each invocation gets a newly created temp directory; cleanup only that directory. Do not use in-memory SQLite with pool options that need QueuePool. Never print environment values. Stop before connection if settings resolve to anything other than the isolated synthetic test DB.

## Independently assignable proof subdeliveries

| ID | Deliverable | Readiness/dependency | Limit |
|---|---|---|---|
| P11.1 | Local runner/synthetic-isolation protocol | Local-ready; current repository config | Document exact safe runner and failure policy; no environment-file edit. |
| P11.2 | Database-free migration graph and local migration-test inventory | Local-ready; P11.1 | Alembic graph is not a database migration test; no PG target. |
| P11.3 | PostgreSQL migration/concurrency proof | Permission-blocked; explicit named disposable target, credential/session, operation, cleanup | No target selection, connection or credential discovery by P11. |
| P11.4 | Candidate evidence matrix and local suite/type/build handoff | Local-ready for authorized candidate checks; exact package candidate | Record result class and skips; hosted CI/E2E/security remain separately authorized. |

P11.1/P11.2 may proceed independently of package implementation. P11.4 consumes one frozen candidate and its authorized commands. P11.3 is optional/permission-gated, not a prerequisite to local contract drafting, and a skipped PG lane remains visibly pending.

## PostgreSQL gate

No PG command is authorized by this card. A future test requires human authorization naming disposable target, credential/session, operation and cleanup boundary. Before connection, verify target isolation/no production fallback, selected tests, environment URLs, cleanup scope and rollback plan. The test owner reports exact executed cases, skips/failures, approved server metadata and cleanup evidence. If target isolation is uncertain, stop. SQLite or Alembic heads does not waive this gate.

## Per-candidate evidence checklist

- [ ] Source commit/tree and worktree identity.
- [ ] Package subtask and acceptance scenario IDs.
- [ ] Exact command, CWD and selected modules.
- [ ] Synthetic fixture/database boundary and confirmation no ambient access occurred.
- [ ] Expected vs observed result, warnings, skips and duration; no fabricated RED/GREEN.
- [ ] PG/hosted/browser/provider/production status labeled pending or separately authorized.
- [ ] Migration graph/head evidence if applicable; never call graph check a DB migration test.
- [ ] Changed-path inventory confirms verification did not mutate unauthorized source.
- [ ] Any rerun is bounded; never blindly retry an uncertain external operation.

## Ordering, effort and rollback

P11 local preparation may run beside P1/P2/P6 and must not block them just because PG is unavailable. Run local candidate checks after authorized implementation and normalization. PG proof waits for a target. Hosted CI and workflow configuration are distinct evidence. Return package failures to their owner; P11 does not patch their source/tests. P12 owns import/release deliverables; P11 provides proof only.

Effort is **S** for graph/static runner checks, **M** for one local suite, **L** for authorized PG migration/concurrency proof. This excludes external wait time.

Verification is read-only. Revert only clearly generated artifacts from the authorized command when safe and specifically owned; never clean broad build/tmp/output folders or user files.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P11.1 | No runtime writes; runner inspection only | `docs/work-packages/contracts/P11.1-local-proof-protocol.md` (PROPOSED) | Document local safe runner; do not add environment files/secrets. |
| P11.2 | No runtime writes; graph/test inspection only | No additional path | Graph-only Alembic heads is not PG upgrade proof. |
| P11.3 | No runtime writes until explicit target approval | No target/config path pre-authorized | Requires explicit disposable target, credential/session, operation and cleanup boundary. |
| P11.4 | No runtime writes; evidence report only | `docs/work-packages/contracts/P11.4-candidate-evidence.md` (PROPOSED) | Local typecheck/build/test receipts only; hosted CI/E2E/security proof permission-gated. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Assignment brief**

> Take only P11.1, P11.2, P11.3, or P11.4 from this card. Select the exact row and copy its candidate path subset above verbatim. Record the candidate package/subtask and source baseline commit/tree. Run only separately authorized local commands or a separately authorized disposable PostgreSQL operation. Do not edit package code, select a DB target, use ambient .env/DB/provider credentials, contact hosted CI/remotes, or touch private workbooks. Confirm API tests use synthetic file-backed SQLite and cannot fall back to PG. Report exact command/CWD, actual counts/timing/warnings/skips, target class, cleanup, changed paths and all unrun gates. Alembic heads is graph proof only.

Evidence: [source-baseline reconciliation](../backend-audit/post-audit-reconciliation.md); [BK ledger](../../odd/tasks/backend-implementation.md); [verification criteria](../backend-plan/05-verification-and-coverage.md); api/migrations/env.py; api/tests/test_migrations.py and test_migrations_postgres.py.
