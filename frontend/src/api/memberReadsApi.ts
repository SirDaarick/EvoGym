import { getReceptionConfig, type ReceptionConfig } from './receptionApi';

/**
 * TypeScript contract interfaces for Member Reload Read Contract (v1).
 * Conforms to P2.2 specification (docs/work-packages/contracts/P2.2-member-read-dto.md).
 */

export type MemberStatus = 'active' | 'inactive' | 'expired' | 'suspended' | 'pending';

export type EntitlementAccessStatus =
  | 'eligible'
  | 'expired'
  | 'restricted_unpaid'
  | 'restricted_admin'
  | 'branch_restricted';

export interface MemberProfile {
  id: string; // UUIDv7 / UUIDv4
  organization_id: string;
  home_branch_id: string;
  member_number: string;
  full_name: string;
  preferred_name: string | null;
  phone: string;
  email: string | null;
  birth_date: string | null; // YYYY-MM-DD
  joined_on: string; // YYYY-MM-DD
  status: MemberStatus;
  photo_url: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}

export interface MemberPeriodRead {
  id: string; // UUID
  order_item_id: string; // UUID
  plan_version_id: string; // UUID
  plan_name: string;
  starts_on: string; // YYYY-MM-DD
  ends_on: string; // YYYY-MM-DD
  branch_id: string | null; // null = all branches
  is_current: boolean;
  access_status: EntitlementAccessStatus;
}

export interface ClassSampleRead {
  id: string; // UUID
  order_item_id: string; // UUID
  plan_version_id: string; // UUID
  plan_name: string;
  is_consumed: boolean;
  consumed_at: string | null; // ISO 8601 UTC
  consumed_visit_id: string | null; // UUID
}

export interface MemberDebtItem {
  debt_id: string; // UUID
  order_id: string; // UUID (needed for repayment)
  branch_id: string; // UUID
  currency: 'MXN';
  initial_outstanding_minor: number; // integer centavos
  remaining_balance_minor: number; // integer centavos
  created_at: string; // ISO 8601 UTC
}

export interface MemberFinancialSummary {
  has_pending_balance: boolean;
  credit_balance_minor: number; // integer centavos
  total_pending_balance_minor: number | null; // null for receptionist
  currency: 'MXN';
  debts: MemberDebtItem[]; // empty array for receptionist
}

export interface MemberVisitLog {
  id: string; // UUID
  visit_id: string; // UUID
  branch_id: string; // UUID
  period_id: string | null;
  sample_entitlement_id: string | null;
  occurred_at: string; // ISO 8601 UTC
  access_reason: string;
  access_warnings: string[];
}

export interface MemberReloadResponse {
  profile: MemberProfile;
  active_periods: MemberPeriodRead[];
  class_samples: ClassSampleRead[];
  financial: MemberFinancialSummary;
  recent_visits: MemberVisitLog[];
  server_time: string; // ISO 8601 UTC
}

/**
 * Fetch durable reloadable member read state conforming to P2.2.
 * Resolves API URL via ReceptionConfig and dispatches authenticated GET.
 */
export async function getMemberReload(
  memberId: string,
  token: string,
  config?: ReceptionConfig,
  visitLimit?: number
): Promise<MemberReloadResponse> {
  const activeConfig = config ?? getReceptionConfig();
  const query = visitLimit !== undefined ? `?visit_limit=${encodeURIComponent(visitLimit)}` : '';
  const url = `${activeConfig.apiOrigin}/api/v1/members/${encodeURIComponent(memberId)}/reload${query}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let errorMessage: string | undefined;
    try {
      const errorPayload = await response.json();
      if (errorPayload && typeof errorPayload.message === 'string') {
        errorMessage = errorPayload.message;
      }
    } catch {
      // Non-JSON response body; fall back to status-based messages
    }

    if (response.status === 401) {
      throw new Error(errorMessage || 'La sesión expiró o se requiere autenticación.');
    }
    if (response.status === 403) {
      throw new Error(errorMessage || 'Acceso denegado: permisos insuficientes o restricción de sucursal.');
    }
    if (response.status === 404) {
      throw new Error(errorMessage || 'Socio no encontrado.');
    }
    if (response.status === 422) {
      throw new Error(errorMessage || 'Identificador de socio inválido.');
    }
    throw new Error(errorMessage || `La solicitud falló (${response.status}).`);
  }

  return response.json() as Promise<MemberReloadResponse>;
}
