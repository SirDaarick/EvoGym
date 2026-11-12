# EvoGym application flows - B. Members and access

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

## 4. Members and memberships

### 4.1 Search, list, detail
- **Status:** Partial. `MemberDetail.tsx` still shows demo notes/habits although the backend has notes endpoints.
- **Code:** `app/ApiMembers.tsx`, `features/members/MemberSearch.tsx` — `members.py:86-138`, `member_reads.py:15-57`.

### 4.2 Register a new member
- **Actor:** receptionist. **Status:** Live (`reception/LiveMemberRegistration.tsx`); demo variant `members/NewMemberRegistration.tsx`.
- **Ideal flow:** capture name and phone/WhatsApp. People may share a phone number. When the number matches existing members, reception sees their names and can select an existing member or continue registering another person. Neither phone nor the combination of name and phone uniquely identifies a member. Quick registration should also work offline (D-027).
- **Implementation:** API create and update allow shared phones, and reception can select a matching member or register another person. The migration path (`0062`–`0065`) is verified on SQLite, offline SQL generation, and disposable Docker PostgreSQL (`evogym-postgres-dev:5433`).
- **Code:** `members.py:102`.

### 4.3 Sell or renew a membership (cash)
- **Actor:** receptionist. **Status:** Live.
- **Ideal flow:**
  1. Select member and plan.
  2. Pay in cash (partial payment allowed; remainder shown as a warning, D-013).
  3. Membership starts on payment; an early renewal starts from the current end date.
- **Rules:** calendar months with end-of-month clamp; validity is `[start, end)` in branch time (D-005).
- **Code:** `reception/LiveMembershipCheckout.tsx`, `api/membershipCheckoutApi.ts` — `sales.py:111`.

### 4.4 Sell a membership by bank transfer
- **Actor:** receptionist records; admin reviews. **Status:** Live.
- **Ideal flow:**
  1. Receptionist records the voucher; the membership is `under_review` and starts immediately.
  2. Admin marks it `confirmed`, or `pending` if the funds are not in the bank.
  3. `pending` restricts only that period; its dates keep running.
- **Rules:** D-006, R-005.
- **Code:** `api/pendingMoneyApi.ts` — `sales.py:141,152`, `pending_money.py:13`.

### 4.5 Pay down membership debt
- **Actor:** receptionist. **Status:** Live.
- **Ideal flow:** explicit payment against a specific order, in the current shift, never larger than the balance.
- **Code:** `reception/PendingBalanceModal.tsx` — `sales.py:122,130`.

### 4.6 Eligibility records (student/kids discounts)
- **Status:** **Missing UI** — API only (`members.py:146-162`).

### 4.7 Day-pass / visit sales
- **Status:** **Demo-only** (`payments/MembershipPayment.tsx`, `sales/Sales.tsx`); no backend exists.

### 4.8 Inactivity
- **Approved rule:** a member becomes inactive after 31 days without renewing after expiry. Inactive is an informational status, not an additional access restriction.
- **Implementation:** verified in the caller's branch timezone across `GET /api/v1/members` and `GET /api/v1/members/{id}` (`members/queries.py`, `members/service.py`). Loyalty behavior is outside the current scope; the meaning of member suspension remains undefined.

## 5. Member credit (saldo a favor)
- **Actor:** receptionist. **Status:** Live.
- **Ideal flow:**
  1. Deposit credit into the member's balance; every movement is listed.
  2. Credit can be applied when paying glove rentals, locker assignments/renewals, rental receivables and member debts.
- **Code:** `features/members/MemberCreditPanel.tsx` — `api/app/api/member_credit.py:19,31`, `api/app/credit/`.
- **Check:** confirm that every spend path writes a credit movement (not verified for this document).

## 6. Access / check-in

### 6.1 Member check-in
- **Actor:** receptionist. **Status:** Live.
- **Ideal flow:**
  1. Look up the member and check eligibility.
  2. Expired membership is always denied; entry only at the membership's own branch.
  3. Pending debt requires explicit confirmation before entry. Confirmed check-ins appear in the branch's administrator alert center (R-007). Offline confirmations are synchronized with the entry; an uncertain online request is retried with its original idempotency key.
  4. A repeat check-in within 5 minutes counts as the same visit (D-033).
  5. On a connectivity failure, record the entry locally and synchronize later; reception sees a discreet pending indicator and log, while the member need not see technical synchronization status. Server denials and errors must not silently become offline entries.
- **Code:** `app/ApiMembers.tsx:436` — `member_check_ins.py:34`.

### 6.2 Single-entry trial ("clase muestra")
- **Status:** Partial. Allowed once per person ever, consumed only on a successful entry (D-019). `ApiMembers.tsx:335` hard-codes `class_samples: []`, so the UI is not wired.
- **Code:** `member_check_ins.py:16`.

### 6.3 Admin access decision
- **Status:** **Missing UI.** Admin blocks or restores a membership period (`membership_access.py:16`).

### 6.4 Owner traffic analytics
- **Actor:** owner. **Status:** Partial (mixed with demo code).
- **Code:** `features/owner/AttendanceAnalytics.tsx` — `owner_attendance.py:14`.

## 7. Classes
- **Status:** **Missing.** No classes API or screen; the only related concept is the single-entry trial (6.2).


## Gaps summary

| # | Gap | Where |
| --- | --- | --- |
| 2 | Trial entry not wired in the UI | `app/ApiMembers.tsx:335` |
| 7 | `MemberDetail` shows demo notes despite live notes endpoints | `features/members/MemberDetail.tsx`, `members.py:122-138` |
| 8 | Classes module does not exist | — |

Gap numbers match the original index. Gap 3 spans parts A, B and C and is listed here only.
