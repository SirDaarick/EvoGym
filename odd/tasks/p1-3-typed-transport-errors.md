# P1.3 - Typed transport error mapping

## Objective
Normalize generic HTTP, network, and request-correlation failures across the existing reception and membership-checkout API clients, using the P1.3 behavior contract approved by the user. Keep business UI and package-specific recovery flows out of this task.

## Problem and motivation
The reception client throws generic errors and drops request IDs. The membership-checkout client has separate HTTP, network, and conflict errors, but parses legacy fields differently. This inconsistency makes callers lose stable status, code, and request-correlation information.

## Scope and constraints
- Normalize the error contract in the two existing clients and their adjacent tests only.
- Preserve HTTP status, stable structured error code when supplied, request ID from X-Request-ID or the approved response envelope, a safe message, and HTTP-versus-network distinction.
- Honor approved mappings: 401 invalid or revoked session; 403 insufficient authority without existence leaks; 409 known conflict; 429 safe retry-later; network failure; 5xx and validation with safe request ID and structured issues. The backend contract at `api/app/errors.py` uses a nested `error` envelope; validation issues contain only allowlisted `location` and `type` values.
- Preserve successful response behavior, including 204 handling, and preserve the existing checkout conflict specialization.
- Do not parse arbitrary raw response text or leak limiter keys, secrets, tokens, or backend internals.
- Do not change login or business UI, backend routes, P2/P3/P4/P6 consumers, or P1.4/P1.5 behavior.
- Do not add a shared operationalTransport file: it is unnecessary for this bounded slice and is not in the approved edit set.
- No package manifest or lockfile changes, credential use, remote services, or API/database calls.

## Authorized edit surfaces
- frontend/src/api/receptionApi.ts
- frontend/src/api/receptionApi.test.ts
- frontend/src/api/membershipCheckoutApi.ts
- frontend/src/api/membershipCheckoutApi.test.ts
- odd/tasks/p1-3-typed-transport-errors.md (this tracking document only)

## Task checklist
- [x] P1.3-01 - Implemented the typed transport contract, added focused assertions, and passed the focused test suite.

## Acceptance criteria
- [x] Both clients expose consistent typed HTTP metadata: status, structured code when available, request ID, and safe message.
- [x] Network failures remain distinguishable from HTTP failures.
- [x] 401/403/409/429/5xx/validation responses use safe mapped messages without exposing raw response text; validation issues are sanitized and capped at 20.
- [x] Request IDs are preserved from the response header and supported nested error envelope.
- [x] Existing successful response and 204 handling remain unchanged; checkout conflict behavior remains covered.
- [x] Only the four approved source/test files change; P1.1 and P1.2 work remains untouched.

## Verification
- Baseline before code changes: npm run test -- src/api/receptionApi.test.ts src/api/membershipCheckoutApi.test.ts - 2 files, 37 tests passed.
- Test-first: add or adjust focused assertions, observe RED when current behavior fails the approved contract, implement GREEN, then refactor while focused tests stay green.
- Test-first RED attempt: `npm run test -- src/api/receptionApi.test.ts src/api/membershipCheckoutApi.test.ts` could not load Vitest config because the local Tailwind native binding emitted invalid UTF-8 and Vite hit `spawn EPERM`; no test assertions ran.
- Final focused check from frontend after correction: `npm run test -- src/api/receptionApi.test.ts src/api/membershipCheckoutApi.test.ts` passed via the single escalated retry (exit 0; 2 files, 40 tests passed). Earlier sandbox attempts failed before test startup because the Tailwind oxide native binding emitted invalid UTF-8 and Vite hit `spawn EPERM`; the successful retry supersedes that environment failure.
- Independent static review follow-up: updated checkout assertions to expect safe status/network messages rather than raw server detail or fetch causes; added validation issue assertions for allowlisted fields/types, removal of arbitrary values, and the 20-item cap.
- No full frontend suite, build, typecheck, or browser check is authorized by this task.

## Routing and delivery
- Route: delegated direct; two existing API clients and two adjacent test files are non-trivial write surfaces.
- Trigger: implementation touches four non-trivial files and requires reading current behavior and tests before writing.
- Forecast: approximately 100-180 authored changed lines, excluding this tracking doc and generated node_modules; delivery strategy ask-on-risk.
- Current RDD mode: off (clone-local). No native review or receipt flow will be started.

## Progress
- [x] P1.3 error behavior contract approved by the user.
- [x] Exact four source/test paths and this tracking path approved.
- [x] Baseline focused tests passed (37 tests).
- [x] P1.3 tracking document mirrored to Engram before source edits.
- [x] P1.3-01 implementation, focused assertions, and focused verification complete (2 files, 40 tests passed). Coordinator review caught duplicate declarations and wrong envelope parsing, corrected before handoff; independent static review prompted safe-message/network expectation updates and explicit sanitized issue assertions.

## Next step
P1.3 is complete; coordinator is awaiting user direction before any later work package. Do not start P1.4/P1.5.
