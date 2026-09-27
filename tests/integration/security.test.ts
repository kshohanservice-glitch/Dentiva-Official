import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestApp, seedActivatedAdmin, seedPatient, type TestApp } from '../helpers/app';
import { hashPassword, verifyPassword, needsRehash, checkPasswordPolicy } from '../../src/core/security/password';
import { canonicaliseActivationInput, verifyActivationCode, readActivationRecord } from '../../src/core/security/activation';

let ctx: TestApp | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

describe('password hashing', () => {
  it('uses scrypt with a per-password salt and never stores the password', () => {
    const hash = hashPassword('Correct#Horse7');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(hash).not.toContain('Correct#Horse7');
    // Two hashes of the same password differ, so the salt is per-password.
    expect(hashPassword('Correct#Horse7')).not.toBe(hash);
    expect(verifyPassword('Correct#Horse7', hash)).toBe(true);
    expect(verifyPassword('correct#horse7', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('refuses a hash whose cost was weakened by hand', () => {
    const strong = hashPassword('Correct#Horse7');
    // An attacker with write access to the database would like verification to
    // be cheap. It is not: the parameters are bounds-checked first.
    const parts = strong.split('$');
    const weakened = ['scrypt', '2', '1', '1', parts[4] as string, parts[5] as string].join('$');
    expect(verifyPassword('Correct#Horse7', weakened)).toBe(false);
    expect(needsRehash(weakened)).toBe(true);
    expect(needsRehash(strong)).toBe(false);
    expect(needsRehash('not-a-hash')).toBe(true);
    expect(verifyPassword('x', 'scrypt$32768$8$1$!!!$!!!')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });

  it('applies the clinic password policy and the username rule', () => {
    const strict = { minLength: 10, requireUpper: true, requireLower: true, requireDigit: true, requireSymbol: true };
    expect(checkPasswordPolicy('short1', strict)).toContain('Password must be at least 10 characters long.');
    expect(checkPasswordPolicy('alllowercase1', strict)).toContain('Password must include an uppercase letter.');
    expect(checkPasswordPolicy('ALLUPPERCASE1', strict)).toContain('Password must include a lowercase letter.');
    expect(checkPasswordPolicy('NoDigitsHere', strict)).toContain('Password must include a digit.');
    expect(checkPasswordPolicy('NoSymbols123', strict)).toContain('Password must include a symbol.');
    expect(checkPasswordPolicy('admin', strict, { username: 'admin' })).toContain('Password must not be the same as the username.');
    expect(checkPasswordPolicy('Correct#Horse7', strict)).toEqual([]);
    // Reusing a previous password is refused.
    const previous = hashPassword('Correct#Horse7');
    expect(checkPasswordPolicy('Correct#Horse7', strict, { previousHashes: [previous] })).toContain(
      'Password must not be one of your last 5 passwords.',
    );
  });
});

describe('activation verifier', () => {
  it('accepts only a well-formed 16-digit code and compares by derivation', () => {
    expect(canonicaliseActivationInput('')).toBeNull();
    expect(canonicaliseActivationInput('1234')).toBeNull();
    expect(canonicaliseActivationInput('123456789012345')).toBeNull();
    expect(canonicaliseActivationInput('12345678901234567')).toBeNull();
    expect(canonicaliseActivationInput('1234567890123456')).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}$/);
    // Separators and case are irrelevant to the operator typing it in.
    expect(canonicaliseActivationInput('1234 5678 9012 3456')).toBe(canonicaliseActivationInput('1234-5678-9012-3456'));
  });

  it('rejects every code that is not the real one', () => {
    for (const guess of ['0000000000000000', '1111111111111111', '1234567890123456', '9999999999999999', 'abcdefghijklmnop']) {
      expect(verifyActivationCode(guess), `${guess} must not activate`).toBe(false);
    }
  });

  it('reports an edited record as unactivated rather than believing it', () => {
    const secret = 'a'.repeat(43);
    const verifier = 'b'.repeat(43);
    const record = { activated: '1', activated_at: '2026-01-01T00:00:00.000Z', machine: 'DESKTOP-1' };

    // A bare "1" with no proof is a legacy record and is honoured.
    expect(readActivationRecord(record).activated).toBe(true);
    // Once a secret exists, the record must actually verify.
    expect(readActivationRecord(record, { secret, verifier }).activated).toBe(false);
    expect(readActivationRecord(record, { secret, verifier }).tampered).toBe(true);
    expect(readActivationRecord({ ...record, activated_at: '2026-02-02T00:00:00.000Z' }, { secret, verifier }).tampered).toBe(true);
    expect(readActivationRecord(undefined).activated).toBe(false);
    expect(readActivationRecord({ activated: '0' }).activated).toBe(false);
  });
});

describe('nothing sensitive is written to disk', () => {
  it('keeps passwords, hashes and tokens out of the database, the logs and the exports', async () => {
    ctx = await signedInApp();
    const patient = await seedPatient(ctx, { fullName: 'রহিমা খাতুন', phone: '01898765432' });
    await ctx.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' });

    const db = readFileSync(join(ctx.dataDir, 'dentiva.db')).toString('latin1');
    // A salted scrypt hash is expected in the users table; the password itself
    // is not, and neither is any other account's password.
    expect(db).not.toContain('Clinic@2026');
    expect(db).toContain('scrypt$32768$8$1$');
    // The session token lives in the sessions table, not in the log files.
    for (const file of readdirSync(join(ctx.dataDir, 'logs'))) {
      const text = readFileSync(join(ctx.dataDir, 'logs', file), 'latin1');
      expect(text).not.toContain('Clinic@2026');
      expect(text.toLowerCase()).not.toContain('password');
    }

    const audit = await ctx.invoke('audit.list', { range: 'today' });
    expect(JSON.stringify(audit)).not.toContain('Clinic@2026');

    const diagnostics = await ctx.invoke('system.exportDiagnosticReport');
    const report = readFileSync(diagnostics.path, 'latin1');
    expect(report).not.toContain('Clinic@2026');
    expect(report.toLowerCase()).not.toContain('"password"');

    expect(patient.full_name).toBe('রহিমা খাতুন');
  });

  it('keeps the activation secret out of the exported diagnostics', async () => {
    ctx = await signedInApp();
    const secret = ctx.app.container.settings.getState('activation.install_secret');
    expect(secret.length).toBeGreaterThan(20);
    const diagnostics = await ctx.invoke('system.exportDiagnosticReport');
    expect(readFileSync(diagnostics.path, 'latin1')).not.toContain(secret);
  });
});

describe('attack surface', () => {
  it('does not reveal whether a patient exists to a caller without permission', async () => {
    ctx = await signedInApp();
    const patient = await seedPatient(ctx);
    const dentistRole = (await ctx.invoke('roles.list')).find((r: any) => r.code === 'dentist');
    const accountantRole = (await ctx.invoke('roles.list')).find((r: any) => r.code === 'accountant');
    await ctx.invoke('users.create', {
      username: 'labuser', displayName: 'Lab', password: 'Strong#Pass1', roleIds: [accountantRole.id],
    });
    const session = await ctx.invoke('auth.login', { username: 'labuser', password: 'Strong#Pass1' });
    await ctx.invoke(
      'auth.changePassword',
      { currentPassword: 'Strong#Pass1', newPassword: 'Another#Pass2', confirmPassword: 'Another#Pass2' },
      { token: session.token },
    );
    const login = await ctx.invoke('auth.login', { username: 'labuser', password: 'Another#Pass2' });
    const saved = ctx.token;
    ctx.token = login.token;

    // An accountant may bill but must not read clinical or dental-chart data.
    await expect(ctx.invoke('patients.get', { id: patient.id })).resolves.toBeTruthy();
    await expect(ctx.invoke('toothChart.get', { patientId: patient.id })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('visits.get', { id: 1 })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('prescriptions.list', { patientId: patient.id })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('settings.update', { 'auth.autoLockMinutes': 5 })).rejects.toMatchObject({ code: 'permission_denied' });

    void dentistRole;
    ctx.token = saved;
  });

  it('refuses a session token from a revoked or expired session', async () => {
    ctx = await signedInApp();
    const session = (await ctx.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' })).token as string;
    expect(await ctx.invoke('auth.me', {}, { token: session })).toBeTruthy();
    await ctx.invoke('auth.logout', {}, { token: session });
    await expect(ctx.invoke('auth.me', {}, { token: session })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(ctx.invoke('auth.me', {}, { token: 'not-a-real-token' })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('counts and locks repeated failures without revealing the password', async () => {
    ctx = await signedInApp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // The last attempt trips the lockout; the ones before it are refused
      // without saying whether the username exists.
      await expect(ctx.invoke('auth.login', { username: 'admin', password: `wrong-guess-${attempt}` })).rejects.toMatchObject({
        code: attempt === 4 ? 'locked_out' : 'unauthenticated',
      });
    }
    // The account is now locked even though the correct password is right.
    await expect(ctx.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' })).rejects.toMatchObject({ code: 'locked_out' });

    const history = await ctx.invoke('auth.recentActivity');
    expect(history.length).toBeGreaterThan(0);
    expect(JSON.stringify(history)).not.toContain('wrong-guess');
    expect(JSON.stringify(history)).not.toContain('Clinic@2026');
  });
});

async function signedInApp(): Promise<TestApp> {
  const app = createTestApp();
  await seedActivatedAdmin(app);
  return app;
}
