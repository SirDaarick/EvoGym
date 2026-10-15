import { useMemo } from 'react';
import { Chart } from '@tanstack/charts/react';
import { barY, defineChart } from '@tanstack/charts';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { pie, polar, radialArc } from '@tanstack/charts/polar';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert01Icon,
  Cash01Icon,
  ChartBarBigIcon,
  Coins01Icon,
  PackageIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';

import type { AttendanceVisit, Member, Sale, SupplementSale } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';
import { Badge } from '../../shared/ui';
import {
  getMemberAnalytics,
  type MemberAnalyticsSummary,
} from '../../demo/memberAnalyticsSelector';
import './OwnerMemberAnalytics.css';

interface OwnerMemberAnalyticsProps {
  members: Member[];
  referenceDate?: string;
  attendanceVisits?: AttendanceVisit[];
  sales?: Sale[];
  supplementSales?: SupplementSale[];
}

export function OwnerMemberAnalytics({
  members,
  referenceDate,
  attendanceVisits = [],
  sales = [],
  supplementSales = [],
}: OwnerMemberAnalyticsProps) {
  const analytics: MemberAnalyticsSummary = useMemo(
    () => getMemberAnalytics(members, referenceDate, attendanceVisits, sales, supplementSales),
    [members, referenceDate, attendanceVisits, sales, supplementSales]
  );

  // Donut chart definition for plan breakdown
  const donutDefinition = useMemo(() => {
    if (!analytics.planSlices.length) return null;
    return defineChart({
      marks: [
        polar({
          inset: 6,
          radiusRatio: 0.94,
          marks: [
            radialArc(pie(analytics.planSlices, { value: 'count' }), {
              innerRadius: ({ radius }) => radius * 0.65,
              cornerRadius: 4,
              color: 'key',
              key: 'key',
            }),
          ],
          scales: { angle: null, radius: null },
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: analytics.planSlices.map(s => s.key),
        range: analytics.planSlices.map(s => s.color),
      },
      keyboard: true,
    });
  }, [analytics.planSlices]);

  // Bar chart definition for tenure cohorts
  const cohortChartDefinition = useMemo(() => {
    return defineChart({
      marks: [
        barY(analytics.tenureCohorts, {
          x: 'cohort',
          y: 'count',
          fill: () => 'var(--color-primary, #FC6C06)',
          radius: 4,
          inset: 4,
        }),
      ],
      scales: {
        x: {
          scale: () => scaleBand().padding(0.24),
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: {
            label: 'Socios',
            ticks: { format: (val: number) => String(Math.round(val)) },
          },
        },
      },
      keyboard: true,
    });
  }, [analytics.tenureCohorts]);

  const maxProductUnits = analytics.retail.topProducts[0]?.unitsSold || 1;

  return (
    <section className="owner-member-analytics" aria-label="Analítica de socios y membresías">
      {/* 6-KPI Bento Grid */}
      <div className="member-analytics-kpi-grid">
        {/* KPI 1: Base Activa */}
        <div className="member-kpi-card">
          <div className="member-kpi-header">
            <span className="member-kpi-label">Socios Activos</span>
            <div className="member-kpi-icon-wrap tone-success" aria-hidden="true">
              <HugeiconsIcon icon={UserGroupIcon} size={18} />
            </div>
          </div>
          <div className="member-kpi-value-row">
            <span className="member-kpi-value">{analytics.activeMembers}</span>
            <Badge tone="success">{analytics.activePercent}% base</Badge>
          </div>
          <div className="member-kpi-footer">
            <span>{analytics.totalMembers} socios registrados en total</span>
          </div>
        </div>

        {/* KPI 2: Antigüedad (Mediana vs Media) */}
        <div className="member-kpi-card">
          <div className="member-kpi-header">
            <span className="member-kpi-label">Antigüedad (Mediana)</span>
            <div className="member-kpi-icon-wrap tone-neutral" aria-hidden="true">
              <HugeiconsIcon icon={ChartBarBigIcon} size={18} />
            </div>
          </div>
          <div className="member-kpi-value-row">
            <span className="member-kpi-value">{analytics.tenure.medianMonths}m</span>
            <span className="muted" style={{ fontSize: '0.875rem' }}>
              ({analytics.tenure.medianDays} días)
            </span>
          </div>
          <div className="member-kpi-footer">
            <span>Media: {analytics.tenure.averageMonths}m · Máx: {analytics.tenure.longestTenureMonths}m</span>
          </div>
        </div>

        {/* KPI 3: Riesgo de Churn / Vencimiento */}
        <div className="member-kpi-card">
          <div className="member-kpi-header">
            <span className="member-kpi-label">Riesgo de Churn</span>
            <div className="member-kpi-icon-wrap tone-warning" aria-hidden="true">
              <HugeiconsIcon icon={Alert01Icon} size={18} />
            </div>
          </div>
          <div className="member-kpi-value-row">
            <span className="member-kpi-value">{analytics.expiringSoonCount}</span>
            <Badge tone={analytics.expiringSoonCount > 0 ? 'warning' : 'neutral'}>
              Vencen en ≤ 7d
            </Badge>
          </div>
          <div className="member-kpi-footer">
            <span>{analytics.expiredCount} membresías ya vencidas</span>
          </div>
        </div>

        {/* KPI 4: ARPU / Ingreso por Socio */}
        <div className="member-kpi-card">
          <div className="member-kpi-header">
            <span className="member-kpi-label">Ingreso / Socio (ARPU)</span>
            <div className="member-kpi-icon-wrap" aria-hidden="true">
              <HugeiconsIcon icon={Coins01Icon} size={18} />
            </div>
          </div>
          <div className="member-kpi-value-row">
            <span className="member-kpi-value">{formatMoney(analytics.arpuMinor)}</span>
            <span className="muted" style={{ fontSize: '0.8125rem' }}>/mes</span>
          </div>
          <div className="member-kpi-footer">
            <span>Est: {formatMoney(analytics.estimatedMonthlyRevenueMinor)}/mes cuotas</span>
          </div>
        </div>

        {/* KPI 5: Asistencias Promedio */}
        <div className="member-kpi-card">
          <div className="member-kpi-header">
            <span className="member-kpi-label">Frecuencia Promedio</span>
            <div className="member-kpi-icon-wrap tone-success" aria-hidden="true">
              <HugeiconsIcon icon={ChartBarBigIcon} size={18} />
            </div>
          </div>
          <div className="member-kpi-value-row">
            <span className="member-kpi-value">{analytics.attendance.averageWeeklyVisits}d</span>
            <span className="muted" style={{ fontSize: '0.8125rem' }}>
              /semana (~{analytics.attendance.averageMonthlyVisits}/mes)
            </span>
          </div>
          <div className="member-kpi-footer">
            <span>{analytics.attendance.highEngagementCount} alta constancia · {analytics.attendance.lowEngagementCount} en riesgo</span>
          </div>
        </div>

        {/* KPI 6: Ticket Mostrador (Retail sin membresías) */}
        <div className="member-kpi-card">
          <div className="member-kpi-header">
            <span className="member-kpi-label">Ticket Mostrador (Retail)</span>
            <div className="member-kpi-icon-wrap tone-neutral" aria-hidden="true">
              <HugeiconsIcon icon={PackageIcon} size={18} />
            </div>
          </div>
          <div className="member-kpi-value-row">
            <span className="member-kpi-value">{formatMoney(analytics.retail.averageTicketMinor)}</span>
            <Badge tone="neutral">{analytics.retail.retailPenetrationPercent}% penetración</Badge>
          </div>
          <div className="member-kpi-footer">
            <span>Total mostrador: {formatMoney(analytics.retail.totalRetailRevenueMinor)}</span>
          </div>
        </div>
      </div>

      {/* Visualizations Row */}
      <div className="member-analytics-charts-grid">
        {/* Panel 1: Donut Chart - Desglose por Membresía */}
        <div className="member-chart-panel" aria-labelledby="member-donut-title">
          <div>
            <h3 id="member-donut-title" className="member-chart-title">
              Desglose por disciplina y plan
            </h3>
            <p className="member-chart-desc">
              Distribución de la base de socios por categoría de disciplina contratada
            </p>
          </div>

          <div className="member-donut-container">
            <div
              className="member-donut-wrap"
              aria-label={`Distribución de membresías: ${analytics.activeMembers} socios activos`}
            >
              {donutDefinition ? (
                <Chart
                  definition={donutDefinition}
                  height={190}
                  ariaLabel="Gráfica circular de desglose por disciplina y tipo de membresía"
                />
              ) : (
                <div className="member-donut-empty" role="img" aria-label="Sin planes registrados" />
              )}
              <div className="member-donut-center" aria-hidden="true">
                <strong>{analytics.activeMembers}</strong>
                <span>Activos</span>
              </div>
            </div>

            <ul className="member-donut-legend" aria-label="Categorías de membresías">
              {analytics.planSlices.map(slice => (
                <li key={slice.key} className="member-legend-item">
                  <div className="member-legend-label-group">
                    <span
                      className="member-legend-color-dot"
                      style={{ backgroundColor: slice.color }}
                      aria-hidden="true"
                    />
                    <span className="member-legend-label">{slice.label}</span>
                  </div>
                  <div className="member-legend-stats">
                    <span className="member-legend-count">{slice.count}</span>
                    <span className="member-legend-pct">({slice.percent}%)</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Panel 2: Bar Chart - Distribución de Antigüedad y Cohortes */}
        <div className="member-chart-panel" aria-labelledby="member-cohorts-title">
          <div>
            <h3 id="member-cohorts-title" className="member-chart-title">
              Permanencia y cohortes de antigüedad
            </h3>
            <p className="member-chart-desc">
              Meses transcurridos desde la fecha de primer registro en EvoGym
            </p>
          </div>

          <div className="member-cohorts-container">
            <div className="member-cohort-chart-wrap">
              <Chart
                definition={cohortChartDefinition}
                height={175}
                ariaLabel="Gráfica de barras mostrando distribución de socios por cohorte de permanencia"
              />
            </div>

            <div className="member-cohort-pills" aria-label="Detalle por cohorte de permanencia">
              {analytics.tenureCohorts.map(cohort => (
                <div key={cohort.cohort} className="member-cohort-pill">
                  <div className="member-cohort-pill-header">
                    <span className="member-cohort-name">{cohort.label}</span>
                    <span className="member-cohort-count">{cohort.count}</span>
                  </div>
                  <span className="member-cohort-desc">{cohort.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel 3: Ranking de Top Productos de Mostrador */}
        <div className="member-chart-panel" aria-labelledby="member-top-products-title">
          <div>
            <h3 id="member-top-products-title" className="member-chart-title">
              Top productos y suplementos favoritos
            </h3>
            <p className="member-chart-desc">
              Artículos de mostrador con mayor demanda y rotación entre socios
            </p>
          </div>

          <div className="member-top-products-list" aria-label="Ranking de productos de mostrador">
            {analytics.retail.topProducts.length > 0 ? (
              analytics.retail.topProducts.map((prod, index) => {
                const fillPercent = Math.round((prod.unitsSold / maxProductUnits) * 100);
                return (
                  <div key={prod.name} className="member-product-ranking-item">
                    <div className="member-product-ranking-meta">
                      <div>
                        <span className={`member-ranking-badge top-${index + 1}`}>{index + 1}°</span>
                        <span className="member-product-ranking-name">{prod.name}</span>
                      </div>
                      <div className="member-product-ranking-stats">
                        <span className="member-ranking-units">{prod.unitsSold} uds</span>
                        <span className="member-ranking-revenue">({formatMoney(prod.revenueMinor)})</span>
                      </div>
                    </div>
                    <div className="member-ranking-bar-track" aria-hidden="true">
                      <div
                        className="member-ranking-bar-fill"
                        style={{ width: `${fillPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="muted" style={{ fontSize: '0.8125rem' }}>
                Sin ventas de productos registradas en este período.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Strategic Insight Strip */}
      <div className="member-retention-insight-banner" role="region" aria-label="Insight estratégico">
        <HugeiconsIcon icon={Alert01Icon} size={18} className="member-insight-icon" aria-hidden="true" />
        <div>
          <strong>Criterio de retención:</strong> La base activa promedia{' '}
          <strong>{analytics.attendance.averageWeeklyVisits} días/semana</strong> con una mediana de antigüedad de{' '}
          <strong>{analytics.tenure.medianMonths} meses</strong>. El mostrador genera un ticket promedio de{' '}
          <strong>{formatMoney(analytics.retail.averageTicketMinor)}</strong> con{' '}
          <strong>{analytics.retail.retailPenetrationPercent}% de penetración</strong>. Estos dos vectores
          permiten perfilar con precisión los clusters de socios de alta fidelidad vs. socios en riesgo de deserción.
        </div>
      </div>
    </section>
  );
}
