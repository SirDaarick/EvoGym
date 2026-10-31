# Rental Lifecycle API

Backend contract for glove and locker rentals under `/api/v1/rentals`. Amounts
are integer minor units (centavos). Asset occupancy is explicit: a rental is
active until it is returned, released, or cancelled, never until a date passes.

## Authorization

Every route requires an authenticated shift actor
(`get_shift_actor_principal`). Lifecycle, register, and member routes accept an
active `receptionist` role grant scoped to the rental branch, or an admin. Asset
create/update and the cancellation alert routes are admin-only. Cross-branch
access returns `403`.

## Idempotency

All state-changing lifecycle routes require an `Idempotency-Key` header of 1 to
128 characters. Replaying the same key with the same request returns the
original result (`200`); replaying it with different facts returns `409`. New
commands return `201`.

## Rental assets

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/assets?branch_id=&kind=&offset=&limit=` | Page of assets with `active_rental_id`; `limit` 1-100. |
| `POST` | `/assets` | Admin. Gloves require `color` and `ounces`; lockers require `locker_number` and no glove fields. |
| `PATCH` | `/assets/{asset_id}` | Admin. An occupied asset accepts only `price_minor`; any other field returns `409`. |

Asset `status` is `available`, `employee`, or `out_of_service`. Out-of-service
assets cannot be rented, and `employee` applies to lockers only.

## Lifecycle

| Method | Path | Effect |
| --- | --- | --- |
| `POST` | `/gloves` | `RentalCreateInput`; creates an active glove rental and an `initial` charge. |
| `POST` | `/lockers` | `RentalCreateInput`; creates an active locker rental with a calendar-month period and an `initial` charge. |
| `POST` | `/{rental_id}/renewals` | Lockers only; appends a `renewal` charge for the next calendar month and extends `ends_on`. |
| `POST` | `/{rental_id}/return` | Gloves only; marks `returned`. Outstanding debt is preserved. |
| `POST` | `/{rental_id}/release` | Lockers only; marks `released` after the physical eviction happened. |
| `GET` | `?branch_id=&status=&kind=&member_id=` | Rental page. |
| `GET` | `/{rental_id}` | Rental detail with charges and balances. |

Gloves have no rental period. Lockers use `starts_on`/`ends_on` with
`ends_on > starts_on`, computed from the branch-local date. A register with an
open shift is required for every cash-bearing command. A second active rental on
the same asset returns `409`.

`RentalDTO` reports `paid_minor`, `outstanding_minor`, `cancelled_debt_minor`, and
per-charge `outstanding_minor`. Transfers stay `pending` and count toward
outstanding debt; card and cash payments are `confirmed` once recorded.

## Receivables

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/{rental_id}/receivable-payments` | `method` is `cash`, `card`, or `transfer`; cannot exceed the rental outstanding balance. `201` with remaining balance; replay `200`. |
| `GET` | `/members/{member_id}/receivables?branch_id=` | Open rental receivables for a member with `total_outstanding_minor`. |

Returning or releasing a rental does not erase its debt. A cancelled rental
cannot receive repayments.

## Cancellation (lockers)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/{rental_id}/cancellation-preview` | Returns `preview_token`, `settled_minor`, `max_refundable_minor`, `suggested_refund_minor`, `outstanding_minor`, `cancelled_debt_minor`, and per-period facts. |
| `POST` | `/{rental_id}/cancellation` | `CancellationInput` with `preview_token`, editable `refund_amount_minor` (may be `0`), `refund_method` (`cash` or `card`), and a `reason` of 1-240 characters. |

`can_cancel` is false unless the rental is an active locker with no pending
transfer. The preview token is a SHA-256 digest of the current rental and charge
facts; confirming with a stale token returns `409` and changes nothing.

- Suggested refund prorates each period by remaining days and is capped at the
  settled amount.
- Requested refund cannot exceed `settled_minor` (confirmed payments less prior
  refunds). Cash refunds reduce drawer expectations; card refunds are recorded
  as an external execution by staff and never call a provider.
- Cancellation cancels the linked outstanding rental debt and marks pending card
  attempts `cancelled`; unrelated debts and financial history are untouched.

## Administration alerts

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/alerts?branch_id=` | Admin. Cancellation records ordered newest first. |
| `POST` | `/alerts/{cancellation_id}/review` | Admin. Idempotently stamps `reviewed_by`/`reviewed_at`; replay returns the same record. |

The immutable cancellation record is the alert source. It stores the operator,
reason, refund method/amount, suggested refund, settled amount, and cancelled
debt.

## Card attempts

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/{rental_id}/charges/{charge_id}/card-attempts` | `CardAttemptInput` with `register_id`, `amount_minor` (not above charge outstanding), optional `terminal_id`. Persists the attempt before calling the provider. |
| `GET` | `/card-attempts/{attempt_id}` | Returns the attempt; a `pending` attempt with a provider intent is refreshed and settled. |

Statuses are `pending`, `confirmed`, `failed`, `unknown`, and `cancelled`. Only a
`PROCESSED` provider result creates a confirmed card `Payment`, and only while
the rental is not cancelled. Provider clients come from
`app.state.rental_point_client` when injected, otherwise Mercado Pago when
configured; otherwise the route fails closed with `503` and creates no attempt.

## Reader extensions

- Shift expected cash and summary include rental cash inflows and cash refunds;
  summary rows use the `rental` family with "Renta de guantes" or
  "Renta de casillero".
- Pending money adds `rental_receivable` rows and rental `pending_transfer`
  rows with `rental_id` and `rental_charge_id`; `order_id` is `null` for these.
- Member financial reads add `rental_pending_balance_minor` and `rental_debts`
  for administrators; receptionist projections leave them empty or `null`.

## Errors

`404` unknown rental/asset/charge/register/member/terminal, `403` wrong branch or
role, `409` state conflict, idempotency mismatch, stale preview, or exclusivity,
`422` invalid input or idempotency key, `503` unconfigured provider or database,
and `502` when the terminal provider rejects the request.
