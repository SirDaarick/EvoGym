# EvoGym — Usable sports identity

**Status: approved direction for a local operational prototype; business exceptions remain unresolved.**
Build a light, task-first interface using Bento composition and restrained clay depth.
Every visible element must help a person understand, decide, or complete real work.
This document does not approve unresolved business rules. The approved implementation uses React, TypeScript, Vite, Tailwind, and React Router with local demonstration data only.

## 1. Decisions and review path

| Status | Direction |
|---|---|
| Confirmed by user | Product name: EvoGym; sports identity; light Bento; subtle claymorphism. |
| Confirmed by user | Minimal, purposeful information; no artificial intelligence claims or decorative metrics. |
| Confirmed by user | Exactly two initial roles: OWNER and RECEPTION. |
| Confirmed by owner interview | Keep the handwritten notebook; Excel is the current reconciliation master. |
| Proposed | Product locale: es-MX; neutral professional Spanish UI copy. Validate before implementation. |
| Proposed | Tokens, screen composition, typography, and interaction details below. |

Review the reception task first, then the owner overview, then failure states.
Validate with the owner and reception before extending to every screen.
Do not treat agreement on colors as acceptance of payment or access rules.

## 2. Roles and information priorities

| Role | Main question | Relevant information | Boundary |
|---|---|---|---|
| OWNER | What needs my attention across the business? | Defined-period collections, shift discrepancies, membership activity, stock exceptions. | Global visibility does not mean permission to erase transaction history. |
| RECEPTION | What do I need to do for this person or this shift? | Member lookup, actual access dates, payment registration, product availability, own shift close. | No global financial dashboard or discretionary credit/access override. |

Permission to reverse a payment, adjust stock, reopen a shift, or authorize grace is unresolved.
Do not expose these actions as generally available until the permission matrix is agreed.
The scholarship selected by the boxing coach does not introduce a coach login.
Show role-appropriate navigation, but enforce authorization outside presentation in implementation.

## 3. Visual direction: structured, athletic, and tactile

**Bento is composition; clay is depth. Neither is a reason to add content.**
- Use asymmetric summary groups only when one item has greater task importance.
- Keep transactions and inventory in readable tables or lists, not separate tiles per record.
- Express sports identity through the official EGC orange, confident type, generous space, and concise actions.
- Light is the default theme: use the official near-white on a quiet off-white canvas, with clear text and restrained gray details. Dark mode is a complete alternate theme, not an inversion filter.
- Make claymorphism more visible on Bento panels through layered soft shadows, a gentle top-edge highlight, and rounded surfaces; keep one clear elevation per panel rather than stacking floating cards.
- Keep text, essential borders, and keyboard focus crisp and high-contrast; decorative depth never substitutes for a control boundary or state label.
- Avoid inset clay effects on inputs: a real control must remain unmistakably interactive.
- Do not use decorative athlete photography in operational screens.
- Keep navigation stable between tasks; do not reorder cards automatically while people work.

### Brand source

Official palette supplied by the owner: EGC Orange `#FC6C06` and EGC White `#FCFCFC`; supporting colors are Black `#080808`, Technical Gray `#202020`, and Secondary Gray `#555555`.
Use the repository logo asset `Logo_Evo.png` as supplied. Preserve its aspect ratio and original artwork; do not redraw, recolor, crop, or distort the mark.
The official orange paired with official black text `#080808` provides 6.95:1 contrast for primary buttons, satisfying WCAG AA in both light and dark themes.
Keep the light theme as the default; dark mode uses the same hierarchy and Bento layout with the official black/technical grays as its base surfaces.
The tagline belongs only in an optional welcome/brand context, never repeated across operational cards.

## 4. Proposed design tokens

### Color and purpose

