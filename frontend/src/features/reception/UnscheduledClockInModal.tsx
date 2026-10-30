import { useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '../../shared/ui';
import RubberSegment from '../catalog/react-bits/RubberSegment';
import AnimatedList, { type AnimatedListEntry } from '../catalog/react-bits/AnimatedList';
import type { StaffAttendancePerson } from './StaffAttendanceView';

export interface ColleagueWithShift {
  staffId: string;
  name: string;
  seriesId?: string;
  displayName: string;
}

export interface ClockInConfirmationPayload {
  series_id?: string;
  covered_profile_id?: string;
  notes?: string;
}

export interface UnscheduledClockInModalProps {
  isOpen: boolean;
  staff: StaffAttendancePerson | null;
  colleaguesWithShift: ColleagueWithShift[];
  onClose: () => void;
  onConfirm: (payload: ClockInConfirmationPayload) => Promise<void> | void;
}

export function UnscheduledClockInModal({
  isOpen,
  staff,
  colleaguesWithShift,
  onClose,
  onConfirm,
}: UnscheduledClockInModalProps) {
  const [selectedOption, setSelectedOption] = useState<'cover' | 'support'>('cover');
  const [coveredStaffId, setCoveredStaffId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableColleagues = useMemo(() => {
    if (!staff) return [];
    return colleaguesWithShift.filter(c => c.staffId !== staff.id);
  }, [colleaguesWithShift, staff]);

  const animatedColleagues: AnimatedListEntry[] = useMemo(() => {
    return availableColleagues.map(colleague => {
      const initials = colleague.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase())
        .join('');

      const match = colleague.displayName.match(/\(([^)]+)\)/);
      const shiftHours = match ? match[1] : 'Turno hoy';
      const isSelected = colleague.staffId === coveredStaffId;

      return {
        id: colleague.staffId,
        title: colleague.displayName,
        description: 'Turno programado para hoy',
        meta: (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: isSelected ? 'var(--color-primary, #FC6C06)' : 'var(--color-soft, #FFF8F2)',
              color: isSelected ? '#ffffff' : 'var(--color-primary, #FC6C06)',
              fontWeight: 600,
              transition: 'background-color 150ms ease, color 150ms ease',
            }}
          >
            {isSelected ? 'Seleccionado' : shiftHours}
          </span>
        ),
        icon: (
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--color-primary, #FC6C06)',
            }}
          >
            {initials || 'ST'}
          </span>
        ),
      };
    });
  }, [availableColleagues, coveredStaffId]);

  const selectedColleagueIndex = availableColleagues.findIndex(c => c.staffId === coveredStaffId);

  useEffect(() => {
    if (isOpen && staff) {
      const hasAvailable = availableColleagues.length > 0;
      setSelectedOption(hasAvailable ? 'cover' : 'support');
      setCoveredStaffId('');
      setIsSubmitting(false);
    }
  }, [isOpen, staff?.id, availableColleagues]);

  if (!isOpen || !staff) return null;

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      if (selectedOption === 'cover') {
        const colleague = availableColleagues.find(c => c.staffId === coveredStaffId);
        await onConfirm({
          series_id: colleague?.seriesId,
          covered_profile_id: coveredStaffId,
          notes: `Cubriendo turno de ${colleague?.name ?? 'compañero'}`,
        });
      } else {
        await onConfirm({
          notes: 'Turno de apoyo / extraordinario',
        });
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  const isCoverDisabled = availableColleagues.length === 0;
  const isConfirmDisabled =
    isSubmitting || (selectedOption === 'cover' && (!coveredStaffId || isCoverDisabled));

  const currentTimeStr = new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());

  const hasBaseShift = Boolean(staff.shift && staff.shift !== 'Sin turno' && staff.shift !== 'Descanso');
  const assignedHoursText = hasBaseShift
    ? staff.shift
    : `Registro abierto (a partir de ${currentTimeStr} hrs)`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Confirmar Entrada"
      titleId="unscheduled-modal-title"
      maxWidth="460px"
      isSubmitting={isSubmitting}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={isConfirmDisabled}
          >
            {isSubmitting ? 'Confirmando…' : 'Confirmar Entrada'}
          </Button>
        </>
      }
    >
      <p style={{ margin: '4px 0 16px', fontSize: '14px', color: 'var(--color-muted)' }}>
        <strong>{staff.name}</strong> no tiene turno programado para hoy.
      </p>

      {/* Paso 1: Segmented Control con RubberSegment */}
      <div style={{ marginBottom: '18px' }}>
        <RubberSegment
          items={[
            { value: 'cover', label: 'Cubrir a un compañero' },
            { value: 'support', label: 'Turno de apoyo' },
          ]}
          value={selectedOption}
          onChange={val => setSelectedOption(val as 'cover' | 'support')}
          thumbColor="var(--color-primary)"
          trackColor="var(--color-soft)"
          textColor="var(--color-ink)"
          activeTextColor="#ffffff"
          size="md"
          equalSlots
          disabled={isSubmitting}
          style={{ width: '100%' }}
        />
      </div>

      {/* Paso 2: Vista condicional 'Cubrir a un compañero' */}
      {selectedOption === 'cover' && (
        <div
          style={{
            background: 'var(--color-canvas, #f8fafc)',
            border: '1px solid var(--color-divider, #e2e8f0)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-ink)' }}>
              Seleccionar compañero a cubrir:
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '6px',
                background: 'var(--color-soft)',
                color: 'var(--color-primary)',
                fontWeight: 600,
              }}
            >
              {availableColleagues.length} disponible{availableColleagues.length !== 1 ? 's' : ''}
            </span>
          </div>

          {!isCoverDisabled ? (
            <div>
              <AnimatedList
                items={animatedColleagues}
                selectedIndex={selectedColleagueIndex}
                onItemSelect={(_item, index) => {
                  const colleague = availableColleagues[index];
                  if (colleague) {
                    setCoveredStaffId(colleague.staffId);
                  }
                }}
                theme="light"
                frame={false}
                selectOnHover={false}
                width="100%"
                maxHeight={250}
                accentColor="var(--color-primary)"
                displayScrollbar
                animation="slide"
                ariaLabel="Seleccionar compañero a cubrir"
              />

              <div
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ color: coveredStaffId ? 'var(--color-ink)' : 'var(--color-muted)' }}>
                  {coveredStaffId ? (
                    <>
                      Cubriendo a: <strong>{availableColleagues.find(c => c.staffId === coveredStaffId)?.name}</strong>
                    </>
                  ) : (
                    'Selecciona un compañero de la lista para continuar.'
                  )}
                </span>
                {coveredStaffId && (
                  <button
                    type="button"
                    onClick={() => setCoveredStaffId('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    Deseleccionar
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#b91c1c',
                fontSize: '12px',
              }}
            >
              No hay compañeros con turno pendiente de iniciar hoy. Selecciona <strong>Turno de apoyo</strong> para continuar.
            </div>
          )}
        </div>
      )}

      {/* Paso 3: Vista condicional 'Turno de apoyo' */}
      {selectedOption === 'support' && (
        <div
          style={{
            background: 'var(--color-canvas, #f8fafc)',
            border: '1px solid var(--color-divider, #e2e8f0)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-ink)' }}>
              Turno de apoyo / Refuerzo extraordinario
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '6px',
                background: 'rgba(34, 197, 94, 0.12)',
                color: '#15803d',
                fontWeight: 600,
              }}
            >
              Extraordinario
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '6px',
              fontSize: '13px',
              color: 'var(--color-ink)',
            }}
          >
            <span style={{ color: 'var(--color-muted)' }}>Horas asignadas:</span>
            <strong>{assignedHoursText}</strong>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--color-muted)', margin: '2px 0 0', lineHeight: 1.4 }}>
            Registrar asistencia como personal de apoyo sin horario programado previo. El turno quedará abierto para registrar salida al concluir la jornada.
          </p>
        </div>
      )}
    </Modal>
  );
}
