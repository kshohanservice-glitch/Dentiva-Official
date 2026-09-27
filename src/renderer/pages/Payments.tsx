import { useEffect, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call, ApiError, filesBridge } from '../lib/api';
import {
  Button, Callout, DataTable, Field, PageHeader, Pagination, Select, Stat, TextArea,
  TextInput, useConfirm, useDebounced, useResource, useToast,
} from '../components/ui';
import { date, money, shiftDateKey, todayKey } from '../lib/format';
import { PAYMENT_METHOD_LABELS } from '../../shared/constants';
import { PaymentForm } from './PaymentForm';
import { runPrint } from '../lib/printing';

interface PaymentRow {
  id: number;
  payment_no: string;
  patient_id: number;
  payment_date: string;
  paid_at: string;
  method: string;
  amount_poisha: number;
  type: string;
  reference: string;
  notes: string;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  received_by_name: string | null;
}

interface PaymentPage {
  rows: PaymentRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface PaymentSummary {
  receivedPoisha: number;
  refundedPoisha: number;
  netPoisha: number;
  count: number;
  byMethod: { method: string; total_poisha: number; n: number }[];
}

export function PaymentsPage(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState(shiftDateKey(todayKey(), -30));
  const [to, setTo] = useState(todayKey());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [recording, setRecording] = useState(false);
  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');
  const [printingId, setPrintingId] = useState<number | null>(null);
  const debounced = useDebounced(search, 260);

  const list = useResource(
    () =>
      call<PaymentPage>('payments.list', {
        search: debounced.trim() || undefined,
        method: method || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize,
      }),
    [debounced, method, from, to, page, pageSize, shell.refreshSignal],
  );

  const summary = useResource(
    () => call<PaymentSummary>('payments.summary', { from: from || undefined, to: to || undefined }),
    [from, to, shell.refreshSignal],
  );

  useEffect(() => setPage(1), [debounced, method, from, to, pageSize]);

  useEffect(() => {
    if (!app.has('payments.create')) return;
    const handler = () => setRecording(true);
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [app]);

  const receipt = async (row: PaymentRow) => {
    setPrintingId(row.id);
    try {
      const model = await call<Record<string, unknown>>('payments.printModel', { id: row.id });
      const result = await runPrint(
        {
          docKind: 'receipt',
          entityId: row.id,
          entityLabel: row.payment_no,
          data: model,
        },
        'print',
        app.token,
      );
      if (result.browserPrint) toast.info('Receipt', result.message ?? 'Use the print dialog to save a PDF.');
      else toast.success('Receipt sent to the printer', row.payment_no);
    } catch (error) {
      toast.error('Could not print receipt', error instanceof ApiError ? error.message : undefined);
    } finally {
      setPrintingId(null);
    }
  };

  const exportCsv = async () => {
    const result = await call<{ filename: string; content: string; rows: number }>('exports.csv', {
      dataset: 'payments',
      from: from || undefined,
      to: to || undefined,
    });
    const saved = await filesBridge().saveText(result.filename, result.content);
    toast.success('Export ready', `${result.rows} rows${saved.saved ? '' : ' — cancelled'}.`);
  };

  const summaryData = summary.data;

  return (
    <>
      <PageHeader
        icon="payments"
        title="Payments"
        subtitle={summaryData ? `${summaryData.count} payment(s) in this period` : undefined}
        actions={
          <>
            <Button icon="download" onClick={() => void exportCsv()}>Export</Button>
            {app.has('payments.create') ? (
              <Button variant="primary" icon="plus" onClick={() => setRecording(true)}>Record payment</Button>
            ) : null}
          </>
        }
      />

      {summaryData ? (
        <div className="stat-grid stat-grid--compact">
          <Stat label="Received" value={money(summaryData.receivedPoisha, app.prefs, { decimals: 0 })} icon="trending-up" tone="ok" />
          <Stat label="Refunded" value={money(summaryData.refundedPoisha, app.prefs, { decimals: 0 })} icon="trending-down" tone="warn" />
          <Stat label="Net collection" value={money(summaryData.netPoisha, app.prefs, { decimals: 0 })} icon="wallet" tone="primary" />
          <Stat
            label="Top method"
            value={summaryData.byMethod[0] ? PAYMENT_METHOD_LABELS[summaryData.byMethod[0].method as keyof typeof PAYMENT_METHOD_LABELS] ?? summaryData.byMethod[0].method : '—'}
            meta={summaryData.byMethod[0] ? money(summaryData.byMethod[0].total_poisha, app.prefs, { decimals: 0 }) : undefined}
            icon="credit-card"
            tone="info"
          />
        </div>
      ) : null}

      <div className="filter-bar mt-3">
        <div className="filter-search">
          <TextInput
            aria-label="Search payments"
            placeholder="Search by receipt number or patient…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon="search"
            inputSize="sm"
          />
        </div>
        <Select
          aria-label="Method"
          inputSize="sm"
          style={{ width: 150 }}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          options={[
            { value: '', label: 'All methods' },
            ...Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <input className="input input--sm" style={{ width: 148 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input input--sm" style={{ width: 148 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setFrom(shiftDateKey(todayKey(), -30));
            setTo(todayKey());
          }}
        >
          Last 30 days
        </Button>
        <span className="spacer" />
        <Button size="sm" icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
      </div>

      <div className="card">
        <DataTable
          rows={list.data?.rows ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          columns={[
            { key: 'no', header: 'Receipt', width: 140, render: (row) => <span className="mono text-sm">{row.payment_no}</span> },
            {
              key: 'patient',
              header: 'Patient',
              render: (row) => (
                <button
                  type="button"
                  className="link-strong"
                  onClick={() => route.navigate(`patients/${row.patient_id}`)}
                >
                  {row.patient_name}
                  <span className="text-xs text-3 mono"> {row.patient_code}</span>
                </button>
              ),
            },
            { key: 'date', header: 'Date', width: 110, render: (row) => date(row.payment_date, app.prefs) },
            {
              key: 'method',
              header: 'Method',
              width: 110,
              render: (row) => PAYMENT_METHOD_LABELS[row.method as keyof typeof PAYMENT_METHOD_LABELS] ?? row.method,
            },
            {
              key: 'amount',
              header: 'Amount',
              width: 130,
              numeric: true,
              render: (row) => (
                <span className={row.type === 'refund' ? 'mono text-danger' : 'mono text-ok'}>
                  {row.type === 'refund' ? '−' : ''}{money(Math.abs(Number(row.amount_poisha)), app.prefs)}
                </span>
              ),
            },
            { key: 'by', header: 'Received by', width: 140, render: (row) => row.received_by_name ?? '—' },
            {
              key: 'actions',
              header: '',
              width: 96,
              render: (row) => (
                <div className="row row-1" style={{ gap: 4 }}>
                  {app.has('payments.view') ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="printer"
                      loading={printingId === row.id}
                      aria-label={`Print receipt ${row.payment_no}`}
                      onClick={() => void receipt(row)}
                    />
                  ) : null}
                  {app.has('payments.refund') && row.type === 'receipt' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="rotate-ccw"
                      aria-label={`Reverse ${row.payment_no}`}
                      onClick={() => {
                        setReversing(row);
                        setReason('');
                      }}
                    />
                  ) : null}
                </div>
              ),
            },
          ]}
          empty={
            <div className="state">
              <div className="state-title">No payments in this period</div>
              <div className="state-text">Payments recorded against invoices appear here with their receipt numbers.</div>
              {app.has('payments.create') ? (
                <div className="state-actions">
                  <Button variant="primary" icon="plus" onClick={() => setRecording(true)}>Record payment</Button>
                </div>
              ) : null}
            </div>
          }
        />
        {list.data && list.data.total > 0 ? (
          <Pagination
            page={list.data.page}
            pageCount={Math.max(1, list.data.pageCount)}
            total={list.data.total}
            pageSize={list.data.pageSize}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        ) : null}
      </div>

      <PaymentForm
        open={recording}
        onClose={() => setRecording(false)}
        onSaved={() => {
          setRecording(false);
          list.reload();
          summary.reload();
          shell.requestRefresh();
        }}
      />

      {reversing ? (
        <ReversePaymentModal
          payment={reversing}
          reason={reason}
          setReason={setReason}
          onClose={() => setReversing(null)}
          onDone={async () => {
            const ok = await confirm({
              title: `Reverse ${reversing.payment_no}?`,
              message: 'The payment is soft-deleted and the invoices it paid go back to their previous balance.',
              tone: 'danger',
              confirmLabel: 'Reverse payment',
            });
            if (!ok) return;
            try {
              await call('payments.delete', { id: reversing.id, reason: reason.trim() });
              toast.success('Payment reversed', reversing.payment_no);
              setReversing(null);
              list.reload();
              summary.reload();
              shell.requestRefresh();
            } catch (error) {
              toast.error('Could not reverse', error instanceof ApiError ? error.message : undefined);
            }
          }}
        />
      ) : null}
    </>
  );
}

function ReversePaymentModal({
  payment, reason, setReason, onClose, onDone,
}: {
  payment: PaymentRow;
  reason: string;
  setReason: (value: string) => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}): JSX.Element {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ ['--modal-w' as string]: '520px' }}>
        <header className="modal-head">
          <div>
            <h2 className="modal-title">Reverse {payment.payment_no}</h2>
            <p className="modal-subtitle">{money(Math.abs(Number(payment.amount_poisha)), app.prefs)} from {payment.patient_name}</p>
          </div>
        </header>
        <div className="modal-body">
          <div className="stack stack-3">
            <Callout tone="warn" title="This cannot be undone">
              The receipt is kept for the audit trail but stops counting toward collections. Any invoice it paid goes
              back to outstanding.
            </Callout>
            <Field label="Reason" required hint="Stored in the audit log exactly as written.">
              <TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Duplicate receipt entered by mistake" />
            </Field>
          </div>
        </div>
        <footer className="modal-foot">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 4}
            onClick={() => {
              setBusy(true);
              void onDone().finally(() => setBusy(false));
            }}
          >
            Reverse payment
          </Button>
        </footer>
      </div>
    </div>
  );
}
