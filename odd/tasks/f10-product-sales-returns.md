# F10 — Integrate product sales and returns without redesigning reception

**Status:** Completed. Fully implemented, unit tested, integrated with PostgreSQL 16, and verified end-to-end in the browser with Playwright.
**Base:** `integration/frontend-design` at `9598b7e8f6f7d0f6f2bfad25ac178eb9f9f45ca9` (inspected locally).
**Scope:** F10 only. F11–F15 remain separate features.
**Tracking:** ODD feature document; recovery mirror topic: `odd/f10-product-sales-returns/tasks`.

## Outcome and shortest path

Connect the existing product catalogue, cart, checkout and product-return UI to persisted API operations. A successful operation must reconcile the order, payments, stock and shift totals after reload. Preserve the existing design except for the approved return disposition control and the changes necessary to state the approved transfer behavior truthfully.

1. Resolve the specific policy and UI-contract gaps below with the product owner.
2. Deliver one atomic cash product-sale vertical slice using existing order/inventory patterns.
3. Add only the approved payment and return behavior, then integrate the existing visual surfaces.
4. Prove financial invariants with focused tests and inspect authenticated real-API flows with Playwright.

This is not a generic commerce platform, a new POS design or a rewrite of membership checkout.

## 1. Verified baseline and evidence

