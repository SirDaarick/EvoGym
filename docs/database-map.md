# EvoGym Database Map

Status: proposed logical design; not an approved physical schema or executable SQL.

This document preserves the database map discussed for EvoGym. It covers the observed frontend workflows and the newly requested member birth date and preferred name. Table names, relationships, fields, constraints, and indexes below are proposals. Unresolved business rules must be confirmed before migrations are written.

## 1. Design decisions and scope

Use PostgreSQL with a relational, transactional model and explicit operational history.

```text
Organization
|-- Branches
|   |-- Cash registers and shifts
|   |-- Sales and payments
|   |-- Inventory
|   `-- Rental assets
|-- Members
|-- Staff
`-- Plan catalog
```

Provisional design assumption: start with one organization and one branch. Organization-level members allow future branches without duplicating people. This is not confirmation of a multi-tenant SaaS requirement or a complete tenant-isolation solution.

### Conventions

| Element | Proposal |
| --- | --- |
| Domain primary keys | `uuid` |
| Money | `bigint` in minor units; MXN amounts are centavos |
| Currency | Explicit code such as `MXN` on monetary operations |
| Quantities | Integers for indivisible units; `numeric(14,3)` for fractional units |
| Personal and business dates | `date` |
| Operational instants | `timestamptz` |
| Status fields | Controlled values, not unrestricted text |
| Optional fields | Marked with `?` in this document |

Editable entities have `created_at` and `updated_at`. Historical events have their recorded time and responsible actor instead of being treated as editable catalogs. Table-specific fields below are in addition to applicable common fields.

Unless overridden by a table definition, `id` is the primary key and relationship identifiers are UUID foreign keys. Natural-language names, codes, descriptions, and references are text. Money fields ending in `_minor` follow the money convention. Exact lengths, enum domains, defaults, foreign-key actions, and remaining nullability decisions belong to the physical schema phase; this document does not silently settle them.

Do not apply soft deletion indiscriminately. Deactivating a catalog entry is different from cancelling a sale, reversing a payment, or correcting a historical event.

## 2. Organization and staff

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `organizations` | `id`, `name`, `status` | Business owner of the data. |
| `branches` | `id`, `organization_id`, `code`, `name`, `timezone`, `address?`, `phone?`, `status` | Code unique within the organization. Timezone defines the operational day. |
| `staff_users` | `id`, `organization_id`, `full_name`, `email?`, `phone?`, `auth_issuer?`, `auth_subject?`, `pin_hash?`, `password_hash?`, `failed_attempts`, `locked_until?`, `status` | Employee identity, separate from members. Supports local secure credential hashes (Argon2id/bcrypt) or external IdP. |
| `staff_roles` | `id`, `staff_user_id`, `role`, `branch_id?` | Branch-scoped permissions; organization-wide roles may have general scope. Exact role and null-scope semantics require confirmation. |
| `staff_sessions` | `id`, `staff_user_id`, `branch_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at?` | Active reception and terminal sessions with explicit lifecycle. |
| `staff_device_pairings` | `id`, `staff_user_id`, `branch_id`, `pairing_code_hash?`, `pairing_code_expires_at?`, `token_hash?`, `device_name?`, `status`, `paired_at?, last_active_at?, revoked_at?, created_by` | Temporary 6-digit code device pairing (similar to WhatsApp Web/Smart TV pairing). Allows staff to pair their personal phone securely without memorizing passwords, with instant revocation by the admin. |
| `staff_attendance_logs` | `id`, `staff_user_id`, `branch_id`, `clock_in_at`, `clock_out_at?`, `method`, `notes?` | Labor clock-in/out for trainers and staff using PIN or kiosk, completely decoupled from member visits. |
| `staff_compensation` | `id`, `staff_user_id`, `amount_minor`, `currency`, `pay_period`, `effective_from`, `effective_to?` | Effective-dated salary history. Salary changes must not rewrite historical budget assumptions. |

