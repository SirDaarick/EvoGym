# F06 & F07 Implementation Plan — Organic Driven Development (ODD) + Ponytail

**Base branch:** `integration/frontend-design` (`cff1e27`)
**Target features:**
- **F06:** Pay membership debt at the register (`P1`, Class A — UI exists or is partially wired; backend debt repayment write endpoint exists; cashier open-debt read contract and register modal flow require end-to-end integration)
- **F07:** Review pending money and transfer payments (`P1`, Class A — backend pending-money read endpoint and transfer review write endpoint exist; owner finance route `/owner/expenses` is currently unmounted on `<UnavailablePage />` and requires live API wiring)

**Execution philosophy (Ponytail + ODD):**
- **Smallest complete change:** Zero speculative abstractions, zero new database tables or Alembic migrations, and zero redundant UI state layers.
- **Strict Frontend Visual Freeze:** Reuse existing layout containers, CSS class names, badges, and tables in `LiveMembershipCheckout.tsx`, `MemberDetail.tsx`, `Members.tsx`, `ExpenseReport.tsx`, and `CollectionsView.tsx`. Never alter existing theme tokens, spacing, or visual hierarchy.
- **High-value testing only:** Every unit/integration test must prove a real business rule, state transition, permission/branch boundary, idempotency contract, or error path. Trivial render-only tests and mock-echo assertions are strictly forbidden.
- **Real-browser verification:** Both features require end-to-end Playwright verification against a live FastAPI + SQLite dev server and Vite frontend (`VITE_DEMO_MODE=false`), including network payload inspection, error/conflict states, and hard page reloads (`F5`).

---

## 0. Sequential ODD Execution & File-Touch Isolation

Although **F06** (reception register debt repayment on `/members`) and **F07** (owner/admin pending money & transfer review on `/owner/expenses`) operate on distinct user journeys, both interact with the sales router (`api/app/api/sales.py`). Under ODD discipline, **F06 executes first (`F06-T01` -> `F06-T03`)**, followed by **F07 (`F07-T01` -> `F07-T03`)**, with zero overlapping frontend files.

| Layer | F06 (Pay Membership Debt at the Register) | F07 (Review Pending Money & Transfer Payments) | Overlap |
| :--- | :--- | :--- | :--- |
| **Backend Models & Migrations** | None (`MembershipDebt` in `api/app/db/models/membership_debts.py` and `MembershipDebtPayment` in `api/app/db/models/membership_debt_payments.py` already exist) | None (`Payment` in `api/app/db/models/orders.py` and `PaymentReviewEvent` in `api/app/db/models/payment_review_events.py` already exist) | **None** |
| **Backend API, Queries & Schemas** | `api/app/api/sales.py` (add `GET /api/v1/registers/{register_id}/members/{member_id}/debts`), `api/app/sales/queries.py`, `api/app/sales/schemas.py`, `api/tests/test_sales.py` | None (`GET /api/v1/admin/pending-money` in `api/app/api/pending_money.py:111-194` and `POST /api/v1/registers/transfer-payments/{payment_id}/review` in `api/app/api/sales.py:310-361` are already complete and tested) | **None** |
| **Frontend App Router (`ApiProductApp.tsx`)** | None (`/members` is already mounted via `<ApiMembers />` at `frontend/src/app/ApiProductApp.tsx:101-106`) | `frontend/src/app/ApiProductApp.tsx` (mount live `<ExpenseReport />` at `/owner/expenses`), `frontend/src/app/ApiProductApp.test.tsx` | **None** |
| **Frontend Feature & API Files** | `frontend/src/api/membershipCheckoutApi.ts`, `frontend/src/api/membershipCheckoutApi.test.ts`, `frontend/src/features/reception/LiveMembershipCheckout.tsx`, `frontend/src/features/reception/LiveMembershipCheckout.test.tsx`, `frontend/src/features/members/Members.tsx`, `frontend/src/features/members/MemberDetail.tsx` | `frontend/src/api/pendingMoneyApi.ts` *(new)*, `frontend/src/api/pendingMoneyApi.test.ts` *(new)*, `frontend/src/features/owner/ExpenseReport.tsx`, `frontend/src/features/owner/ExpenseReport.test.tsx` *(new)*, `frontend/src/features/owner/finance/CollectionsView.tsx` | **None** |

---

## Part 1: F06 — Pay Membership Debt at the Register (`P1`, Class A)

### 1.1 Objective & Business Rule Reconciliation (`D-012`, `D-013`, `D-024`, `R-007`)

Enable a receptionist or admin operating an active cash register with an open shift to view a member's open branch-scoped membership debts (`order_id`, plan/item description, initial outstanding amount, remaining balance) and record a partial or full **cash** debt repayment via `POST /api/v1/registers/{register_id}/membership-debt-payments`, immediately refreshing the member's operational balance warning (`has_pending_balance` / `pending_balance_minor`) and expediente financial view.

#### Canonical Business Rule Alignment
1. **`D-012` / `R-007` (Partial cash sale creates explicit order-linked debt):**
   - When a membership cash sale is posted with `cash_amount_minor < price_minor` (`api/app/sales/queries.py:173-239`), the order stores the full snapshot price, the payment records only the actual cash received on that shift, and a `MembershipDebt` row (`api/app/db/models/membership_debts.py:16-54`) is created with immutable `initial_outstanding_minor = price_minor - cash_amount_minor`.
   - Operational consequence: the member's period remains active while `evaluate_membership_access` (`api/app/memberships/eligibility.py`) emits the `"outstanding_balance"` warning until remaining debt reaches `0` (unless an admin explicitly restricts access via `MemberAccessDecision`).
2. **`D-013` / `R-007` (Order-specific cash debt repayment at the register):**
   - Subsequent debt repayments are **cash-only**, **order-specific** (`order_id`), and **branch/shift-bound**: `post_membership_debt_payment` (`api/app/sales/queries.py:416-521`) requires an active `CashRegister` on the same branch as `Order.branch_id` (`sales/queries.py:446-447`), an open `Shift` on that register (`sales/queries.py:432-434`), and a strict positive integer `amount_minor <= remaining_balance_minor` (`sales/queries.py:451-462`).
   - Every repayment inserts an append-only `MembershipDebtPayment` receipt (`api/app/db/models/membership_debt_payments.py:16-67`) linked to `shift_id`, contributing `func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0)` to `expected_cash_at_close_minor` when the shift closes (`api/tests/test_sales.py:416-421`).
   - There is **no multi-order automatic allocation inference** and **no non-cash (card/transfer) debt repayment** in v1 (`D-013`).
