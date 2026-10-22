import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { GuantesModal } from './GuantesModal';

describe('GuantesModal', () => {
  it('renders 12 glove cards and displays initial available and rented states', () => {
    const handleClose = vi.fn();
    render(
      <DemoProvider>
        <GuantesModal isOpen={true} onClose={handleClose} />
      </DemoProvider>
    );

    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Guantes' })).toBeVisible();

    // 12 glove cards
    const buttons = screen.getAllByRole('button');
    const gloveCards = buttons.filter(b => b.classList.contains('guante-card'));
    expect(gloveCards).toHaveLength(12);

    // Initial seed: 10 available, 2 rented
    const availableBadges = screen.getAllByText('Disponible');
    // Note: 'Disponible' can appear on badges, specs, and cards
    expect(availableBadges.length).toBeGreaterThan(0);

    // #02 is rented in seed to Carlos Rivera
    const card02 = screen.getByText('#02 · Negro · 14 oz').closest('button');
    expect(card02).toHaveTextContent('Carlos Rivera');

    // #05 is rented in seed to Alex Morgan
    const card05 = screen.getByText('#05 · Rosa · 12 oz').closest('button');
    expect(card05).toHaveTextContent('Alex Morgan');
  });

  it('displays specifications for the selected glove and allows assigning a member', async () => {
    const handleClose = vi.fn();
    render(
      <DemoProvider>
        <GuantesModal isOpen={true} onClose={handleClose} />
      </DemoProvider>
    );

    // Click on available glove #01
    const card01 = screen.getByText('#01 · Rojo · 12 oz').closest('button');
    expect(card01).toBeTruthy();
    await userEvent.click(card01!);

    // Specifications card
    expect(screen.getByRole('heading', { name: 'Especificación de los guantes' })).toBeVisible();
    expect(screen.getByText('#01')).toBeVisible();
    expect(screen.getByText('Rojo')).toBeVisible();
    expect(screen.getByText('12 oz')).toBeVisible();

    // Assignment card
    expect(screen.getByRole('heading', { name: 'Asignar a socio' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Buscar socio activo' })).toBeVisible();

    // Assign member Mariana López via search combobox
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar socio activo' }), 'Mariana');
    await userEvent.click(screen.getByRole('option', { name: /Mariana López/i }));

    expect(screen.getByText('Mariana López')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Desasignar socio' })).toBeVisible();
  });

  it('confirms rental and transitions glove to rented with assigned member', async () => {
    const handleClose = vi.fn();
    render(
      <DemoProvider>
        <GuantesModal isOpen={true} onClose={handleClose} />
      </DemoProvider>
    );

    // Select available glove #03
    const card03 = screen.getByText('#03 · Azul · 10 oz').closest('button');
    await userEvent.click(card03!);

    // Assign Mariana López via search combobox
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar socio activo' }), 'Mariana');
    await userEvent.click(screen.getByRole('option', { name: /Mariana López/i }));

    // Proceed to payment step
    const proceedBtn = screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i });
    await userEvent.click(proceedBtn);

    // Select Efectivo method
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));

    // Confirm rental
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar cobro y entregar' });
    expect(confirmBtn).not.toBeDisabled();
    await userEvent.click(confirmBtn);

    // SwipeToast notification
    expect(screen.getByText('Renta confirmada')).toBeInTheDocument();
    expect(screen.getByText(/rentados exitosamente a Mariana López/i)).toBeInTheDocument();

    // Glove #03 should now be rented with Mariana López
    const updatedCard03 = screen.getByText('#03 · Azul · 10 oz').closest('button');
    expect(updatedCard03).toHaveTextContent('Mariana López');
    expect(updatedCard03).toHaveTextContent('En uso');
  });

  it('selects a rented glove, displays return button, and restores glove to available', async () => {
    const handleClose = vi.fn();
    render(
      <DemoProvider>
        <GuantesModal isOpen={true} onClose={handleClose} />
      </DemoProvider>
    );

    // Select initially rented glove #02 (rented to Carlos Rivera)
    const card02 = screen.getByText('#02 · Negro · 14 oz').closest('button');
    await userEvent.click(card02!);

    // Should show assigned member details
    expect(screen.getByRole('heading', { name: 'Socio asignado' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Devolución' })).toBeVisible();

    const returnBtn = screen.getByRole('button', { name: 'Marcar como devuelto' });
    expect(returnBtn).toBeVisible();

    // Click return
    await userEvent.click(returnBtn);

    // SwipeToast notification
    expect(screen.getByText('Guantes devueltos')).toBeInTheDocument();
    expect(screen.getByText(/devueltos y ahora disponibles para renta/i)).toBeInTheDocument();

    // Glove #02 should now be available
    const updatedCard02 = screen.getByText('#02 · Negro · 14 oz').closest('button');
    expect(updatedCard02).toHaveTextContent('Disponible');
  });

  it('closes modal on close button click and Escape key', async () => {
    const handleClose = vi.fn();
    const { rerender } = render(
      <DemoProvider>
        <GuantesModal isOpen={true} onClose={handleClose} />
      </DemoProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar modal de guantes' }));
    expect(handleClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(handleClose).toHaveBeenCalledTimes(2);

    rerender(
      <DemoProvider>
        <GuantesModal isOpen={false} onClose={handleClose} />
      </DemoProvider>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