The prototype contains a `pin` field. Never store plaintext PINs or passwords. Local credentials must use slow cryptographic hashing (e.g., Argon2id or bcrypt) with brute-force protection (`failed_attempts`, `locked_until`).

Reception access to staff information must not automatically grant access to compensation data.

## 3. Members

### `members`

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `id` | `uuid` | Yes | Stable internal identity. |
| `organization_id` | `uuid` | Yes | Owning organization. |
| `home_branch_id` | `uuid` | Yes | Registration branch; does not by itself determine access scope. |
| `member_number` | `text` | Yes | Unique within the organization; preserves leading zeros. |
| `full_name` | `text` | Yes | Full name without requiring unavailable surname components. |
| `preferred_name` | `text` | No | How the member prefers to be addressed; fall back to full name. |
| `phone` | `text` | No | Normalize when supplied; preserve international prefix. |
| `email` | `text` | No | Contact address, not necessarily a login identity. |
| `birth_date` | `date` | No | Date of birth; calculate age instead of storing it. |
| `joined_on` | `date` | Yes | Date the person joined the gym. |
| `credit_limit_minor` | `bigint` | Yes | Maximum authorized debt in minor units. Defaults to 0 (credit/debt disabled). |
| `status` | Controlled status | Yes | Proposed examples: `active`, `inactive`, `blocked`. |
| `created_by` | `uuid` | Yes | Staff actor or technical import identity; physical actor representation to be resolved. |
| `created_at` | `timestamptz` | Yes | Record creation time. |
| `updated_at` | `timestamptz` | Yes | Last modification time. |

An administratively active member does not necessarily have a valid membership or current access rights. If a member's debt exceeds `credit_limit_minor` (or if credit limit is 0 and any debt exists), credit purchases are disabled and reception check-in can be blocked.

Names, phone numbers, and email addresses are not unique identity keys: names repeat and family members may share contact information.

### Related tables

| Table | Specific fields | Rule |
| --- | --- | --- |
| `member_notes` | `id`, `member_id`, `author_id`, `body`, `created_at`, `voided_at?`, `voided_by?` | Authored history with restricted access. |
| `member_eligibility_records` | `id`, `member_id`, `eligibility_type`, `verified_by`, `verified_at`, `valid_until?`, `evidence_file_id?` | Eligibility attestations, such as student status, where required by a plan. |

Physical access hardware (turnstiles, RFID badges, barcodes) and membership freezes/holds are explicitly out of scope: check-in is verified by staff at reception, and membership validity runs continuously without pauses. Do not collect medical information, identity documents, or emergency contacts without an explicit requirement. A family/dependent relationship is not currently established by the observed model and is not assumed here.

## 4. Services, plans, and memberships

Keep these concepts separate:

- Plan: the stable catalog offering.
- Plan version: specific commercial terms.
- Membership: what a member purchased.
- Entitlement: authorized service access, validity, and session allowance.

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `services` | `id`, `organization_id`, `code`, `name`, `status` | Gym, boxing, children's boxing, and similar services. Code unique per organization. |
| `plans` | `id`, `organization_id`, `code`, `kind`, `status` | Stable offering identity; kind distinguishes membership and visit offerings. |
| `plan_versions` | `id`, `plan_id`, `version_number`, `name`, `price_minor`, `currency`, `reference_amount_minor?`, `duration_value`, `duration_unit`, `eligibility_type`, `restriction_notes?`, `published_at` | Published versions are immutable. Unique plan/version pair. |
| `plan_version_services` | `plan_version_id`, `service_id`, `session_limit?` | Included services; composite primary key. |
| `memberships` | `id`, `member_id`, `plan_version_id`, `order_item_id`, `status`, `activated_at?`, `cancelled_at?`, `cancellation_reason?` | Tied to the sold item. Retrying a purchase must not create duplicate memberships. |
| `membership_entitlements` | `id`, `membership_id`, `service_id`, `branch_id?`, `starts_on`, `ends_on?`, `session_limit?`, `status` | Authorized dates, branch scope, and sessions. Null branch scope semantics must be finalized. |
| `entitlement_uses` | `id`, `entitlement_id`, `attendance_visit_id`, `quantity`, `recorded_at`, `reverses_use_id?` | Session consumption history; prevent duplicate consumption for the same attendance and entitlement. |

