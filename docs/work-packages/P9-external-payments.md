# P9 — External payments and provider reconciliation

**Primary owner:** unfinished BK-053–057 residuals; BK-057 Gimi renewal-link provider capability has one primary owner here.
**Contributors:** P1 identity/branch grant, P3 internal order/payment/period/idempotency, P4 register/shift context, P5 published plan quote, P10 Gimi identity/permission and delivery/UI join. These contributors keep their own ownership.
**Suggested assignee:** Backend payments engineer experienced in signed webhook validation, durable idempotency and reconciliation, paired with an authorized provider account owner only after explicit permission.
**Helpful skills:** threat-modeling webhook ingress, cryptographic signature verification from official provider specifications, state-machine/reconciliation design and secret-safe operational testing.
**State:** Planning only; no provider APIs, SDKs, products, endpoint fields, signatures, URLs, credentials or account configuration were verified in this documentation phase. No provider contact or sandbox test is authorized.

## Objective and readiness

Add explicit Point and Checkout Pro payment paths without trusting client-calculated amounts or a browser redirect. A valid external observation may inform—but never directly mutate around—the P3 order/settlement boundary. Persist provider attempts, callbacks and reconciliation as durable, scoped, idempotent evidence. Exactly one eligible internal settlement can activate a purchase even when Point and hosted online checkout compete.

| Subdelivery | Readiness | Gate |
|---|---|---|
| Point operation contract (BK-053) | Contract-ready; provider execution blocked | D-017 merchant binding + explicit provider operation/account/session permission |
| Hosted Checkout Pro renewal link (BK-054) | Contract-ready; provider execution blocked | D-017 binding, P3 server quote and explicit permission; one-time link only per ledger scope |
| Callback authentication/dedupe/reconciliation (BK-055) | Security-design blocked pending official provider contract | Verify official docs at implementation time; never invent signature/header/body semantics |
| Exactly-once competing attempts (BK-056) | Decision-blocked | D-023 cross-channel collision policy unresolved; P3 settlement owner required |
| Expiry, late, partial payment/refund behavior | Decision-blocked | D-024 unresolved; do not infer provider or access consequences |
| Gimi renewal link (BK-057) | Contract-ready with P10 milestone | D-022 requires verified incoming WhatsApp number matched to registered member mobile; P10.1 identity/permission must precede P9.5 link capability |
| Offline provider operation | Not allowed by current package | P7 queue cannot authorize a provider attempt offline; keep provider initiation online-only |

## Boundaries and provider contract

**In:** BK-053 Point terminal card order initiation, BK-054 server-priced one-time Checkout Pro renewal order/link, BK-055 provider-specific authenticated callbacks and reconciliation, BK-056 exactly-once settlement across competing channel attempts, and BK-057 verified member-to-Gimi renewal link generation capability.

**Out:** catalog price/version ownership (P5); internal order/payment/entitlement settlement authority (P3); notification content, recipient permission and delivery UI (P10); all external provider API details not established by authorized primary documentation; recurring subscriptions; offline provider requests; real accounts, credentials, terminals, callbacks, sandbox, PostgreSQL, hosted CI or production operation.

The API provider contract is **proposed and unresolved**. Public official-documentation research is read-only and does not require provider-account credentials or a session; verify primary sources when that research is within the assigned scope. Cite the source/version for request/response fields, merchant ownership, webhook signature verification, event types, idempotency support, expiry, status query, refunds, currency and operation limits. No field names, signature schemes, endpoint URLs or retry promises are specified here before that evidence exists. Any actual provider account/API/sandbox/charge/webhook operation requires explicit authorization naming the destination, operation and session; this plan grants none.

| Invariant | Required outcome |
|---|---|
| Server-priced immutable quote | P3/P5 calculate and freeze amount, currency, member, plan version and period; client cannot change authoritative value. |
| Scoped attempt | Provider attempt references internal order, branch/register, channel, amount and actor; terminal/link is bound to the approved merchant/account. |
| Callback authenticity | Reject invalid signature, wrong account/order/amount/currency, replay or out-of-scope event; log redacted correlation only. Exact provider validation remains TBD. |
| Durable event lifecycle | Attempt/callback/reconciliation is idempotent and append-only; repeated delivery returns prior result. |
| Unknown result | Timeout/redirect loss never means failure or success; query/reconcile original attempt, do not create a fresh charge/link automatically. |
| Single settlement | Across Point/Checkout Pro contenders, one internal settlement transition only; other attempts become linked duplicate/cancelled/under-review per approved D-023 semantics. |
| Member and Gimi identity | Before link disclosure, verified WhatsApp phone must match the registered member mobile (D-022); no name/phone guess or cross-branch dedupe. |
| Payment vs entitlement | Provider event is evidence; P3 owns internal settlement/access state and approved D-024 consequences. |

## Existing seams and proposed paths

