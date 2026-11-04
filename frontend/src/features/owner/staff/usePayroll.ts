import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payPayrollWeek, recordPayrollAdvance, type PayrollItem } from '@/api/payrollApi';
import { addDays } from '@/shared/formatters/date';
import { staffKeys, useAdminRequest } from './utils';

export interface PayrollDialogState {
  item: PayrollItem;
  mode: 'advance' | 'pay';
  targetWeek: string;
  key: string;
  nextWeekKey?: string;
}

export interface PayrollSubmission {
  dialog: PayrollDialogState;
  amountMinor: number | null;
  nextAdvanceMinor: number | null;
  notes: string;
  method: 'cash' | 'transfer';
}

/** Records an advance or pays the week, then refreshes the payroll queries. */
export function usePayroll(branchId: string) {
  const request = useAdminRequest();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dialog, amountMinor, nextAdvanceMinor, notes, method }: PayrollSubmission) => {
      if (!request) throw new Error('La sesión Admin no está disponible. Vuelve a iniciar sesión.');
      const target = { branch_id: branchId, staff_profile_id: dialog.item.profile_id, week_start: dialog.targetWeek };
      if (dialog.mode === 'advance') {
        await recordPayrollAdvance(request, { ...target, amount_minor: amountMinor!, ...(notes ? { notes } : {}) }, dialog.key);
        return;
      }
      await payPayrollWeek(request, { ...target, payment_method: method }, dialog.key);
      if (nextAdvanceMinor !== null && nextAdvanceMinor > 0) {
        await recordPayrollAdvance(request, {
          ...target,
          week_start: addDays(dialog.targetWeek, 7),
          amount_minor: nextAdvanceMinor,
          notes: 'Adelanto registrado junto con liquidación semanal',
        }, dialog.nextWeekKey || crypto.randomUUID());
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: staffKeys.payrollAll }),
  });
}
