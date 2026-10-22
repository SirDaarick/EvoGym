import { useEffect, useState } from 'react';
import type { StaffProfile } from './staffStore';
import { getStaffList, setSelectedStaff } from './staffStore';

export interface PairedDevice {
  id: string;
  staffId: string;
  deviceName: string;
  pairedAt: string;
  lastUsedAt?: string;
  status: 'active' | 'revoked';
}

export interface PairingCode {
  code: string; // Formatted "849-210"
  rawCode: string; // "849210"
  staffId: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

const STORAGE_KEY_CODES = 'evogym:pairing_codes';
const STORAGE_KEY_DEVICES = 'evogym:paired_devices';
const STORAGE_KEY_SESSION = 'evogym:paired_session';

const CODE_VALIDITY_MS = 10 * 60 * 1000; // 10 minutes

// In-memory fallback
let memoryCodes: PairingCode[] = [];
let memoryDevices: PairedDevice[] = [
  {
    id: 'device-demo-1',
    staffId: 'staff-sheila',
    deviceName: 'iPhone 14 · Safari',
    pairedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    lastUsedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    status: 'active',
  },
];

const deviceListeners = new Set<() => void>();
const codeListeners = new Set<() => void>();

function notifyDevices() {
  deviceListeners.forEach(fn => fn());
}

function notifyCodes() {
  codeListeners.forEach(fn => fn());
}

function loadCodes(): PairingCode[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryCodes;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CODES);
    if (!raw) return memoryCodes;
    return JSON.parse(raw) as PairingCode[];
  } catch {
    return memoryCodes;
  }
}

function saveCodes(codes: PairingCode[]): void {
  memoryCodes = codes;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY_CODES, JSON.stringify(codes));
    } catch {
      // ignore
    }
  }
  notifyCodes();
}

function loadDevices(): PairedDevice[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryDevices;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_DEVICES);
    if (!raw) return memoryDevices;
    return JSON.parse(raw) as PairedDevice[];
  } catch {
    return memoryDevices;
  }
}

function saveDevices(devices: PairedDevice[]): void {
  memoryDevices = devices;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY_DEVICES, JSON.stringify(devices));
    } catch {
      // ignore
    }
  }
  notifyDevices();
}

/**
 * Format a 6-digit number into XXX-XXX
 */
export function formatPairingCode(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

/**
 * Strips non-digits
 */
export function normalizePairingCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6);
}

/**
 * Generates a random 6-digit code with 10-minute expiry
 */
export function generatePairingCode(staffId: string): PairingCode {
  const num = Math.floor(100000 + Math.random() * 900000);
  const rawCode = num.toString();
  const code = `${rawCode.slice(0, 3)}-${rawCode.slice(3)}`;
  const now = Date.now();

  const newEntry: PairingCode = {
    code,
    rawCode,
    staffId,
    createdAt: now,
    expiresAt: now + CODE_VALIDITY_MS,
    used: false,
  };

  const current = loadCodes().filter(c => c.staffId !== staffId || c.used);
  current.push(newEntry);
  saveCodes(current);

  return newEntry;
}

/**
 * Returns active pairing code for employee if still valid and unused
 */
export function getActivePairingCodeForStaff(staffId: string): PairingCode | null {
  const now = Date.now();
  const codes = loadCodes();
  const active = codes.find(c => c.staffId === staffId && !c.used && c.expiresAt > now);
  return active ?? null;
}

/**
 * Returns active devices for an employee
 */
export function getActiveDevicesForStaff(staffId: string): PairedDevice[] {
  const devices = loadDevices();
  return devices.filter(d => d.staffId === staffId && d.status === 'active');
}

/**
 * Revokes a device
 */
