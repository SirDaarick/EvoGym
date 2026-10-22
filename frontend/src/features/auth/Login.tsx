import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { homePath } from '../../app/navigation';
import { Button, Field, Panel } from '../../shared/ui';
import { PwaInstallPrompt } from '../../shared/PwaInstallPrompt';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import logo from '../../assets/evogym-logo-128.webp';
import { getStaffList, setSelectedStaff } from '../staff/staffStore';
import './Login.css';

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

export function Login() {
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

  // Header Time & Date
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

  // Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Toast feedback
  const [toast, setToast] = useState<{
    open: boolean;
    type: 'success' | 'error';
    title: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    setSelectedStaff(null);
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    const trimmedUser = username.trim();
    const trimmedPass = password.trim();

    if (!trimmedUser || !trimmedPass) {
      setError('Ingresa tu usuario y contraseña.');
      setToast({
        open: true,
        type: 'error',
        title: 'Campos requeridos',
        description: 'Por favor completa todos los campos del formulario.',
      });
      return;
    }

    const staffList = getStaffList();
    const normalizedUser = trimmedUser.toLowerCase();

    // Match by staff name, id, or special 'admin' alias
    const profile = staffList.find(
      (s) =>
        s.name.toLowerCase() === normalizedUser ||
        s.id.toLowerCase() === normalizedUser ||
        (normalizedUser === 'admin' && s.role === 'OWNER'),
    );

    if (!profile) {
      setError('Usuario no encontrado.');
      setToast({
        open: true,
        type: 'error',
        title: 'Acceso denegado',
        description: 'No existe una cuenta registrada con ese usuario.',
      });
      return;
    }

    // Expected password matches profile PIN, or default fallback '1234'
    const expectedPassword = profile.pin ?? '1234';
    if (trimmedPass !== expectedPassword) {
      setError('Contraseña incorrecta.');
      setToast({
        open: true,
        type: 'error',
        title: 'Contraseña incorrecta',
        description: 'Verifica la contraseña ingresada.',
      });
      return;
    }

    // Success
    setSelectedStaff(profile);
    setToast({
      open: true,
      type: 'success',
      title: 'Acceso autorizado',
      description: `Iniciando sesión como ${profile.name}`,
    });

    navigate(homePath(profile.role));
  }

  return (
    <div className="staff-selection-page login-page">
      <a href="#main-content" className="skip-link">Ir al contenido</a>
      <Panel className="staff-selection-container login-container">
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
            <span className="staff-shift-pill">Acceso Seguro</span>
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
            <h1>Iniciar sesión</h1>
            <p className="muted">Ingresa tus credenciales para acceder a tu turno o panel</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-field-group">
              <Field
                id="login-username"
                name="username"
                label="Usuario"
                type="text"
                autoComplete="username"
                autoFocus
                placeholder="Ej. Admin, Emigdio..."
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError('');
                }}
              />
            </div>

            <div className="login-field-group">
              <Field
                id="login-password"
                name="password"
                label="Contraseña"
                type="password"
                autoComplete="current-password"
                placeholder="Ingresa tu contraseña"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
              />
            </div>

            {error && (
              <p className="login-error-message" role="alert">
                {error}
              </p>
            )}

            <div className="login-form-actions">
              <Button variant="primary" type="submit" className="login-submit-button">
                Entrar
              </Button>
            </div>

            <div className="login-switch-mode">
              <span className="login-switch-text">¿Terminal de recepción compartida?</span>
              <Button
                variant="secondary"
                type="button"
                className="login-kiosk-button"
                onClick={() => navigate('/profiles')}
              >
                Acceso rápido por perfil (Modo Kiosco)
              </Button>
            </div>
          </form>
        </main>

        {/* Footer */}
        <footer className="staff-footer">
          <span>EvoGym · Operación de Gimnasio</span>
          <span className="login-footer-hint">Autenticación de personal</span>
        </footer>
      </Panel>

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
