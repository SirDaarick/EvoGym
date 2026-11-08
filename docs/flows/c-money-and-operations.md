# EvoGym application flows - C. Money and operations

How each end-to-end flow should ideally work, plus its current implementation status.
Rule ids (D-xxx, R-xxx, BK-xxx) refer to `docs/backend-plan/02-business-rules-and-decisions.md`.
API paths omit the `/api/v1` prefix. Code paths are relative to the repository root.

## Roles

| Role | Access | Notes |
| --- | --- | --- |
| Owner / admin | Email + password | `is_owner` unlocks Permissions; `can_manage_employees` unlocks Staff and Alerts. |
| Receptionist | PIN on the shared reception PC (kiosk) or a paired personal phone | Cannot see financial history, payroll or audit logs (D-011, D-012). |

## Live vs demo screens

A screen is **live** when it calls the API and **demo** when it runs on fake data in
`frontend/src/demo` (enabled with `evogym:demo-mode` in sessionStorage). Live screens are
selected in `frontend/src/app/ApiProductApp.tsx:116-151`; any route not listed there shows
an "API not connected" page.

Status values used below: **Live**, **Partial** (mixed live/demo), **Demo-only**, **Missing UI**
(API exists, no screen), **Missing** (neither).

---

## 3. Reception shifts and cash

### 3.1 Open shift
- **Actor:** receptionist. **Status:** Partial (modal still imports demo helpers).
- **Ideal flow:**
  1. Pick a register.
  2. Count bills and coins (mandatory).
  3. Accept the presented inventory, recording only exceptions.
  4. Cash left pending from an overtime handoff is linked to this shift.
- **Rules:** BK-021, D-014. Known deviation: the API and modal accept a manual opening total without denominations.
- **Code:** `features/shifts/Shifts.tsx`, `ShiftOpenModal.tsx` — `shifts.py:115`.

### 3.2 Close shift (cash count)
- **Actor:** receptionist. **Status:** Partial.
- **Ideal flow:**
  1. Count cash by denomination.
  2. Server computes expected cash and the difference, then freezes the result.
  3. Repeating the same count returns the frozen result; a different count conflicts.
- **Rules:** state machine open → closing → closed (R-004). In practice close is atomic under register and shift locks: `open` goes straight to `closed` and `closing` is never entered.
  Offline closes with a manual total sync `counted_cash_minor` instead of a fabricated denomination.
- **Code:** `ShiftCloseDialog.tsx` — `shifts.py:120,135`.

### 3.3 Overtime sale
- **Actor:** receptionist. **Status:** Live/demo mix.
- **Ideal flow:** a sale after the cash count is attributed to the closed shift; its money goes to the next shift or stays pending.
- **Rule:** overtime means no shift is open (server decision). Live screens read the open-shift state; the clock heuristic only runs in demo.
- **Code:** `features/reception/OvertimeSaleToggle.tsx`.

### 3.4 Registers and terminals setup
- **Status:** **Missing UI** — API only (`shifts.py:77-100`).

### 3.5 Shift expense and cash contribution
- **Actor:** receptionist (void: admin). **Status:** Live or demo depending on route.
- **Ideal flow:** record an expense ("gasto") or an extra cash contribution with evidence upload; expenses can be voided by an admin (owner expense screen) and the shift balance reflects it.
- **Code:** `reception/GastoModal.tsx`, `ExtraModal.tsx` — `expenses.py:38-79`.

## 8. Rentals (gloves and lockers)

### 8.1 Glove rental
- **Actor:** receptionist. **Status:** Live, online only.
- **Ideal flow:** same-day rental; gloves must be returned before the member leaves (D-008, R-010); payable with cash, card or member credit. The API flags an active glove rental from a previous day as `overdue`; it is not blocked.
- **Code:** `reception/GuantesModal.tsx` — `rentals.py:50,116`.

### 8.2 Locker rental
- **Actor:** receptionist, admin for cancellation review. **Status:** Live, online only.
- **Ideal flow:** monthly rental following available → occupied → expired → 2-week grace → evicted. The server derives `lifecycle_status` (active, expired for 1-14 days past `ends_on`, evicted after) in branch-local time; the database stores only active/returned/released/cancelled. Supports renew, release, cancel with refund preview, card payment attempts, receivables (unpaid charges) and admin review of cancellations.
- **Code:** `reception/CasillerosModal.tsx`, `rentalPayments.tsx` — `rentals.py:31-149`; capability in `offline/capabilities.ts:58`.

## 9. Products, sales and inventory

### 9.1 Product sale (cash or card terminal)
- **Actor:** receptionist; admin can resolve a stuck sale. **Status:** Live.
- **Ideal flow:**
  1. Build the cart and pick the payment method.
  2. Cash: complete the sale. Card: create a card intent on the terminal (Mercado Pago Point), then the sale.
  3. An interrupted sale keeps a saved sale intent that can be resolved later.
- **Gap:** provider policies are unresolved (D-017, D-023, D-024).
- **Code:** `app/ApiReceptionHome.tsx`, `reception/home/useProductSaleSubmit.ts`, `PointPaymentModal.tsx` — `sales.py:29-82`, `admin_staff_accounts.py:24,29`.

### 9.2 Product return
- **Ideal flow:** same day, with receipt. Unopened goes back to stock, opened goes to waste; refund to the original payment method (D-007), enforced by the API (409 on mismatch). One Point card intent funds one sale only.
- **Code:** `reception/DevolucionesModal.tsx` — `sales.py:92,100`.

### 9.3 Supplement servings
- **Ideal flow:** opening a container moves stock to bar consumption; each scoop decrements it (D-009).
- **Code:** `SuplementosModal.tsx` — `inventory.py:139`.

### 9.4 Inventory catalog, initial stock, movements
- **Status:** Live. Valuation and variance policy unresolved (D-015).
- **Code:** `features/inventory/*` — `inventory.py:93-161`.
- **Demo-only:** waste screen `MermaModal.tsx`, `InventoryAnalytics`.

## 14. Owner reports, finance, Gimi AI and notifications
- **Overview and history:** Live. `owner/LiveOverview.tsx`, `LiveHistory.tsx` — `owner_overview.py:23`, `owner_history.py:14`; the `Overview.tsx` / `History.tsx` wrappers render the live components whenever `apiRequest` is passed (demo only without it). Still hardcoded: Gimi resolution rate, average duration, gym capacity (50). The headline "Cobros confirmados" equals the sum of the by-method rows.
- **Finance:** `owner/ExpenseReport.tsx`. Expenses and payroll are live (`expenses.py:60-73`); budget and fixed costs are demo-only (`demo/fixedCostsStore`); Balance and Collections are mixed.
- **Gimi AI:** knowledge-base management, notification delivery, owner chat (`features/gimi/*` — `owner_gimi.py:24-132`). Member WhatsApp via `whatsapp_webhook.py`; identity is verified by phone match (D-022).
- **Missing:** Mercado Pago online checkout links (D-021, D-024).

---


## Gaps summary

| # | Gap | Where |
| --- | --- | --- |
| 6 | Demo-only screens: day-pass sales, waste, budget/fixed costs | `sales/Sales.tsx`, `MermaModal.tsx`, `demo/fixedCostsStore` |

Gap numbers match the original index. Gap 3 spans parts A, B and C and is listed here only.