3. **`D-024` (Online payment expiry boundary):**
   - `D-024` governs online Checkout Pro link/order expiration (`D-001` / `D-003`) so expired online links cannot overwrite newer sales. It does **not** expire local `MembershipDebt` records created at the physical register under `D-012` / `D-013`.

#### Concrete Codebase Gap Identified for F06 (Receptionist Open-Debt Read Gap)
- **What already exists on the backend:**
  - `POST /api/v1/registers/{register_id}/membership-debt-payments` (`api/app/api/sales.py:172-232`) is fully implemented and tested (`api/tests/test_sales.py:301-448`, `api/tests/test_pending_money.py:112-135`). It authenticates via `get_shift_actor_principal` (`api/app/api/shifts.py:66-103`), which accepts both Admin Bearer tokens and receptionist Staff Bearer tokens (`Permission.MEMBER_OPERATIONAL_READ`).
- **What is missing on the backend:**
  - `POST /api/v1/registers/{register_id}/membership-debt-payments` requires `{ "order_id": "<uuid>", "amount_minor": <int> }`.
  - However, a receptionist cannot currently read a member's open debt `order_id`s from any existing endpoint:
    1. `GET /api/v1/members/{member_id}/reload` (`api/app/members/read_queries.py:272-280`) intentionally sets `total_pending_balance_minor=None` and `debts=[]` whenever `principal_is_admin` is `False`, and `test_t02_receptionist_projection_hides_financial_amounts_and_debts` (`api/tests/test_member_reads.py:260-313`) explicitly locks that redaction.
    2. `GET /api/v1/members/{member_id}` (`api/app/api/members.py:124-143, 221-240`) returns `pending_balance_minor` and `has_pending_balance` to receptionists, and `test_sales.py:230` asserts `"orders" not in detail.json() and "payments" not in detail.json()`.
    3. `GET /api/v1/admin/pending-money` (`api/app/api/pending_money.py:111-194`) requires `Permission.FINANCE_READ`, which receptionists do not hold (`api/app/auth/authorization.py:61-66`).
- **Smallest Complete Fix (Zero Regression on Existing Contracts):**
  - Keep `GET /api/v1/members/{member_id}` and `GET /api/v1/members/{member_id}/reload` 100% untouched.
  - Add a focused register-scoped read endpoint in `api/app/api/sales.py`:
    `GET /api/v1/registers/{register_id}/members/{member_id}/debts` -> `list[RegisterMemberOpenDebtDTO]`
  - Authenticated with the exact same `ShiftActorPrincipal = Depends(get_shift_actor_principal)` and branch guard (`principal.branch_id == register.branch_id`) as `POST /api/v1/registers/{register_id}/membership-debt-payments`.
  - Queries open `MembershipDebt` rows for `member_id` where `Order.branch_id == register.branch_id` and `remaining_balance_minor > 0`, returning `{ debt_id, order_id, member_id, branch_id, currency, description_snapshot, initial_outstanding_minor, paid_amount_minor, remaining_balance_minor, created_at }`.
  - Because it filters by `Order.branch_id == register.branch_id`, every returned debt is guaranteed to belong to the active register's branch (`D-013`).

#### What Ponytail Explicitly Skips for F06
- No multi-order auto-allocation or FIFO debt splitting (`D-013` requires explicit `order_id` selection).
- No card or bank-transfer debt repayment (`D-013` restricts debt repayment to cash receipts on an open shift).
- No changes to `GET /api/v1/members/{member_id}/reload` (`test_member_reads.py` `T02` stays untouched).
- No new CSS classes or modal layouts; reuse `LiveMembershipCheckout.tsx` modal classes (`membership-checkout-modal-overlay`, `membership-checkout-modal-card`, `membership-checkout-grid`, `membership-checkout-summary`, `membership-checkout-receipt`) and `MemberDetail.tsx` action triggers.

---

### 1.2 Allowed Edit Surfaces (F06)

#### Backend (Read Endpoint for Register Open Debts + Tests)
- `api/app/sales/schemas.py`
- `api/app/sales/queries.py`
- `api/app/api/sales.py`
- `api/tests/test_sales.py`

#### Frontend (Transport + Register Debt Payment Flow + Member Detail Integration + Tests)
- `frontend/src/api/membershipCheckoutApi.ts`
- `frontend/src/api/membershipCheckoutApi.test.ts`
- `frontend/src/features/reception/LiveMembershipCheckout.tsx`
- `frontend/src/features/reception/LiveMembershipCheckout.test.tsx`
- `frontend/src/features/members/Members.tsx`
- `frontend/src/features/members/MemberDetail.tsx`

---

### 1.3 Minimal Technical Design (F06)

#### A. Backend Register Open-Debt Endpoint (`api/app/sales/schemas.py`, `api/app/sales/queries.py`, `api/app/api/sales.py`)
1. **Schema (`api/app/sales/schemas.py`):**
   - Add `RegisterMemberOpenDebtDTO(BaseModel)`:
     ```python
     class RegisterMemberOpenDebtDTO(BaseModel):
         model_config = ConfigDict(extra="forbid")

         debt_id: UUID
         order_id: UUID
         member_id: UUID
         branch_id: UUID
         currency: str
         description_snapshot: str
         initial_outstanding_minor: int
         paid_amount_minor: int
         remaining_balance_minor: int
         created_at: datetime
     ```