| Token | Value | Purpose |
|---|---|---|
| brand.orange | `#FC6C06` | Official EGC brand accent; paired with `#080808` text for primary actions. |
| background | `#F7F7F5` | Page canvas. |
| surface | `#FCFCFC` | Official EGC White for cards, tables, and form surfaces. |
| text.primary | `#202020` | Official Technical Gray for main text and numeric values. |
| text.secondary | `#555555` | Official Secondary Gray for supporting text; check other pairings. |
| brand.black | `#080808` | Official Black for selected high-contrast details; not a default page background. |
| action.primary | `#FC6C06` | Official EGC Orange paired with `#080808` text; official black text provides 6.95:1 contrast meeting WCAG AA. |
| action.hover | `#E05A00` | Primary control hover/pressed candidate. |
| action.soft | `#FFF8F2` | Quiet orange grouping background. |
| boundary.essential | `#75717C` | Necessary input/button boundary against white or page canvas. |
| border.decorative | `#E5E3E0` | Nonessential card separators only. |
| focus | `#2455A4` | Keyboard focus indicator, separate from brand/status. |
| status.success | `#175D3B` on `#EAF6EE` | Confirmed successful outcome. |
| status.warning | `#9A3412` on `#FFF3E7` | Attention with explicit reason. |
| status.error | `#A32222` on `#FDEEEE` | Failure or blocking validation. |

Brand orange is never the sole indicator of selected, overdue, or allowed status.
Pair statuses with text; reserve warning/error colors for meaningful conditions, not visual variety.

### Dark theme palette

Dark mode keeps the same logo, orange accent, roles, and content hierarchy. It does not simply invert the light theme. Official brand colors remain unchanged; derived dark-theme surfaces and status colors below are interface tokens, not additional official brand colors.

| Token | Value | Purpose |
|---|---|---|
| dark.background | `#080808` | Official Black for the page canvas and navigation. |
| dark.surface | `#202020` | Official Technical Gray for standard panels, tables, and forms. |
| dark.surface.raised | `#2A2A2A` | Derived raised surface for a selected or higher-priority Bento panel. |
| dark.surface.sunken | `#141414` | Derived inset region for grouping only; never use to make an input look disabled. |
| dark.text.primary | `#FCFCFC` | Official EGC White for primary content. |
| dark.text.secondary | `#CCCCCC` | Derived supporting text with readable contrast on dark surfaces. |
| dark.action.primary | `#FC6C06` | Official EGC Orange for the primary action; pair with dark text, not white. |
| dark.action.text | `#080808` | Official Black on orange primary actions. |
| dark.border.essential | `#8A8A8A` | Derived visible boundary for controls on `#202020`. |
| dark.focus | `#9CC5FF` | Derived keyboard focus color that remains distinct on both dark surfaces. |
| dark.success | `#6DD58C` on `#12301F` | Derived success state. |
| dark.warning | `#FDBA74` on `#3A2416` | Derived warning state. |
| dark.error | `#FF8B8B` on `#391B1B` | Derived error state. |

Use readable text labels with every status color. Do not reuse light-theme status backgrounds or reduce opacity to create dark variants.

### Measured contrast, not a compliance claim

Calculated using WCAG sRGB relative luminance; ratios below are truncated to two decimals.
Checks apply only to the named opaque pairs, not arbitrary shadows, overlays, or other states.

| Foreground / background | Ratio | Intended check |
|---|---:|---|
| `#202020` / `#FCFCFC` | 15.88:1 | Normal text >= 4.5:1. |
| `#555555` / `#FCFCFC` | 7.27:1 | Normal text >= 4.5:1. |
| `#080808` / `#FC6C06` | 6.95:1 | Primary button text >= 4.5:1. |
| `#080808` / `#E05A00` | 5.31:1 | Hover button text >= 4.5:1. |
| `#A83D08` / `#FFF8F2` | 5.98:1 | Soft action text >= 4.5:1. |
| `#75717C` / `#FCFCFC` | 4.64:1 | Essential boundary >= 3:1. |
| `#75717C` / `#F7F7F5` | 4.43:1 | Boundary only; not normal text on canvas. |
| `#2455A4` / official white / canvas | 7.03 / 6.73:1 | Focus against these adjacent surfaces >= 3:1. |
| Success / warning / error pairs above | 7.09 / 6.68 / 6.63:1 | Normal status text >= 4.5:1. |
| Dark primary text / canvas (`#FCFCFC` / `#080808`) | 19.52:1 | Normal text >= 4.5:1. |
| Dark secondary text / surface (`#CCCCCC` / `#202020`) | 10.15:1 | Normal text >= 4.5:1. |
| Dark action text / orange (`#080808` / `#FC6C06`) | 6.95:1 | Primary button text >= 4.5:1. |
| Dark focus / canvas and surface (`#9CC5FF`) | 11.30 / 9.19:1 | Focus against these adjacent surfaces >= 3:1. |
| Dark success / warning / error pairs above | 7.86 / 8.62 / 6.92:1 | Normal status text >= 4.5:1. |

