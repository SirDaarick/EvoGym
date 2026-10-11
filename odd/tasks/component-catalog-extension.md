# Component Catalog Extension

## Objective
Add the approved collapsible global sidebar, demonstrate nine requested React Bits components in `/components`, and extend the existing TanStack data examples without changing operational controls or business rules.

## Constraints and delivery
- Preserve unrelated dirty and untracked files, especially `Design.md`, `.atl/`, `Logo_Evo.png`, and other ODD documents/previews.
- Use the existing React 19, TypeScript, Vite, CSS-token, and Vitest stack. Adapt free React Bits TS-CSS source; retain its MIT + Commons Clause notice. No premium source or product authentication.
- Keep all new motion demos catalog-only; the sidebar is the sole global UI change. Honor keyboard/focus, narrow reflow, themes, and reduced motion.
- Route: delegated direct; multi-file implementation and source installation require a bounded writer. Forecast: over 400 authored lines. Delivery: local feature-branch chain on `codex/component-catalog-extension`; no push or PR.
- Each unit includes its tests and a Conventional Commit. Receipt-driven development is off by clone-local choice; do not start native review.

## Tasks
- [x] **CE01 — Accessible collapsible sidebar.** Compact desktop rail with the supplied unaltered logo, recognizable icons, accessible names, hover/focus expansion and explicit pin toggle; active state and narrow layout remain usable. Route: delegated direct (app shell, styles, tests). TDD RED: two focused sidebar tests failed before implementation; GREEN: focused app tests 12/12. Writer checks: `npm run typecheck` passed, `npm test` passed (80/80), `npm run build` passed with the existing non-failing chunk warning. Parent spot check: `npm run typecheck` passed. Layout reserves expanded width so hovering does not cover or shift transaction content; 150ms motion is disabled for reduced motion and narrow layouts. Commit: `07a7e84` (`feat(navigation): add accessible collapsible sidebar`).
- [x] **CE02 — React Bits catalog demos.** Installed/adapted genuine free TS-CSS registry source for CodeSlots, JellyRadio, RubberSegment, SpringCheck, SquishSwitch, SwipeToast, MagicBento, AnimatedList, and Stepper, with complete upstream license and interactive fictional examples only in `/components`. Route: delegated direct (registry setup, source, catalog, styles, tests). The registry source was extracted directly into the authorized directory rather than running the CLI, whose generated destinations could exceed the approved edit surface. TDD RED: catalog interactions and follow-up accessibility tests failed before implementation/correction; GREEN: focused tests 16/16. Writer checks: `npm run typecheck`, `npm test` (86/86), and `npm run build` passed with the existing non-failing large-chunk warning. Independent verifier confirmed typecheck, 83/83 tests, and build before the correction; parent reran the corrected focused tests 16/16. Corrected toast close label, fictional OTP autofill, and scripted reduced-motion behavior. This coherent nine-component source integration exceeds the ~400-line review heuristic because upstream source is retained, not compressed; local feature-branch slices and tests keep it auditable. Commit identity pending.
- [ ] **CE03 — TanStack data showcase.** Keep existing line/bar charts; add a fictional categorical comparison chart with exact-value table, plus filtering and row selection in existing TanStack Table example. Tests: controls/results/accessible alternatives, typecheck, full test, build. Route: delegated direct (catalog/data/chart/tests).

## Progress and evidence
- Starting branch point: `a79cea6`; pre-existing unrelated work remains dirty/untracked.
- 2026-10-10: Read-only map confirmed existing fixed sidebar and existing TanStack chart/table demos. React Bits free license is MIT + Commons Clause.
- CE01: Implemented and verified the global collapsible sidebar; only the pre-existing `Logo_Evo.png` asset is staged from prior untracked files because the sidebar directly uses it.
- CE02: Added `components.json` with the free `@react-bits` registry, TS/Vite alias wiring, nine TSX/CSS source pairs, their notice, scoped gallery, and targeted tests. Existing operational controls remain unchanged.

## Next step
Commit CE02, then add the categorical TanStack comparison and table interactions for CE03.
