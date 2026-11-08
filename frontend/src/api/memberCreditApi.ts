import { requestJson, type ApiRequest } from './http';

export interface MemberCreditMovement {
  id: string;
  member_id: string;
  branch_id: string;
  register_id: string;
  shift_id: string;
  kind: 'deposit' | 'apply';
  amount_minor: number;
  balance_after_minor: number;
  order_id: string | null;
  debt_id: string | null;
  rental_charge_id: string | null;
  received_by: string;
  created_at: string;
}

export interface MemberCreditMovementPage {
  total_items: number;
  items: MemberCreditMovement[];
}

const MESSAGES = {
  403: 'No tienes autorización para registrar saldo a favor en esta caja.',
  404: 'No se encontró el socio o la caja.',
  409: 'No se pudo registrar el saldo a favor. Verifica que la caja tenga un turno abierto.',
};

/** Cash received into a member's saldo a favor; needs an open shift on `registerId`. */
export function depositMemberCredit(
  request: ApiRequest,
  registerId: string,
  body: { member_id: string; amount_minor: number },
  idempotencyKey: string,
): Promise<MemberCreditMovement> {
  return requestJson<MemberCreditMovement>(
    request,
    `/api/v1/registers/${encodeURIComponent(registerId)}/member-credit-deposits`,
    { method: 'POST', body, idempotencyKey, messages: MESSAGES },
  );
}

export function listMemberCreditMovements(
  request: ApiRequest,
  memberId: string,
  offset = 0,
  limit = 50,
): Promise<MemberCreditMovementPage> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  return requestJson<MemberCreditMovementPage>(
    request,
    `/api/v1/members/${encodeURIComponent(memberId)}/credit-movements?${params}`,
    { messages: MESSAGES },
  );
}
