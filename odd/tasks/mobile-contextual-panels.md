# Mobile Contextual Panels and Compact Catalog

## Objective
Make EvoGym's existing desktop split-view workflows comfortable on mobile, preserving each section's current behavior while reducing header/navigation height and excess catalog scrolling.

## Problem and why
At phone widths the current sidebar occupies a full-width block above the page, and square product cards with a 180px minimum width collapse into an oversized single column. Users need the selection workspace first, with contextual details available without scrolling to a second column.

## Scope and constraints
- Mobile/tablet responsive UX only; preserve desktop split-view layout and business logic.
- Header is limited to the EvoGym logo, global search, and profile. The logo also exposes the navigation drawer.
- Swipe right opens the left navigation drawer; swipe left opens the current section's existing contextual detail panel.
- Keep visible tap controls as alternatives to gestures. Preserve vertical scrolling, text entry, horizontal scrollers, browser/OS navigation and assistive-technology gestures.
- Product/reception catalog uses two compact cards per row with essential information and usable touch controls.
- Preserve selections, payment drafts, inventory preview semantics and catalog scroll position when drawers open and close. Never treat inventory receiving preview as a checkout cart.
- Chat remains a floating bottom-right widget and must not cover important drawer actions.
- No dependencies or remote services; no changes to PWA install behavior.

## Accepted design rationale
- Borrow two-column mobile product-grid and overlay-drawer patterns from Shopify Dawn; borrow stock-visible actionable tiles from Square POS without implying its native app layout applies to web; follow Fluent web drawer separation of header, scrollable content and actions.
- Gestures enhance rather than replace controls. The W3C pointer-gesture guidance requires an alternative simple pointer operation.

## Tasks and progress
- [x] M01 — Replace the stacked mobile sidebar with a compact header and accessible left navigation drawer; add directional gesture recognition with tap alternatives and conflict exclusions.
  - Route: delegated direct (shared shell and interaction tests span multiple files).
  - Acceptance: search/logo/profile fit without a navigation block above content; menu opens by right-swipe and tap; desktop navigation behavior remains unchanged; vertical scroll and text entry continue working.
  - Checks: focused App tests; mobile viewport/touch verification if browser harness is available.
  - Evidence: commits `bace71e`, `610de55`, `640c6a7`; corrective work units add modal focus containment, inert background, focus restoration on Escape/backdrop/close/navigation, desktop breakpoint reset with focus moved to `#main-content`, cancellation-safe single-touch swipe tracking and reduced-motion drawer handling. `npm --prefix frontend run test -- src/app/App.test.tsx` passed (21 tests); `npm --prefix frontend run typecheck` passed. Independent verification found no remaining findings after the last correction. Assessment outcome: unavailable/unassessable high because Git review-index access was denied. The desktop fallback is asserted in jsdom; computed CSS visibility and real-device/browser touch behavior remain unverified.
- [x] M02 — Move existing section-specific right-hand detail content into a mobile contextual drawer, preserving existing state and section semantics.
  - Route: delegated direct (multiple feature consumers and integration tests).
  - Acceptance: left-swipe and visible trigger open details; only one drawer is open; close restores catalog context; transaction is neither submitted nor cleared; inventory preview stays non-transactional.
  - Checks: focused Reception, Inventory and App tests; typecheck.
  - Evidence: commit `7875f92` adds a shared modal drawer for the reception purchase, reception inventory preview, and new-member summary. Each feature retains ownership of its selection/draft state; closing leaves the existing content mounted, and inventory still shows unavailable costs/totals with disabled receipt actions. Touch recognition is single-pointer, horizontal, and avoids controls, text selection, horizontal scrollers and the system edge zone. `npm --prefix frontend run test -- src/app/App.test.tsx src/features/reception/ReceptionHome.test.tsx src/features/inventory/Inventory.test.tsx src/features/members/Members.test.tsx src/shared/MobileDetailPanel.test.tsx` passed (59 tests); `npm --prefix frontend run typecheck` passed. No browser or real-device responsive/touch proof was run.
  - Escape correction: an open `role="combobox"` with `aria-expanded="true"` now owns Escape before the enclosing detail dialog; the regression test proves the first Escape dismisses suggestions and the second closes the drawer. Test-first RED: `npm --prefix frontend run test -- src/features/reception/ReceptionHome.test.tsx -t "dismisses member suggestions before closing"` failed because first Escape closed the dialog. GREEN: that focused command passed (1 test); `npm --prefix frontend run test -- src/features/reception/ReceptionHome.test.tsx` passed (13 tests); `npm --prefix frontend run typecheck` passed. Runtime browser/device harness: N/A (none available); jsdom does not verify real browser keyboard/touch behavior. Correction commit: `db88d45` (`fix(mobile): defer Escape to open combobox`).
