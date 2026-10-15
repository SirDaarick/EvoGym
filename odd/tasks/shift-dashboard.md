# Shift Dashboard

Implement the approved shift dashboard in the existing Shifts screen, with a pure data selector, responsive activity visualizations, and a searchable/filterable operation table while preserving the close workflow.

## Problem and why

The current screen primarily exposes close controls and a basic cash summary; the approved wireframe calls for a clearer operational view of shift activity, confirmed financial totals, and an auditable movement ledger.

## Scope and constraints

- Use existing app shell, UI primitives, TanStack Charts 1.1.0, and TanStack Table 8.21.3; no package changes.
- Summary = opening + confirmed cash + Extra − Gasto. Chart activity counts distinct confirmed operations by sale family and shows amounts.
- Include ledger, expenses, extras, stock movements (excluding sale mirrors), and count movements. Optional arrays default to empty. Exclude pending specialized sources from confirmed chart/cash; count confirmed specialized amounts once from ledger and enrich via namespaced paymentId only.
- Dedupe product/supplement counts by namespaced cart IDs while retaining line-level history. Never invent actor, method, or amount.
- Render dates in America/Mexico_City from openedAt and the shift name from shift.window. Closed shifts retain snapshots; only open calculations and close snapshots use the new formula. Preserve negative expected values with a warning.
- Missing shift renders a safe empty state. Reset table state on shift change. Preserve close confirmation/revision guards and focus behavior on open/cancel. No T14 redesign.
- No source-mutating normalizers; preserve all pre-existing work. No package edits. No commit/staging when unrelated existing work prevents exact isolation.

## Visual redesign addendum

The user rejected the first dashboard presentation and explicitly authorized a visual refinement. Preserve accounting/domain behavior and current close-flow safeguards. Match EGC's existing color tokens and bento + claymorphism language; use restrained shadows/highlights, meaningful type scale, hierarchy, and concise copy. The referenced Anthropic `frontend-design` skill guides design and screenshot critique; do not install dependencies or modify global styles.

### Confirmed design contract

- Order: shift header/close action; three prominent KPIs; payment-method donut and compact activity bars; financial movements; separate inventory movements.
- Donut segments are cash/card **operation counts**. Center stays total confirmed sale count. Hover/focus communicates payment method, count, percentage, and confirmed amount. Pending transfers remain outside the donut and total. Empty shifts show a neutral zero ring.
- Financial table has exactly six columns: date/time, type, detail, buyer/person, payment method, amount. Keep search/type/method filters and independent 10/25/50 pagination; pending indicator stays inside payment method.
- Inventory table sits below, separately paginated/filtered, with date/time, movement, product, and quantity/count result. Keep restock, waste, and physical counts; exclude stock rows mirroring a sale.
- Preserve existing accounting formula, selector's namespaced de-duplication, access rules, close/review guards, historical snapshots, and non-Turno UI styles.
- Visual acceptance requires review at 1440, 1024, and 390 px in light and dark themes; include hover, keyboard focus, reduced motion, and ensure only table regions scroll horizontally.

## Route and forecast

- Route: delegated direct; trigger evidence: multi-file UI/domain/test implementation and preparation required reading existing shift and source data behavior.
- Forecast: approximately 450 authored changed lines (excluding generated files), revised after adding the exact header/close interaction, three KPI cards, six-family activity chart, payment-method panel, and regression coverage.
- Delivery strategy: ask-on-risk.
- Authorized paths: original dashboard files plus `src/app/App.test.tsx`, `src/features/sales/operations.test.ts`, and `src/demo/ownerOperations.test.ts` for alignment of close-form and cash-formula assertions; no other files may be changed.

## Checklist

- [ ] **S01 — Build and verify the shift dashboard** (pure selector tests, selector/formula, screen/chart/table/CSS integration, then focused verification).
  - [x] Add focused RED tests; the first run failed because `src/demo/shiftDashboard.ts` did not yet exist, then the focused selector suite passed 2/2.
  - [x] Implement selector and connect new open-shift formula to summary/close snapshot without changing closed snapshots or close guards.
  - [x] Integrate responsive summary, charts, and sortable/searchable/filterable/paginated activity table; handle shift changes and focus.
  - [x] Add regression coverage for six sale families, cart deduplication, pending-transfer methods, header date, hidden-by-default close form, focus, and closed historical view.
  - [x] Run `npm run typecheck` and `npx vitest run src/demo/shiftDashboard.test.ts src/features/shifts/ShiftFlow.test.tsx` in foreground; record exact partial outcomes below.
  - [x] Correct post-implementation P2 family collision: explicit `sup-event-`, `glove-event-`, and `locker-event-` namespaces now take precedence over paymentId fallback; colliding-source regression test observed RED before fix and GREEN afterward.
  - [x] Extend precedence to ordinary `sale-event-` ledger IDs before any cross-family paymentId lookup; regression now covers a product sale colliding with supplement, glove, and locker records.

