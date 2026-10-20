# Frontend Migration and Data Plan

**Goal:** move workflows to the required local-first command/query boundary without mixing demo ownership and production sync state. Each provisioned device works independently through WAN outage, retaining durable local operations for later server reconciliation; no frontend files are changed here. See the [local-first and sync subplan](08-local-first-and-sync.md).

**Current backend checkpoint:** BK-012 adds infrastructure health and diagnostics only; no frontend authentication or business-data path is connected. The frontend migration sequence and client source-of-truth rules below remain unchanged.

## Baseline and migration principles

- `frontend/src/domain/models.ts` contains a demo aggregate; map its fields to normalized storage intentionally rather than treating each interface as a table.
- `DemoProvider`/localStorage has broad coupling (71 callers observed in prior exploration). Some independent stores exist. Inventory usages before each slice; do not globally replace blindly.
- `frontend/README.md` describes operations as abstracted through `DemoProvider` and typed domain models. Treat its “ready for backend” claim as a starting hypothesis: field, status and side-effect compatibility must be verified.
- Keep `backend/` notebook/data workspace independent; never overwrite or inspect private workbooks as a migration source.
- Do not let a feature mix demo and synchronized member sources. Production UI reads/writes through one local repository boundary backed by scoped IndexedDB + FastAPI sync; local projection is not a second canonical server authority. `DemoProvider`/whole-state localStorage remains demo-only until a deliberately migrated slice replaces it.
- Keep demo fixtures synthetic and identifiable; never use real member records in tests, screenshots or committed fixtures.

## Incremental integration pattern

1. Define API request/response DTO and map to existing UI view model in a feature adapter/repository seam. The same repository owns local IndexedDB projection and command submission online/offline; frontend validation is advisory and server Python use cases remain canonical.
2. Keep UI components focused on interaction; move loading, provisional/accepted/rejected/conflict state, retry and server errors into feature data hooks/services consistent with existing frontend conventions.
3. Switch one feature slice at a time behind explicit config/deployment boundary; do not dual-write to demo and server or create a separate online/offline writer. New writes enter one durable local command journal and fast-path sync when connected.
4. On success, remove/disable the old demo mutation path for that slice; preserve unrelated demo features. Show local provisional vs server accepted state explicitly.
5. Test refresh/restart, retries, stale `as of` reads, authorization denial, empty state, queue recovery, sync conflicts, storage failures and network partitions before continuing.

## Workflow-to-API mapping

| Frontend workflow | Proposed API/domain slice | Source-of-truth migration notes |
|---|---|---|
| Member directory/profile/create | `GET/POST/PATCH /members` and profile projection | Start read-only; restrict notes/eligibility fields. Optional `preferred_name` and `birth_date` do not imply age storage. |
| Plan/service selection | Catalog plan versions | UI discount percentage calculation is not persisted policy; immutable published terms. |
| Checkout/payment | Orders, payments, allocations, provider order adapters, reconciliation | Server resolves catalog/member/branch/merchant/order snapshot. Point card dispatch requires an authorized staff session/open shift and selected registered terminal; show busy/pending/unknown/reconcile states, never silently treat as cash. Online hosted Checkout Pro Orders URL is one-time renewal flow delivered only after customer-to-member verification; browser return is not settlement proof. Do not mix card, cash drawer or membership activation. |
| Membership/profile/access | Membership activation, entitlement, attendance | Cached entitlement is stale/as-of; attendance offline is a candidate observation only after D-005/D-013 policy; no activation, debt/current eligibility claim or hardware unlock from stale data. |
| Trials | Trial lifecycle endpoints | Do not reuse membership mutation merely because demo currently routes that way. |
| Shift summary/open/close | Registers, shifts, denomination counts, cash movements and sync receipts | Cached summary is labelled as-of; shared shift open/close/post policy is not assumed safe offline. Any approved offline cash fact is provisional and reconciled against canonical shift snapshot; never erase it by choosing a version. |
| Product sale/inventory | Orders + stock ledger | Retail unit vs scoop serving distinct; physical count not adjustment. New exclusive stock/availability claims are online-only initially; a permitted cash-received observation may be provisional and can conflict with server stock. |
| Rental/return/refund | Rental events, return items and refund states | New rental/asset grant and refunds online-only initially. A physical return/condition observation may be queued only by policy; do not show the asset released or refund complete until server acceptance. |
| Expenses/extras/staff | Finance and labor endpoints | Expenses, extra movement, waste and labor attendance remain separate concepts. |
| Admin reports | Read projections from reliable source events | Metric definition, timezone, period and report retention must be resolved. |
| Gimi/notifications/member renewal | Allowlisted application commands, verified identity, Checkout Pro Orders renewal URL and outbox | Requires internet; never queue a provider link/chat/notification side effect for blind replay. Verify intended member identity before disclosure; server chooses current quote/scope; no PII in URL. Delivery is not payment proof; callback reconciliation precedes settlement/activation. |

## Local-first interaction states

