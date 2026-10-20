# Domain and Schema Plan

**Status:** Ratified under **BK-007** (Phase P0 is 100% complete). The domain glossary, entity relationship map, and source-of-truth boundaries have been formally reviewed and ratified by the user. Physical schemas and migrations are implemented incrementally starting in Phase P1.

**Purpose:** Establish a verified logical domain map before physical migrations. The inventory below derives from `docs/database-map.md`, domain decisions D-001 through D-027, and frontend operational requirements.

**P1 implementation checkpoint:** migrations through `0004_audit_events` now include only baseline tracking, minimal PIN/auth/session foundation, and a small application audit row (actor, branch, allowlisted action, server timestamp, request UUID). This does not ratify the full proposed governance schema, audit retention, or future business tables; BK-010/011 remain Partial and BK-012 remains Partial until review/commit and operational policy.

## Reading rule and source-of-truth boundaries

1. **Canonical Source of Truth:** Authoritative operational persistence is established in **PostgreSQL**, paired with a local IndexedDB contingency outbox on provisioned front-desk clients for offline store-and-forward operational continuity.
2. **Provisional Legacy Classification:** Existing frontend demonstration state (`DemoProvider` / `localStorage` / `frontend/src/domain/models.ts`) is formally classified as provisional legacy. It must be adapted or replaced slice-by-slice behind verified API adapter seams—never treated as a canonical persistence contract or mixed concurrently with live backend truth.
3. **Contract Isolation:** Database storage, API DTOs, and UI view models are distinct contracts. Do not expose ORM rows directly as API responses or treat demo aggregates as normalized production tables. A feature may compose multiple records into one response. Do not create one table per screen/report.
4. **Deferred Later-Phase Policies:** Unresolved policies for subsequent phases (such as detailed accounting categorization, Gimi tool call scopes, import cutovers) remain explicitly deferred to their respective phases without blocking Phase P1.

## Cross-domain relationship map

```text
organization -> branches -> registers/terminals -> shifts -> orders/payments/cash
organization -> members -> memberships -> entitlements -> attendance visits
organization -> services/plans -> immutable plan versions -> order items
orders -> payments -> channel-specific provider orders/callback inbox -> settlement/credit/refund events
products -> stock movements <- sale/receipt/count/adjustment provenance
branches -> rental assets/rates -> rental events -> returns/refunds
staff -> roles/sessions/audit -> operational events; labor attendance is separate
per-device local journal -> sync operation/receipt -> canonical domain change log -> each provisioned device projection
```

### Tenancy and Cross-Branch Boundaries (D-001 Resolution)

The tenancy architecture is confirmed (D-001) as **single-organization per deployment instance** with native multi-branch (`branches`) capability. For future commercialization to third-party gyms, an isolated instance-per-client model (separate Docker container + isolated PostgreSQL database per client) will be used, completely avoiding single-database multi-tenant complexity.

- **Organization-Level (Shared across branches):**
  - **Member identity & profiles (`members`):** Unified member identity across the organization with mobile phone/WhatsApp as primary natural key. Members do not duplicate across branches (e.g. Fitness vs Box/MMA).
  - **Master service & product catalog (`plans`, `services`, `products`):** Shared across all branches; published plan versions and catalog items are centralized.
  - **Multi-branch memberships (`membership_entitlements.branch_id`):** Nullable field where `NULL` grants access to all branches across the organization, while a specific `branch_id` restricts access strictly to that physical location.
- **Branch-Level (Strictly isolated by `branch_id`):**
  - **Cash registers and shifts (`cash_registers`, `shifts`):** Physical cash drawer and Arqueo Físico shift lifecycle are bound to a specific branch.
  - **Physical payment terminals (`payment_terminals`):** Mercado Pago Point devices bound to a specific branch/counter register.
  - **Physical inventory and stock movements (`stock_movements`):** Warehouse and cooler inventory tracked independently per branch.
  - **Attendance visits / check-ins (`attendance_visits`):** Record the exact physical branch entered.

## Logical inventory

