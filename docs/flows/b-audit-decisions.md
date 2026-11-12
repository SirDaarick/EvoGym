# Flow B audit - fixes and open decisions

Audit date: 2026-11-08. Scope: `docs/flows/b-members-and-access.md`.

## Fixed

| # | Change | Where |
| --- | --- | --- |
| 1 | Shared phone numbers allowed (`phone_key` non-unique index in `0062`/`0065`); registration and lookup return matching members so reception can select an existing member or register another. | `api/app/members/queries.py`, `service.py`, `LiveMemberRegistration.tsx` |
| 2 | Member reload, summary, list, and detail compute "today" and derived status in the branch timezone. | `members/read_queries.py` `branch_today`, `members/queries.py`, `members/service.py` |
| 3 | Member reload no longer reports "eligible" when access evaluation fails (removed the swallowing `except`) and projects `restricted_unpaid` when an active period has outstanding debt. | `members/read_queries.py` |
| 4 | DB `CHECK (credit_balance_minor >= 0)` on `members` (migration `0063`). | `db/models/members.py` |
| 5 | Check-in UI shows the real denial reason (expired, other branch, not started, transfer, admin restriction). | `ApiMembers.tsx` |
| 6 | Tests: removed tautological `test_access_status_contract...`; expired test uses branch-local date (no midnight flake); added not-yet-valid denial and "debt is allowed with warning" check-in tests; E2E Flow B suite (`test_flow_b_e2e.py`) and frontend integration tests cover S1–S4. | `api/tests/`, `frontend/src/` |
| 7 | R-007 admin alert on entry with debt (flow 6.1): check-in requires explicit reception confirmation (`confirm_outstanding_balance=True`) when debt is pending, records `outstanding_balance_confirmed`, and surfaces the alert to admins (`GET /api/v1/member-check-ins/branches/{branch_id}/debt-alerts`). Immediate local roster delta refresh runs after checkout/repayment (`LiveMembershipCheckout.tsx`, `flushManager.ts`). | `api/app/api/member_check_ins.py`, `reconcile.py`, `AlertCenter.tsx`, `LiveMembershipCheckout.tsx` |
| 8 | Inactivity status (flow 4.8): derived as `expired` for `< 31` days past `ends_on` and `inactive` at `>= 31` days in the branch timezone; informational only, without extra access block or loyalty behavior. | `api/app/members/queries.py`, `service.py` |
| 9 | Offline check-in (flow 6.1): only network failures (`NetworkError` / `TypeError` / offline) fall back to the local contingency queue; HTTP 4xx/5xx denials/errors never silently queue offline. Reception sees a discreet indicator and pending log (`OfflineStatusBadge.tsx`, `PendingCheckInLog.tsx`). | `ApiMembers.tsx`, `PendingCheckInLog.tsx`, `flushManager.ts` |

## Implemented and verified decisions

1. **R-007 admin alert on entry with debt (flow 6.1).** Implemented and verified across API, DB, offline reconciliation, and admin `AlertCenter.tsx`.
2. **Shared phone numbers.** Implemented and verified across migrations `0062`/`0065`, backend search/create/update, and `LiveMemberRegistration.tsx` / `LiveMemberLookup.tsx`.
3. **Inactive.** Implemented and verified at the 31-day threshold in the caller's branch timezone across list and detail endpoints, as an informational status without extra access blocks.
4. **Offline check-in.** Implemented and verified for connectivity failures only, with reception-only pending indicator/log, idempotent online-to-offline replay (`online_idempotency_key`), and immediate post-checkout local roster delta refresh.

## Decisions to review (not changed)

1. **Suspension:** its meaning and effect remain undefined; no new suspension policy is approved. Inactive is not an extra access block.
2. **Duplicate phones:** migration `0062` allows shared numbers, and `0065` removes an earlier unique index if present. SQLite, generated offline SQL, and disposable Docker PostgreSQL (`evogym-postgres-dev:5433`) lifecycle tests cover `0061 -> 0065 -> 0064 -> 0065`.
5. **Lock order differs** between rentals (rental, register, member) and sales (register, shift, member), and membership sales lock the branch row. Possible Postgres deadlocks; not reproduced. Define one order.
6. **Ledger immutability** is enforced only by ORM listeners; add a DB trigger or revoke UPDATE/DELETE.
8. **Invalid branch timezone** makes check-in return 500 (`memberships/service.py`); sales return a typed error.
9. **Remaining test gaps:** trial denied at wrong branch / does not consume entitlement, debt overpay, pending-money matrix, concurrency (SQLite cannot show it).

## Verified migrations

- Migrations `0062`–`0065` were executed and verified on SQLite, offline PostgreSQL SQL compilation, and live Docker PostgreSQL (`evogym-postgres-dev` on port `5433`, PostgreSQL 17 with pgvector) across full upgrade/downgrade paths (`test_migrations.py`, `test_shared_phone_migration.py`).
