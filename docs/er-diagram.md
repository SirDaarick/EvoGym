# EvoGym — Logical Entity-Relationship (ER) Architecture

Status: Proposed Logical ER Model based on `docs/database-map.md`.

This document translates the approved database map into domain-driven Entity-Relationship (ER) models. Due to the scale of the system (~40+ relational entities), the architecture is structured into **Core Global Hierarchy** followed by **Domain Bounded Contexts** to maintain clarity, prevent diagram clutter, and preserve transactional boundaries.

---

## 1. High-Level Global Architecture (Core Aggregates)

```mermaid
erDiagram
    ORGANIZATION ||--o{ BRANCH : "operates"
    ORGANIZATION ||--o{ STAFF_USER : "employs"
    ORGANIZATION ||--o{ MEMBER : "registers"
    ORGANIZATION ||--o{ PLAN : "catalogs"
    ORGANIZATION ||--o{ PRODUCT : "catalogs"
    BRANCH ||--o{ CASH_REGISTER : "contains"
    BRANCH ||--o{ ORDER : "processes"
    BRANCH ||--o{ ATTENDANCE_VISIT : "receives"
    BRANCH ||--o{ RENTAL_ASSET : "manages"
    MEMBER ||--o{ MEMBERSHIP : "purchases"
    MEMBER ||--o{ ORDER : "places"
    MEMBER ||--o{ GIMI_CONVERSATION : "engages"
    MEMBER ||--o{ NOTIFICATION_LOG : "receives"
    ORGANIZATION ||--o{ GIMI_CONVERSATION : "hosts"
    ORDER ||--o{ PAYMENT : "settled_by"
    CASH_REGISTER ||--o{ SHIFT : "records"
    SHIFT ||--o{ ORDER : "batches"
    SHIFT ||--o{ CASH_MOVEMENT : "controls"
```

---

## 2. Bounded Context A: Organization, Staff & Security

Manages gym tenancy, branch locations, employee roles, sessions, and compensation history.

```mermaid
erDiagram
    ORGANIZATION {
        uuid id PK
        string name
        string status
    }
    BRANCH {
        uuid id PK
        uuid organization_id FK
        string code
        string name
        string timezone
        string status
    }
    STAFF_USER {
        uuid id PK
        uuid organization_id FK
        string full_name
        string email
        string phone
        string pin_hash
        string password_hash
        int failed_attempts
        timestamptz locked_until
        string status
    }
    STAFF_ROLE {
        uuid id PK
        uuid staff_user_id FK
        string role
        uuid branch_id FK
    }
    STAFF_SESSION {
        uuid id PK
        uuid staff_user_id FK
        uuid branch_id FK
        string token_hash UK
        timestamptz created_at
        timestamptz expires_at
        timestamptz revoked_at
    }
    STAFF_COMPENSATION {
        uuid id PK
        uuid staff_user_id FK
        bigint amount_minor
        string currency
        string pay_period
        date effective_from
        date effective_to
    }
    STAFF_ATTENDANCE_LOG {
        uuid id PK
        uuid staff_user_id FK
        uuid branch_id FK
        timestamptz clock_in_at
        timestamptz clock_out_at
        string method
        string notes
    }
    STAFF_DEVICE_PAIRING {
        uuid id PK
        uuid staff_user_id FK
        uuid branch_id FK
        string pairing_code_hash
        timestamptz pairing_code_expires_at
        string token_hash UK
        string device_name
        string status
        timestamptz paired_at
        timestamptz last_active_at
        timestamptz revoked_at
        uuid created_by FK
    }

    ORGANIZATION ||--o{ BRANCH : "owns"
    ORGANIZATION ||--o{ STAFF_USER : "employs"
    BRANCH ||--o{ STAFF_ROLE : "scopes"
    STAFF_USER ||--o{ STAFF_ROLE : "has"
    STAFF_USER ||--o{ STAFF_SESSION : "authenticates"
    BRANCH ||--o{ STAFF_SESSION : "hosts"
    STAFF_USER ||--o{ STAFF_COMPENSATION : "earns"
    STAFF_USER ||--o{ STAFF_ATTENDANCE_LOG : "clock_ins"
    BRANCH ||--o{ STAFF_ATTENDANCE_LOG : "work_site"
    STAFF_USER ||--o{ STAFF_DEVICE_PAIRING : "paired_devices"
    BRANCH ||--o{ STAFF_DEVICE_PAIRING : "enrolled_at"
```

