# F01 — Authenticated cash-shift lifecycle

## Objective and approved product flow
Implement the existing cash-shift workflow through the real authenticated API without redesigning the screens or implementing F04 sales UI.

The user clarified on 2026-10-26: opening automatically selects the applicable time window; the responsible receptionist is the authenticated opener; opening cash requires denomination counts; staff counts physical inventory and enters a reason for any known discrepancy before opening. Do not replace this with a reduced/manual-choice workflow.

## Baseline and preservation
- Base: f267cac on codex/backend-foundation; working branch: codex/f01-cash-shift-lifecycle.
- Preserve the original 11 dirty paths and the untracked remaining-feature-integrations.md backlog. Do not stage unrelated files, private spreadsheets, temporary outputs, secrets, runtime env files or dependency changes.
- Recorded baseline: API 508 passed / 18 skipped; frontend 739 passed; TypeScript app/node and production build passed. These are historical, not F01 proof.
- RDD is explicitly off at clone/global scope. Do not enable or start it. Independent functional verification remains required.
- Delivery strategy: exception-ok, explicitly approved for F01 by the user on 2026-10-26. One local feature branch with cohesive functional commits. Forecast: 650–900 authored lines including tests/migration/adapters; advisory only, never remove tests or compress code to fit. No remote publication or automatic merge is authorized.

## Scope and minimal technical decisions
- Strict visual freeze: no stylesheet/class/layout/component visual changes or new controls without explicit user approval. Reuse the existing components and bind real data/callbacks only. If integration requires a visual change, stop that part and ask the user first.
- Reuse ShiftOpenModal, ShiftCloseDialog and existing shift visual components; API mode must not load DemoProvider or fabricate DemoState/financial history.
- Use actual Admin/ProductAccess authenticated request transports and server-side actor/branch authorization, not token globals or a client-selected responsible user. opened_by already stores the opener; no duplicate responsibility column.
- Derive the displayed time window using authoritative opened_at and the existing business timezone/cutoff. Preserve existing time-window behavior; do not invent new operating-hour rules or add a redundant window column. Verify the actual cutoff implementation rather than copying an exploration summary.
- Only denomination counts are allowed in the live opening flow. Preserve existing denomination validation and integer minor-unit amounts.
- Add minimal persisted reason/comment support to inventory observations. Require a nonblank reason when physical quantity differs from a known authoritative snapshot quantity; keep unknown baselines unknown. Return comments on reload. A reason documents a discrepancy; it must not create waste/restock stock-ledger movements (F09).
- Preserve stale-snapshot, wrong-branch, duplicate count and negative quantity protections.
- Preserve the current close preview. If current read DTOs lack expected cash, expose a server-computed read value using the same calculation as close; do not calculate authoritative money from incomplete frontend arrays. Persisted close response remains authoritative if activity changes after a preview.
- Uncertain opening must reconcile the current register shift before retrying; a unique-active-shift constraint is not idempotent-open proof. Identical closed-count retries must replay; changed counts must conflict under existing API semantics.

## Work units and routing
All tasks use delegated direct: connected multi-file changes and execution exceed the inline budget. One Luna writer at a time; parent review plus independent verification. Exact edit surfaces are derived before each writer starts.

- [x] T1 Add inventory discrepancy reason persistence, API DTO validation/readback and a single-head migration. Observed RED on missing reason, then GREEN. Commit: `e156222` (`feat(shifts): persist inventory discrepancy reasons`).
- [ ] T2 Connect the existing authenticated opening/current workflow: real register/snapshot, automatic opener/window, denomination-only count, discrepancy comments, error/retry states and reload. Reuse the modal design and actual route shell.
- [ ] T3 Connect persisted totals and closing to the existing close interface. Verify live reconciliation preview, close/reload, immutable closed totals and retry behavior; do not build membership checkout. Backend read-contract note: `GET /api/v1/shifts/current` and `GET /api/v1/shifts/{id}` use `ShiftDTO.expected_cash_at_close_minor`, which remains null until close freezes it. T3 should expose a server-computed active preview from the same canonical cash calculation; keep the close result authoritative if activity changes after preview.
- [ ] T4 Independently verify the feature with API/frontend/type/build checks and real-browser disposable API/DB flows; record exact commit/commands/results, skipped checks and warnings. Obtain owner daily-workflow signoff separately.

## Acceptance evidence required
- A real receptionist can open a scoped register shift using the automatic flow and retrieve its state/comments after reload.
- Tests reject missing reason for a known count discrepancy, negative/duplicate counts, stale snapshots and unauthorized branches; unknown baseline is never treated as zero.
- Open timeout/retry cannot silently create a second shift or claim another opener's shift as its own; closed retry and changed-count conflict follow the contract.
- Seed supported register activity through existing API fixture operations to verify real totals, then close and read frozen expected/counted/difference values. This is not permission to implement F04 UI.
- Observe meaningful deterministic RED before fixing behavior, then GREEN. Run targeted API tests (shifts, inventory reviews, auth/branch and migration cases), affected route/modal/client tests, actual app/node TypeScript and production build. Full applicable suites run at closure, serialized where necessary to avoid the recorded CPU-load timeouts.
- Browser proof must use the mounted authenticated route and a disposable real API/DB, including happy path, a denied/invalid path, hard reload and persisted data—not only a success toast.
- PostgreSQL-specific tests require an explicitly authorized disposable target. Never migrate a production database for verification. No installs, remote work, publishing, destructive Git or unrelated feature changes.

## Current status and next step
- User product flow is resolved. T1 backend persistence and DTO readback are implemented and verified; no visual/UI files changed.
- Opening inventory reasons are nullable up to 500 characters, trimmed at input, and required only when the consumed snapshot has an initialized, non-null baseline that differs from the physical count. Unknown baselines stay unknown; existing rows remain null; inventory totals/ledger are not rewritten.
- T1 checks: RED `pytest tests/test_inventory_reviews.py::test_known_inventory_difference_requires_and_persists_reason -p no:cacheprovider -q` failed before implementation as expected; GREEN API targeted suite `pytest tests/test_inventory_reviews.py tests/test_shifts.py tests/test_migrations.py tests/test_contract_smoke.py -p no:cacheprovider -q` passed 88 tests (21 warnings). Follow-up `pytest tests/test_inventory_reviews.py -p no:cacheprovider -q` passed 18 tests. PostgreSQL-specific tests were not run because no disposable PostgreSQL target was authorized.
- Existing backend already supports secure opener attribution, denomination counts, snapshot validation and persisted close reconciliation.
- T3 retains the active-cash preview read-contract above; do not add a stored expected-cash column or frontend-computed totals.
- Next: T2 connects the existing UI without visual changes. Engram mirror is pending while the provider is unavailable.
