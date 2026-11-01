# F13 — Run weekly payroll (Nómina semanal del equipo)

**Status: Discovery and Architecture Plan completed and approved; ready for implementation sequencing.**

**Authority & Reference:** [remaining-feature-integrations.md](remaining-feature-integrations.md) (Card F13).

---

## 1. Domain Objective & Boundaries

Establish an end-to-end, weekly payroll run engine and interface for gym owners to manage, adjust, disburse, and audit staff compensation without operational or accounting friction.

### Fundamental Architectural Rules (Agreed Decisions)
- **Model A (Predictable Fixed Base Salary):** Compensation is calculated from a weekly fixed base salary per employee profile, not multiplied by clock-in hours from `staff_attendance.py`. Avoids payroll blockages when employees forget to punch out.
- **Weekly Pay Cycle:** The gym runs payroll on a weekly cadence ($20,000 MXN total baseline across the 9 team members, corresponding to $80,000 MXN/month fixed payroll OPEX).
- **Salary Advances (Adelantos en $ MXN):**
  - Owner-transferred: Advances during the week are paid via direct bank transfer by the owner; they **NEVER** touch the reception cash register drawer (`Shift`).
  - Captured in money ($ MXN), with optional UI helper shortcuts showing 1 day equivalent.
  - Live recalculation: Once recorded, advances reduce the pending net pay immediately in the weekly view.
- **Per-Employee Payment Lifecycle:**
  - Weekly entries have individual status: `pending` vs `paid`.
  - Owner can disburse and mark employees individually (e.g., as bank transfers clear).
- **Automatic Financial Expense Integration (F12 / P&L):**
  - Marking a payroll entry as `paid` automatically records an expense in Finanzas (`expenses` table) with category `general` / concept `Nómina semanal`, ensuring the business P&L under `/owner/expenses` reflects real cash outflows.
- **Mounted UI Boundary (In-table Modal, No Extra Tabs):** Integrated directly into the existing staff table in `/owner/staff` ([StaffManagement.tsx](../../frontend/src/features/owner/StaffManagement.tsx)). No new tabs or top-level routes.
- **Smart Contextual Action Button:**
  - Non-paydays (mid-week): Button renders as `[ Adelantar ]`.
  - Payday window (e.g., Friday/Saturday): Button renders as `[ Pagar $X,XXX ]`.
  - Once paid: Row displays `🟢 Pagado` with action to `[ Adelantar próx. semana ]`.
- **Compound Payout (Current Pay + Next Week Advance):**
  - Inside the `Pagar` modal on payday, the owner can disburse current week net pay PLUS an optional advance for the next week in a single transfer.
  - Automatically settles the current run and queues the advance to be deducted in next week's payroll.

---

## 2. Staff Salary Catalog (From Business Excel SSOT)

| Employee | Position / Department | Daily Rate | Weekly Base | Monthly Reference |
|---|---|---|---|---|
| **Silvia** | Staff / Recepción | $400 MXN | $2,000 MXN | $8,000 MXN |
| **Sheila** | Recepción | $500 MXN | $2,500 MXN | $10,000 MXN |
| **Emigdio** | Entrenador | $700 MXN | $3,500 MXN | $14,000 MXN |
| **Alan** | Staff | $400 MXN | $2,000 MXN | $8,000 MXN |
| **Maho** | Limpieza / Staff | $300 MXN | $1,500 MXN | $6,000 MXN |
| **Mikel** | Entrenador | $500 MXN | $2,500 MXN | $10,000 MXN |
| **Charly** | Entrenador | $500 MXN | $2,500 MXN | $10,000 MXN |
| **Iñaky** | Staff | $200 MXN | $1,000 MXN | $4,000 MXN |
| **Tadeo** | Entrenador | $500 MXN | $2,500 MXN | $10,000 MXN |
| **TOTAL** | — | **$4,000 MXN/día** | **$20,000 MXN/sem** | **$80,000 MXN/mes** |

---

## 3. Data Contract & Database Schema

### Table: `payroll_runs`
Represents one weekly payroll period for a branch.

| Column | Type | Constraints / Description |
|---|---|---|
| `id` | `UUID` | Primary Key, `default=uuid4` |
| `branch_id` | `UUID` | `FK -> branches.id, ondelete='RESTRICT'`, indexed |
| `period_start` | `DATE` | Start of weekly cycle (e.g. Monday) |
| `period_end` | `DATE` | End of weekly cycle (e.g. Sunday) |
| `status` | `VARCHAR(24)` | `default='open', CheckConstraint("status IN ('open', 'completed')")` |
| `total_gross_minor` | `BIGINT` | Sum of base salaries |
| `total_net_minor` | `BIGINT` | Sum of net payable amounts |
| `created_at` | `TIMESTAMPTZ` | `server_default=now()` |
| `completed_at` | `TIMESTAMPTZ | NULL` | When all entries are settled |

### Table: `payroll_entries`
Individual employee payout line for a specific weekly run.

