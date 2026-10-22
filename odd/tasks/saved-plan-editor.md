# Saved composable plan editor

## Objective
Create and edit reusable service combinations through the existing plan-catalog UI, reproduce the operational workbook's twenty membership prices, and preserve previously purchased terms.

## Scope
- Upgrade the existing owner catalog create/edit dialog; retain the application's Spanish interface and existing visual system.
- Saved plans capture services, period, name, price and explicit conditions. Unknown eligibility and duration rules remain marked as unresolved, not inferred.
- Preserve old/new combined tariffs, stable plan identifiers, custom persisted plans, visits and unrelated dirty worktree changes.
- Future payments and new-registration purchases capture immutable plan terms. Existing name/amount history remains unchanged; no invented legacy prices.
- This is the existing frontend/localStorage demo. Do not activate membership access, calculate dates, import personal records, add a backend or implement a promotions engine.

## Work unit
- [ ] PLAN-1: Implementation and focused checks complete; blocked from full closure by general test/typecheck failures and unavailable browser permission. Commit pending.
- [ ] PLAN-2: Stepper simplification implemented and independently verified; commit and visual proof remain pending with the existing feature closure constraints.
- [ ] PLAN-3: Linked pricing implemented and independently verified; commit and full-feature closure remain pending with the previously recorded general-check and visual-proof constraints.

## Linked pricing request
- User requests a visible price equivalent to 100% and mutually linked final amount and percentage controls. Percentage means the share charged, not the discount: reference 500, final 400, percentage 80%.
- Keep canonical integer-cent final amount and optional positive integer-cent reference amount. Derive percentage rather than persisting an independent floating-point value.
- Explicit reference is configurable; existing plans default to their current tariff at 100%. Never infer references by summing services or multiplying monthly prices. No current seed prices change.
- Editing final amount updates percentage; editing percentage rounds the calculated final amount to cents. Reference changes retain the current ratio and recalculate final, with a clear hint. A rounded displayed percentage must not reprice an unchanged final amount on save.
- Store optional reference in saved plans and detached purchase snapshots, while preserving legacy records without invented historical references. No campaign/discount engine or automatic eligibility changes.
- Route: delegated direct, one writer. Scope: editor/test/CSS, catalog integration tests if selectors change, plans store/tests, optional snapshot model field and purchase-path tests. No Stepper or actual transaction-path changes needed.
- Checks: RED/GREEN linked fields, decimal rounding, >100%, invalid/blank/zero values, existing-price preservation, persistence and both purchase snapshots; focused suite, typecheck and build. Known unrelated failures remain separate; browser-origin refusal still applies.
- Implemented optional `referenceAmountMinor` on plans and purchased snapshots. Percentage remains derived; legacy purchases without a reference stay unchanged. Existing source plans open at their current amount/100% unless an explicit reference was saved.
- Step-three pricing now links editable reference, percentage to charge and final price through event handlers. Exact rational working ratios avoid floating-point monetary drift; final amounts round half-up to integer centavos. Rounded display percentages never reprice an untouched final amount.
- New valid reference initializes a new plan at 100%; reference changes retain the current working ratio. Inputs accept decimal percentages with dot/comma and above 100%; blanks, nonpositive values, nonnumeric and unsafe results block saving.
- Fresh nine-file baseline `.cache/saved-plan-pricing/baseline/`; no seed-price changes, shared Stepper changes or production transaction-path edits.
- Observed RED: missing reference input and missing snapshot projection before production changes. Writer and independent verifier passed all 66 focused tests across five files. Parent spot check passed 22 editor tests; scoped whitespace checks passed.
- Writer reran typecheck/build; both still fail at the recorded untouched `DevolucionesModal.tsx:402` Tone `info` incompatibility. No full-suite rerun, browser/network/server activity, staging or commit.

## Simplification request
- User likes the current appearance but finds the configuration hard to use; explicitly requests the existing Stepper.
- Reuse `features/catalog/react-bits/Stepper.tsx` unchanged, as already used in reception. Do not introduce another wizard component or dependency.
- Three steps: services, duration, price/review. Only current-step inputs are exposed; optional eligibility, expiry and notes use progressive disclosure. Existing special conditions and unresolved activity remain intact and visible when relevant.
- Preserve entered values when moving back, validate before advancing and prevent Enter from saving before the final step. Generate editable suggested names/descriptions without overwriting existing or manually edited text.
- Route: delegated direct; edit only `PlanEditor.tsx`, its tests, editor-scoped `PlanCatalog.css`, and affected `PlanCatalog.test.tsx` interaction paths. No store/domain/transaction edits.
- Test-first and checks: editor/catalog tests; existing catalog/registration/payment regression tests; typecheck. Inherited general failures remain separately tracked. Browser origin refusal still applies; no retry or workaround without renewed user authorization.
- Implemented the existing shared Stepper unchanged with three steps and one active body; indicators cannot bypass validation. Enter advances on early steps; only final save submits.
- Duration presets, editable derived names/descriptions and progressively disclosed optional settings reduce mandatory inputs. Back navigation preserves manual drafts; existing names, conditions, eight-day periods and unresolved fifteen-day activity remain intact.
- Fresh four-file pre-change baseline: `.cache/saved-plan-stepper/baseline/`. Only owner editor, its tests, editor-scoped catalog CSS and catalog interaction tests changed; store, domain, source prices and purchase snapshots were not edited.
- Observed RED: missing real Stepper assertion failed before changes. Writer and independent verifier: editor/catalog 15 tests passed. Store/registration/payment regressions: 32 passed. Parent spot check: editor seven passed. Scoped whitespace check passed; shared Stepper/CSS have no diff.
- Typecheck remains blocked only by recorded untouched `DevolucionesModal.tsx:402` TS2322. No full suite/build rerun for this UI-only refinement; prior general failures remain tracked below.
- No browser/network/server attempt in this refinement; previous browser-origin refusal respected. No stage or commit.

