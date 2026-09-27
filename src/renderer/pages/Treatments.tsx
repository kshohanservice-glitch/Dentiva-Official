import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useShell } from '../app/AppShell';
import { call, ApiError } from '../lib/api';
import {
  Badge, Button, Callout, Checkbox, DataTable, Field, Modal, PageHeader, Pagination, Select,
  TextArea, TextInput, useConfirm, useDebounced, useResource, useToast,
} from '../components/ui';
import { money, poishaToInput } from '../lib/format';
import { takaInputToPoisha } from '../../core/money/money';

interface TreatmentRow {
  id: number;
  code: string;
  name: string;
  category_id: number | null;
  category_name: string | null;
  description: string;
  default_price_poisha: number;
  duration_minutes: number;
  is_active: number;
  is_system: number;
  notes: string;
}

interface TreatmentPage {
  rows: TreatmentRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface Category {
  id: number;
  name: string;
}

export function TreatmentsPage(): JSX.Element {
  const app = useApp();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<TreatmentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search, 250);

  const list = useResource(
    () => call<TreatmentPage>('treatments.list', { search: debounced.trim() || undefined, categoryId: categoryId ? Number(categoryId) : undefined, page, pageSize }),
    [debounced, categoryId, page, pageSize, shell.refreshSignal],
  );
  const categories = useResource(() => call<Category[]>('treatments.categories'), [shell.refreshSignal]);

  useEffect(() => setPage(1), [debounced, categoryId, pageSize]);

  useEffect(() => {
    if (!app.has('treatments.manage')) return;
    const handler = () => setCreating(true);
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [app]);

  const remove = async (row: TreatmentRow) => {
    const ok = await confirm({
      title: `Remove ${row.name}?`,
      message:
        row.is_system
          ? 'This is a built-in treatment. It will be hidden from pickers but stay on historical records.'
          : 'If this treatment has been used, it is deactivated rather than deleted so history stays intact.',
      tone: 'danger',
      confirmLabel: 'Remove treatment',
    });
    if (!ok) return;
    try {
      const result = await call<{ deactivated: boolean }>('treatments.delete', { id: row.id });
      toast.success(result.deactivated ? 'Treatment deactivated' : 'Treatment deleted', row.name);
      list.reload();
    } catch (error) {
      toast.error('Could not remove', error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <>
      <PageHeader
        icon="treatments"
        title="Treatment catalogue"
        subtitle={`${list.data?.total ?? 0} treatment(s) used on invoices and the dental chart`}
        actions={
          app.has('treatments.manage') ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New treatment</Button>
          ) : null
        }
      />

      <div className="filter-bar">
        <div className="filter-search">
          <TextInput
            aria-label="Search treatments"
            placeholder="Search by name or code…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon="search"
            inputSize="sm"
          />
        </div>
        <Select
          aria-label="Category"
          inputSize="sm"
          style={{ width: 180 }}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          options={[
            { value: '', label: 'All categories' },
            ...(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name })),
          ]}
        />
        <span className="spacer" />
        <Button size="sm" icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
      </div>

      <div className="card">
        <DataTable
          rows={list.data?.rows ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => (app.has('treatments.manage') ? setEditing(row) : undefined)}
          columns={[
            { key: 'code', header: 'Code', width: 108, render: (row) => <span className="mono text-sm">{row.code}</span> },
            {
              key: 'name',
              header: 'Treatment',
              render: (row) => (
                <div className="stack stack-0" style={{ minWidth: 0 }}>
                  <strong className="truncate">{row.name}</strong>
                  {row.description ? <span className="text-xs text-3 truncate">{row.description}</span> : null}
                </div>
              ),
            },
            { key: 'category', header: 'Category', width: 160, render: (row) => row.category_name ?? 'Uncategorised' },
            { key: 'duration', header: 'Duration', width: 96, numeric: true, render: (row) => (row.duration_minutes ? `${row.duration_minutes} min` : '—') },
            {
              key: 'price',
              header: 'Default price',
              width: 130,
              numeric: true,
              render: (row) => <span className="mono">{money(row.default_price_poisha, app.prefs)}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              width: 96,
              render: (row) => (row.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Hidden</Badge>),
            },
            ...(app.has('treatments.manage')
              ? [
                  {
                    key: 'actions',
                    header: '',
                    width: 96,
                    render: (row: TreatmentRow) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        aria-label={`Remove ${row.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void remove(row);
                        }}
                      />
                    ),
                  },
                ]
              : []),
          ]}
          empty={
            <div className="state">
              <div className="state-title">No treatments in the catalogue</div>
              <div className="state-text">
                Add the procedures your clinic performs so they can be billed in one click and tracked on the dental chart.
              </div>
              {app.has('treatments.manage') ? (
                <div className="state-actions">
                  <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Add first treatment</Button>
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

      <TreatmentForm
        open={creating}
        categories={categories.data ?? []}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          list.reload();
        }}
      />
      <TreatmentForm
        open={Boolean(editing)}
        treatment={editing}
        categories={categories.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          list.reload();
        }}
      />
    </>
  );
}

function TreatmentForm({
  open, treatment, categories, onClose, onSaved,
}: {
  open: boolean;
  treatment?: TreatmentRow | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', code: '', categoryId: '', description: '', price: '', duration: '30', notes: '', isActive: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setError('');
    setErrors({});
    if (treatment) {
      setForm({
        name: treatment.name,
        code: treatment.code,
        categoryId: treatment.category_id ? String(treatment.category_id) : '',
        description: treatment.description ?? '',
        price: poishaToInput(treatment.default_price_poisha),
        duration: String(treatment.duration_minutes ?? 30),
        notes: treatment.notes ?? '',
        isActive: Boolean(treatment.is_active),
      });
    } else {
      setForm({ name: '', code: '', categoryId: '', description: '', price: '', duration: '30', notes: '', isActive: true });
    }
  }, [open, treatment]);

  const preview = useMemo(() => takaInputToPoisha(form.price) ?? 0, [form.price]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        categoryId: form.categoryId ? Number(form.categoryId) : undefined,
        description: form.description.trim(),
        defaultPricePoisha: preview,
        durationMinutes: Number(form.duration) || 0,
        notes: form.notes.trim(),
        isActive: form.isActive,
      };
      if (treatment) {
        await call('treatments.update', { id: treatment.id, ...payload });
        toast.success('Treatment updated', payload.name);
      } else {
        await call('treatments.create', payload);
        toast.success('Treatment added', payload.name);
      }
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'The treatment could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={treatment ? `Edit ${treatment.name}` : 'New treatment'}
      subtitle="Prices are the clinic default — they can still be overridden per invoice line"
      onClose={onClose}
      width={640}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>
            {treatment ? 'Save changes' : 'Add treatment'}
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="grid grid-2">
          <TextInput label="Treatment name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          <TextInput label="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} className="mono" placeholder="e.g. RC-01" />
        </div>
        <div className="grid grid-3">
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            options={[{ value: '', label: 'Uncategorised' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
          />
          <Field label="Default price (৳)" error={errors.defaultPricePoisha}>
            <input className="input mono" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" />
          </Field>
          <Field label="Duration (minutes)" error={errors.durationMinutes}>
            <input className="input" type="number" min={0} max={600} step={5} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
          </Field>
        </div>
        <TextArea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} />
        <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} error={errors.notes} />
        <Checkbox label="Available for new records" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
        <p className="text-xs text-3">
          This treatment will be billed at <strong className="mono">{money(preview, app.prefs)}</strong> by default.
        </p>
      </div>
    </Modal>
  );
}
