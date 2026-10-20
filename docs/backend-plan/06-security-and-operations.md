# Security, Privacy, and Operations Plan

Security is a design input for every BK task, not a final hardening phase. No deployment, credential/session discovery, production probe, or real-data access is authorized by this document.

BK-012 local foundation: request IDs are server-generated; errors are generic; request logs/metrics use only bounded route templates and low-cardinality dimensions; readiness does not expose driver details and has explicit PostgreSQL/pool deadlines. The minimal audit append service rechecks current authority and writes within the caller transaction, but retention/access, database-administrator tamper resistance, complete event coverage, and production operational policy remain unresolved. The early API CI definition uses only synthetic PostgreSQL credentials and does not deploy.

Unexpected pre-response exceptions are converted in the request context so response and completion log share one ID without exposing exception data; once a stream starts, only a terminal body is sent, never a second response start. Local Uvicorn must use `--no-access-log`, because its default access log includes the raw request target. Health readiness runs its synchronous DB probe in a one-worker executor with at most one queued operation and a 2.5-second async deadline; saturation fails closed, and timed-out work retains capacity until the driver operation ends. PostgreSQL connect and statement bounds are two seconds. These limits bound concurrency and waiting; they do not establish deployment SLOs.

## Threat and data boundaries

| Asset / threat | Required control | Plan references |
|---|---|---|
| Member identity/contact/birth date/notes/eligibility | Minimum field purpose/access for first slice; later notes/eligibility retention and deletion rules, export limits, access audit | D-012,D-020, BK-006,BK-016 |
| Staff PIN/password/session | Slow salted hash, rate limiting/lockout, secure reset, token hash at rest, expiry/revocation | D-011, BK-010,BK-011 |
| Employee enrollment and device pairing codes | One-time, short-lived codes; attempt/rate limits; hash at rest; bind to verified staff identity; issue/list/revoke authority restricted to Admin; revoke enrolled device | D-011,D-025, BK-059,BK-060 |
| Payment data/provider callback | No PAN/CVV; separate Point and Checkout Pro Orders adapters; per-product/event signature contract; durable callback inbox; retrieve authoritative status; verify provider account/scope/order/reference/amount/currency before once-only effect; reconcile unknown outcomes | D-017,D-021,D-023,D-024,R-016..R-020, BK-053..BK-056 |
| Cash/stock/entitlement mutation | Server-side role/scope, atomic use case, idempotency, audit and concurrency serialization | R-004..R-009 |
| File/evidence upload | MIME/size limits, malware scan where available, opaque storage key, private authorization, retention and safe download | D-020, BK-016,BK-025 |
| Gimi prompt injection or unauthorized renewal | Verify customer-to-member identity before revealing renewal details or issuing a link; allowlisted domain operation; server-derived quote/branch/provider scope; opaque references without PII; explicit confirmation and audit; no direct DB/provider writes | D-016,D-021,D-022,R-015,R-018..R-020, BK-044..BK-047,BK-057 |
| Import/backup leakage | Synthetic-first dry run, encrypted approved storage, provenance, restricted access, deletion schedule | D-018, BK-049..BK-051 |
| Offline device loss/tampering | Minimal scope cache, bounded grant, safe-origin PWA, current server reauthorization, append-only rejected/conflict history; storage compromise/eviction and unuploaded loss are explicit risks | D-026..D-030,R-021..R-030,BK-061..BK-076 |
| Sync replay/cursor corruption | operation ID + canonical payload hash receipt, scoped dedupe, ordered cursor, snapshot-required recovery, outbox consistency; do not log full payloads | R-021..R-028,BK-064..BK-074 |

## Authentication, authorization, and audit

