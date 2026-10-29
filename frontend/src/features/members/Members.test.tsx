import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import * as memberReadsApi from '../../api/memberReadsApi';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';
import { MemberDetail } from './Members';
import { ApiMembers, ApiMemberDetail, ApiNewMember } from '../../app/ApiMembers';

async function mount(path = '/reception/members') {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /></DemoProvider></MemoryRouter>);
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
}
describe('member workflow', () => {
  it('registers a measured visit and tries automatic closure without inventing time', async () => {
    await mount('/reception/members/demo-active');
    expect(screen.queryByText('Reloj y cierre de demostración')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /avanzar|simular/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    expect(screen.getByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Entrada registrada');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar salida' }));
    expect(screen.getByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Salida registrada');
  }, 12000);
  it('groups global suggestions and selects a member with the keyboard', async () => {
    await mount('/reception/home');
    const input = screen.getByRole('combobox', { name: 'Búsqueda global de socios' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.type(input, 'Alex');
    expect(within(screen.getByRole('listbox')).getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual(['Activos']);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
    expect(await screen.findByRole('heading', { name: 'Alex Morgan' }, { timeout: 10000 })).toBeVisible();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Asistencia previa' })).toBeVisible();
  });
  it('shows no results and Escape closes suggestions', async () => {
    await mount();
    const input = screen.getByRole('combobox', { name: 'Búsqueda global de socios' });
    await userEvent.type(input, 'nobody');
    expect(screen.getByText('Sin coincidencias de socios.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Sin coincidencias de socios.')).not.toBeInTheDocument();
  });
  it('requires renewal in the expired demo without pretending attendance exists', async () => {
    await mount('/reception/members/demo-expired');
    expect(screen.queryByRole('button', { name: 'Registrar entrada' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Registrar pago de membresía' })).not.toBeInTheDocument();
  });
  it('searches members and creates a member with only a required name', async () => {
    await mount();
    await userEvent.type(screen.getByLabelText('Buscar socio'), 'Mariana');
    expect(screen.getByRole('link', { name: 'Mariana López' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Carlos Rivera' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.click(screen.getByRole('button', { name: /proceder al cobro|revisar cobro/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.type(screen.getByLabelText('Monto recibido'), '500');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar operación' }));
    expect(screen.getByRole('heading', { name: 'Registro guardado' })).toBeVisible();
    expect(screen.getByText(/Ana Torres/)).toBeVisible();
  });
  it('presents operation types as theme-aware accessible JellyRadio choices and plans as a list', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    const operationChoices = within(screen.getByRole('radiogroup', { name: 'Tipo de operación' })).getAllByRole('radio');
    expect(operationChoices).toHaveLength(3);
    expect(operationChoices[0]).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelector('.registration-type-jelly')).toHaveStyle({ '--jr-h': '36px' });
    expect(document.querySelector('.registration-type-jelly')).toHaveStyle({ '--jr-active': '#f5f5f5' });
    expect(screen.getByLabelText('Detalles del registro')).toBeVisible();
    const planList = screen.getByRole('listbox');
    expect(within(planList).getAllByRole('option').length).toBeGreaterThan(1);
    await userEvent.click(screen.getByRole('radio', { name: 'Clase muestra' }));
    expect(screen.getByRole('option', { name: /Clase muestra.*100/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$100.00 MXN');
    await userEvent.click(screen.getByRole('button', { name: 'Usar tema oscuro' }));
    expect(document.querySelector('.registration-type-jelly')).toHaveStyle({ '--jr-h': '36px' });
  });
  it('shows method-specific cash, card, and transfer details and submits without acknowledgements', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.click(screen.getByRole('button', { name: /proceder al cobro|revisar cobro/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    expect(screen.getByLabelText('Monto recibido')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Monto recibido'), '1000');
    expect(within(screen.getByText('Cambio a devolver:').parentElement!).getByText('$500.00 MXN')).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    expect(screen.getByText(/comisión estimada/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Transferencia' }));
    expect(screen.getByText(/T03/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('uses the shared cash calculator with exact payment and decimal validation', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.click(screen.getByRole('button', { name: /proceder al cobro|revisar cobro/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    const input = screen.getByLabelText('Monto recibido');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    await userEvent.type(input, '1000');
    expect(screen.getByText('Cambio a devolver:')).toBeVisible();
    expect(within(screen.getByText('Cambio a devolver:').parentElement!).getByText('$500.00 MXN')).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, '1.234');
    expect(screen.getByText('Monto inválido')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Pago exacto' }));
    expect(input).toHaveValue('500.00');
  });
  it('blocks cash registration when the tendered amount is below the current total', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.click(screen.getByRole('button', { name: /proceder al cobro|revisar cobro/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.type(screen.getByLabelText('Monto recibido'), '100');
    expect(screen.getByRole('alert')).toHaveTextContent(/Faltan.*400\.00/);
    await userEvent.click(screen.getByRole('button', { name: /registrar operación/i }));
    expect(screen.getByRole('dialog', { name: 'Confirmar saldo pendiente' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Registro guardado' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Torres');
  });
  it('allows a student-rate plan without a verification checkbox or gate', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Alex Ruiz');
    await userEvent.click(screen.getByRole('option', { name: /Gym estudiante/i }));
    await userEvent.click(screen.getByRole('button', { name: /proceder al cobro|revisar cobro/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.type(screen.getByLabelText('Monto recibido'), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar operación' }));
    expect(screen.getByRole('heading', { name: 'Registro guardado' })).toBeVisible();
  });
  it('reuses the current purchase checkout without member assignment', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    const currentPurchaseHeading = screen.getByRole('heading', { name: 'Compra actual' });
    expect(currentPurchaseHeading).toBeVisible();
    expect(currentPurchaseHeading.closest('section')).toHaveClass('cart-checkout-panel');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.click(screen.getByRole('button', { name: /proceder al cobro|revisar cobro/i }));
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Asignar socio' })).not.toBeInTheDocument();
  });
  it('shows a live draft assignment for membership and trial, but never for visits', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    expect(screen.getByText('Ana Torres')).toBeVisible();
    expect(screen.getByText('Asignación de borrador')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Teléfono (opcional)'), '5551234');
    expect(screen.getByText('Tel: 5551234')).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Visita' }));
    expect(screen.queryByText('Asignación de borrador')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Membresía' }));
    expect(screen.getByText('Ana Torres')).toBeVisible();
    expect(screen.getByText('Tel: 5551234')).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Clase muestra' }));
    expect(screen.getByText('Asignación de borrador')).toBeVisible();
  });
  it('places details before a bounded checkout column in the registration layout', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    const form = document.querySelector('.new-registration-form')!;
    expect(form).toHaveClass('new-registration-form');
    expect(form.parentElement).toHaveClass('registration-checkout');
      expect(document.querySelector('.registration-panel')).toBeNull();
    const details = form.querySelector('.registration-main')!;
    const checkout = form.querySelector('.registration-current-purchase')!;
      expect(details.querySelector('.registration-details-card')).toBeInTheDocument();
      expect(checkout).toHaveClass('current-purchase-card');
    expect(details.compareDocumentPosition(checkout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('reviews a cash payment, records it and leaves access dates unresolved', async () => {
    await mount('/reception/members/demo-002/payment');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar pago' }));
    expect(screen.getByRole('heading', { name: 'Revisar pago de membresía' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(screen.getByRole('heading', { name: 'Pago completo registrado' })).toBeVisible();
    expect(screen.getByText(/Operación registrada localmente\. No activa acceso/)).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Ver socio' }));
    expect(screen.queryByText('Pagado · fechas por definir')).not.toBeInTheDocument();
    expect(screen.getAllByText('Pagado').length).toBeGreaterThan(0);
  });
  it('does not present a transfer as paid', async () => {
    await mount('/reception/members/demo-002/payment');
    await userEvent.selectOptions(screen.getByLabelText('Método'), 'transfer');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar pago' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar transferencia pendiente' }));
    expect(screen.getByRole('heading', { name: 'Transferencia sin confirmar' })).toBeVisible();
    expect(screen.queryByText('Pago completo registrado')).not.toBeInTheDocument();
  });
  it('renders owner member analytics in /owner/members and keeps reception view clean', async () => {
    await mount('/owner/members');
    expect(screen.getByRole('region', { name: 'Analítica de socios y membresías' })).toBeVisible();
    expect(screen.getByText('Directorio y análisis de socios')).toBeVisible();
    expect(screen.getByText('Socios Activos')).toBeVisible();
    expect(screen.getByText('Antigüedad (Mediana)')).toBeVisible();
    expect(screen.getByText('Desglose por disciplina y plan')).toBeVisible();
  });
  it('does not render owner analytics in reception view', async () => {
    await mount('/reception/members');
    expect(screen.queryByRole('region', { name: 'Analítica de socios y membresías' })).not.toBeInTheDocument();
    expect(screen.getByText('Socios y membresías')).toBeVisible();
  });
  it('opens the registration summary without submitting the draft', async () => {
    await mount('/reception/members/new');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.click(document.querySelector('.mobile-detail-trigger')!);
    expect(screen.getByRole('dialog', { name: 'Resumen del registro' })).toBeVisible();
    expect(screen.getByText('Ana Torres')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Registro guardado' })).not.toBeInTheDocument();
    await userEvent.click(document.querySelector('.mobile-detail-close')!);
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Torres');
  });
  it('triggers getMemberReload and passes reload data to MemberCounterView when operational token is present in sessionStorage', async () => {
    sessionStorage.setItem('evogym:operational-session', 'test-operational-token');
    const mockReloadData: memberReadsApi.MemberReloadResponse = {
      profile: {
        id: 'demo-active',
        organization_id: 'org-1',
        home_branch_id: 'branch-1',
        member_number: 'SOC-ACTIVE',
        full_name: 'Alex Morgan',
        preferred_name: null,
        phone: '5550000003',
        email: 'alex@example.com',
        birth_date: null,
        joined_on: '2026-01-01',
        status: 'active',
        photo_url: null,
        emergency_contact_name: null,
        emergency_contact_phone: null,
      },
      active_periods: [
        {
          id: 'period-1',
          order_item_id: 'oi-1',
          plan_version_id: 'pv-1',
          plan_name: 'Membresía Activa Sincronizada',
          starts_on: '2026-10-01',
          ends_on: '2026-11-01',
          branch_id: null,
          is_current: true,
          access_status: 'eligible',
        },
      ],
      class_samples: [],
      financial: {
        has_pending_balance: false,
        credit_balance_minor: 0,
        total_pending_balance_minor: null,
        currency: 'MXN',
        debts: [],
      },
      recent_visits: [],
      server_time: '2026-10-23T12:00:00.000Z',
    };

    const reloadSpy = vi.spyOn(memberReadsApi, 'getMemberReload').mockResolvedValue(mockReloadData);

    try {
      await mount('/reception/members/demo-active');

      expect(reloadSpy).toHaveBeenCalledWith('demo-active', 'test-operational-token');
      expect(screen.queryByText('Estado sincronizado del socio')).not.toBeInTheDocument();
      expect(await screen.findByText('Membresía Activa Sincronizada')).toBeVisible();
    } finally {
      sessionStorage.clear();
      reloadSpy.mockRestore();
    }
  });

  describe('F05 live member check-in flow', () => {
    const mockReload: memberReadsApi.MemberReloadResponse = {
      profile: {
        id: 'member-f05',
        organization_id: 'org-1',
        home_branch_id: 'branch-1',
        member_number: 'SOC-F05',
        full_name: 'Carlos Santana',
        preferred_name: null,
        phone: '5551234567',
        email: 'carlos@example.com',
        birth_date: null,
        joined_on: '2026-01-01',
        status: 'active',
        photo_url: null,
        emergency_contact_name: null,
        emergency_contact_phone: null,
      },
      active_periods: [
        {
          id: 'period-f05',
          order_item_id: 'oi-f05',
          plan_version_id: 'pv-f05',
          plan_name: 'Membresía Activa F05',
          starts_on: '2026-10-01',
          ends_on: '2026-11-01',
          branch_id: 'branch-1',
          is_current: true,
          access_status: 'eligible',
        },
      ],
      class_samples: [],
      financial: {
        has_pending_balance: false,
        credit_balance_minor: 0,
        total_pending_balance_minor: null,
        currency: 'MXN',
        debts: [],
      },
      recent_visits: [],
      server_time: '2026-10-27T12:00:00.000Z',
    };

    const mockDetailMember = {
      id: 'member-f05',
      name: 'Carlos Santana',
      phone: '5551234567',
      creditMinor: 0,
      membership: null,
      joinedOn: '2026-01-01',
    };

    it('renders Mostrador by default with live reload data and Asistencia previa', () => {
      render(
        <MemoryRouter>
          <MemberDetail
            role="RECEPTION"
            liveData={{
              member: mockDetailMember,
              reload: mockReload,
              notes: null,
              status: 'active',
              isAdmin: false,
            }}
          />
        </MemoryRouter>
      );

      const counterTab = screen.getByRole('tab', { name: 'Mostrador' });
      expect(counterTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('heading', { name: 'Asistencia previa' })).toBeVisible();
      expect(screen.queryByText('Mostrador no disponible')).not.toBeInTheDocument();
    });

    it('enables Registrar entrada when eligible and displays success feedback after check-in', async () => {
      const onCheckIn = vi.fn().mockResolvedValue({ ok: true, message: 'Entrada registrada.' });
      render(
        <MemoryRouter>
          <MemberDetail
            role="RECEPTION"
            liveData={{
              member: mockDetailMember,
              reload: mockReload,
              notes: null,
              status: 'active',
              isAdmin: false,
              onCheckIn,
            }}
          />
        </MemoryRouter>
      );

      const checkInBtn = screen.getByRole('button', { name: 'Registrar entrada' });
      expect(checkInBtn).toBeEnabled();

      await userEvent.click(checkInBtn);
      expect(onCheckIn).toHaveBeenCalledTimes(1);

      const feedback = screen.getByRole('status', { name: 'Resultado de asistencia' });
      expect(feedback).toHaveTextContent('Entrada registrada.');
    });

    it('disables Registrar entrada when access_status is not eligible', () => {
      const expiredReload: memberReadsApi.MemberReloadResponse = {
        ...mockReload,
        active_periods: [
          {
            ...mockReload.active_periods[0],
            access_status: 'expired',
          },
        ],
      };

      render(
        <MemoryRouter>
          <MemberDetail
            role="RECEPTION"
            liveData={{
              member: mockDetailMember,
              reload: expiredReload,
              notes: null,
              status: 'expired',
              isAdmin: false,
              onCheckIn: vi.fn(),
            }}
          />
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: 'Registrar entrada' })).toBeDisabled();
    });

    it('records check-in via ApiMemberDetail and reuses idempotency key on retry', async () => {
      let callCount = 0;
      const idempotencyKeysUsed: string[] = [];

      const mockRequest = vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/v1/members/member-f05') {
          return new Response(JSON.stringify({
            ...mockDetailMember,
            member_number: 'SOC-F05',
            full_name: 'Carlos Santana',
            preferred_name: null,
            email: null,
            birth_date: null,
            notes: null,
            status: 'active',
            credit_balance_minor: 0,
            pending_balance_minor: 0,
            has_pending_balance: false,
            emergency_contact_name: null,
            emergency_contact_phone: null,
            photo_url: null,
          }));
        }
        if (path === '/api/v1/members/member-f05/reload?visit_limit=12') {
          return new Response(JSON.stringify(mockReload));
        }
        if (path.startsWith('/api/v1/member-check-ins/branches/')) {
          callCount += 1;
          const headers = (init?.headers ?? {}) as Record<string, string>;
          const key = headers['Idempotency-Key'] || headers['idempotency-key'];
          if (key) idempotencyKeysUsed.push(key);

          if (callCount === 1) {
            return new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500 });
          }
          return new Response(JSON.stringify({
            id: 'checkin-1',
            visit_id: 'visit-1',
            member_id: 'member-f05',
            period_id: 'period-f05',
            branch_id: 'branch-1',
            recorded_by: 'staff-1',
            occurred_at: '2026-10-27T12:00:00Z',
            access_reason: 'eligible',
            access_warnings: [],
            replayed: false,
          }), { status: 201 });
        }
        return new Response('{}');
      });

      render(
        <MemoryRouter initialEntries={['/reception/members/member-f05']}>
          <ApiMemberDetail role="RECEPTION" request={mockRequest} isAdmin={false} />
        </MemoryRouter>
      );

      expect(await screen.findByRole('button', { name: 'Registrar entrada' })).toBeVisible();

      await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
      expect(await screen.findByRole('alert', { name: 'Resultado de asistencia' })).toHaveTextContent(/No se pudo registrar la entrada|Internal server error/);

      await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
      expect(await screen.findByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Entrada registrada.');

      expect(idempotencyKeysUsed.length).toBe(2);
      expect(idempotencyKeysUsed[0]).toBe(idempotencyKeysUsed[1]);
      expect(idempotencyKeysUsed[0]).toMatch(/^checkin-/);
    });
  });

  describe('F02 members lifecycle', () => {
    const fixtureMember = {
      id: 'member-f02-1',
      member_number: 'M-F02-100',
      full_name: 'Elena Morales',
      preferred_name: 'Ele',
      phone: '5551112233',
      email: 'elena@example.com' as string | null,
      status: 'active',
      joined_on: '2026-10-27',
      credit_balance_minor: 0,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      photo_url: null,
      birth_date: null,
      notes: null,
      pending_balance_minor: 0,
      has_pending_balance: false,
    };

    const fixtureReload = {
      profile: {
        ...fixtureMember,
        organization_id: 'org-1',
        home_branch_id: 'branch-1',
      },
      active_periods: [
        {
          id: 'period-f02',
          order_item_id: 'order-item-f02',
          plan_version_id: 'plan-f02',
          plan_name: 'Mensualidad Estándar',
          starts_on: '2026-10-01',
          ends_on: '2026-10-31',
          branch_id: 'branch-1',
          is_current: true,
          access_status: 'eligible' as const,
        },
      ],
      class_samples: [],
      financial: {
        has_pending_balance: false,
        credit_balance_minor: 0,
        total_pending_balance_minor: 0,
        currency: 'MXN' as const,
        debts: [],
      },
      recent_visits: [],
      server_time: '2026-10-27T12:00:00Z',
    };

    it('shows both "Nuevo socio" and "Actualizar" in live directory, creates a member, and edits pre-filled legal full_name', async () => {
      let currentMember = { ...fixtureMember };
      const requests: { path: string; init?: RequestInit }[] = [];

      const mockRequest = vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path.startsWith('/api/v1/members?page=')) {
          return new Response(JSON.stringify({
            items: [currentMember],
            total: 1,
            page: 1,
            limit: 100,
            pages: 1,
          }));
        }
        if (path === '/api/v1/members' && init?.method === 'POST') {
          const body = JSON.parse(init?.body as string);
          expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
          expect(body.full_name).toBe('Elena Morales');
          expect(body.phone).toBe('5551112233');
          expect(body.email).toBe('elena@example.com');
          return new Response(JSON.stringify(currentMember), { status: 201 });
        }
        if (path === `/api/v1/members/${currentMember.id}` && init?.method === 'PATCH') {
          const body = JSON.parse(init?.body as string);
          expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
          expect(body).toEqual({
            full_name: 'Elena Morales',
            phone: '5559998877',
            email: null,
          });
          currentMember = { ...currentMember, phone: '5559998877', email: null };
          return new Response(JSON.stringify(currentMember), { status: 200 });
        }
        if (path === `/api/v1/members/${currentMember.id}`) {
          return new Response(JSON.stringify(currentMember));
        }
        if (path.includes('/reload')) {
          return new Response(JSON.stringify({
            ...fixtureReload,
            profile: currentMember,
          }));
        }
        return new Response('{}');
      });

      // 1. Live directory shows both "Nuevo socio" and "Actualizar"
      const { unmount: unmountDir } = render(
        <MemoryRouter initialEntries={['/reception/members']}>
          <ApiMembers role="RECEPTION" request={mockRequest} />
        </MemoryRouter>
      );
      expect(await screen.findByRole('link', { name: 'Nuevo socio' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Actualizar' })).toBeVisible();
      unmountDir();

      // 2. Submitting create form sends POST /api/v1/members
      const { unmount: unmountCreate } = render(
        <MemoryRouter initialEntries={['/reception/members/new']}>
          <ApiNewMember role="RECEPTION" request={mockRequest} />
        </MemoryRouter>
      );
      await userEvent.type(screen.getByLabelText('Nombre completo'), 'Elena Morales');
      await userEvent.type(screen.getByLabelText('Teléfono'), '5551112233');
      await userEvent.type(screen.getByLabelText('Correo electrónico (opcional)'), 'elena@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Registrar socio' }));
      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledWith('/api/v1/members', expect.objectContaining({ method: 'POST' }));
      });
      unmountCreate();

      // 3. Editing pre-fills legal full_name (not preferred_name "Ele"), sends PATCH, and updates detail
      render(
        <MemoryRouter initialEntries={[`/reception/members/${currentMember.id}`]}>
          <ApiMemberDetail role="RECEPTION" request={mockRequest} isAdmin={false} />
        </MemoryRouter>
      );
      expect(await screen.findByRole('button', { name: 'Editar datos' })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Editar datos' }));

      // Legal name "Elena Morales" must be pre-filled, NOT preferred_name "Ele"!
      const nameInput = screen.getByLabelText('Nombre completo') as HTMLInputElement;
      const phoneInput = screen.getByLabelText('Teléfono') as HTMLInputElement;
      const emailInput = screen.getByLabelText('Correo electrónico (opcional)') as HTMLInputElement;
      expect(nameInput.value).toBe('Elena Morales');
      expect(phoneInput.value).toBe('5551112233');
      expect(emailInput.value).toBe('elena@example.com');

      // Update phone and clear email
      await userEvent.clear(phoneInput);
      await userEvent.type(phoneInput, '5559998877');
      await userEvent.clear(emailInput);
      await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledWith(
          `/api/v1/members/${currentMember.id}`,
          expect.objectContaining({ method: 'PATCH' })
        );
      });
    });

    it('surfaces alert on 422/409/500, preserves typed form values, and never fabricates saved state', async () => {
      const mockFailRequest = vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/v1/members' && init?.method === 'POST') {
          return new Response(JSON.stringify({ detail: 'Teléfono inválido.' }), { status: 422 });
        }
        if (init?.method === 'PATCH') {
          return new Response(JSON.stringify({ detail: 'Error de servidor.' }), { status: 500 });
        }
        if (path.includes('/reload')) {
          return new Response(JSON.stringify(fixtureReload));
        }
        return new Response(JSON.stringify(fixtureMember));
      });

      // 1. Error on create preserves input values
      const { unmount } = render(
        <MemoryRouter initialEntries={['/reception/members/new']}>
          <ApiNewMember role="RECEPTION" request={mockFailRequest} />
        </MemoryRouter>
      );
      const nameInput = screen.getByLabelText('Nombre completo');
      const phoneInput = screen.getByLabelText('Teléfono');
      await userEvent.type(nameInput, 'Persona Rechazada');
      await userEvent.type(phoneInput, '0000');
      await userEvent.click(screen.getByRole('button', { name: 'Registrar socio' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Teléfono inválido.');
      expect(nameInput).toHaveValue('Persona Rechazada');
      expect(phoneInput).toHaveValue('0000');
      unmount();

      // 2. Error on edit preserves input values
      render(
        <MemoryRouter initialEntries={[`/reception/members/${fixtureMember.id}`]}>
          <ApiMemberDetail role="RECEPTION" request={mockFailRequest} isAdmin={false} />
        </MemoryRouter>
      );
      expect(await screen.findByRole('button', { name: 'Editar datos' })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Editar datos' }));
      const editPhoneInput = screen.getByLabelText('Teléfono');
      await userEvent.clear(editPhoneInput);
      await userEvent.type(editPhoneInput, '999');
      await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

      expect(await screen.findByRole('alert')).toBeVisible();
      expect(editPhoneInput).toHaveValue('999');
    });

    it('OWNER loads and posts durable notes via /notes with zero DemoProvider mounted; RECEPTION cannot see note controls; F05 check-in continues to work', async () => {
      const notesList = [
        {
          id: 'note-f02-1',
          member_id: fixtureMember.id,
          author_id: 'admin-1',
          body: 'Nota existente de dirección',
          created_at: '2026-10-27T10:00:00Z',
          voided_at: null,
          voided_by: null,
          is_voided: false,
        },
      ];

      const requestedPaths: string[] = [];
      const mockRequest = vi.fn(async (path: string, init?: RequestInit) => {
        requestedPaths.push(path);
        if (path === `/api/v1/members/${fixtureMember.id}`) {
          return new Response(JSON.stringify(fixtureMember));
        }
        if (path.includes('/reload')) {
          return new Response(JSON.stringify(fixtureReload));
        }
        if (path === `/api/v1/members/${fixtureMember.id}/notes` && init?.method === 'POST') {
          const body = JSON.parse(init?.body as string);
          expect(body.body).toBe('Socio solicita factura mensual');
          const created = {
            id: 'note-f02-2',
            member_id: fixtureMember.id,
            author_id: 'admin-1',
            body: body.body,
            created_at: '2026-10-27T11:00:00Z',
            voided_at: null,
            voided_by: null,
            is_voided: false,
          };
          notesList.unshift(created);
          return new Response(JSON.stringify(created), { status: 201 });
        }
        if (path === `/api/v1/members/${fixtureMember.id}/notes`) {
          return new Response(JSON.stringify(notesList));
        }
        if (path.startsWith('/api/v1/member-check-ins/branches/')) {
          return new Response(JSON.stringify({
            id: 'checkin-f02',
            visit_id: 'visit-f02',
            member_id: fixtureMember.id,
            period_id: 'period-f02',
            branch_id: 'branch-1',
            recorded_by: 'staff-1',
            occurred_at: '2026-10-27T12:00:00Z',
            access_reason: 'eligible',
            access_warnings: [],
            replayed: false,
          }), { status: 201 });
        }
        return new Response('{}');
      });

      // 1. RECEPTION: No /notes request, no note controls visible, F05 check-in works
      const { unmount: unmountRecep } = render(
        <MemoryRouter initialEntries={[`/reception/members/${fixtureMember.id}`]}>
          <ApiMemberDetail role="RECEPTION" request={mockRequest} isAdmin={false} />
        </MemoryRouter>
      );
      expect(await screen.findByRole('button', { name: 'Registrar entrada' })).toBeVisible();
      expect(requestedPaths.some(p => p.includes('/notes'))).toBe(false);
      expect(screen.queryByRole('button', { name: '+ Agregar nota' })).not.toBeInTheDocument();
      expect(screen.queryByText('Atención al socio')).not.toBeInTheDocument();

      // Check-in still works (F05 preservation)
      await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
      expect(await screen.findByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Entrada registrada.');
      unmountRecep();

      // 2. OWNER: Zero DemoProvider mounted, /notes requested and displayed, can post new note
      requestedPaths.length = 0;
      render(
        <MemoryRouter initialEntries={[`/owner/members/${fixtureMember.id}`]}>
          <ApiMemberDetail role="OWNER" request={mockRequest} isAdmin={true} />
        </MemoryRouter>
      );

      // Verify /notes was called
      expect(await screen.findByRole('heading', { name: 'Atención al socio' })).toBeVisible();
      expect(requestedPaths.some(p => p.includes('/notes'))).toBe(true);
      expect(screen.getByText('Nota existente de dirección')).toBeInTheDocument();

      // Post new note
      await userEvent.click(screen.getByRole('button', { name: '+ Agregar nota' }));
      const noteInput = screen.getByLabelText('Nueva nota');
      await userEvent.type(noteInput, 'Socio solicita factura mensual');
      await userEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));

      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledWith(
          `/api/v1/members/${fixtureMember.id}/notes`,
          expect.objectContaining({ method: 'POST' })
        );
      });
      expect(await screen.findByText('Socio solicita factura mensual')).toBeInTheDocument();
    });

    it('opens LiveMembershipCheckout from member detail, completes cash sale, and refreshes hero badge and period via reload', async () => {
      const memberWithoutPlan = {
        ...fixtureMember,
        id: 'member-f04-sale',
        full_name: 'Marcos Venta',
        preferred_name: null,
        status: 'inactive' as const,
      };

      const reloadWithoutPlan = {
        ...fixtureReload,
        profile: { ...memberWithoutPlan, organization_id: 'org-1', home_branch_id: 'branch-1' },
        active_periods: [],
        financial: {
          has_pending_balance: false,
          credit_balance_minor: 0,
          total_pending_balance_minor: 0,
          currency: 'MXN' as const,
          debts: [],
        },
      };

      const reloadWithPlan = {
        ...reloadWithoutPlan,
        active_periods: [
          {
            id: 'period-f04-new',
            order_item_id: 'item-f04-new',
            plan_version_id: 'version-f04-1',
            plan_name: 'Mensual Pro',
            starts_on: '2026-11-01',
            ends_on: '2026-11-30',
            branch_id: 'branch-1',
            is_current: true,
            access_status: 'eligible' as const,
          },
        ],
      };

      let currentReload: memberReadsApi.MemberReloadResponse = reloadWithoutPlan;

      const mockCatalogPlan = {
        id: 'plan-f04-1',
        name: 'Mensual Pro',
        current_version: {
          id: 'version-f04-1',
          name: 'Mensual Pro v1',
          price_minor: 65000,
        },
      };
      const mockRegister = {
        id: 'register-f04-1',
        name: 'Caja Principal',
        has_open_shift: true,
      };
      const mockShift = {
        id: 'shift-f04-1',
        cash_register_id: 'register-f04-1',
      };

      const mockRequest = vi.fn(async (path: string, init?: RequestInit) => {
        if (path.includes('/reload')) {
          return new Response(JSON.stringify(currentReload));
        }
        if (path === `/api/v1/members/${memberWithoutPlan.id}`) {
          return new Response(JSON.stringify(memberWithoutPlan));
        }
        if (path.includes('/api/v1/catalog/plans')) {
          return new Response(JSON.stringify([mockCatalogPlan]));
        }
        if (path === '/api/v1/registers') {
          return new Response(JSON.stringify([mockRegister]));
        }
        if (path.includes('/api/v1/shifts/current')) {
          return new Response(JSON.stringify(mockShift));
        }
        if (path.includes('/membership-sales') && init?.method === 'POST') {
          currentReload = reloadWithPlan;
          return new Response(JSON.stringify({
            order: { id: 'order-f04' },
            item: { id: 'item-f04' },
            payment: { status: 'confirmed' },
            membership: {
              id: 'mem-f04',
              starts_on: '2026-11-01',
              ends_on: '2026-11-30',
            },
          }), { status: 201 });
        }
        return new Response('{}');
      });

      render(
        <MemoryRouter initialEntries={[`/reception/members/${memberWithoutPlan.id}`]}>
          <ApiMemberDetail role="RECEPTION" request={mockRequest} isAdmin={false} />
        </MemoryRouter>
      );

      // Verify initial state: inactive status tone/badge, check-in button disabled
      expect(await screen.findByRole('button', { name: 'Registrar entrada' })).toBeDisabled();
      expect(screen.getByText('Inactivo')).toBeInTheDocument();

      // Open checkout
      const sellBtn = screen.getByRole('button', { name: 'Vender membresía' });
      await userEvent.click(sellBtn);

      // Dialog opens
      expect(await screen.findByRole('heading', { name: /Venta de membresía · Marcos Venta/i })).toBeVisible();

      // Select plan and register
      const planSelect = screen.getByLabelText('Plan de membresía');
      await userEvent.selectOptions(planSelect, mockCatalogPlan.id);

      const regSelect = screen.getByLabelText('Caja abierta');
      await userEvent.selectOptions(regSelect, mockRegister.id);

      expect(await screen.findByText('Turno abierto confirmado: shift-f04-1')).toBeVisible();

      // Submit cash sale (blank amount pays full)
      const submitBtn = screen.getByRole('button', { name: 'Cobrar en efectivo' });
      await userEvent.click(submitBtn);

      // Result screen
      expect(await screen.findByText('Pago confirmado.')).toBeVisible();
      expect(screen.getByText('Membresía activada por el backend: 2026-11-01 a 2026-11-30.')).toBeVisible();

      // Close modal
      await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

      // Verify modal is closed
      expect(screen.queryByRole('heading', { name: /Venta de membresía · Marcos Venta/i })).not.toBeInTheDocument();

      // Verify hero badge updated to "Elegible" and check-in button enabled
      await waitFor(() => {
        expect(screen.getAllByText('Elegible').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByRole('button', { name: 'Registrar entrada' })).toBeEnabled();
      expect(screen.getByText(/2026-11-01 al 2026-11-30/)).toBeInTheDocument();
    });

    it('blocks checkout when no register has an open shift, and displays warning notice and debt badge on partial cash sale', async () => {
      const memberDebt = {
        ...fixtureMember,
        id: 'member-f04-debt',
        full_name: 'David Deuda',
        preferred_name: null,
        status: 'active' as const,
      };

      const reloadNoDebt = {
        ...fixtureReload,
        profile: { ...memberDebt, organization_id: 'org-1', home_branch_id: 'branch-1' },
        financial: {
          has_pending_balance: false,
          credit_balance_minor: 0,
          total_pending_balance_minor: 0,
          currency: 'MXN' as const,
          debts: [],
        },
      };

      const reloadWithDebt = {
        ...reloadNoDebt,
        financial: {
          has_pending_balance: true,
          credit_balance_minor: 0,
          total_pending_balance_minor: 25000,
          currency: 'MXN' as const,
          debts: [
            {
              debt_id: 'debt-1',
              order_id: 'order-f04-debt',
              branch_id: 'branch-1',
              currency: 'MXN' as const,
              initial_outstanding_minor: 25000,
              remaining_balance_minor: 25000,
              created_at: '2026-10-28T12:00:00Z',
            },
          ],
        },
      };

      let currentReload: memberReadsApi.MemberReloadResponse = reloadNoDebt;
      let registers = [{ id: 'register-closed-1', name: 'Caja Cerrada', has_open_shift: false }];

      const mockCatalogPlan = {
        id: 'plan-f04-2',
        name: 'Mensual 500',
        current_version: {
          id: 'version-f04-2',
          name: 'v2',
          price_minor: 50000,
        },
      };

      const mockRequest = vi.fn(async (path: string, init?: RequestInit) => {
        if (path.includes('/reload')) {
          return new Response(JSON.stringify(currentReload));
        }
        if (path === `/api/v1/members/${memberDebt.id}`) {
          return new Response(JSON.stringify(memberDebt));
        }
        if (path.includes('/api/v1/catalog/plans')) {
          return new Response(JSON.stringify([mockCatalogPlan]));
        }
        if (path === '/api/v1/registers') {
          return new Response(JSON.stringify(registers));
        }
        if (path.includes('/api/v1/shifts/current')) {
          return new Response(JSON.stringify({ id: 'shift-f04-open', cash_register_id: 'register-open-1' }));
        }
        if (path.includes('/membership-sales') && init?.method === 'POST') {
          currentReload = reloadWithDebt;
          return new Response(JSON.stringify({
            order: { id: 'order-f04-debt' },
            item: { id: 'item-f04-debt' },
            payment: { status: 'confirmed' },
            membership: {
              id: 'mem-f04-debt',
              starts_on: '2026-11-01',
              ends_on: '2026-11-30',
            },
          }), { status: 201 });
        }
        return new Response('{}');
      });

      const { unmount } = render(
        <MemoryRouter initialEntries={[`/reception/members/${memberDebt.id}`]}>
          <ApiMemberDetail role="RECEPTION" request={mockRequest} isAdmin={false} />
        </MemoryRouter>
      );

      // Open checkout with closed registers
      await userEvent.click(await screen.findByRole('button', { name: 'Vender membresía' }));
      expect(await screen.findByText('No hay cajas con turno abierto.')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Cobrar en efectivo' })).toBeDisabled();

      unmount();

      // Now open checkout with an open register
      registers = [{ id: 'register-open-1', name: 'Caja Abierta', has_open_shift: true }];
      render(
        <MemoryRouter initialEntries={[`/reception/members/${memberDebt.id}`]}>
          <ApiMemberDetail role="RECEPTION" request={mockRequest} isAdmin={false} />
        </MemoryRouter>
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Vender membresía' }));
      await userEvent.selectOptions(await screen.findByLabelText('Plan de membresía'), mockCatalogPlan.id);
      await userEvent.selectOptions(screen.getByLabelText('Caja abierta'), 'register-open-1');

      // Enter partial cash amount (250 < 500)
      const cashInput = screen.getByLabelText('Efectivo recibido en MXN (opcional; vacío cobra el precio completo)');
      await userEvent.type(cashInput, '250');
      expect(screen.getByText(/El monto en efectivo es menor al precio publicado; se registrará un saldo pendiente informativo/)).toBeVisible();

      // Submit partial sale
      await userEvent.click(screen.getByRole('button', { name: 'Cobrar en efectivo' }));
      expect(await screen.findByText('Pago confirmado.')).toBeVisible();

      // Close modal
      await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

      // Verify pending balance alert appears in MemberCounterView
      expect(await screen.findByTestId('balance-warning-alert')).toBeVisible();
      expect(screen.getByText(/Saldo pendiente registrado/)).toBeVisible();
    });

    it('F06: opens Liquidar adeudo from member detail, posts cash debt payment, and clears pending balance warning after reload', async () => {
      const memberWithDebt = {
        ...fixtureMember,
        id: 'member-f06-repay',
        full_name: 'Sofía Abono',
        preferred_name: null,
        status: 'active' as const,
        pending_balance_minor: 20000,
        has_pending_balance: true,
      };

      const reloadWithOpenDebt: memberReadsApi.MemberReloadResponse = {
        ...fixtureReload,
        profile: { ...memberWithDebt, organization_id: 'org-1', home_branch_id: 'branch-1' },
        financial: {
          has_pending_balance: true,
          credit_balance_minor: 0,
          total_pending_balance_minor: null,
          currency: 'MXN',
          debts: [],
        },
      };

      const reloadAfterSettled: memberReadsApi.MemberReloadResponse = {
        ...reloadWithOpenDebt,
        financial: {
          has_pending_balance: false,
          credit_balance_minor: 0,
          total_pending_balance_minor: null,
          currency: 'MXN',
          debts: [],
        },
      };

      let currentReload = reloadWithOpenDebt;
      let currentMember = memberWithDebt;

      const mockRequest = vi.fn(async (path: string, init?: RequestInit) => {
        if (path.includes('/reload')) {
          return new Response(JSON.stringify(currentReload));
        }
        if (path === `/api/v1/members/${memberWithDebt.id}`) {
          return new Response(JSON.stringify(currentMember));
        }
        if (path.includes('/api/v1/catalog/plans')) {
          return new Response(JSON.stringify([]));
        }
        if (path === '/api/v1/registers') {
          return new Response(JSON.stringify([{ id: 'reg-f06-open', name: 'Caja Principal', has_open_shift: true }]));
        }
        if (path.includes('/api/v1/shifts/current')) {
          return new Response(JSON.stringify({ id: 'shift-f06-open', cash_register_id: 'reg-f06-open' }));
        }
        if (path === `/api/v1/registers/reg-f06-open/members/${memberWithDebt.id}/debts`) {
          return new Response(JSON.stringify([
            {
              debt_id: 'debt-f06-order-1',
              order_id: 'order-f06-1',
              member_id: memberWithDebt.id,
              branch_id: 'branch-1',
              currency: 'MXN',
              description_snapshot: 'Mensualidad Estándar',
              initial_outstanding_minor: 20000,
              paid_amount_minor: 0,
              remaining_balance_minor: 20000,
              created_at: '2026-10-28T10:00:00Z',
            },
          ]));
        }
        if (path === '/api/v1/registers/reg-f06-open/membership-debt-payments' && init?.method === 'POST') {
          currentReload = reloadAfterSettled;
          currentMember = { ...memberWithDebt, pending_balance_minor: 0, has_pending_balance: false };
          return new Response(JSON.stringify({
            id: 'receipt-f06-settled',
            debt_id: 'debt-f06-order-1',
            order_id: 'order-f06-1',
            member_id: memberWithDebt.id,
            branch_id: 'branch-1',
            register_id: 'reg-f06-open',
            shift_id: 'shift-f06-open',
            amount_minor: 20000,
            remaining_balance_minor: 0,
            received_by: 'staff-1',
            received_at: '2026-10-28T12:00:00Z',
          }), { status: 201 });
        }
        return new Response('{}');
      });

      render(
        <MemoryRouter initialEntries={[`/reception/members/${memberWithDebt.id}`]}>
          <ApiMemberDetail role="RECEPTION" request={mockRequest} isAdmin={false} />
        </MemoryRouter>,
      );

      expect(await screen.findByTestId('balance-warning-alert')).toBeVisible();
      const payDebtBtn = screen.getByRole('button', { name: 'Liquidar adeudo' });
      await userEvent.click(payDebtBtn);

      expect(await screen.findByRole('heading', { name: /Liquidar adeudo · Sofía Abono/i })).toBeVisible();
      expect(await screen.findByLabelText('Adeudo pendiente')).toHaveValue('order-f06-1');
      expect(screen.getByLabelText('Monto a abonar (MXN)')).toHaveValue(200);

      await userEvent.click(screen.getByRole('button', { name: 'Registrar abono en efectivo' }));
      expect(await screen.findByRole('heading', { name: 'Abono registrado' })).toBeVisible();
      expect(screen.getByText(/Adeudo liquidado en su totalidad/)).toBeVisible();

      await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
      await waitFor(() => {
        expect(screen.queryByTestId('balance-warning-alert')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Al corriente en pagos')).toBeVisible();
    });
  });
});
