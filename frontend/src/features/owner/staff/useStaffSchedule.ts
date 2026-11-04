import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelScheduleSeries,
  createScheduleException,
  createScheduleSeries,
  editFutureScheduleSeries,
  listScheduleOccurrences,
  type CreateSeriesPayload,
  type EditSeriesPayload,
  type StaffScheduleSeriesItem,
} from '@/api/staffSchedulesApi';
import { queryKeys } from '@/api/queryKeys';
import { addDays, businessDate } from '@/shared/formatters/date';
import { staffKeys, toApiTime, useAdminRequest } from './utils';

/** The series currently driving a profile's schedule (non-cancelled first). */
export function activeSeriesFor(series: StaffScheduleSeriesItem[], profileId: string) {
  const list = series.filter(item => item.profile_id === profileId);
  return list.find(item => !item.cancelled_from) ?? list[0];
}

export interface ScheduleFormValues {
  weekdays: number[];
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string;
  scope: 'this_and_future' | 'all_future';
}

/** Occurrence query plus save / cancel / skip / override mutations for one profile's schedule. */
export function useStaffSchedule(profileId: string, branchId: string, activeSeries: StaffScheduleSeriesItem | undefined) {
  const request = useAdminRequest();
  const queryClient = useQueryClient();
  const range = useMemo(() => {
    const from = businessDate();
    return { from, to: addDays(from, 7) };
  }, []);

  const occurrencesQuery = useQuery({
    queryKey: staffKeys.occurrences(profileId, range.from, range.to),
    queryFn: () => listScheduleOccurrences(request!, activeSeries!.id, range.from, range.to).catch(() => []),
    enabled: Boolean(request && activeSeries),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
  const need = () => {
    if (!request) throw new Error('La sesión Admin no está disponible. Vuelve a iniciar sesión.');
    return request;
  };

  const save = useMutation({
    mutationFn: async (form: ScheduleFormValues) => {
      const base = {
        weekdays: form.weekdays,
        start_time: toApiTime(form.startTime),
        end_time: toApiTime(form.endTime),
        end_date: form.endDate ? form.endDate : null,
      };
      if (activeSeries) {
        const payload: EditSeriesPayload = { ...base, effective_date: form.startDate, scope: form.scope };
        await editFutureScheduleSeries(need(), activeSeries.id, payload);
        return 'updated' as const;
      }
      const payload: CreateSeriesPayload = { ...base, start_date: form.startDate };
      await createScheduleSeries(need(), branchId, profileId, payload);
      return 'created' as const;
    },
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => cancelScheduleSeries(need(), activeSeries!.id),
    onSuccess: refresh,
  });
  const skip = useMutation({
    mutationFn: (localDate: string) => createScheduleException(need(), activeSeries!.id, localDate, { action: 'skip' }),
    onSuccess: refresh,
  });
  const override = useMutation({
    mutationFn: ({ localDate, startTime, endTime }: { localDate: string; startTime: string; endTime: string }) =>
      createScheduleException(need(), activeSeries!.id, localDate, {
        action: 'override', start_time: toApiTime(startTime), end_time: toApiTime(endTime),
      }),
    onSuccess: refresh,
  });

  return {
    occurrences: activeSeries ? occurrencesQuery.data ?? [] : [],
    save,
    cancel,
    skip,
    override,
    saving: save.isPending,
    cancelling: cancel.isPending,
    exceptionSaving: skip.isPending || override.isPending,
  };
}
