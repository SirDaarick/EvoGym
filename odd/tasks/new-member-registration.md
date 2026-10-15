# New member registration

## Objective
Implement and refine the “Nuevo socio” registration screen from the user-provided sketch, reuse existing EvoGym UI components, support anonymous visits, and remove user-visible demo/simulation framing while keeping operational limitations accurate.

## Problem and why
The current NewMember page only creates a named member with a name and optional phone. It does not capture email, membership/trial/visit type, payment method, total, or proof/receipt confirmations. The user requested an end-to-end registration flow and set “Clase muestra” to MXN $100.

## Scope
- Build the registration UI at the existing NewMember route using reusable shared controls.
- Support existing membership plans and visit rates, plus a trial-class plan priced at MXN $100.
- Save member registrations and anonymous visit registrations to local state, without pretending to process real payments.
- Present the cashier workflow for the selected method (cash received/change, card terminal/fee information, or transfer amount/pending state) without extra cashier-confirmation or student-verification checkboxes, per NMR-7.
- Do not activate membership access or represent local records as real collection; use neutral operational guidance instead of demo/simulation framing.
- Match the app's active light/dark theme while giving the screen a dark-friendly finish when dark mode is selected.
- Use three clear operation-type buttons, an AnimatedList for plan selection, balanced-width fields, and a responsive bento layout.
- Reuse the exact “Compra actual” payment/checkout component from reception home in the new-member payment section; show a presentation-only assignment for the new member and keep anonymous visits unassigned.

## Constraints and accepted rules
- A visit does not require or store the visitor’s name; use the existing one-area or Gym + Box visit choice and current catalog prices.
- For membership and trial-class registrations, name is required; phone and email follow the sketch but remain optional unless existing policy dictates otherwise.
- Trial class price is MXN $100 per the user’s clarification.
- NMR-7's explicit user instruction removes both cashier acknowledgement and student-verification checkboxes from registration, including the student eligibility gate; do not restore either gate without renewed authorization.
- Preserve all pre-existing working-tree edits. The target repository is heavily dirty before this feature; do not stage or commit unrelated paths.
- Current branch is `codex/component-catalog-extension`; delivery strategy is `ask-on-risk` by default, forecast approximately 250 authored changed lines.
- Follow-up NMR-6 supersedes NMR-5's original exclusion of assignment UI only for the registration consumer; preserve reception's existing active-member search and all unrelated dirty state.

## Authorized edit scope
- `src/features/members/Members.tsx`
- `src/features/members/Members.test.tsx`
- `src/features/members/NewMemberRegistration.tsx`
- `src/features/members/NewMemberRegistration.css`
- `src/features/reception/ReceptionHome.tsx`
- `src/features/reception/ReceptionHome.test.tsx`
- `src/features/reception/CurrentPurchaseCard.tsx` (new shared component)
- `src/features/reception/CurrentPurchaseCard.css` (new shared component styling)
- `src/demo/operations.ts`
- `src/demo/newMemberRegistration.ts`
- `src/demo/newMemberRegistration.test.ts`
- `src/demo/plans.ts`
- `src/domain/models.ts`
- `src/demo/adapter.ts`
- `src/styles.css`

## Tasks and acceptance criteria
- [x] NMR-1 — Extend demo domain/operations to persist named registrations and anonymous visit purchases using catalog pricing and existing open-shift/accounting rules.
- [x] NMR-2 — Replace the basic NewMember form with the type-aware registration screen, including conditional data fields and confirmation checkboxes; reuse Field, Button, Panel, PageHeader, Notice.
- [x] NMR-3 — Add regression tests covering visit anonymity, member fields, pricing, required confirmations, and safe failure paths.
- [x] NMR-4 — Refine the registration layout/theme and controls per the user's visual direction: three operation buttons, AnimatedList plan picker, proportionate bento cards, and a left-aligned detail/payment card that follows the existing active theme.
- [x] NMR-5 — Extract and reuse ReceptionHome’s current-purchase payment component in NewMemberRegistration, with no member assignment UI in the registration use; preserve checkout selection/detail/payment semantics and cover both consumers in focused tests.
- [x] NMR-6 — Align the registration checkout to ReceptionHome's right-side 340–400px column and 1000px responsive breakpoint; share the assigned-member presentation, show the typed new member as a non-persisted draft for membership/trial, and keep visits unassigned.
- [x] NMR-7 — Split member details and current purchase into separate cards; use theme-adaptive JellyRadio for operation selection; show method-specific checkout details including a cash calculator that blocks tender below the total, card terminal/fee details, and exact-amount pending transfer; remove both cashier confirmation and student-verification checkboxes and their submit gates.