- Decide identity source before choosing local password/PIN versus identity provider. Never store plaintext PIN/password or bearer token. Admin own-account recovery, session review/revoke, MFA and employee/device enrollment are explicit workflows (BK-058..BK-060); their proofing and recovery policy remains D-025. Staff/Admin login is not customer identity proof for Gimi renewal.
- Enforce rate limits by suitable combination of account, device and network context without creating denial-of-service lockouts; instrument lockout and recovery.
- Define short-lived session/token behavior, revocation, CSRF/origin protection where cookie-based, secure cookie flags, transport security, and secret rotation.
- Use a role/action/branch matrix. Check permission at every request and domain command; UI route visibility is not a security boundary.
- Scope queries in a server-enforced way. Reject client scope escalation and test colliding IDs from another organization.
- Audit actor, action, target, request ID, time and outcome. Avoid dumping full request body, notes, evidence, credentials or payment data. Define audit retention and access.
- Compensation, private notes, eligibility evidence and administrative credential reset require narrower policies than general reception.

## Payment and channel-specific controls

- Keep Point physical terminal dispatch and hosted Checkout Pro Orders renewal links as separate provider adapters over shared payment/order application use cases. Each adapter owns its authentication, request idempotency key, status mapping, cancellation semantics, callback configuration and reconciliation protocol. Do not assume one signing secret, webhook event name/schema, retry schedule or idempotency policy fits both products.
- Never keep a database transaction open across Mercado Pago network calls. Persist scoped local intent/idempotency first, dispatch via durable worker/outbox, then reconcile timeout or callback. A signed notification triggers verification; it is not itself sufficient evidence of funds. The browser success/return path is never payment proof.
- Merchant/account, configured store/POS/terminal, local order, opaque reference, amount, currency and live provider state must agree before the financial effect. Avoid trusted amount/member/branch values from browser or chatbot. Never log access tokens, signatures, full callback bodies, checkout URLs or payment details. Never store PAN/CVV.
- Unknown, conflicting, partial, late or repeated outcomes remain pending/reconcilable; no blind retry, duplicate charge, or membership activation. Refund/chargeback and concurrent Point/online renewal policy must be owner-decided before enabling affected paths.
- Official product guidance: [Point order notifications](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications), [Checkout Pro Orders notifications](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/notifications), and [online order status](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro-orders/payment-management/status/order-status). Verify the exact event configuration/schema for the selected product and API/account; the official online pages currently use differing event labels, so do not unify handlers by assumption.

## Local-first security and resilience

- Treat local device storage and client timestamps as attacker-controlled. Bootstrap only minimal authorized branch projection; require online enrollment and bounded offline grant. Numeric grant TTL and shared-device relock are D-028; disconnected devices cannot receive revocations immediately.
- Server sync ingestion rechecks actor, installation, current role/scope and each domain command. A stale or altered local grant cannot authorize financial effects. Preserve observations for review where appropriate, not as proof of authority. Keep local grant token/key material out of source, logs, analytics, crash reports and URLs.
- Use HTTPS secure origin for PWA; service worker caches shell only. Protect against XSS, CSRF/origin abuse, malicious extensions/shared-device access and offline cache leakage. IndexedDB encryption is not assumed to protect an unlocked origin; minimize sensitive PII and provide user/device partitioning, session lock, local logout/quarantine and retention lifecycle.
- A local outbox is not a generic write API. Allowlisted typed commands only, bounded payloads and batch/rate limits, dependency graph validation, per-operation receipt, same-ID/hash idempotency and changed-hash rejection. Never mass-assign server tables. Conflict resolution requires current online Admin/domain permission, reason, expected revision and audited domain remedy.
- Browser storage persistence may be denied or evicted; device loss, clear/reinstall or corruption before upload can lose unacknowledged history. Do not promise zero loss. Fail closed before saying “saved” or taking irreversible action when local journal write fails.
- Do not retain every raw operation payload forever. D-030 decides purpose, retention, redaction, secure purge and tombstones. Deleting a receipt/change cursor too early can cause financial replay or sync gaps; align retention with minimum supported client and force consistent snapshot/reconciliation before purge.
- Keep sync change journal separate from business audit and provider payment outbox/inbox. Restore database, dedupe receipts, cursor high-water mark and server outboxes coherently; monitor queue age, conflict severity, grant-expired/rejected operations, cursor resets and local quota errors with payloads/PII redacted.
- No central backup exists for queued local commands until a device syncs. Optional encrypted export/recovery is not promised; key management and privacy require separate approval.