---

## 3. Bounded Context B: Members, Memberships & Attendance

Separates member identity from catalog offerings, purchased memberships, authorized entitlements, and attendance check-in.

```mermaid
erDiagram
    MEMBER {
        uuid id PK
        uuid organization_id FK
        uuid home_branch_id FK
        string member_number UK
        string full_name
        string preferred_name
        string phone
        string email
        date birth_date
        date joined_on
        bigint credit_limit_minor
        string status
    }
    MEMBER_NOTE {
        uuid id PK
        uuid member_id FK
        uuid author_id FK
        string body
        timestamptz created_at
        timestamptz voided_at
    }
    SERVICE {
        uuid id PK
        uuid organization_id FK
        string code UK
        string name
        string status
    }
    PLAN {
        uuid id PK
        uuid organization_id FK
        string code
        string kind
        string status
    }
    PLAN_VERSION {
        uuid id PK
        uuid plan_id FK
        int version_number
        string name
        bigint price_minor
        string currency
        int duration_value
        string duration_unit
        timestamptz published_at
    }
    PLAN_VERSION_SERVICE {
        uuid plan_version_id PK_FK
        uuid service_id PK_FK
        int session_limit
    }
    MEMBERSHIP {
        uuid id PK
        uuid member_id FK
        uuid plan_version_id FK
        uuid order_item_id FK
        string status
        timestamptz activated_at
        timestamptz cancelled_at
    }
    MEMBERSHIP_ENTITLEMENT {
        uuid id PK
        uuid membership_id FK
        uuid service_id FK
        uuid branch_id FK
        date starts_on
        date ends_on
        int session_limit
        string status
    }
    ENTITLEMENT_USE {
        uuid id PK
        uuid entitlement_id FK
        uuid attendance_visit_id FK
        int quantity
        timestamptz recorded_at
    }
    ATTENDANCE_VISIT {
        uuid id PK
        uuid branch_id FK
        uuid member_id FK
        uuid service_id FK
        timestamptz checked_in_at
        timestamptz checked_out_at
        uuid recorded_by FK
    }
    TRIAL_VISIT {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        string full_name
        string phone
        uuid service_id FK
        timestamptz used_at
        string status
        uuid recorded_by FK
    }

    ORGANIZATION ||--o{ MEMBER : "registers"
    BRANCH ||--o{ MEMBER : "home_branch"
    MEMBER ||--o{ MEMBER_NOTE : "has"
    ORGANIZATION ||--o{ SERVICE : "defines"
    ORGANIZATION ||--o{ PLAN : "offers"
    PLAN ||--o{ PLAN_VERSION : "versions"
    PLAN_VERSION ||--|{ PLAN_VERSION_SERVICE : "includes"
    SERVICE ||--o{ PLAN_VERSION_SERVICE : "part_of"
    MEMBER ||--o{ MEMBERSHIP : "purchases"
    PLAN_VERSION ||--o{ MEMBERSHIP : "specifies"
    MEMBERSHIP ||--|{ MEMBERSHIP_ENTITLEMENT : "grants"
    SERVICE ||--o{ MEMBERSHIP_ENTITLEMENT : "authorizes"
    MEMBERSHIP_ENTITLEMENT ||--o{ ENTITLEMENT_USE : "tracks"
    ATTENDANCE_VISIT ||--o{ ENTITLEMENT_USE : "validates"
    MEMBER ||--o{ ATTENDANCE_VISIT : "attends"
    BRANCH ||--o{ ATTENDANCE_VISIT : "receives"
    BRANCH ||--o{ TRIAL_VISIT : "conducts"
    SERVICE ||--o{ TRIAL_VISIT : "samples"
```

---

## 4. Bounded Context C: Sales, Payments, Allocations & Credit Ledger (POS)

Implements double-entry and allocation semantics: sales (`orders`), settlements (`payments`), line allocations, receivables/credit history, and returns.

