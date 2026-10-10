# Interactive Component Catalog

## Objective
Extend the existing `/components` page into an interactive, reusable visual catalog derived from `odd/tasks/frontend-v2.md` and `Design.md`. Build representative shared and domain composites with explicit fictitious data; leave all unresolved business policies and API behavior out of scope.

## Problem and rationale
The project has a small shared UI foundation and a basic catalog, but the planned 18 workflows need a consistent component, state, animation, table, and chart vocabulary before assembling screens and implementing their domain logic.

## Scope and constraints
- Preserve the existing React, React Router, TypeScript, Vite, Tailwind, CSS-token, and Vitest/testing-library conventions.
- Extend `/components`; do not build a second component system or alter the authoritative screen plan/design source files.
- Reuse existing `Button`, `Panel`, `PageHeader`, `Badge`, `Notice`, `EmptyState`, `Field`, `TableRegion`, and attendance calendar where suitable.
- Keep domain behaviors separate while sharing visual primitives; use mock data only and label it as demonstration data.
- Use the visual and accessibility contract in `Design.md`, including light/dark tokens, high-contrast focus, 320px reflow, and reduced-motion behavior.
- Adapt the selected React Bits TS-TW source components to EvoGym rather than importing their demo presentation unchanged.
- Add only TanStack Table/Charts needed for the catalog; no Query, Form, Virtual, or Router package.
- Keep dependency versions on published releases and record the resolved version in the lockfile.
- Preserve existing unrelated dirty and untracked files.

## Delivery
- Route: delegated direct, one writer; preparation and implementation stay together.
- Trigger: work crosses multiple non-trivial source files and package/test integration.
- Forecast: approximately 900 authored changed lines across three work units; generated bundle output excluded.
- Delivery strategy: feature-branch-chain (user selected choice 1); keep each task as a local reviewable slice on the existing feature branch. No PR, push, or other remote operation is authorized.
- Current branch is an existing feature branch; do not branch-switch or include unrelated workspace changes.