2. **Query (`api/app/sales/queries.py`):**
   - Add `list_register_member_open_debts(session: Session, *, register_id: UUID, member_id: UUID, authorized_branch_id: UUID | None = None) -> list[RegisterMemberOpenDebtDTO]`:
     - Validate `register = session.get(CashRegister, register_id)` (`CashRegisterNotFoundError` -> `404`, ` CashRegisterInactiveError` -> `409`).
     - If `authorized_branch_id is not None and register.branch_id != authorized_branch_id`, raise `SaleAuthorizationError("Not authorized to access debts for this branch.")` (`403`).
     - Validate `member = session.get(Member, member_id)` (`MemberNotFoundError` -> `404`).
     - Select `MembershipDebt`, `Order`, and the primary `OrderItem.description_snapshot` (`OrderItem.line_number == 1`) with `paid_amount_minor = func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0)` where `MembershipDebt.member_id == member_id` and `Order.branch_id == register.branch_id`, ordered by `MembershipDebt.created_at.asc(), MembershipDebt.id.asc()`.
     - Compute `remaining_balance_minor = debt.initial_outstanding_minor - paid_amount_minor` and include only rows with `remaining_balance_minor > 0`.
3. **Router (`api/app/api/sales.py`):**
   - Add `@router.get("/registers/{register_id}/members/{member_id}/debts", response_model=list[RegisterMemberOpenDebtDTO])` using `principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)`, mapping `SaleAuthorizationError` -> `403`, `CashRegisterNotFoundError | MemberNotFoundError` -> `404`, `CashRegisterInactiveError` -> `409`.

#### B. Frontend Transport (`frontend/src/api/membershipCheckoutApi.ts`)
1. Add DTO and request types matching the backend contracts in `api/app/sales/schemas.py:24-43`:
   ```ts
   export interface RegisterMemberOpenDebt {
     debt_id: string;
     order_id: string;
     member_id: string;
     branch_id: string;
     currency: string;
     description_snapshot: string;
     initial_outstanding_minor: number;
     paid_amount_minor: number;
     remaining_balance_minor: number;
     created_at: string;
   }

   export interface MembershipDebtPaymentInput {
     order_id: string;
     amount_minor: number;
   }

   export interface MembershipDebtPaymentReceipt {
     id: string;
     debt_id: string;
     order_id: string;
     member_id: string;
     branch_id: string;
     register_id: string;
     shift_id: string;
     amount_minor: number;
     remaining_balance_minor: number;
     received_by: string;
     received_at: string;
   }
   ```
2. Add transport helpers:
   - `listRegisterMemberOpenDebts(registerId: string, memberId: string, apiRequest?: AuthenticatedRequest): Promise<RegisterMemberOpenDebt[]>` calling `GET /api/v1/registers/${encodeURIComponent(registerId)}/members/${encodeURIComponent(memberId)}/debts`.
   - `submitMembershipDebtPayment(registerId: string, payload: MembershipDebtPaymentInput, idempotencyKey: string, apiRequest?: AuthenticatedRequest): Promise<MembershipDebtPaymentReceipt>` calling `POST /api/v1/registers/${encodeURIComponent(registerId)}/membership-debt-payments` with `Idempotency-Key` header.

#### C. Frontend Register Debt Repayment Flow (`LiveMembershipCheckout.tsx`, `Members.tsx`, `MemberDetail.tsx`)
1. **Checkout Mode / Debt Payment Flow in `LiveMembershipCheckout.tsx`:**
   - Extend `LiveMembershipCheckoutProps` with optional `initialOperation?: 'sale' | 'debt_payment'` and `initialOrderId?: string`.
   - Reuse the existing register discovery and shift gate in `LiveMembershipCheckout.tsx:167-237` (`listCheckoutRegisters`, `getRegisterOpenShift`, and inline `openCheckoutShift` when no shift is open on the selected register).
   - Provide a two-mode selector at the top of the modal body when the member has `pending_balance_minor > 0` or `initialOperation === 'debt_payment'`:
     - **Vender membresía** (existing cash/transfer membership sale flow)
     - **Liquidar / abonar adeudo** (register cash debt repayment flow)
   - In **Liquidar / abonar adeudo** mode:
     - When an active register is selected, call `listRegisterMemberOpenDebts(selectedRegisterId, member.id, apiRequest)`.
     - Render a `<select>` of open debts for that branch (`description_snapshot`, order short ID, remaining balance in MXN) defaulting to `initialOrderId` (if provided) or the oldest open debt.
     - Display a `<dl className="membership-checkout-summary">` with:
       - `Adeudo original` (`formatMinorCurrency(selectedDebt.initial_outstanding_minor)`)
       - `Saldo pendiente actual` (`formatMinorCurrency(selectedDebt.remaining_balance_minor)`)
       - `Método de cobro`: `Efectivo en turno abierto`
     - Render an `<input type="number" step="0.01">` for `Monto a abonar (MXN)` pre-filled with the full `remaining_balance_minor / 100`, allowing any positive amount up to `remaining_balance_minor`.
     - Validate client-side before submit: `amount_minor` must be an integer `> 0` and `<= selectedDebt.remaining_balance_minor`.
     - Generate a stable `Idempotency-Key` (`createCheckoutIdempotencyKey()`) per `(selectedRegisterId, selectedDebt.order_id, amountMajor)` combination so network retries reuse the same key while amount/order edits generate a fresh key.
     - On submit, call `submitMembershipDebtPayment(selectedRegisterId, { order_id: selectedDebt.order_id, amount_minor }, idempotencyKey, apiRequest)`, render the receipt view (`Monto abonado`, `Saldo restante del pedido`, `Recibo`, `Turno`), and invoke `onSaleCompleted()` so `ApiMembers` refreshes both `GET /api/v1/members/{member_id}` and `GET /api/v1/members/{member_id}/reload`.
