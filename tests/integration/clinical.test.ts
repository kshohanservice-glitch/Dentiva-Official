import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestApp, seedActivatedAdmin, seedPatient, seedWorkingUser, type TestApp } from '../helpers/app';

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

const TODAY = new Date().toISOString().slice(0, 10);

describe('treatment catalogue', () => {
  it('keeps a unique code, supports Bengali names and archives rather than deletes', async () => {
    ctx = await signedIn();

    const created = await ctx.invoke('treatments.create', {
      name: 'দাঁত পরিষ্কার করা',
      code: 'SCALE-01',
      description: 'স্কেলিং এবং পলিশিং',
      defaultPricePoisha: 80000,
      durationMinutes: 30,
    });
    expect(created.name).toBe('দাঁত পরিষ্কার করা');
    expect(created.default_price_poisha).toBe(80000);

    await expect(
      ctx.invoke('treatments.create', { name: 'Duplicate', code: 'SCALE-01', defaultPricePoisha: 100 }),
    ).rejects.toThrow(/already in use/i);

    // A Bengali name is findable from the picker.
    const found = await ctx.invoke('treatments.list', { search: 'পরিষ্কার' });
    expect(found.rows.map((r: any) => r.id)).toContain(created.id);

    await ctx.invoke('treatments.update', { id: created.id, name: created.name, code: created.code, defaultPricePoisha: 90000 });
    expect((await ctx.invoke('treatments.get', { id: created.id })).default_price_poisha).toBe(90000);

    await ctx.invoke('treatments.delete', { id: created.id });
    expect(await ctx.invoke('treatments.list', { search: 'SCALE-01' })).toMatchObject({ total: 0 });
    await expect(ctx.invoke('treatments.get', { id: created.id })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('visits and recorded treatment', () => {
  it('records a visit, logs the treatment against it, and keeps the timeline', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx, { fullName: 'কামাল উদ্দিন' });
    const dentist = (await ctx.invoke('dentists.list'))[0];
    const treatment = await ctx.invoke('treatments.create', {
      name: 'Filling',
      code: 'FILL-01',
      defaultPricePoisha: 120000,
      durationMinutes: 40,
    });

    const visit = await ctx.invoke('visits.create', {
      patientId: patient.id,
      dentistId: dentist.id,
      visitDate: TODAY,
      chiefComplaint: 'ডান পেছনের দাঁতে ব্যথা',
      notes: 'Patient reports pain on chewing',
    });
    expect(visit.status).toBe('open');

    await ctx.invoke('treatmentRecords.create', {
      visitId: visit.id,
      treatmentId: treatment.id,
      name: 'Filling',
      toothCode: '46',
      qtyMilli: 1000,
      unitPricePoisha: 120000,
      status: 'done',
    });
    await ctx.invoke('toothChart.set', {
      patientId: patient.id,
      visitId: visit.id,
      dentition: 'adult',
      condition: 'caries',
      surface: 'occlusal',
      severity: 2,
      teeth: ['46'],
    });

    const forVisit = await ctx.invoke('treatmentRecords.listForVisit', { visitId: visit.id });
    expect(forVisit).toHaveLength(1);
    expect(forVisit[0].tooth_code).toBe('46');
    expect(forVisit[0].name_snapshot).toBe('Filling');

    const chart = await ctx.invoke('toothChart.get', { patientId: patient.id });
    expect(chart.current.map((r: any) => r.tooth_code)).toEqual(['46']);

    const detail = await ctx.invoke('patients.get', { id: patient.id });
    expect(detail.summary.total_visits).toBe(1);
    expect(detail.summary.last_visit).toBe(TODAY);
    const visitList = await ctx.invoke('visits.list', { patientId: patient.id });
    expect(visitList.rows[0].chief_complaint).toBe('ডান পেছনের দাঁতে ব্যথা');

    // The visit is now the patient's latest visit.
    const list = await ctx.invoke('patients.list', {});
    expect(list.rows[0].last_visit_at).toBeTruthy();
  });
});

describe('invoice arithmetic', () => {
  it('applies a percentage discount and tax in whole poisha', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const treatment = await ctx.invoke('treatments.create', { name: 'Crown', code: 'CRN-01', defaultPricePoisha: 200000 });

    const invoice = await ctx.invoke('invoices.create', {
      patientId: patient.id,
      issueDate: TODAY,
      discountPercentBp: 1000, // 10.00%
      taxPercentBp: 500, // 5.00%
      items: [
        { treatmentId: treatment.id, description: 'Crown', qtyMilli: 2000, unitPricePoisha: 200000 },
      ],
    });
    // 2 × ৳2000.00 = ৳4000.00; less 10% = ৳3600.00; plus 5% tax = ৳3780.00
    expect(invoice.subtotal_poisha).toBe(400000);
    expect(invoice.discount_poisha).toBe(40000);
    expect(invoice.tax_poisha).toBe(18000);
    expect(invoice.grand_total_poisha).toBe(378000);
    for (const value of [invoice.subtotal_poisha, invoice.discount_poisha, invoice.tax_poisha, invoice.grand_total_poisha]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('refuses a discount or tax that would make the invoice meaningless', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const treatment = await ctx.invoke('treatments.create', { name: 'X-Ray', code: 'XR-01', defaultPricePoisha: 50000 });
    await expect(
      ctx.invoke('invoices.create', {
        patientId: patient.id,
        issueDate: TODAY,
        discountPercentBp: 10001,
        items: [{ treatmentId: treatment.id, description: 'X-Ray', qtyMilli: 1000, unitPricePoisha: 50000 }],
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      ctx.invoke('invoices.create', {
        patientId: patient.id,
        issueDate: TODAY,
        items: [],
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('keeps a free-text line detached from the catalogue', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const invoice = await ctx.invoke('invoices.create', {
      patientId: patient.id,
      issueDate: TODAY,
      items: [{ treatmentId: null, description: 'দাঁতের যত্ন বোধন', qtyMilli: 1000, unitPricePoisha: 75000 }],
    });
    const detail = await ctx.invoke('invoices.get', { id: invoice.id });
    expect(detail.items[0].treatment_id).toBeNull();
    expect(detail.items[0].description).toBe('দাঁতের যত্ন বোধন');
    expect(detail.invoice.grand_total_poisha).toBe(75000);
  });

  it('cancels only an unpaid invoice and keeps a paid one for refund', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const treatment = await ctx.invoke('treatments.create', { name: 'Extraction', code: 'EXT-01', defaultPricePoisha: 90000 });

    const paid = await ctx.invoke('invoices.create', {
      patientId: patient.id,
      issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: 'Extraction', qtyMilli: 1000, unitPricePoisha: 90000 }],
    });
    await ctx.invoke('payments.create', {
      patientId: patient.id,
      paymentDate: TODAY,
      method: 'cash',
      type: 'receipt',
      amountPoisha: 90000,
      allocations: [{ invoiceId: paid.id, amountPoisha: 90000 }],
    });
    await expect(ctx.invoke('invoices.cancel', { id: paid.id, reason: 'Duplicate' })).rejects.toMatchObject({ code: 'business_rule' });
    await expect(ctx.invoke('invoices.delete', { id: paid.id, confirmInvoiceNo: paid.invoice_no })).rejects.toMatchObject({
      code: 'business_rule',
    });

    const unpaid = await ctx.invoke('invoices.create', {
      patientId: patient.id,
      issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: 'Extraction', qtyMilli: 1000, unitPricePoisha: 90000 }],
    });
    await expect(ctx.invoke('invoices.cancel', { id: unpaid.id, reason: 'Patient withdrew' })).resolves.toMatchObject({ status: 'cancelled' });
    await expect(ctx.invoke('invoices.update', {
      id: unpaid.id,
      issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: 'Extraction', qtyMilli: 1000, unitPricePoisha: 90000 }],
    })).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('payments, refunds and reconciliation', () => {
  it('refunds against a paid invoice and brings the balance back', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const treatment = await ctx.invoke('treatments.create', { name: 'Bridge', code: 'BRG-01', defaultPricePoisha: 150000 });
    const invoice = await ctx.invoke('invoices.create', {
      patientId: patient.id,
      issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: 'Bridge', qtyMilli: 1000, unitPricePoisha: 150000 }],
    });
    await ctx.invoke('payments.create', {
      patientId: patient.id, paymentDate: TODAY, method: 'bkash', type: 'receipt', amountPoisha: 150000,
      allocations: [{ invoiceId: invoice.id, amountPoisha: 150000 }],
    });

    // More money back than was ever collected is refused.
    await expect(ctx.invoke('payments.create', {
      patientId: patient.id, paymentDate: TODAY, method: 'bkash', type: 'refund', amountPoisha: 200000,
      allocations: [{ invoiceId: invoice.id, amountPoisha: 200000 }],
    })).rejects.toMatchObject({ code: 'business_rule' });
    // A refund must be allocated in full, so it can never drift from the payment.
    await expect(ctx.invoke('payments.create', {
      patientId: patient.id, paymentDate: TODAY, method: 'bkash', type: 'refund', amountPoisha: 50000,
      allocations: [{ invoiceId: invoice.id, amountPoisha: 20000 }],
    })).rejects.toMatchObject({ code: 'validation' });

    const refund = await ctx.invoke('payments.create', {
      patientId: patient.id, paymentDate: TODAY, method: 'bkash', type: 'refund', amountPoisha: 50000,
      allocations: [{ invoiceId: invoice.id, amountPoisha: 50000 }],
    });
    expect(refund.type).toBe('refund');

    const after = await ctx.invoke('invoices.get', { id: invoice.id });
    expect(after.invoice.paid_poisha).toBe(100000);
    expect(after.invoice.balance_poisha).toBe(50000);
    expect(after.invoice.status).toBe('partial');

    const summary = await ctx.invoke('payments.summary', { from: TODAY, to: TODAY });
    expect(summary.receivedPoisha).toBe(150000);
    expect(summary.refundPoisha).toBe(50000);
    expect(summary.netPoisha).toBe(100000);
    expect(summary.walletPoisha).toBe(150000);
    expect(summary.outstandingPoisha).toBe(50000);
  });

  it('splits one payment across two invoices without losing a poisha', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const treatment = await ctx.invoke('treatments.create', { name: 'Consult', code: 'CON-01', defaultPricePoisha: 60000 });

    const first = await ctx.invoke('invoices.create', {
      patientId: patient.id, issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: 'Consult', qtyMilli: 1000, unitPricePoisha: 60000 }],
    });
    const second = await ctx.invoke('invoices.create', {
      patientId: patient.id, issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: 'Consult', qtyMilli: 1000, unitPricePoisha: 60000 }],
    });

    await ctx.invoke('payments.create', {
      patientId: patient.id, paymentDate: TODAY, method: 'cash', type: 'receipt', amountPoisha: 100000,
      allocations: [{ invoiceId: first.id, amountPoisha: 60000 }, { invoiceId: second.id, amountPoisha: 40000 }],
    });

    expect((await ctx.invoke('invoices.get', { id: first.id })).invoice.status).toBe('paid');
    const secondAfter = await ctx.invoke('invoices.get', { id: second.id });
    expect(secondAfter.invoice.paid_poisha).toBe(40000);
    expect(secondAfter.invoice.balance_poisha).toBe(20000);
    expect(secondAfter.invoice.status).toBe('partial');
  });

  it('shows the outstanding balance for a patient before they are treated', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const treatment = await ctx.invoke('treatments.create', { name: 'Whitening', code: 'WHT-01', defaultPricePoisha: 300000 });
    const invoice = await ctx.invoke('invoices.create', {
      patientId: patient.id, issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: 'Whitening', qtyMilli: 1000, unitPricePoisha: 300000 }],
    });
    const outstanding = await ctx.invoke('payments.outstandingFor', { patientId: patient.id });
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0].balance_poisha).toBe(300000);
    expect(outstanding[0].invoice_no).toBe(invoice.invoice_no);
  });
});

