import { useState, type FormEvent, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import {
  verifyAndPairCode,
  formatPairingCode,
  normalizePairingCode,
  getPairedSession,
} from './devicePairingStore';
import { homePath } from '../../app/navigation';
import { Button } from '../../shared/ui';
import logo from '../../assets/evogym-logo-128.webp';
import './DevicePairingView.css';

export function DevicePairingView() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If already paired, can optionally direct to dashboard
  useEffect(() => {
    const session = getPairedSession();
    if (session) {
      setSuccessMsg(`Sesión activa detectada (${session.staff.name}). Redirigiendo...`);
      const timer = setTimeout(() => {
        navigate(homePath(session.staff.role));
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [navigate]);

  const handleInputChange = (val: string) => {
    const raw = normalizePairingCode(val);
    const formatted = formatPairingCode(raw);
    setCode(formatted);
    setError(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const raw = normalizePairingCode(code);
    if (raw.length < 6) {
      setError('Ingresa los 6 dígitos del código de vinculación.');
      return;
    }

    setIsSubmitting(true);
    const result = verifyAndPairCode(raw);

    if (!result.success || !result.staff) {
      setError(result.error ?? 'Error al vincular el dispositivo.');
      setIsSubmitting(false);
      return;
    }

    const matchedStaff = result.staff;
    const roleName = matchedStaff.role === 'OWNER' ? 'Administrador' : 'Recepción';
    setSuccessMsg(`¡Dispositivo vinculado con éxito! Bienvenido, ${matchedStaff.name} (${roleName}).`);

    // Redirect after brief feedback
    setTimeout(() => {
      navigate(homePath(matchedStaff.role));
    }, 900);
  };

  const rawLength = normalizePairingCode(code).length;

  return (
    <main className="pairing-view-container">
      <div className="pairing-view-card">
        <img src={logo} alt="EvoGym Logo" className="pairing-view-logo" />

        <div className="pairing-view-header">
          <span className="pairing-view-brand">EvoGym · Personal</span>
          <h1 className="pairing-view-title">Vincular Dispositivo</h1>
          <p className="pairing-view-subtitle">
            Ingresa el código de 6 dígitos generado por tu administrador para acceder a tu turno sin contraseña.
          </p>
        </div>

        <form className="pairing-view-form" onSubmit={handleSubmit}>
          <div className="pairing-view-input-wrap">
            <label htmlFor="pairing-code-input" className="sr-only">
              Código de vinculación de 6 dígitos
            </label>
            <input
              id="pairing-code-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              placeholder="000-000"
              value={code}
              onChange={e => handleInputChange(e.target.value)}
              className={`pairing-view-code-input ${error ? 'is-error' : successMsg ? 'is-success' : ''}`}
              autoFocus
              maxLength={7} // "XXX-XXX"
              disabled={isSubmitting || Boolean(successMsg)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'pairing-error' : undefined}
            />
            <span className="pairing-view-hint">Ejemplo: 849-210</span>
          </div>

          {error && (
            <div id="pairing-error" className="pairing-view-feedback is-error" role="alert">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="pairing-view-feedback is-success" role="status">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{successMsg}</span>
            </div>
          )}

          <Button
            type="submit"
            className="pairing-view-submit-btn"
            disabled={rawLength !== 6 || isSubmitting || Boolean(successMsg)}
            onClick={handleSubmit}
          >
            {isSubmitting ? 'Verificando código...' : 'Vincular mi dispositivo'}
          </Button>
        </form>

        <Link to="/" className="pairing-view-back-link">
          ← Volver a selección de perfiles
        </Link>
      </div>
    </main>
  );
}
