import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AdminAuthClient } from '../../api/adminAuthApi';
import {
  changeProfileInitialPin, enterEmployeeProfile, getAdminProfileChoices, getPairedProfileChoices, logoutEmployeeProfileSession, logoutProfileAccess, ProfileAccessApiError,
  pairWithCode, type ProfileEntryOutcome, type ProfileEntrySession, type ProfileIdentityChoice,
} from '../../api/profileAccessApi';
import { AdminSessionProvider, useAdminSession } from './AdminSessionProvider';

export type OperatingPrincipal =
  | { kind: 'admin'; identity: ProfileIdentityChoice }
  | { kind: 'employee'; identity: ProfileIdentityChoice; branch: ProfileIdentityChoice['branch_profiles'][number]; session: ProfileEntrySession };

interface ProductAccessValue {
  loading: boolean;
  identities: ProfileIdentityChoice[];
  currentIdentityId: string | null;
  principal: OperatingPrincipal | null;
  canUnlinkPairedDevice: boolean;
  error: string;
  reload(): Promise<void>;
  pair(code: string): Promise<void>;
  enter(identity: ProfileIdentityChoice, branch: ProfileIdentityChoice['branch_profiles'][number], pin: string): Promise<ProfileEntryOutcome | undefined>;
  changeInitialPin(identity: ProfileIdentityChoice, branch: ProfileIdentityChoice['branch_profiles'][number], currentPin: string, newPin: string): Promise<void>;
  enterAdmin(identity: ProfileIdentityChoice): void;
  leaveProfile(): Promise<void>;
  unlinkPairedDevice(): Promise<void>;
  exit(): Promise<void>;
}

const ProductAccessContext = createContext<ProductAccessValue | null>(null);

function safeMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message === 'An API origin is required for Admin authentication.') {
    return 'Profile access is not configured. Contact your administrator.';
  }
  return 'Profile access could not be completed. Check your connection and try again.';
}

