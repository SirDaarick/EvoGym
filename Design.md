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

## 3. Visual direction: structured, light, athletic

**Bento is composition; clay is depth. Neither is a reason to add content.**
- Use asymmetric summary groups only when one item has greater task importance.
- Keep transactions and inventory in readable tables or lists, not separate tiles per record.
- Express sports identity through orange accents, confident type, generous space, and concise actions.
- Use white surfaces on a quiet off-white background; keep shadows shallow.
- Avoid inset clay effects on inputs: a real control must remain unmistakably interactive.
- Do not use decorative athlete photography in operational screens.
- Keep navigation stable between tasks; do not reorder cards automatically while people work.

### Brand source

Reference image: `C:/Users/edani/AppData/Local/Temp/codex-clipboard-b59af7af-88d1-43b1-bf12-0da469b3f2e7.png`.
Read-only pixel sampling found common flat pixels `#F58231` orange, `#231D1F` dark, and white.
These are raster observations, **not official brand specifications**. Gray is visually present but not precisely sampled here.
Retain the supplied original logo; request a vector/high-resolution asset before production use.
Do not redraw the mark, distort it, or claim to identify the exact logo font.
Use the full mark where legible; a compact approved asset is pending, not an invented monogram.
The tagline belongs only in an optional welcome/brand context, never repeated across operational cards.

## 4. Proposed design tokens

### Color and purpose

| Token | Value | Purpose |
|---|---|---|
| brand.orange | `#F58231` | Brand accent, selected decoration; not a white-text button default. |
| background | `#F7F7F5` | Page canvas. |
| surface | `#FFFFFF` | Cards, tables, form surfaces. |
| text.primary | `#242124` | Main text and numeric values. |
| text.secondary | `#62616A` | Supporting text on white surfaces; check other pairings. |
| action.primary | `#A83D08` | Accessible darker orange candidate for primary controls. |
| action.hover | `#873006` | Primary control hover/pressed candidate. |
| action.soft | `#FFF8F2` | Quiet orange grouping background. |
| boundary.essential | `#75717C` | Necessary input/button boundary against white or page canvas. |
| border.decorative | `#E5E3E0` | Nonessential card separators only. |
| focus | `#2455A4` | Keyboard focus indicator, separate from brand/status. |
| status.success | `#175D3B` on `#EAF6EE` | Confirmed successful outcome. |
| status.warning | `#9A3412` on `#FFF3E7` | Attention with explicit reason. |
| status.error | `#A32222` on `#FDEEEE` | Failure or blocking validation. |

Brand orange is never the sole indicator of selected, overdue, or allowed status.
Pair statuses with text; reserve warning/error colors for meaningful conditions, not visual variety.

### Measured contrast, not a compliance claim

Calculated using WCAG sRGB relative luminance; ratios below are truncated to two decimals.
Checks apply only to the named opaque pairs, not arbitrary shadows, overlays, or other states.

| Foreground / background | Ratio | Intended check |
|---|---:|---|
| `#242124` / `#FFFFFF` | 15.93:1 | Normal text >= 4.5:1. |
| `#62616A` / `#FFFFFF` | 6.10:1 | Normal text >= 4.5:1. |
| `#FFFFFF` / `#A83D08` | 6.29:1 | Primary button text >= 4.5:1. |
| `#FFFFFF` / `#873006` | 8.55:1 | Hover button text >= 4.5:1. |
| `#A83D08` / `#FFF8F2` | 5.98:1 | Soft action text >= 4.5:1. |
| `#75717C` / `#FFFFFF` | 4.76:1 | Essential boundary >= 3:1. |
| `#75717C` / `#F7F7F5` | 4.43:1 | Boundary only; not normal text on canvas. |
| `#2455A4` / white / canvas | 7.21 / 6.72:1 | Focus against these adjacent surfaces >= 3:1. |
| Success / warning / error pairs above | 7.09 / 6.68 / 6.63:1 | Normal status text >= 4.5:1. |

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
| Depth | Cards: 0 4px 14px rgba(35,29,31,.06); optional 0 1px 0 rgba(255,255,255,.8) inset. |
| Controls | Solid fill or essential boundary; never rely on shadow alone to identify a button. |

Keep clay depth on a few panel surfaces; avoid stacked floating layers, gloss, and soft text edges.

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
- Motion is optional: 120–180ms state transitions, no loops; honor prefers-reduced-motion.
- Support zoom and reflow at 320 CSS px; a genuine two-dimensional table may use scoped scrolling.
- Do not hide essential financial review behind a hover, animation, or responsive breakpoint.

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
No disconnected charts, fake forecasts, progress rings, productivity scores, or random gradients.
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
Use EvoGym sports identity, white/off-white Bento grouping, restrained clay shadows, and the tokens above.
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
| Application shell | Persistent demo label, role simulation, reset action, stable role navigation, skip link, responsive task order. |
| Page header and panel | Clear task title and context; optional single primary action; purposeful Bento sizing and restrained depth. |
| Button | Primary, secondary, disabled with adjacent explanation, visible keyboard focus; semantic button type. |
| Field | Persistent label, typed value, error association, invalid state; preserve input on recoverable failure. |
| Badge and notice | Text with neutral, confirmed, pending/warning, and error states; color is never the only signal. |
| Empty state | Explicit absence with next-step context; not a fabricated zero or a disguised failure. |
| Table region | Caption, scoped headers, readable rows, contained horizontal scroll and keyboard focus. |
| Financial review/result | Member/item, period, MXN total, method and explicit credit; confirmed, pending/unknown, error, processing. Implemented with the owning workflow, not a generic unused framework. |

- Feature-oriented routes reuse shared primitives and tokens; business records and operations live outside presentation.
- Demo amounts use integer MXN centavos; format only at presentation boundaries and derive totals from records.
- Keep exactly OWNER and RECEPTION. The selector does not establish identity, permissions, or backend authorization.
- In-memory state resets on reload or explicit reset. Do not claim persistence, connectivity, real-time data, or synchronization.
- Use the Tailwind Vite plugin and CSS theme tokens. No unused dialog dependency or separate Storybook is needed for the initial in-browser component reference.
- No approved logo asset is present in the repository. Plain product-name text is temporary; do not redraw the source mark.
- Treat measured tokens as candidates. Validate rendered contrast, focus, 200% text enlargement, and 320px reflow before any accessibility conformance claim.
- Acceptance tests cover shell, role navigation, route changes, catalog, and reset. Later tasks add deterministic operation tests before behavior changes when runnable.

## References

WCAG 2.2: [text contrast](https://www.w3.org/TR/WCAG22/#contrast-minimum), [non-text contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast), [focus visible](https://www.w3.org/TR/WCAG22/#focus-visible), [focus not obscured](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum), [target size](https://www.w3.org/TR/WCAG22/#target-size-minimum), [financial error prevention](https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data), [reflow](https://www.w3.org/TR/WCAG22/#reflow).
Business evidence: owner interview messages and user decisions in this conversation; Wiki was not reread or modified for this document.
