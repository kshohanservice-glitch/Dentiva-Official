import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestApp, seedActivatedAdmin, seedPatient, type TestApp } from '../helpers/app';

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

/** A date 20 days from today, well inside the default expiry alert window. */
function nextMonth(): string {
  const d = new Date();
  d.setDate(d.getDate() + 20);
  return d.toISOString().slice(0, 10);
}

describe('appointments and the waiting room', () => {
  it('books a slot, refuses an overlapping one, and offers it as a suggestion', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx, { fullName: 'Appointment Patient' });
    const dentist = (await ctx.invoke('dentists.list'))[0];

    const booked = await ctx.invoke('appointments.create', {
      patientId: patient.id,
      dentistId: dentist.id,
      appointmentDate: TODAY,
      startTime: '11:00',
      durationMinutes: 30,
      appointmentType: 'consultation',
    });
    expect(booked.status).toBe('scheduled');

    await expect(
      ctx.invoke('appointments.create', {
        patientId: patient.id,
        dentistId: dentist.id,
        appointmentDate: TODAY,
        startTime: '11:15',
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({ code: 'validation' });

    // The clinic can see the clash and deliberately override it.
    const override = await ctx.invoke('appointments.create', {
      patientId: patient.id,
      dentistId: dentist.id,
      appointmentDate: TODAY,
      startTime: '11:15',
      durationMinutes: 15,
      force: true,
    });
    expect(override.id).not.toBe(booked.id);

    const day = await ctx.invoke('appointments.day', { date: TODAY });
    expect(day.rows.length).toBe(2);
    expect(day.summary.total).toBe(2);
  });

  it('will not book a patient into the queue twice in one day', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const dentist = (await ctx.invoke('dentists.list'))[0];

    const first = await ctx.invoke('queue.checkIn', { patientId: patient.id, dentistId: dentist.id, date: TODAY });
    expect(first.queue_no).toBe(1);

    await expect(ctx.invoke('queue.checkIn', { patientId: patient.id, dentistId: dentist.id, date: TODAY })).rejects.toMatchObject({
      code: 'conflict',
    });

    // A queue without a dentist cannot be numbered or displayed per dentist.
    await expect(ctx.invoke('queue.checkIn', { patientId: patient.id, date: TODAY })).rejects.toMatchObject({ code: 'validation' });

    const board = await ctx.invoke('queue.board', { date: TODAY });
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].patient_name).toBe('Md. Rakibul Hasan');
    expect(board.summary.waiting).toBe(1);
  });

  it('moves a patient through the queue and updates the summary', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const dentist = (await ctx.invoke('dentists.list'))[0];
    const entry = await ctx.invoke('queue.checkIn', { patientId: patient.id, dentistId: dentist.id, date: TODAY });
    expect(entry.id).toBeGreaterThan(0);

    await ctx.invoke('queue.updateStatus', { id: entry.id, status: 'in_progress' });
    let board = await ctx.invoke('queue.board', { date: TODAY });
    expect(board.summary.in_progress).toBe(1);

    await ctx.invoke('queue.updateStatus', { id: entry.id, status: 'completed' });
    board = await ctx.invoke('queue.board', { date: TODAY });
    expect(board.summary.completed).toBe(1);
    expect(board.summary.waiting).toBe(0);
  });
});