Rules:

- Renewals preserve previous periods instead of overwriting them.
- Catalog price changes never rewrite historical purchases.
- Use one consistent validity convention: start inclusive, end exclusive.
- Monthly duration follows an explicit calendar policy, not an assumed 30-day period.
- Payment and access activation are related but distinct actions.

The current plan editor uses a percentage to calculate the final price, but the percentage is not persisted as a plan attribute. Preserve the final price, reference amount, and immutable purchased terms. Do not infer an automatic dependency between plans from this UI calculation.

## 5. Attendance and trial classes

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `attendance_visits` | `id`, `branch_id`, `member_id?`, `service_id`, `visit_order_item_id?`, `trial_visit_id?`, `checked_in_at`, `checked_out_at?`, `close_reason?`, `recorded_by` | Member access, paid one-time visit, or trial with a valid source. |
| `trial_visits` | `id`, `organization_id`, `branch_id`, `member_id?`, `full_name`, `phone?`, `service_id`, `scheduled_at?`, `used_at?`, `status`, `recorded_by` | Dedicated trial history; does not require creating a membership. |

A matching name may justify a repeated-trial warning, but does not prove identity. Repeat-entry and open-visit constraints depend on the final attendance policy.

Observed gap: the current trial UI routes through the membership operation. The proposed separation is not already implemented.

## 6. Sales, payments, and member balances

### Sales

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `orders` | `id`, `branch_id`, `shift_id`, `member_id?`, `order_number`, `status`, `currency`, `subtotal_minor`, `discount_minor`, `discount_reason?`, `discount_authorized_by?`, `tax_minor`, `total_minor`, `is_overtime`, `credit_authorized_by?`, `due_on?`, `created_by`, `confirmed_at?` | Purchase header; member optional for anonymous sales or one-time visits. Discounts require reason and authorizer when non-zero. `is_overtime` flags shift-transition sales. |
| `order_items` | `id`, `order_id`, `line_number`, `kind`, `product_id?`, `plan_version_id?`, `rental_rate_id?`, `description`, `quantity`, `unit_price_minor`, `discount_minor`, `discount_reason?`, `tax_minor`, `total_minor` | Immutable sold descriptions and prices. Unique line number per order. |

Use explicit source foreign keys according to item kind. Avoid a generic operational `entity_id` that can reference unrelated tables without referential integrity. The physical schema must enforce permitted source combinations and reconcile row/header totals using the approved rounding policy.

### Payments

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `payments` | `id`, `branch_id`, `shift_id`, `terminal_id?`, `member_id?`, `method`, `status`, `amount_minor`, `currency`, `fee_minor`, `net_amount_minor?`, `external_reference?`, `external_intent_id?`, `card_brand?`, `card_last_digits?`, `authorization_code?`, `received_at`, `confirmed_at?`, `recorded_by` | Received or pending payment. For card terminal payments (Mercado Pago Point), captures intent lifecycle, device ID, card metadata, and processing fee. |
| `payment_allocations` | `id`, `payment_id`, `order_id`, `amount_minor`, `allocated_at`, `reverses_allocation_id?` | Allocate payments to purchases; supports mixed tender and later repayments. |
| `payment_verifications` | `id`, `payment_id`, `action`, `result`, `actor_id`, `occurred_at`, `evidence_file_id?`, `notes?` | Separate voucher review, bank confirmation, and rejection. |

Example: an MXN 500 purchase paid with MXN 200 cash and MXN 300 transfer has one order, two payments, and two allocations. The transfer portion is not confirmed until the defined verification is satisfied.

