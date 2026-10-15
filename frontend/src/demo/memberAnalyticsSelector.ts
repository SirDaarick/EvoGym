import type { Member, Money } from '../domain/models';
import { memberStatus } from './memberStatus';

export interface PlanCategorySlice {
  key: string;
  label: string;
  count: number;
  percent: number;
  color: string;
}

export interface TenureCohort {
  cohort: string;
  label: string;
  count: number;
  percent: number;
  description: string;
}

export interface MemberAnalyticsSummary {
  totalMembers: number;
  activeMembers: number;
  activePercent: number;
  expiringSoonCount: number;
  expiredCount: number;
  noMembershipCount: number;
  tenure: {
    medianMonths: number;
    averageMonths: number;
    medianDays: number;
    longestTenureMonths: number;
  };
  arpuMinor: Money;
  estimatedMonthlyRevenueMinor: Money;
  planSlices: PlanCategorySlice[];
  tenureCohorts: TenureCohort[];
}

const PLAN_COLORS: Record<string, string> = {
  gym: '#FC6C06',       // Official EGC Orange
  box: '#2455A4',       // Technical Deep Blue
  combo: '#0284C7',     // Sky Blue
  student: '#10B981',   // Emerald Green
  other: '#64748B',     // Neutral Slate
  none: '#94A3B8',      // Light Slate
};

