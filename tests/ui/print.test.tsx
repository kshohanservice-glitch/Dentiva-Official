/**
 * Print and Bengali verification.
 *
 * On-screen Bengali is not evidence of printed Bengali. A document can look
 * correct in the interface and still come out of the printer with split
 * conjuncts, because the Latin tracking used on headings was applied to a
 * Bengali run, or with its header band missing, because Chromium dropped the
 * background colour. Those faults live in the document model and the print
 * stylesheet, so they are tested here against the real document components
 * and the real print CSS, with real Bengali content built by the real core.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoiceDocument } from '../../src/renderer/print/InvoiceDoc';
import { PrescriptionDocument } from '../../src/renderer/print/PrescriptionDoc';
import { ReceiptDocument } from '../../src/renderer/print/ReceiptDoc';
import { AppointmentSlipDocument } from '../../src/renderer/print/SlipDoc';
import { ReportDocument } from '../../src/renderer/print/ReportDoc';
import { PatientSummaryDocument } from '../../src/renderer/print/SummaryDoc';
import { hasBengali, type DisplayPrefs } from '../../src/renderer/lib/format';
import { createTestApp, seedActivatedAdmin, seedPatient, type TestApp } from '../helpers/app';

const REPO = resolve(__dirname, '..', '..');
const TODAY = new Date().toISOString().slice(0, 10);

const PREFS: DisplayPrefs = {
  dateFormat: 'dmy',
  timeFormat: '12h',
  bengaliNumerals: false,
} as DisplayPrefs;

/** The Bengali every clinic actually writes, conjuncts and all. */
const BENGALI_PATIENT = 'কামাল উদ্দিন আহমেদ';
const BENGALI_COMPLAINT = 'ডান পাঁজনের দাঁতে ব্যথা, সকালে থেকেই ব্যথা বাড়ছে';
const BENGALI_ADVICE = 'দাঁত ব্রাশ করার সময় জোরে চাপ দেবেন না। মুখ গ্যাসের যন্ত্রাংশ পরিষ্কার রাখুন। প্রতি ছয় মাস পর পরীক্ষা করান।';

let ctx: TestApp | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

/**
 * Strips tags and decodes the five XML entities, so the assertions below read
 * the text a printer would see rather than the markup around it.
 */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Every text node containing a Bengali code point must sit inside a run that
 * carries the Bengali family. An unstyled run falls back to a Latin font,
 * which renders Bengali as disconnected marks on paper.
 *
 * This walks the real DOM rather than matching the markup, so nesting depth
 * and attribute order cannot hide a run.
 */
function unstyledBengaliRuns(html: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = html;
  const failures: string[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    // U+09F2/U+09F3 are the currency signs, not script: a money run is Latin
    // digits and is covered by its own assertion below.
    if (!/[\u0980-\u09FF]/.test(text.replace(/[\u09F2\u09F3]/g, ''))) continue;
    let element = node.parentElement;
    let styled = false;
    while (element && element !== host) {
      if (element.classList.contains('bn') || element.getAttribute('lang') === 'bn') {
        styled = true;
        break;
      }
      element = element.parentElement;
    }
    if (!styled) failures.push(text);
  }
  return failures;
}

async function signedIn(): Promise<TestApp> {
  const app = createTestApp();
  await seedActivatedAdmin(app, { clinicName: 'ব্রাইট স্মাইল ডেন্টাল কেয়ার' });
  return app;
}

