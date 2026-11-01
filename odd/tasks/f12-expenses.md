# F12 — Record and review expenses (Gastos y Finanzas)

**Status: Discovery and Architecture Plan completed and approved; ready for implementation sequencing after F11 stabilization.**

**Authority & Reference:** [remaining-feature-integrations.md](remaining-feature-integrations.md) (Card F12).

---

## 1. Domain Objective & Boundaries

Enable EvoGym to record, track, and audit operational outflows across two distinct business boundaries:
1. **Petty Cash / Shift Expenses (Caja chica en turno):** Immediate cash deductions from physical cash register drawers operated by reception staff during active shifts.
2. **General OPEX / Business Expenses (Gastos operativos del negocio):** Administrative, vendor, utility, or equipment maintenance expenses registered by owners/finance operators, paid via bank transfer, debit/credit card, or corporate funds.

### Fundamental Architectural Rules (Agreed Decisions)
- **Immediate shift cash deduction:** Petty cash expenses entered in reception (`GastoModal.tsx`) deduct immediately from the shift's expected cash drawer (`expected_cash_at_close_minor = opening_cash + cash_sales - shift_expenses`). No prior approval is required for the cashier to close their shift.
- **Strict Immutability & Voiding (Option A):** Expense records are append-only; hard deletion (`DELETE`) is forbidden. If an entry is mistaken, it is marked `voided` with audit metadata (`voided_by`, `voided_at`, `void_reason`).
- **Shift Drawer Seal:** A petty cash expense linked to a shift can **ONLY** be voided while that shift remains `open`. Once the shift is closed, the physical drawer reconciliation is sealed and immutable. Any post-close corrections must be handled as adjusting financial entries in owner finances.
- **Explicit 5-Category Taxonomy:** Replaces fragile regex/inference heuristics with an explicit `category` field:
  - `mantenimiento` (máquinas, equipo, pesas, instalaciones)
  - `limpieza` (químicos, bolsas, papel, insumos de aseo)
  - `consumibles` (garrafones de agua, papelería, botiquín)
  - `servicios` (luz, agua, internet, renta, fumigación)
  - `general` (honorarios, trámites, imprevistos administrativos)
- **Zero-VPS Blob Storage (Pre-signed Cloudflare R2):**
  - Textual reference (`voucher_reference`) for ticket folio, invoice UUID, or transfer tracking number.
  - Optional `evidence_url` for ticket photos.
  - Image pipeline: browser-side compression (canvas to WebP, ~200 KB) followed by direct PUT to Cloudflare R2 via backend-generated pre-signed URLs. Zero image storage on the VPS filesystem; zero bandwidth saturation.

---

## 2. Data Contract & Database Schema

### Table: `expenses`

| Column | Type | Constraints / Description |
|---|---|---|
| `id` | `UUID` | Primary Key, `default=uuid4` |
| `branch_id` | `UUID` | `FK -> branches.id, ondelete='RESTRICT'`, indexed |
| `shift_id` | `UUID | NULL` | `FK -> shifts.id, ondelete='RESTRICT'`, indexed. Populated if registered from a cash drawer shift |
| `category` | `VARCHAR(32)` | `CheckConstraint("category IN ('mantenimiento', 'limpieza', 'consumibles', 'servicios', 'general')")` |
| `concept` | `VARCHAR(255)` | Detailed expense description (e.g. "Reparación polea caminadora 3") |
| `payee_name` | `VARCHAR(160)` | Vendor, provider, or responsible payee name |
| `amount_minor` | `BIGINT` | Minor currency units (cents MXN), `CheckConstraint('amount_minor > 0')` |
| `payment_method` | `VARCHAR(32)` | `CheckConstraint("payment_method IN ('cash', 'transfer', 'card', 'other')")`. Shift expenses default to `'cash'` |
| `voucher_reference` | `VARCHAR(120) | NULL` | Ticket folio, invoice number, or bank tracking code |
| `evidence_url` | `VARCHAR(512) | NULL` | Direct Cloudflare R2 URL to compressed ticket photo |
| `recorded_by_id` | `UUID` | `FK -> staff_users.id`, operator who registered the expense |
| `status` | `VARCHAR(24)` | `default='active', CheckConstraint("status IN ('active', 'voided')")` |
| `voided_at` | `TIMESTAMPTZ | NULL` | Timestamp when voided |
| `voided_by_id` | `UUID | NULL` | `FK -> staff_users.id`, user who voided the record |
| `void_reason` | `TEXT | NULL` | Mandatory reason when voiding an expense |
| `created_at` | `TIMESTAMPTZ` | `server_default=now()` |
| `updated_at` | `TIMESTAMPTZ` | `server_default=now(), onupdate=now()` |