## Verification
- Test-first: establish a failing deterministic regression test before implementing behavior where the existing Vitest runner supports it.
- Earlier focused registration tests passed: `npm test -- --run src/demo/newMemberRegistration.test.ts src/features/members/Members.test.tsx` (12 tests); UI test passed: `npm test -- --run src/features/members/Members.test.tsx --reporter=dot` (8 tests).
- NMR-5 focused check and parent spot-check passed: `npm test -- --run src/features/members/Members.test.tsx src/features/reception/ReceptionHome.test.tsx --reporter=dot` (2 files, 20 tests).
- Parent review assessment remained high/unassessable because unrelated pre-existing untracked files require explicit declaration. RDD is off; no native review was started.
- Current follow-up starts with 69 dirty paths. Preserve them; do not stage or commit unrelated paths. RDD status is off (clone-local), so do not start native review.
- NMR-6 test-first verification: added draft-assignment and layout regressions; before implementation the focused suite had 2 failures (missing draft assignment and missing registration layout wrapper), while 20 prior tests passed.
- NMR-6 verification: `npm test -- --run src/features/members/Members.test.tsx src/features/reception/ReceptionHome.test.tsx --reporter=dot` passed (2 files, 22 tests). `npm run typecheck` remains blocked by the pre-existing TS2345 errors at `src/demo/memberNotes.test.ts:12-13`; no NMR-6 errors remain.
- NMR-7 test-first: newly added no-checkbox, student-rate, JellyRadio/theme, and method-detail regressions produced RED before implementation (focused suite: 8 failed, 10 passed).
- NMR-7 verification before cash-shortfall correction: `npm test -- --run src/features/members/Members.test.tsx src/demo/newMemberRegistration.test.ts --reporter=dot` passed (2 files, 18 tests). `npm run typecheck` exits 1 only for the pre-existing TS2345 errors in `src/demo/memberNotes.test.ts:12-13`; no NMR-7 errors were reported.
- NMR-7 cash-shortfall correction test-first: added a regression that submits $100 against the $500 default plan and requires no registration. Before the guard, it failed because submit completed the operation and replaced the form instead of keeping the shortfall visible.
- NMR-7 cash-shortfall correction verification: `npm test -- --run src/features/members/Members.test.tsx src/demo/newMemberRegistration.test.ts --reporter=dot` passed (2 files, 19 tests). `npm run typecheck` still exits 1 only for the pre-existing TS2345 errors in `src/demo/memberNotes.test.ts:12-13`; no correction-related errors were reported.
- Independent read-only review confirmed both screens use the shared summary, registration shows only draft assignment for membership/trial and omits it for visits, and ReceptionHome retains its search/selection behavior. No browser-rendered visual comparison was performed.
- Previous full suite had 158 passes and 2 failures (App test timeout and component-catalog expected-region); not diagnosed.
- `npm run typecheck` still has unrelated TS2345 errors at `src/demo/memberNotes.test.ts:12-13`.
- No staging, commit, or git mutation was performed; unrelated changes remain preserved.

