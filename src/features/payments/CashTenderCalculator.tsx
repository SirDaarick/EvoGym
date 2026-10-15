import { parseMoney, formatMoney } from '../../demo/adapter';
import { Button } from '../../shared/ui';
import './CashTenderCalculator.css';

interface CashTenderCalculatorProps {
  totalMinor: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  inputId?: string;
}

export function CashTenderCalculator({ totalMinor, value, onChange, disabled = false, inputId = 'cash-tendered-input' }: CashTenderCalculatorProps) {
  const tenderedMinor = value ? parseMoney(value) : null;
  const changeMinor = tenderedMinor === null ? null : tenderedMinor - totalMinor;

  return <div className="cash-tender-card">
    <div className="field">
      <label htmlFor={inputId}>Monto recibido</label>
      <div className="cash-tender-input-row">
        <input id={inputId} type="text" inputMode="decimal" placeholder="0.00" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
        <Button type="button" variant="secondary" className="button-sm" disabled={disabled || totalMinor <= 0} onClick={() => onChange((totalMinor / 100).toFixed(2))}>Pago exacto</Button>
      </div>
    </div>
    <div className="cash-change-result">
      <span>Cambio a devolver:</span>
      <strong>{changeMinor !== null && changeMinor >= 0 ? `${formatMoney(changeMinor)} MXN` : value && changeMinor === null ? 'Monto inválido' : changeMinor !== null ? 'Monto insuficiente' : '$0.00 MXN'}</strong>
    </div>
    {changeMinor !== null && changeMinor < 0 && <span className="cash-tender-shortfall" role="alert">Faltan {formatMoney(Math.abs(changeMinor))} MXN.</span>}
  </div>;
}