## Gimi and notification safety

Gimi is in planned scope, but no chatbot is an authority. It may call only approved read/action use cases. Restrict data by actor and purpose; require confirmation for financial, membership, access, staff or personal-data changes as decided; apply idempotency and standard domain audit. Notifications use an outbox and minimal message content. Handle provider retry/unknown outcome without duplicates; avoid including sensitive details in push/email/SMS previews.

## Files, secrets, and dependency hygiene

- Keep secrets in environment/secret manager appropriate to the chosen host; never commit `.env`, logs, provider credentials or real datasets.
- Validate uploaded file size/type/content, randomize storage identifiers, store outside public web root, and authorize every retrieval.
- Pin dependencies only after a supported version choice; run dependency vulnerability/license review and lockfile checks in CI; update with tested changes.
- Configure CORS, trusted hosts, TLS, request size/time limits, rate limits and secure headers for the deployment topology.
- Separate dev/test/staging/production credentials and data. Synthetic fixtures only in ordinary tests.

## Operational readiness

| Area | Required future evidence |
|---|---|
| Migrations | Reviewed migration plan, fresh/upgrade proof, lock/downtime estimate, recovery path, backward compatibility, and PostgreSQL Alembic version-width compatibility for every published revision. |
| Backups | Encrypted backup schedule, retention, access controls, restore rehearsal and measured recovery objectives. |
| Health | Liveness vs readiness distinction, DB/provider dependency status without leaking internals. |
| Logging/metrics | Request correlation, error and latency distributions, queue depth/age, per-device last sync, conflicts by severity, snapshot-required count, quota failures, settlement/stock reconciliation alerts; redact PII/payloads. |
| Incident response | Credential compromise, payment reconciliation, data exposure, import errors, restore and notification failure runbooks. |
| Rollback | Application version rollback compatibility, schema forward repair/restore decision, explicit stop thresholds, no destructive blind rollback. |
| Environments | No production credentials in local/dev; production-like access only by named authorization. |
| Local-first lifecycle | Supported client/schema range, cursor/operation retention compatibility, versioned IndexedDB/service-worker upgrade, queue migration/recovery and device-loss warning. |
| Sync backup | Restore accepted operation receipts, canonical change cursor and server outboxes atomically with domain data; local pending operations remain device-dependent until uploaded. |

## Explicit limits and authorization gates

- RFID/turnstile hardware and membership freezes/holds remain out of scope.
- Modeling Mercado Pago Point terminals or Checkout Pro Orders links does not authorize real provider calls, sandbox transactions, merchant onboarding, credential access or real charges.
- Local-first plans do not authorize collecting/importing real member data, provisioning devices, changing auth/session policy, or claiming zero-loss offline backup; those require approved implementation decisions and authorized operations. Test credentials and test accounts must be separately configured by an authorized owner; real terminal validation requires an approved non-test operation.
- Real-data import and remote deployment are separate operations requiring explicit destination, operation, and credential/session authorization.
- Do not inspect ambient SSH agents, authenticated sessions, hostnames, or remote access paths to infer permission.
- No production or external service call is part of routine verification unless the exact operation is authorized.

## Security acceptance checklist

- [ ] Role/scope matrix and sensitive-field access policy reviewed by owner.
- [ ] Negative auth, cross-scope, revocation, rate-limit and abuse cases verified.
- [ ] Secrets and personal/payment data absent from logs, errors, commits and test fixtures.
- [ ] State-changing endpoints use transaction, audit, idempotency and concurrency controls as applicable.
- [ ] Restore, migration failure and external unknown-outcome procedures are rehearsed safely.
- [ ] Data retention, deletion, export, evidence files and backups have accountable owners.
- [ ] Offline grant/revocation limits, local PII scope, journal recovery and stale-client behavior are reviewed.
- [ ] Sync receipts/cursor restore, storage quota failure, disconnected-device loss and high-severity conflict playbooks are tested.
