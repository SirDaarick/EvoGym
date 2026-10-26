# P1 — Employee initial PIN lifecycle

## Objective
Implement the approved first employee PIN slice: Admin issue/reset, cryptographically random six-digit initial PIN returned once, seven-day unused expiry, mandatory replacement before normal session issuance, and revocation of active employee sessions on reset.

## Authorization and allowed edits
The user explicitly approved the eleven candidate paths, including serial router registration and migration work:
- `api/app/db/models/staff.py`
- `api/app/auth/credentials.py`
- `api/app/auth/sessions.py`
- `api/app/api/admin_auth.py`
- `api/app/api/staff_credentials.py` (new)
- `api/app/main.py`
- `api/migrations/versions/0032_employee_pin_lifecycle.py` (new)
- `api/tests/test_credentials.py`
- `api/tests/test_sessions.py`
- `api/tests/test_staff_auth.py`
- `api/tests/test_staff_credentials.py` (new)
- `odd/tasks/p1-employee-pin-lifecycle.md` (automatic recovery tracking)

Preserve all pre-existing P1 work and unrelated dirty/untracked files, including migration 0031. No B/C, frontend, other routers, shared model registry, CI, provider, .env, real credential or production changes. No staging or commits. RDD is off; do not enable it. Existing lockout behavior must remain five failed attempts/five minutes per employee and reset the counter after expiry.

## Plan and delivery
Route: delegated direct for implementation and verification; substantial model/service/API/migration behavior needs one Luna writer and an independent verifier. Serial reservation: only this writer edits `main.py` and the new 0032 migration. Forecast: 250–450 authored changed lines, provisional and advisory; no code-golf or omitted tests to fit it. Delivery strategy: ask-on-risk; no commit permitted, so commit identity N/A.

## Tasks
- [x] **EPIN-01:** Add lifecycle persistence and deterministic regression coverage; observe RED before implementing issuance/reset/expiry/first-change gating. RED was observed as collection failure because the proposed service module did not exist; the tests then targeted the established credentials module.
- [x] **EPIN-02:** Implement authorized Admin issue/reset and employee first-change API with generic denial, one-time response disclosure, hash-only storage, active-session revocation and required router registration.
- [x] **EPIN-03:** Run focused synthetic regression checks and independent review, including new migration structural/database proof when safely available; record every unavailable or pending check. Independent verification passed: 107 focused tests, genuine PostgreSQL migration continuity and a bounded reciprocal-reset race.

## Acceptance
- Only an authenticated authorized Admin can issue/reset an eligible employee PIN. Normal Staff credentials must not grant this authority; deny inactive/missing targets safely.
- Generated PIN is a cryptographically random six-character digit string, including leading zeros; raw PIN appears only in the successful issue/reset response, never persistent storage, logs or later reads.
- Initial PIN expires if unused at seven days, rejects at the exact boundary, and only an Admin can reissue it.
- Initial PIN cannot mint an ordinary employee branch session until it is replaced with a different valid six-digit PIN. The replacement must prove the current initial PIN, preserve lockout rules and require a currently valid employee/branch grant. Do not expose reusable bypass credentials.
- Reset invalidates the old PIN and revokes active employee PIN-authenticated phone/Reception sessions without revoking unrelated Admin sessions.
- Migration 0032 follows 0031, preserves existing rows and clearly defines compatibility behavior; do not silently invalidate legacy credentials or assert full employee lifecycle migration without evidence.
- Existing credential, staff/session, Admin authentication and generic error behavior remain valid. Session lifetime/alerts/device-deactivation policies beyond this first slice remain separate pending work.

## Verification
Existing venv deterministic pytest tests in `test_credentials.py`, `test_sessions.py`, `test_staff_auth.py`, and new `test_staff_credentials.py`; add relevant existing Admin/auth-failure cases when changing shared auth boundaries. Use fresh empty scratch cwd outside OneDrive, absolute pytest config/test paths, clean synthetic environment, new nonexistent basetemp and existing dependencies. No real .env or database/provider access. Log exact RED/GREEN commands/counts and migration scope. Tests may use synthetic SQLite. PostgreSQL proof, if performed, must use only a uniquely created loopback-bound disposable local instance and fictitious data; never ambient database URLs or unrelated containers. No installs/image pulls.

Run `git diff --check`. Independent review must check authorization, state-machine/expiry boundaries, replay/races, secret redaction, all modified callers and rollback. No claim of complete P1, production bootstrap, UI integration or universal concurrency proof.

## Progress
Exploration found existing five-attempt/five-minute lockout and pending security event, but no initial-PIN issuance/unused expiry/mandatory-change fields. Existing sessions support explicit expiry/revocation. Current migration head was 0031; this slice adds 0032.

Implementation progress (independently verified within the authorized slice):