## Progress
- NMR-1 through NMR-4 were completed in earlier work: domain operation, anonymous visit behavior, plan/trial pricing, confirmation gates and initial bento UI.
- NMR-5 extracted `CurrentPurchaseCard` with the shared “Compra actual” heading, total and JellyRadio payment method control. ReceptionHome supplies optional assignment UI and keeps its transaction flow; NMR-6 later adds a presentation-only draft summary to registration.
- NMR-6 completed: registration now uses a 340–400px right-side checkout column with the 1000px collapse breakpoint and details-first narrow ordering. `AssignedMemberSummary` is shared by reception and registration; registration shows the live name/optional phone as a draft on membership/trial and omits it for visits without changing transaction timing or member identity creation.
- NMR-6 focused tests passed (22/22); typecheck still reports only the pre-existing TS2345 at `src/demo/memberNotes.test.ts:12-13`.
- NMR-7 completed: registration details and checkout render as distinct cards; operation choice uses theme-aware JellyRadio; cash shows tender/change, card shows terminal amount plus 4.06% fee/net estimate, and transfer shows exact amount and T03 pending guidance. Removed both acknowledgements from UI and demo transaction gates, allowing student-rate plans without verification while retaining non-student plan restrictions and paid-versus-pending semantics.
- NMR-7 checks: observed RED (8 failed, 10 passed) before implementation; GREEN focused suite initially (2 files, 18 tests); subsequent short-tender regression was RED before guard and focused suite GREEN after correction (2 files, 19 tests); typecheck remains limited to the known unrelated TS2345 at `src/demo/memberNotes.test.ts:12-13`.
- Cash shortfall correction: cash submit now returns before transaction when tendered amount is below the selected total; exact or greater tender may proceed, with overage shown as change. UI regression confirms $100 tender against $500 leaves the form active and shows the shortfall.
- NMR-7 is explicitly authorized to remove both the payment-method cashier acknowledgement and the separate student-verification checkbox/gate; preserve the demo-only notice and existing paid-vs-pending payment semantics.
- Required focused tests passed (20/20), parent spot-check passed (20/20), and independent structural review found no blocker.
- Existing unrelated typecheck and full-suite failures remain outside this task.
- Branch remains `codex/component-catalog-extension`; work is uncommitted and unstaged.

## NMR-8 — Production-facing checkout parity and neutral app copy

### Objective and scope
- Reuse one cash tender calculator component in reception and registration, preserving identical presentation and the cash-shortfall submission guard.
- Restore the catalog JellyRadio `md` defaults for operation selection; retain the existing payment selector.
- Keep registration detail and purchase as independent cards, hide method-specific guidance under card/transfer in registration, and route the header action directly to role-aware `members/new`.
- Remove visible application-mode wording across the app, including simulation-only payment/access notices in membership checkout and sales, and neutralize rendered sample names/statuses; preserve legitimate “Clase muestra” and catalog showcase content.
- Do not change internal identifiers, storage, transaction behavior, or backend; this copy change does not make payment processing real.

### Route, estimate, and acceptance criteria
- Route: delegated direct, one Luna writer; evidence-triggered because the app-wide wording audit identified more than five non-trivial source modules and a shared calculator touches both payment consumers.
- Delivery strategy: `ask-on-risk`; estimated authored change count ~250 lines, excluding generated files.
- [x] NMR-8a — Extract cash tender calculator presentation/state helpers as appropriate; use the same component from reception and registration with identical input, exact-payment action, change/shortfall output, and decimal handling.
- [x] NMR-8b — Use default `md` JellyRadio for operation choice, retain separate floating cards and responsive layout, remove registration card/transfer detail copy, and fix the role-aware header destination.
- [x] NMR-8c — Remove visible demo-mode and demo-named fixture/status copy across audited source modules; update only affected assertions, preserving internal identifiers and catalog showcase examples.
- [x] NMR-8d — Replace the result notices in MembershipPayment and Sales with neutral operational guidance; retain truthful local-record/payment/access limitations and add focused copy regressions.
- [x] NMR-8e — Replace user-visible demo/fictitious sample-result framing in ComponentCatalog with neutral catalog-preview wording; retain the component examples and behavior.
- Focused NMR-8e test surface: `src/features/catalog/ComponentCatalog.test.tsx`.
- [x] NMR-8e — Remove explicit demo/fictitious sample-result wording from the component catalog while preserving actual component examples and behavior; adjust only affected assertions.
- [x] NMR-8f — Remove the last user-visible “demo” wording in Sales’ product-safety notice and replace it with neutral guidance; add a focused regression.
- [x] NMR-8g — Neutralize PlanCatalog’s rendered “demo/simulated” labels and fallback copy while keeping unconfirmed-data and access limitations truthful; add a focused regression.
- Acceptance: exact cash, change, invalid-decimal and insufficient-tender behavior remains covered; card/transfer registration shows no supplemental detail; reception retains search/assignment; role-aware header route resolves to new-member screen; no visible app-mode or simulation-only copy remains outside legitimate product examples.

