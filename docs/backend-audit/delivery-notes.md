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
Clean R1 proof is PARTIAL: API 30 passed and frontend 64 passed; compiler reported two baseline TS2353 errors in unchanged finance fixtures. R1 acceptance is blocked pending R1a and a clean compiler rerun.
Rollback: only R1 CORS hunks in `api/app/main.py`, `api/tests/test_app.py`, checkout API/component/test hunks and `frontend/src/features/checkIns/offlineClock.test.ts`; preserve unrelated dirty wiring.
Commit identity: `a58113e394cbf3230c114968c6b7777b6eb67e2f`; this observed R1 commit does not close the blocked compiler acceptance.

## R1a

Baseline cause: clean R1 typecheck found two TS2353 excess-property errors already present in baseline finance fixtures; unrelated dirty model changes had masked them in primary-worktree checks.
Outcome: remove only two unsupported `refundedAt` fixture properties in `frontend/src/demo/financeReportSelector.test.ts`; do not adopt the dirty domain model or change production selectors.
Invariant: test names/assertions, sale facts and negative ledger events with their `recordedAt` refund dates remain byte-for-byte unchanged apart from those two property removals.
Observed RED: parent clean-R1 compiler result failed on those two TS2353 errors; no new behavioral RED is invented for a fixture/compiler correction.
Primary fixture check: `frontend/` `.\node_modules\.bin\vitest.cmd run src/demo/financeReportSelector.test.ts --maxWorkers=2 --reporter=dot` → 9 passed (2.22s); dirty-worktree success cannot substitute for a clean compiler result.
Clean GREEN: PENDING after parent commits R1a and independently checks compiler, finance fixtures and checkout against the clean owned prefix.
Rollback: restore only the two removed finance-fixture properties; no domain/selector/source or unrelated dirty-file rollback is authorized.
Commit identity: PENDING; proposed message `test(finance): remove unsupported refund fixture metadata`.