2. **Entry Points in `Members.tsx` and `MemberDetail.tsx`:**
   - In `Members.tsx` (`LiveMemberDetail`, lines 397–478):
     - Track `checkoutState: { open: boolean; operation: 'sale' | 'debt_payment'; orderId?: string }`.
     - When `member.has_pending_balance` (or `(reload?.financial.total_pending_balance_minor ?? 0) > 0`), render a secondary action button in `.member-hero-actions` (`"Liquidar adeudo"`, `className="button ghost"`) alongside `"Vender membresía"`, opening `LiveMembershipCheckout` with `initialOperation="debt_payment"`.
     - Pass an optional `onPayDebt?: (orderId?: string) => void` callback into `MemberCounterView` and `MemberDetailSections` in `MemberDetail.tsx` so:
       - Clicking `"Liquidar adeudo"` in the counter warning banner (`MemberDetail.tsx:863-871`, `data-testid="balance-warning-alert"`) opens the register debt repayment modal.
       - In the `Adeudos pendientes` table (`MemberDetail.tsx:604-627`), each open debt row can trigger `onPayDebt(debt.order_id)` directly.

---

### 1.4 ODD Work Units: DoR & DoD (F06)

#### Work Unit `F06-T01`: Backend Register Open-Debt Read Endpoint — [x] Completed
- **Definition of Ready (DoR):**
  - `POST /api/v1/registers/{register_id}/membership-debt-payments` in `api/app/api/sales.py:172-232` verified.
  - `test_t02_receptionist_projection_hides_financial_amounts_and_debts` in `api/tests/test_member_reads.py:260-313` verified.
- **Scope:**
  - Add `RegisterMemberOpenDebtDTO` to `api/app/sales/schemas.py`.
  - Add `list_register_member_open_debts` to `api/app/sales/queries.py`.
  - Add `GET /api/v1/registers/{register_id}/members/{member_id}/debts` to `api/app/api/sales.py`.
  - Add backend integration tests in `api/tests/test_sales.py`.
- **Definition of Done (DoD):**
  - Receptionist and Admin tokens can list open debts for a member on an active register in their authorized branch (`200 OK`).
  - Partially repaid debts reflect accurate `paid_amount_minor` and `remaining_balance_minor`; fully repaid debts (`remaining_balance_minor == 0`) and debts from other branches are excluded.
  - Cross-branch receptionist access returns `403`, unknown register/member returns `404`, and `pytest api/tests/test_sales.py api/tests/test_member_reads.py` passes with zero regressions.

#### Work Unit `F06-T02`: Frontend Debt Payment API Transport & Unit Tests — [x] Completed
- **Definition of Ready (DoR):**
  - `F06-T01` endpoint contract finalized.
- **Scope:**
  - Add `RegisterMemberOpenDebt`, `MembershipDebtPaymentInput`, `MembershipDebtPaymentReceipt`, `listRegisterMemberOpenDebts`, and `submitMembershipDebtPayment` to `frontend/src/api/membershipCheckoutApi.ts`.
  - Extend `frontend/src/api/membershipCheckoutApi.test.ts`.
- **Definition of Done (DoD):**
  - Transport functions send exact paths, method, JSON payload, and `Idempotency-Key` header, and surface backend `403`/`409`/`422` `detail` messages via `MembershipCheckoutApiError`.

#### Work Unit `F06-T03`: Register Debt Repayment Modal & Member Detail Wiring — [x] Completed
- **Definition of Ready (DoR):**
  - `F06-T02` complete; `LiveMembershipCheckout.tsx`, `Members.tsx`, and `MemberDetail.tsx` props inspected.
- **Scope:**
  - Wire `initialOperation="debt_payment"` and `initialOrderId` in `LiveMembershipCheckout.tsx`.
  - Wire `"Liquidar adeudo"` triggers in `Members.tsx` and `MemberDetail.tsx`.
  - Add high-value tests in `frontend/src/features/reception/LiveMembershipCheckout.test.tsx` and `frontend/src/features/members/Members.test.tsx`.
- **Definition of Done (DoD):**
  - Cashier can open `"Liquidar adeudo"` from member detail, open a shift if closed, select an open branch debt, submit a partial or full cash repayment, see the receipt with updated `remaining_balance_minor`, and trigger `onSaleCompleted()` to refresh member detail and reload state.
  - `npx vitest run src/api/membershipCheckoutApi.test.ts src/features/reception/LiveMembershipCheckout.test.tsx src/features/members/Members.test.tsx` and `npm run build` pass.

---

### 1.5 High-Value Test Matrix (F06)

> **Ban on trivial tests:** Do not write tests that only check button labels or static props. Every test below verifies an operational invariant.

| Test ID | Target File | Scenario & Invariant Verified |
| :--- | :--- | :--- |
| **`F06-B01`** | `api/tests/test_sales.py` | **Branch-scoped open debt listing & repayment lifecycle:** Receptionist creates two partial cash sales on Branch A and one on Branch B. `GET /api/v1/registers/{register_a}/members/{member_id}/debts` returns only Branch A's open debts with `initial_outstanding_minor`, `paid_amount_minor`, and `remaining_balance_minor`. After a partial payment (`2500`), `remaining_balance_minor` decreases by `2500`; after full settlement (`remaining == 0`), the debt disappears from the open list. |
| **`F06-B02`** | `api/tests/test_sales.py` | **Cross-branch & inactive-register denial:** Receptionist for Branch A calling `GET /api/v1/registers/{register_b}/members/{member_id}/debts` receives `403 Forbidden`; inactive register returns `409 Conflict`. Existing `test_member_reads.py` (`T02`) continues to pass unchanged. |
| **`F06-F01`** | `frontend/src/api/membershipCheckoutApi.test.ts` | **Debt payment transport & idempotency header:** `listRegisterMemberOpenDebts` and `submitMembershipDebtPayment` target `/api/v1/registers/{id}/members/{memberId}/debts` and `/api/v1/registers/{id}/membership-debt-payments` with `Idempotency-Key`, and propagate `409` overpayment/already-settled errors via `MembershipCheckoutApiError`. |
| **`F06-F02`** | `frontend/src/features/reception/LiveMembershipCheckout.test.tsx` | **Partial & full cash debt repayment flow with shift gate:** In `debt_payment` mode, if the register has no open shift, the inline shift-open form gates payment submission; once open, selecting an open debt, entering a partial MXN amount, and submitting sends `amount_minor` in centavos with a stable `Idempotency-Key`, renders the repayment receipt (`remaining_balance_minor`), and triggers `onSaleCompleted`. |
| **`F06-F03`** | `frontend/src/features/reception/LiveMembershipCheckout.test.tsx` | **Overpayment & zero-amount guard + backend `409` handling:** Entering `0` or an amount greater than `remaining_balance_minor` is blocked before network dispatch; a backend `409 Conflict` surfaces the exact error alert and allows retry when the amount changes with a rotated `Idempotency-Key`. |

