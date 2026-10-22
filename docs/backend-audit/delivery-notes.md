# Backend remediation delivery notes

Baseline: `709466caa545d862c6effc53a9bbaf1a8a28d65f` on `codex/backend-foundation`, 2026-10-22.
These ordered notes accompany sequential local work units; each entry distinguishes dirty-worktree observations from explicitly reported clean-prefix results.
User approved `auto-chain` / `feature-branch-chain` preparation locally only: no PR, push, remote publication or unobserved clean-prefix PASS.

## R1

Outcome: align CORS/browser methods and idempotency headers, serialized plan/register arrays, current-shift `cash_register_id`, typed plan IDs and the clock-test fixture.
Exclusions: no broader frontend/auth rewrite, historical plan fallback, schedule implementation or PostgreSQL proof.
Dirty API proof: root `.\api\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider api/tests/test_app.py api/tests/test_settings.py` → 30 passed; preceding app RED had 5 failed/11 passed.
Dirty frontend proof, `frontend/`: `.\node_modules\.bin\vitest.cmd run src/api/membershipCheckoutApi.test.ts src/features/reception/LiveMembershipCheckout.test.tsx src/features/checkIns/offlineClock.test.ts src/api/receptionApi.test.ts src/features/reception/LiveMemberLookup.test.tsx src/features/reception/LiveMemberRegistration.test.tsx --maxWorkers=2 --reporter=dot` → 64 passed; two-file preceding RED had 24 failed/16 passed.
Dirty compiler command: `frontend/` `npm.cmd run typecheck` → exit 0; these results do not establish a clean R1 commit prefix.
Historical R1-only proof: API 30/FE 64 passed but compiler failed on unchanged baseline fixtures; after R1a, the clean R1 family passes API 30, finance/checkout FE 73 and typecheck.
Rollback: only R1 CORS hunks in `api/app/main.py`, `api/tests/test_app.py`, checkout API/component/test hunks and `frontend/src/features/checkIns/offlineClock.test.ts`; preserve unrelated dirty wiring.
Commit identity: `a58113e394cbf3230c114968c6b7777b6eb67e2f`; R1a below closes the previously blocked compiler acceptance.

## R1a

Baseline cause: clean R1 typecheck found two TS2353 excess-property errors already present in baseline finance fixtures; unrelated dirty model changes had masked them in primary-worktree checks.
Outcome: remove only two unsupported `refundedAt` fixture properties in `frontend/src/demo/financeReportSelector.test.ts`; do not adopt the dirty domain model or change production selectors.
Invariant: test names/assertions, sale facts and negative ledger events with their `recordedAt` refund dates remain byte-for-byte unchanged apart from those two property removals.
Observed RED: parent clean-R1 compiler result failed on those two TS2353 errors; no new behavioral RED is invented for a fixture/compiler correction.
Primary fixture check: `frontend/` `.\node_modules\.bin\vitest.cmd run src/demo/financeReportSelector.test.ts --maxWorkers=2 --reporter=dot` → 9 passed (2.22s); dirty-worktree success cannot substitute for a clean compiler result.
Clean GREEN: `09e616b019b2e98397a86d18ccac66965067cf5c` — API 30 passed; frontend 73 passed in 7 files; typecheck exit 0.
Rollback: restore only the two removed finance-fixture properties; no domain/selector/source or unrelated dirty-file rollback is authorized.
Commit identity: `09e616b019b2e98397a86d18ccac66965067cf5c`; results above identify this exact clean prefix.

## R2

Outcome: add a closed trusted public-error boundary, period/sample denial wiring, safe bounded validation diagnostics and their check-in OpenAPI schemas.
Exclusions: other domain/idempotency mappings, non-check-in OpenAPI overrides and typed frontend transport remain follow-ups.
Dirty RED: error/period/sample regressions → 15 failed/15 passed before implementation.
Dirty GREEN: root `.\api\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider api/tests/test_errors.py api/tests/test_member_check_ins.py api/tests/test_class_sample_check_ins.py` → 32 passed, 1 existing warning.
Proof scope: malicious metadata/detail redaction, actual expired-period/sample denials and schema checks passed only on the dirty snapshot.
Clean-prefix verification: `e53eddf2f48e0d44c32d0e288b3658e89e453046` — 32 passed; existing Starlette warning; clean imports verified.
Rollback: R2 hunks in `api/app/errors.py`, `api/app/api/member_check_ins.py` and the three named test modules, preserving other check-in work.
Commit identity: `e53eddf2f48e0d44c32d0e288b3658e89e453046`; results above identify this exact clean prefix.

## R3

Outcome: member/catalog/shift principal resolution falls back only on `AuthorizationDenied`; classified driver/pool failures return generic 503 and unexpected failures reach generic 500.
Exclusions: no service-wide database policy, blanket SQLAlchemy catch, new auth abstraction or weakened role/branch checks.
Dirty RED: corrected fault regressions → 42 failed/6 passed before the source fix; an earlier fixture-only pagination mistake was corrected first.
Dirty GREEN: root `.\api\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider api/tests/test_authentication_failures.py api/tests/test_members.py api/tests/test_catalog.py api/tests/test_shifts.py` → 104 passed, 1 existing warning.
Proof scope: exact validator calls, no unintended fallback, real revoked-token rejection and valid staff handler reads were checked on the dirty tree.
Clean-prefix verification: `26a845eadc91ce1a5b81d443e8f5d520139d5f95` — 104 passed in 58.91s; existing Starlette warning; isolated imports.
Rollback: only R3 resolver/import hunks in the three API modules and new `api/tests/test_authentication_failures.py`, not whole shared files.
Commit identity: `26a845eadc91ce1a5b81d443e8f5d520139d5f95`; results above identify this exact clean prefix.