Existing internal API seams: `api/app/api/sales.py` (membership cash/transfer and debt routes), `api/app/api/catalog.py` (plan/version reads), `api/app/api/shifts.py` (register/shift/terminal context), `api/app/sales/`, and `api/app/audit.py`. Existing tests `api/tests/test_sales.py`, `test_catalog.py`, and `test_shifts.py` cover current internal seams, not external provider APIs. Existing FE checkout seams: `frontend/src/api/membershipCheckoutApi.ts`, its test, and `frontend/src/features/reception/LiveMembershipCheckout.tsx` plus its test.

No provider-specific adapter or callback module was established by the source mapping. **PROPOSED conditional paths:** `api/app/payments/point_attempts.py`, `checkout_pro_attempts.py`, `provider_callbacks.py`, `reconciliation.py`, and a narrowly scoped `api/app/api/provider_callbacks.py`; select only after provider contract review. New test files are proposed and do not exist yet. The provider credential/config source is not specified or authorized. Any migration must use an explicitly reserved `api/migrations/versions/<revision>_provider_attempts.py` slot.

Shared files `api/app/main.py`, model registry, `api/app/db/models/__init__.py`, migration chain, FE App route registry, lockfiles, CI and BK ledger require the named serialized integrator. Provider workers submit registration/migration patches; do not concurrently edit them. Never authorize `api/app/**` or credentials files.

## Subdelivery sequence

| ID | Deliverable | Depends on | Owner/stop boundary |
|---|---|---|---|
| P9.1 | Point attempt contract | P1 scope; P3 order/payment; P4 register/shift; D-017 | Specify internal state transitions without external execution. Stop until exact official contract/session is authorized. |
| P9.2 | One-time hosted checkout contract | P3 quote/order + P5 published plan; D-017 | Server-created immutable quote and safe link result; no recurring/subscription assumption. |
| P9.3 | Callback validation and reconciliation | P9.1/P9.2 provider contracts + P3 payment boundary | Exact signature verification, dedupe, out-of-order/unknown result; only documented provider events. |
| P9.4 | Competing-channel exactly-once settlement | P9.3 + explicit D-023 decision + P3 settlement method | Atomic one-winner settlement; stop if cross-channel collision policy unresolved. |
| P9.5 | Gimi renewal-link provider capability | P10.1 Gimi identity/permissions + P3/P5 quote + P9.2/.3 link/status contract | Return typed link/expiry/attempt result only; P10.2 owns disclosure/delivery/UI. |
| P9.6 | Local synthetic proof and authorized provider proof plan | Approved implementation candidate | Unit/SQLite isolation first; sandbox/live proof requires exact separate permission. |

P9.1, P9.2 and D-017 account/merchant contract exploration can proceed as independent design only. P9.3 needs provider-specific docs for each channel. P9.4 is blocked by D-023 and does not imply a P3 package-wide block. Avoid whole-package cycles: P10.1 → P9.5 → P10.2; P9 provider lanes can work outside the Gimi join.

## Acceptance and failure scenarios

- [ ] Provider/account and environment are explicitly configured from authorized secret management; no local fallback to ambient environment or default credentials.
- [ ] Amount, currency, member, branch, plan version and internal order are checked against the immutable server quote before an attempt.
- [ ] Point and hosted link operations have explicit attempt IDs and safe replay semantics; no double click creates duplicate order/attempt effects.
- [ ] Checkout link is a one-time renewal flow, has documented expiry and is never treated as a recurring subscription.
- [ ] Callback verifies official provider signature/authenticity, account binding, event uniqueness, order scope, amount and currency before P3 settlement.
- [ ] Callback duplicates/out-of-order/late/unknown events are idempotently stored and reconciled; no DB bypass or event-body PII/secrets in logs.
- [ ] Competing Point/hosted attempts cannot create two settled payments or duplicate membership activation; D-023 outcome is explicit before this slice.
- [ ] Expiry, partial, late, refund and entitlement outcomes follow approved D-024 rules; unresolved cases remain pending/under review, not invented defaults.
- [ ] Gimi disclosure occurs only after verified WhatsApp number matches registered member mobile (D-022), explicit identity/permission rules and P10 delivery consent.
- [ ] Provider errors, amount mismatch, signature failure, unavailable status query or unknown result never display “paid” or silently re-submit with a new key.
- [ ] Tests use synthetic payloads and local fakes; no actual provider call or credential is embedded.

| Fault | Expected behavior |
|---|---|
| Duplicate valid callback | Return existing receipt; no second settlement. |
| Invalid signature or unbound merchant | Reject/quarantine; no order/member state mutation. |
| Callback has different amount/currency/internal order | Mismatch under review; no settlement or link disclosure. |
| Browser/provider timeout after possible acceptance | Persist unknown; query original attempt under approved policy. No blind new charge. |
| Both channels authorize near-simultaneously | One atomic winner; loser recorded and reconciled under approved D-023 rule. |
| Expired checkout link | Apply explicit D-024 rule; do not assume renewal or refund outcome. |
| Unverified/mismatched WhatsApp phone | Do not produce or disclose renewal link; no fuzzy identity match. |

## Verification plan — commands are planned, not run

From `api`, existing internal tests only:

    .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_sales.py tests/test_catalog.py tests/test_shifts.py