```mermaid
erDiagram
    ORDER {
        uuid id PK
        uuid branch_id FK
        uuid shift_id FK
        uuid member_id FK
        string order_number UK
        string status
        string currency
        bigint subtotal_minor
        bigint discount_minor
        string discount_reason
        uuid discount_authorized_by FK
        bigint tax_minor
        bigint total_minor
        boolean is_overtime
        uuid credit_authorized_by FK
        date due_on
        timestamptz confirmed_at
    }
    ORDER_ITEM {
        uuid id PK
        uuid order_id FK
        int line_number
        string kind
        uuid product_id FK
        uuid plan_version_id FK
        uuid rental_rate_id FK
        string description
        numeric quantity
        bigint unit_price_minor
        bigint discount_minor
        string discount_reason
        bigint total_minor
    }
    PAYMENT {
        uuid id PK
        uuid branch_id FK
        uuid shift_id FK
        uuid terminal_id FK
        uuid member_id FK
        string method
        string status
        bigint amount_minor
        string currency
        bigint fee_minor
        bigint net_amount_minor
        string external_reference
        string external_intent_id
        string card_brand
        string card_last_digits
        string authorization_code
        timestamptz received_at
        timestamptz confirmed_at
    }
    PAYMENT_ALLOCATION {
        uuid id PK
        uuid payment_id FK
        uuid order_id FK
        bigint amount_minor
        timestamptz allocated_at
        uuid reverses_allocation_id FK
    }
    PAYMENT_VERIFICATION {
        uuid id PK
        uuid payment_id FK
        string action
        string result
        uuid actor_id FK
        timestamptz occurred_at
    }
    MEMBER_CREDIT_ENTRY {
        uuid id PK
        uuid member_id FK
        bigint amount_minor
        string kind
        uuid payment_id FK
        uuid order_id FK
        uuid refund_id FK
        string reason
        timestamptz created_at
    }
    RETURN {
        uuid id PK
        uuid order_id FK
        uuid branch_id FK
        uuid shift_id FK
        string reason
        string status
        timestamptz created_at
    }
    RETURN_ITEM {
        uuid id PK
        uuid return_id FK
        uuid order_item_id FK
        numeric quantity
        bigint amount_minor
        string stock_disposition
    }
    REFUND {
        uuid id PK
        uuid return_id FK
        uuid original_payment_id FK
        uuid shift_id FK
        string method
        bigint amount_minor
        string currency
        string status
        timestamptz processed_at
    }

    BRANCH ||--o{ ORDER : "places_at"
    MEMBER ||--o{ ORDER : "buys"
    ORDER ||--|{ ORDER_ITEM : "contains"
    BRANCH ||--o{ PAYMENT : "collects"
    MEMBER ||--o{ PAYMENT : "submits"
    PAYMENT ||--o{ PAYMENT_ALLOCATION : "applies"
    ORDER ||--o{ PAYMENT_ALLOCATION : "settled_via"
    PAYMENT ||--o{ PAYMENT_VERIFICATION : "verified_by"
    MEMBER ||--o{ MEMBER_CREDIT_ENTRY : "ledger"
    ORDER ||--o{ RETURN : "reversed_by"
    RETURN ||--|{ RETURN_ITEM : "specifies"
    ORDER_ITEM ||--o{ RETURN_ITEM : "targeted_line"
    RETURN ||--o{ REFUND : "disburses"
```

---

## 5. Bounded Context D: Cash Registers, Shifts, Terminals & Drawer

Controls physical registers, Point terminals (Mercado Pago), shift handovers, and physical cash movements.

