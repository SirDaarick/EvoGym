# BK-027 — Membership entitlements

## Objective

Derive membership access from period dates, sale branch, payment review state, outstanding balance, and explicit Admin access decisions before BK-029 builds member check-in.

## Problem and rationale

The current eligibility helper combines dates and payment status into a boolean. It does not represent branch-only entitlement, warning-only pending balances, explicit missing-funds restrictions, or an auditable manual access exception. BK-029 needs this policy source before online/offline check-in can rely on it.

## Confirmed rules and constraints

- A membership period uses `[starts_on, ends_on)` dates; an expired period always denies access.
- The order's branch owns the membership entitlement; it cannot authorize another branch.
- A transfer voucher under Admin review does not alone block access; the period starts when the voucher is sent and its original dates keep running.
- A partial payment/abono balance is warning-only while the period is valid; it does not itself block access.
- When Admin confirms transfer funds are absent, that membership's access is blocked while its outstanding amount remains. The period does not pause or extend; unreceived funds are pending money, not revenue.
- An authorized Admin may manually lift a payment-related access restriction. Payment confirmation or full repayment also restores access within the original valid dates.
- Preserve existing payment/debt ledger events; do not mutate sale snapshots or classify pending money as revenue.
- Do not implement check-in, offline queue/sync, trial visits, Mercado Pago, or staff absence in this feature.

## Tasks

### BK027-S1 — Derive branch-scoped membership entitlement
- [x] Replace the boolean-only policy with a structured access decision and reason/warning fields for valid, pending-balance, voucher-review, blocked-missing-funds, wrong-branch, and expired cases.
- [x] Derive entitlement from the period's order/payment and existing membership debt/abono ledger; preserve the period start/end dates.
- [x] Add deterministic tests for date boundaries, transfer review states, partial balances/abonos, and branch isolation.

### BK027-S2 — Persist and review Admin access restrictions
- [x] Add an auditable, migration-backed Admin decision to restrict or manually restore a member's access for payment-related cases without rewriting payment history.
- [x] Scope writes to existing Admin grants; keep the decision from overriding branch mismatch or expired membership.
- [x] Ensure recorded full repayment or confirmed payment restores eligible access, while retaining the audit trail.
- [x] Add tests for authorization, retries/conflicts, manual restore, repayment clearing, and immutable history.

### BK027-S3 — Close evidence and documentation
- [x] Update the business-rule catalogue, backend implementation phases/master task board, and this document with observed behavior.
- [x] Run focused tests, migration checks, full API tests, and `git diff --check`; record failures/skips honestly.
- [x] Commit each coherent work unit with Spanish Conventional Commit messages; do not push.

## Acceptance criteria

- Callers can distinguish allowed access from warning, explicit block, wrong branch, and expiry without re-deriving payment rules.
- Under-review transfer and partially paid cash memberships remain eligible only within original valid dates and own branch.
- An Admin-confirmed missing transfer payment blocks only the associated membership while it remains unpaid; its dates continue to elapse.
- Authorized Admin manual restoration is auditable and cannot admit an expired or wrong-branch membership.
- Full repayment/confirmed payment restores access only within the original interval; the outstanding amount is not counted as revenue.
- Existing sales, payment review, and debt-payment behavior remains compatible.

## Route and verification

- Route: delegated direct. The slice spans policy, persistence, API authorization, migrations, tests, and plan documentation.
- Use one Luna writer at a time; parent reviews and independently verifies the candidate.
- RDD remains off; no push, live database, or external services.
- Delivery strategy: user-directed `exception-ok`; land BK-027 as one Spanish Conventional Commit on the existing `codex/backend-foundation` branch, with no new branch, PR chain, or push. The feature may exceed 400 authored lines; do not split solely to satisfy the heuristic.
- Initial focused checks: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_membership_entitlements.py api/tests/test_sales.py api/tests/test_transfer_reviews.py api/tests/test_migrations.py api/tests/test_contract_smoke.py`; full check: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests`.

## Progress

- Read-only mapping selected BK-027 after BK040-S3; BK-029 remains downstream of this entitlement source plus offline idempotency and sync-time revalidation.
- Confirmed rules are sourced from `docs/backend-plan/02-business-rules-and-decisions.md` D-031/R-005/R-007 and `odd/tasks/backend-implementation.md` BK-027.
- Open implementation boundary: ensure manual restoration is tied to the current payment restriction and does not silently bypass expiry or branch policy. If code evidence makes broader scope necessary, document it before changing scope.

### Implementation evidence (2026-10-21)

- Implemented `MembershipAccessDecision` as an append-only, idempotent audit trail and `POST /api/v1/membership-access/periods/{period_id}/decisions`; active Admin organization or branch grants are rechecked against the membership's sale branch.
- `evaluate_membership_access` now returns `allowed`, status, reason, warning codes, and outstanding amount; the existing boolean helper delegates to it for compatibility.
- Manual restoration lifts payment-related blocking only after date and branch checks; original dates and payment/debt ledgers are unchanged. Partial cash debt remains warning-only; under-review voucher is eligible; a transfer marked pending is blocked until restored/confirmed.
- Focused verification: 57 passed, 15 warnings. Full `api/tests`: 233 passed, 17 skipped, 15 warnings. Skips are existing opt-in/external tests; no live PostgreSQL or services used.
- `git diff --check`: passed for the scoped BK-027 paths; only Git's expected Windows LF-to-CRLF notices appeared.
- Commit: `feat(membresias): aplicar reglas de acceso por pago y sucursal` on `codex/backend-foundation`; no push. The resulting Git object ID is reported in the task handoff because including it in the same commit would change that ID.

## Relevant files

- `api/app/memberships/eligibility.py` — existing date/payment boolean predicate to evolve or wrap.
- `api/app/db/models/memberships.py` — membership period dates and sale linkage.
- `api/app/db/models/membership_debts.py` and `api/app/db/models/membership_debt_payments.py` — immutable balance and abono ledger.
- `api/app/sales/queries.py` — transfer review and debt payment behavior.
- `docs/backend-plan/02-business-rules-and-decisions.md` — D-031, R-005, and R-007.
- `odd/tasks/backend-implementation.md` — canonical BK-027/BK-029 dependencies.
