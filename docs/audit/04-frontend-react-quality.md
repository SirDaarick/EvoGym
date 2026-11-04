# 04 — Frontend: React quality and performance

Scope: `frontend/src` (React 19 + TypeScript + Vite PWA). Guides: `vercel-react-best-practices`, `ponytail-review`.
Assumed load: one branch, a few receptionists on one tablet/PC, plus the owner. At this load, correctness and maintainability matter more than raw speed.
Method: static reading and counts. No typecheck, lint, build or test run was part of this audit.

## Summary

The codebase has good foundations: lazy routes with error boundaries, integer-centavo money, idempotency keys on writes, behavior-focused tests. The main problems are:

1. Business dates are computed in UTC, which is wrong in the evening in Mexico City.
2. There is no shared data-fetching layer: copy-pasted `request()` helpers, no cancellation, no cache.
3. Very large reception/owner components mix data loading, state and UI.
4. Two parallel worlds (demo/localStorage and live API) branch inside screens.

## Must fix

### R1. "Today" is the UTC date, not the gym's business date

- **Where:** 12 uses of `new Date().toISOString().slice(0, 10)` in 6 files (verified):
  - `features/reception/StaffAttendanceView.tsx` (4)
  - `features/owner/StaffManagement.tsx` (3)
  - `features/attendance/AttendanceCalendar.tsx` (2)
  - `features/owner/finance/FinanceCharts.tsx` (1)
  - `demo/financeReportSelector.ts` (1)
  - `demo/ownerOperations.ts` (1)
- **Problem:** After 18:00 in America/Mexico_City, the UTC date is already tomorrow. During the evening shift, `fetchLiveAttendance` asks for `business_date=<tomorrow>`, so attendance and corrections come back empty or wrong.
- **Fix:** A timezone-aware formatter already exists in `demo/attendanceOperations.ts:6-7` (`en-CA` + `timeZone: 'America/Mexico_City'`). Move it to `shared/` as `businessDate(now, timeZone)` and replace all 12 call sites. Pass the timezone in instead of hardcoding it, so each branch can have its own.
- **Reuse impact:** A business-date helper is generic. It belongs in the reusable core.

### R2. Secondary loads swallow errors; no request cancellation

- **Where:** `features/reception/StaffAttendanceView.tsx:139-211`.
- **Problem:**
  - Corrections and schedule loads sit inside `catch { /* ignore */ }`. If they fail, the screen looks healthy but shows empty data.
  - The online and offline paths are copy-pasted. One uses `liveRequest`, the other a raw `fetch`.
  - There are zero `AbortController` uses in `src`. If the user changes branch while a request is in flight, the stale response can still write state.
- **Fix:** Keep one request path and surface secondary failures in `liveError`. Add an `active` flag (or abort) in the effect. Run the three loads with `Promise.all` instead of three awaits in a row.

## Should fix

### R3. No shared HTTP client; every screen refetches

- **Where:** at least 6 near-identical clients:
  - `api/receptionApi.ts:71`
  - `api/membershipCheckoutApi.ts:123`
  - `api/pendingMoneyApi.ts:87`
  - `api/memberReadsApi.ts:121`
  - `api/inventoryApi.ts:96`
  - `api/adminAuthApi.ts`
- **Problem:** There are 157 `useEffect`s with no dedup, cache or retry. Opening and closing a modal refetches branches and registers.
- **Fix, step by step:**
  1. Extract one `createApiClient({ baseUrl, getToken })` with a shared `parseError` and idempotency support.
  2. Adopt TanStack Query for server state. This is the main reuse lever: it gives cache, dedup, retry and cancellation for free, and `@tanstack/*` packages are already in the project.
  3. Write shared hooks for shared loaders (`useBranches`, `useCashRegisters`).
- **Reuse impact:** HIGH. A typed API client plus query hooks is the base every future app needs.

### R4. Giant components with many states and effects

| Lines | File |
|---|---|
| 1439 | `features/owner/StaffManagement.tsx` |
| 1357 | `features/reception/CasillerosModal.tsx` |
| 1175 | `features/reception/StaffAttendanceView.tsx` |
| 1175 | `features/reception/ReceptionHome.tsx` |
| 1133 | `features/owner/InventoryAnalytics.tsx` |
| 1108 | `features/members/MemberDetail.tsx` |

- **Problem:** `CasillerosModal.tsx:107-148` has about 20 `useState`. Every keystroke in the member search re-renders the whole 1.3k-line tree.
- **Fix:** Split by job, not by line count:
  - a `MemberSearchBox` combobox, shared with `GuantesModal`;
  - a `PaymentBreakdownForm`, also duplicated between `CasillerosModal.tsx:404-418` and `GuantesModal.tsx:340-355`;
  - a container hook (`useLockerRental`) that holds the data and mutations, leaving the modal presentational.

### R5. Modals are always mounted while closed

- **Where:** `app/ApiReceptionHome.tsx:377-399`, `features/reception/ReceptionHome.tsx:1175-1200`. `DevolucionesModal`, `GuantesModal` and `CasillerosModal` render and then `return null`.
- **Problem:** While closed, they keep running a `MutationObserver` on `documentElement` (`CasillerosModal.tsx:204-216`), a document `pointerdown` listener and about 20 states. About 3,000 lines also stay in the Reception chunk.
- **Fix:** `{open && <CasillerosModal/>}`, combined with `lazy()`.