### Authorized edit surfaces
`src/app/App.tsx`
`src/app/App.test.tsx`
`src/demo/adapter.ts`
`src/demo/attendanceOperations.ts`
`src/demo/inventoryOperations.ts`
`src/demo/memberStatus.ts`
`src/demo/memberStatus.test.ts`
`src/demo/ownerOperations.ts`
`src/demo/ownerQuestions.ts`
`src/demo/plans.ts`
`src/demo/shiftOperations.ts`
`src/features/demo/OwnerQuestions.tsx`
`src/features/inventory/Inventory.tsx`
`src/features/members/MemberDetail.tsx`
`src/features/members/MemberDetail.test.tsx`
`src/features/members/Members.tsx`
`src/features/members/Members.test.tsx`
`src/features/members/MemberSearch.tsx`
`src/features/members/NewMemberRegistration.tsx`
`src/features/owner/History.tsx`
`src/features/owner/Overview.tsx`
`src/features/owner/PeriodFields.tsx`
`src/features/owner/PlanCatalog.tsx`
`src/features/owner/PlanCatalog.test.tsx` (new)
`src/features/catalog/ComponentCatalog.tsx`
`src/features/catalog/ComponentCatalog.test.tsx`
`src/features/catalog/catalog-charts.tsx`
`src/features/catalog/catalog-data.ts`
`src/features/catalog/ReactBitsGallery.tsx`
`src/features/payments/MembershipPayment.tsx`
`src/features/payments/CashTenderCalculator.tsx` (new)
`src/features/payments/CashTenderCalculator.css` (new)
`src/features/reception/ReceptionHome.tsx`
`src/features/reception/ReceptionHome.test.tsx`
`src/features/reception/SuplementosModal.tsx`
`src/features/sales/Sales.tsx`
`src/features/sales/Sales.test.tsx` (new)
`src/features/shifts/Shifts.tsx`
`src/features/shifts/ShiftFlow.test.tsx`
`src/features/staff/StaffProfileSelection.tsx`

