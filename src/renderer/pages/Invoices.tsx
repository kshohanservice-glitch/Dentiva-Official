import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call } from '../lib/api';
import {
  Badge, Button, DataTable, PageHeader, Pagination, Select, TextInput,
  useConfirm, useDebounced, useResource, useToast,
} from '../components/ui';
import { date, money, STATUS_LABELS } from '../lib/format';
import { InvoiceForm } from './InvoiceForm';

export interface InvoiceRow {
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
}

interface InvoicePage {
  rows: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'primary'> = {
  paid: 'ok', partial: 'warn', unpaid: 'danger', cancelled: 'neutral',
};

export function InvoicesPage(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(route.query.get('status') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search, 260);

  const list = useResource(
    () =>
      call<InvoicePage>('invoices.list', {
        search: debounced.trim() || undefined,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize,
      }),
    [debounced, status, from, to, page, pageSize, shell.refreshSignal],
  );

  useEffect(() => setPage(1), [debounced, status, from, to, pageSize]);

  useEffect(() => {
    if (!app.has('invoices.create')) return;
    const handler = () => setCreating(true);
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [app]);

  const totals = useMemo(() => {
    const rows = list.data?.rows ?? [];
    return {
      billed: rows.reduce((a, r) => a + Number(r.grand_total_poisha), 0),
      paid: rows.reduce((a, r) => a + Number(r.paid_poisha), 0),
      due: rows.reduce((a, r) => a + Number(r.balance_poisha), 0),
    };
  }, [list.data]);

  const cancel = async (row: InvoiceRow) => {
    const ok = await confirm({
      title: `Cancel invoice ${row.invoice_no}?`,
      message: (
        <>
          The invoice for <strong>{row.patient_name}</strong> worth{' '}
          <strong className="mono">{money(row.grand_total_poisha, app.prefs)}</strong> will be marked cancelled.
          {Number(row.paid_poisha) > 0
            ? ' Recorded payments stay in the ledger and must be refunded separately if required.'
            : ''}
        </>
      ),
      tone: 'danger',
      confirmLabel: 'Cancel invoice',
      detail: 'Cancelling never deletes data — the record and its audit trail remain.',
    });
    if (!ok) return;
    try {
      await call('invoices.cancel', { id: row.id });
      toast.success('Invoice cancelled', row.invoice_no);
      list.reload();
      shell.requestRefresh();
    } catch (error) {
      toast.error('Could not cancel', error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <>
      <PageHeader
        icon="invoice"
        title="Invoices"
        subtitle={
          list.data
            ? `${list.data.total} invoice(s) · ${money(totals.due, app.prefs, { decimals: 0 })} outstanding on this page`
            : undefined
        }
        actions={
          app.has('invoices.create') ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New invoice</Button>
          ) : null
        }
      />

      <div className="filter-bar">
        <div className="filter-search">
          <TextInput
            aria-label="Search invoices"
            placeholder="Search by invoice number or patient…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon="search"
            inputSize="sm"
          />
        </div>
        <Select
          aria-label="Status"
          inputSize="sm"
          style={{ width: 150 }}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'unpaid', label: 'Unpaid' },
            { value: 'partial', label: 'Partially paid' },
            { value: 'paid', label: 'Paid' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
        <input className="input input--sm" style={{ width: 150 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input input--sm" style={{ width: 150 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        {from || to ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            Clear dates
          </Button>
        ) : null}
        <span className="spacer" />
        <Button size="sm" icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
      </div>

      <div className="card">
        <DataTable
          rows={list.data?.rows ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => route.navigate(`billing/invoices/${row.id}`)}
          columns={[
            { key: 'no', header: 'Invoice', width: 130, render: (row) => <span className="mono text-sm">{row.invoice_no}</span> },
            {
              key: 'patient',
              header: 'Patient',
              render: (row) => (
                <div className="stack stack-0" style={{ minWidth: 0 }}>
                  <strong className="truncate">{row.patient_name}</strong>
                  <span className="text-xs text-3 mono">{row.patient_code}</span>
                </div>
              ),
            },
            { key: 'date', header: 'Date', width: 110, render: (row) => <span className="text-sm">{date(row.issue_date, app.prefs)}</span> },
            { key: 'total', header: 'Total', width: 118, numeric: true, render: (row) => <span className="mono">{money(row.grand_total_poisha, app.prefs)}</span> },
            {
              key: 'paid',
              header: 'Paid',
              width: 118,
              numeric: true,
              render: (row) => <span className="mono text-ok">{money(row.paid_poisha, app.prefs)}</span>,
            },
            {
              key: 'due',
              header: 'Balance',
              width: 118,
              numeric: true,
              render: (row) => (
                <span className={Number(row.balance_poisha) > 0 ? 'mono text-danger' : 'mono text-3'}>
                  {money(row.balance_poisha, app.prefs)}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 120,
              render: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{STATUS_LABELS[row.status] ?? row.status}</Badge>,
            },
            ...(app.has('invoices.edit')
              ? [
                  {
                    key: 'actions',
                    header: '',
                    width: 96,
                    render: (row: InvoiceRow) =>
                      row.status === 'cancelled' ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="ban"
                          onClick={(event) => {
                            event.stopPropagation();
                            void cancel(row);
                          }}
                        >
                          Cancel
                        </Button>
                      ),
                  },
                ]
              : []),
          ]}
          empty={
            <div className="state">
              <div className="state-title">No invoices found</div>
              <div className="state-text">Invoices you raise for patients appear here with their payment status.</div>
              {app.has('invoices.create') ? (
                <div className="state-actions">
                  <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create invoice</Button>
                </div>
              ) : null}
            </div>
          }
          footer={
            totals.billed > 0 ? (
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Page totals</td>
                <td className="num mono">{money(totals.billed, app.prefs)}</td>
                <td className="num mono text-ok">{money(totals.paid, app.prefs)}</td>
                <td className="num mono text-danger">{money(totals.due, app.prefs)}</td>
                <td colSpan={2} />
              </tr>
            ) : null
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

      <div className="row row-2 mt-3">
        <Button size="sm" variant="ghost" icon="download" onClick={() => route.navigate('reports?kind=collection')}>
          Collection report
        </Button>
        <Button size="sm" variant="ghost" icon="download" onClick={() => route.navigate('reports?kind=outstanding')}>
          Outstanding report
        </Button>
      </div>

      <InvoiceForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(id) => {
          setCreating(false);
          toast.success('Invoice created');
          route.navigate(`billing/invoices/${id}`);
        }}
      />
    </>
  );
}