- [ ] **S02 — Redesign shift visual hierarchy and split movement history** (TanStack payment donut, compact activity chart, six-column financial table, separate inventory table, responsive/clay styling, and visual QA).
  - Route: delegated direct; trigger evidence: one selector projection plus coordinated UI, responsive styles, and regression tests across five non-trivial source/test files. Use one writer and one independent read-only verifier; no parallel writers.
  - Authorized edit surfaces: `src/demo/shiftDashboard.ts`, `src/demo/shiftDashboard.test.ts`, `src/features/shifts/Shifts.tsx`, `src/features/shifts/ShiftDashboard.css`, `src/features/shifts/ShiftFlow.test.tsx`, and this task document only. No new files or package changes.
  - [x] Extend pure selector projection with confirmed counts by payment method, expense count, and distinct money/inventory movement collections without changing domain accounting.
  - [ ] Redesign Turno header/KPIs/cards and chart panels using existing EGC tokens, primitives, and installed icons; remove explanatory clutter.
  - [ ] Replace payment CSS bars with accessible TanStack radial donut: count-sized cash/card slices, stable center total, hover/focus detail, compact legend, pending outside the chart.
    - [x] Verify equal-count cash/card slices keep 50% tooltip/focus percentages even when their amounts differ; observed RED before the count-based percentage fix.
  - [x] Simplify money table to the six confirmed columns and add an independent inventory table for restocks, waste, and physical counts.
  - [x] Add selector/UI regressions for counts, pending exclusion, money/inventory separation, and table structure; filters/pagination remain independently stateful in each table.
  - [ ] Visually inspect 1440/1024/390 px in light and dark themes, including chart tooltips, keyboard focus, reduced motion, and page overflow.
  - [ ] Run the focused tests, full suite, typecheck, and build; distinguish pre-existing failures from redesign regressions.
  - [ ] Preserve existing user changes. Do not stage or commit when exact isolation from unrelated dirty hunks cannot be guaranteed.

## Acceptance criteria

- Confirmed totals and activity derive from the selector without double counting mirrored specialized sale sources.
- Pending specialized records do not affect confirmed cash/charts; all supported movement families appear appropriately in the history table.
- Cash expectations preserve negative discrepancies, closed snapshots, and existing review/revision guards.
- Responsive dashboard provides accessible exact-value summaries, filters, sorting, and pagination; shift selection resets table state.
- Missing/optional data is handled safely and no fabricated details are shown.
- Visual redesign acceptance: prominent readable KPIs; brand-consistent bento/clay surfaces; payment donut grouped by payment method and operation count; activity bars compact; financial movements in six columns; inventory tracked in a separate table; responsive theme-aware screenshot review.

## Progress and evidence

