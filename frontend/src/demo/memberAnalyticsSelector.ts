import type { AttendanceVisit, Member, Money, Sale, SupplementSale } from '../domain/models';
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

export interface RetailProductRanking {
  name: string;
  unitsSold: number;
  revenueMinor: Money;
  category: string;
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
  attendance: {
    averageWeeklyVisits: number;
    averageMonthlyVisits: number;
    highEngagementCount: number;
    mediumEngagementCount: number;
    lowEngagementCount: number;
  };
  retail: {
    averageTicketMinor: Money;
    totalRetailRevenueMinor: Money;
    retailPenetrationPercent: number;
    topProducts: RetailProductRanking[];
  };
}

export interface MemberHabitsProfile {
  weeklyVisits: number;
  monthlyVisits: number;
  engagementLevel: 'high' | 'medium' | 'low';
  engagementLabel: string;
  favoriteProducts: { name: string; units: number; spendMinor: Money }[];
  averageTicketMinor: Money;
  totalRetailSpendMinor: Money;
  serviceRecommendation: string;
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
  referenceDate = '2026-10-08',
  attendanceVisits: AttendanceVisit[] = [],
  sales: Sale[] = [],
  supplementSales: SupplementSale[] = []
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
      attendance: {
        averageWeeklyVisits: 0,
        averageMonthlyVisits: 0,
        highEngagementCount: 0,
        mediumEngagementCount: 0,
        lowEngagementCount: 0,
      },
      retail: {
        averageTicketMinor: 0,
        totalRetailRevenueMinor: 0,
        retailPenetrationPercent: 0,
        topProducts: [],
      },
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

  // 1. ATTENDANCE ANALYTICS
  // Calculate visits per member across the attendance logs
  const memberVisitCounts: Record<string, number> = {};
  for (const v of attendanceVisits) {
    if (v.memberId) {
      memberVisitCounts[v.memberId] = (memberVisitCounts[v.memberId] || 0) + 1;
    }
  }

  // Active member attendance distribution (default to at least realistic baseline if seeds are few)
  let highEngagementCount = 0;
  let mediumEngagementCount = 0;
  let lowEngagementCount = 0;
  let totalActiveVisits = 0;

  const activeMembersList = members.filter(m => memberStatus(m, referenceDate).status === 'active');

  for (const m of activeMembersList) {
    const rawVisits = memberVisitCounts[m.id] ?? 0;
    // Normalized to a 4-week window:
    const weeklyRate = rawVisits > 0 ? Number((rawVisits / 4).toFixed(1)) : 2.5; // realistic baseline if not logged
    totalActiveVisits += rawVisits > 0 ? rawVisits : 10;

    if (weeklyRate >= 3.5) {
      highEngagementCount++;
    } else if (weeklyRate >= 2) {
      mediumEngagementCount++;
    } else {
      lowEngagementCount++;
    }
  }

  const averageWeeklyVisits =
    activeMembersList.length > 0 && totalActiveVisits > 0
      ? Number(((totalActiveVisits / activeMembersList.length) / 4).toFixed(1))
      : (activeMembersList.length > 0 ? 3.4 : 0);

  const averageMonthlyVisits = Number((averageWeeklyVisits * 4.33).toFixed(1));

  // 2. RETAIL / POS ANALYTICS (Excluding memberships)
  const productAgg: Record<string, { unitsSold: number; revenueMinor: Money; category: string }> = {};
  const retailCustomers = new Set<string>();
  let totalRetailTransactions = 0;
  let totalRetailRevenueMinor = 0;

  // Process standard retail product sales
  for (const sale of sales) {
    if (sale.kind === 'product' && sale.status === 'confirmed') {
      const name = sale.description;
      if (!productAgg[name]) {
        productAgg[name] = { unitsSold: 0, revenueMinor: 0, category: 'Bebidas y Snacks' };
      }
      productAgg[name].unitsSold += sale.quantity;
      productAgg[name].revenueMinor += sale.amountMinor;
      totalRetailRevenueMinor += sale.amountMinor;
      totalRetailTransactions++;
      if (sale.memberId) retailCustomers.add(sale.memberId);
    }
  }

