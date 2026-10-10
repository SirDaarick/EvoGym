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
- Feedback is subtle and consistent for hover, focus, press/click, route/content, dialog, and success/error states; it never conveys status by motion alone or delays an operation.
- Tables and charts use the agreed TanStack capabilities while matching EvoGym visual tokens; financial values are immediately legible and charts provide tabular equivalents.
- Keyboard, touch, focus visibility, reduced motion, light/dark themes, and narrow viewport behavior are verified.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Tasks
- [x] **TC01 — Build shared visual and motion foundation.** Added accessible arrow-key-operable catalog tabs, light/dark system and manual theme support, shared panel spotlight, active button feedback, route/tab arrival and reduced-motion safeguards. Added focused tab/theme tests. Route: delegated direct. RED: new catalog tests failed before implementation because the catalog had no tab roles; GREEN: focused catalog and app tests passed, 12 tests total; `npm run typecheck` passed. Source adaptation is local CSS/React behavior; no React Bits source was copied. Slice commit: `53027b7` (`feat(catalog): add accessible visual foundation`).
- [x] **TC02 — Add representative accessible data views.** Added TanStack Table sorting with semantic headers, 4/12-week controls, TanStack Charts with EvoGym color tokens, fictional financial/stock data with exact-value alternatives, and existing attendance calendar with isolated fixtures. Route: delegated direct. RED: the added table/chart/attendance test failed because the data section had no sorting control; GREEN: focused catalog tests passed, 3 tests total, including sort state and selected period data; `npm run typecheck` passed. Dependency versions: `@tanstack/charts@1.1.0`, `@tanstack/react-table@8.21.3`; both MIT. Slice commit: `7f4771f` (`feat(catalog): add accessible data views`).
- [x] **TC03 — Map domain composites to T01–T18 and close the catalog.** Added all 18 screen IDs as explicit fictional reference cards, with screen-specific no-policy-invention notes; shared component fiches document interactive states and accessibility contracts. Route: delegated direct. RED: mapping test failed before gallery implementation because the workflow tab did not label fictional samples or enumerate the screen IDs; GREEN: focused catalog tests passed, 4 tests total, and `npm run typecheck` passed. Full verification: `npm run typecheck` passed; `npm test` passed (14 files, 72 tests); `npm run build` passed with a non-failing Vite warning that the main JS chunk is 514.53 kB (>500 kB). Slice commit: `3167a2e` (`feat(catalog): map planned workflow demos`).

## Progress and evidence
- Initial inspection: current branch `codex/reception-daily-operations`; pre-existing dirty/untracked work includes `Design.md`, `.atl/`, `Logo_Evo.png`, `odd/previews/`, `odd/tasks/frontend-v2.md`, and `odd/tasks/stitch-ui-prototype.md`. Preserve all of it.
- Receipt-driven development status reported OFF (`clone_local`); ordinary repository policy applies. The subsequent status probe also emitted a Git-common-directory access-denied diagnostic; do not infer enabled review from that diagnostic.
- Published dependency verification: TanStack Charts `@tanstack/charts@1.1.0` and TanStack Table `@tanstack/react-table@8.21.3` are stable published releases; install was permitted after sandbox DNS failure, and the lockfile records exact versions and package license metadata.
- TC01 slice committed as `53027b7` (`feat(catalog): add accessible visual foundation`); TC02 slice committed as `7f4771f` (`feat(catalog): add accessible data views`); TC03 slice committed as `3167a2e` (`feat(catalog): map planned workflow demos`).

## Local feature-branch slices

| Slice | Commit | Review boundary |
|---|---|---|
| TC01 | `53027b7` | Shared controls, catalog tabs, theme/motion foundation and focused tests. |
| TC02 | `7f4771f` | TanStack packages, accessible table/charts, period controls, attendance and data fixtures. |
| TC03 | `3167a2e` | T01–T18 gallery coverage, policy-safe fixture descriptions and mapping test. |

## Next step
Implementation and local verification are complete. No PR or push was created; those remote operations were not authorized.