describe('inventory', () => {
  it('tracks batches, issues stock, and refuses to go negative', async () => {
    ctx = await signedIn();
    const item = await ctx.invoke('inventory.create', {
      name: 'Latex Gloves (M)',
      sku: 'GLV-M-100',
      category: 'Consumables',
      unit: 'box',
      minStock: 10,
      sellingPricePoisha: 45000,
    });
    expect(item.current_stock).toBe(0);

    await ctx.invoke('inventory.stockIn', {
      itemId: item.id,
      quantity: 10,
      unitCostPoisha: 38000,
      batchNo: 'LOT-2026-A',
      expiryDate: '2099-06-30',
    });
    await ctx.invoke('inventory.stockIn', {
      itemId: item.id,
      quantity: 4,
      unitCostPoisha: 40000,
      batchNo: 'LOT-2026-B',
      expiryDate: nextMonth(),
    });

    // The near-expiry batch is surfaced before anything is consumed from it.
    const earlyAlerts = await ctx.invoke('inventory.alerts', {});
    expect(earlyAlerts.expiring.map((r: any) => r.batch_no)).toEqual(['LOT-2026-B']);
    expect(earlyAlerts.expired).toHaveLength(0);

    const detail = await ctx.invoke('inventory.get', { id: item.id });
    expect(detail.item.current_stock).toBe(14);
    expect(detail.item.is_low).toBe(0);
    expect(detail.item.next_expiry).toBe(nextMonth());
    // FEFO: the batch that expires first is issued first.
    expect(detail.batches[0].batch_no).toBe('LOT-2026-B');
    expect(detail.batches.map((b: any) => b.quantity_issued)).toEqual([0, 0]);

    await expect(ctx.invoke('inventory.stockOut', { itemId: item.id, quantity: 20 })).rejects.toMatchObject({ code: 'business_rule' });

    // FEFO: the batch expiring first is consumed first.
    const issued = await ctx.invoke('inventory.stockOut', { itemId: item.id, quantity: 6 });
    expect(issued.currentStock).toBe(8);
    const afterIssue = await ctx.invoke('inventory.get', { id: item.id });
    expect(afterIssue.batches.map((b: any) => b.quantity_issued)).toEqual([4, 2]);

    // FEFO emptied the ৳400 batch first, so 8 units of the ৳380 batch remain.
    const valuation = await ctx.invoke('inventory.valuation', {});
    expect(valuation.stockValuePoisha).toBe(8 * 38000);
    expect(Number.isInteger(valuation.stockValuePoisha)).toBe(true);
    expect(valuation.byCategory[0]).toMatchObject({ category: 'Consumables', value_poisha: 304000, units: 8 });

    // Restocking dropped it under the reorder level, so it now needs buying.
    const alerts = await ctx.invoke('inventory.alerts', {});
    expect(alerts.lowStock.map((r: any) => r.id)).toContain(item.id);
    expect(alerts.outOfStock).toHaveLength(0);
    expect(alerts.expired).toHaveLength(0);
    const suggestions = await ctx.invoke('inventory.purchaseOrders', {});
    expect(suggestions.find((r: any) => r.id === item.id).suggested_quantity).toBe(12);
  });

  it('rejects a duplicate SKU with a readable message', async () => {
    ctx = await signedIn();
    await ctx.invoke('inventory.create', { name: 'Alginate', sku: 'ALG-1', unit: 'box' });
    await expect(ctx.invoke('inventory.create', { name: 'Alginate Type Two', sku: 'ALG-1' })).rejects.toThrow(/already in use/i);
  });
});

