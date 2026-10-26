# P1.5 — Local observability evidence

## Objective
Complete the authorized local P1.5 observability slice without changing production policy or CI workflows.

## Scope and authorization
The user approved implementation with Luna after the exact two candidate paths were presented. Allowed changes:
- `api/tests/test_observability.py`
- `docs/work-packages/contracts/P1.5-observability.md` (new)
- `odd/tasks/p1-5-observability.md` (this recovery document)

Preserve all existing P1.1–P1.4 work and unrelated dirty files. No source middleware changes, staging, commits, installs, real credentials, .env reads, live databases/providers, hosted CI, or B/C changes. CI workflow and retention/access policy remain integrator/product-owned. RDD is off; do not enable it.

## Plan and delivery
Route: delegated direct for both tasks; preparation and test execution are delegated. One Luna writer; independent focused verification after handoff.
Forecast: 80–180 authored changed lines, generated files excluded. Delivery: ask-on-risk. The existing no-commit instruction overrides work-unit commits; commit identities remain N/A.

## Tasks
- [x] **P15-01 (independently verified):** Added lifespan and WebSocket passthrough tests; renamed the HTTP test to state its actual scope. The observability suite and final combined focused run pass. Independent verification passed: 131 tests in 33.40 seconds, one existing Starlette/httpx warning.
- [x] **P15-02 (independently verified):** Drafted the local contract and recorded the CI definition boundary. The three pre-repair authentication failures were traced to stale validator call sites and resolved by authorized P15-03; no hosted CI was inspected. Independent verification passed: 131 tests in 33.40 seconds, one existing Starlette/httpx warning.

## Acceptance and verification
- Non-HTTP ASGI scopes reach the wrapped app unchanged with original receive/send callbacks, without synthetic HTTP headers or request context mutation.
- Existing request-ID generation, concurrent context, safe errors and auth-failure redaction remain covered; bounded rate-limit cases pass.
- Run existing venv pytest against `tests/test_observability.py`, `tests/test_errors.py`, `tests/test_authentication_failures.py`, and the existing named Admin-login/staff-PIN rate-limit cases (resolve exact node IDs before execution).
- Use a new empty scratch cwd outside OneDrive, absolute test/config paths, clean synthetic environment and fresh basetemp; no real .env loading or old pytest temp access.
- `git diff --check` passes. No build/hosted/provider/production proof is claimed.
- Test-first exception: this is regression coverage for behavior already implemented, not a behavior change. The added test may pass immediately; do not invent RED or modify working source to manufacture a failure.

## Progress
CodeGraph source inspection confirmed `RequestIdMiddleware.__call__` directly delegates non-HTTP scopes and returns before HTTP state/context/log/metric behavior. The prior HTTP test name mentioned non-HTTP but only sent HTTP requests. No runtime change was indicated.

### Writer verification evidence

- Added `test_non_http_lifespan_scope_is_passed_through_unchanged` and `test_non_http_websocket_scope_and_messages_are_passed_through_unchanged`; both assert exact scope/callback identity and no request-ID context, metrics, or API logs. WebSocket messages are identity-preserved and no response headers are injected.
- Renamed `test_ids_are_server_generated_for_normal_and_non_http_asgi` to `test_ids_are_server_generated_for_http_requests`.
- Test-first exception: this adds regression coverage for existing pass-through behavior, not a runtime behavior change; no artificial RED was appropriate.
- One focused pytest invocation used the existing `api/.venv/Scripts/python.exe`, absolute config/test paths, a fresh empty scratch cwd under `work/a-p15/`, clean child environment (`EVOGYM_ENV=test`, absolute `PYTHONPATH`, bytecode/plugin autoload disabled), and a new `--basetemp`. It selected all tests in `test_observability.py`, `test_errors.py`, and `test_authentication_failures.py`, plus `test_login_request_limit_returns_generic_429_and_body_is_bounded` and `test_staff_pin_route_uses_shared_rate_limiter`.
- Result: the invocation exceeded its 120-second timeout and was terminated. No pytest summary, pass count, failure count, or skip count was emitted; outcome is unknown, not a pass. No retry was performed. This limitation blocks task completion pending independent review/verification.
- Before authorized P15-03, independent verification reported the observability suite as 5 passed in 0.19 seconds. Its broader focused set reported 73 passed and 3 failed in 15.02 seconds; the failures were associated with `test_real_invalid_and_revoked_tokens_remain_generic_401` in `api/tests/test_authentication_failures.py` (expected 401, observed 500). P15-03 identified and repaired the stale two-argument Admin-validator calls; the post-repair focused result is recorded below. Independent verification of the repair passed: 131 tests in 33.40 seconds.
- A follow-up assertion now captures `request_id()` from inside both lifespan and WebSocket delegated app calls and compares it to the pre-call value. Targeted command: existing venv `python.exe -m pytest -c <absolute api/pyproject.toml> --rootdir <absolute repository> --basetemp <new work/a-p15 child> -p no:cacheprovider -q <absolute api/tests/test_observability.py>`, from a fresh empty `work/a-p15/` cwd with the clean synthetic environment. Result: **5 passed in 0.17s**, exit 0; no failures or skips reported.
- `.github/workflows/api.yml` was read only: it defines push/PR path triggers and an Ubuntu/Python 3.14 API workflow with synthetic PostgreSQL service and test/migration steps. No hosted workflow run was inspected.
- No real `.env`, credentials, database, provider, or hosted system was intentionally used. Retention/access policy remains undecided. Independent review completed with no actionable issue; no commit per user constraint.

