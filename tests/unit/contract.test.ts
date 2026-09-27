import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { operationCatalogue } from '../../src/core/api';
import { createTestApp, seedActivatedAdmin, seedPatient } from '../helpers/app';

/** Every renderer and print source file, so the sweep covers the whole UI. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (['.ts', '.tsx'].includes(extname(full))) found.push(full);
  }
  return found;
}

const RENDERER = join(__dirname, '..', '..', 'src', 'renderer');

/** Operation names the UI actually invokes, e.g. `patients.list`. */
function calledOperations(): Map<string, string[]> {
  const calls = new Map<string, string[]>();
  for (const file of sourceFiles(RENDERER)) {
    const text = readFileSync(file, 'utf8');
    const pattern = /call(?:<[^>]*>)?\(\s*'([a-zA-Z0-9_.]+)'/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const op = match[1] as string;
      const list = calls.get(op) ?? [];
      list.push(file.replace(`${join(__dirname, '..', '..')}/`, ''));
      calls.set(op, list);
    }
  }
  return calls;
}

describe('the interface only calls operations that exist', () => {
  const catalogue = operationCatalogue();
  const known = new Set(catalogue.map((op) => op.name));

  it('has a non-trivial catalogue', () => {
    expect(known.size).toBeGreaterThan(150);
  });

  it('calls only real operations', () => {
    const calls = calledOperations();
    expect(calls.size).toBeGreaterThan(60);
    const missing = [...calls.entries()]
      .filter(([op]) => !known.has(op))
      .map(([op, files]) => `${op} (called from ${[...new Set(files)].join(', ')})`);
    expect(missing, `The interface calls operations the core does not provide:\n${missing.join('\n')}`).toEqual([]);
  });

  // Operations any signed-in user may call. Each one is deliberately harmless
  // and none of them touches clinic records; anything else must name a
  // permission so the denial is deliberate rather than accidental.
  const ANY_SIGNED_IN_USER = new Set([
    'auth.me', 'auth.logout', 'auth.unlock', 'auth.changePassword',
    'auth.recentActivity', 'system.about', 'system.markClean', 'settings.get', 'paymentMethods.list',
    'roles.permissions', 'printerProfiles.list', 'attachments.read', 'attachments.path',
  ]);

  it('exposes every operation with a label and an explicit access rule', () => {
    for (const op of catalogue) {
      expect(op.label, `${op.name} has no label`).toBeTruthy();
      if (op.public) {
        expect(op.permissions, `${op.name} is public but also demands a permission`).toEqual([]);
      } else if (op.permissions.length === 0 && !op.guarded) {
        // Guarded operations decide their permission from the payload, which
        // the registry enforces just as firmly.
        expect(ANY_SIGNED_IN_USER.has(op.name), `${op.name} needs a permission, a guard, or a place in the allowlist`).toBe(true);
      }
    }
  });

  it('keeps destructive operations behind an explicit permission', () => {
    const destructive = [
      'system.wipe', 'maintenance.wipe', 'maintenance.run', 'invoices.delete', 'payments.delete',
      'patients.delete', 'backups.remove', 'backups.restore', 'users.delete', 'roles.delete',
      'settings.update', 'settings.reset', 'system.exportDiagnosticReport',
    ];
    const live = new Map(catalogue.map((op) => [op.name, op]));
    for (const name of destructive) {
      const op = live.get(name);
      if (!op) continue;
      expect(op.permissions.length, `${name} is reachable without a permission`).toBeGreaterThan(0);
      expect(op.public, `${name} must never be a public operation`).toBe(false);
    }
  });
});