## Acceptance criteria
- Catalog demonstrates representative component variants, states, visual treatment, interactions, and screen coverage across T01–T18 without inventing business decisions.
- Feedback is subtle and consistent for hover, focus, press/click, tab/content, dialog, and simulated success/error states; it never conveys status by motion alone or delays an operation. The native modal dialog announces illustrative content, supports Escape and explicit close, returns focus to its opener, and disables entrance motion for reduced-motion preferences.
- Tables and charts use the agreed TanStack capabilities while matching EvoGym visual tokens; financial values are immediately legible and charts provide tabular equivalents.
- Keyboard, touch, focus visibility, reduced motion, light/dark themes, and narrow viewport behavior are verified.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Tasks
- [x] **TC01 — Build shared visual and motion foundation.** Added accessible arrow-key-operable catalog tabs, light/dark system and manual theme support, shared panel spotlight, active button feedback, route/tab arrival and reduced-motion safeguards. Added focused tab/theme tests. Route: delegated direct. RED: new catalog tests failed before implementation because the catalog had no tab roles; GREEN: focused catalog and app tests passed, 12 tests total; `npm run typecheck` passed. Source adaptation is local CSS/React behavior; no React Bits source was copied. Slice commit: `53027b7` (`feat(catalog): add accessible visual foundation`).
- [x] **TC02 — Add representative accessible data views.** Added TanStack Table sorting with semantic headers, 4/12-week controls, TanStack Charts with EvoGym color tokens, fictional financial/stock data with exact-value alternatives, and existing attendance calendar with isolated fixtures. Route: delegated direct. RED: the added table/chart/attendance test failed because the data section had no sorting control; GREEN: focused catalog tests passed, 3 tests total, including sort state and selected period data; `npm run typecheck` passed. Dependency versions: `@tanstack/charts@1.1.0`, `@tanstack/react-table@8.21.3`; both MIT. Slice commit: `7f4771f` (`feat(catalog): add accessible data views`).
- [x] **TC03 — Map domain composites to T01–T18 and close the catalog.** Added all 18 screen IDs as explicit fictional reference cards, with screen-specific no-policy-invention notes; shared component fiches document interactive states and accessibility contracts. Independent verification found text-only cards, inadequate dark contrast, and missing tab-content transition. Correction RED: three new focused assertions failed for absent composites, contrast tokens, and tab transition. GREEN: four visible fictional composites group T01–T18; an interactive demo result selector announces simulated success/error without data mutation; tab panel remounts trigger the reduced-motion-aware transition. Dark contrast tests enforce >=4.5:1 text and >=3:1 chart ratios; computed ratios are 7.78:1 primary label, 9.93:1 field error, 9.35:1 and 8.99:1 chart series. A real dialog remains pending and is not claimed as delivered. Prior writer checks: typecheck passed; 14 files/72 tests passed; build passed with Vite >500 kB warning (514.53 kB). Independent verifier `npm run typecheck`: PASS. Correction checks: focused test 7/7 passed; `npm run typecheck` passed; `npm test` passed (14 files, 75 tests); `npm run build` passed with same warning (518.76 kB). Correction slice commit: `6154e5d` (`fix(catalog): add domain examples and dark contrast`).
- [x] **TC04 — Add an accessible illustrative dialog.** Added a native modal `<dialog>` fixture with a descriptive accessible name, initial focus on the close action, Escape/cancel handling, explicit close, and focus return to the opener. Copy explicitly says the dialog is illustrative and does not confirm or change data. Reduced-motion styles disable the dialog and backdrop entrance animations. TDD RED: focused test failed because no dialog trigger existed. GREEN: catalog tests passed (8 tests), including modal semantics, illustrative copy, close/Escape, focus return, and reduced-motion CSS. Full verification: `npm run typecheck` passed; `npm test` passed (14 files, 76 tests); `npm run build` passed with the existing non-failing Vite chunk warning at 519.94 kB (>500 kB). Slice commit: pending.
## Progress and evidence
- Initial inspection: current branch `codex/reception-daily-operations`; pre-existing dirty/untracked work includes `Design.md`, `.atl/`, `Logo_Evo.png`, `odd/previews/`, `odd/tasks/frontend-v2.md`, and `odd/tasks/stitch-ui-prototype.md`. Preserve all of it.
- Receipt-driven development status reported OFF (`clone_local`); ordinary repository policy applies. A subsequent status probe emitted a Git-common-directory access-denied diagnostic; do not infer enabled review from that diagnostic.
- Published dependency verification: TanStack Charts `@tanstack/charts@1.1.0` and TanStack Table `@tanstack/react-table@8.21.3` are stable published releases; lockfile records exact versions and package license metadata.
- Independent verification finding: workflow mapping cards were text-only; dark primary label, field error, and chart-series colors had inadequate contrast; tab-content transition was missing. The independent verifier separately reported `npm run typecheck`: PASS.
- Correction TDD: new composite, feedback, contrast, and transition tests were first observed failing; after implementation, focused catalog tests passed (7/7). Dark contrast assertions use minimum thresholds and verify reduced-motion exclusion.
- TC04 TDD: the new dialog test first failed because no dialog trigger existed; then focused catalog tests passed (8/8), verifying dialog semantics, illustrative-only copy, Escape and close actions, focus return, and reduced-motion selectors.
- Full correction checks: `npm run typecheck` passed; `npm test` passed (14 files, 75 tests); `npm run build` passed with Vite's non-failing main-chunk warning at 518.76 kB (>500 kB). Previous writer's checks remain recorded in TC03 above: 14 files/72 tests and a passing build with 514.53 kB warning.
- TC03 correction implementation commit: `6154e5d` (`fix(catalog): add domain examples and dark contrast`). Evidence commits: `685ceb0` (`docs(catalog): record correction evidence`) and `5d3a7e4` (`docs(catalog): restore task evidence sections`).
- TC04 full verification passed: `npm run typecheck`; `npm test` (14 files, 76 tests); `npm run build` (non-failing 519.94 kB chunk warning). Commit identity is recorded after creation below.

## Local feature-branch slices

| Slice | Commit | Review boundary |
|---|---|---|
| TC01 | `53027b7` | Shared controls, catalog tabs, theme/motion foundation and focused tests. |
| TC02 | `7f4771f` | TanStack packages, accessible table/charts, period controls, attendance and data fixtures. |
| TC03 | `3167a2e`, correction `6154e5d` | T01–T18 mapping and visible domain composites, theme contrast and tab transitions. |
| TC03 evidence | `685ceb0`, `5d3a7e4` | Task document records findings, checks, commit IDs and pending dialog scope. |
| TC04 | Pending | Accessible illustrative native dialog with Escape/close, focus return, and reduced-motion support. |

## Next step
The accessible catalog dialog is locally verified by TC04 checks above. No PR or push was created; those remote operations were not authorized.
