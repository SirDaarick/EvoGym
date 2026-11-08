import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney, parseMoney } from '@/shared/formatters/money';
import { depositMemberCredit, listMemberCreditMovements, type MemberCreditMovement } from '../../api/memberCreditApi';
import { getRegisters, type AuthenticatedRequest, type CheckoutRegister } from '../../api/membershipCheckoutApi';
import { Button, EmptyState, Field, Modal, Notice, Panel, TableRegion } from '../../shared/ui';

const PAGE_SIZE = 20;
const KIND_LABELS: Record<MemberCreditMovement['kind'], string> = { deposit: 'Depósito', apply: 'Aplicado en compra/abono' };
const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });

interface Props {
  memberId: string;
  memberName: string;
  creditMinor: number;
  /** Debt amount; null when the projection hides it (receptionists). */
  pendingMinor: number | null;
  hasPendingBalance: boolean;
  apiRequest: AuthenticatedRequest;
  onRefresh?: () => void;
}

function registerLabel(register: CheckoutRegister) {
  return typeof register.name === 'string' && register.name ? register.name : register.id;
}

function DepositModal({ memberId, memberName, apiRequest, onClose, onDone }: {
  memberId: string; memberName: string; apiRequest: AuthenticatedRequest; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [registers, setRegisters] = useState<CheckoutRegister[] | null>(null);
  const [registerId, setRegisterId] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getRegisters(apiRequest)
      .then(items => {
        if (cancelled) return;
        const open = items.filter(item => item.has_open_shift);
        setRegisters(open);
        if (open.length === 1) setRegisterId(open[0].id);
      })
      .catch(reason => {
        if (cancelled) return;
        setRegisters([]);
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las cajas.');
      });
    return () => { cancelled = true; };
  }, [apiRequest]);

  const amountMinor = parseMoney(amount);
  const amountInvalid = amount.trim() !== '' && (amountMinor === null || amountMinor <= 0);
  const canSubmit = amountMinor !== null && amountMinor > 0 && Boolean(registerId) && !submitting;

  async function submit() {
    if (!canSubmit || amountMinor === null || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    // The key is stable per (register, amount) so a retry after a network failure replays instead of duplicating.
    const fingerprint = `${registerId}:${amountMinor}`;
    if (attemptRef.current?.fingerprint !== fingerprint) attemptRef.current = { fingerprint, key: `credit-deposit-${crypto.randomUUID()}` };
    try {
      await depositMemberCredit(apiRequest, registerId, { member_id: memberId, amount_minor: amountMinor }, attemptRef.current.key);
      attemptRef.current = null;
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo registrar el saldo a favor.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Agregar saldo a favor"
      isSubmitting={submitting}
      actions={<>
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Button>
        <Button type="submit" form="member-credit-deposit-form" disabled={!canSubmit}>{submitting ? 'Guardando…' : 'Agregar saldo'}</Button>
      </>}
    >
      <form id="member-credit-deposit-form" className="flow" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <p>Efectivo recibido de {memberName}. Se registra en el turno abierto de la caja elegida.</p>
        <Field
          id="member-credit-amount"
          label="Monto en pesos"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          error={amountInvalid ? 'Captura un monto mayor a cero con máximo 2 decimales.' : undefined}
        />
        {registers === null ? <p role="status">Cargando cajas…</p> : registers.length === 0 ? (
          <Notice tone="warning">No hay una caja con turno abierto. Abre un turno para agregar saldo a favor.</Notice>
        ) : (
          <div className="field">
            <label htmlFor="member-credit-register">Caja</label>
            <select id="member-credit-register" value={registerId} onChange={event => setRegisterId(event.target.value)}>
              {registers.length > 1 && <option value="">Selecciona una caja</option>}
              {registers.map(register => <option key={register.id} value={register.id}>{registerLabel(register)}</option>)}
            </select>
          </div>
        )}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </form>
    </Modal>
  );
}

export function MemberCreditPanel({ memberId, memberName, creditMinor, pendingMinor, hasPendingBalance, apiRequest, onRefresh }: Props) {
  const [depositOpen, setDepositOpen] = useState(false);
  const [items, setItems] = useState<MemberCreditMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPage = useCallback(async (offset: number) => {
    setLoading(true);
    setError('');
    try {
      const page = await listMemberCreditMovements(apiRequest, memberId, offset, PAGE_SIZE);
      const pageItems = Array.isArray(page?.items) ? page.items : [];
      setItems(prev => (offset === 0 ? pageItems : [...prev, ...pageItems]));
      setTotal(page?.total_items ?? 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los movimientos de saldo.');
    } finally {
      setLoading(false);
    }
  }, [apiRequest, memberId]);

  useEffect(() => { void loadPage(0); }, [loadPage]);

  const debtText = pendingMinor !== null ? formatMoney(pendingMinor) : hasPendingBalance ? 'Con saldo pendiente' : 'Sin saldo pendiente';

  return (
    <Panel>
      <section aria-labelledby="member-credit-heading" className="flow">
        <h2 id="member-credit-heading">Balance del socio</h2>
        <dl className="member-balance-grid">
          <div><dt>Deuda pendiente</dt><dd>{debtText}</dd></div>
          <div><dt>Saldo a favor</dt><dd>{formatMoney(creditMinor)}</dd></div>
        </dl>
        <Button type="button" variant="secondary" onClick={() => setDepositOpen(true)}>Agregar saldo a favor</Button>
        <h3>Movimientos de saldo</h3>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {items.length === 0 && !loading && !error ? (
          <EmptyState title="Sin movimientos de saldo">Aún no hay depósitos ni aplicaciones de saldo a favor.</EmptyState>
        ) : items.length > 0 ? (
          <TableRegion label="Movimientos de saldo">
            <table className="member-detail-table">
              <thead><tr><th scope="col">Fecha</th><th scope="col">Tipo</th><th scope="col">Monto</th><th scope="col">Saldo posterior</th></tr></thead>
              <tbody>{items.map(item => (
                <tr key={item.id}>
                  <td>{dateFormat.format(new Date(item.created_at))}</td>
                  <td>{KIND_LABELS[item.kind] ?? item.kind}</td>
                  <td>{item.kind === 'apply' ? '−' : '+'}{formatMoney(item.amount_minor)} MXN</td>
                  <td>{formatMoney(item.balance_after_minor)} MXN</td>
                </tr>
              ))}</tbody>
            </table>
          </TableRegion>
        ) : null}
        {loading && <p role="status">Cargando movimientos…</p>}
        {items.length < total && !loading && <Button type="button" variant="secondary" onClick={() => void loadPage(items.length)}>Cargar más</Button>}
      </section>
      {depositOpen && (
        <DepositModal
          memberId={memberId}
          memberName={memberName}
          apiRequest={apiRequest}
          onClose={() => setDepositOpen(false)}
          onDone={() => { setDepositOpen(false); onRefresh?.(); void loadPage(0); }}
        />
      )}
    </Panel>
  );
}
