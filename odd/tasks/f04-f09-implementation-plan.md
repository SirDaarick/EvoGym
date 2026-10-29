# F04 & F09 — Parallel Implementation Plan (Ponytail + ODD)

**Status:** Planning complete (DoR verified against `integration/frontend-design` at `9dbcd0b`). Ready for bounded execution.

## 0. Parallel Execution & Zero-Overlap Contract

`F04` (Sell a membership) and `F09` (Set up inventory and record stock movement) are orthogonal across backend routers, database models, and frontend feature directories. To execute them in parallel (or back-to-back on the same worktree) with **zero merge conflicts**:

| Layer | F04 Allowed Surface | F09 Allowed Surface | Isolation Rule |
|---|---|---|---|
| **Backend Models & Migrations** | *None* (`api/app/db/models/sales.py` and `catalog.py` are already complete) | `api/app/db/models/inventory.py`, `api/app/db/models/__init__.py`, `api/migrations/versions/*` | Only `F09` touches SQLAlchemy models and Alembic migrations. |
| **Backend API & Queries** | *None* (`api/app/api/sales.py`, `shifts.py`, `catalog.py` already satisfy the contract) | `api/app/api/inventory.py`, `api/app/inventory/schemas.py`, `api/app/inventory/queries.py` | Zero shared backend files (`inventory_router` is already mounted in `api/app/main.py:238`). |
| **Frontend App Router** | *None* (`/{owner,reception}/members/:id` is already mounted in `ApiProductApp.tsx:116-117`) | `frontend/src/app/ApiProductApp.tsx`, `frontend/src/app/ApiProductApp.test.tsx` | `F04` mounts checkout inside `ApiMembers.tsx` / `Members.tsx`; only `F09` edits `ApiProductApp.tsx`. |
| **Frontend Feature & API Files** | `frontend/src/api/membershipCheckoutApi.ts`, `frontend/src/api/membershipCheckoutApi.test.ts`, `frontend/src/features/reception/LiveMembershipCheckout.tsx`, `frontend/src/features/reception/LiveMembershipCheckout.test.tsx`, `frontend/src/app/ApiMembers.tsx`, `frontend/src/features/members/Members.tsx`, `frontend/src/features/members/Members.test.tsx` | `frontend/src/api/inventoryApi.ts`, `frontend/src/features/inventory/Inventory.tsx`, `frontend/src/features/inventory/Inventory.test.tsx`, `frontend/src/features/owner/InventoryAnalytics.tsx`, `frontend/src/features/owner/InventoryAnalytics.test.tsx` | Zero shared frontend files. |

---

## Part 1: F04 — Sell a Membership (P0, Class A)

### 1.1 Objective & Ponytail Scope

Connect the existing API-backed `LiveMembershipCheckout` dialog to the authenticated member detail screen (`/{owner,reception}/members/:memberId`) over the active session's `AuthenticatedRequest` transport (`AdminSessionProvider` / `ProductAccessProvider`), without altering any existing visual design, layout, or backend sales logic.

```text
Authenticated Member Detail → Click "Vender membresía" → LiveMembershipCheckout Modal →
Load Active Plans (/api/v1/catalog/plans?kind=membership&status=active) + Open-Shift Registers (/api/v1/registers) →
Select Register → Confirm Current Open Shift (/api/v1/shifts/current?register_id=...) →
Submit Cash (full/partial) or Bank Transfer with Idempotency-Key →
Render Authoritative Receipt & Membership/Sample State → Refresh Member Detail & Reload State (GET /reload)
```

**What Ponytail explicitly skips for F04:**
- **Zero backend edits:** `POST /api/v1/registers/{register_id}/membership-sales`, `POST /api/v1/registers/{register_id}/membership-transfer-sales`, `GET /api/v1/registers`, `GET /api/v1/shifts/current`, and `GET /api/v1/catalog/plans` already enforce branch scope, shift lock, idempotency fingerprint replay (`200` on replay, `409` on mutated body), period chaining (`starts_on` / `ends_on`), class sample entitlements, and partial-cash `MembershipDebt`.
- **Zero second checkout UI:** Do not rewrite `MembershipPayment.tsx` (demo-only page) or redesign `LiveMembershipCheckout.tsx` / `MemberDetail.tsx`.
- **Zero `ApiProductApp.tsx` route churn:** Mount the checkout trigger directly in `LiveMemberDetail` (`frontend/src/features/members/Members.tsx`) wired from `ApiMemberDetail` (`frontend/src/app/ApiMembers.tsx`).

