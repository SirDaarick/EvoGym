import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const tableCallGuard = vi.hoisted(() => ({ active: false, calls: 0 }));

vi.mock('@tanstack/react-table', async importOriginal => {
  const actual = await importOriginal<typeof import('@tanstack/react-table')>();
  return {
    ...actual,
    useReactTable: (...args: Parameters<typeof actual.useReactTable>) => {
      if (tableCallGuard.active && ++tableCallGuard.calls > 40) {
        throw new Error('Membership table exceeded the 40-call render safety bound.');
      }
      return actual.useReactTable(...args);
    },
  };
});
import { AttendanceCalendar } from '../attendance/AttendanceCalendar';
import { MemberCounterView, MemberDetailSections } from './MemberDetail';
import type { MemberReloadResponse } from '../../api/memberReadsApi';
import { rentalStatus } from './memberDetailUtils';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';
import { MemoryRouter, useLocation } from 'react-router';
import { setSelectedStaff } from '../staff/staffStore';

function RouteProbe() {
  const location = useLocation();
  return <output data-testid="current-route">{location.pathname}</output>;
}

describe('member detail presentation', () => {
  it('navigates back from a member detail route to the members list', async () => {
    render(<MemoryRouter initialEntries={['/reception/members/demo-001']}><DemoProvider><><App /><RouteProbe /></></DemoProvider></MemoryRouter>);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });

    await userEvent.click(screen.getByRole('link', { name: 'Volver a socios' }));

    expect(screen.getByTestId('current-route')).toHaveTextContent('/reception/members');
  }, 12000);

  it('opens and closes the note editor from the notes section', async () => {
    render(<MemoryRouter initialEntries={['/reception/members/demo-001']}><DemoProvider><App /></DemoProvider></MemoryRouter>);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar nota' }));
    expect(screen.getByLabelText('Nueva nota')).toBeVisible();
    const noteForm = screen.getByLabelText('Nueva nota').closest('form')!;
    await userEvent.click(within(noteForm).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Nueva nota')).not.toBeInTheDocument();
  });

  it('places membership and rentals down the left, attendance and notes down the right, then purchases full width', async () => {
    render(<MemoryRouter initialEntries={['/reception/members/demo-001']}><DemoProvider><App /></DemoProvider></MemoryRouter>);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
    await userEvent.click(screen.getByRole('tab', { name: /Expediente/i }));
    const layout = screen.getByRole('main').querySelector('.member-detail-sections') as HTMLElement;
    const left = layout.querySelector('.member-detail-left-column') as HTMLElement;
    const right = layout.querySelector('.member-detail-right-column') as HTMLElement;
    const purchases = layout.querySelector('.member-detail-purchases') as HTMLElement;
    expect(Array.from(left.querySelectorAll('h2')).map(item => item.textContent)).toEqual(['Membresía', 'Rentas actuales']);
    expect(Array.from(right.querySelectorAll('h2')).map(item => item.textContent)).toEqual(['Asistencia previa', 'Frecuencia de asistencia', 'Nota']);
    expect(layout.lastElementChild).toBe(purchases);
    expect(purchases).toHaveClass('member-detail-purchases');
  });

  it('shows the explicitly labeled sample note for the seeded member immediately', async () => {
    render(<MemoryRouter initialEntries={['/reception/members/demo-001']}><DemoProvider><App /></DemoProvider></MemoryRouter>);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText('Nota de muestra — Información para mostrar el historial de notas.')).toBeVisible();
    expect(screen.getByText(/Valeria M./)).toBeVisible();
    expect(screen.getByText(/8 oct 2026/)).toBeVisible();
  });

  it('keeps membership first and purchase history last while preserving the remaining wireframe sections', async () => {
    render(<MemoryRouter initialEntries={['/reception/members/demo-active']}><DemoProvider><App /></DemoProvider></MemoryRouter>);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Alex Morgan' })).toBeVisible();
    expect(within(main).getByRole('button', { name: 'Registrar entrada' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Expediente/i }));
    const sections = main.querySelector('.member-detail-sections');
    const sectionHeadings = Array.from(sections?.querySelectorAll('h2') ?? []).map(node => node.textContent);
    expect(sectionHeadings[0]).toBe('Membresía');
    expect(sectionHeadings.at(-1)).toBe('Historial de compras');
    const primarySectionHeadings = sectionHeadings.filter(heading => ['Membresía', 'Rentas actuales', 'Asistencia previa', 'Nota', 'Historial de compras'].includes(heading ?? ''));
    expect(primarySectionHeadings).toEqual(['Membresía', 'Rentas actuales', 'Asistencia previa', 'Nota', 'Historial de compras']);
    expect(within(sections as HTMLElement).getByRole('heading', { name: 'Guantes' })).toBeVisible();
    expect(within(sections as HTMLElement).getByRole('heading', { name: 'Casillero' })).toBeVisible();
    expect(within(sections as HTMLElement).getByRole('region', { name: 'Historial de membresías' })).toBeVisible();
    expect(within(sections as HTMLElement).getByRole('heading', { name: 'Racha' })).toBeVisible();
    expect(main.textContent?.replace('Alex Morgan', '')).not.toMatch(/demostración|provisional|dueña|Q-0[1-9]/i);
    expect(within(main).queryByRole('button', { name: /avanzar|simular|restablecer/i })).not.toBeInTheDocument();
    expect(within(main).queryByText(/Saldo a favor/)).not.toBeInTheDocument();
    expect(within(main).getByRole('button', { name: '+ Agregar nota' })).toBeVisible();
    await userEvent.click(within(main).getByRole('button', { name: '+ Agregar nota' }));
    expect(within(main).getByRole('button', { name: 'Guardar nota' })).toBeDisabled();
    expect(within(main).getByText(/Las notas se guardan solo en el estado en memoria/)).toBeVisible();
    expect(within(sections as HTMLElement).getByText(/Racha de renovaciones consecutivas/)).toBeVisible();
    expect(within(main).queryByText(/Los registros iniciales son ejemplos ficticios/)).not.toBeInTheDocument();
  }, 12000);

  it('scales attendance squares by measured gym time and keeps unknown time attended', () => {
    render(<AttendanceCalendar now="2026-10-08T12:00:00-06:00" visits={[
      { id: 'short', memberId: 'm', observedCheckIn: '2026-10-07T08:00:00-06:00', observedCheckOut: '2026-10-07T08:30:00-06:00', autoClosedAt: null },
      { id: 'long', memberId: 'm', observedCheckIn: '2026-10-06T08:00:00-06:00', observedCheckOut: '2026-10-06T11:00:00-06:00', autoClosedAt: null },
      { id: 'unknown', memberId: 'm', observedCheckIn: '2026-10-05T08:00:00-06:00', observedCheckOut: null, autoClosedAt: '2026-10-05T22:00:00-06:00' },
    ]} />);
    expect(screen.getByRole('img', { name: /Mapa anual de asistencia 2026/ })).toBeVisible();
    expect(screen.getByText(/visitas totales/)).toBeVisible();
  });

  it('uses recorded expiry boundaries without mutating or claiming an eviction', () => {
    expect(rentalStatus('2026-10-01T00:00:00-06:00', '2026-10-01T00:00:00-06:00')).toBe('active');
    expect(rentalStatus('2026-09-30T00:00:00-06:00', '2026-10-01T00:00:00-06:00')).toBe('overdue');
    expect(rentalStatus('2026-09-16T00:00:00-06:00', '2026-10-01T00:00:00-06:00')).toBe('eviction-status');
    expect(rentalStatus(null, '2026-10-01T00:00:00-06:00')).toBe('none');
  });

  it('shows attributed purchase history as a final in-page TanStack table', async () => {
    render(<DemoProvider><MemberDetailSections member={{ id: 'm', name: 'Member', phone: '', creditMinor: 0, membership: null }} now="2026-10-08T12:00:00-06:00"
      gloves={[]} gloveRentals={[]} lockers={[]} lockerRentals={[]} payments={[]} supplementSales={[
        { id: 'linked', supplementId: 's', name: 'Proteína', scoops: 1, unitPriceMinor: 3500, amountMinor: 3500, memberId: 'm', method: 'cash', status: 'confirmed', shiftId: 'shift', recordedAt: '2026-10-08T10:00:00-06:00' },
        { id: 'unlinked', supplementId: 's', name: 'Unlinked', scoops: 1, unitPriceMinor: 3500, amountMinor: 3500, memberId: null, method: 'cash', status: 'confirmed', shiftId: 'shift', recordedAt: '2026-10-08T10:00:00-06:00' },
      ]} /></DemoProvider>);
    expect(screen.getByRole('columnheader', { name: 'Fecha' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Producto' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Importe' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Método' })).toBeVisible();
    expect(screen.getAllByText('Proteína')[0]).toBeVisible();
    expect(screen.queryByText('Unlinked')).not.toBeInTheDocument();
    const detailTables = screen.getAllByRole('table');
    expect(detailTables).toHaveLength(2);
    expect(detailTables.every(table => table.classList.contains('member-detail-table'))).toBe(true);
    expect(detailTables[0].querySelector('caption')).toHaveTextContent(/membresías atribuidas al socio/);
    expect(detailTables[1].querySelector('caption')).toHaveTextContent('Operaciones atribuidas al socio');
  });

  it('keeps returned and released member rentals in purchase history', async () => {
    render(<DemoProvider><MemberDetailSections member={{ id: 'm', name: 'Member', phone: '', creditMinor: 0, membership: null }} now="2026-10-08T12:00:00-06:00"
      gloves={[{ id: 'glove-04', code: '#04', color: 'Black', ounces: 12, priceMinor: 2500, status: 'available' }]}
      gloveRentals={[{ id: 'returned', gloveId: 'glove-04', memberId: 'm', memberName: 'Member', shiftId: 'shift', priceMinor: 2500, method: 'cash', status: 'paid', rentedAt: '2026-10-06T10:00:00-06:00', returnedAt: '2026-10-06T11:00:00-06:00' }]}
      lockers={[{ id: 'locker-04', number: 4, code: '#04', status: 'available', monthlyPriceMinor: 15000 }]}
      lockerRentals={[{ id: 'released', lockerId: 'locker-04', memberId: 'm', memberName: 'Member', shiftId: 'shift', priceMinor: 15000, method: 'card', status: 'paid', rentedAt: '2026-10-01T10:00:00-06:00', expiresAt: '2026-11-01T10:00:00-06:00', releasedAt: '2026-10-07T10:00:00-06:00' }]}
      payments={[]} supplementSales={[]} /></DemoProvider>);
    expect(screen.getByText('Renta de guantes · #04')).toBeVisible();
    expect(screen.getByText('Renta de casillero · #04')).toBeVisible();
  });

  it('records notes using the selected staff identity and paid membership history only', async () => {
    setSelectedStaff({ id: 'recep-1', name: 'Valeria M.' });
    render(<DemoProvider><MemberDetailSections member={{ id: 'm', name: 'Member', phone: '', creditMinor: 0, membership: { planName: 'Mensual', startsOn: '2026-10-01', endsOn: '2026-10-31' } }} now="2026-10-08T12:00:00-06:00"
      gloves={[]} gloveRentals={[]} lockers={[]} lockerRentals={[]} payments={[
        { id: 'paid', memberId: 'm', planId: 'p', planName: 'Mensual', amountMinor: 100, method: 'cash', status: 'paid', recordedAt: '2026-10-01T12:00:00-06:00', shiftId: 's', effectiveDates: null },
        { id: 'pending', memberId: 'm', planId: 'p', planName: 'Pendiente', amountMinor: 100, method: 'cash', status: 'pending', recordedAt: '2026-09-01T12:00:00-06:00', shiftId: 's', effectiveDates: null },
      ]} supplementSales={[]} /></DemoProvider>);
    expect(screen.getAllByRole('row', { name: /Mensual/ })[0]).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar nota' }));
    await userEvent.type(screen.getByLabelText('Nueva nota'), 'Llamar para renovar');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    expect(screen.getByText('Llamar para renovar')).toBeVisible();
    expect(screen.getByText('Valeria M.')).toBeVisible();
    setSelectedStaff(null);
  }, 12000);

  it('highlights only the authoritative current membership row and keeps same-plan payments as history', () => {
    render(<DemoProvider><MemberDetailSections member={{ id: 'm', name: 'Member', phone: '', creditMinor: 0, membership: { planName: 'Mensual', startsOn: '2026-10-01', endsOn: '2026-10-31' } }} now="2026-10-08T12:00:00-06:00"
      gloves={[]} gloveRentals={[]} lockers={[]} lockerRentals={[]} payments={[{ id: 'same-name', memberId: 'm', planId: 'p', planName: 'Mensual', amountMinor: 100, method: 'cash', status: 'paid', recordedAt: '2026-10-01T12:00:00-06:00', shiftId: 's', effectiveDates: null }]} supplementSales={[]} /></DemoProvider>);
    const rows = screen.getAllByRole('row', { name: /Mensual/ });
    expect(rows[0]).toHaveClass('membership-current-row');
    expect(rows[1]).not.toHaveClass('membership-current-row');
  });

  it('does not highlight a linked payment when current membership dates have expired', () => {
    render(<DemoProvider><MemberDetailSections member={{ id: 'm', name: 'Member', phone: '', creditMinor: 0, lastPaymentId: 'linked', membership: { planName: 'Mensual', startsOn: '2026-01-01', endsOn: '2026-01-31' } }} now="2026-10-08T12:00:00-06:00"
      gloves={[]} gloveRentals={[]} lockers={[]} lockerRentals={[]} payments={[{ id: 'linked', memberId: 'm', planId: 'p', planName: 'Mensual', amountMinor: 100, method: 'cash', status: 'paid', recordedAt: '2026-01-01T12:00:00-06:00', shiftId: 's', effectiveDates: null }]} supplementSales={[]} /></DemoProvider>);
    expect(screen.getAllByRole('row', { name: /Mensual/ })[0]).not.toHaveClass('membership-current-row');
  });

  it('keeps membership history stable across parent rerenders and updates when the member changes', async () => {
    const member = { id: 'm', name: 'Member', phone: '', creditMinor: 0, membership: null };
    const payment = { id: 'paid', memberId: 'm', planId: 'p', planName: 'Mensual', amountMinor: 100, method: 'cash' as const, status: 'paid' as const, recordedAt: '2026-10-01T12:00:00-06:00', shiftId: 's', effectiveDates: null };
    const props = { member, now: '2026-10-08T12:00:00-06:00', gloves: [], gloveRentals: [], lockers: [], lockerRentals: [], supplementSales: [] };
    const payments = [payment];
    const view = render(<DemoProvider><MemberDetailSections {...props} payments={payments} /></DemoProvider>);
    const membershipRegion = screen.getByRole('region', { name: 'Historial de membresías' });
    expect(within(membershipRegion).getByRole('row', { name: /Mensual/ })).toBeVisible();

    tableCallGuard.calls = 0;
    tableCallGuard.active = true;
    try {
      await act(async () => {
        view.rerender(<DemoProvider><MemberDetailSections {...props} payments={payments} /></DemoProvider>);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(within(membershipRegion).getByRole('row', { name: /Mensual/ })).toBeVisible();

      await act(async () => {
        view.rerender(<DemoProvider><MemberDetailSections {...props} member={{ ...member, id: 'other' }} payments={payments} /></DemoProvider>);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(within(membershipRegion).queryByRole('row', { name: /Mensual/ })).not.toBeInTheDocument();
    } finally {
      tableCallGuard.active = false;
      tableCallGuard.calls = 0;
    }
  });

  it('renders habits and preferences section with front-desk tips in reception role', () => {
    render(
      <DemoProvider>
        <MemberDetailSections
          member={{ id: 'demo-001', name: 'Mariana López', phone: '5550000001', creditMinor: 0, membership: null }}
          now="2026-10-08T12:00:00-06:00"
          gloves={[]}
          gloveRentals={[]}
          lockers={[]}
          lockerRentals={[]}
          payments={[]}
          supplementSales={[]}
          role="RECEPTION"
        />
      </DemoProvider>
    );

    expect(screen.getByText('Hábitos y preferencias de consumo')).toBeVisible();
    expect(screen.getByText('Sugerencia de mostrador')).toBeVisible();
    expect(screen.getByText(/Ofrecer su batido habitual/)).toBeVisible();
    expect(screen.queryByText('Ticket promedio mostrador')).not.toBeInTheDocument();
  });

  it('renders habits section with commercial and financial breakdown in owner role', () => {
    render(
      <DemoProvider>
        <MemberDetailSections
          member={{ id: 'demo-active', name: 'Alex Morgan', phone: '5550000003', creditMinor: 0, membership: null }}
          now="2026-10-08T12:00:00-06:00"
          gloves={[]}
          gloveRentals={[]}
          lockers={[]}
          lockerRentals={[]}
          payments={[]}
          supplementSales={[]}
          role="OWNER"
        />
      </DemoProvider>
    );

    expect(screen.getByText('Hábitos y preferencias de consumo')).toBeVisible();
    expect(screen.getByText('Ticket promedio mostrador')).toBeVisible();
    expect(screen.getByText('Gasto total en mostrador')).toBeVisible();
    expect(screen.getByRole('note', { name: 'Estrategia de retención' })).toBeVisible();
  });

  it('renders front-desk bento by default and switches between Mostrador and Expediente tabs', async () => {
    render(<MemoryRouter initialEntries={['/reception/members/demo-active']}><DemoProvider><App /></DemoProvider></MemoryRouter>);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });

    const mostradorTab = screen.getByRole('tab', { name: 'Mostrador' });
    const expedienteTab = screen.getByRole('tab', { name: 'Expediente' });
    expect(mostradorTab).toHaveAttribute('aria-selected', 'true');
    expect(expedienteTab).toHaveAttribute('aria-selected', 'false');

    expect(screen.getByRole('heading', { name: 'Membresía' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Asistencia previa' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Rentas actuales' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Atención al socio' })).toBeVisible();

    await userEvent.click(expedienteTab);
    expect(expedienteTab).toHaveAttribute('aria-selected', 'true');
    expect(mostradorTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('region', { name: 'Historial de membresías' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Historial de compras' })).toBeVisible();

    await userEvent.click(mostradorTab);
    expect(mostradorTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Atención al socio' })).toBeVisible();
  });
});

describe('member reload contract consumption (P2.4)', () => {
  const baseReloadResponse: MemberReloadResponse = {
    profile: {
      id: '018f3a20-0000-7000-8000-000000000001',
      organization_id: '018f3a00-0000-7000-8000-000000000001',
      home_branch_id: '00000000-0000-7000-8000-000000000001',
      member_number: 'SOC-0001',
      full_name: 'Synthetic Reload Member',
      preferred_name: 'Synthetic',
      phone: '+525555555555',
      email: 'synthetic@example.com',
      birth_date: '1995-05-15',
      joined_on: '2026-01-10',
      status: 'active',
      photo_url: null,
      emergency_contact_name: 'Emergency Contact',
      emergency_contact_phone: '+525555555556',
    },
    active_periods: [
      {
        id: '018f3a30-0000-7000-8000-000000000001',
        order_item_id: '018f3a40-0000-7000-8000-000000000001',
        plan_version_id: '018f3a50-0000-7000-8000-000000000001',
        plan_name: 'Membresía Semestral Élite',
        starts_on: '2026-10-01',
        ends_on: '2027-04-01',
        branch_id: null,
        is_current: true,
        access_status: 'eligible',
      },
    ],
    class_samples: [
      {
        id: '018f3a60-0000-7000-8000-000000000001',
        order_item_id: '018f3a70-0000-7000-8000-000000000001',
        plan_version_id: '018f3a80-0000-7000-8000-000000000001',
        plan_name: 'Muestra Muay Thai',
        is_consumed: false,
        consumed_at: null,
        consumed_visit_id: null,
      },
    ],
    financial: {
      has_pending_balance: false,
      credit_balance_minor: 0,
      total_pending_balance_minor: null,
      currency: 'MXN',
      debts: [],
    },
    recent_visits: [
      {
        id: '018f3a90-0000-7000-8000-000000000001',
        visit_id: '018f3aa0-0000-7000-8000-000000000001',
        branch_id: '00000000-0000-7000-8000-000000000001',
        period_id: '018f3a30-0000-7000-8000-000000000001',
        sample_entitlement_id: null,
        occurred_at: '2026-10-22T08:30:00.000Z',
        access_reason: 'valid_membership',
        access_warnings: [],
      },
    ],
    server_time: '2026-10-23T05:00:00.000Z',
  };

  const dummyMember = {
    id: '018f3a20-0000-7000-8000-000000000001',
    name: 'Synthetic Reload Member',
    phone: '+525555555555',
    creditMinor: 0,
    membership: null,
  };

  it('renders reloadable membership periods and class sample entitlements in native views', () => {
    const { unmount } = render(
      <DemoProvider>
        <MemberDetailSections
          member={dummyMember}
          now="2026-10-23T12:00:00-06:00"
          gloves={[]}
          gloveRentals={[]}
          lockers={[]}
          lockerRentals={[]}
          payments={[]}
          supplementSales={[]}
          reloadState={baseReloadResponse}
        />
      </DemoProvider>
    );

    expect(screen.queryByText('Estado sincronizado del socio')).not.toBeInTheDocument();
    expect(screen.getByText('Membresía Semestral Élite')).toBeVisible();
    expect(screen.getByText(/2026-10-01 al 2027-04-01/)).toBeVisible();
    expect(screen.getByText('Elegible')).toBeVisible();
    expect(screen.getByText('Multisucursal')).toBeVisible();

    expect(screen.getByText('Muestra Muay Thai')).toBeVisible();
    expect(screen.getByText('Disponible para check-in')).toBeVisible();
    unmount();

    render(
      <DemoProvider>
        <MemberCounterView
          member={dummyMember}
          now="2026-10-23T12:00:00-06:00"
          reloadState={baseReloadResponse}
        />
      </DemoProvider>
    );

    expect(screen.queryByText('Estado sincronizado del socio')).not.toBeInTheDocument();
    expect(screen.getByText('Membresía Semestral Élite')).toBeVisible();
    expect(screen.getByText(/2026-10-01 al 2027-04-01/)).toBeVisible();
  });

  it('shows boolean balance warning for receptionist role in native card without leaking centavos', () => {
    const receptionistReloadResponse: MemberReloadResponse = {
      ...baseReloadResponse,
      financial: {
        has_pending_balance: true,
        credit_balance_minor: 0,
        total_pending_balance_minor: null,
        currency: 'MXN',
        debts: [],
      },
    };

    render(
      <DemoProvider>
        <MemberCounterView
          member={dummyMember}
          now="2026-10-23T12:00:00-06:00"
          role="RECEPTION"
          reloadState={receptionistReloadResponse}
        />
      </DemoProvider>
    );

    expect(screen.queryByText('Estado sincronizado del socio')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Saldo pendiente registrado');
    expect(screen.queryByText(/Adeudo/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-debt-details')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-debt-amount')).not.toBeInTheDocument();
  });

  it('shows debt amount in native card when viewing as Admin/Owner', () => {
    const adminReloadResponse: MemberReloadResponse = {
      ...baseReloadResponse,
      financial: {
        has_pending_balance: true,
        credit_balance_minor: 0,
        total_pending_balance_minor: 35000,
        currency: 'MXN',
        debts: [
          {
            debt_id: '018f3b00-0000-7000-8000-000000000001',
            order_id: '018f3b10-0000-7000-8000-000000000001',
            branch_id: '00000000-0000-7000-8000-000000000001',
            currency: 'MXN',
            initial_outstanding_minor: 50000,
            remaining_balance_minor: 35000,
            created_at: '2026-10-20T12:00:00.000Z',
          },
        ],
      },
    };

    render(
      <DemoProvider>
        <MemberCounterView
          member={dummyMember}
          now="2026-10-23T12:00:00-06:00"
          role="OWNER"
          reloadState={adminReloadResponse}
        />
      </DemoProvider>
    );

    expect(screen.queryByText('Estado sincronizado del socio')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Saldo pendiente registrado');
    expect(screen.getByText(/350\.00/)).toBeVisible();
  });
});
