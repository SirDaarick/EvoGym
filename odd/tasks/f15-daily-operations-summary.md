# F15 — Review owner daily operations summary (Centro de Mando Ejecutivo 360°)

**Status: Discovery and Architecture Plan completed and approved; ready for implementation sequencing.**

**Authority & Reference:** [remaining-feature-integrations.md](remaining-feature-integrations.md) (Card F15).

---

## 1. Domain Objective & Boundaries

Provide the gym owner with an executive, high-level operational overview at login (`/owner/overview`) that summarizes the entire business in 30 seconds. Answers the daily executive question: *"How is my branch performing today, and what requires my immediate attention?"*

### Fundamental Architectural Rules (Agreed Decisions)
- **Executive Synthesis ("Never Too Much Information"):**
  - Designed as an actionable command center, not an exhaustive data dump. Each pillar displays a maximum of 3 key indicators with clear action links to deep views.
- **Default Today Horizon:**
  - Opens by default showing the live operational pulse of **TODAY** (`now` in branch timezone `America/Mexico_City`), with a simple date picker to audit past dates.
- **Bento 360° Architecture:**
  - Organized into 4 operational pillars plus an executive real-time pulse strip.
- **Lightweight Backend Aggregation:**
  - Powered by a dedicated single endpoint `GET /api/v1/owner/overview/daily` aggregating authoritative persisted data across shifts, sales, attendance, payroll, and inventory.
- **Mounted UI Seam:**
  - Directly replaces `<UnavailablePage title="Resumen del negocio" />` at `/owner/overview` inside [ApiProductApp.tsx](../../frontend/src/app/ApiProductApp.tsx).

---

## 2. Bento Grid 360° Visual Hierarchy

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 🟢 PULSO EN VIVO: Aforo (24 / 80 socios · 30%) · Cobrado hoy ($8,450 MXN)│
├───────────────────────────┬─────────────────────────────────────────────┤
│ 💰 1. CAJA Y FINANZAS     │ 👥 2. SOCIOS Y AFLUENCIA                    │
│ Cobrado hoy: $8,450 MXN   │ Visitas hoy: 112 check-ins                  │
│ Caja de turnos: Cuadrada  │ Membresías: 3 nuevas / 5 renovaciones       │
│ ⚠️ 1 Transferencia pend.  │ Aforo pico: 19:00 hrs                       │
│ [ Ir a Finanzas › ]       │ [ Ver Afluencia › ]                         │
├───────────────────────────┼─────────────────────────────────────────────┤
│ 👔 3. EQUIPO Y NÓMINA     │ 📦 4. INVENTARIO Y OPERACIONES              │
│ Próximo pago: Sábado      │ ⚠️ 2 productos en stock crítico             │
│ Nómina estimada: $20,000  │ 🔔 1 casillero vencido sin desalojo         │
│ Staff hoy: 3 en turno     │                                             │
│ [ Gestionar Nómina › ]    │ [ Ver Alertas › ]                           │
└───────────────────────────┴─────────────────────────────────────────────┘
```

1. **Top Pulse Strip (Real-Time):**
   - Live occupancy count & percentage.
   - Total confirmed revenue collected today.
   - Open operational alerts indicator badge.
2. **Pilar 1: Caja & Finanzas:**
   - Total confirmed collections today (Cash vs. Card).
   - Cash drawer discrepancy status across closed shifts (`Cuadrada` or `Faltante -$XXX`).
   - Pending transfers count & volume awaiting owner review (F07).
   - Action link &rarr; `/owner/expenses` / `/owner/shifts`.
3. **Pilar 2: Socios & Afluencia:**
   - Daily unique check-in attendance volume.
   - New membership sales & renewals executed today (F04).
   - Historical peak hour observed today.
   - Action link &rarr; `/owner/attendance` / `/owner/members`.
4. **Pilar 3: Equipo & Nómina (F13):**
   - Next scheduled weekly payday reminder.
   - Estimated weekly payroll total ($20,000 MXN base).
   - Active staff on shift today and recorded absences.
   - Action link &rarr; `/owner/staff`.
5. **Pilar 4: Inventario & Operaciones (F09, F11):**
   - Products below reorder threshold.
   - Active locker expirations and rental alerts.
   - Action link &rarr; `/owner/inventory` / `/owner/alerts`.

---

## 3. Data Contract & Backend API Endpoint

### `GET /api/v1/owner/overview/daily`
- **Role:** Authenticated admin/owner (`OWNER` or `ADMIN` role bundle).
- **Query Params:**
  - `date`: `YYYY-MM-DD` (optional, defaults to current date in branch timezone).
  - `branch_id`: `UUID` (optional, defaults to caller's active branch).
- **Response DTO:**
  ```json
  {
    "date": "2026-11-01",
    "branch_id": "uuid",
    "pulse": {
      "live_occupancy_count": 24,
      "gym_capacity": 80,
      "live_occupancy_percent": 30,
      "total_confirmed_revenue_minor": 845000,
      "open_alerts_count": 1
    },
    "finances": {
      "total_confirmed_minor": 845000,
      "cash_minor": 520000,
      "card_minor": 325000,
      "shifts_closed_count": 2,
      "shift_discrepancy_minor": 0,
      "has_cash_shortfall": false,
      "pending_transfers_count": 1,
      "pending_transfers_minor": 65000
    },
    "attendance": {
      "total_check_ins": 112,
      "peak_hour": "19:00",
      "memberships_sold_today": 3,
      "memberships_renewed_today": 5
    },
    "staff": {
      "next_payday": "2026-11-07",
      "days_until_payday": 6,
      "estimated_payroll_minor": 2000000,
      "staff_on_duty_count": 3,
      "staff_absent_count": 0
    },
    "operations": {
      "low_stock_products_count": 2,
      "overdue_lockers_count": 1,
      "critical_alerts_count": 1
    }
  }
  ```

---

## 4. UI Mount & Component Integration

1. In `frontend/src/app/ApiProductApp.tsx`:
   - Mount `<Overview apiRequest={apiRequest} />` when `pathname === '/owner/overview' && isAdmin && admin.status === 'authenticated'`.
2. In `frontend/src/features/owner/Overview.tsx`:
   - Add `apiRequest` prop to `Overview({ apiRequest }: { apiRequest?: AuthenticatedRequest })`.
   - If `apiRequest` is present, fetch live aggregated daily summary from `GET /api/v1/owner/overview/daily`.
   - Render Bento grid layout with interactive action links.

---

## 5. Verification Strategy & Acceptance Checklist

- [ ] **API Tests:**
  - Returns `200 OK` with valid daily totals for current branch.
  - Assert cash revenue reconciles with shift cash transactions for the date.
  - Assert check-in count matches `member_check_ins` within date boundary.
  - Assert non-admin callers receive `403 Forbidden`.
- [ ] **Frontend Tests:**
  - `Overview.test.tsx`: verifies live API data fetch and rendering of the 4 Bento pillars.
  - Verifies date change updates all 4 pillars reactively.
  - Verifies navigation links to respective sub-modules.
- [ ] **Browser Acceptance:**
  - Owner navigates to `/owner/overview` &rarr; dashboard renders within 500ms without layout shift.
  - All 4 pillars display correct authoritative numbers matching underlying modules.
