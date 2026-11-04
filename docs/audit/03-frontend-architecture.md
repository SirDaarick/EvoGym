# 03 — Frontend: architecture and reusability

Scope: `frontend/src`. Guides: `architecture-patterns`, `ponytail-review`, judged against screaming architecture, atomic design and container/presentational.
Method: codegraph, an import-graph script over non-test files, and targeted reads.

## Current shape

```text
frontend/src/
├── domain/     2 files: models.ts, gimi.ts — imports nothing (good)
├── shared/     9 files: ui.tsx (Button, Panel, Modal, Field...), theme, MobileDetailPanel — imports nothing (good)
├── api/        35 files: one client per backend area, injected `request`
├── demo/       55 files: a full fake backend on localStorage + selectors + utilities
├── app/        16 files: shell, routing (navigation.ts), Api* glue
└── features/   181 files: owner 26, reception 25, catalog 25 (vendored react-bits), auth 13, ...
```

The layout is a hybrid: layers at the top level (`api`, `domain`, `demo`, `app`, `shared`) and features inside `features/`. It does not "scream" the business yet, and dependency rules are not enforced by any tool.

## What to keep

- `shared/` and `domain/` are leaf layers with zero outward imports.
- `api/*` functions take an injected `request`, so they are testable and framework-free.
- `strict: true` and the `@` alias are configured.
- 1,512 uses of `var(--…)` tokens.
- `ComponentCatalog` works as a living style guide.
- `shared/ui.tsx` has accessibility basics: `aria-invalid`, `aria-describedby`, Escape handling and `role="dialog"`.

## Must fix

### F1. Demo (fake) and live code are interleaved; `demo/` is the de facto shared kernel

- **Two parallel apps:** `app/ProductRoutes.tsx:29-31` chooses `ApiProductApp` or `<DemoProvider><App/></DemoProvider>`.
- **Components branch internally** between demo and live data:
  - `Shifts.tsx:70-76`
  - `PlanCatalog.tsx:34-43`
  - `Members.tsx:716,858`
  - `Inventory.tsx:285`
  - `ExpenseReport.tsx:44`
  - `AlertCenter.tsx:88-101`, which also calls `useDemo` inside try/catch and breaks the rules of hooks.
- **Live code depends on demo:** about 55 non-test files import `demo/`. Pure utilities and types live there:
  - `formatMoney`/`parseMoney` in `demo/adapter.ts`, used by `ApiReceptionHome`, `StaffManagement`, `PlanEditor` and `gimiStore`
  - the `Plan` type in `demo/plans.ts`, which `api/catalogApi.ts:1` imports, so the API layer depends on demo
  - `memberStatus` and `cashDenominations`
- **Live app is incomplete:** Overview, History, Attendance and Gimi exist only in the demo app. `ApiProductApp.tsx:109` shows `UnavailablePage` for them.
- **Fix:**
  1. Move pure utilities to `shared/format/money.ts`, and move `Plan` and `memberStatus` to `domain/`.
  2. Split each dual component into `XView` (props only), `useLiveX()` and, while demo lives, `useDemoX()`.
  3. Delete the demo branch once the live route exists. Decision D1 is in [06](06-reuse-roadmap.md).
- **Reuse:** This is the BIGGEST blocker. Any feature you extract drags the whole demo state with it.

### F2. Dependency cycle between `features/` and `app/`

- **Evidence:**
  - Nine feature files import `../../app/navigation` for `rolePath`/`homePath` (verified), for example `Login.tsx:3`, `Members.tsx:11`, `Shifts.tsx:14`, `Sales.tsx:4`.
  - `app/` imports 8+ features.
  - The same reverse pattern appears in `demo → features/staff`, `catalog → attendance` and the `auth ↔ staff` cycle.
- **Fix:** Move route helpers to `shared/routing`, or pass `buildPath` in. Move shared pieces (member lookup, payment calculators, staff identity) down to `shared/` or `domain/`, so features only depend downward.

### F3. No central HTTP client

- **Evidence:**
  - 7 copies of `type Request = (path, init) => Promise<Response>`.
  - `requestJson`/`readResponse` are reimplemented.
  - 7 direct `fetch` calls, 2 of them inside components (`StaffAttendanceView.tsx:184`, `LiveMembershipCheckout.tsx:131`).
  - About 15 `*ApiError` classes with no common base; `MemberNumberConflictError` is defined twice.
  - Token handling uses 3 mechanisms: an in-memory refresh class (`adminAuthApi.ts:303`), Bearer headers in `ProductAccessProvider.tsx:114`, and the `sessionStorage` key `evogym:operational-session`.
- **Fix:** One `api/http.ts` with `ApiRequest`, `HttpError(status, code, requestId)`, `NetworkError`, `requestJson` with an injectable message map, and one token provider. Re-export it from every client. See also [04 R3](04-frontend-react-quality.md) (TanStack Query).

## Should fix

### F4. Giant components that mix data, state and UI

- **Worst cases:**

  | File | Lines | Notes |
  |---|---|---|
  | `owner/StaffManagement.tsx` | ~1,440 | one function spanning lines 63–762, 50 `useState` |
  | `reception/CasillerosModal.tsx` | ~1,360 | about 24 states, 7 effects, demo operations inline |
  | `reception/ReceptionHome.tsx` | ~1,175 | about 28 states, `useDemo` + `transact` |
  | `reception/LiveMembershipCheckout.tsx` | ~1,010 | about 25 states, raw `fetch` |

