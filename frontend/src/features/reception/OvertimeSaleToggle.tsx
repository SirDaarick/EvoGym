import { useMemo } from 'react';
import './OvertimeSaleToggle.css';

export interface OvertimeSaleToggleProps {
  isOvertime?: boolean;
  shiftWindow?: string;
  currentTime?: Date | string;
  className?: string;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
}

/**
 * Checks whether a given timestamp is outside the standard shift window or in shift transition / cash cut.
 * Standard EvoGym shifts:
 * - Matutino: 06:00–14:00 (Transition/Overtime/Corte: before 06:00 or >= 13:45)
 * - Vespertino: 14:00–22:00 (Transition/Overtime/Corte: before 14:00 or >= 21:45)
 * - No active shift / closed shift: always true (overtime).
 */
export function isShiftTransitionOrOvertime(
  shiftWindow?: string,
  date: Date | string = new Date()
): boolean {
  if (!shiftWindow) return true;

  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return true;

  const hours = d.getHours();
  const minutes = d.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  if (shiftWindow.includes('06:00') && shiftWindow.includes('14:00')) {
    // 06:00 is 360 min, 14:00 is 840 min.
    // Transition / Corte de caja: < 06:00 or >= 13:45 (the 15 min cut window before 14:00)
    return currentMinutes < 360 || currentMinutes >= 825;
  }

  if (shiftWindow.includes('14:00') && shiftWindow.includes('22:00')) {
    // 14:00 is 840 min, 22:00 is 1320 min.
    // Transition / Corte de caja: < 14:00 or >= 21:45 (the 15 min cut window before 22:00)
    return currentMinutes < 840 || currentMinutes >= 1305;
  }

  return false;
}

/**
 * OvertimeSaleToggle - Non-optional, automatic indicator.
 * Automatically marks sales as Overtime during shift cut/transition so that:
 * 1. The sale is not included in the preceding cash cut.
 * 2. The incoming shift is released from responsibility for unexpected inventory deductions.
 */
export function OvertimeSaleToggle({
  isOvertime: controlledIsOvertime,
  shiftWindow,
  currentTime,
  className = '',
}: OvertimeSaleToggleProps) {
  const isAutoOvertime = useMemo(() => {
    return isShiftTransitionOrOvertime(shiftWindow, currentTime);
  }, [shiftWindow, currentTime]);

  const active = controlledIsOvertime ?? isAutoOvertime;

  if (!active) return null;

  return (
    <div
      className={`overtime-sale-automatic-banner ${className}`.trim()}
      data-testid="overtime-sale-banner"
      role="status"
      aria-label="Venta en Corte de Caja y Overtime"
    >
      <div className="overtime-automatic-header">
        <span className="overtime-badge">
          ⚡ Venta en Corte de Caja / Overtime
        </span>
        <span className="overtime-auto-tag">
          🔒 Asignación obligatoria
        </span>
      </div>
      <p className="overtime-explanation-text">
        Esta venta se realiza durante el <strong>corte de caja o cambio de turno</strong>. Se asigna automáticamente como <strong>Overtime</strong> para no alterar el corte en curso y deslindar de responsabilidad al siguiente turno por el movimiento de inventario.
      </p>
    </div>
  );
}
