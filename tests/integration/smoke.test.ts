import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestApp, seedActivatedAdmin, seedPatient, markActivatedForTest, type TestApp } from '../helpers/app';

let ctx: TestApp | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

describe('bootstrap: fresh installation', () => {
  it('reports a clean, unconfigured, unactivated application', async () => {
    ctx = createTestApp();
    const status = await ctx.invoke('system.status');
    expect(status.setupCompleted).toBe(false);
    expect(status.activated).toBe(false);
    expect(status.hasAdmin).toBe(false);
    expect(status.integrity.ok).toBe(true);
  });

  it('refuses setup before activation', async () => {
    ctx = createTestApp();
    await expect(
      ctx.invoke('setup.run', { clinic: { name: 'X' }, dentists: [], admin: {}, prefs: {} }),
    ).rejects.toMatchObject({ code: 'not_activated' });
  });

  it('rejects malformed and incorrect activation codes without recording anything', async () => {
    ctx = createTestApp();
    await expect(ctx.invoke('system.activate', { code: '' })).rejects.toMatchObject({ code: 'validation' });
    await expect(ctx.invoke('system.activate', { code: '0000000000000000' })).rejects.toMatchObject({ code: 'validation' });
    await expect(ctx.invoke('system.activate', { code: '1234-5678' })).rejects.toMatchObject({ code: 'validation' });
    await expect(ctx.invoke('system.activate', { code: 'not-a-licence-key' })).rejects.toMatchObject({ code: 'validation' });
    const status = await ctx.invoke('system.status');
    expect(status.activated).toBe(false);
  });

  it('accepts activation exactly once and records no part of the code', async () => {
    ctx = createTestApp();
    await markActivatedForTest(ctx);
    const status = await ctx.invoke('system.status');
    expect(status.activated).toBe(true);
    expect(status.activatedAt).toBeTruthy();
    // Re-activating an already-activated install is refused.
    await expect(ctx.invoke('system.activate', { code: '0000000000000000' })).rejects.toMatchObject({ code: 'conflict' });

    // The persisted activation record must contain no code material.
    const dbBytes = readFileSync(join(ctx.dataDir, 'dentiva.db')).toString('latin1');
    for (const forbidden of ['activation_code', 'activationKey', 'ACTIVATION_CODE']) {
      expect(dbBytes).not.toContain(forbidden);
    }
  });
});

describe('setup, authentication and patients', () => {
  it('completes setup, signs in, and creates a patient with a generated code', async () => {
    ctx = createTestApp();
    await seedActivatedAdmin(ctx);
    const me = await ctx.invoke('auth.me');
    expect(me.username).toBe('admin');
    expect(me.isAdministrator).toBe(true);

    const patient = await seedPatient(ctx);
    expect(patient.patient_code).toBe('P-000001');
    expect(patient.full_name).toBe('Md. Rakibul Hasan');

    const second = await seedPatient(ctx, { fullName: 'রহিমা খাতুন', ageYears: 27, gender: 'female', phone: '01898765432' });
    expect(second.patient_code).toBe('P-000002');
    expect(second.full_name).toBe('রহিমা খাতুন');
  });

  it('enforces authentication on protected operations', async () => {
    ctx = createTestApp();
    await seedActivatedAdmin(ctx);
    ctx.token = null;
    await expect(ctx.invoke('patients.list')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a wrong password and locks the account after repeated failures', async () => {
    ctx = createTestApp();
    await seedActivatedAdmin(ctx);
    ctx.token = null;
    for (let i = 0; i < 4; i += 1) {
      await expect(ctx.invoke('auth.login', { username: 'admin', password: 'wrong' })).rejects.toMatchObject({ code: 'unauthenticated' });
    }
    await expect(ctx.invoke('auth.login', { username: 'admin', password: 'wrong' })).rejects.toMatchObject({ code: 'locked_out' });
    await expect(ctx.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' })).rejects.toMatchObject({ code: 'locked_out' });
  });

  it('rejects duplicate patient codes', async () => {
    ctx = createTestApp();
    await seedActivatedAdmin(ctx);
    await seedPatient(ctx, { patientCode: 'P-CUSTOM-1' });
    await expect(seedPatient(ctx, { patientCode: 'P-CUSTOM-1' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('finds a Bengali-named patient through global search', async () => {
    ctx = createTestApp();
    await seedActivatedAdmin(ctx);
    await seedPatient(ctx, { fullName: 'রহিমা খাতুন', phone: '01898765432', area: 'উত্তরা' });
    const result = await ctx.invoke('search.global', { query: 'রহিমা' });
    expect(result.total).toBeGreaterThan(0);
    expect(result.groups.patients.items[0].title).toBe('রহিমা খাতুন');

    const byCode = await ctx.invoke('search.global', { query: 'P-000001' });
    expect(byCode.total).toBeGreaterThan(0);
  });
});
