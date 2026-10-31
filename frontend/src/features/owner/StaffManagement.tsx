import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useStaff, saveStaffProfile, toggleStaffActive, type StaffProfile } from '../staff/staffStore';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { Button, Panel, PageHeader, EmptyState } from '../../shared/ui';
import SquishSwitch from '../catalog/react-bits/SquishSwitch';
import CodeSlots, { type CodeSlotsStatus } from '../catalog/react-bits/CodeSlots';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import JellyRadio from '../catalog/react-bits/JellyRadio';
import { DevicePairingModal } from '../staff/DevicePairingModal';
import { useAdminSession } from '../auth/AdminSessionProvider';
import {
  issueInitialPin,
  listAdminBranches,
  listAdminRosterProfiles,
  listAdminStaffAccounts,
  linkAdminStaffAccount,
  deactivateStaffAccount,
  getStaffPendingSale,
  resolveStaffPendingSale,
  type StaffPendingSale,
  type AdminRosterProfileChoice,
  type AdminBranchChoice,
  type AdminStaffAccountChoice,
} from '../../api/staffCredentialsApi';
import {
  listScheduleSeries,
  createScheduleSeries,
  listScheduleOccurrences,
  editFutureScheduleSeries,
  createScheduleException,
  cancelScheduleSeries,
  formatScheduleSummary,
  type StaffScheduleSeriesItem,
  type StaffScheduleOccurrenceItem,
  type CreateSeriesPayload,
  type EditSeriesPayload,
} from '../../api/staffSchedulesApi';
export interface ManagedStaffProfile extends StaffProfile {
  staffUserId?: string;
}