### R6. `DemoProvider` context value is rebuilt every render

- **Where:** `demo/DemoProvider.tsx:214-234`.
- **Problem:** The `value` object and its closures are new on every render, and `useDemo` has 70 callers. Any provider `setState` re-renders every consumer.
- **Fix:** `useMemo` the value and `useCallback` the actions. Only do this if demo mode stays (see [06-reuse-roadmap.md](06-reuse-roadmap.md), decision D1).

### R7. Every transaction serializes the whole state twice

- **Where:** `demo/shiftPersistence.ts:109-111`. It does stringify, then parse to validate, then `setItem`, all synchronously on the main thread.
- **Fix:** Validate the object before stringifying, and debounce non-critical writes such as drafts. There is a `version: 1` schema but no migration path; add one if this persistence stays.

### R8. Duplicate fetch on reception load and a stale header clock

- **Duplicate fetch:** `app/ApiReceptionHome.tsx:82-94`. The effect depends on `registerId` but also sets it, so branches and registers load twice. Fix: remove `registerId` from the deps and use `setRegisterId(cur => cur ?? picked)`.
- **Stale clock:** `app/App.tsx:219` formats `new Date()` inline, so the time only updates when `App` happens to re-render. Login, `StaffProfileSelection` and `ProfileEntryLayout` each have their own `setInterval` clock. Extract one `useClock(intervalMs)` into `shared/`.

### R9. Unsafe types in the payment modals

- **Where:**
  - 22 `any` in total: `CasillerosModal` 10, `GuantesModal` 7, `GimiChatWidget` 4, `StaffAttendanceView` 1.
  - `breakdown.method as any` in `CasillerosModal.tsx:410-417` and `GuantesModal.tsx:347-354`.
  - 38 non-null `!` in non-test code.
- **Fix:**
  - Use the `PaymentMethod` type instead of `as any`.
  - Use `catch (err: unknown)` with an `instanceof` check.
  - Add the ESLint rule `@typescript-eslint/no-explicit-any` as an error.

### R10. Domain types and API DTOs are duplicated

- **Examples:**
  - `Member` (`domain/models.ts:4`) vs `MemberProfile` (`api/memberReadsApi.ts:17`)
  - `Plan` (`demo/plans.ts:4`) vs `ActiveMembershipPlan` in the checkout API
- **Fix:** Keep DTOs in `api/`, add explicit mappers to domain types, and keep `domain/` free of transport shapes. Generating DTOs from the FastAPI OpenAPI schema (`openapi-typescript`) removes the hand-written duplicates entirely.

## Nice to have

- **Bundle:**
  - `App.tsx` eagerly imports `ShiftOpenModal` (791 lines), `ShiftCloseDialog` (647 lines) and `GimiChatWidget`, even though they only mount on demand. `lazy()` them.
  - Run `npx vite-bundle-visualizer` once. The previous audit recorded a 524.79 kB entry chunk.
- **PWA:**
  - `vite.config.ts` has no `workbox.navigateFallbackDenylist` for `/api`, so navigations to `/api` or `/docs` can be answered with `index.html`.
  - The manifest strings are mojibake (`GestiÃ³n`). Re-save the file as UTF-8.
  - `orientation: 'portrait'` can lock reception tablets that are used in landscape.
- **Gimi chat:** `GimiChatWidget.tsx:179-191` has a `setTimeout` that closes over a stale `state`. `gimiStore.ts:312` parses `sessionStorage` on every query.
- **App shell:**
  - `App.tsx:88-92` runs three full `ledger`/`extras`/`expenses` filters on every render. Wrap them in `useMemo`.
  - `useOptionalProductAccess` (`App.tsx:46-60`) detects a missing provider with try/catch. Use `useContext` returning null instead, as `AdminSessionProvider.tsx:195` does.
- **Hygiene:** 13 `console.*` in non-test code; 7 `key={index}` (check whether those lists are static).

## What to keep

- 25 lazy routes wrapped in `RouteBoundary` + `Suspense`.
- `ProductAccessProvider` and `AdminSessionProvider` memoize their context values.
- Debounced searches with `active` flags and cleanup.
- Persistence with a schema version, a `navigator.locks` writer lock and corrupt-data recovery.
- Whitelisted error messages and `Idempotency-Key` on writes.
- Tests:
  - 107 files and about 792 tests.
  - Queries are mostly by role: about 1,523 `*ByRole` against 129 `ByTestId`.
  - Almost no fake timers.
  - 0 `@ts-ignore`.

## Metrics (non-test code)

| Metric | Value |
|---|---|
| Source / test files | 156 / 107 |
| `useEffect` / `useState` | 157 / 767 |
| `useMemo` / `useCallback` / `memo(` | 88 / 45 / 0 |
| `lazy(` | 25 |
| `any` / non-null `!` | 22 / 38 |
| `AbortController` | 0 |
| `localStorage`/`sessionStorage` refs | 62 in 12 files |
