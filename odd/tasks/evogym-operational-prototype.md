# EvoGym operational prototype

## Objective

Create a coherent, navigable, full-operation prototype using React, TypeScript, Vite, and Tailwind. Validate workflows with the owner and reception using connected demo data; do not build a backend or real payment processing.

## Problem and why

The generated Stitch screens were inconsistent and introduced unsupported operational claims. A shared visual system, application shell, reusable components, and consistent prototype state are needed to test real workflows without implying that unresolved business decisions have been made.

## Scope and constraints

- Exactly two demo roles: `OWNER` and `RECEPTION`; a role selector is not authentication or authorization.
- Follow `Design.md`: light Bento layout, restrained clay depth, EvoGym orange/dark identity, neutral Spanish UI, purposeful content, keyboard access, responsive layouts, and no fabricated metrics.
- Preserve the physical notebook as mandatory and Excel as the current reconciliation master; do not claim automatic reconciliation or synchronization.
- No backend, real payments, online checkout, biometric access, turnstiles, or WhatsApp integration.
- Do not invent rules for grace, credit application/refund, transfer confirmation, cancellation, permissions, or ambiguous renewal dates. Keep related exceptional actions unavailable or clearly marked as pending.
- Keep business data and simulated operations outside presentation components. Keep monetary values in integer minor units and derive totals.
- Preserve the source logo; do not redraw it or create an unapproved monogram.
- Do not commit secrets, credentials, generated CodeGraph data, or runtime output.

## Delivery strategy and route

- Strategy: `ask-on-risk`; the user chose a linear chain of work-unit commits on the feature branch. No PRs will be opened or published without separate authorization.
- Implementation route: delegated direct, one writer per task. The change is multi-file and reading prepares implementation.
- Feature branch: `feat/evogym-operational-prototype`.
- Forecast: more than 400 authored lines across the full feature; keep work units coherent and reassess before a later commit if the delivery budget is reached. T01 commits: `b89f0f0fd7341a223abbf97b362dc0f55f96d0f5` (application foundation) and `b657765938e8c93b399538a9e01942960130ebf5` (design map/run documentation); T02 commit: `595fdd225899f5f49062eeaa70e8d7d5da9e9838`; T03 commit: `1325c8a`.
- CodeGraph initialization reported no indexed source files because the workspace initially contained only Markdown. Use ordinary file tools until source exists.
- No project skill registry exists; use available global skills and the verified React/Tailwind/Vite guidance already researched.

## Work plan

### T01 — Shared application foundation
- [x] Create the Vite React/TypeScript app and Tailwind integration with current documented setup.
- [x] Implement shared tokens, responsive app shell, OWNER/RECEPTION navigation, accessible primitives, and a component catalog route.
- [x] Add typed demo data and a small mock operations adapter/store with role switch and reset; no production auth.
- [x] Add test/typecheck/build scripts and document local run commands.
- [x] Ignore generated CodeGraph data and runtime output.
- Verification: `npm run typecheck`; `npm test`; `npm run build`.
- Route: delegated direct. Acceptance: app starts; shared design tokens and navigation are consistent; role changes update allowed demo navigation; catalog shows component states; demo data is labeled; the three checks pass.

### T02 — Members and membership collection
- [x] Add member search/list, member detail, demo member creation, and membership collection/review/result flow.
- [x] Use confirmed catalog pricing only; show unresolved eligibility, grace, credit, transfer, and date rules without silently choosing a policy.
- [x] Ensure one simulated confirmed payment updates the member and current shift once.
- Verification: `npm run typecheck`; `npm test`; `npm run build`; focused member/payment tests.
- Route: delegated direct. Acceptance: search/detail/renewal navigation works; a confirmed demo payment is idempotent for duplicate submission and reflected consistently; pending outcomes are never presented as confirmed.

### T03 — Sales, inventory, and shifts
- [x] Add product/visit sale, shift opening/current shift/close, inventory movements, physical count, and discrepancy review.
- [x] Keep opening float separate from sales; model expected stock as opening + restocks − sold − waste.
- [x] Scope reception to the current shift and keep unresolved adjustments unavailable; carry-in stock preserves expected inventory without exposing prior movement totals.
- Verification: `npm run typecheck`; `npm test`; `npm run build`; focused sales/inventory/shift tests.
- Route: delegated direct. Acceptance: sales update inventory and shift totals exactly once; opening float is not revenue; inventory discrepancy remains separately visible; notebook/Excel comparison is explicitly manual.

### T04 — Owner overview, history, and visual validation
- [ ] Add owner business overview, movement/shift history, and read-only catalog.
- [ ] Validate shared layout across role screens, responsive behavior, keyboard navigation, contrast, and realistic empty/error/unknown demo states.
- [ ] Add browser-level Playwright coverage for the principal connected workflows if runtime tooling permits.
- Verification: `npm run typecheck`; `npm test`; `npm run build`; Playwright checks if available; parent spot-check of one primary workflow and branch diff.
- Route: delegated direct. Acceptance: owner overview uses explicit period and confirmed collections, not profit or invented scores; global history is absent from reception navigation; desktop/mobile layouts preserve task order; all verification outcomes are recorded honestly.

## Progress and evidence

- [x] Initial workspace and `Design.md` inspected; no application existed.
- [x] CodeGraph initialized; no supported source files were present at initialization.
- [x] Feature branch created: `feat/evogym-operational-prototype`.
- [ ] Engram mirror pending: writes for project `evogym` currently return `unknown_project`.
- [x] T01 — application foundation commit `b89f0f0fd7341a223abbf97b362dc0f55f96d0f5`; design-map/run documentation commit `b657765938e8c93b399538a9e01942960130ebf5`. Typecheck passed, tests 7/7 passed, production build passed; independent review found no actionable issues. Package installation required explicit escalation after sandbox DNS failure. Native RDD status/assessment unavailable because `gentle-ai` is not installed; no native review receipt is claimed.
- [x] T02 — commit `595fdd225899f5f49062eeaa70e8d7d5da9e9838`; user approved Vitest thread-pool setting in `vite.config.ts`; tests 15/15 passed under standard `npm test`, typecheck/build passed, and independent review found no actionable issues. Parent also re-ran `npm test` and `git diff --check`.
- [x] T03 — commit `1325c8a`; two-shift regression proves Reception sees current-shift movement totals and accurate carry-in only. Tests 28/28, typecheck, build, and diff check passed; independent review found no remaining correction-specific issue. No visual/browser QA or native RDD receipt.
- [ ] T04 — awaiting prior flows.

## Next step

Implement T04 owner overview, movement/shift history, and visual validation.

## Relevant files

- `Design.md` — approved visual direction and confirmed constraints.
- `odd/tasks/evogym-operational-prototype.md` — feature scope, stable tasks, and verification evidence.