## R4

Outcome: normalize required member text before length checks, reject blank/null required PATCH values, and distinguish omitted from explicitly null birth dates.
Exclusions: no data migration/backfill, new DB constraint, editable member number, eligibility/status policy or other nullable-field change.
Dirty RED: selected route regressions → 9 failed/3 passed, with 21 existing tests deselected.
Dirty GREEN: root `.\api\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider api/tests/test_members.py` → 33 passed, 1 existing warning.
Proof scope: rejection causes no row/count changes, formatting/aliases are preserved, and birth-date omission/update/clear behavior passes on synthetic SQLite in the dirty tree.
Clean-prefix verification: `6b16bab093a151ba4ff9aa81af36195e3838a1b6` — 33 passed in 49.97s; existing Starlette warning; isolated imports.
Rollback: only R4 validators in `api/app/members/schemas.py`, validated-text/date-presence hunks in `api/app/members/queries.py`, and its added member tests.
Commit identity: `6b16bab093a151ba4ff9aa81af36195e3838a1b6`; results above identify this exact clean prefix.

## R5

Outcome: explicitly select current migration/sale/shift PG modules in ephemeral CI and derive four post-head expected revisions from Alembic's graph.
Exclusions: no PostgreSQL/Docker/hosted run, new migration, changed isolation guard or comprehensive append-only/H01/H02 proof.
Dirty structural proof: installed-PyYAML/AST checks pass; unchanged test logic apart from the helper/import and four expected-head comparisons is verified, not database behavior.
Dirty collection command: root `.\api\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider api/tests/test_migrations_postgres.py` with database URLs absent → 4 skipped, exit 0.
Proof scope: dirty graph resolved `0030_staff_schedules`; 30-minute job/15-minute step bounds and three module paths were checked structurally only.
Clean-prefix verification: `f1153da6ef5718a64cd8480a69f107699ac4ebea` — YAML/AST passed; clean head 0029; migration collection 4 skipped, not PostgreSQL proof.
Rollback: R5 additions in `.github/workflows/api.yml` and helper/import/four comparison hunks in `api/tests/test_migrations_postgres.py`; preserve historical migration targets and fixture guards.
Commit identity: `f1153da6ef5718a64cd8480a69f107699ac4ebea`; results above identify this exact clean prefix.

## Clean committed full-suite receipt — partial frontend result

Source prefix: `f1153da6ef5718a64cd8480a69f107699ac4ebea`, tree `766529c26777de83338d394ac70c39c152a41107`; clean Alembic graph: **`0029_class_sample_check_ins (head)`**, not the uncommitted schedule draft 0030. The six source commits above are observed; D1–D3 documentation commits remain pending. No unowned source was adopted.

API commands used the existing shared primary-checkout `api/.venv/Scripts/python.exe`, with clean-checkout API imports (`PYTHONPATH` and `app.__file__` checked), fresh test-only process settings and database URLs absent. `$Python` below is a documentation alias for that same interpreter, not a claimed saved wrapper.

| Working directory / command | Observed clean-R5 result |
|---|---|
| Clean root: `& $Python -m pytest -q -p no:cacheprovider api/tests` | **335 passed, 17 PG skipped, 18 warnings**, 371.75s |
| Clean root: `& $Python -m pip check` | No broken requirements |
| Clean `api/`: `& $Python -m alembic heads` | `0029_class_sample_check_ins (head)` |
| Clean `frontend/`: `npm.cmd run typecheck` | Passed, 7.37s |
| Clean `frontend/`: `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **2 failed, 471 passed**, 63 files, 381.87s; NOT an all-green verdict |
| Clean `frontend/`: `npm.cmd run build` | Production/PWA passed, approximately 38.79s; Vite 2.75s; 524.79kB entry advisory |
| Clean root: `& $Python -m pytest -q -p no:cacheprovider api/tests/test_migrations_postgres.py` | **4 skipped**, 0.98s; not PostgreSQL execution |

The full frontend failures were the Members measured-visit mount/loading timeout (`frontend/src/features/members/Members.test.tsx:10`) and Owner keyboard focus expecting `Desde` after 20 tabs (`frontend/src/features/owner/Owner.test.tsx:51`). No assertion was weakened and the original failed full-run result is retained.

Same filtered command in clean R5 and baseline `709466caa545d862c6effc53a9bbaf1a8a28d65f`: `npm.cmd test -- --maxWorkers=2 --reporter=dot src/features/members/Members.test.tsx src/features/owner/Owner.test.tsx -t "registers a measured visit|keeps the skip link"` → **1 passed, 1 failed, 22 filtered skips** in both (13.92s / 15.00s). Members passed and Owner failed in both; relevant production/test directories were unchanged between those commits. Owner is a reproduced pre-existing baseline failure; Members' full-suite timeout did not reproduce in this focused comparison, and timing/load remains only a hypothesis. No full-suite retry occurred because both focused checks were not passing.

The earlier dirty snapshot's 367 API/578 frontend passes and graph 0030 include unowned drafts and are separate historical evidence, never clean-prefix proof. Current readiness is **scoped source checks passed, clean full frontend partial**. PostgreSQL/hosted CI, browser E2E, vulnerability scans and production/deployment were not run; no production certification or new functional approval follows from this receipt.
