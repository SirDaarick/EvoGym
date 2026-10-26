import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EmployeeAuthError, listReceptionProfiles, phoneLogin, receptionLogin, type EmployeeProfileChoice, type EmployeeSession } from '../../api/employeeAuthApi';
import { StaffDevicesApiError, submitEmployeeDevicePairing } from '../../api/staffDevicesApi';

type Mode = 'phone' | 'reception';

export function StaffAccessPage({ apiOrigin }: { apiOrigin?: string }) {
  const [mode, setMode] = useState<Mode>('phone');
  const [branchId, setBranchId] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [stationCredential, setStationCredential] = useState('');
  const [profiles, setProfiles] = useState<EmployeeProfileChoice[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<EmployeeProfileChoice | null>(null);
  const [pin, setPin] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [pairingStatus, setPairingStatus] = useState('');
  const [session, setSession] = useState<EmployeeSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);

  useEffect(() => () => { requestGeneration.current += 1; }, []);

  function clearEmployeeSession() {
    setSession(null);
    setPin('');
    setPairingCode('');
    setDeviceName('');
    setPairingStatus('');
    setSelectedProfile(null);
  }

  function changeMode(next: Mode) {
    requestGeneration.current += 1;
    setBusy(false);
    clearEmployeeSession();
    setProfiles([]);
    setStationCredential('');
    setError('');
    setMode(next);
  }

  async function loadProfiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !stationCredential) return;
    const current = ++requestGeneration.current;
    setBusy(true); setError('');
    try {
      const result = await listReceptionProfiles(stationCredential, { apiOrigin });
      if (requestGeneration.current === current) setProfiles(result);
    } catch (reason) {
      if (requestGeneration.current === current) setError(reason instanceof EmployeeAuthError ? reason.message : 'No se pudieron cargar los perfiles.');
    } finally {
      if (requestGeneration.current === current) setBusy(false);
    }
  }

  async function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !pin) return;
    const current = ++requestGeneration.current;
    setBusy(true); setError('');
    const submittedPin = pin;
    setPin('');
    try {
      const result = mode === 'phone'
        ? await phoneLogin({ loginIdentifier, pin: submittedPin, branchId }, { apiOrigin })
        : selectedProfile
          ? await receptionLogin({ stationCredential, profile: selectedProfile, pin: submittedPin }, { apiOrigin })
          : null;
      if (result && requestGeneration.current === current) setSession(result);
      else if (!result && requestGeneration.current === current) setError('Elegí un perfil activo para continuar.');
    } catch (reason) {
      if (requestGeneration.current === current) setError(reason instanceof EmployeeAuthError ? reason.message : 'No se pudo iniciar sesión.');
    } finally {
      if (requestGeneration.current === current) setBusy(false);
    }
  }

  async function submitPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || mode !== 'phone' || !loginIdentifier.trim() || !/^\d{6}$/.test(pairingCode) ||
        !deviceName.trim() || deviceName.trim().length > 128) return;
    const current = ++requestGeneration.current;
    const submittedCode = pairingCode;
    setBusy(true); setError(''); setPairingStatus(''); setPairingCode('');
    try {
      const deviceIdentifier = window.crypto.randomUUID();
      await submitEmployeeDevicePairing({ loginIdentifier, pairingCode: submittedCode,
        deviceIdentifier, deviceName }, { apiOrigin });
      if (requestGeneration.current === current) setPairingStatus('Teléfono vinculado. La vinculación no inicia sesión.');
    } catch (reason) {
      if (requestGeneration.current === current) {
        setError(reason instanceof StaffDevicesApiError && (reason.status === 401 || reason.status === 429)
          ? 'El código no es válido o venció. Solicita uno nuevo si hace falta.'
          : 'No se pudo vincular el teléfono. Revisa tu conexión y el código, e inténtalo con un código vigente.');
      }
    } finally {
      if (requestGeneration.current === current) { setPairingCode(''); setBusy(false); }
    }
  }

  function signOut() {
    requestGeneration.current += 1;
    setBusy(false);
    clearEmployeeSession();
    setStationCredential('');
    setProfiles([]);
    setError('');
  }

  return <main aria-labelledby="staff-access-title" style={{ maxWidth: 480, margin: '3rem auto', padding: '1.5rem' }}>
    <h1 id="staff-access-title">Acceso de personal</h1>
    <p>Este acceso crea una sesión del servidor. Las pantallas de demostración existentes no quedan autorizadas por esta sesión.</p>
    {session ? <section aria-label="Sesión de personal activa">
      <p role="status">Sesión activa: {session.profile?.full_name ?? loginIdentifier} ({session.purpose}).</p>
      <button type="button" onClick={signOut}>Cerrar sesión</button>
    </section> : <>
      <div role="group" aria-label="Tipo de acceso">
        <button type="button" aria-pressed={mode === 'phone'} onClick={() => changeMode('phone')}>Teléfono</button>
        <button type="button" aria-pressed={mode === 'reception'} onClick={() => changeMode('reception')}>Recepción</button>
      </div>
      {mode === 'phone' ? <form onSubmit={submitPin}>
        <label>Identificador de acceso<input autoComplete="username" value={loginIdentifier} disabled={busy} onChange={event => setLoginIdentifier(event.target.value)} /></label>
        <label>ID de sucursal<input value={branchId} disabled={busy} onChange={event => setBranchId(event.target.value)} /></label>
        <label>PIN<input inputMode="numeric" autoComplete="off" type="password" value={pin} disabled={busy} onChange={event => setPin(event.target.value)} /></label>
        <button type="submit" disabled={busy || !loginIdentifier.trim() || !branchId || !pin}>{busy ? 'Ingresando…' : 'Ingresar con PIN'}</button>
      </form> : <>
        <form onSubmit={loadProfiles}>
          <label>Credencial de esta estación<input autoComplete="off" type="password" value={stationCredential} disabled={busy} onChange={event => {
            requestGeneration.current += 1; setBusy(false);
            setStationCredential(event.target.value); setProfiles([]); setSelectedProfile(null); setPin('');
          }} /></label>
          <button type="submit" disabled={busy || !stationCredential}>{busy ? 'Cargando…' : 'Cargar perfiles activos'}</button>
        </form>
        {profiles.length > 0 && <label>Perfil activo<select value={selectedProfile?.id ?? ''} disabled={busy} onChange={event => {
          requestGeneration.current += 1; setBusy(false);
          setSelectedProfile(profiles.find(profile => profile.id === event.target.value) ?? null);
          setPin(''); setError('');
        }}>
          <option value="">Elegir perfil</option>
          {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name} — {profile.position}</option>)}
        </select></label>}
        {selectedProfile && <form onSubmit={submitPin}>
          <label>PIN de {selectedProfile.full_name}<input inputMode="numeric" autoComplete="off" type="password" value={pin} disabled={busy} onChange={event => setPin(event.target.value)} /></label>
          <button type="submit" disabled={busy || !pin}>{busy ? 'Ingresando…' : 'Ingresar con PIN'}</button>
        </form>}
      </>}
      {mode === 'phone' && <section aria-label="Vincular teléfono">
        <h2>Vincular teléfono nuevo</h2>
        <p>La vinculación requiere un código vigente de Admin. Vincular no inicia sesión ni concede permisos.</p>
        <form onSubmit={event => void submitPairing(event)}>
          <label>Código de vinculación<input inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6}
            value={pairingCode} disabled={busy} onChange={event => { setPairingCode(event.target.value); setPairingStatus(''); }} /></label>
          <label>Nombre del dispositivo<input autoComplete="off" maxLength={128} value={deviceName} disabled={busy}
            onChange={event => setDeviceName(event.target.value)} /></label>
          <button type="submit" disabled={busy || !loginIdentifier.trim() || !/^\d{6}$/.test(pairingCode) || !deviceName.trim()}>
            {busy ? 'Vinculando…' : 'Vincular teléfono'}
          </button>
        </form>
        {pairingStatus && <p role="status">{pairingStatus}</p>}
      </section>}
      {error && <p role="alert">{error}</p>}
    </>}
  </main>;
}
