import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Member } from '../../domain/models';
import { OwnerMemberAnalytics } from './OwnerMemberAnalytics';

const sampleMembers: Member[] = [
  {
    id: 'm1',
    name: 'Mariana López',
    phone: '5550000001',
    creditMinor: 0,
    joinedOn: '2025-10-15',
    membership: { planName: 'Gym mensual', startsOn: '2026-09-17', endsOn: '2026-10-17' },
  },
  {
    id: 'm2',
    name: 'Carlos Rivera',
    phone: '5550000002',
    creditMinor: 0,
    joinedOn: '2026-05-10',
    membership: null,
  },
  {
    id: 'm3',
    name: 'Alex Morgan',
    phone: '5550000003',
    creditMinor: 0,
    joinedOn: '2026-07-01',
    membership: { planName: 'Gym + Box mensual', startsOn: '2026-10-01', endsOn: '2026-10-31' },
  },
  {
    id: 'm4',
    name: 'Patricia Gómez',
    phone: '5550000004',
    creditMinor: 0,
    joinedOn: '2026-04-12',
    membership: { planName: 'Box mensual', startsOn: '2026-09-01', endsOn: '2026-09-30' }, // Expired
  },
  {
    id: 'm5',
    name: 'Marco Silva',
    phone: '5550000005',
    creditMinor: 0,
    demoScenario: 'expiry-today',
    joinedOn: '2026-08-09',
    membership: { planName: 'Gym estudiante', startsOn: '2026-09-09', endsOn: '2026-10-08' },
  },
];

describe('OwnerMemberAnalytics', () => {
  it('renders the 4 Bento KPIs with correct metrics', () => {
    render(<OwnerMemberAnalytics members={sampleMembers} referenceDate="2026-10-08" />);

    // KPI 1: Socios Activos
    expect(screen.getByText('Socios Activos')).toBeVisible();
    // 3 active members: m1, m3, m5 (m5 expires today so still active)
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('60% base')).toBeVisible();
    expect(screen.getByText('5 socios registrados en total')).toBeVisible();

    // KPI 2: Antigüedad (Mediana)
    expect(screen.getByText('Antigüedad (Mediana)')).toBeVisible();

    // KPI 3: Riesgo de Churn
    expect(screen.getByText('Riesgo de Churn')).toBeVisible();
    expect(screen.getByText('Vencen en ≤ 7d')).toBeVisible();

    // KPI 4: ARPU
    expect(screen.getByText('Ingreso / Socio (ARPU)')).toBeVisible();
  });

  it('renders the Donut Chart and legend with membership categories', () => {
    render(<OwnerMemberAnalytics members={sampleMembers} referenceDate="2026-10-08" />);

    expect(screen.getByText('Desglose por disciplina y plan')).toBeVisible();
    expect(screen.getByLabelText('Gráfica circular de desglose por disciplina y tipo de membresía')).toBeVisible();

    // Categories in legend
    expect(screen.getByText('Gym')).toBeVisible();
    expect(screen.getByText('Combo Gym + Box')).toBeVisible();
    expect(screen.getByText('Estudiantes')).toBeVisible();
  });

  it('renders the tenure cohorts chart and strategic insight banner', () => {
    render(<OwnerMemberAnalytics members={sampleMembers} referenceDate="2026-10-08" />);

    expect(screen.getByText('Permanencia y cohortes de antigüedad')).toBeVisible();
    expect(screen.getByLabelText('Gráfica de barras mostrando distribución de socios por cohorte de permanencia')).toBeVisible();

    // Cohorts pills
    expect(screen.getAllByText('< 1 mes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1–3 meses').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('+1 año').length).toBeGreaterThanOrEqual(1);

    // Strategic insight banner
    expect(screen.getByRole('region', { name: 'Insight estratégico' })).toBeVisible();
    expect(screen.getByText(/Criterio de retención:/)).toBeVisible();
  });

  it('renders all 6 Bento KPIs and the Top Products ranking', () => {
    render(<OwnerMemberAnalytics members={sampleMembers} referenceDate="2026-10-08" />);

    // KPI 5: Frecuencia Promedio
    expect(screen.getByText('Frecuencia Promedio')).toBeVisible();

    // KPI 6: Ticket Mostrador (Retail)
    expect(screen.getByText('Ticket Mostrador (Retail)')).toBeVisible();

    // Top products ranking panel
    expect(screen.getByText('Top productos y suplementos favoritos')).toBeVisible();
    expect(screen.getByLabelText('Ranking de productos de mostrador')).toBeVisible();
  });
});