### Shift Relationship & Cash Drawer Math
When a shift is queried for closure (`api/app/shifts/queries.py`):
```python
total_shift_expenses_minor = sum(
    e.amount_minor for e in shift.expenses if e.status == 'active' and e.payment_method == 'cash'
)
expected_cash_at_close_minor = opening_cash_minor + total_cash_sales_minor - total_shift_expenses_minor
```

---

## 3. API Endpoints

### 1. `POST /api/v1/expenses`
- **Role:** Authenticated staff or admin.
- **Rules:**
  - If `shift_id` is passed, caller must be assigned to the shift or have branch admin rights, and the shift MUST be in status `'open'`.
  - Payment method defaults to `'cash'` when `shift_id` is present.
  - Body validated against minor unit amount, required concept, payee, and valid 5-category enum.

### 2. `GET /api/v1/expenses`
- **Role:** Authenticated staff (own shift) or admin (branch / all).
- **Query Params:** `branch_id`, `shift_id`, `category`, `from_date`, `to_date`, `status`, `page`, `page_size`.
- **Response:** Paginated list of expense DTOs, including aggregated `total_amount_minor` for the active filter.

### 3. `POST /api/v1/expenses/{expense_id}/void`
- **Role:** Authenticated staff (own open shift only) or admin.
- **Rules:**
  - Rejects with `409 Conflict` if the linked shift is already `'closed'`.
  - Requires `reason` in payload.
  - Updates status to `'voided'`, records timestamp and user ID.

### 4. `POST /api/v1/expenses/presigned-upload-url`
- **Role:** Authenticated staff or admin.
- **Payload:** `{ "content_type": "image/webp", "file_size_bytes": 204800 }`
- **Response:** `{ "upload_url": "https://...r2.cloudflarestorage.com/...", "public_url": "https://cdn.../expenses/uuid.webp" }`
- **Graceful degradation:** If Cloudflare R2 credentials are not configured in environment, returns `501 Not Implemented` with a clean error message, allowing frontend to fall back gracefully to text-only `voucher_reference`.

---

## 4. Frontend Integration Surfaces

1. **Reception Shift Modal (`frontend/src/features/reception/GastoModal.tsx`):**
   - Connect to real `POST /api/v1/expenses` with active `shiftId`.
   - Add explicit `<select>` for `category` (5 standard categories).
   - Add optional input for `voucher_reference` ("Folio o ticket").
   - Add optional camera/file input with client-side canvas compression to WebP before upload.
   - Show active shift expense list with a "Anular" button (with confirmation dialog).

2. **Owner Expenses View (`frontend/src/features/owner/ExpenseReport.tsx` -> `ExpensesView.tsx`):**
   - Replace demo empty state / local selector in live mode with `getExpenses(apiRequest, filters)`.
   - Add "Registrar Gasto del Negocio" button opening an owner expense modal:
     - Allows selecting branch, category, payment method (Transferencia, Tarjeta, Efectivo general), amount, concept, payee, reference, and optional photo.
   - Display real filtered metrics and TanStack chart mapped from server categories.
   - TanStack table with column for status (`active` vs `voided`), category badge, concept, payee, payment method, voucher reference / photo link, and action to void.

---

## 5. Verification Strategy & Acceptance Criteria

- [ ] **Contract tests (API):**
  - Create shift expense with valid fields &rarr; asserts `201 Created` and verifies `shift.expected_cash_at_close_minor` reflects deduction.
  - Reject expense with negative or zero amount &rarr; `422 Unprocessable Entity`.
  - Reject expense on closed shift &rarr; `409 Conflict`.
  - Void expense on open shift &rarr; asserts status `voided` and verifies shift expected cash restores amount.
  - Reject voiding expense on closed shift &rarr; `409 Conflict`.
  - Admin OPEX expense without `shift_id` &rarr; asserts `201 Created` with `payment_method='transfer'`.
- [ ] **Frontend tests:**
  - `GastoModal.test.tsx`: validates 5 categories in dropdown, validates required fields, handles successful submission without demo provider.
  - `ExpenseReport.test.tsx`: verifies live API data fetch, category filtering, and owner modal submission.
- [ ] **E2E / Browser Acceptance:**
  - Cashier opens shift &rarr; records $150 MXN petty cash for cleaning products with ticket reference &rarr; closes shift verifying expected cash reconciles.
  - Owner opens `/owner/expenses` &rarr; registers $2,500 MXN machine repair by transfer &rarr; verifies chart and table reflect the expense under `mantenimiento`.
