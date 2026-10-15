import { Field, Notice } from '../../shared/ui';
import { validPeriod, type ReportingPeriod } from '../../demo/ownerOperations';

export function PeriodFields({ period, onChange }: { period: ReportingPeriod; onChange: (next: ReportingPeriod) => void }) {
  return <><div className="grid gap-4 sm:grid-cols-2"><Field id="period-from" label="Desde" type="date" value={period.from} onChange={event => onChange({ ...period, from: event.target.value })} /><Field id="period-to" label="Hasta" type="date" value={period.to} onChange={event => onChange({ ...period, to: event.target.value })} /></div>
    <p className="muted">Días completos, inclusivos · zona de reporte: America/Mexico_City · fuente: registros locales en memoria.</p>
    {!validPeriod(period) && <div role="alert"><Notice tone="error">Selecciona fechas válidas; Desde no puede ser posterior a Hasta. No se calculan resultados para un periodo inválido.</Notice></div>}</>;
}
