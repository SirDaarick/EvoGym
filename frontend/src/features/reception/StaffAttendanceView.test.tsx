import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { resetStaff, setSelectedStaff } from '../staff/staffStore';
import { StaffAttendanceView } from './StaffAttendanceView';

describe('StaffAttendanceView', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStaff();
    setSelectedStaff({ id: 'staff-sheila', name: 'Sheila' });
  });

  function renderView() {
    return render(
      <DemoProvider>
        <StaffAttendanceView />
      </DemoProvider>
    );
  }

  it('renders the header, KPIs and employee cards with department indicators', async () => {
    renderView();

    expect(screen.getByText('RECEPCIÓN · PERSONAL')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pase de Lista del Personal' })).toBeInTheDocument();

    // Bento KPIs
    expect(screen.getByText('En Turno')).toBeInTheDocument();
    expect(screen.getByText('Fuera del Gym')).toBeInTheDocument();
    expect(screen.getByText('Total Equipo')).toBeInTheDocument();
    expect(screen.getAllByText('Sheila').length).toBeGreaterThan(0);

    // Verify employees exist
    expect(screen.getByTestId('staff-card-staff-mikel')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-charly')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();

    // Verify departments
    expect(screen.getAllByText('Entrenador').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mantenimiento').length).toBeGreaterThan(0);
  });

  it('displays status indicator: Fuera del gym (gray) vs En turno (green with check-in time)', async () => {
    renderView();

    // From initial seed, Mikel is in turn
    const mikelCard = screen.getByTestId('staff-card-staff-mikel');
    expect(mikelCard).toHaveTextContent('En turno');
    expect(mikelCard).toHaveTextContent('Hora de entrada:');
    expect(mikelCard).toHaveTextContent('07:00 hrs');
    expect(mikelCard).toHaveTextContent('Registrado por:');

    // Charly is outside the gym
    const charlyCard = screen.getByTestId('staff-card-staff-charly');
    expect(charlyCard).toHaveTextContent('Fuera del gym');
    expect(charlyCard).toHaveTextContent('Marcar Entrada');
  });

  it('records check-in with one click, storing clock_in_at, recorded_by, and optional note', async () => {
    const user = userEvent.setup();
    renderView();

    const charlyCard = screen.getByTestId('staff-card-staff-charly');
    expect(charlyCard).toHaveTextContent('Fuera del gym');

    // Type optional note
    const noteInput = screen.getByLabelText('Nota opcional de entrada para Charly');
    await user.type(noteInput, 'Llegó 15 min tarde con justificante');

    // Click Marcar Entrada
    const checkInBtn = screen.getByRole('button', { name: 'Marcar entrada para Charly' });
    await user.click(checkInBtn);

    // Verify Charly is now in turn
    await waitFor(() => {
      expect(charlyCard).toHaveTextContent('En turno');
      expect(charlyCard).toHaveTextContent('Nota: Llegó 15 min tarde con justificante');
      expect(charlyCard).toHaveTextContent('Sheila');
    });

    // Shows Marcar Salida button
    expect(screen.getByRole('button', { name: 'Marcar salida para Charly' })).toBeInTheDocument();
  });

  it('records check-out when employee finishes shift', async () => {
    const user = userEvent.setup();
    renderView();

    const mikelCard = screen.getByTestId('staff-card-staff-mikel');
    expect(mikelCard).toHaveTextContent('En turno');

    // Click Marcar Salida
    const checkOutBtn = screen.getByRole('button', { name: 'Marcar salida para Mikel' });
    await user.click(checkOutBtn);

    // Verify Mikel is now outside the gym
    await waitFor(() => {
      expect(mikelCard).toHaveTextContent('Fuera del gym');
    });

    expect(screen.getByRole('button', { name: 'Marcar entrada para Mikel' })).toBeInTheDocument();
  });

  it('filters employees by search query', async () => {
    const user = userEvent.setup();
    renderView();

    const searchInput = screen.getByLabelText('Buscar empleado');
    await user.type(searchInput, 'Silvia');

    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-charly')).not.toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-mikel')).not.toBeInTheDocument();
  });

  it('filters employees by department pills', async () => {
    const user = userEvent.setup();
    renderView();

    const maintenancePill = screen.getByRole('button', { name: 'Mantenimiento' });
    await user.click(maintenancePill);

    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-alan')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-mikel')).not.toBeInTheDocument();
  });

  it('filters employees by status pills (En turno / Fuera del gym)', async () => {
    const user = userEvent.setup();
    renderView();

    const inTurnPill = screen.getByRole('button', { name: /En turno/ });
    await user.click(inTurnPill);

    expect(screen.getByTestId('staff-card-staff-mikel')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-charly')).not.toBeInTheDocument();

    const outPill = screen.getByRole('button', { name: /Fuera del gym/ });
    await user.click(outPill);

    expect(screen.getByTestId('staff-card-staff-charly')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-mikel')).not.toBeInTheDocument();
  });

  it('displays the audit table with recorded check-ins', () => {
    renderView();

    expect(screen.getByRole('heading', { name: 'Historial de registros de hoy' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Tabla de registros de asistencia del personal' })).toBeInTheDocument();
    expect(screen.getAllByText('Sheila').length).toBeGreaterThan(0);
  });
});
