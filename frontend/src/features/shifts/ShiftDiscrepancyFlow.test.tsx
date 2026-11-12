import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ShiftOpenModal } from './ShiftOpenModal';
import { ShiftCloseDialog } from './ShiftCloseDialog';
import { Shifts } from './Shifts';
import type { ApiRequest } from '../../api/shiftsApi';

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

afterEach(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

describe('Shift discrepancy comments and expected cash flow', () => {
  it('requires a comment when opening cash differs from expected cash', async () => {
    const onConfirm = vi.fn();
    render(
      <ShiftOpenModal
        isOpen
        liveInventory={{
          products: [{ id: 'p1', name: 'Agua 600ml', category: 'Bebidas', expectedQuantity: 10, initialized: true }],
          window: '06:00–14:00',
          openerName: 'Recepcionista Turno',
          expectedOpeningCashMinor: 50000,
        }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    // Switch to manual total mode and enter a discrepancy: $400 instead of expected $500
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    const manualInput = screen.getByLabelText(/Fondo inicial/);
    await userEvent.type(manualInput, '400');

    // Attempt to proceed without entering a comment
    const nextBtn = screen.getByRole('button', { name: /2\. Inventario Inicial/ });
    await userEvent.click(nextBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Se requiere un comentario cuando hay diferencia en el fondo inicial de efectivo.'
    );
    expect(onConfirm).not.toHaveBeenCalled();

    // Now enter opening observations
    const notesInput = screen.getByLabelText(/Observaciones del fondo inicial/);
    await userEvent.type(notesInput, 'Faltan 100 pesos en morralla');

    await userEvent.click(nextBtn);

    // Now step 2 is active
    expect(await screen.findByText('2. Inventario Inicial')).toBeInTheDocument();
  });

  it('requires a reason when opening physical inventory differs from expected stock', async () => {
    const onConfirm = vi.fn();
    render(
      <ShiftOpenModal
        isOpen
        liveInventory={{
          products: [{ id: 'p1', name: 'Proteína Barra', category: 'Suplementos', expectedQuantity: 10, initialized: true }],
          window: '06:00–14:00',
          openerName: 'Recepcionista Turno',
          expectedOpeningCashMinor: 50000,
        }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    // Cash matches expected
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    await userEvent.type(screen.getByLabelText(/Fondo inicial/), '500');

    await userEvent.click(screen.getByRole('button', { name: /2\. Inventario Inicial/ }));

    // Change physical count from 10 to 8
    const countInput = await screen.findByLabelText(/Stock físico de Proteína Barra/);
    fireEvent.change(countInput, { target: { value: '8' } });

    // Attempt to go to summary without selecting a reason
    await userEvent.click(screen.getByRole('button', { name: /3\. Resumen y Confirmación/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Indica el motivo de la diferencia de Proteína Barra.'
    );

    // Select reason
    const reasonSelect = screen.getByLabelText(/Motivo de .* para Proteína Barra/);
    await userEvent.selectOptions(reasonSelect, 'Merma detectada al abrir');

    await userEvent.click(screen.getByRole('button', { name: /3\. Resumen y Confirmación/ }));

    // Confirm opening
    const confirmBtn = await screen.findByRole('button', { name: 'Confirmar e Iniciar Turno' });
    await userEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      openingCashMinor: 50000,
      counts: [
        expect.objectContaining({
          productId: 'p1',
          quantity: 8,
          reason: 'Merma detectada al abrir',
        }),
      ],
    }));
  });

  it('requires a closing note when shift is closed with a cash difference', async () => {
    const request = vi.fn<ApiRequest>(async () => new Response(JSON.stringify({
      id: 'shift-1',
      status: 'closed',
      closing_denomination_counts: [],
      counted_cash_minor: 40000,
      difference_minor: -10000,
      closing_notes: 'Faltante al cierre',
    })));

    render(
      <ShiftCloseDialog
        isOpen
        shiftId="shift-1"
        shiftName="Matutino"
        expectedCashMinor={50000}
        apiRequest={request}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Select manual total and enter $400 (difference of -$100)
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'manual');
    const countedInput = screen.getByLabelText('Efectivo contado (MXN)');
    await userEvent.type(countedInput, '400');

    // Attempt to submit review without closing notes
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Se requiere un comentario al cerrar turno cuando hay diferencia de efectivo.'
    );

    // Now fill in closing notes
    const closingNotesInput = screen.getByLabelText(/Observaciones del cierre/);
    await userEvent.type(closingNotesInput, 'Faltante de 100 pesos justificado');

    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));

    // Confirmation screen
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar cierre' });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        '/api/v1/shifts/shift-1/close',
        expect.objectContaining({
          body: JSON.stringify({
            counted_cash_minor: 40000,
            closing_notes: 'Faltante de 100 pesos justificado',
          }),
        })
      );
    });
  });

  it('displays opening notes, expected cash, and opening difference in Shift dashboard', async () => {
    const closedShift = {
      id: 'shift-100',
      cash_register_id: 'reg-1',
      opened_by: 'staff-1',
      opened_at: '2026-10-31T06:00:00Z',
      closed_at: '2026-10-31T14:00:00Z',
      status: 'closed' as const,
      opening_cash_minor: 45000,
      expected_opening_cash_minor: 50000,
      opening_difference_minor: -5000,
      notes: 'Faltaron 50 pesos al inicio',
      denomination_counts: [],
      closing_denomination_counts: [],
      inventory_review: null,
      expected_cash_at_close_minor: 60000,
      current_expected_cash_minor: null,
      counted_cash_minor: 60000,
      difference_minor: 0,
      closing_notes: 'Cierre cuadrado',
    };

    const request = vi.fn<ApiRequest>(async path => {
      if (path === '/api/v1/registers') return new Response(JSON.stringify([{ id: 'reg-1', branch_id: 'b-1', code: 'C1', name: 'Caja 1', status: 'active', has_open_shift: false }]));
      if (path.startsWith('/api/v1/shifts?')) return new Response(JSON.stringify({ items: [closedShift], total: 1, offset: 0, limit: 50 }));
      if (path === '/api/v1/shifts/current?register_id=reg-1') return new Response(null, { status: 404 });
      if (path.includes('/summary')) return new Response(JSON.stringify({ shift_id: 'shift-100', confirmed_minor: 15000, confirmed_cash_minor: 15000, pending_transfer_minor: 0, payment_methods: [], activities: [], payments: [], expected_cash_minor: 60000, expense_minor: 0, expense_count: 0, extra_minor: 0 }));
      if (path.includes('/stock/movements') || path.includes('/inventory')) return new Response(JSON.stringify({ items: [], total: 0 }));
      return new Response(JSON.stringify({ items: [] }));
    });

    render(
      <MemoryRouter>
        <Shifts role="OWNER" apiRequest={request} actorId="admin-1" actorName="Admin Dueño" />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Observaciones de apertura: Faltaron 50 pesos al inicio/)).toBeInTheDocument();
    expect(screen.getByText(/Fondo inicial esperado: \$500\.00 MXN/)).toBeInTheDocument();
    expect(screen.getByText(/Diferencia de apertura: -\$50\.00 MXN/)).toBeInTheDocument();
    expect(screen.getByText(/Observaciones del cierre: Cierre cuadrado/)).toBeInTheDocument();
  });

  it('passes register expected_opening_cash_minor (with overtime) into ShiftOpenModal', async () => {
    const request = vi.fn<ApiRequest>(async (path, init) => {
      if (path === '/api/v1/registers') {
        return new Response(JSON.stringify([{
          id: 'reg-ot',
          branch_id: 'b-1',
          code: 'C1',
          name: 'Caja 1',
          status: 'active',
          has_open_shift: false,
          last_closed_shift_id: 'shift-0',
          expected_opening_cash_minor: 80000,
        }]));
      }
      if (path.startsWith('/api/v1/shifts?')) return new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 50 }));
      if (path === '/api/v1/shifts/current?register_id=reg-ot') return new Response(null, { status: 404 });
      if (path.includes('/inventory-snapshots') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'snap-1', cash_register_id: 'reg-ot', captured_at: '2026-11-11T12:00:00Z', items: [] }));
      }
      return new Response(JSON.stringify({ items: [] }));
    });

    render(
      <MemoryRouter>
        <Shifts role="RECEPTION" apiRequest={request} actorId="staff-1" actorName="Recep" />
      </MemoryRouter>,
    );

    const openBtn = await screen.findByRole('button', { name: 'Abrir Turno' });
    await userEvent.click(openBtn);

    expect(await screen.findByRole('dialog', { name: 'Iniciar Nuevo Turno de Trabajo' })).toBeInTheDocument();
    expect(screen.getByText('$800.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('-$800.00 MXN')).toBeInTheDocument();
  });
});