- Added `pin_change_required` and nullable `initial_pin_expires_at`; migrated legacy rows to `false` without invalidating their PINs. Migration 0032 statically follows 0031 and its downgrade refuses to discard pending first-change state.
- Added Admin-authorized issue/reset that rechecks the live organization Admin session and grant in the mutation transaction, returns a `secrets.randbelow` six-digit string once with `Cache-Control: no-store`, persists only its salted hash, sets a seven-day deadline, clears lockout and revokes active employee PIN sessions. Admin sessions are not targeted.
- Added employee first-change endpoint; it requires matching unexpired initial PIN, different valid six-digit replacement, active staff and branch grant; wrong attempts use the existing five-attempt/five-minute lockout row. Ordinary session issuance rechecks the mandatory-change flag under the credential lock. Existing credentials default to legacy-compatible behavior.
- Applied one bounded independent-review correction: first-change now uses the shared IP limiter and password-hash semaphore, and its exact route is covered by the existing request-body cap; invalid branch/staff scope is denied before bcrypt and does not consume an account PIN attempt, while valid-scope wrong PINs continue through the existing lockout. Admin resets lock actor+target user rows in ascending UUID order before credential/session rows, preventing reciprocal reset lock inversion.
- Correction RED command ran in fresh empty `C:\Users\edani\Documents\Codex\2026-10-23\ho\work\employee-pin\red-correction2` with a cleared child environment (`PYTHONPATH=<repo>\api`, `PYTHONDONTWRITEBYTECODE=1`, `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, `EVOGYM_ENV=test`, plus OS `SystemRoot`/`WINDIR`/system `PATH`): `python -m pytest -c C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\pyproject.toml C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\tests\test_staff_credentials.py -k "shared_auth_body_limit or shared_auth_rate_limit or shared_password_hash_capacity or invalid_branch or canonical_uuid_order" -vv -p no:cacheprovider --basetemp C:\Users\edani\Documents\Codex\2026-10-23\ho\work\employee-pin\red-correction2\pytest-tmp`; **5 failed**, 8 deselected, 9.24s. Failures were observed behavior: 422 instead of 413, 401 instead of 429/503, invalid-branch bcrypt invocation, and actor-before-target lock ordering.
- Correction selected GREEN command used the same clean environment and absolute config/test paths with fresh cwd/basetemp `C:\Users\edani\Documents\Codex\2026-10-23\ho\work\employee-pin\green-correction1`; **5 passed**, 8 deselected, one Starlette/httpx warning, 9.46s.
- Test-first evidence: initial command used the absolute `api/tests/test_staff_credentials.py` path and fresh `red-1` basetemp, with `PYTHONPATH=<repo>/api`, `PYTHONDONTWRITEBYTECODE=1`, `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, and `EVOGYM_ENV=test`; result was 0 collected, one expected collection error `ModuleNotFoundError: app.auth.staff_credentials` (the proposed API had not yet been implemented).
- Writer GREEN command ran from fresh empty `C:\Users\edani\Documents\Codex\2026-10-23\ho\work\employee-pin\full-correction` with cleared child environment (`PYTHONPATH=<repo>\api`, `PYTHONDONTWRITEBYTECODE=1`, `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, `EVOGYM_ENV=test`, plus OS `SystemRoot`/`WINDIR`/system `PATH`): `python -m pytest -c C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\pyproject.toml C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\tests\test_credentials.py C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\tests\test_sessions.py C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\tests\test_staff_auth.py C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\tests\test_admin_auth.py C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\tests\test_authentication_failures.py C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym-worktrees\front-a-contracts\api\tests\test_staff_credentials.py -vv -p no:cacheprovider --basetemp C:\Users\edani\Documents\Codex\2026-10-23\ho\work\employee-pin\full-correction\pytest-tmp`; **107 passed**, one existing Starlette/httpx deprecation warning, 80.27s.
- Additional new-file-only run used the same environment and absolute configuration/test paths with `--basetemp C:\Users\edani\Documents\Codex\2026-10-23\ho\work\employee-pin\green-4`; **7 passed**, one same warning, 21.46s.
- Migration structural check (no database): AST-parsed seven changed/new Python files and asserted `0032_employee_pin_lifecycle.down_revision == 0031_admin_session_policy.revision`; passed. `git diff --check` passed; Git emitted existing working-tree LF/CRLF notices for unrelated dirty files.
- Parent reports the prior independent review observed 102 passing tests and a passing PostgreSQL migration proof; independent review of the correction batch passed with no actionable issue. Full API suite/build were not run. No commit or staging performed per authorization override. Runtime warning: installed TestClient path emits Starlette's `httpx` deprecation warning.

## Next step
Next: independent review of the bounded correction batch; no product-scope expansion is planned.


## Independent verification and closure

- A fresh isolated focused run passed **107 tests in 80.99s**, with one existing Starlette/httpx deprecation warning. The independent reviewer found no remaining actionable issue in this bounded candidate.
- Genuine disposable PostgreSQL 16 migrations from 0031 to 0032 preserved the legacy credential hash and failure count, defaulted lifecycle fields to false/NULL, and enforced the check constraint. Downgrade refused pending first-change state without damaging it; after consuming that state, downgrade/re-upgrade preserved the legacy row.
- The corrected first-change route is covered by existing rate/hash-capacity limits and body-size bounds; invalid branch scope is denied before hashing. Reciprocal resets acquire staff rows in canonical UUID order.
- A separate disposable PostgreSQL run upgraded through 0032 and exercised barrier-synchronized reciprocal Admin resets: both completed, both targets obtained fresh initial-PIN state, and both Admin sessions remained active. This proves that bounded schedule, not universal deadlock freedom. One initial scratch fixture-order foreign-key error was corrected in the harness only before the successful run.
- Disposable containers created for verification were stopped. No real database, credentials, provider, hosted CI, or full API/build execution was used. Parent structural readback and git diff --check passed.