Use a 2px focus outline with a 2px separating gap; inspect actual adjacency in the prototype.
Recheck every rendered text, boundary, selected, focus, hover, and error pairing.
The target is WCAG 2.2 AA; this document and these calculations **do not establish conformance**.

### Typography, space, and depth

| Category | Proposed rule |
|---|---|
| Typeface | System sans-serif first: system-ui, Segoe UI, sans-serif. Optional licensed font only after visual review. |
| Sizes | Body/input 16px; supporting 14px; section 20px; page title 28px; key value 32px. |
| Rhythm | Body line-height 1.5; headings 1.2; use 400/600/700 weights sparingly. |
| Numbers | Tabular numerals for money/counts; currency and period always explicit. |
| Spacing | 4/8/12/16/24/32px scale; 24px card padding desktop, 16px narrow. |
| Radius | Cards 20px, controls 10px, small labels 6px; avoid pill-shaped everything. |
| Depth, light | Bento panels: 0 10px 24px rgba(35,29,31,.10), 0 3px 7px rgba(35,29,31,.06), and 0 1px 0 rgba(255,255,255,.9) inset. |
| Depth, dark | Bento panels: 0 12px 26px rgba(0,0,0,.48), 0 2px 6px rgba(0,0,0,.30), and 0 1px 0 rgba(255,255,255,.07) inset. |
| Controls | Solid fill or essential boundary; never rely on shadow alone to identify a button. |

Use the more visible clay depth on primary Bento panels and the page shell; keep tables, dialogs, and secondary cards flatter. Avoid stacked floating layers, gloss, bright orange glows, and soft text edges. Honor `prefers-reduced-motion`; depth and hover do not depend on animation.

## 5. Interaction and accessibility contract

- One primary action per task context; secondary actions have lower emphasis and clear labels.
- Label icons unless their meaning has been validated; no unexplained icon-only payment actions.
- Use 44px minimum comfortable action targets as a project recommendation, not a WCAG mandate.
- WCAG 2.2 AA target-size minimum is 24 CSS pixels with exceptions; evaluate the actual layout.
- All operations work with keyboard; tab order follows reading/task order, without positive tabindex.
- Focus stays visible and unobscured by sticky headers, notices, or modal controls.
- Dialogs move focus to meaningful content, contain focus, support safe dismissal, and return focus.
- Show persistent field labels; associate errors with fields and explain a correction in plain language.
- Announce async success/failure through appropriate live status without moving focus unnecessarily.
- Disabled actions explain their reason; do not rely on hover-only tooltips.
- Preserve entered data after recoverable errors; never make an operator retype an entire payment.
- Before financial commitment, show member/item, period, total, payment method, and applied credit.
- Prevent repeated submission while processing; never display success before confirmation.
- If the outcome is unknown, show an explicit pending/unknown result and a safe verification path.
- Backend transaction/idempotency semantics remain to be defined; UI locking alone is insufficient.
- Cancellation/refund controls require agreed permissions and traceability; no universal edit/delete.
- Motion is a consistent, purposeful layer across the product, using selected React Bits components where they improve orientation or feedback. Keep ordinary transitions around 120–180ms, avoid idle loops, and honor `prefers-reduced-motion` with reduced or removed nonessential effects.
- Light is the default visual theme; dark mode uses its own tokens rather than filter inversion. If a theme control is shown, it must be labeled, keyboard accessible, and preserve the current task when switched.
- Support zoom and reflow at 320 CSS px; a genuine two-dimensional table may use scoped scrolling.
- Do not hide essential financial review behind a hover, animation, or responsive breakpoint.