```mermaid
erDiagram
    PAYMENT_TERMINAL {
        uuid id PK
        uuid branch_id FK
        string code
        string name
        string provider
        string device_id UK
        string mp_store_id
        string mp_pos_id
        string status
    }
    CASH_REGISTER {
        uuid id PK
        uuid branch_id FK
        string code
        string name
        uuid default_terminal_id FK
        string status
    }
    SHIFT {
        uuid id PK
        uuid cash_register_id FK
        uuid opened_by FK
        uuid closed_by FK
        timestamptz opened_at
        timestamptz closed_at
        string status
        bigint opening_cash_minor
        bigint expected_cash_at_close_minor
        bigint counted_cash_minor
        bigint difference_minor
        string closing_notes
    }
    SHIFT_DENOMINATION_COUNT {
        uuid shift_id PK_FK
        bigint denomination_minor PK
        int quantity
    }
    CASH_MOVEMENT {
        uuid id PK
        uuid shift_id FK
        string direction
        bigint amount_minor
        uuid payment_id FK
        uuid refund_id FK
        uuid expense_id FK
        uuid extra_movement_id FK
        string reason
        timestamptz recorded_at
    }

    BRANCH ||--o{ PAYMENT_TERMINAL : "deploys"
    BRANCH ||--o{ CASH_REGISTER : "installs"
    PAYMENT_TERMINAL ||--o{ CASH_REGISTER : "default_terminal"
    CASH_REGISTER ||--o{ SHIFT : "tracks"
    SHIFT ||--|{ SHIFT_DENOMINATION_COUNT : "audits"
    SHIFT ||--o{ CASH_MOVEMENT : "journal"
    PAYMENT ||--o| CASH_MOVEMENT : "cash_inflow"
    REFUND ||--o| CASH_MOVEMENT : "cash_outflow"
```

---

## 6. Bounded Context E: Products, Inventory & Supplements

Maintains SKU catalogs, branch warehouse stock balances, movements (sales, restocks, adjustments), and physical counts.

```mermaid
erDiagram
    PRODUCT {
        uuid id PK
        uuid organization_id FK
        string sku UK
        string name
        string category
        string kind
        string stock_unit
        bigint sale_price_minor
        bigint reference_cost_minor
        string flavor
        string status
    }
    STOCK_BALANCE {
        uuid branch_id PK_FK
        uuid product_id PK_FK
        numeric quantity
        int version
        timestamptz updated_at
    }
    STOCK_MOVEMENT {
        uuid id PK
        uuid branch_id FK
        uuid product_id FK
        string kind
        numeric quantity_delta
        bigint unit_cost_minor
        uuid order_item_id FK
        uuid return_item_id FK
        uuid stock_count_item_id FK
        string reason
        timestamptz recorded_at
    }
    STOCK_COUNT {
        uuid id PK
        uuid branch_id FK
        string status
        timestamptz started_at
        timestamptz completed_at
        uuid counted_by FK
        uuid approved_by FK
    }
    STOCK_COUNT_ITEM {
        uuid id PK
        uuid stock_count_id FK
        uuid product_id FK
        numeric expected_quantity
        numeric counted_quantity
        numeric variance
        timestamptz counted_at
    }

    ORGANIZATION ||--o{ PRODUCT : "catalogs"
    BRANCH ||--o{ STOCK_BALANCE : "stocks"
    PRODUCT ||--o{ STOCK_BALANCE : "inventoried_as"
    BRANCH ||--o{ STOCK_MOVEMENT : "logs"
    PRODUCT ||--o{ STOCK_MOVEMENT : "moves"
    ORDER_ITEM ||--o{ STOCK_MOVEMENT : "sale_deduction"
    RETURN_ITEM ||--o{ STOCK_MOVEMENT : "return_restock"
    BRANCH ||--o{ STOCK_COUNT : "initiates"
    STOCK_COUNT ||--|{ STOCK_COUNT_ITEM : "records"
    PRODUCT ||--o{ STOCK_COUNT_ITEM : "audited_product"
```

---

## 7. Bounded Context F: Asset Rentals (Lockers & Gloves)

Tracks physical asset occupancy and rental terms, preserving the boundary between contractual expiration and physical release.

```mermaid
erDiagram
    RENTAL_ASSET {
        uuid id PK
        uuid branch_id FK
        string code
        string kind
        string status
        string glove_color
        int glove_ounces
    }
    RENTAL_RATE {
        uuid id PK
        uuid organization_id FK
        string asset_kind
        int version
        string name
        bigint price_minor
        string currency
        int duration_value
        string duration_unit
        date effective_from
        date effective_to
    }
    RENTAL {
        uuid id PK
        uuid asset_id FK
        uuid member_id FK
        uuid order_item_id FK
        uuid rental_rate_id FK
        timestamptz starts_at
        timestamptz expires_at
        timestamptz released_at
        string status
    }

    BRANCH ||--o{ RENTAL_ASSET : "deploys"
    ORGANIZATION ||--o{ RENTAL_RATE : "prices"
    RENTAL_ASSET ||--o{ RENTAL : "assigned_to"
    MEMBER ||--o{ RENTAL : "rents"
    RENTAL_RATE ||--o{ RENTAL : "governed_by"
    ORDER_ITEM ||--o| RENTAL : "billed_as"
```