Allocation totals cannot exceed available confirmed funds when treated as settled. Pending allocation/confirmation behavior must be explicitly defined rather than counted as received money.

### Credit and receivables

| Table | Specific fields | Rule |
| --- | --- | --- |
| `member_credit_entries` | `id`, `member_id`, `amount_minor`, `kind`, `payment_id?`, `order_id?`, `refund_id?`, `reverses_entry_id?`, `reason`, `created_by`, `created_at` | Signed credit history: origin, application, and correction. |

Do not use a single editable `creditMinor` value as the complete account record.

- Receivables derive from authorized credit sales and confirmed settlement allocations.
- Available member credit has its own traceable history.
- A pending transfer does not automatically become a credit sale or debt.
- Applying existing member credit is not a new receipt of money.
- Prevent concurrent over-application of payments or member credit.
- Source constraints and transaction rules must prevent counting the same funds as both allocated payment and unused credit.
- Direct credit/debt policy: `credit_limit_minor` defaults to 0 on member records. When the limit is 0, credit sales (fiado) are completely disabled. If a member carries any outstanding debt, new credit is rejected and reception check-in is deactivated/blocked until the balance is paid.

## 7. Returns and refunds

Returning an item and returning money are separate events.

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `returns` | `id`, `order_id`, `branch_id`, `shift_id`, `reason`, `status`, `created_by`, `created_at` | Return header. |
| `return_items` | `id`, `return_id`, `order_item_id`, `quantity`, `amount_minor`, `stock_disposition` | Returned quantities and whether stock is restored or discarded. |
| `refunds` | `id`, `return_id`, `original_payment_id?`, `shift_id`, `method`, `amount_minor`, `currency`, `status`, `external_reference?`, `processed_by`, `processed_at?` | Actual refund or member-credit outcome. |

Rules:

- Never return more units than sold, including previous returns.
- Never refund more than permitted by the original transaction and prior refunds.
- Restore inventory only when the returned goods are saleable.
- Preserve the original sale.
- A pending return is not an executed refund.
- Define explicit source rules for monetary refunds versus member-credit refunds.

This model can represent partial quantities, but the current frontend returns complete sale lines. Partial-return eligibility and UI behavior are not approved by this schema proposal.

## 8. Cash registers and shifts

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `payment_terminals` | `id`, `branch_id`, `code`, `name`, `provider`, `device_id`, `mp_store_id?`, `mp_pos_id?`, `status` | Physical Point terminal registered per branch. Decoupled from cash registers so terminals can be shared, replaced, or expanded across multiple branches without code changes. |
| `cash_registers` | `id`, `branch_id`, `code`, `name`, `default_terminal_id?`, `status` | Physical or operational register. Optional default payment terminal. |
| `shifts` | `id`, `cash_register_id`, `opened_by`, `closed_by?`, `opened_at`, `closed_at?`, `status`, `opening_cash_minor`, `expected_cash_at_close_minor?`, `counted_cash_minor?`, `difference_minor?`, `closing_notes?` | One open shift per register. |
| `shift_denomination_counts` | `shift_id`, `denomination_minor`, `quantity` | Closing denomination count; composite primary key. |
| `cash_movements` | `id`, `shift_id`, `direction`, `amount_minor`, `payment_id?`, `refund_id?`, `expense_id?`, `extra_movement_id?`, `reason`, `recorded_by`, `recorded_at` | Physical cash only, with constrained traceable sources. |

Card and transfer payments do not increase drawer cash. Opening cash is the shift baseline; avoid counting it again as a sale receipt.

Closed shifts retain their closing calculation. Subsequent corrections require traceable adjustments rather than silent edits. Shift closure and new movements must share a concurrency protocol so no operation can post to a shift after its closing snapshot is frozen.