| Domain | Proposed tables and important field groups | Relationships / caution |
|---|---|---|
| Organization | `organizations(id uuid, name, status)`; `branches(id, organization_id, code, name, timezone, address?, phone?, status)` | Code unique within org; branch timezone defines operational day. Single-org multi-branch architecture confirmed (D-001); commercialization uses dedicated container+DB instances per client. Shared members/catalog; branch-isolated cash, terminals, stock, and check-ins. |
| Staff/auth | `staff_users(login_identifier, is_active)`; `staff_credentials(method, secret_hash, failed_attempts, locked_until?)`; `branches(code, name, is_active)`; `staff_role_grants(staff_id, role, scope_kind, branch_id?, is_active)`; `staff_sessions(token_digest, staff_id, branch_id, issued_at, expires_at, revoked_at?)`; later device-pairing records | Current foundation supports PIN only. Org-wide Admin scope is explicit (`scope_kind=organization`); receptionist scope is always an assigned branch. Raw PIN/token never persists. No password/device pairing yet. |
| Labor | `staff_attendance_logs(staff_user_id, branch_id, clock_in_at, clock_out_at?, method, notes?)`; `staff_compensation(amount_minor, currency, pay_period, effective_from, effective_to?)` | Separate from member visit attendance. Compensation has stricter permissions. |
| Members | `members(organization_id, home_branch_id, member_number, full_name, preferred_name?, phone?, email?, birth_date date?, joined_on date, credit_limit_minor bigint, status, created_by, timestamps)`; `member_notes(member_id, author_id, body, void metadata?)`; `member_eligibility_records(member_id, type, verified_by/at, valid_until?, evidence_file_id?)` | Member number unique within agreed scope; names/contact are not identity keys. Notes/eligibility contain sensitive data. |
| Service catalog | `services(code, name, status)`; `plans(code, kind, status)`; `plan_versions(plan_id, version_number, name, price_minor, currency, reference amount?, duration, eligibility, published_at)`; `plan_version_services(plan_version_id, service_id, session_limit?)` | Published terms immutable. Price discount percentage in UI is not automatically a plan attribute. |
| Membership/access | `memberships(member_id, plan_version_id, order_item_id, status, activation/cancellation fields)`; `membership_entitlements(membership_id, service_id, branch_id?, starts_on date, ends_on?, session_limit?, status)`; `entitlement_uses(entitlement_id, attendance_visit_id, quantity, recorded_at, reversal link?)` | Membership purchase is not activation. Start-inclusive/end-exclusive is proposed, calendar and timezone policy unresolved. |
| Visits/trials | `attendance_visits(branch_id, member_id?, service_id, source order/trial, checked_in_at, checked_out_at?, recorded_by)`; `trial_visits(org/branch, member_id?, name, phone?, service_id, scheduled/used times, status, actor)` | Trial cannot create membership by accident. Repeat/open visit policy unresolved. |
| Sales | `orders(branch_id, shift_id, member_id?, order_number, status, currency, subtotal/discount/tax/total_minor, overtime, authorizers, created_by)`; `order_items(order_id, line_number, kind, typed source FKs, immutable description/price/quantity/totals)` | Avoid polymorphic generic source IDs; enforce kind/source consistency and approved rounding. |
| Payments/credit | `payments(branch_id, shift_id, terminal_id?, provider_channel, member_id?, method, internal_status, amount_minor, currency, fee/net, external refs, card metadata, timestamps, actor)`; `payment_allocations(payment_id, order_id, amount_minor, reverses?)`; `payment_verifications(payment_id, action/result, actor, time, evidence?)`; `member_credit_entries(member_id, signed amount, kind, source/reversal, reason, actor/time)` | Internal state and provider channel/status stay separate. Pending is not settlement. Never store PAN/CVV. |
| Returns | `returns(order_id, branch_id, shift_id, reason, status, actor/time)`; `return_items(order_item_id, quantity, amount_minor, stock_disposition)`; `refunds(return_id, original_payment_id?, shift_id, method, amount, currency, status, external ref, processor/time)` | Returned goods and returned money are separate. Partial return support/policy not approved. |
| Registers/shifts | `payment_terminals(branch_id, register_id?, code, provider, device_id, store_id, pos_id, mode, supported_model/config validation, status)`; `cash_registers(branch_id, code, default_terminal_id?, status)`; `shifts(register_id, open/close actors/times, status, opening/expected/counted/difference minor)`; `shift_denomination_counts(shift_id, denomination_minor, quantity)`; `cash_movements(shift_id, direction, amount, typed source FKs, reason, actor/time)` | New openings require physical bill/coin counts whose server-computed sum equals opening cash; counts are observation only and never adjust stock. Historical shifts may have no denomination evidence. One open shift per register; non-cash card settlement does not increase cash drawer. |
| Finance | `expense_categories`; `expenses(branch_id, shift_id?, category_id, concept, payee?, amount/currency/method/status, incurred/paid dates, evidence)`; `extra_movements` with its own business source | Expenses, receptionist-funded extras, waste, and inventory receipts are distinct categories. |
| Inventory | `products(organization_id, code/name/category/image, cost/price, status)`; `stock_movements(branch_id, product_id, kind, quantity, unit/cost valuation, source, actor/time)`; counts and count lines; supplement serving definitions/sales | On-hand derives from movements. Physical count is observation, not adjustment. Scoop-to-container conversion and valuation unresolved. |
| Rentals | `rental_assets(branch_id, code, status)`; `rental_rates(asset/type, price, duration, effective dates)`; `rental_events(member?, order_item, start/due/returned times, condition/actor)` | Expiry alone must not mark asset returned/released. Rental policy unresolved. |
| Governance | `policies`; `idempotency_records(actor/scope/key, request hash, status/response ref)`; `audit_events(actor, action, target, redacted diff, time, request id)`; `files(metadata/storage key, purpose, checksum, actor)`; `import_batches/rows` with source, provenance, validation outcome | Retention, file access, import dedupe, and audit redaction are policy-controlled. |
| Synchronization/control | Server proposals: `device_installations(actor_ref, branch/scope, status, last_seen_at)`; `offline_grants(device_id, actor_ref, policy_version, issued/expires/revoked metadata)`; `sync_operations(device_id, operation_id, origin_sequence, command_type, payload_schema_version/hash, received_at, outcome, receipt_ref)`; `sync_changes(commit_cursor, scoped change/tombstone reference, schema_version)`; `sync_conflicts(operation_id, base_version, canonical_version, classification, status, resolution_revision?)`. Local IndexedDB separately holds projection, schema version, sequence allocator, immutable command journal/outbox, receipts and pull cursor. | Proposed logical structures only; no whole-domain event sourcing. Device journal, server dedupe receipt/change feed, business audit, and provider inbox/outbox are separate. Sensitive payload retention/redaction and cursor/tombstone expiry are unresolved (D-030); tenancy and branch isolation confirmed (D-001). |
| Integrations/payments | `payment_provider_orders(payment_id, channel, provider_order_id, opaque_external_reference, provider_status, provider_status_detail, account/scope binding, terminal/POS or hosted URL reference, timestamps)`; `payment_webhook_inbox(channel, provider_event_id/order_id, event type/version, signature result, received/processed times, dedupe key)`; `notification_outbox` and attempts; Gimi interaction/action audit records | Schemas/names remain proposals. Do not store unredacted checkout URLs as ordinary logs; if retained for delivery, treat them as payment-capable sensitive tokens with limited exposure/retention. No direct DB/provider bypass. |

