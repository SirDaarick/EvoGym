# Member credit wallet (saldo a favor)
Objective: one monetary wallet per member, deposited from the profile or from overpayment change, applied to any payment via a tick in Compra actual.
Branch: integration/frontend-design · Delivery: ask-on-risk · Runner: `pytest` (api), `vitest` (frontend)

## Specs
S1. "le gustaria que tambien existiera un saldo a favor" — one wallet per member (`members.credit_balance_minor`), separate from debts, never negative.
S2. "si una persona hace un pago de un producto y paga mas de lo que deberia, pues ese saldo se ponga a favor" — overpayment in cash can be left as saldo a favor instead of change (member assigned only).
S3. "en el perfil pues haya un boton para agregar saldo a favor" — profile button "Agregar saldo a favor" (cash deposit on an open shift).
S4. "al momento de pagar, pues haya como un tick o algo asi que diga, pagar con saldo a favor ... dentro del componente de Compra actual, pues eso se podria aplicar a cualquier pago dentro de la aplicacion" — tick in `CurrentPurchaseCard`, works for membership, product and rental payments, and debt abonos.
S5. "dentro de la vista de un cliente poder visualizar un balance de su deuda y saldo a favor" — member view shows debt balance and saldo a favor.
S6. "el saldo a favor no se tiene que incluir en los metodos de pago ... si tiene saldo a favor lo mencione como saldo a favor: tanto, y ahi aparezca el tick de usarlo, pero si no lo tiene pues no mostrarlo" — not a method tile; line "Saldo a favor: $X" + tick, hidden when balance is 0 or no member.
S7. (accounting, derived) Deposit = cash in drawer but liability, not sales. Application = income, no cash movement.

## Tasks
- [x] T1 (S1,S3,S7) ledger table + migration + `app/credit` helper + deposit endpoint + shift cash summary + movements read — inline. Evidence: `tests/test_member_credit.py` 4 passed (written after the code, no RED observed); regression `test_shifts/test_sales/test_owner_overview/test_pending_money/test_member_reads/test_contract_smoke/test_migrations` green after updating head/table lists. Risk: item 1 (new migration, persisted money format) + item 4 (balance under concurrent writes; relies on member `FOR UPDATE`, Postgres concurrency test pending in T3).
- [ ] T2 (S4,S7) credit in debt abonos (`source` column) — inline
- [ ] T3 (S2,S4) credit + change-to-credit in membership, product, rental payments — inline
- [ ] T4 (S2-S6) frontend: Compra actual tick + change choice, callers, profile balance card/button/movements — inline

## Log
L1 (2026-11-07) Hola, ayudame estuve platicando con el cliente, dueño del gimnasio ... le gustaria que tambien existiera un saldo a favor, ya que muchas veces hay clientes que por ejemplo, al inicio de la semana dejan pagadas unas 3 o 4 aguas para toda la semana, o hay veces que durante el mes, estan dejando dinero para despues pagar la siguiente membresia, o pagan y dicen que dejen de mas para saldo a favor, entonces sean como apartados distintos para que cuando haya una deuda o una venta se pueda cubrir con ese saldo a favor, como podriamos manejarlo?
L2 Decision: one monetary wallet (not earmarked buckets).
L3 Plan approved; detail in `C:\Users\edani\.claude\plans\hola-ayudame-estuve-platicando-floating-nebula.md`.
