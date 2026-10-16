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
  - Evidence: `npm --prefix frontend run test -- src/app/App.test.tsx` passed (19 tests); `npm --prefix frontend run typecheck` passed. Added tap-open/close coverage; swipe arbitration is implemented in the shared shell. No real-device/browser touch verification was available, so gesture behavior remains unverified outside DOM logic.
- [ ] M02 — Move existing section-specific right-hand detail content into a mobile contextual drawer, preserving existing state and section semantics.
  - Route: delegated direct (multiple feature consumers and integration tests).
  - Acceptance: left-swipe and visible trigger open details; only one drawer is open; close restores catalog context; transaction is neither submitted nor cleared; inventory preview stays non-transactional.
  - Checks: focused Reception, Inventory and App tests; typecheck.
- [ ] M03 — Compact product cards into two columns and verify mobile content density, touch targets and chat/drawer coexistence.
  - Route: delegated direct (shared catalog card, CSS and tests).
  - Acceptance: two cards fit at 320px without horizontal page overflow; names/prices/stock/action remain readable and usable; desktop card layout remains intact.
  - Checks: focused card/Inventory tests; typecheck and production build; browser checks at 320/360/390/430px where available.

## Forecast and delivery
- Forecast: approximately 350 authored changed lines (additions plus deletions; generated files excluded), across one coherent mobile UX feature.
- Delivery strategy: ask-on-risk; no chain strategy selected because forecast is below the current ~400-line threshold.
- Work-unit commit identities and review assessment outcomes: pending.

## Verification
- Test-first where applicable: observe a focused test failure before implementing each behavior, then green and refactor checks.
- RDD mode observed: off (clone-local status). No native review transaction will be started while off.
- Initial review assessment was unassessable/high because access to the Git review index was denied; preserve this result. Reassess commit boundaries and require independent verification for any still-unassessable high tier.
- Runtime/browser gesture proof is pending; DOM unit tests alone do not verify real touch arbitration.

## Next step
Implement M02 in its own work unit, preserving existing contextual panel state and transaction semantics.

## Relevant files
- `frontend/src/app/App.tsx` — application shell, navigation and global header.
- `frontend/src/styles.css` — mobile breakpoints and product card geometry.
- `frontend/src/features/reception/ProductCard.tsx` — shared catalog item card.