- **Also large:** `StaffAttendanceView`, `InventoryAnalytics`, `MemberDetail`, `GuantesModal`, `Members`, `AlertCenter`, `ShiftOpenModal`, `CurrentPurchaseCard`, `DevolucionesModal`.
- **Fix:** Use container/presentational. A `use<Thing>()` hook loads and mutates, and the views stay pure. Split by job, never by line count. Start with `StaffManagement`, `CasillerosModal` and `GuantesModal`; the last two share the member search and payment breakdown.

### F5. The design system exists but is barely used

- **Evidence:**
  - The shared `Modal` (`shared/ui.tsx:60`) is used by 1 feature file.
  - About 12 dialogs hand-roll overlay, Escape handling and aria with the `staff-modal-overlay` class. There are 25 separate `'Escape'` handlers.
  - The shared Modal itself has a domain-named class (`staff-modal-*`), a hardcoded "Cerrar" and inline styles.
  - There is no shared Table, Select, Tabs, Combobox or Form primitive. `@tanstack/react-table` is wired separately in each feature.
- **Fix:**
  1. Rename the classes to `ui-modal-*` and add a `closeLabel` prop.
  2. Migrate the dialogs one by one.
  3. Add `DataTable`, `Combobox` (member search) and `Tabs` to `shared/ui/`.
- See [05](05-ui-ux.md) for the full UI kit proposal.

### F6. `catalog/` is both the style guide and a runtime UI library

- **Evidence:**
  - Features import vendored react-bits components for real behavior: SwipeToast (10 imports), AnimatedList (8), JellyRadio (4), and also CodeSlots, Stepper, RubberSegment and SquishSwitch.
  - `catalog → attendance` is a reverse edge.
- **Fix:** Move the components that are actually used to `shared/ui/` or `shared/motion/`, and keep `catalog` as a dev-only route.

### F7. Brand, locale and gym vocabulary are hardcoded

- **Evidence:**
  - No i18n library; Spanish copy is inline everywhere, including in `shared/ui.tsx`.
  - `app/navigation.ts:12-33` mixes gym nouns with the route table, and `ApiProductApp.tsx:27-44` repeats the titles.
  - `es-MX` and `America/Mexico_City` are hardcoded (`Shifts.tsx:98`).
  - The "EvoGym" PWA manifest is in `vite.config.ts:15-19`.
  - `domain/models.ts:132` `DemoState` aggregates gloves, lockers and supplements.
- **Fix:**
  1. Add an `appConfig` (brand, locale, currency, timeZone, navigation) and inject it.
  2. Add a minimal `t()`/message-catalog module for the shared and core features. Doing this now is cheaper than retrofitting it later.

### F8. No server-state library; `request` is prop-drilled

- **Evidence:** Only three contexts exist (`DemoProvider`, `AdminSessionProvider`, `ProductAccessProvider`). Each component re-implements loading, error and cancellation, and `apiRequest` is passed into every feature.
- **Fix:** Add a `useApiRequest()` context hook and adopt TanStack Query.

## Nice to have

### F9. Tooling does not enforce the architecture

- **Evidence:**
  - There is no ESLint or Prettier config in `frontend/` (verified).
  - `tsconfig.app.json` lacks `noUnusedLocals`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
  - Code uses deep `../../` paths even though the `@/` alias exists.
- **Fix:** Add ESLint with:
  - `react-hooks` (it would catch the AlertCenter bug);
  - `eslint-plugin-boundaries` or `no-restricted-imports`, so that `shared/domain` import nothing and `features/*` do not import `app`, `demo` or other features.

## Target structure

This keeps the current folders and only adds rules plus a few moves:

```text
src/
├── core/            # reusable across businesses (future package)
│   ├── http/        # client, errors, token provider
│   ├── ui/          # design system: tokens, atoms, molecules, organisms
│   ├── i18n/        # t(), formatters (money, date, businessDate)
│   ├── auth/        # PIN login, admin session, guards
│   └── config/      # appConfig types
├── modules/         # reusable business modules (POS, cash shift, inventory, staff)
│   └── <module>/{api,hooks,components,model}
├── features/        # gym-specific (members, plans, check-ins, rentals, gimi)
└── app/             # composition root: routes, providers, appConfig for EvoGym
```

Dependency rule: `app → features → modules → core`. Nothing points upward.

## Reuse extraction candidates

| Module | Generic? | Blockers | Effort |
|---|---|---|---|
| `shared/ui` design system | Yes | `staff-modal-*` names, Spanish strings, hex colors | S |
| HTTP client + errors (new) | Yes | 7 `Request` types, ~15 error classes | M |
| Auth / PIN login / admin session | Mostly | Spanish copy, `app/navigation`, `staff` cycle, 3 token mechanisms | M |
| Cash shift | Mostly | Demo branch, MXN and timezone, inline messages | M |
| Inventory | Yes | `useDemo`, 1.2k-line analytics | M |
| POS / payments (`CashTenderCalculator`) | Partly | Gym products (gloves, lockers), `useDemo` | M–L |
| Staff management / attendance | Mostly | 1.4k-line component, demo store | L |
| Alerts | Partly | Demo + live mixed, rental-specific | M |
| Members, plans, Gimi | Gym-specific | — | keep in app |
| `demo/` | No | Fake backend | retire or move to `test/fixtures` |