## 9. Expenses, extras, and budgets

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `expense_categories` | `id`, `organization_id`, `code`, `name`, `status` | Rent, utilities, maintenance, and other expense categories. |
| `expenses` | `id`, `branch_id`, `shift_id?`, `category_id`, `concept`, `payee_name?`, `amount_minor`, `currency`, `method`, `status`, `incurred_on`, `paid_at?`, `recorded_by`, `evidence_file_id?` | Distinguish an incurred expense from a paid expense. |
| `extra_movements` | `id`, `branch_id`, `shift_id?`, `concept`, `direction`, `amount_minor`, `currency`, `method`, `occurred_at`, `staff_user_id?`, `recorded_by` | Explicit exceptional inflow or outflow. |
| `budget_periods` | `id`, `branch_id`, `starts_on`, `ends_on`, `version`, `status`, `created_by` | Versioned period budget. |
| `budget_lines` | `id`, `budget_period_id`, `category_id`, `description`, `planned_amount_minor`, `currency` | Planned amounts, separate from actual expenses. |

A budget is not an expense, and a configured salary is not a salary payment. A complete payroll module is outside this proposal.

## 10. Products and inventory

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `products` | `id`, `organization_id`, `sku`, `name`, `category`, `kind`, `stock_unit`, `sale_price_minor`, `currency`, `reference_cost_minor?`, `flavor?`, `status` | Retail and supplement products. SKU unique per organization. |
| `stock_balances` | `branch_id`, `product_id`, `quantity`, `version`, `updated_at` | Operational balance; composite primary key. |
| `stock_movements` | `id`, `branch_id`, `product_id`, `kind`, `quantity_delta`, `unit_cost_minor?`, `order_item_id?`, `return_item_id?`, `stock_count_item_id?`, `reason?`, `recorded_by`, `recorded_at` | Restocks, sales, waste, returns, and adjustments. |
| `stock_counts` | `id`, `branch_id`, `status`, `started_at`, `completed_at?`, `counted_by`, `approved_by?` | Physical count header. |
| `stock_count_items` | `id`, `stock_count_id`, `product_id`, `expected_quantity`, `counted_quantity`, `variance`, `counted_at` | Observed differences and linked adjustment. |

Update a balance and its movement in the same transaction. Balances are efficient operational projections; movements explain their origins. Use an atomic conditional update or locking protocol to prevent overselling.

Define physical-count reconciliation against concurrent sales before implementing adjustments; a snapshot variance alone must not overwrite intervening movements.

Start supplements in the unit represented by the current frontend: scoops. Container, gram, and scoop conversion rules need confirmed package quantities, replenishment behavior, and waste policy.

Retail price is never a substitute for inventory cost. A reference cost is not a complete inventory valuation policy.

## 11. Lockers and gloves

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `rental_assets` | `id`, `branch_id`, `code`, `kind`, `status`, `glove_color?`, `glove_ounces?` | Individually identified locker or glove pair. |
| `rental_rates` | `id`, `organization_id`, `asset_kind`, `version`, `name`, `price_minor`, `currency`, `duration_value`, `duration_unit`, `effective_from`, `effective_to?` | Historical rental terms; define the rate-family/version key in physical design. |
| `rentals` | `id`, `asset_id`, `member_id`, `order_item_id`, `rental_rate_id`, `assigned_by`, `starts_at`, `expires_at?`, `released_at?`, `returned_by?`, `status` | Asset assignment and history. |

Expiry and release are distinct. An expired locker may still be occupied. Availability follows the approved release policy, not just the expiry timestamp.

Prevent incompatible concurrent assignments of an asset. Keep payment status distinct from occupancy and physical return state.

## 12. Configuration, audit, files, and imports