### 1.2 Allowed Edit Surfaces (F04)

```text
frontend/src/api/membershipCheckoutApi.ts
frontend/src/api/membershipCheckoutApi.test.ts
frontend/src/features/reception/LiveMembershipCheckout.tsx
frontend/src/features/reception/LiveMembershipCheckout.test.tsx
frontend/src/app/ApiMembers.tsx
frontend/src/features/members/Members.tsx
frontend/src/features/members/Members.test.tsx
odd/tasks/f04-f09-implementation-plan.md
```

### 1.3 Technical Design (Minimal Diff)

1. **Transport Adapter in `frontend/src/api/membershipCheckoutApi.ts`:**
   - Accept an optional `apiRequest?: AuthenticatedRequest` parameter in `getActiveMembershipPlans`, `getRegisters`, `getCurrentRegisterShift`, `submitMembershipCashSale`, and `submitMembershipTransferSale`.
   - Inside internal `request<T>(path, init, apiRequest?)`:
     - When `apiRequest` is provided, execute `apiRequest(path, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })`, converting thrown `TypeError` exceptions into `CheckoutApiNetworkError` (`reason.kind === 'network'`) and non-2xx responses into `CheckoutApiHttpError` via the existing error envelope parser (`:105-130`).
     - When `apiRequest` is omitted, retain the legacy `readOperationalToken()` path so existing unit tests remain 100% compatible.
2. **Thread `apiRequest` & Single-Entry Entitlement Display in `frontend/src/features/reception/LiveMembershipCheckout.tsx`:**
   - Add optional `apiRequest?: AuthenticatedRequest` prop to `LiveMembershipCheckout` and pass it to the 5 API calls.
   - Include `sample_entitlement` from `MembershipSaleResponse` in component state so purchasing a `single_entry` membership plan (created in `F03`) displays its availability status clearly instead of falling through to the generic `"Sin periodo de membresía devuelto"` notice.
3. **Mount in `frontend/src/app/ApiMembers.tsx` & `frontend/src/features/members/Members.tsx`:**
   - Pass `apiRequest={request}` in `ApiMemberDetail` (`ApiMembers.tsx:314-332`) via `liveData`.
   - In `LiveMemberDetail` (`Members.tsx:418-438`), add a `"Vender membresía"` `<Button variant="secondary">` in `.member-hero-actions` that toggles `isCheckoutOpen`.
   - When `isCheckoutOpen` is true, render `<LiveMembershipCheckout member={{ id: member.id, name: member.name }} apiRequest={apiRequest} onClose={() => setIsCheckoutOpen(false)} onCompleted={() => void onRefresh?.()} />` above the tabs (matching the existing `isEditing` panel placement at `Members.tsx:439`).

### 1.4 Work Units (ODD Execution — F04)

- [x] **F04-T01 (Transport & Checkout Component RED → GREEN):**
  - Add focused tests in `membershipCheckoutApi.test.ts` and `LiveMembershipCheckout.test.tsx` proving `apiRequest` transport injection, `Idempotency-Key` preservation across network failure + retry (`reason.kind === 'network'`), and `201`/`200` receipt handling.
  - Implement optional `apiRequest` threading in `membershipCheckoutApi.ts` and `LiveMembershipCheckout.tsx`.
- [x] **F04-T02 (Live Member Detail Integration RED → GREEN):**
  - Add focused integration tests in `Members.test.tsx` proving `"Vender membresía"` opens `LiveMembershipCheckout` from `ApiMemberDetail`, submits the sale over `AuthenticatedRequest`, and triggers `GET /api/v1/members/{id}/reload` on completion to refresh eligibility (`Elegible`), active period dates, and pending debt badge.
  - Wire `apiRequest` and `LiveMembershipCheckout` in `ApiMembers.tsx` and `Members.tsx`.