## Required payment channel model

Mercado Pago is a required **two-channel** integration (D-021), not a card method handled by one generic provider call:

1. **Reception Point:** authenticated staff selects card on an order while a shift is open; the server derives the immutable amount/currency/order reference and sends a Point order to the registered POS/terminal association. Track the exact provider order lifecycle; a card transaction is not cash-drawer currency.
2. **Gimi online renewal:** after customer identity is verified, the server creates a one-time renewal order from the server-side plan/version and current renewal quote, then delivers the provider-hosted checkout URL. Online orders and memberships are distinct local records. No automatic subscription/recurring charge is in scope.

Both paths link a provider order back to local order/payment/renewal attempt through an opaque non-PII reference and channel-specific adapter. Provider callbacks are input events, not payment truth; keep separate per-channel event configuration/signature verification and retrieve/validate the current remote resource before irreversible local effects. The selected API's exact event topic, request schema, supported Point hardware and reconciliation operations must be checked before implementation. A transaction table or internal map does not imply an approved physical schema.

Offline sync uses its own append-only client operation journal, server receipts and canonical change cursor; it is distinct from payment-provider outbox/inbox and audit. See the [local-first architecture plan](08-local-first-and-sync.md). The specific client projection/journal tables are proposed, not approved schema.

Provider order and checkout URL are not customer identities. Do not include member name, phone, email, birth date, or member number in externally visible URL/reference. Link expiry, supersession and pending competing Point/online payment rules are blocked by D-022..D-024.

