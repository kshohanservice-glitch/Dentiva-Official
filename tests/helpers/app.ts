import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DentivaApp } from '../../src/core';
import { ACTIVATION_PROOF_KEYS, buildActivationRecord, buildInstallProof } from '../../src/core/security/activation';

export interface TestApp {
  app: DentivaApp;
  dataDir: string;
  /** The backup folder this test instance is confined to. */
  backupFolder: string;
  token: string | null;
  invoke: (op: string, input?: unknown, options?: { token?: string | null }) => Promise<any>;
  cleanup: () => void;
}

let counter = 0;

export function createTestApp(overrides: Record<string, unknown> = {}): TestApp {
  counter += 1;
  const dataDir = mkdtempSync(join(tmpdir(), `dentiva-test-${process.pid}-${counter}-`));
  const app = new DentivaApp({ dataDir, logLevel: 'error', consoleLog: false, machine: 'test-machine' });
  const state: TestApp = {
    app,
    dataDir,
    backupFolder: join(dataDir, 'backups'),
    token: null,
    invoke: async (op: string, input: unknown = {}, options: { token?: string | null } = {}) => {
      const result = await app.invoke(op, input, {
        sessionToken: options.token !== undefined ? options.token : state.token,
        machine: 'test-machine',
      });
      if (!result.ok) {
        const error = result.error as { code: string; message: string; detail?: string; issues?: { field: string; message: string }[] };
        const err = new Error(`[${op}] ${error.code}: ${error.message}${error.detail ? ` :: ${error.detail}` : ''}`) as Error & { code: string; issues?: unknown };
        err.code = error.code;
        err.issues = error.issues;
        throw err;
      }
      return result.data;
    },
    cleanup: () => {
      try {
        app.close();
      } catch {
        /* already closed */
      }
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
  void overrides;
  return state;
}

/**
 * Marks a test instance as activated by writing exactly the record that a
 * successful `system.activate` call writes.
 *
 * The activation code itself is deliberately absent from this repository — not
 * in fixtures, not in comments, not in the test suite. Tests that need an
 * activated app seed the activation *record* instead of typing a code, and the
 * code-entry path is covered separately by asserting that an invalid code is
 * rejected. That keeps the credential out of version control entirely.
 */
export async function markActivatedForTest(ctx: TestApp, machine = 'test-machine'): Promise<void> {
  const now = new Date().toISOString();
  const record = buildActivationRecord(now, machine);
  // The same per-install proof a real activation writes, so tests exercise the
  // real verification path rather than a shortcut.
  const proof = buildInstallProof(now, machine);
  ctx.app.container.db.transaction(() => {
    ctx.app.container.settings.setState('activation.activated', record.activated);
    ctx.app.container.settings.setState('activation.activated_at', record.activated_at);
    ctx.app.container.settings.setState('activation.machine', record.machine);
    ctx.app.container.settings.setState(ACTIVATION_PROOF_KEYS.secret, proof.secret);
    ctx.app.container.settings.setState(ACTIVATION_PROOF_KEYS.verifier, proof.verifier);
  });
  ctx.app.container.settings.invalidate();
}

export interface SeedOptions {
  clinicName?: string;
  dentistName?: string;
  username?: string;
  password?: string;
}

/** Brings a fresh app to the point where an admin is signed in. */
export async function seedActivatedAdmin(ctx: TestApp, options: SeedOptions = {}): Promise<void> {
  const clinicName = options.clinicName ?? 'Bright Smile Dental Care';
  const username = options.username ?? 'admin';
  const password = options.password ?? 'Clinic@2026';

  await ctx.invoke('system.status');
  await markActivatedForTest(ctx);
  await ctx.invoke('setup.run', {
    clinic: {
      name: clinicName,
      address: 'House 12, Road 5, Dhanmondi',
      area: 'Dhanmondi',
      district: 'Dhaka',
      phone: '01712345678',
      email: 'hello@brightsmile.test',
      website: 'www.brightsmile.test',
      footer: 'Your healthy smile is our priority.',
      businessStart: '09:00',
      businessEnd: '20:00',
      workingDays: [0, 1, 2, 3, 4, 5],
    },
    dentists: [
      {
        fullName: options.dentistName ?? 'Dr. Shirin Akter',
        title: 'BDS',
        designations: ['Dentist', 'Endodontist'],
        qualifications: 'DDM, BDS, M.Sc. Clinical Endodontics',
        registrationNo: 'A-12345',
        phone: '01711111111',
        email: 'shirin@brightsmile.test',
        consultationHours: 'Saturday–Thursday, 10:00–20:00',
        degreePrefix: 'Dr.',
      },
    ],
    admin: { displayName: 'Shohan Khan', username, password, confirmPassword: password },
    prefs: {
      dateFormat: 'dmy',
      timeFormat: '12h',
      autoLockMinutes: 10,
      backupFolder: join(dataDirOf(ctx), 'backups'),
      backupFrequencyDays: 7,
      bengaliNumerals: false,
    },
  });

  const login = await ctx.invoke('auth.login', { username, password });
  ctx.token = login.token as string;
  await ctx.app.container.settings.invalidate();
  void dataDirOf;
}

/** The temporary data directory backing a test instance. */
function dataDirOf(ctx: TestApp): string {
  return ctx.dataDir;
}

/**
 * Creates a user, signs in and completes the forced password change, returning
 * a session token. New accounts are always required to replace the password an
 * administrator set, so every test that signs one in has to do the same.
 */
export async function seedWorkingUser(
  ctx: TestApp,
  options: { username: string; password: string; displayName?: string; roleCodes: string[]; staffId?: number },
): Promise<string> {
  const roles = await ctx.invoke('roles.list');
  const roleIds = options.roleCodes.map((code) => {
    const role = (roles as { id: number; code: string }[]).find((r) => r.code === code);
    if (!role) throw new Error(`Unknown role "${code}"`);
    return role.id;
  });
  await ctx.invoke('users.create', {
    username: options.username,
    displayName: options.displayName ?? options.username,
    password: options.password,
    roleIds,
    ...(options.staffId ? { staffId: options.staffId } : {}),
  });
  const temporary = options.password;
  const next = `${temporary}Changed7!`;
  const session = await ctx.invoke('auth.login', { username: options.username, password: temporary });
  await ctx.invoke(
    'auth.changePassword',
    { currentPassword: temporary, newPassword: next, confirmPassword: next },
    { token: session.token },
  );
  const login = await ctx.invoke('auth.login', { username: options.username, password: next });
  return login.token as string;
}

export async function seedPatient(ctx: TestApp, overrides: Record<string, unknown> = {}): Promise<Record<string, any>> {
  return ctx.invoke('patients.create', {
    fullName: 'Md. Rakibul Hasan',
    ageYears: 32,
    gender: 'male',
    phone: '01712345678',
    address: 'Mirpur 10, Dhaka',
    area: 'Mirpur',
    district: 'Dhaka',
    ...overrides,
  });
}
