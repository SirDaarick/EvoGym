# F01 — Authenticated cash-shift lifecycle

## Objective and approved product flow
Implement the existing cash-shift workflow through the real authenticated API without redesigning the screens or implementing F04 sales UI.

The user clarified on 2026-10-26: opening automatically selects the applicable time window; the responsible receptionist is the authenticated opener; opening cash supports counted units, amount per denomination, or an explicitly entered total; staff counts physical inventory and enters a reason for any known discrepancy before opening. Do not replace this with a reduced/manual-choice workflow.

## Baseline and preservation
- Base: f267cac on codex/backend-foundation; working branch: codex/f01-cash-shift-lifecycle.
- Preserve the original 11 dirty paths and the untracked remaining-feature-integrations.md backlog. Do not stage unrelated files, private spreadsheets, temporary outputs, secrets, runtime env files or dependency changes.
- Recorded baseline: API 508 passed / 18 skipped; frontend 739 passed; TypeScript app/node and production build passed. These are historical, not F01 proof.
- RDD is explicitly off at clone/global scope. Do not enable or start it. Independent functional verification remains required.
- Delivery strategy: exception-ok, explicitly approved for F01 by the user on 2026-10-26. One local feature branch with cohesive functional commits. Forecast: 750–1,100 authored lines including tests/migration/adapters; advisory only, never remove tests or compress code to fit. No remote publication or automatic merge is authorized.

## Scope and minimal technical decisions
- Strict visual freeze: no stylesheet/class/layout/component visual changes or new controls without explicit user approval. Reuse the existing components and bind real data/callbacks only. If integration requires a visual change, stop that part and ask the user first.
- Reuse ShiftOpenModal, ShiftCloseDialog and existing shift visual components; API mode must not load DemoProvider or fabricate DemoState/financial history.
- Use actual Admin/ProductAccess authenticated request transports and server-side actor/branch authorization, not token globals or a client-selected responsible user. opened_by already stores the opener; no duplicate responsibility column.
- Derive the displayed time window using authoritative opened_at and the existing business timezone/cutoff. Preserve existing time-window behavior; do not invent new operating-hour rules or add a redundant window column. Verify the actual cutoff implementation rather than copying an exploration summary.
- User-approved opening capture modes: units per denomination, amount per denomination, and total manual. Reuse the existing controls. Convert the first two to exact physical counts; reject non-multiples rather than rounding. Manual totals must persist honestly without a fabricated denomination breakdown. Preserve integer minor-unit validation. This supersedes the prior denominations-only assumption.
- Add minimal persisted reason/comment support to inventory observations. Require a nonblank reason when physical quantity differs from a known authoritative snapshot quantity; keep unknown baselines unknown. Return comments on reload. A reason documents a discrepancy; it must not create waste/restock stock-ledger movements (F09).
- Preserve stale-snapshot, wrong-branch, duplicate count and negative quantity protections.
- Preserve the current close preview. If current read DTOs lack expected cash, expose a server-computed read value using the same calculation as close; do not calculate authoritative money from incomplete frontend arrays. Persisted close response remains authoritative if activity changes after a preview.
- Uncertain opening must reconcile the current register shift before retrying; a unique-active-shift constraint is not idempotent-open proof. Identical closed-count retries must replay; changed counts must conflict under existing API semantics.

## Work units and routing
All tasks use delegated direct: connected multi-file changes and execution exceed the inline budget. One Luna writer at a time; parent review plus independent verification. Exact edit surfaces are derived before each writer starts.

- [x] T1 Add inventory discrepancy reason persistence, API DTO validation/readback and a single-head migration. Observed RED on missing reason, then GREEN. Commit: `e156222` (`feat(shifts): persist inventory discrepancy reasons`).
- [x] T1b Extend the opening contract minimally for a genuine manual total without denomination rows; preserve counted modes, legacy reads and secure opener/snapshot constraints. Observed RED -> GREEN; API readback verified. Implementation commit: `5d3180c95c5b58b6b9db88633bdee6520c5075a4` (`feat(shifts): support manual opening cash total`).
- [ ] T2 Connect the existing authenticated opening/current workflow: real register/snapshot, automatic opener/window, all three approved count modes, discrepancy comments, error/retry states and reload. Reuse the modal design and actual route shell.
- [ ] T3 Add the smallest server-computed current-cash preview from the canonical close calculation, then connect persisted totals and closing to the existing close interface. Keep expected_cash_at_close_minor frozen/nullable until close rather than overloading its meaning. Verify live reconciliation preview, close/reload, immutable closed totals and retry behavior; do not build membership checkout. **Backend subtask completed:** `GET /api/v1/shifts/current` and `GET /api/v1/shifts/{id}` expose distinct `current_expected_cash_minor` for open shifts; `expected_cash_at_close_minor` stays null until close. The same `expected_cash_for_shift(session, shift)` calculation is used by preview and close. Close accepts either denomination rows or explicit `counted_cash_minor`, persists existing `closing_notes`, rejects ambiguous/invalid values, preserves count rows only for physical breakdowns, and only replays closed requests with identical normalized mode/amount/counts/notes; changed totals, mode or notes conflict. `GET /api/v1/shifts?register_id=...&offset=0&limit=50` returns `{items,total,offset,limit}` in deterministic newest-first order and enforces register branch scope. Backend commit: pending below. UI wiring and full F01 acceptance remain pending. Unsupported extra/expense/rental, payment-method/activity summary data was intentionally not fabricated or added in this bounded backend slice.
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
- T1b adds a manual-total API mode while preserving truthful denomination data; see the T1b contract note below.
- T3 backend RED/GREEN evidence: two new API tests initially failed (manual close was rejected by the schema; active preview field was absent). After implementation, `pytest tests/test_shifts.py tests/test_inventory_reviews.py tests/test_sales.py -p no:cacheprovider -q` passed 76 tests (1 pre-existing Starlette/httpx deprecation warning). Tests cover manual close/reload, note persistence and retry conflict, strict totals, existing denomination close/replay, frozen close field versus live preview, paged history metadata, and cross-branch history denial. PostgreSQL-specific tests were not run because no disposable PostgreSQL target was authorized.
- Next: T2 connects the existing UI without visual changes. T3 frontend close integration and T4 independent full verification remain pending. Engram mirror must remain synchronized.

