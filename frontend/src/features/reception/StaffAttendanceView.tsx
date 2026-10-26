import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDemo } from '../../demo/DemoProvider';
import { activeShift } from '../../demo/inventoryOperations';
import {
  getStaffAttendanceStatus,
  recordStaffClockIn,
  recordStaffClockOut,
} from '../../demo/staffAttendanceOperations';
import {
  listStaffAttendance,
  recordStaffAttendance,
  recordStaffCheckout,
  OperationalApiHttpError,
  OperationalApiNetworkError,
  type StaffAttendanceItem,
} from '../../api/staffAttendanceApi';
import { readOperationalToken } from '../../api/receptionApi';
import { createEmptyDemoState } from '../../demo/adapter';
import { Button, EmptyState, PageHeader } from '../../shared/ui';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { getSelectedStaff, useStaff, type StaffProfile } from '../staff/staffStore';
import './StaffAttendanceView.css';

type DepartmentFilter = 'all' | 'Entrenador' | 'Mantenimiento' | 'Staff';
type StatusFilter = 'all' | 'in-turn' | 'out';

function formatClockTime(isoString?: string | null): string {
  if (!isoString) return '--:--';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return new Intl.DateTimeFormat('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date) + ' hrs';
  } catch {
    return isoString;
  }
}

interface ActiveStaffRecord {
  id?: string;
  clockInAt?: string;
  clock_in_at?: string;
  clockOutAt?: string | null;
  clock_out_at?: string | null;
  recordedBy?: string;
  recorded_by?: string;
  notes?: string;
  status?: string;
  review_required?: boolean;
  clock_validation_status?: string;
}

type LiveRequest = (path: string, init?: RequestInit) => Promise<Response>;

