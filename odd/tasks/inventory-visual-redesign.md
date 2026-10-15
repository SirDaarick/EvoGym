# Inventory visual redesign

## Objective
Deliver the approved design-first inventory refresh for the existing T12 stock-receiving flow, matching the inventory sketch and reusing the reception-home product presentation without changing current inventory operations.

## Problem and why
Inventory needs a visual structure aligned with the approved sketch and consistent with the reception home. The reception product tiles are currently inline markup, while `CurrentPurchaseCard` contains sale/payment semantics and cannot be reused unchanged for receiving. This work extracts a neutral reusable product presentation and applies it to inventory before adding new inventory operations.

## Scope and constraints
- In scope: extract/reuse the reception-home product tile presentation; visually adapt the inventory page to the approved inventory sketch; retain existing inventory operations and their behavior; ensure the shared presentation works in light/dark themes and responsive layouts.
- Out of scope: product creation, acquisition-cost rules or persistence, receipt-batch workflows, new receiving semantics, sales/checkout changes, and unrelated inventory analytics.
- Keep the T12 receiving screen distinct from T18 owner inventory analytics and sales flows.
- Do not reuse `CurrentPurchaseCard` unchanged; its payment behavior is sale-specific.
- Unsupported create/cost controls must remain clearly unavailable or deferred; do not simulate persistence.
- Preserve all pre-existing working-tree changes. Edit only the approved implementation surfaces after the bounded writer receives them.
- Project task documentation is in English, consistent with existing task plans.

## Authorized scope
- Implementation files: `src/features/inventory/Inventory.tsx`, `src/features/inventory/Inventory.css`, `src/features/inventory/Inventory.test.tsx`, `src/features/reception/ReceptionHome.tsx`, and the shared `src/features/reception/ProductCard.tsx`, `ProductCard.css`, and `ProductCard.test.tsx`.
- Related requirements: `odd/tasks/frontend-v2.md` T12, especially lines 610–661.
- This recovery document records task scope and observed progress; its mirror is maintained in Engram.

## Route and trigger
- Route: delegated direct, one bounded writer for the multi-file behavior change.
- Trigger: extracting a shared component and updating both reception and inventory are multiple non-trivial source changes; preparation for those writes belongs with the writer.
- Verification: writer ran focused unit tests; parent performs independent verification and one structural spot check.

## Estimate and delivery strategy
- Forecast: approximately 150–300 authored changed lines across implementation and focused tests (estimate only; generated files excluded).
- Delivery strategy: `ask-on-risk` (default). If the forecast or running authored count exceeds about 400 lines, ask once for the chain strategy before the next commit.
- Work-unit boundary: one coherent visual redesign unit, including its focused tests. Parent instructed no commit because unrelated dirty state makes safe staging boundaries unclear.

## Acceptance criteria
1. Inventory visually follows the approved sketch and remains the existing T12 receiving flow.
2. Reception home and inventory use a neutral shared product presentation without changing home purchase/payment behavior.
3. Existing inventory tools and operations remain available and behaviorally unchanged.
4. No product-creation, acquisition-cost, or receipt-batch persistence is introduced.
5. Both light and dark themes render correctly, and the layout remains usable at responsive breakpoints.
6. Focused checks pass, existing behavior regressions are checked, and the resulting work unit is recorded with its commit identity.

## Tasks
- [x] `INV-VIS-04` Match Inventory product presentation and local quantity interactions exactly to ReceptionHome, including shared grid/parent sizing, ordering, stock/price, click/right-click and quantity controls. Keep local selections through search and all persistence disabled. Commit omitted by parent instruction because existing dirty files overlap this work.
- [x] `INV-VIS-01` Extract `ProductCard` as a neutral product presentation; ReceptionHome retains quantity changes and cart/payment behavior through callbacks.
- [x] `INV-VIS-02` Recompose Inventory with searchable responsive catalog, four-column wide grid, selected-product receipt preview, disabled create/confirm controls, and existing operations under “Registros de inventario”. No model or persistence semantics changed.
- [x] `INV-VIS-03` Add isolated ProductCard and Inventory tests; run focused and reception regression tests. Commit intentionally omitted because unrelated pre-existing working-tree dirt prevents a safe boundary.

## Checks
- Before editing, inspect the current working tree and existing package scripts/tests; preserve unrelated changes.
- Run the focused reception and inventory tests if present, plus the repository's applicable typecheck/lint/build checks. Resolve exact command names from package scripts before execution; do not claim unavailable checks passed.
- Exercise or verify the reception home, existing inventory interactions, light/dark themes, and responsive layout. Record failed, skipped, unavailable, or pending checks explicitly.
- Run `git diff --check` and inspect the work-unit diff before committing.
- Record runtime harness scenario/results, or explicit `N/A` with the reason if no runtime boundary exists.