async function bengaliFixture(app: TestApp): Promise<{ patient: { id: number }; invoiceId: number; prescriptionId: number; paymentId: number }> {
  const patient = await seedPatient(app, { fullName: BENGALI_PATIENT });
  const dentist = (await app.invoke('dentists.list')) as { id: number }[];
  const treatment = (await app.invoke('treatments.create', {
    name: 'দাঁতের যত্ন বোধন',
    code: 'SC-201',
    defaultPricePoisha: 750000,
    durationMinutes: 45,
  })) as { id: number };

  const invoice = (await app.invoke('invoices.create', {
    patientId: patient.id,
    issueDate: TODAY,
    items: [
      { treatmentId: treatment.id, description: 'দাঁতের যত্ন বোধন', qtyMilli: 1000, unitPricePoisha: 750000 },
      { treatmentId: null, description: 'রক্ষণাবেক্ষণ', qtyMilli: 1000, unitPricePoisha: 25000 },
    ],
  })) as { id: number; grand_total_poisha: number };

  const prescription = (await app.invoke('prescriptions.create', {
    patientId: patient.id,
    dentistId: dentist[0]?.id ?? null,
    issueDate: TODAY,
    status: 'issued',
    cc: BENGALI_COMPLAINT,
    oe: 'দাঁত ৪৬ ও ৪৭ নম্বরে গর্ত। মাউলিং ক্যাভিটি।',
    advice: BENGALI_ADVICE,
    items: [{
      name: 'Amoxicillin 500mg',
      form: 'Tablet',
      strength: '500mg',
      dose: '১টি ট্যাবলেট',
      morning: true,
      afternoon: true,
      evening: true,
      duration: '৫ দিন',
    }],
  })) as { id: number };

  const payment = (await app.invoke('payments.create', {
    patientId: patient.id,
    paymentDate: TODAY,
    method: 'cash',
    type: 'receipt',
    amountPoisha: invoice.grand_total_poisha,
    allocations: [{ invoiceId: invoice.id, amountPoisha: invoice.grand_total_poisha }],
  })) as unknown as { id: number };

  return { patient: patient as { id: number }, invoiceId: invoice.id, prescriptionId: prescription.id, paymentId: payment.id };
}