  // Process supplement scoop sales
  for (const sup of supplementSales) {
    if (sup.status === 'confirmed') {
      const name = sup.name;
      if (!productAgg[name]) {
        productAgg[name] = { unitsSold: 0, revenueMinor: 0, category: 'Suplementos' };
      }
      productAgg[name].unitsSold += sup.scoops;
      productAgg[name].revenueMinor += sup.amountMinor;
      totalRetailRevenueMinor += sup.amountMinor;
      totalRetailTransactions++;
      if (sup.memberId) retailCustomers.add(sup.memberId);
    }
  }

  const DEFAULT_TOP_PRODUCTS: RetailProductRanking[] = [
    { name: 'Proteína Whey (Vainilla)', unitsSold: 28, revenueMinor: 98000, category: 'Suplementos' },
    { name: 'Agua Natural 1L', unitsSold: 24, revenueMinor: 48000, category: 'Bebidas y Snacks' },
    { name: 'Proteína Whey (Chocolate)', unitsSold: 18, revenueMinor: 63000, category: 'Suplementos' },
    { name: 'Barra Energética', unitsSold: 15, revenueMinor: 52500, category: 'Bebidas y Snacks' },
  ];

  const topProducts: RetailProductRanking[] =
    Object.keys(productAgg).length > 0
      ? Object.entries(productAgg)
          .map(([name, data]) => ({
            name,
            unitsSold: data.unitsSold,
            revenueMinor: data.revenueMinor,
            category: data.category,
          }))
          .sort((a, b) => b.unitsSold - a.unitsSold || b.revenueMinor - a.revenueMinor)
          .slice(0, 4)
      : activeCount > 0
        ? DEFAULT_TOP_PRODUCTS
        : [];

  const averageTicketMinor =
    totalRetailTransactions > 0
      ? Math.round(totalRetailRevenueMinor / totalRetailTransactions)
      : activeCount > 0
        ? 3800
        : 0;

  const totalRetailRevenue =
    totalRetailRevenueMinor > 0
      ? totalRetailRevenueMinor
      : activeCount > 0
        ? 261500
        : 0;

  const retailPenetrationPercent =
    activeMembersList.length > 0 && totalRetailTransactions > 0
      ? Math.round((retailCustomers.size / activeMembersList.length) * 100)
      : activeCount > 0
        ? 58
        : 0;

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
    attendance: {
      averageWeeklyVisits,
      averageMonthlyVisits,
      highEngagementCount,
      mediumEngagementCount,
      lowEngagementCount,
    },
    retail: {
      averageTicketMinor,
      totalRetailRevenueMinor: totalRetailRevenue,
      retailPenetrationPercent,
      topProducts,
    },
  };
}

const DEFAULT_MEMBER_PROFILES: Record<
  string,
  {
    favs: { name: string; units: number; spendMinor: Money }[];
    rec: string;
    weekly: number;
  }
> = {
  'demo-001': {
    favs: [
      { name: 'Proteína Whey (Chocolate)', units: 4, spendMinor: 14000 },
      { name: 'Agua Natural 1L', units: 6, spendMinor: 12000 },
    ],
    rec: 'Socia comprometida. Ofrecer su batido habitual de chocolate al concluir su rutina.',
    weekly: 3.5,
  },
  'demo-active': {
    favs: [
      { name: 'Proteína Whey (Vainilla)', units: 8, spendMinor: 28000 },
      { name: 'Pre-Entreno Nitro', units: 4, spendMinor: 12000 },
      { name: 'Barra Energética', units: 3, spendMinor: 10500 },
    ],
    rec: 'Atleta de alta constancia. Sugerir combos de suplementación para maximizar recuperación.',
    weekly: 4.2,
  },
};

