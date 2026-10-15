# EvoGym frontend V2 and progressive backend map

## Objective

Record the target frontend screen by screen, then consolidate its data and backend needs before deciding on production persistence or database schema changes. This plan tracks requirements; it does not authorize implementation by itself.

## Problem and why

The current application is a useful React demo with OWNER/RECEPTION navigation, but its entry screen is only a role selector. The new target needs individual staff profiles and optional credentials, plus owner-managed receptionist accounts. Mapping each workflow as it is described will expose shared data needs without designing a database from one screen prematurely.

## Scope and constraints

- Add each screen as a stable-ID pending task with its user story, behavior, acceptance criteria, reusable code/design, and backend data needs.
- Keep confirmed decisions, proposals, and unresolved questions explicitly distinguished; do not invent authentication, permission, retention, or account-recovery policy.
- Follow `Design.md`: EvoGym identity and `Logo_Evo.png`, light Bento default, more visible but controlled clay depth, and the defined dark theme.
- Keep `OWNER` and `RECEPTION` as application roles unless the owner confirms a different mapping. An individual staff profile is a person/account identity, not a role itself.
- Existing user-facing role selection is a local demo, not authentication. The current demo has volatile in-memory state and no production credential store or backend.
- No source-code implementation, database migration, or production authentication is included in this planning pass.
- Accumulate a cross-screen data map as tasks are added. Consolidate entities, relationships, operations, and security responsibilities after the screen map is reviewed; only then propose a database schema.

## Work plan

### T01 — Select a staff profile and enter the application

**Status:** Pending — requirements captured; screen and credential interaction need owner review.

**User story**

As a gym staff member, I want to choose my named Admin or Reception profile and use a password or PIN if I configured one, so that I enter the application as the correct person without making credentials mandatory for every profile.

**Details and rules**

- Follow the supplied sketch: EvoGym logo; current time/shift and date in the header; one Admin profile; a responsive grid of individual Reception profiles.
- Show a distinct, recognizable identity for each receptionist. Do not render several generic cards all labeled only “Recep”. Whether to use initials, an avatar, or additional identity details is still open.
- Selecting a profile with a configured credential should lead to the credential step; the no-credential path and exact prompt timing need confirmation before implementation.
- The owner described credentials as optional per profile. Do not require PIN/password for all staff or imply a credential has been verified when it has not.
- Admin can create and edit receptionist profiles from the Admin area. The management screen is tracked separately as T02; this selection-screen task may link to it but does not specify its full form.
- Display time, date, and shift consistently. Timezone, the authoritative shift source, and what to show when no shift is active remain open.
- The current demo's direct OWNER/RECEPTION entry predates this target behavior. Preserve that demo as-is until implementation is separately authorized.

**Acceptance criteria**

- [ ] Admin and each active receptionist are distinguishable profile choices; the number of receptionist choices can grow beyond the sketch.
- [ ] A configured credential is requested before entering that profile; a credentialless profile is not blocked by a mandatory credential requirement (exact transition remains to confirm).
- [ ] The user can tell which profile is selected and which application role it has.
- [ ] Header information does not fabricate time, date, or shift data when its source is unavailable.
- [ ] Profile choices are keyboard-operable with visible focus and reflow on narrow screens; the layout follows both themes and `Design.md` contrast rules.
- [ ] No raw PIN or password is displayed or persisted in a production design; authentication and secret storage are deferred to backend/security design.

**Existing elements to reuse or adapt**

- `src/app/App.tsx` — existing `/` entry point, Admin/Reception landing choices, and `homePath` navigation; currently routes by role rather than individual staff identity.
- `src/app/navigation.ts` and `src/domain/models.ts` — `OWNER`/`RECEPTION` roles and role-specific home routes; do not overload `Role` as a staff-profile identifier.
- `src/shared/ui.tsx` — accessible `Button` primitive for profile choices; adapt existing button-based card treatment rather than adding a second primitive without need.
- `Design.md` and `Logo_Evo.png` — authoritative visual direction and logo asset. Preserve the source artwork and use the documented light/dark theme tokens.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Staff identity | Stable staff-profile ID, display name, and assigned role (`OWNER` or `RECEPTION`). | Needed; exact fields beyond display name and role are open. |
| Credential policy | Per-profile credential mode: none, PIN, or password; a secure verifier rather than plaintext secret if credentials are enabled. | Optional credentials confirmed; credential lifecycle/security design open. |
| Profile selection | List eligible profiles, select one, and verify a credential only when that profile has one configured. | Desired flow; no backend contract chosen. |
| Profile administration | Owner creates and updates receptionist profiles. Track actor/permission and audit needs in the later backend map. | Capability reported; fields, authorization details, and audit policy open. |
| Header context | Current date/time, timezone, and active shift label/state. | Visible in sketch; source and boundaries open. |

Do not create credential columns or migrations from this screen alone. Decide whether credentials belong in a separate authentication/account model after all screen and security requirements are mapped.

### T02 — Create and edit receptionist profiles

**Status:** Implemented in prototype — screen implemented in `StaffManagement.tsx` and preview in `admin-staff-management.html` with monthly salary assignment, 2-phase PIN confirmation, no KPI cards, spring modal open animations, and `react-bits` components (`SquishSwitch`, `CodeSlots`, `SwipeToast`, `JellyRadio`, and `AnimatedList`). All 15 test suites pass.

**User story**

As an Admin, I want to find, create, edit, and manage receptionist profiles from an Admin-only screen, so that current staff can access the correct application profile while former staff do not remain selectable.

**Details and rules**

- T01 covers choosing a staff profile and entering the application; T02 is the Admin-only management workflow for creating and updating the receptionist profiles available to T01. Receptionists may choose their own profile in T01 but cannot access T02. Treat T01 and T02 as connected parts of the same staff-profile capability, not duplicate employee screens.

- The reviewed proposal uses a searchable employee list with profile/role, credential status (configured / none, never the secret), account status, and edit actions; an add-employee action opens the profile form.
- The proposed form includes display name, application role, active status, and optional PIN/password setup. Do not reveal a stored PIN/password; configuring or changing a credential is distinct from editing profile details.
- Current user-confirmed scope explicitly includes creating and editing receptionist profiles. Admin profile creation, changing roles, and self-management need permission rules before implementation.
- Deactivation instead of permanent deletion was proposed to preserve operational history, but the owner has not confirmed this lifecycle rule. Do not silently treat the proposal as approved behavior.
- Duplicate identity handling, required fields beyond display name/role, credential reset/recovery, who can deactivate or reactivate an account, and audit history remain open.
- A deactivated profile should not be presented as selectable in T01 only if that lifecycle behavior is later confirmed.

**Acceptance criteria**

- [ ] Only Admin can access the employee-management screen; receptionists cannot create or edit staff profiles.
- [ ] Admin can find and edit an employee profile and can create a receptionist profile that becomes available in T01.
- [ ] The list makes profile/role and account status clear without exposing a PIN or password.
- [ ] Credential setup/change never displays an existing secret and is not conflated with ordinary profile editing.
- [ ] Deactivation vs permanent deletion, field requirements, role permissions, and duplicate handling are resolved before implementation.
- [ ] The screen follows `Design.md`, remains keyboard accessible, and fits the shared responsive Admin shell in both themes.

**Existing elements to reuse or adapt**

- T01 profile selection — reuse staff identity and optional-credential concepts; keep navigation and role assignment consistent.
- Current `OWNER` / `RECEPTION` role model — do not introduce new roles or assume Admin account management permissions without approval.
- Shared application shell, table/search/form primitives, `Design.md`, and `Logo_Evo.png` — retain the established design system.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Employee list | Stable staff ID, display name, role, account status, and credential mode indicator. | Display name and receptionist management are in scope; other required fields and Admin profile management remain open. |
| Profile operations | Create, read/list, update, and potentially deactivate/reactivate. | Create/edit receptionist requested; account lifecycle and permission boundaries require confirmation. |
| Credential lifecycle | Optional mode, secure verifier, setup/change/reset operation, and audit actor/time. | Optional PIN/password captured in T01; reset/recovery and audit specifics remain unresolved. |
| Profile uniqueness | Matching rules for duplicate names and any optional identifiers. | No extra personal identifiers are approved; matching policy remains open. |
| History preservation | Relationship of past shifts/sales/expenses to inactive staff profiles. | Deactivation was proposed to preserve records, not confirmed as policy. |

### T03 — Reception home: member lookup, product sales, checkout, and waste

**Status:** Pending — first screen and workflow requirements captured; payment, sorting, and inventory-accounting details need review.

**User story**

As a receptionist, I want to find the right member, build a product cart, record the payment method and result, and document product waste from one workspace, so that service is quick while member history, cash/shift totals, and stock remain traceable.

**Details and rules**

**Workspace and member lookup**

- Follow the sketch: persistent role navigation, logo, a top search field, shortcuts whose behavior is deferred, a product grid, and a cart at the right on wide screens.
- Typing a printable key while focus is outside an editable control should route text into the global search and focus it. Do not hijack keystrokes while the user is typing in another input, textarea, select, editable region, or dialog; provide a clear keyboard-focus path and visible focus.
- Search recommendations are grouped into `Activos`, `Vencidos`, and `Inactivos`. Keep groups visually distinct when few results exist; allow collapse when result volume is high. The threshold and default collapsed state remain open.
- User-provided classification: active means the membership is current; expired means less than one month since expiry; inactive means more than one month without renewal. Confirm whether “one month” means a calendar month or a fixed duration, exact boundary/timezone, and whether the rule changes access. Existing policy still requires an expired member to renew before a new entry; the category itself does not grant access.
- If facts are incomplete, preserve a separate unknown/unconfirmed state instead of forcing that member into an active/expired/inactive bucket.
- Support alphabetical order and recent attendance prominence. The attendance lookback window, primary/default order, tie-breaking, and whether the receptionist can switch between sort modes remain open. Do not present an attendance count without its period.
- Assigning a member to the cart should allow review of that member's history and preselect their favorite payment method, if one exists. How that preference is set and what to do when none exists are open.

**Product catalog and cart**

- Product cards are square, show product name/image and current stock, and follow the documented Bento/clay tokens in both themes. Default product order is alphabetical; optional sorts are by stock and sales frequency. Sort direction, tie-breaking, and the sales-frequency lookback window need definition.
- Prefer a product image assigned in inventory. Internet image discovery is a separate future integration: retain source/license/attribution data and support commercial-use permission before adding an image. Do not silently copy an image just because a search result is accessible; exact API/source and review workflow are undecided.
- Product selection supports an explicit plus, editable quantity, and minus; do not exceed available stock. Hover may emphasize a card and expose controls on pointer devices, but keyboard and touch must retain visible controls. A card click may add one; right-click removal is optional only and must not be the only decrement path or break the browser context menu without an accessible alternative.
- The cart shows item, quantity, unit price, line total, cart total, assigned member, and one mutually exclusive payment method among cash, card, or transfer. Use an accessible single-select control, not three independent checkboxes that allow simultaneous methods.
- The future shortcuts `Nuevo`, `Gasto`, `Extra`, `Guantes`, `Suplementos`, and `Casilleros` are intentionally deferred until the owner explains their behavior; do not invent their flows in this task.

**Payment and transaction history**

- Cash opens a dialog with a numeric amount and calculated change. Requested keyboard behavior: number keys enter the amount; Enter confirms; Enter with an empty amount means exact payment (or the receptionist has already calculated change manually). Preserve this as the requested behavior, but clarify whether that path should be an explicit “pago exacto” action so an accidental Enter cannot silently complete a cash sale. Record what was actually tendered/change if those values are required for shift reconciliation.
- Card opens a confirmation dialog for a completed terminal charge; transfer opens a dialog to acknowledge that the voucher shows the correct amount. Each method has a clear confirmation action and success feedback.
- **Transfer safety gate:** require the receptionist to deliberately review the voucher and confirm that its amount matches the sale. This is an attention checkpoint, not proof that funds reached the account: after this step the transfer remains pending, with no confirmed revenue or stock reduction until the payment is independently verified. The user confirmed this matches current practice; the exact later verification procedure (“blindar” the method) will be defined with the client.
- On confirmed checkout, show an unobtrusive toast/card notification with the result; retain an error/pending state if the outcome is not confirmed. Prevent duplicate submission and keep cart data available after recoverable errors.
- Link a member's product history to product, quantity, unit price/total, payment method, and date/time. Distinguish gross sale amount, fee, and net settlement; do not rewrite the customer-facing sale price as the net amount.
- Provided card commission formula: `Precio - (Precio * 0.0406)`, equivalent to 95.94% of the input price after a 4.06% fee. Confirm whether `Precio` is the gross sale amount, when/how to round to integer MXN cents, and whether to record the withheld fee and net payout separately. The current demo records integer-centavo amounts and does not model provider fees.

