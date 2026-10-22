# Backend remediation delivery notes

Baseline: `709466caa545d862c6effc53a9bbaf1a8a28d65f` on `codex/backend-foundation`, 2026-10-22.
These ordered notes accompany sequential local work units; evidence below came from the dirty working tree, not a clean committed prefix.
User approved `auto-chain` / `feature-branch-chain` preparation locally only: no PR, push, remote publication or claim of clean-prefix verification.

## R1

Outcome: align CORS/browser methods and idempotency headers, serialized plan/register arrays, current-shift `cash_register_id`, typed plan IDs and the clock-test fixture.
Exclusions: no broader frontend/auth rewrite, historical plan fallback, schedule implementation or PostgreSQL proof.
Dirty API proof: root `.\api\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider api/tests/test_app.py api/tests/test_settings.py` → 30 passed; preceding app RED had 5 failed/11 passed.
Dirty frontend proof, `frontend/`: `.\node_modules\.bin\vitest.cmd run src/api/membershipCheckoutApi.test.ts src/features/reception/LiveMembershipCheckout.test.tsx src/features/checkIns/offlineClock.test.ts src/api/receptionApi.test.ts src/features/reception/LiveMemberLookup.test.tsx src/features/reception/LiveMemberRegistration.test.tsx --maxWorkers=2 --reporter=dot` → 64 passed; two-file preceding RED had 24 failed/16 passed.
Dirty compiler command: `frontend/` `npm.cmd run typecheck` → exit 0; these results do not establish a clean R1 commit prefix.
Clean-prefix verification: PENDING against the exact owned R1 index/commit tree; record its command and observed result before treating this prefix as proven.
Rollback: only R1 CORS hunks in `api/app/main.py`, `api/tests/test_app.py`, checkout API/component/test hunks and `frontend/src/features/checkIns/offlineClock.test.ts`; preserve unrelated dirty wiring.
Commit identity: PENDING; no commit or clean-prefix result is inferred from the dirty tests.