### Collapsible sidebar

- Keep the primary navigation in a stable left rail. In its resting desktop state, it is compact: show the unaltered EvoGym logo mark at the top and one recognizable icon for each available navigation destination (for example, a package/box for Inventory); hide the wordmark and visible item labels while collapsed.
- When the pointer enters the rail, expand it to show the EvoGym name and each navigation icon with its text label. Collapse it after the pointer leaves the rail; do not collapse while keyboard focus remains inside it. Keep the active destination visibly identifiable in both widths.
- Provide an explicit, labeled toggle so keyboard and touch users are not dependent on hover. On touch/narrow layouts, use that toggle instead of hover; close the expanded navigation after a destination is selected when appropriate.
- Icon-only destinations retain accessible names and a discoverable label on hover and keyboard focus. Tooltips supplement, but never replace, programmatic names or keyboard operation. Preserve the skip link and visible focus outline.
- Use a short width/content transition consistent with the motion system. The sidebar must not cover or unexpectedly shift essential transaction content, and it must remain usable at zoom and narrow widths.

### React Bits motion language

- Use React Bits as the source for selected motion components and effects across the shared shell and screens: sidebar expansion, route/content transitions, purposeful card hover/selection, dialog entry, and success/error feedback are good candidates. Choose effects that make a state change or task relationship easier to perceive; do not decorate every element simply because it can move.
- Adapt every selected effect to EvoGym's visual language before use: recolor it with the approved light/dark and EGC tokens, and tune its scale, speed, easing, depth, and contrast to the restrained claymorphism and athletic Bento layout. Do not ship a React Bits demo's default neon palette, unrelated gradients, glass/gloss treatment, or oversized/bouncy motion if it conflicts with this identity.
- Keep all motion treatments coherent across screens: share a small set of transition/easing/duration patterns, use orange only as the brand accent (never as the only status cue), and preserve established semantic status colors. A distinct effect is acceptable only when it still feels like the same product.
- Prefer brief, event-driven transitions. Do not animate prices, stock counts, form values, or financial confirmation in ways that obscure their final value; do not delay a control or payment action until a decorative animation finishes.
- Do not use ambient/continuous motion in operational screens. Never make motion the only indication of selected, pending, successful, failed, or overdue state.
- Respect `prefers-reduced-motion`: disable looping/parallax/large travel, shorten or remove nonessential transitions, and preserve immediate state feedback. Check animation smoothness and resource use on representative lower-powered devices.
- Before implementation, verify each chosen React Bits component's current source, license/access tier, dependencies, and compatibility with the existing React/Vite/Tailwind stack. Prefer only the components needed; do not add a broad animation runtime or copy premium-only code without authorization.

## 6. Information inclusion rule

For every proposed element, record: **data, question answered, action enabled, role, source, reliability**.
Remove it if its purpose or source cannot be explained; unresolved useful data gets a pending state.
Limit summary groups to meaningful priorities, not a predetermined count of decorative cards.

| Prefer actionable copy | Reject unsupported copy |
|---|---|
| “Revisar diferencia del turno” | “Inteligencia activa” |
| “Registrar pago” | “Optimización inteligente” |
| “3 productos requieren revisión” with an agreed rule | A decorative “salud del negocio” score. |
| “Última actualización: …” from a real timestamp | “En vivo” without an actual freshness mechanism. |