---

## Part 2: F07 — Review Pending Money and Transfer Payments (`P1`, Class A)

### 2.1 Objective & Business Rule Reconciliation (`D-006`, `D-017`, `D-023`, `D-031`, `R-005`)

Mount the owner/admin finance view (`/owner/expenses`, `ExpenseReport.tsx` + `CollectionsView.tsx`) in `ApiProductApp.tsx` and wire it to live `GET /api/v1/admin/pending-money` and `POST /api/v1/registers/transfer-payments/{payment_id}/review` so authorized actors can inspect pending transfers and membership debts across branches (or filtered by branch) and confirm (`status: "confirmed"`) or flag/keep pending (`status: "pending"`) bank transfer payments with idempotency protection.

#### Canonical Business Rule Alignment
1. **`D-006` / `R-005` (Transfer sale lifecycle & review states):**
   - `post_membership_transfer_sale` (`api/app/sales/queries.py:242-327`) creates an `Order`, an active `MembershipPeriod`, and a `Payment(method="transfer", status="under_review")` without mutating shift cash totals.
   - `review_membership_transfer` (`api/app/sales/queries.py:330-414`, exposed at `POST /api/v1/registers/transfer-payments/{payment_id}/review` in `api/app/api/sales.py:310-361`) transitions a transfer payment to:
     - `status = "confirmed"`: records an append-only `PaymentReviewEvent` (`api/app/db/models/payment_review_events.py:16-58`), confirms the payment, keeps membership access allowed, and removes the item from `GET /api/v1/admin/pending-money`.
     - `status = "pending"`: records an append-only `PaymentReviewEvent`, marks funds as not received (`payment.status = "pending"`), keeps the item visible in `GET /api/v1/admin/pending-money` (`api/app/api/pending_money.py:67`), and causes `evaluate_membership_access` to block check-in with `AccessDenialReason.BLOCKED_MISSING_FUNDS` (`api/tests/test_transfer_reviews.py:155-171`).
     - A transfer already marked `"pending"` can later be transitioned to `"confirmed"` once funds arrive (`api/tests/test_transfer_reviews.py:173-189`); once `"confirmed"`, any subsequent attempt to revert to `"pending"` is rejected with `409 Conflict` (`api/app/sales/queries.py:381-382`).
2. **`D-023` & `D-031` (Unified Pending Money read model & RBAC boundaries):**
   - `GET /api/v1/admin/pending-money` (`api/app/api/pending_money.py:111-194`) returns `PendingMoneyResponse`:
     - `items`: unified list of `item_type = "pending_transfer"` (`status` in `{"under_review", "pending"}`, `source_event_id = payment.id`) and `item_type = "membership_debt"` (`status = "outstanding"`, `source_event_id = debt.id`, `initial_amount_minor`, `paid_amount_minor`, `amount_minor = remaining_balance_minor`).
     - `total_items`: count of open items.
     - `total_pending_minor`: sum of `amount_minor` across all open items.
   - Enforces `Permission.FINANCE_READ` per branch (`api/app/api/pending_money.py:130-156`) for read access and `Permission.TRANSFER_REVIEW` (`api/app/api/sales.py:328`) for transfer review actions.
3. **`D-017` (Separate expense ledger vs pending money):**
   - `D-017` defines operating expenses as a separate ledger domain (`F12`, `P2`). In `ExpenseReport.tsx`, the `cobros` tab (`CollectionsView.tsx:250-273`, `"Transferencias pendientes"` / `"Aparte de lo cobrado"`) is the canonical surface for `F07`. Mounting `ExpenseReport` at `/owner/expenses` and wiring its pending-money / transfer-review state delivers `F07` without inventing premature `F12` expense-ledger endpoints.

#### Backend Readiness Check for F07
- Both backend endpoints required by F07 are **already 100% implemented, mounted in `api/app/main.py:238-239`, and covered by comprehensive backend tests** (`api/tests/test_pending_money.py` and `api/tests/test_transfer_reviews.py`):
  1. `GET /api/v1/admin/pending-money?branch_id=<optional_uuid>` (`api/app/api/pending_money.py:111-194`)
  2. `POST /api/v1/registers/transfer-payments/{payment_id}/review` (`api/app/api/sales.py:310-361`)
- Therefore, **zero backend files need to be modified for F07**.

#### What Ponytail Explicitly Skips for F07
- Zero backend edits or migrations.
- No fake backend endpoints for operating expenses (`F12` is out of scope for `F07`; existing static/empty expense tabs in `ExpenseReport.tsx` remain untouched).
- No new CSS files or visual redesign; reuse `ExpenseReport.tsx`, `CollectionsView.tsx` (`finance-pending-list`, `finance-panel`, `finance-pill`, `button ghost`), and `FinanceToolbar.tsx`.

---

### 2.2 Allowed Edit Surfaces (F07)

#### Frontend Only (Transport + Owner Finance Pending-Money & Transfer Review Wiring + Router Mount + Tests)
- `frontend/src/api/pendingMoneyApi.ts` *(new)*
- `frontend/src/api/pendingMoneyApi.test.ts` *(new)*
- `frontend/src/features/owner/finance/CollectionsView.tsx`
- `frontend/src/features/owner/ExpenseReport.tsx`
- `frontend/src/features/owner/ExpenseReport.test.tsx` *(new)*
- `frontend/src/app/ApiProductApp.tsx`
- `frontend/src/app/ApiProductApp.test.tsx`

---

### 2.3 Minimal Technical Design (F07)