describe('money never travels as a float', () => {
  const MONEY_KEY = /(?:poisha|_amount$|^amount|_total$|^total|price|paid|balance|subtotal|discount|tax|revenue|value|net$|received|refund|outstanding)/i;

  /** Walks a core response and reports every money-named field that is not an integer. */
  function audit(value: unknown, path: string, out: string[]): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => audit(item, `${path}[${index}]`, out));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const here = `${path}.${key}`;
      if (typeof inner === 'number' && MONEY_KEY.test(key) && !Number.isInteger(inner)) {
        out.push(`${here} = ${inner}`);
      }
      audit(inner, here, out);
    }
  }

  it('hands the interface only whole poisha, for every financial read', async () => {
    const ctx = createTestApp();
    try {
      await seedActivatedAdmin(ctx);
      const patient = await seedPatient(ctx, { fullName: 'রহিমা খাতুন' });
      const dentist = (await ctx.invoke('dentists.list'))[0];
      const today = new Date().toISOString().slice(0, 10);

      const treatment = await ctx.invoke('treatments.create', {
        name: 'Root Canal', code: 'RCT-01', defaultPricePoisha: 350000, durationMinutes: 90,
      });
      const item = await ctx.invoke('inventory.create', { name: 'Glove', sku: 'G-1', minStock: 5, sellingPricePoisha: 45000 });
      await ctx.invoke('inventory.stockIn', { itemId: item.id, quantity: 12, unitCostPoisha: 38000 });
      const invoice = await ctx.invoke('invoices.create', {
        patientId: patient.id, issueDate: today, discountPercentBp: 250, taxPercentBp: 150,
        items: [{ treatmentId: treatment.id, description: 'Root Canal', qtyMilli: 1500, unitPricePoisha: 350000 }],
      });
      const payment = await ctx.invoke('payments.create', {
        patientId: patient.id, paymentDate: today, method: 'cash', type: 'receipt', amountPoisha: 300000,
        allocations: [{ invoiceId: invoice.id, amountPoisha: 300000 }],
      });
      await ctx.invoke('appointments.create', { patientId: patient.id, dentistId: dentist.id, appointmentDate: today, startTime: '10:00' });
      await ctx.invoke('queue.checkIn', { patientId: patient.id, dentistId: dentist.id, date: today });
      await ctx.invoke('accounting.createExpense', { entryDate: today, method: 'cash', description: 'Rent', amountPoisha: 900000, vendor: 'Landlord' });
      await ctx.invoke('accounting.createIncome', { entryDate: today, method: 'cash', source: 'other', amountPoisha: 125000, description: 'Other' });

      const reads: [string, unknown][] = [
        ['dashboard.summary', await ctx.invoke('dashboard.summary')],
        ['patients.list', await ctx.invoke('patients.list', {})],
        ['patients.get', await ctx.invoke('patients.get', { id: patient.id })],
        ['invoices.list', await ctx.invoke('invoices.list', {})],
        ['invoices.get', await ctx.invoke('invoices.get', { id: invoice.id })],
        ['invoices.printModel', await ctx.invoke('invoices.printModel', { id: invoice.id })],
        ['payments.list', await ctx.invoke('payments.list', {})],
        ['payments.get', await ctx.invoke('payments.get', { id: payment.id })],
        ['payments.printModel', await ctx.invoke('payments.printModel', { id: payment.id })],
        ['payments.summary', await ctx.invoke('payments.summary', { from: today, to: today })],
        ['payments.outstandingFor', await ctx.invoke('payments.outstandingFor', { patientId: patient.id })],
        ['accounting.report', await ctx.invoke('accounting.report', { kind: 'daily', from: today, to: today })],
        ['accounting.listIncome', await ctx.invoke('accounting.listIncome', { from: today, to: today })],
        ['accounting.listExpenses', await ctx.invoke('accounting.listExpenses', { from: today, to: today })],
        ['inventory.list', await ctx.invoke('inventory.list', {})],
        ['inventory.get', await ctx.invoke('inventory.get', { id: item.id })],
        ['inventory.valuation', await ctx.invoke('inventory.valuation', {})],
        ['appointments.day', await ctx.invoke('appointments.day', { date: today })],
        ['queue.board', await ctx.invoke('queue.board', { date: today })],
        ['documents.report:income', await ctx.invoke('documents.report', { kind: 'income', from: today, to: today })],
        ['documents.report:outstanding', await ctx.invoke('documents.report', { kind: 'outstanding' })],
        ['documents.report:collection', await ctx.invoke('documents.report', { kind: 'collection', from: today, to: today })],
        ['documents.report:treatment-revenue', await ctx.invoke('documents.report', { kind: 'treatment-revenue', from: today, to: today })],
        ['documents.report:inventory', await ctx.invoke('documents.report', { kind: 'inventory' })],
        ['documents.report:expense', await ctx.invoke('documents.report', { kind: 'expense', from: today, to: today })],
        ['documents.report:payment-summary', await ctx.invoke('documents.report', { kind: 'payment-summary', from: today, to: today })],
        ['documents.report:daily-summary', await ctx.invoke('documents.report', { kind: 'daily-summary', from: today, to: today })],
      ];

      const offenders: string[] = [];
      for (const [name, payload] of reads) {
        audit(payload, name, offenders);
      }
      expect(offenders, `Money must be whole poisha everywhere:\n${offenders.join('\n')}`).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});
