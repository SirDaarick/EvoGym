import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UnscheduledClockInModal, type ColleagueWithShift } from './UnscheduledClockInModal';
import type { StaffAttendancePerson } from './StaffAttendanceView';

describe('UnscheduledClockInModal', () => {
  const mockStaff: StaffAttendancePerson = {
    id: 'staff-1',
    name: 'Carlos Ruiz',
    active: true,
    avatarInitials: 'CR',
    department: 'Staff',
    shift: '08:00 - 16:00',
  };

  const mockColleagues: ColleagueWithShift[] = [
    {
      staffId: 'staff-2',
      name: 'Ana Pérez',
      seriesId: 'series-ana',
      displayName: 'Ana Pérez (08:00 - 16:00)',
    },
    {
      staffId: 'staff-3',
      name: 'Mario Soto',
      seriesId: 'series-mario',
      displayName: 'Mario Soto (16:00 - 22:00)',
    },
  ];

  it('renders nothing when isOpen is false or staff is null', () => {
    const { rerender } = render(
      <UnscheduledClockInModal
        isOpen={false}
        staff={mockStaff}
        colleaguesWithShift={mockColleagues}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <UnscheduledClockInModal
        isOpen={true}
        staff={null}
        colleaguesWithShift={mockColleagues}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title, employee name, RubberSegment options, and colleague dropdown by default', () => {
    render(
      <UnscheduledClockInModal
        isOpen={true}
        staff={mockStaff}
        colleaguesWithShift={mockColleagues}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Confirmar Entrada' })).toBeInTheDocument();
    expect(screen.getByText(/Carlos Ruiz/)).toBeInTheDocument();
    expect(screen.getByText(/no tiene turno programado para hoy/)).toBeInTheDocument();

    // Paso 1: RubberSegment items
    expect(screen.getByRole('radio', { name: 'Cubrir a un compañero' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Turno de apoyo' })).toBeInTheDocument();

    // Paso 2: Colleague selection panel with AnimatedList (active because cover is selected)
    expect(screen.getByText('Seleccionar compañero a cubrir:')).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Seleccionar compañero a cubrir' })).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez (08:00 - 16:00)')).toBeInTheDocument();
    expect(screen.getByText('Mario Soto (16:00 - 22:00)')).toBeInTheDocument();
    expect(screen.getByText('Selecciona un compañero de la lista para continuar.')).toBeInTheDocument();

    // Confirm button is disabled until a colleague is chosen
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar Entrada' });
    expect(confirmBtn).toBeDisabled();
  });

  it('defaults to support mode with assigned hours when no colleagues have shifts', () => {
    render(
      <UnscheduledClockInModal
        isOpen={true}
        staff={mockStaff}
        colleaguesWithShift={[]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    // In support mode, shows the assigned hours panel
    expect(screen.getByText('Turno de apoyo / Refuerzo extraordinario')).toBeInTheDocument();
    expect(screen.getByText('Horas asignadas:')).toBeInTheDocument();
    expect(screen.getByText('08:00 - 16:00')).toBeInTheDocument();
    expect(screen.queryByLabelText('Seleccionar compañero a cubrir')).not.toBeInTheDocument();
  });

  it('confirms clock-in covering selected colleague', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <UnscheduledClockInModal
        isOpen={true}
        staff={mockStaff}
        colleaguesWithShift={mockColleagues}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar Entrada' });
    expect(confirmBtn).toBeDisabled();

    // Select Mario Soto in AnimatedList
    await user.click(screen.getByText('Mario Soto (16:00 - 22:00)'));
    expect(confirmBtn).toBeEnabled();
    expect(screen.getByText(/Cubriendo a:/)).toBeInTheDocument();

    await user.click(confirmBtn);

    expect(handleConfirm).toHaveBeenCalledWith({
      series_id: 'series-mario',
      covered_profile_id: 'staff-3',
      notes: 'Cubriendo turno de Mario Soto',
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('switches to support mode via RubberSegment, shows assigned hours, and confirms', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <UnscheduledClockInModal
        isOpen={true}
        staff={mockStaff}
        colleaguesWithShift={mockColleagues}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    // Click on 'Turno de apoyo' in RubberSegment
    const supportRadio = screen.getByRole('radio', { name: 'Turno de apoyo' });
    await user.click(supportRadio);

    // Paso 3 panel is now visible
    expect(screen.getByText('Turno de apoyo / Refuerzo extraordinario')).toBeInTheDocument();
    expect(screen.getByText('Horas asignadas:')).toBeInTheDocument();
    expect(screen.getByText('08:00 - 16:00')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar Entrada' });
    await user.click(confirmBtn);

    expect(handleConfirm).toHaveBeenCalledWith({
      notes: 'Turno de apoyo / extraordinario',
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('allows selecting and deselecting a colleague from AnimatedList', async () => {
    const user = userEvent.setup();
    render(
      <UnscheduledClockInModal
        isOpen={true}
        staff={mockStaff}
        colleaguesWithShift={mockColleagues}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar Entrada' });
    expect(confirmBtn).toBeDisabled();

    // Select Ana
    await user.click(screen.getByText('Ana Pérez (08:00 - 16:00)'));
    expect(confirmBtn).toBeEnabled();
    expect(screen.getByText(/Cubriendo a:/)).toBeInTheDocument();

    // Deselect Ana
    await user.click(screen.getByRole('button', { name: 'Deseleccionar' }));
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByText('Selecciona un compañero de la lista para continuar.')).toBeInTheDocument();
  });

  it('supports closing via cancel button, close X button, and Escape key', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <UnscheduledClockInModal
        isOpen={true}
        staff={mockStaff}
        colleaguesWithShift={mockColleagues}
        onClose={handleClose}
        onConfirm={vi.fn()}
      />
    );

    // Cancel button
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Close X button
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(handleClose).toHaveBeenCalledTimes(2);

    // Escape key
    await user.keyboard('{Escape}');
    expect(handleClose).toHaveBeenCalledTimes(3);
  });
});
