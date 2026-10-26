import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AdminAuthClient,
  AdminAuthHttpError,
  AdminAuthReauthenticationRequired,
  type AdminPendingApproval,
  type AdminSessionCategory,
} from '../../api/adminAuthApi';

export type AdminAuthStatus = 'restoring' | 'unauthenticated' | 'pendingapproval' | 'authenticated' | 'error';

export interface AdminSessionContextValue {
  status: AdminAuthStatus;
  approval: AdminPendingApproval | null;
  expiresAt: number | null;
  error: Error | null;
  signIn: (loginIdentifier: string, password: string, category?: AdminSessionCategory) => Promise<void>;
  pollApproval: () => Promise<void>;
  logout: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export interface AdminSessionProviderProps {
  client: AdminAuthClient;
  children: ReactNode;
}

export function AdminSessionProvider({ client, children }: AdminSessionProviderProps) {
  const [status, setStatus] = useState<AdminAuthStatus>('restoring');
  const [approval, setApproval] = useState<AdminPendingApproval | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setStatus('restoring');
    void client.restore().then(session => {
      if (!active || generation.current !== current) return;
      setApproval(null);
      setError(null);
      setExpiresAt(session?.expiresAt ?? null);
      setStatus(session ? 'authenticated' : 'unauthenticated');
    }).catch((reason: unknown) => {
      if (!active || generation.current !== current) return;
      client.clear();
      setApproval(null);
      setExpiresAt(null);
      setError(reason instanceof Error ? reason : new Error('Authentication could not be restored.'));
      setStatus('error');
    });
    return () => {
      active = false;
      const disposedGeneration = ++generation.current;
      clearTimer();
      queueMicrotask(() => {
        if (generation.current === disposedGeneration) client.clear();
      });
    };
  }, [client, clearTimer]);

  useEffect(() => {
    if (status !== 'authenticated' || expiresAt === null) return;
    const current = generation.current;
    const delay = Math.max(0, expiresAt - Date.now() - 30_000);
    timer.current = window.setTimeout(() => {
      void client.refresh().then(session => {
        if (generation.current !== current) return;
        setError(null);
        setExpiresAt(session.expiresAt);
      }).catch((reason: unknown) => {
        if (generation.current !== current) return;
        client.clear();
        setApproval(null);
        setExpiresAt(null);
        setError(reason instanceof Error ? reason : new Error('Authentication could not be renewed.'));
        setStatus(reason instanceof AdminAuthHttpError && reason.status === 401 ? 'unauthenticated' : 'error');
      });
    }, delay);
    return clearTimer;
  }, [client, clearTimer, expiresAt, status]);

  const signIn = useCallback(async (loginIdentifier: string, password: string, category?: AdminSessionCategory) => {
    const current = ++generation.current;
    clearTimer();
    setStatus('restoring');
    setApproval(null);
    setExpiresAt(null);
    setError(null);
    try {
      const result = await client.login(loginIdentifier, password, category);
      if (generation.current !== current) return;
      if (result.kind === 'pending') {
        setApproval(result);
        setStatus('pendingapproval');
      } else {
        setApproval(null);
        setExpiresAt(result.expiresAt);
        setStatus('authenticated');
      }
    } catch (reason) {
      if (generation.current !== current) return;
      console.error('[AdminSessionProvider] signIn failed:', reason);
      setError(reason instanceof Error ? reason : new Error('Authentication failed.'));
      setStatus('error');
    }
  }, [client, clearTimer]);

  const pollApproval = useCallback(async () => {
    if (!approval) return;
    const current = ++generation.current;
    try {
      const result = await client.pollApproval(approval.approvalId, approval.pollToken);
      if (generation.current !== current) return;
      if (result.kind === 'pending') {
        setStatus('pendingapproval');
      } else {
        setApproval(null);
        setError(null);
        setExpiresAt(result.expiresAt);
        setStatus('authenticated');
      }
    } catch (reason) {
      if (generation.current !== current) return;
      console.error('[AdminSessionProvider] pollApproval failed:', reason);
      setError(reason instanceof Error ? reason : new Error('Approval status could not be checked.'));
      setStatus('error');
    }
  }, [approval, client]);

  const clearLocalSession = useCallback(() => {
    generation.current += 1;
    clearTimer();
    client.clear();
    setApproval(null);
    setExpiresAt(null);
    setError(null);
    setStatus('unauthenticated');
  }, [client, clearTimer]);

  const logout = useCallback(async () => {
    const current = ++generation.current;
    clearTimer();
    client.clear();
    setApproval(null);
    setExpiresAt(null);
    setError(null);
    setStatus('restoring');
    try {
      await client.logout();
      if (generation.current === current) setStatus('unauthenticated');
    } catch (reason) {
      const failure = reason instanceof Error ? reason : new Error('Logout could not be completed on the server.');
      if (generation.current === current) {
        setError(failure);
        setStatus('error');
      }
      throw reason;
    }
  }, [client, clearTimer]);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const current = generation.current;
    try {
      const response = await client.fetchAuthenticated(path, init);
      if (generation.current === current && !client.getAccessToken()) clearLocalSession();
      return response;
    } catch (reason) {
      if (generation.current === current && reason instanceof AdminAuthReauthenticationRequired) clearLocalSession();
      if (generation.current === current && !client.getAccessToken()) clearLocalSession();
      throw reason;
    }
  }, [client, clearLocalSession]);
  const value = useMemo(() => ({ status, approval, expiresAt, error, signIn, pollApproval, logout, request }),
    [status, approval, expiresAt, error, signIn, pollApproval, logout, request]);

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionContextValue {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error('useAdminSession must be used within an AdminSessionProvider.');
  return value;
}

export function useOptionalAdminSession(): AdminSessionContextValue | null {
  return useContext(AdminSessionContext);
}