#### A. Frontend Pending Money & Transfer Review Transport (`frontend/src/api/pendingMoneyApi.ts`)
1. Define TypeScript contracts matching `api/app/api/pending_money.py:23-47` and `api/app/sales/schemas.py:45-49, 86-94`:
   ```ts
   export type PendingMoneyItemType = 'pending_transfer' | 'membership_debt';
   export type TransferReviewDecisionStatus = 'confirmed' | 'pending';

   export interface PendingMoneyItemDTO {
     item_type: PendingMoneyItemType;
     branch_id: string;
     branch_name: string;
     member_id: string;
     member_number: string;
     member_name: string;
     order_id: string;
     amount_minor: number;
     currency: string;
     source_event_id: string;
     source_event_at: string;
     status: 'under_review' | 'pending' | 'outstanding' | string;
     status_event_id: string | null;
     status_event_at: string | null;
     initial_amount_minor: number | null;
     paid_amount_minor: number | null;
   }

   export interface PendingMoneyResponseDTO {
     items: PendingMoneyItemDTO[];
     total_items: number;
     total_pending_minor: number;
   }
   ```
2. Export transport functions:
   - `getPendingMoney(options?: { branchId?: string }, apiRequest?: AuthenticatedRequest): Promise<PendingMoneyResponseDTO>` calling `GET /api/v1/admin/pending-money` (appending `?branch_id=...` when `branchId` is a valid UUID).
   - `reviewTransferPayment(paymentId: string, status: TransferReviewDecisionStatus, idempotencyKey: string, apiRequest?: AuthenticatedRequest): Promise<CashMembershipSaleResponse>` calling `POST /api/v1/registers/transfer-payments/${encodeURIComponent(paymentId)}/review` with `Idempotency-Key` header and `{ status }` body.
   - `PendingMoneyApiError` class preserving `status: number` and backend `detail` message (`401`, `403`, `404`, `409`, `422`).
   - `createTransferReviewIdempotencyKey(): string` helper using `crypto.randomUUID()`.

#### B. Owner Finance UI Wiring (`ExpenseReport.tsx` & `CollectionsView.tsx`)
1. **`ExpenseReport.tsx` (`frontend/src/features/owner/ExpenseReport.tsx`):**
   - Accept optional props `{ apiRequest?: AuthenticatedRequest; initialTab?: FinanceViewTab }` (defaulting `initialTab` to `'cobros'` when `apiRequest` is provided so navigating to `/owner/expenses` in live API mode immediately surfaces the live pending money & transfer review queue, while keeping `'balance'` as default when `apiRequest` is omitted in demo mode).
   - When `apiRequest` is provided:
     - Fetch `getPendingMoney({ branchId: selectedBranchUuid }, apiRequest)` on mount and whenever the branch filter changes.
     - Derive available branches dynamically from the loaded `PendingMoneyItemDTO[]` (`branch_id` + `branch_name`) so the branch `<select>` in `FinanceToolbar` filters via `GET /api/v1/admin/pending-money?branch_id=<uuid>` (or `"ALL"` for all branches).
     - Maintain per-item review state (`reviewingPaymentId`, `reviewError`, `reviewNotice`) and a stable idempotency key map (`Record<string, string>` keyed by `${paymentId}:${decisionStatus}`) so retrying a transient failure reuses the same `Idempotency-Key`, while switching between `"confirmed"` and `"pending"` uses a distinct key.
     - When `handleReviewTransfer(paymentId: string, status: 'confirmed' | 'pending')` succeeds, re-fetch `getPendingMoney` so confirmed transfers disappear from the pending list (`total_pending_minor` and `total_items` update from backend truth) and transfers flagged as `"pending"` update their status badge (` Sin fondos / bloqueado `) and `status_event_at` timestamp.
2. **`CollectionsView.tsx` (`frontend/src/features/owner/finance/CollectionsView.tsx:250-273`):**
   - Extend `CollectionsViewProps` with optional live pending-money props:
     - `livePendingMoney?: PendingMoneyResponseDTO | null`
     - `pendingMoneyLoading?: boolean`
     - `pendingMoneyError?: string | null`
     - `reviewingPaymentId?: string | null`
     - `reviewError?: string | null`
     - `onReviewTransfer?: (paymentId: string, status: TransferReviewDecisionStatus) => void`
     - `onRetryPendingMoney?: () => void`
   - Inside the existing `<aside className="finance-panel">` (`CollectionsView.tsx:250-273`):
     - When `livePendingMoney` is present:
       - Display the authoritative backend total `mxn(livePendingMoney.total_pending_minor)` and item count (`${livePendingMoney.total_items} registros pendientes`).
       - Render `<ul className="finance-pending-list">` with every `PendingMoneyItemDTO`:
         - For `item_type === 'pending_transfer'`:
           - Show `member_name` (`member_number`), `branch_name`, formatted `source_event_at`, amount `mxn(item.amount_minor)`, and status pill (`En revisión` for `under_review`, `Fondos pendientes (acceso restringido)` for `pending`).
           - Render inline action buttons using existing `.button.ghost` styling:
             - **`Confirmar transferencia`** (`onClick={() => onReviewTransfer(item.source_event_id, 'confirmed')}`), enabled for both `under_review` and `pending` transfers (`D-006` allows confirming a previously flagged transfer once funds settle).
             - **`Marcar sin fondos`** (`onClick={() => onReviewTransfer(item.source_event_id, 'pending')}`), rendered when `item.status === 'under_review'`.
         - For `item_type === 'membership_debt'`:
           - Show `member_name` (`member_number`), `branch_name`, `Adeudo en caja`, remaining balance `mxn(item.amount_minor)` (with `Inicial: ${mxn(item.initial_amount_minor)} · Abonado: ${mxn(item.paid_amount_minor)}`), and a link/note indicating cash settlement at the branch register (`/members`).

#### C. Live Route Mount (`frontend/src/app/ApiProductApp.tsx`)
- In `frontend/src/app/ApiProductApp.tsx:101-130`:
  - Import `ExpenseReport` from `'../features/owner/ExpenseReport'`.
  - Add route branch for `/owner/expenses`:
    ```tsx
    ) : path === '/owner/expenses' ? (
      <ExpenseReport apiRequest={apiRequest} />
    ```
  - This replaces `<UnavailablePage />` on `/owner/expenses` while keeping `/owner/expenses` protected by the existing `canAccessPath('OWNER', '/owner/expenses')` RBAC guard (`frontend/src/app/navigation.ts`).

