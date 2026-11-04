# 05 — UI/UX, accessibility and design system

Scope: `frontend/` styles and components, measured against `Design.md` and the Vercel Web Interface Guidelines.
Guides: `web-design-guidelines`, `redesign-existing-projects`, `frontend-design`, `ponytail-review`.
Users:
- receptionists doing fast counter work on touch tablets
- the owner/admin working with reports, catalog, inventory and staff

Method: static. Contrast was computed from token values, not from the rendered DOM.

## Must fix

### U1. Dialogs have no focus management (30 hand-rolled copies)

- **Shared `Modal` (`shared/ui.tsx:76-145`):**
  - no initial focus, no Tab trap, no focus return, no `inert` background
  - imported by only 1 file (`UnscheduledClockInModal`)
- **30 other `role="dialog"` blocks are copy-pasted.** Examples:
  - `GastoModal.tsx:119`
  - `LiveMembershipCheckout.tsx:388/419/452`
  - `StaffManagement.tsx:542/710/1210/1226/1507`
  - `InventoryAnalytics.tsx:946/1061/1156`
- **Escape is missing** in `StaffManagement`, `PointPaymentModal`, `StaffProfileSelection`, `DevicePairingModal` and `GimiDashboard`.
- **Case:** A receptionist opens "Gasto" from the keyboard or scanner. Tab moves into the page behind the dialog, and focus is lost when it closes. This contradicts Design.md §5 ("contain focus, return focus").
- **Fix:** Build one `<Dialog>` primitive on native `<dialog>` + `showModal()`. It gives the focus trap, Escape, `inert` and focus return for free. `ShiftOpenModal` and `PlanEditor` already use it. Migrate the call sites incrementally.

### U2. Brand orange used as text fails contrast

- **Problem:**
  - `#FC6C06` on `#FCFCFC` is about **2.8:1**; AA needs 4.5:1.
  - About 132 rules use it for text: links (`styles.css:33`), `.eyebrow` at 12px (`:196`), the active nav item (`:70`).
  - Design.md specifies `#A83D08` (5.98:1) for text, but no token for it exists.
- **Fix:** Add a `--color-primary-ink` token (plus a dark-theme value) for text, links and icons. Keep `#FC6C06` for fills only.

### U3. Validation is toast-only

- **Where:** `GastoModal.tsx:58-86` and about 10 other modals.
- **Problem:** "Concepto requerido" and "Monto inválido" appear in a toast that disappears after 3.2 seconds. The field gets no `aria-invalid` and no inline message, even though `Field` supports both.
- **Case:** On a touch tablet, the receptionist misses the toast and does not know which field failed.
- **Fix:** Use `<Field error=…>` for field errors. Keep toasts for operation outcomes only. Error toasts should persist and use `role="alert"`; today they are polite and auto-dismiss.

### U4. The reason a button is disabled is only shown on hover

- **Where:** `ReceptionHome.tsx:905-911`.
- **Problem:** The Merma button's reason lives in `title=`. Touch screens never show it, and a disabled button gets no focus.
- **Fix:** Show visible helper text, linked with `aria-describedby`.

### U5. Theme defaults to dark and is not persisted — VERIFIED

- **Where:** `index.html:2` hardcodes `data-theme="dark"`.
- **Problem:**
  - Design.md says light is the default, and the `theme-color` meta is the light value.
  - The toggle in `ApplicationShell.tsx:137` only sets the dataset, so a reload resets the theme.
- **Fix:**
  - Add a small inline `<head>` script that reads storage or `prefers-color-scheme`.
  - Persist the choice on toggle.
  - Set `theme-color` dynamically.
- Decide the default with D8.

### U6. `window.confirm` for destructive actions

- **Where:** 5 sites: `ApiProductApp.tsx:90`, `StaffProfileSelection.tsx:192`, `DevicePairingModal.tsx:198`, `AdminAccessApp.tsx:341`, `AdminStaffDevices.tsx:78`.
- **Problem:** The native dialog is unstyled and can be blocked in installed PWAs.
- **Fix:** Add a `ConfirmDialog` built on U1's `<Dialog>`.

## Should fix

### U7. Tokens are only partly adopted

- **What exists:** A real token layer in `styles.css:3-25` (`@theme`) plus a full dark theme (`:422-447`).
- **Hardcoded colors:** about 1,020 hex literals across 36 CSS files (about 40 of them are the token definitions) and 209 more in TSX. Worst files:

  | File | Hardcoded colors |
  |---|---|
  | `MemberDetail.css` | 303 hex + 157 rgba |
  | `styles.css` | 186 hex |
  | `GimiDashboard.css` | 71 |

- **Values drift from Design.md:**
  - `#176b45` instead of success `#175D3B`
  - cool slate grays (`#334155`) that clash with the warm palette
  - `#dc2626` instead of error `#A32222`
- **Missing tokens:** Status colors (success/warning/error with background and ink) are not tokens. The `--catalog-*` tokens are misnamed.
- **Fix:**
  1. Add semantic status tokens.
  2. Codemod the hex values to them.
  3. Ban hex outside `tokens.css` with Stylelint (`color-no-hex` scoped).

### U8. Touch targets and small text

- **What exists:** A global rule gives buttons and selects `min-height: 44px` (`styles.css:35`).
- **Problems:** About 80 rules override it with 20–39px targets, for example:
  - `.header-action-control` at 40px
  - `.demo-controls` at 36px
  - Gimi and Stepper controls

  49 rules use 9–11px font sizes.