Distinguish zero, empty, loading, error, stale, and unknown; unavailable is never displayed as $0.
Show a defined reporting period and source timestamp where necessary for interpretation.
No disconnected charts, fake forecasts, progress rings, productivity scores, or random gradients. Use a chart only when trend, comparison, or distribution is materially easier to understand visually than in a table; retain the exact values, period, source, and an accessible text/table equivalent.
Demo records use a persistent “Datos de demostración” label; never imply production results.
Do not show connectivity, AI, or synchronization status unless it reflects implemented behavior.

## 7. First prototype: two representative screens

### A. OWNER overview

| Component | Purpose | Constraint |
|---|---|---|
| Period selector and title | Make the reporting window explicit. | Affects all summaries consistently. |
| Collections summary | Understand confirmed collections by payment method. | Do not call it profit; define sources and treatment of credit. |
| Shift review list | Find reconciliation differences needing review. | Show shift, reason, and link to detail, not a vague score. |
| Membership summary | Review actual membership activity. | Define active/vencida/grace status before counting. |
| Stock exception list | Identify operational shortages or discrepancies. | Threshold/expected-stock rules must be agreed. |

Arrange the important summary in the larger Bento region; use smaller groups for exceptions.
Omit a chart unless a validated comparison question requires one.
Keep long transactions and drill-down details out of the overview.

### B. RECEPTION membership and payment

| Component | Purpose | Constraint |
|---|---|---|
| Member search and result | Identify the correct person. | Show only agreed identifying data. |
| Membership/access summary | Explain current entitlement and actual dates. | No assumed grace access or fabricated 30-day period. |
| Plan and payment form | Register a supported membership and method. | Relevant eligibility must be explicit, not inferred. |
| Review and primary action | Confirm money and entitlement before submission. | Proposed label: “Confirmar pago”; success only on confirmed result. |
| Outcome/receipt reference | Explain the result and support reconciliation. | Notebook folio format is pending; do not invent existing fields. |

Use a focused two-column task layout on desktop, stacked on narrow screens.
The notebook remains a real operational step, not a problem the prototype claims to remove.
Stock visibility belongs in product sale tasks; avoid unrelated inventory cards in membership payment.

## 8. Business constraints the interface must preserve

- Full payment is the default prerequisite for activation; grace is a separate unresolved exception policy.
- Monthly renewal follows calendar dates (17 to 17), not a fixed 30-day interval.
- Day-31 anchoring after a short month, leap-year handling, and renewal timing remain unresolved.
- Grace is at most five days; authorization, eligibility, visibility, and access during grace are pending.
- Account top-ups create credit in favor, not installment debt; credit application/reversal rules are pending.
- Student and coach-selected scholarship eligibility must be validated; do not infer automatic approval.
- Keep the interview catalog as the pricing source; confirm validity dates and eligibility before implementation.
- Shifts are 06:00–14:00 and 14:00–22:00; opening cash is not sales revenue.
- Expected inventory = opening + restocked − sold − waste; record physical count and discrepancy separately.
- Handwritten notebook is mandatory; Excel remains the current reconciliation master.
- Future authority between system/Excel and notebook matching fields require explicit agreement.
- Pending payment and credit balance are not payment methods; transfer confirmation is unresolved.
- Online payments/WhatsApp are desired but initial scope remains pending; anticipatory perks are deferred.

## 9. Responsive and validation checklist

Desktop/tablet-first is a prototype hypothesis, not a claim about installed hardware.
Keep the same task order in a narrow layout; collapse navigation without hiding the current task.
Use scoped table scrolling with readable headers; prioritize columns by task importance.

- [ ] Owner identifies the reporting period and finds a shift discrepancy without prompting.
- [ ] Reception locates the correct member, explains status, and reviews a payment before committing.
- [ ] Reception distinguishes top-up credit from unpaid membership without granting unapproved access.
- [ ] Participants identify what to compare against notebook/Excel and what remains unresolved.
- [ ] Keyboard-only operation covers search, form, review, dismissal, and returned focus.
- [ ] Test empty/loading/error/stale/unknown, duplicate-click, failed payment, and unresolved outcome states.
- [ ] Check contrast in rendered states, 200% text enlargement, and 320px reflow.
- [ ] Verify no fabricated metrics, unsupported statuses, or permission-dependent controls appear as real.

