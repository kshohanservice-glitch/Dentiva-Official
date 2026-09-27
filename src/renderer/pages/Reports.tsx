import { useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { call, ApiError, filesBridge } from '../lib/api';
import {
  Badge, Button, Callout, Card, DataTable, Field, PageHeader, Select, Stat, Tabs, TextInput,
  useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { date, dateAndTime, money, todayKey } from '../lib/format';
import { runPrint, type PrintOutput } from '../lib/printing';

type RangeKey = 'today' | '7d' | '30d' | '90d' | '1y' | 'custom' | 'all';

type DocKind =
  | 'daily-summary'
  | 'collection'
  | 'payment-summary'
  | 'outstanding'
  | 'treatment-revenue'
  | 'expense'
  | 'income'
  | 'inventory'
  | 'patient-list'
  | 'audit';

interface ReportModel {
  kind: DocKind;
  from: string;
  to: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, unknown>[];
  totals: { label: string; valuePoisha: number }[];
  clinic: Record<string, unknown>;
  generatedAt: string;
}

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last year' },
  { value: 'custom', label: 'Custom range' },
  { value: 'all', label: 'All time' },
];

type ReportMeta = {
  value: DocKind;
  label: string;
  icon: 'chart' | 'invoice' | 'payments' | 'wallet' | 'trending-up' | 'accounting' | 'package' | 'patients' | 'activity';
  description: string;
  csv: 'patients' | 'invoices' | 'payments' | 'inventory' | 'expenses' | 'income' | 'appointments' | 'prescriptions' | null;
};

const REPORT_KINDS: ReportMeta[] = [
  { value: 'daily-summary', label: 'Daily summary', icon: 'chart', description: 'Income, expenses and invoicing per day', csv: null },
  { value: 'collection', label: 'Invoice collection', icon: 'invoice', description: 'Every invoice in range with paid and balance', csv: 'invoices' },
  { value: 'payment-summary', label: 'Payments received', icon: 'payments', description: 'Every receipt and refund, with the staff member who took it', csv: 'payments' },
  { value: 'outstanding', label: 'Outstanding receivables', icon: 'wallet', description: 'Patients with an unpaid balance, largest first', csv: null },
  { value: 'treatment-revenue', label: 'Treatment revenue', icon: 'trending-up', description: 'Revenue by treatment across the range', csv: null },
  { value: 'expense', label: 'Expenses', icon: 'accounting', description: 'Every expense entry with category and vendor', csv: 'expenses' },
  { value: 'income', label: 'Other income', icon: 'accounting', description: 'Income that does not come from an invoice', csv: 'income' },
  { value: 'inventory', label: 'Stock on hand', icon: 'package', description: 'Current stock levels and the next expiry for each item', csv: 'inventory' },
  { value: 'patient-list', label: 'Registered patients', icon: 'patients', description: 'Patients registered in the range', csv: 'patients' },
  { value: 'audit', label: 'Audit trail', icon: 'activity', description: 'Every recorded action in the range', csv: null },
];

function shiftKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ReportsPage(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const toast = useToast();

  const [kind, setKind] = useState<DocKind>('daily-summary');
  const [range, setRange] = useState<RangeKey>('30d');
  const [from, setFrom] = useState(shiftKey(29));
  const [to, setTo] = useState(todayKey());
  const [limit, setLimit] = useState('500');
  const [tab, setTab] = useState<'report' | 'export'>('report');
  const [printing, setPrinting] = useState<PrintOutput | ''>('');

  const meta: ReportMeta = REPORT_KINDS.find((entry) => entry.value === kind) ?? REPORT_KINDS[0]!;
  const permission = permissionFor(kind);
  const allowed = app.hasAny(...permission);

  const report = useResource<ReportModel | null>(
    () =>
      allowed
        ? call<ReportModel>('documents.report', {
            kind,
            range,
            from: range === 'custom' ? from : undefined,
            to: range === 'custom' ? to : undefined,
            limit: Number(limit) || 500,
          })
        : Promise.resolve(null),
    [kind, range, from, to, limit, allowed],
  );

  const summary = useMemo(() => {
    const totals = report.data?.totals ?? [];
    return new Map(totals.map((entry) => [entry.label, Number(entry.valuePoisha) || 0]));
  }, [report.data]);

  const print = async (output: PrintOutput) => {
    if (!report.data) return;
    setPrinting(output);
    try {
      await runPrint(
        { docKind: 'report', entityId: null, entityLabel: meta.label, data: { ...report.data, title: meta.label } },
        output,
        app.token,
      );
      if (output === 'pdf') toast.success('Report PDF saved');
      if (output === 'print') toast.success('Sent to the printer');
    } catch (caught) {
      toast.error('Could not produce the report', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPrinting('');
    }
  };

  const exportCsv = async () => {
    if (!meta.csv) return;
    try {
      const result = await call<{ filename: string; content: string; rows: number }>('exports.csv', {
        dataset: meta.csv,
        range,
        from: range === 'custom' ? from : undefined,
        to: range === 'custom' ? to : undefined,
      });
      const saved = await filesBridge().saveText(result.filename, result.content);
      toast.success('Export ready', saved.saved ? `${result.rows} rows` : 'The download was cancelled.');
    } catch (caught) {
      toast.error('Export failed', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  if (!app.hasAny('reports.view', 'accounting.view')) {
    return (
      <>
        <PageHeader title="Reports" icon="chart" />
        <Callout tone="warn" title="No access">Your role does not include reporting.</Callout>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reports"
        icon="chart"
        subtitle="Every report is generated from the local database and can be printed or exported"
        actions={
          <>
            <Button icon="eye" loading={printing === 'preview'} disabled={!report.data} onClick={() => void print('preview')}>
              Preview
            </Button>
            <Button icon="printer" loading={printing === 'print'} disabled={!report.data} onClick={() => void print('print')}>
              Print
            </Button>
            <Button variant="primary" icon="download" loading={printing === 'pdf'} disabled={!report.data} onClick={() => void print('pdf')}>
              Save PDF
            </Button>
          </>
        }
      />

      <div className="grid grid-1-2 mt-3">
        <Card title="Report" icon="chart">
          <div className="stack stack-2">
            {REPORT_KINDS.map((entry) => {
              const enabled = app.hasAny(...permissionFor(entry.value));
              return (
                <button
                  key={entry.value}
                  type="button"
                  className="picker-item"
                  aria-current={entry.value === kind}
                  disabled={!enabled}
                  onClick={() => setKind(entry.value)}
                >
                  <Icon name={entry.icon} size={16} className="shrink-0" />
                  <span className="picker-item-main">
                    <span className="truncate">{entry.label}</span>
                    <span className="text-xs text-3">{enabled ? entry.description : 'Not available for your role'}</span>
                  </span>
                  {entry.value === kind ? <Icon name="check" size={15} className="text-primary" /> : null}
                </button>
              );
            })}
          </div>
        </Card>

        <div className="stack stack-3">
          <Card title="Filters" icon="filter">
            <div className="filter-bar" style={{ border: 0, padding: 0 }}>
              <Select
                label="Period"
                value={range}
                onChange={(event) => setRange(event.target.value as RangeKey)}
                options={RANGE_OPTIONS}
                style={{ width: 200 }}
              />
              {range === 'custom' ? (
                <>
                  <Field label="From">
                    <input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                  </Field>
                  <Field label="To">
                    <input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                  </Field>
                </>
              ) : null}
              <Field label="Maximum rows" hint="Reports never silently truncate: the limit is shown below.">
                <TextInput inputSize="sm" inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value)} style={{ width: 110 }} />
              </Field>
            </div>
          </Card>

          {summary.size > 0 ? (
            <div className="stat-grid stat-grid--compact">
              {[...summary.entries()].map(([label, value]) => (
                <Stat
                  key={label}
                  label={label}
                  value={money(value, app.prefs, { decimals: 0 })}
                  icon="wallet"
                  tone={value === 0 ? 'info' : 'primary'}
                />
              ))}
            </div>
          ) : null}

          <div className="mt-3">
            <Tabs
              ariaLabel="Report output"
              value={tab}
              onChange={(next) => setTab(next as 'report' | 'export')}
              items={[
                { id: 'report', label: 'On screen', icon: 'eye' },
                { id: 'export', label: 'Export', icon: 'download' },
              ]}
            />
          </div>

          <div className="mt-3">
            {tab === 'report' ? (
              <Card
                title={meta.label}
                icon={meta.icon}
                subtitle={report.data ? `${report.data.from} → ${report.data.to} · ${report.data.rows.length} row(s)` : 'Loading…'}
                flush
              >
                <DataTable
                  rows={(report.data?.rows ?? []).map((row, index) => ({ ...row, id: `${kind}-${index}` }))}
                  loading={report.loading}
                  error={report.error}
                  onRetry={report.reload}
                  maxHeight={520}
                  columns={(report.data?.columns ?? []).map((column) => ({
                    key: column.key,
                    header: column.label,
                    numeric: column.numeric,
                    render: (row: Record<string, unknown> & { id: string }) =>
                      column.numeric ? (
                        <span className="mono">{money(Number(row[column.key] ?? 0), app.prefs)}</span>
                      ) : (
                        <span className="truncate">
                          {column.key.endsWith('_poisha')
                            ? money(Number(row[column.key] ?? 0), app.prefs)
                            : String(row[column.key] ?? '—')}
                        </span>
                      ),
                  }))}
                  empty={
                    <div className="state">
                      <div className="state-title">Nothing in this period</div>
                      <div className="state-text">Widen the date range, or pick a different report.</div>
                    </div>
                  }
                />
              </Card>
            ) : (
              <Card title="Export this data" icon="download">
                <div className="stack stack-3">
                  <p className="text-sm text-2">
                    CSV files open directly in Excel. Bengali names and descriptions are written as UTF-8 with a byte
                    order mark, so Excel on Windows shows them correctly without any import step.
                  </p>
                  <div className="row row-2 row-wrap">
                    <Button
                      variant="primary"
                      icon="download"
                      disabled={!meta.csv}
                      onClick={() => void exportCsv()}
                    >
                      Export {meta.csv ?? 'this report'} as CSV
                    </Button>
                    <Button icon="file-text" disabled={!report.data} loading={printing === 'pdf'} onClick={() => void print('pdf')}>
                      Export as PDF
                    </Button>
                  </div>
                  {!meta.csv ? (
                    <Callout tone="info">
                      This report has no matching CSV export because it is a live calculation rather than a stored
                      dataset. Use <strong>Save PDF</strong> or <strong>Print</strong> instead.
                    </Callout>
                  ) : null}
                  {report.data ? (
                    <Callout tone="info" title="What is included">
                      {report.data.rows.length} row(s) between {date(report.data.from, app.prefs)} and{' '}
                      {date(report.data.to, app.prefs)}, generated {dateAndTime(report.data.generatedAt, '', app.prefs)}.
                    </Callout>
                  ) : null}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {app.has('audit.view') ? (
        <div className="mt-3">
          <Card title="Related" icon="activity">
            <div className="row row-2 row-wrap">
              <Button icon="activity" onClick={() => route.navigate('administration/staff?tab=audit')}>
                Open the full audit log
              </Button>
              <Button icon="accounting" onClick={() => route.navigate('billing/accounting')}>
                Open income &amp; expenses
              </Button>
              <Button icon="wallet" onClick={() => route.navigate('billing/payments')}>
                Open receivables
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {report.data && report.data.rows.length >= Number(limit) ? (
        <div className="mt-3">
          <Callout tone="warn" title="Row limit reached">
            This report stopped at {report.data.rows.length} rows. Raise the maximum above and run it again for the
            complete picture.
          </Callout>
        </div>
      ) : null}

      <div className="mt-3">
        <div className="row row-2 row-wrap text-xs text-3">
          <Badge tone="neutral">Generated from the local database</Badge>
          <span className="row row-1">
            <Icon name="lock" size={13} /> Reports never include passwords, activation data or clinical notes beyond what is listed.
          </span>
        </div>
      </div>
    </>
  );
}

function permissionFor(kind: DocKind): string[] {
  switch (kind) {
    case 'outstanding':
    case 'payment-summary':
      return ['payments.view', 'accounting.view', 'reports.view'];
    case 'collection':
      return ['invoices.view', 'accounting.view', 'reports.view'];
    case 'expense':
    case 'income':
    case 'daily-summary':
      return ['accounting.view', 'reports.view'];
    case 'inventory':
      return ['inventory.view', 'reports.view'];
    case 'patient-list':
      return ['patients.view', 'reports.view'];
    case 'audit':
      return ['audit.view'];
    case 'treatment-revenue':
      return ['treatments.view', 'accounting.view', 'reports.view'];
    default:
      return ['reports.view'];
  }
}