## Progress and next step
- Parity correction outcome (2026-10-14): complete. Inventory now passes quantity and quantity callbacks to unchanged ProductCard, uses the exact shared reception-checkout/products-column/catalog-panel/product-grid layout classes, removes inventory-specific fixed columns, and displays the last interacted product's local quantity. State.products order, expected stock, and prices match home. Search preserves quantities; zero removes controls/highlighting. Safe integer/nonnegative validation matches home, without a stock cap. No persistence or records markup changes.
- Parity verification: RED observed with `npm test -- src/features/inventory/Inventory.test.tsx` (3 failed, 1 passed): missing footer/incorrect initial selected state, absent quantity outputs, and absent preserved quantities after search. GREEN observed with `npm test -- src/features/inventory/Inventory.test.tsx src/features/reception/ProductCard.test.tsx src/features/reception/ReceptionHome.test.tsx` (3 files, 18 passed). Tests compare initial and selected card outerHTML with home, catalog/layout classes, quantity controls, right-click to zero, selection beyond stock, independent quantities, search/empty state, disabled receipt actions, and unchanged persisted DemoState.
- `npm run typecheck` and `npm run build` both fail at the existing unrelated `src/demo/memberNotes.test.ts:12-13` status widening defect. Build does not reach Vite; no successful build claimed for this correction. Scoped `git diff --check -- src/features/inventory/Inventory.tsx src/features/inventory/Inventory.css src/features/inventory/Inventory.test.tsx odd/tasks/inventory-visual-redesign.md` passes (only Git line-ending conversion advisory). Browser screenshot/device comparison not performed by writer; responsive/themes are structurally identical through shared layout/tile CSS. Runtime harness: unit DOM interaction checks passed; visual browser QA remains pending. Authored-only correction estimate: approximately 120–150 added/deleted lines, excluding prior dirty changes. Next step: parent independent check and visual confirmation; no commit or review action run.
- Parity correction (2026-10-14): route is delegated direct because quantity behavior, responsive layout, and regression tests span multiple non-trivial files. Authorized edits are Inventory.tsx, Inventory.css, Inventory.test.tsx and this document only. Forecast: approximately 100–180 authored lines; no commits authorized due overlapping existing dirty changes. Full mirror was reconciled with the local document: both described earlier records UI, but current source has already removed that markup. Preserve that current source state; do not restore records. Previous fixed four-column catalog and selection-only behavior are superseded by exact home parity. Observe RED before implementing, then run focused tests/typecheck/build and scoped whitespace checks.
- Status: implementation complete; verification is partial because existing unrelated repository failures remain.
- Current outcome: shared tiles have exact Home local quantity interactions and layout classes; acquisition cost and persistence remain unavailable. Records markup was removed before this correction and has not been restored.
- Verification evidence: after independent review identified that disabled product tiles still decremented on context-menu, a focused regression test first failed (RED: callback called with quantity 1), then passed after guarding the handler with `!disabled`. `npm test -- --reporter=dot src/features/reception/ProductCard.test.tsx src/features/inventory/Inventory.test.tsx src/features/reception/ReceptionHome.test.tsx` passed (3 files, 16 tests). `npm run typecheck` failed on pre-existing `src/demo/memberNotes.test.ts:12-13` status widening (`string` versus `'paid' | 'pending'`). `git diff --check` reported existing blank lines at EOF in unrelated dirty files; no whitespace diagnostics identified in the changed tracked files. Responsive/theme behavior was structurally checked in local CSS; no browser/device visual run was performed.
- Commit: intentionally not created because the checkout contains extensive unrelated modified/untracked files and safe staging boundaries are unclear.
- Final independent and parent checks: both reran the focused three-file suite with 18 passing tests. Parent structurally confirmed unchanged shared tiles and layout classes. Browser navigation to both local server addresses timed out, so rendered desktop/mobile and light/dark parity remains unverified; the temporary verifier server was terminated. Assessment remains high/unassessable due existing untracked inventory; independent verification completed and review mode remains off.
- Next step: browser visual comparison when local preview access is available; resolve the unrelated typecheck/build failure separately. No commit created because pre-existing changes overlap this work.
- Relevant implementation files: `src/features/inventory/Inventory.tsx`, `src/features/inventory/Inventory.css`, `src/features/inventory/Inventory.test.tsx`, `src/features/reception/ReceptionHome.tsx`, `src/features/reception/ProductCard.tsx`, `src/features/reception/ProductCard.css`, `src/features/reception/ProductCard.test.tsx`.