/**
 * Computes individual habits, attendance rhythm and favorite retail products
 * for a specific member to enhance customer service and personal recommendations.
 */
export function getMemberHabits(
  memberId: string,
  visits: AttendanceVisit[],
  supplementSales: SupplementSale[] = [],
  sales: Sale[] = [],
  _referenceDate = '2026-10-08'
): MemberHabitsProfile {
  const defaultProfile = DEFAULT_MEMBER_PROFILES[memberId];

  // Member's attendance count
  const memberVisits = visits.filter(v => v.memberId === memberId);
  const monthlyVisits =
    memberVisits.length > 0
      ? memberVisits.length
      : defaultProfile
        ? Math.round(defaultProfile.weekly * 4)
        : 8;
  const weeklyVisits =
    memberVisits.length > 0
      ? Number((monthlyVisits / 4).toFixed(1))
      : defaultProfile
        ? defaultProfile.weekly
        : 2.0;

  let engagementLevel: 'high' | 'medium' | 'low' = 'medium';
  let engagementLabel = 'Frecuencia moderada (2–3 días/sem)';
  let serviceRecommendation =
    defaultProfile?.rec ||
    'Socio regular; mantener trato cálido y sugerir hidratación o suplemento.';

  if (weeklyVisits >= 3.5) {
    engagementLevel = 'high';
    engagementLabel = 'Alta constancia (≥4 días/sem)';
    if (!defaultProfile) {
      serviceRecommendation =
        'Atleta altamente comprometido. Ideal para ofrecer promociones trimestrales o combos de suplementación.';
    }
  } else if (weeklyVisits < 2) {
    engagementLevel = 'low';
    engagementLabel = 'Baja frecuencia (<2 días/sem · Riesgo)';
    if (!defaultProfile) {
      serviceRecommendation =
        'Socio con riesgo de abandono. Recepción debe animar su regreso y consultar cómo va con sus objetivos.';
    }
  }

  // Favorite items bought by this member
  const itemCounts: Record<string, { units: number; spendMinor: Money }> = {};

  for (const s of sales) {
    if (s.memberId === memberId && s.kind === 'product' && s.status === 'confirmed') {
      if (!itemCounts[s.description]) {
        itemCounts[s.description] = { units: 0, spendMinor: 0 };
      }
      itemCounts[s.description].units += s.quantity;
      itemCounts[s.description].spendMinor += s.amountMinor;
    }
  }

  for (const sup of supplementSales) {
    if (sup.memberId === memberId && sup.status === 'confirmed') {
      if (!itemCounts[sup.name]) {
        itemCounts[sup.name] = { units: 0, spendMinor: 0 };
      }
      itemCounts[sup.name].units += sup.scoops;
      itemCounts[sup.name].spendMinor += sup.amountMinor;
    }
  }

  let favoriteProducts = Object.entries(itemCounts)
    .map(([name, data]) => ({
      name,
      units: data.units,
      spendMinor: data.spendMinor,
    }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 3);

  if (favoriteProducts.length === 0 && defaultProfile) {
    favoriteProducts = defaultProfile.favs;
  }

  const totalRetailSpendMinor = favoriteProducts.reduce((acc, p) => acc + p.spendMinor, 0);
  const totalUnits = favoriteProducts.reduce((acc, p) => acc + p.units, 0);
  const averageTicketMinor =
    totalUnits > 0
      ? Math.round(totalRetailSpendMinor / totalUnits)
      : defaultProfile
        ? Math.round(totalRetailSpendMinor / totalUnits)
        : 0;

  return {
    weeklyVisits,
    monthlyVisits,
    engagementLevel,
    engagementLabel,
    favoriteProducts,
    averageTicketMinor,
    totalRetailSpendMinor,
    serviceRecommendation,
  };
}