**Waste (merma)**

- The cart-area `Merma` action opens a dialog summarizing the products/quantities to remove from stock, their value, and a reason/comment. The stated examples are a gift to a member, personal consumption, and damaged/defective product; do not turn examples into an exhaustive reason list without approval.
- Require a recorded quantity and reason/comment before confirming a stock loss; preserve who recorded it and the shift/date for later reconciliation if backend policy supports it.
- Existing stock operations already distinguish a `waste` movement from sales. The current product model has a retail price but no cost-basis field; do not present retail price as inventory cost without confirmation. Clarify how the modal chooses products/quantities and what “value” means.

**Design and accessibility**

- Follow `Design.md`: use the root `Logo_Evo.png`, official EGC palette, clear Bento hierarchy, visibly tactile but controlled clay depth, and matching light/dark tokens. Do not let shadows substitute for input/button boundaries.
- Dialogs must have labeled controls, keyboard focus management, safe cancellation, clear errors, and focus return. Search, card controls, sort controls, cart edits, and checkout must work without hover or right-click.
- Preserve the same task order at narrow widths; keep the cart and payment action reachable rather than hiding them behind decorative cards.

**Acceptance criteria**

- [ ] Global type-to-search works outside editable controls and never consumes text intended for another active control.
- [ ] Results are categorized with the stated membership lifecycle, preserve unknown status, can be sorted by name or a labeled recent-attendance period, and remain keyboard navigable.
- [ ] The product grid exposes name, image, stock, price, and accessible quantity controls; sorting choices and stock limits are clear.
- [ ] Cart supports member assignment, member history context, a single payment method, reviewable line totals and a total, and preselection of a known favorite method.
- [ ] Cash, card, and transfer have distinct confirmation dialogs; a reviewed transfer voucher alone does not count as confirmed funds under the existing rule.
- [ ] Card fee handling keeps gross, fee, and net concepts distinct; rounding and source amount are explicitly agreed before financial implementation.
- [ ] Waste records product/quantity, reason/comment, and an explicit stock movement without treating retail price as cost by default.
- [ ] Confirmed sales are recorded once with member (when assigned), items, prices, method, and timestamp; pending/error outcomes do not falsely claim completion.
- [ ] Pointer, keyboard, touch, light/dark, focus, responsive, and recoverable-error states align with `Design.md`; no interaction is hover- or right-click-only.

**Existing elements to reuse or adapt**

- `src/features/reception/ReceptionHome.tsx` — current product grid, stock labels, quantity edits, cart quote, and one-step cart submission; adapt the existing flow rather than duplicating it.
- `src/features/members/MemberSearch.tsx` and `src/demo/memberStatus.ts` — global member combobox and grouped results. Current groups are active/inactive/unknown; expired needs a separately specified lifecycle rule and tests.
- `src/demo/salesOperations.ts` — `cartQuote` and atomic `registerCart` validate the cart as one transaction and prevent partial multi-line commits; preserve this boundary.
- `src/domain/models.ts` — `Product`, `Member`, `Sale`, and `PaymentMethod`; current `Sale` lacks member linkage and `Member` lacks a favorite payment method; `Product` lacks image provenance and cost basis.
- `src/demo/inventoryOperations.ts` — existing `waste` movement and stock reconciliation formula; extend with reason/value metadata only after requirements are agreed.
- `src/shared/ui.tsx` — `Button`, `Panel`, `Field`, `Notice`, and shared dialog/form primitives where appropriate; check existing focus and status semantics before adding new UI.
- `Design.md` — page shell, EGC assets/palette, Bento, claymorphism, both themes, and interaction contract.

**Progressive backend/data mapping — candidates, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Member lifecycle | Membership start/end/renewal facts; derived active/expired/inactive/unknown status and the agreed one-month boundary. | New categorization requested; calendar rule and boundary open. |
| Attendance ranking | Member attendance events plus a named lookback period and ranking rule. | Existing attendance facts may be reused; lookback/sort behavior open. |
| Member payment preference | Optional preferred payment method associated with a member. | Requested; capture source/update permission/default fallback open. |
| Product catalog | Product identity, display order, sale price, expected stock, optional image asset/source/license metadata. | Current model has no image or source metadata; image sourcing/provider open. |
| Product ranking | Stock balance and sales frequency for a defined period. | Stock is derived from movements; frequency period/order open. |
| Cart/checkout | Cart ID, member ID if assigned, item quantities/prices, gross total, payment method/state, shift/time, idempotency. | Cart transaction exists in demo; member linkage and persistent contract open. |
| Card settlement | Gross sale, fee rate/amount, rounding, net settlement, reconciliation reference. | Formula supplied; accounting meaning and rounding open. |
| Cash tender | Amount tendered, change, exact-payment path, and resulting sale/shift ledger effects. | UI behavior described; blank-Enter safety and reconciliation needs open. |
| Transfer review and verification | Record the receptionist's deliberate voucher/amount review separately from verified payment evidence; only verified payment may transition to paid/confirmed and affect revenue or stock. | Review checkpoint confirmed; independent verification procedure and evidence remain open for later client discussion. |
| Product waste | Product, quantity, reason/comment, actor, shift/time, and valuation basis. | `waste` movement exists; reason and value basis not modeled. |

Do not add these as database columns yet. Map entity boundaries, relationships, transition rules, and audit requirements across the remaining screens first.

### T04 — Register an unexpected cash expense

**Status:** Pending — purpose and basic fields captured; authorization and reconciliation rules need owner review.

**User story**

As a receptionist, I want to record an unexpected payment made from the cash drawer, including its concept, amount, and responsible person, so that the shift's cash balance and later reconciliation reflect money spent outside ordinary sales.

**Details and rules**

- The supplied sketch shows a “Registrar Gasto” action, fields for concept, name, and amount/balance, an Add action, and the current shift's expense history.
- Intended example: a supplier arrives to replenish a product, and the owners have not provided separate purchase funds, so the receptionist pays from the cash drawer and records the outflow here.
- A saved expense is a cash outflow, not a sale or product-cost/inventory receipt by itself. If the purchase also needs inventory receiving, that is a separate workflow to be described; do not silently increase stock from an expense record.
- Require a positive, valid amount and a non-empty concept before adding. Retain actor, timestamp, and current shift for audit/reconciliation; whether the “name” field means the receptionist, supplier, or other payee remains open.
- Show newest-first entries for the active shift with concept, amount, responsible person/payee, and time. Do not delete or silently rewrite an already recorded outflow; correction/void rules remain open.
- User-described capability is receptionist-side registration; whether the Admin must approve expenses, set limits, or review them is not specified.
- Expense records must affect expected cash at shift close as outflows, while remaining separately visible from cash sales. Do not treat recorded spending as a confirmed inventory expense category or tax/accounting classification without owner approval.

**Acceptance criteria**

- [ ] Reception can enter a concept and valid amount, identify the relevant person, and add the expense to the current shift history.
- [ ] Invalid, zero, negative, or malformed amounts and missing required text are rejected without changing the shift balance.
- [ ] Each saved expense is linked to a shift and timestamp and is visible in that shift's history.
- [ ] A cash expense reduces expected drawer cash exactly once and remains distinguishable from sales and product waste.
- [ ] Expense registration does not create a sale, confirm a supplier payment external to the drawer, or change product stock on its own.
- [ ] The flow follows `Design.md`, supports keyboard/touch, shows clear success/error feedback, and preserves entered values after recoverable errors.

**Existing elements to reuse or adapt**

- `src/features/reception/ReceptionHome.tsx` — existing reception shell and shortcut context; the `Gasto` shortcut's behavior was deferred and is now specified by this task.
- `src/shared/ui.tsx` — existing `Button`, `Panel`, `Field`, `Notice`, and `TableRegion` primitives for entry and shift history.
- `src/demo/DemoProvider.tsx` and `src/demo/operations.ts` — existing state transaction boundary and `Transaction` result pattern; no expense-registration operation exists in the mapped flow yet.
- `src/demo/shiftOperations.ts::shiftSummary` — currently calculates expected cash as opening cash plus cash-ledger totals. An expense operation must be represented explicitly and incorporated as an outflow rather than misclassified as sales.
- `Design.md` — reuse the documented Bento/clay components, EGC palette, responsive layout, and light/dark tokens.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Shift cash expense | Expense ID, concept, positive amount, actor/payee identity, timestamp, shift ID, and status/correction reference if approved. | Purpose and visible fields requested; exact “name” meaning and correction lifecycle open. |
| Cash reconciliation | Subtract shift expenses from expected drawer cash separately from sales; retain auditable source events. | Existing shift summary ignores expense outflows; reconciliation rule required before implementation. |
| Purchase/inventory linkage | Optional reference between expense and supplier/product receiving, without assuming an expense automatically receives stock. | Example is supplier replenishment; linkage and receiving workflow not yet defined. |
| Expense controls | Permission, approval threshold, owner review, and limits. | Not specified; do not invent. |

### T05 — Record receptionist-funded change (“Extra”)

**Status:** Pending — purpose captured; accounting direction and reconciliation behavior need owner review.

**User story**

As a receptionist, I want to record when I use my own money to provide change to a customer because the drawer lacks sufficient change, so that the shift can later reconcile the personal funds advanced without confusing them with sales or an ordinary cash expense.

**Details and rules**

- The supplied sketch shows a “Registrar Extra” action, fields for concept, name, and amount/balance, an Add action, and the current shift's extra history.
- Intended example: a receptionist pays change to a customer from their own pocket when the register cannot make change; the amount should remain traceable for later gains/losses reconciliation.
- Capture the amount, concept/reason, associated receptionist, timestamp, shift, and (if applicable) related sale or change event. The exact meaning of “Nombre” and whether the amount is the change paid or another amount need confirmation.
- An extra is a personal-funds/change adjustment, not revenue, a customer payment, or a drawer deposit by default. Do not automatically add it to drawer cash or offset sales until the owner confirms the intended accounting direction and reconciliation formula.
- Keep entries separate from `Gasto`, sale, and `Merma`; show them in their own current-shift history. Corrections/voids and who may record or approve an extra remain open.
- Record the adjustment exactly once and leave enough source information for the shift close/reporting workflow to explain any variance. The subsequent settlement with the receptionist, if any, is not defined by this screen.

**Acceptance criteria**

- [ ] Reception can record an extra with required concept and valid amount, linked to the responsible receptionist and active shift.
- [ ] The current shift's extra history shows amount, reason, person, and time, and prevents accidental duplicate submission.
- [ ] The record is not classified as sales income, a cash-drawer inflow, or an ordinary expense unless the owner confirms that accounting treatment.
- [ ] Extra entries are separately available to shift reconciliation and do not change inventory.
- [ ] Invalid/incomplete input produces clear feedback without writing a transaction; saved records are retained after recoverable UI errors.
- [ ] The interface follows `Design.md` and remains accessible without hover or pointer-only controls.

**Existing elements to reuse or adapt**

