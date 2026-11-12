import { demoDenominations, parseCashQuantity } from '@/domain/cash';
import type { ShiftCloseDraftDTO, ShiftCloseDraftInputDTO } from '../../api/shiftsApi';

export type CloseDraftMap = Record<string, string>;

export interface StoredLocalCloseDraft {
  draft: CloseDraftMap;
  updatedAt: string;
  synced: boolean;
}

const DRAFT_STORAGE_PREFIX = 'evogym.shift.closeDraft.v1.';

function storageKey(shiftId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${shiftId}`;
}

export function createEmptyCloseDraft(): CloseDraftMap {
  return { mode: 'denominations', manualTotal: '', closingNotes: '', entryMode: 'units' };
}

export function readLocalCloseDraft(shiftId: string): StoredLocalCloseDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(shiftId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLocalCloseDraft>;
    if (!parsed || typeof parsed !== 'object' || !parsed.draft || typeof parsed.draft !== 'object') {
      return null;
    }
    return {
      draft: { ...createEmptyCloseDraft(), ...parsed.draft },
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      synced: Boolean(parsed.synced),
    };
  } catch {
    return null;
  }
}

export function writeLocalCloseDraft(
  shiftId: string,
  draft: CloseDraftMap,
  options?: { updatedAt?: string; synced?: boolean },
): boolean {
  try {
    const payload: StoredLocalCloseDraft = {
      draft,
      updatedAt: options?.updatedAt ?? new Date().toISOString(),
      synced: options?.synced ?? false,
    };
    window.localStorage.setItem(storageKey(shiftId), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalCloseDraft(shiftId: string): void {
  try {
    window.localStorage.removeItem(storageKey(shiftId));
  } catch {
    // Clearing failure should never abort an already confirmed close.
  }
}

export function closeDraftToServerInput(draft: CloseDraftMap): ShiftCloseDraftInputDTO {
  const denominationCounts: { denomination_minor: number; quantity: number }[] = [];
  for (const item of demoDenominations) {
    const parsed = parseCashQuantity(draft[`quantity-${item.valueMinor}`] ?? '0');
    const quantity = parsed !== null && parsed > 0 ? parsed : 0;
    if (quantity > 0) {
      denominationCounts.push({ denomination_minor: item.valueMinor, quantity });
    }
  }
  return {
    mode: draft.mode === 'manual' ? 'manual' : 'denominations',
    entry_mode: draft.entryMode === 'amount' ? 'amount' : 'units',
    denomination_counts: denominationCounts,
    manual_total: (draft.manualTotal ?? '').slice(0, 32),
    closing_notes: (draft.closingNotes ?? '').slice(0, 500),
  };
}

export function serverDraftToCloseDraft(serverDraft: ShiftCloseDraftDTO): CloseDraftMap {
  const next: CloseDraftMap = {
    mode: serverDraft.mode === 'manual' ? 'manual' : 'denominations',
    entryMode: serverDraft.entry_mode === 'amount' ? 'amount' : 'units',
    manualTotal: serverDraft.manual_total ?? '',
    closingNotes: serverDraft.closing_notes ?? '',
  };
  for (const row of serverDraft.denomination_counts ?? []) {
    if (row.quantity > 0) {
      next[`quantity-${row.denomination_minor}`] = String(row.quantity);
      next[`amount-${row.denomination_minor}`] = ((row.quantity * row.denomination_minor) / 100).toString();
    }
  }
  return next;
}

export function resolveInitialCloseDraft(
  shiftId: string,
  serverDraft?: ShiftCloseDraftDTO | null,
): { draft: CloseDraftMap; dirty: boolean; notice: string } {
  const local = readLocalCloseDraft(shiftId);
  const serverTime = serverDraft?.updated_at ? Date.parse(serverDraft.updated_at) : Number.NaN;
  const localTime = local?.updatedAt ? Date.parse(local.updatedAt) : Number.NaN;

  if (local && serverDraft) {
    const serverIsNewer =
      local.synced &&
      Number.isFinite(serverTime) &&
      (!Number.isFinite(localTime) || serverTime >= localTime);
    if (serverIsNewer) {
      const merged = serverDraftToCloseDraft(serverDraft);
      writeLocalCloseDraft(shiftId, merged, {
        updatedAt: serverDraft.updated_at ?? new Date().toISOString(),
        synced: true,
      });
      return {
        draft: merged,
        dirty: false,
        notice: 'Se cargó el último avance guardado en el servidor.',
      };
    }
    return {
      draft: local.draft,
      dirty: !local.synced,
      notice: local.synced
        ? 'Se cargó el último avance guardado.'
        : 'Se restauró tu avance local pendiente de guardar en el servidor.',
    };
  }

  if (local) {
    return {
      draft: local.draft,
      dirty: !local.synced,
      notice: local.synced
        ? 'Se cargó el último avance guardado.'
        : 'Se restauró tu avance local pendiente de guardar en el servidor.',
    };
  }

  if (serverDraft) {
    const merged = serverDraftToCloseDraft(serverDraft);
    writeLocalCloseDraft(shiftId, merged, {
      updatedAt: serverDraft.updated_at ?? new Date().toISOString(),
      synced: true,
    });
    return {
      draft: merged,
      dirty: false,
      notice: 'Se cargó el último avance guardado en el servidor.',
    };
  }

  return { draft: createEmptyCloseDraft(), dirty: false, notice: '' };
}
