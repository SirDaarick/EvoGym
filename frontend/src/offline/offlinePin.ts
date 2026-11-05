/**
 * Offline staff PIN authentication with WebCrypto PBKDF2-SHA256 (T5.11).
 *
 * Rules:
 * - 24-hour grant TTL from last online authentication.
 * - Maximum 5 consecutive failed attempts before local lockout.
 * - Constant-time timing-safe hash comparison.
 */

import type { EvoGymLocalDB, OfflineCredentialRow } from './db';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const MAX_FAILED_ATTEMPTS = 5;

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derivePinHash(pin: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return toHex(derivedBits);
}

export async function registerOfflinePin(
  db: EvoGymLocalDB,
  staffId: string,
  pin: string,
  ttlHours = 24,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt, PBKDF2_ITERATIONS);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  const credential: OfflineCredentialRow = {
    staff_id: staffId,
    salt: toHex(salt.buffer),
    hash,
    iterations: PBKDF2_ITERATIONS,
    grantExpiresAt: expiresAt,
    failedAttempts: 0,
    lockedUntil: null,
  };

  await db.offline_credentials.put(credential);
}

export type VerifyPinResult =
  | { success: true }
  | { success: false; error: 'not_enrolled' | 'expired' | 'locked' | 'invalid_pin'; remainingAttempts?: number };

export async function verifyOfflinePin(
  db: EvoGymLocalDB,
  staffId: string,
  pin: string,
  now: Date = new Date(),
): Promise<VerifyPinResult> {
  const cred = await db.offline_credentials.get(staffId);
  if (!cred) {
    return { success: false, error: 'not_enrolled' };
  }

  // 1. Check lockout
  if (cred.lockedUntil && new Date(cred.lockedUntil) > now) {
    return { success: false, error: 'locked', remainingAttempts: 0 };
  }

  // 2. Check grant TTL
  if (new Date(cred.grantExpiresAt) < now) {
    return { success: false, error: 'expired' };
  }

  // 3. Compute hash and compare timing-safely
  const salt = fromHex(cred.salt);
  const candidateHash = await derivePinHash(pin, salt, cred.iterations);

  const isMatch = timingSafeEqual(
    fromHex(candidateHash),
    fromHex(cred.hash),
  );

  if (isMatch) {
    // Reset failed attempts
    if (cred.failedAttempts > 0 || cred.lockedUntil !== null) {
      cred.failedAttempts = 0;
      cred.lockedUntil = null;
      await db.offline_credentials.put(cred);
    }
    return { success: true };
  }

  // Failed attempt
  const failed = (cred.failedAttempts || 0) + 1;
  const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - failed);
  cred.failedAttempts = failed;

  if (failed >= MAX_FAILED_ATTEMPTS) {
    // Lock out permanently until online re-authentication
    cred.lockedUntil = new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString();
    await db.offline_credentials.put(cred);
    return { success: false, error: 'locked', remainingAttempts: 0 };
  }

  await db.offline_credentials.put(cred);
  return { success: false, error: 'invalid_pin', remainingAttempts: remaining };
}
