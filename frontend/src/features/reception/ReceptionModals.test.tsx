import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { CasillerosModal } from './CasillerosModal';
import { SuplementosModal } from './SuplementosModal';
import { GastoModal } from './GastoModal';
import { ExtraModal } from './ExtraModal';
import { getStoredAlerts } from '../gimi/gimiStore';

describe('Reception Modals (Casilleros, Suplementos, Gasto, Extra)', () => {
  describe('CasillerosModal', () => {
    it('renders 42 lockers and displays assigned vs available details', () => {
      render(
        <DemoProvider>
          <CasillerosModal isOpen={true} onClose={vi.fn()} />
        </DemoProvider>
      );

      expect(screen.getByRole('dialog')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Casilleros' })).toBeVisible();

      const buttons = screen.getAllByRole('button');
      const lockerCards = buttons.filter(b => b.classList.contains('casillero-card'));
      expect(lockerCards).toHaveLength(42);

      // Locker #03 is assigned to Carlos Rivera in seed
      expect(screen.getByText('#03')).toBeVisible();
      expect(screen.getByText('Carlos Rivera')).toBeVisible();
    });

    it('assigns an available locker to a member and frees it with release', async () => {
      render(
        <DemoProvider>
          <CasillerosModal isOpen={true} onClose={vi.fn()} />
        </DemoProvider>
      );

      // Select available locker #04
      const card04 = screen.getByText('#04').closest('button');
      expect(card04).toBeTruthy();
      await userEvent.click(card04!);

      // Search and select Mariana López
      await userEvent.type(screen.getByRole('combobox', { name: 'Buscar socio activo' }), 'Mariana');
      await userEvent.click(screen.getByRole('option', { name: /Mariana López/i }));

      // Proceed to checkout step
      const proceedBtn = screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i });
      await userEvent.click(proceedBtn);

      // Select Efectivo method
      await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));

      // Confirm assignment
      const confirmBtn = screen.getByRole('button', { name: 'Confirmar cobro y asignar' });
      expect(confirmBtn).not.toBeDisabled();
      await userEvent.click(confirmBtn);

      // SwipeToast notification
      expect(screen.getByText('Casillero asignado')).toBeInTheDocument();
      expect(card04).toHaveTextContent('Mariana López');

      // Now cancel and release it
      const releaseBtn = screen.getByRole('button', { name: /Cancelar asignación|Liberar casillero/i });
      await userEvent.click(releaseBtn);
      expect(screen.getByText(/Casillero cancelado y liberado|Casillero liberado/)).toBeInTheDocument();
      expect(card04).toHaveTextContent('Disponible');
    });

    it('handles automatic lifecycle: displays Ocupado, renews, cancels with admin alert, and evicts to available', async () => {
      render(
        <DemoProvider>
          <CasillerosModal isOpen={true} onClose={vi.fn()} />
        </DemoProvider>
      );

      // Locker #03 is assigned to Carlos Rivera (Ocupado)
      const card03 = screen.getByText('#03').closest('button')!;
      expect(card03).toHaveTextContent('Ocupado');
      await userEvent.click(card03);

      expect(screen.getByRole('heading', { name: 'Cliente asignado' })).toBeVisible();
      expect(screen.getAllByText('Carlos Rivera').length).toBeGreaterThan(0);

      // Renovar mensualidad
      const renewBtn = screen.getByRole('button', { name: /Renovar mensualidad/i });
      await userEvent.click(renewBtn);
      expect(screen.getByText('Mensualidad renovada')).toBeInTheDocument();

      // Cancelar suscripción -> frees to available & generates admin alert
      const cancelBtn = screen.getByRole('button', { name: /Cancelar asignación/i });
      await userEvent.click(cancelBtn);
      expect(screen.getByText('Casillero cancelado y liberado')).toBeInTheDocument();
      expect(card03).toHaveTextContent('Disponible');

      // Verify admin alert in store
      const alerts = getStoredAlerts();
      const cancelAlert = alerts.find(a => a.message.includes('#03') && a.message.includes('Carlos Rivera'));
      expect(cancelAlert).toBeDefined();

      // Eviction test: Locker #15 is evicted (Desalojar)
      const card15 = screen.getByText('#15').closest('button')!;
      expect(card15).toHaveTextContent('Desalojar');
      await userEvent.click(card15);

      expect(screen.getByRole('heading', { name: 'Casillero por desalojar' })).toBeVisible();
      const evictBtn = screen.getByRole('button', { name: 'Desalojar casillero' });
      await userEvent.click(evictBtn);
      expect(screen.getByText('Casillero desalojado')).toBeInTheDocument();
      expect(card15).toHaveTextContent('Disponible');
    });
  });

  describe('SuplementosModal', () => {
    it('renders supplement scoops and supports cart checkout', async () => {
      render(
        <DemoProvider>
          <SuplementosModal isOpen={true} onClose={vi.fn()} />
        </DemoProvider>
      );

      expect(screen.getByRole('dialog')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Suplementos' })).toBeVisible();

      // Add 2 scoops of Proteína Whey (Vainilla) via card selection (left click) and + button
      const selectBtn = screen.getByRole('button', { name: 'Seleccionar Proteína Whey (Vainilla)' });
      await userEvent.click(selectBtn);
      const plusBtn = screen.getByRole('button', { name: 'Aumentar Proteína Whey (Vainilla)' });
      await userEvent.click(plusBtn);

      expect(screen.getByLabelText('Cantidad de Proteína Whey (Vainilla)')).toHaveTextContent('2');

      // Right-click decrements to 1 scoop
      const wheyCard = selectBtn.closest('article')!;
      fireEvent.contextMenu(wheyCard);
      expect(screen.getByLabelText('Cantidad de Proteína Whey (Vainilla)')).toHaveTextContent('1');

      // Left-click card again increments back to 2 scoops
      await userEvent.click(selectBtn);
      expect(screen.getByLabelText('Cantidad de Proteína Whey (Vainilla)')).toHaveTextContent('2');

      // Proceed to checkout step
      const proceedBtn = screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i });
      await userEvent.click(proceedBtn);

      // Select Efectivo method
      await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));

      // Confirm sale
      const confirmBtn = screen.getByRole('button', { name: 'Confirmar cobro de suplementos' });
      expect(confirmBtn).not.toBeDisabled();
      await userEvent.click(confirmBtn);

      // SwipeToast notification
      expect(screen.getByText('Cobro de suplementos confirmado')).toBeInTheDocument();
    });
  });

  describe('GastoModal', () => {
    it('registers an unexpected expense and displays it in current shift history', async () => {
      render(
        <DemoProvider>
          <GastoModal isOpen={true} onClose={vi.fn()} />
        </DemoProvider>
      );

      expect(screen.getByRole('dialog')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Registrar Gasto' })).toBeVisible();

      await userEvent.type(screen.getByLabelText('Concepto *'), 'Insumos de limpieza turno tarde');
      await userEvent.type(screen.getByLabelText('Nombre *'), 'Don Chente Limpieza');
      await userEvent.type(screen.getByLabelText('Saldo / Monto *'), '120.50');

      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

      // SwipeToast
      expect(screen.getByText('Gasto registrado')).toBeInTheDocument();
      // Appears in table
      expect(screen.getByText('Insumos de limpieza turno tarde')).toBeVisible();
      expect(screen.getByText('Don Chente Limpieza')).toBeVisible();
    });
  });

  describe('ExtraModal', () => {
    it('registers personal change advance and displays it in current shift history', async () => {
      render(
        <DemoProvider>
          <ExtraModal isOpen={true} onClose={vi.fn()} />
        </DemoProvider>
      );

      expect(screen.getByRole('dialog')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Registrar Extra' })).toBeVisible();

      await userEvent.type(screen.getByLabelText('Concepto *'), 'Cambio billete $500 cliente Carlos');
      await userEvent.type(screen.getByLabelText('Nombre *'), 'Mariana López');
      await userEvent.type(screen.getByLabelText('Saldo / Monto *'), '50');

      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

      // SwipeToast
      expect(screen.getByText('Extra registrado')).toBeInTheDocument();
      // Appears in table
      expect(screen.getByText('Cambio billete $500 cliente Carlos')).toBeVisible();
      expect(screen.getAllByText('Mariana López').length).toBeGreaterThan(0);
    });
  });
});
