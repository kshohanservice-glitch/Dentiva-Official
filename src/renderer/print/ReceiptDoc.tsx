import type { JSX } from 'react';
import { DocHeader, PatientStrip, Scripted, FormattedDate, FormattedMoney, FormattedTime } from './common';
import type { ClinicIdentity } from './common';
import type { DisplayPrefs } from '../lib/format';

export interface ReceiptModel {
  payment: {
    id: number;
    payment_no: string;
    payment_date: string;
    paid_at: string;
    amount_poisha: number;
    type: 'receipt' | 'refund';
    method: string;
    reference: string | null;
    notes: string;
    invoice_no: string | null;
    patient_name: string;
    patient_code: string;
    phone: string | null;
    received_by_name: string | null;
  };
  allocations: { id: number; invoice_no: string; amount_poisha: number }[];
  clinic: ClinicIdentity;
  logoDataUrl?: string | null;
}

export function ReceiptDocument({ model, prefs }: { model: ReceiptModel; prefs: DisplayPrefs }): JSX.Element {
  const pay = model.payment;
  const isRefund = pay.type === 'refund';
  return (
    <>
      <DocHeader
        clinic={model.clinic}
        title={isRefund ? 'Refund Receipt' : 'Payment Receipt'}
        number={pay.payment_no}
        issuedAt={`${FormattedDate(pay.payment_date, prefs)}, ${FormattedTime(pay.paid_at, prefs)}`}
        logo={model.logoDataUrl ?? null}
      />

      <PatientStrip
        compact
        entries={[
          { k: 'Received from', v: pay.patient_name, script: true },
          { k: 'Code', v: pay.patient_code },
          { k: 'Phone', v: pay.phone || '—' },
          { k: 'Method', v: `${pay.method.charAt(0).toUpperCase()}${pay.method.slice(1)}` },
        ]}
      />

      <div className="doc-band">
        <div className="doc-band-item">
          <div className="doc-band-label">{isRefund ? 'Amount refunded' : 'Amount received'}</div>
          <div className="doc-band-value" style={{ color: isRefund ? '#b42318' : '#067a56' }}>
            {isRefund ? '−' : ''}{FormattedMoney(pay.amount_poisha, prefs)}
          </div>
        </div>
        {pay.received_by_name ? (
          <div className="doc-band-item">
            <div className="doc-band-label">Received by</div>
            <div className="doc-band-value" style={{ fontSize: '9pt' }}><Scripted>{pay.received_by_name}</Scripted></div>
          </div>
        ) : null}
        {pay.reference ? (
          <div className="doc-band-item">
            <div className="doc-band-label">Reference</div>
            <div className="doc-band-value" style={{ fontSize: '9pt' }}>{pay.reference}</div>
          </div>
        ) : null}
      </div>

      {model.allocations.length > 0 ? (
        <table className="doc-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th className="num">Amount applied</th>
            </tr>
          </thead>
          <tbody>
            {model.allocations.map((allocation) => (
              <tr key={allocation.id}>
                <td>{allocation.invoice_no}</td>
                <td className="num">{FormattedMoney(allocation.amount_poisha, prefs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {pay.notes ? (
        <div className="doc-section-block">
          <h3>Notes</h3>
          <div className="doc-section-body"><Scripted>{pay.notes}</Scripted></div>
        </div>
      ) : null}

      <footer className="doc-foot">
        <div className="doc-foot-message">
          {model.clinic.footer_message ? <Scripted>{model.clinic.footer_message}</Scripted> : null}
        </div>
        <div className="doc-signature">
          <div className="doc-signature__line" style={{ marginTop: 12 }}>
            <div className="doc-signature__name">
              {pay.received_by_name ? <Scripted>{pay.received_by_name}</Scripted> : 'Cashier'}
            </div>
            <div className="doc-signature__title">Received with thanks</div>
          </div>
        </div>
      </footer>
    </>
  );
}
