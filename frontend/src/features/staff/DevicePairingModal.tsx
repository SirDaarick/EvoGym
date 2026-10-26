import { useCallback, useEffect, useRef, useState } from 'react';
import type { StaffProfile } from './staffStore';
import {
  generatePairingCode,
  getActivePairingCodeForStaff,
  useActiveDevices,
  revokeDevice,
  buildWhatsAppShareUrl,
  type PairingCode,
} from './devicePairingStore';
import { useOptionalAdminSession } from '../auth/AdminSessionProvider';
import {
  issueAdminDevicePairingCode,
  listAdminPairedDevices,
  revokeAdminPairedDevice,
  type AdminPairedDevice,
} from '../../api/staffDevicesApi';
import { Button } from '../../shared/ui';
import './DevicePairingModal.css';

export interface DevicePairingModalProps {
  isOpen: boolean;
  staff: StaffProfile | null;
  serverIdentity?: { staffId: string; staffName: string; contextId: string };
  onClose: () => void;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function DevicePairingModal({
  isOpen,
  staff,
  serverIdentity,
  onClose,
}: DevicePairingModalProps) {
  const adminSession = useOptionalAdminSession();
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [pairingContext, setPairingContext] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [liveDevices, setLiveDevices] = useState<AdminPairedDevice[]>([]);
  const [devicesContext, setDevicesContext] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const operation = useRef(0);

  const staffId = staff?.id ?? '';
  const localDevices = useActiveDevices(serverIdentity ? '' : staffId);

  const targetStaffId = serverIdentity
    ? (UUID_REGEX.test(serverIdentity.staffId) ? serverIdentity.staffId : null)
    : staff
      ? ((staff as { staffUserId?: string }).staffUserId && UUID_REGEX.test((staff as { staffUserId?: string }).staffUserId!)
        ? (staff as { staffUserId?: string }).staffUserId!
        : UUID_REGEX.test(staff.id) ? staff.id : null)
      : null;

  const contextKey = `${serverIdentity ? 'server' : 'demo'}:${serverIdentity?.staffId ?? staffId}:${serverIdentity?.contextId ?? ''}:${adminSession?.status ?? 'no-session'}`;
  const contextRef = useRef({ isOpen, contextKey });
  contextRef.current = { isOpen, contextKey };
  const isServerMode = serverIdentity !== undefined;
  const isLive = isServerMode
    ? Boolean(adminSession?.status === 'authenticated' && targetStaffId)
    : Boolean(adminSession && adminSession.status === 'authenticated' && targetStaffId);
  const visiblePairingCode = pairingContext === contextKey ? pairingCode : null;
  const visibleDevices = devicesContext === contextKey ? liveDevices : [];
  const staffName = serverIdentity?.staffName ?? staff?.name ?? '';
  const staffInitials = serverIdentity
    ? (serverIdentity.staffName.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase() || '?')
    : staff?.avatarInitials ?? '?';
  const requestIsCurrent = (token: number, requestContext: string) =>
    operation.current === token && contextRef.current.isOpen && contextRef.current.contextKey === requestContext;

  const fetchLiveDevices = useCallback(async (token: number, requestContext: string, staffUserId: string) => {
    if (!adminSession || adminSession.status !== 'authenticated') throw new Error('admin-session');
    const devices = await listAdminPairedDevices(adminSession.request);
    if (!requestIsCurrent(token, requestContext)) return;
    setLiveDevices(devices.filter(device => device.staff_id === staffUserId && !device.revoked));
    setDevicesContext(requestContext);
  }, [adminSession]);

  const issueLiveCode = useCallback(async () => {
    if (!adminSession || adminSession.status !== 'authenticated' || !targetStaffId || !isOpen) return;
    const requestContext = contextKey;
    const token = ++operation.current;
    setIsLoading(true);
    setPairingCode(null);
    setPairingContext('');
    setApiError(null);
    setCopied(false);
    try {
      const response = await issueAdminDevicePairingCode(adminSession.request, targetStaffId);
      if (!requestIsCurrent(token, requestContext)) return;
      const expiresAt = Date.parse(response.expires_at);
      const nextCode: PairingCode = {
        code: `${response.pairing_code.slice(0, 3)}-${response.pairing_code.slice(3)}`,
        rawCode: response.pairing_code,
        staffId: targetStaffId,
        createdAt: Date.now(),
        expiresAt,
        used: false,
      };
      setPairingCode(nextCode);
      setPairingContext(requestContext);
      setRemainingSeconds(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
      try {
        await fetchLiveDevices(token, requestContext, targetStaffId);
      } catch {
        if (requestIsCurrent(token, requestContext)) setApiError('El código se generó, pero no se pudo actualizar la lista de dispositivos. Actualiza e inténtalo de nuevo.');
      }
    } catch {
      if (requestIsCurrent(token, requestContext)) setApiError('No se pudo generar el código en el servidor.');
    } finally {
      if (requestIsCurrent(token, requestContext)) setIsLoading(false);
    }
  }, [adminSession, targetStaffId, isOpen, contextKey, fetchLiveDevices]);

  // Initialize or fetch active code
  useEffect(() => {
    const token = ++operation.current;
    setPairingCode(null);
    setPairingContext('');
    setLiveDevices([]);
    setDevicesContext('');
    setRemainingSeconds(0);
    setCopied(false);
    setApiError(null);
    if (!isOpen || (!staff && !serverIdentity)) {
      setPairingCode(null);
      setRemainingSeconds(0);
      return () => { operation.current += 1; };
    }

    if (isServerMode) {
      if (!targetStaffId) {
        setApiError('No se puede gestionar el dispositivo: la cuenta vinculada no tiene un identificador válido.');
      } else if (!adminSession || adminSession.status !== 'authenticated') {
        setApiError('La sesión Admin no está disponible. Vuelve a iniciar sesión.');
      } else {
        setIsLoading(true);
        void fetchLiveDevices(token, contextKey, targetStaffId).catch(() => {
          if (requestIsCurrent(token, contextKey)) setApiError('No se pudo cargar la lista de dispositivos desde el servidor.');
        }).finally(() => {
          if (requestIsCurrent(token, contextKey)) setIsLoading(false);
        });
      }
    } else if (isLive) {
      void issueLiveCode();
    } else if (staff) {
      const existing = getActivePairingCodeForStaff(staff.id);
      if (existing) {
        setPairingCode(existing);
        setPairingContext(contextKey);
        const diffSecs = Math.max(0, Math.floor((existing.expiresAt - Date.now()) / 1000));
        setRemainingSeconds(diffSecs);
      } else {
        const fresh = generatePairingCode(staff.id);
        setPairingCode(fresh);
        setPairingContext(contextKey);
        setRemainingSeconds(600); // 10 minutes
      }
    }
    return () => { operation.current += 1; };
  }, [isOpen, staff, serverIdentity, isServerMode, isLive, targetStaffId, adminSession, contextKey, issueLiveCode, fetchLiveDevices]);

  // Countdown timer
  useEffect(() => {
    if (!visiblePairingCode) return;

    const timer = setInterval(() => {
      const diffSecs = Math.max(0, Math.floor((visiblePairingCode.expiresAt - Date.now()) / 1000));
      setRemainingSeconds(diffSecs);
      if (diffSecs === 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [visiblePairingCode]);

  if (!isOpen || (!staff && !serverIdentity)) return null;

  const handleGenerateNewCode = () => {
    if (isServerMode) {
      void issueLiveCode();
    } else {
      if (!staff) return;
      const fresh = generatePairingCode(staff.id);
      setPairingCode(fresh);
      setPairingContext(contextKey);
      setRemainingSeconds(600);
    }
    setCopied(false);
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (isServerMode && adminSession?.status === 'authenticated' && targetStaffId) {
      if (!window.confirm('¿Desvincular este teléfono? Esto cierra las sesiones activas del empleado en ese teléfono. Las sesiones de recepción y Admin permanecen activas. Para reemplazarlo se necesita un nuevo código de vinculación.')) return;
      const requestContext = contextKey;
      const token = ++operation.current;
      setApiError(null);
      try {
        await revokeAdminPairedDevice(adminSession.request, deviceId);
        if (!requestIsCurrent(token, requestContext)) return;
        await fetchLiveDevices(token, requestContext, targetStaffId);
      } catch {
        if (requestIsCurrent(token, requestContext)) setApiError('No se confirmó la desvinculación o no se pudo actualizar la lista. Actualiza antes de volver a intentarlo.');
      }
    } else if (!isServerMode) {
      revokeDevice(deviceId);
    }
  };

  const handleCopyCode = async () => {
    if (!visiblePairingCode) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(visiblePairingCode.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setApiError('No se pudo copiar el código. Selecciónalo y cópialo manualmente.');
    }
  };

  const handleWhatsAppShare = () => {
    if (!visiblePairingCode) return;
    const url = buildWhatsAppShareUrl(visiblePairingCode.code, staffName);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isExpired = remainingSeconds <= 0;

  const displayedDevices = isServerMode
    ? visibleDevices.map(d => ({
        id: d.id,
        deviceName: d.device_name,
        pairedAt: d.paired_at,
      }))
    : isLive ? visibleDevices.map(d => ({ id: d.id, deviceName: d.device_name, pairedAt: d.paired_at })) : localDevices.map(d => ({
        id: d.id,
        deviceName: d.deviceName,
        pairedAt: d.pairedAt,
      }));

  return (
    <div
      className="device-pairing-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pairing-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="device-pairing-card">
        {/* Header */}
        <div className="device-pairing-header">
          <div className="device-pairing-title-group">
            <h2 id="pairing-modal-title">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                <path d="M12 18h.01" />
              </svg>
              Vincular Dispositivo
            </h2>
            <div className="device-pairing-staff-badge">
              <span className="device-pairing-staff-avatar">{staffInitials}</span>
              <span><strong>{staffName}</strong> · ID: {serverIdentity?.staffId ?? staff?.id}{staff && !serverIdentity ? ` (${staff.shift})` : ''}</span>
            </div>
          </div>
          <button
            type="button"
            className="device-pairing-close-btn"
            aria-label="Cerrar modal"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* 6-Digit Code Section */}
        <div className="device-pairing-code-section" data-testid="pairing-code-section">
          <span className="device-pairing-code-label">
            Código de vinculación único (6 dígitos):
          </span>

          <div
            className={`device-pairing-code-display ${isExpired ? 'is-expired' : ''}`}
            data-testid="pairing-code-display"
            aria-live="polite"
          >
            {isLoading ? (
              <span className="device-pairing-code-loading">{serverIdentity ? 'Cargando dispositivos...' : 'Generando código...'}</span>
            ) : visiblePairingCode ? (
              <span className="device-pairing-code-digits">{visiblePairingCode.code}</span>
            ) : (
              '--- ---'
            )}
          </div>

          {apiError && (
            <p className="device-pairing-error" role="alert" style={{ color: 'var(--color-danger, #DC2626)', fontSize: '0.85rem', margin: '4px 0' }}>
              {apiError}
            </p>
          )}

          {/* Countdown timer badge */}
          <div
            className={`device-pairing-timer-badge ${
              isExpired ? 'is-expired' : remainingSeconds < 120 ? 'is-warning' : 'is-valid'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>
              {isExpired ? 'Código expirado' : `${timeFormatted} restantes`}
            </span>
          </div>

          <p className="device-pairing-instructions">
            El empleado debe ingresar a EvoGym en su teléfono o navegador de recepción y seleccionar <strong>&ldquo;Vincular dispositivo con código&rdquo;</strong> para ingresar estos 6 dígitos.
          </p>

          {/* Action buttons */}
          <div className="device-pairing-actions">
            <Button
              type="button"
              variant="primary"
              onClick={handleCopyCode}
              disabled={isExpired || !visiblePairingCode}
              title="Copia el código al portapapeles"
            >
              {copied ? '✓ ¡Código copiado!' : '📋 Copiar código'}
            </Button>

            <Button
              type="button"
              className="device-pairing-btn-wa"
              onClick={handleWhatsAppShare}
              disabled={isExpired || !visiblePairingCode}
            >
              💬 Enviar por WhatsApp
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleGenerateNewCode}
              disabled={isLoading || (isServerMode && !isLive)}
              title="Genera un nuevo código de 6 dígitos con vigencia"
            >
              🔄 Generar nuevo
            </Button>
          </div>
        </div>

        {/* Active Devices List */}
        <div className="device-pairing-devices-section" data-testid="active-devices-section">
          <h3 className="device-pairing-devices-heading">
            <span>Dispositivos activos vinculados</span>
            <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
              {displayedDevices.length}
            </span>
          </h3>

          {displayedDevices.length === 0 ? (
            <div className="device-pairing-empty-devices">
              No hay teléfonos vinculados activos para este empleado.
            </div>
          ) : (
            <div className="device-pairing-device-list">
              {displayedDevices.map(device => {
                const dateStr = new Date(device.pairedAt).toLocaleDateString('es-MX', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <div key={device.id} className="device-pairing-device-row">
                    <div className="device-pairing-device-info">
                      <div className="device-pairing-device-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                          <path d="M12 18h.01" />
                        </svg>
                      </div>
                      <div className="device-pairing-device-meta">
                        <span className="device-pairing-device-name">{device.deviceName}</span>
                        <span className="device-pairing-device-date">Vinculado: {dateStr}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      style={{ fontSize: '12px', padding: '4px 10px', color: '#B91C1C' }}
                      onClick={() => handleRevokeDevice(device.id)}
                      title="Desvincula este dispositivo inmediatamente"
                    >
                      Desvincular
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="device-pairing-footer">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
