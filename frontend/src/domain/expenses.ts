export type ExpenseCategoryKey =
  | 'consumibles'
  | 'limpieza'
  | 'mantenimiento_piso'
  | 'mantenimiento_peso'
  | 'mantenimiento_cardio'
  | 'mantenimiento_box'
  | 'servicios'
  | 'general';

export type ExpenseCategoryLabel =
  | 'Consumibles'
  | 'Limpieza'
  | 'Mantenimiento: Piso'
  | 'Mantenimiento: Peso'
  | 'Mantenimiento: Cardio'
  | 'Mantenimiento: Box'
  | 'Servicios'
  | 'General';

export interface ExpenseCategoryConfig {
  key: ExpenseCategoryKey;
  label: ExpenseCategoryLabel;
  color: string;
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategoryKey, ExpenseCategoryConfig> = {
  consumibles: {
    key: 'consumibles',
    label: 'Consumibles',
    color: '#2455A4', // Accessible Blue
  },
  limpieza: {
    key: 'limpieza',
    label: 'Limpieza',
    color: '#0284C7', // Sky Cyan
  },
  mantenimiento_piso: {
    key: 'mantenimiento_piso',
    label: 'Mantenimiento: Piso',
    color: '#9A3412', // Terracotta
  },
  mantenimiento_peso: {
    key: 'mantenimiento_peso',
    label: 'Mantenimiento: Peso',
    color: '#D97706', // Amber
  },
  mantenimiento_cardio: {
    key: 'mantenimiento_cardio',
    label: 'Mantenimiento: Cardio',
    color: '#EA580C', // Orange-red
  },
  mantenimiento_box: {
    key: 'mantenimiento_box',
    label: 'Mantenimiento: Box',
    color: '#DC2626', // Red
  },
  servicios: {
    key: 'servicios',
    label: 'Servicios',
    color: '#FC6C06', // Official EGC Orange
  },
  general: {
    key: 'general',
    label: 'General',
    color: '#6B7280', // Technical Neutral Gray
  },
};

/**
 * Automatically classifies an expense concept into an Excel business category:
 * Consumibles | Limpieza | Mantenimiento: Piso | Mantenimiento: Peso | Mantenimiento: Cardio | Mantenimiento: Box | Servicios | General
 */
export function classifyExpenseConcept(concept: string): ExpenseCategoryLabel {
  const normalized = (concept || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 1. Limpieza
  if (
    /cloro|jabon|detergente|trapeador|escoba|desinfectante|sanitizante|sanitas|aromatizante|franela|atomizador/.test(
      normalized
    ) ||
    (normalized.includes('limpieza') && !normalized.includes('mantenimiento'))
  ) {
    return 'Limpieza';
  }

  // 2. Mantenimiento subcategories
  // 2a. Mantenimiento: Box
  if (/costal|pera|box|boxeo|ring|guante/.test(normalized)) {
    return 'Mantenimiento: Box';
  }

  // 2b. Mantenimiento: Piso
  if (/piso|loseta|duela|caucho|tapete/.test(normalized)) {
    return 'Mantenimiento: Piso';
  }

  // 2c. Mantenimiento: Cardio
  if (/caminadora|eliptica|escaladora|banda|bicicleta|spinning|cardio|polea|cable/.test(normalized)) {
    return 'Mantenimiento: Cardio';
  }

  // 2d. Mantenimiento: Peso
  if (/mancuerna|disco|barra|rack|banco|peso|pesas|soldadura|herreria/.test(normalized)) {
    return 'Mantenimiento: Peso';
  }

  // Generic Mantenimiento fallback -> Mantenimiento: Peso
  if (/mantenimiento|reparacion|refaccion|tecnico|plomeria|cerrajeria|aire|clima|foco|balastra|tornillo/.test(normalized)) {
    return 'Mantenimiento: Peso';
  }

  // 3. Servicios
  if (
    /luz|cfe|electricidad|internet|telefono|telmex|servicio|gas|alestra|izzi|megacable|software|suscripcion|linea/.test(
      normalized
    )
  ) {
    return 'Servicios';
  }

  // 4. Consumibles
  if (
    /garrafon|agua|vaso|cafe|azucar|\bte\b|servilleta|insumo|papel|bolsa/.test(
      normalized
    )
  ) {
    return 'Consumibles';
  }

  // 5. General fallback
  return 'General';
}

/** Payment method of a recorded expense (mirrors the API contract). */
export type ExpenseMethod = 'cash' | 'transfer' | 'card';