## T1 independent verification and UI approval checkpoint
- T1 implementation commit: e156222; evidence commit: 032d71f. A fresh Luna verifier reran 88 targeted API tests (21 existing warnings) at 032d71f, with no findings. Disposable SQLite HTTP proof: missing discrepancy reason returned 422; padded reason returned 201, was trimmed, attributed to the authenticated opener and survived GET current-shift readback. PostgreSQL was not verified.
- Parent spot check: tests/test_inventory_reviews.py -k reason passed 2 tests (16 deselected). No full F01 suite or browser proof is claimed yet.
- Native risk assessment was unassessable because unrelated untracked files were deliberately preserved; treated as high. RDD remains off. Independent T1 verification was performed instead; this is not native-review approval.
- Frontend files and styles remain unchanged. The user subsequently approved the conditional register selector and surplus-reason UI changes; no UI files are changed in T1b.
- Concrete UI seams: the existing inventory reason control is shown only for shortages; surplus rows currently show static text. The modal also exposes manual cash and editable time-window controls. API employee sessions identify a branch, not a default register; never silently select the first of several registers.
- Approved UI scope (latest user clarification): reuse the same reason control in its existing column for shortages and surpluses; keep automatic time selection and all three opening modes; select one authorized register automatically, but show a Caja selector before counting if multiple authorized registers exist. No CSS/redesign or duplicate screen.
- No UI writer has been launched yet. The full F01 feature remains incomplete.

## Latest user clarification — approved capture modes and UI scope
- Keep all three existing opening modes: quantity per denomination, amount per denomination, and total manual. A total-only entry must not create fake bill/coin rows or falsely claim a measured breakdown. A per-denomination amount must divide exactly into whole bills/coins.
- Comments are required for known surplus as well as shortage; reuse the existing reason control in its current inventory column.
- Exactly one authorized register is selected automatically. When multiple registers are available, use the previously proposed register selector; never silently pick the first.
- The earlier proposal to disable total-manual capture is rejected and superseded. Preserve existing visual design and controls; only the explicitly approved reason coverage and conditional register control are authorized. No other visual changes may be made without asking.
- T1 reason persistence and T1b manual-total API contract are complete. T2/T3/T4 remain pending. The current implementation branch and size exception remain in force.


## T1b verified opening API contract
- `POST /api/v1/shifts/open`: omit `denomination_counts` only when providing an explicit nonnegative signed-64-bit integer `opening_cash_minor`; this is the manual-total mode. Explicit `denomination_counts: []` is invalid. When counts are supplied, they remain strict physical counts; total is derived and any supplied compatibility total must match exactly.
- Manual total 0 is valid only when explicitly present. Missing both fields, booleans, floats, negative values, and out-of-range values are rejected. No denomination row or inferred capture-method column is written.
- `GET /api/v1/shifts/current` (and existing shift DTO reads) returns `denomination_counts: []` when no breakdown was recorded. This means the breakdown is unavailable; it does not assert that a legacy record used manual entry. Legacy rows remain valid without migration. Authenticated opener attribution, branch enforcement, and snapshot consumption are unchanged.
- RED: `pytest tests/test_shifts.py::test_open_shift_accepts_manual_total_without_denomination_breakdown tests/test_shifts.py::test_open_shift_requires_valid_explicit_total_without_denomination_breakdown tests/test_shifts.py::test_open_shift_rejects_explicit_empty_denomination_list_as_unclear_mode -p no:cacheprovider -q --basetemp %TEMP%/evogym-f01-manual-red` -> 1 failed (manual total rejected as missing denomination_counts), 6 passed.
- GREEN focused: same three tests plus `test_manual_total_opening_roundtrips_without_fabricated_denominations` -> 8 passed, 1 existing Starlette httpx deprecation warning.
- GREEN targeted suite: `pytest tests/test_shifts.py tests/test_inventory_reviews.py -p no:cacheprovider -q --basetemp %TEMP%/evogym-f01-manual-full` -> 54 passed, 1 existing warning (40.06s). Disposable SQLite API test verified 201 open, authenticated opener readback, current-shift GET with an empty breakdown, no denomination rows persisted, and explicit empty list 422. PostgreSQL-specific tests not run.
- Scope: backend/API only; no schema migration, frontend, or new persistence column. Work-unit commit: `5d3180c95c5b58b6b9db88633bdee6520c5075a4`.