---

### 2.4 ODD Work Units: DoR & DoD (F07)

#### Work Unit `F07-T01`: Frontend Pending Money & Transfer Review API Client — [x] Completed (2026-10-29)
- **Definition of Ready (DoR):**
  - `api/app/api/pending_money.py:111-194` and `api/app/api/sales.py:310-361` verified.
- **Scope:**
  - Create `frontend/src/api/pendingMoneyApi.ts` and `frontend/src/api/pendingMoneyApi.test.ts`.
- **Definition of Done (DoD):**
  - `getPendingMoney` and `reviewTransferPayment` verified via unit tests covering query parameter serialization (`branch_id`), `Idempotency-Key` headers, and `PendingMoneyApiError` status/message propagation (`403`, `409`, `422`).

#### Work Unit `F07-T02`: Live Pending Money & Transfer Review in `ExpenseReport` and `CollectionsView` — [x] Completed (2026-10-29)
- **Definition of Ready (DoR):**
  - `F07-T01` complete; `ExpenseReport.tsx` and `CollectionsView.tsx` inspected.
- **Scope:**
  - Update `frontend/src/features/owner/finance/CollectionsView.tsx` and `frontend/src/features/owner/ExpenseReport.tsx`.
  - Create `frontend/src/features/owner/ExpenseReport.test.tsx`.
- **Definition of Done (DoD):**
  - Live `PendingMoneyResponseDTO` renders both `pending_transfer` (`under_review` and `pending`) and `membership_debt` items with accurate totals.
  - Clicking `Confirmar transferencia` dispatches `POST /api/v1/registers/transfer-payments/{source_event_id}/review` with `{ status: "confirmed" }` and `Idempotency-Key`, then refreshes `/api/v1/admin/pending-money`.
  - Clicking `Marcar sin fondos` dispatches `{ status: "pending" }`, keeping the transfer in the list with updated `"pending"` status.
  - Backend `403`/`409` errors display an accessible alert banner without crashing or losing list state.

#### Work Unit `F07-T03`: Mount `/owner/expenses` in `ApiProductApp.tsx` — [x] Completed (2026-10-29)
- **Definition of Ready (DoR):**
  - `F07-T02` complete.
- **Scope:**
  - Mount `<ExpenseReport apiRequest={apiRequest} />` at `/owner/expenses` in `frontend/src/app/ApiProductApp.tsx`.
  - Extend `frontend/src/app/ApiProductApp.test.tsx` to verify `/owner/expenses` renders the live finance view for `OWNER` and remains blocked (`Acceso no disponible` / role guard) for `RECEPTION`.
- **Definition of Done (DoD):**
  - `npx vitest run src/api/pendingMoneyApi.test.ts src/features/owner/ExpenseReport.test.tsx src/app/ApiProductApp.test.tsx` and `npm run build` pass with zero TypeScript or bundle errors.

---

### 2.5 High-Value Test Matrix (F07)

| Test ID | Target File | Scenario & Invariant Verified |
| :--- | :--- | :--- |
| **`F07-F01`** | `frontend/src/api/pendingMoneyApi.test.ts` | **Pending money & transfer review transport contract:** Verifies `GET /api/v1/admin/pending-money` (with and without `branch_id` query param) and `POST /api/v1/registers/transfer-payments/{payment_id}/review` (`status: "confirmed"` and `"pending"`, `Idempotency-Key` header), plus `PendingMoneyApiError` on `403 Forbidden` and `409 Conflict`. |
| **`F07-F02`** | `frontend/src/features/owner/ExpenseReport.test.tsx` | **Confirm transfer (`under_review` -> `confirmed`) removes item & updates total:** Renders `<ExpenseReport apiRequest={mockApi} />`, loads 1 `pending_transfer` (`under_review`, `$1,250.00`) and 1 `membership_debt` (`outstanding`, `$350.00`). Clicking `Confirmar transferencia` posts `{ status: "confirmed" }` to `/api/v1/registers/transfer-payments/{source_event_id}/review`, re-queries `/api/v1/admin/pending-money`, removes the confirmed transfer, and updates total pending money to `$350.00`. |
| **`F07-F03`** | `frontend/src/features/owner/ExpenseReport.test.tsx` | **Flag missing funds (`under_review` -> `pending`) & subsequent confirmation:** Clicking `Marcar sin fondos` posts `{ status: "pending" }`, refreshes the list showing the transfer in `"pending"` (`Fondos pendientes`) state where `Confirmar transferencia` remains available; also verifies `409 Conflict` error banner rendering when a concurrent review conflicts. |
| **`F07-F04`** | `frontend/src/app/ApiProductApp.test.tsx` | **Router mount & RBAC enforcement on `/owner/expenses`:** Navigating to `/owner/expenses` as `OWNER` mounts `ExpenseReport` and requests `/api/v1/admin/pending-money`; navigating as `RECEPTION` blocks access via the product role guard. |

---

## Part 3: Playwright Real-Browser Verification Plan (F06 & F07)

Per ODD + Ponytail rules, unit tests and build checks are necessary but not sufficient. After implementing `F06` and `F07`, a bounded verification worker will run a disposable local environment:
- **Backend:** `python api/run_dev_server.py` (seeded with an active branch, cash register, open shift, active membership plan, a member with a partial-cash membership debt, and a member with an `under_review` transfer sale).
- **Frontend:** `npm run dev` in `frontend/` with `VITE_DEMO_MODE=false` pointing at `http://127.0.0.1:8000`.

### 3.1 F06 Browser Verification Checklist (Reception / Register Debt Repayment) — [x] Verified (2026-10-29)
1. **Login & Member Inspection (`[x]`):**
   - Logged in as receptionist (`Recepcionista Centro`, PIN `123456`) on `/reception/members/8e62255e-fc39-438e-867b-c4bc0d92898e` and as owner (`admin@evogym.com`) on `/owner/members/8e62255e-fc39-438e-867b-c4bc0d92898e` against live FastAPI (`127.0.0.1:8091`) + Vite (`127.0.0.1:5191`, `VITE_DEMO_MODE=false`).
   - Verified `[data-testid="balance-warning-alert"]` (`⚠️ Saldo pendiente registrado`), `"Liquidar adeudo"` hero trigger, `"Abonar en caja ›"` counter trigger, and `"Abonar pedido"` row trigger in `Expediente`.