- S01: acceptance corrections implemented; verification remains partial and S01 stays unchecked because the prescribed suite/typecheck do not fully pass.
- Added only test alignment in the three explicitly authorized test files after the full-suite run exposed assertions stale against the hidden-by-default close form and approved opening + cash + Extra − Gasto formula. No implementation source changed in this alignment step.
- `src/app/App.test.tsx`: activated `Cerrar turno` before accessing `Forma de conteo`; updated expected discrepancy to `$20.00 MXN` because the selected $555.00 count exceeds expected $535.00 (opening $500.00 + $55.00 cash sale + $50.00 extra − $70.00 expense).
- `src/features/sales/operations.test.ts`: updated expected cash from 54000 to 52000 and 100000 to 98000; each is reduced by the seeded net expense of 2000 minor units (7000 expense − 5000 extra). Updated close difference from -1000 to +1000 because counted 99000 minus revised expected 98000 is positive 1000.
- `src/demo/ownerOperations.test.ts`: aligned cash difference to +1000 using the same 99000 count − 98000 expected cash arithmetic. Note: the parent's verbal direction said the new formula returned -1000, but direct test observation returned +1000; signed difference is counted minus expected, so +1000 is correct.
- Targeted test results after alignment: `npx vitest run src/app/App.test.tsx -t "connects profile, cart, keyboard member lookup"` passed 1/1; `npx vitest run src/features/sales/operations.test.ts -t "posts one complete cash product sale|separates float from collections"` passed 2/2; `npx vitest run src/demo/ownerOperations.test.ts -t "totals confirmed cash/card"` passed 1/1.
- `npm test`: failed with 4 tests across 30 files (183 passed / 4 failed / 187 total): unrelated glove demo-name assertion at `src/features/reception/GuantesModal.test.tsx:35`, the authorized App test timed out at 5 seconds under full-suite parallel load (its targeted run passed), and two unrelated inventory-route assertions in `src/features/shifts/ShiftFlow.test.tsx:120` and `src/features/sales/operations.test.ts:129`.
- `npm run typecheck`: failed only at unrelated `src/demo/memberNotes.test.ts:12-13` due inferred `status: string` versus `'paid' | 'pending'`.
- `npm run build`: blocked by the same two unrelated `src/demo/memberNotes.test.ts:12-13` type errors before Vite build could run.
- Parent spot-check found that paymentId fallback precedence could classify an explicit locker ledger event as glove when source IDs collided. Updated `familyForEvent` to honor specialized event ID prefixes before any namespaced paymentId fallback; the selected family then resolves its own source map.
- `npx vitest run src/demo/shiftDashboard.test.ts -t "uses explicit event namespaces"`: passed, 1 targeted regression test; before the classifier fix it failed with all 606 minor units assigned to supplement and zero glove/locker activity.
- `npx vitest run src/demo/shiftDashboard.test.ts`: passed, 1 file / 5 tests after the collision fix.
- A second independent review found ordinary `sale-event-` IDs also need explicit precedence: a shared paymentId could otherwise misclassify an ordinary product ledger row as a specialized source. Extended the regression to ordinary product plus supplement/glove/locker records all sharing ID `shared`, with assertions for product description, specialized actors/details, amounts, and all four activity buckets.
- The expanded test was observed RED before the second fix: product activity was 0/0 while supplement incorrectly contained 505 minor units. `familyForEvent` now recognizes `sale-event-` as product before specialized paymentId fallbacks.
- `npx vitest run src/demo/shiftDashboard.test.ts -t "uses explicit event namespaces"`: passed, 1 targeted regression test after the ordinary-sale precedence fix.
- `npx vitest run src/demo/shiftDashboard.test.ts`: passed, 1 file / 5 tests after the expanded collision fix.
- `npx vitest run src/demo/shiftDashboard.test.ts`: passed, 1 file / 4 tests, including all six operation families, product/supplement cart dedupe, and canonical pending method.
- `npx vitest run src/demo/shiftDashboard.test.ts src/features/shifts/ShiftFlow.test.tsx`: 14 passed / 1 failed. The failure is the unrelated inventory scenario in `ShiftFlow.test.tsx:120`: `/reception/inventory` is mounted but the `Unidades` field cannot be found; the rendered page is the shift screen. All shift close/dashboard interaction cases passed.
- `npm run typecheck`: fails in unrelated `src/demo/memberNotes.test.ts:12-13` because inferred `status: string` is incompatible with `'paid' | 'pending'`; no errors remain in the changed implementation files.
- Full-suite, typecheck, and build outcomes from the test-alignment follow-up are recorded below; verification remains partial due unrelated failures.
- No commit created: shared target files and the working tree contain unrelated pre-existing changes, so exact task-only staging could not be guaranteed. Changes remain unstaged.
- Relevant files: `src/demo/shiftDashboard.ts`, `src/demo/shiftDashboard.test.ts`, `src/demo/shiftOperations.ts`, `src/features/shifts/Shifts.tsx`, `src/features/shifts/ShiftDashboard.css`, `src/features/shifts/ShiftFlow.test.tsx`.

## Next step

Finish S02 by completing the 1440/1024/390 light/dark screenshot review when browser visibility is available; then update its visual QA checklist based on evidence. The unrelated inventory route assertions and member-notes typing failures need separate authorized work before the prescribed full check set is green.

## Verification

- `npm run typecheck`
- `npx vitest run src/demo/shiftDashboard.test.ts src/features/shifts/ShiftFlow.test.tsx`

