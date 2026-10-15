import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { memberStatus, memberSearchGroups } from './memberStatus';

describe('demo membership classification', () => {
  it('keeps legacy illustrative dates and absent dates unknown', () => {
    const members = createDemoState().members;
    expect(memberStatus(members[0]).status).toBe('unknown');
    expect(memberStatus(members[1]).status).toBe('unknown');
  });
  it('recognizes only explicit illustrative scenarios and marks expiry-day provisional', () => {
    const members = createDemoState().members;
    expect(memberStatus(members.find(member => member.demoScenario === 'active')!).status).toBe('active');
    expect(memberStatus(members.find(member => member.demoScenario === 'expired')!).status).toBe('expired');
    expect(memberStatus(members.find(member => member.demoScenario === 'expiry-today')!)).toMatchObject({ status: 'active', provisional: true });
    expect(memberStatus(members.find(member => member.demoScenario === 'unknown')!).status).toBe('unknown');
  });
  it('groups active first, expired second, inactive third and unknown separately with trimmed filtering', () => {
    const groups = memberSearchGroups(createDemoState().members, ' demo ');
    expect(groups.map(group => group.status)).toEqual(['active', 'expired', 'inactive', 'unknown']);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[1].members).toHaveLength(1);
    expect(memberSearchGroups(createDemoState().members, 'zzz').flatMap(group => group.members)).toHaveLength(0);
    expect(memberSearchGroups(createDemoState().members, '  ').flatMap(group => group.members)).toHaveLength(0);
    expect(memberSearchGroups(createDemoState().members, '', undefined, true).flatMap(group => group.members)).toHaveLength(createDemoState().members.length);
  });
  it('evaluates status by referenceDate when provided', () => {
    const members = createDemoState().members;
    const mariana = members[0]; // endsOn: '2026-10-17'
    expect(memberStatus(mariana, '2026-10-10').status).toBe('active');
    expect(memberStatus(mariana, '2026-10-25').status).toBe('expired');
    expect(memberStatus(mariana, '2026-12-01').status).toBe('inactive');
  });
});