Record task completion, errors, misunderstandings, and assistance required; set targets after baseline testing.
Business uncertainties block related behavior, not exploration of unrelated typography or layout.

## 10. Reusable prototype brief

Create two clearly labeled demo screens: OWNER overview and RECEPTION membership/payment.
Use the supplied `Logo_Evo.png`, official EGC colors, light Bento grouping, more visible but controlled clay depth, and the light/dark tokens above.
Use neutral es-MX copy, realistic labeled sample data, and no fabricated capabilities or operational claims.
Apply information inclusion rules and preserve notebook/Excel reconciliation and unresolved business states.
Provide keyboard-visible controls, payment review, failure/unknown states, and responsive task ordering.
Do not implement backend, invent access overrides, redraw the logo, or add a third role.
This brief is portable to local code, Figma, or Stitch; tools do not replace business/design validation.

## 11. Complete prototype screen map

Navigation is role-specific presentation, not authentication or authorization. T01 supplies the shared shell and component catalog; the remaining screens stay visibly in preparation until their feature tasks are implemented.

| Screen / route suffix | Demo roles | Task and states |
|---|---|---|
| `overview` | OWNER | Defined-period collections and attention items; empty, unknown, and unavailable totals stay distinct from zero. |
| `members` / member detail / create | OWNER, RECEPTION | Search, identify, and create a demo member; results, empty, validation error, and actual membership dates. |
| Membership collection / review / result | OWNER, RECEPTION | Supported plan and method, explicit financial review, confirmed/pending/error result, duplicate-submit protection. |
| `sales` | OWNER, RECEPTION | Product/visit selection, stock availability, explicit total and method, confirmed or unresolved result. |
| `shifts` / opening / close | OWNER, RECEPTION | Opening cash, current shift collections, physical cash/count, manual notebook comparison, discrepancy detail. Reception is scoped to its current shift. |
| `inventory` / movement / physical count | OWNER, RECEPTION | Opening + restocked − sold − waste, physical count, separate discrepancy. Exceptional adjustments stay unavailable until permission is agreed. |
| `history` / movement / shift detail | OWNER | Read-only global history with explicit period, sources and confirmed/pending states; no erase/reverse action. |
| `plans` | OWNER | Read-only source-backed pricing and eligibility information; unresolved eligibility is labeled. |
| `/components` | Both demo views | Development reference for shared primitives; not an operational business catalog. |

Operational routes are prefixed `/owner/` or `/reception/`; the role switch preserves a shared task when available and otherwise opens the new role's primary task. Invalid demo routes redirect to that role's primary task. This is navigation only.

## 12. Shared inventory and implementation principles

| Shared element | Required states / behavior |
|---|---|
| Application shell | Persistent demo label, role simulation, reset action, collapsible icon-rail navigation with pointer/focus/touch behavior, skip link, responsive task order. |
| Page header and panel | Clear task title and context; optional single primary action; purposeful Bento sizing and consistent tactile depth in both themes. |
| Button | Primary, secondary, disabled with adjacent explanation, visible keyboard focus; semantic button type. |
| Field | Persistent label, typed value, error association, invalid state; preserve input on recoverable failure. |
| Badge and notice | Text with neutral, confirmed, pending/warning, and error states; color is never the only signal. |
| Empty state | Explicit absence with next-step context; not a fabricated zero or a disguised failure. |
| Table region | Caption, scoped headers, readable rows, contained horizontal scroll and keyboard focus. |
| Financial review/result | Member/item, period, MXN total, method and explicit credit; confirmed, pending/unknown, error, processing. Implemented with the owning workflow, not a generic unused framework. |

### TanStack ecosystem candidates — evaluate per need, not as a bundle

The current prototype uses React, Vite, Tailwind, and React Router; TanStack packages are not currently installed. Add only a library that solves a concrete screen or data-flow need, and keep its presentation aligned with this design system.

