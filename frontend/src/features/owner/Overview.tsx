import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert01Icon,
  Cash01Icon,
  Clock01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';

import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import {
  defaultPeriod,
  localDateKey,
  ownerSummary,
  validPeriod,
  type ReportingPeriod,
} from '../../demo/ownerOperations';
import { getAttendanceAnalytics } from '../../demo/attendanceAnalyticsSelector';
import { getMemberAnalytics } from '../../demo/memberAnalyticsSelector';
import { getInventoryAnalytics } from '../../demo/inventoryAnalyticsSelector';
import { getOperationalAlerts, type AlertPeriod } from '../../demo/alertCenterSelector';
import { getStoredConversations } from '../gimi/gimiStore';
import type { DemoState } from '../../domain/models';
import type { GimiConversation } from '../../domain/gimi';
import { Badge, EmptyState, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { NotebookNotice } from '../../shared/operationPresentation';
import { PeriodFields } from './PeriodFields';
import './Overview.css';

export function getAlertCenterAnalytics(state: DemoState, period: AlertPeriod = 'all') {
  return getOperationalAlerts(state, period);
}

export function getGimiConversationsSummary(conversations: GimiConversation[] = getStoredConversations()) {
  const total = conversations.length;
  const resolved = conversations.filter(c => c.status === 'resolved').length;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
  return {
    totalConversations: total,
    resolvedConversations: resolved,
    resolutionRate,
  };
}

export function Overview() {
  const { state } = useDemo();
  const [period, setPeriod] = useState<ReportingPeriod>(() => defaultPeriod(state));
  const isValid = validPeriod(period);
  const summary = isValid ? ownerSummary(state, period) : null;

  // Real-time pillar analytics
  const attendance = useMemo(
    () => getAttendanceAnalytics(state.attendance, state.members, state.demoClock, 'today'),
    [state.attendance, state.members, state.demoClock]
  );

  const memberAnalytics = useMemo(
    () =>
      getMemberAnalytics(
        state.members,
        state.demoClock,
        state.attendance,
        state.sales,
        state.supplementSales
      ),
    [state.members, state.demoClock, state.attendance, state.sales, state.supplementSales]
  );

  const inventory = useMemo(() => getInventoryAnalytics(state, 'all'), [state]);

  const alertsResult = useMemo(
    () => (isValid ? getOperationalAlerts(state, period) : getOperationalAlerts(state, 'all')),
    [state, period, isValid]
  );

  const conversations = useMemo(() => getStoredConversations(), []);
  const gimiSummary = useMemo(() => getGimiConversationsSummary(conversations), [conversations]);

  // Total retail revenue for selected period
  const retailRevenueMinor = useMemo(() => {
    if (!isValid) return 0;
    return state.sales
      .filter(
        sale =>
          sale.kind === 'product' &&
          sale.status === 'confirmed' &&
          localDateKey(sale.recordedAt) >= period.from &&
          localDateKey(sale.recordedAt) <= period.to
      )
      .reduce((sum, sale) => sum + sale.amountMinor, 0);
  }, [state.sales, isValid, period.from, period.to]);

  return (
    <div className="overview-page">
      <PageHeader
        eyebrow="PROPIETARIO · VISIÓN DEL PERIODO"
        title="Resumen del negocio"
        description="Cobros confirmados y diferencias observadas para revisar; no es un estado de resultados."
      />

      <Panel>
        <PeriodFields period={period} onChange={setPeriod} />
      </Panel>

      {!isValid ? (
        <div role="alert" className="overview-invalid-alert">
          <Notice tone="warning">
            No se calculan resultados para un periodo inválido; la fecha final no puede ser anterior a la inicial.
          </Notice>
        </div>
      ) : (
        summary && (
          <div className="bento-grid mt-6">
            {/* 1. Executive Pulse Strip (Full Width) */}
            <div className="executive-pulse-bar clay-card" role="region" aria-label="Pulso ejecutivo en tiempo real">
              <div className="pulse-header">
                <div className="pulse-title-group">
                  <span className="pulse-indicator" aria-hidden="true">
                    <span className="pulse-dot" />
                    <span className="pulse-ring" />
                  </span>
                  <span className="font-bold text-sm tracking-wide uppercase">Pulso ejecutivo en vivo</span>
                </div>
                <span className="pulse-badge">
                  En vivo · Aforo {attendance.liveOccupancyPercent}%
                </span>
              </div>

              <div className="pulse-metrics-grid">
                <div className="pulse-metric-card">
                  <span className="pulse-metric-label">
                    <HugeiconsIcon icon={Clock01Icon} size={14} className="text-primary" />
                    Aforo en vivo
                  </span>
                  <span className="pulse-metric-value">
                    {attendance.liveOccupancyCount} / {attendance.gymCapacity}
                  </span>
                  <span className="pulse-metric-subtext">
                    {attendance.liveOccupancyPercent}% de capacidad
                  </span>
                </div>

                <div className="pulse-metric-card">
                  <span className="pulse-metric-label">
                    <HugeiconsIcon icon={UserGroupIcon} size={14} className="text-primary" />
                    Base de socios
                  </span>
                  <span className="pulse-metric-value">
                    {memberAnalytics.activePercent}%
                  </span>
                  <span className="pulse-metric-subtext">
                    {memberAnalytics.activeMembers} activos de {memberAnalytics.totalMembers}
                  </span>
                </div>

                <div className="pulse-metric-card">
                  <span className="pulse-metric-label">
                    <HugeiconsIcon icon={Cash01Icon} size={14} className="text-primary" />
                    Cobros confirmados
                  </span>
                  <span className="pulse-metric-value">
                    {formatMoney(summary.confirmedMinor)} MXN
                  </span>
                  <span className="pulse-metric-subtext">
                    {summary.confirmedCount} operaciones
                  </span>
                </div>

                <div className="pulse-metric-card">
                  <span className="pulse-metric-label">
                    <HugeiconsIcon icon={Alert01Icon} size={14} className="text-primary" />
                    Alertas operativas
                  </span>
                  <div className="mt-1">
                    <Badge tone={alertsResult.totalCount > 0 ? 'warning' : 'success'}>
                      {alertsResult.totalCount} {alertsResult.totalCount === 1 ? 'alerta abierta' : 'alertas abiertas'}
                    </Badge>
                  </div>
                  <span className="pulse-metric-subtext mt-1">
                    Gimi AI: {gimiSummary.resolutionRate}% resuelto
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Finances & Cash Pillar */}
            <Panel className="clay-card">
              <h2>Cobros confirmados</h2>
              <p className="text-3xl font-bold">{formatMoney(summary.confirmedMinor)} MXN</p>
              <p className="muted">Sin fondo inicial ni transferencias pendientes. No representa utilidad.</p>
              <TableRegion label="Cobros por método">
                <table>
                  <caption>{period.from} a {period.to} · MXN</caption>
                  <thead>
                    <tr>
                      <th scope="col">Método</th>
                      <th scope="col">Confirmado</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Efectivo</td>
                      <td>{formatMoney(summary.cashMinor)}</td>
                    </tr>
                    <tr>
                      <td>Tarjeta</td>
                      <td>{formatMoney(summary.cardMinor)}</td>
                    </tr>
                  </tbody>
                </table>
              </TableRegion>
              {!summary.confirmedCount && (
                <p className="muted mt-4">
                  No hay cobros confirmados en este periodo; el cero corresponde a registros locales, no al negocio real.
                </p>
              )}
              <div className="flow">
                <Link to="/owner/history">Consultar movimientos</Link>
              </div>
            </Panel>

            <Panel className="clay-card">
              <h2>Transferencias pendientes</h2>
              <p className="text-3xl font-bold">{formatMoney(summary.transferPendingMinor)} MXN</p>
              <Notice tone="warning">
                No incluidas en los cobros confirmados. No validan pago, inventario ni acceso. La recepción y validación de transferencias siguen sin definir.
              </Notice>
            </Panel>

            <Panel className="clay-card">
              <h2>Diferencias de efectivo</h2>
              {summary.shiftDiscrepancies.length ? (
                <TableRegion label="Diferencias de turnos">
                  <table>
                    <caption>Turnos cerrados en el periodo · comparación manual pendiente</caption>
                    <thead>
                      <tr>
                        <th scope="col">Turno</th>
                        <th scope="col">Diferencia MXN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.shiftDiscrepancies.map(shift => (
                        <tr key={shift.id}>
                          <td>
                            {shift.id}
                            <p className="muted">{shift.window}</p>
                          </td>
                          <td>{formatMoney(shift.cashDifferenceMinor!)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableRegion>
              ) : (
                <EmptyState title="Sin diferencias registradas">
                  Solo se evalúan cierres con conteo; un turno abierto no está conciliado.
                </EmptyState>
              )}
              <Link to="/owner/shifts">Revisar turnos y conteos</Link>
            </Panel>

            <Panel className="clay-card">
              <h2>Diferencias de inventario</h2>
              {summary.countDiscrepancies.length ? (
                <TableRegion label="Diferencias de conteos">
                  <table>
                    <caption>Observaciones en el periodo; no correcciones de stock</caption>
                    <thead>
                      <tr>
                        <th scope="col">Producto / turno</th>
                        <th scope="col">Diferencia de unidades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.countDiscrepancies.map(count => (
                        <tr key={count.id}>
                          <td>
                            {state.products.find(product => product.id === count.productId)?.name}
                            <p className="muted">{count.shiftId}</p>
                          </td>
                          <td>{count.variance}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableRegion>
              ) : (
                <EmptyState title="Sin diferencias observadas">
                  No equivale a un inventario físico validado; revisa los conteos disponibles.
                </EmptyState>
              )}
              <Link to="/owner/inventory">Revisar inventario</Link>
            </Panel>

            {/* 3. Members & Retention Pillar */}
            <Panel className="clay-card overview-pillar-card">
              <div className="overview-card-header">
                <h2>Socios y retención</h2>
                <Badge tone={memberAnalytics.activePercent >= 70 ? 'success' : 'neutral'}>
                  {memberAnalytics.activePercent}% activo
                </Badge>
              </div>
              <div className="overview-kpi-highlight">
                <p className="text-3xl font-bold">
                  {memberAnalytics.activeMembers}{' '}
                  <span className="text-base font-normal muted">
                    ({memberAnalytics.activePercent}% de la base)
                  </span>
                </p>
                <p className="muted">
                  {memberAnalytics.totalMembers} socios registrados en total en el sistema.
                </p>
              </div>
              <div className="overview-stats-row">
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Permanencia mediana</span>
                  <span className="overview-stat-value">{memberAnalytics.tenure.medianMonths}m</span>
                </div>
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Por vencer pronto</span>
                  <span className="overview-stat-value">{memberAnalytics.expiringSoonCount}</span>
                </div>
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Membresías vencidas</span>
                  <span className="overview-stat-value">{memberAnalytics.expiredCount}</span>
                </div>
              </div>
              <div className="overview-card-actions">
                <Link to="/owner/members">Ver analítica y directorio de socios →</Link>
              </div>
            </Panel>

            {/* 4. Attendance & Live Traffic Pillar */}
            <Panel className="clay-card overview-pillar-card">
              <div className="overview-card-header">
                <h2>Afluencia y ocupación en sala</h2>
                <Badge tone={attendance.liveOccupancyPercent >= 80 ? 'warning' : 'success'}>
                  {attendance.liveOccupancyCount} en sala
                </Badge>
              </div>
              <div className="overview-kpi-highlight">
                <p className="text-3xl font-bold">
                  {attendance.liveOccupancyCount}{' '}
                  <span className="text-base font-normal muted">
                    / {attendance.gymCapacity} capacidad ({attendance.liveOccupancyPercent}%)
                  </span>
                </p>
                <div className="overview-progress-bar" aria-hidden="true">
                  <div
                    className="overview-progress-fill"
                    style={{ width: `${Math.min(100, attendance.liveOccupancyPercent)}%` }}
                  />
                </div>
              </div>
              <div className="overview-stats-row">
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Hora pico</span>
                  <span className="overview-stat-value">{attendance.peakHour.label}</span>
                </div>
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Hora valle</span>
                  <span className="overview-stat-value">{attendance.valleyHour.label}</span>
                </div>
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Duración promedio</span>
                  <span className="overview-stat-value">{attendance.averageDurationMinutes} min</span>
                </div>
              </div>
              <div className="overview-card-actions">
                <Link to="/owner/attendance">Ver análisis de afluencia completo →</Link>
              </div>
            </Panel>

            {/* 5. Inventory & Retail Pillar */}
            <Panel className="clay-card overview-pillar-card">
              <div className="overview-card-header">
                <h2>Inventario y ventas de mostrador</h2>
                <Badge tone={inventory.kpis.lowStockCount > 0 ? 'warning' : 'neutral'}>
                  {inventory.kpis.lowStockCount} stock bajo
                </Badge>
              </div>
              <div className="overview-kpi-highlight">
                <p className="text-3xl font-bold">{formatMoney(retailRevenueMinor)} MXN</p>
                <p className="muted">
                  Ingresos confirmados por venta de productos en mostrador en el periodo.
                </p>
              </div>
              <div className="overview-stats-row">
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Catálogo activo</span>
                  <span className="overview-stat-value">{inventory.kpis.activeProductsCount} productos</span>
                </div>
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Alertas de stock</span>
                  <span className="overview-stat-value">{inventory.kpis.lowStockCount} advertencias</span>
                </div>
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Unidades vendidas</span>
                  <span className="overview-stat-value">{inventory.kpis.totalUnitsSold}</span>
                </div>
              </div>
              <div className="overview-card-actions">
                <Link to="/owner/inventory">Ver inventario y conteo físico →</Link>
              </div>
            </Panel>

            {/* 6. Operations, Alerts & Gimi AI Pillar */}
            <Panel className="clay-card overview-pillar-card">
              <div className="overview-card-header">
                <h2>Operaciones, alertas y Gimi AI</h2>
                <Badge tone={alertsResult.totalCount > 0 ? 'warning' : 'success'}>
                  {alertsResult.totalCount} alertas abiertas
                </Badge>
              </div>
              <div className="overview-kpi-highlight">
                <p className="text-3xl font-bold">
                  {alertsResult.totalCount}{' '}
                  <span className="text-base font-normal muted">
                    {alertsResult.totalCount === 1 ? 'evento operativo' : 'eventos operativos'}
                  </span>
                </p>
                {alertsResult.categoryCounts.length > 0 && (
                  <div className="overview-alert-categories">
                    {alertsResult.categoryCounts.map(cat => (
                      <span key={cat.category} className="overview-category-tag">
                        <span className="overview-category-dot" style={{ backgroundColor: cat.color }} />
                        {cat.label}: <strong>{cat.count}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="overview-stats-row">
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Conversaciones Gimi</span>
                  <span className="overview-stat-value">{gimiSummary.totalConversations} chats</span>
                </div>
                <div className="overview-stat-box">
                  <span className="overview-stat-label">Resolución autónoma</span>
                  <span className="overview-stat-value">{gimiSummary.resolutionRate}%</span>
                </div>
              </div>
              <div className="overview-card-actions">
                <Link to="/owner/alerts">Ver centro de alertas →</Link>
                <Link to="/owner/gimi">Ver monitor de Gimi AI →</Link>
              </div>
            </Panel>
          </div>
        )
      )}

      <NotebookNotice />
    </div>
  );
}