## Authorized integration correction

The user explicitly approved repairing the following consumers and adding regression coverage after independent verification exposed a P1.4 integration regression:

- `api/app/api/members.py`
- `api/app/api/catalog.py`
- `api/app/api/shifts.py`
- `api/app/api/admin_enrollment.py`
- `api/app/api/device_pairing.py`
- `api/app/api/inventory.py`
- `api/app/api/membership_access.py`
- `api/app/api/pending_money.py`
- `api/app/api/staff_roster.py`
- `api/app/api/staff_schedules.py`
- `api/tests/test_authentication_failures.py`

- [x] **P15-03 (independently verified):** Supply configured Admin signing secrets to all ten validator consumers, preserve Staff authentication when Admin signing is unconfigured, and verify generic denial and valid credentials across the affected dependencies. Independent verification passed: 131 tests in 33.40 seconds, one existing Starlette/httpx warning.

Route: delegated direct (ten runtime consumers plus regression tests). Existing RED evidence: three authentication-failure cases expected HTTP 401 but returned HTTP 500. The current Admin validator requires a third signing-secret argument; these consumers still pass two. Do not weaken validator authentication or silently accept unsigned Admin tokens. Add focused regression assertions before the repair and observe their result. Forecast for this correction is approximately 120–250 authored lines; no commits or publication are authorized.

### P15-03 writer verification evidence

- Root cause: `validate_admin_session` requires `(session_factory, token, signing_secret)`, but the ten listed consumers passed only `(session_factory, token)`. Mixed Admin/Staff consumers now attempt Admin validation only when both Admin policy and token signing are configured, extracting the secret with `get_secret_value()`; otherwise they continue their existing Staff path. Admin-only consumers reject missing/unusable signing configuration with a generic 401. No validator behavior, roles, or authorization policy changed.
- Test-first RED: `test_configured_admin_secret_is_passed_to_every_consumer` selected 10 cases before the fix; all 10 failed because the validator received two arguments. Command used the existing venv, fresh empty `work/a-p15/repair/red` cwd and `--basetemp`, clean child test environment, `-p no:cacheprovider`, and the absolute `api/tests/test_authentication_failures.py` path with `-k configured_admin_secret_is_passed_to_every_consumer`. Result: **10 failed, 48 deselected in 2.57s**.
- Focused GREEN wiring proof: selected `configured_admin_secret_is_passed_to_every_consumer or missing_admin_signing_secret`; **20 passed, 48 deselected in 1.72s**. These are mocked call-site/fallback checks and do not claim cryptographic validation.
- Real credential proof: `test_real_signed_admin_token_authenticates_then_revocation_is_generic_401` exercised a signed Admin login through the members consumer, then confirmed raw and revoked Admin tokens return generic 401; **1 passed in 2.96s**. Existing real invalid/revoked Staff-token generic-denial cases also pass.
- Final local command used existing `api/.venv/Scripts/python.exe`, fresh empty `work/a-p15/repair/final-suite` cwd, new basetemp, clean child environment (`EVOGYM_ENV=test`, absolute `PYTHONPATH`, bytecode/plugin autoload disabled), absolute config/test paths, and `-p no:cacheprovider`; selected `test_observability.py`, `test_errors.py`, `test_authentication_failures.py`, `test_admin_auth.py`, `test_admin_sessions.py`, `test_admin_recovery_delivery.py`, `test_settings.py`, plus `test_staff_auth.py::test_staff_pin_route_uses_shared_rate_limiter`. Result: **131 passed in 33.35s**, no failures or skips, one Starlette/httpx deprecation warning. No database/provider/hosted system beyond synthetic local SQLite tests was used.
- `git diff --check` is required after documentation updates. No commit, staging, install, production-readiness claim, or whole-P1 completion claim is authorized. Writer proof and independent verification are complete. The independent run passed 131 tests in 33.40 seconds with one existing Starlette/httpx warning and found no actionable code issue. All 11 API Admin-validator calls found by targeted review pass the signing secret.

## Next step
The authorized local P1.5 work unit and integration correction are independently verified. Hosted CI, operational retention/access decisions, production bootstrap and deployment remain outside this evidence. No commits or staging were performed.

