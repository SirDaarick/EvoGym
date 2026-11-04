import { categoryLabels, validPeriod, type HistoryCategory, type ReportingPeriod } from '@/domain/reporting';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';
import { getOwnerHistory, type OwnerHistoryRecord } from '../../api/ownerHistoryApi';
import type { PaymentMethod } from '../../domain/models';
import { Button, EmptyState, Notice, PageHeader, Panel } from '../../shared/ui';
import { paymentMethods } from '../../shared/operationPresentation';
import { HistoryTable } from './HistoryTable';
import { PeriodFields } from './PeriodFields';

const PAGE_SIZE = 50;
const LOAD_ERROR = 'No se pudo cargar el historial de movimientos.';

export function LiveHistory({ apiRequest }: { apiRequest: AuthenticatedRequest }) {
  // Period starts null: the server resolves the default range using the branch business date/timezone.
  const [period, setPeriod] = useState<ReportingPeriod | null>(null);
  const [timezone, setTimezone] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState<HistoryCategory | 'all'>('all');
  const [method, setMethod] = useState<PaymentMethod | 'all'>('all');
  const [records, setRecords] = useState<OwnerHistoryRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const serverPeriod = useRef(false); // period just adopted from the server response: already loaded

  useEffect(() => {
    if (serverPeriod.current) { serverPeriod.current = false; return; }
    if (period && !validPeriod(period)) { setLoading(false); return; }
    const current = ++generation.current;
    setLoading(true);
    setError('');
    setRecords([]);
    setCursor(null);
    getOwnerHistory(apiRequest, {
      ...(period ?? {}), limit: PAGE_SIZE,
      ...(category !== 'all' ? { category } : {}), ...(method !== 'all' ? { method } : {}),
    }).then(page => {
      if (current !== generation.current) return;
      setRecords(page.records);
      setCursor(page.nextCursor);
      setTimezone(page.period.timezone);
      if (!period) {
        serverPeriod.current = true;
        setPeriod({ from: page.period.from, to: page.period.to });
      }
    }).catch(() => { if (current === generation.current) setError(LOAD_ERROR); })
      .finally(() => { if (current === generation.current) setLoading(false); });
  }, [apiRequest, period?.from, period?.to, category, method]);

  const loadMore = useCallback(() => {
    if (!period || !cursor) return;
    const current = generation.current;
    setLoadingMore(true);
    setError('');
    getOwnerHistory(apiRequest, {
      ...period, cursor, limit: PAGE_SIZE,
      ...(category !== 'all' ? { category } : {}), ...(method !== 'all' ? { method } : {}),
    }).then(page => {
      if (current !== generation.current) return;
      setRecords(previous => [...previous, ...page.records]);
      setCursor(page.nextCursor);
    }).catch(() => { if (current === generation.current) setError(LOAD_ERROR); })
      .finally(() => { if (current === generation.current) setLoadingMore(false); });
  }, [apiRequest, period, cursor, category, method]);

  const valid = !period || validPeriod(period);
  return (
    <>
      <PageHeader
        eyebrow="PROPIETARIO · TRAZABILIDAD"
        title="Historial de movimientos"
        description="Pagos, ventas, cantidades, conteos y turnos. Consulta de solo lectura."
      />
      <Panel>
        {period && <PeriodFields period={period} onChange={setPeriod} source="registros del servidor" timezone={timezone} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="history-category">Categoría</label>
            <select id="history-category" value={category} onChange={event => setCategory(event.target.value as HistoryCategory | 'all')}>
              <option value="all">Todas las categorías</option>
              {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="history-method">Método</label>
            <select id="history-method" value={method} onChange={event => setMethod(event.target.value as PaymentMethod | 'all')}>
              <option value="all">Todos / no aplica</option>
              {Object.entries(paymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
        <p className="muted">
          Filtrar por método muestra solo operaciones de pago. Reposición, merma, conteo y turnos no tienen método ni importe de venta.
        </p>
      </Panel>

      {valid && (
        <Panel className="mt-6">
          {loading && <p role="status">Cargando historial…</p>}
          {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
          {!loading && !error && records.length === 0 && (
            <EmptyState title="Sin movimientos para estos filtros">
              No hay registros coincidentes. Cambia el periodo, categoría o método.
            </EmptyState>
          )}
          {!loading && records.length > 0 && (
            <>
              <HistoryTable records={records} timezone={timezone} paginated={false}
                caption={`${records.length} registros cargados${cursor ? ' · hay más disponibles' : ''}`} />
              {cursor && (
                <div className="mt-4">
                  <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
                    {loadingMore ? 'Cargando…' : 'Cargar más'}
                  </Button>
                </div>
              )}
            </>
          )}
        </Panel>
      )}
      <div className="flow">
        <Link to="/owner/shifts">Consultar resumen por turno</Link>
      </div>
    </>
  );
}
