import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { branchPayrollDate, getPayrollWeek } from '@/api/payrollApi';
import { listAdminBranches, listAdminRosterProfiles, listAdminStaffAccounts } from '@/api/staffCredentialsApi';
import { listScheduleSeries } from '@/api/staffSchedulesApi';
import { queryKeys } from '@/api/queryKeys';
import { staffKeys, useAdminRequest } from './utils';

/** Branches plus the roster, accounts, schedule series and payroll week of the selected branch. */
export function useStaffRoster(branchId: string) {
  const request = useAdminRequest();
  const queryClient = useQueryClient();
  const [refreshToken, setRefreshToken] = useState(0);

  const branchesQuery = useQuery({
    queryKey: staffKeys.branches(),
    queryFn: () => listAdminBranches(request!),
    enabled: Boolean(request),
  });
  const branches = branchesQuery.data ?? [];
  const timezone = branches.find(branch => branch.id === branchId)?.timezone;
  // `refreshToken` forces a new "current week" evaluation when the payroll week rolled over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payrollDate = useMemo(() => (timezone ? branchPayrollDate(timezone) : null), [timezone, refreshToken]);
  const branchEnabled = Boolean(request && branchId);

  const profilesQuery = useQuery({
    queryKey: staffKeys.roster(branchId),
    queryFn: () => listAdminRosterProfiles(request!, branchId),
    enabled: branchEnabled,
  });
  const accountsQuery = useQuery({
    queryKey: staffKeys.accounts(branchId),
    queryFn: () => listAdminStaffAccounts(request!, branchId),
    enabled: branchEnabled,
  });
  const seriesQuery = useQuery({
    queryKey: staffKeys.series(branchId),
    queryFn: () => listScheduleSeries(request!, branchId).catch(() => []),
    enabled: branchEnabled,
  });
  const payrollQuery = useQuery({
    queryKey: staffKeys.payroll(branchId, payrollDate?.weekStart ?? ''),
    queryFn: () => getPayrollWeek(request!, branchId, payrollDate!.weekStart),
    enabled: branchEnabled && Boolean(payrollDate),
  });

  const loading =
    branchesQuery.isLoading || profilesQuery.isLoading || accountsQuery.isLoading ||
    seriesQuery.isLoading || payrollQuery.isLoading;

  let loadError = '';
  if (!request) loadError = 'La sesión Admin no está disponible. Vuelve a iniciar sesión.';
  else if (branchesQuery.isError) loadError = 'No se pudieron cargar las sucursales desde la API.';
  else if (branchId && (profilesQuery.isError || accountsQuery.isError)) {
    loadError = 'No se pudo cargar el personal de la sucursal. No se usaron datos locales.';
  } else if (branchId && payrollQuery.isError) loadError = 'No se pudo cargar la nómina de la sucursal.';

  /** Re-evaluates the payroll week and refetches every staff query. */
  const reload = useCallback(() => {
    setRefreshToken(token => token + 1);
    return queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
  }, [queryClient]);

  return {
    branches,
    profiles: branchId ? profilesQuery.data ?? [] : [],
    accounts: branchId ? accountsQuery.data ?? [] : [],
    series: branchId ? seriesQuery.data ?? [] : [],
    payroll: branchId ? payrollQuery.data ?? null : null,
    payrollDate: branchId ? payrollDate : null,
    loading,
    loadError,
    reload,
  };
}
