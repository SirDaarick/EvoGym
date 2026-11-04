import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { SuplementosModal } from './SuplementosModal';
import { GastoModal } from './GastoModal';
import { ExtraModal } from './ExtraModal';

describe('Reception Modals (Suplementos, Gasto, Extra)', () => {
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
      await userEvent.selectOptions(screen.getByLabelText('Categoría *'), 'limpieza');

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