- `src/features/reception/ReceptionHome.tsx` — existing reception shell and shortcut context; the `Extra` shortcut was deferred and is now specified by this task.
- `src/shared/ui.tsx` — shared `Button`, `Panel`, `Field`, `Notice`, and `TableRegion` can support the form and history.
- `src/demo/DemoProvider.tsx` and `src/demo/operations.ts` — reuse the transaction/state-update boundary if a dedicated extra operation is introduced.
- `src/demo/shiftOperations.ts::shiftSummary` and `src/features/shifts/Shifts.tsx` — existing shift reconciliation is based on opening cash and confirmed cash-ledger events; this flow needs an explicitly agreed treatment before affecting totals.
- `Design.md` — keep the task visually consistent with the Bento/clay system and both themes.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Personal change advance | Extra ID, concept/reason, amount, receptionist/staff ID, timestamp, shift ID, and optional related sale/change reference. | Purpose captured; person field, relation, and exact amount semantics open. |
| Cash ownership/reconciliation | Distinguish receptionist-owned funds from drawer-owned funds; determine how the advance affects expected drawer cash and shift variance. | Do not change cash totals until the owner confirms the accounting direction/formula. |
| Settlement/correction | Optional reimbursement/settlement status and correction/void trace. | Later settlement and correction policy not described. |
| Shift reporting | Show extras independently from sales, expenses, and inventory waste; make them available to reconcile gains/losses. | Reporting destination requested conceptually; final calculation and report screen open. |

### T06 — Rent, assign, and return gloves

**Status:** Pending — core rental interaction captured; rental pricing period and exception handling need owner review.

**User story**

As a receptionist, I want to see which gloves are available or rented, assign an available pair to a member, collect its rental charge, and record its return, so that each reusable pair and its payment/member history stay traceable.

**Details and rules**

- Selecting `Guantes` opens a modal showing the glove pairs and their availability. Each glove item displays color, weight in ounces, rental price, and whether it is available or assigned to a member.
- Selecting a pair updates the detail panel on the right. For an available pair, the receptionist can choose a member, review the glove specification and rental price, and open the same payment flow used by product sales.
- The receptionist explicitly confirms that the rent was paid before the glove transitions to rented/assigned and becomes unavailable. A pending transfer is not a confirmed payment; apply T03's transfer gate and do not mark the rental paid until funds are independently verified.
- For a rented pair, show the assigned member and offer a distinct `Mark returned` action. Recording a return releases the pair back to availability and preserves the loan/return history. Do not use one ambiguous action label for both collecting payment and returning gloves.
- Glove status should be conveyed with text/icon as well as color. The sketch's green/red card colors are not defined as authoritative status colors and must not be the sole status indicator.
- Prevent assigning an already-rented pair or returning an available pair. Handle a pair becoming unavailable while a modal is open by refreshing/revalidating before confirming.
- Track the member, receptionist, payment method/status, rental amount, assigned time, and return time. Reuse the existing sale payment-method choices/dialogs, while keeping a glove rental distinguishable from a product sale.
- Rental charge duration/basis (per visit, session, day, or another period), deposits, overdue handling, damage/loss, cleaning/maintenance status, and multiple concurrent pairs per member have not been specified. Do not assume these policies.
- Follow `Design.md` for the modal, Bento cards, claymorphism, EGC palette, responsive behavior, and both themes. Cards and detail/actions must work on touch and keyboard, not only hover.

**Acceptance criteria**

- [ ] The modal lists each glove pair with color, ounce weight, rental price, and a clear available/rented state.
- [ ] Selecting an available pair allows the receptionist to assign a member and review the price/specification before payment.
- [ ] The existing cash/card/transfer payment flow is reused; a payment must be confirmed before the pair is recorded as rented.
- [ ] A pending/unverified transfer does not complete the rental; its state remains pending until funds are independently verified under T03.
- [ ] A rented pair identifies its assigned member and exposes a separate return action; confirming return restores availability and records the return event.
- [ ] The system prevents conflicting assignments, invalid returns, and duplicate rental/return submissions.
- [ ] Rental and return events remain linked to the pair, member, receptionist, shift, timestamp, and payment state for later review.
- [ ] Availability and actions remain understandable without color, hover, or pointer-only interaction and follow both themes in `Design.md`.

**Existing elements to reuse or adapt**

- `src/features/reception/ReceptionHome.tsx` — reception workspace and the `Guantes` shortcut context; reuse the shell rather than making an unrelated destination.
- `src/features/sales/Sales.tsx`, `src/demo/salesOperations.ts`, and `src/features/payments/MembershipPayment.tsx` — existing sale/payment patterns and explicit paid/pending outcomes; adapt shared payment presentation without recording glove rentals as merchandise sales.
- `src/domain/models.ts` — current member, payment, product, and shift types may inform the later rental model; no glove/rental asset or loan-history entity is currently mapped.
- `src/demo/DemoProvider.tsx` and `src/demo/operations.ts` — existing state transaction pattern for future rental/return operations.
- `src/shared/ui.tsx` — shared `Button`, `Panel`, `Badge`, `Notice`, and dialog/table primitives.
- `Design.md` — Bento/clay styling, official brand palette, modal behavior, and light/dark design contract.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Glove pair catalog | Stable glove ID, color, ounce weight, rental price, and availability/maintenance state. | Display fields requested; maintenance states and pricing basis open. |
| Rental assignment | Rental/loan ID, glove ID, member ID, receptionist ID, assigned timestamp, current state, return timestamp/actor. | Available-to-rented-to-returned flow requested; persistence and history contract open. |
| Rental payment | Amount, payment method, paid/pending/verified state, timestamp, and reference to the rental rather than a retail product sale. | Reuse sales payment UI; backend operation/ledger treatment open. |
| Transfer confirmation | Preserve pending state until independent fund verification; do not release a paid/unpaid distinction based only on voucher review. | Inherits T03 transfer rule. |
| Availability consistency | Atomic validation that a glove is available before assignment and rented before return; prevent duplicate submissions. | Required to avoid double-loaning; exact API not designed. |
| Rental policy | Billing period, deposit, overdue, damage/loss, cleaning, and member concurrency rules. | Not specified; requires owner/client input before implementation. |

### T07 — Sell supplement servings by scoop

**Status:** Pending — separate serving-based supplement sales captured; portion and inventory conversion rules need owner review.

**User story**

As a receptionist, I want to sell supplement servings by the scoop, assign the purchase to a member, and collect payment through the familiar sales flow, so that per-serving revenue and the source container's inventory are tracked separately from ordinary retail products.

**Details and rules**

- Selecting `Suplementos` opens a product grid and cart similar to normal product sales, but the sellable unit is a scoop/serving rather than a full tub or bottle.
- Product cards use the requested hover emphasis and slight growth on pointer devices. A left click can add a serving and a right click can remove one from the cart as requested, but explicit plus/minus and editable quantity controls must remain available for keyboard, touch, and users who do not use right-click. Do not break the browser context menu as the only removal path.
- The cart supports member assignment, one payment method, total, and the same cash/card/transfer checkout experience as product sales. Preserve T03's transfer review/verification rule; a voucher-only review leaves the transaction pending.
- Supplement servings are recorded separately from ordinary unit-product sales. Do not record the sale of a whole container when only a scoop was sold, and do not merge scoop revenue into the ordinary product-sale history without a distinguishable transaction/line type.
- Each serving sale should record supplement identity, number of servings, serving price, gross amount, member if assigned, payment method/status, shift, receptionist, and timestamp. A member's history should be able to distinguish a supplement serving from a retail product purchase.
- Inventory must account for the physical quantity taken from the open container, but the conversion from scoops to remaining product needs an agreed unit/portion model. Do not subtract one whole container for a single scoop or invent yield/rounding rules.
- Clarify whether the price is fixed per scoop, varies by supplement/size, and how partial servings, container opening, spills/merma, and restocking are recorded. The user states that scoop sales are calculated and tracked separately; exact formula/report totals are not yet specified.
- Reuse the existing product grid/cart/payment patterns where possible, while keeping supplement-specific pricing, serving quantities, and history explicit. Follow `Design.md` for Bento/clay cards, official colors, keyboard/touch use, responsive layout, and light/dark themes.

**Acceptance criteria**

- [ ] The supplement screen lists eligible supplements and supports adding servings to a cart; the full container is not presented as the sold unit.
- [ ] Pointer users can add with left click and remove with right click if enabled; plus/minus and editable quantity remain accessible alternatives on all devices.
- [ ] The cart can assign a member and select exactly one of the shared payment methods, then invoke the existing method-specific payment dialogs.
- [ ] Cash/card/transfer outcomes use the same confirmed/pending/error safeguards as T03; unverified transfers are not reported as paid.
- [ ] A confirmed serving sale is recorded as a distinct supplement transaction with quantity, price, member (if assigned), method/status, staff, shift, and timestamp.
- [ ] Supplement serving sales appear separately from whole-unit retail sales in member history and later sales reports.
- [ ] The serving-to-container stock conversion is based on an owner-approved portion/yield definition, preventing unexplained full-container deductions or invented precision.
- [ ] Invalid quantities or insufficient available supplement stock prevent checkout without partially saving the cart.
- [ ] The interface remains usable without hover/right-click and follows both themes and accessibility rules in `Design.md`.

**Existing elements to reuse or adapt**

- `src/features/reception/ReceptionHome.tsx` — existing product grid, quantity editing, cart, and checkout interaction; adapt rather than duplicate the cart mechanics.
- `src/demo/salesOperations.ts` — `cartQuote`, `registerCart`, and atomic multi-line transaction behavior; a separate serving-aware operation or line kind may be needed to avoid treating one scoop as one whole product unit.
- `src/demo/inventoryOperations.ts` — stock movement and expected-stock calculations; current movements use integer item quantities and need a defined supplement serving/container conversion before reuse.
- `src/domain/models.ts` — current `Product`, `Sale`, `PaymentMethod`, and stock-movement shapes can inform the later design, but do not yet express serving size, opened-container yield, or a distinct supplement-sale record.
- `src/features/members/Members.tsx` — existing payment method labels; preserve pending transfer wording and status semantics.
- `src/shared/ui.tsx` — shared `Button`, `Panel`, `Badge`, `Notice`, and form/dialog primitives.
- `Design.md` — visual contract for product cards, hover/depth, modal/payment states, and both themes.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Supplement catalog | Supplement ID/name, container size/unit, serving definition, price per serving, opened/available state, and optional stock image. | Scoop-based selling confirmed; product portion and pricing fields open. |
| Serving stock conversion | Number/weight of servings per container or portion quantity per scoop; decrement only the equivalent consumed amount. | Required for accurate stock; no conversion or rounding rule provided. |
| Supplement sale | Sale/serving ID, supplement ID, serving quantity, unit serving price, gross amount, member ID, payment state/method, shift, actor, timestamp. | Keep distinct from retail sale records; persistence/ledger contract open. |
| Payment | Shared cash/card/transfer state machine and pending transfer verification. | Reuse T03 behavior; no separate supplement payment policy requested. |
| History and reporting | Separate supplement revenue/serving totals from unit-product sales; member history labels the serving and quantity. | Separate tracking requested; report dimensions and calculations open. |
| Container variance | Spills, complimentary servings, spoilage, opened/partial container counts, and reconciliation. | Not specified; do not invent inventory or waste treatment. |

### T08 — Assign and manage monthly lockers

**Status:** Pending — locker count, monthly expiry rule, and status categories captured; status transitions and billing details need owner review.

**User story**

As a receptionist, I want to view the gym's 42 numbered lockers, assign an available locker to a member for a paid month, track its exact expiry and status, and release or evict it when appropriate, so that locker availability and monthly payments remain clear and traceable.

**Details and rules**

- The locker screen shows all **42 lockers** in fixed order: number from top to bottom, then left to right. The sketch illustrates a smaller grid only; it does not change the confirmed total.
- The user-defined statuses are `Assigned to employee`, `Available`, `Sold`, `Evicted`, and `Out of service`. Show the status as text/icon as well as color; the sample colors are not the only status signal.
- Selecting a locker opens a detail panel with the status control, member assignment or current assigned member, the monthly price, and the payment/expiry date. For an available locker assigned to a member, use the established cash/card/transfer payment dialogs from sales.
- A locker rental lasts one calendar month. Its expiry is the same day number in the following month at the same local time; if that day does not exist in the next month, expire on that month's last day at the same local time (for example, a January 31 start expires on the last day of February). Preserve the gym's authoritative timezone; do not calculate calendar-month expiry by adding a fixed number of days or UTC slicing.
- Reuse membership date semantics for this monthly term, but do not treat locker payment as a gym membership or grant gym access. A pending/unverified transfer follows T03 and must not be labeled paid.
- The sketch includes actions for paid, released, evicted, or unassign. Keep these actions distinct and record their actor/time. Do not infer that a locker is `Sold` merely because a payment is recorded until the owner confirms what `Sold` means relative to a monthly rental.
- `Out of service` lockers cannot be assigned until returned to service. `Available` lockers have no active member assignment. Prevent a locker from being assigned to multiple people at once.
- Current ownership/assignment suggests some lockers may be allocated to employees, but do not infer a number or who can create that allocation. Keep employee assignment distinct from customer rental unless the owner confirms otherwise.
- Define how a payment confirmation, monthly renewal, expiry, overdue state, eviction, release, and unassignment transition between the five named statuses before implementation. In particular, the user has not specified whether expiry automatically changes status, whether there is a grace period, or whether `Evicted` is a manual action.
- Use the locker detail panel and 42-slot grid responsively, with keyboard and touch selection. Follow `Design.md` Bento/claymorphism, brand colors, and light/dark themes.