- **Fix:** Add a `--target-min: 44px` token and keep a 12px minimum for secondary text.

### U9. CSS organization does not scale

- **Size:** `styles.css` has 2,470 lines and still holds feature styles.
- **Class names do not say where they are used:**
  - `.guantes-*` is used by Gasto, Extra and Merma.
  - `.staff-modal-*` is used by reception modals and owner screens.
- **Anti-patterns:**
  - 205 `!important`
  - 34 `transition: all` (a guideline anti-pattern)
  - z-index values up to 1200 with no scale
  - 444 inline `style={}` (55 in `LiveMembershipCheckout`)
  - 11 different breakpoint values
- **Fix:**
  1. Split into `tokens.css`, `base.css` and `components/*.css`, with a z-index and breakpoint scale in the tokens.
  2. Use `ui-` prefixed class names (or CSS Modules) for the reusable kit.
- Design.md mentions Tailwind v4, but only `@theme` is used, with no utility classes. Decision D9.

### U10. Copy and formatting are hardcoded

- **Evidence:**
  - No i18n layer.
  - Literals: 75 `'es-MX'`, 37 `'America/Mexico_City'` and 135 "MXN" text suffixes.
  - 24 `toFixed` calls that skip `Intl`.
  - `formatMoney` is duplicated (`demo/adapter.ts:259`, `demo/inventoryAnalyticsSelector.ts:73`).
- **Case:** "$1,234.00 MXN" shows the currency twice (symbol and code).
- **Fix:** One `createFormat({ locale, currency, timeZone })` from `appConfig`, plus a small typed message catalog for the strings that change per business.

### U11. Weak double-submit protection on simple modals

- **What is good:** `LiveMembershipCheckout.tsx:96-114, 264-335` is excellent: a `submittingRef`, an idempotency key and an "unknown outcome" retry.
- **Problem:** `GastoModal.tsx:54-117` has no guard, so Enter plus a second tap can record two expenses. `ExtraModal` and `MermaModal` probably have the same gap.
- **Fix:** Extract a `useSubmitLock()` hook from the checkout and add a busy state to `Button`.

### U12. Tables

- **What is good:** The 61 tables mostly use scroll wrappers.
- **Problems:**
  - 83 `<th>` lack `scope`.
  - Dense tables do not collapse into cards on a phone.
- **Fix:** Add a shared `DataTable` with `scope` and a responsive card mode.

## Nice to have

- **Focus:** About 10 react-bits CSS files use `outline: none`. Check that each has a `:focus-visible` replacement.
- **Viewport height:** Switch the 9 remaining `100vh` uses (`.sidebar`, `.app-shell`) to `dvh`.
- **Template feel:**
  - Every container is the same `.panel` (border, shadow, radius 20). Vary the elevation as Design.md asks: tables and dialogs flatter.
  - An eyebrow sits above every title.
  - Mild marketing copy: "Socios y ventas, a un paso.".
  - Close buttons use the ✕ glyph.
  - Icons are mixed: 65 inline `<svg>` plus Hugeicons.
- **Reception home:** 5 quick actions plus Devoluciones/Merma give no clear primary action per context. Consider grouping, or making the most frequent action primary.

## What to keep

- A real `@theme` token layer and a complete dark theme.
- A skip link, a global `:focus-visible`, 44px base targets and 16 `prefers-reduced-motion` blocks.
- 358 `aria-label`s, 152 live regions, and only 3 click handlers on non-buttons.
- `Field` with `aria-invalid` and `aria-describedby`; `<html lang="es-MX">`; tabular numbers in tables.
- The checkout's idempotency and unknown-outcome flow, and the cash tender calculator.
- Native `<dialog>` in the shift flows, and the component catalog as the seed of a documentation site.

## Proposal: a reusable UI kit (`core/ui`)

| Layer | Contents |
|---|---|
| Tokens (`tokens.css`) | color (brand, surface, ink, muted, border, focus, success/warning/error + bg + ink, `primary-ink`), spacing 4–32, radius, shadows, type scale, motion, z-index scale, `--target-min`, breakpoints |
| Brand theme (`theme-evogym.css`) | the only file another business overrides: brand colors, logo, name |
| Primitives | Button (busy state), IconButton (required `aria-label`), Field/Select/Textarea, Badge, Notice, Panel, EmptyState, Skeleton, Tabs, PageHeader, Toast (persistent error variant) |
| Overlays | Dialog (native), ConfirmDialog, Drawer (replaces `MobileDetailPanel` and the `staff-modal-*` pile) |
| Patterns | ModalForm, MoneyInput, CashTender, DataTable (+ card mode), Combobox (member/product search), StatCard, AppShell + config-driven Sidebar |
| Locale | `createFormat()`, a typed message catalog |
| Hooks | `useSubmitLock`, `useClock`, `useBusinessDate` |
| Guardrails | Stylelint: no hex/px outside tokens; a lint rule for 44px targets |

## Metrics

| Metric | Value |
|---|---|
| CSS files / `styles.css` lines | 36 / 2,470 |
| Hex literals (CSS / TSX) | ~1,020 / 209 |
| `!important` / `transition: all` | 205 / 34 |
| Dialog implementations | 1 shared (1 user) + 30 hand-rolled + 5 native |
| `<button>` vs `<Button>` | 439 / 439 |
| Inline `style={}` | 444 |
| `window.confirm` | 5 |
