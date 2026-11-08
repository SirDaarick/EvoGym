# Flow C audit fixes
Objective: fix every defect found by the audit of docs/flows/c-money-and-operations.md. Branch: fix/flow-c-audit. Delivery: ask-on-risk, commits per area. Runner: pytest (api/), vitest (frontend/).

## Specs
S1. "Corrige todo, no te detengas hasta haber terminado con todos" — fix all audit findings.
S2. POST /owner/gimi/chat must require organization admin (D-011/D-012); receptionist gets 403.
S3. POST /owner/gimi/notifications/deliver must never mark real pending rows sent via FakeDeliveryAdapter outside tests.
S4. Product return payout_method must equal the original payment method (D-007).
S5. One processed Point card intent can fund only one sale (unique mp_payment_intent_id + check).
S6. Overview "Cobros confirmados" must include confirmed transfers and equal the by-method table.
S7. Frontend overtime banner must match the backend definition (no open shift), not the clock.
S8. Locker expired/grace/evicted derived server-side in branch-local time; frontend `expiresAt` not UTC.
S9. Shift close: R-004 `closing` state is never entered; document/align (no dead behavior).
S10. Offline manual-total close must not fabricate a denomination.
S11. Minor gaps: expense void admin-only + idempotent replay; renewal replay before status check; first-restock race maps to 409/retry; gimi chat financial overview consistent with overview endpoint; overview multi-branch; NaN variance; glove overdue flag; stale test_mercadopago_http_client_operations; stale spec labels.
Assumptions: BK-021 manual opening total is kept (tests pin it) and documented as deviation; D-017/D-023/D-024 card-refund-after-failed-post stays open.

## Tasks
- T1 (S2,S3,S6,S11 owner/gimi) — delegated (parallelism)
- T2 (S4,S5,S11 sales/inventory) — delegated
- T3 (S7,S9,S10,S11 shifts/expenses) — delegated
- T4 (S8,S11 rentals) — delegated

## Decisions to review (user)
- D1. BK-021 manual opening total kept as a deliberate deviation (tests pin it). Revisit if denominations must be mandatory.
- D2. Card charged but sale rejected: no auto-refund (D-017/D-023/D-024 unresolved).
- D3. Cancel-with-refund stays blocked for credit-paid rentals (documented temporary gap).
- D4. Expense void restricted to admin per spec (receptionist loses self-void).
- D5. Locker lifecycle derived server-side in the DTO, no new DB states/migration.

- D6. CLI notifications worker keeps FakeDeliveryAdapter outside production (local dev simulation); only the HTTP deliver endpoint was fixed. Revisit before a real provider exists.
- D7. Multi-branch admin overview without branch_id deterministically picks the first branch by name (UI sends no branch_id) instead of aggregating or 422.
- D8. Locker "grace" is not a separate lifecycle value: lifecycle_status = active|expired|evicted (expired = +1..+14 days).
- D9. Scoop return/waste behavior is undefined by D-009 (generic movements apply to the scoop product); no test added.
- D10. `pulse.confirmed_minor` is now the sum of by_method (includes transfers, credit row "Saldo a favor").
- D11. api/.venv lacked pymupdf and python-multipart; python-multipart was pip-installed into the venv (not in repo). pymupdf was stubbed outside the repo.

- D12. GastoModal `canVoid` stays unwired (default false): admins void on the owner screen (ExpenseReport onVoid); the shift-mode void UI is now unreachable. Consider removing the prop and button.
- D13. sync/reconcile.py:222 still treats status 'closing' as live; the state is never entered. Left as is.
- D14. Legacy offline `shift.arqueo_close` with `[]` and no counted_cash_minor still parses and closes as zero (queued events compatibility).
- D15. tests/test_import_legacy_data.py cannot be collected: openpyxl missing in api/.venv; excluded from the full run.

## Blockers
- B1. Migrations 0062_member_phone_key and 0063_member_credit_nonnegative are untracked work from another change (members), not part of this branch. My 0064_unique_card_intent chains after 0063_member_credit_nonnegative, so it only applies once that work is committed first. tests/test_migrations.py head pins were bumped to 0064.
- B2. tests/test_migrations.py::test_postgresql_offline_upgrade_emits_sql_without_connecting fails inside 0062_member_phone_key.py:17 (TypeError: NoneType not iterable in offline mode). Not caused by this work; owner of the members migration must fix.
- B3. T2 ran alembic upgrade/downgrade and the log said PostgresqlImpl: it may have touched a configured dev database (only the new unique index). Verify the dev DB state.

## Log
L1 (2026-11-08): "Corrige todo, no te detengas hasta haber terminado con todos"
L2 (2026-11-08): "si hay un bloqueo o una cosa realmente importante, documentalo y sigue con lo mas que puedas, si son decisiones que no son tan relevantes, documentalas tambien para revisarlas yo despues, no te detengas hasta terminar todo el trabajo"
