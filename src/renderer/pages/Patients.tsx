import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call } from '../lib/api';
import {
  Badge, Button, Checkbox, Column, DataTable, Pagination, PageHeader,
  Segmented, Select, TextInput, useDebounced, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { age, date, GENDER_LABELS, money, STATUS_LABELS, statusTone } from '../lib/format';
import { PatientForm } from './PatientForm';

export interface PatientRow {
  id: number;
  patient_code: string;
  full_name: string;
  gender: string;
  date_of_birth: string | null;
  age_years: number | null;
  age_months: number | null;
  phone: string | null;
  alt_phone: string | null;
  status: string;
  is_favourite: number;
  created_at: string;
  last_visit_at: string | null;
  blood_group: string | null;
  area: string | null;
  district: string | null;
  present_complaint: string | null;
  visit_count: number;
  total_billed_poisha: number | null;
  total_paid_poisha: number | null;
}

interface PatientPage {
  rows: PatientRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
  { value: 'deceased', label: 'Deceased' },
];

export function PatientsPage(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();
  const toast = useToast();

  const [search, setSearch] = useState(route.query.get('search') ?? '');
  const [status, setStatus] = useState(route.query.get('status') ?? '');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name' | 'code'>('newest');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(route.query.get('new') === '1');
  const [editing, setEditing] = useState<PatientRow | null>(null);
  const [counts, setCounts] = useState<{ status: string; n: number }[]>([]);
  const debouncedSearch = useDebounced(search, 260);

  const list = useResource(
    () =>
      call<PatientPage>('patients.list', {
        search: debouncedSearch.trim() || undefined,
        status: status || undefined,
        sort,
        favouritesOnly,
        page,
        pageSize,
      }),
    [debouncedSearch, status, sort, favouritesOnly, page, pageSize, shell.refreshSignal],
  );

  useResource(
    () => call<{ status: string; n: number }[]>('patients.countByStatus').then(setCounts),
    [shell.refreshSignal],
  );

  // Reset to the first page whenever the filter changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, sort, favouritesOnly, pageSize]);

  // Ctrl+N opens the create form from anywhere on this screen.
  useEffect(() => {
    if (!app.has('patients.create')) return;
    const handler = () => setCreating(true);
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [app]);

  const toggleFavourite = async (row: PatientRow) => {
    await call('patients.toggleFavourite', { id: row.id });
    list.reload();
  };

  const columns = useMemo<Column<PatientRow>[]>(
    () => [
      {
        key: 'code',
        header: 'Code',
        width: 116,
        render: (row) => (
          <span className="row row-1" style={{ gap: 4 }}>
            <button
              type="button"
              className="star-btn"
              aria-label={row.is_favourite ? 'Unpin patient' : 'Pin patient'}
              onClick={(event) => {
                event.stopPropagation();
                void toggleFavourite(row);
              }}
            >
              <Icon name={row.is_favourite ? 'star-filled' : 'star'} size={14} />
            </button>
            <span className="mono text-xs">{row.patient_code}</span>
          </span>
        ),
      },
      {
        key: 'name',
        header: 'Patient',
        render: (row) => (
          <div className="stack stack-0" style={{ minWidth: 0 }}>
            <strong className="truncate">{row.full_name}</strong>
            <span className="text-xs text-3 truncate">
              {GENDER_LABELS[row.gender] ?? row.gender} · {age(row, app.prefs)}
              {row.blood_group ? ` · ${row.blood_group}` : ''}
            </span>
          </div>
        ),
      },
      {
        key: 'phone',
        header: 'Phone',
        width: 130,
        render: (row) => <span className="mono text-sm">{row.phone || '—'}</span>,
      },
      {
        key: 'area',
        header: 'Area',
        width: 130,
        render: (row) => <span className="truncate">{row.area || row.district || '—'}</span>,
      },
      {
        key: 'visits',
        header: 'Visits',
        width: 72,
        numeric: true,
        render: (row) => <span className="mono">{row.visit_count}</span>,
      },
      {
        key: 'lastVisit',
        header: 'Last visit',
        width: 110,
        render: (row) => <span className="text-sm">{row.last_visit_at ? date(row.last_visit_at, app.prefs) : '—'}</span>,
      },
      ...(app.has('payments.view')
        ? [
            {
              key: 'due',
              header: 'Due',
              width: 116,
              numeric: true,
              render: (row: PatientRow) => {
                const due = Number(row.total_billed_poisha ?? 0) - Number(row.total_paid_poisha ?? 0);
                return (
                  <span className={due > 0 ? 'mono text-danger' : 'mono text-3'}>
                    {due > 0 ? money(due, app.prefs, { decimals: 0 }) : '—'}
                  </span>
                );
              },
            } as Column<PatientRow>,
          ]
        : []),
      {
        key: 'status',
        header: 'Status',
        width: 100,
        render: (row) => <Badge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</Badge>,
      },
    ],
    [app, list],
  );

  const totalByStatus = useMemo(() => {
    const map = new Map(counts.map((c) => [c.status, Number(c.n)]));
    return { active: map.get('active') ?? 0, archived: map.get('archived') ?? 0, all: [...map.values()].reduce((a, b) => a + b, 0) };
  }, [counts]);

  const exportCsv = useCallback(async () => {
    const result = await call<{ filename: string; content: string; rows: number }>('exports.csv', { dataset: 'patients' });
    const { filesBridge } = await import('../lib/api');
    const saved = await filesBridge().saveText(result.filename, result.content);
    toast.success('Patient export ready', `${result.rows} rows${saved.saved ? '' : ' — the download was cancelled'}.`);
  }, [toast]);

  return (
    <>
      <PageHeader
        icon="patients"
        title="Patients"
        subtitle={`${totalByStatus.all} patient record(s) · ${totalByStatus.active} active`}
        actions={
          <>
            {app.has('patients.export') ? (
              <Button icon="download" onClick={() => void exportCsv()}>Export</Button>
            ) : null}
            {app.has('patients.create') ? (
              <Button variant="primary" icon="user-plus" onClick={() => setCreating(true)}>
                New patient
              </Button>
            ) : null}
          </>
        }
      />

      <div className="filter-bar">
        <div className="filter-search">
          <TextInput
            aria-label="Search patients"
            placeholder="Search by name, code, phone or Bengali text…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon="search"
            inputSize="sm"
          />
        </div>
        <Select
          aria-label="Status filter"
          inputSize="sm"
          style={{ width: 150 }}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={STATUS_OPTIONS}
        />
        <Segmented
          label="Sort patients"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
            { value: 'name', label: 'A–Z' },
            { value: 'code', label: 'Code' },
          ]}
        />
        <Checkbox label="Pinned only" checked={favouritesOnly} onChange={(event) => setFavouritesOnly(event.target.checked)} />
        <span className="spacer" />
        <Button size="sm" icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          rows={list.data?.rows ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => route.navigate(`patients/${row.id}`)}
          empty={
            search || status || favouritesOnly ? (
              <div className="state state--compact">
                <div className="state-title">No patients match these filters</div>
                <div className="state-text">Try a different search term or clear the filters.</div>
                <div className="state-actions">
                  <Button
                    onClick={() => {
                      setSearch('');
                      setStatus('');
                      setFavouritesOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              </div>
            ) : (
              <div className="state">
                <div className="state-title">No patients yet</div>
                <div className="state-text">Add the first patient to start building your clinic records.</div>
                {app.has('patients.create') ? (
                  <div className="state-actions">
                    <Button variant="primary" icon="user-plus" onClick={() => setCreating(true)}>Add first patient</Button>
                  </div>
                ) : null}
              </div>
            )
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

      <PatientForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(id) => {
          setCreating(false);
          toast.success('Patient created', 'The record is ready for visits and billing.');
          route.navigate(`patients/${id}`);
        }}
      />

      <PatientForm
        open={Boolean(editing)}
        patient={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          list.reload();
        }}
      />
    </>
  );
}

/** The form re-reads the full record itself, so it only needs these identifying fields. */
export interface PatientFormTarget {
  id: number;
  patient_code: string;
  full_name: string;
  created_at: string;
}

export interface PatientFormProps {
  open: boolean;
  patient?: PatientFormTarget | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}
