import { useEffect, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useShell } from '../app/AppShell';
import { call, ApiError, filesBridge } from '../lib/api';
import {
  Badge, Button, Callout, Card, DataTable, Field, Modal, PageHeader, Pagination, Select, Stat,
  TextArea, TextInput, useConfirm, useDebounced, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { date, dateTime, money, poishaToInput, quantityLabel, todayKey } from '../lib/format';
import { takaInputToPoisha } from '../../core/money/money';
import { INVENTORY_CATEGORIES, INVENTORY_UNITS } from '../../shared/constants';

interface ItemRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  min_stock: number;
  expiry_alert_days: number;
  selling_price_poisha: number;
  is_active: number;
  notes: string;
  is_low: number;
  next_expiry: string | null;
}

interface ItemPage {
  rows: ItemRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface AlertSummary {
  low: { id: number; sku: string; name: string; current_stock: number; min_stock: number; unit: string }[];
  expiring: { batch_id: number; item_id: number; sku: string; name: string; batch_no: string; expiry_date: string; remaining: number; unit: string }[];
  expired: { batch_id: number; item_id: number; sku: string; name: string; batch_no: string; expiry_date: string; remaining: number; unit: string }[];
}

interface Valuation {
  totalItems: number;
  totalUnits: number;
  costValuePoisha: number;
  retailValuePoisha: number;
}

type StockAction = 'in' | 'out' | 'dispose' | 'adjust';

export function InventoryPage({ itemId }: { itemId?: string }): JSX.Element {
  const app = useApp();
  const shell = useShell();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [stockFor, setStockFor] = useState<{ item: ItemRow; action: StockAction } | null>(null);
  const [selected, setSelected] = useState<ItemRow | null>(null);
  const debounced = useDebounced(search, 250);

  const list = useResource(
    () => call<ItemPage>('inventory.list', { search: debounced.trim() || undefined, category: category || undefined, page, pageSize }),
    [debounced, category, page, pageSize, shell.refreshSignal],
  );
  const alerts = useResource(() => call<AlertSummary>('inventory.alerts'), [shell.refreshSignal]);
  const valuation = useResource(() => call<Valuation>('inventory.valuation'), [shell.refreshSignal]);
  const detail = useResource(
    () => (selected ? call<Detail>('inventory.get', { id: selected.id }) : Promise.resolve(null)),
    [selected?.id, shell.refreshSignal],
  );

  useEffect(() => setPage(1), [debounced, category, pageSize]);

  useEffect(() => {
    if (!app.has('inventory.manage')) return;
    const handler = () => setCreating(true);
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [app]);

  // Deep link from search results / notifications.
  useEffect(() => {
    if (!itemId) return;
    void call<ItemRow>('inventory.get', { id: Number(itemId) })
      .then((result) => setSelected((result as unknown as { item: ItemRow }).item))
      .catch(() => undefined);
  }, [itemId]);

  const exportCsv = async () => {
    const result = await call<{ filename: string; content: string; rows: number }>('exports.csv', { dataset: 'inventory' });
    const saved = await filesBridge().saveText(result.filename, result.content);
    toast.success('Inventory export ready', `${result.rows} rows${saved.saved ? '' : ' — cancelled'}.`);
  };

  const totalAlerts = (alerts.data?.low.length ?? 0) + (alerts.data?.expiring.length ?? 0) + (alerts.data?.expired.length ?? 0);

  if (selected) {
    return (
      <ItemDetail
        item={selected}
        detail={detail.data}
        loading={detail.loading}
        onBack={() => setSelected(null)}
        onStock={(action) => setStockFor({ item: selected, action })}
        onChanged={() => {
          detail.reload();
          list.reload();
          alerts.reload();
          valuation.reload();
          shell.requestRefresh();
        }}
      />
    );
  }

  return (
    <>
      <PageHeader
        icon="inventory"
        title="Inventory"
        subtitle={
          valuation.data
            ? `${valuation.data.totalItems} item(s) · ${valuation.data.totalUnits} unit(s) on hand`
            : undefined
        }
        actions={
          <>
            <Button icon="download" onClick={() => void exportCsv()}>Export</Button>
            {app.has('inventory.manage') ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New item</Button>
            ) : null}
          </>
        }
      />

      {valuation.data ? (
        <div className="stat-grid stat-grid--compact">
          <Stat label="Stock value (cost)" value={money(valuation.data.costValuePoisha, app.prefs, { decimals: 0 })} icon="database" tone="primary" />
          <Stat label="Retail value" value={money(valuation.data.retailValuePoisha, app.prefs, { decimals: 0 })} icon="trending-up" tone="ok" />
          <Stat label="Low stock items" value={alerts.data?.low.length ?? '—'} icon="alert-triangle" tone="warn" />
          <Stat label="Expiring batches" value={totalAlerts - (alerts.data?.low.length ?? 0)} icon="clock" tone={totalAlerts > 0 ? 'danger' : 'ok'} />
        </div>
      ) : null}

      {alerts.data && totalAlerts > 0 ? (
        <div className="mt-3">
          <Callout
            tone={alerts.data.expired.length > 0 ? 'danger' : 'warn'}
            title={`${totalAlerts} stock alert${totalAlerts === 1 ? '' : 's'}`}
          >
            <div className="row row-wrap" style={{ gap: 6, marginTop: 4 }}>
              {alerts.data.expired.map((batch) => (
                <Badge key={`exp-${batch.batch_id}`} tone="danger">
                  {batch.name} expired {date(batch.expiry_date, app.prefs)}
                </Badge>
              ))}
              {alerts.data.expiring.map((batch) => (
                <Badge key={`exp2-${batch.batch_id}`} tone="warn">
                  {batch.name} expires {date(batch.expiry_date, app.prefs)}
                </Badge>
              ))}
              {alerts.data.low.map((item) => (
                <Badge key={`low-${item.id}`} tone="warn">
                  {item.name}: {item.current_stock}/{item.min_stock} {item.unit}
                </Badge>
              ))}
            </div>
          </Callout>
        </div>
      ) : null}

      <div className="filter-bar mt-3">
        <div className="filter-search">
          <TextInput
            aria-label="Search inventory"
            placeholder="Search by name or SKU…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon="search"
            inputSize="sm"
          />
        </div>
        <Select
          aria-label="Category"
          inputSize="sm"
          style={{ width: 170 }}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          options={[{ value: '', label: 'All categories' }, ...INVENTORY_CATEGORIES.map((c) => ({ value: c, label: c }))]}
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
          onRowClick={(row) => setSelected(row)}
          columns={[
            { key: 'sku', header: 'SKU', width: 118, render: (row) => <span className="mono text-sm">{row.sku}</span> },
            {
              key: 'name',
              header: 'Item',
              render: (row) => (
                <div className="stack stack-0" style={{ minWidth: 0 }}>
                  <strong className="truncate">{row.name}</strong>
                  <span className="text-xs text-3">{row.category || 'Uncategorised'}</span>
                </div>
              ),
            },
            {
              key: 'stock',
              header: 'Stock',
              width: 130,
              numeric: true,
              render: (row) => (
                <span className={row.is_low ? 'mono text-warn' : 'mono'}>
                  {quantityLabel(row.current_stock)} {row.unit}
                  {row.is_low ? <Icon name="alert-triangle" size={12} /> : null}
                </span>
              ),
            },
            { key: 'min', header: 'Minimum', width: 92, numeric: true, render: (row) => <span className="mono text-3">{quantityLabel(row.min_stock)}</span> },
            { key: 'expiry', header: 'Next expiry', width: 118, render: (row) => (row.next_expiry ? date(row.next_expiry, app.prefs) : '—') },
            {
              key: 'price',
              header: 'Sale price',
              width: 118,
              numeric: true,
              render: (row) => <span className="mono">{money(row.selling_price_poisha, app.prefs)}</span>,
            },
            ...(app.has('inventory.manage')
              ? [
                  {
                    key: 'actions',
                    header: '',
                    width: 168,
                    render: (row: ItemRow) => (
                      <div className="row row-1" style={{ gap: 4 }} onClick={(event) => event.stopPropagation()}>
                        <Button size="sm" icon="upload" onClick={() => setStockFor({ item: row, action: 'in' })}>In</Button>
                        <Button size="sm" icon="download" onClick={() => setStockFor({ item: row, action: 'out' })}>Out</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="rotate-ccw"
                          aria-label={`Adjust ${row.name}`}
                          onClick={() => setStockFor({ item: row, action: 'adjust' })}
                        />
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
          empty={
            <div className="state">
              <div className="state-title">No inventory items</div>
              <div className="state-text">
                Track the consumables you use so low stock and expiry warnings reach you before a patient is turned away.
              </div>
              {app.has('inventory.manage') ? (
                <div className="state-actions">
                  <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Add first item</Button>
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

      <ItemForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          list.reload();
          alerts.reload();
          valuation.reload();
        }}
      />

      {stockFor ? (
        <StockModal
          item={stockFor.item}
          action={stockFor.action}
          onClose={() => setStockFor(null)}
          onSaved={() => {
            setStockFor(null);
            list.reload();
            alerts.reload();
            valuation.reload();
            detail.reload();
            shell.requestRefresh();
          }}
        />
      ) : null}

      {app.has('inventory.manage') ? (
        <p className="text-xs text-3 mt-3 row row-1" style={{ gap: 6 }}>
          <Icon name="shield" size={13} /> Issues consume the oldest non-expired batch first (FEFO), so expiry dates are
          honoured automatically.
        </p>
      ) : null}
    </>
  );
}

interface Detail {
  item: ItemRow;
  batches: { id: number; batch_no: string; expiry_date: string | null; quantity_received: number; quantity_issued: number; unit_cost_poisha: number; location: string }[];
  transactions: { id: number; type: string; quantity: number; unit_cost_poisha: number; reference: string; note: string; performed_at: string; performed_by_name: string | null; batch_no: string | null }[];
}

function ItemDetail({
  item, detail, loading, onBack, onStock, onChanged,
}: {
  item: ItemRow;
  detail: Detail | null;
  loading: boolean;
  onBack: () => void;
  onStock: (action: StockAction) => void;
  onChanged: () => void;
}): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const confirm = useConfirm();

  return (
    <>
      <PageHeader
        icon="package"
        title={item.name}
        subtitle={`${item.sku} · ${item.category || 'Uncategorised'}`}
        breadcrumb={[{ label: 'Inventory', href: 'billing/inventory' }, { label: item.name }]}
        actions={
          <>
            <Button icon="arrow-left" onClick={onBack}>Back to inventory</Button>
            {app.has('inventory.manage') ? (
              <>
                <Button icon="upload" onClick={() => onStock('in')}>Receive stock</Button>
                <Button icon="download" onClick={() => onStock('out')}>Issue stock</Button>
                <Button variant="ghost" icon="rotate-ccw" onClick={() => onStock('adjust')}>Adjust</Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="stat-grid stat-grid--compact">
        <Stat label="On hand" value={`${quantityLabel(item.current_stock)} ${item.unit}`} icon="package" tone={item.is_low ? 'warn' : 'ok'} />
        <Stat label="Minimum level" value={`${quantityLabel(item.min_stock)} ${item.unit}`} icon="alert-triangle" tone="info" />
        <Stat label="Sale price" value={money(item.selling_price_poisha, app.prefs)} icon="receipt" tone="primary" />
        <Stat
          label="Stock value (cost)"
          value={money(
            (detail?.batches ?? []).reduce(
              (sum, b) => sum + (b.quantity_received - b.quantity_issued) * b.unit_cost_poisha,
              0,
            ),
            app.prefs,
            { decimals: 0 },
          )}
          icon="database"
        />
      </div>

      {item.is_low ? (
        <div className="mt-3">
          <Callout tone="warn" title="Below minimum stock">
            {item.name} has {quantityLabel(item.current_stock)} {item.unit} left against a minimum of{' '}
            {quantityLabel(item.min_stock)}. Receive more before the next appointment.
          </Callout>
        </div>
      ) : null}

      <div className="grid grid-2 mt-4">
        <Card title="Batches" subtitle="Oldest non-expired stock is issued first" flush>
          <DataTable
            compact
            loading={loading}
            rows={(detail?.batches ?? []).map((batch) => ({ ...batch, id: batch.id }))}
            columns={[
              { key: 'batch', header: 'Batch', width: 110, render: (row) => <span className="mono text-sm">{row.batch_no || '—'}</span> },
              {
                key: 'qty',
                header: 'Remaining',
                width: 110,
                numeric: true,
                render: (row) => `${quantityLabel(row.quantity_received - row.quantity_issued)} ${item.unit}`,
              },
              { key: 'expiry', header: 'Expiry', width: 110, render: (row) => (row.expiry_date ? date(row.expiry_date, app.prefs) : '—') },
              { key: 'cost', header: 'Unit cost', width: 110, numeric: true, render: (row) => money(row.unit_cost_poisha, app.prefs) },
              { key: 'loc', header: 'Location', render: (row) => row.location || '—' },
            ]}
            empty={<div className="state state--compact"><div className="state-title">No batches</div><div className="state-text">Receive stock to create the first batch.</div></div>}
          />
        </Card>

        <Card title="Movement history" icon="activity" flush>
          <DataTable
            compact
            maxHeight={420}
            loading={loading}
            rows={(detail?.transactions ?? []).map((tx) => ({ ...tx, id: tx.id }))}
            columns={[
              {
                key: 'type',
                header: 'Type',
                width: 88,
                render: (row) => (
                  <Badge tone={row.type === 'in' ? 'ok' : row.type === 'out' ? 'info' : 'warn'}>
                    {row.type === 'in' ? 'Received' : row.type === 'out' ? 'Issued' : row.type === 'dispose' ? 'Disposed' : row.type}
                  </Badge>
                ),
              },
              { key: 'qty', header: 'Qty', width: 84, numeric: true, render: (row) => <span className="mono">{quantityLabel(row.quantity)}</span> },
              { key: 'when', header: 'When', width: 140, render: (row) => <span className="text-sm">{dateTime(row.performed_at, app.prefs)}</span> },
              {
                key: 'by',
                header: 'By',
                render: (row) => (
                  <div className="stack stack-0" style={{ minWidth: 0 }}>
                    <span className="truncate text-sm">{row.performed_by_name ?? 'System'}</span>
                    {row.note ? <span className="text-xs text-3 truncate">{row.note}</span> : null}
                  </div>
                ),
              },
            ]}
            empty={<div className="state state--compact"><div className="state-title">No movements yet</div></div>}
          />
        </Card>
      </div>

      {item.notes ? (
        <Card title="Notes" className="mt-4">
          <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</p>
        </Card>
      ) : null}

      {app.has('inventory.manage') ? (
        <div className="row row-2 mt-4">
          <Button
            variant="danger-soft"
            icon="ban"
            onClick={() => {
              void (async () => {
                const ok = await confirm({
                  title: `Deactivate ${item.name}?`,
                  message: 'Deactivated items stay on past invoices and reports but disappear from new entries.',
                  tone: 'danger',
                  confirmLabel: 'Deactivate',
                });
                if (!ok) return;
                try {
                  await call('inventory.update', { id: item.id, name: item.name, sku: item.sku, isActive: false });
                  toast.success('Item deactivated', item.name);
                  onChanged();
                  onBack();
                } catch (error) {
                  toast.error('Could not deactivate', error instanceof Error ? error.message : undefined);
                }
              })();
            }}
          >
            Deactivate item
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ItemForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', sku: '', category: 'Consumable', unit: 'pcs', minStock: '0', expiryAlertDays: '30', price: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm({ name: '', sku: '', category: 'Consumable', unit: 'pcs', minStock: '0', expiryAlertDays: '30', price: '', notes: '' });
    setError('');
    setErrors({});
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await call('inventory.create', {
        name: form.name.trim(),
        sku: form.sku.trim().toUpperCase(),
        category: form.category,
        unit: form.unit,
        minStock: Number(form.minStock) || 0,
        expiryAlertDays: Number(form.expiryAlertDays) || 0,
        sellingPricePoisha: takaInputToPoisha(form.price) ?? 0,
        notes: form.notes.trim(),
      });
      toast.success('Item added', form.name.trim());
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'The item could not be added.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="New inventory item"
      subtitle="Consumables you track by batch and expiry date"
      onClose={onClose}
      width={640}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>Add item</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="grid grid-2">
          <TextInput label="Item name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          <TextInput label="SKU / code" required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} error={errors.sku} className="mono" placeholder="e.g. GLOVE-M-100" />
        </div>
        <div className="grid grid-2">
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <Select label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} options={INVENTORY_UNITS.map((u) => ({ value: u, label: u }))} />
        </div>
        <div className="grid grid-3">
          <TextInput label="Minimum stock" type="number" min={0} value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} error={errors.minStock} />
          <TextInput label="Expiry alert (days)" type="number" min={0} value={form.expiryAlertDays} onChange={(e) => setForm({ ...form, expiryAlertDays: e.target.value })} error={errors.expiryAlertDays} />
          <TextInput label="Sale price (৳)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="0.00" error={errors.sellingPricePoisha} />
        </div>
        <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <p className="text-xs text-3">
          Preview: {form.name || 'Item name'} will warn you when stock falls to {form.minStock || 0} {form.unit} and{' '}
          {form.expiryAlertDays || 0} days before expiry. All amounts are in poisha ({takaInputToPoisha(form.price) ?? 0}).
        </p>
      </div>
    </Modal>
  );
}

function StockModal({
  item, action, onClose, onSaved,
}: {
  item: ItemRow;
  action: StockAction;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState(poishaToInput(item.selling_price_poisha));
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [newQuantity, setNewQuantity] = useState(poishaToInput(item.current_stock));
  const [reason, setReason] = useState('');
  const [type, setType] = useState<'out' | 'dispose'>('out');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    setQuantity('1');
    setUnitCost(poishaToInput(item.selling_price_poisha));
    setBatchNo('');
    setExpiryDate('');
    setReference('');
    setNote('');
    setNewQuantity(poishaToInput(item.current_stock));
    setReason('');
    setType('out');
    setError('');
    if (action === 'in') {
      void call<{ rows: { id: number; name: string }[] }>('inventory.suppliers.list', {})
        .then((result) => setSuppliers(result.rows))
        .catch(() => setSuppliers([]));
    }
  }, [action, item]);

  const title =
    action === 'in' ? 'Receive stock' : action === 'out' ? 'Issue stock' : action === 'dispose' ? 'Dispose stock' : 'Adjust stock to actual count';

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (action === 'in') {
        const result = await call<{ currentStock: number }>('inventory.stockIn', {
          itemId: item.id,
          quantity: Number(quantity),
          unitCostPoisha: takaInputToPoisha(unitCost) ?? 0,
          batchNo: batchNo.trim() || undefined,
          expiryDate: expiryDate || undefined,
          supplierId: supplierId ? Number(supplierId) : undefined,
          reference: reference.trim(),
          note: note.trim(),
        });
        toast.success('Stock received', `${item.name} now ${quantityLabel(result.currentStock)} ${item.unit}`);
      } else if (action === 'adjust') {
        await call('inventory.adjust', {
          itemId: item.id,
          newQuantity: Math.round(Number(newQuantity) * 1000),
          reason: reason.trim(),
        });
        toast.success('Stock adjusted', item.name);
      } else {
        const result = await call<{ currentStock: number }>('inventory.stockOut', {
          itemId: item.id,
          quantity: Number(quantity),
          type: action === 'dispose' ? 'dispose' : 'out',
          reference: reference.trim(),
          note: note.trim(),
        });
        toast.success(action === 'dispose' ? 'Stock disposed' : 'Stock issued', `${item.name} now ${quantityLabel(result.currentStock)} ${item.unit}`);
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'The stock movement failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={title}
      subtitle={`${item.name} · ${quantityLabel(item.current_stock)} ${item.unit} on hand`}
      onClose={onClose}
      width={560}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>{title}</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}

        {action === 'adjust' ? (
          <>
            <Field label="Actual quantity on hand" required hint={`Currently recorded as ${quantityLabel(item.current_stock)} ${item.unit}`}>
              <input
                className="input mono"
                inputMode="decimal"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
              />
            </Field>
            <TextArea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="e.g. Physical count at month end" />
          </>
        ) : (
          <>
            <div className="grid grid-2">
              <Field label="Quantity" required error={error && !quantity ? 'Enter a quantity' : undefined}>
                <input className="input mono" type="number" min={0} step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              {action === 'out' || action === 'dispose' ? (
                <Select
                  label="Movement type"
                  value={type}
                  onChange={(e) => setType(e.target.value as 'out' | 'dispose')}
                  options={[
                    { value: 'out', label: 'Used in treatment' },
                    { value: 'dispose', label: 'Disposed / expired' },
                  ]}
                />
              ) : (
                <Field label="Unit cost (৳)" hint="Cost paid per unit">
                  <input className="input mono" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                </Field>
              )}
            </div>
            {action === 'in' ? (
              <div className="grid grid-3">
                <TextInput label="Batch / lot no." value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
                <Field label="Expiry date">
                  <input className="input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} min={todayKey()} />
                </Field>
                <Select
                  label="Supplier"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  options={[{ value: '', label: 'Not specified' }, ...suppliers.map((s) => ({ value: String(s.id), label: s.name }))]}
                />
              </div>
            ) : null}
            <TextInput label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Invoice no., visit no., voucher…" />
            <TextArea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        )}
      </div>
    </Modal>
  );
}
