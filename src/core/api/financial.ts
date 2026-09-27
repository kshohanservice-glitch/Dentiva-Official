import { nowIso } from '../db/connection';
import { Container } from '../container';
import { fieldError, notFound, conflict, businessRule } from '../errors';
import { Validator } from '../validation/validate';
import { toLocalDateKey } from '../money/format';
import { percentOf, multiplyByMilliQuantity, qtyToMilli } from '../money/money';
import { PAYMENT_METHOD_CODES, PAYMENT_METHOD_LABELS } from '../../shared/constants';
import { paginate, readPaging, dateRangeFrom, patientFinancialSummary } from './patients';
import type { ApiSpec } from '../registry';
import type { Actor } from '../security/rbac';

export interface InvoiceLineInput {
  treatmentId: number | null;
  description: string;
  toothCode: string;
  qtyMilli: number;
  unitPricePoisha: number;
  discountPoisha: number;
  taxPoisha: number;
}

export interface ComputedInvoice {
  subtotalPoisha: number;
  discountPoisha: number;
  taxPoisha: number;
  grandTotalPoisha: number;
  lines: (InvoiceLineInput & { lineTotalPoisha: number })[];
}

/**
 * The single place invoice money is calculated. Every code path — create, edit,
 * recalculation and the reconciliation tests — goes through this function, so a
 * printed invoice can never disagree with the stored totals.
 */
export function computeInvoice(lines: InvoiceLineInput[], discountPercentBp: number, extraDiscountPoisha: number, taxPercentBp: number): ComputedInvoice {
  let subtotal = 0;
  let lineDiscount = 0;
  let lineTax = 0;
  const computed = lines.map((line) => {
    const gross = multiplyByMilliQuantity(line.unitPricePoisha, line.qtyMilli);
    const lineTotal = gross - line.discountPoisha + line.taxPoisha;
    subtotal += gross;
    lineDiscount += line.discountPoisha;
    lineTax += line.taxPoisha;
    return { ...line, lineTotalPoisha: lineTotal };
  });
  const percentDiscount = percentOf(subtotal, discountPercentBp);
  const discountTotal = percentDiscount + extraDiscountPoisha + lineDiscount;
  const taxOnDiscountable = subtotal - percentDiscount - extraDiscountPoisha;
  const percentTax = percentOf(taxOnDiscountable, taxPercentBp);
  const taxTotal = lineTax + percentTax;
  const grandTotal = subtotal - discountTotal + taxTotal;
  return {
    subtotalPoisha: subtotal,
    discountPoisha: discountTotal,
    taxPoisha: taxTotal,
    grandTotalPoisha: grandTotal,
    lines: computed,
  };
}

export function invoiceStatusFor(grandTotal: number, paid: number): 'unpaid' | 'partial' | 'paid' | 'cancelled' {
  if (paid <= 0) return 'unpaid';
  if (paid >= grandTotal) return 'paid';
  return 'partial';
}

/** Recompute and persist the cached paid amount + status for one invoice. */
export function refreshInvoiceTotals(c: Container, invoiceId: number): void {
  const inv = c.db.get<{ grand_total_poisha: number; status: string }>(
    'SELECT grand_total_poisha, status FROM invoices WHERE id = ?',
    [invoiceId],
  );
  if (!inv) return;
  const allocated = c.db.count('SELECT 0 AS n', []);
  void allocated;
  const row = c.db.get<{ total: number }>(
    'SELECT COALESCE(SUM(amount_poisha), 0) AS total FROM payment_allocations WHERE invoice_id = ?',
    [invoiceId],
  );
  const paid = Number(row?.total ?? 0);
  const status = inv.status === 'cancelled' ? 'cancelled' : invoiceStatusFor(Number(inv.grand_total_poisha), paid);
  c.db.run('UPDATE invoices SET paid_poisha = ?, status = ?, updated_at = ? WHERE id = ?', [paid, status, nowIso(), invoiceId]);
}