**Acceptance criteria**

- [ ] Exactly 42 lockers are rendered and numbered in top-to-bottom, then left-to-right order.
- [ ] Each locker has one of the five named, readable statuses; status is not conveyed by color alone.
- [ ] Selecting a locker shows its current status, assignment/member, monthly price, and relevant payment/expiry information.
- [ ] A member can be assigned to an eligible available locker and the correct shared payment flow opens.
- [ ] The month term expires on the matching next-month date/time, clamped to the last day when necessary, using the agreed gym timezone and calendar arithmetic.
- [ ] Pending/unverified transfer payments are not treated as paid locker rentals.
- [ ] Out-of-service and already-assigned lockers cannot be assigned; release/unassign/eviction are separate auditable actions.
- [ ] Locker assignment, payment, renewal, expiry, release, and eviction events are traceable to locker, person/member, receptionist, shift, and timestamp where applicable.
- [ ] The screen works with keyboard/touch and both documented themes; all 42 lockers remain navigable at narrow widths.

**Existing elements to reuse or adapt**

- `src/features/reception/ReceptionHome.tsx` — existing Reception shell and `Casilleros` shortcut context.
- `src/features/payments/MembershipPayment.tsx` and `src/demo/operations.ts::collectMembership` — existing monthly-payment and paid/pending result patterns; adapt them without creating a gym membership for a locker.
- `src/demo/memberStatus.ts` and the membership date model in `src/domain/models.ts` — existing membership date semantics may inform calendar-month expiry, but locker status/contract should remain separate.
- `src/demo/shiftOperations.ts` — shift/payment reconciliation context for recording locker payments.
- `src/demo/DemoProvider.tsx` and `src/demo/operations.ts` — existing atomic state transaction boundary for future locker assignment/payment/status operations.
- `src/shared/ui.tsx` — existing `Button`, `Panel`, `Badge`, `Notice`, and dialog/table primitives.
- `Design.md` — official EGC colors, Bento/clay grid/card treatments, modal behavior, and both themes.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Locker catalog | Fixed locker ID/number (1–42), position/order, and operational status. | Count/order and five statuses specified; visual geometry and status transitions open. |
| Locker assignment | Assignment ID, locker ID, member or employee ID, start time, expiry time, current state, and actor. | Monthly member assignment described; employee allocation semantics/count open. |
| Calendar expiry | Local start datetime, timezone, next-month calendar date/time with end-of-month clamp, renewal and expiry transitions. | Date rule confirmed; authoritative timezone and expiration transition/grace behavior open. |
| Locker pricing/payment | Monthly amount, payment method, paid/pending/verified state, timestamp, shift/receptionist, and locker-assignment reference. | Reuse payment dialogs; exact price and accounting/ledger contract open. |
| Status history | Status change, actor, timestamp, reason, and links to assignment/payment where applicable. | Required to distinguish sold, evicted, released, employee-assigned, and out-of-service lifecycle; definitions/transitions open. |
| Availability and authorization | Atomic assignment only for available/in-service lockers; permissions for staff allocation, release, eviction, and maintenance. | Consistency required; role/approval rules unspecified. |

### T09 — Browse and search members

**Status:** Pending — member list and search captured; new-member registration is specified in T10; row selection now opens the member profile in T11.

**User story**

As a receptionist, I want to browse and search members in one table with their contact and membership details, so that I can quickly find the right person and start a new member registration when needed.

**Details and rules**

- Follow the supplied screen: Reception navigation, shared top search bar, `Nuevo` and `Perfil` actions, and a member table.
- The table must make these facts visible: member name, phone number, current membership/plan, membership type, and membership expiry date. The sketch has one `Membresía` column while the description distinguishes membership and membership type; confirm whether these are one combined display or separate columns.
- The search uses the same global search behavior as T03 and filters the visible table results. Reuse the existing name/phone/reference matching rather than adding a separate, inconsistent search implementation. If shared type-to-search is available, preserve its focus safeguards and do not capture keys while another editable control/dialog owns focus.
- Keep membership and expiry information grounded in recorded data. Show an explicit empty/unknown value when no membership/expiry exists; do not fabricate a plan or date. Expiration display must follow the agreed gym timezone and membership date semantics; do not infer that a listed member is eligible for access solely from the row.
- `Nuevo` opens the member-registration flow described in T10. Do not silently enroll the new member in a paid membership; membership, class-sample, and one-time-visit paths have different persistence and eligibility behavior.
- `Perfil` remains the shared signed-in staff profile action, not a member profile action. Selecting a member row, or selecting a member result from the shared search and pressing Enter, opens that member's profile in T11. Make row/result selection keyboard-operable and visually clear; do not turn it into an undisclosed destructive or state-changing action. Sorting, pagination, and filtering by membership type/status are not specified.
- On narrow screens, keep all five required facts discoverable via responsive columns or a contained horizontal table region. Follow `Design.md` for Bento/clay panel styling, brand colors, and light/dark themes.

**Acceptance criteria**

- [ ] The member list displays name, phone, current membership/plan, membership type, and expiry date (combined or separate columns as owner confirms).
- [ ] Shared search filters the table by the same supported member identifiers as T03 and provides a clear no-results state.
- [ ] Search keyboard behavior does not steal input from another focused field or open dialog.
- [ ] Missing membership or expiry values are represented honestly and do not imply access authorization.
- [ ] `Nuevo` opens the member-registration flow in T10, with the selected registration type determining the relevant fields and payment/eligibility steps.
- [ ] The list remains readable at narrow widths and with keyboard/screen-reader navigation, and follows both design themes.
- [ ] The screen reuses existing member-list and registration behavior where suitable rather than creating parallel sources of truth.

**Existing elements to reuse or adapt**

- `src/features/members/Members.tsx::Members` — existing member table, search filter, page heading, and `Nuevo socio` route; adapt columns and shared search instead of duplicating the member directory.
- `src/features/members/Members.tsx::NewMember` and `src/demo/operations.ts::addMember` — existing registration UI and create-member operation; retain validation/idempotency patterns while field requirements are reviewed.
- `src/features/members/MemberSearch.tsx` and `src/demo/memberStatus.ts` — global member search and grouping; share its search semantics while rendering results as a table rather than a recommendation menu.
- `src/domain/models.ts::Member` — existing member identity/contact and membership facts; inspect field semantics before deciding how membership type should display.
- `src/shared/ui.tsx` — shared `PageHeader`, `Field`, `Panel`, `Button`, `EmptyState`, `Notice`, and `TableRegion` primitives.
- `Design.md` — page shell, Bento table container, EGC colors, accessible states, and light/dark contract.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Member directory | Member ID, display name, phone, current membership/plan, membership type, expiry, and honest missing-value representation. | Required display facts captured; exact distinction between plan and type open. |
| Search/filter | Shared query over supported identifiers; consistent normalization, keyboard focus ownership, and filtered table results. | Reuse current name/phone/reference semantics; more filter controls not requested. |
| Membership date display | Membership plan/type and expiry facts with timezone/date semantics and no access implication from display alone. | Reuse established membership facts; type mapping and authoritative timezone need review. |
| Member registration | Create-member operation, required fields, same-name class-sample warning, initial membership/payment relation, and post-create destination. | Registration paths captured in T10; same-name warning is non-blocking and contact stays optional. |
| Row detail/navigation | Navigate from a selected row or Enter-selected search result to the member profile. | Explicitly requested; route and selection affordance should be keyboard accessible. |

### T10 — Register a member, class sample, or one-time visit

**Status:** Pending — base fields and three registration paths captured; warning wording, eligibility proof, and visit-record rules need owner review.

**User story**

As a receptionist, I want to register a new member with only the information required for their selected membership or class-sample path, or process a one-time visit without creating a member profile, so that payments and eligibility are recorded without collecting unnecessary personal data.

**Details and rules**

- The `Nuevo` action from T09 opens this form. The sketch shows name, phone, email, membership/class-sample selection, payment method, total, a conditional verification step, and a final `Register` action.
- Name is required; phone and email are optional as described. Define and validate any additional fields only when required by the selected path; do not make optional contact details mandatory globally.
- The flow has three paths:
  - **Membership:** select the membership plan/type, show its amount, choose a payment method, complete that method's confirmation modal, and create the member/membership record according to the established payment result. Do not mark a transfer as paid or authorize access while it remains pending under T03.
  - **Class sample:** create a persistent member record and record each class-sample use. Since phone/email can be unavailable or declined and government identifiers such as CURP should not be collected for this purpose, compare the person's full name with prior class-sample records and show a non-blocking warning with the number of prior sample uses recorded under that same full name. The warning is a signal for receptionist judgment, not proof that the people are identical and not an automatic denial; people may share names or spell them differently.
  - **One-time visit:** do not create a persistent member profile, because the visitor may not return. If the visit still requires a charge or operational attendance record, use a separate visit transaction without silently creating a member; whether and what anonymous visit details must be retained remains open.