| Library | Recommendation for EvoGym | Fit and tradeoff |
|---|---|---|
| [TanStack Charts](https://tanstack.com/charts/latest) | Preferred candidate when an OWNER or operational report genuinely benefits from a trend, comparison, or distribution chart. | Typed, responsive chart grammar with SVG as the default renderer; React adapter supports React 18/19. Style chart colors, type, labels, tooltips, and dark/light surfaces with EGC/design tokens. It is not a reason to turn simple histories, transaction rows, or every number into a chart. Define trusted source, period, and business meaning before graphing; the current OWNER overview uses period summaries and tables, not chart series. |
| [TanStack Table](https://tanstack.com/table/latest/docs/overview) | Consider for member/inventory lists if real sorting, filtering, pagination, grouping, or row selection becomes sufficiently complex. | Headless: keeps full control of EvoGym markup and styling, but the app still owns semantic HTML, responsive behavior, accessibility, and visual treatment. Current simple tables do not require it yet. |
| [TanStack Query](https://tanstack.com/query/latest/docs/framework/react) | Consider when a real backend/API supplies shared or frequently refreshed data. | Manages asynchronous server state, cache freshness, and mutation updates; it does not provide the API, database, authorization, or offline-sync guarantee. The current in-memory demo has no server-state problem to solve. |
| [TanStack Form](https://tanstack.com/form/latest/docs/framework/react) | Re-evaluate if conditional multi-step registration/payment forms become difficult to validate and maintain with native React form state. | Flexible typed field/form validation, but introduces another form-state model; do not migrate straightforward forms before complexity warrants it. |
| [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction) | Add only if measured long product/member/history lists create a rendering bottleneck. | Headless virtualization preserves style ownership but complicates row measurement, focus, and screen-reader navigation; current demo-sized lists do not justify it. |
| [TanStack Router](https://tanstack.com/router/latest/docs/framework/react/overview) | Not recommended as an additional router. | The project already uses React Router. TanStack Router has useful type-safe route/search APIs, but adopting it would be a migration decision; never run two competing routing systems for the same app. |

- Feature-oriented routes reuse shared primitives and tokens; business records and operations live outside presentation.
- Demo amounts use integer MXN centavos; format only at presentation boundaries and derive totals from records.
- Keep exactly OWNER and RECEPTION. The selector does not establish identity, permissions, or backend authorization.
- In-memory state resets on reload or explicit reset. Do not claim persistence, connectivity, real-time data, or synchronization.
- Use the Tailwind Vite plugin and CSS theme tokens. No unused dialog dependency or separate Storybook is needed for the initial in-browser component reference.
- Use `Logo_Evo.png` from the repository root without altering the source artwork; plain product-name text may remain where the full mark does not fit legibly.
- Treat measured tokens as candidates. Validate rendered contrast, focus, 200% text enlargement, and 320px reflow before any accessibility conformance claim.
- Acceptance tests cover shell, role navigation, route changes, catalog, and reset. Later tasks add deterministic operation tests before behavior changes when runnable.
- Use React Bits components selectively for the shared motion language; make motion nonessential, accessible, performant, and consistent rather than adding a continuous effect to every control.
- Use TanStack Charts as the preferred charting candidate only when it clarifies a validated analytical question; evaluate Table, Query, Form, or Virtual only when their specific trigger above exists. Do not add the TanStack ecosystem wholesale.

## References

WCAG 2.2: [text contrast](https://www.w3.org/TR/WCAG22/#contrast-minimum), [non-text contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast), [focus visible](https://www.w3.org/TR/WCAG22/#focus-visible), [focus not obscured](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum), [target size](https://www.w3.org/TR/WCAG22/#target-size-minimum), [financial error prevention](https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data), [reflow](https://www.w3.org/TR/WCAG22/#reflow).
Animation source: [React Bits animated React components](https://www.reactbits.dev/get-started/index); verify the selected component's source and license/access tier before implementation.
Business evidence: owner interview messages and user decisions in this conversation; Wiki was not reread or modified for this document.
