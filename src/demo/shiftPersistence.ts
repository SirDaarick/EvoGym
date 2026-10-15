import type { DemoState } from '../domain/models';
import { createDemoState } from './adapter';

export const STORAGE_KEY = 'evogym.demo.operational.v1';
export const PERSISTENCE_VERSION = 1;
export type ShiftDrafts = Record<string, Record<string, string>>;
export interface PersistenceRecord { version: 1; datasetId: string; state: DemoState; drafts: ShiftDrafts }
export type HydrationResult = { status: 'ready'; record: PersistenceRecord } | { status: 'empty' } | { status: 'corrupt' } | { status: 'unsupported' };

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
const credentialField = (key: string) => {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  if (normalized.startsWith('author')) return false;
  return ['pin', 'pincode', 'password', 'secret', 'token', 'credential', 'auth', 'staffprofile', 'selectedstaff', 'staffid'].some(prefix => normalized.startsWith(prefix));
};
function validTree(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(validTree);
  if (!isObject(value)) return false;
  return Object.entries(value).every(([key, child]) => !credentialField(key) && validTree(child));
}
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isOneOf = (values: readonly string[]) => (value: unknown) => isString(value) && values.includes(value);
function hasFields(value: unknown, strings: string[], numbers: string[], enums: Record<string, readonly string[]> = {}): boolean {
  return isObject(value) && strings.every(key => isString(value[key])) && numbers.every(key => isNumber(value[key]))
    && Object.entries(enums).every(([key, options]) => isOneOf(options)(value[key]));
}
function validDomainEntry(key: string, value: unknown): boolean {
  switch (key) {
    case 'attendance': return hasFields(value, ['id', 'memberId', 'observedCheckIn'], []) && isObject(value)
      && (value.observedCheckOut === null || isString(value.observedCheckOut)) && (value.autoClosedAt === null || isString(value.autoClosedAt));
    case 'members': return hasFields(value, ['id', 'name', 'phone'], ['creditMinor']) && isObject(value)
      && (value.membership === null || hasFields(value.membership, ['planName', 'startsOn', 'endsOn'], []));
    case 'payments': return hasFields(value, ['id', 'memberId', 'planId', 'planName', 'recordedAt', 'shiftId'], ['amountMinor'], { method: ['cash', 'card', 'transfer'], status: ['paid', 'pending'] }) && isObject(value) && value.effectiveDates === null;
    case 'ledger': return hasFields(value, ['id', 'paymentId', 'shiftId', 'recordedAt'], ['amountMinor'], { kind: ['membership', 'product', 'visit'], method: ['cash', 'card'] });
    case 'shifts': {
      if (!hasFields(value, ['id', 'openedAt'], ['openingCashMinor'], { window: ['06:00–14:00', '14:00–22:00'], status: ['open', 'closed'] }) || !isObject(value)) return false;
      const optionalMoney = ['countedCashMinor', 'expectedCashAtCloseMinor', 'cashDifferenceMinor'];
      return (value.closedAt === undefined || isString(value.closedAt))
        && (value.closingNotes === undefined || isString(value.closingNotes))
        && optionalMoney.every(field => value[field] === undefined || isNumber(value[field]))
        && (value.cashDenominations === undefined || (Array.isArray(value.cashDenominations)
          && value.cashDenominations.every(item => {
            if (!hasFields(item, [], ['valueMinor', 'quantity'])) return false;
            const count = item as Record<string, unknown>;
            return Number.isSafeInteger(count.valueMinor) && Number.isSafeInteger(count.quantity) && (count.quantity as number) >= 0;
          })));
    }
    case 'products': return hasFields(value, ['id', 'name'], ['priceMinor', 'openingQuantity']) && isObject(value) && value.illustrative === true;
    case 'stockMovements': return hasFields(value, ['id', 'productId', 'shiftId', 'recordedAt'], ['quantity'], { kind: ['restock', 'sale', 'waste'] });
    case 'counts': return hasFields(value, ['id', 'productId', 'shiftId', 'recordedAt'], ['quantity', 'expectedAtCount', 'variance']);
    case 'sales': return hasFields(value, ['id', 'description', 'shiftId', 'recordedAt'], ['quantity', 'unitPriceMinor', 'amountMinor'], { kind: ['product', 'visit'], method: ['cash', 'card', 'transfer'], status: ['confirmed', 'pending'] });
    case 'memberNotes': return hasFields(value, ['id', 'memberId', 'body', 'authorId', 'authorName', 'createdAt'], []);
    case 'gloves': return hasFields(value, ['id', 'code', 'color'], ['ounces', 'priceMinor'], { status: ['available', 'rented'] });
    case 'gloveRentals': return hasFields(value, ['id', 'gloveId', 'memberId', 'memberName', 'shiftId', 'rentedAt'], ['priceMinor'], { method: ['cash', 'card', 'transfer'], status: ['paid', 'pending'] });
    case 'lockers': return hasFields(value, ['id', 'code'], ['number', 'monthlyPriceMinor'], { status: ['available', 'assigned', 'employee', 'evicted', 'out_of_service'] });
    case 'lockerRentals': return hasFields(value, ['id', 'lockerId', 'memberId', 'memberName', 'shiftId', 'rentedAt', 'expiresAt'], ['priceMinor'], { method: ['cash', 'card', 'transfer'], status: ['paid', 'pending'] });
    case 'supplements': return hasFields(value, ['id', 'name'], ['scoopPriceMinor', 'availableScoops']);
    case 'supplementSales': return hasFields(value, ['id', 'supplementId', 'name', 'shiftId', 'recordedAt'], ['scoops', 'unitPriceMinor', 'amountMinor'], { method: ['cash', 'card', 'transfer'], status: ['confirmed', 'pending'] });
    case 'expenses': return hasFields(value, ['id', 'concept', 'payeeName', 'shiftId', 'recordedAt'], ['amountMinor']);
    case 'extras': return hasFields(value, ['id', 'concept', 'staffName', 'shiftId', 'recordedAt'], ['amountMinor']);
    default: return false;
  }
}
function validState(value: unknown): value is DemoState {
  if (!isObject(value) || !validTree(value)) return false;
  const required = ['attendance', 'members', 'payments', 'ledger', 'shifts', 'products', 'stockMovements', 'counts', 'sales'];
  if (required.some(key => !Array.isArray(value[key]))) return false;
  const optional = ['gloves', 'gloveRentals', 'lockers', 'lockerRentals', 'supplements', 'supplementSales', 'expenses', 'extras', 'memberNotes'];
  return [...required, ...optional].every(key => value[key] === undefined
      ? !required.includes(key)
      : Array.isArray(value[key]) && (value[key] as unknown[]).every(entry => validDomainEntry(key, entry)))
    && typeof value.demoClock === 'string' && typeof value.currentShiftId === 'string'
    && Number.isSafeInteger(value.revision) && isObject(value.attendancePolicy)
    && typeof value.attendancePolicy.allowExpiryDay === 'boolean' && typeof value.attendancePolicy.allowRepeatVisits === 'boolean';
}
function validDrafts(value: unknown): value is ShiftDrafts {
  return isObject(value) && Object.entries(value).every(([shiftId, draft]) => !credentialField(shiftId) && isObject(draft)
    && Object.entries(draft).every(([field, input]) => !credentialField(field) && typeof input === 'string'));
}
function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `dataset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export function createPersistenceRecord(state: DemoState, drafts: ShiftDrafts = {}, datasetId = makeId()): PersistenceRecord {
  return { version: PERSISTENCE_VERSION, datasetId, state, drafts };
}
export function parsePersistenceRecord(raw: string): PersistenceRecord {
  const value: unknown = JSON.parse(raw);
  if (!isValidPersistenceRecord(value)) throw new Error('Invalid persistence record');
  return value as unknown as PersistenceRecord;
}
function isValidPersistenceRecord(value: unknown): value is PersistenceRecord {
  return isObject(value) && value.version === PERSISTENCE_VERSION && typeof value.datasetId === 'string' && !!value.datasetId
    && validState(value.state) && validDrafts(value.drafts);
}
export function hydratePersistence(storage: Storage): HydrationResult {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { status: 'empty' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== PERSISTENCE_VERSION) return { status: 'unsupported' };
    return { status: 'ready', record: parsePersistenceRecord(raw) };
  } catch { return { status: 'corrupt' }; }
}
export function savePersistenceRecord(storage: Storage, record: PersistenceRecord): void {
  const raw = JSON.stringify(record);
  if (!isValidPersistenceRecord(JSON.parse(raw))) throw new Error('Invalid persistence record');
  storage.setItem(STORAGE_KEY, raw);
}

export type WriterLockResult = { status: 'acquired'; release: () => void } | { status: 'blocked' } | { status: 'unavailable' };

async function requestLockOnce(): Promise<WriterLockResult> {
  const locks = navigator.locks;
  if (!locks) return { status: 'unavailable' };
  let releaseLock!: () => void;
  let signalAcquired!: (release: () => void) => void;
  const acquired = new Promise<((() => void))>(resolve => { signalAcquired = resolve; });
  const held = new Promise<void>(resolve => { releaseLock = resolve; });
  let request: Promise<unknown>;
  try { request = locks.request(STORAGE_KEY, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) return;
    signalAcquired(releaseLock);
    await held;
  }); } catch { return { status: 'unavailable' }; }
  const raced = await Promise.race([acquired.then(release => ({ status: 'acquired' as const, release })),
    request.then(() => ({ status: 'blocked' as const }), () => ({ status: 'unavailable' as const }))]);
  return raced;
}

export async function acquireExclusiveWriter(retries = 3, retryDelayMs = 30): Promise<WriterLockResult> {
  for (let i = 0; i <= retries; i++) {
    const res = await requestLockOnce();
    if (res.status === 'acquired' || res.status === 'unavailable') return res;
    if (i < retries) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  return { status: 'blocked' };
}

export function emptyPersistenceRecord(): PersistenceRecord { return createPersistenceRecord(createDemoState(), {}); }
