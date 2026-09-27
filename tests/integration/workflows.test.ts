import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestApp, seedActivatedAdmin, seedPatient, seedWorkingUser, type TestApp } from '../helpers/app';
import { toCsv } from '../../src/core/api/platform';

let ctx: TestApp | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

async function signedIn(): Promise<TestApp> {
  const app = createTestApp();
  await seedActivatedAdmin(app);
  return app;
}

/** Creates a catalogue treatment, an invoice and (optionally) pays it. */
async function bill(
  app: TestApp,
  patientId: number,
  options: { amount?: string; pay?: string } = {},
): Promise<{ invoice: any; payment?: any }> {
  const treatments = await app.invoke('treatments.list', { pageSize: 10 });
  if (treatments.rows.length === 0) {
    await app.invoke('treatments.create', {
      name: 'Scaling and polishing',
      code: 'SCALE-01',
      categoryId: null,
      defaultPricePoisha: 80000,
      durationMinutes: 30,
    });
  }
  const list = await app.invoke('treatments.list', { pageSize: 10 });
  const treatment = list.rows[0];
  const amountPoisha = options.amount ? Math.round(Number(options.amount) * 100) : Number(treatment.default_price_poisha);
  const invoice = await app.invoke('invoices.create', {
    patientId,
    issueDate: new Date().toISOString().slice(0, 10),
    discountPercentBp: 0,
    taxPercentBp: 0,
    items: [{ treatmentId: treatment.id, description: treatment.name, qtyMilli: 1000, unitPricePoisha: amountPoisha }],
  });
  if (!options.pay) return { invoice };
  const payment = await app.invoke('payments.create', {
    patientId,
    paymentDate: new Date().toISOString().slice(0, 10),
    method: 'cash',
    type: 'receipt',
    amountPoisha: Math.round(Number(options.pay) * 100),
    allocations: [{ invoiceId: invoice.id, amountPoisha: Math.round(Number(options.pay) * 100) }],
  });
  return { invoice, payment };
}

describe('money is fixed-point end to end', () => {
  it('stores poisha, never a float, and reconciles invoice → payment → patient balance', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);

    const { invoice, payment } = await bill(ctx, patient.id, { amount: '1200.50', pay: '500.25' });
    expect(Number.isInteger(invoice.grand_total_poisha)).toBe(true);
    expect(invoice.grand_total_poisha).toBe(120050);
    expect(Number.isInteger(payment.amount_poisha)).toBe(true);
    expect(payment.amount_poisha).toBe(50025);

    const after = await ctx.invoke('invoices.get', { id: invoice.id });
    expect(after.invoice.paid_poisha).toBe(50025);
    expect(after.invoice.balance_poisha).toBe(70025);

    const detail = await ctx.invoke('patients.get', { id: patient.id });
    expect(detail.financial.totalBilledPoisha).toBe(120050);
    expect(detail.financial.totalPaidPoisha).toBe(50025);
    expect(detail.financial.outstandingPoisha).toBe(70025);
  });

  it('blocks overpayment unless the clinic explicitly allows it', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const { invoice } = await bill(ctx, patient.id, { amount: '500' });

    await expect(
      ctx.invoke('payments.create', {
        patientId: patient.id,
        paymentDate: new Date().toISOString().slice(0, 10),
        method: 'cash',
        type: 'receipt',
        amountPoisha: 60000,
        allocations: [{ invoiceId: invoice.id, amountPoisha: 60000 }],
      }),
    ).rejects.toThrow(/more than|exceed|outstanding/i);

    await ctx.invoke('settings.update', { 'financial.allowOverpayment': true });
    const over = await ctx.invoke('payments.create', {
      patientId: patient.id,
      paymentDate: new Date().toISOString().slice(0, 10),
      method: 'cash',
      type: 'receipt',
      amountPoisha: 60000,
      allocations: [{ invoiceId: invoice.id, amountPoisha: 60000 }],
    });
    expect(over.amount_poisha).toBe(60000);
    // The excess is still visible on the patient record rather than vanishing.
    const detail = await ctx.invoke('patients.get', { id: patient.id });
    expect(detail.financial.outstandingPoisha).toBeLessThanOrEqual(0);
  });

  it('refuses to archive a patient who still owes money', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    await bill(ctx, patient.id, { amount: '900' });
    await expect(ctx.invoke('patients.setStatus', { id: patient.id, status: 'archived' })).rejects.toThrow(/outstanding/i);
  });
});