---

## 8. Bounded Context G: Expenses, Extras & Operational Budgets

Captures recurring business expenses, exceptional cash flow, and branch budget projections.

```mermaid
erDiagram
    EXPENSE_CATEGORY {
        uuid id PK
        uuid organization_id FK
        string code UK
        string name
        string status
    }
    EXPENSE {
        uuid id PK
        uuid branch_id FK
        uuid shift_id FK
        uuid category_id FK
        string concept
        string payee_name
        bigint amount_minor
        string currency
        string method
        string status
        date incurred_on
        timestamptz paid_at
        uuid recorded_by FK
    }
    EXTRA_MOVEMENT {
        uuid id PK
        uuid branch_id FK
        uuid shift_id FK
        string concept
        string direction
        bigint amount_minor
        string currency
        string method
        timestamptz occurred_at
        uuid staff_user_id FK
        uuid recorded_by FK
    }
    BUDGET_PERIOD {
        uuid id PK
        uuid branch_id FK
        date starts_on
        date ends_on
        int version
        string status
    }
    BUDGET_LINE {
        uuid id PK
        uuid budget_period_id FK
        uuid category_id FK
        string description
        bigint planned_amount_minor
        string currency
    }

    ORGANIZATION ||--o{ EXPENSE_CATEGORY : "standardizes"
    BRANCH ||--o{ EXPENSE : "registers"
    EXPENSE_CATEGORY ||--o{ EXPENSE : "classifies"
    BRANCH ||--o{ EXTRA_MOVEMENT : "executes"
    BRANCH ||--o{ BUDGET_PERIOD : "plans"
    BUDGET_PERIOD ||--|{ BUDGET_LINE : "allocates"
    EXPENSE_CATEGORY ||--o{ BUDGET_LINE : "targets"
```

---

## 9. Bounded Context H: Assistant (Gimi Chatbot) & Outbound Communications

Models the AI assistant's conversation lifecycle, knowledge base grounding, operational alerts, and outbound member notifications.

```mermaid
erDiagram
    GIMI_KNOWLEDGE_ITEM {
        uuid id PK
        uuid organization_id FK
        string category
        string title
        string content
        timestamptz expires_at
        timestamptz created_at
        timestamptz updated_at
    }
    GIMI_KNOWLEDGE_CHUNK {
        uuid id PK
        uuid knowledge_item_id FK
        int chunk_index
        string content
        vector embedding
        int token_count
        timestamptz created_at
    }
    GIMI_CONVERSATION {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        string client_name
        string client_phone
        string channel
        string contact_type
        string status
        timestamptz started_at
        timestamptz last_message_at
        int messages_count
        boolean needs_human_attention
        string summary
        string alert_reason
    }
    GIMI_MESSAGE {
        uuid id PK
        uuid conversation_id FK
        string role
        string content
        string intent
        string action_taken
        timestamptz sent_at
    }
    GIMI_ALERT {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid conversation_id FK
        uuid member_id FK
        string type
        string severity
        string message
        string status
        timestamptz created_at
        timestamptz resolved_at
        uuid resolved_by FK
    }
    NOTIFICATION_LOG {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        string channel
        string template_code
        string recipient
        string content_summary
        string status
        string external_message_id
        timestamptz sent_at
        string error_message
        timestamptz created_at
    }

    ORGANIZATION ||--o{ GIMI_KNOWLEDGE_ITEM : "curates"
    GIMI_KNOWLEDGE_ITEM ||--|{ GIMI_KNOWLEDGE_CHUNK : "chunked_into"
    ORGANIZATION ||--o{ GIMI_CONVERSATION : "hosts"
    BRANCH ||--o{ GIMI_CONVERSATION : "routes_to"
    MEMBER ||--o{ GIMI_CONVERSATION : "engages"
    GIMI_CONVERSATION ||--|{ GIMI_MESSAGE : "contains"
    GIMI_CONVERSATION ||--o{ GIMI_ALERT : "triggers"
    ORGANIZATION ||--o{ NOTIFICATION_LOG : "dispatches"
    MEMBER ||--o{ NOTIFICATION_LOG : "receives"
```