function ProductAccessState({ children, apiOrigin, fetchImpl }: { children: ReactNode; apiOrigin?: string; fetchImpl?: typeof fetch }) {
  const admin = useAdminSession();
  const [loading, setLoading] = useState(true);
  const [identities, setIdentities] = useState<ProfileIdentityChoice[]>([]);
  const [currentIdentityId, setCurrentIdentityId] = useState<string | null>(null);
  const [canUnlinkPairedDevice, setCanUnlinkPairedDevice] = useState(false);
  const [principal, setPrincipal] = useState<OperatingPrincipal | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const exitInFlight = useRef<Promise<void> | null>(null);
  const unlinkInFlight = useRef<Promise<void> | null>(null);
  const cleanupTokens = useRef(new Set<string>());
  const suppressAutomaticDiscovery = useRef(false);
  const previousAdminStatus = useRef(admin.status);

  const cleanupPendingSessions = useCallback(async () => {
    let complete = true;
    for (const token of [...cleanupTokens.current]) {
      try {
        await logoutEmployeeProfileSession(token, { apiOrigin, fetchImpl });
        cleanupTokens.current.delete(token);
      } catch {
        complete = false;
      }
    }
    return complete;
  }, [apiOrigin, fetchImpl]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      if (admin.status === 'authenticated') {
        const choices = await getAdminProfileChoices(admin.request);
        if (!mounted.current || generation.current !== current) return;
        setCanUnlinkPairedDevice(false);
        setIdentities(choices.identities);
        setCurrentIdentityId(choices.currentIdentityId);
      } else if (admin.status !== 'restoring') {
        const choices = await getPairedProfileChoices({ apiOrigin, fetchImpl });
        if (!mounted.current || generation.current !== current) return;
        setCanUnlinkPairedDevice(choices.length > 0);
        setIdentities(choices);
        setCurrentIdentityId(null);
      } else {
        return;
      }
      setPrincipal(null);
    } catch (reason) {
      if (!mounted.current || generation.current !== current) return;
      setIdentities([]);
      setCanUnlinkPairedDevice(false);
      setCurrentIdentityId(null);
      setPrincipal(null);
      setError(safeMessage(reason));
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }, [admin.request, admin.status, apiOrigin, fetchImpl]);

  useEffect(() => {
    const previous = previousAdminStatus.current;
    previousAdminStatus.current = admin.status;
    if (exitInFlight.current) return;
    if (suppressAutomaticDiscovery.current) {
      if (admin.status !== 'authenticated' || previous === 'authenticated') return;
      suppressAutomaticDiscovery.current = false;
    }
    void reload();
  }, [admin.status, reload]);

  useEffect(() => {
    if (principal?.kind !== 'employee') return;
    const rawDelay = principal.session.expiresAt - Date.now();
    if (rawDelay <= 0) {
      setPrincipal(null);
      setError('Your employee session expired. Enter your PIN again to continue.');
      return;
    }
    // Browser setTimeout overflows 32-bit signed integer (> 24.8 days) and fires immediately
    if (rawDelay > 2147483647) return;
    const timer = window.setTimeout(() => {
      if (!mounted.current) return;
      ++generation.current;
      setPrincipal(null);
      setError('Your employee session expired. Enter your PIN again to continue.');
    }, rawDelay);
    return () => window.clearTimeout(timer);
  }, [principal]);

  const pair = useCallback(async (code: string) => {
    const current = ++generation.current;
    setError(''); setLoading(true);
    try {
      await pairWithCode(code, { apiOrigin, fetchImpl });
      const choices = await getPairedProfileChoices({ apiOrigin, fetchImpl });
      if (!mounted.current || generation.current !== current) return;
      setCanUnlinkPairedDevice(choices.length > 0);
      setIdentities(choices); setCurrentIdentityId(null); setPrincipal(null);
    } catch (reason) {
      if (mounted.current && generation.current === current) setError(safeMessage(reason));
      throw reason;
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }, [apiOrigin, fetchImpl]);

  const enter = useCallback(async (identity: ProfileIdentityChoice, branch: ProfileIdentityChoice['branch_profiles'][number], pin: string): Promise<ProfileEntryOutcome | undefined> => {
    if (identity.kind !== 'employee') throw new ProfileAccessApiError();
    if (!(await cleanupPendingSessions())) {
      setError('A previous employee session could not be revoked. Try again before entering.');
      throw new ProfileAccessApiError();
    }
    const current = ++generation.current;
    setError(''); setLoading(true);
    try {
      const outcome = await enterEmployeeProfile({ identityId: identity.id, profileId: branch.profile_id, branchId: branch.branch_id, pin,
        adminRequest: admin.status === 'authenticated' ? admin.request : undefined }, { apiOrigin, fetchImpl });
      if (outcome.kind === 'setup_required') {
        if (!mounted.current || generation.current !== current) return undefined;
        return outcome;
      }
      if (!mounted.current || generation.current !== current) {
        try { await logoutEmployeeProfileSession(outcome.accessToken, { apiOrigin, fetchImpl }); }
        catch {
          cleanupTokens.current.add(outcome.accessToken);
          if (mounted.current) setError('A late employee session could not be revoked. Try again before continuing.');
        }
        return;
      }
      setPrincipal({ kind: 'employee', identity, branch, session: outcome });
      return outcome;
    } catch (reason) {
      if (mounted.current && generation.current === current) setError(safeMessage(reason));
      throw reason;
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }, [admin.request, admin.status, apiOrigin, cleanupPendingSessions, fetchImpl]);

  const changeInitialPin = useCallback(async (identity: ProfileIdentityChoice, branch: ProfileIdentityChoice['branch_profiles'][number], currentPin: string, newPin: string) => {
    if (identity.kind !== 'employee') throw new ProfileAccessApiError();
    const current = ++generation.current;
    setError(''); setLoading(true);
    try {
      await changeProfileInitialPin({ identityId: identity.id, profileId: branch.profile_id, branchId: branch.branch_id,
        pin: currentPin, newPin, adminRequest: admin.status === 'authenticated' ? admin.request : undefined }, { apiOrigin, fetchImpl });
      if (!mounted.current || generation.current !== current) return;
    } catch (reason) {
      if (mounted.current && generation.current === current) setError(safeMessage(reason));
      throw reason;
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }, [admin.request, admin.status, apiOrigin, fetchImpl]);

  const enterAdmin = useCallback((identity: ProfileIdentityChoice) => {
    if (admin.status !== 'authenticated' || identity.kind !== 'admin' || identity.id !== currentIdentityId) return;
    ++generation.current;
    setError(''); setPrincipal({ kind: 'admin', identity }); setLoading(false);
  }, [admin.status, currentIdentityId]);

  const leaveProfile = useCallback(async () => {
    if (exitInFlight.current) return exitInFlight.current;
    const currentPrincipal = principal;
    const current = ++generation.current;
    suppressAutomaticDiscovery.current = true;
    setLoading(true); setError(''); setPrincipal(null);
    const flight = (async () => {
      try {
        const pendingCleanupComplete = await cleanupPendingSessions();
        if (currentPrincipal?.kind === 'employee') {
          try { await logoutEmployeeProfileSession(currentPrincipal.session.accessToken, { apiOrigin, fetchImpl }); }
          catch {
            cleanupTokens.current.add(currentPrincipal.session.accessToken);
            throw new ProfileAccessApiError();
          }
        }
        if (!pendingCleanupComplete) throw new ProfileAccessApiError();
        if (!mounted.current || generation.current !== current) return;
        await reload();
      } catch (reason) {
        if (mounted.current && generation.current === current) {
          setError('Server revocation could not be confirmed. Try again before continuing.');
          setLoading(false);
        }
        throw reason;
      }
    })();
    exitInFlight.current = flight;
    try { await flight; }
    finally { if (exitInFlight.current === flight) exitInFlight.current = null; }
  }, [apiOrigin, cleanupPendingSessions, fetchImpl, principal, reload]);

  const unlinkPairedDevice = useCallback(() => {
    if (unlinkInFlight.current) return unlinkInFlight.current;
    if (!canUnlinkPairedDevice && (principal?.kind !== 'employee' || principal.session.purpose !== 'phone')) {
      return Promise.reject(new ProfileAccessApiError());
    }
    const current = ++generation.current;
    setLoading(true); setError('');
    const flight = (async () => {
      try {
        await logoutProfileAccess({ apiOrigin, fetchImpl });
        if (!mounted.current) return;
        // Invalidate any choice discovery started while the revocation was in flight.
        ++generation.current;
        suppressAutomaticDiscovery.current = true;
        setCanUnlinkPairedDevice(false);
        setPrincipal(null); setIdentities([]); setCurrentIdentityId(null); setLoading(false);
      } catch (reason) {
        if (mounted.current && generation.current === current) {
          setError('This device could not be unlinked because the server did not confirm revocation. Try again.');
          setLoading(false);
        }
        throw reason;
      }
    })();
    unlinkInFlight.current = flight;
    void flight.finally(() => {
      if (unlinkInFlight.current === flight) unlinkInFlight.current = null;
    }).catch(() => undefined);
    return flight;
  }, [apiOrigin, canUnlinkPairedDevice, fetchImpl, principal]);

  const exit = useCallback(() => {
    if (exitInFlight.current) return exitInFlight.current;
    const current = ++generation.current;
    suppressAutomaticDiscovery.current = true;
    setLoading(true); setError(''); setPrincipal(null); setCanUnlinkPairedDevice(false); setIdentities([]); setCurrentIdentityId(null);
    const flight = (async () => {
      let failure: unknown = (await cleanupPendingSessions()) ? undefined : new ProfileAccessApiError();
      if (admin.status === 'authenticated' || admin.status === 'error' || admin.status === 'pendingapproval') {
        try { await admin.logout(); } catch (reason) { failure = reason; }
      }
      try {
        const choices = await getPairedProfileChoices({ apiOrigin, fetchImpl });
        if (mounted.current && generation.current === current) {
          setCanUnlinkPairedDevice(choices.length > 0); setIdentities(choices); setCurrentIdentityId(null);
        }
      } catch (reason) {
        if (!(reason instanceof ProfileAccessApiError && reason.status === 401)) failure ??= reason;
      }
      if (!mounted.current || generation.current !== current) return;
      setError(failure ? 'Server revocation could not be confirmed. Try signing out again before continuing.' : '');
      setLoading(false);
      if (failure) throw new Error('Server revocation could not be confirmed.');
    })();
    exitInFlight.current = flight;
    void flight.finally(() => {
      if (exitInFlight.current === flight) exitInFlight.current = null;
    }).catch(() => undefined);
    return flight;
  }, [admin, apiOrigin, cleanupPendingSessions, fetchImpl]);

  const value = useMemo(() => ({ loading, identities, currentIdentityId, principal, canUnlinkPairedDevice, error, reload, pair, enter, changeInitialPin, enterAdmin, leaveProfile, unlinkPairedDevice, exit }),
    [loading, identities, currentIdentityId, principal, canUnlinkPairedDevice, error, reload, pair, enter, changeInitialPin, enterAdmin, leaveProfile, unlinkPairedDevice, exit]);
  return <ProductAccessContext.Provider value={value}>{children}</ProductAccessContext.Provider>;
}

export function ProductAccessProvider({ children, apiOrigin, client, fetchImpl }: {
  children: ReactNode; apiOrigin?: string; client?: AdminAuthClient; fetchImpl?: typeof fetch;
}) {
  const [created] = useState(() => {
    if (client) return { value: client, error: '' };
    try { return { value: new AdminAuthClient({ apiOrigin }), error: '' }; }
    catch { return { value: null, error: 'Profile access is not configured. Contact your administrator.' }; }
  });
  if (!created.value) return <main role="alert">{created.error}</main>;
  return <AdminSessionProvider client={created.value}>
    <ProductAccessState apiOrigin={apiOrigin} fetchImpl={fetchImpl}>{children}</ProductAccessState>
  </AdminSessionProvider>;
}

export function useProductAccess(): ProductAccessValue {
  const value = useContext(ProductAccessContext);
  if (!value) throw new Error('useProductAccess must be used within ProductAccessProvider.');
  return value;
}
