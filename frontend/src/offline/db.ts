import Dexie, { type Table } from 'dexie';

export type SyncStatus = 'queued' | 'sending' | 'acknowledged' | 'flagged_audit' | 'rejected' | 'unknown';

export interface MetaRow { key: string; value: unknown }
export interface DeviceRow {
  id: string;
  deviceId?: string;
  devicePrefix?: string;
  token?: string;
  expiresAt?: string;
  branchId?: string;
  next_seq?: number;
}

export interface LocalActivePeriod {
  period_id: string;
  starts_on: string;
  ends_on: string;
  access: 'valid' | 'valid_with_outstanding_balance' | 'denied';
}

export interface MemberRow {
  member_id: string;
  member_number?: string | number | null;
  full_name?: string;
  phone_last4?: string;
  photo_hash?: string | null;
  status?: string;
  active_periods?: LocalActivePeriod[];
  has_debt?: boolean;
  changed_at?: string;
  nameTokens?: string[];
  [k: string]: unknown;
}
export interface CatalogRow {
  product_id: string;
  code?: string;
  name?: string;
  unit?: string;
  price_minor?: number;
  is_active?: boolean;
  on_hand?: number;
  [k: string]: unknown;
}
export interface RegisterRow { register_id: string; [k: string]: unknown }
export interface ShiftStateRow {
  register_id: string;
  shift_id?: string;
  opening_cash_minor?: number;
  opened_at?: string;
  status?: string;
  closed_at?: string;
  [k: string]: unknown;
}
export interface OfflineCredentialRow {
  staff_id: string;
  salt: string;
  hash: string;
  iterations: number;
  grantExpiresAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
}
export interface LocalEventReceipt { status: string; server_refs?: unknown; reason?: string; [k: string]: unknown }
export interface LocalEvent {
  event_id: string;
  seq: number;
  event_type: string;
  schema_version: number;
  actor_staff_id: string;
  payload: unknown;
  payload_hash: string;
  client_recorded_at: string;
  clock_anchor_utc: string | null;
  clock_monotonic_delta_ms: number | null;
  sync_status: SyncStatus;
  created_at: string;
  receipt?: LocalEventReceipt;
}
export interface ReceiptRow { event_id: string; [k: string]: unknown }
export interface LocalCheckInRow { id?: number; member_id: string; recorded_at: string; [k: string]: unknown }

export class EvoGymLocalDB extends Dexie {
  meta!: Table<MetaRow, string>;
  device!: Table<DeviceRow, string>;
  members!: Table<MemberRow, string>;
  catalog!: Table<CatalogRow, string>;
  registers!: Table<RegisterRow, string>;
  shift_state!: Table<ShiftStateRow, string>;
  offline_credentials!: Table<OfflineCredentialRow, string>;
  local_event_queue!: Table<LocalEvent, string>;
  receipts!: Table<ReceiptRow, string>;
  local_check_ins!: Table<LocalCheckInRow, number>;

  constructor(name = 'evogym-local') {
    super(name);
    this.version(1).stores({
      meta: '&key',
      device: '&id',
      members: '&member_id, member_number, *nameTokens',
      catalog: '&product_id, unit',
      registers: '&register_id',
      shift_state: '&register_id',
      offline_credentials: '&staff_id',
      local_event_queue: '&event_id, seq, sync_status, created_at',
      receipts: '&event_id',
      local_check_ins: '++id, member_id, recorded_at',
    });
  }
}

export const openLocalDb = (name = 'evogym-local'): EvoGymLocalDB => new EvoGymLocalDB(name);

export class OfflineStorageError extends Error {
  readonly cause?: unknown;
  constructor(message = 'Almacenamiento lleno: no se puede operar sin conexión', cause?: unknown) {
    super(message);
    this.name = 'OfflineStorageError';
    this.cause = cause;
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function markStorageUnhealthy(db: EvoGymLocalDB): Promise<void> {
  try {
    await db.meta.put({ key: 'storageHealthy', value: false });
  } catch {
    // Storage is full; the in-memory flag below keeps the process fail-closed.
  }
  unhealthy.add(db.name);
}

const unhealthy = new Set<string>();

export async function isStorageHealthy(db: EvoGymLocalDB): Promise<boolean> {
  if (unhealthy.has(db.name)) return false;
  const row = await db.meta.get('storageHealthy');
  return row?.value !== false;
}

export function isQuotaError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e);
    const name = (e as { name?: string }).name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
    e = (e as { inner?: unknown; cause?: unknown }).inner ?? (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Runs a write; on quota failure marks storage unhealthy (fail-closed) and throws OfflineStorageError. */
export async function safeWrite<T>(db: EvoGymLocalDB, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isQuotaError(err)) {
      await markStorageUnhealthy(db);
      throw new OfflineStorageError(undefined, err);
    }
    throw err;
  }
}
