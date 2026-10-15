import { describe, expect, it } from 'vitest';
import type { Member } from '../domain/models';
import {
  classifyPlanCategory,
  getMemberAnalytics,
} from './memberAnalyticsSelector';

describe('memberAnalyticsSelector', () => {
  it('handles empty members array gracefully without NaN or errors', () => {
    const result = getMemberAnalytics([]);
    expect(result.totalMembers).toBe(0);
    expect(result.activeMembers).toBe(0);
    expect(result.activePercent).toBe(0);
    expect(result.tenure.medianMonths).toBe(0);
    expect(result.tenure.averageMonths).toBe(0);
    expect(result.arpuMinor).toBe(0);
    expect(result.planSlices).toEqual([]);
    expect(result.tenureCohorts).toHaveLength(5);
  });

  it('correctly classifies plan categories', () => {
    expect(classifyPlanCategory('Gym mensual').key).toBe('gym');
    expect(classifyPlanCategory('Box mensual').key).toBe('box');
    expect(classifyPlanCategory('Gym + Box mensual').key).toBe('combo');
    expect(classifyPlanCategory('Gym estudiante').key).toBe('student');
    expect(classifyPlanCategory('Box estudiante').key).toBe('student');
    expect(classifyPlanCategory(null).key).toBe('none');
  });

  it('computes accurate active members, median tenure, and ARPU', () => {
    const mockMembers: Member[] = [
      {
        id: 'm1',
        name: 'Member 1',
        phone: '111',
        creditMinor: 0,
        joinedOn: '2025-10-08', // 12 months ago
        membership: { planName: 'Gym mensual', startsOn: '2026-10-01', endsOn: '2026-10-31' },
      },
      {
        id: 'm2',
        name: 'Member 2',
        phone: '222',
        creditMinor: 0,
        joinedOn: '2026-06-08', // 4 months ago
        membership: { planName: 'Box mensual', startsOn: '2026-10-01', endsOn: '2026-10-31' },
      },
      {
        id: 'm3',
        name: 'Member 3',
        phone: '333',
        creditMinor: 0,
        joinedOn: '2026-08-08', // 2 months ago
        membership: { planName: 'Gym + Box mensual', startsOn: '2026-10-01', endsOn: '2026-10-31' },
      },
      {
        id: 'm4',
        name: 'Member 4',
        phone: '444',
        creditMinor: 0,
        joinedOn: '2026-09-08', // 1 month ago
        membership: null,
      },
      {
        id: 'm5',
        name: 'Member 5',
        phone: '555',
        creditMinor: 0,
        joinedOn: '2026-04-08', // 6 months ago
        membership: { planName: 'Gym estudiante', startsOn: '2026-09-01', endsOn: '2026-09-30' }, // Expired
      },
    ];

    const analytics = getMemberAnalytics(mockMembers, '2026-10-08');

    expect(analytics.totalMembers).toBe(5);
    expect(analytics.activeMembers).toBe(3); // m1, m2, m3
    expect(analytics.expiredCount).toBe(1); // m5
    expect(analytics.noMembershipCount).toBe(1); // m4
    expect(analytics.activePercent).toBe(60);

    // Tenure sorted in months: [1.0, 2.0, 4.0, 6.0, 12.0]
    // Median of 5 items is index 2 = 4.0 months
    expect(analytics.tenure.medianMonths).toBe(4);
    expect(analytics.tenure.longestTenureMonths).toBe(12);

    // Active plans: Gym (500), Box (500), Combo (750) = 1,750 MXN (175,000 centavos)
    // ARPU = 175,000 / 3 = 58,333 centavos (~$583.33 MXN)
    expect(analytics.estimatedMonthlyRevenueMinor).toBe(175000);
    expect(analytics.arpuMinor).toBe(58333);

    // Slices
    expect(analytics.planSlices.length).toBeGreaterThanOrEqual(3);
    const gymSlice = analytics.planSlices.find(s => s.key === 'gym');
    expect(gymSlice).toBeDefined();
    expect(gymSlice?.count).toBe(1);

    // Cohorts
    const under1m = analytics.tenureCohorts.find(c => c.cohort === '< 1 mes');
    expect(under1m).toBeDefined();
  });

  it('calculates even median correctly', () => {
    const mockEvenMembers: Member[] = [
      {
        id: 'e1',
        name: 'A',
        phone: '',
        creditMinor: 0,
        joinedOn: '2026-08-08', // 2 months
        membership: null,
      },
      {
        id: 'e2',
        name: 'B',
        phone: '',
        creditMinor: 0,
        joinedOn: '2026-04-08', // 6 months
        membership: null,
      },
    ];
    const analytics = getMemberAnalytics(mockEvenMembers, '2026-10-08');
    // Median between 2.0 and 6.0 is 4.0
    expect(analytics.tenure.medianMonths).toBe(4);
  });
});