## Key/nullability/type decisions

Use UUID primary keys as a proposal, but settle all key ownership with D-002. Preserve member numbers as text to retain leading zeroes. Personal/business dates should be `date`; event instants should be timezone-aware instants stored consistently. Money should use integer minor units plus explicit currency; do not mix floats or infer fee/tax rounding. Indivisible quantities may be integer; fractional stock may use fixed precision after units and conversions are defined. `?` means candidate nullable, not approved nullable. Defaults, lengths, enum values, FK delete behavior, checks, indexes and uniqueness are all pending physical-schema review.

## Relationships and constraints to decide per slice

- Scope every query and unique constraint according to D-001 (shared members/catalog at org level, strict `branch_id` isolation for registers, shifts, Point terminals, stock movements, and attendance visits); test cross-branch boundaries.
- Use typed foreign keys for order item source kinds, refund source, cash movement source, and import provenance.
- Preserve immutable snapshots for sold plan terms and items; catalog edits do not rewrite historical purchases.
- Require positive quantities/amounts where appropriate, nonnegative totals, consistent currency, and line/header reconciliation after rounding policy is approved.
- Define uniqueness/partial indexes for member numbers, plan version numbers, one open shift, idempotency keys, source event deduplication, operation_id per installation, receipt lookup, canonical change cursor and entitlement consumption.
- Index access paths from actual list/filter/report queries, tenant scope plus key, date ranges, and event source. Validate query plans only after real workload is known; do not index every field.
- Define restrict/cascade/soft-disable behavior explicitly; never cascade-delete financial history or audit evidence as a convenience.

## Field-design checklist

- [ ] Define actor, owner scope, sensitivity, retention and purpose for every field.
- [ ] Distinguish mutable catalog fields from immutable event snapshots.
- [ ] Document required/optional fields and normalization without over-collecting PII.
- [ ] Specify currency, units, precision, timezone and date boundaries.
- [ ] Specify FK actions, uniqueness, checks, concurrency locking and idempotency.
- [ ] Map DB row to request DTO, response DTO and UI model independently.
- [ ] Provide migration and rollback/data-recovery treatment for each new constraint.

For local sync structures, separately define retention/redaction of command payloads, unique `(installation_id, operation_id)`, same-hash receipt replay, changed-payload mismatch, cursor ordering, snapshot consistency, tombstone expiry, and compatibility with the oldest supported unacked client. Never cascade-delete a receipt/change needed to prevent replay or cursor gaps.

## Module migration acceptance

Before a module migration: identify relevant D/R/BK decisions; review table/field ownership; write fresh-database and upgrade-path proof; include referential, check, unique, and query-index choices; test invalid data and rollback/forward recovery; record data-loss risk. Never run an unreviewed destructive migration on production-like data. See BK-009 and [migration coverage](05-verification-and-coverage.md#migrations-and-data-integrity).

## Evidence source

- `docs/database-map.md` — proposed logical model and explicit caveats.
- `odd/tasks/frontend-v2.md` — workflows and unresolved UX/data policies.
- `frontend/README.md` — frontend currently presents demo abstractions as backend-ready; verify each mapping rather than assuming normalized contracts.
