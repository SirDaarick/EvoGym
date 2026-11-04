import type { HistoryCategory } from '@/domain/reporting';
import type { PaymentMethod } from '../domain/models';
import type { AuthenticatedRequest } from './membershipCheckoutApi';

export type OwnerHistoryStatus = 'confirmed' | 'pending' | 'under_review' | 'failed' | 'recorded' | 'observed' | 'opened' | 'closed';

export interface OwnerHistoryItemResponse {
  id: string;
  occurred_at: string;
  category: HistoryCategory;
  branch_id: string;
  shift_id: string | null;
  description: string;
  detail: string;
  status: OwnerHistoryStatus;
  amount_minor: number | null;
  method: PaymentMethod | null;
  actor_id: string;
  actor_name: string;
  member_id: string | null;
  member_name: string | null;
}

export interface OwnerHistoryResponse {
  period: { from: string; to: string; timezone: string };
  items: OwnerHistoryItemResponse[];
  next_cursor: string | null;
}

export interface OwnerHistoryQuery {
  from?: string;
  to?: string;
  category?: HistoryCategory;
  method?: PaymentMethod;
  branchId?: string;
  cursor?: string | null;
  limit?: number;
}

/** Row shape compatible with `HistoryRecord` (demo/ownerOperations.ts); `shiftId` is '' when absent. */
export interface OwnerHistoryRecord {
  id: string;
  category: HistoryCategory;
  recordedAt: string;
  shiftId: string;
  branchId: string;
  description: string;
  detail: string;
  status: string;
  amountMinor: number | null;
  method: PaymentMethod | null;
  memberId?: string;
  memberName?: string;
  actorId: string;
  actorName: string;
}

export interface OwnerHistoryPage {
  period: { from: string; to: string; timezone: string };
  records: OwnerHistoryRecord[];
  nextCursor: string | null;
}

export const historyStatusLabels: Record<OwnerHistoryStatus, string> = {
  confirmed: 'Confirmado',
  pending: 'Pendiente',
  under_review: 'En revisión',
  failed: 'Fallido',
  recorded: 'Registrado',
  observed: 'Observado',
  opened: 'Apertura',
  closed: 'Cierre',
};

export function mapOwnerHistoryItem(item: OwnerHistoryItemResponse): OwnerHistoryRecord {
  return {
    id: item.id,
    category: item.category,
    recordedAt: item.occurred_at,
    shiftId: item.shift_id ?? '',
    branchId: item.branch_id,
    description: item.description,
    detail: item.detail,
    status: historyStatusLabels[item.status] ?? item.status,
    amountMinor: item.amount_minor,
    method: item.method,
    ...(item.member_id ? { memberId: item.member_id } : {}),
    ...(item.member_name ? { memberName: item.member_name } : {}),
    actorId: item.actor_id,
    actorName: item.actor_name,
  };
}

export async function getOwnerHistory(request: AuthenticatedRequest, query: OwnerHistoryQuery = {}): Promise<OwnerHistoryPage> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.category) params.set('category', query.category);
  if (query.method) params.set('method', query.method);
  if (query.branchId) params.set('branch_id', query.branchId);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(Math.min(200, Math.max(1, Math.trunc(query.limit)))));
  const qs = params.toString();
  const response = await request(`/api/v1/owner/history${qs ? `?${qs}` : ''}`);
  if (!response.ok) throw new Error('No se pudo cargar el historial de movimientos.');
  const body = await response.json() as OwnerHistoryResponse;
  return { period: body.period, records: body.items.map(mapOwnerHistoryItem), nextCursor: body.next_cursor ?? null };
}