describe('Bengali is first-class in storage, search, print and export', () => {
  it('round-trips Bengali names and finds them by search, code and phone', async () => {
    ctx = await signedIn();
    const created = await seedPatient(ctx, {
      fullName: 'রহিমা খাতুন',
      phone: '01898765432',
      area: 'মিরপুর',
      presentComplaint: 'দাঁতে ব্যথা হচ্ছে',
    });
    expect(created.full_name).toBe('রহিমা খাতুন');

    for (const query of ['রহিমা', 'খাতুন', 'মিরপুর']) {
      const found = await ctx.invoke('patients.list', { search: query });
      expect(found.rows.map((r: any) => r.id)).toContain(created.id);
    }

    const byPhone = await ctx.invoke('patients.list', { search: '01898765432' });
    expect(byPhone.rows[0].id).toBe(created.id);

    const detail = await ctx.invoke('patients.get', { id: created.id });
    expect(detail.patient.present_complaint).toBe('দাঁতে ব্যথা হচ্ছে');
  });

  it('produces a prescription print model that carries the clinic identity and Bengali clinical text', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx, { fullName: 'রহিমা খাতুন', ageYears: 27, gender: 'female' });

    // A draft is autosaved verbatim so nothing typed is lost, then reloaded.
    await ctx.invoke('prescriptions.saveDraft', {
      patientId: patient.id,
      cc: 'দাঁতে ব্যথা',
      advice: 'ব্যথা হলে ঔষধ খাবেন।',
      items: [
        {
          name: 'Naproxen 500',
          genericName: 'Naproxen',
          form: 'Tablet',
          strength: '500 mg',
          dose: '১টি',
          timing: 'After food',
          frequency: 'morning,evening',
          durationDays: 3,
          instructions: 'খাবারের পরে',
        },
      ],
    });
    const draft = await ctx.invoke('prescriptions.loadDraft', {});
    expect(draft.cc).toBe('দাঁতে ব্যথা');

    const saved = await ctx.invoke('prescriptions.create', {
      patientId: patient.id,
      issueDate: new Date().toISOString().slice(0, 10),
      cc: draft.cc,
      advice: draft.advice,
      items: draft.items,
      status: 'issued',
    });
    expect(saved.prescription_no).toMatch(/^RX-\d{4}-\d{5}$/);

    const model = await ctx.invoke('documents.prescription', { id: saved.id });
    expect(model.prescription.patient_name).toBe('রহিমা খাতুন');
    expect(model.prescription.cc).toBe('দাঁতে ব্যথা');
    expect(model.prescription.advice).toBe('ব্যথা হলে ঔষধ খাবেন।');
    expect(model.items[0].name).toBe('Naproxen 500');
    expect(model.clinic.name).toBe('Bright Smile Dental Care');
    // The signature block is a layout concern; the model must not invent one.
    expect(model.prescription.signature_attachment_id ?? null).toBeNull();
  });

  it('writes CSV exports as UTF-8 with a byte order mark so Excel shows Bengali', async () => {
    ctx = await signedIn();
    await seedPatient(ctx, { fullName: 'রহিমা খাতুন' });
    const exported = await ctx.invoke('exports.csv', { dataset: 'patients' });
    expect(exported.rows).toBeGreaterThan(0);
    expect(exported.content.charCodeAt(0)).toBe(0xfeff);
    expect(exported.content).toContain('রহিমা খাতুন');
  });
});

