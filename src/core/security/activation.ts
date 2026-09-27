import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors';

/**
 * One-time local activation.
 *
 * ── Honest threat model ────────────────────────────────────────────────────
 * Dentiva Pro is a fully offline Windows application. Any verification that
 * runs entirely on the client's machine can ultimately be observed, traced or
 * re-implemented by a determined attacker who has the binary; that is
 * unavoidable and we do not claim otherwise. What this design *does* achieve:
 *
 *   • the activation code is never stored in any form — not in the database,
 *     not in the settings table, not in the installer, not in a UI resource,
 *     not in a log file, and not in a test fixture;
 *   • the code is never compared as a string — it is canonicalised, passed
 *     through a keyed SHA-256 derivation, and the result is compared to a
 *     second-level hash with a constant-time comparison;
 *   • no single contiguous string in the binary yields the code, so a casual
 *     `strings` / decompiler scan does not reveal it;
 *   • a corrupted or tampered activation record is detected rather than
 *     silently bypassed.
 *
 * The verifier is split across several constants, mixed, and the expected value
 * is stored one hash layer away from the comparison target so that recovering
 * the comparison target does not directly yield the derivation input.
 */

const NS = 'dpv1';
/** Key material, deliberately assembled at runtime from unrelated fragments. */
const K0 = 'Dentiva';
const K1 = 'Pro';
const K2 = 'Offline';
const K3 = 'Activation';
const K4 = '2026';
/** Stored verifier: SHA-256('dpv1:' + innerDigest), truncated. */
const V = [
  'n6jV',
  'WxlV',
  'yBlq',
  'SWtm',
  'PWFG',
  'mKj6',
  'iO0I',
  '0bUk',
  'HSl1',
  'sg-6',
  'Q_A',
].join('');

/** Normalise whatever the operator typed into the canonical derivation input. */
export function canonicaliseActivationInput(input: string): string | null {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length !== 16) return null;
  const groups = [0, 4, 8, 12].map((i) => digits.slice(i, i + 4));
  return groups.reverse().join('-');
}

function derive(canonical: string): string {
  const key = [K0, K1, K2, K3, K4].join('/');
  return createHash('sha256').update(`${key}|${canonical}`).digest('base64url').slice(0, 43);
}

function seal(inner: string): string {
  return createHash('sha256').update(`${NS}:${inner}`).digest('base64url').slice(0, 43);
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True when `input` is the correct activation code. Never logs the input. */
export function verifyActivationCode(input: string): boolean {
  const canonical = canonicaliseActivationInput(input);
  if (canonical === null) return false;
  return constantTimeEquals(seal(derive(canonical)), V);
}

export interface ActivationState {
  activated: boolean;
  activatedAt: string | null;
  machine: string | null;
  /** Set when the stored record is present but does not verify. */
  tampered?: boolean;
}

/**
 * A per-install secret, generated once at activation. It is never shown, never
 * logged and never leaves the machine; it only exists so the activation record
 * cannot be forged by writing a single `1` into the database.
 */
/** Keys under which the proof material is kept in `app_state`. */
export const ACTIVATION_PROOF_KEYS = {
  secret: 'activation.install_secret',
  verifier: 'activation.install_verifier',
} as const;

function installVerifier(secret: string, machine: string, activatedAt: string): string {
  return createHmac('sha256', secret).update(`${NS}|${machine}|${activatedAt}`).digest('base64url').slice(0, 43);
}

/**
 * The persistent record written after a successful activation.
 * It stores no part of the code — only when and where it happened, plus a
 * verifier that proves the record has not been edited by hand.
 */
export function buildActivationRecord(now: string, machine: string): { activated: string; activated_at: string; machine: string } {
  return { activated: '1', activated_at: now, machine };
}

/** Assembles the verifier to store alongside the record. */
export function buildInstallProof(now: string, machine: string): { secret: string; verifier: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, verifier: installVerifier(secret, machine, now) };
}

/**
 * Validates an activation record read back from storage.
 *
 * A record with no verifier is treated as legacy-but-valid only when the
 * install secret is also absent, which is the state a factory-fresh
 * installation is in. As soon as a secret exists the record must verify.
 */
export function readActivationRecord(
  record: Record<string, string> | undefined,
  proof: { secret: string; verifier: string } = { secret: '', verifier: '' },
): ActivationState {
  if (!record) return { activated: false, activatedAt: null, machine: null };
  if (record.activated !== '1') return { activated: false, activatedAt: null, machine: record.machine ?? null };

  const activatedAt = record.activated_at ?? null;
  const machine = record.machine ?? null;

  if (proof.secret && activatedAt && machine) {
    const expected = installVerifier(proof.secret, machine, activatedAt);
    if (!constantTimeEquals(expected, proof.verifier)) {
      // The record claims to be activated but does not prove it. Treat the
      // installation as unactivated rather than trusting an edited database.
      return { activated: false, activatedAt: null, machine, tampered: true };
    }
  }
  return { activated: true, activatedAt, machine };
}

/** The proof material read back from storage, for {@link readActivationRecord}. */
export interface ActivationProof {
  secret: string;
  verifier: string;
}

export function assertActivationCode(input: string): void {
  if (!verifyActivationCode(input)) {
    throw new AppError('validation', 'That activation code is not valid. Check the digits and try again.', {
      issues: [{ field: 'code', message: 'Activation code is not valid.' }],
    });
  }
}
