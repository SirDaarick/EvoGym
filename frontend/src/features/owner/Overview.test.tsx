import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { Overview, getAlertCenterAnalytics, getGimiConversationsSummary } from './Overview';
import type { GimiConversation } from '../../domain/gimi';
import type { DemoState } from '../../domain/models';

function mountOverview() {
  return render(
    <MemoryRouter initialEntries={['/owner/overview']}>
      <DemoProvider>
        <Overview />
      </DemoProvider>
    </MemoryRouter>
  );
}

describe('Overview Executive 360 Command Center', () => {
  it('renders executive pulse strip with live occupancy, active member %, confirmed revenue, and alerts badge', () => {
    mountOverview();

    // Pulse strip region
    const pulseRegion = screen.getByRole('region', { name: 'Pulso ejecutivo en tiempo real' });
    expect(pulseRegion).toBeInTheDocument();

    // 1. Live occupancy with pulse indicator
    expect(screen.getByText('Pulso ejecutivo en vivo')).toBeInTheDocument();
    expect(screen.getByText('Aforo en vivo')).toBeInTheDocument();
    expect(screen.getByText(/de capacidad máxima|de capacidad/)).toBeInTheDocument();

    // 2. Base de socios / Active %
    expect(screen.getByText('Base de socios')).toBeInTheDocument();
    expect(screen.getByText(/activos de/)).toBeInTheDocument();

    // 3. Confirmed collections in pulse
    expect(screen.getAllByText('Cobros confirmados').length).toBeGreaterThanOrEqual(1);

    // 4. Operational alerts badge
    expect(screen.getAllByText(/alertas? abiertas?/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Gimi AI:/)).toBeInTheDocument();
  });

  it('renders finances & cash pillar with mandatory tables, headings, and empty state copy', () => {
    mountOverview();

    // Mandatory headings
    expect(screen.getByRole('heading', { name: 'Cobros confirmados' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Transferencias pendientes' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Diferencias de efectivo' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Diferencias de inventario' })).toBeVisible();

    // Mandatory copy & empty states
    expect(screen.getByText(/Sin fondo inicial ni transferencias pendientes\. No representa utilidad\./)).toBeVisible();
    expect(
      screen.getByText(/No hay cobros confirmados en este periodo; el cero corresponde a registros locales, no al negocio real\./)
    ).toBeVisible();
    expect(
      screen.getByText(/No incluidas en los cobros confirmados\. No validan pago, inventario ni acceso/i)
    ).toBeVisible();

    // Tables
    expect(screen.getByRole('region', { name: 'Cobros por método' })).toBeVisible();
    expect(screen.getByText('Efectivo')).toBeVisible();
    expect(screen.getByText('Tarjeta')).toBeVisible();

    // Action links
    expect(screen.getByRole('link', { name: 'Consultar movimientos' })).toHaveAttribute('href', '/owner/history');
    expect(screen.getByRole('link', { name: 'Revisar turnos y conteos' })).toHaveAttribute('href', '/owner/shifts');
    expect(screen.getAllByRole('link', { name: /Revisar inventario/ }).length).toBeGreaterThan(0);
  });

  it('renders members & retention pillar with active count, median tenure, expiring soon, and direct link', () => {
    mountOverview();

    expect(screen.getByRole('heading', { name: 'Socios y retención' })).toBeVisible();
    expect(screen.getByText('Permanencia mediana')).toBeVisible();
    expect(screen.getByText('Por vencer pronto')).toBeVisible();
    expect(screen.getByText('Membresías vencidas')).toBeVisible();

    // Median tenure indicator (e.g. 4m)
    expect(screen.getByText(/\d+m/)).toBeVisible();

    // Direct link to member directory and analytics
    const membersLink = screen.getByRole('link', { name: 'Ver analítica y directorio de socios →' });
    expect(membersLink).toBeVisible();
    expect(membersLink).toHaveAttribute('href', '/owner/members');
  });

  it('renders attendance & live traffic pillar with occupancy vs 50 capacity, peak hour, session duration, and direct link', () => {
    mountOverview();

    expect(screen.getByRole('heading', { name: 'Afluencia y ocupación en sala' })).toBeVisible();
    expect(screen.getByText(/50 capacidad/)).toBeVisible();
    expect(screen.getByText('Hora pico')).toBeVisible();
    expect(screen.getByText('Hora valle')).toBeVisible();
    expect(screen.getByText('Duración promedio')).toBeVisible();
    expect(screen.getByText(/65 min/)).toBeVisible();

    // Direct link to attendance view
    const attendanceLink = screen.getByRole('link', { name: 'Ver análisis de afluencia completo →' });
    expect(attendanceLink).toBeVisible();
    expect(attendanceLink).toHaveAttribute('href', '/owner/attendance');
  });

  it('renders inventory & retail pillar with active products, low stock alerts, revenue, and direct link', () => {
    mountOverview();

    expect(screen.getByRole('heading', { name: 'Inventario y ventas de mostrador' })).toBeVisible();
    expect(screen.getByText('Catálogo activo')).toBeVisible();
    expect(screen.getByText('Alertas de stock')).toBeVisible();
    expect(screen.getByText(/\d+\s+productos/)).toBeVisible();

    // Direct link to inventory
    const inventoryLink = screen.getByRole('link', { name: 'Ver inventario y conteo físico →' });
    expect(inventoryLink).toBeVisible();
    expect(inventoryLink).toHaveAttribute('href', '/owner/inventory');
  });

  it('renders operations, alerts & Gimi AI pillar with open alerts, Gimi stats, and direct links', () => {
    mountOverview();

    expect(screen.getByRole('heading', { name: 'Operaciones, alertas y Gimi AI' })).toBeVisible();
    expect(screen.getByText('Conversaciones Gimi')).toBeVisible();
    expect(screen.getByText('Resolución autónoma')).toBeVisible();

    // Direct links to alerts and Gimi
    const alertsLink = screen.getByRole('link', { name: 'Ver centro de alertas →' });
    expect(alertsLink).toBeVisible();
    expect(alertsLink).toHaveAttribute('href', '/owner/alerts');

    const gimiLink = screen.getByRole('link', { name: 'Ver monitor de Gimi AI →' });
    expect(gimiLink).toBeVisible();
    expect(gimiLink).toHaveAttribute('href', '/owner/gimi');
  });

  it('renders warning notice when period is invalid and hides Cobros confirmados heading', async () => {
    mountOverview();

    // Initially valid
    expect(screen.getByRole('heading', { name: 'Cobros confirmados' })).toBeVisible();

    // Invalidate period
    await userEvent.clear(screen.getByLabelText('Desde'));

    const invalidNotice = screen.getByText(
      'No se calculan resultados para un periodo inválido; la fecha final no puede ser anterior a la inicial.'
    );
    expect(invalidNotice).toBeVisible();

    // Must NOT render Cobros confirmados heading
    expect(screen.queryByRole('heading', { name: 'Cobros confirmados' })).not.toBeInTheDocument();
  });

  it('allows keyboard navigation through period fields without disruption', async () => {
    mountOverview();

    const fromInput = screen.getByLabelText('Desde');
    const toInput = screen.getByLabelText('Hasta');

    fromInput.focus();
    expect(fromInput).toHaveFocus();

    await userEvent.tab();
    expect(toInput).toHaveFocus();
  });

  it('getGimiConversationsSummary calculates totals and autonomous resolution rate', () => {
    const mockConversations: GimiConversation[] = [
      {
        id: 'c1',
        clientName: 'Test 1',
        channel: 'whatsapp',
        contactType: 'sales',
        status: 'resolved',
        startedAt: '2026-10-08T09:00:00Z',
        lastMessageAt: '2026-10-08T09:10:00Z',
        messagesCount: 4,
        needsHumanAttention: false,
        summary: 'Resolved query',
      },
      {
        id: 'c2',
        clientName: 'Test 2',
        channel: 'whatsapp',
        contactType: 'inquiry',
        status: 'active',
        startedAt: '2026-10-08T10:00:00Z',
        lastMessageAt: '2026-10-08T10:05:00Z',
        messagesCount: 2,
        needsHumanAttention: true,
        summary: 'Active query',
      },
      {
        id: 'c3',
        clientName: 'Test 3',
        channel: 'web',
        contactType: 'customer_support',
        status: 'resolved',
        startedAt: '2026-10-08T11:00:00Z',
        lastMessageAt: '2026-10-08T11:05:00Z',
        messagesCount: 3,
        needsHumanAttention: false,
        summary: 'Resolved support',
      },
      {
        id: 'c4',
        clientName: 'Test 4',
        channel: 'whatsapp',
        contactType: 'sales',
        status: 'escalated',
        startedAt: '2026-10-08T12:00:00Z',
        lastMessageAt: '2026-10-08T12:15:00Z',
        messagesCount: 5,
        needsHumanAttention: true,
        summary: 'Escalated sales',
      },
    ];

    const summary = getGimiConversationsSummary(mockConversations);
    expect(summary.totalConversations).toBe(4);
    expect(summary.resolvedConversations).toBe(2);
    expect(summary.resolutionRate).toBe(50);

    // Empty list edge case
    const emptySummary = getGimiConversationsSummary([]);
    expect(emptySummary.totalConversations).toBe(0);
    expect(emptySummary.resolvedConversations).toBe(0);
    expect(emptySummary.resolutionRate).toBe(0);
  });

  it('getAlertCenterAnalytics wraps operational alerts selector', () => {
    const mockState = {
      demoClock: '2026-10-08T12:00:00-06:00',
      attendancePolicy: { allowExpiryDay: false, allowRepeatVisits: false },
      attendance: [],
      members: [],
      revision: 1,
      currentShiftId: 'shift-1',
      shifts: [],
      products: [],
      stockMovements: [],
      counts: [],
      payments: [],
      sales: [],
      supplementSales: [],
      expenses: [],
      ledger: [],
      gloves: [],
      lockers: [],
    } as unknown as DemoState;

    const result = getAlertCenterAnalytics(mockState, 'all');
    expect(result).toHaveProperty('alerts');
    expect(result).toHaveProperty('totalCount');
    expect(result).toHaveProperty('categoryCounts');
    expect(result).toHaveProperty('kpis');
  });
});
