import { useState } from 'react';
import { formatMoney, parseMoney } from '@/shared/formatters/money';
import { Button, Field } from '@/shared/ui';
import { Dialog } from '@/shared/components/ui';
import type { PayrollDialogState, PayrollSubmission } from './usePayroll';

interface Props {
  dialog: PayrollDialogState;
  currentWeekStart: string;
  busy: boolean;
  serverError: string;
  onSubmit: (submission: PayrollSubmission) => void;
  onClose: () => void;
}

function titleFor(dialog: PayrollDialogState, currentWeekStart: string): string {
  const prefix = dialog.mode === 'advance'
    ? (dialog.targetWeek !== currentWeekStart ? 'Adelanto próxima semana a ' : 'Adelantar a ')
    : 'Pagar a ';
  return `${prefix}${dialog.item.full_name}`;
}

export function PayrollDialog({ dialog, currentWeekStart, busy, serverError, onSubmit, onClose }: Props) {
  const { item } = dialog;
  const [advanceText, setAdvanceText] = useState('');
  const [nextWeekText, setNextWeekText] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<'cash' | 'transfer'>('transfer');
  const [amountError, setAmountError] = useState('');
  const [nextError, setNextError] = useState('');

  function submit() {
    const amount = parseMoney(advanceText);
    const nextAdvance = parseMoney(nextWeekText);
    setAmountError('');
    setNextError('');
    if (dialog.mode === 'advance') {
      const maxAllowed = dialog.targetWeek === currentWeekStart ? item.net_minor : item.base_minor;
      if (amount === null || amount <= 0 || amount > maxAllowed) {
        setAmountError('Ingresa un adelanto válido que no supere el límite permitido.');
        return;
      }
    } else if (nextAdvance !== null && (nextAdvance <= 0 || nextAdvance > item.base_minor)) {
      setNextError('El adelanto de próxima semana no puede superar la base semanal.');
      return;
    }
    onSubmit({ dialog, amountMinor: amount, nextAdvanceMinor: nextAdvance, notes: notes.trim(), method });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      hideCloseButton
      title={titleFor(dialog, currentWeekStart)}
      description={`Referencia diaria: ${formatMoney(item.daily_minor)}`}
      footer={<>
        <Button disabled={busy} onClick={submit}>Confirmar</Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Cerrar</Button>
      </>}
    >
      {dialog.mode === 'advance' ? <>
        {dialog.targetWeek !== currentWeekStart && <p className="badge badge-neutral">Semana del {dialog.targetWeek}</p>}
        <Field id="payroll-amount" label="Importe" value={advanceText} error={amountError} disabled={busy}
          onChange={event => setAdvanceText(event.target.value)} />
        <Button variant="secondary" disabled={busy} onClick={() => setAdvanceText((item.daily_minor / 100).toFixed(2))}>
          1 día ({formatMoney(item.daily_minor)})
        </Button>
        <Field id="payroll-notes" label="Notas opcionales" value={notes} maxLength={255} disabled={busy}
          onChange={event => setNotes(event.target.value)} />
      </> : <>
        <p>Base: {formatMoney(item.base_minor)}</p>
        <p>Adelantos: −{formatMoney(item.advances_minor)}</p>
        <p>Neto a liquidar: {formatMoney(item.net_minor)}</p>
        <div className="field">
          <label htmlFor="payroll-method">Método de pago</label>
          <select id="payroll-method" value={method} disabled={busy} onChange={event => setMethod(event.target.value as 'cash' | 'transfer')}>
            <option value="transfer">Transferencia</option>
            <option value="cash">Efectivo</option>
          </select>
        </div>
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
          <Field id="payroll-next-advance" label="+ Adelanto próxima semana (opcional)" placeholder="0.00" value={nextWeekText}
            error={nextError} disabled={busy} onChange={event => setNextWeekText(event.target.value)} />
          <span className="muted" style={{ fontSize: '0.82rem', display: 'block', marginTop: '4px' }}>
            Si el personal solicita un anticipo al cobrar su semana, se deducirá del siguiente periodo.
          </span>
        </div>
      </>}
      {serverError && <p role="alert">{serverError}</p>}
    </Dialog>
  );
}