- Payment method selection is one mutually exclusive choice among cash, card, and transfer (use a radio/single-select pattern, not three independent payment checkboxes). The selected method opens its own modal when the receptionist proceeds to register/pay.
- Reuse T03's cash calculator/change flow, card-terminal confirmation, and transfer-voucher review. A transfer voucher checkbox confirms only that the receptionist reviewed the voucher and amount; it does not prove funds arrived. Keep the payment pending until independent verification, without confirmed revenue/access effects.
- For a cash modal, record the amount received and calculated change, while preserving the exact-payment behavior from T03; avoid silently completing a cash payment from an accidental keyboard event.
- For card, require a deliberate confirmation that the terminal charge was completed. For transfer, require the deliberate voucher/amount review checkpoint while preserving pending status until verified.
- If a selected membership type requires student eligibility (as the sketch's verification note suggests), prompt for an explicit receptionist confirmation that the student credential was checked. Do not show that verification for unrelated membership types. The exact accepted evidence, who may verify it, and whether any proof is recorded are open; minimize personal/sensitive proof data.
- Separate payment verification from student eligibility verification. Completing one checkbox/modal must not implicitly satisfy the other.
- Prevent duplicate submission and retry-created duplicate member/payment/sample records (idempotency is distinct from same-name matching). If payment is pending or errors, show the actual state and retain safe form context for recovery; do not display a generic “registered and paid” success for pending transfer.
- Follow `Design.md`: organize the form into readable sections with conditional fields and a clear review/confirmation step, without crowding every verification control into a permanent checkbox block. Use both themes, responsive layout, labeled controls, keyboard focus, and clear errors.

**Acceptance criteria**

- [ ] Name is required; phone and email remain optional for every registration path, including class samples. No government identifier is required for repeat-sample warnings.
- [ ] The receptionist can choose exactly one of membership, class sample, or one-time visit and sees only the fields and checks relevant to that path.
- [ ] Membership registration shows the selected plan/type and amount, then opens the cash/card/transfer-specific confirmation flow.
- [ ] A class sample creates a traceable member/sample-use record; if prior samples are recorded under the same full name, show a warning with their count and let the receptionist assess it without automatic blocking.
- [ ] Same-name warnings are explicitly presented as possible matches, not verified identity; phone, email, or government ID is not required to dismiss/resolve a warning.
- [ ] A one-time visit does not create a persistent member profile; any visit charge/anonymous operational record is kept distinct from member enrollment.
- [ ] Student eligibility is requested only for a plan/type that requires it and remains separate from payment confirmation.
- [ ] Cash captures tender/change; card requires terminal confirmation; transfer voucher review is recorded as review only, leaving funds pending until independently verified per T03.
- [ ] Pending/error outcomes are communicated honestly, do not trigger paid/access effects, and do not create duplicate records on retry.
- [ ] The form works with keyboard and touch, provides conditional validation and recoverable errors, and follows both themes and accessibility rules in `Design.md`.

**Existing elements to reuse or adapt**

- `src/features/members/Members.tsx::NewMember` — current creation form; already requires name and treats phone as optional. Extend it with registration paths rather than rebuilding the form shell.
- `src/demo/operations.ts::addMember` — current member creation operation; adapt for optional email, membership/sample linkage, a non-blocking same-full-name sample-use warning, and safe idempotency.
- `src/features/payments/MembershipPayment.tsx` and `src/demo/operations.ts::collectMembership` — existing plan payment selection and paid/pending semantics; reuse method-specific UI/behavior, keeping transfer pending.
- `src/demo/salesOperations.ts` — existing cash/card/transfer purchase confirmation patterns; reuse interaction and transaction safety without treating class sample/visit as merchandise.
- `src/domain/models.ts::Member`, `MembershipPayment`, `AttendanceVisit`, and `PaymentMethod` — candidate existing domain concepts; current Member does not include email or a trial-use marker, and visit/attendance must not be conflated with membership enrollment.
- `src/shared/ui.tsx` — `Field`, `Button`, `Panel`, `Notice`, and dialog primitives for validated conditional form sections and payment modals.
- `Design.md` — form hierarchy, EGC branding, clay/Bento treatments, focus/error feedback, and theme tokens.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Member identity | Required full name, optional phone/email, stable member ID, and a privacy-minimal same-full-name comparison for class-sample warnings. | Show recorded same-name sample-use count as a non-blocking warning; it is not reliable identity proof. Do not require CURP or contact details. |
| Membership registration | Selected plan/type, amount, start/expiry facts, payment association, and eligibility/access effect based on payment state. | Plan selection and method flow requested; date source and pending-access rule to align with established membership policy. |
| Class-sample tracking | Member/sample-use event, name as entered/normalized for lookup, prior same-name sample-use count, warning display, actor/time. | Name-based count and warning requested; no hard identity claim or automatic block. Exact normalization and warning wording open. |
| Student verification | Conditional attestation for student membership, actor/time, and minimal verification evidence. | Verification requested by sketch; accepted proof and retention policy open. |
| One-time visit | Optional anonymous visit/payment event, amount/method/status, time/shift, and no persistent member creation. | No member profile confirmed; visit/attendance and receipt-record requirements open. |
| Payment confirmation | Method-specific cash tender/change, card-terminal acknowledgment, or transfer voucher-review event plus independent verification state. | Reuse T03 safeguard; transfer review alone remains pending. |
| Idempotency/audit | Single registration/payment submission, staff actor, timestamp, and recoverable pending/error state. | Required for retry safety; backend contract not selected. |

### T11 — View member profile, attendance, services, and notes

**Status:** Pending — profile content and navigation are captured; data semantics, permissions, and retention rules need owner review.

**User story**

As a receptionist, I want a selected member's identity, attendance, current services, purchase/payment history, memberships, and incident notes in one profile, so that I can register their visit and follow up on unresolved items using the member's history as context.

**Details and rules**

- Open this screen when a receptionist selects a member from T09 or highlights a search result and presses Enter. Preserve the selected member identity across navigation and provide a clear way to return to the directory/search.
- The header shows the member's full name and whichever contact details exist: phone, email, or both. Both remain optional; do not require or collect CURP or another sensitive government identifier as a workaround for missing contact information.
- Provide one attendance action whose label/state follows the member's current visit: `Register entry` when there is no open visit and `Register exit` when one is open. Reuse existing entry/exit operations and access rules; prevent duplicate open visits and do not imply that profile visibility itself authorizes entry.
- Show current glove rentals/assignments and locker assignments, including clear outstanding/not-returned, availability, and expiry/status facts where recorded. Surface unresolved returns so Reception can ask or follow up. Do not invent penalties, automatic eviction, or confiscation rules.
- Show purchase history with products, date, payment method, and actual payment state. Distinguish a deliberately recorded unpaid/on-credit balance from a transfer that is merely awaiting independent verification; voucher review alone is not proof of payment and must not be mislabeled as customer debt. Make any recorded outstanding amount visible for follow-up.
- Store/show a member's preferred payment method and use it as the preselected method for a later payment when the member is assigned in T03 or another payment flow. If no preference is known, leave method selection unselected; do not infer one from the most recent transaction without an explicit rule.
- Render historical attendance as a GitHub-style grid of day squares, with attendance days visually marked. Define accessible text for date/count and a legend; period length, timezone, multiple visits per day, and color semantics remain open.
- Show current and prior membership periods and a tenure/continuity streak derived from recorded periods. This context may help Reception decide whether to offer a discretionary extension, but the system must not grant extensions automatically or imply an entitlement. Any future extension must be an explicit, auditable staff action under an owner-approved rule.
- Include a notes area for incidents and relevant follow-up. Preserve authorship and timestamp and avoid silently overwriting prior notes; use minimal factual wording. Who may read/add/edit/delete notes, retention, and handling of sensitive information require an explicit privacy/access policy before implementation.
- Follow `Design.md`: use Bento sections, pronounced but controlled claymorphism, EGC brand palette, and supported light/dark themes. Keep the profile scannable and responsive; allow service/history details to be explored without overcrowding the page.

**Acceptance criteria**

- [ ] Selecting a T09 row or pressing Enter on a selected search result opens the matching member profile; keyboard users can also return to the directory.
- [ ] The profile displays the full name and available optional phone/email without requiring missing contact data or adding a government identifier.
- [ ] The attendance action accurately switches between entry and exit based on the open visit and reuses existing duplicate/access safeguards.
- [ ] Gloves and lockers show recorded assignments and flag unresolved returns/statuses without inventing penalties or transitions.
- [ ] Purchase history shows product, date, payment method, and recorded state; outstanding customer balance is distinct from pending transfer verification.
- [ ] A stored preferred payment method is preselected in the applicable later payment flow; an unknown preference remains unselected.
- [ ] The attendance grid exposes marked attendance days with accessible date/count labels and a legend; date range/timezone rules are defined before implementation.
- [ ] Current/prior memberships and derived tenure/streak are visible; discretionary extensions are never automatic and remain subject to owner policy/audit.
- [ ] Notes retain author/time and history; note permissions, retention, and sensitive-data handling are resolved before implementation.
- [ ] The screen follows both themes, responsive layout, keyboard/screen-reader accessibility, and the Bento/clay visual system in `Design.md`.

**Existing elements to reuse or adapt**

- `src/features/members/Members.tsx::MemberDetail` and `MemberAttendance` — existing member profile and attendance presentation; extend rather than duplicate.
- `src/features/attendance/AttendanceCalendar.tsx` — attendance date-grid/calendar rendering; adapt to the requested GitHub-like heatmap and accessible day metadata.
- `src/demo/attendanceOperations.ts::enterMember`, `exitMember`, and `openAttendance` — existing entry/exit and open-visit behavior; preserve its validation and tests.
- `src/features/members/MemberSearch.tsx` and `src/demo/memberStatus.ts` — member selection/search and current status semantics.
- `src/domain/models.ts::Member`, `AttendanceVisit`, `MembershipPayment`, `PaymentMethod` — existing domain facts; current model has only one membership summary and lacks email/history/debt preference/notes.
- `src/features/sales/Sales.tsx`, `src/demo/salesOperations.ts`, and shared payment-method UI — purchase/payment presentation and method preselection integration point; inspect actual paths/API before implementation.
- `src/shared/ui.tsx` and `Design.md` — shared panels, buttons, empty states, notices, tokens, theme, and accessibility patterns.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Member identity/contact | Member ID, full name, optional phone/email. | Name and optional contact are established in T10; current model lacks email. |
| Visit state | Attendance visits, check-in/out, current open visit, actor/time, date aggregation. | Reuse attendance records/operations; heatmap range/timezone and aggregation rules open. |
| Gloves | Rental item, member assignment, paid state, checkout/return timestamps, current outstanding status. | Screen requirements captured in T06/T11; current persistence shape to verify. |
| Lockers | Locker number, member assignment, lifecycle status, paid-through/expiry and release events. | Screen requirements captured in T08/T11; expiry and transitions need owner-approved rules. |
| Purchases and balances | Sale lines, date, payment method/state, explicitly unpaid/on-credit balance and settlement history. | History and visibility requested; no credit/unpaid-sale semantics specified; separate from pending transfer verification. |
| Preferred payment method | Optional member-level payment-method preference. | Requested for checkout preselection; persistence/update rule not yet specified. |
| Membership history | Membership periods, status, payments, continuity/streak derivation, discretionary extension event and actor/reason. | Current model stores one membership summary; history and extension policy remain open. |
| Attendance heatmap | Visit dates/count, timezone, display period, date-to-color/accessibility text. | Visual form requested; period, timezone, multiple-visit aggregation and palette semantics open. |
| Member notes | Appendable incident/follow-up notes with author and timestamp, access and retention/audit rules. | Notes requested; permissions, edit/delete, retention, and privacy policy open. |

### T12 — Browse inventory, create products, and receive stock

**Status:** Pending — catalog, new-product fields, and stock-receipt flow captured; valuation, cost-change notification delivery, and expense linkage need owner review.

**User story**

As a receptionist, I want to review the product catalog and record new products or incoming quantities with their acquisition cost, so that inventory stays current and cost changes are visible to the administrator.

**Details and rules**

- Follow the inventory sketch: shared Reception shell/search, product grid/list with current stock, `Agregar producto` action, and a right-side receipt summary with quantity, cost, sale price, selected products, total, and `Agregar` confirmation. Keep catalog and receiving distinct from normal product sales (T03).
- `Agregar producto` creates a catalog item with required name, purchase/unit cost, sale price, and initial quantity. The initial quantity must be recorded as an opening stock event/movement so the displayed stock has traceable provenance, not only as an unexplained mutable number.
- To receive existing stock, select a product, enter the received quantity, and show its current unit acquisition cost and sale price. Default to the catalog's current cost; allow an authorized cost edit when the new receipt has a different acquisition cost. The sale price is visible for context; who may change it and whether it is editable in this flow remain open.
- When a receipt uses a different acquisition cost, record the old/new values, quantity, product, receptionist, time, and shift, then notify the administrator/OWNER. The notification is informational per the request; do not silently block the receipt pending approval or silently overwrite history. Delivery channel and whether OWNER can review/approve cost updates remain open.
- The right-side summary lists every selected product with received quantity, unit cost, and extended line cost, plus a total receipt value. Use explicit currency formatting and safe integer minor units; quantity and cost validation must reject zero/negative or malformed values. The exact valuation policy (last cost vs average cost vs another method) remains open; the line total is the stated receipt cost, not a claim of accounting inventory valuation.
- `Agregar` confirms the summarized receipt once, updates expected stock through an auditable stock movement, and shows a clear success/error state. Prevent duplicate submissions and stale/insufficient catalog references. If the user edits quantity or cost, recompute line/receipt totals before confirmation.
- Recording incoming stock is not automatically a `Gasto` or cash-drawer movement. Link a supplier expense only when a separate expense/payment workflow is explicitly completed; the same purchase must not be silently double-counted as both stock movement and cash expense.
- The shared search may filter products using established search behavior. No additional sort modes, product images, stock warnings, supplier identity, purchase invoice, or approval workflow were specified for this inventory screen; do not invent them here. Reuse the product imagery field/UI from T03 only if available and appropriate.
- Follow `Design.md`: visible but controlled claymorphism on Bento panels, EGC palette, responsive layout, and both light and dark themes. Ensure the receipt summary remains usable without relying on hover.

**Acceptance criteria**

- [ ] The inventory view lists catalog products and clearly displays current expected stock.
- [ ] Creating a product requires name, purchase/unit cost, sale price, and initial quantity; its initial quantity is traceable as an opening stock event.
- [ ] Receiving stock requires product and positive quantity and shows current unit cost and sale price before confirmation.
- [ ] A changed acquisition cost is recorded with old/new values and actor/time/shift and triggers an administrator/OWNER notification without erasing history.
- [ ] The receipt summary shows each product, quantity, unit cost, line total, and recomputed aggregate total before commit.
- [ ] Confirming adds exactly one receipt/movement per selected line and updates stock; repeat submission does not duplicate inventory.
- [ ] A stock receipt does not implicitly create a `Gasto`, cash movement, or sale.
- [ ] Product search, keyboard access, responsive layout, screen-reader labels, and both `Design.md` themes remain usable.

**Existing elements to reuse or adapt**

- `src/features/inventory/Inventory.tsx::Inventory` — existing inventory/physical-count view; current screen records demonstration counts, restock, and waste rather than product creation/receiving at purchase cost.
- `src/demo/inventoryOperations.ts::stockBreakdown`, `expectedStock`, `currentShiftStockBreakdown`, `recordMovement`, and `recordCount` — expected-stock derivation and auditable quantity movements; preserve their separation of expected quantity from physical count.
- `src/domain/models.ts::Product`, `StockMovement`, and `PhysicalCount` — current inventory types; `Product` has one `priceMinor`, opening quantity, and `illustrative: true`, while stock movements currently lack acquisition-cost snapshots and receiving actor metadata.
- `src/features/sales/Sales.tsx` and `src/demo/salesOperations.ts` — product catalog/sales price usage and stock decrement on sales; ensure new catalog/receipt data remains compatible with T03 sales.
- `src/demo/ownerOperations.ts` and OWNER-facing surfaces — inspect existing alert/administrative patterns before choosing notification delivery.
- `src/shared/ui.tsx` and `Design.md` — shared fields, panels, buttons, notices, tables, page layout, and brand/theme contract.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Product catalog | Product ID, name, current purchase/unit cost, sale price, lifecycle/availability, optional image. | Create flow requires name/cost/sale price; current type holds one price and illustrative seed; lifecycle policy open. |
| Opening stock | Initial quantity, opening movement, actor, time, source. | Quantity required at creation; movement-based provenance requested to avoid untracked baseline changes. |
| Stock receipt | Product lines, received quantity, unit acquisition cost snapshot, line/receipt total, actor, shift, timestamp, idempotency key. | Quantity and cost receipt captured; duplicate-safe audited operation required. |
| Cost change history | Previous/new unit cost, receipt reference, changed-by, time, quantity, administrator notification and optional review state. | Notify administrator when acquisition cost changes; delivery/approval and audit retention rules open. |
| Stock calculation | Opening quantity plus received stock minus sales/waste; physical counts remain observations until an explicit correction. | Existing expected-stock model already separates movements and physical counts; preserve semantics. |
| Receipt valuation | Line cost and receipt total, currency precision, method for catalog/current inventory valuation. | UI total is quantity × receipt unit cost; average/last-cost policy is not selected. |
| Supplier/cash ledger | Optional supplier expense/payment link and reconciliation without duplicate cash/expense recognition. | Receipt must not implicitly create `Gasto` or cash movement; linkage workflow remains open. |
| Authorization/notification | Who can create products/change costs, OWNER recipients, notification channel and review/approval flow. | Cost-change notification requested; permission/channel/approval rules need owner review. |

### T13 — Review current shift activity and close the shift

**Status:** Pending — Reception shift summary and cash reconciliation are captured; cash-flow semantics, card-fee rounding, and independent transfer verification need owner review.

**User story**

As a receptionist, I want to review the collections, cash movements, and activity recorded during my current shift, so that I can reconcile the physical drawer against its expected balance and close the shift using the existing denomination-count flow.

**Details and rules**

- Follow the supplied layout within the shared application shell: page title `Turno`, `Cerrar turno` action, three summary cards, “Cobros por métodos de pago”, “Actividad de turno (tipo de ventas hechas)”, and “Historial de movimientos por turno”. Use the established header and navigation rather than creating a separate shell.
- The three cards represent shift collections, cash outflows, and expected physical cash in the drawer. They are shift-accounting summaries, not generic performance KPIs; label the amounts and their included/excluded states clearly.
- Treat expected drawer cash as a candidate formula: opening cash + confirmed cash collections + receptionist-funded `Extra` cash contributions − actual cash `Gasto`s − confirmed cash refunds/returns, if any. The exact cash-expense/extra recording model and any refund policy remain subject to owner review; this formula is not a finalized accounting or schema decision.
- Count only confirmed cash collections as physical drawer cash. Card sales and bank transfers are not cash in the drawer. Transfers awaiting independent verification remain pending and are excluded from confirmed collections; voucher review alone is not independent payment confirmation.
- Show card gross and the 4.06% fee/net settlement separately in the payment-method summary. Do not subtract the card fee from physical drawer cash. The fee's rounding/settlement precision and adjustment rules need owner review before implementation.
- `Extra` means receptionist-provided cash/change entering the till; it increases expected physical cash but is not sales revenue. Waste is inventory-only and does not affect drawer cash. Received inventory must not be counted again as a shift expense merely because stock was recorded.
- The `Cerrar turno` action opens the dedicated T14 cash-count and handoff flow, which reuses existing cash denomination reconciliation (`closeShift`). Compare expected drawer cash with the counted/entered amount; do not invent a new closure policy or automatic approval/variance threshold. T14 specifies the proposed interaction and open decisions.
- Show activity and movement history by type, with timestamps and payment method/confirmation state where relevant. Separate sales, cash expenses, `Extra`, inventory-only waste/receipts, and other recorded shift events so their meanings and cash impact are not conflated. The exact grouping, ordering, and retention window remain open if not already defined by existing behavior.
- Keep the view usable and accessible under `Design.md` visual, responsive, keyboard, screen-reader, theme, and motion conventions. A simple payment summary does not require TanStack Charts; if a chart is retained, it must answer a useful comparison question better than clearly labeled totals and remain accessible.

**Acceptance criteria**

- [ ] The page uses the shared Reception shell and displays `Turno`, `Cerrar turno`, all three summary cards, payment-method collections, activity-by-sale-type, and shift movement history.
- [ ] The three cards are explicitly shift collections, cash outflows, and expected physical drawer cash rather than generic KPI labels.
- [ ] Expected cash follows the candidate formula: opening cash + confirmed cash collections + receptionist-funded `Extra` − actual cash expenses and confirmed cash refunds/returns, when recorded; pending policy/model details are identified for owner review.
- [ ] Only confirmed cash increases physical drawer cash; card/transfer receipts are excluded, pending transfers are not treated as confirmed, and card gross plus 4.06% fee/net settlement are shown separately.
- [ ] `Extra` is represented as a cash contribution, not revenue; waste is inventory-only; receiving stock does not create a duplicate shift expense.
- [ ] `Cerrar turno` reuses `closeShift` denomination reconciliation and compares the expected drawer amount with the counted cash without introducing a new closure/variance policy.
- [ ] Activity/history can distinguish movement type and timestamp and shows method or confirmation state when relevant; cash-affecting and inventory-only records are not conflated.
- [ ] Any chart has a justified analytical purpose beyond simple totals; the simpler labeled summary remains available and the presentation is accessible.
- [ ] The screen follows `Design.md` for responsive behavior, keyboard and screen-reader access, light/dark themes, and motion/visual treatment.

**Existing elements to reuse or adapt**

- `src/features/shifts/Shifts.tsx` — current shift summary and close-shift interface; CodeGraph confirms this path and the `closeShift` operation.
- `src/demo/shiftOperations.ts::shiftSummary` and `closeShift` — existing shift summary and denomination-count reconciliation; `shiftSummary` currently calculates expected drawer cash from opening cash plus cash receipts only, so new cash event semantics need owner-approved mapping before expanding it.
- `src/domain/models.ts::Shift`, `LedgerEvent`, and `PaymentMethod` — existing shift identity, ledger events, and payment-method concepts to reuse where their semantics fit.
- `src/demo/salesOperations.ts` and payment confirmation flows — sales, payment method, and confirmed/pending collection states; preserve the rule that transfer voucher review alone does not confirm payment.
- Relevant expense, receptionist-funded `Extra`, and inventory/stock models or operations from T04, T05, and T12 — reuse event semantics where available; do not duplicate received stock as an expense or count waste as cash.
- `src/shared/ui.tsx` and `Design.md` — shared layout/UI primitives, accessible interaction patterns, EGC tokens, themes, and motion conventions.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Shift scope and opening balance | Shift ID, receptionist/actor, opened time, opening cash, lifecycle/close time. | Reuse `Shift`; source for the receptionist's current shift and timezone/boundaries needs confirmation if not already established. |
| Shift ledger and activity | `LedgerEvent` or equivalent typed events with amount, method, actor, timestamp, shift association, confirmation state, and cash-impact classification. | Existing ledger concept is reusable; event coverage and cash semantics need mapping across sales, expenses, `Extra`, refunds, and inventory-only events. |
| Confirmed collections | Sales/payment records by cash, card, or transfer, with method-specific confirmation and settlement facts. | Count confirmed cash only; awaiting independent transfer verification remains pending/excluded. Exact independent verification rule remains open. |
| Card settlement | Card gross, 4.06% fee, net settlement, transaction/settlement reference, and currency rounding. | Display separately from drawer cash; fee rounding and reconciliation rules require owner review. |
| Cash expenses | Actual cash `Gasto` amount, category/reason, actor, time, and shift. | T04 captures unexpected cash expense flow; exact event/model linkage to `LedgerEvent` and authorization remain open. |
| Receptionist-funded `Extra` | Contribution amount, receptionist/actor, time, shift, and optional note/source. | T05 defines cash/change entering the till, not revenue; persistence and reconciliation/audit details remain open. |
| Refunds and returns | Confirmed cash refund/return amount and link to original sale/payment where applicable. | Include as drawer outflow only when recorded and confirmed; refund policy and existing model support need owner review. |
| Inventory-only events | Waste, received stock, sales-driven stock decrement, and any supplier-payment link. | Waste and stock receipts are not cash expenses on their own; do not double count stock received as a shift expense. |
| Cash reconciliation | Existing `closeShift` operation, denomination counts, counted cash, expected cash, variance, and close result. | Reuse existing reconciliation; do not add a new closure policy or threshold in this task. |
| History presentation | Typed event grouping, chronological order, timestamp localization, payment method, confirmation state, and display window. | Type/time/method/state requested; grouping, timezone, and retention window remain open where existing behavior does not decide them. |

### T14 — Count cash and hand off the shift

**Status:** Pending — design proposal for the `Cerrar turno` screen; count-mode behavior, provisional denomination policy, draft persistence, and discrepancy-note rules need owner review.

**User story**

As a receptionist, I want to count the cash in the drawer either denomination by denomination or by entering one total, review the difference from expected cash, and hand off the shift with observations, so that the next person receives a clear and traceable cash reconciliation.

**Design proposal — interaction, not implementation or schema decision**

- Clicking `Cerrar turno` from T13 opens a focused close/handoff screen in the shared application shell. Its hierarchy follows the supplied image: top actions/title (`Cerrar turno`, `Guardar borrador`, `Entregar turno`), a large `Conteo por denominación` area, a `Cuánto debe de haber en caja` summary card, and a bottom `Resumen de la entrega y observaciones` area.
- Use a clearly labeled two-option segmented control or equivalent switch: `Count denominations` and `Enter total`. Recommend denomination mode by default because the task is a physical cash count; direct-total mode is a quicker alternative. Keep the selected mode visible and make switching reversible before delivery.
- In denomination mode, list banknotes and coins separately. Each denomination row has a labeled quantity input, denomination value, row subtotal, and a live counted total. The current illustrative candidate list is MXN bills 1000, 500, 200, 100, 50, and 20, plus coins 10, 5, 2, 1, and 0.50. This list is provisional: existing demo comments explicitly say it is illustrative, not an approved cash policy; confirm denominations and smallest accepted unit with the gym before implementation.
- In direct-total mode, accept a nonnegative monetary total and show a clearly labeled `Suggested denomination equivalent`, decomposed largest-to-smallest against the current provisional list. Many combinations can produce the same total, so this is only a suggestion, not an observed physical count. Never save the generated breakdown as actual denomination observations or imply the receptionist verified those notes/coins. Persist direct-total mode and the entered amount only; allow an easy return to editable physical-count mode.
- Both modes show the T13 expected drawer balance, the actual counted/entered total, and the numeric difference with an explicit `Surplus` or `Shortage` label; use text as well as color. Expected cash includes only confirmed cash collections. Card commission and transfers stay separate from the physical till; unverified transfers remain excluded.
- `Guardar borrador` preserves partial denomination quantities or the direct-entered total, selected mode, and any observation without closing or delivering the shift. Draft state must not be mistaken for a completed reconciliation.
- `Entregar turno` first presents a confirmation summary with expected cash, counted cash, difference, count mode, and observations. On confirmation, invoke the existing `closeShift` denomination/reconciliation flow. Do not invent a variance threshold, block delivery solely because of a difference, or auto-approve the shift.
- Provide an observations field for handoff context. Notes are proposed as optional; whether a discrepancy should require a note is an open product decision. The screenshot requests observations but does not define a conditional requirement.
- Use restrained EGC Bento/clay styling, the shared responsive shell, and keyboard/screen-reader semantics. This transactional form does not need a chart or new UI dependency.
- This is a design proposal derived from the image and stated interaction. Draft lifecycle, count-mode persistence/audit details, denomination approval, and any discrepancy-note policy remain unresolved; no backend or schema change is authorized by this task.

**Acceptance criteria**

- [ ] Clicking T13 `Cerrar turno` opens the proposed handoff screen with title/actions, denomination-or-total input, expected-cash summary, and delivery/observations area.
- [ ] The labeled mode control defaults to physical denomination counting, can switch to direct-total entry, and preserves a clear distinction between observed and suggested values.
- [ ] Denomination mode displays separate banknote/coin inputs, row subtotals, and a live total; the illustrative MXN list is confirmed before implementation rather than treated as approved policy.
- [ ] Direct-total mode validates a nonnegative amount and may show a largest-to-smallest suggested equivalent; the suggestion is never persisted or presented as an observed denomination count.
- [ ] Both modes show expected cash, actual amount, and signed surplus/shortage in text and color; only confirmed cash enters expected drawer cash, with card/transfer amounts separate.
- [ ] Saving a draft preserves partial input, mode, and observations without closing or delivering the shift.
- [ ] Delivery presents a confirmation summary and, only after confirmation, reuses `closeShift` reconciliation; no new variance threshold, automatic approval, or difference-only delivery block is added.
- [ ] Observations are available; whether a discrepancy makes a note mandatory remains explicitly open until the owner decides.
- [ ] The form follows the existing responsive shell, keyboard and screen-reader semantics, and `Design.md` styling without adding a chart or dependency.

**Existing elements to reuse or adapt**

- `src/features/shifts/Shifts.tsx` — current close-shift entry point; `src/demo/shiftOperations.ts::closeShift` owns reconciliation and its transaction boundary.
- `src/demo/cashDenominations.ts` — current illustrative denomination set and denomination helpers; its comments state that the set is illustrative, not an approved cash policy.
- `src/domain/models.ts::Shift` — current `countedCashMinor`, `cashDenominations`, `expectedCashAtCloseMinor`, and `cashDifferenceMinor` fields are reuse candidates, not a decided persistence contract.
- `src/shared/ui.tsx` and `Design.md` — shared form, panel, button, responsive, accessibility, theme, and EGC visual conventions.
- T13 shift summary and payment confirmation rules — expected drawer cash is based on confirmed cash only; card commission and transfers remain outside the physical till.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Count mode and value | Selected mode (`denominations` or `direct-total`), counted total, currency precision. | Two modes proposed; representation and draft persistence need owner/backend review. |
| Observed denomination count | Denomination identifier/value and physically observed quantity. | Store only when the receptionist actually counted denominations; a direct-total suggestion must not fabricate observations. |
| Suggested decomposition | Derived largest-to-smallest denomination quantities from direct-entered total and a provisional denomination list. | Presentation-only proposal; non-unique decomposition and provisional list must be disclosed. |
| Draft handoff | Shift ID, partial input, selected mode, observations, draft state, actor, and updated time. | Draft action required by sketch; persistence lifecycle, expiry, and edit/resume rules open. |
| Reconciliation | Expected drawer cash, actual counted/entered total, signed difference, close result, actor/time, and existing `closeShift` operation. | Reuse current Shift fields/operation where applicable; no new close policy or schema decided. |
| Expected cash sources | Confirmed cash collections and cash movements already defined by T13; card fee/settlement and transfers kept separate. | Only confirmed cash belongs in expected physical drawer balance. |
| Handoff observations | Optional observation text associated with the shift close/handoff and author/time. | Field proposed; discrepancy-required-note policy and audit/edit rules remain open. |
| Denomination policy | Approved currency denominations, coin/bill set, smallest accepted unit, and decomposition order. | Current demo list is illustrative only and requires confirmation by the gym. |

**Open decisions for owner review**

- Confirm the valid MXN denominations and minimum unit; the demo list is not an approved cash-handling policy.
- Confirm whether drafts must persist across devices/sessions and who may resume or edit them.
- Confirm whether a non-zero discrepancy requires a note; do not impose this rule before approval.
- Confirm whether final delivery remains a single close action in existing `closeShift` or has a distinct handoff state; this proposal assumes current close behavior is reused after confirmation.

### T15 — Monitor business status and operational alerts

**Status:** Pending — the proposed Admin dashboard wireframe was approved as the initial baseline; KPIs and chart selection may be adjusted after client feedback.

**User story**

As an Admin, I want a visual overview of the business and the operational events that need review, so that I can understand today's status quickly and follow up on receptionist activity without duplicating the Reception workspace.

**Details and rules**

- Use the approved dashboard wireframe as the starting layout: Admin navigation, period selector, a compact KPI row, useful charts, actionable alerts, and today's shift status.
- Initial KPI proposal: recorded income, expected physical cash, active members, and today's attendance. Treat these as a practical baseline, not immutable metrics; adjust if the client needs a different summary.
- Initial chart proposal: income trend across the selected period and collections by payment method. Keep a visualization only when it makes comparison or trend-reading easier than labeled values; do not add charts for decoration.
- Keep card gross, its 4.06% commission/net settlement, transfer collections, and physical cash distinguishable. Card and transfer amounts must not inflate expected drawer cash; pending transfers remain unconfirmed.
- Surface events that may need Admin attention, including cash-close discrepancies, recorded waste, and extraordinary expenses. Each alert should lead to its relevant detail; alert resolution policy, acknowledgement, and notification channel remain open.
- Show current/recent shift status as operational context, without conflating shift cash with business revenue or inventory-only movements.
- Match the approved EvoGym visual direction in `Design.md`: Bento layout, more visible but controlled clay depth, brand orange, light/dark themes, coherent motion, and charts only where useful.
- Values in the reviewed wireframe are illustrative only. The period definition, comparison baseline, refresh behavior, alert prioritization, and exact report/metric formulas require review with the client.

**Acceptance criteria**

- [ ] Admin can review the business overview for a selected period and quickly read each displayed KPI's label, value, unit, and comparison context when available.
- [ ] The initial dashboard includes the proposed income, expected-cash, active-member, and attendance indicators, subject to client review.
- [ ] Income trend and payment-method comparison are shown only when their data is available and the chart improves interpretation over plain totals.
- [ ] Cash expected, card fees/net settlement, and transfers are presented as distinct concepts; unconfirmed transfers and non-cash collections do not count as drawer cash.
- [ ] Discrepancy, waste, and extraordinary-expense alerts identify their type and provide a path to inspect the underlying record; no unapproved alert-resolution policy is implied.
- [ ] Shift status is available as context, with business totals and shift cash clearly distinguished.
- [ ] The page follows `Design.md` for responsive layout, accessible labels, light/dark presentation, and restrained motion.

**Existing elements to reuse or adapt**

- T13 shift summary and T14 cash handoff — reuse their distinction between confirmed cash, non-cash collections, card fee/net settlement, and cash movements.
- T03 sales, T04 expenses, T05 receptionist-funded `Extra`, and T12 inventory — reuse their event semantics when forming summaries and alerts; do not count waste or stock receipt as cash movement by itself.
- T09/T11 member and attendance concepts — reuse active-membership and attendance sources once their definitions and date boundaries are confirmed.
- Existing application shell, navigation, shared components, and `Design.md` — retain the shared visual language and avoid implementing a separate copy of Reception workflows.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Overview period | Selected date/range, timezone, comparison range, refresh timestamp. | Period selector proposed; date boundaries and comparison behavior need client review. |
| Business totals | Confirmed sales by payment method, gross card amount, commission, net settlement, and confirmed transfers. | Sources span T03/T10/T13; formulas and final metric definitions require consolidation. |
| Drawer cash | Opening balance, confirmed cash receipts, cash expenses, receptionist-funded `Extra`, and confirmed cash returns. | Reuse T13/T14 cash semantics; never infer drawer cash from total business income. |
| Membership and attendance | Active membership state and attendance counts within the selected period. | T09/T10/T11 capture the concepts; status boundary, timezone, and period semantics remain to be confirmed. |
| Operational alerts | Alert kind, source record/shift, amount or impact, actor, timestamp, review state, and destination detail. | Discrepancy, waste, and expense sources are planned; acknowledgement, persistence, priority, and notification channel remain open. |
| Shift status | Shift identifier, receptionist, lifecycle state, opening/closing times, and reconciliation outcome. | Reuse T13/T14 mapping; cross-shift history and period grouping still need review. |

### T16 — Review operational alerts and flagged movements

**Status:** Pending — the proposed Admin alert-center wireframe was approved as a screen direction; alert priority, acknowledgement/resolution lifecycle, and notification behavior remain open.

**User story**

As an Admin, I want to inspect operational events that may need follow-up, including cash discrepancies, waste, and extraordinary expenses, so that I can understand what happened and open the source record without confusing the different business impacts.

**Details and rules**

- Use the approved wireframe as the initial layout: period selector, small summary of items to review, type filters, a selectable alert list, and a detail pane for the selected event.
- Proposed event types include a shift-close cash difference, recorded inventory waste, and an extraordinary cash expense. Add other types only after the business identifies them.
- Each list item should identify the event, responsible receptionist, timestamp/shift, relevant amount or inventory value, and review state when one exists. Values in the approved sketch are illustrative only.
- The detail pane should summarize the source facts and provide a direct path to the originating record (for example, opening the shift close for a cash difference). Do not create a separate edit path that could diverge from the source record.
- Preserve distinct semantics: cash difference compares expected and counted drawer cash; waste is inventory-only though its product value may be shown; an extraordinary expense is a cash outflow as recorded in T04. Do not combine them into one financial total.
- The reviewed wireframe uses a `Pendiente`/`Requiere revisión` label, but the transitions, acknowledgement/resolution action, severity/priority rules, escalation, and notification channel remain unresolved. Do not imply that opening a record resolves an alert.
- Keep period and type filtering simple and useful; exact date boundaries and alert retention remain open for consolidation.
- Follow `Design.md` for the shared Admin shell, EGC brand, responsive Bento/clay surfaces, accessible selection, and restrained coherent motion.

**Acceptance criteria**

- [ ] Admin can review a period-scoped list and summary of flagged operational events, with event type, actor, time/shift, and relevant amount/value visible.
- [ ] Selecting an event presents its source context and a navigation action to the originating shift close, waste record, or expense record.
- [ ] Cash discrepancies, waste value, and actual cash expenses are shown as distinct facts and are not added together as if they had the same accounting effect.
- [ ] The initial view can filter by event type and period without hiding the currently selected event's source context.
- [ ] Review state is shown only as currently defined by available data; opening a source record does not silently mark an item resolved.
- [ ] No acknowledgement, resolution, escalation, priority, or notification workflow is introduced before the owner/client defines it.
- [ ] The screen follows `Design.md` for responsive layout, keyboard/screen-reader support, light/dark themes, and motion.

**Existing elements to reuse or adapt**

- T13 shift summary and T14 cash handoff — reuse expected-versus-counted cash facts and the existing distinction between confirmed drawer cash and other payment methods.
- T03 waste records, T04 extraordinary cash expenses, and T12 inventory receipts — reuse source-record meanings; keep inventory-only value separate from cash flow.
- Existing application shell, navigation, shared components, and `Design.md` — preserve the same Admin/Reception visual and interaction foundation.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Flagged event source | Source type and ID, shift/member/product context where relevant, responsible actor, timestamp, amount/value, and source status. | Candidate links to T03, T04, T12, T13, and T14; not a separate schema decision. |
| Cash discrepancy | Expected cash, counted cash, signed difference, shift, and close observations. | T14 supplies candidate facts; alert threshold/creation policy is unresolved and must not be invented. |
| Waste | Product, quantity, inventory value, reason/comment, actor, and shift/time. | T03 waste flow is planned; inventory value is not drawer cash. |
| Extraordinary expense | Amount, concept, reason, actor, time/shift, and cash impact. | T04 records an unexpected cash outflow; authorization and source event linkage remain open. |
| Review lifecycle | Current review state, reviewer, reviewed time, resolution, and follow-up. | The wireframe labels items pending, but acknowledgement and resolution transitions are not defined. |
| Filtering/history | Period boundaries, event-type filter, retention, sorting, and access permissions. | Simple period/type filters proposed; timezone, retention, and permissions need consolidation. |

### T17 — Review and export expense reports

**Status:** Pending — the proposed Admin expense-report screen was approved as the initial direction; report retention, snapshot behavior, export detail, and access rules remain open.

**User story**

As an Admin, I want to review expenses by week or month, inspect their movements, and export a PDF report, so that I can monitor cash outflows and retain a usable report for business records.

**Details and rules**

- Follow the reviewed wireframe: weekly/monthly range control, expense totals and movement count, a trend/category visualization where useful, an itemized movement table, PDF export, and a saved-reports area.
- Treat totals as actual expenses recorded for the selected period. Do not merge receptionist-funded `Extra`, inventory waste, or stock receipts into expenses; they have distinct operational/accounting meanings in T03–T05 and T12.
- The report should show date, concept, amount, responsible staff member, and shift when available; filters and sort order can be refined with the client.
- TanStack Charts may be used for the trend/category view if it materially improves reading; retain an accessible tabular alternative and avoid charts for sparse or trivial data.
- PDF export should reflect the selected report period and displayed records. Whether exports are generated on demand or persisted as immutable snapshots, and the retention/access policy, are unresolved.
- Values in the wireframe are illustrative only. Follow `Design.md` for the EGC brand, Bento/clay surfaces, responsive behavior, light/dark themes, and coherent restrained motion.

**Acceptance criteria**

- [ ] Admin can switch between weekly and monthly expense views and see the selected date range clearly.
- [ ] Summary totals and movement count match the expense records included in the selected range.
- [ ] Admin can inspect individual expense records with concept, amount, date, actor, and shift context when available.
- [ ] PDF export represents the same selected period and expense records shown in the report.
- [ ] Saved reports are discoverable from the screen, without implying a retention or immutable-snapshot policy until defined.
- [ ] Expenses remain distinct from `Extra`, waste value, and inventory receipts; no unsupported financial aggregation is introduced.
- [ ] The visualization is optional when not useful and includes a non-visual/table-based path for the same information.
- [ ] The page follows `Design.md` for responsive accessible layout and light/dark themes.

**Existing elements to reuse or adapt**

- T04 expense registration/history — reuse recorded expense concepts, amounts, actors, and shift context as source records.
- T05 receptionist-funded `Extra`, T03 waste, T12 inventory receiving — preserve boundaries and exclude these from expense totals unless a later business rule explicitly changes the accounting model.
- T13/T14 shift summaries and cash handoff — reuse cash context without treating report totals as drawer reconciliation.
- Existing application shell, shared components, `Design.md`, and TanStack chart conventions if already established — keep a single visual and data-reading language.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Report period | Period kind, start/end boundaries, timezone, and generation timestamp. | Weekly/monthly controls proposed; boundary and timezone rules need confirmation. |
| Expense records | Amount, concept/category, actor, timestamp, shift, and source record. | Reuse T04; category taxonomy and correction/deletion rules remain open. |
| Aggregation | Included expense records, totals, counts, and optional grouping by period/category. | Must exclude `Extra`, waste, and inventory receipts absent an explicit rule. |
| PDF generation | Selected range, report contents, formatting, and generated artifact. | Export requested; on-demand vs stored output and required detail remain open. |
| Saved report history | Report identifier, range, creation time, creator, and artifact location/status. | Saved reports requested; retention, immutability, and access policy are unresolved. |
### T18 — Manage products and analyze inventory

**Status:** Pending — the Admin inventory-management and analysis screen direction was approved; metric definitions, product deactivation effects, and inventory thresholds remain open.

**User story**

As an Admin, I want to analyze product sales and inventory signals and manage the product catalog, so that I can understand what sells, maintain accurate product details and prices, and stop offering products that are no longer active.

**Details and rules**

- Use the approved wireframe as the initial layout: a sales/inventory insight area above a searchable, sortable product catalog, with actions to create a product and edit, deactivate, or reactivate an existing product.
- Show a clearly selected analysis period. The mockup uses the last 30 days as an illustrative default; confirm the default period, date boundaries, timezone, and any comparison period before implementation.
- Present top sellers by units sold and/or revenue as distinct measures. Do not label one ranking as the other. Other useful candidate signals include products with no sales in the selected period and current stock relative to sales in that same period.
- A low-stock or restock warning requires a defined product-level threshold or an agreed rule. Do not infer a stock alert solely from an arbitrary sample number.
- The product form may reuse T12's name, image, purchase/unit cost, sale price, and category concepts; exact editable fields and role/approval policy still need confirmation. The owner explicitly wants Admin product creation and editing, including prices.
- Stock receiving and stock adjustments remain auditable movements handled by T12; editing product details must not silently overwrite the quantity or movement history. A new product's opening quantity must retain T12's traceable opening-stock semantics.
- Deactivating a product should preserve its historical sales and stock records. Whether inactive products disappear from Reception sales, how remaining stock is handled, who may reactivate, and whether changes require approval/audit are still open.
- Keep supplement servings (T07) distinct from whole-unit product sales unless the owner defines an aggregate measure. Do not combine glove rentals (T06) with product sales by default.
- Treat all values in the mockup as illustrative. Follow `Design.md` for the shared Admin shell, EvoGym palette, Bento layout, clay depth, light/dark themes, responsive layout, accessibility, and restrained coherent motion.

**Acceptance criteria**

- [ ] Admin can view the product catalog and create a product, edit approved product fields and prices, and activate/deactivate a product.
- [ ] Deactivation preserves existing sales and stock movement history; behavior for remaining stock and Reception visibility is defined before implementation.
- [ ] Admin can select an analysis period and inspect top sellers with the metric (units or revenue) labeled clearly.
- [ ] The analysis can surface products with no sales in the selected period and current-stock context without claiming an undefined low-stock threshold.
- [ ] Sales rankings and insights use traceable T03 sales data and T12 stock data; supplements and glove rentals remain separate unless an explicit aggregation rule is approved.
- [ ] Product-detail changes do not mutate stock or erase historical values; stock quantity changes continue through auditable T12 movements.
- [ ] Charts are used only when clearer than a table, remain accessible, and provide an equivalent readable data view.
- [ ] The screen follows `Design.md` in both themes, with accessible controls and responsive behavior.

**Existing elements to reuse or adapt**

- T12 inventory catalog/product creation and stock receiving — reuse product fields, images, stock movement provenance, and receipt history; keep catalog editing distinct from stock movement.
- T03 standard product sales — reuse completed sale lines and amounts for product rankings; respect void/refund semantics once defined.
- T07 supplement serving sales and T06 glove rentals — preserve separate units and service semantics; include only under an approved aggregate rule.
- Existing application shell, shared UI, `Design.md`, and `odd/previews/admin-inventory-management.html` — use the reviewed screen direction, not a second visual system.

**Progressive backend/data mapping — candidate, not schema**

| Concern | Data or operation to account for | State |
|---|---|---|
| Product catalog | Product ID, name, category, image/source, cost, sale price, and active state. | T12 captures catalog creation; Admin edit/deactivation actions approved here; field requirements and lifecycle policy remain open. |
| Product changes | Actor, timestamp, changed fields, prior/new values, and optional approval/audit state. | Admin editing is in scope; audit depth, approval, and price-history needs need confirmation. |
| Stock | Current quantity derived from opening balance and stock movements; optional reorder threshold. | Reuse T12 movement semantics; no stock-count editing through catalog details; threshold is undefined. |
| Sales analysis | Period, timezone, completed product sale lines, quantity, gross amount, refunds/voids, and aggregation key. | T03 is the standard-product source; sale cancellation/refund treatment and period boundaries remain open. |
| Insights | Ranking metric, selected period, current stock context, no-sales state, and optional threshold comparison. | Top seller and useful insights requested; definitions and thresholds require owner review. |
| Product lifecycle | Active/inactive state, deactivation actor/time/reason, history retention, reactivation, and handling of remaining stock. | Deactivation requested; visibility, reason, stock disposition, and audit behavior remain unresolved. |

## Consolidation gate

After the user has described the intended screens and reviewed their stories, consolidate the cross-screen map into entities, relationships, state transitions, operations, permissions, persistence needs, and unresolved questions. Review that map before proposing the production backend architecture or database schema. No schema is decided by this document.

## Progress and next step

- Completed: captured T01 and T02 from the first-screen sketch and user description; captured T03 from the Reception home sketch and workflow description; captured T04 unexpected cash expenses, T05 receptionist-funded change, T06 glove rentals/returns, T07 scoop-based supplement sales, T08 monthly locker management, T09 member directory/search, T10 membership/sample/visit registration, T11 member profile, T12 inventory/product creation and stock receipt, T13 current-shift summary/reconciliation, T14 cash count/shift handoff proposal, T15 the approved initial Admin business-overview dashboard baseline, and T16 the approved initial Admin alert-review screen direction, plus T17 the approved initial Admin expense-report screen direction and T18 the approved initial Admin inventory-management/analysis screen direction.
- Pending: receive further screen diagrams; clarify the credential prompt/no-credential transition, Admin-to-`OWNER` naming, profile fields, header shift/time source, membership status boundary, sort periods, card-fee rounding/settlement, independent transfer verification, expense/extra event modeling and authorization, cash-refund rules, glove rental pricing/exception, supplement serving/stock conversion, locker status/expiry transitions, membership-vs-type columns, student eligibility proof, anonymous visit record requirements, membership profile/heatmap periods and timezone, explicit unpaid-sale/credit semantics, preferred-payment update rule, member-note permissions/retention, product cost valuation method, sale-price changes during T12 stock receipt and price-history/audit rules, stock valuation and receipt-cost handling, shift-history grouping/timezone/retention, approved cash denominations/minimum unit, draft persistence/resume rules, discrepancy-note policy, Admin dashboard metric definitions and period comparisons, alert prioritization/acknowledgement/notification behavior, expense-report snapshot/retention/PDF detail policies, employee-profile deactivation/credential reset rules, and T18 analysis periods, aggregation definitions, stock thresholds, and product deactivation behavior.
- Implementation: not started or authorized by this planning document.

## Relevant files

- `Design.md` — visual and interaction contract.
- `Logo_Evo.png` — supplied brand asset.
- `src/app/App.tsx` — current demo profile entry and role landing navigation.
- `src/app/navigation.ts` — current role-based routes.
- `src/domain/models.ts` — current `Role` and demo domain types.
- `src/features/inventory/Inventory.tsx` and `src/demo/inventoryOperations.ts` — current inventory/count interface and quantity movement operations to adapt for product catalog and stock receiving.
- `src/features/shifts/Shifts.tsx`, `src/demo/cashDenominations.ts`, `src/demo/shiftOperations.ts`, and `src/domain/models.ts` — current shift summary, `closeShift`, illustrative denominations, and `Shift` reconciliation fields relevant to T13/T14; no schema change is decided.
- `src/shared/ui.tsx` — reusable UI primitives including `Button`.
- `odd/previews/admin-inventory-management.html` — approved initial wireframe for Admin catalog management and inventory insights.
