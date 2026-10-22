import { useEffect, useState } from 'react';
import type { StaffProfile } from './staffStore';
import {
  generatePairingCode,
  getActivePairingCodeForStaff,
  useActiveDevices,
  revokeDevice,
  buildWhatsAppShareUrl,
  type PairingCode,
} from './devicePairingStore';
import { Button } from '../../shared/ui';
import './DevicePairingModal.css';

export interface DevicePairingModalProps {
  isOpen: boolean;
  staff: StaffProfile | null;
  onClose: () => void;
}

export function DevicePairingModal({
  isOpen,
  staff,
  onClose,
}: DevicePairingModalProps) {
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  const staffId = staff?.id ?? '';
  const activeDevices = useActiveDevices(staffId);

  // Initialize or fetch active code
  useEffect(() => {
    if (!isOpen || !staff) {
      setPairingCode(null);
      setRemainingSeconds(0);
      setCopied(false);
      return;
    }

    const existing = getActivePairingCodeForStaff(staff.id);
    if (existing) {
      setPairingCode(existing);
      const diffSecs = Math.max(0, Math.floor((existing.expiresAt - Date.now()) / 1000));
      setRemainingSeconds(diffSecs);
    } else {
      const fresh = generatePairingCode(staff.id);
      setPairingCode(fresh);
      setRemainingSeconds(600); // 10 minutes
    }
  }, [isOpen, staff]);

  // Countdown timer
  useEffect(() => {
    if (!pairingCode) return;

    const timer = setInterval(() => {
      const diffSecs = Math.max(0, Math.floor((pairingCode.expiresAt - Date.now()) / 1000));
      setRemainingSeconds(diffSecs);
      if (diffSecs === 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [pairingCode]);

  if (!isOpen || !staff) return null;

  const handleGenerateNewCode = () => {
    const fresh = generatePairingCode(staff.id);
    setPairingCode(fresh);
    setRemainingSeconds(600);
    setCopied(false);
  };

  const handleCopyCode = async () => {
    if (!pairingCode) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(pairingCode.code);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleWhatsAppShare = () => {
    if (!pairingCode) return;
    const url = buildWhatsAppShareUrl(pairingCode.code, staff.name);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isExpired = remainingSeconds <= 0;

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
              <span className="device-pairing-staff-avatar">{staff.avatarInitials}</span>
              <span><strong>{staff.name}</strong> · ID: {staff.id} ({staff.shift})</span>
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
          <span className="device-pairing-code-label">Código de vinculación de 6 dígitos</span>

          <output
            className="device-pairing-code-digits"
            aria-label="Código de vinculación"
            data-testid="pairing-code-display"
          >
            {pairingCode?.code ?? '--- ---'}
          </output>

          <div
            className={`device-pairing-timer-badge ${
              isExpired ? 'is-expired' : remainingSeconds < 120 ? 'is-warning' : 'is-valid'
            }`}
          >
            {isExpired ? (
              <>⚠️ Código expirado</>
            ) : (
              <>⏱ {timeFormatted} restantes</>
            )}
          </div>

          <div className="device-pairing-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopyCode}
              disabled={isExpired}
            >
              {copied ? '✓ ¡Código copiado!' : '📋 Copiar código'}
            </Button>

            <Button
              type="button"
              className="device-pairing-btn-wa"
              onClick={handleWhatsAppShare}
              disabled={isExpired}
            >
              💬 Enviar por WhatsApp
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleGenerateNewCode}
              title="Genera un nuevo código de 6 dígitos con 10 minutos de vigencia"
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
              {activeDevices.length}
            </span>
          </h3>

          {activeDevices.length === 0 ? (
            <div className="device-pairing-empty-devices">
              No hay teléfonos vinculados activos para este empleado.
            </div>
          ) : (
            <div className="device-pairing-device-list">
              {activeDevices.map(device => {
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
                      onClick={() => revokeDevice(device.id)}
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