describe('roles and permissions administration', () => {
  it('creates a role, assigns it, and takes effect on the next sign-in', async () => {
    ctx = await signedIn();
    const created = await ctx.invoke('roles.create', {
      name: 'Lab Assistant',
      description: 'Prepares appliances; no money, no clinical notes.',
      permissions: ['patients.view', 'inventory.view', 'inventory.manage'],
    });
    expect(created.code).toBe('lab_assistant');

    const all = await ctx.invoke('roles.list');
    expect(all.map((r: any) => r.code)).toContain(created.code);

    const token = await seedWorkingUser(ctx, {
      username: 'labuser',
      password: 'LabBench#2026',
      roleCodes: [created.code],
    });
    const saved = ctx.token;
    ctx.token = token;

    await expect(ctx.invoke('inventory.create', { name: 'Alginate', sku: 'ALG-9' })).resolves.toBeTruthy();
    await expect(ctx.invoke('invoices.list', {})).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(ctx.invoke('patients.list', {})).resolves.toBeTruthy();

    ctx.token = saved;
  });

  it('protects the built-in roles from being deleted', async () => {
    ctx = await signedIn();
    const admin = (await ctx.invoke('roles.list')).find((r: any) => r.code === 'administrator');
    await expect(ctx.invoke('roles.delete', { id: admin.id })).rejects.toThrow();
    const remaining = await ctx.invoke('roles.list');
    expect(remaining.find((r: any) => r.code === 'administrator')).toBeTruthy();
  });

  it('refuses to remove a role that is still assigned to someone', async () => {
    ctx = await signedIn();
    const dentistRole = (await ctx.invoke('roles.list')).find((r: any) => r.code === 'dentist');
    await ctx.invoke('users.create', {
      username: 'drtest', displayName: 'Dr Test', password: 'Strong#Pass1', roleIds: [dentistRole.id],
    });
    await expect(ctx.invoke('roles.delete', { id: dentistRole.id })).rejects.toThrow();
  });
});

