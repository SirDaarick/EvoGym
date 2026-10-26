import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Panel } from '../../shared/ui';
import { PwaInstallPrompt } from '../../shared/PwaInstallPrompt';
import logo from '../../assets/evogym-logo-128.webp';
import { Link, useNavigate } from 'react-router';
import CodeSlots, { type CodeSlotsStatus } from '../catalog/react-bits/CodeSlots';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { useAdminSession } from '../auth/AdminSessionProvider';
import { useProductAccess } from '../auth/ProductAccessProvider';
import type { ProfileBranchChoice, ProfileIdentityChoice } from '../../api/profileAccessApi';
import { homePath } from '../../app/navigation';
import { setSelectedStaff, useStaff, type StaffProfile } from './staffStore';
import { ProfileEntryLayout } from './ProfileEntryLayout';
import { isDemoModeEnabled } from '../../demo/adapter';

function SunIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41-1.41M19.07 4.93l-1.41-1.41" /></svg>;
}
function MoonIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>;
}
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase() || '?'; }

export function StaffProfileSelection() {
  const navigate = useNavigate();
  const admin = useAdminSession();
  const access = useProductAccess();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [showPairing, setShowPairing] = useState(false);
  const [pairStatus, setPairStatus] = useState<CodeSlotsStatus>('idle');
  const [activeIdentity, setActiveIdentity] = useState<ProfileIdentityChoice | null>(null);
  const [activeBranches, setActiveBranches] = useState<ProfileBranchChoice[]>([]);
  const [branch, setBranch] = useState<ProfileBranchChoice | null>(null);
  const [pin, setPin] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [confirmSetupPin, setConfirmSetupPin] = useState('');
  const [temporaryPin, setTemporaryPin] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const [changedButNotEntered, setChangedButNotEntered] = useState(false);
  const [pinStatus, setPinStatus] = useState<CodeSlotsStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const flowEpoch = useRef(0);
  const [toast, setToast] = useState<{ open: boolean; type: 'success' | 'error'; title: string; description: string } | null>(null);

  useEffect(() => { setPassword(''); }, [admin.status]);
  const identitySnapshot = JSON.stringify(access.identities);
  useEffect(() => { flowEpoch.current += 1; setPin(''); setSetupPin(''); setConfirmSetupPin(''); setTemporaryPin(''); setSetupRequired(false); setChangedButNotEntered(false); setPinStatus('idle'); setBranch(null); setActiveIdentity(null); setActiveBranches([]); }, [identitySnapshot, access.currentIdentityId]);

  const adminIdentity = access.identities.find(identity => identity.kind === 'admin' && identity.id === access.currentIdentityId);

  useEffect(() => {
    if (admin.status === 'pendingapproval') {
      const pollTimer = window.setTimeout(() => {
        void admin.pollApproval();
      }, 1000);
      return () => window.clearTimeout(pollTimer);
    }
  }, [admin.status, admin.pollApproval]);

  function clearPinFlow() { flowEpoch.current += 1; setActiveIdentity(null); setActiveBranches([]); setBranch(null); setPin(''); setSetupPin(''); setConfirmSetupPin(''); setTemporaryPin(''); setSetupRequired(false); setChangedButNotEntered(false); setPinStatus('idle'); }
  function enterDemoMode() {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('evogym:demo-mode', 'true');
    }
    navigate('/reception/home');
  }
  function selectIdentity(identity: ProfileIdentityChoice) {
    if (identity.kind === 'admin') {
      access.enterAdmin(identity);
      navigate('/owner/overview');
      return;
    }
    if (identity.kind === 'unlinked') return;
    clearPinFlow(); setPinStatus('idle'); setActiveIdentity(identity); setActiveBranches(identity.branch_profiles);
    if (identity.branch_profiles.length === 1) setBranch(identity.branch_profiles[0]);
  }

  async function submitAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !username.trim() || !password) return;
    inFlight.current = true; setSubmitting(true);
    console.log('[StaffProfileSelection] Iniciando autenticación Admin para:', username.trim());
    try {
      await admin.signIn(username, password, 'computer');
      console.log('[StaffProfileSelection] admin.signIn completado con status:', admin.status);
    } catch (err) {
      console.error('[StaffProfileSelection] Error en submitAdmin:', err);
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  async function completePair(code: string) {
    if (!/^\d{6}$/.test(code) || inFlight.current) return;
    inFlight.current = true; setSubmitting(true); setPairStatus('idle');
    try { await access.pair(code); setPairingCode(''); setPairStatus('success'); setShowPairing(false); }
    catch { setPairStatus('error'); }
    finally { setPairingCode(''); setSubmitting(false); inFlight.current = false; }
  }

  async function submitPin(code: string) {
    if (!activeIdentity || !branch || inFlight.current) return;
    if (!/^\d{6}$/.test(code)) { setPinStatus('error'); return; }
    inFlight.current = true; setSubmitting(true); setPinStatus('idle');
    const currentFlow = flowEpoch.current;
    try {
      const outcome = await access.enter(activeIdentity, branch, code);
      if (currentFlow !== flowEpoch.current) return;
      if (outcome?.kind === 'setup_required') {
        setTemporaryPin(code); setPin(''); setSetupRequired(true); setPinStatus('idle');
        return;
      }
      setPin(''); setPinStatus('success'); clearPinFlow();
      navigate('/reception/home');
    } catch { setPin(''); setPinStatus('error'); }
    finally { setSubmitting(false); inFlight.current = false; }
  }

  async function saveInitialPin() {
    if (!activeIdentity || !branch || !temporaryPin || !/^\d{6}$/.test(setupPin) || setupPin !== confirmSetupPin || inFlight.current) {
      setPinStatus('error'); return;
    }
    inFlight.current = true; setSubmitting(true); setPinStatus('idle');
    const currentFlow = flowEpoch.current;
    try {
      await access.changeInitialPin(activeIdentity, branch, temporaryPin, setupPin);
      if (currentFlow !== flowEpoch.current) return;
      setTemporaryPin(''); setSetupRequired(false); setChangedButNotEntered(true);
      const outcome = await access.enter(activeIdentity, branch, setupPin);
      if (currentFlow !== flowEpoch.current) return;
      if (outcome && 'accessToken' in outcome) {
        clearPinFlow(); navigate('/reception/home');
      } else {
        setPinStatus('error');
      }
    } catch {
      setPinStatus('error');
    } finally { setSubmitting(false); inFlight.current = false; }
  }

  async function enterWithChangedPin() {
    if (!activeIdentity || !branch || !changedButNotEntered || !/^\d{6}$/.test(setupPin) || inFlight.current) return;
    inFlight.current = true; setSubmitting(true);
    const currentFlow = flowEpoch.current;
    try {
      const outcome = await access.enter(activeIdentity, branch, setupPin);
      if (currentFlow !== flowEpoch.current) return;
      if (outcome && 'accessToken' in outcome) { clearPinFlow(); navigate('/reception/home'); }
      else setPinStatus('error');
    } catch { setPinStatus('error'); }
    finally { setSubmitting(false); inFlight.current = false; }
  }

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true; setSubmitting(true);
    try { await access.exit(); setUsername(''); setPassword(''); setPairingCode(''); }
    catch { /* The provider reports a safe error and retains no operating principal. */ }
    finally { setSubmitting(false); inFlight.current = false; }
  }

  const employeeIdentities = access.identities.filter(identity => identity.kind === 'employee');
  const showAdminSignIn = !access.loading && admin.status !== 'restoring' && admin.status !== 'authenticated' && admin.status !== 'pendingapproval' && employeeIdentities.length === 0;
  const unlinkedIdentities = admin.status === 'authenticated' ? access.identities.filter(identity => identity.kind === 'unlinked') : [];
  const cards = [...(adminIdentity ? [adminIdentity] : []), ...employeeIdentities, ...unlinkedIdentities];
  const currentName = access.principal?.identity.display_name;
  const pairingFlowVisible = showPairing && !access.canUnlinkPairedDevice;

  return <ProfileEntryLayout>
    <>
      <main className="staff-selection-main" id="main-content" tabIndex={-1}>
        <div className="staff-selection-heading">
          <h1>{access.principal ? 'Perfil activo' : showAdminSignIn ? 'Inicia sesión' : 'Elige tu perfil'}</h1>
          <p className="muted">{access.principal ? `Sesión activa para ${currentName}.` : showAdminSignIn ? 'Accede con tu cuenta de administrador para continuar.' : 'Selecciona tu cuenta de personal para comenzar el turno u operaciones'}</p>
          {access.error && <p className="staff-pin-error" role="alert">{access.error}</p>}
          {admin.status === 'restoring' || access.loading ? <p role="status">Verificando acceso…</p> : null}
          {admin.status === 'pendingapproval' && <section className="staff-access-panel" aria-label="Aprobación de dispositivo"><p role="status">Aprobando acceso de dispositivo en servidor…</p><Button variant="primary" disabled={submitting} onClick={() => void admin.pollApproval()}>Verificar aprobación</Button></section>}
          {admin.status === 'error' && admin.error && <p className="staff-pin-error" role="alert">Error de autenticación: {admin.error.message}</p>}
          {showAdminSignIn && !access.principal && admin.status !== 'pendingapproval' && <form className="staff-access-panel" onSubmit={event => void submitAdmin(event)} aria-label="Admin sign in">
            <label className="staff-access-field"><span>Usuario Admin</span><input autoComplete="username" name="login_identifier" value={username} onChange={event => setUsername(event.target.value)} disabled={submitting} /></label>
            <label className="staff-access-field"><span>Contraseña</span><input type="password" autoComplete="current-password" name="password" value={password} onChange={event => setPassword(event.target.value)} disabled={submitting} /></label>
            <Button variant="primary" type="submit" disabled={submitting || !username.trim() || !password}>{submitting ? 'Ingresando…' : 'Iniciar sesión Admin'}</Button>
            <a href="/admin/recovery">¿Olvidaste tu contraseña?</a>
          </form>}
          {!access.principal && !pairingFlowVisible && <div className="staff-login-link-container">
            {!access.canUnlinkPairedDevice && <Button variant="secondary" className="staff-login-link" onClick={() => { setShowPairing(true); setPairingCode(''); setPairStatus('idle'); }}>Vincular dispositivo con código</Button>}
            {access.canUnlinkPairedDevice && <Button variant="secondary" className="staff-login-link" disabled={submitting || access.loading} onClick={() => {
              if (window.confirm('Desvincular este dispositivo? Para volver a entrar, un Admin tendrá que generar un nuevo código de vinculación.')) {
                void access.unlinkPairedDevice().catch(() => undefined);
              }
            }}>Desvincular este dispositivo</Button>}
            {isDemoModeEnabled() && <Button variant="secondary" className="staff-login-link" onClick={enterDemoMode}>Continuar con datos locales (Modo Demo)</Button>}
          </div>}
          {pairingFlowVisible && <section className="staff-access-panel" aria-label="Vincular dispositivo">
            <p>Ingresa el código de seis dígitos entregado por tu administrador.</p>
            <CodeSlots length={6} value={pairingCode} onChange={value => setPairingCode(value)} onComplete={value => void completePair(value)} status={pairStatus} mask autoFocus ariaLabel="Código de vinculación de seis dígitos" accentColor="var(--color-primary)" slotColor="var(--color-canvas)" inkColor="var(--color-ink)" digitColor="var(--color-ink)" />
            {pairStatus === 'error' && <p role="alert">El código no pudo verificarse. Compruébalo e intenta de nuevo.</p>}
            <Button variant="secondary" onClick={() => { setShowPairing(false); setPairingCode(''); setPairStatus('idle'); }}>Cancelar</Button>
          </section>}
        </div>

        {access.principal ? <section className="staff-access-panel" aria-label="Sesión autenticada">
          <div className="staff-avatar staff-avatar-modal" aria-hidden="true">{initials(access.principal.identity.display_name)}</div>
          <strong>{access.principal.identity.display_name}</strong>
          {access.principal.kind === 'employee' && <p>{access.principal.branch.branch_name}</p>}
          <p role="status">Identidad verificada por el servidor. Las operaciones disponibles dependen de los permisos del servidor.</p>
          <Button variant="secondary" disabled={submitting} onClick={() => void signOut()}>Cerrar sesión</Button>
        </section> : <>
          {admin.status === 'authenticated' && !adminIdentity && <p role="alert">La sesión Admin no devolvió una identidad válida. Vuelve a iniciar sesión.</p>}
          {!showAdminSignIn && !access.loading && cards.length > 0 && <section className="staff-reception-section" aria-label="Perfiles disponibles"><div className="staff-grid-row staff-grid-row-1">
            {cards.map(identity => <Button key={`${identity.kind}:${identity.id}`} variant="secondary" className={`staff-card ${identity.kind === 'admin' ? 'staff-admin-card' : 'staff-recep-card'}`} onClick={() => selectIdentity(identity)} disabled={identity.kind === 'unlinked'} aria-label={`${identity.display_name}${identity.kind === 'admin' ? ' · Admin' : identity.kind === 'unlinked' ? ` · Pendiente de vincular cuenta · ${identity.branch_profiles[0]?.branch_name ?? ''}` : ' · Personal'}`}>
              <div className={`staff-avatar ${identity.kind === 'admin' ? 'staff-avatar-admin' : 'staff-avatar-recep'}`} aria-hidden="true">{initials(identity.display_name)}</div><strong className="staff-name">{identity.display_name}</strong>{identity.kind === 'admin' && <span>Admin</span>}{identity.kind === 'unlinked' && <span>Pendiente de vincular cuenta · {identity.branch_profiles[0]?.branch_name}</span>}
            </Button>)}
          </div></section>}
          {admin.status === 'authenticated' && <Button variant="secondary" disabled={submitting} onClick={() => void signOut()}>Cerrar sesión</Button>}
          {!showAdminSignIn && !cards.length && !access.loading && <p className="muted">No hay perfiles disponibles para esta sesión.</p>}
        </>}
      </main>

    {activeIdentity && <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-staff-title">
      <div className="staff-modal-card"><div className="staff-modal-header"><div className="staff-avatar staff-avatar-modal" aria-hidden="true">{initials(activeIdentity.display_name)}</div><h2 id="modal-staff-title">{activeIdentity.display_name}</h2><p className="muted">{changedButNotEntered ? 'PIN actualizado' : setupRequired ? 'Configura tu nuevo PIN de seis dígitos' : 'Ingresa tu PIN de seis dígitos'}</p></div>
        {activeBranches.length > 1 && !setupRequired && <label className="staff-access-field"><span>Sucursal</span><select disabled={submitting} value={branch?.profile_id ?? ''} onChange={event => { flowEpoch.current += 1; setBranch(activeBranches.find(item => item.profile_id === event.target.value) ?? null); setPin(''); setSetupPin(''); setConfirmSetupPin(''); setTemporaryPin(''); setSetupRequired(false); setChangedButNotEntered(false); setPinStatus('idle'); }}><option value="">Selecciona una sucursal</option>{activeBranches.map(item => <option key={item.profile_id} value={item.profile_id}>{item.branch_name}</option>)}</select></label>}
        {branch && !setupRequired && !changedButNotEntered && <div className="staff-pin-container"><CodeSlots length={6} value={pin} onChange={value => { setPin(value); setPinStatus('idle'); }} onComplete={value => void submitPin(value)} status={pinStatus} mask autoFocus ariaLabel={`Ingresa el PIN de seis dígitos para ${activeIdentity.display_name}`} accentColor="var(--color-primary)" slotColor="var(--color-canvas)" inkColor="var(--color-ink)" digitColor="var(--color-ink)" />{pinStatus === 'error' && <p className="staff-pin-error" role="alert">El PIN no pudo verificarse. Inténtalo de nuevo.</p>}</div>}
        {branch && setupRequired && <div className="staff-pin-container">
          <CodeSlots length={6} value={setupPin} onChange={value => { setSetupPin(value); setPinStatus('idle'); }} status={pinStatus} mask autoFocus ariaLabel="Nuevo PIN de seis dígitos" accentColor="var(--color-primary)" slotColor="var(--color-canvas)" inkColor="var(--color-ink)" digitColor="var(--color-ink)" />
          <CodeSlots length={6} value={confirmSetupPin} onChange={value => { setConfirmSetupPin(value); setPinStatus('idle'); }} status={pinStatus} mask ariaLabel="Confirma el nuevo PIN de seis dígitos" accentColor="var(--color-primary)" slotColor="var(--color-canvas)" inkColor="var(--color-ink)" digitColor="var(--color-ink)" />
          {pinStatus === 'error' && <p className="staff-pin-error" role="alert">Verifica que ambos PIN coincidan y vuelve a intentarlo.</p>}
        </div>}
        {branch && changedButNotEntered && pinStatus === 'error' && <p className="staff-pin-error" role="alert">El PIN se actualizó, pero no se pudo iniciar la sesión. Intenta entrar con tu nuevo PIN.</p>}
        <div className="staff-modal-actions"><Button variant="secondary" disabled={submitting} onClick={clearPinFlow}>Cancelar</Button>{branch && changedButNotEntered
          ? <Button variant="primary" disabled={submitting || setupPin.length !== 6} onClick={() => void enterWithChangedPin()}>Entrar con el nuevo PIN</Button>
          : branch && setupRequired
            ? <Button variant="primary" disabled={submitting || setupPin.length !== 6 || confirmSetupPin.length !== 6} onClick={() => void saveInitialPin()}>{submitting ? 'Guardando…' : 'Guardar nuevo PIN'}</Button>
            : branch && <Button variant="primary" disabled={pin.length !== 6 || submitting} onClick={() => void submitPin(pin)}>{submitting ? 'Verificando…' : 'Entrar'}</Button>}</div>
      </div>
    </div>}
    {toast && <div className="staff-toast-wrapper"><SwipeToast open={toast.open} title={toast.title} description={toast.description} duration={3200} fuse={toast.type === 'error' ? 'none' : 'bottom'} closeButton closeLabel="Cerrar notificación" background="var(--color-surface)" color="var(--color-ink)" fuseColor={toast.type === 'error' ? 'var(--catalog-field-error, #A32222)' : 'var(--color-primary)'} onClose={() => setToast(null)} /></div>}
    </>
  </ProfileEntryLayout>;
}

// The standalone App is an explicit demo harness; this legacy selector is never routed from RootApp.


// The standalone App is an explicit demo harness; this legacy selector is never routed from RootApp.
export function LegacyDemoStaffProfileSelection() {
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
            <div className="staff-login-link-container">
              <Link to="/login" className="staff-login-link">
                Iniciar sesión con usuario y contraseña →
              </Link>
            </div>
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