export function StaffAttendanceView({ liveRequest, liveStaff, branchId }: { liveRequest?: LiveRequest; liveStaff?: StaffProfile[]; branchId?: string } = {}) {
  let demo: ReturnType<typeof useDemo> | null = null;
  try { demo = useDemo(); } catch { /* API routes do not mount demo state. */ }
  const state = demo?.state ?? createEmptyDemoState();
  const transact = demo?.transact;
  const storeStaff = useStaff();
  const staffList = liveStaff ?? storeStaff;
  const currentActiveShift = demo ? activeShift(state) : undefined;
  const loggedStaff = getSelectedStaff();

  const operationalToken = liveRequest ? null : readOperationalToken();
  const isLive = Boolean(liveRequest || operationalToken);

  const [liveRecords, setLiveRecords] = useState<StaffAttendanceItem[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);

  const receptionistName =
    loggedStaff?.name ??
    currentActiveShift?.responsibleStaffName ??
    'Recepción';

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Per-employee note input before check-in
  const [notesByStaffId, setNotesByStaffId] = useState<Record<string, string>>({});

  // Toast feedback
  const [toast, setToast] = useState<{
    open: boolean;
    title: string;
    description: string;
    type: 'success' | 'error';
  } | null>(null);

  const fetchLiveAttendance = useCallback(async () => {
    if (!operationalToken && !liveRequest) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      let records: StaffAttendanceItem[];
      if (liveRequest) {
        const response = await liveRequest(`/api/v1/staff-attendance?branch_id=${encodeURIComponent(branchId ?? '')}&business_date=${today}`);
        if (!response.ok) throw new Error('No se pudo sincronizar la asistencia desde la API.');
        records = (await response.json() as { items: StaffAttendanceItem[] }).items;
      } else {
        records = (await listStaffAttendance(today, operationalToken!)).items;
      }
      setLiveRecords(records);
      setLiveError(null);
    } catch (err) {
      if (err instanceof OperationalApiHttpError || err instanceof OperationalApiNetworkError) {
        setLiveError(err.message);
      } else {
        setLiveError('Error al sincronizar asistencia.');
      }
    }
  }, [branchId, liveRequest, operationalToken]);

  useEffect(() => {
    if (isLive) {
      fetchLiveAttendance();
    }
  }, [isLive, fetchLiveAttendance]);

  const activeStaff = useMemo(() => {
    return staffList.filter(s => s.active && s.id !== 'admin-1');
  }, [staffList]);

  const staffStatuses = useMemo(() => {
    if (isLive) {
      const map = new Map<
        string,
        {
          isClockedIn: boolean;
          activeRecord?: ActiveStaffRecord;
        }
      >();
      activeStaff.forEach(staff => {
        const recordsForStaff = liveRecords.filter(
          r => r.profile_id === staff.id || r.full_name.toLowerCase() === staff.name.toLowerCase()
        );
        const activeRec = recordsForStaff.find(r => !r.checkout_at);
        if (activeRec) {
          map.set(staff.id, {
            isClockedIn: true,
            activeRecord: {
              id: activeRec.id,
              clockInAt: activeRec.device_captured_at ?? activeRec.occurred_at,
              recordedBy: activeRec.recorded_by,
              status: activeRec.status,
              review_required:
                activeRec.review_required || activeRec.clock_validation_status === 'review_required',
              clock_validation_status: activeRec.clock_validation_status,
            },
          });
        } else {
          const latestClosed = recordsForStaff[0];
          map.set(staff.id, {
            isClockedIn: false,
            activeRecord: latestClosed
              ? {
                  id: latestClosed.id,
                  clockInAt: latestClosed.device_captured_at ?? latestClosed.occurred_at,
                  clockOutAt: latestClosed.checkout_at,
                  recordedBy: latestClosed.recorded_by,
                  status: latestClosed.status,
                  review_required:
                    latestClosed.review_required ||
                    latestClosed.clock_validation_status === 'review_required',
                  clock_validation_status: latestClosed.clock_validation_status,
                }
              : undefined,
          });
        }
      });
      return map;
    }

    const map = new Map<
      string,
      {
        isClockedIn: boolean;
        activeRecord?: ActiveStaffRecord;
      }
    >();
    activeStaff.forEach(staff => {
      const demoStatus = getStaffAttendanceStatus(state.staffAttendance, staff.id);
      map.set(staff.id, {
        isClockedIn: demoStatus.isClockedIn,
        activeRecord: demoStatus.activeRecord
          ? {
              id: demoStatus.activeRecord.id,
              clockInAt: demoStatus.activeRecord.clockInAt,
              clockOutAt: demoStatus.activeRecord.clockOutAt,
              recordedBy: demoStatus.activeRecord.recordedBy,
              notes: demoStatus.activeRecord.notes,
            }
          : undefined,
      });
    });
    return map;
  }, [isLive, activeStaff, liveRecords, state.staffAttendance]);

  // Counts for KPIs
  const totalEmployees = activeStaff.length;
  const inTurnCount = useMemo(() => {
    return activeStaff.filter(s => staffStatuses.get(s.id)?.isClockedIn).length;
  }, [activeStaff, staffStatuses]);
  const outCount = totalEmployees - inTurnCount;

  // Filtered staff list
  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return activeStaff.filter(staff => {
      const status = staffStatuses.get(staff.id);
      const isClockedIn = Boolean(status?.isClockedIn);

      // Status filter
      if (statusFilter === 'in-turn' && !isClockedIn) return false;
      if (statusFilter === 'out' && isClockedIn) return false;

      // Department filter
      const dept = staff.department ?? 'Staff';
      if (departmentFilter !== 'all' && dept !== departmentFilter) return false;

      // Search query
      if (q) {
        const matchesName = staff.name.toLowerCase().includes(q);
        const matchesDept = dept.toLowerCase().includes(q);
        const matchesShift = staff.shift.toLowerCase().includes(q);
        if (!matchesName && !matchesDept && !matchesShift) return false;
      }

      return true;
    });
  }, [activeStaff, staffStatuses, statusFilter, departmentFilter, searchQuery]);

  async function handleClockIn(staff: StaffProfile) {
    if (isLive) {
      try {
        const idempotencyKey =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `key-${Date.now()}`;
        const deviceCapturedAt = new Date().toISOString();
        const today = deviceCapturedAt.slice(0, 10);

        const payload = {
          occurrence_date: today,
          device_captured_at: deviceCapturedAt,
          idempotency_key: idempotencyKey,
        };
        const record = liveRequest
          ? await liveRequest(`/api/v1/staff-attendance/branches/${encodeURIComponent(branchId ?? '')}/profiles/${encodeURIComponent(staff.id)}`, { method: 'POST', body: JSON.stringify(payload) }).then(async response => {
              if (!response.ok) throw new Error('No se pudo registrar la entrada desde la API.');
              return response.json() as Promise<StaffAttendanceItem>;
            })
          : await recordStaffAttendance(
          staff.id,
          payload,
          operationalToken ?? undefined
        );

        setLiveRecords(prev => [record, ...prev.filter(r => r.id !== record.id)]);
        const timeStr = formatClockTime(record.device_captured_at ?? record.occurred_at);
        setToast({
          open: true,
          type: 'success',
          title: 'Entrada registrada',
          description: `${staff.name} entró a las ${timeStr}. Registrado por ${record.recorded_by}.`,
        });
        setNotesByStaffId(prev => ({ ...prev, [staff.id]: '' }));
      } catch (err) {
        const errorMsg =
          err instanceof OperationalApiHttpError
            ? err.message
            : err instanceof OperationalApiNetworkError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Error desconocido al registrar entrada';
        setToast({
          open: true,
          type: 'error',
          title: 'Error al marcar entrada',
          description: errorMsg,
        });
      }
      return;
    }

    const note = notesByStaffId[staff.id]?.trim() || '';

    if (!transact) return;
    const transactionResult = transact(currentState =>
      recordStaffClockIn(currentState, {
        staffId: staff.id,
        staffName: staff.name,
        roleOrDepartment: staff.department ?? 'Staff',
        recordedBy: receptionistName,
        notes: note,
      })
    );

    if (transactionResult.status === 'ok') {
      const timeStr = formatClockTime(transactionResult.record.clockInAt);
      setToast({
        open: true,
        type: 'success',
        title: 'Entrada registrada',
        description: `${staff.name} entró a las ${timeStr}. Registrado por ${receptionistName}.`,
      });
      setNotesByStaffId(prev => ({ ...prev, [staff.id]: '' }));
    } else {
      setToast({
        open: true,
        type: 'error',
        title: 'Error al marcar entrada',
        description: transactionResult.message,
      });
    }
  }

  async function handleClockOut(staff: StaffProfile) {
    if (isLive) {
      const statusInfo = staffStatuses.get(staff.id);
      const activeRecordId = statusInfo?.activeRecord?.id;
      if (!activeRecordId) {
        setToast({
          open: true,
          type: 'error',
          title: 'Error al marcar salida',
          description: 'No se encontró un registro activo de entrada.',
        });
        return;
      }

      try {
        const checkout = liveRequest
          ? await liveRequest(`/api/v1/staff-attendance/${encodeURIComponent(activeRecordId)}/checkout`, { method: 'POST', body: '{}' }).then(async response => {
              if (!response.ok) throw new Error('No se pudo registrar la salida desde la API.');
              return response.json() as Promise<{ occurred_at: string; recorded_by: string }>;
            })
          : await recordStaffCheckout(activeRecordId, operationalToken ?? undefined);
        setLiveRecords(prev =>
          prev.map(r =>
            r.id === activeRecordId
              ? {
                  ...r,
                  checkout_at: checkout.occurred_at,
                  checkout_recorded_by: checkout.recorded_by,
                }
              : r
          )
        );
        const timeStr = formatClockTime(checkout.occurred_at);
        setToast({
          open: true,
          type: 'success',
          title: 'Salida registrada',
          description: `${staff.name} ha concluido su turno (${timeStr}).`,
        });
      } catch (err) {
        const errorMsg =
          err instanceof OperationalApiHttpError
            ? err.message
            : err instanceof OperationalApiNetworkError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Error desconocido al registrar salida';
        setToast({
          open: true,
          type: 'error',
          title: 'Error al marcar salida',
          description: errorMsg,
        });
      }
      return;
    }

    if (!transact) return;
    const transactionResult = transact(currentState =>
      recordStaffClockOut(currentState, {
        staffId: staff.id,
      })
    );

    if (transactionResult.status === 'ok') {
      const timeStr = formatClockTime(transactionResult.record.clockOutAt);
      setToast({
        open: true,
        type: 'success',
        title: 'Salida registrada',
        description: `${staff.name} ha concluido su turno (${timeStr}).`,
      });
    } else {
      setToast({
        open: true,
        type: 'error',
        title: 'Error al marcar salida',
        description: transactionResult.message,
      });
    }
  }

  // Attendance records for audit / today summary
  const todayRecords = useMemo(() => {
    if (isLive) {
      return liveRecords.map(rec => ({
        id: rec.id,
        staffName: rec.full_name,
        roleOrDepartment: rec.position,
        clockInAt: rec.device_captured_at ?? rec.occurred_at,
        clock_in_at: rec.device_captured_at ?? rec.occurred_at,
        clockOutAt: rec.checkout_at,
        clock_out_at: rec.checkout_at,
        recordedBy: rec.recorded_by,
        recorded_by: rec.recorded_by,
        notes: rec.review_required
          ? `[Revisión requerida] Estado: ${rec.status}`
          : rec.status !== 'present'
          ? `Estado: ${rec.status}`
          : '',
      }));
    }
    return [...(state.staffAttendance ?? [])].reverse();
  }, [isLive, liveRecords, state.staffAttendance]);

  return (
    <div className="staff-attendance-page">
      <PageHeader
        eyebrow="RECEPCIÓN · PERSONAL"
        title="Pase de Lista del Personal"
        description="Control de asistencia en tiempo real para entrenadores, mantenimiento y staff."
      />

      {liveError && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            marginBottom: '16px',
            background: '#FEF2F2',
            border: '1px solid #F87171',
            borderRadius: '8px',
            color: '#991B1B',
            fontSize: '14px',
          }}
        >
          {liveError}
        </div>
      )}

      {/* Bento KPIs */}
      <div className="staff-att-kpis" role="region" aria-label="Resumen de asistencia del personal">
        <div className="staff-att-kpi">
          <div className="staff-att-kpi-header">
            <span className="staff-att-kpi-title">En Turno</span>
            <span className="staff-att-dot staff-att-dot-in" aria-hidden="true" />
          </div>
          <div className="staff-att-kpi-value">
            <span>{inTurnCount}</span>
            <small style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-muted)' }}>
              de {totalEmployees}
            </small>
          </div>
          <span className="staff-att-kpi-desc">Personal presente en las instalaciones</span>
        </div>

        <div className="staff-att-kpi">
          <div className="staff-att-kpi-header">
            <span className="staff-att-kpi-title">Fuera del Gym</span>
            <span className="staff-att-dot staff-att-dot-out" aria-hidden="true" />
          </div>
          <div className="staff-att-kpi-value">{outCount}</div>
          <span className="staff-att-kpi-desc">Personal libre o fuera de jornada</span>
        </div>

        <div className="staff-att-kpi">
          <div className="staff-att-kpi-header">
            <span className="staff-att-kpi-title">Total Equipo</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--color-primary)' }}>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="staff-att-kpi-value">{totalEmployees}</div>
          <span className="staff-att-kpi-desc">Entrenadores, limpieza y staff activo</span>
        </div>

        <div className="staff-att-kpi">
          <div className="staff-att-kpi-header">
            <span className="staff-att-kpi-title">Recepcionista</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--color-primary)' }}>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          </div>
          <div className="staff-att-kpi-value" style={{ fontSize: '20px' }}>
            {receptionistName}
          </div>
          <span className="staff-att-kpi-desc">
            {currentActiveShift ? `Turno activo: ${currentActiveShift.window}` : 'Mostrador activo'}
          </span>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div className="staff-att-toolbar" role="search" aria-label="Filtros de personal">
        <div className="staff-att-search-row">
          <div className="staff-att-search-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className="staff-att-search-input"
              placeholder="Buscar colaborador por nombre, puesto o turno..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Buscar empleado"
            />
          </div>

          <div className="staff-att-filters-group">
            <span className="staff-att-filter-label">Estado:</span>
            <div className="staff-att-pill-group" role="radiogroup" aria-label="Filtrar por estado">
              <button
                type="button"
                className={`staff-att-pill-btn ${statusFilter === 'all' ? 'active' : ''}`}
                onClick={() => setStatusFilter('all')}
                aria-pressed={statusFilter === 'all'}
              >
                Todos ({totalEmployees})
              </button>
              <button
                type="button"
                className={`staff-att-pill-btn ${statusFilter === 'in-turn' ? 'active' : ''}`}
                onClick={() => setStatusFilter('in-turn')}
                aria-pressed={statusFilter === 'in-turn'}
              >
                <span className="staff-att-dot staff-att-dot-in" aria-hidden="true" />
                En turno ({inTurnCount})
              </button>
              <button
                type="button"
                className={`staff-att-pill-btn ${statusFilter === 'out' ? 'active' : ''}`}
                onClick={() => setStatusFilter('out')}
                aria-pressed={statusFilter === 'out'}
              >
                <span className="staff-att-dot staff-att-dot-out" aria-hidden="true" />
                Fuera del gym ({outCount})
              </button>
            </div>
          </div>
        </div>

        <div className="staff-att-filters-group">
          <span className="staff-att-filter-label">Puesto:</span>
          <div className="staff-att-pill-group" role="radiogroup" aria-label="Filtrar por puesto">
            <button
              type="button"
              className={`staff-att-pill-btn ${departmentFilter === 'all' ? 'active' : ''}`}
              onClick={() => setDepartmentFilter('all')}
              aria-pressed={departmentFilter === 'all'}
            >
              Todos
            </button>
            <button
              type="button"
              className={`staff-att-pill-btn ${departmentFilter === 'Entrenador' ? 'active' : ''}`}
              onClick={() => setDepartmentFilter('Entrenador')}
              aria-pressed={departmentFilter === 'Entrenador'}
            >
              Entrenadores
            </button>
            <button
              type="button"
              className={`staff-att-pill-btn ${departmentFilter === 'Mantenimiento' ? 'active' : ''}`}
              onClick={() => setDepartmentFilter('Mantenimiento')}
              aria-pressed={departmentFilter === 'Mantenimiento'}
            >
              Mantenimiento
            </button>
            <button
              type="button"
              className={`staff-att-pill-btn ${departmentFilter === 'Staff' ? 'active' : ''}`}
              onClick={() => setDepartmentFilter('Staff')}
              aria-pressed={departmentFilter === 'Staff'}
            >
              Staff / Recepción
            </button>
          </div>
        </div>
      </div>

      {/* Staff Cards Grid */}
      {filteredStaff.length > 0 ? (
        <div className="staff-att-cards-grid" role="list" aria-label="Lista de colaboradores">
          {filteredStaff.map(staff => {
            const status = staffStatuses.get(staff.id);
            const isClockedIn = Boolean(status?.isClockedIn);
            const activeRecord = status?.activeRecord;
            const dept = staff.department ?? 'Staff';
            const deptClass =
              dept === 'Entrenador'
                ? 'trainer'
                : dept === 'Mantenimiento'
                ? 'maintenance'
                : 'staff';

            return (
              <div
                key={staff.id}
                className={`staff-card-item ${isClockedIn ? 'in-turn' : ''}`}
                role="listitem"
                data-testid={`staff-card-${staff.id}`}
              >
                <div className="staff-card-head">
                  <div className="staff-card-profile">
                    <div
                      className={`staff-card-avatar ${deptClass}`}
                      aria-hidden="true"
                    >
                      {staff.avatarInitials}
                    </div>
                    <div className="staff-card-info">
                      <h3 className="staff-card-name">{staff.name}</h3>
                      <div className="staff-card-meta">
                        <span className={`staff-dept-badge ${deptClass}`}>
                          {dept}
                        </span>
                        <span className="staff-shift-label">· {staff.shift}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Indicator */}
                  <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {isClockedIn ? (
                      <span
                        className="staff-status-badge in-turn"
                        title={`En turno desde ${formatClockTime(activeRecord?.clockInAt ?? activeRecord?.clock_in_at)}`}
                      >
                        <span className="staff-att-dot staff-att-dot-in" aria-hidden="true" />
                        En turno
                      </span>
                    ) : (
                      <span className="staff-status-badge out">
                        <span className="staff-att-dot staff-att-dot-out" aria-hidden="true" />
                        Fuera del gym
                      </span>
                    )}

                    {/* Server-accepted marks indicator: present, late, review_pending */}
                    {activeRecord?.status && (
                      <span
                        className={`staff-status-badge mark-${activeRecord.status}`}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          backgroundColor:
                            activeRecord.status === 'late'
                              ? '#FEE2E2'
                              : activeRecord.status === 'review_pending'
                              ? '#FEF3C7'
                              : '#DCFCE7',
                          color:
                            activeRecord.status === 'late'
                              ? '#991B1B'
                              : activeRecord.status === 'review_pending'
                              ? '#92400E'
                              : '#166534',
                          fontWeight: 500,
                        }}
                      >
                        {activeRecord.status}
                      </span>
                    )}

                    {/* Review Required Badge */}
                    {activeRecord?.review_required && (
                      <span
                        className="staff-status-badge review-required"
                        data-testid="review-required-badge"
                        style={{
                          backgroundColor: '#FEF3C7',
                          color: '#92400E',
                          border: '1px solid #FCD34D',
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          fontWeight: 600,
                        }}
                        title="Requiere revisión de horario o validación de reloj"
                      >
                        Revisión requerida
                      </span>
                    )}
                  </div>
                </div>

                {/* If Clocked In: Details */}
                {isClockedIn && (
                  <div className="staff-active-detail-box">
                    <div className="staff-detail-row">
                      <span className="staff-detail-title">Hora de entrada:</span>
                      <strong className="staff-detail-val" style={{ color: '#16A34A' }}>
                        {formatClockTime(activeRecord?.clockInAt ?? activeRecord?.clock_in_at)}
                      </strong>
                    </div>
                    <div className="staff-detail-row">
                      <span className="staff-detail-title">Registrado por:</span>
                      <span className="staff-detail-val">
                        {activeRecord?.recordedBy ?? activeRecord?.recorded_by ?? receptionistName}
                      </span>
                    </div>
                    {activeRecord?.status && (
                      <div className="staff-detail-row">
                        <span className="staff-detail-title">Estado marca:</span>
                        <span className="staff-detail-val">
                          {activeRecord.status}
                        </span>
                      </div>
                    )}
                    {activeRecord?.notes && (
                      <div className="staff-note-alert">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        <span>Nota: {activeRecord.notes}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="staff-card-actions">
                  {!isClockedIn ? (
                    <>
                      <div className="staff-note-input-row">
                        <label htmlFor={`note-${staff.id}`}>Nota opcional:</label>
                        <input
                          id={`note-${staff.id}`}
                          type="text"
                          className="staff-note-input"
                          placeholder="Ej. Llegó 15 min tarde con justificante"
                          value={notesByStaffId[staff.id] ?? ''}
                          onChange={e =>
                            setNotesByStaffId(prev => ({
                              ...prev,
                              [staff.id]: e.target.value,
                            }))
                          }
                          aria-label={`Nota opcional de entrada para ${staff.name}`}
                        />
                      </div>
                      <div className="staff-action-buttons">
                        <Button
                          variant="primary"
                          className="staff-btn-clock-in"
                          onClick={() => handleClockIn(staff)}
                          aria-label={`Marcar entrada para ${staff.name}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="9 11 12 14 22 4" />
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                          </svg>
                          <span>Marcar Entrada</span>
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="staff-action-buttons">
                      <Button
                        variant="secondary"
                        className="staff-btn-clock-out"
                        onClick={() => handleClockOut(staff)}
                        aria-label={`Marcar salida para ${staff.name}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>Marcar Salida</span>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Sin colaboradores">
          No se encontró personal con los filtros o búsqueda especificados.
        </EmptyState>
      )}

      {/* Historial de Asistencia del Día */}
      <div className="staff-audit-panel" role="region" aria-label="Historial de registros de asistencia de hoy">
        <div className="staff-audit-header">
          <h2>Historial de registros de hoy</h2>
          <span style={{ fontSize: '13px', color: 'var(--color-muted)' }}>
            {todayRecords.length} {todayRecords.length === 1 ? 'registro' : 'registros'}
          </span>
        </div>

        {todayRecords.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="staff-audit-table" aria-label="Tabla de registros de asistencia del personal">
              <thead>
                <tr>
                  <th scope="col">Colaborador</th>
                  <th scope="col">Puesto</th>
                  <th scope="col">Hora Entrada</th>
                  <th scope="col">Hora Salida</th>
                  <th scope="col">Registrado por</th>
                  <th scope="col">Notas</th>
                </tr>
              </thead>
              <tbody>
                {todayRecords.map(rec => (
                  <tr key={rec.id}>
                    <td>
                      <strong>{rec.staffName}</strong>
                    </td>
                    <td>
                      <span className="staff-dept-badge staff">
                        {rec.roleOrDepartment ?? 'Staff'}
                      </span>
                    </td>
                    <td>
                      <strong style={{ color: '#16A34A' }}>
                        {formatClockTime(rec.clockInAt ?? rec.clock_in_at)}
                      </strong>
                    </td>
                    <td>
                      {rec.clockOutAt || rec.clock_out_at ? (
                        formatClockTime(rec.clockOutAt ?? rec.clock_out_at)
                      ) : (
                        <span className="staff-status-badge in-turn" style={{ fontSize: '11px', padding: '2px 8px' }}>
                          ● En turno
                        </span>
                      )}
                    </td>
                    <td>{rec.recordedBy ?? rec.recorded_by}</td>
                    <td>{rec.notes ? rec.notes : <span style={{ color: 'var(--color-muted)' }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--color-muted)', fontSize: '14px', margin: '8px 0' }}>
            Aún no hay registros de asistencia para el día de hoy.
          </p>
        )}
      </div>

      {/* Toast Feedback */}
      {toast && (
        <SwipeToast
          open={toast.open}
          title={toast.title}
          description={toast.description}
          onClose={() => setToast(null)}
          duration={3500}
        />
      )}
    </div>
  );
}