From `frontend` for existing checkout consumers:

    npm.cmd test -- --run src/features/reception/LiveMembershipCheckout.test.tsx --maxWorkers=2
    npm.cmd run typecheck

The source baseline has no existing provider-specific tests. New provider tests/fakes are planned only after an exact authorized path is selected. Use P11 safe fresh temp-SQLite harness with ambient DB variables removed and an explicit no-network assertion. Unit tests do not prove provider sandbox semantics. Public official-doc contract research is read-only within assigned scope and requires no provider account/session; sandbox calls, merchant credentials, webhook ingress exposure, hosted CI, PostgreSQL and live payments each need their applicable separate explicit destination/operation/session permission; none is granted here.

## Effort, rollback and handoff

Effort: **M** for one provider contract/adapter; **L** for callback verification, reconciliation and competing channel settlement; **XL** if both channels, Gimi link, migration and external proof are bundled. Split by P9.x, never by file type. Rollback only the exact adapter/attempt slice; do not delete provider or payment evidence or reopen a settled event. Any schema rollback must preserve the append-only evidence and use approved forward repair.

## Future write-path allowlists

These are candidate subsets for future, separately authorized implementation. Select exactly one row, copy its path column verbatim into the delegation, then obtain human authorization for that exact set. A proposed filename is not an existing file or permission. Contract-only tasks write only their named proposed contract document. Shared-file handoffs are excluded from each row unless the integrator separately reserves them.

| Subdelivery | Candidate existing write paths | Proposed new runtime/test/doc paths | Shared-file handoff / exclusion |
|---|---|---|---|
| P9.1 | `api/app/api/sales.py`; `api/app/api/shifts.py`; `api/tests/test_sales.py` | `api/app/payments/point_attempts.py`; `api/tests/test_point_attempts.py` (PROPOSED) | Public official-docs research is read-only; actual provider/account operation separately needs explicit destination, operation and session authorization. |
| P9.2 | `api/app/api/catalog.py`; `api/app/api/sales.py`; `api/tests/test_catalog.py`; `api/tests/test_sales.py` | `api/app/payments/checkout_pro_attempts.py`; `api/tests/test_checkout_pro_attempts.py` (PROPOSED) | No provider account/credential use authorized. |
| P9.3 | `api/app/api/sales.py`; `api/app/audit.py`; `api/tests/test_sales.py` | `api/app/payments/provider_callbacks.py`; `api/app/api/provider_callbacks.py`; `api/tests/test_provider_callbacks.py` (PROPOSED) | API/router registration and schema migration reserved; signature fields verified from official docs only at authorized future step. |
| P9.4 | `api/app/api/sales.py`; `api/app/sales/queries.py`; `api/tests/test_sales.py` | `api/app/payments/reconciliation.py`; `api/tests/test_payment_reconciliation.py` (PROPOSED) | Blocked by D-023; cannot claim exactly one settlement until internal transactional contract passes. |
| P9.5 | No runtime writes; contract handoff only | `docs/work-packages/contracts/P9.5-gimi-renewal-link.md` (PROPOSED) | P10.1 permission contract first; P9 provider link generation requires separate explicit destination/operation/session authorization. |
| P9.6 | Exact local synthetic test paths only | `api/tests/test_provider_contract_fixtures.py` (PROPOSED) | No provider sandbox/live operation; proof limits recorded by P11. |

**Brief path rule:** replace the brief’s path placeholder with the exact candidate path subset from the selected row; remove every other row’s paths. The plan itself authorizes no source edits.
Select exactly one stable subdelivery ID from this card before sending the brief. Copy the existing/proposed path columns and shared-file reservation from that exact row verbatim; do not fill a path placeholder by inference. The selected row remains a candidate until a human authorizes the exact implementation paths.

**Copy-paste assignment brief**

> Take only **P9 subtask [P9.x: exact provider deliverable]**, using the exact candidate path subset copied verbatim from the selected row above; receive separate human authorization before source edits. Public official-documentation research is read-only and may be performed within the assigned research scope without provider-account credentials; cite primary-source semantics and do not invent missing details. This card does not authorize provider account/API/sandbox/charge/webhook operations or credential access. Before any such operation, request explicit authorization naming provider/destination, operation and session; until then use synthetic fakes only. Provider endpoint/signature/event/retry details remain TBD until supported by cited evidence. P3 owns internal settlement, P5 the published quote, P4 register/shift, P10 Gimi permission/delivery join. Stop on D-017 merchant binding, D-023 competing settlement or D-024 expiry/refund uncertainty. Return provider contract citations, implementation paths, isolated tests/results, mismatch/unknown handling, permission status and rollback boundary. No offline payment, ambient credentials, PG, remote or production.

Evidence: [BK ledger](../../odd/tasks/backend-implementation.md); [decision register](../backend-plan/02-business-rules-and-decisions.md); [P3 internal payment boundary](P3-membership-payments-and-access.md); [P4 shift context](P4-shifts-and-cash.md); [P5 catalog quote](P5-published-catalog.md); [P10 Gimi/delivery contract](P10-notifications-reporting-and-gimi.md).
