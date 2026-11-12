# Flow C review: owner decisions and implementation status

The owner confirmed the decisions below during this review. Sections **Shifts, cash and inventory** and **Inventory purchases and prices** (including migration `0066_inventory_purchases`, atomic purchase + linked expense, drawer-cash guard, cost-increase alerts, and L16 post-sale purchase cancellation protection) are now implemented and verified against SQLite, PostgreSQL (`evogym-postgres-dev:5433`), and the frontend UI. Section **Membership payments** (S5 provider cancellation/expiration semantics) remains gated on live provider verification as noted below.

## Shifts, cash and inventory

- At opening and closing, show current inventory quantities. Unchanged quantities mean staff declare them correct, not that a physical recount is proven. Record only differences.
- For a reported shortage or surplus, require a comment, automatically adjust stock to the reported count and alert the administrator with the relevant shift. An alert identifies when the difference was detected; it does not establish when it occurred or who caused it.
- A cash difference at opening or closing does not prevent the shift operation. Require a comment and alert the administrator for either a shortage or a surplus.
- The next shift's expected cash takes the previous counted closing amount and intervening overtime cash sales into account. The opening physical count already includes any overtime money physically present; do not add it a second time to the count.
- Sales cannot exceed recorded available stock. Record internal consumption as waste and explain it in the observations.
- During offline operation, allow sales up to the stock shown on that device. Concurrent sales on another device can still produce a variance at synchronization; retain the sale and alert for review. An uncertain online sale must remain recoverable rather than being rejected based on a stale local count.

## Inventory purchases and prices

- Reception may register stock purchases and waste. Only an administrator may change a product's sale price or deactivate it. Deactivation is allowed even with stock remaining; retain stock and history and do not offer the product for sale.
- In inventory, a **current purchase** groups product lines. Reception enters quantity and total cost per line; the system calculates unit cost and the total. Retain each purchase's cost and use the latest cost as the reference; do not implement FIFO cost allocation. A margin based on the latest cost is an estimate, not the exact historical cost of each sale.
- Preserve the exact line and purchase totals; round the reference unit cost to cents. For example, three bottles costing $100 retain the $100 expense and use $33.33 per bottle as the reference for alerts and surpluses.
- Alert the administrator when purchase cost rises; changing the sale price remains a manual admin decision.
- On purchase confirmation, update inventory and create one expense for the total. A **pay with cash drawer money** checkbox makes that expense affect the drawer; reject a purchase paid from the drawer if it exceeds available drawer cash. Otherwise the purchase uses money kept separately and must not reduce drawer cash. Inventory and expense must not be partially recorded. Do not create a second expense for the same purchase.
- If a purchase was entered incorrectly and some products have already been sold, do not automatically reverse it; require administrator review so inventory and the expense do not silently diverge.
- The separate reception expense flow remains for incidental expenses and non-inventory items such as cleaning supplies. Register those separately, even if they appear on the same receipt. This replaces the earlier proposal to link a previously recorded reception expense or allocate part of a mixed expense.
- Value a surplus using the product's latest recorded cost. If no cost exists, capture one before confirming the surplus adjustment.

## Membership payments

- Switching between a renewal link and the Point terminal is allowed only after confirming the previous attempt can no longer be charged. If it is already approved, do not charge again. If processing or uncertain, wait. Verify cancellation semantics for the actual provider product and channel before implementation.
- A renewal link is intended to last 24 hours. Once it expires, tell the member and provide a replacement only after confirming that the prior attempt cannot be charged and has no payment in process. The first and second links preserve the originally offered price; after the second, a new sale uses the then-current price. Respect the offered price when switching to the terminal while the offer still applies.
- Respect a valid payment confirmed later for the same link if the renewal was not already paid. Never activate the same renewal twice. In an exceptional duplicate charge, alert the administrator to manage the additional refund; a single valid payment needs no refund.
- An uncertain provider result remains pending confirmation and must not enable a second attempt. If still unconfirmed after 15 minutes, alert the administrator. When rejection is confirmed, notify the member, show the reason if supplied by the provider, and allow another attempt with the same or another method.
- A confirmed total **or partial** refund cancels the entire membership period associated with that refunded payment and alerts the administrator; do not cancel other paid periods. For example, refunding $100 of a $1,000 membership cancels that whole period. A chargeback is alerted for administrator review without automatic cancellation.

## Reconciliation and remaining checks

| Area | Outstanding work or uncertainty |
| --- | --- |
| Authoritative rules | `docs/backend-plan/02-business-rules-and-decisions.md` points to these newer decisions and retains older BK-021 and R-008 passages as implementation history. Preserve auditability when specifying the new automatic adjustment; do not infer that the existing implementation changed. |
| Refund authorization | D-007 says activated memberships are non-refundable absent an authorized admin override. The new decision specifies the consequence **after a refund is confirmed**; it does not authorize reception to issue refunds or remove the override requirement. Resolve mapping when a payment covers multiple periods, split payments, and effects on later chained dates before implementation. |
| Cash and offline | Verify expected opening cash, overtime for each sale type, shift ownership, race handling, and how opening/closing alerts and stock adjustments behave during offline synchronization. Existing CASH-02 evidence is bounded to membership cash sales. |
| Inventory costs | Define rounding when a line total cannot be divided exactly into unit cents, baseline costs for existing stock, behavior on stale counts/concurrent sales, and purchase cancellation/correction without losing audit history. Check supplement container/serving cost handling separately. |
| Provider integration | Verify the selected Mexican Mercado Pago checkout product's expiration, cancellation and in-process behavior, callback verification, timing, and account/terminal mapping. A request to cancel or a local expiration timestamp alone is not proof that a provider attempt cannot be charged. Underpayment/overpayment and fees remain unresolved. |
| Existing behavior and coverage | The flow map reports partial or demo-only areas. Recheck the current implementation and tests before claiming completion: register/terminal setup; shift expense and contribution; gloves and lockers; product returns and supplements; inventory waste; owner finance, reports, Gimi and notifications. This review did not audit every area end to end. |

The backend rule register remains the existing canonical decision register and points to this note for the newer owner decisions. Do not interpret old implementation-status labels as proof that these new decisions are implemented.