For every migrated feature, distinguish `local-only draft`, `queued`, `syncing`, `accepted`, `rejected`, `conflict`, `dependency blocked`, `snapshot required`, and `as of cursor/time` in user-appropriate copy. These are conceptual client states, not fixed API enum/version choices. A green local save indicator requires a successful durable IndexedDB transaction; it must not be worded as “saved to server” until the receipt is accepted. Show outstanding operation count, last successful sync and a clear manual retry/support action without leaking member details.

- The cached PWA shell may open offline only after a successful provisioning/install; clean first install may need internet. IndexedDB is the structured projection+journal, not whole-state localStorage. If storage quota/persistence or transaction fails, do not claim success or perform an irreversible action.
- Use online fast-path sync through the same command boundary; reconnect/foreground/resume/manual retry are required. `navigator.onLine` is only a hint; background sync is optional. Lost acknowledgement resends the same operation ID and displays receipt outcome.
- Server rechecks current authorization and business invariants. Local clock, cached role, plan price, member identity, branch, stock and payment status are not trusted authority. Conflicts remain visible until an authorized resolution is pulled back by the device.
- Keep online-only flows visibly blocked before side effects: Point terminal dispatch, hosted payment-link creation, Gimi/cloud calls, refunds, membership activation, shared shift close, new exclusive rental/stock grant, and Admin credential/device changes unless a reviewed policy explicitly changes it.

## Adapter and UI behavior acceptance

- Explicit DTO-to-view-model mapping with exhaustive status handling; unknown server enum fails safely rather than silently mapping to success.
- Loading, empty, validation error, permission denial, retryable dependency failure and unknown financial outcome states are distinct.
- Mutations disable duplicate submit where useful but rely on server idempotency for correctness. For Point terminal dispatch, duplicate clicks/retries reuse one local intent and show terminal busy/unknown states; no automatic blind retry after a timeout.
- Never represent online checkout redirect, chatbot message delivery, or provider-link creation as a paid renewal. Poll/read the local reconciled order state; provide a safe support/reconcile path for unknown outcomes.
- Cross-channel Point and online attempts for one renewal must use a server-enforced state policy; UI must not imply that switching method cancels or refunds the earlier attempt. Prevent local double activation and surface a clear pending/reconciliation state.
- Optimistic updates are limited to reversible non-financial changes; financial/access/stock actions await authoritative server outcome.
- Refresh/navigation restore server state; local draft persistence is separately decided and never treated as committed transaction.
- Use accessible error summary and retry action; never expose raw server traces.
- Keep one local command/query source boundary per migrated feature and one canonical server authority. The local-first substrate is required early, not a later optional enhancement; however each command remains offline-disabled until its policy and proof are accepted. See D-026..D-030 and BK-061..BK-076.

## Provider checkout verification boundary

Use separate synthetic/test environments for the two payment channels. Mercado Pago documents that Point sandbox can simulate state changes but cannot prove compatibility or payment acceptance on a physical production terminal; Checkout Pro Orders provides test accounts/cards for simulated outcomes. The customer UI must never receive provider credentials or raw payment-card fields. See [Point test limitations](https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test) and [Checkout Pro Orders test purchase](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro-orders/integration-test/test-purchase-with-card?scope=prod).

## Legacy mapping and import safety

Build an inventory from source code and documented synthetic fixtures only. Record for each legacy store: name, fields/status meanings, writers/readers, records expected, PII classification, mapping target, dedupe key, validation and retirement trigger. Do not read notebook workbooks or personal datasets without separate explicit authorization.

Future import pipeline must support:

- dry-run by default with row counts, validation failures, quarantined rows and no target mutation;
- source provenance and import batch identity on every imported event/entity;
- deterministic deduplication that does not use names or phone/email as identity proof;
- normalization of dates/timezones, money, enum/status and leading-zero member number;
- reconciliation totals and sampled synthetic fixtures before approved data;
- repeat-safe import, stop threshold, rollback/forward repair and cutover audit;
- explicit privacy retention and secure deletion of source/intermediate artifacts.

## Cutover and rollback checklist

- [ ] API and UI feature use the same domain terminology and state transitions.
- [ ] Read/write ownership switch is atomic at the feature/deployment boundary; no accidental dual writes.
- [ ] Synthetic end-to-end workflow passes in non-production environment.
- [ ] Unknown provider outcome, retry, refresh, and interrupted session have safe behavior.
- [ ] Data migration has explicit authorization, dry-run reconciliation, provenance, quarantine and rollback trigger.
- [ ] Fallback to demo behavior cannot overwrite live records or misrepresent a failed live command as success.
- [ ] Old local data retirement/export handling is defined according to privacy and owner requirements.

## Related tasks

The master ledger tracks BK-014, BK-019, BK-028, BK-031, BK-036, BK-039, BK-043, BK-047, BK-048..BK-051, and local-first substrate BK-061..BK-076. See [08-local-first-and-sync](08-local-first-and-sync.md) for operation envelope, endpoint contract, conflict policy, storage risks and testing. This document never carries independent progress checkboxes.
