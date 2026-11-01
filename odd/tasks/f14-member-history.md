# F14 — Review a member account history (Cockpit de Mostrador y Expediente 360°)

**Status: Discovery and Architecture Plan completed and approved; ready for implementation sequencing.**

**Authority & Reference:** [remaining-feature-integrations.md](remaining-feature-integrations.md) (Card F14).

---

## 1. Domain Objective & Boundaries

Provide receptionists and administrators with an instant, zero-scroll operational overview of a gym member upon arrival, alongside an in-depth audit record on demand.

### Fundamental Architectural Rules (Agreed Decisions)
- **Strict Two-Tab Information Architecture:**
  - **Pestaña `Mostrador` (Operational HUD):** Zero-scroll view adhering to the 3-second counter rule. Displays only essential, high-priority signals needed while interacting with the member at the front desk.
  - **Pestaña `Expediente` (Deep Audit):** Hosts heavy itemized tables (full purchase history, attendance calendars, and comprehensive notes logs) for administrative research or member billing inquiries.
- **Noise Elimination in Mostrador:**
  - Redundant footer links (e.g., *"Ver historial de membresías ›"*, *"Ver todas las notas ›"*) are removed from counter cards; navigation to deep history is handled exclusively by the `Expediente` tab.
  - Explanatory multi-line eviction/warning disclaimers are simplified into concise status badges.
- **Server-Side Habits Aggregation:**
  - The backend computes a lightweight customer success summary (last 30–60 days: visit frequency, attendance engagement tier, and top purchased retail item) instead of streaming thousands of historical raw events over the wire.
- **Mounted UI Boundary:**
  - Directly inside the existing `/reception/members/:id` and `/owner/members/:id` routes ([Members.tsx](../../frontend/src/features/members/Members.tsx) and [MemberDetail.tsx](../../frontend/src/features/members/MemberDetail.tsx)). No new routes.

---

## 2. Mostrador Zero-Scroll Bento HUD Layout

Organized into a high-contrast, compact grid fitting entirely above the fold on desktop and tablet:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ [Foto]  CARLOS MARTÍNEZ  (SOC-0042)        [🟢 ACTIVO · Vence en 14d]  │
│         ☎ 55 1234 5678                     [ BOTÓN: RENOVAR PLAN ]     │
├──────────────────┬───────────────────────┬─────────────────────────────┤
│ 🥊 RENTAS (F11)  │ 🤝 ATENCIÓN & HÁBITOS │ 📝 NOTA INTERNA             │
│ Casillero: #14   │ Visitas: 4/semana     │ "Olvidó su toalla ayer,     │
│ (Vence en 4 días)│ (Socio habitual)      │ entregar en mostrador."     │
│ Guantes:         │ 🥤 Suele comprar:     │                             │
│ Devueltos ✅     │ Agua Bonafont fría    │ [+ Agregar nota]            │
└──────────────────┴───────────────────────┴─────────────────────────────┘
```

1. **Card 1: Membresía & Cobranza:**
   - Active plan title and dates.
   - Status badge: `🟢 Elegible`, `🟡 Vence hoy`, `🔴 Adeudo pendiente`.
   - Primary action buttons:
     - `[ Renovar plan ]` &rarr; opens checkout modal.
     - `[ Cobrar deuda $XXX ]` &rarr; opens register debt payment (F06).
2. **Card 2: Rentas Activas (F11):**
   - Compact badges for Locker (`Casillero #14 · 4 días restantes` / `Vencido`) and Gloves (`Devueltos ✅` / `En uso 🥊`).
3. **Card 3: Atención al Cliente & Fidelización:**
   - Attendance tier: `🔥 Socio habitual (4 visitas/sem)` vs `⚠️ Riesgo de abandono (8 días sin venir)`.
   - Suggested conversation prompt: e.g. *"Reincorporación: Preguntar cómo ha estado tras varios días sin entrenar."*
   - Favorite product recommendation: e.g. *"🥤 Suele comprar: Agua Bonafont"*.
4. **Card 4: Notas del Staff:**
   - Displays the single latest active staff note with author and timestamp.
   - Quick action button: `[+ Agregar nota]`.

---

## 3. Expediente Tab Layout (Deep Dive)

Active when switching to `activeTab === 'record'` (`Expediente`):
1. **Historial de Pagos y Compras:**
   - TanStack Table displaying all attributed transactions: memberships, product retail, glove/locker rentals, and debt settlements.
   - Columns: Fecha, Concepto / Producto, Monto (MXN), Método de pago, Estado (`Pagado` / `Pendiente`).
2. **Historial de Membresías:**
   - Itemized validity periods table (Plan name, starts_on, ends_on, access_status).
3. **Bitácora de Notas:**
   - Full reverse-chronological list of administrative notes with author badge and date.
4. **Calendario de Asistencias:**
   - Interactive attendance calendar component mapping check-ins across months.

---

## 4. Data Contract & Backend API Endpoints

### 1. `GET /api/v1/members/{id}/summary` (Lightweight Mostrador HUD)
- **Role:** Authenticated staff or admin.
- **Response DTO:**
  ```json
  {
    "member_id": "uuid",
    "member_number": "SOC-0042",
    "full_name": "Carlos Martínez",
    "phone": "5512345678",
    "photo_url": null,
    "membership": {
      "plan_name": "Gym + Box mensual",
      "starts_on": "2026-10-15",
      "ends_on": "2026-11-15",
      "status": "eligible",
      "days_remaining": 15
    },
    "financial": {
      "has_pending_balance": true,
      "pending_balance_minor": 35000,
      "unpaid_order_id": "uuid"
    },
    "rentals": {
      "active_locker": { "code": "14", "expires_at": "2026-11-04T12:00:00Z", "status": "active" },
      "active_gloves": { "code": "G-08", "returned": true }
    },
    "habits": {
      "weekly_visits": 4,
      "attendance_tier": "high",
      "greeting_prompt": "Socio habitual: Saludo ágil y desear excelente entrenamiento.",
      "favorite_product": "Agua Bonafont 1L"
    },
    "latest_note": {
      "id": "uuid",
      "body": "Olvidó su toalla ayer, entregar en mostrador.",
      "author_name": "Valeria M.",
      "created_at": "2026-10-30T14:30:00Z"
    }
  }
  ```

### 2. `GET /api/v1/members/{id}/purchases` (Expediente Tab)
- **Query Params:** `page`, `page_size`, `from_date`, `to_date`.
- **Response:** Paginated purchase operations (orders, sales, rentals, debt payments).

### 3. `GET /api/v1/members/{id}/check-ins` (Expediente Tab)
- **Query Params:** `month`, `year`.
- **Response:** List of check-in timestamps and access reasons.

---

## 5. Verification Strategy & Acceptance Checklist

- [ ] **Contract tests (API):**
  - Verify `GET /api/v1/members/{id}/summary` returns aggregated habits without calculating on full database scans.
  - Verify debts and rental items reflect authoritative data from `orders` and `rentals`.
  - Verify `GET /api/v1/members/{id}/purchases` correctly pages across sales and payments.
- [ ] **Frontend tests:**
  - `MemberCounterView.test.tsx`: asserts zero vertical scrolling on standard desktop break-point; validates absence of redundant card footers; checks direct triggers for `Renovar` and `Cobrar deuda`.
  - `MemberDetailSections.test.tsx`: validates all deep tables render inside the `Expediente` tab.
- [ ] **E2E Acceptance:**
  - Receptionist searches member &rarr; Mostrador HUD displays status, habits, and active locker in under 1 second.
  - Clicking `Expediente` displays historical purchase table and full notes audit.
