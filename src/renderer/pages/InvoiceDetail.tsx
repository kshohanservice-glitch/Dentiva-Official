import { useCallback, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call, ApiError } from '../lib/api';
import {
  Badge, Button, Callout, Card, DataTable, ErrorState, PageHeader, useConfirm, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { date, money, quantityLabel, STATUS_LABELS } from '../lib/format';
import { runPrint, type PrintOutput } from '../lib/printing';
import { PaymentForm } from './PaymentForm';

interface InvoiceDetailModel {
  invoice: {
    id: number;
    invoice_no: string;
    patient_id: number;
    issue_date: string;
    due_date: string | null;
    subtotal_poisha: number;
    discount_poisha: number;
    tax_poisha: number;
    grand_total_poisha: number;
    paid_poisha: number;
    balance_poisha: number;
    status: string;
    notes: string;
    patient_name: string;
    patient_code: string;
    phone: string | null;
    address: string | null;
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
  allocations: {
    id: number;
    amount_poisha: number;
    payment_id: number;
    payment_no: string;
    payment_date: string;
    method: string;
  }[];
}

const STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger'> = {
  paid: 'ok', partial: 'warn', unpaid: 'danger', cancelled: 'neutral',
};

export function InvoiceDetailPage({ invoiceId }: { invoiceId: string }): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();
  const toast = useToast();
  const confirm = useConfirm();
  const [paying, setPaying] = useState(false);
  const [printing, setPrinting] = useState<PrintOutput | ''>('');
  const [printError, setPrintError] = useState('');

  const detail = useResource(() => call<InvoiceDetailModel>('invoices.get', { id: Number(invoiceId) }), [invoiceId, shell.refreshSignal]);

  const doPrint = useCallback(
    async (output: PrintOutput) => {
      const data = detail.data;
      if (!data) return;
      setPrinting(output);
      setPrintError('');
      try {
        const result = await runPrint(
          {
            docKind: 'invoice',
            entityId: data.invoice.id,
            entityLabel: data.invoice.invoice_no,
            logoAttachmentId: (data.invoice as unknown as { logo_attachment_id?: number }).logo_attachment_id ?? null,
            data: data as unknown as Record<string, unknown>,
          },
          output,
          app.token,
        );
        if (output === 'pdf') {
          if (result.path) toast.success('PDF saved', result.path);
          else if (result.message) toast.info('PDF', result.message);
        } else if (output === 'print') {
          toast.success('Sent to the printer');
        }
      } catch (error) {
        const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Printing failed.';
        setPrintError(message);
        toast.error('Print failed', message);
      } finally {
        setPrinting('');
      }
    },
    [detail.data, app.token, toast],
  );

  const cancel = async () => {
    const data = detail.data;
    if (!data) return;
    const ok = await confirm({
      title: `Cancel ${data.invoice.invoice_no}?`,
      message: 'The invoice stays in the ledger marked cancelled. Nothing is deleted.',
      tone: 'danger',
      confirmLabel: 'Cancel invoice',
    });
    if (!ok) return;
    try {
      await call('invoices.cancel', { id: data.invoice.id });
      toast.success('Invoice cancelled');
      detail.reload();
      shell.requestRefresh();
    } catch (error) {
      toast.error('Could not cancel', error instanceof Error ? error.message : undefined);
    }
  };

  if (detail.loading && !detail.data) {
    return (
      <>
        <PageHeader title="Loading invoice…" icon="invoice" />
        <Card><div className="skeleton" style={{ height: 220 }} /></Card>
      </>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <>
        <PageHeader title="Invoice" icon="invoice" breadcrumb={[{ label: 'Invoices', href: 'billing/invoices' }]} />
        <ErrorState error={detail.error} onRetry={detail.reload} />
      </>
    );
  }

  const { invoice, items, allocations } = detail.data;

  return (
    <>
      <PageHeader
        icon="invoice"
        title={invoice.invoice_no}
        subtitle={`${invoice.patient_name} · ${date(invoice.issue_date, app.prefs)}`}
        breadcrumb={[{ label: 'Invoices', href: 'billing/invoices' }, { label: invoice.invoice_no }]}
        actions={
          <>
            <Badge tone={STATUS_TONE[invoice.status] ?? 'neutral'}>{STATUS_LABELS[invoice.status] ?? invoice.status}</Badge>
            {app.has('invoices.print') ? (
              <>
                <Button icon="eye" loading={printing === 'preview'} onClick={() => void doPrint('preview')}>Preview</Button>
                <Button icon="printer" loading={printing === 'print'} onClick={() => void doPrint('print')}>Print</Button>
                <Button icon="download" loading={printing === 'pdf'} onClick={() => void doPrint('pdf')}>PDF</Button>
              </>
            ) : null}
            {app.has('payments.create') && Number(invoice.balance_poisha) > 0 && invoice.status !== 'cancelled' ? (
              <Button variant="primary" icon="payments" onClick={() => setPaying(true)}>Record payment</Button>
            ) : null}
          </>
        }
      />

      {printError ? <Callout tone="danger" title="Printing problem">{printError}</Callout> : null}

      <div className="grid grid-2-1">
        <div className="stack stack-3">
          <Card title="Items" flush>
            <DataTable
              compact
              rows={items}
              columns={[
                {
                  key: 'description',
                  header: 'Description',
                  render: (row) => (
                    <div className="stack stack-0">
                      <span>{row.description}</span>
                      {row.tooth_code ? <span className="text-xs text-3">Tooth {row.tooth_code}</span> : null}
                    </div>
                  ),
                },
                { key: 'qty', header: 'Qty', width: 80, numeric: true, render: (row) => quantityLabel(row.qty_milli) },
                { key: 'rate', header: 'Rate', width: 110, numeric: true, render: (row) => money(row.unit_price_poisha, app.prefs) },
                { key: 'amount', header: 'Amount', width: 120, numeric: true, render: (row) => <strong className="mono">{money(row.line_total_poisha, app.prefs)}</strong> },
              ]}
              footer={
                <>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right' }}>Subtotal</td>
                    <td className="num mono">{money(invoice.subtotal_poisha, app.prefs)}</td>
                  </tr>
                  {invoice.discount_poisha > 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'right' }}>Discount</td>
                      <td className="num mono text-ok">−{money(invoice.discount_poisha, app.prefs)}</td>
                    </tr>
                  ) : null}
                  {invoice.tax_poisha > 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'right' }}>Tax</td>
                      <td className="num mono">{money(invoice.tax_poisha, app.prefs)}</td>
                    </tr>
                  ) : null}
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Grand total</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{money(invoice.grand_total_poisha, app.prefs)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right' }}>Paid</td>
                    <td className="num mono text-ok">{money(invoice.paid_poisha, app.prefs)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Balance due</td>
                    <td className="num mono" style={{ fontWeight: 700, color: Number(invoice.balance_poisha) > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                      {money(invoice.balance_poisha, app.prefs)}
                    </td>
                  </tr>
                </>
              }
            />
          </Card>

          {allocations.length > 0 ? (
            <Card title="Payments applied" icon="payments" flush>
              <DataTable
                compact
                rows={allocations}
                columns={[
                  { key: 'no', header: 'Receipt', width: 140, render: (row) => <span className="mono text-sm">{row.payment_no}</span> },
                  { key: 'date', header: 'Date', width: 110, render: (row) => date(row.payment_date, app.prefs) },
                  { key: 'method', header: 'Method', width: 100, render: (row) => row.method.charAt(0).toUpperCase() + row.method.slice(1) },
                  { key: 'amount', header: 'Applied', numeric: true, render: (row) => <span className="mono text-ok">{money(row.amount_poisha, app.prefs)}</span> },
                ]}
              />
            </Card>
          ) : null}

          {invoice.notes ? (
            <Card title="Notes">
              <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
            </Card>
          ) : null}
        </div>

        <div className="stack stack-3">
          <Card title="Patient">
            <div className="stack stack-2">
              <button type="button" className="link-strong" onClick={() => route.navigate(`patients/${invoice.patient_id}`)}>
                {invoice.patient_name}
              </button>
              <span className="text-sm text-3 mono">{invoice.patient_code}</span>
              {invoice.phone ? <span className="text-sm"><Icon name="phone" size={13} /> {invoice.phone}</span> : null}
              {invoice.address ? <span className="text-sm text-3">{invoice.address}</span> : null}
            </div>
          </Card>

          <Card title="Summary">
            <div className="stack stack-2">
              <div className="row-between"><span className="text-sm text-3">Invoice date</span><span className="text-sm">{date(invoice.issue_date, app.prefs)}</span></div>
              {invoice.due_date ? (
                <div className="row-between"><span className="text-sm text-3">Due date</span><span className="text-sm">{date(invoice.due_date, app.prefs)}</span></div>
              ) : null}
              <div className="row-between"><span className="text-sm text-3">Total</span><span className="mono">{money(invoice.grand_total_poisha, app.prefs)}</span></div>
              <div className="row-between"><span className="text-sm text-3">Paid</span><span className="mono text-ok">{money(invoice.paid_poisha, app.prefs)}</span></div>
              <div className="row-between"><span className="text-sm text-3">Balance</span>
                <span className={Number(invoice.balance_poisha) > 0 ? 'mono text-danger' : 'mono text-ok'}>
                  {money(invoice.balance_poisha, app.prefs)}
                </span>
              </div>
            </div>
          </Card>

          {app.has('invoices.edit') && invoice.status !== 'cancelled' ? (
            <Card title="Danger zone">
              <p className="text-sm text-3">Cancelling keeps the record for the audit trail but stops it counting toward revenue.</p>
              <Button variant="danger-soft" icon="ban" onClick={() => void cancel()}>Cancel invoice</Button>
            </Card>
          ) : null}
        </div>
      </div>

      <PaymentForm
        open={paying}
        patientId={invoice.patient_id}
        patientLabel={`${invoice.patient_name} (${invoice.patient_code})`}
        presetAllocations={[{ invoiceId: invoice.id, amountPoisha: Number(invoice.balance_poisha) }]}
        onClose={() => setPaying(false)}
        onSaved={() => {
          setPaying(false);
          detail.reload();
          shell.requestRefresh();
        }}
      />
    </>
  );
}