function useOptionalAdminSession() {
  try {
    return useAdminSession();
  } catch {
    return null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function StaffManagement() {
  const staffList = useStaff();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sorting, setSorting] = useState<SortingState>([]);

  // Admin live API integration
  const adminSession = useOptionalAdminSession();
  const [liveAccounts, setLiveAccounts] = useState<AdminStaffAccountChoice[]>([]);
  const [pinIssuingId, setPinIssuingId] = useState<string | null>(null);
  const [issuedPinModal, setIssuedPinModal] = useState<{ staffName: string; pin: string } | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pairingStaff, setPairingStaff] = useState<StaffProfile | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shift, setShift] = useState('Matutino');
  const [salaryText, setSalaryText] = useState('8000');
  const [isActive, setIsActive] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');

  // Toast state
  const [toast, setToast] = useState<{
    open: boolean;
    type: 'success' | 'error';
    title: string;
    description: string;
  } | null>(null);

  const fetchLiveAccounts = useCallback(async () => {
    if (!adminSession || adminSession.status !== 'authenticated') {
      setLiveAccounts([]);
      return;
    }
    try {
      const branches = await listAdminBranches(adminSession.request);
      const branchId = import.meta.env.VITE_BRANCH_ID || branches[0]?.id;
      if (branchId) {
        const accounts = await listAdminStaffAccounts(adminSession.request, branchId);
        setLiveAccounts(accounts);
      }
    } catch {
      // Graceful fallback to local store if live fetch fails or is unauthorized
    }
  }, [adminSession]);

  useEffect(() => {
    void fetchLiveAccounts();
  }, [fetchLiveAccounts]);

  // Merge local staff with live admin accounts
  const mergedStaffList = useMemo<ManagedStaffProfile[]>(() => {
    const list: ManagedStaffProfile[] = staffList.map((s) => {
      const matched = liveAccounts.find(
        (a) => a.linked_profile_id === s.id || a.id === s.id
      );
      if (matched) {
        return {
          ...s,
          staffUserId: matched.id,
          active: matched.is_active,
        };
      }
      return { ...s };
    });

    for (const account of liveAccounts) {
      const alreadyInList = list.some(
        (s) => s.id === account.id || s.staffUserId === account.id || s.id === account.linked_profile_id
      );
      if (!alreadyInList) {
        list.push({
          id: account.id,
          name: account.login_identifier,
          role: 'RECEPTION',
          shift: 'General',
          salaryMinor: 0,
          hasPin: true,
          active: account.is_active,
          avatarInitials: account.login_identifier.slice(0, 2).toUpperCase(),
          department: 'Staff',
          staffUserId: account.id,
        });
      }
    }

    return list;
  }, [staffList, liveAccounts]);

  // Filter receptionists with stable memoization
  const filteredStaff = useMemo(() => {
    return mergedStaffList.filter((s) => {
      if (s.role !== 'RECEPTION') return false;
      const matchesStatus =
        statusFilter === 'all' ? true : statusFilter === 'active' ? s.active : !s.active;
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        query === '' ||
        s.name.toLowerCase().includes(query) ||
        s.shift.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [mergedStaffList, statusFilter, searchQuery]);

  function openCreateModal() {
    setEditingId(null);
    setName('');
    setShift('Matutino');
    setSalaryText('8000');
    setIsActive(true);
    setHasPin(false);
    setPin1('');
    setPin2('');
    setIsModalOpen(true);
  }

  const openEditModal = useCallback((staff: StaffProfile) => {
    setEditingId(staff.id);
    setName(staff.name);
    setShift(staff.shift);
    setSalaryText(staff.salaryMinor ? (staff.salaryMinor / 100).toString() : '8000');
    setIsActive(staff.active);
    setHasPin(staff.hasPin);
    setPin1(staff.hasPin ? (staff.pin ?? '1234') : '');
    setPin2(staff.hasPin ? (staff.pin ?? '1234') : '');
    setIsModalOpen(true);
  }, []);

  function closeModal() {
    setIsModalOpen(false);
    setEditingId(null);
    setPin1('');
    setPin2('');
  }

  // 2-phase PIN status validation
  let pinStatus: CodeSlotsStatus = 'idle';
  let pinValidationMsg = '';
  if (hasPin) {
    if (pin1.length === 4 && pin2.length === 4) {
      if (pin1 === pin2) {
        pinStatus = 'success';
        pinValidationMsg = '✓ PIN confirmado correctamente';
      } else {
        pinStatus = 'idle';
        pinValidationMsg = 'Los PINs no coinciden. Por favor verifica.';
      }
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    if (hasPin) {
      if (pin1.length < 4 || pin2.length < 4 || pin1 !== pin2) {
        setToast({
          open: true,
          type: 'error',
          title: 'Error de PIN',
          description: 'Debes ingresar y confirmar el mismo PIN de 4 dígitos.',
        });
        return;
      }
    }

    const salaryMinor = parseMoney(salaryText) ?? 800000;
    const staffId = editingId ?? `recep-${Date.now().toString().slice(-4)}`;

    saveStaffProfile({
      id: staffId,
      name: name.trim(),
      role: 'RECEPTION',
      shift,
      salaryMinor,
      hasPin,
      pin: hasPin ? pin1 : '',
      active: isActive,
    });

    setToast({
      open: true,
      type: 'success',
      title: editingId ? 'Perfil actualizado' : 'Recepcionista registrado',
      description: `El perfil de ${name.trim()} se ha guardado correctamente.`,
    });

    closeModal();
  }

  const handleToggleStatus = useCallback((staff: StaffProfile) => {
    const updated = toggleStaffActive(staff.id);
    if (updated) {
      setToast({
        open: true,
        type: 'success',
        title: updated.active ? 'Perfil reactivado' : 'Perfil desactivado',
        description: `${updated.name} ${updated.active ? 'ahora aparecerá' : 'ya no aparecerá'} en la pantalla de inicio.`,
      });
    }
  }, []);

  const handleIssueInitialPin = async (staff: ManagedStaffProfile) => {
    const targetUserId = staff.staffUserId || staff.id;
    if (!adminSession || !validUuid(targetUserId)) return;
    setPinIssuingId(staff.id);
    try {
      const generated = await issueInitialPin(adminSession.request, targetUserId);
      setIssuedPinModal({ staffName: staff.name, pin: generated });
      setToast({
        open: true,
        type: 'success',
        title: 'PIN Inicial Emitido',
        description: `PIN temporal para ${staff.name}: ${generated}`,
      });
    } catch {
      setToast({
        open: true,
        type: 'error',
        title: 'Error al emitir PIN',
        description: 'No se pudo generar el PIN inicial. Verifica tus permisos de administrador.',
      });
    } finally {
      setPinIssuingId(null);
    }
  };

  const receptionStaff = mergedStaffList.filter((s) => s.role === 'RECEPTION');
  const activeCount = receptionStaff.filter((s) => s.active).length;
  const inactiveCount = receptionStaff.length - activeCount;

  const columns = useMemo<ColumnDef<ManagedStaffProfile>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Recepcionista',
        cell: ({ row }) => (
          <div className="staff-cell">
            <div className="staff-avatar staff-avatar-recep" aria-hidden="true">
              {row.original.avatarInitials}
            </div>
            <div className="staff-info">
              <strong>{row.original.name}</strong>
              <span className="muted">ID: {row.original.id}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'shift',
        header: 'Turno',
        cell: ({ row }) => row.original.shift,
      },
      {
        accessorKey: 'salaryMinor',
        header: 'Sueldo mensual',
        sortDescFirst: false,
        cell: ({ row }) => (
          <span className="staff-salary-cell">
            <strong>{formatMoney(row.original.salaryMinor)}</strong>
          </span>
        ),
      },
      {
        accessorKey: 'hasPin',
        header: 'Credencial',
        cell: ({ row }) => (
          <span className="badge-pin">
            {row.original.hasPin ? '🔒 Con PIN' : '⚡ Acceso directo'}
          </span>
        ),
      },
      {
        accessorKey: 'active',
        header: 'Estado',
        cell: ({ row }) => (
          <span className={`badge ${row.original.active ? 'badge-success' : 'badge-neutral'}`}>
            {row.original.active ? '● Activo' : '○ Inactivo'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => {
          const isEligibleForPin = Boolean(
            adminSession?.status === 'authenticated' &&
            validUuid(row.original.staffUserId ?? row.original.id)
          );

          return (
            <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end', width: '100%', flexWrap: 'wrap' }}>
              {adminSession?.status === 'authenticated' && (
                <Button
                  variant="secondary"
                  disabled={!isEligibleForPin || pinIssuingId === row.original.id}
                  onClick={() => void handleIssueInitialPin(row.original)}
                  title={isEligibleForPin ? 'Emitir PIN inicial para acceso seguro' : 'Requiere ID UUID de personal'}
                >
                  {pinIssuingId === row.original.id ? 'Emitiendo…' : 'Emitir PIN'}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => setPairingStaff(row.original)}
                title="Vincular teléfono del empleado sin contraseñas"
              >
                Vincular Dispositivo
              </Button>
              <Button variant="secondary" onClick={() => openEditModal(row.original)}>
                Editar
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleToggleStatus(row.original)}
                style={{
                  color: row.original.active ? 'var(--catalog-field-error, #A32222)' : 'inherit',
                }}
              >
                {row.original.active ? 'Desactivar' : 'Activar'}
              </Button>
            </div>
          );
        },
      },
    ],
    [openEditModal, handleToggleStatus, adminSession, pinIssuingId]
  );

  const table = useReactTable({
    data: filteredStaff,
    columns,
    getRowId: (row) => row.id,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="staff-mgmt-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN · PERSONAL</p>
          <h1>Equipo de Recepción</h1>
          <p className="muted">
            {activeCount} activos · {inactiveCount} inactivos · {receptionStaff.length} en total
          </p>
        </div>
        <Button variant="primary" onClick={openCreateModal}>
          <span>+</span> Nuevo recepcionista
        </Button>
      </header>

      {/* Main Content Panel */}
      <Panel className="staff-mgmt-panel">
        <div className="staff-mgmt-toolbar">
          <div className="field staff-mgmt-search">
            <label htmlFor="staff-search-input" className="sr-only">
              Buscar recepcionista
            </label>
            <input
              id="staff-search-input"
              type="text"
              placeholder="Buscar por nombre o turno..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="staff-mgmt-filters">
            <JellyRadio
              items={[
                { value: 'all', label: 'Todos' },
                { value: 'active', label: 'Activos' },
                { value: 'inactive', label: 'Inactivos' },
              ]}
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as 'all' | 'active' | 'inactive')}
              size="sm"
              chipColor="var(--color-surface-soft, #242424)"
              activeColor="var(--color-primary, #FC6C06)"
              textColor="var(--color-muted, #a3a3a3)"
              activeTextColor="#080808"
              ariaLabel="Filtrar por estado"
            />
          </div>
        </div>

        {/* Elevated TanStack Table */}
        <div
          className="table-region staff-table-region"
          role="region"
          aria-label="Listado de recepcionistas"
        >
          <table className="staff-table">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const isSorted = header.column.getIsSorted();
                    const headerLabel =
                      typeof header.column.columnDef.header === 'string'
                        ? header.column.columnDef.header
                        : 'columna';

                    return (
                      <th
                        key={header.id}
                        style={header.id === 'actions' ? { textAlign: 'right' } : undefined}
                        aria-sort={
                          canSort
                            ? isSorted === 'asc'
                              ? 'ascending'
                              : isSorted === 'desc'
                              ? 'descending'
                              : 'none'
                            : undefined
                        }
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            className="staff-table-sort-btn"
                            onClick={header.column.getToggleSortingHandler()}
                            aria-label={`Ordenar por ${headerLabel.toLowerCase()}`}
                          >
                            <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            <span className="sort-indicator" aria-hidden="true">
                              {isSorted === 'asc' ? ' ▲' : isSorted === 'desc' ? ' ▼' : ' ⇅'}
                            </span>
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    style={{ textAlign: 'center', padding: '32px', color: 'var(--color-muted)' }}
                  >
                    No se encontraron recepcionistas con los criterios actuales.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        style={cell.column.id === 'actions' ? { textAlign: 'right' } : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Modal Dialog with 2-phase PIN and SquishSwitch */}
      {isModalOpen && (
        <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-staff-form-title">
          <div className="staff-modal-card staff-mgmt-modal-card">
            <div className="staff-modal-header" style={{ width: '100%', textAlign: 'left', alignItems: 'flex-start' }}>
              <h2 id="modal-staff-form-title">
                {editingId ? 'Editar Recepcionista' : 'Nuevo Recepcionista'}
              </h2>
              <p className="muted">Registra los datos de acceso, turno y remuneración del empleado</p>
            </div>

            <form onSubmit={handleSave} className="staff-form">
              <div className="field">
                <label htmlFor="staff-name-input">Nombre completo *</label>
                <input
                  id="staff-name-input"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Valeria Morales"
                  autoFocus
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="staff-shift-select">Turno asignado</label>
                  <select
                    id="staff-shift-select"
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                  >
                    <option value="Matutino">Matutino (06:00 - 14:00)</option>
                    <option value="Vespertino">Vespertino (14:00 - 22:00)</option>
                    <option value="Mixto">Mixto</option>
                    <option value="Fin de semana">Fin de semana</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="staff-salary-input">Sueldo mensual (MXN) *</label>
                  <input
                    id="staff-salary-input"
                    type="number"
                    step="50"
                    min="0"
                    required
                    value={salaryText}
                    onChange={(e) => setSalaryText(e.target.value)}
                    placeholder="8000"
                  />
                </div>
              </div>

              <div className="field">
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Estado de la cuenta
                </label>
                <JellyRadio
                  items={[
                    { value: 'active', label: '● Activo' },
                    { value: 'inactive', label: '○ Inactivo' },
                  ]}
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(val) => setIsActive(val === 'active')}
                  size="sm"
                  chipColor="var(--color-surface-soft, #242424)"
                  activeColor="var(--color-primary, #FC6C06)"
                  textColor="var(--color-muted, #a3a3a3)"
                  activeTextColor="#080808"
                  ariaLabel="Estado de la cuenta"
                />
              </div>

              {/* 2-Phase PIN Configuration with SquishSwitch */}
              <div className="staff-pin-toggle-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>Configurar PIN de acceso</strong>
                    <p className="muted" style={{ fontSize: '12px', margin: '2px 0 0' }}>
                      Opcional. Si está desactivado, el empleado entrará directamente sin clave.
                    </p>
                  </div>
                  <SquishSwitch
                    checked={hasPin}
                    onChange={(checked) => {
                      setHasPin(checked);
                      if (!checked) {
                        setPin1('');
                        setPin2('');
                      }
                    }}
                    ariaLabel="Activar PIN de acceso"
                    trackOnColor="var(--color-primary)"
                    thumbOnColor="var(--color-primary-text)"
                  />
                </div>

                {hasPin && (
                  <div className="staff-2phase-pin-container">
                    {/* Phase 1 */}
                    <div className="pin-phase-box">
                      <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                        1. Ingresa el PIN (4 dígitos)
                      </label>
                      <CodeSlots
                        length={4}
                        value={pin1}
                        onChange={setPin1}
                        mask
                        autoFocus
                        ariaLabel="Primer ingreso del PIN"
                        accentColor="var(--color-primary)"
                        slotColor="var(--color-canvas)"
                        inkColor="var(--color-ink)"
                        digitColor="var(--color-ink)"
                      />
                    </div>

                    {/* Phase 2: Confirmation */}
                    <div className="pin-phase-box">
                      <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                        2. Confirma el PIN (repite los 4 dígitos)
                      </label>
                      <CodeSlots
                        length={4}
                        value={pin2}
                        onChange={setPin2}
                        mask
                        ariaLabel="Confirmación del PIN"
                        status={pinStatus}
                        accentColor="var(--color-primary)"
                        slotColor="var(--color-canvas)"
                        inkColor="var(--color-ink)"
                        digitColor="var(--color-ink)"
                      />
                    </div>

                    {pinValidationMsg && (
                      <p
                        className={pinStatus === 'success' ? 'pin-confirm-success' : 'staff-pin-error'}
                        role="status"
                      >
                        {pinValidationMsg}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="staff-modal-actions">
                <Button variant="secondary" onClick={closeModal}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={hasPin && (pin1.length < 4 || pin2.length < 4 || pin1 !== pin2)}
                >
                  {editingId ? 'Guardar cambios' : 'Crear perfil'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issued PIN Modal */}
      {issuedPinModal && (
        <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-issued-pin-title">
          <div className="staff-modal-card staff-mgmt-modal-card" style={{ maxWidth: '420px', textAlign: 'center' }}>
            <div className="staff-modal-header" style={{ width: '100%', alignItems: 'center' }}>
              <h2 id="modal-issued-pin-title">PIN Inicial Generado</h2>
              <p className="muted">Comunica esta credencial directamente al empleado. Sólo se muestra una vez.</p>
            </div>
            <div style={{ margin: '24px 0', padding: '16px', background: 'var(--color-canvas)', borderRadius: '12px' }}>
              <span className="muted" style={{ fontSize: '13px' }}>Empleado: {issuedPinModal.staffName}</span>
              <p style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '8px', margin: '12px 0', color: 'var(--color-primary)' }}>
                {issuedPinModal.pin}
              </p>
            </div>
            <div className="staff-modal-actions" style={{ justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => setIssuedPinModal(null)}>
                Entendido y copiado
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SwipeToast notification */}
      {toast && (
        <div className="staff-toast-wrapper">
          <SwipeToast
            open={toast.open}
            title={toast.title}
            description={toast.description}
            duration={3200}
            fuse={toast.type === 'error' ? 'none' : 'bottom'}
            closeButton
            closeLabel="Cerrar notificación"
            background="var(--color-surface)"
            color="var(--color-ink)"
            fuseColor={toast.type === 'error' ? 'var(--catalog-field-error, #A32222)' : 'var(--color-primary)'}
            onClose={() => setToast(null)}
          />
        </div>
      )}

      {/* Device Pairing Modal */}
      {pairingStaff && (
        <DevicePairingModal
          isOpen={Boolean(pairingStaff)}
          staff={pairingStaff}
          onClose={() => setPairingStaff(null)}
        />
      )}
    </div>
  );
}

export function LiveStaffManagement() {
  return <StaffManagement />;
}

/** Server-only staff management for the authenticated product shell. */
export function ApiStaffManagement() {
  const adminSession = useOptionalAdminSession();
  const [branches, setBranches] = useState<AdminBranchChoice[]>([]);
  const [branchId, setBranchId] = useState('');
  const [profiles, setProfiles] = useState<AdminRosterProfileChoice[]>([]);
  const [accounts, setAccounts] = useState<AdminStaffAccountChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editingProfile, setEditingProfile] = useState<AdminRosterProfileChoice | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [linking, setLinking] = useState(false);
  const [pinIssuingId, setPinIssuingId] = useState<string | null>(null);
  const [issuedPin, setIssuedPin] = useState<{ name: string; value: string } | null>(null);
  const [deviceProfile, setDeviceProfile] = useState<AdminRosterProfileChoice | null>(null);
  const [deactivation, setDeactivation] = useState<{ profile: AdminRosterProfileChoice; pending: StaffPendingSale | null; active: boolean } | null>(null);
  const [deactivationBusy, setDeactivationBusy] = useState(false);
  const [scheduleSeries, setScheduleSeries] = useState<StaffScheduleSeriesItem[]>([]);
  const [scheduleWeekdays, setScheduleWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [scheduleStartTime, setScheduleStartTime] = useState('06:00');
  const [scheduleEndTime, setScheduleEndTime] = useState('14:00');
  const [scheduleStartDate, setScheduleStartDate] = useState('');
  const [scheduleEndDate, setScheduleEndDate] = useState('');
  const [scheduleEditScope, setScheduleEditScope] = useState<'this_and_future' | 'all_future'>('this_and_future');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleCancelling, setScheduleCancelling] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [occurrences, setOccurrences] = useState<StaffScheduleOccurrenceItem[]>([]);
  const [overridingDate, setOverridingDate] = useState<string | null>(null);
  const [overrideStartTime, setOverrideStartTime] = useState('');
  const [overrideEndTime, setOverrideEndTime] = useState('');
  const [exceptionSaving, setExceptionSaving] = useState(false);
  const operation = useRef(0);

  useEffect(() => {
    if (!adminSession || adminSession.status !== 'authenticated') {
      setBranches([]);
      setBranchId('');
      setProfiles([]);
      setAccounts([]);
      setEditingProfile(null);
      setSelectedAccountId('');
      setDeviceProfile(null);
      setIssuedPin(null);
      setError('La sesión Admin no está disponible. Vuelve a iniciar sesión.');
      return;
    }
    const current = ++operation.current;
    setLoading(true);
    setError('');
    void listAdminBranches(adminSession.request).then(rows => {
      if (operation.current === current) setBranches(rows);
    }).catch(() => {
      if (operation.current === current) setError('No se pudieron cargar las sucursales desde la API.');
    }).finally(() => {
      if (operation.current === current) setLoading(false);
    });
    return () => { operation.current += 1; };
  }, [adminSession]);

  const loadBranch = useCallback(async (nextBranchId: string) => {
    const current = ++operation.current;
    setBranchId(nextBranchId);
    setProfiles([]);
    setAccounts([]);
    setEditingProfile(null);
    setSelectedAccountId('');
    setLinking(false);
    setPinIssuingId(null);
    setIssuedPin(null);
    setDeviceProfile(null);
    setError('');
    setNotice('');
    setScheduleSeries([]);
    setOccurrences([]);
    setOverridingDate(null);
    setScheduleError('');
    setLoading(false);
    if (!nextBranchId || !adminSession || adminSession.status !== 'authenticated') return;
    setLoading(true);
    try {
      const [nextProfiles, nextAccounts, nextSeries] = await Promise.all([
        listAdminRosterProfiles(adminSession.request, nextBranchId),
        listAdminStaffAccounts(adminSession.request, nextBranchId),
        listScheduleSeries(adminSession.request, nextBranchId).catch(() => []),
      ]);
      if (operation.current === current) {
        setProfiles(nextProfiles);
        setAccounts(nextAccounts);
        setScheduleSeries(nextSeries);
      }
    } catch {
      if (operation.current === current) setError('No se pudo cargar el personal de la sucursal. No se usaron datos locales.');
    } finally {
      if (operation.current === current) setLoading(false);
    }
  }, [adminSession]);

  const filteredProfiles = profiles.filter(profile =>
    (statusFilter === 'all' || (statusFilter === 'active' ? profile.is_active : !profile.is_active)) &&
    `${profile.full_name} ${profile.position}`.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()));
  const activeCount = profiles.filter(profile => profile.is_active).length;
  const inactiveCount = profiles.length - activeCount;

  const getActiveSeriesForProfile = useCallback((profileId: string) => {
    const list = scheduleSeries.filter(s => s.profile_id === profileId);
    const active = list.find(s => !s.cancelled_from) ?? list[0];
    return active;
  }, [scheduleSeries]);

  const loadOccurrences = useCallback(async (seriesId: string) => {
    if (!adminSession || adminSession.status !== 'authenticated') return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const toDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const list = await listScheduleOccurrences(adminSession.request, seriesId, today, toDate);
      setOccurrences(list);
    } catch {
      setOccurrences([]);
    }
  }, [adminSession]);

  function openEdit(profile: AdminRosterProfileChoice) {
    if (!profiles.some(row => row.id === profile.id)) return;
    setEditingProfile(profile);
    setSelectedAccountId(profile.staff_user_id ?? '');
    setError('');
    setNotice('');
    setScheduleError('');
    setOverridingDate(null);

    const active = getActiveSeriesForProfile(profile.id);
    const today = new Date().toISOString().slice(0, 10);
    if (active) {
      setScheduleWeekdays(active.weekdays.length ? active.weekdays : [0, 1, 2, 3, 4]);
      setScheduleStartTime(active.start_time.slice(0, 5));
      setScheduleEndTime(active.end_time.slice(0, 5));
      setScheduleStartDate(active.start_date);
      setScheduleEndDate(active.end_date ?? '');
      setScheduleEditScope('this_and_future');
      void loadOccurrences(active.id);
    } else {
      setScheduleWeekdays([0, 1, 2, 3, 4]);
      setScheduleStartTime('06:00');
      setScheduleEndTime('14:00');
      setScheduleStartDate(today);
      setScheduleEndDate('');
      setScheduleEditScope('this_and_future');
      setOccurrences([]);
    }
  }

  function closeEdit() {
    setEditingProfile(null);
    setSelectedAccountId('');
    setOverridingDate(null);
    setScheduleError('');
  }

  async function handleSaveSchedule() {
    if (!editingProfile || !branchId || !adminSession || adminSession.status !== 'authenticated') return;
    const active = getActiveSeriesForProfile(editingProfile.id);
    setScheduleSaving(true);
    setScheduleError('');
    try {
      const startTime = scheduleStartTime.length === 5 ? `${scheduleStartTime}:00` : scheduleStartTime;
      const endTime = scheduleEndTime.length === 5 ? `${scheduleEndTime}:00` : scheduleEndTime;

      if (active) {
        const payload: EditSeriesPayload = {
          effective_date: scheduleStartDate,
          scope: scheduleEditScope,
          weekdays: scheduleWeekdays,
          start_time: startTime,
          end_time: endTime,
          end_date: scheduleEndDate ? scheduleEndDate : null,
        };
        const updated = await editFutureScheduleSeries(adminSession.request, active.id, payload);
        const nextSeries = await listScheduleSeries(adminSession.request, branchId);
        setScheduleSeries(nextSeries);
        await loadOccurrences(updated.id);
        setNotice('Horario actualizado correctamente.');
      } else {
        const payload: CreateSeriesPayload = {
          start_date: scheduleStartDate,
          weekdays: scheduleWeekdays,
          start_time: startTime,
          end_time: endTime,
          end_date: scheduleEndDate ? scheduleEndDate : null,
        };
        const created = await createScheduleSeries(adminSession.request, branchId, editingProfile.id, payload);
        const nextSeries = await listScheduleSeries(adminSession.request, branchId);
        setScheduleSeries(nextSeries);
        await loadOccurrences(created.id);
        setNotice('Horario asignado correctamente.');
      }
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Error al guardar horario.');
    } finally {
      setScheduleSaving(false);
    }
  }

  async function handleCancelSchedule() {
    if (!editingProfile || !branchId || !adminSession || adminSession.status !== 'authenticated') return;
    const active = getActiveSeriesForProfile(editingProfile.id);
    if (!active) return;
    setScheduleCancelling(true);
    setScheduleError('');
    try {
      await cancelScheduleSeries(adminSession.request, active.id);
      const nextSeries = await listScheduleSeries(adminSession.request, branchId);
      setScheduleSeries(nextSeries);
      await loadOccurrences(active.id);
      setNotice('Serie de horario cancelada.');
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Error al cancelar horario.');
    } finally {
      setScheduleCancelling(false);
    }
  }

  async function handleSkipOccurrence(localDate: string) {
    if (!editingProfile || !adminSession || adminSession.status !== 'authenticated') return;
    const active = getActiveSeriesForProfile(editingProfile.id);
    if (!active) return;
    setExceptionSaving(true);
    setScheduleError('');
    try {
      await createScheduleException(adminSession.request, active.id, localDate, { action: 'skip' });
      await loadOccurrences(active.id);
      setNotice(`Ocurrencia del ${localDate} omitida.`);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Error al omitir ocurrencia.');
    } finally {
      setExceptionSaving(false);
    }
  }

  async function handleSaveOverride(localDate: string) {
    if (!editingProfile || !adminSession || adminSession.status !== 'authenticated') return;
    const active = getActiveSeriesForProfile(editingProfile.id);
    if (!active || !overrideStartTime || !overrideEndTime) return;
    setExceptionSaving(true);
    setScheduleError('');
    try {
      const startTime = overrideStartTime.length === 5 ? `${overrideStartTime}:00` : overrideStartTime;
      const endTime = overrideEndTime.length === 5 ? `${overrideEndTime}:00` : overrideEndTime;
      await createScheduleException(adminSession.request, active.id, localDate, {
        action: 'override',
        start_time: startTime,
        end_time: endTime,
      });
      await loadOccurrences(active.id);
      setOverridingDate(null);
      setNotice(`Horario modificado para el ${localDate}.`);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Error al cambiar horario de la ocurrencia.');
    } finally {
      setExceptionSaving(false);
    }
  }

  async function linkAccount() {
    const profile = editingProfile;
    const targetBranch = branchId;
    const accountId = selectedAccountId;
    if (!profile || profile.staff_user_id || !accountId || !targetBranch || !adminSession ||
        adminSession.status !== 'authenticated' || linking || !profiles.some(row => row.id === profile.id)) return;
    const account = accounts.find(row => row.id === accountId);
    if (!account || !account.is_active || (account.linked_profile_id !== null && account.linked_profile_id !== profile.id)) return;
    const current = operation.current;
    setLinking(true);
    setError('');
    setNotice('');
    try {
      await linkAdminStaffAccount(adminSession.request, profile.id, account.id);
      if (operation.current !== current || branchId !== targetBranch) return;
      closeEdit();
      setLinking(false);
      const refresh = ++operation.current;
      setLoading(true);
      try {
        const [nextProfiles, nextAccounts, nextSeries] = await Promise.all([
          listAdminRosterProfiles(adminSession.request, targetBranch),
          listAdminStaffAccounts(adminSession.request, targetBranch),
          listScheduleSeries(adminSession.request, targetBranch).catch(() => []),
        ]);
        if (operation.current === refresh) {
          setProfiles(nextProfiles);
          setAccounts(nextAccounts);
        setScheduleSeries(nextSeries);
          setNotice(`La cuenta ${account.login_identifier} quedó vinculada a ${profile.full_name}.`);
        }
      } catch {
        if (operation.current === refresh) setError('La cuenta se vinculó, pero no se pudo actualizar la vista. Recarga la sucursal.');
      } finally {
        if (operation.current === refresh) setLoading(false);
      }
    } catch {
      if (operation.current === current && branchId === targetBranch) {
        setError('No se pudo vincular la cuenta. Actualiza la sucursal antes de volver a intentarlo.');
      }
    } finally {
      if (operation.current === current) setLinking(false);
    }
  }

  async function issuePin(profile: AdminRosterProfileChoice) {
    const targetUserId = profile.staff_user_id;
    const targetBranch = branchId;
    if (!targetUserId || !adminSession || adminSession.status !== 'authenticated' ||
        !profiles.some(row => row.id === profile.id && row.staff_user_id === targetUserId)) return;
    const current = ++operation.current;
    setPinIssuingId(profile.id);
    setIssuedPin(null);
    setError('');
    try {
      const value = await issueInitialPin(adminSession.request, targetUserId);
      if (operation.current === current && branchId === targetBranch &&
          profiles.some(row => row.id === profile.id && row.staff_user_id === targetUserId)) {
        setIssuedPin({ name: profile.full_name, value });
      }
    } catch {
      if (operation.current === current && branchId === targetBranch) setError('No se pudo emitir el PIN inicial desde la API.');
    } finally {
      if (operation.current === current) setPinIssuingId(null);
    }
  }

  const deviceAccount = deviceProfile?.staff_user_id
    ? accounts.find(account => account.id === deviceProfile.staff_user_id && account.linked_profile_id === deviceProfile.id)
    : undefined;

  async function openDeactivation(profile: AdminRosterProfileChoice, active: boolean) {
    if (!profile.staff_user_id || !adminSession || adminSession.status !== 'authenticated') return;
    setDeactivationBusy(true); setError('');
    try {
      const pending = await getStaffPendingSale(adminSession.request, profile.staff_user_id);
      setDeactivation({ profile, pending, active });
    } catch { setError('No se pudo consultar la venta pendiente. Intenta de nuevo.'); }
    finally { setDeactivationBusy(false); }
  }

  async function resolveDeactivationSale() {
    if (!deactivation?.pending || !deactivation.profile.staff_user_id || !adminSession || adminSession.status !== 'authenticated') return;
    setDeactivationBusy(true); setError('');
    try {
      const status = await resolveStaffPendingSale(adminSession.request, deactivation.profile.staff_user_id, deactivation.pending.key);
      const pending = await getStaffPendingSale(adminSession.request, deactivation.profile.staff_user_id);
      setDeactivation({ ...deactivation, pending });
      setNotice(status === 'completed' ? 'La venta ya estaba registrada.' : 'El intento pendiente fue cancelado; no se registró una venta.');
    } catch { setError('No se pudo confirmar la resolución. Vuelve a consultar el estado.'); }
    finally { setDeactivationBusy(false); }
  }

  async function confirmDeactivation() {
    if (!deactivation || deactivation.pending || !deactivation.profile.staff_user_id || !adminSession || adminSession.status !== 'authenticated') return;
    setDeactivationBusy(true); setError('');
    try {
      await deactivateStaffAccount(adminSession.request, deactivation.profile.staff_user_id);
      setDeactivation(null); setNotice('La cuenta de acceso fue desactivada.');
      await loadBranch(branchId);
    } catch {
      setError('No se pudo desactivar la cuenta. Puede existir una venta pendiente; consulta nuevamente.');
      setDeactivation(null);
    } finally { setDeactivationBusy(false); }
  }

  return <div className="staff-mgmt-page">
    <header className="page-header">
      <div>
        <p className="eyebrow">ADMINISTRACIÓN · PERSONAL</p>
        <h1>Equipo de Recepción</h1>
        <p className="muted">{activeCount} activos · {inactiveCount} inactivos · {profiles.length} en total</p>
      </div>
      <Button variant="primary" disabled title="La creación de perfiles aún no está disponible en la API.">
        <span>+</span> Nuevo recepcionista
      </Button>
    </header>

    <Panel className="staff-mgmt-panel">
      <div className="staff-mgmt-toolbar">
        <div className="field staff-mgmt-search">
          <label htmlFor="api-staff-branch">Sucursal</label>
          <select id="api-staff-branch" value={branchId} disabled={loading || !branches.length}
            onChange={event => void loadBranch(event.target.value)}>
            <option value="">Selecciona una sucursal</option>
            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
          </select>
        </div>
        <div className="field staff-mgmt-search">
          <label htmlFor="staff-search-input" className="sr-only">Buscar recepcionista</label>
          <input id="staff-search-input" type="text" placeholder="Buscar recepcionista o turno..."
            value={searchQuery} onChange={event => setSearchQuery(event.target.value)} />
        </div>
        <div className="staff-mgmt-filters">
          <JellyRadio items={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Activos' }, { value: 'inactive', label: 'Inactivos' }]}
            value={statusFilter} onChange={value => setStatusFilter(value as typeof statusFilter)} size="sm"
            chipColor="var(--color-surface-soft, #242424)" activeColor="var(--color-primary, #FC6C06)"
            textColor="var(--color-muted, #a3a3a3)" activeTextColor="#080808" ariaLabel="Filtrar por estado" />
        </div>
      </div>
      {error && <p role="alert" className="staff-pin-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Cargando personal desde la API…</p>}
      <div className="table-region staff-table-region" role="region" aria-label="Listado de recepcionistas">
        <table className="staff-table">
          <thead><tr><th>Recepcionista</th><th>Turno</th><th>Sueldo mensual</th><th>Credencial</th><th>Estado</th><th style={{ textAlign: 'right' }}>Acciones</th></tr></thead>
          <tbody>{filteredProfiles.length ? filteredProfiles.map(profile => {
            const account = profile.staff_user_id ? accounts.find(row => row.id === profile.staff_user_id && row.linked_profile_id === profile.id) : undefined;
            return <tr key={profile.id}>
              <td><div className="staff-cell"><div className="staff-avatar staff-avatar-recep" aria-hidden="true">{profile.full_name.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase() || '?'}</div>
                <div className="staff-info"><strong>{profile.full_name}</strong><span className="muted">{profile.position} · ID: {profile.id}</span>
                  {account && <span className="muted">Cuenta: {account.login_identifier} · {account.is_active ? 'Activa' : 'Inactiva'}</span>}</div></div></td>
              <td>{formatScheduleSummary(getActiveSeriesForProfile(profile.id))}</td><td>No disponible en API</td><td>No disponible en API</td>
              <td><span className={`badge ${profile.is_active ? 'badge-success' : 'badge-neutral'}`}>{profile.is_active ? '● Activo' : '○ Inactivo'}</span></td>
              <td><div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end', width: '100%', flexWrap: 'wrap' }}>
                <Button variant="secondary" disabled={!profile.staff_user_id || pinIssuingId === profile.id}
                  onClick={() => void issuePin(profile)} title={profile.staff_user_id ? 'Emitir PIN inicial desde la API' : 'Vincula una cuenta antes de emitir el PIN'}>
                  {pinIssuingId === profile.id ? 'Emitiendo…' : 'Emitir PIN'}
                </Button>
                <Button variant="secondary" disabled={!account?.is_active || !profile.is_active}
                  onClick={() => setDeviceProfile(profile)} title="Gestionar dispositivos vinculados desde la API">Vincular Dispositivo</Button>
                <Button variant="secondary" onClick={() => openEdit(profile)}>Editar</Button>
                <Button variant="secondary" disabled={!account || deactivationBusy}
                  onClick={() => void openDeactivation(profile, Boolean(account?.is_active))}>
                  {account?.is_active ? 'Desactivar cuenta' : 'Consultar venta pendiente'}
                </Button>
                <Button variant="secondary" disabled title="La activación y desactivación aún no están disponibles en la API.">
                  {profile.is_active ? 'Desactivar' : 'Activar'}
                </Button>
              </div></td>
            </tr>;
          }) : <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--color-muted)' }}>
            {branchId ? 'No se encontraron recepcionistas con los criterios actuales.' : 'Selecciona una sucursal para consultar al personal.'}
          </td></tr>}</tbody>
        </table>
      </div>
    </Panel>

    {deactivation && <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="deactivate-account-title">
      <div className="staff-modal-card">
        <h2 id="deactivate-account-title">Desactivar cuenta de {deactivation.profile.full_name}</h2>
        {deactivation.pending ? <>
          <p>Hay una venta pendiente por ${((deactivation.pending.payload.expected_total_minor) / 100).toFixed(2)}. Resuélvela antes de desactivar la cuenta.</p>
          <p>Caja: {deactivation.pending.register_id}. Productos: {deactivation.pending.payload.items.reduce((sum, item) => sum + item.quantity, 0)}.</p>
          <p>Al resolverla, se confirmará si ya se registró; si no, el intento se cancelará para impedir un cobro tardío.</p>
          <Button disabled={deactivationBusy} onClick={() => void resolveDeactivationSale()}>Resolver venta pendiente</Button>
        </> : deactivation.active ? <>
          <p>Se revocarán las sesiones y dispositivos vinculados a esta cuenta.</p>
          <Button disabled={deactivationBusy} onClick={() => void confirmDeactivation()}>Confirmar desactivación de cuenta</Button>
        </> : <p>Esta cuenta está inactiva y no tiene ventas pendientes.</p>}
        <Button variant="secondary" disabled={deactivationBusy} onClick={() => setDeactivation(null)}>Cerrar</Button>
      </div>
    </div>}

    {editingProfile && <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-staff-form-title">
      <div className="staff-modal-card staff-mgmt-modal-card">
        <div className="staff-modal-header" style={{ width: '100%', textAlign: 'left', alignItems: 'flex-start' }}>
          <h2 id="modal-staff-form-title">Editar Recepcionista</h2>
          <p className="muted">Administra el horario semanal y la cuenta de acceso del colaborador.</p>
        </div>
        <form className="staff-form" onSubmit={event => event.preventDefault()}>
          <div className="field"><label htmlFor="staff-name-input">Nombre completo *</label><input id="staff-name-input" value={editingProfile.full_name} readOnly /></div>
          <div className="field-row">

            <div className="field"><label htmlFor="staff-salary-input">Sueldo mensual (MXN) *</label><input id="staff-salary-input" type="text" disabled value="No disponible en API" /></div>
          </div>
          {(() => {
            const activeScheduleSeries = getActiveSeriesForProfile(editingProfile.id);
            return (
              <div className="staff-pin-toggle-card" style={{ marginTop: '12px' }}>
                <div>
                  <strong>Horario semanal recurrente</strong>
                  <p className="muted" style={{ fontSize: '12px', margin: '2px 0 8px' }}>
                    Define los días y horas de turno habituales para este colaborador.
                  </p>
                </div>

                <div style={{ margin: '8px 0' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Días laborales
                  </label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[
                      { day: 0, label: 'L' },
                      { day: 1, label: 'M' },
                      { day: 2, label: 'X' },
                      { day: 3, label: 'J' },
                      { day: 4, label: 'V' },
                      { day: 5, label: 'S' },
                      { day: 6, label: 'D' },
                    ].map(w => {
                      const active = scheduleWeekdays.includes(w.day);
                      return (
                        <button
                          key={w.day}
                          type="button"
                          className={`staff-att-pill-btn ${active ? 'active' : ''}`}
                          style={active ? { background: 'var(--color-primary, #FC6C06)', color: '#000', fontWeight: 700 } : undefined}
                          onClick={() => {
                            setScheduleWeekdays(prev =>
                              prev.includes(w.day)
                                ? (prev.length > 1 ? prev.filter(d => d !== w.day) : prev)
                                : [...prev, w.day].sort((a, b) => a - b)
                            );
                          }}
                          disabled={scheduleSaving || scheduleCancelling}
                          aria-label={`Día ${w.label}`}
                        >
                          {w.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="staff-schedule-start-time">Hora inicio</label>
                    <input
                      id="staff-schedule-start-time"
                      type="time"
                      value={scheduleStartTime}
                      onChange={e => setScheduleStartTime(e.target.value)}
                      disabled={scheduleSaving || scheduleCancelling}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="staff-schedule-end-time">Hora fin</label>
                    <input
                      id="staff-schedule-end-time"
                      type="time"
                      value={scheduleEndTime}
                      onChange={e => setScheduleEndTime(e.target.value)}
                      disabled={scheduleSaving || scheduleCancelling}
                    />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="staff-schedule-start-date">Fecha inicio</label>
                    <input
                      id="staff-schedule-start-date"
                      type="date"
                      value={scheduleStartDate}
                      onChange={e => setScheduleStartDate(e.target.value)}
                      disabled={scheduleSaving || scheduleCancelling}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="staff-schedule-end-date">Fecha fin (opcional)</label>
                    <input
                      id="staff-schedule-end-date"
                      type="date"
                      value={scheduleEndDate}
                      onChange={e => setScheduleEndDate(e.target.value)}
                      disabled={scheduleSaving || scheduleCancelling}
                    />
                  </div>
                </div>

                {activeScheduleSeries && (
                  <div className="field" style={{ margin: '8px 0' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                      Alcance de edición
                    </label>
                    <JellyRadio
                      items={[
                        { value: 'this_and_future', label: 'Esta y futuras' },
                        { value: 'all_future', label: 'Toda la serie' },
                      ]}
                      value={scheduleEditScope}
                      onChange={val => setScheduleEditScope(val as 'this_and_future' | 'all_future')}
                      size="sm"
                      ariaLabel="Alcance de edición de horario"
                    />
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <Button
                    variant="primary"
                    disabled={scheduleSaving || scheduleCancelling || !scheduleStartTime || !scheduleEndTime || !scheduleStartDate || scheduleWeekdays.length === 0}
                    onClick={handleSaveSchedule}
                  >
                    {scheduleSaving ? 'Guardando horario…' : activeScheduleSeries ? 'Actualizar horario' : 'Asignar horario'}
                  </Button>
                  {activeScheduleSeries && (
                    <Button
                      variant="secondary"
                      disabled={scheduleSaving || scheduleCancelling}
                      onClick={handleCancelSchedule}
                    >
                      {scheduleCancelling ? 'Cancelando…' : 'Cancelar serie futura'}
                    </Button>
                  )}
                </div>

                {scheduleError && (
                  <p role="alert" className="staff-pin-error" style={{ marginTop: '8px' }}>
                    {scheduleError}
                  </p>
                )}

                {activeScheduleSeries && occurrences.length > 0 && (
                  <div style={{ marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--color-muted)' }}>
                      Próximas ocurrencias (7 días)
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {occurrences.map(occ => {
                        const isEditing = overridingDate === occ.local_date;
                        const timeDisplay = `${occ.local_start.slice(11, 16)}–${occ.local_end.slice(11, 16)}`;
                        return (
                          <div
                            key={occ.local_date}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '6px 10px',
                              background: 'var(--color-canvas, #1a1a1a)',
                              borderRadius: '6px',
                              fontSize: '12px',
                            }}
                          >
                            <span>
                              <strong>{occ.local_date}</strong> · {timeDisplay}
                              {occ.recorded_exception === 'skip' && (
                                <span className="badge badge-neutral" style={{ marginLeft: '6px', fontSize: '10px' }}>Omitida</span>
                              )}
                              {occ.recorded_exception === 'override' && (
                                <span className="badge badge-warning" style={{ marginLeft: '6px', fontSize: '10px' }}>Hora cambiada</span>
                              )}
                            </span>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              {isEditing ? (
                                <>
                                  <input
                                    type="time"
                                    value={overrideStartTime}
                                    onChange={e => setOverrideStartTime(e.target.value)}
                                    style={{ fontSize: '11px', padding: '2px 4px' }}
                                    aria-label="Hora inicio excepción"
                                  />
                                  <span>–</span>
                                  <input
                                    type="time"
                                    value={overrideEndTime}
                                    onChange={e => setOverrideEndTime(e.target.value)}
                                    style={{ fontSize: '11px', padding: '2px 4px' }}
                                    aria-label="Hora fin excepción"
                                  />
                                  <Button
                                    variant="primary"
                                    disabled={exceptionSaving}
                                    onClick={() => handleSaveOverride(occ.local_date)}
                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                  >
                                    Guardar
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    disabled={exceptionSaving}
                                    onClick={() => setOverridingDate(null)}
                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                  >
                                    Cancelar
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    variant="secondary"
                                    disabled={exceptionSaving || occ.recorded_exception === 'skip'}
                                    onClick={() => handleSkipOccurrence(occ.local_date)}
                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                  >
                                    Omitir
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    disabled={exceptionSaving}
                                    onClick={() => {
                                      setOverridingDate(occ.local_date);
                                      setOverrideStartTime(occ.local_start.slice(11, 16));
                                      setOverrideEndTime(occ.local_end.slice(11, 16));
                                    }}
                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                  >
                                    Cambiar hora
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {!editingProfile.staff_user_id && <div className="field">
            <label htmlFor="staff-account-select">Vincular cuenta de acceso</label>
            <select id="staff-account-select" value={selectedAccountId} onChange={event => setSelectedAccountId(event.target.value)} disabled={linking}>
              <option value="">Selecciona una cuenta activa</option>
              {accounts.filter(account => account.is_active && (account.linked_profile_id === null || account.linked_profile_id === editingProfile.id))
                .map(account => <option key={account.id} value={account.id}>{account.login_identifier}</option>)}
            </select>
            <p className="muted">La vinculación se confirma en el servidor y no se infiere por nombre.</p>
          </div>}
          {editingProfile.staff_user_id && <p role="status">La cuenta vinculada no se puede cambiar desde esta pantalla.</p>}
          <div className="field">
            <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Estado del perfil</label>
            <JellyRadio items={[{ value: 'active', label: '● Activo' }, { value: 'inactive', label: '○ Inactivo' }]}
              value={editingProfile.is_active ? 'active' : 'inactive'} size="sm" disabled ariaLabel="Estado del perfil" />
          </div>
          <div className="staff-pin-toggle-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><strong>Configurar PIN de acceso</strong><p className="muted" style={{ fontSize: '12px', margin: '2px 0 0' }}>El estado del PIN no está disponible en la API. Usa la acción de emisión cuando corresponda.</p></div>
              <SquishSwitch checked={false} disabled ariaLabel="Estado de PIN no disponible en API" />
            </div>
          </div>
          {error && <p role="alert" className="staff-pin-error">{error}</p>}
          <div className="staff-modal-actions">
            <Button variant="secondary" disabled={linking} onClick={closeEdit}>Cancelar</Button>
            {!editingProfile.staff_user_id && <Button variant="primary" disabled={!selectedAccountId || linking} onClick={() => void linkAccount()}>{linking ? 'Vinculando…' : 'Vincular cuenta'}</Button>}
            {editingProfile.staff_user_id && <Button variant="primary" type="submit" disabled title="La edición de datos personales aún no está disponible en la API.">Guardar cambios</Button>}
          </div>
        </form>
      </div>
    </div>}
    {issuedPin && <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="api-issued-pin-title">
      <div className="staff-modal-card staff-mgmt-modal-card" style={{ maxWidth: '420px', textAlign: 'center' }}>
        <div className="staff-modal-header" style={{ width: '100%', alignItems: 'center' }}><h2 id="api-issued-pin-title">PIN Inicial Generado</h2>
          <p className="muted">Entrega este PIN a {issuedPin.name} de forma segura. Sólo se muestra una vez.</p></div>
        <div style={{ margin: '24px 0', padding: '16px', background: 'var(--color-canvas)', borderRadius: '12px' }}><p style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '8px', margin: '12px 0', color: 'var(--color-primary)' }}>{issuedPin.value}</p></div>
        <div className="staff-modal-actions" style={{ justifyContent: 'center' }}><Button variant="primary" onClick={() => setIssuedPin(null)}>Entendido y copiado</Button></div>
      </div>
    </div>}
    {deviceProfile && deviceAccount && <DevicePairingModal isOpen staff={null}
      serverIdentity={{ staffId: deviceAccount.id, staffName: deviceProfile.full_name, contextId: branchId }}
      onClose={() => setDeviceProfile(null)} />}
  </div>;
}