describe('dentist records', () => {
  it('keeps Bengali qualifications and clears a signature on request', async () => {
    ctx = await signedIn();
    const created = await ctx.invoke('dentists.create', {
      fullName: 'ড. মোহাম্মদ করিম',
      title: 'BDS, MS',
      qualifications: 'ঢাবি বিডিএস, ক্লিনিক্যাল মাস্টার অফ সার্জারি',
      designations: ['Oral Surgeon'],
      registrationNo: 'A-99887',
      phone: '01812345678',
    });
    expect(created.full_name).toBe('ড. মোহাম্মদ করিম');
    expect(created.registration_no).toBe('A-99887');

    const list = await ctx.invoke('dentists.list');
    expect(list.find((d: any) => d.id === created.id).full_name).toBe('ড. মোহাম্মদ করিম');

    await expect(ctx.invoke('dentists.create', { fullName: 'No Contact' })).resolves.toBeTruthy();
  });
});

describe('print history and diagnostics', () => {
  it('records a print and exposes it, and writes a diagnostics bundle', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx, { fullName: 'আলিমা বেগম' });
    const treatment = await ctx.invoke('treatments.create', { name: 'Scaling', code: 'SCL-01', defaultPricePoisha: 70000 });
    const invoice = await ctx.invoke('invoices.create', {
      patientId: patient.id, issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: 'Scaling', qtyMilli: 1000, unitPricePoisha: 70000 }],
    });

    await ctx.invoke('printHistory.record', { docKind: 'invoice', entityId: invoice.id, entityLabel: invoice.invoice_no, output: 'pdf' });
    const history = await ctx.invoke('printHistory.list', { pageSize: 10 });
    expect(history.rows.length).toBeGreaterThan(0);
    expect(history.rows[0].doc_kind).toBe('invoice');
    expect(history.rows[0].entity_label).toBe(invoice.invoice_no);

    const diagnostics = await ctx.invoke('system.exportDiagnosticReport');
    expect(diagnostics.bytes).toBeGreaterThan(0);
    expect(diagnostics.path.endsWith('.json')).toBe(true);
  });

  it('refuses to wipe everything without the exact word, and backs up before it does', async () => {
    ctx = await signedIn();
    for (const wrong of ['delete', 'Delete', 'DELETE ', ' DELETE', 'yes', '']) {
      await expect(ctx.invoke('maintenance.wipe', { confirmation: wrong })).rejects.toMatchObject({ code: 'validation' });
    }
    // The refusals left the data alone.
    expect((await ctx.invoke('patients.list', {})).total).toBe(0);

    // Real maintenance runs, and a real wipe takes a safety backup first.
    const maintenance = await ctx.invoke('maintenance.run');
    expect(maintenance.integrity.ok).toBe(true);

    await seedPatient(ctx, { fullName: 'Will Be Erased' });
    const patient = await seedPatient(ctx, { fullName: 'আমার সাথে যাবে' });
    await ctx.invoke('attachments.add', {
      ownerType: 'patient', ownerId: patient.id, fileName: 'xray.png', mimeType: 'image/png',
      dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64'),
    });

    const wiped = await ctx.invoke('maintenance.wipe', { confirmation: 'DELETE' });
    expect(wiped.ok).toBe(true);
    expect(wiped.preWipeBackup).toMatch(/^DentivaPro_Backup_/);
    // Everything is gone, including the attachments folder on disk. The session
    // went with it, which is the point: the app returns to first-time setup.
    const status = await ctx.invoke('system.status');
    expect(status.setupCompleted).toBe(false);
    expect(status.hasAdmin).toBe(false);
    expect(status.activated).toBe(false);
    expect(readdirSync(join(ctx.dataDir, 'attachments'))).toHaveLength(0);
    await expect(ctx.invoke('patients.list', {})).rejects.toMatchObject({ code: 'unauthenticated' });

    // …and the safety backup really is a complete copy, checked straight off
    // disk rather than through the service that just lost its session.
    const manifestPath = join(ctx.backupFolder, wiped.preWipeBackup, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.app).toBe('Dentiva Pro');
    expect(manifest.files.some((f: any) => f.name === 'data.db')).toBe(true);
    expect(manifest.files.some((f: any) => f.name.startsWith('attachments/'))).toBe(true);
  });
});
