import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { assignLocker, calculateNextMonthExpiry, evictLocker, releaseLocker, updateLockerStatus } from './lockerOperations';

describe('lockerOperations', () => {
  it('calculates calendar month expiry with day clamping', () => {
    // 31 Jan -> 28 Feb (or 29 Feb in leap year)
    const jan31 = new Date(2026, 0, 31, 10, 0, 0);
    const expiry = calculateNextMonthExpiry(jan31);
    const expiryDate = new Date(expiry);
    expect(expiryDate.getMonth()).toBe(1); // February
    expect(expiryDate.getDate()).toBe(28); // 2026 is not a leap year

    // 15 March -> 15 April
    const mar15 = new Date(2026, 2, 15, 12, 0, 0);
    const expiryMar = calculateNextMonthExpiry(mar15);
    const expiryMarDate = new Date(expiryMar);
    expect(expiryMarDate.getMonth()).toBe(3); // April
    expect(expiryMarDate.getDate()).toBe(15);
  });

  it('assigns an available locker and records rental with cash ledger event', () => {
    const state = createDemoState();
    const result = assignLocker(state, {
      id: 'rent-locker-04',
      lockerId: 'locker-04',
      memberId: 'demo-001',
      method: 'cash',
    });

    expect(result.result.status).toBe('paid');
    if (result.result.status === 'paid') {
      expect(result.result.locker.status).toBe('assigned');
      expect(result.result.locker.assignedMemberId).toBe('demo-001');
      expect(result.result.locker.assignedMemberName).toBe('Mariana López');
      expect(result.result.rental.priceMinor).toBe(15000);
    }

    const ledger = result.state.ledger.find(l => l.paymentId === 'rent-locker-04');
    expect(ledger).toBeDefined();
    expect(ledger?.amountMinor).toBe(15000);
  });

  it('releases an assigned locker', () => {
    const state = createDemoState();
    // locker-03 is assigned to Carlos Rivera in seed
    const result = releaseLocker(state, 'locker-03');
    expect(result.result.status).toBe('released');
    if (result.result.status === 'released') {
      expect(result.result.locker.status).toBe('available');
      expect(result.result.locker.assignedMemberId).toBeNull();
      expect(result.result.rental?.releasedAt).toBeTruthy();
    }
  });

  it('evicts a locker', () => {
    const state = createDemoState();
    const result = evictLocker(state, 'locker-03');
    expect(result.result.status).toBe('evicted');
    if (result.result.status === 'evicted') {
      expect(result.result.locker.status).toBe('evicted');
      expect(result.result.locker.assignedMemberName).toContain('Desalojado');
    }
  });

  it('updates locker status directly', () => {
    const state = createDemoState();
    const result = updateLockerStatus(state, 'locker-04', 'out_of_service');
    expect(result.result.status).toBe('updated');
    if (result.result.status === 'updated') {
      expect(result.result.locker.status).toBe('out_of_service');
    }
  });
});
