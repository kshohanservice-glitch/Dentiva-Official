import type { JSX } from 'react';
import { DocHeader, PatientStrip, DocFooter, Scripted, AgeText, FormattedDate, FormattedMoney, toBengaliEnglishWords } from './common';
import type { ClinicIdentity } from './common';
import { quantityLabel, type DisplayPrefs } from '../lib/format';

export interface InvoiceModel {
  invoice: {
    id: number;
    invoice_no: string;
    issue_date: string;
    due_date: string | null;
    subtotal_poisha: number;
    discount_poisha: number;
    discount_percent_bp: number;
    tax_poisha: number;
    tax_percent_bp: number;
    grand_total_poisha: number;
    paid_poisha: number;
    balance_poisha: number;
    status: 'unpaid' | 'partial' | 'paid' | 'cancelled';
    notes: string;
    patient_name: string;
    patient_code: string;
    phone: string | null;
    address: string | null;
    gender: string;
    age_years: number | null;
    age_months: number | null;
    date_of_birth: string | null;
  };
  items: {
    id: number;
    description: string;
    tooth_code: string | null;
    qty_milli: number;
    unit_price_poisha: number;
    discount_poisha: number;
    tax_poisha: number;
    line_total_poisha: number;
  }[];
  allocations: { id: number; payment_no: string; payment_date: string; method: string; amount_poisha: number }[];
  clinic: ClinicIdentity;
  showDentist: boolean;
  footerMessage: string;
  logoDataUrl?: string | null;
}

const STAMP: Record<string, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'doc-stamp--paid' },
  partial: { label: 'Partially paid', className: 'doc-stamp--partial' },
  unpaid: { label: 'Unpaid', className: 'doc-stamp--unpaid' },
  cancelled: { label: 'Cancelled', className: 'doc-stamp--unpaid' },
};

export function InvoiceDocument({ model, prefs }: { model: InvoiceModel; prefs: DisplayPrefs }): JSX.Element {
  const inv = model.invoice;
  const stamp = STAMP[inv.status] ?? STAMP.unpaid!;
  const showTotalsBlock = model.items.length > 6;

  return (
    <>
      <DocHeader
        clinic={model.clinic}
        title="Invoice"
        number={inv.invoice_no}
        issuedAt={FormattedDate(inv.issue_date, prefs)}
        logo={model.logoDataUrl ?? null}
      />

      <PatientStrip
        compact
        entries={[
          { k: 'Patient', v: inv.patient_name, script: true },
          { k: 'Code', v: inv.patient_code },
          { k: 'Age', v: AgeText(inv, prefs) },
          { k: 'Phone', v: inv.phone || '—' },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, gap: 6 }}>
        <div style={{ fontSize: '8.2pt', color: '#4a5b6a' }}>
          {inv.due_date ? <>Due: {FormattedDate(inv.due_date, prefs)}</> : null}
        </div>
        <span className={`doc-stamp ${stamp.className}`}>{stamp.label}</span>
      </div>

      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: '7%' }}>#</th>
            <th>Description</th>
            <th className="num" style={{ width: '13%' }}>Qty</th>
            <th className="num" style={{ width: '17%' }}>Rate</th>
            <th className="num" style={{ width: '20%' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {model.items.map((item, index) => (
            <tr key={item.id}>
              <td>{index + 1}</td>
              <td>
                <Scripted>{item.description}</Scripted>
                {item.tooth_code ? <span style={{ color: '#5a6b7a' }}> (Tooth {item.tooth_code})</span> : null}
                {item.discount_poisha > 0 ? (
                  <div style={{ fontSize: '7.4pt', color: '#067a56' }}>
                    Discount −{FormattedMoney(item.discount_poisha, prefs)}
                  </div>
                ) : null}
              </td>
              <td className="num">{quantityLabel(item.qty_milli)}</td>
              <td className="num">{FormattedMoney(item.unit_price_poisha, prefs)}</td>
              <td className="num">{FormattedMoney(item.line_total_poisha, prefs)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-totals">
        <div className="doc-totals-row">
          <span>Subtotal</span>
          <span>{FormattedMoney(inv.subtotal_poisha, prefs)}</span>
        </div>
        {inv.discount_poisha > 0 ? (
          <div className="doc-totals-row">
            <span>
              Discount{inv.discount_percent_bp ? ` (${(inv.discount_percent_bp / 100).toFixed(2)}%)` : ''}
            </span>
            <span>−{FormattedMoney(inv.discount_poisha, prefs)}</span>
          </div>
        ) : null}
        {inv.tax_poisha > 0 ? (
          <div className="doc-totals-row">
            <span>Tax{inv.tax_percent_bp ? ` (${(inv.tax_percent_bp / 100).toFixed(2)}%)` : ''}</span>
            <span>{FormattedMoney(inv.tax_poisha, prefs)}</span>
          </div>
        ) : null}
        <div className="doc-totals-row doc-totals-row--grand">
          <span>Grand total</span>
          <span>{FormattedMoney(inv.grand_total_poisha, prefs)}</span>
        </div>
        {inv.paid_poisha > 0 ? (
          <div className="doc-totals-row doc-totals-row--paid">
            <span>Paid</span>
            <span>−{FormattedMoney(inv.paid_poisha, prefs)}</span>
          </div>
        ) : null}
        {inv.status !== 'cancelled' ? (
          <div className={`doc-totals-row ${inv.balance_poisha > 0 ? 'doc-totals-row--due' : 'doc-totals-row--paid'}`}>
            <span>{inv.balance_poisha > 0 ? 'Balance due' : 'Balance'}</span>
            <span>{FormattedMoney(inv.balance_poisha, prefs)}</span>
          </div>
        ) : null}
      </div>

      <div style={{ fontSize: '7.6pt', color: '#5a6b7a', marginTop: 2.5, textAlign: 'right' }}>
        In words: {toBengaliEnglishWords(inv.grand_total_poisha, prefs.bengaliNumerals)}
      </div>

      {model.allocations.length > 0 ? (
        <div className="doc-section-block">
          <h3>Payments received</h3>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date</th>
                <th>Method</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {model.allocations.map((allocation) => (
                <tr key={allocation.id}>
                  <td>{allocation.payment_no}</td>
                  <td>{FormattedDate(allocation.payment_date, prefs)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{allocation.method}</td>
                  <td className="num">{FormattedMoney(allocation.amount_poisha, prefs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {inv.notes ? (
        <div className="doc-section-block">
          <h3>Notes</h3>
          <div className="doc-section-body"><Scripted>{inv.notes}</Scripted></div>
        </div>
      ) : null}

      {showTotalsBlock ? null : null}

      <DocFooter
        message={model.footerMessage || model.clinic.footer_message || ''}
        signature={
          <div className="doc-signature">
            <div className="doc-signature__line" style={{ marginTop: 14 }}>
              <div className="doc-signature__title">
                For <Scripted>{model.clinic.name ?? 'the clinic'}</Scripted>
              </div>
              <div className="doc-signature__reg">Authorised signature</div>
            </div>
          </div>
        }
      />
    </>
  );
}
