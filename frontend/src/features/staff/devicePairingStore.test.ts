import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generatePairingCode,
  getActivePairingCodeForStaff,
  getActiveDevicesForStaff,
  revokeDevice,
  verifyAndPairCode,
  getPairedSession,
  clearPairedSession,
  formatPairingCode,
  normalizePairingCode,
  buildWhatsAppShareUrl,
  resetDevicePairingStore,
} from './devicePairingStore';
import { resetStaff, getStaffList } from './staffStore';

describe('devicePairingStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStaff();
    resetDevicePairingStore();
  });

  it('formats and normalizes 6-digit codes correctly', () => {
    expect(formatPairingCode('849210')).toBe('849-210');
    expect(formatPairingCode('849-210')).toBe('849-210');
    expect(normalizePairingCode('849-210')).toBe('849210');
    expect(normalizePairingCode(' 849 210 ')).toBe('849210');
  });

  it('generates a 6-digit pairing code with 10-minute validity', () => {
    const code = generatePairingCode('staff-sheila');
    expect(code.staffId).toBe('staff-sheila');
    expect(code.rawCode).toMatch(/^\d{6}$/);
    expect(code.code).toMatch(/^\d{3}-\d{3}$/);
    expect(code.used).toBe(false);
    expect(code.expiresAt - code.createdAt).toBe(10 * 60 * 1000);

    const active = getActivePairingCodeForStaff('staff-sheila');
    expect(active?.rawCode).toBe(code.rawCode);
  });

  it('builds a valid WhatsApp share URL with message and link', () => {
    const url = buildWhatsAppShareUrl('849-210', 'Sheila', 'https://evogym.app');
    expect(url).toContain('https://wa.me/?text=');
    expect(url).toContain('849-210');
    expect(url).toContain('Sheila');
    expect(url).toContain('https%3A%2F%2Fevogym.app%2Fpair');
  });

  it('verifies code, creates active device and sets persistent session', () => {
    const code = generatePairingCode('staff-sheila');
    const result = verifyAndPairCode(code.code, 'iPhone 15 Pro');

    expect(result.success).toBe(true);
    expect(result.staff?.id).toBe('staff-sheila');
    expect(result.device?.deviceName).toBe('iPhone 15 Pro');
    expect(result.device?.status).toBe('active');

    // Code is now used and cannot be reused
    const secondTry = verifyAndPairCode(code.rawCode);
    expect(secondTry.success).toBe(false);
    expect(secondTry.error).toContain('ya ha sido utilizado');

    // Session is persisted
    const session = getPairedSession();
    expect(session?.staff.id).toBe('staff-sheila');
    expect(session?.device.id).toBe(result.device?.id);
  });

  it('rejects expired codes', () => {
    const code = generatePairingCode('staff-sheila');

    // Advance time past 10 minutes
    const futureTime = Date.now() + 11 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(futureTime);

    const result = verifyAndPairCode(code.rawCode);
    expect(result.success).toBe(false);
    expect(result.error).toContain('ha expirado');

    vi.restoreAllMocks();
  });

  it('lists active devices and allows revoking devices', () => {
    const devicesInitial = getActiveDevicesForStaff('staff-sheila');
    expect(devicesInitial.length).toBeGreaterThan(0);

    const deviceId = devicesInitial[0].id;
    revokeDevice(deviceId);

    const devicesAfter = getActiveDevicesForStaff('staff-sheila');
    expect(devicesAfter.some(d => d.id === deviceId)).toBe(false);
  });
});