export function revokeDevice(deviceId: string): void {
  const devices = loadDevices().map(d => {
    if (d.id === deviceId) {
      return { ...d, status: 'revoked' as const };
    }
    return d;
  });
  saveDevices(devices);

  // If current session belongs to this device, clear it
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const session = window.localStorage.getItem(STORAGE_KEY_SESSION);
      if (session) {
        const parsed = JSON.parse(session);
        if (parsed.deviceId === deviceId) {
          window.localStorage.removeItem(STORAGE_KEY_SESSION);
        }
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Verifies 6-digit code and creates active paired device session
 */
export function verifyAndPairCode(
  rawInput: string,
  customDeviceName?: string
): { success: boolean; staff?: StaffProfile; device?: PairedDevice; error?: string } {
  const normalized = normalizePairingCode(rawInput);
  if (normalized.length !== 6) {
    return { success: false, error: 'Ingresa los 6 dígitos del código de vinculación.' };
  }

  const now = Date.now();
  const codes = loadCodes();
  const matchIndex = codes.findIndex(c => c.rawCode === normalized);

  if (matchIndex === -1) {
    return { success: false, error: 'Código inválido o no reconocido.' };
  }

  const entry = codes[matchIndex];
  if (entry.used) {
    return { success: false, error: 'Este código ya ha sido utilizado.' };
  }

  if (now > entry.expiresAt) {
    return {
      success: false,
      error: 'El código ha expirado (límite de 10 minutos). Solicita uno nuevo a tu administrador.',
    };
  }

  const staff = getStaffList().find(s => s.id === entry.staffId);
  if (!staff) {
    return { success: false, error: 'Empleado no encontrado en el sistema.' };
  }

  // Mark code used
  codes[matchIndex] = { ...entry, used: true };
  saveCodes(codes);

  // Detect device name
  let inferredDevice = customDeviceName;
  if (!inferredDevice && typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) inferredDevice = 'iPhone · Móvil';
    else if (/iPad/i.test(ua)) inferredDevice = 'iPad · Tablet';
    else if (/Android/i.test(ua)) inferredDevice = 'Android · Móvil';
    else inferredDevice = 'Dispositivo Móvil';
  } else if (!inferredDevice) {
    inferredDevice = 'Dispositivo Móvil';
  }

  const newDevice: PairedDevice = {
    id: `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    staffId: staff.id,
    deviceName: inferredDevice,
    pairedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    status: 'active',
  };

  const devices = loadDevices();
  devices.push(newDevice);
  saveDevices(devices);

  // Set persistent session
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(
        STORAGE_KEY_SESSION,
        JSON.stringify({
          staffId: staff.id,
          deviceId: newDevice.id,
          pairedAt: newDevice.pairedAt,
        })
      );
    } catch {
      // ignore
    }
  }

  // Activate staff in session
  setSelectedStaff({ id: staff.id, name: staff.name });

  return { success: true, staff, device: newDevice };
}

/**
 * Returns current paired device session if still valid and not revoked
 */
export function getPairedSession(): { staff: StaffProfile; device: PairedDevice } | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const devices = loadDevices();
    const dev = devices.find(d => d.id === parsed.deviceId && d.status === 'active');
    if (!dev) {
      window.localStorage.removeItem(STORAGE_KEY_SESSION);
      return null;
    }
    const staff = getStaffList().find(s => s.id === parsed.staffId && s.active);
    if (!staff) {
      window.localStorage.removeItem(STORAGE_KEY_SESSION);
      return null;
    }
    return { staff, device: dev };
  } catch {
    return null;
  }
}

export function clearPairedSession(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY_SESSION);
    } catch {
      // ignore
    }
  }
}

/**
 * WhatsApp share URL builder
 */
export function buildWhatsAppShareUrl(
  code: string,
  staffName: string,
  originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://evogym.app'
): string {
  const pairUrl = `${originUrl}/pair`;
  const message = `Hola ${staffName}, tu código de acceso a EvoGym es: ${code}.\n\nIngresa desde tu teléfono aquí:\n${pairUrl}\n\n(Válido por 10 minutos).`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * React hook for employee devices
 */
export function useActiveDevices(staffId: string) {
  const [devices, setDevices] = useState(() => getActiveDevicesForStaff(staffId));

  useEffect(() => {
    function update() {
      setDevices(getActiveDevicesForStaff(staffId));
    }
    deviceListeners.add(update);
    return () => {
      deviceListeners.delete(update);
    };
  }, [staffId]);

  return devices;
}

/**
 * Reset test helper
 */
export function resetDevicePairingStore() {
  memoryCodes = [];
  memoryDevices = [
    {
      id: 'device-demo-1',
      staffId: 'staff-sheila',
      deviceName: 'iPhone 14 · Safari',
      pairedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      lastUsedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      status: 'active',
    },
  ];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY_CODES);
      window.localStorage.removeItem(STORAGE_KEY_DEVICES);
      window.localStorage.removeItem(STORAGE_KEY_SESSION);
    } catch {
      // ignore
    }
  }
  notifyDevices();
  notifyCodes();
}