| Column | Type | Constraints / Description |
|---|---|---|
| `id` | `UUID` | Primary Key, `default=uuid4` |
| `run_id` | `UUID` | `FK -> payroll_runs.id, ondelete='CASCADE'`, indexed |
| `staff_profile_id` | `UUID` | `FK -> staff_roster_profiles.id, ondelete='RESTRICT'`, indexed |
| `base_salary_minor` | `BIGINT` | Base weekly pay in minor units (e.g. 350000) |
| `advances_minor` | `BIGINT` | Sum of advances deducted in the week, `default=0` |
| `bonuses_minor` | `BIGINT` | Additional manual bonuses, `default=0` |
| `deductions_minor` | `BIGINT` | Absences or other penalties, `default=0` |
| `net_pay_minor` | `BIGINT` | Calculated: `base - advances - deductions + bonuses` |
| `status` | `VARCHAR(24)` | `default='pending', CheckConstraint("status IN ('pending', 'paid')")` |
| `paid_at` | `TIMESTAMPTZ | NULL` | Timestamp of disbursement |
| `payment_method` | `VARCHAR(32) | NULL` | `'transfer'`, `'cash'`, `'other'` |
| `expense_id` | `UUID | NULL` | `FK -> expenses.id, ondelete='SET NULL'`, linked finance outflow |
| `created_at` | `TIMESTAMPTZ` | `server_default=now()` |
| `updated_at` | `TIMESTAMPTZ` | `server_default=now(), onupdate=now()` |

### Table: `payroll_advances`
Audit trail of salary advances transferred to an employee before payday.

| Column | Type | Constraints / Description |
|---|---|---|
| `id` | `UUID` | Primary Key, `default=uuid4` |
| `run_id` | `UUID` | `FK -> payroll_runs.id, ondelete='CASCADE'`, indexed |
| `staff_profile_id` | `UUID` | `FK -> staff_roster_profiles.id, ondelete='RESTRICT'`, indexed |
| `amount_minor` | `BIGINT` | Advance amount in minor units (> 0) |
| `notes` | `TEXT | NULL` | Reason or reference (e.g. "Adelanto personal") |
| `disbursed_at` | `TIMESTAMPTZ` | When the transfer was made |
| `recorded_by_id` | `UUID` | `FK -> staff_users.id`, user who registered the advance |
| `created_at` | `TIMESTAMPTZ` | `server_default=now()` |

---

## 4. API Endpoints

### 1. `GET /api/v1/payroll/runs/current`
- **Role:** Authenticated admin with finance/payroll permission.
- **Description:** Returns the active weekly run for the selected branch. If none exists, creates or initializes the draft for the current week using active roster profiles and their configured weekly salaries.

### 2. `POST /api/v1/payroll/runs/{run_id}/advances`
- **Role:** Authenticated admin.
- **Payload:** `{ "staff_profile_id": UUID, "amount_minor": 50000, "notes": "Adelanto gasolina" }`
- **Behavior:** Persists `payroll_advances` record, recalculates `payroll_entries.advances_minor` and `net_pay_minor` for that employee.

### 3. `POST /api/v1/payroll/entries/{entry_id}/pay`
- **Role:** Authenticated admin.
- **Payload:** `{ "payment_method": "transfer", "notes": "SPEI BBVA" }`
- **Behavior:**
  - Marks entry as `paid` with `paid_at=now()`.
  - Automatically inserts an expense in `expenses`:
    `category='general'`, `concept='Nómina semanal: [Staff Name]'`, `amount_minor=entry.net_pay_minor`, `payment_method=payment_method`.
  - Links `expense_id` back to the entry.
  - If all entries in the run are `paid`, updates run status to `completed`.

---

## 5. UI & Component Integration

In `/owner/staff` ([StaffManagement.tsx](../../frontend/src/features/owner/StaffManagement.tsx)):
1. **In-Table Weekly Summary & Contextual Action (No New Tabs):**
   - In the existing staff table (`StaffTable`), add weekly status indicator in the Sueldo column:
     - `🟡 Pendiente ($3,000 netos)` vs `🟢 Pagado esta semana`.
   - In the `Acciones` column, add a contextual button:
     - **Mid-week (Lunes a Jueves):** `[ Adelantar ]` &rarr; opens advance modal.
     - **Payday window (Viernes / Sábado):** `[ Pagar $X,XXX ]` &rarr; opens payout modal.
     - **Already paid:** `🟢 Pagado` with action `[ Adelanto próx. semana ]`.

2. **Modal `Pagar Nómina` (Payday):**
   - Displays breakdown:
     - Sueldo base semanal ($3,500)
     - Menos adelantos de la semana actual (-$500)
     - **Neto semanal adeudado: $3,000 MXN**
   - **Opción para adelanto de la próxima semana:**
     - Toggle / Checkbox: `[x] Incluir adelanto para la próxima semana`
     - Input de monto ($ MXN): `[ $1,000 ]` (con botón rápido: "1 día = $700")
   - **Total a transferir hoy:** **$4,000 MXN** ($3,000 nómina + $1,000 adelanto).
   - Selector de método: Transferencia bancaria (predeterminado) o Efectivo.
   - Botón: `Confirmar pago ($4,000)`.

3. **Modal `Registrar Adelanto` (Entre semana):**
   - Nombre de colaborador y sueldo diario de referencia.
   - Input de monto ($ MXN) con botón "1 día ($XXX)".
   - Notas opcionales y método de pago (transferencia bancaria).
   - Botón: `Registrar adelanto`.

---

## 6. Verification Strategy & Acceptance Checklist

- [ ] **API Tests:**
  - Initialize current week run with active profiles &rarr; verifies correct base salaries.
  - Post advance of $500 MXN to Emigdio &rarr; asserts net pay reduces from $3,500 to $3,000.
  - Pay entry &rarr; asserts status `paid`, verifies new row in `expenses` matching amount and vendor name.
  - Reject negative advances or advances exceeding weekly salary &rarr; `422 Unprocessable Entity`.
  - Non-admin callers &rarr; `403 Forbidden`.
- [ ] **Frontend Tests:**
  - Renders 9 team members with proper base salaries.
  - Submitting an advance immediately updates the row's net pay.
  - Clicking pay opens confirmation and marks row green on success.
- [ ] **P&L E2E Check:**
  - Disbursing payroll entry updates `/owner/expenses` balance chart and list under `ExpensesView`.