| Table | Specific fields | Rule |
| --- | --- | --- |
| `branch_policy_versions` | `id`, `branch_id`, `effective_from`, `effective_to?`, `allow_expiry_day`, `allow_repeat_visits`, `attendance_close_time`, `refund_window_days?` | Effective-dated operating policy; policy values remain subject to approval. |
| `idempotency_requests` | `id`, `organization_id`, `operation`, `request_key`, `request_hash`, `status`, `result_reference?`, `created_at`, `expires_at` | Retries do not duplicate operations; reject key reuse with different input. |
| `audit_events` | `id`, `organization_id`, `branch_id?`, `actor_id`, `action`, `entity_type`, `entity_id`, `occurred_at`, `request_id`, `changes?` | Restricted audit trail with sensitive fields minimized or redacted. |
| `stored_files` | `id`, `organization_id`, `storage_key`, `content_type`, `size_bytes`, `checksum`, `purpose`, `uploaded_by`, `created_at` | Private object-storage references; avoid large binary vouchers in operational tables. |
| `import_batches` | `id`, `organization_id`, `source_system`, `source_file_hash`, `status`, `started_at`, `completed_at?`, `row_count`, `error_count` | Migration provenance. |
| `import_member_links` | `import_batch_id`, `member_id`, `source_member_id`, `source_row_number` | Links imported members to source records; define batch/source uniqueness and cross-batch identity rules. |

An audit event may have a generic entity reference because it describes an event. Important operational and financial relationships require actual foreign keys.

Do not infer valid membership from an imported administrative `Activo` state. Do not merge people automatically because full names match, or invent missing birth dates. Preserve source identifiers and migration evidence without exposing raw personal records in logs.

## 13. Assistant (Gimi chatbot) and outbound communications

Unified in the same transactional PostgreSQL database to allow direct member phone matching, live catalog queries, and operational alerts without cross-database synchronization overhead.

| Table | Specific fields | Relationships and rules |
| --- | --- | --- |
| `gimi_knowledge_items` | `id`, `organization_id`, `category`, `title`, `content`, `tags`, `author_id?`, `expires_at?`, `created_at`, `updated_at` | Categories: `tariffs_promos`, `schedules_classes`, `regulations`, `supplements_store`. Informs the AI assistant with curated gym guidelines. |
| `gimi_knowledge_chunks` | `id`, `knowledge_item_id`, `chunk_index`, `content`, `embedding`, `token_count`, `created_at` | Semantic text fragment. The `embedding` field uses PostgreSQL `pgvector` (`vector(768)` or `vector(1536)`) for native RAG semantic similarity search. |
| `gimi_conversations` | `id`, `organization_id`, `branch_id?`, `member_id?`, `client_name`, `client_phone?`, `channel`, `contact_type`, `status`, `started_at`, `last_message_at`, `messages_count`, `needs_human_attention`, `summary?`, `alert_reason?` | Channels: `whatsapp`, `web`. `client_phone` matches against `members.phone` to resolve existing member identity. |
| `gimi_messages` | `id`, `conversation_id`, `role`, `content`, `intent?`, `action_taken?`, `suggestions?`, `sent_at` | Chronological conversation transcript with role (`user` vs `assistant`), detected intent, and actions taken. |
| `gimi_alerts` | `id`, `organization_id`, `branch_id?`, `conversation_id`, `member_id?`, `type`, `severity`, `message`, `status`, `created_at`, `resolved_at?`, `resolved_by?` | Types: `churn_risk`, `unresolved_inquiry`, `complaint`, `high_intent_lead`. Escalated to staff reception dashboard. |
| `notification_logs` | `id`, `organization_id`, `branch_id?`, `member_id?`, `channel`, `template_code`, `recipient`, `content_summary?`, `status`, `external_message_id?`, `sent_at`, `error_message?`, `created_at` | Outbound communication log (WhatsApp/email payment receipts, upcoming expiry warnings) preventing duplicate reminders. |

## 14. Initial indexes and constraints

