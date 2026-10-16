import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Role } from '../../domain/models';
import { homePath } from '../../app/navigation';
import { Button, Panel } from '../../shared/ui';
import { PwaInstallPrompt } from '../../shared/PwaInstallPrompt';
import CodeSlots, { type CodeSlotsStatus } from '../catalog/react-bits/CodeSlots';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import logo from '../../assets/evogym-logo-128.webp';

import { setSelectedStaff, useStaff, type StaffProfile } from './staffStore';

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

export function StaffProfileSelection() {
  const navigate = useNavigate();

  // Dark / Light Theme
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const theme = document.documentElement.dataset.theme;
    return theme ? theme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  }

  // Header Time & Shift
  const [timeStr, setTimeStr] = useState('14:35 hrs');
  const [dateStr, setDateStr] = useState('Jueves, 10 de octubre');

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      setTimeStr(`${h}:${m} hrs`);
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
      const formatted = now.toLocaleDateString('es-MX', options);
      setDateStr(formatted.charAt(0).toUpperCase() + formatted.slice(1));
    }
    updateClock();
    const interval = setInterval(updateClock, 20000);
    return () => clearInterval(interval);
  }, []);

  // Modal & PIN state
  const [activeProfile, setActiveProfile] = useState<StaffProfile | null>(null);
  const [pin, setPin] = useState('');
  const [pinStatus, setPinStatus] = useState<CodeSlotsStatus>('idle');
  const [pinError, setPinError] = useState('');
  useEffect(() => { setSelectedStaff(null); }, []);

  // Toast feedback
  const [toast, setToast] = useState<{
    open: boolean;
    type: 'success' | 'error';
    title: string;
    description: string;
  } | null>(null);

  function handleSelect(profile: StaffProfile) {
    if (profile.hasPin) {
      setActiveProfile(profile);
      setPin('');
      setPinStatus('idle');
      setPinError('');
    } else {
      setSelectedStaff(profile);
      // Direct access (no PIN configured)
      setToast({
        open: true,
        type: 'success',
        title: 'Acceso directo',
        description: `Iniciando sesión como ${profile.name} (${profile.role === 'OWNER' ? 'Admin' : 'Recepción'})`,
      });
      navigate(homePath(profile.role));
    }
  }

  function handlePinSubmit(code: string) {
    if (!activeProfile) return;
    if (code.length < 4) {
      setPinError('Ingresa los 4 dígitos del PIN.');
      setPinStatus('error');
      return;
    }

    const expected = activeProfile.pin ?? '1234';
    if (code === expected) {
      setSelectedStaff(activeProfile);
      setPinStatus('success');
      setPinError('');
      setToast({
        open: true,
        type: 'success',
        title: 'PIN verificado',
        description: `Accediendo como ${activeProfile.name}`,
      });
      const targetRole = activeProfile.role;
      setActiveProfile(null);
      navigate(homePath(targetRole));
    } else {
      setPinStatus('error');
      setPinError('PIN incorrecto. Inténtalo de nuevo.');
      setToast({
        open: true,
        type: 'error',
        title: 'PIN incorrecto',
        description: 'Verifica los 4 dígitos o intenta con 1234.',
      });
    }
  }

  function closeModal() {
    setActiveProfile(null);
    setPin('');
    setPinStatus('idle');
    setPinError('');
  }

  const allStaff = useStaff();
  const activeStaff = allStaff.filter((p) => p.active);
  const adminProfile = activeStaff.find((p) => p.role === 'OWNER') || allStaff.find((p) => p.role === 'OWNER')!;
  const receptionProfiles = activeStaff.filter((p) => p.role === 'RECEPTION');
  const row1 = receptionProfiles.slice(0, 4);
  const row2 = receptionProfiles.slice(4);

  return (
    <div className="staff-selection-page">
      <a href="#main-content" className="skip-link">Ir al contenido</a>
      <Panel className="staff-selection-container">
        <PwaInstallPrompt />
        {/* Header */}
        <header className="staff-header">
          <div className="staff-brand">
            <div className="staff-logo-mark" aria-hidden="true">
              <img src={logo} alt="EvoGym" width={128} height={124} />
            </div>
            <span className="staff-brand-name">EvoGym</span>
          </div>

          <div className="staff-shift-info" aria-label="Hora y turno actual">
            <span className="staff-clock">{timeStr}</span>
            <span className="staff-shift-pill">Turno Vespertino</span>
          </div>

          <div className="staff-header-actions">
            <span className="staff-date-text">{dateStr}</span>
            <Button
              variant="secondary"
              className="theme-toggle"
              aria-pressed={dark}
              onClick={toggleTheme}
              aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'}
              title={dark ? 'Usar tema claro' : 'Usar tema oscuro'}
            >
              <span className="theme-toggle-icon" aria-hidden="true">
                {dark ? <SunIcon /> : <MoonIcon />}
              </span>
            </Button>
          </div>
        </header>

        {/* Content */}
        <main className="staff-selection-main" id="main-content" tabIndex={-1}>
          <div className="staff-selection-heading">
            <h1>Elige tu perfil</h1>
            <p className="muted">Selecciona tu cuenta de personal para comenzar el turno u operaciones</p>
          </div>

          {/* Admin apex card */}
          <section className="staff-admin-section" aria-label="Perfil Administrador">
            <Button
              variant="secondary"
              className="staff-card staff-admin-card"
              onClick={() => handleSelect(adminProfile)}
              aria-label="Admin"
            >
              <div className="staff-avatar staff-avatar-admin" aria-hidden="true">
                {adminProfile.avatarInitials}
              </div>
              <strong className="staff-name">{adminProfile.name}</strong>
            </Button>
          </section>

          {/* Reception cluster (4 on top, 3 on bottom matching wireframe) */}
          <section className="staff-reception-section" aria-label="Perfiles de Recepción">
            <div className="staff-grid-row staff-grid-row-1">
              {row1.map((profile) => (
                <Button
                  key={profile.id}
                  variant="secondary"
                  className="staff-card staff-recep-card"
                  onClick={() => handleSelect(profile)}
                  aria-label={`${profile.name} · Recepción`}
                >
                  <div className="staff-avatar staff-avatar-recep" aria-hidden="true">
                    {profile.avatarInitials}
                  </div>
                  <strong className="staff-name">{profile.name}</strong>
                </Button>
              ))}
            </div>

            <div className="staff-grid-row staff-grid-row-2">
              {row2.map((profile) => (
                <Button
                  key={profile.id}
                  variant="secondary"
                  className="staff-card staff-recep-card"
                  onClick={() => handleSelect(profile)}
                  aria-label={`${profile.name} · Recepción`}
                >
                  <div className="staff-avatar staff-avatar-recep" aria-hidden="true">
                    {profile.avatarInitials}
                  </div>
                  <strong className="staff-name">{profile.name}</strong>
                </Button>
              ))}
            </div>
          </section>
        </main>

        {/* Footer note */}
        <footer className="staff-footer">
          <span>EvoGym · Operación de Gimnasio</span>
        </footer>
      </Panel>

      {/* PIN Modal Dialog */}
      {activeProfile && (
        <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-staff-title">
          <div className="staff-modal-card">
            <div className="staff-modal-header">
              <div className="staff-avatar staff-avatar-modal" aria-hidden="true">
                {activeProfile.avatarInitials}
              </div>
              <h2 id="modal-staff-title">{activeProfile.name}</h2>
              <p className="muted">
                {activeProfile.role === 'OWNER' ? 'Perfil Administrador' : 'Perfil Recepción'} · Requiere PIN
              </p>
            </div>

            <div className="staff-pin-container">
              <CodeSlots
                length={4}
                value={pin}
                onChange={(val) => {
                  setPin(val);
                  setPinStatus('idle');
                  setPinError('');
                }}
                onComplete={handlePinSubmit}
                status={pinStatus}
                mask
                autoFocus
                ariaLabel={`Ingresa el PIN de 4 dígitos para ${activeProfile.name}`}
                accentColor="var(--color-primary)"
                slotColor="var(--color-canvas)"
                inkColor="var(--color-ink)"
                digitColor="var(--color-ink)"
              />
              {pinError && <p className="staff-pin-error" role="alert">{pinError}</p>}
            </div>

            <div className="staff-modal-actions">
              <Button variant="secondary" onClick={closeModal}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={() => handlePinSubmit(pin)}
                disabled={pin.length < 4}
              >
                Entrar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SwipeToast Notification */}
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
    </div>
  );
}