2. **Partial Cash Debt Repayment (`201 Created`) (`[x]`):**
   - Clicking `"Liquidar adeudo"` opened `LiveMembershipCheckout` in `debt_payment` mode and dispatched `GET /api/v1/registers/8f097590-e592-490e-8770-305df66cbb07/members/8e62255e-fc39-438e-867b-c4bc0d92898e/debts` (`200 OK`), populating order `5ccf358d-10b2-432c-af2f-ce11a57887bc` (`Plan Mensual v1`, `initial_outstanding_minor: 7500`, `remaining_balance_minor: 7500`).
   - Entered partial repayment `$25.00` MXN (`2500` minor) and submitted: `POST /api/v1/registers/8f097590-e592-490e-8770-305df66cbb07/membership-debt-payments` with `Idempotency-Key: b0ab95a9-4810-46bb-9408-fe38f83ecc06` returned `201 Created` (`receipt id: 6f5d884f-6104-4fa6-bcfd-c699f55c1d91`, `amount_minor: 2500`, `remaining_balance_minor: 5000`), and refreshed `GET /api/v1/members/8e62255e-fc39-438e-867b-c4bc0d92898e` (`pending_balance_minor: 5000`, `has_pending_balance: true`).
3. **Validation & Conflict Edge Case (`[x]`):**
   - Verified entering `0` or `75.01` MXN (exceeding `remaining_balance_minor`) rendered `role="alert"` (`"El abono en efectivo debe ser mayor a cero y no superar el saldo pendiente ($75.00)."`) and kept `"Registrar abono en efectivo"` disabled with zero network dispatch.
4. **Full Settlement & Hard Reload Persistence (`F5`) (`[x]`):**
   - Performed full document reload after the `$25.00` partial payment and verified SQLite persisted `Adeudo: $50.00 MXN` (`paid_amount_minor: 2500`, `remaining_balance_minor: 5000`).
   - Opened `"Abonar pedido"` from `Expediente`, submitted the remaining `$50.00` MXN (`5000` minor), and verified `has_pending_balance` cleared (`✓ Al corriente en pagos`, `"Liquidar adeudo"` trigger removed, `Adeudos pendientes` table cleared).
   - Performed a second full document reload and confirmed `✓ Al corriente en pagos` persisted from SQLite and `GET /api/v1/registers/8f097590-e592-490e-8770-305df66cbb07/members/8e62255e-fc39-438e-867b-c4bc0d92898e/debts` returned `[]` (`"No hay adeudos pendientes en esta sucursal para este socio."`).

### 3.2 F07 Browser Verification Checklist (Owner / Pending Money & Transfer Review) — [x] Verified (2026-10-29)
1. **Owner Navigation to `/owner/expenses` (`[x]`):**
   - Logged in as owner (`admin@evogym.com` / `Admin1234!`) against live FastAPI (`127.0.0.1:8092`) + Vite (`127.0.0.1:5192`, `VITE_DEMO_MODE=false`) and navigated to `/owner/expenses` (`Finanzas`).
   - Verified `GET /api/v1/admin/pending-money` (`200 OK`) loaded automatically in the `Cobros` tab (`Transferencias pendientes` / `Aparte de lo cobrado` panel), displaying `total_pending_minor: 65000` (`$650.00 MXN`), branch filter `<select id="pending-money-branch">` (`Todas las sucursales`, `Sucursal Centro`), `pending_transfer` (`Carlos Gomez (SOC-001) · Sucursal Centro · Orden 436a2949-a933-4e54-9ef1-1039b22e3933 · En revisión · $500.00 MXN`), and `membership_debt` (`Lucia Morales (SOC-002) · Sucursal Centro · Orden 9ea75be7-c87f-4339-8928-9590598419da · Adeudo pendiente · $150.00 MXN`).
2. **Flag Transfer as Missing Funds (`under_review` -> `pending`) (`[x]`):**
   - Clicked `"Marcar sin fondos"` on transfer payment `a4604a2a-fd4f-4461-9cc6-aa002c98584a`.
   - Verified `POST /api/v1/registers/transfer-payments/a4604a2a-fd4f-4461-9cc6-aa002c98584a/review` with `{ "status": "pending" }` and `Idempotency-Key` returned `200 OK`, updating the item badge in-place to `"Fondos pendientes"`, removing `"Marcar sin fondos"`, and keeping `"Confirmar transferencia"` enabled while `total_pending_minor` remained `$650.00 MXN`.
   - *(Cross-feature invariant check `D-006`)*: Navigated to `/owner/members/0288f831-27dc-4f81-9df5-f5286ac29e45` (`Carlos Gomez`) and verified access status changed to `"Restringido por adeudo"` (`access_status: "blocked_missing_funds"`) and check-in was blocked.
3. **Confirm Transfer Receipt (`pending` -> `confirmed`) & Hard Reload (`F5`) (`[x]`):**
   - Returned to `/owner/expenses` and clicked `"Confirmar transferencia"` on `a4604a2a-fd4f-4461-9cc6-aa002c98584a`.
   - Verified `POST /api/v1/registers/transfer-payments/a4604a2a-fd4f-4461-9cc6-aa002c98584a/review` with `{ "status": "confirmed" }` returned `200 OK`, and the refreshed `GET /api/v1/admin/pending-money` removed the confirmed transfer and reduced `total_pending_minor` from `$650.00 MXN` to `$150.00 MXN` (only Lucia's `$150.00 MXN` cash debt remained).
   - Verified on `/owner/members/0288f831-27dc-4f81-9df5-f5286ac29e45` that `Carlos Gomez`'s eligibility was restored (`checkInButtonDisabled: false`).
   - Performed a full document reload (`window.location.reload()`) on `/owner/expenses` and confirmed from SQLite persistence that the confirmed transfer remained absent (`$150.00 MXN`, `remainingItemsCount: 1`).