| Query or invariant | Proposed index |
| --- | --- |
| Member number lookup | Unique `members(organization_id, member_number)` |
| Member purchase history | `orders(member_id, created_at DESC, id)` |
| Attendance history | `attendance_visits(member_id, checked_in_at DESC, id)` |
| Product movement history | `stock_movements(branch_id, product_id, recorded_at DESC, id)` |
| Period sales | `orders(branch_id, confirmed_at, id)` |
| Shift operations | `shift_id` indexes on relevant payments and movement tables |
| Pending transfers | Partial branch/date index over pending transfer payments |
| Open shift | Unique partial index per register while open |
| Occupied rental asset | Unique partial index per asset while unreleased |
| Operation retries | Unique organization/operation/request-key index |
| Plan versions | Unique `plan_versions(plan_id, version_number)` |
| Active staff sessions | Unique `staff_sessions(token_hash)` where `revoked_at IS NULL` |
| Active staff paired device | Unique `staff_device_pairings(token_hash)` where `revoked_at IS NULL` |
| Pending pairing code | `staff_device_pairings(pairing_code_hash)` where `status = 'pending'` |
| Staff labor attendance | `staff_attendance_logs(staff_user_id, clock_in_at DESC)` |
| RAG vector search | `gimi_knowledge_chunks` using `HNSW (embedding vector_cosine_ops)` |
| Gimi phone lookup | `gimi_conversations(organization_id, client_phone)` |
| Gimi messages timeline | `gimi_messages(conversation_id, sent_at ASC)` |
| Gimi active alerts | `gimi_alerts(organization_id, status, severity)` |
| Notification deduplication | `notification_logs(member_id, template_code, created_at DESC)` |

Evaluate referencing foreign-key indexes according to joins, deletes, and workload; do not assume declaring a foreign key automatically indexes its referencing columns. Avoid duplicating indexes already supplied by primary keys and unique constraints.

Name search needs an explicit requirement: prefix lookup, substring search, and typo tolerance do not necessarily use the same index.

### Organization integrity

A payment must not reference a member or order owned by another organization. Carry ownership through appropriate composite keys and foreign keys, including indirect branch ownership, as well as authorization checks. An `organization_id` column alone does not guarantee isolation.

Use deliberate delete actions. Do not cascade-delete historical money, inventory, membership, or attendance evidence when deactivating a catalog record or person.

### Performance approach

- Start with transactional tables and workload-specific indexes.
- Use stable pagination for long histories rather than loading all operational records into the client.
- Inspect representative query plans and measured latency before adding persistent summaries.
- Do not introduce partitioning or sharding without evidence of a bottleneck.
- Define backups, restore tests, monitoring, and least-privilege access before production.

## 15. Atomic operation boundaries

These operations complete entirely or roll back:

1. Sale: order, items, payment records, allocations, and applicable stock/cash effects.
2. Transfer confirmation: verification, payment state, and authorized downstream effects.
3. Rental: availability check, asset assignment, and linked commercial operation.
4. Session entry: entitlement validation, attendance, and a single session consumption.
5. Return: quantity validation, return record, applicable stock effects, and synchronous refund records. External refund execution requires explicit pending/failure states and reconciliation rather than assuming an external service rolls back with the database.
6. Cash closure: prevent further shift movements and preserve a consistent closing snapshot.

Cross-row rules such as refund limits, credit availability, session consumption, and allocation totals need transaction/concurrency controls. Do not attempt to implement them as row-level `CHECK` constraints that read other rows. Use appropriate locked updates or a retryable isolation strategy.

## 16. Reports and alerts are views, not new source tables

Initially derive these through queries or views:

- Active and expiring memberships.
- Alert center.
- Shift summary.
- Collections by payment method.
- Operational balance.
- Budget versus actual expenses.
- Low stock.
- Expired rentals.
- Member account statement.

A screen does not require its own table. Persistent summaries can be introduced after measurements demonstrate a need. Define financial projections so payments, refunds, expenses, and cash movements are not counted twice.

## 17. Decisions required before physical SQL