- [x] **F04-T03 (Automated Suite & Playwright Visual Verification):**
  - Run backend `api/tests/test_sales.py`, frontend targeted tests, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`, and Playwright browser verification.

### 1.5 High-Value Test Matrix (Anti-Slop Gate — F04)

Do **not** duplicate existing `api/tests/test_sales.py` coverage. Only add these 4 high-value frontend tests:
1. **`membershipCheckoutApi.test.ts` — Authenticated Transport & Error Mapping:** Verifies `submitMembershipCashSale` and `submitMembershipTransferSale` use the injected `AuthenticatedRequest`, attach `Content-Type: application/json` and `Idempotency-Key`, map network `TypeError` to `CheckoutApiNetworkError`, and map `403`/`409`/`422` to `CheckoutApiHttpError`.
2. **`LiveMembershipCheckout.test.tsx` — Uncertain Network Outcome & Idempotent Retry:** Simulates a network drop (`TypeError`) on `POST /membership-sales`, asserts inputs lock and `"Reintentar la misma solicitud"` appears, clicks retry, and asserts the **exact same `Idempotency-Key` and body** are re-sent without generating a second sale.
3. **`Members.test.tsx` — End-to-End Member Detail Checkout & Reload Refresh:** Opens `"Vender membresía"` on a member with no active membership, selects an active plan and open-shift register, completes a full cash sale (`201`), and verifies `GET /api/v1/members/{id}/reload` refreshes the hero badge to `"Elegible"` and renders the new `starts_on – ends_on` period.
4. **`Members.test.tsx` — Partial Cash Debt & Closed-Shift Guard:** Verifies that when no register has `has_open_shift: true`, submission is blocked with `"No hay cajas con turno abierto"`, and when partial cash `< price_minor` is submitted, the warning notice and refreshed pending balance alert (`⚠️ Saldo pendiente registrado`) appear.

---

## Part 2: F09 — Set Up Inventory and Record Stock Movement (P1, Class B)

### 2.1 Objective, D-015 Resolution & Ponytail Scope

Connect the existing owner inventory dashboard (`/owner/inventory` → `InventoryAnalytics.tsx`) and reception inventory screen (`/reception/inventory` → `Inventory.tsx`) to durable FastAPI endpoints using the existing frontend modals, tables, and inputs as the strict UI contract.

**Minimalist D-015 Resolution (Class B Contract Alignment):**
1. **Units & Money:** All products remain integer piece-counted (`unit = 'piece'`). Commercial metadata required by `InventoryAnalytics.tsx` (`category`, `price_minor`, `cost_minor`, `is_active`) is stored on `Product` as nonnegative integer centavos (`MXN`).
2. **Opening Stock vs. Later Movements:**
   - Opening stock (`StockInitialization`, nonnegative integer `>= 0`) is recorded once per `(branch_id, product_id)` (automatically initialized when creating a product from `InventoryAnalytics.tsx` Modal 1 with `Stock inicial >= 0`, or via explicit initialization).
   - Subsequent stock changes are recorded in an append-only, branch-scoped `StockMovement` ledger (`stock_movements`) supporting `kind IN ('restock', 'waste', 'adjustment')`, positive integer `quantity > 0` (or signed delta for `adjustment`), required `reason` for `waste`/`adjustment`, `actor_id`, and `idempotency_key`.
3. **Negative Stock & Deactivation Guard:**
   - Any `waste` or negative `adjustment` that would reduce branch on-hand stock (`opening_quantity + restock - waste + adjustment`) below `0` is rejected with `409 Conflict`.
   - Deactivating a product (`is_active = false`) blocks new reception movements while preserving historical stock and catalog value.
4. **Snapshot Compatibility:** Existing `RegisterInventorySnapshot` queries in `api/app/inventory/queries.py` remain untouched so shift opening inventory reviews (`test_inventory_snapshots.py`, `test_inventory_reviews.py`) pass with zero regressions.

**What Ponytail explicitly skips for F09:**
- **Zero UI redesign:** Keep `InventoryAnalytics.tsx` and `Inventory.tsx` CSS, layout, KPI cards, TanStack Table, and modals intact. Reuse `getInventoryAnalytics(state, period)` in `InventoryAnalytics.tsx` by feeding it a synthesized state mapped from the API response (`products`, `stockMovements`, `sales: []`).
- **Zero POS / Product Sales in F09:** Product sales belong to `F10`; `sales` remains `[]` in `F09` so KPI 2 (`Ventas de productos`) and Top 5 charts naturally render their built-in zero-sales state.
- **Zero multi-warehouse or FIFO cost-layer accounting:** Cost and price are simple minor-unit integers on `Product`.

### 2.2 Allowed Edit Surfaces (F09)

```text
api/app/db/models/inventory.py
api/app/db/models/__init__.py
api/migrations/versions/
api/app/inventory/schemas.py
api/app/inventory/queries.py
api/app/api/inventory.py
api/tests/test_inventory.py
frontend/src/api/inventoryApi.ts
frontend/src/app/ApiProductApp.tsx
frontend/src/app/ApiProductApp.test.tsx
frontend/src/features/inventory/Inventory.tsx
frontend/src/features/inventory/Inventory.test.tsx
frontend/src/features/owner/InventoryAnalytics.tsx
frontend/src/features/owner/InventoryAnalytics.test.tsx
odd/tasks/f04-f09-implementation-plan.md
```

### 2.3 Backend FastAPI & Database Design (F09)

1. **Database Model & Single Alembic Migration (`api/app/db/models/inventory.py`):**
   - Extend `Product` with:
     - `category: Mapped[str]` (`String(64)`, `nullable=False`, `default="General"`, `server_default="General"`)
     - `price_minor: Mapped[int]` (`BigInteger`, `nullable=False`, `default=0`, `server_default="0"`, `CheckConstraint("price_minor >= 0")`)
     - `cost_minor: Mapped[int]` (`BigInteger`, `nullable=False`, `default=0`, `server_default="0"`, `CheckConstraint("cost_minor >= 0")`)
     - `is_active: Mapped[bool]` (`Boolean`, `nullable=False`, `default=True`, `server_default="true"`)
   - Add `StockMovement(Base)` (`__tablename__ = "stock_movements"`):
     - `id: Mapped[UUID]` (PK)
     - `branch_id: Mapped[UUID]` (`ForeignKey("branches.id", ondelete="RESTRICT")`, indexed)
     - `product_id: Mapped[UUID]` (`ForeignKey("products.id", ondelete="RESTRICT")`, indexed)
     - `kind: Mapped[str]` (`String(16)`, `CheckConstraint("kind IN ('restock', 'waste')")`)
     - `quantity: Mapped[int]` (`BigInteger`, `CheckConstraint("quantity > 0")`)
     - `reason: Mapped[str | None]` (`String(240)`, nullable; required when `kind == 'waste'`)
     - `recorded_by: Mapped[UUID]` (`ForeignKey("staff_users.id", ondelete="RESTRICT")`)
     - `idempotency_key: Mapped[str]` (`String(128)`, `UniqueConstraint("branch_id", "idempotency_key")`)
     - `recorded_at: Mapped[datetime]` (`DateTime(timezone=True)`, `server_default=func.now()`)

2. **FastAPI Endpoints (`api/app/api/inventory.py`):**
   - **Auth Principal:** Allow both Admin (`is_admin=True`) and Staff with `Permission.MEMBER_OPERATIONAL_READ` (`get_inventory_actor_principal`, mirroring `get_catalog_actor_principal` / `get_shift_actor_principal`). Admin can create/edit/toggle products and record movements on any branch; Reception staff can read branch stock and record movements (`restock` / `waste`) only for their assigned `branch_id`.
   - **Branch Resolution:** Add `GET /api/v1/inventory/branches` (or resolve default branch when `branch_id` query param is omitted for Admin) so `InventoryAnalytics.tsx` can load and initialize stock for the active gym branch without hardcoding UUIDs.
   - **Extended Product Endpoints:**
     - `POST /api/v1/inventory/products`: Accept optional `code` (auto-generated slug/UUID prefix if omitted by UI), `name`, `category = "General"`, `price_minor = 0`, `cost_minor = 0`, `initial_branch_id: UUID | None = None`, `initial_quantity: int | None = None`. If `initial_quantity is not None` and `initial_branch_id` (or single default branch) is present, atomically create `StockInitialization` in the same transaction.
     - `PATCH /api/v1/inventory/products/{product_id}` (Admin only): Update `name`, `category`, `price_minor`, `cost_minor`, `is_active`.
   - **Extended Branch Stock & Movements Endpoints:**
     - `GET /api/v1/inventory/branches/{branch_id}/stock`: Return `StockRowDTO` enriched with `category`, `price_minor`, `cost_minor`, `is_active`, `opening_quantity` (`initialization.quantity`), `restocked_quantity`, `waste_quantity`, and `quantity` (current on-hand = `opening_quantity + restocked_quantity - waste_quantity` when initialized, else `None`).
     - `POST /api/v1/inventory/branches/{branch_id}/movements` (`status_code=201`, `200` on `Idempotency-Key` replay):
       - Lock `StockInitialization` row (or auto-initialize at `0` if not yet initialized when recording a `restock`; reject `waste` if uninitialized or if `quantity > on_hand_quantity` with `409`).
       - Reject movements on inactive products (`is_active == False`) with `409`.
       - Persist `StockMovement` and return `StockMovementDTO` + updated `on_hand_quantity`.
     - `GET /api/v1/inventory/branches/{branch_id}/movements`: Return paginated movement ledger (`items`, `total`) ordered by `recorded_at DESC`.

### 2.4 Frontend Integration Design (F09 — Zero Visual Changes)

1. **`frontend/src/api/inventoryApi.ts`:**
   - Minimal typed helper over `AuthenticatedRequest`: `listBranchInventory`, `createCatalogProduct`, `updateCatalogProduct`, `recordStockMovement`, `listStockMovements`.
2. **Owner View (`frontend/src/features/owner/InventoryAnalytics.tsx`):**
   - Accept optional `apiRequest?: AuthenticatedRequest` prop (when omitted, falls back to `useDemo()` so all existing demo tests pass unchanged).
   - When `apiRequest` is provided:
     - Fetch branch stock and movements on mount, mapping them into the `DemoState` slice consumed by `getInventoryAnalytics(liveState, period)`.
     - Wire Modal 1 (`handleSaveNewProduct`) to `await createCatalogProduct(apiRequest, ...)` with in-flight submit disable and error retention.
     - Wire Modal 2 (`handleSaveEditProduct`) to `await updateCatalogProduct(apiRequest, ...)`.
     - Wire Modal 3 (`handleConfirmToggle`) to `await updateCatalogProduct(apiRequest, id, { is_active: !prod.active })`.
3. **Reception View (`frontend/src/features/inventory/Inventory.tsx`):**
   - Accept optional `apiRequest?: AuthenticatedRequest` prop and pass it to `<InventoryAnalytics apiRequest={apiRequest} />` when `role === 'OWNER'`.
   - When `role === 'RECEPTION'` and `apiRequest` is provided:
     - Load active products and current stock from `listBranchInventory(apiRequest)`.
     - Enable the existing reception panel (`aside.inventory-receipt`) controls to submit a live `restock` (`"Confirmar recepción"`) or `waste` movement with reason via `recordStockMovement(apiRequest, ...)` and refresh the displayed stock counts.
4. **Mount in `frontend/src/app/ApiProductApp.tsx`:**
   - Route `/owner/inventory` and `/reception/inventory` to `<Inventory role={role} apiRequest={apiRequest} />`.

### 2.5 Work Units (ODD Execution — F09)

- [x] **F09-T01 (Backend Schema, Migration & Movement Ledger RED → GREEN):**
  - Write failing tests in `api/tests/test_inventory.py` for product commercial fields (`category`, `price_minor`, `cost_minor`, `is_active`), `PATCH /products/{id}`, `POST /branches/{id}/movements` (`restock` and `waste`), negative-stock `409` rejection, idempotent replay (`200`), and branch scope enforcement (`403` for cross-branch staff).
  - Implement model fields, Alembic migration, queries, schemas, and endpoints in `api/app/inventory/*` and `api/app/api/inventory.py`.
- [x] **F09-T02 (Frontend Owner & Reception Live Adapters RED → GREEN):**
  - Write failing tests in `InventoryAnalytics.test.tsx`, `Inventory.test.tsx`, and `ApiProductApp.test.tsx` using API-shaped DTO fixtures.
  - Implement `inventoryApi.ts`, wire `InventoryAnalytics.tsx` and `Inventory.tsx` with optional `apiRequest`, and mount `/owner/inventory` and `/reception/inventory` in `ApiProductApp.tsx`.
- [x] **F09-T03 (Automated Suite & Playwright Visual Verification):**
  - Run backend inventory & snapshot suites, frontend inventory & router suites, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`, and Playwright browser verification.

### 2.6 High-Value Test Matrix (Anti-Slop Gate — F09)

1. **`api/tests/test_inventory.py` — Durable Ledger & Invariants:**
   - Creating a product with `price_minor`, `cost_minor`, `category`, and initial stock persists across sessions; `PATCH` updates metadata/status without altering stock.
   - Recording `restock` (+10) then `waste` (-3, with reason) produces durable `quantity = opening + 7` on `GET /branches/{id}/stock` and lists both movements on `GET /branches/{id}/movements`.
   - Recording `waste` exceeding current on-hand quantity returns `409` and leaves stock unchanged.
   - Replaying `POST /branches/{id}/movements` with the same `Idempotency-Key` returns `200` without double-counting; a cross-branch staff token returns `403`.
2. **`frontend/src/features/owner/InventoryAnalytics.test.tsx` — Live Owner CRUD & Reload:**
   - Renders live KPI totals and table rows from `apiRequest` without `DemoProvider`; submitting Modal 1 (`Nuevo producto`), Modal 2 (`Editar producto`), and Modal 3 (`Desactivar producto`) sends the exact JSON payloads and retains form values on `409`/`422` errors.
3. **`frontend/src/features/inventory/Inventory.test.tsx` & `ApiProductApp.test.tsx` — Live Reception Stock Movement & Route Mount:**
   - `/owner/inventory` and `/reception/inventory` mount in `ApiProductApp` (never `UnavailablePage`); reception selects a product, enters quantity, confirms reception (`POST /movements`), and displays the updated on-hand stock.

---

## Part 3: Playwright Real-Browser Verification Plan (F04 & F09)

Start the backend against a disposable SQLite database and the frontend dev server with `VITE_DEMO_MODE=false`. Use Playwright MCP (`playwright_navigate`, `playwright_click`, `playwright_fill`, `playwright_get_visible_text`, `playwright_screenshot`) to verify and capture visual proof for these 4 end-to-end flows:

### Flow A (F04) — Reception Cash Membership Sale & Hard Reload
1. Authenticate as receptionist (`recepcion`) with an open cash shift on the branch register.
2. Navigate to `/reception/members`, open an existing member without an active membership, and verify badge shows inactive/no membership.
3. Click `"Vender membresía"`, select an active published membership plan and the open register, verify the open shift ID renders, and click `"Cobrar en efectivo"` (leaving cash amount blank for full price).
4. Verify `"Pago confirmado"` and `"Membresía activada por el backend: <starts_on> a <ends_on>"` appear in the dialog. Close the dialog.
5. Verify the member detail hero badge immediately updates to `"Elegible"` and `"Registrar entrada"` becomes enabled. Hard-reload (`F5`) and confirm the active period persists.

### Flow B (F04) — Partial Cash Debt & Bank Transfer Pending Review
1. On another member's detail page, open `"Vender membresía"`, enter a partial cash amount (`< price_minor`), verify the partial-payment notice appears, and submit.
2. Close the dialog and verify `"⚠️ Saldo pendiente registrado"` renders on the counter card and persists after reload.
3. On a third member, submit via `"Transferencia bancaria"` and verify `"Transferencia pendiente de revisión (under_review)"` renders without falsely activating eligibility.

### Flow C (F09) — Owner Product Creation, Edit, Deactivation & Hard Reload
1. Authenticate as owner (`admin`) and navigate to `/owner/inventory`.
2. Click `"Nuevo producto"`, fill `Nombre: "Electrolito Suero 500ml"`, `Categoría: "Bebidas"`, `Precio: "35"`, `Costo: "18"`, `Stock inicial: "20"`, and submit.
3. Verify the table renders `"Electrolito Suero 500ml"` with `Stock actual: 20`, `Precio venta: $35.00 MXN`, and KPI 1 (`Catálogo y valor en piso`) increases by `$700.00 MXN`.
4. Click `"Editar"` on the row, update `Precio` to `"40"`, save, and verify `$40.00 MXN`. Click `"Desactivar"`, confirm, verify badge changes to `"Inactivo"`, and hard-reload (`F5`) to confirm persistence.

### Flow D (F09) — Reception Stock Movement (`restock` / `waste`) & Negative-Stock Guard
1. Reactivate `"Electrolito Suero 500ml"` as owner, then switch to receptionist (`recepcion`) and navigate to `/reception/inventory`.
2. Select `"Electrolito Suero 500ml"`, enter quantity `5`, confirm reception (`restock`), and verify stock updates from `20` to `25` and survives hard reload (`F5`).
3. Attempt a `waste` movement exceeding `25` units and verify the `409` error banner is displayed and stock remains `25`.
