import type { PlanComposition } from './models';

export interface Plan {
  id: string;
  name: string;
  amountMinor: number;
  referenceAmountMinor?: number;
  applicability: string;
  restriction?: string;
  kind: 'membership' | 'visit';
  active?: boolean;
  revision?: number;
  composition?: PlanComposition;
  sourceLabel?: string;
  legacy?: boolean;
}

export const PLAN_COLORS: Record<string, string> = {
  gym: '#FC6C06',       // Official EGC Orange
  box: '#2455A4',       // Technical Deep Blue
  combo: '#0284C7',     // Sky Blue
  student: '#10B981',   // Emerald Green
  other: '#64748B',     // Neutral Slate
  none: '#94A3B8',      // Light Slate
};

export function classifyPlanCategory(planName: string | undefined | null): { key: string; label: string; color: string } {
  if (!planName) {
    return { key: 'none', label: 'Sin plan activo', color: PLAN_COLORS.none };
  }
  const lower = planName.toLowerCase();
  if (lower.includes('estudiante')) {
    return { key: 'student', label: 'Estudiantes', color: PLAN_COLORS.student };
  }
  if (lower.includes('gym') && lower.includes('box')) {
    return { key: 'combo', label: 'Combo Gym + Box', color: PLAN_COLORS.combo };
  }
  if (lower.includes('box')) {
    return { key: 'box', label: 'Box', color: PLAN_COLORS.box };
  }
  if (lower.includes('gym') || lower === 'mensual') {
    return { key: 'gym', label: 'Gym', color: PLAN_COLORS.gym };
  }
  return { key: 'other', label: planName, color: PLAN_COLORS.other };
}