- [x] M03 — Compact product cards into two columns and verify mobile content density, touch targets and chat/drawer coexistence.
  - Route: delegated direct (shared catalog card, CSS and tests).
  - Acceptance: two cards fit at 320px without horizontal page overflow; names/prices/stock/action remain readable and usable; desktop card layout remains intact.
  - Checks: focused card/Inventory tests; typecheck and production build; browser checks at 320/360/390/430px where available.
  - Evidence: `frontend/src/features/reception/ProductCard.css` now applies a two-column, minmax-safe grid at mobile widths, compact cards with wrapped name/price content, 44px quantity controls, and safe-area-aware trailing grid space so the floating chat can be scrolled clear. Desktop selectors/layout are unchanged. Test-first exception: this is CSS-only responsive layout; the available jsdom tests do not calculate media-query layout, so no meaningful RED test exists. The focused tests passed before and after styling: `npm --prefix frontend run test -- src/features/reception/ProductCard.test.tsx src/features/inventory/Inventory.test.tsx` passed (8 tests); `npm --prefix frontend run typecheck` passed; `npm --prefix frontend run build` passed (Vite/PWA generation succeeded; existing chunk-size warning remains). Browser/device viewport checks at 320/360/390/430px: not performed; CUA reported no browsers or apps available. M03 commit: `c857711` (`feat(mobile): compact catalog into two-column cards`).

## Forecast and delivery
- Forecast: approximately 600 authored changed lines (additions plus deletions; generated files excluded), across one coherent mobile UX feature.
- Delivery strategy: feature-branch chain, selected by the user. This records PR stacking preference only; no push or PR creation is authorized.
- M01 commit identities: `bace71e`, `610de55`, `640c6a7` (all on `feat/mobile-contextual-panels`). Review assessment after each was due but unassessable/high because access to the Git review index was denied; M01 received independent verification, which found no outstanding findings after the final bounded correction.
- M02 commit identity: `7875f92` (`feat(mobile): add contextual detail drawers`); assessment remains unassessable/high due denied Git review-index access; no review lifecycle commands were run. M03 commit identity: `c857711` (`feat(mobile): compact catalog into two-column cards`); check outcomes are recorded above.

## Verification
- Test-first where applicable: observe a focused test failure before implementing each behavior, then green and refactor checks.
- RDD mode observed: off (clone-local status). No native review transaction will be started while off.
- Initial review assessment was unassessable/high because access to the Git review index was denied; preserve this result. Reassess commit boundaries and require independent verification for any still-unassessable high tier.
- Runtime/browser gesture proof is pending; DOM unit tests alone do not verify real touch arbitration.

## Next step
Parent to assess and spot-check M03's compact catalog work; mobile viewport and device proof remains unavailable.

## Relevant files
- `frontend/src/app/App.tsx` — application shell, navigation and global header.
- `frontend/src/styles.css` — mobile breakpoints and product card geometry.
- `frontend/src/features/reception/ProductCard.tsx` — shared catalog item card.