- [ ] Confirm organization, branch, and future tenant scope.
- [ ] Confirm membership activation, renewal, overlap, service access, and calendar rules.
- [ ] Confirm trial eligibility and repeat-use behavior.
- [x] Credit/debt policy confirmed: `credit_limit_minor` defaults to 0 (no debt allowed). Any debt disables new credit purchases and blocks reception check-in.
- [x] Scope boundary confirmed: Physical turnstile/RFID hardware and membership freezes/holds are explicitly out of scope.
- [x] Staff credentials confirmed: Local PIN/password must be securely hashed (Argon2id/bcrypt) with brute-force lockouts and tracked in `staff_sessions`.
- [x] Card terminal integration confirmed: Mercado Pago Point terminals modeled via `payment_terminals` per branch and detailed in `payments`.
- [x] Assistant & Notifications confirmed: Unified PostgreSQL tables for Gimi (`gimi_conversations`, `gimi_messages`, `gimi_knowledge_items`, `gimi_alerts`) and `notification_logs`.
- [x] Shift opening & Overtime confirmed: Stepper modal for opening cash denominations + inventory audit; overtime sales marked with `is_overtime`.
- [x] Staff Attendance & Device Pairing confirmed: Decoupled labor attendance (`staff_attendance_logs`) and 6-digit pairing (`staff_device_pairings`).
- [ ] Confirm transfer verification authority and pending-sale stock behavior.
- [ ] Confirm return eligibility, partial returns, refund methods, and stock disposition.
- [ ] Confirm card fees, monetary rounding, taxes if applicable, and settlement behavior.
- [ ] Confirm rental duration, renewal, expiry, and asset-release rules.
- [ ] Confirm supplement unit conversion and inventory valuation if required.
- [ ] Define privacy, retention, file access, and audit policies.
- [ ] Finalize every field type, nullability, status domain, default, key, and foreign-key action.
- [ ] Translate the accepted map into an ER diagram, migrations, and transactional verification scenarios only when implementation is authorized.

## 18. Evidence and references

Repository evidence used during read-only exploration and frontend implementation:

- `frontend/src/domain/models.ts` - current entities, integer-centavo convention, purchased-plan snapshots, and membership/payment separation.
- `frontend/src/domain/gimi.ts` - Gimi chatbot knowledge categories, conversation states, assistant alerts, and message models.
- `frontend/src/features/shifts/ShiftOpenModal.tsx` - 3-step opening modal with cash denomination counter, inventory audit, and confirmation.
- `frontend/src/features/reception/StaffAttendanceView.tsx` - staff labor attendance check-in/out by reception or kiosk.
- `frontend/src/features/reception/OvertimeSaleToggle.tsx` - transition sales indicator with `is_overtime` toggle.
- `frontend/src/features/staff/DevicePairingModal.tsx` & `DevicePairingView.tsx` - 6-digit pairing code generation and redemption for mobile staff access.
- `frontend/src/features/reception/PointPaymentModal.tsx` - Mercado Pago Point terminal checkout modal and transaction states.
- `frontend/src/demo/plans.ts` - catalog and purchase snapshot behavior.
- `frontend/src/features/owner/PlanEditor.tsx` - calculated price/reference behavior.
- `frontend/src/features/members/NewMemberRegistration.tsx` - trial routing and separate pending-balance adjustment.
- `frontend/src/features/staff/staffStore.ts` - prototype staff role, salary, and PIN fields.
- `frontend/src/demo/salesOperations.ts` - sale confirmation and retry behavior.
- `frontend/src/demo/returnOperations.ts` - whole-line returns and stock restoration.
- `frontend/src/demo/attendanceOperations.ts` - attendance lifecycle.
- `frontend/src/demo/lockerOperations.ts` and `frontend/src/demo/gloveOperations.ts` - rental lifecycle.
- `frontend/src/demo/supplementOperations.ts` - scoop inventory and sales.
- `odd/tasks/frontend-v2.md` - business requirements and unresolved operating policies.

Official PostgreSQL references:

- [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [Multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)
- [Partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)

## 19. Next step

Review this map by domain and resolve the open business decisions before writing migrations. Saving this document does not approve every proposed policy or authorize backend implementation.