describe('accounting', () => {
  it('records income and expenses and reports the day summary in poisha', async () => {
    ctx = await signedIn();
    const rent = (await ctx.invoke('accounting.categories')).expense.find((c: any) => c.name === 'Rent');
    await ctx.invoke('accounting.createIncome', {
      entryDate: TODAY,
      amountPoisha: 250000,
      source: 'other',
      method: 'cash',
      description: 'চিকিৎসা সেবা ফি',
      reference: 'REF-1',
    });
    await ctx.invoke('accounting.createExpense', {
      entryDate: TODAY,
      categoryId: rent.id,
      amountPoisha: 900000,
      method: 'cash',
      description: 'Clinic rent',
      vendor: 'Landlord',
    });

    const income = await ctx.invoke('accounting.listIncome', { from: TODAY, to: TODAY });
    expect(income.total).toBe(1);
    expect(income.rows[0].amount_poisha).toBe(250000);
    expect(income.rows[0].description).toBe('চিকিৎসা সেবা ফি');

    const expenses = await ctx.invoke('accounting.listExpenses', { from: TODAY, to: TODAY });
    expect(expenses.total).toBe(1);
    expect(expenses.rows[0].amount_poisha).toBe(900000);
    expect(expenses.rows[0].category_name).toBe('Rent');

    const report = await ctx.invoke('accounting.report', { kind: 'daily', from: TODAY, to: TODAY });
    expect(report.incomePoisha).toBe(250000);
    expect(report.expensePoisha).toBe(900000);
    expect(report.netPoisha).toBe(-650000);
    expect(Number.isInteger(report.netPoisha)).toBe(true);
    expect(report.daily[0]).toMatchObject({ day: TODAY, income_poisha: 250000, expense_poisha: 900000 });
  });

  it('refuses a negative or zero accounting amount', async () => {
    ctx = await signedIn();
    await expect(ctx.invoke('accounting.createExpense', { entryDate: TODAY, method: 'cash', description: 'x', amountPoisha: 0 })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(ctx.invoke('accounting.createExpense', { entryDate: TODAY, method: 'cash', description: 'x', amountPoisha: -5000 })).rejects.toMatchObject({
      code: 'validation',
    });
  });
});

describe('attachments are contained', () => {
  it('stores a file, reads it back byte for byte, and refuses traversal', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

    const saved = await ctx.invoke('attachments.add', {
      ownerType: 'patient',
      ownerId: patient.id,
      fileName: 'xray.png',
      mimeType: 'image/png',
      dataBase64: bytes.toString('base64'),
    });
    expect(saved.file_name).toBe('xray.png');

    const stored = readdirSync(join(ctx.dataDir, 'attachments'));
    expect(stored.length).toBeGreaterThan(0);
    // The on-disk name is generated, never client-controlled.
    expect(stored.some((name) => name === 'xray.png')).toBe(false);

    const read = await ctx.invoke('attachments.read', { id: saved.id });
    expect(Buffer.from(read.dataBase64, 'base64').equals(bytes)).toBe(true);

    await expect(ctx.invoke('attachments.add', {
      ownerType: 'patient',
      ownerId: patient.id,
      fileName: '../../../../etc/passwd',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('nope').toString('base64'),
    })).rejects.toMatchObject({ code: 'validation' });

    await expect(ctx.invoke('attachments.add', {
      ownerType: 'patient',
      ownerId: patient.id,
      fileName: 'payload.exe',
      mimeType: 'application/x-msdownload',
      dataBase64: Buffer.from('MZ').toString('base64'),
    })).rejects.toMatchObject({ code: 'validation' });
  });

  it('keeps a file the clinic attached in a backup and restores it', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx, { fullName: 'Attachment Patient' });
    const bytes = Buffer.from('Bengali dental note: দাঁতে ব্যথা', 'utf8');
    const saved = await ctx.invoke('attachments.add', {
      ownerType: 'patient',
      ownerId: patient.id,
      fileName: 'note.txt',
      mimeType: 'text/plain',
      dataBase64: bytes.toString('base64'),
    });

    const created = await ctx.invoke('backups.create');
    expect(existsSync(join(created.path, 'attachments'))).toBe(true);

    await ctx.invoke('attachments.delete', { id: saved.id });
    await expect(ctx.invoke('attachments.read', { id: saved.id })).rejects.toMatchObject({ code: 'not_found' });

    await ctx.invoke('backups.restore', { path: created.path, confirmName: created.name });
    const restored = await ctx.invoke('attachments.read', { id: saved.id });
    expect(Buffer.from(restored.dataBase64, 'base64').toString('utf8')).toBe('Bengali dental note: দাঁতে ব্যথা');
  });
});