### Verification
- [x] Observe regression RED before implementation, when tests can express the expected behavior.
- [x] Focused Vitest tests for app routing, registration/reception calculator, and changed copy assertions.
- [x] Run complete typecheck and report known baseline errors separately.
- [x] Search audited user-visible source for app-mode wording, excluding internals/comments and legitimate catalog showcase copy.
- [x] Add and run focused payment/sales copy regressions (`App.test.tsx` 3/3; `Sales.test.tsx` 1/1) while preserving local-record limitations.
- [x] Parent spot-check shared calculator, registration card boundaries, role-aware route, JellyRadio defaults, neutral PlanCatalog/Sales wording, and repository status; index remains clean with 92 dirty paths preserved.
- RED evidence before implementation: the initial focused run observed the new route still targeting `/reception/members`, missing the shared registration cash input, and card/transfer details still appearing (3 task-related failures); it also encountered the known App foundation timeout.
- GREEN evidence: the requested six-file command reached 67 passing tests and one timed-out existing App foundation test. A focused direct-header route test passed (1 passed, 14 skipped), and the five-file non-App suite passed (53/53).
- Final calculator spot checks passed after setting the shared exact-payment button explicitly to `type="button"`: registration cash/card/transfer checks (2/2) and ReceptionHome calculator check (1/1).
- `npm run typecheck` remains blocked only by the pre-existing TS2345 fixture typing errors in `src/demo/memberNotes.test.ts:12-13`.
- The audited user-facing source no longer exposes app-mode/demo markers outside retained catalog showcase copy; internal identifiers and storage keys remain unchanged. Sample names and status labels were neutralized.
- No browser-rendered visual comparison was run; mark visual QA as pending for a session with an available running UI/browser target.
- No files were staged or committed: multiple authorized target files already contained unrelated dirty edits, so a safe isolated work-unit commit could not be prepared without absorbing them.
- Parent follow-up RED: the new registration-layout assertion failed while the outer `.registration-panel` still wrapped both cards.
- Follow-up GREEN: removed only that wrapper and its now-unused panel padding/color-scheme rules; details and current-purchase cards remain distinct. `Members.test.tsx` and `ReceptionHome.test.tsx` passed (26/26); the registration wrapper/card regression is included.
- Follow-up copy regressions passed: the focused App footer assertion passed (1/1), and the ReceptionHome shortcut-modal regression asserts that the supplements modal no longer says “de demostración”. App footer copy now accurately says profile selection changes the active view and auth/permissions are not implemented; the footer date note and supplements description are neutral.
- NMR-8d RED: the two new `src/app/App.test.tsx` regressions failed before the payment/sales copy updates because each result notice still contained “simulado”. GREEN: `npm test -- --run src/app/App.test.tsx -t 'neutral operational guidance' --reporter=dot` passed (2/2); the changed existing payment expectation passed alongside those new regressions (3/3 targeted tests).
- MembershipPayment and Sales now describe records as local operations and explicitly avoid implying payment receipt or access activation. Transfer-pending notices and processing semantics are unchanged.
- Remaining visible safety/showcase language is intentional: PlanCatalog and Sales retain illustrative product/catalog data, and PlanCatalog's plan restriction accurately says a listed charge does not grant real access. ComponentCatalog, CatalogCharts, and catalog-data now use neutral reference/preview wording for all visible catalog samples; actual example/component showcases remain valid.
- NMR-8e RED: the updated result-copy regression failed before source changes because the UI still had the `(demo)` selector and lacked the preview status wording. GREEN: `npm test -- --run src/features/catalog/ComponentCatalog.test.tsx --reporter=dot` passed (1 file, 18/18 tests).
- NMR-8e gallery RED: a whole-catalog language regression failed while ReactBitsGallery still rendered explicit demo/fictitious copy. GREEN: after neutralizing its captions, accessible labels, toast titles, and stepper text without changing interactions, the catalog suite passed 19/19.
- NMR-8e screen audit found no user-visible explicit demo/fictitious/simulated wording in ComponentCatalog, catalog-charts, catalog-data, or ReactBitsGallery. Remaining grep matches are internal import/type/data identifiers, fixture IDs, or CSS class names; sample/example catalog content and the “not authentication” safety notice remain intentionally.
- Independent final audit found the Sales product notice still said “solo para ilustrar la demo”; NMR-8f is authorized to neutralize that last visible phrase and cover it with a focused test.
- Independent audit found PlanCatalog’s table headings, accessible label, and fallback restriction still used rendered “demo/simulado” wording; NMR-8g is authorized to replace these with neutral reference/validation copy while retaining the pending-data and access caveats.
- NMR-8f RED: `npm test -- --run src/features/sales/Sales.test.tsx --reporter=dot` failed before the copy edit because the exact neutral reference notice did not exist.
- NMR-8f GREEN: the same command passed (1 file, 1/1 test). Sales now identifies the price/quantity as reference values and says they are not a confirmed catalog or stock; no payment/inventory semantics changed.
- NMR-8f audit: Sales visible copy no longer contains demo/simulated framing. Remaining grep matches are `DemoProvider`/demo module identifiers and test prose/assertions, not rendered app copy.
- NMR-8g RED: `npm test -- --run src/features/owner/PlanCatalog.test.tsx --reporter=dot` initially failed because the new `Productos de referencia` accessible label and neutral fallback were absent.
- NMR-8g GREEN: the required command passed (1 file, 1/1 test). Product table labels now use reference wording, values remain explicitly unconfirmed, and the plan fallback says local confirmation is pending and access is not activated automatically.
- NMR-8g audit: PlanCatalog has no visible demo/simulation/fictitious wording; remaining matches are internal `DemoProvider`/module names and test assertions only. Product data disclaimer and no-automatic-access warning remain.
- The full App test file still has pre-existing unrelated failures (foundation timeout and stale-suggestion listbox expectations); the complete required focused command is therefore not green. Do not mark it as passing.
- Final required command outcome after the payment/sales copy update: 68 passed, 2 failed across 6 files; failures are the App foundation timeout (`App.test.tsx:19`) and the pre-existing stale-suggestion listbox lookup (`App.test.tsx:49`). The focused copy regressions passed 2/2, with the related existing membership payment regression passing as part of the targeted 3/3 run.

### Progress
- NMR-8a through NMR-8g implemented and parent spot-checked; catalog preview tests are green (19/19), Sales copy regression is green (1/1), and PlanCatalog copy regression is green (1/1). Existing App suite failures and the typecheck baseline remain recorded above.
- Existing known typecheck failures at `src/demo/memberNotes.test.ts:12-13` predate NMR-8.

## Next step
Implementation is complete. Visual browser QA and previously recorded App/typecheck baseline failures remain unverified/known; no staging or commit was performed because unrelated dirty changes overlap the work surfaces.