const PLAN_MONTHLY_VALUES_MINOR: Record<string, Money> = {
  'Gym mensual': 50000,
  'Box mensual': 50000,
  'Gym + Box mensual': 75000,
  'Gym estudiante': 40000,
  'Box estudiante': 40000,
  'Gym trimestral': 40000, // 120,000 / 3 months = 40,000/month
  'Gym semestral': 38333,
  'Gym anual': 37500,
  'Box kids': 35000,
  'Box beca': 35000,
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

function calculateDaysDifference(dateStrA: string, dateStrB: string): number {
  const tA = new Date(dateStrA + 'T00:00:00Z').getTime();
  const tB = new Date(dateStrB + 'T00:00:00Z').getTime();
  if (Number.isNaN(tA) || Number.isNaN(tB)) return 0;
  return Math.max(0, Math.round((tA - tB) / (1000 * 60 * 60 * 24)));
}

export function getMemberAnalytics(
  members: Member[],
  referenceDate = '2026-10-08'
): MemberAnalyticsSummary {
  const total = members.length;
  if (total === 0) {
    return {
      totalMembers: 0,
      activeMembers: 0,
      activePercent: 0,
      expiringSoonCount: 0,
      expiredCount: 0,
      noMembershipCount: 0,
      tenure: {
        medianMonths: 0,
        averageMonths: 0,
        medianDays: 0,
        longestTenureMonths: 0,
      },
      arpuMinor: 0,
      estimatedMonthlyRevenueMinor: 0,
      planSlices: [],
      tenureCohorts: [
        { cohort: '< 1 mes', label: '< 1 mes', count: 0, percent: 0, description: 'Nuevos ingresos' },
        { cohort: '1-3 meses', label: '1–3 meses', count: 0, percent: 0, description: 'Fase de adaptación' },
        { cohort: '3-6 meses', label: '3–6 meses', count: 0, percent: 0, description: 'Hábito consolidado' },
        { cohort: '6-12 meses', label: '6–12 meses', count: 0, percent: 0, description: 'Socios regulares' },
        { cohort: '+1 año', label: '+1 año', count: 0, percent: 0, description: 'Fidelizados / Veteranos' },
      ],
    };
  }

  let activeCount = 0;
  let expiringSoonCount = 0;
  let expiredCount = 0;
  let noMembershipCount = 0;
  let totalActiveRevenueMinor = 0;

  const planCounts: Record<string, { label: string; color: string; count: number }> = {};
  const tenureMonthsList: number[] = [];
  const tenureDaysList: number[] = [];

  const cohortBins = {
    under1m: 0,
    oneTo3m: 0,
    threeTo6m: 0,
    sixTo12m: 0,
    over12m: 0,
  };

  const refTime = new Date(referenceDate + 'T00:00:00Z').getTime();

  for (const member of members) {
    const statusInfo = memberStatus(member, referenceDate);
    const hasMembership = Boolean(member.membership);

    if (!hasMembership) {
      noMembershipCount++;
    } else if (statusInfo.status === 'active') {
      activeCount++;
      const endsOn = member.membership?.endsOn;
      if (endsOn) {
        const daysToExpiry = Math.round((new Date(endsOn + 'T00:00:00Z').getTime() - refTime) / (1000 * 60 * 60 * 24));
        if (daysToExpiry <= 7 || member.demoScenario === 'expiry-today') {
          expiringSoonCount++;
        }
      }
      const planName = member.membership?.planName ?? '';
      const monthlyVal = PLAN_MONTHLY_VALUES_MINOR[planName] ?? 50000;
      totalActiveRevenueMinor += monthlyVal;
    } else {
      expiredCount++;
    }

    // Categorization for donut chart:
    const category = classifyPlanCategory(
      statusInfo.status === 'active' ? member.membership?.planName : null
    );
    if (!planCounts[category.key]) {
      planCounts[category.key] = { label: category.label, color: category.color, count: 0 };
    }
    planCounts[category.key].count++;

    // Tenure computation:
    const regDate = member.joinedOn || member.membership?.startsOn || referenceDate;
    const days = calculateDaysDifference(referenceDate, regDate);
    const months = Number((days / 30.4375).toFixed(1));

    tenureDaysList.push(days);
    tenureMonthsList.push(months);

    if (months < 1) cohortBins.under1m++;
    else if (months < 3) cohortBins.oneTo3m++;
    else if (months < 6) cohortBins.threeTo6m++;
    else if (months < 12) cohortBins.sixTo12m++;
    else cohortBins.over12m++;
  }

  // Median & Average calculations
  tenureMonthsList.sort((a, b) => a - b);
  tenureDaysList.sort((a, b) => a - b);

  const len = tenureMonthsList.length;
  const medianMonths =
    len % 2 === 1
      ? tenureMonthsList[Math.floor(len / 2)]
      : Number(((tenureMonthsList[len / 2 - 1] + tenureMonthsList[len / 2]) / 2).toFixed(1));

  const medianDays =
    len % 2 === 1
      ? tenureDaysList[Math.floor(len / 2)]
      : Math.round((tenureDaysList[len / 2 - 1] + tenureDaysList[len / 2]) / 2);

  const sumMonths = tenureMonthsList.reduce((acc, val) => acc + val, 0);
  const averageMonths = Number((sumMonths / len).toFixed(1));
  const longestTenureMonths = tenureMonthsList[len - 1] ?? 0;

  const arpuMinor = activeCount > 0 ? Math.round(totalActiveRevenueMinor / activeCount) : 0;
  const activePercent = Math.round((activeCount / total) * 100);

  // Build sorted plan slices for Donut Chart
  const planSlices: PlanCategorySlice[] = Object.entries(planCounts)
    .map(([key, data]) => ({
      key,
      label: data.label,
      count: data.count,
      percent: Math.round((data.count / total) * 100),
      color: data.color,
    }))
    .sort((a, b) => b.count - a.count);

  const tenureCohorts: TenureCohort[] = [
    {
      cohort: '< 1 mes',
      label: '< 1 mes',
      count: cohortBins.under1m,
      percent: Math.round((cohortBins.under1m / total) * 100),
      description: 'Nuevos ingresos',
    },
    {
      cohort: '1-3 meses',
      label: '1–3 meses',
      count: cohortBins.oneTo3m,
      percent: Math.round((cohortBins.oneTo3m / total) * 100),
      description: 'Fase de adaptación',
    },
    {
      cohort: '3-6 meses',
      label: '3–6 meses',
      count: cohortBins.threeTo6m,
      percent: Math.round((cohortBins.threeTo6m / total) * 100),
      description: 'Hábito consolidado',
    },
    {
      cohort: '6-12 meses',
      label: '6–12 meses',
      count: cohortBins.sixTo12m,
      percent: Math.round((cohortBins.sixTo12m / total) * 100),
      description: 'Socios regulares',
    },
    {
      cohort: '+1 año',
      label: '+1 año',
      count: cohortBins.over12m,
      percent: Math.round((cohortBins.over12m / total) * 100),
      description: 'Fidelizados / Veteranos',
    },
  ];

  return {
    totalMembers: total,
    activeMembers: activeCount,
    activePercent,
    expiringSoonCount,
    expiredCount,
    noMembershipCount,
    tenure: {
      medianMonths,
      averageMonths,
      medianDays,
      longestTenureMonths,
    },
    arpuMinor,
    estimatedMonthlyRevenueMinor: totalActiveRevenueMinor,
    planSlices,
    tenureCohorts,
  };
}