describe('print models carry the right identity', () => {
  it('shows the clinic identity and no doctor details on an invoice', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx, { fullName: 'রহিমা খাতুন', phone: '01898765432' });
    const treatment = await ctx.invoke('treatments.create', {
      name: 'Root Canal Therapy',
      code: 'RCT-01',
      defaultPricePoisha: 350000,
      durationMinutes: 90,
    });
    const invoice = await ctx.invoke('invoices.create', {
      patientId: patient.id,
      issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: treatment.name, qtyMilli: 1000, unitPricePoisha: 350000 }],
    });

    const model = await ctx.invoke('invoices.printModel', { id: invoice.id });
    const printed = JSON.stringify(model);
    expect(model.clinic.name).toBe('Bright Smile Dental Care');
    expect(model.clinic.phone).toBe('01712345678');
    // The clinic, not the clinician, heads an invoice — and no clinician detail
    // or signature travels with the model at all.
    expect(model.showDentist).toBe(false);
    expect(printed).not.toContain('Dr. Shirin Akter');
    expect(printed).not.toContain('dentist');
    expect(printed).not.toContain('registration_no');
    expect(model.invoice.invoice_no).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(model.items[0].description).toBe('Root Canal Therapy');
    expect(model.invoice.grand_total_poisha).toBe(350000);

    // It can be turned on deliberately, and only then.
    await ctx.invoke('settings.update', { 'print.showDentistOnInvoice': true });
    expect((await ctx.invoke('invoices.printModel', { id: invoice.id })).showDentist).toBe(true);
  });

  it('renders ৳ and Bengali digits for a payment receipt', async () => {
    ctx = await signedIn();
    await ctx.invoke('settings.update', { 'display.bengaliNumerals': true });
    const patient = await seedPatient(ctx, { fullName: 'রহিমা খাতুন' });
    const treatment = await ctx.invoke('treatments.create', { name: 'Check-up', code: 'CHK-01', defaultPricePoisha: 50000 });
    const invoice = await ctx.invoke('invoices.create', {
      patientId: patient.id,
      issueDate: TODAY,
      items: [{ treatmentId: treatment.id, description: treatment.name, qtyMilli: 1000, unitPricePoisha: 50000 }],
    });
    const payment = await ctx.invoke('payments.create', {
      patientId: patient.id,
      paymentDate: TODAY,
      method: 'bkash',
      type: 'receipt',
      amountPoisha: 50000,
      allocations: [{ invoiceId: invoice.id, amountPoisha: 50000 }],
    });

    const model = await ctx.invoke('payments.printModel', { id: payment.id });
    expect(model.payment.method).toBe('bkash');
    expect(model.payment.patient_name).toBe('রহিমা খাতুন');
    expect(model.payment.amount_poisha).toBe(50000);
    expect(model.payment.payment_no).toMatch(/^PAY-\d{4}-\d{5}$/);
    expect(model.clinic.name).toBe('Bright Smile Dental Care');
    expect(model.allocations[0].invoice_no).toMatch(/^INV-/);
    // The renderer formats the money; the core only ever hands over poisha and
    // the display preferences that decide how it reads.
    expect(Number.isInteger(model.payment.amount_poisha)).toBe(true);
    expect(model.settings.bengaliNumerals).toBe(true);
    expect(model.settings.currencySymbol).toBe('৳');
  });
});

describe('passwords and sessions', () => {
  it('requires a strong password, hashes it, and never returns it', async () => {
    ctx = await signedIn();
    for (const weak of ['short1', 'alllowercase1', '12345678', 'Password!']) {
      await expect(
        ctx.invoke('users.create', { username: `weak${weak.length}`, displayName: 'Weak', password: weak, roleIds: [] }),
      ).rejects.toMatchObject({ code: 'validation' });
    }

    const role = (await ctx.invoke('roles.list')).find((r: any) => r.code === 'dentist');
    const created = await ctx.invoke('users.create', {
      username: 'drshirin',
      displayName: 'Dr. Shirin Akter',
      password: 'Correct#Horse7',
      roleIds: [role.id],
      mustChangePassword: true,
    });
    const serialised = JSON.stringify(created);
    expect(serialised).not.toContain('Correct#Horse7');
    expect(serialised).not.toContain('password_hash');

    // A forced-change account may sign in but not work until the password changes.
    const session = await ctx.invoke('auth.login', { username: 'drshirin', password: 'Correct#Horse7' });
    const saved = ctx.token;
    ctx.token = session.token;
    await expect(ctx.invoke('patients.list', {})).rejects.toMatchObject({ code: 'password_change_required' });

    await ctx.invoke('auth.changePassword', { currentPassword: 'Correct#Horse7', newPassword: 'Bengali#Teeth9', confirmPassword: 'Bengali#Teeth9' });
    const after = await ctx.invoke('auth.login', { username: 'drshirin', password: 'Bengali#Teeth9' });
    ctx.token = after.token;
    await expect(ctx.invoke('patients.list', {})).resolves.toBeTruthy();
    ctx.token = saved;
  });

  it('ends every session when the password is changed from another device', async () => {
    ctx = await signedIn();
    const role = (await ctx.invoke('roles.list')).find((r: any) => r.code === 'dentist');
    await ctx.invoke('users.create', {
      username: 'drrahim',
      displayName: 'Dr. Rahim',
      password: 'Correct#Horse7',
      roleIds: [role.id],
    });
    // A newly created user must replace the password the administrator set.
    const first = (await ctx.invoke('auth.login', { username: 'drrahim', password: 'Correct#Horse7' })).token;
    const second = (await ctx.invoke('auth.login', { username: 'drrahim', password: 'Correct#Horse7' })).token;
    expect((await ctx.invoke('auth.me', {}, { token: first })).mustChangePassword).toBe(true);

    const saved = ctx.token;
    ctx.token = first;
    await expect(ctx.invoke('patients.list', {})).rejects.toMatchObject({ code: 'password_change_required' });
    ctx.token = second;
    await expect(ctx.invoke('patients.list', {})).rejects.toMatchObject({ code: 'password_change_required' });
    ctx.token = saved;

    // A reset from another device ends every session that user had open.
    await ctx.invoke('users.resetPassword', {
      id: (await ctx.invoke('users.list')).rows.find((u: any) => u.username === 'drrahim').id,
      newPassword: 'Fresh#Pass99',
    });
    ctx.token = first;
    await expect(ctx.invoke('patients.list', {})).rejects.toMatchObject({ code: 'unauthenticated' });
    ctx.token = second;
    await expect(ctx.invoke('patients.list', {})).rejects.toMatchObject({ code: 'unauthenticated' });
    ctx.token = saved;
  });
});