## Route and delivery
- Route: delegated direct, one bounded writer. Trigger: multiple non-trivial files, persistence and purchase paths, UI and tests.
- One cohesive work unit keeps catalog schema, its editor and consuming purchase snapshots compatible. Forecast: approximately 800–1,200 authored lines, including tests; this is advisory, not a size gate.
- Delivery strategy: single-pr for this cohesive feature; no push, PR or merge is authorized or performed. Commit only this work unit, excluding all pre-existing changes; leave commit pending if isolation cannot be proved.
- Branch: existing `feat/mobile-contextual-panels`. Review mode: explicitly clone-local off, verified outside sandbox; do not start or enable native review.

## Acceptance and checks
- Source: `backend/Control de turno Regardles.xlsx`, operative `BITACORA!AN5:AO25`; twenty memberships, excluding locker. Preserve all exact prices, including semester Gym/Box 2,500 and old/new combined 650/750.
- Create/save/edit combinations without rebuilding them at checkout; validation errors are actionable.
- Previously captured name, amount and nested service/period terms survive catalogue edits and reloads. New purchases use updated terms.
- Preserve legacy/custom storage safely; seed migration must not overwrite edited/custom plans or pretend persistence succeeded when storage fails.
- Modal: keyboard focus containment, Escape/cancel and focus restoration, labelled controls, desktop/mobile layout, safe scrolling and accessible touch targets.
- Test-first: observe focused failing tests before implementation, then passing tests; refactor only while green.
- Commands from `frontend`: focused catalog/registration/payment/editor tests, `npm run typecheck`, `npm run build`, `npm test`.
- Independent verification plus a parent spot check; browser desktop/mobile checks where tooling is available. Disclose unavailable UI proof.

## Progress
- Read-only CodeGraph mapping complete. Existing free-text dialogs, unversioned independent catalog persistence and payment name/amount snapshots identified.
- Existing transactions intentionally do not activate memberships or compute effective dates; preserve that boundary.
- `15 DIAS` activity, weekly 7/8-day semantics and old-rate renewal eligibility are not established by the workbook. Do not silently resolve them.
- Implemented versioned structured catalog, one shared create/edit native dialog, exact source prices, responsive layout, focus/keyboard handling and detached purchase snapshots in both collection and registration paths.
- Original extra offers (Box beca and Clase muestra) retain availability and are visibly marked legacy; the user requested source plans, not removal of existing working offers. Twenty source plans plus two legacy offers and two visits are retained.
- Legacy/custom catalog migration preserves edits, blocks overwriting corrupt/unsupported data and publishes state only after persistence succeeds. No membership activation or date calculation added.
- Writer baseline: 30 focused tests passed. Observed RED: two new catalog/composition tests failed before implementation. Final focused command passed 45 tests across five files; independent verifier reran the same 45 successfully. Parent reran catalog tests: 20 passed.
- Direct source read by independent verifier confirmed all twenty prices; semesters 2,500 and combined old/new 650/750. Pre-existing model fields and catalog-test timeout preserved against `.cache/saved-plan-editor/baseline/`.
- Writer full suite: 419 passed, three failed (missing `Asistencia previa` heading in `MemberDetail.test.tsx:60`, `:84`, `Members.test.tsx:31`). Baseline causality is not established; no unrelated files changed.
- Typecheck and build fail with TS2322 at untouched `frontend/src/features/reception/DevolucionesModal.tsx:402`, `Tone` does not accept `info`. Independent typecheck confirms this; pre-change failure was not captured.
- Feature-scoped diff whitespace check passed. Whole-worktree whitespace check finds unrelated existing whitespace warnings; no broad normalizer applied.
- Browser QA could not complete: initial sandbox server timed out; a temporary loopback-only server outside sandbox started, but browser origin approval was declined. No alternate browser/surface workaround attempted. Both owned servers stopped.
- Native assessment was unassessable due mixed untracked inventory; conservatively used independent verification. Review mode remains explicitly off; no native review or preference change.
- No stage, commit, push or PR. Next: resolve the separate broad-check failures and obtain browser permission for desktop/mobile visual proof before closing the work unit.
- Measured feature delta against pre-write baseline: 645 additions and 458 deletions, 1,103 authored lines across twelve source/test files. The forecast was appropriate; no size-only rewriting or test omission.