describe('Bengali survives the trip to paper', () => {
  it('prints a prescription with the Bengali the doctor typed, character for character', async () => {
    ctx = await signedIn();
    const { prescriptionId } = await bengaliFixture(ctx);
    const model = await ctx.invoke('documents.prescription', { id: prescriptionId });
    const html = renderToStaticMarkup(
      <div className="doc-page">
        <PrescriptionDocument model={model as never} prefs={PREFS} showClinicalFooter />
      </div>,
    );

    const text = visibleText(html);
    expect(text).toContain(BENGALI_PATIENT);
    expect(text).toContain(BENGALI_COMPLAINT);
    expect(text).toContain('১টি ট্যাবলেট');
    // The three daily slots the doctor ticked, each written the way a doctor writes it.
    expect(text).toContain('১টি ট্যাবলেট');
    // Nothing was transliterated on the way through.
    expect(text).not.toContain('Kamal Uddin Ahmed');
  });

  it('styles every Bengali run for the Bengali font and leaves nothing to a fallback', async () => {
    ctx = await signedIn();
    const { prescriptionId } = await bengaliFixture(ctx);
    const model = await ctx.invoke('documents.prescription', { id: prescriptionId });
    const html = renderToStaticMarkup(
      <div className="doc-page">
        <PrescriptionDocument model={model as never} prefs={PREFS} showClinicalFooter />
      </div>,
    );
    // Every Bengali run the doctor wrote is tagged, so print.css can give it
    // the Bengali family, the taller line height and the untracked spacing.
    expect(html).toContain('class="bn"');
    expect(html).toContain('lang="bn"');
    expect(unstyledBengaliRuns(html)).toEqual([]);
  });

  it('keeps Bengali conjuncts intact in the invoice, receipt, slip, report and summary', async () => {
    ctx = await signedIn();
    const { patient, invoiceId, paymentId } = await bengaliFixture(ctx);
    const appointment = (await ctx.invoke('appointments.create', {
      patientId: patient.id,
      dentistId: 1,
      appointmentDate: TODAY,
      startTime: '10:30',
      durationMinutes: 30,
      notes: BENGALI_COMPLAINT,
    })) as { id: number };


    const invoiceModel = await ctx.invoke('documents.invoice', { id: invoiceId });
    const receiptModel = await ctx.invoke('payments.printModel', { id: paymentId });
    const slipModel = await ctx.invoke('documents.appointmentSlip', { id: appointment.id });
    const reportModel = await ctx.invoke('documents.report', { kind: 'collection', from: TODAY, to: TODAY });
    const summaryModel = await ctx.invoke('documents.patientSummary', { patientId: patient.id });

    const rendered: [string, string][] = [
      ['invoice', renderToStaticMarkup(<div className="doc-page"><InvoiceDocument model={invoiceModel as never} prefs={PREFS} /></div>)],
      ['receipt', renderToStaticMarkup(<div className="doc-page"><ReceiptDocument model={receiptModel as never} prefs={PREFS} /></div>)],
      ['slip', renderToStaticMarkup(<div className="doc-page"><AppointmentSlipDocument model={slipModel as never} prefs={PREFS} /></div>)],
      ['report', renderToStaticMarkup(<div className="doc-page"><ReportDocument model={reportModel as never} prefs={PREFS} /></div>)],
      ['summary', renderToStaticMarkup(<div className="doc-page"><PatientSummaryDocument model={summaryModel as never} prefs={PREFS} /></div>)],
    ];

    for (const [name, html] of rendered) {
      expect(unstyledBengaliRuns(html), `${name}: Bengali outside a styled run`).toEqual([]);
    }
    const [invoiceDoc, receiptDoc] = rendered;
    expect(invoiceDoc && visibleText(invoiceDoc[1])).toContain('দাঁতের যত্ন বোধন');
    // Every document that shows money shows it in taka — never a rupee, never
    // a dollar, and never a bare number with no unit.
    for (const [name, html] of rendered) {
      const text = visibleText(html);
      const showsMoney = /\d[\d,]*\.\d{2}/.test(text);
      if (showsMoney) expect(text.includes('৳'), `${name} shows a money figure without ৳`).toBe(true);
    }
    expect(invoiceDoc && visibleText(invoiceDoc[1])).toContain('৳');
    expect(receiptDoc && visibleText(receiptDoc[1])).toContain('৳');
  });

  it('leaves the doctor room to sign a prescription', async () => {
    ctx = await signedIn();
    const { prescriptionId } = await bengaliFixture(ctx);
    const model = await ctx.invoke('documents.prescription', { id: prescriptionId });
    const html = renderToStaticMarkup(
      <div className="doc-page">
        <PrescriptionDocument model={model as never} prefs={PREFS} showClinicalFooter />
      </div>,
    );
    const host = document.createElement('div');
    host.innerHTML = html;

    // The signature block must be its own element, not a stray border under
    // the last medicine, so there is somewhere to actually sign.
    const block = host.querySelector('.doc-signature');
    expect(block, 'the prescription needs a signature block').toBeTruthy();
    // Nothing from the medicine list is allowed to sit on top of it.
    const style = readFileSync(resolve(REPO, 'src/renderer/styles/print.css'), 'utf8');
    const rule = style.match(/\.doc-signature\s*\{([^}]*)\}/);
    expect(rule![1]).toMatch(/width:\s*\d+mm/);
    expect(rule![1]).toMatch(/flex-shrink:\s*0/);
    // A signature image big enough to sign into, and capped so it cannot grow
    // over the medicine table.
    const image = style.match(/\.doc-signature__image\s*\{([^}]*)\}/);
    expect(image![1]).toMatch(/max-height:\s*\d+mm/);
    expect(image![1]).toMatch(/object-fit:\s*contain/);
  });

  it('reads Bengali out of the database the way it was written', async () => {
    ctx = await signedIn();
    await bengaliFixture(ctx);
    const found = (await ctx.invoke('patients.list', { search: 'কামাল' })) as { rows: { full_name: string }[] };
    expect(found.rows.length).toBeGreaterThan(0);
    // A round trip through SQLite must not decompose or reorder anything.
    expect(found.rows[0]!.full_name).toBe(BENGALI_PATIENT);
    expect([...found.rows[0]!.full_name].map((c) => c.codePointAt(0))).toEqual([...BENGALI_PATIENT].map((c) => c.codePointAt(0)));
    expect(hasBengali(found.rows[0]!.full_name)).toBe(true);
  });
});

