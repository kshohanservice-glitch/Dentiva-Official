import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing — scrypt (memory-hard KDF, RFC 7914 / NIST SP 800-132).
 * Chosen over Argon2/bcrypt because it needs no native dependency, so the
 * Windows installer stays a single self-contained artefact.
 *
 * Format: scrypt$N$r$p$<salt-b64>$<key-b64>
 */
const N = 32768; // 2^15 — ~32 MB working set
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAXMEM = 128 * N * R * 2;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4] as string, 'base64');
    const expected = Buffer.from(parts[5] as string, 'base64');
    // The cost parameters come out of the database and are therefore untrusted
    // input. Without these bounds a hand-edited hash could request a trivial
    // work factor and turn verification into a cheap oracle.
    if (!Number.isInteger(n) || n < 2 || n > 1 << 20) return false;
    if (!Number.isInteger(r) || r < 1 || r > 32) return false;
    if (!Number.isInteger(p) || p < 1 || p > 16) return false;
    if (salt.length < 8 || expected.length < 16 || expected.length > 128) return false;
    const actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  // A cost weaker than the current default must be replaced, not trusted. A
  // stronger one is kept, so raising the default later does not weaken anyone.
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || n < N) return true;
  if (!Number.isInteger(r) || r < R) return true;
  if (!Number.isInteger(p) || p < P) return true;
  return false;
}

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUpper: false,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
};

export function checkPasswordPolicy(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
  context: { username?: string; previousHashes?: string[] } = {},
): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength) problems.push(`Password must be at least ${policy.minLength} characters long.`);
  if (password.length > 256) problems.push('Password must be at most 256 characters long.');
  if (policy.requireLower && !/[a-z]/.test(password)) problems.push('Password must include a lowercase letter.');
  if (policy.requireUpper && !/[A-Z]/.test(password)) problems.push('Password must include an uppercase letter.');
  if (policy.requireDigit && !/[0-9]/.test(password)) problems.push('Password must include a digit.');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) problems.push('Password must include a symbol.');
  if (context.username && password.toLowerCase() === context.username.toLowerCase()) {
    problems.push('Password must not be the same as the username.');
  }
  for (const prev of context.previousHashes ?? []) {
    if (verifyPassword(password, prev)) {
      problems.push('Password must not be one of your last 5 passwords.');
      break;
    }
  }
  return problems;
}
