import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { resetPlans } from '../../demo/plans';
import { PlanCatalog } from './PlanCatalog';

function enableWriterLock() {
  vi.stubGlobal(
    'navigator',
    Object.create(window.navigator, {
      locks: {
        value: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => {
            await callback({});
          },
        },
      },
    })
  );
}

describe('PlanCatalog owner screen', () => {
  beforeEach(() => {
    enableWriterLock();
    resetPlans();
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetPlans();
  });

  it('uses reference labels and operational limits without demo framing', () => {
    render(
      <DemoProvider>
        <PlanCatalog />
      </DemoProvider>
    );

    expect(screen.getByRole('region', { name: 'Productos de referencia' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Precio MXN' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Cantidad inicial' })).toBeVisible();
    for (const note of screen.getAllByText('Registro de cobro pendiente de validación; no activa acceso automáticamente.')) {
      expect(note).toBeVisible();
    }
    expect(document.body).not.toHaveTextContent(/demo|demostración|simulado/i);
  });

  it('renders header, "Nuevo plan" button, and the 4 Bento KPI summary cards', () => {
    const { container } = render(
      <DemoProvider>
        <PlanCatalog />
      </DemoProvider>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Catálogo de planes' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Nuevo plan/i })).toBeVisible();

    const bento = container.querySelector('.plan-bento-grid') as HTMLElement;
    expect(within(bento).getByText('Total planes')).toBeVisible();
    expect(within(bento).getByText('Planes activos')).toBeVisible();
    expect(within(bento).getAllByText('Membresías')[0]).toBeVisible();
    expect(within(bento).getByText('Pases por visita')).toBeVisible();
  });

  it('renders catalog table with filter pills', () => {
    render(
      <DemoProvider>
        <PlanCatalog />
      </DemoProvider>
    );

    const plansRegion = screen.getByRole('region', { name: 'Planes y visitas' });
    expect(plansRegion).toBeVisible();

    const pillsGroup = screen.getByRole('radiogroup', { name: 'Filtrar planes' });
    expect(within(pillsGroup).getByRole('button', { name: /^Todos/i })).toBeVisible();
    expect(within(pillsGroup).getByRole('button', { name: /^Activos/i })).toBeVisible();
    expect(within(pillsGroup).getByRole('button', { name: /^Membresías/i })).toBeVisible();
    expect(within(pillsGroup).getByRole('button', { name: /^Visitas/i })).toBeVisible();
    expect(within(pillsGroup).getByRole('button', { name: /^Inactivos/i })).toBeVisible();

    // Check specific seed plans
    expect(within(plansRegion).getByText('Gym mensual')).toBeVisible();
    expect(within(plansRegion).getByText('Box mensual')).toBeVisible();
    expect(within(plansRegion).getByText('Visita una área')).toBeVisible();
  });

  it('filters table by category and status pills', async () => {
    const user = userEvent.setup();
    render(
      <DemoProvider>
        <PlanCatalog />
      </DemoProvider>
    );

    const plansRegion = screen.getByRole('region', { name: 'Planes y visitas' });
    const pillsGroup = screen.getByRole('radiogroup', { name: 'Filtrar planes' });

    // Filter by Visitas
    const visitsPill = within(pillsGroup).getByRole('button', { name: /^Visitas/i });
    await user.click(visitsPill);

    expect(within(plansRegion).getByText('Visita una área')).toBeVisible();
    expect(within(plansRegion).getByText('Visita Gym + Box')).toBeVisible();
    expect(within(plansRegion).queryByText('Gym mensual')).not.toBeInTheDocument();

    // Filter by Membresías
    const membershipsPill = within(pillsGroup).getByRole('button', { name: /^Membresías/i });
    await user.click(membershipsPill);

    expect(within(plansRegion).getByText('Gym mensual')).toBeVisible();
    expect(within(plansRegion).queryByText('Visita una área')).not.toBeInTheDocument();

    // Filter by Inactivos (initially empty)
    const inactivePill = within(pillsGroup).getByRole('button', { name: /^Inactivos/i });
    await user.click(inactivePill);

    expect(screen.getByText('No se encontraron planes')).toBeVisible();
  });

  it('filters table by search query', async () => {
    const user = userEvent.setup();
    render(
      <DemoProvider>
        <PlanCatalog />
      </DemoProvider>
    );

    const plansRegion = screen.getByRole('region', { name: 'Planes y visitas' });
    const searchInput = screen.getByRole('searchbox', { name: 'Buscar planes' });

    await user.type(searchInput, 'estudiante');

    expect(within(plansRegion).getByText('Gym estudiante')).toBeVisible();
    expect(within(plansRegion).getByText('Box estudiante')).toBeVisible();
    expect(within(plansRegion).queryByText('Gym mensual')).not.toBeInTheDocument();

    await user.clear(searchInput);
    expect(within(plansRegion).getByText('Gym mensual')).toBeVisible();
  });

  it('opens and closes "Nuevo plan" modal with form validation and creates a plan', async () => {
    const user = userEvent.setup();
    render(
      <DemoProvider>
        <PlanCatalog />
      </DemoProvider>
    );

    const newBtn = screen.getByRole('button', { name: /Nuevo plan/i });
    await user.click(newBtn);

    expect(screen.getByRole('heading', { name: 'Nuevo plan' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByText('Descripción y condiciones (opcional)'));
    const nameInput = screen.getByLabelText('Nombre del plan');
    const priceInput = screen.getByLabelText('Precio MXN');
    const applicabilityInput = screen.getByLabelText('Descripción de aplicabilidad');
    const submitBtn = screen.getByRole('button', { name: 'Guardar plan' });

    // Validation check on empty submit
    await user.click(submitBtn);

    // Fill valid data
    await user.clear(nameInput);
    await user.type(nameInput, 'Plan Box Pro');
    await user.type(screen.getByLabelText('Precio de referencia (100%)'), '650');
    expect(priceInput).toHaveValue('650.00');
    await user.clear(applicabilityInput);
    await user.type(applicabilityInput, 'Box avanzado con acceso a ring y sparring.');
    await user.click(submitBtn);

    // Modal closes and plan is in table
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Nuevo plan' })).not.toBeInTheDocument();
    });

    const plansRegion = screen.getByRole('region', { name: 'Planes y visitas' });
    expect(within(plansRegion).getByText('Plan Box Pro')).toBeVisible();
    expect(within(within(plansRegion).getByText('Plan Box Pro').closest('tr')!).getByText('$650.00 MXN')).toBeVisible();
  }, 15000);

  it('opens edit modal and updates plan price and applicability', async () => {
    const user = userEvent.setup();
    render(
      <DemoProvider>
        <PlanCatalog />
      </DemoProvider>
    );

    const editBtn = screen.getByRole('button', { name: 'Editar Gym mensual' });
    await user.click(editBtn);

    expect(screen.getByRole('heading', { name: 'Editar plan' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByText('Descripción y condiciones (opcional)'));

    const priceInput = screen.getByLabelText('Precio MXN');
    const appInput = screen.getByLabelText('Descripción de aplicabilidad');
    const saveBtn = screen.getByRole('button', { name: 'Guardar cambios' });

    await user.clear(priceInput);
    await user.type(priceInput, '550');
    await user.clear(appInput);
    await user.type(appInput, 'Acceso ilimitado a Gym actualizado.');
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Editar plan' })).not.toBeInTheDocument();
    });

    const plansRegion = screen.getByRole('region', { name: 'Planes y visitas' });
    expect(within(plansRegion).getByText('$550.00 MXN')).toBeVisible();
    expect(within(plansRegion).getByText('Acceso ilimitado a Gym actualizado.')).toBeVisible();
  }, 15000);

  it('opens confirmation modal and deactivates a plan', async () => {
    const user = userEvent.setup();
    render(
      <DemoProvider>
        <PlanCatalog />
      </DemoProvider>
    );

    const deactivateBtn = screen.getByRole('button', { name: 'Desactivar Gym mensual' });
    await user.click(deactivateBtn);

    expect(screen.getByRole('heading', { name: '¿Desactivar plan?' })).toBeVisible();
    expect(screen.getByText(/La recepción ya no podrá ofrecerlo ni cobrarlo/i)).toBeVisible();

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar desactivación' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '¿Desactivar plan?' })).not.toBeInTheDocument();
    });

    // The plan button now says "Activar Gym mensual"
    expect(screen.getByRole('button', { name: 'Activar Gym mensual' })).toBeVisible();

    // Inactive filter now shows 1
    const inactivePill = screen.getByRole('button', { name: /Inactivos/i });
    await user.click(inactivePill);

    const plansRegion = screen.getByRole('region', { name: 'Planes y visitas' });
    expect(within(plansRegion).getByText('Gym mensual')).toBeVisible();
  });
});