describe('global search and notifications', () => {
  it('finds a patient by name, code, phone or partial digits', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx, { fullName: 'রহিমা খাতুন', phone: '01898765432' });
    for (const query of ['রহিমা', 'খাতুন', patient.patient_code, '98765432', '65432']) {
      const hits = await ctx.invoke('search.global', { query });
      expect(hits.groups.patients.items.map((p: any) => p.id)).toContain(patient.id);
      expect(hits.groups.patients.items[0].route).toBe(`patients/${patient.id}`);
    }
    const none = await ctx.invoke('search.global', { query: 'zzzzzzzzzzzz' });
    expect(none.total).toBe(0);
    expect(none.groups.patients).toBeUndefined();
  });

  it('produces the notification list the dashboard shows', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx);
    const item = await ctx.invoke('inventory.create', { name: 'Composite', sku: 'CMP-1', unit: 'g', minStock: 5 });
    await ctx.invoke('inventory.stockIn', { itemId: item.id, quantity: 2 });

    const list = await ctx.invoke('notifications.list', {});
    expect(Array.isArray(list.rows)).toBe(true);
    for (const notification of list.rows) {
      expect(notification.title).toBeTruthy();
      expect(['info', 'warning', 'critical']).toContain(notification.severity);
    }
    expect(list.rows.some((n: any) => n.severity === 'warning')).toBe(true);
    const unread = list.rows.filter((n: any) => !n.read_at).length;
    expect(list.unread).toBe(unread);
    void patient;
  });
});

describe('data directory integrity', () => {
  it('keeps the database readable and consistent after a full workflow', async () => {
    ctx = await signedIn();
    const patient = await seedPatient(ctx, { fullName: 'আলিমা বেগম' });
    await ctx.invoke('appointments.create', { patientId: patient.id, appointmentDate: TODAY, startTime: '10:00' });
    await ctx.invoke('inventory.stockIn', { itemId: (await ctx.invoke('inventory.create', { name: 'Mask', sku: 'MSK-1' })).id, quantity: 10 });
    await ctx.invoke('accounting.createExpense', { entryDate: TODAY, method: 'cash', description: 'Utilities', amountPoisha: 450000 });

    mkdirSync(ctx.dataDir, { recursive: true });
    writeFileSync(join(ctx.dataDir, '.gitignore-probe'), 'probe');
    const status = await ctx.invoke('system.status');
    expect(status.integrity.ok).toBe(true);
    expect(status.integrity.message).toMatch(/verified/i);
    expect(status.schemaVersion).toBe(2);
  });
});