export function readInvoiceLines(input: unknown): InvoiceLineInput[] {
  const body = (input ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(body.items) ? body.items : [];
  const issues: { field: string; message: string }[] = [];
  const lines: InvoiceLineInput[] = [];
  raw.forEach((item, index) => {
    const v = new Validator(item, `items[${index}]`);
    const description = v.string('description', { required: true, min: 1, max: 200, label: 'Item description' });
    const qtyMilli = v.int('qtyMilli', { min: 1, max: 1000000, label: 'Quantity' });
    const unitPricePoisha = v.int('unitPricePoisha', { min: 0, max: 100000000000, label: 'Unit price' });
    const discountPoisha = v.int('discountPoisha', { min: 0, max: 100000000000 });
    const taxPoisha = v.int('taxPoisha', { min: 0, max: 100000000000 });
    const toothCode = v.string('toothCode', { max: 4 });
    const treatmentId = v.optionalInt('treatmentId');
    if (unitPricePoisha < 0) issues.push({ field: `items[${index}].unitPricePoisha`, message: 'Unit price cannot be negative.' });
    if (discountPoisha > 0 && unitPricePoisha * qtyMilli < discountPoisha) {
      issues.push({ field: `items[${index}].discountPoisha`, message: 'Line discount cannot be greater than the line amount.' });
    }
    if (!description) return;
    lines.push({ treatmentId, description, toothCode, qtyMilli, unitPricePoisha, discountPoisha, taxPoisha });
  });
  if (issues.length) throw fieldError(issues, 'Please correct the invoice lines.');
  return lines;
}

export const financialApi: ApiSpec = {
  invoices: {
    list: {
      perms: ['invoices.view'],
      label: 'List invoices',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.optionalInt('patientId');
        const status = v.enum('status', ['', 'unpaid', 'partial', 'paid', 'cancelled'] as const);
        const search = v.string('search', { max: 120 });
        const { from, to } = dateRangeFrom(input);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where = ['i.deleted_at IS NULL'];
        const params: (string | number)[] = [];
        if (patientId) { where.push('i.patient_id = ?'); params.push(patientId); }
        if (status) { where.push('i.status = ?'); params.push(status); }
        if (from) { where.push('i.issue_date >= ?'); params.push(from); }
        if (to) { where.push('i.issue_date <= ?'); params.push(to); }
        if (search) {
          where.push('(i.invoice_no LIKE ? COLLATE NOCASE OR p.full_name LIKE ? COLLATE NOCASE OR p.patient_code LIKE ?)');
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        const whereSql = where.join(' AND ');
        const total = c.db.count(
          `SELECT COUNT(*) AS n FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE ${whereSql}`,
          params,
        );
        const rows = c.db.all(
          `SELECT i.*, p.full_name AS patient_name, p.patient_code, p.phone,
                  (i.grand_total_poisha - i.paid_poisha) AS balance_poisha
             FROM invoices i JOIN patients p ON p.id = i.patient_id
            WHERE ${whereSql} ORDER BY i.issue_date DESC, i.id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    get: {
      perms: ['invoices.view'],
      label: 'Read invoice',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const invoice = c.db.get(
          `SELECT i.*, p.full_name AS patient_name, p.patient_code, p.phone, p.address, p.gender, p.age_years, p.age_months,
                  p.date_of_birth, (i.grand_total_poisha - i.paid_poisha) AS balance_poisha,
                  cl.name AS clinic_name, cl.address_line AS clinic_address, cl.area AS clinic_area, cl.district AS clinic_district,
                  cl.phone AS clinic_phone, cl.email AS clinic_email, cl.website, cl.logo_attachment_id, cl.footer_message
             FROM invoices i JOIN patients p ON p.id = i.patient_id CROSS JOIN clinic cl
            WHERE i.id = ? AND i.deleted_at IS NULL`,
          [id],
        );
        if (!invoice) throw notFound('Invoice');
        const items = c.db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id', [id]);
        const allocations = c.db.all(
          `SELECT a.*, pay.payment_no, pay.payment_date, pay.method, pay.paid_at
             FROM payment_allocations a JOIN payments pay ON pay.id = a.payment_id
            WHERE a.invoice_id = ? ORDER BY pay.paid_at DESC`,
          [id],
        );
        return { invoice, items, allocations };
      },
    },
    create: {
      perms: ['invoices.create'],
      label: 'Create invoice',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const visitId = v.optionalInt('visitId');
        const issueDate = v.dateKey('issueDate', { required: true, label: 'Invoice date' });
        const dueDate = v.optionalString('dueDate', 10);
        const notes = v.string('notes', { max: 1000 });
        const discountPercentBp = v.int('discountPercentBp', { min: 0, max: 10000 });
        const discountPoisha = v.int('discountPoisha', { min: 0, max: 100000000000 });
        const taxPercentBp = v.int('taxPercentBp', { min: 0, max: 10000 });
        v.throwIfInvalid('Please correct the highlighted fields.');

        const lines = readInvoiceLines(input);
        if (lines.length === 0) {
          throw fieldError([{ field: 'items', message: 'Add at least one line item to the invoice.' }]);
        }
        if (!c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId])) throw notFound('Patient');
        if (visitId && !c.db.get('SELECT id FROM visits WHERE id = ?', [visitId])) throw notFound('Visit');

        const computed = computeInvoice(lines, discountPercentBp, discountPoisha, taxPercentBp);
        if (computed.grandTotalPoisha < 0) {
          throw fieldError([{ field: 'discountPoisha', message: 'The discount is greater than the invoice total.' }]);
        }

        return c.db.transaction(() => {
          const now = nowIso();
          const prefix = c.settings.get('financial.invoicePrefix') || 'INV';
          const invoiceNo = c.nextDocumentNo(prefix, 'invoices', 'invoice_no');
          const id = c.db.insert(
            `INSERT INTO invoices (invoice_no, patient_id, visit_id, issue_date, due_date, subtotal_poisha, discount_poisha,
               discount_percent_bp, tax_poisha, tax_percent_bp, grand_total_poisha, paid_poisha, status, notes, created_at, created_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
            [invoiceNo, patientId, visitId, issueDate, dueDate || null, computed.subtotalPoisha, computed.discountPoisha,
              discountPercentBp, computed.taxPoisha, taxPercentBp, computed.grandTotalPoisha,
              invoiceStatusFor(computed.grandTotalPoisha, 0), notes, now, actor?.userId ?? null, now],
          );
          computed.lines.forEach((line, index) => {
            c.db.run(
              `INSERT INTO invoice_items (invoice_id, treatment_id, description, tooth_code, qty_milli, unit_price_poisha,
                 discount_poisha, tax_poisha, line_total_poisha, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, line.treatmentId, line.description, line.toothCode || null, line.qtyMilli, line.unitPricePoisha,
                line.discountPoisha, line.taxPoisha, line.lineTotalPoisha, index],
            );
          });
          refreshInvoiceTotals(c, id);
          c.audit(actor, {
            action: 'invoices.create', entity: 'invoice', entityId: id,
            summary: `Invoice ${invoiceNo} created for patient #${patientId}`,
            metadata: { no: invoiceNo, grandTotalPoisha: computed.grandTotalPoisha },
          });
          return c.db.get('SELECT * FROM invoices WHERE id = ?', [id]);
        });
      },
    },
    update: {
      perms: ['invoices.edit'],
      label: 'Update invoice',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const existing = c.db.get<{ status: string; grand_total_poisha: number; paid_poisha: number }>(
          'SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!existing) throw notFound('Invoice');
        if (existing.status === 'cancelled') throw conflict('A cancelled invoice cannot be edited.');
        const issueDate = v.dateKey('issueDate', { required: true, label: 'Invoice date' });
        const dueDate = v.optionalString('dueDate', 10);
        const notes = v.string('notes', { max: 1000 });
        const discountPercentBp = v.int('discountPercentBp', { min: 0, max: 10000 });
        const discountPoisha = v.int('discountPoisha', { min: 0, max: 100000000000 });
        const taxPercentBp = v.int('taxPercentBp', { min: 0, max: 10000 });
        v.throwIfInvalid();

        const lines = readInvoiceLines(input);
        if (lines.length === 0) throw fieldError([{ field: 'items', message: 'An invoice must have at least one line item.' }]);
        const computed = computeInvoice(lines, discountPercentBp, discountPoisha, taxPercentBp);
        if (computed.grandTotalPoisha < Number(existing.paid_poisha)) {
          throw businessRule(
            'The new total is lower than the amount already paid. Remove the payment allocation before reducing the invoice total.',
          );
        }

        c.db.transaction(() => {
          c.db.run(
            `UPDATE invoices SET issue_date = ?, due_date = ?, subtotal_poisha = ?, discount_poisha = ?, discount_percent_bp = ?,
               tax_poisha = ?, tax_percent_bp = ?, grand_total_poisha = ?, notes = ?, updated_at = ? WHERE id = ?`,
            [issueDate, dueDate || null, computed.subtotalPoisha, computed.discountPoisha, discountPercentBp,
              computed.taxPoisha, taxPercentBp, computed.grandTotalPoisha, notes, nowIso(), id],
          );
          c.db.run('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
          computed.lines.forEach((line, index) => {
            c.db.run(
              `INSERT INTO invoice_items (invoice_id, treatment_id, description, tooth_code, qty_milli, unit_price_poisha,
                 discount_poisha, tax_poisha, line_total_poisha, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, line.treatmentId, line.description, line.toothCode || null, line.qtyMilli, line.unitPricePoisha,
                line.discountPoisha, line.taxPoisha, line.lineTotalPoisha, index],
            );
          });
          refreshInvoiceTotals(c, id);
          c.audit(actor, { action: 'invoices.update', entity: 'invoice', entityId: id, summary: `Invoice #${id} updated` });
        });
        return c.db.get('SELECT * FROM invoices WHERE id = ?', [id]);
      },
    },
    cancel: {
      perms: ['invoices.edit'],
      label: 'Cancel invoice',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const reason = v.string('reason', { required: true, max: 300, label: 'Reason' });
        v.throwIfInvalid();
        const invoice = c.db.get<{ invoice_no: string; paid_poisha: number }>(
          'SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!invoice) throw notFound('Invoice');
        if (Number(invoice.paid_poisha) > 0) {
          throw businessRule('This invoice has payments against it. Issue a refund before cancelling.');
        }
        c.db.run("UPDATE invoices SET status = 'cancelled', notes = notes || ?, updated_at = ? WHERE id = ?", [
          `\n[Cancelled: ${reason}]`, nowIso(), id,
        ]);
        c.audit(actor, { action: 'invoices.cancel', entity: 'invoice', entityId: id, summary: `Invoice ${invoice.invoice_no} cancelled: ${reason}` });
        return c.db.get('SELECT * FROM invoices WHERE id = ?', [id]);
      },
    },
    delete: {
      perms: ['invoices.delete'],
      label: 'Delete invoice',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const confirmNo = v.string('confirmInvoiceNo', { required: true, max: 40, label: 'Invoice number confirmation' });
        v.throwIfInvalid('Type the invoice number to confirm deletion.');
        const invoice = c.db.get<{ invoice_no: string; paid_poisha: number }>(
          'SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!invoice) throw notFound('Invoice');
        if (invoice.invoice_no !== confirmNo) {
          throw fieldError([{ field: 'confirmInvoiceNo', message: 'The invoice number does not match.' }], 'The invoice number does not match.');
        }
        if (Number(invoice.paid_poisha) > 0) {
          throw businessRule('This invoice has payments recorded against it and cannot be deleted. Cancel it instead so the audit trail is preserved.');
        }
        c.db.run('UPDATE invoices SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id]);
        c.audit(actor, { action: 'invoices.delete', entity: 'invoice', entityId: id, summary: `Invoice ${invoice.invoice_no} deleted` });
        return { ok: true };
      },
    },
    printModel: {
      perms: ['invoices.view'],
      label: 'Build invoice print model',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const { invoice, items, allocations } = getInvoiceModel(c, id);
        return {
          invoice,
          items,
          allocations,
          clinic: c.db.get('SELECT * FROM clinic WHERE id = 1') ?? {},
          // An invoice is issued by the clinic. A clinician is only shown when
          // the clinic explicitly turns that on, which the core never does.
          showDentist: c.settings.get('print.showDentistOnInvoice'),
          footerMessage: c.settings.get('print.invoiceFooter') || '',
        };
      },
    },
  },

  payments: {
    list: {
      perms: ['payments.view'],
      label: 'List payments',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.optionalInt('patientId');
        const method = v.enum('method', ['', ...PAYMENT_METHOD_CODES] as const);
        const search = v.string('search', { max: 120 });
        const { from, to } = dateRangeFrom(input);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where = ['p.deleted_at IS NULL'];
        const params: (string | number)[] = [];
        if (patientId) { where.push('p.patient_id = ?'); params.push(patientId); }
        if (method) { where.push('p.method = ?'); params.push(method); }
        if (from) { where.push('p.payment_date >= ?'); params.push(from); }
        if (to) { where.push('p.payment_date <= ?'); params.push(to); }
        if (search) {
          where.push('(p.payment_no LIKE ? COLLATE NOCASE OR pt.full_name LIKE ? COLLATE NOCASE OR pt.patient_code LIKE ?)');
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        const whereSql = where.join(' AND ');
        const total = c.db.count(
          `SELECT COUNT(*) AS n FROM payments p JOIN patients pt ON pt.id = p.patient_id WHERE ${whereSql}`,
          params,
        );
        const rows = c.db.all(
          `SELECT p.*, pt.full_name AS patient_name, pt.patient_code, u.display_name AS received_by_name,
                  COALESCE((SELECT SUM(a.amount_poisha) FROM payment_allocations a WHERE a.payment_id = p.id), 0) AS allocated_poisha
             FROM payments p JOIN patients pt ON pt.id = p.patient_id LEFT JOIN users u ON u.id = p.received_by
            WHERE ${whereSql} ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    get: {
      perms: ['payments.view'],
      label: 'Read payment',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const payment = c.db.get(
          `SELECT p.*, pt.full_name AS patient_name, pt.patient_code, u.display_name AS received_by_name,
                  cl.name AS clinic_name, cl.address_line AS clinic_address, cl.phone AS clinic_phone, cl.logo_attachment_id
             FROM payments p JOIN patients pt ON pt.id = p.patient_id
             LEFT JOIN users u ON u.id = p.received_by CROSS JOIN clinic cl
            WHERE p.id = ? AND p.deleted_at IS NULL`,
          [id],
        );
        if (!payment) throw notFound('Payment');
        const allocations = c.db.all(
          `SELECT a.*, i.invoice_no, i.issue_date, i.grand_total_poisha, i.paid_poisha
             FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = ?`,
          [id],
        );
        return {
          payment,
          allocations,
          clinic: c.db.get('SELECT * FROM clinic WHERE id = 1') ?? {},
          settings: {
            bengaliNumerals: c.settings.get('display.bengaliNumerals'),
            currencySymbol: c.settings.get('clinic.currencySymbol'),
            dateFormat: c.settings.get('format.dateFormat'),
            receiptFooter: c.settings.get('print.prescriptionFooter') || '',
          },
        };
      },
    },
    outstandingFor: {
      perms: ['payments.view'],
      label: 'Outstanding invoices for a patient',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        v.throwIfInvalid();
        return c.db.all(
          `SELECT id, invoice_no, issue_date, grand_total_poisha, paid_poisha,
                  (grand_total_poisha - paid_poisha) AS balance_poisha
             FROM invoices WHERE patient_id = ? AND deleted_at IS NULL AND status <> 'cancelled'
               AND (grand_total_poisha - paid_poisha) > 0 ORDER BY issue_date, id`,
          [patientId],
        );
      },
    },
    create: {
      perms: ['payments.create'],
      label: 'Record payment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const amount = v.int('amountPoisha', { required: true, min: 1, max: 100000000000, label: 'Amount' });
        const method = v.enum('method', PAYMENT_METHOD_CODES, { required: true, label: 'Payment method' });
        const paymentDate = v.dateKey('paymentDate', { required: true, label: 'Payment date' });
        const reference = v.string('reference', { max: 120 });
        const notes = v.string('notes', { max: 500 });
        const type = v.enum('type', ['receipt', 'refund'] as const);
        const allocations = v.array('allocations', (x) => {
          const a = new Validator(x, 'allocations');
          const invoiceId = a.int('invoiceId', { required: true, min: 1 });
          const amt = a.int('amountPoisha', { min: 1, max: 100000000000, label: 'Amount' });
          a.throwIfInvalid();
          return { invoiceId, amountPoisha: amt };
        }, { maxItems: 200, label: 'Allocations' });
        v.throwIfInvalid('Please correct the highlighted fields.');

        if (!c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId])) throw notFound('Patient');

        const allowOverpayment = c.settings.get('financial.allowOverpayment');
        const isRefund = type === 'refund';
        let allocatedTotal = 0;
        const touched: number[] = [];
        for (const alloc of allocations) {
          const invoice = c.db.get<{ id: number; invoice_no: string; grand_total_poisha: number; paid_poisha: number; status: string; patient_id: number }>(
            'SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL',
            [alloc.invoiceId],
          );
          if (!invoice) throw notFound(`Invoice #${alloc.invoiceId}`);
          if (invoice.patient_id !== patientId) throw businessRule('A payment can only be allocated to invoices for the same patient.');
          if (invoice.status === 'cancelled') throw businessRule(`Invoice ${invoice.invoice_no} is cancelled and cannot receive a payment.`);

          // A receipt fills an invoice up; a refund takes money back off one. Each
          // is bounded by a different amount, so each is checked against the one
          // that actually applies.
          if (isRefund) {
            const collected = Number(invoice.paid_poisha);
            if (alloc.amountPoisha > collected) {
              throw businessRule(
                `The refund of ৳${(alloc.amountPoisha / 100).toFixed(2)} is more than the ৳${(collected / 100).toFixed(2)} collected on invoice ${invoice.invoice_no}.`,
              );
            }
            if (Number(invoice.grand_total_poisha) - (collected - alloc.amountPoisha) < 0) {
              throw businessRule(`A refund cannot take invoice ${invoice.invoice_no} below zero.`);
            }
          } else {
            const balance = Number(invoice.grand_total_poisha) - Number(invoice.paid_poisha);
            if (alloc.amountPoisha > balance && !allowOverpayment) {
              throw businessRule(
                `The allocation of ৳${(alloc.amountPoisha / 100).toFixed(2)} exceeds the outstanding balance of ৳${(balance / 100).toFixed(2)} on invoice ${invoice.invoice_no}.`,
              );
            }
          }
          allocatedTotal += alloc.amountPoisha;
          touched.push(invoice.id);
        }
        if (isRefund) {
          if (allocations.length === 0) throw fieldError([{ field: 'allocations', message: 'Select the invoice this refund applies to.' }]);
          if (allocatedTotal !== amount) {
            throw fieldError(
              [{ field: 'allocations', message: `The refund of ৳${(amount / 100).toFixed(2)} must be allocated in full across invoices.` }],
              'The refund must be fully allocated.',
            );
          }
        } else if (allocatedTotal > amount) {
          throw fieldError([{ field: 'allocations', message: 'The allocated amounts are greater than the payment amount.' }]);
        } else if (allocatedTotal < amount && !allowOverpayment) {
          throw fieldError(
            [{ field: 'allocations', message: `Allocate the full ৳${(amount / 100).toFixed(2)} across invoices, or record the difference as an advance.` }],
            'The payment must be fully allocated. Enable "Allow overpayment" in Financial settings to record advances.',
          );
        }

        return c.db.transaction(() => {
          const now = nowIso();
          const prefix = c.settings.get('financial.paymentPrefix') || 'PAY';
          const paymentNo = c.nextDocumentNo(prefix, 'payments', 'payment_no');
          const id = c.db.insert(
            `INSERT INTO payments (payment_no, patient_id, payment_date, paid_at, method, amount_poisha, type, reference, notes, received_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [paymentNo, patientId, paymentDate, now, method, type === 'refund' ? -amount : amount, type, reference, notes, actor?.userId ?? null, now],
          );
          for (const alloc of allocations) {
            const signed = type === 'refund' ? -alloc.amountPoisha : alloc.amountPoisha;
            c.db.run('INSERT INTO payment_allocations (payment_id, invoice_id, amount_poisha) VALUES (?, ?, ?)', [id, alloc.invoiceId, signed]);
          }
          for (const invoiceId of new Set(touched)) refreshInvoiceTotals(c, invoiceId);
          c.audit(actor, {
            action: 'payments.create', entity: 'payment', entityId: id,
            summary: `${type === 'refund' ? 'Refund' : 'Payment'} ${paymentNo} of ৳${(amount / 100).toFixed(2)} via ${PAYMENT_METHOD_LABELS[method]}`,
            metadata: { no: paymentNo, amountPoisha: amount, method, allocations: allocations.length },
          });
          return c.db.get('SELECT * FROM payments WHERE id = ?', [id]);
        });
      },
    },
    delete: {
      perms: ['payments.refund'],
      label: 'Reverse payment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const reason = v.string('reason', { required: true, max: 300, label: 'Reason' });
        v.throwIfInvalid();
        const payment = c.db.get<{ payment_no: string }>('SELECT * FROM payments WHERE id = ? AND deleted_at IS NULL', [id]);
        if (!payment) throw notFound('Payment');
        return c.db.transaction(() => {
          const allocations = c.db.all<{ invoice_id: number; amount_poisha: number }>(
            'SELECT invoice_id, amount_poisha FROM payment_allocations WHERE payment_id = ?',
            [id],
          );
          c.db.run('UPDATE payments SET deleted_at = ?, notes = notes || ? WHERE id = ?', [
            nowIso(), `\n[Reversed: ${reason}]`, id,
          ]);
          for (const alloc of allocations) refreshInvoiceTotals(c, alloc.invoice_id);
          c.audit(actor, { action: 'payments.delete', entity: 'payment', entityId: id, summary: `Payment ${payment.payment_no} reversed: ${reason}` });
          return { ok: true };
        });
      },
    },
    summary: {
      perms: ['payments.view'],
      label: 'Payment summary',
      handler: ({ c }, input: unknown) => {
        const { from, to } = dateRangeFrom(input);
        const params: string[] = [];
        let where = 'WHERE p.deleted_at IS NULL';
        if (from) { where += ' AND p.payment_date >= ?'; params.push(from); }
        if (to) { where += ' AND p.payment_date <= ?'; params.push(to); }
        const byMethod = c.db.all(
          `SELECT p.method, p.type, SUM(p.amount_poisha) AS total_poisha, COUNT(*) AS count
             FROM payments p ${where} GROUP BY p.method, p.type ORDER BY p.method`,
          params,
        );
        const outstanding = c.db.get<{ total: number }>(
          `SELECT COALESCE(SUM(grand_total_poisha - paid_poisha), 0) AS total FROM invoices
            WHERE deleted_at IS NULL AND status NOT IN ('cancelled') AND (grand_total_poisha - paid_poisha) > 0`,
        );
        const walletCodes = ['bkash', 'nagad', 'rocket', 'upay'];
        let received = 0;
        let refunds = 0;
        let wallet = 0;
        let cash = 0;
        for (const row of byMethod) {
          const total = Number(row.total_poisha);
          if (row.type === 'refund') refunds += Math.abs(total);
          else {
            received += total;
            if (walletCodes.includes(String(row.method))) wallet += total;
            if (row.method === 'cash') cash += total;
          }
        }
        return {
          receivedPoisha: received,
          refundPoisha: refunds,
          netPoisha: received - refunds,
          walletPoisha: wallet,
          cashPoisha: cash,
          outstandingPoisha: Number(outstanding?.total ?? 0),
          byMethod,
          from,
          to,
        };
      },
    },
    patientFinancials: {
      perms: ['payments.view'],
      label: 'Patient financial history',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId])) throw notFound('Patient');
        return patientFinancialSummary(c, patientId);
      },
    },
    printModel: {
      perms: ['payments.view'],
      label: 'Build receipt print model',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const payment = c.db.get(
          `SELECT p.*, pt.full_name AS patient_name, pt.patient_code, pt.phone, u.display_name AS received_by_name,
                  cl.name AS clinic_name, cl.address_line AS clinic_address, cl.area AS clinic_area, cl.district AS clinic_district,
                  cl.phone AS clinic_phone, cl.email AS clinic_email, cl.logo_attachment_id, cl.footer_message
             FROM payments p JOIN patients pt ON pt.id = p.patient_id
             LEFT JOIN users u ON u.id = p.received_by CROSS JOIN clinic cl
            WHERE p.id = ? AND p.deleted_at IS NULL`,
          [id],
        );
        if (!payment) throw notFound('Payment');
        const allocations = c.db.all(
          `SELECT a.*, i.invoice_no, i.issue_date, i.grand_total_poisha, i.paid_poisha
             FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = ?`,
          [id],
        );
        return {
          payment,
          allocations,
          clinic: c.db.get('SELECT * FROM clinic WHERE id = 1') ?? {},
          settings: {
            bengaliNumerals: c.settings.get('display.bengaliNumerals'),
            currencySymbol: c.settings.get('clinic.currencySymbol'),
            dateFormat: c.settings.get('format.dateFormat'),
            receiptFooter: c.settings.get('print.prescriptionFooter') || '',
          },
        };
      },
    },
  },

  accounting: {
    listIncome: {
      perms: ['accounting.view'],
      label: 'List income',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        const { from, to } = dateRangeFrom(input);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where = ['e.deleted_at IS NULL'];
        const params: (string | number)[] = [];
        if (from) { where.push('e.entry_date >= ?'); params.push(from); }
        if (to) { where.push('e.entry_date <= ?'); params.push(to); }
        if (search) { where.push('(e.description LIKE ? COLLATE NOCASE OR e.vendor LIKE ? COLLATE NOCASE)'); params.push(`%${search}%`, `%${search}%`); }
        const whereSql = where.join(' AND ');
        const total = c.db.count(`SELECT COUNT(*) AS n FROM income_entries e WHERE ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT e.*, ic.name AS category_name, u.display_name AS recorded_by_name
             FROM income_entries e LEFT JOIN income_categories ic ON ic.id = e.category_id
             LEFT JOIN users u ON u.id = e.recorded_by
            WHERE ${whereSql} ORDER BY e.entry_date DESC, e.id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    createIncome: {
      perms: ['accounting.manage'],
      label: 'Record income',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const entryDate = v.dateKey('entryDate', { required: true, label: 'Date' });
        const amount = v.int('amountPoisha', { required: true, min: 1, max: 100000000000, label: 'Amount' });
        const categoryId = v.optionalInt('categoryId');
        const source = v.enum('source', ['treatment', 'consultation', 'other'] as const);
        const method = v.enum('method', PAYMENT_METHOD_CODES, { required: true, label: 'Payment method' });
        const description = v.string('description', { max: 500 });
        const vendor = v.string('vendor', { max: 200 });
        const reference = v.string('reference', { max: 120 });
        v.throwIfInvalid('Please correct the highlighted fields.');
        const id = c.db.insert(
          `INSERT INTO income_entries (entry_date, amount_poisha, category_id, source, method, description, vendor, reference, recorded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entryDate, amount, categoryId, source, method, description, vendor, reference, actor?.userId ?? null, nowIso()],
        );
        c.audit(actor, { action: 'accounting.income.create', entity: 'income_entry', entityId: id, summary: `Income ৳${(amount / 100).toFixed(2)} recorded` });
        return c.db.get('SELECT * FROM income_entries WHERE id = ?', [id]);
      },
    },
    deleteIncome: {
      perms: ['accounting.manage'],
      label: 'Delete income',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        c.db.run('UPDATE income_entries SET deleted_at = ? WHERE id = ?', [nowIso(), id]);
        c.audit(actor, { action: 'accounting.income.delete', entity: 'income_entry', entityId: id, summary: 'Income entry deleted' });
        return { ok: true };
      },
    },
    listExpenses: {
      perms: ['accounting.view'],
      label: 'List expenses',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const categoryId = v.optionalInt('categoryId');
        const search = v.string('search', { max: 120 });
        const { from, to } = dateRangeFrom(input);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where = ['e.deleted_at IS NULL'];
        const params: (string | number)[] = [];
        if (categoryId) { where.push('e.category_id = ?'); params.push(categoryId); }
        if (from) { where.push('e.entry_date >= ?'); params.push(from); }
        if (to) { where.push('e.entry_date <= ?'); params.push(to); }
        if (search) { where.push('(e.description LIKE ? COLLATE NOCASE OR e.vendor LIKE ? COLLATE NOCASE)'); params.push(`%${search}%`, `%${search}%`); }
        const whereSql = where.join(' AND ');
        const total = c.db.count(`SELECT COUNT(*) AS n FROM expenses e WHERE ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT e.*, ec.name AS category_name, u.display_name AS recorded_by_name, s.full_name AS staff_name
             FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
             LEFT JOIN users u ON u.id = e.recorded_by LEFT JOIN staff s ON s.id = e.staff_id
            WHERE ${whereSql} ORDER BY e.entry_date DESC, e.id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    createExpense: {
      perms: ['accounting.manage'],
      label: 'Record expense',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const entryDate = v.dateKey('entryDate', { required: true, label: 'Date' });
        const amount = v.int('amountPoisha', { required: true, min: 1, max: 100000000000, label: 'Amount' });
        const categoryId = v.optionalInt('categoryId');
        const method = v.enum('method', PAYMENT_METHOD_CODES, { required: true, label: 'Payment method' });
        const description = v.string('description', { required: true, max: 500, label: 'Description' });
        const vendor = v.string('vendor', { max: 200 });
        const reference = v.string('reference', { max: 120 });
        const staffId = v.optionalInt('staffId');
        v.throwIfInvalid('Please correct the highlighted fields.');
        const id = c.db.insert(
          `INSERT INTO expenses (entry_date, amount_poisha, category_id, method, description, vendor, reference, staff_id, recorded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entryDate, amount, categoryId, method, description, vendor, reference, staffId, actor?.userId ?? null, nowIso()],
        );
        c.audit(actor, { action: 'accounting.expense.create', entity: 'expense', entityId: id, summary: `Expense ৳${(amount / 100).toFixed(2)} recorded (${description})` });
        return c.db.get('SELECT * FROM expenses WHERE id = ?', [id]);
      },
    },
    deleteExpense: {
      perms: ['accounting.manage'],
      label: 'Delete expense',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        c.db.run('UPDATE expenses SET deleted_at = ? WHERE id = ?', [nowIso(), id]);
        c.audit(actor, { action: 'accounting.expense.delete', entity: 'expense', entityId: id, summary: 'Expense deleted' });
        return { ok: true };
      },
    },
    categories: {
      perms: ['accounting.view'],
      label: 'List accounting categories',
      handler: ({ c }) => ({
        income: c.db.all('SELECT * FROM income_categories ORDER BY sort_order, name'),
        expense: c.db.all('SELECT * FROM expense_categories ORDER BY sort_order, name'),
      }),
    },
    createCategory: {
      perms: ['accounting.manage'],
      label: 'Create accounting category',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const name = v.string('name', { required: true, min: 2, max: 80, label: 'Category name' });
        const kind = v.enum('kind', ['income', 'expense'] as const, { required: true });
        v.throwIfInvalid();
        const table = kind === 'income' ? 'income_categories' : 'expense_categories';
        if (c.db.get(`SELECT id FROM ${table} WHERE name = ?`, [name])) throw conflict(`"${name}" already exists.`);
        const id = c.db.insert(`INSERT INTO ${table} (name, sort_order) VALUES (?, COALESCE((SELECT MAX(sort_order) FROM ${table}), 0) + 1)`, [name]);
        c.audit(actor, { action: 'accounting.category.create', entity: kind === 'income' ? 'income_category' : 'expense_category', entityId: id, summary: `Category "${name}" created` });
        return c.db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      },
    },
    report: {
      perms: ['accounting.view'],
      label: 'Accounting report',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const kind = v.enum('kind', ['daily', 'monthly', 'category', 'method', 'treatment', 'receivables'] as const);
        const { from, to } = dateRangeFrom(input);
        const toDate = to ?? toLocalDateKey(new Date());
        const fromDate = from ?? `${toDate.slice(0, 4)}-01-01`;

        const totals = c.db.get<{ income: number; expenses: number }>(
          `SELECT
             (SELECT COALESCE(SUM(amount_poisha), 0) FROM income_entries WHERE deleted_at IS NULL AND entry_date BETWEEN ? AND ?) AS income,
             (SELECT COALESCE(SUM(amount_poisha), 0) FROM expenses WHERE deleted_at IS NULL AND entry_date BETWEEN ? AND ?) AS expenses`,
          [fromDate, toDate, fromDate, toDate],
        );
        const invoiceRevenue = c.db.get<{ total: number }>(
          `SELECT COALESCE(SUM(grand_total_poisha), 0) AS total FROM invoices
            WHERE deleted_at IS NULL AND status <> 'cancelled' AND issue_date BETWEEN ? AND ?`,
          [fromDate, toDate],
        );
        const byExpenseCategory = c.db.all(
          `SELECT ec.name AS category, COALESCE(SUM(e.amount_poisha), 0) AS total_poisha, COUNT(*) AS entries
             FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
            WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ? AND ?
            GROUP BY ec.name ORDER BY total_poisha DESC`,
          [fromDate, toDate],
        );
        const byIncomeCategory = c.db.all(
          `SELECT ic.name AS category, COALESCE(SUM(e.amount_poisha), 0) AS total_poisha, COUNT(*) AS entries
             FROM income_entries e LEFT JOIN income_categories ic ON ic.id = e.category_id
            WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ? AND ?
            GROUP BY ic.name ORDER BY total_poisha DESC`,
          [fromDate, toDate],
        );
        const byMethod = c.db.all(
          `SELECT p.method, SUM(p.amount_poisha) AS total_poisha, COUNT(*) AS count FROM payments p
            WHERE p.deleted_at IS NULL AND p.type = 'receipt' AND p.payment_date BETWEEN ? AND ?
            GROUP BY p.method ORDER BY total_poisha DESC`,
          [fromDate, toDate],
        );
        const topTreatments = c.db.all(
          `SELECT ii.description, SUM(ii.line_total_poisha) AS total_poisha, SUM(ii.qty_milli) AS qty_milli
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.issue_date BETWEEN ? AND ?
            GROUP BY ii.description ORDER BY total_poisha DESC LIMIT 15`,
          [fromDate, toDate],
        );
        const receivables = c.db.get<{ total: number; count: number }>(
          `SELECT COALESCE(SUM(grand_total_poisha - paid_poisha), 0) AS total, COUNT(*) AS count FROM invoices
            WHERE deleted_at IS NULL AND status NOT IN ('cancelled') AND (grand_total_poisha - paid_poisha) > 0`,
        );
        const daily = kind === 'daily' || kind === 'monthly'
          ? c.db.all(
              `SELECT d.day,
                 (SELECT COALESCE(SUM(amount_poisha), 0) FROM income_entries WHERE deleted_at IS NULL AND entry_date = d.day) AS income_poisha,
                 (SELECT COALESCE(SUM(amount_poisha), 0) FROM expenses WHERE deleted_at IS NULL AND entry_date = d.day) AS expense_poisha,
                 (SELECT COALESCE(SUM(grand_total_poisha), 0) FROM invoices WHERE deleted_at IS NULL AND status <> 'cancelled' AND issue_date = d.day) AS invoiced_poisha
               FROM (
                 SELECT entry_date AS day FROM income_entries WHERE deleted_at IS NULL AND entry_date BETWEEN ? AND ?
                 UNION SELECT entry_date FROM expenses WHERE deleted_at IS NULL AND entry_date BETWEEN ? AND ?
                 UNION SELECT issue_date FROM invoices WHERE deleted_at IS NULL AND issue_date BETWEEN ? AND ?
               ) d ORDER BY d.day`,
              [fromDate, toDate, fromDate, toDate, fromDate, toDate],
            )
          : [];

        return {
          kind,
          from: fromDate,
          to: toDate,
          incomePoisha: Number(totals?.income ?? 0),
          expensePoisha: Number(totals?.expenses ?? 0),
          netPoisha: Number(totals?.income ?? 0) - Number(totals?.expenses ?? 0),
          invoiceRevenuePoisha: Number(invoiceRevenue?.total ?? 0),
          byExpenseCategory,
          byIncomeCategory,
          byMethod,
          topTreatments,
          receivables: { totalPoisha: Number(receivables?.total ?? 0), count: Number(receivables?.count ?? 0) },
          daily,
        };
      },
    },
  },

  paymentMethods: {
    list: {
      perms: [],
      label: 'List payment methods',
      handler: ({ c }) => c.db.all('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY sort_order'),
    },
    save: {
      perms: ['settings.manage'],
      label: 'Save payment method',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const code = v.string('code', { required: true, max: 24, label: 'Code' });
        const label = v.string('label', { required: true, min: 2, max: 60, label: 'Label' });
        const active = v.bool('isActive', true);
        v.throwIfInvalid();
        c.db.run(
          `INSERT INTO payment_methods (code, label, sort_order, is_active) VALUES (?, ?, COALESCE((SELECT MAX(sort_order) FROM payment_methods), 0) + 1, ?)
           ON CONFLICT(code) DO UPDATE SET label = excluded.label, is_active = excluded.is_active`,
          [code, label, active ? 1 : 0],
        );
        c.audit(actor, { action: 'settings.payment_method', entity: 'payment_method', entityId: code, summary: `Payment method "${label}" saved` });
        return c.db.get('SELECT * FROM payment_methods WHERE code = ?', [code]);
      },
    },
  },
};

function getInvoiceModel(c: Container, id: number) {
  const invoice = c.db.get(
    `SELECT i.*, p.full_name AS patient_name, p.patient_code, p.phone, p.address, p.gender, p.age_years, p.age_months,
            p.date_of_birth, (i.grand_total_poisha - i.paid_poisha) AS balance_poisha,
            cl.name AS clinic_name, cl.address_line AS clinic_address, cl.area AS clinic_area, cl.district AS clinic_district,
            cl.phone AS clinic_phone, cl.email AS clinic_email, cl.website, cl.logo_attachment_id, cl.footer_message
       FROM invoices i JOIN patients p ON p.id = i.patient_id CROSS JOIN clinic cl
      WHERE i.id = ? AND i.deleted_at IS NULL`,
    [id],
  );
  if (!invoice) throw notFound('Invoice');
  const items = c.db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id', [id]);
  const allocations = c.db.all(
    `SELECT a.*, pay.payment_no, pay.payment_date, pay.method FROM payment_allocations a
       JOIN payments pay ON pay.id = a.payment_id WHERE a.invoice_id = ? ORDER BY pay.paid_at DESC`,
    [id],
  );
  return { invoice, items, allocations };
}

export { getInvoiceModel, qtyToMilli };
export type { Actor };
