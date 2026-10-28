export type AuthenticatedRequest = (path: string, init?: RequestInit) => Promise<Response>;

export interface MemberListItemDTO {
  id: string;
  member_number: string;
  full_name: string;
  preferred_name: string | null;
  phone: string;
  status: string;
  joined_on: string;
  credit_balance_minor: number;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  photo_url: string | null;
}

export interface MemberDetailDTO extends MemberListItemDTO {
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  pending_balance_minor: number;
  has_pending_balance: boolean;
}

export interface MemberListResponse {
  items: MemberListItemDTO[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface MemberNoteDTO {
  id: string;
  member_id: string;
  author_id: string;
  body: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  is_voided: boolean;
}

export type MemberNoteListResponse = MemberNoteDTO[];

export interface CreateMemberPayload {
  member_number: string;
  full_name: string;
  phone: string;
  preferred_name?: string | null;
  email?: string | null;
  birth_date?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  photo_url?: string | null;
  joined_on?: string | null;
  initial_notes?: string | null;
}

export interface UpdateMemberPayload {
  full_name?: string | null;
  preferred_name?: string | null;
  phone?: string | null;
  email?: string | null;
  birth_date?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  photo_url?: string | null;
  status?: string | null;
}

export class MemberApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'MemberApiError';
  }
}

export class MemberNumberConflictError extends Error {
  readonly kind = 'conflict';

  constructor(readonly status: 409, readonly memberNumber: string) {
    super('Este número de socio ya pertenece a otra identidad.');
    this.name = 'MemberNumberConflictError';
  }
}

export class MemberApiNetworkError extends Error {
  readonly kind = 'network';

  constructor(message = 'No se pudo conectar con el servidor. Intenta nuevamente.') {
    super(message);
    this.name = 'MemberApiNetworkError';
  }
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const err = obj.error ?? obj.detail;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string') {
      return (err as Record<string, unknown>).message as string;
    }
    if (typeof obj.message === 'string') return obj.message;
  }
  if (status === 401) return 'La sesión expiró o fue revocada.';
  if (status === 403) return 'No tienes autorización para realizar esta acción.';
  if (status === 404) return 'El recurso solicitado no fue encontrado.';
  if (status === 409) return 'Conflicto al procesar los datos del socio.';
  if (status === 422) return 'Revisa los datos enviados e intenta nuevamente.';
  return status >= 500 ? 'El servidor no pudo completar la operación.' : `La solicitud falló (${status}).`;
}

const defaultRequest: AuthenticatedRequest = (path, init) => fetch(path, init);

export function createMemberNumber(): string {
  return `M${crypto.randomUUID().replaceAll('-', '').slice(0, 31)}`;
}

export function createMember(
  request: AuthenticatedRequest,
  payload: CreateMemberPayload
): Promise<MemberDetailDTO>;
export function createMember(
  payload: CreateMemberPayload
): Promise<MemberDetailDTO>;
export async function createMember(
  first: AuthenticatedRequest | CreateMemberPayload,
  second?: CreateMemberPayload
): Promise<MemberDetailDTO> {
  const req: AuthenticatedRequest = typeof first === 'function' ? first : defaultRequest;
  const payload: CreateMemberPayload = typeof first === 'function' ? second! : first;

  let response: Response;
  try {
    response = await req('/api/v1/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new MemberApiNetworkError();
  }

  if (response.status === 409) {
    const query = new URLSearchParams({
      page: '1',
      limit: '100',
      search: payload.member_number,
      sort_by: 'member_number',
      sort_dir: 'asc',
    });
    let items: MemberListItemDTO[];
    try {
      const searchRes = await req(`/api/v1/members?${query}`);
      if (!searchRes.ok) throw new Error('Search failed');
      const data = (await searchRes.json()) as MemberListResponse;
      items = data.items;
      if (!Array.isArray(items)) throw new Error('Member search did not return an items list.');
    } catch {
      throw new MemberApiNetworkError('No se pudo verificar el resultado del registro. Reintentá con el mismo número y los mismos datos.');
    }

    const sameNumber = items.filter(
      member => typeof member === 'object' && member !== null && member.member_number === payload.member_number
    );
    const match = sameNumber.find(
      member => member.full_name === payload.full_name && member.phone === payload.phone
    );
    if (match) return match as unknown as MemberDetailDTO;
    if (sameNumber.length > 0) throw new MemberNumberConflictError(409, payload.member_number);
    throw new MemberApiNetworkError('La búsqueda no confirmó si el número de socio ya fue registrado. Reintentá con el mismo número y los mismos datos.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new MemberApiError(response.status, extractErrorMessage(body, response.status));
  }

  return response.json() as Promise<MemberDetailDTO>;
}

export function updateMember(
  request: AuthenticatedRequest,
  memberId: string,
  payload: UpdateMemberPayload
): Promise<MemberDetailDTO>;
export function updateMember(
  memberId: string,
  payload: UpdateMemberPayload
): Promise<MemberDetailDTO>;
export async function updateMember(
  first: AuthenticatedRequest | string,
  second: string | UpdateMemberPayload,
  third?: UpdateMemberPayload
): Promise<MemberDetailDTO> {
  const req: AuthenticatedRequest = typeof first === 'function' ? first : defaultRequest;
  const memberId: string = typeof first === 'function' ? (second as string) : (first as string);
  const payload: UpdateMemberPayload = typeof first === 'function' ? third! : (second as UpdateMemberPayload);

  let response: Response;
  try {
    response = await req(`/api/v1/members/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new MemberApiNetworkError();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new MemberApiError(response.status, extractErrorMessage(body, response.status));
  }

  return response.json() as Promise<MemberDetailDTO>;
}

export function listMemberNotes(
  request: AuthenticatedRequest,
  memberId: string
): Promise<MemberNoteListResponse>;
export function listMemberNotes(
  memberId: string
): Promise<MemberNoteListResponse>;
export async function listMemberNotes(
  first: AuthenticatedRequest | string,
  second?: string
): Promise<MemberNoteListResponse> {
  const req: AuthenticatedRequest = typeof first === 'function' ? first : defaultRequest;
  const memberId: string = typeof first === 'function' ? second! : (first as string);

  let response: Response;
  try {
    response = await req(`/api/v1/members/${encodeURIComponent(memberId)}/notes`, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new MemberApiNetworkError();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new MemberApiError(response.status, extractErrorMessage(body, response.status));
  }

  return response.json() as Promise<MemberNoteListResponse>;
}

export function createMemberNote(
  request: AuthenticatedRequest,
  memberId: string,
  body: string
): Promise<MemberNoteDTO>;
export function createMemberNote(
  memberId: string,
  body: string
): Promise<MemberNoteDTO>;
export async function createMemberNote(
  first: AuthenticatedRequest | string,
  second: string,
  third?: string
): Promise<MemberNoteDTO> {
  const req: AuthenticatedRequest = typeof first === 'function' ? first : defaultRequest;
  const memberId: string = typeof first === 'function' ? second : (first as string);
  const bodyText: string = typeof first === 'function' ? third! : second;

  let response: Response;
  try {
    response = await req(`/api/v1/members/${encodeURIComponent(memberId)}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: bodyText }),
    });
  } catch {
    throw new MemberApiNetworkError();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new MemberApiError(response.status, extractErrorMessage(body, response.status));
  }

  return response.json() as Promise<MemberNoteDTO>;
}