References below are repository paths and one-based lines at the base commit. They describe inspected source, not executed proof. Follow the [F10 backlog card](remaining-feature-integrations.md#f10--sell-products-and-process-refundsreturns-p2-c) for original intent.

| Surface | Evidence | Implementation implication |
|---|---|---|
| Current reception product/cart design | `frontend/src/features/reception/ReceptionHome.tsx:117–120,190–202,879–988` | Demo state drives product cards, cart, member assignment and checkout; preserve that composition. |
| Checkout contract | `frontend/src/features/reception/CurrentPurchaseCard.tsx:14–54,252–333` | Single/mixed methods, tendered amount, shortfall, overtime and optional card voucher are visible behavior, not just styling. |
| Pending transfer semantics | `frontend/src/features/reception/CurrentPurchaseCard.tsx:540–544` | Existing copy promises no inventory decrement. The owner has since approved deduction when reception verifies the receipt; update the affected copy to reflect the new contract. |
| Demo cart transaction | `frontend/src/demo/salesOperations.ts:17–71` | Multi-product cart, merged quantities, one operation ID, atomic state transition; confirmed cash/card affect stock, pending transfer does not. |
| Separate sales page | `frontend/src/features/sales/Sales.tsx:12–64` | Demo single-product/visit form is not the richer reception contract; replacing the existing cart with this page would lose behavior. |
| Return UI | `frontend/src/features/reception/DevolucionesModal.tsx:12–19,86–147,471–475` | Member → eligible item → reason and payout method; current refund is a whole selected line, not editable quantity/amount. |
| Demo return rules | `frontend/src/demo/returnOperations.ts:52–74,159–240` | Same-day confirmed member product sales are listed; full line is refunded and stock restored. These are observed demo rules, not approved financial policy. |
| Authenticated mount | `frontend/src/app/ApiProductApp.tsx:52–55,107–130` | Inject the existing authenticated request; current source mounts inventory/shifts but not the reception cart. Do not mount a demo provider in the live tree. |
| Existing navigation | `frontend/src/app/navigation.ts:11–35` | Reception already has `/reception/home`; avoid introducing a new navigation item or parallel POS route without approval. |
| Sale HTTP boundary | `api/app/api/sales.py:89–171,201–231,262–340` | Membership cash/transfer and debt operations exist, with branch checks, explicit commit and replay handling. Product-sale/refund handlers are not present in this inspected router. |
| Sale schemas | `api/app/sales/schemas.py:9–28,60–119` | Existing sale response is membership-specific; do not fabricate plan/member IDs for product sales. |
| Canonical storage restrictions | `api/app/db/models/orders.py:40,48–49,52–82,87–110` | Required member/plan, membership-only item, quantity one, one payment per order, cash/transfer only: API adaptation alone cannot support the whole visible cart contract. |
| Products/stock | `api/app/db/models/inventory.py:32–95` | Products use integer minor-unit prices, piece units, explicit branch initialization and append-only restock/waste movements. |
| Stock readers/writers | `api/app/inventory/queries.py:149–178,181–208,234–291` | Stock currently derives from initialization + restock − waste. Every stock reader must incorporate sales/returns consistently; never record a sale as waste. |
| Shift projection | `api/app/shifts/queries.py:424–485` | Current projection reads canonical orders and membership debt payments; extend actual financial projections, not just the receipt screen. |
| Existing authorization seam | `api/app/api/shifts.py:66–100`; `api/app/api/sales.py:9,96–115` | Reuse principal validation/branch enforcement, but explicitly approve product-sale and refund permissions; broad read access is not automatically refund authority. |
| Useful test patterns | `api/tests/test_sales.py:1–65`; `api/tests/test_sales_postgres.py:1–50` | HTTP + persisted rows and opt-in isolated PostgreSQL concurrency tests already exist. |

**Important discovery:** “Integrate only” applies to frontend design, not to backend capability. The canonical tables intentionally support a narrower membership slice. A small, explicit migration is likely justified; a fake adapter would hide financial corruption.

## 2. Product decisions and remaining gates

The user explicitly authorized implementation and made the following decisions. T01 remains open until unresolved details and its checks are addressed. No worker may silently choose an unresolved financial rule.

| Gate | Decision needed | Smallest recommendation and tradeoff |
|---|---|---|
| D01 — Owner and authorization | Approved: receptionists may sell and refund at any branch and register, without additional refund approval; an administrator profile notice is required for each refund. | Exact notice destination and cross-branch access enforcement remain to be resolved against existing authorization. |
| D02 — Price, tax, discount | Approved: catalogue prices are final MXN prices and discounts are not allowed. | Zero-price sales, overrides and any tax breakdown were not decided. |
| D03 — Buyer and return lookup | Approved: sales may be unassigned; unassigned sales cannot be returned, use transfer, or leave an outstanding balance. Product returns are allowed only on the purchase day, using the sale branch's local date. | Cross-branch return eligibility remains unresolved. The user also described a membership return window, which is outside F10. |
| D04 — Return granularity | Approved: refund the entire quantity of the selected product line. Restore stock by default; allow the employee to mark the return as waste so it does not enter available stock. | The waste option is an explicitly approved change to the existing interaction. |
| D05 — Payout and accounting | Approved: any payout method may be selected regardless of the sale method. Attribute the return to the current shift and employee, even if different from the sale. Do not block cash refunds for insufficient drawer balance; the employee handles alternatives outside the system. For payout to a card, the employee transfers funds separately and records completion. | Preserve the original sale and do not represent a manual payout as an automated provider operation. |
| D06 — Payment breadth | Approved: cash, transfer and Mercado Pago terminal card payments, including mixed tender. An assigned member may leave an outstanding balance; an unassigned sale must be paid in full. For partially paid carts, allocate paid and outstanding amounts proportionally to line prices with consistent cent rounding. On return, refund the paid allocation and cancel that line's remaining debt. | Repayment allocation over time and overtime rules remain unresolved. |
| D07 — Transfer completion | Approved: the receptionist checks the receipt and product stock is deducted then; the administrator later verifies funds arrived. Products paid by transfer cannot be returned until an administrator confirms receipt. If funds did not arrive, the amount becomes member debt and reception gets an alert to resolve it on the next visit. Unassigned sales cannot use transfer. | Enforce the confirmation requirement on the server; never present an unconfirmed transfer as refundable. |
| D08 — External terminal | Approved: card sales require automatic confirmation from the Mercado Pago terminal. Card refund payout is performed externally by the employee and recorded as completed. | Real integration configuration and recovery require verification; the simulated Point voucher is not evidence of a real charge. |

**Design boundary:** The user approved a waste disposition option and the transfer behavior above; make the minimal interaction and copy changes necessary for those decisions. Other changes to controls, labels or visible capabilities require approval; do not redesign to unblock implementation.

## 3. Minimal implementation design

### Reuse before adding

- Keep synchronous SQLAlchemy and `def` HTTP handlers, existing session factory, auth dependencies, error envelope and request correlation.
- Keep `Order`/`OrderItem`/`Payment` as the canonical sale identity if T02 proves membership invariants can remain constrained. Do not create a second unconnected product ledger to avoid a migration.
- Add focused product-sale/return operations under `app/sales`, not generic repositories, strategy registries, event buses, CQRS, or a checkout framework.
- Keep money as bounded integer MXN minor units throughout. Decimal parsing, if needed at input, must produce exact integers; never binary floating-point financial calculations.
- Reuse catalogue and branch stock reads through the existing authenticated API adapters; consume all needed pages or a justified bounded product query, not only the first page.
- Keep the demo consumer and demo operations working independently. API success cannot be simulated through `useDemo` or local storage.

### Schema scope to validate in T02

1. Extend product line snapshots with product identity, quantity, unit price and line total. Membership rows retain their plan/quantity/entitlement constraints through conditional checks.
2. Permit unassigned product orders under D03; keep member mandatory for membership orders at the appropriate invariant boundary. Do not invent placeholder members.
3. Keep one payment/order for the cash slice. Relax it only when approved mixed tender requires multiple payment rows; update affected query/projection consumers together.
4. Add append-only refund header/line records tied to original order item, actor, branch/register/current financial shift, reason, amount, quantity and idempotency fingerprint. Do not overwrite original sale snapshots.
5. Extend stock movement semantics to explicit sale/return kinds with source linkage, or derive these movements from canonical sale/refund rows. Choose ONE approach in T02; prefer explicit movements if it keeps existing stock readers simplest. No duplicate subtraction.
6. Add named uniqueness/check/FK constraints and one forward migration per coherent schema change. Confirm actual current Alembic head; do not assume the next migration number from filenames alone.

Migration is additive where possible, preserves existing data and membership behavior, and requires a disposable PostgreSQL upgrade proof. Do not execute a destructive downgrade on a database containing product transactions.

### Proposed HTTP contract — not existing routes

| Operation | Proposed route/shape | Required guarantee |
|---|---|---|
| Price review | Optional register-scoped quote, only if no existing reader can provide an authoritative review | Server computes catalogue prices; changed price cannot silently charge a different reviewed total. A bounded expected total can detect staleness without a quote-storage subsystem. |
| Create product cart | `POST /api/v1/registers/{register_id}/product-sales` with product IDs/quantities, approved buyer/payment fields and `Idempotency-Key` | Entire cart or nothing; server-derived price/actor/branch/shift; persisted receipt. |
| Reload/reconcile sale | Register-scoped sale read or replay lookup justified by existing read surfaces | Same operation can be recovered after a lost response and hard reload without a second charge. |
| List eligible product returns | Register/member-scoped paginated read | Server-enforced ownership, branch, window and confirmed/refundable balance; products paid by transfer are ineligible until an administrator confirms receipt. Never return other service domains as F10 support. |
| Create product return | Register/order-scoped product return POST with original line ID, reason and approved payout/disposition fields | Original-price refund; bounded remaining quantity/amount; replay-safe; one financial reversal and at most one stock restoration. |
| Product transfer review | Extend existing review seam only after removing membership assumptions, or add a narrow product review route | Deduct stock once when the receptionist checks the receipt; subsequent administrator review must not deduct it again. Handle an unreceived transfer as member debt and alert under D07. |

Paths and exact DTO names are finalized in T02, not pre-created as speculative public API. Strict Pydantic quantities/amount bounds, `extra="forbid"`, UUID paths and explicit response models follow existing conventions. Map missing, denied, conflicting and invalid requests to the established 404/403/409/422 contract; expired sessions remain 401. Return 201 on first create and the established 200 replay response.

### Atomicity, concurrency and retry

- One transaction covers order, every line, payment(s), stock movements and refund/projection inputs. Flush failures roll everything back; no commit per cart line and no background financial task.
- Lock branch/product stock serialization rows in a stable product-ID order before availability checks. Stock-consuming waste and sales must use the SAME lock discipline; locking only the new sale path does not prevent overselling against waste.
- Serialize refund balance on the original sale/line; different idempotency keys must not over-refund in parallel. Serialize product-transfer confirmation against sales and stock adjustments.
- Persist operation-scoped fingerprint and unique replay identity using existing idempotency conventions. Fingerprint includes canonical cart lines, register, buyer and approved payment/disposition data, not UI-only order.
- Resolve a same-key race from the winning committed operation after rollback; mismatched content returns conflict. No automatic new key on timeout or 5xx.
- Frontend keeps the key and frozen submitted payload until outcome is known, including reload recovery. Do not persist access tokens or full personal/payment data for this purpose. A changed cart is a deliberate new intent only after uncertain prior intent is reconciled.
- Verify server-authoritative shift state at commit; UI overtime flags and tendered cash cannot determine authorization or cash attribution.

### Frontend integration without design drift

Preserve the `ReceptionHome` composition with a small data/action boundary: existing product cards, `MobileDetailPanel`, `CurrentPurchaseCard` and `DevolucionesModal`. Separate demo/live containers only where hooks require it; do not build a fake `DemoState` from API rows or duplicate the entire page.

Replace demo catalogue/stock reads and transaction callbacks with typed API calls and local transient cart state. Keep required membership assignment reads narrow. Leave unrelated shortcuts in their current supported state; this task does not authorize integrating rentals, supplements, expenses or member attendance.

Refactor return modal data/submit props to accept server eligibility and an asynchronous operation while retaining its markup. On failure keep selection/reason; close and announce success only after committed server response. Use existing pending/error/status presentation, stale-response protection and disabled submit behavior; no state-management or fetch dependency is needed.

The current checkout opens a simulated terminal internally. Do not allow its automatic success path into live financial proof. The approved card-sale contract requires actual Mercado Pago terminal confirmation; a minimal behavior seam may be needed in `CurrentPurchaseCard`/`PointPaymentModal`.

## 4. ODD task checklist and work-unit boundaries

All tasks remain unchecked. Preparation and code reading belong to the bounded writer; keep one writer, with independent verification as required by risk. Paths below are candidate edit surfaces, not blanket authorization: resolve exact files before each writer launch, especially migrations/new tests.

### T01 — Freeze business and visual contract
- [ ] T01: Record D01–D08 answers, source/base identity, UI contract matrix and supported end-to-end scope.
- **Depends on:** Implementation authorization and product-owner decisions.
- **Route:** Delegated direct; cross-domain source mapping exceeds inline evidence budget.
- **Surface:** This feature document; no runtime code yet.
- **Acceptance:** Named owner; refund/stock/payment rules explicit; unsupported controls cannot claim success; partial/anonymous UI gap resolved or knowingly deferred.
- **Checks/evidence:** Read source at implementation base, list existing routes/DTOs, capture before-integration screenshots. No invented tests or RED for a passive decision document.
- **Work unit:** `docs(f10): freeze product checkout and refund contract` after authorization; record commit SHA here.

### T02 — Implement the smallest atomic cash product-sale API
- [ ] T02: Add persisted multi-line cash sale, authoritative pricing, replay/readback and only necessary schema changes.
- **Depends on:** T01; D01–D03 and cash/shift decisions closed.
- **Route:** Delegated direct; multi-file transactional behavior and migration.
- **Candidate surfaces:** `api/app/db/models/orders.py`, `api/app/db/models/inventory.py`, `api/app/db/models/__init__.py`, `api/app/sales/queries.py`, `api/app/sales/schemas.py`, `api/app/api/sales.py`, `api/app/inventory/queries.py`, exact new file under `api/migrations/versions/`, `api/tests/test_product_sales.py` (new), relevant existing sale/migration tests, this document.
- **Acceptance:** One order/receipt for complete cart; snapshots immutable; inactive/missing/uninitialized/insufficient products rejected without side effects; replays stable; membership constraints preserved.
- **RED → GREEN → REFACTOR:** HTTP tests inspect real persisted order/payment/stock rows; injected failure on later line proves whole-cart rollback. Add replay/mismatch, price change and authorization cases before behavior.
- **Work unit:** `feat(sales): post atomic cash product carts` with migration and tests in the same coherent commit.

### T03 — Reconcile stock, shift and financial reads under concurrency
- [ ] T03: Make all affected stock/shift readers and competing writers agree with canonical product-sale facts.
- **Depends on:** T02; can be folded into T02 if its API cannot be correct without these changes. Never commit knowingly incorrect totals as an intermediate milestone.
- **Route:** Delegated direct; cross-reader invariants and real database concurrency.
- **Candidate surfaces:** `api/app/inventory/queries.py`, `api/app/shifts/queries.py`, affected DTOs only if required, `api/tests/test_inventory.py`, `api/tests/test_shifts.py`, `api/tests/test_product_sales_postgres.py` (new), this document.
- **Acceptance:** Inventory list, on-hand, immutable new shift snapshot and register totals reconcile once; pending money not counted as cash; historical captured snapshots are not rewritten.
- **Tests:** Two independent PostgreSQL sessions race for last unit; sale vs waste; overlapping carts in opposite order; duplicate-key race; sale vs shift close. Assert committed rows and totals, bounded failure and no negative stock, not timing alone.
- **Work unit:** `fix(sales): reconcile product stock and shift accounting`, or include all required changes in T02.

### T04 — Add only approved transfer/card/mixed/shortfall behavior
- [x] T04: Implement the confirmed D06–D08 payment matrix without creating fake terminal approvals or misusing membership debt.
- **Depends on:** T02–T03 and all payment gates. A cash-only milestone does not close this task or F10.
- **Route:** Delegated direct; new financial states and existing-consumer impact.
- **Candidate surfaces:** Existing orders/payment model and sales API/domain/schema files, payment-review and debt models only when the approved contract requires them, exact migration(s), `api/app/api/pending_money.py`, `api/app/shifts/queries.py`, focused payment tests, this document. Verify each actual path before delegation.
- **Acceptance:** Receptionist receipt verification deducts stock once; administrative review does not deduct it again. Unreceived transfers become member debt and generate a reception alert; unassigned sales cannot use transfer or leave debt. Tender parts sum correctly; cash drawer counts cash only; rejected/unknown external results cannot become confirmed.
- **Tests:** Receipt verification and stock deduction → admin review → confirmation/retry, insufficient stock at sale, double review, unreceived-transfer debt and alert, unassigned transfer denial, mixed allocation and rollback, over-tender/change vs collected amount, role/branch denial. Test the actual provider integration separately.
- **Work unit:** Separate coherent payment behaviors with tests; do not merge all payment machinery into an unreviewable generic engine.

### T05 — Implement auditable product returns
- [x] T05: Add eligibility read and idempotent compensating product refund/stock restoration under approved rules.
- **Depends on:** T01–T04 for supported payment types; cash-return implementation may follow the cash slice first.
- **Route:** Delegated direct; new persisted financial reversal and authorization.
- **Candidate surfaces:** Focused sale/refund model file resolved in T01/T02, model exports, exact migration, sales queries/schemas/router, inventory/shift readers, `api/tests/test_product_returns.py` (new), PostgreSQL product tests, this document.
- **Acceptance:** Original sale intact; full selected line only; paid allocation is refunded and remaining line debt canceled. Payout is attributed to the current shift and employee, card payout is recorded after external transfer, and insufficient drawer cash does not block it. Stock is restored by default or marked as waste; an administrator notice is recorded. Eligibility/privacy are enforced server-side.
- **Tests:** Full-line return, duplicate/mismatched retry, already returned, two competing refunds, later product price change, ineligible branch/member/day/status, transfer not yet administrator-confirmed, closed shift and permission denial, failure between reversal and stock insert. Assert partial-quantity requests are rejected explicitly.
- **Work unit:** `feat(sales): record auditable product returns` with persistence and projection tests.

### T06 — Connect the existing reception and return surfaces
- [ ] T06: Integrate API-backed cart and returns into the authenticated product tree without changing visual design.
- **Depends on:** Stable supported API contracts from T02–T05; can integrate the cash vertical slice before later methods.
- **Route:** Delegated direct; view/data separation and several callers.
- **Candidate surfaces:** `frontend/src/features/reception/ReceptionHome.tsx`, `frontend/src/features/reception/DevolucionesModal.tsx`, `frontend/src/features/reception/CurrentPurchaseCard.tsx`/`PointPaymentModal.tsx` only for approved live behavior seams, `frontend/src/app/ApiProductApp.tsx`, one focused new adapter under `frontend/src/api/`, a narrow live container only if needed, corresponding tests, this document.
- **Acceptance:** Existing product cards, cart steps and return modal with the approved waste disposition control and accurate transfer copy; real catalogue/stock/member data; no demo financial state in live tree; request key reused on uncertain outcome; reload reconciles committed sale; inputs preserved on rejection; existing demo still works.
- **Tests:** Use real UI actions with boundary responses for lost-response retry, stale price/stock, denied/expired session, no shift, async refund failure and submit lock. Confirm live route selects live adapter without DemoProvider. Do not snapshot thousands of markup lines or duplicate backend arithmetic tests.
- **Design check:** Preserve the design except for the approved waste control and necessary transfer copy. Compare before/after screenshots at the same viewport and fixture state; seek approval for other interaction changes.
- **Work unit:** `feat(reception): integrate live product checkout and returns` with meaningful interaction tests.

### T07 — Run focused and full verification
- [ ] T07: Run the command ledger below; investigate all failures without broad unrelated cleanup.
- **Depends on:** Each completed implementation slice; full closure after T06.
- **Route:** Delegated verification; foreground execution and concise observed results. Writer self-check plus independent verifier when native risk/RDD rules require it.
- **Surface:** Tests only for authorized fixes; this document records exact command, base/candidate, passed/failed/skipped, duration and reason for unavailable checks.
- **Acceptance:** Relevant focused proof green; PostgreSQL concurrency/migration checks actually executed, not silently skipped; typecheck/build and full suites dispositioned. A pre-existing failure requires reproduction/evidence, not an assumption from old counts.
- **Work unit:** Evidence/docs with the behavior it verifies; follow-up fix commit only for demonstrated scoped defects.

### T08 — Verify real authenticated browser flows with Playwright
- [ ] T08: Execute and visually inspect the scenarios in section 6; attach evidence and unresolved gaps.
- **Depends on:** T06–T07, disposable local runtime/data, permitted local auth setup, and real supported payment contracts.
- **Route:** Delegated verification; one browser session against real local frontend/API. No mocked API success for acceptance.
- **Candidate surfaces:** Existing browser harness if discovered; otherwise a single focused F10 Playwright script/config and artifact directory selected before writing. No new framework/install without checking existing tooling first. This document stores result references, not credentials.
- **Acceptance:** Screenshots actually inspected; all required flows proved with network and persisted readback; no unexpected console/runtime errors; desktop/mobile and existing light/dark layouts unchanged; unsupported provider flow recorded honestly.
- **Work unit:** `test(sales): verify authenticated product sale and return flows` only when a durable useful harness is warranted; store acceptance evidence alongside the relevant unit.

## 5. Useful test strategy and command ledger

Tests protect money, stock, permissions, retries and user recovery. Do not test trivial getters, UUID existence alone, framework validation internals, mocks asserting their own calls, static text, or implementation-specific hook structure.

**Established runners:** pytest (`api/pyproject.toml`, `api/README.md:31–38`); Vitest/typecheck/build (`frontend/package.json`). Commands below are intended future checks, not results.

```powershell
# Repository root; existing backend regression suites
.\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_sales.py api/tests/test_inventory.py api/tests/test_shifts.py api/tests/test_migrations.py

# Proposed files: selectors become runnable only after the relevant tasks create them
.\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_product_sales.py api/tests/test_product_returns.py
.\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_product_sales_postgres.py api/tests/test_migrations_postgres.py

# Full API closure
.\api\.venv\Scripts\python.exe -m pytest -q api/tests

# Run from frontend/; CurrentPurchaseCard.test.tsx is proposed, not present at baseline
npm run test -- src/features/reception/ReceptionHome.test.tsx src/app/ApiProductApp.test.tsx src/features/reception/CurrentPurchaseCard.test.tsx
npm run typecheck
npm run test
npm run build
```

Use the already configured project interpreter if its location differs; do not install tools just because a sample command fails. Add the future adapter/return-modal interaction selectors when their exact paths are chosen; no existing CurrentPurchaseCard test is claimed. PostgreSQL tests require `EVOGYM_TEST_POSTGRES_URL` pointing to an explicitly disposable loopback database and isolated schema; missing variable means **unverified/skipped**, not PASS. Run migration upgrade at current head with existing membership fixture plus new product/refund fixtures. SQLite cannot prove PostgreSQL row locking.

The declared versions currently include FastAPI `>=0.149,<1.0` and SQLAlchemy `>=2.1.5,<3.0`; do not upgrade dependencies for this feature. Session/transaction ownership follows existing explicit commit/rollback patterns, not a repo-wide dependency refactor. Response models constrain public output; avoid returning raw ORM/internal fingerprints.

Official FastAPI guidance consulted through Context7 during planning:
- [Synchronous blocking dependencies/path operations](https://fastapi.tiangolo.com/async/) — use ordinary `def` for this synchronous DB stack.
- [Response models](https://fastapi.tiangolo.com/tutorial/response-model/) — validate/filter public responses.
- [Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/) — release scoped resources and propagate exceptions; never hide transaction failure or defer a financial commit until after success is sent.

## 6. Playwright visual and persisted-flow acceptance

No Playwright dependency or npm script is declared in `frontend/package.json`; do not invent `npm run e2e` as an existing command. At T08, discover reusable installed browser tooling first. If adding a durable harness is justified, explicitly record the exact chosen package/version/command and narrow allowed file surfaces before installation or creation.

Run local-only frontend and API using existing README commands, the disposable database and synthetic products/members/staff. Verify authentication through the real session/device-approval contract with authorized synthetic identities; do not reuse ambient owner credentials, bypass access checks or approve a real device silently.

Capture the designated branch design before integration at desktop (e.g. 1440×900) and mobile (e.g. 390×844), using the existing light/dark switch. Capture again after integration with equivalent fixtures/cart state. Inspect images for wrapping, spacing, panel width, overlays, clipping, keyboard focus and responsive cart access. Dynamic IDs/timestamps may differ; do not auto-approve a broad pixel threshold that masks layout drift.

| Scenario | Browser actions | Independent evidence |
|---|---|---|
| Cash multi-product sale | Login as branch cashier, open existing shift, choose two products, assign member where applicable, review, tender and confirm | Real POST/response IDs; one order, all lines, payment, decremented stock, correct shift cash including change. Screenshot catalogue, review and success. |
| Hard reload and uncertain response | Reload after success; separately interrupt receipt delivery after server commit, retry same intent/key | Fresh GET/replay resolves same sale; one set of rows/movements, cart not silently double-charged. Screenshot recoverable status. |
| Rejection | Change stock/price through a second authorized session before confirmation; attempt no-shift/expired/denied operation | Real rejection, no partial writes, preserved cart and actionable existing error display. Screenshot error and recovered retry. |
| Approved non-cash methods | Receptionist checks a transfer receipt, administrator reviews it; mixed/shortfall/card scenarios | Stock is deducted once at receipt verification, never again at admin review; unreceived funds create debt and alert. No Point simulation is treated as provider proof. |
| Product return | Select member and eligible original item, enter reason/payout, confirm, reload | Original sale unchanged, one refund linked to it, correct restored/non-restored stock and current shift cash/projection. Screenshot steps and result. |
| Refund safety | Retry, attempt already-refunded/ineligible/other-branch item; partial refund only if approved UI supports it | Server denial or stable replay, no over-refund/restock duplication; selected values retained on failure. |
| Visual contract | Repeat main cart and modal states at matching desktop/mobile/light/dark settings | Before/after images inspected by a human/visual agent; no unexplained design changes or horizontal overflow. |

Record browser version, viewport/theme, base/candidate SHA, scenario, exact outcome, screenshot/trace path and matching API/readback IDs. Capture console errors, failed requests and relevant network statuses with credentials and personal data redacted. Use API/DB assertions for persistence; screenshots alone cannot prove accounting. Keep seeds/cleanup scoped to synthetic IDs or the disposable schema, never broad deletes on a shared database.

## 7. Execution, review and delivery discipline

- Implementation begins only after explicit authorization and the applicable business gates. Create `codex/f10-product-sales-returns` from the designated base after checking drift; do not switch/reset this branch or overwrite unrelated local work automatically.
- Reconcile this file with its full Engram mirror before work/resume. Mirror the entire document and locator after each observed task closure; mark mirror unavailable/pending honestly.
- Each bounded writer receives exact allowed paths, relevant skill paths, task/decision context and exact verification commands. Keep writes single-threaded. Runtime workers report blockers rather than expanding scope.
- Follow meaningful deterministic RED → GREEN → REFACTOR; record the actual failing assertion before implementation. Passive docs/browser evidence do not justify fabricated RED.
- Normalize source before final checks/review. Keep tests/docs with behavior and record Conventional Commit identity per work unit; never add AI attribution. No commits are made during this planning request.
- Read the user-owned RDD switch without toggling it. When enabled, use native assessment and returned preflight/consent/collection/acknowledgement transitions for a work-unit or review slice, never the accumulated feature branch or a checkbox. Decline/OFF follows ordinary checks without fabricated review approval.
- Default delivery strategy: `ask-on-risk`; chain strategy not selected. Forecast 1,000–1,800 authored changed lines across schema, API, integration and useful tests (planning estimate, not a cap or a verified diff). This likely exceeds ~400, so resolve the chain strategy once before the first implementation commit; do not ask now or create PRs during planning.
- Suggested cohesive slices: cash sale with required stock/projections; approved additional payments; returns with projections; frontend integration/browser proof. Merge slices when an intermediate slice would be incorrect. Never omit tests or compress code to meet a line budget.
- Commit, push, PR and merge remain separate under the applicable authorization. No push, publication or provider/remote operations are authorized by this plan.

## 8. Non-goals and completion gate

No frontend redesign beyond approved interaction and copy changes, new component library, generalized payment engine, event bus, tax engine, fiscal invoices, membership cancellation, visit sales, supplements, rentals, offline sync, exports, dashboards or speculative extensibility. Automatic Mercado Pago terminal confirmation for product card sales is explicitly in scope. No unrelated backlog cleanup or rewriting already verified features.

F10 is complete only when the approved product sale/return flow works in the authenticated tree, survives reload/retry, reconciles all affected persisted facts and existing readers, preserves frontend design, and has recorded focused/full-check and Playwright evidence. Deferred visible behavior is a named product limitation; it is not an implicitly completed task.

## Progress, verification and next step

**Planning evidence:** Branch/hash and clean starting worktree observed; source and runner configuration inspected; current official FastAPI guidance consulted. Only this Markdown file was authored. No test/build/browser/provider execution or implementation commit occurred.

| Task | Status | Commit | Observed proof |
|---|---|---|---|
| T01–T08 | Pending | None | None; commands/scenarios above are planned, not executed. |

**Next step:** Reconcile the approved decisions with the recovery mirror, resolve outstanding business gates for the affected slices, and complete T01 evidence before the first source write.

**In-progress cash slice (not complete):** Product cash-sale, stock and shift changes are present without a work-unit commit. On SQLite, focused checks covered sale/replay, changed payload, unauthorized access, rollback after an injected second-line failure, stock/shift totals, and preservation of historical membership amounts. The targeted command `pytest -q api/tests/test_product_sales.py api/tests/test_product_sales_postgres.py api/tests/test_migrations.py::test_product_sales_migration_preserves_legacy_membership_amounts` reported 5 passed and 2 skipped; PostgreSQL was not configured. PostgreSQL migration and concurrency evidence, cross-branch read authorization, full regression disposition, independent verification and all later F10 slices remain pending. T02 and T03 remain unchecked.

**Review corrections, still partial:** ORM metadata now matches the migration's historical membership amount constraint; its regression failed before the fix and passed afterward. Opening snapshot validation now also holds a PostgreSQL shared lock on the stock movement ledger until transaction completion, coordinating with inserts for sale, waste and restock. `pytest -q api/tests/test_product_sales.py api/tests/test_product_sales_postgres.py api/tests/test_inventory.py api/tests/test_migrations.py::test_product_sales_migration_preserves_legacy_membership_amounts` reported 16 passed and 3 skipped. The new PostgreSQL snapshot-versus-movement race test was skipped because the disposable PostgreSQL URL is unavailable; the locking change is therefore not yet proven on PostgreSQL.

**In-progress live cash integration:** The user approved automatic selection when one open register is available and explicit selection when multiple are available. The candidate adds a live cash-only reception container, branch-labelled selector, cross-branch receptionist register and stock reads, and frozen retryable sale intent; unsupported methods and returns are not simulated. The selected register and cart are not marked complete. `npm run test -- src/api/productSalesApi.test.ts src/app/ApiReceptionHome.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism` reported 7 passed; `npm run typecheck` passed. Focused direct backend tests for cross-branch role checks, metadata consistency and typed rejection reported 3 passed. The wider backend HTTP tests hung before producing results in this runtime, so authorization and checkout still need real HTTP verification. PostgreSQL, browser visual acceptance, remaining payment methods, refunds, independent verification and commits are pending.

**Cash transition blocker:** The live checkout does not receive an authoritative shift window. The existing classifier treats an unknown window as a transition, so new cash posts and replay POSTs are conservatively blocked rather than silently attributed to the current shift. A read-only reconciliation or server-enforced transition contract is needed to safely resume. An uncertain POST followed by rejection likewise remains frozen: the original request could still arrive later; safely releasing that intent requires server-owned terminal cancellation or reconciliation. Focused frontend tests after these safeguards: 9 passed; typecheck passed. These are blockers, not completed F10 behavior.

**Cash shift policy in progress:** Product cash sales use the open register shift; without one they use the latest closed shift as overtime, or reject with `first_shift_required` when no earlier shift exists. Existing opening-count reconciliation links overtime cash without counting it twice. Live checkout no longer infers server shift state from an absent display window. An uncertain request remains frozen and cannot be retried or cancelled safely until a server-owned reconciliation/cancellation contract is added. Focused SQLite policy test passed; PostgreSQL sale/close concurrency test added but skipped without disposable PostgreSQL. Full HTTP and browser acceptance remain pending.

**Cash intent resolution in progress:** The cashier can resolve an uncertain cash intent. The server returns a committed sale or persists a cancellation that prevents a delayed original request from posting; both operations serialize on the seller row. The cancellation stores only the request fingerprint, not cart contents. Focused SQLite service/endpoint and migration tests passed; frontend resolution tests and typecheck passed. PostgreSQL cancellation-versus-sale race coverage is present but skipped without a disposable database. Real HTTP and browser verification remain pending; this does not complete F10.


**Durable intent coordination in progress:** The server stores one unresolved product-sale intent per seller before accepting a cash sale, exposes it to other tabs, and resolves it through committed-sale recovery or durable cancellation. Competing preparations serialize on the seller; delayed preparation cannot revive a resolved intent. PostgreSQL race checks and browser acceptance remain pending. Administrative recovery is now implemented for server-registered intents; see below.


**Administrative recovery in progress:** Employee deactivation rejects an unresolved server-registered product sale. An organization administrator with employee-management permission can inspect and resolve the specific intent using their own identity; the action records seller, administrator, register, request key, result and timestamp in a transactional append-only audit record. Previously disabled accounts are supported. The seller row serializes preparation, resolution and deactivation, and new preparations reject inactive accounts. The owner screen displays the pending amount and requires resolution before account deactivation. PostgreSQL concurrency and browser acceptance remain pending; legacy intents existing only in a closed browser tab cannot be discovered by the server.

**PostgreSQL regression correction:** Seller serialization now uses `FOR NO KEY UPDATE`, preserving mutual exclusion without blocking the shift-close foreign-key check. A deterministic sale-versus-close regression and the PostgreSQL product, membership and shift tests passed (17 total). PostgreSQL and SQLite migration tests, product sale tests and administrative staff tests passed (65 total); migration 0038's downgrade uses portable Boolean comparisons and current-head expectations include the product-sale tables. Browser acceptance remains pending.


**Product returns and refunds completed:** Added canonical `ProductRefund` model, migration `0045_product_refunds.py`, stock movement constraint updates (`return` kind), inventory restored stock calculations for `restock` disposition vs `waste`, shift cash deduction for cash returns (`expected_cash_for_shift`), API endpoints `GET /api/v1/registers/{register_id}/members/{member_id}/eligible-product-returns` and `POST /api/v1/registers/{register_id}/product-returns` with 64-char sha256 request fingerprint and idempotency key replay, frontend client `productSalesApi.ts`, live/demo `DevolucionesModal.tsx`, and reception wiring in `ApiReceptionHome.tsx`.
**Card payments with Mercado Pago Point integration completed (D08):**
Implemented card payments for product sales integrated with Mercado Pago Point terminals.
Key additions:
- Configuration: `EVOGYM_MERCADO_PAGO_ACCESS_TOKEN` in `api/app/settings.py` and `api/.env.example`.
- Migration: `0046_card_payments_point.py` adding `terminal_id`, `mp_payment_intent_id`, `mp_payment_id`, `card_brand`, `card_last_four`, `authorization_code` to `payments`, and updating check constraints `ck_payments_supported_method` (`'cash', 'transfer', 'card'`) and `ck_payments_method_status` (`method = 'card' AND status IN ('pending', 'confirmed', 'failed')`).
- Models: Updated `Payment` in `api/app/db/models/orders.py` with foreign key and relationship to `PaymentTerminal`.
- Terminal Integration: Implemented `PointTerminalClient` protocol, `MockPointTerminalClient` (in-memory simulator with cancellation and auto-process hooks), `MercadoPagoPointHttpClient` (calling MP Point API), and `get_point_client` factory in `api/app/sales/point.py`.
- Sales Queries & Endpoints: Added `post_card_product_sale` with row-level locks, stock checks, atomic `Order`, `OrderItem`, `StockMovement(kind='sale')`, and `Payment(method='card', status='confirmed')` persistence, and idempotent replay. Added endpoints `POST /{register_id}/card-intent`, `GET /{register_id}/card-intent/{intent_id}`, `DELETE /{register_id}/card-intent/{intent_id}`, and `POST /{register_id}/product-sales/card`.
- Shift Drawer Separation: Financial summary (`shift_financial_summary`) aggregates confirmed card payments into total revenue while strictly isolating physical cash in drawer (`confirmed_cash_minor`).
- Returns Support: Card sales lines are fully eligible for product returns, with refund payout recorded to card/cash as approved.
- Frontend: `productSalesApi.ts` client methods (`createCardIntent`, `getCardIntentStatus`, `cancelCardIntent`, `submitCardProductSale`), `CurrentPurchaseCard.tsx` with live intent trigger without client simulation modal, and `ApiReceptionHome.tsx` handling terminal polling, error handling, cancellation, and receipt settlement.

Observed verification:
- `cd api; ..\api\.venv\Scripts\alembic.exe upgrade head`: Context impl PostgresqlImpl, transactional DDL. Upgraded to `0046_card_payments_point`.
- `api\.venv\Scripts\python.exe -m pytest -q api/tests/test_card_sales.py`: 7 passed in 11.97s.
- `api\.venv\Scripts\python.exe -m pytest -q -s api/tests/test_card_sales_postgres.py`: 3 passed in 13.55s.
- `api\.venv\Scripts\python.exe -m pytest -q api/tests/test_product_sales.py api/tests/test_product_returns.py api/tests/test_shifts.py`: 69 passed in 79.08s.
- `cd frontend; npm test -- src/api/productSalesApi.test.ts src/app/ApiReceptionHome.test.tsx --run`: 24 passed in 20.27s.
- `cd frontend; npm run typecheck`: clean (0 errors).
- `cd api; .\.venv\Scripts\python.exe check_point_terminal.py --test-intent`: verified pre-flight CLI with device query and intent lifecycle.
- Playwright E2E interactive live session:
  1. Cash sale: Agua Natural 1L assigned to Carlos Gomez, stock deducted 20 -> 19, shift balance updated.
  2. Card sale: Bebida Isotónica assigned to Carlos Gomez, simulated Point terminal approved, stock deducted 15 -> 14, cash drawer isolated.
  3. Devoluciones: Query member purchases, select Agua Natural 1L, choose restock disposition, refund $20.00 MXN, stock restored 19 -> 20, shift expected cash deducted.