describe('dental chart', () => {
  it('records conditions per tooth, keeps history, and rejects impossible teeth', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);

    await ctx.invoke('toothChart.set', {
      patientId: patient.id,
      dentition: 'adult',
      condition: 'caries',
      surface: 'occlusal',
      severity: 2,
      note: 'Occlusal lesion',
      teeth: ['26', '36'],
    });

    const chart = await ctx.invoke('toothChart.get', { patientId: patient.id });
    const codes = chart.current.map((row: any) => row.tooth_code).sort();
    expect(codes).toEqual(['26', '36']);
    expect(chart.current[0].condition).toBe('caries');
    expect(chart.current[0].surface).toBe('occlusal');
    expect(chart.history.length).toBe(2);

    // Updating a tooth supersedes the previous record rather than overwriting it.
    await ctx.invoke('toothChart.set', {
      patientId: patient.id,
      dentition: 'adult',
      condition: 'restoration',
      surface: 'full',
      severity: 1,
      teeth: ['26'],
    });
    const updated = await ctx.invoke('toothChart.get', { patientId: patient.id });
    expect(updated.current.find((row: any) => row.tooth_code === '26').condition).toBe('restoration');
    expect(updated.current).toHaveLength(2);
    // The superseded entry is retained, so the chart keeps a full audit trail.
    // Newest first. Tooth 26 keeps both the live restoration and the caries
    // entry it replaced, so no clinical history is ever lost.
    expect(updated.history.length).toBe(3);
    const tooth26 = updated.history.filter((row: any) => row.tooth_code === '26');
    expect(tooth26.map((row: any) => row.condition)).toEqual(['restoration', 'caries']);
    expect(tooth26.filter((row: any) => row.superseded_at).length).toBe(1);
    expect(tooth26[0].superseded_at ?? null).toBeNull();

    // A primary tooth number is not valid in the adult dentition.
    await expect(
      ctx.invoke('toothChart.set', { patientId: patient.id, dentition: 'adult', condition: 'caries', teeth: ['55'] }),
    ).rejects.toMatchObject({ code: 'validation' });

    // An unknown condition is refused.
    await expect(
      ctx.invoke('toothChart.set', { patientId: patient.id, dentition: 'adult', condition: 'sparkle', teeth: ['11'] }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('permissions are enforced at the service boundary', () => {
  it('denies a receptionist the operations the receptionist role does not hold', async () => {
    ctx = await signedIn();
    await ctx.invoke('staff.create', { fullName: 'Reception Desk', position: 'Receptionist' });
    const staff = await ctx.invoke('staff.list', { pageSize: 5 });
    const record = staff.rows[0];

    const token = await seedWorkingUser(ctx, {
      username: 'frontdesk',
      displayName: 'Front Desk',
      password: 'Reception@2026',
      roleCodes: ['receptionist'],
      staffId: record.id,
    });
    const savedToken = ctx.token;
    ctx.token = token;

    // Allowed for their role.
    await expect(ctx.invoke('patients.list', {})).resolves.toBeTruthy();

    // Reading settings is allowed for this role; changing them is not.
    await expect(ctx.invoke('settings.get')).resolves.toBeTruthy();
    await expect(ctx.invoke('settings.update', { 'auth.autoLockMinutes': 5 })).rejects.toMatchObject({ code: 'permission_denied' });

    // Denied at the service, not merely hidden in the UI.
    await expect(ctx.invoke('backups.create')).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('audit.list')).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('users.list')).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('inventory.create', { name: 'Gloves', unit: 'box' })).rejects.toMatchObject({ code: 'permission_denied' });
    // …and they may not create a clinical record either.
    await expect(
      ctx.invoke('visits.create', { patientId: 1, visitDate: '2026-01-01', chiefComplaint: 'test' }),
    ).rejects.toMatchObject({ code: 'permission_denied' });

    ctx.token = savedToken;
  });

  it('blocks report and CSV export access by the report that was asked for', async () => {
    ctx = await signedIn();
    const token = await seedWorkingUser(ctx, {
      username: 'frontdesk2',
      displayName: 'Front Desk Two',
      password: 'Reception@2026',
      roleCodes: ['receptionist'],
    });
    const savedToken = ctx.token;
    ctx.token = token;

    // The invoice export is permitted for this role…
    await expect(ctx.invoke('exports.csv', { dataset: 'invoices' })).resolves.toBeTruthy();
    // …but financial data belonging to another domain is not, and the refusal
    // happens in the core rather than in the interface.
    await expect(ctx.invoke('exports.csv', { dataset: 'expenses' })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('exports.csv', { dataset: 'inventory' })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('exports.csv', { dataset: 'audit' as never })).rejects.toMatchObject({ code: 'validation' });
    await expect(ctx.invoke('documents.report', { kind: 'audit' })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('documents.report', { kind: 'daily-summary' })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('documents.report', { kind: 'collection' })).resolves.toBeTruthy();

    ctx.token = savedToken;
  });
});

describe('backup and restore', () => {
  it('creates a verifiable backup, restores it, and rolls back the live data to the backup contents', async () => {
    ctx = await signedIn();
    await seedPatient(ctx, { fullName: 'Backup Patient' });

    const created = await ctx.invoke('backups.create');
    expect(existsSync(join(created.path, 'manifest.json'))).toBe(true);
    expect(existsSync(join(created.path, 'data.db'))).toBe(true);

    const manifest = await ctx.invoke('backups.validate', { path: created.path });
    expect(manifest.app).toBe('Dentiva Pro');
    expect(manifest.files.some((file: any) => file.name === 'data.db')).toBe(true);

    // Change the data after the backup was taken.
    await seedPatient(ctx, { fullName: 'Added After Backup' });
    expect((await ctx.invoke('patients.list', {})).total).toBe(2);

    const restored = await ctx.invoke('backups.restore', { path: created.path, confirmName: created.name });
    expect(restored.integrityOk).toBe(true);
    expect(restored.preRestoreBackup).toBeTruthy();
    // The safety backup is a real backup on disk, not just a name.
    const safety = restored.preRestoreBackup as string;
    expect(safety).toMatch(/^DentivaPro_Backup_/);
    expect(existsSync(join(ctx.backupFolder, safety, 'manifest.json'))).toBe(true);

    // The container reopens the swapped database in place, so the same session
    // keeps working and now sees exactly the state captured by the backup.
    const patients = await ctx.invoke('patients.list', {});
    expect(patients.total).toBe(1);
    expect(patients.rows[0].full_name).toBe('Backup Patient');
  });

  it('refuses a restore until the backup name is typed back exactly', async () => {
    ctx = await signedIn();
    const created = await ctx.invoke('backups.create');
    expect(created.path.startsWith(ctx.backupFolder)).toBe(true);
    await expect(ctx.invoke('backups.restore', { path: created.path, confirmName: 'wrong-name' })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(ctx.invoke('backups.restore', { path: created.path, confirmName: created.name.toUpperCase() })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('refuses to delete anything outside the backup folder', async () => {
    ctx = await signedIn();
    const created = await ctx.invoke('backups.create');
    const listing = await ctx.invoke('backups.list');
    expect(listing.history.length).toBe(1);
    await expect(ctx.invoke('backups.remove', { path: ctx.dataDir, confirmName: '' })).rejects.toMatchObject({ code: 'validation' });
    await expect(ctx.invoke('backups.remove', { path: '/tmp', confirmName: 'tmp' })).rejects.toMatchObject({ code: 'validation' });
    await expect(ctx.invoke('backups.remove', { path: created.path, confirmName: 'not-the-name' })).rejects.toMatchObject({
      code: 'validation',
    });
    const removed = await ctx.invoke('backups.remove', { path: created.path, confirmName: created.name });
    expect(removed.removed).toBe(created.name);
    expect(existsSync(created.path)).toBe(false);
    // The history row goes with the folder, and the deletion is auditable.
    const history = await ctx.invoke('backups.list');
    expect(history.history.some((row: any) => row.file_name === created.name)).toBe(false);
    const audit = await ctx.invoke('audit.list', { range: 'today' });
    expect(audit.rows.map((row: any) => row.action)).toContain('backup.delete');
  });
});

describe('CSV export formatting', () => {
  it('quotes separators, newlines and quotes, and keeps Bengali intact', () => {
    const csv = toCsv(
      [{ key: 'name', label: 'Name' }, { key: 'note', label: 'Note' }],
      [
        { name: 'Rahma, Khatun', note: 'She said "it hurts"' },
        { name: 'রহিমা খাতুন', note: 'line one\nline two' },
      ],
    );
    expect(csv).toContain('"Rahma, Khatun"');
    expect(csv).toContain('"She said ""it hurts"""');
    expect(csv).toContain('রহিমা খাতুন');
    expect(csv).toContain('"line one\nline two"');
  });
});

describe('audit trail', () => {
  it('records who changed what, without ever storing a password', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    await bill(ctx, patient.id, { amount: '400', pay: '400' });

    const audit = await ctx.invoke('audit.list', { range: 'today' });
    const actions = audit.rows.map((row: any) => row.action);
    expect(actions).toContain('patients.create');
    expect(actions).toContain('invoices.create');
    expect(actions).toContain('payments.create');

    const dbBytes = readFileSync(join(ctx.dataDir, 'dentiva.db')).toString('latin1');
    expect(dbBytes).not.toContain('Clinic@2026');
  });
});
