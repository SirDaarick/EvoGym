import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OvertimeSaleToggle, isShiftTransitionOrOvertime } from './OvertimeSaleToggle';

describe('OvertimeSaleToggle and isShiftTransitionOrOvertime', () => {
  it('correctly detects shift transition and overtime times', () => {
    // 06:00-14:00 window
    // At 10:00 (inside shift): false
    const insideMorning = new Date(2026, 9, 19, 10, 0);
    expect(isShiftTransitionOrOvertime('06:00–14:00', insideMorning)).toBe(false);

    // At 13:50 (transition / corte de caja before 14:00): true
    const transitionMorning = new Date(2026, 9, 19, 13, 50);
    expect(isShiftTransitionOrOvertime('06:00–14:00', transitionMorning)).toBe(true);

    // At 14:10 (after morning shift, waiting for afternoon): true
    const overtimeMorning = new Date(2026, 9, 19, 14, 10);
    expect(isShiftTransitionOrOvertime('06:00–14:00', overtimeMorning)).toBe(true);

    // At 05:30 (before morning shift opening): true
    const beforeMorning = new Date(2026, 9, 19, 5, 30);
    expect(isShiftTransitionOrOvertime('06:00–14:00', beforeMorning)).toBe(true);

    // No shift window provided (shift is closed / corte finished)
    expect(isShiftTransitionOrOvertime(undefined)).toBe(true);

    // String date parameter support
    expect(isShiftTransitionOrOvertime('06:00–14:00', '2026-10-19T13:55:00-06:00')).toBe(true);
    expect(isShiftTransitionOrOvertime('06:00–14:00', '2026-10-19T11:00:00-06:00')).toBe(false);
  });

  it('renders automatic non-optional banner without checkbox when in transition or corte de caja', () => {
    render(
      <OvertimeSaleToggle
        isOvertime={true}
        shiftWindow="06:00–14:00"
      />
    );

    // Banner is rendered with status role
    expect(screen.getByRole('status', { name: /venta en corte de caja y overtime/i })).toBeInTheDocument();
    expect(screen.getByText(/⚡ Venta en Corte de Caja \/ Overtime/)).toBeInTheDocument();
    expect(screen.getByText(/🔒 Asignación obligatoria/)).toBeInTheDocument();
    expect(screen.getByText(/deslindar de responsabilidad al siguiente turno/i)).toBeInTheDocument();

    // Verify there is NO checkbox (not an option for the receptionist to toggle)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/registrar como overtime/i)).not.toBeInTheDocument();
  });

  it('automatically detects transition and displays banner without manual prop', () => {
    const cutTime = new Date(2026, 9, 19, 13, 50);

    render(
      <OvertimeSaleToggle
        shiftWindow="06:00–14:00"
        currentTime={cutTime}
      />
    );

    expect(screen.getByTestId('overtime-sale-banner')).toBeInTheDocument();
    expect(screen.getByText(/⚡ Venta en Corte de Caja \/ Overtime/)).toBeInTheDocument();
  });

  it('renders nothing when sale is during normal shift hours', () => {
    const normalTime = new Date(2026, 9, 19, 10, 30);

    const { container } = render(
      <OvertimeSaleToggle
        shiftWindow="06:00–14:00"
        currentTime={normalTime}
      />
    );

    // Clean checkout: nothing rendered when not in overtime
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('overtime-sale-banner')).not.toBeInTheDocument();
  });
});