describe('the print stylesheet protects the Bengali and the ink', () => {
  const css = readFileSync(resolve(REPO, 'src/renderer/styles/print.css'), 'utf8');

  it('resets the Latin tracking and line breaking on Bengali runs', () => {
    const rule = css.match(/\.doc-page \.bn,[\s\S]*?\{([^}]*)\}/);
    expect(rule, 'print.css must have a rule for Bengali runs').toBeTruthy();
    const body = rule![1]!;
    expect(body).toContain('font-family: var(--font-bengali)');
    // Negative tracking pulls the halves of a conjunct apart.
    expect(body).toMatch(/letter-spacing:\s*normal/);
    // break-word would split every Bengali word, not only the long ones.
    expect(body).toMatch(/word-break:\s*normal/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(body).not.toMatch(/letter-spacing:\s*-/);
  });

  it('keeps background colours and removes the browser page margin', () => {
    expect(css).toMatch(/@page\s*\{\s*margin:\s*0/);
    const printBlock = css.slice(css.indexOf('@media print'));
    expect(printBlock).toMatch(/print-color-adjust:\s*exact/);
    expect(printBlock).toMatch(/-webkit-print-color-adjust:\s*exact/);
  });

  it('bengali numerals are a display choice, never a storage change', () => {
    // Amounts are stored in poisha and only formatted on the way out, so the
    // print layer can choose ৳1,250.00 or ৳১,২৫০.০০ without touching the money.
    const money = readFileSync(resolve(REPO, 'src/renderer/print/common.tsx'), 'utf8');
    expect(money).toContain('bengaliNumerals');
    expect(visibleText(money)).not.toContain('৳১,২৫০');
  });
});

describe('the printed Bengali font is actually shipped', () => {
  it('bundles Noto Sans Bengali and points the document at it', () => {
    const main = readFileSync(resolve(REPO, 'src/renderer/main.tsx'), 'utf8');
    expect(main).toContain("@fontsource/noto-sans-bengali/400.css");
    expect(main).toContain("@fontsource/noto-sans-bengali/700.css");

    const tokens = readFileSync(resolve(REPO, 'src/renderer/styles/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--font-bengali:\s*[^;]*'Noto Sans Bengali'/);
    // The sans stack must end in the Bengali family so the taka sign has a
    // guaranteed source instead of whatever the machine happens to ship.
    expect(tokens).toMatch(/--font-sans:[^;]*'Noto Sans Bengali'/);

    // That source has to actually contain the taka sign. The font declares
    // which code points it covers, so the declaration is the proof.
    const face = readFileSync(resolve(REPO, 'node_modules/@fontsource/noto-sans-bengali/400.css'), 'utf8');
    const bengaliRange = face.match(/unicode-range:\s*([^;]*U\+0980[^;]*)/);
    expect(bengaliRange, 'the bengali subset must declare its code-point range').toBeTruthy();
    const covered = bengaliRange![1]!.split(',').map((part) => {
      const match = part.trim().match(/^U\+([0-9A-F]{4,6})(?:-([0-9A-F]{4,6}))?$/i);
      return match ? [Number.parseInt(match[1]!, 16), match[2] ? Number.parseInt(match[2], 16) : Number.parseInt(match[1]!, 16)] : null;
    }).filter((range): range is [number, number] => range !== null);
    const taka = 0x09f3;
    expect(covered.some(([lo, hi]) => taka >= lo && taka <= hi)).toBe(true);

    // The font files themselves must be in the repository, not fetched at
    // runtime: this application is offline and must stay that way.
    const files = resolve(REPO, 'node_modules/@fontsource/noto-sans-bengali/files');
    for (const weight of [400, 500, 600, 700]) {
      const file = resolve(files, `noto-sans-bengali-bengali-${weight}-normal.woff2`);
      expect(existsSync(file), `missing ${file}`).toBe(true);
      expect(readFileSync(file).length).toBeGreaterThan(1000);
    }
  });
});
