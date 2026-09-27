import { useEffect, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call, ApiError, filesBridge } from '../lib/api';
import {
  Button, Callout, Card, DataTable, Field, Modal, PageHeader, Pagination, Segmented, Select, Stat,
  Tabs, TextInput, useConfirm, useDebounced, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { date, money, shiftDateKey, todayKey } from '../lib/format';
import { takaInputToPoisha } from '../../core/money/money';
import { PAYMENT_METHOD_CODES, PAYMENT_METHOD_LABELS } from '../../shared/constants';
import { runPrint } from '../lib/printing';

interface EntryRow {
  id: number;
  entry_date: string;
  amount_poisha: number;
  category_id: number | null;
  category_name: string | null;
  method: string;
  description: string;
  vendor: string;
  reference: string;
  source?: string;
  recorded_by_name: string | null;
  staff_name?: string | null;
}

interface EntryPage {
  rows: EntryRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface Categories {
  income: { id: number; name: string }[];
  expense: { id: number; name: string }[];
}

interface AccountingReport {
  kind: string;
  from: string;
  to: string;
  incomePoisha: number;
  expensePoisha: number;
  netPoisha: number;
  invoiceRevenuePoisha: number;
  byExpenseCategory: { category: string | null; total_poisha: number; entries: number }[];
  byIncomeCategory: { category: string | null; total_poisha: number; entries: number }[];
  byMethod: { method: string; total_poisha: number; count: number }[];
  topTreatments: { description: string; total_poisha: number; qty_milli: number }[];
  receivables: { totalPoisha: number; count: number };
  daily: { day: string; income_poisha: number; expense_poisha: number; invoiced_poisha: number }[];
}

type Tab = 'expenses' | 'income' | 'report';

export function AccountingPage(): JSX.Element {
  const app = useApp();
  const shell = useShell();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('expenses');
  const [from, setFrom] = useState(`${todayKey().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayKey());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState<'expense' | 'income' | null>(null);
  const debounced = useDebounced(search, 250);

  const categories = useResource(() => call<Categories>('accounting.categories'), [shell.refreshSignal]);

  const expenses = useResource(
    () =>
      tab === 'expenses'
        ? call<EntryPage>('accounting.listExpenses', { search: debounced.trim() || undefined, from, to, page, pageSize })
        : Promise.resolve(null),
    [tab, debounced, from, to, page, pageSize, shell.refreshSignal],
  );
  const income = useResource(
    () =>
      tab === 'income'
        ? call<EntryPage>('accounting.listIncome', { search: debounced.trim() || undefined, from, to, page, pageSize })
        : Promise.resolve(null),
    [tab, debounced, from, to, page, pageSize, shell.refreshSignal],
  );
  const report = useResource(
    () => (tab === 'report' ? call<AccountingReport>('accounting.report', { kind: 'daily', from, to }) : Promise.resolve(null)),
    [tab, from, to, shell.refreshSignal],
  );

  useEffect(() => setPage(1), [tab, debounced, from, to, pageSize]);

  useEffect(() => {
    if (!app.has('accounting.manage')) return;
    const handler = () => setCreating(tab === 'income' ? 'income' : 'expense');
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [app, tab]);

  const list = tab === 'income' ? income.data : expenses.data;

  const exportCsv = async () => {
    const dataset = tab === 'income' ? 'income' : 'expenses';
    const result = await call<{ filename: string; content: string; rows: number }>('exports.csv', { dataset, from, to });
    const saved = await filesBridge().saveText(result.filename, result.content);
    toast.success('Export ready', `${result.rows} rows${saved.saved ? '' : ' — cancelled'}.`);
  };

  return (
    <>
      <PageHeader
        icon="accounting"
        title="Accounting"
        subtitle="Income, expenses and the clinic's financial position"
        actions={
          <>
            <Button icon="download" onClick={() => void exportCsv()}>Export</Button>
            {app.has('accounting.manage') && tab !== 'report' ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(tab === 'income' ? 'income' : 'expense')}>
                {tab === 'income' ? 'Record income' : 'Record expense'}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="filter-bar">
        <Segmented
          label="Accounting view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'expenses', label: 'Expenses', icon: 'trending-down' },
            { value: 'income', label: 'Other income', icon: 'trending-up' },
            { value: 'report', label: 'Report', icon: 'accounting' },
          ]}
        />
        <input className="input input--sm" style={{ width: 148 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input input--sm" style={{ width: 148 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setFrom(`${todayKey().slice(0, 7)}-01`);
            setTo(todayKey());
          }}
        >
          This month
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setFrom(shiftDateKey(todayKey(), -365));
            setTo(todayKey());
          }}
        >
          Last year
        </Button>
        <span className="spacer" />
        <Button size="sm" icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
      </div>

      {report.data ? <ReportPanel report={report.data} /> : null}

      {tab !== 'report' ? (
        <div className="card mt-3">
          <div className="card-head">
            <div className="filter-search" style={{ maxWidth: 320 }}>
              <TextInput
                aria-label="Search entries"
                placeholder="Search description or vendor…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                icon="search"
                inputSize="sm"
              />
            </div>
          </div>
          <DataTable
            rows={list?.rows ?? []}
            loading={tab === 'expenses' ? expenses.loading : income.loading}
            error={tab === 'expenses' ? expenses.error : income.error}
            onRetry={() => (tab === 'expenses' ? expenses.reload() : income.reload())}
            columns={[
              { key: 'date', header: 'Date', width: 110, render: (row) => date(row.entry_date, app.prefs) },
              { key: 'category', header: 'Category', width: 160, render: (row) => row.category_name ?? 'Uncategorised' },
              {
                key: 'description',
                header: 'Description',
                render: (row) => (
                  <div className="stack stack-0" style={{ minWidth: 0 }}>
                    <span className="truncate">{row.description || '—'}</span>
                    {row.vendor ? <span className="text-xs text-3 truncate">{row.vendor}</span> : null}
                  </div>
                ),
              },
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
                  <strong className={tab === 'income' ? 'mono text-ok' : 'mono text-danger'}>
                    {tab === 'income' ? '+' : '−'}{money(row.amount_poisha, app.prefs)}
                  </strong>
                ),
              },
              { key: 'by', header: 'By', width: 130, render: (row) => <span className="text-sm truncate">{row.recorded_by_name ?? '—'}</span> },
              ...(app.has('accounting.manage')
                ? [
                    {
                      key: 'actions',
                      header: '',
                      width: 88,
                      render: (row: EntryRow) => (
                        <DeleteEntryButton kind={tab === 'income' ? 'income' : 'expense'} row={row} onDone={() => {
                          if (tab === 'income') income.reload();
                          else expenses.reload();
                          report.reload();
                          shell.requestRefresh();
                        }} />
                      ),
                    },
                  ]
                : []),
            ]}
            empty={
              <div className="state">
                <div className="state-title">{tab === 'income' ? 'No other income recorded' : 'No expenses recorded'}</div>
                <div className="state-text">
                  {tab === 'income'
                    ? 'Record income that does not come from an invoice, such as a lab refund or a grant.'
                    : 'Record rent, salaries, supplies and every other cost so the clinic profit is accurate.'}
                </div>
                {app.has('accounting.manage') ? (
                  <div className="state-actions">
                    <Button variant="primary" icon="plus" onClick={() => setCreating(tab === 'income' ? 'income' : 'expense')}>
                      {tab === 'income' ? 'Record income' : 'Record expense'}
                    </Button>
                  </div>
                ) : null}
              </div>
            }
          />
          {list && list.total > 0 ? (
            <Pagination
              page={list.page}
              pageCount={Math.max(1, list.pageCount)}
              total={list.total}
              pageSize={list.pageSize}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          ) : null}
        </div>
      ) : null}

      <EntryForm
        kind={creating}
        categories={categories.data}
        onClose={() => setCreating(null)}
        onSaved={() => {
          setCreating(null);
          expenses.reload();
          income.reload();
          report.reload();
          shell.requestRefresh();
        }}
      />
    </>
  );
}

function DeleteEntryButton({ kind, row, onDone }: { kind: 'income' | 'expense'; row: EntryRow; onDone: () => void }): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon="trash"
      loading={busy}
      aria-label={`Delete ${row.description || 'entry'}`}
      onClick={() => {
        void (async () => {
          const ok = await confirm({
            title: 'Delete this entry?',
            message: (
              <>
                {kind === 'income' ? 'Income' : 'Expense'} of <strong className="mono">{money(row.amount_poisha, app.prefs)}</strong> dated{' '}
                {row.entry_date}. The entry is archived, not erased, and the deletion is written to the audit log.
              </>
            ),
            tone: 'danger',
            confirmLabel: 'Delete entry',
          });
          if (!ok) return;
          setBusy(true);
          try {
            await call(kind === 'income' ? 'accounting.deleteIncome' : 'accounting.deleteExpense', { id: row.id });
            toast.success('Entry deleted');
            onDone();
          } catch (error) {
            toast.error('Could not delete', error instanceof ApiError ? error.message : undefined);
          } finally {
            setBusy(false);
          }
        })();
      }}
    />
  );
}

function ReportPanel({ report }: { report: AccountingReport }): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const [view, setView] = useState<'daily' | 'category' | 'method' | 'treatment' | 'receivables'>('daily');

  return (
    <>
      <div className="stat-grid">
        <Stat label="Invoice revenue" value={money(report.invoiceRevenuePoisha, app.prefs, { decimals: 0 })} icon="invoice" tone="primary" />
        <Stat label="Other income" value={money(report.incomePoisha, app.prefs, { decimals: 0 })} icon="trending-up" tone="ok" />
        <Stat label="Expenses" value={money(report.expensePoisha, app.prefs, { decimals: 0 })} icon="trending-down" tone="danger" />
        <Stat
          label="Net (other income − expenses)"
          value={money(report.netPoisha, app.prefs, { decimals: 0 })}
          icon="accounting"
          tone={report.netPoisha >= 0 ? 'ok' : 'danger'}
        />
        <Stat
          label="Receivables"
          value={money(report.receivables.totalPoisha, app.prefs, { decimals: 0 })}
          meta={`${report.receivables.count} unpaid invoice(s)`}
          icon="wallet"
          tone={report.receivables.totalPoisha > 0 ? 'warn' : 'ok'}
          href="billing/invoices?status=unpaid"
        />
      </div>

      <Card
        className="mt-4"
        title="Breakdown"
        icon="accounting"
        actions={
          <>
            <Tabs
              ariaLabel="Report view"
              value={view}
              onChange={(id) => setView(id as typeof view)}
              items={[
                { id: 'daily', label: 'Daily' },
                { id: 'category', label: 'Categories' },
                { id: 'method', label: 'Methods' },
                { id: 'treatment', label: 'Treatments' },
                { id: 'receivables', label: 'Receivables' },
              ]}
            />
            {app.has('reports.view') ? (
              <Button
                size="sm"
                icon="download"
                onClick={() => {
                  void (async () => {
                    const model = await call<Record<string, unknown>>('documents.report', {
                      kind: view === 'category' ? 'expense' : view === 'method' ? 'payment-summary' : 'daily-summary',
                      from: report.from,
                      to: report.to,
                    });
                    await runPrint(
                      {
                        docKind: 'report',
                        entityId: null,
                        entityLabel: 'Accounting report',
                        data: { ...model, title: 'Accounting report' },
                      },
                      'pdf',
                      app.token,
                    );
                  })();
                }}
              >
                PDF
              </Button>
            ) : null}
          </>
        }
        flush
      >
        {view === 'daily' ? (
          <DataTable
            compact
            maxHeight={420}
            rows={report.daily.map((row) => ({ ...row, id: row.day }))}
            columns={[
              { key: 'day', header: 'Date', width: 130, render: (row) => date(row.day, app.prefs) },
              { key: 'invoiced', header: 'Invoiced', numeric: true, render: (row) => money(row.invoiced_poisha, app.prefs) },
              { key: 'income', header: 'Other income', numeric: true, render: (row) => <span className="text-ok">{money(row.income_poisha, app.prefs)}</span> },
              { key: 'expense', header: 'Expenses', numeric: true, render: (row) => <span className="text-danger">{money(row.expense_poisha, app.prefs)}</span> },
              {
                key: 'net',
                header: 'Net',
                numeric: true,
                render: (row) => {
                  const net = Number(row.income_poisha) - Number(row.expense_poisha);
                  return <strong className={net >= 0 ? 'text-ok' : 'text-danger'}>{money(net, app.prefs)}</strong>;
                },
              },
            ]}
            empty={<div className="state state--compact"><div className="state-title">No movements in this period</div></div>}
          />
        ) : view === 'category' ? (
          <div className="grid grid-2" style={{ padding: 12 }}>
            <div>
              <h3 className="section-title">Expenses by category</h3>
              <ul className="rank-list">
                {report.byExpenseCategory.map((row) => (
                  <BreakdownRow key={`e-${row.category}`} label={row.category ?? 'Uncategorised'} poisha={row.total_poisha} max={report.byExpenseCategory} app={app} meta={`${row.entries} entries`} />
                ))}
              </ul>
            </div>
            <div>
              <h3 className="section-title">Other income by category</h3>
              <ul className="rank-list">
                {report.byIncomeCategory.map((row) => (
                  <BreakdownRow key={`i-${row.category}`} label={row.category ?? 'Uncategorised'} poisha={row.total_poisha} max={report.byIncomeCategory} app={app} meta={`${row.entries} entries`} />
                ))}
              </ul>
            </div>
          </div>
        ) : view === 'method' ? (
          <DataTable
            compact
            rows={report.byMethod.map((row, i) => ({ ...row, id: i }))}
            columns={[
              { key: 'method', header: 'Method', render: (row) => PAYMENT_METHOD_LABELS[row.method as keyof typeof PAYMENT_METHOD_LABELS] ?? row.method },
              { key: 'count', header: 'Payments', width: 110, numeric: true, render: (row) => row.count },
              { key: 'total', header: 'Collected', numeric: true, render: (row) => <strong className="mono">{money(row.total_poisha, app.prefs)}</strong> },
            ]}
            empty={<div className="state state--compact"><div className="state-title">No payments in this period</div></div>}
          />
        ) : view === 'treatment' ? (
          <DataTable
            compact
            maxHeight={420}
            rows={report.topTreatments.map((row, i) => ({ ...row, id: i }))}
            columns={[
              { key: 'description', header: 'Treatment', render: (row) => row.description },
              { key: 'qty', header: 'Times', width: 90, numeric: true, render: (row) => (Number(row.qty_milli) / 1000).toFixed(0) },
              { key: 'total', header: 'Revenue', width: 130, numeric: true, render: (row) => <strong className="mono">{money(row.total_poisha, app.prefs)}</strong> },
            ]}
            empty={<div className="state state--compact"><div className="state-title">No invoiced treatments in this period</div></div>}
          />
        ) : (
          <div style={{ padding: 12 }}>
            <Callout tone={report.receivables.totalPoisha > 0 ? 'warn' : 'ok'}>
              {report.receivables.count} invoice(s) still hold a balance of{' '}
              <strong className="mono">{money(report.receivables.totalPoisha, app.prefs)}</strong>.
            </Callout>
            <Button className="mt-3" icon="invoice" onClick={() => route.navigate('billing/invoices?status=unpaid')}>
              Open outstanding invoices
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

function BreakdownRow({
  label, poisha, max, app, meta,
}: {
  label: string;
  poisha: number;
  max: { total_poisha: number }[];
  app: ReturnType<typeof useApp>;
  meta: string;
}): JSX.Element {
  const peak = Math.max(...max.map((m) => Number(m.total_poisha)), 1);
  const pct = Math.round((Number(poisha) / peak) * 100);
  return (
    <li className="rank-item">
      <span className="rank-main">
        <span className="rank-label truncate">{label}</span>
        <span className="rank-track"><span className="rank-fill" style={{ width: `${pct}%` }} /></span>
      </span>
      <span className="rank-value mono">{money(poisha, app.prefs, { decimals: 0 })}</span>
      <span className="text-xs text-3">{meta}</span>
    </li>
  );
}

function EntryForm({
  kind, categories, onClose, onSaved,
}: {
  kind: 'expense' | 'income' | null;
  categories: Categories | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [entryDate, setEntryDate] = useState(todayKey());
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [method, setMethod] = useState('cash');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [reference, setReference] = useState('');
  const [source, setSource] = useState('other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!kind) return;
    setEntryDate(todayKey());
    setAmount('');
    setCategoryId('');
    setMethod('cash');
    setDescription('');
    setVendor('');
    setReference('');
    setError('');
  }, [kind]);

  if (!kind) return <></>;

  const submit = async () => {
    const poisha = takaInputToPoisha(amount);
    if (poisha === null || poisha <= 0) {
      setError('Enter a valid amount greater than zero.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        entryDate,
        amountPoisha: poisha,
        categoryId: categoryId ? Number(categoryId) : undefined,
        method,
        description: description.trim(),
        vendor: vendor.trim(),
        reference: reference.trim(),
      };
      if (kind === 'expense') {
        await call('accounting.createExpense', payload);
        toast.success('Expense recorded', money(poisha, app.prefs));
      } else {
        await call('accounting.createIncome', { ...payload, source });
        toast.success('Income recorded', money(poisha, app.prefs));
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'The entry could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const options = kind === 'expense' ? (categories?.expense ?? []) : (categories?.income ?? []);

  return (
    <Modal
      open
      title={kind === 'expense' ? 'Record expense' : 'Record other income'}
      subtitle={`${date(entryDate, app.prefs)} · amounts are stored in poisha`}
      onClose={onClose}
      width={600}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>Save entry</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="grid grid-3">
          <Field label="Date" required>
            <input className="input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Amount (৳)" required>
            <input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Method" required>
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={PAYMENT_METHOD_CODES.map((c) => ({ value: c, label: PAYMENT_METHOD_LABELS[c] }))}
            />
          </Field>
        </div>
        <div className="grid grid-2">
          <Select
            label="Category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[{ value: '', label: 'Uncategorised' }, ...options.map((c) => ({ value: String(c.id), label: c.name }))]}
          />
          {kind === 'income' ? (
            <Select
              label="Source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              options={[
                { value: 'other', label: 'Other' },
                { value: 'consultation', label: 'Consultation' },
                { value: 'treatment', label: 'Treatment' },
              ]}
            />
          ) : (
            <TextInput label="Vendor / paid to" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Dhaka Electric Supply" />
          )}
        </div>
        {kind === 'income' ? (
          <TextInput label="Received from" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        ) : null}
        <TextInput
          label="Description"
          required={kind === 'expense'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={kind === 'expense' ? 'e.g. February rent' : 'e.g. Lab refund for failed crown'}
        />
        <TextInput label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque no., receipt no." />
        <p className="text-xs text-3 row row-1" style={{ gap: 6 }}>
          <Icon name="info-circle" size={13} /> This entry is separate from patient payments and does not affect any
          invoice balance.
        </p>
      </div>
    </Modal>
  );
}