- S02 implementation: added confirmed method operation-count projections and moved restock/waste/physical-count projections to a separate inventory collection; sale-mirror rows remain excluded. The Turno screen now uses a cash/card radial count donut, compact six-family activity chart, bento KPI cards, six-column financial ledger, and independent four-column inventory ledger with separate filters/pagination. Existing close controls, expected-cash formula, permissions, and snapshot rendering were retained.
- S02 regressions: selector tests cover confirmed method counts, pending exclusion, and financial/inventory separation; ShiftFlow asserts the table column counts and updated activity heading. `npx vitest run src/demo/shiftDashboard.test.ts`: 5 passed.
- Required focused command: `npx vitest run src/demo/shiftDashboard.test.ts src/features/shifts/ShiftFlow.test.tsx`: 15 passed / 1 failed; only failure is the known unrelated `/reception/inventory` route assertion in `ShiftFlow.test.tsx` (the route renders the shift page instead of the expected inventory quantity field).
- `npm test`: 182 passed / 5 failed across 30 files. Failures: unrelated sales inventory-route assertion, glove demo-card assertion, the same ShiftFlow inventory-route assertion, an App test timeout, and a stale-suggestion App assertion. `npm run typecheck`: fails only on existing inferred `status: string` errors in `src/demo/memberNotes.test.ts:12-13`. `npm run build`: blocked by the same member-notes type errors before Vite.
- Visual QA remains pending: the Vite server started, but `cua_repl` reports that browser visibility is unavailable in this subagent thread, so no 1440/1024/390 light/dark screenshots or screenshot critique could be performed. No source-related visual acceptance failure was observed through tests; manual screenshot acceptance is not claimed.
- No stage/commit was created; pre-existing unrelated dirty work overlaps all target files and prevents exact task-only isolation.

- Follow-up visual acceptance correction: changed the middle KPI from cash counted to total expenses with a selector-projected expense count; removed the long formula helper, removed the redundant financial Status filter, replaced the empty vertical activity plot with a horizontal TanStack `barX` chart and an explicit no-activity state, and changed KPI surfaces/icons to EGC surface/orange/blue tokens. At 390px, the Turno close action is full-width beneath the title; scoped styles hide the redundant Turno eyebrow/description and constrain Turno grids.
- Follow-up focused command: `npx vitest run src/demo/shiftDashboard.test.ts src/features/shifts/ShiftFlow.test.tsx`: 15 passed / 1 failed; the only failure remains the unrelated `/reception/inventory` route assertion at `ShiftFlow.test.tsx:122`.
- Follow-up `npm run typecheck` and `npm run build`: both fail only on the existing `src/demo/memberNotes.test.ts:12-13` `status: string` versus `'paid' | 'pending'` errors; no errors are reported in modified implementation files. Full-suite was not rerun as requested by parent.
- Parent is handling post-correction viewport/theme/overflow screenshot QA; visual review remains unchecked until that evidence is recorded.
- Final Turno-only acceptance correction: removed the old owner-conversation disclosure and notebook/Excel notice from the dashboard render (reusable components and other screens are unchanged); added a native accessible expected-cash `<details>/<summary>` formula disclosure; expense count now uses singular/plural movement labels. ShiftFlow regression asserts both obsolete help blocks are absent and the formula disclosure is present.
- Final focused command: `npx vitest run src/demo/shiftDashboard.test.ts src/features/shifts/ShiftFlow.test.tsx`: 15 passed / 1 failed; only failure remains the known unrelated `/reception/inventory` route assertion at `ShiftFlow.test.tsx:125`.
- Final `git diff --check`: exit 1 from pre-existing unrelated EOF blank-line findings in `src/features/attendance/AttendanceCalendar.test.tsx:48`, `src/features/members/MemberSearch.tsx:267`, `src/features/reception/ReceptionHome.test.tsx:173`, and `src/styles.css:2410`; no reported whitespace errors in the changed Turno targets. Visual QA remains with parent.
- Independent verifier correction: the donut sectors were count-sized, but tooltip/focus percentages incorrectly divided method amounts by confirmed money. Added a regression with one cash operation at $100.00 and one card operation at $900.00; observed RED because the accessible method label exposed amount-based percentages instead of 50%/50%. Percentages now divide each method's operation count by the stable total operation count; count-sized wedges, center total, and exact method amounts are unchanged.
- Required final focused command: `npx vitest run src/demo/shiftDashboard.test.ts src/features/shifts/ShiftFlow.test.tsx`: 16 passed / 1 failed. The only failure is the known unrelated inventory route assertion at `ShiftFlow.test.tsx:143` (`/reception/inventory` renders Turno, so the `Unidades` label is absent).