---

## 10. Bounded Context I: Configuration, Audit, Files & Data Migration (Infrastructure)

Handles tenant operating policy versions, system-wide cryptographic audit logs, file attachments (vouchers, evidence), and historical data migration links.

```mermaid
erDiagram
    BRANCH_POLICY_VERSION {
        uuid id PK
        uuid branch_id FK
        date effective_from
        date effective_to
        boolean allow_expiry_day
        boolean allow_repeat_visits
        string attendance_close_time
        int refund_window_days
    }
    IDEMPOTENCY_REQUEST {
        uuid id PK
        uuid organization_id FK
        string operation
        string request_key UK
        string request_hash
        string status
        string result_reference
        timestamptz created_at
        timestamptz expires_at
    }
    AUDIT_EVENT {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid actor_id FK
        string action
        string entity_type
        uuid entity_id
        timestamptz occurred_at
        string request_id
        string changes
    }
    STORED_FILE {
        uuid id PK
        uuid organization_id FK
        string storage_key UK
        string content_type
        bigint size_bytes
        string checksum
        string purpose
        uuid uploaded_by FK
        timestamptz created_at
    }
    IMPORT_BATCH {
        uuid id PK
        uuid organization_id FK
        string source_system
        string source_file_hash
        string status
        timestamptz started_at
        timestamptz completed_at
        int row_count
        int error_count
    }
    IMPORT_MEMBER_LINK {
        uuid import_batch_id PK_FK
        uuid member_id PK_FK
        string source_member_id
        int source_row_number
    }

    BRANCH ||--o{ BRANCH_POLICY_VERSION : "governed_by"
    ORGANIZATION ||--o{ IDEMPOTENCY_REQUEST : "ensures_once"
    ORGANIZATION ||--o{ AUDIT_EVENT : "audits"
    ORGANIZATION ||--o{ STORED_FILE : "attaches"
    ORGANIZATION ||--o{ IMPORT_BATCH : "imports"
    IMPORT_BATCH ||--|{ IMPORT_MEMBER_LINK : "maps"
    MEMBER ||--o{ IMPORT_MEMBER_LINK : "originated_from"
```

---

## 11. Architectural Integrity & Cross-Context Foreign Keys

1. **Transaction Isolation:** Venta (`ORDER`), Cobro (`PAYMENT`), y Entrega de Servicio/Producto se desacoplan explícitamente mediante `PAYMENT_ALLOCATION`, `MEMBERSHIP`, `RENTAL` y `STOCK_MOVEMENT`.
2. **Double-Entry & Cash Safety:** `CASH_MOVEMENT` audita cada centavo físico en `SHIFT`, ligando el id del pago o gasto correspondiente sin mutar saldos ciegamente.
3. **Debt Enforcement:** `MEMBER.credit_limit_minor` (default 0) y el saldo neto de `MEMBER_CREDIT_ENTRY` dictan en tiempo de ejecución si el socio puede ingresar en `ATTENDANCE_VISIT` o adquirir fiado.
4. **CRM & Unified Identity:** El chatbot (`GIMI_CONVERSATION`) y las notificaciones (`NOTIFICATION_LOG`) se conectan directamente con `MEMBER` mediante su ID y teléfono, unificando la atención al cliente con la base de datos operativa.
5. **RAG & Vector Embeddings:** `GIMI_KNOWLEDGE_CHUNK` almacena embeddings vectoriales gestionados nativamente con `pgvector` y un índice HNSW, permitiendo búsquedas semánticas híbridas directas contra la base relacional sin servicios vectoriales externos.
6. **Provenance & Migration:** `IMPORT_MEMBER_LINK` preserva los IDs y filas de origen de los 4,337 socios y 17,776 membresías históricas analizados en `backend/`, garantizando trazabilidad sin inventar datos.
