import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deactivateStaffAccount,
  getStaffPendingSale,
  issueInitialPin,
  linkAdminStaffAccount,
  resolveStaffPendingSale,
  updateStaffSalary,
  type AdminRosterProfileChoice,
  type StaffPendingSale,
} from '@/api/staffCredentialsApi';
import { queryKeys } from '@/api/queryKeys';
import { useAdminRequest } from './utils';

export interface DeactivationState {
  profile: AdminRosterProfileChoice;
  pending: StaffPendingSale | null;
  active: boolean;
}

interface Callbacks {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

/** Salary, account link, initial PIN and account deactivation flows for the selected branch. */
export function useStaffAccountActions(branchId: string, { onError, onNotice }: Callbacks) {
  const request = useAdminRequest();
  const queryClient = useQueryClient();
  const branchRef = useRef(branchId);
  branchRef.current = branchId;
  const [issuedPin, setIssuedPin] = useState<{ name: string; value: string } | null>(null);
  const [deactivation, setDeactivation] = useState<DeactivationState | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
  const need = () => {
    if (!request) throw new Error('La sesión Admin no está disponible. Vuelve a iniciar sesión.');
    return request;
  };

  const saveSalary = useMutation({
    mutationFn: ({ profileId, amountMinor }: { profileId: string; amountMinor: number }) =>
      updateStaffSalary(need(), profileId, amountMinor),
    onSuccess: refresh,
  });

  const link = useMutation({
    mutationFn: ({ profileId, accountId }: { profileId: string; accountId: string; label: string; branch: string }) =>
      linkAdminStaffAccount(need(), profileId, accountId),
    onSuccess: (_data, vars) => {
      if (branchRef.current === vars.branch) onNotice(vars.label); // ignore results for a branch we left
      return refresh();
    },
    onError: (_e, vars) => {
      if (branchRef.current === vars.branch) onError('No se pudo vincular la cuenta. Actualiza la sucursal antes de volver a intentarlo.');
    },
  });

  const pin = useMutation({
    mutationFn: ({ staffUserId }: { profileId: string; name: string; staffUserId: string; branch: string }) =>
      issueInitialPin(need(), staffUserId),
    onSuccess: (value, vars) => {
      if (branchRef.current === vars.branch) setIssuedPin({ name: vars.name, value });
    },
    onError: (_e, vars) => {
      if (branchRef.current === vars.branch) onError('No se pudo emitir el PIN inicial desde la API.');
    },
  });

  // Deactivation results are ignored when the selected branch changed while they were in flight.
  const openCheck = useMutation({
    mutationFn: async ({ profile, active }: { profile: AdminRosterProfileChoice; active: boolean; branch: string }) =>
      ({ profile, active, pending: await getStaffPendingSale(need(), profile.staff_user_id!) }),
    onSuccess: (state, vars) => {
      if (branchRef.current === vars.branch) setDeactivation(state);
    },
    onError: (_e, vars) => {
      if (branchRef.current === vars.branch) onError('No se pudo consultar la venta pendiente. Intenta de nuevo.');
    },
  });

  const resolveSale = useMutation({
    mutationFn: async ({ state }: { state: DeactivationState; branch: string }) => {
      const staffId = state.profile.staff_user_id!;
      const status = await resolveStaffPendingSale(need(), staffId, state.pending!.key);
      return { status, pending: await getStaffPendingSale(need(), staffId) };
    },
    onSuccess: ({ status, pending }, { state, branch }) => {
      if (branchRef.current !== branch) return;
      setDeactivation({ ...state, pending });
      onNotice(status === 'completed' ? 'La venta ya estaba registrada.' : 'El intento pendiente fue cancelado; no se registró una venta.');
    },
    onError: (_e, { branch }) => {
      if (branchRef.current === branch) onError('No se pudo confirmar la resolución. Vuelve a consultar el estado.');
    },
  });

  const confirm = useMutation({
    mutationFn: ({ state }: { state: DeactivationState; branch: string }) => deactivateStaffAccount(need(), state.profile.staff_user_id!),
    onSuccess: (_data, { branch }) => {
      if (branchRef.current === branch) { setDeactivation(null); onNotice('La cuenta de acceso fue desactivada.'); }
      return refresh();
    },
    onError: (_e, { branch }) => {
      if (branchRef.current !== branch) return;
      onError('No se pudo desactivar la cuenta. Puede existir una venta pendiente; consulta nuevamente.');
      setDeactivation(null);
    },
  });

  return {
    saveSalary,
    link,
    issuePin: pin,
    issuingId: pin.isPending ? pin.variables?.profileId ?? null : null,
    issuedPin,
    clearIssuedPin: () => setIssuedPin(null),
    deactivation,
    closeDeactivation: () => setDeactivation(null),
    openDeactivation: (vars: { profile: AdminRosterProfileChoice; active: boolean }) => openCheck.mutate({ ...vars, branch: branchRef.current }),
    resolveSale: (state: DeactivationState) => resolveSale.mutate({ state, branch: branchRef.current }),
    confirmDeactivation: (state: DeactivationState) => confirm.mutate({ state, branch: branchRef.current }),
    deactivationBusy: openCheck.isPending || resolveSale.isPending || confirm.isPending,
    reset: () => { setIssuedPin(null); setDeactivation(null); },
  };
}
