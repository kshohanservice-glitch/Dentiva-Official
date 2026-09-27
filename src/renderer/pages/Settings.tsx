import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useShell } from '../app/AppShell';
import { call, ApiError } from '../lib/api';
import {
  Badge, Button, Callout, Card, Checkbox, DataTable, Field, IconButton, Modal, PageHeader, Select,
  Switch, Tabs, TextArea, TextInput, useConfirm, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { date, money, todayKey } from '../lib/format';
import { AUTO_LOCK_OPTIONS, BACKUP_FREQENCIES, PAPER_SIZES, type PaperSizeId } from '../../shared/constants';
import { listSystemPrinters } from '../lib/printing';

interface ClinicRow {
  id: number;
  name: string;
  tagline: string;
  address_line: string;
  area: string;
  district: string;
  thana: string;
  postcode: string;
  phone: string;
  alt_phone: string;
  email: string;
  website: string;
  footer_message: string;
  business_start: string;
  business_end: string;
  invoice_prefix: string;
  payment_prefix: string;
  logo_attachment_id: number | null;
  working_days: string;
}

interface HolidayRow {
  id: number;
  title: string;
  date_key: string;
  is_closed: number;
  notes: string;
}

interface PrinterRow {
  id: number;
  name: string;
  doc_kind: string;
  printer_name: string;
  paper_id: PaperSizeId;
  paper_width_mm: number;
  paper_height_mm: number;
  margin_top_mm: number;
  margin_right_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  orientation: 'portrait' | 'landscape';
  font_scale: number;
  copies: number;
  is_default: number;
  show_clinical_footer: number;
}

interface PaymentMethodRow {
  code: string;
  label: string;
  sort_order: number;
  is_active: number;
}

const DOC_KINDS = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'receipt', label: 'Payment receipt' },
  { value: 'patient-summary', label: 'Patient summary' },
  { value: 'appointment-slip', label: 'Appointment slip' },
  { value: 'report', label: 'Report' },
] as const;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Tab = 'clinic' | 'appearance' | 'printing' | 'security' | 'backup' | 'billing' | 'maintenance';

export function SettingsPage(): JSX.Element {
  const app = useApp();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('clinic');
  const canManage = app.has('settings.manage');

  if (!app.has('settings.view')) {
    return (
      <>
        <PageHeader title="Settings" icon="settings" />
        <Callout tone="warn" title="No access">Your role cannot view application settings.</Callout>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        icon="settings"
        subtitle={canManage ? 'Changes apply to this workstation and are recorded in the audit log' : 'Read-only — your role cannot change settings'}
      />
      <div className="mt-3">
        <Tabs
          ariaLabel="Settings sections"
          value={tab}
          onChange={(next) => setTab(next as Tab)}
          items={[
            { id: 'clinic', label: 'Clinic', icon: 'building' },
            { id: 'appearance', label: 'Appearance', icon: 'sun' },
            { id: 'printing', label: 'Printing', icon: 'printer' },
            { id: 'security', label: 'Security', icon: 'lock' },
            { id: 'backup', label: 'Backups', icon: 'database' },
            { id: 'billing', label: 'Billing', icon: 'invoice' },
            { id: 'maintenance', label: 'Maintenance', icon: 'settings', permission: 'settings.manage' },
          ]}
        />
      </div>
      <div className="mt-3">
        {tab === 'clinic' ? <ClinicTab canManage={canManage} /> : null}
        {tab === 'appearance' ? <AppearanceTab canManage={canManage} onDone={() => shell.requestRefresh()} /> : null}
        {tab === 'printing' ? <PrintingTab canManage={canManage} onDone={() => shell.requestRefresh()} /> : null}
        {tab === 'security' ? <SecurityTab canManage={canManage} /> : null}
        {tab === 'backup' ? <BackupTab canManage={canManage} onDone={() => shell.requestRefresh()} /> : null}
        {tab === 'billing' ? <BillingTab canManage={canManage} /> : null}
        {tab === 'maintenance' ? <MaintenanceTab confirm={confirm} toast={toast} onDone={() => shell.requestRefresh()} /> : null}
      </div>
    </>
  );
}

/* ── Clinic ─────────────────────────────────────────────────────────────── */

function ClinicTab({ canManage }: { canManage: boolean }): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const clinic = useResource(() => call<ClinicRow>('settings.clinic'), []);
  const holidays = useResource(() => call<HolidayRow[]>('settings.holidays'), []);
  const [form, setForm] = useState<ClinicRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holiday, setHoliday] = useState({ title: '', dateKey: todayKey(), notes: '' });
  const [workingDays, setWorkingDays] = useState<number[]>([]);

  useEffect(() => {
    if (clinic.data && !form) {
      setForm(clinic.data);
      setWorkingDays(String(clinic.data.working_days ?? '').split(',').filter(Boolean).map(Number).filter((n) => Number.isInteger(n)));
    }
  }, [clinic.data, form]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      await call('settings.updateClinic', {
        name: form.name,
        tagline: form.tagline,
        address: form.address_line,
        area: form.area,
        district: form.district,
        thana: form.thana,
        postcode: form.postcode,
        phone: form.phone,
        altPhone: form.alt_phone,
        email: form.email,
        website: form.website,
        footerMessage: form.footer_message,
        businessStart: form.business_start,
        businessEnd: form.business_end,
        invoicePrefix: form.invoice_prefix,
        paymentPrefix: form.payment_prefix,
      });
      await call('settings.update', { 'clinic.workingDays': workingDays.join(',') }).catch(() => undefined);
      toast.success('Clinic details saved', 'New documents will use these details.');
      clinic.reload();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        toast.error('Clinic details not saved', caught.message);
      } else {
        toast.error('Clinic details not saved');
      }
    } finally {
      setBusy(false);
    }
  };

  const saveHoliday = async () => {
    if (holiday.title.trim().length < 2) return;
    setBusy(true);
    try {
      await call('settings.saveHoliday', { title: holiday.title.trim(), dateKey: holiday.dateKey, notes: holiday.notes.trim() });
      toast.success('Holiday saved', holiday.dateKey);
      setHoliday({ title: '', dateKey: todayKey(), notes: '' });
      setHolidayOpen(false);
      holidays.reload();
    } catch (caught) {
      toast.error('Holiday not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!form) return <Card><div className="skeleton" style={{ height: 280 }} /></Card>;

  const set = <K extends keyof ClinicRow>(key: K, value: ClinicRow[K]) => setForm({ ...form, [key]: value });

  return (
    <div className="grid grid-2-1">
      <div className="stack stack-3">
        <Card
          title="Clinic identity"
          icon="building"
          subtitle="Printed at the top of prescriptions, invoices, receipts and reports"
          actions={canManage ? <Button size="sm" variant="primary" icon="save" loading={busy} onClick={() => void save()}>Save</Button> : null}
        >
          <fieldset className="setup-panel" disabled={!canManage}>
            <div className="grid grid-2">
              <TextInput label="Clinic name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
              <TextInput label="Tagline" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} error={errors.tagline} />
            </div>
            <TextInput label="Address" value={form.address_line} onChange={(e) => set('address_line', e.target.value)} error={errors.address} />
            <div className="grid grid-2">
              <TextInput label="Area" value={form.area} onChange={(e) => set('area', e.target.value)} error={errors.area} />
              <TextInput label="Thana" value={form.thana} onChange={(e) => set('thana', e.target.value)} error={errors.thana} />
            </div>
            <div className="grid grid-2">
              <TextInput label="District" value={form.district} onChange={(e) => set('district', e.target.value)} error={errors.district} />
              <TextInput label="Postcode" value={form.postcode} onChange={(e) => set('postcode', e.target.value)} error={errors.postcode} />
            </div>
            <div className="grid grid-2">
              <TextInput label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} inputMode="tel" />
              <TextInput label="Alternate phone" value={form.alt_phone} onChange={(e) => set('alt_phone', e.target.value)} error={errors.altPhone} inputMode="tel" />
            </div>
            <div className="grid grid-2">
              <TextInput label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
              <TextInput label="Website" value={form.website} onChange={(e) => set('website', e.target.value)} error={errors.website} />
            </div>
            <div className="grid grid-2">
              <Field label="Opens" required error={errors.businessStart}>
                <input className="input" type="time" value={form.business_start} onChange={(e) => set('business_start', e.target.value)} />
              </Field>
              <Field label="Closes" required error={errors.businessEnd}>
                <input className="input" type="time" value={form.business_end} onChange={(e) => set('business_end', e.target.value)} />
              </Field>
            </div>
            <Field label="Working days" hint="Used by the appointment book to warn about slots outside opening hours.">
              <div className="row row-wrap" style={{ gap: 6 }}>
                {WEEKDAYS.map((day, index) => (
                  <Checkbox
                    key={day}
                    label={day.slice(0, 3)}
                    checked={workingDays.includes(index)}
                    onChange={(e) =>
                      setWorkingDays((days) =>
                        e.target.checked ? [...days, index].sort((a, b) => a - b) : days.filter((d) => d !== index),
                      )
                    }
                  />
                ))}
              </div>
            </Field>
            <TextArea
              label="Footer message"
              rows={2}
              value={form.footer_message}
              onChange={(e) => set('footer_message', e.target.value)}
              error={errors.footerMessage}
              hint="Printed at the bottom of prescriptions."
            />
            <div className="grid grid-2">
              <TextInput
                label="Invoice number prefix"
                value={form.invoice_prefix}
                onChange={(e) => set('invoice_prefix', e.target.value)}
                error={errors.invoicePrefix}
                className="mono"
              />
              <TextInput
                label="Receipt number prefix"
                value={form.payment_prefix}
                onChange={(e) => set('payment_prefix', e.target.value)}
                error={errors.paymentPrefix}
                className="mono"
              />
            </div>
          </fieldset>
        </Card>
      </div>

      <Card
        title="Holidays"
        icon="calendar"
        subtitle="Marked on the appointment calendar"
        actions={
          canManage ? (
            <Button size="sm" icon="plus" onClick={() => setHolidayOpen(true)}>Add</Button>
          ) : null
        }
        flush
      >
        <DataTable
          rows={holidays.data ?? []}
          loading={holidays.loading}
          error={holidays.error}
          onRetry={holidays.reload}
          columns={[
            { key: 'date', header: 'Date', width: 120, render: (row) => date(row.date_key, app.prefs) },
            { key: 'title', header: 'Holiday', render: (row) => <span className="truncate">{row.title}</span> },
            {
              key: 'actions',
              header: '',
              width: 48,
              render: (row) =>
                canManage ? (
                  <IconButton
                    icon="trash"
                    label="Remove holiday"
                    size={15}
                    onClick={() => {
                      void (async () => {
                        await call('settings.deleteHoliday', { id: row.id });
                        holidays.reload();
                      })();
                    }}
                  />
                ) : null,
            },
          ]}
          empty={<div className="state state--compact"><div className="state-title">No holidays recorded</div></div>}
        />
      </Card>

      <Modal
        open={holidayOpen}
        title="Add holiday"
        onClose={() => setHolidayOpen(false)}
        width={480}
        closeOnBackdrop={false}
        footer={
          <>
            <Button onClick={() => setHolidayOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="save" loading={busy} onClick={() => void saveHoliday()}>Save holiday</Button>
          </>
        }
      >
        <div className="stack stack-3">
          <Field label="Date" required>
            <input className="input" type="date" value={holiday.dateKey} onChange={(e) => setHoliday({ ...holiday, dateKey: e.target.value })} />
          </Field>
          <TextInput label="Title" required value={holiday.title} onChange={(e) => setHoliday({ ...holiday, title: e.target.value })} placeholder="e.g. Eid holiday" />
          <TextArea label="Notes" rows={2} value={holiday.notes} onChange={(e) => setHoliday({ ...holiday, notes: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

/* ── Appearance ────────────────────────────────────────────────────────── */

function AppearanceTab({ canManage, onDone }: { canManage: boolean; onDone: () => void }): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const settings = useResource(() => call<Record<string, unknown>>('settings.get'), []);
  const [busy, setBusy] = useState(false);

  const value = <K extends string>(key: K): string => String(settings.data?.[key] ?? '');
  const flag = (key: string): boolean => settings.data?.[key] === true;

  const save = async (patch: Record<string, unknown>, live?: Parameters<typeof app.applyPreferences>[0]) => {
    if (live) app.applyPreferences(live);
    if (!canManage) return;
    setBusy(true);
    try {
      await call('settings.update', patch);
      toast.success('Appearance saved');
      settings.reload();
      onDone();
    } catch (caught) {
      toast.error('Setting not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <Card title="Display" icon="sun" subtitle="Applies immediately to this workstation" flush>
        <div className="stack stack-4" style={{ padding: 'var(--sp-4)' }} aria-busy={busy}>
          <Field label="Theme">
            <Select
              value={value('display.theme')}
              onChange={(e) => void save({ 'display.theme': e.target.value }, { theme: e.target.value as 'light' | 'dark' })}
              options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
              disabled={!canManage}
            />
          </Field>
          <Field label="Density">
            <Select
              value={value('display.density')}
              onChange={(e) => void save({ 'display.density': e.target.value }, { density: e.target.value as 'comfortable' | 'compact' })}
              options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
              disabled={!canManage}
            />
          </Field>
          <Field label="Date format">
            <Select
              value={value('format.dateFormat')}
              onChange={(e) => void save({ 'format.dateFormat': e.target.value }, { dateFormat: e.target.value as 'dmy' })}
              options={[
                { value: 'dmy', label: '31/12/2026 (day first)' },
                { value: 'ymd', label: '2026-12-31 (year first)' },
                { value: 'mdy', label: '12/31/2026 (month first)' },
              ]}
              disabled={!canManage}
            />
          </Field>
          <Field label="Time format">
            <Select
              value={value('format.timeFormat')}
              onChange={(e) => void save({ 'format.timeFormat': e.target.value }, { timeFormat: e.target.value as '12h' })}
              options={[{ value: '12h', label: '2:30 PM (12-hour)' }, { value: '24h', label: '14:30 (24-hour)' }]}
              disabled={!canManage}
            />
          </Field>
          <Switch
            checked={flag('display.bengaliNumerals')}
            onChange={(checked) => void save({ 'display.bengaliNumerals': checked }, { bengaliNumerals: checked })}
            label="Show Bengali numerals (০১২৩) throughout the interface"
            disabled={!canManage}
          />
          <Switch
            checked={flag('display.animations')}
            onChange={(checked) => void save({ 'display.animations': checked }, { animations: checked })}
            label="Interface animations"
            disabled={!canManage}
          />
          <p className="text-xs text-3">{busy ? 'Saving…' : 'Changes are stored per workstation.'}</p>
        </div>
      </Card>

      <Card title="Preview" icon="eye">
        <div className="stack stack-3">
          <div className="detail-grid">
            <div className="detail-row">
              <span className="detail-label">Patient</span>
              <span className="detail-value">রহিমা খাতুন</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Date</span>
              <span className="detail-value">{date(new Date().toISOString(), app.prefs)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Amount</span>
              <span className="detail-value mono">{money(125000, app.prefs)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Numerals</span>
              <span className="detail-value mono">{app.prefs.bengaliNumerals ? '০১২৩৪৫৬৭৮৯' : '0123456789'}</span>
            </div>
          </div>
          <Callout tone="info" title="Bengali everywhere, not just on screen">
            Names, addresses and clinical notes are stored as proper Unicode and are searchable in Bengali. Printed
            prescriptions, invoices and reports use the bundled Noto Sans Bengali font, so the glyphs are correct on
            paper and in exported PDFs as well.
          </Callout>
        </div>
      </Card>
    </div>
  );
}

/* ── Printing ──────────────────────────────────────────────────────────── */

function PrintingTab({ canManage, onDone }: { canManage: boolean; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const profiles = useResource(() => call<PrinterRow[]>('printerProfiles.list'), []);
  const settings = useResource(() => call<Record<string, unknown>>('settings.get'), []);
  const [editing, setEditing] = useState<PrinterRow | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '', docKind: 'prescription', printerName: '', paperId: 'a4', paperWidth: '210', paperHeight: '297',
    marginTop: '10', marginRight: '10', marginBottom: '10', marginLeft: '10', orientation: 'portrait',
    fontScale: '1', copies: '1', isDefault: false, showClinicalFooter: true,
  });

  useEffect(() => {
    void listSystemPrinters().then(setPrinters);
  }, []);

  const startEdit = (row: PrinterRow) => {
    setEditing(row);
    setCreating(null);
    setForm({
      name: row.name, docKind: row.doc_kind, printerName: row.printer_name, paperId: row.paper_id,
      paperWidth: String(row.paper_width_mm), paperHeight: String(row.paper_height_mm),
      marginTop: String(row.margin_top_mm), marginRight: String(row.margin_right_mm),
      marginBottom: String(row.margin_bottom_mm), marginLeft: String(row.margin_left_mm),
      orientation: row.orientation, fontScale: String(row.font_scale), copies: String(row.copies),
      isDefault: Boolean(row.is_default), showClinicalFooter: Boolean(row.show_clinical_footer),
    });
  };

  const startCreate = (docKind: string) => {
    setCreating(docKind);
    setEditing(null);
    const geometry = PAPER_SIZES.a4;
    setForm({
      name: `Default ${docKind}`, docKind, printerName: printers[0] ?? '', paperId: 'a4',
      paperWidth: String(geometry.width), paperHeight: String(geometry.height),
      marginTop: '10', marginRight: '10', marginBottom: '10', marginLeft: '10',
      orientation: 'portrait', fontScale: '1', copies: '1', isDefault: true, showClinicalFooter: true,
    });
  };

  const applyPaper = (paperId: string) => {
    const geometry = PAPER_SIZES[paperId as PaperSizeId] ?? PAPER_SIZES.a4;
    setForm((f) => ({ ...f, paperId, paperWidth: String(geometry.width), paperHeight: String(geometry.height || 200) }));
  };

  const save = async () => {
    setBusy(true);
    try {
      await call('printerProfiles.save', {
        id: editing?.id,
        name: form.name.trim(),
        docKind: form.docKind,
        printerName: form.printerName,
        paperId: form.paperId,
        paperWidthMm: Number(form.paperWidth),
        paperHeightMm: Number(form.paperHeight),
        marginTopMm: Number(form.marginTop),
        marginRightMm: Number(form.marginRight),
        marginBottomMm: Number(form.marginBottom),
        marginLeftMm: Number(form.marginLeft),
        orientation: form.orientation,
        fontScale: Number(form.fontScale),
        copies: Number(form.copies),
        isDefault: form.isDefault,
        showClinicalFooter: form.showClinicalFooter,
      });
      toast.success('Printer profile saved');
      setEditing(null);
      setCreating(null);
      profiles.reload();
      onDone();
    } catch (caught) {
      toast.error('Profile not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: PrinterRow) => {
    setBusy(true);
    try {
      await call('printerProfiles.delete', { id: row.id });
      toast.success('Printer profile removed');
      profiles.reload();
    } catch (caught) {
      toast.error('Profile not removed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const saveFooter = async (key: string, value: string) => {
    setBusy(true);
    try {
      await call('settings.update', { [key]: value });
      settings.reload();
      toast.success('Footer saved');
    } catch (caught) {
      toast.error('Footer not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack stack-3">
      <Callout tone="info" title="How printing works here">
        Every document is laid out in millimetres using the paper profile below, then sent to the Windows print
        dialog or saved as a PDF. Nothing is rendered through a browser default, so the output matches the preview
        exactly. Bengali text uses the bundled font, so it prints correctly without installing anything.
      </Callout>

      <Card title="Printer profiles" icon="printer" subtitle="One profile per document type; the default is used automatically" flush>
        <DataTable
          rows={profiles.data ?? []}
          loading={profiles.loading}
          error={profiles.error}
          onRetry={profiles.reload}
          columns={[
            { key: 'name', header: 'Profile', render: (row) => <span className="truncate">{row.name}</span> },
            { key: 'kind', header: 'Document', width: 150, render: (row) => DOC_KINDS.find((k) => k.value === row.doc_kind)?.label ?? row.doc_kind },
            { key: 'paper', header: 'Paper', width: 120, render: (row) => PAPER_SIZES[row.paper_id]?.label ?? row.paper_id },
            { key: 'printer', header: 'Printer', width: 180, render: (row) => <span className="truncate">{row.printer_name || 'System default'}</span> },
            { key: 'copies', header: 'Copies', width: 80, numeric: true, render: (row) => String(row.copies) },
            { key: 'default', header: 'Default', width: 90, render: (row) => (row.is_default ? <Badge tone="primary">Default</Badge> : null) },
            {
              key: 'actions',
              header: '',
              width: 120,
              render: (row) =>
                canManage ? (
                  <div className="row row-2 row-end">
                    <Button size="sm" icon="edit" onClick={() => startEdit(row)}>Edit</Button>
                    <IconButton icon="trash" label="Delete profile" size={15} onClick={() => void remove(row)} />
                  </div>
                ) : null,
            },
          ]}
          empty={
            <div className="state">
              <div className="state-title">No printer profiles yet</div>
              <div className="state-text">Add one for prescriptions, and every other document type you print regularly.</div>
            </div>
          }
        />
      </Card>

      {canManage ? (
        <Card title="Add a profile" icon="plus">
          <div className="row row-wrap row-2">
            {DOC_KINDS.map((kind) => (
              <Button key={kind.value} size="sm" icon="plus" onClick={() => startCreate(kind.value)}>
                {kind.label}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Document footers" icon="file-text" subtitle="Printed at the bottom of each document type">
        <div className="grid grid-2">
          <TextArea
            label="Prescription footer"
            rows={3}
            defaultValue={String(settings.data?.['print.prescriptionFooter'] ?? '')}
            onBlur={(e) => void saveFooter('print.prescriptionFooter', e.target.value)}
            disabled={!canManage}
            hint="Example: Take the medicine after meals. Come back if there is no improvement in 3 days."
          />
          <TextArea
            label="Invoice footer"
            rows={3}
            defaultValue={String(settings.data?.['print.invoiceFooter'] ?? '')}
            onBlur={(e) => void saveFooter('print.invoiceFooter', e.target.value)}
            disabled={!canManage}
            hint="Example: Thank you for visiting. Fees once paid are non-refundable."
          />
        </div>
        <div className="mt-3">
          <Checkbox
            label="Show the treating dentist's name on invoices"
            checked={settings.data?.['print.showDentistOnInvoice'] === true}
            disabled={!canManage}
            onChange={(checked) => void saveFooter('print.showDentistOnInvoice', String(checked))}
          />
          <p className="text-xs text-3" style={{ marginTop: 6 }}>
            Off by default: an invoice carries clinic identity only, with no clinical content and no signature.
          </p>
        </div>
      </Card>

      <Modal
        open={Boolean(editing) || Boolean(creating)}
        title={editing ? `Edit ${editing.name}` : `New ${creating} profile`}
        subtitle="Paper size, margins and font scale"
        onClose={() => { setEditing(null); setCreating(null); }}
        width={760}
        closeOnBackdrop={false}
        footer={
          <>
            <Button onClick={() => { setEditing(null); setCreating(null); }}>Cancel</Button>
            <Button variant="primary" icon="save" loading={busy} onClick={() => void save()}>Save profile</Button>
          </>
        }
      >
        <div className="stack stack-3">
          <div className="grid grid-2">
            <TextInput label="Profile name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field label="Document type">
              <Select
                value={form.docKind}
                onChange={(e) => setForm({ ...form, docKind: e.target.value })}
                options={DOC_KINDS.map((k) => ({ value: k.value, label: k.label }))}
                disabled={Boolean(editing)}
              />
            </Field>
          </div>
          <Field label="Printer" hint="Leave as the system default to always use whatever Windows selects.">
            <Select
              value={form.printerName}
              onChange={(e) => setForm({ ...form, printerName: e.target.value })}
              options={[
                { value: '', label: 'Ask every time (Windows default)' },
                ...printers.map((name) => ({ value: name, label: name })),
              ]}
            />
          </Field>
          <div className="grid grid-3">
            <Field label="Paper">
              <Select
                value={form.paperId}
                onChange={(e) => applyPaper(e.target.value)}
                options={Object.values(PAPER_SIZES).map((size) => ({ value: size.id, label: size.label }))}
              />
            </Field>
            <Field label="Width (mm)">
              <input className="input num" type="number" min={20} max={1000} value={form.paperWidth} onChange={(e) => setForm({ ...form, paperWidth: e.target.value })} />
            </Field>
            <Field label="Height (mm)">
              <input className="input num" type="number" min={0} max={2000} value={form.paperHeight} onChange={(e) => setForm({ ...form, paperHeight: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-2">
            <Field label="Orientation">
              <Select
                value={form.orientation}
                onChange={(e) => setForm({ ...form, orientation: e.target.value })}
                options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]}
              />
            </Field>
            <Field label="Copies" hint="Default number of copies sent to the printer.">
              <input className="input num" type="number" min={1} max={20} value={form.copies} onChange={(e) => setForm({ ...form, copies: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-4">
            <Field label="Margin top (mm)">
              <input className="input num" type="number" min={0} max={60} value={form.marginTop} onChange={(e) => setForm({ ...form, marginTop: e.target.value })} />
            </Field>
            <Field label="Margin right (mm)">
              <input className="input num" type="number" min={0} max={60} value={form.marginRight} onChange={(e) => setForm({ ...form, marginRight: e.target.value })} />
            </Field>
            <Field label="Margin bottom (mm)">
              <input className="input num" type="number" min={0} max={60} value={form.marginBottom} onChange={(e) => setForm({ ...form, marginBottom: e.target.value })} />
            </Field>
            <Field label="Margin left (mm)">
              <input className="input num" type="number" min={0} max={60} value={form.marginLeft} onChange={(e) => setForm({ ...form, marginLeft: e.target.value })} />
            </Field>
          </div>
          <Field label="Font scale" hint="1 = normal. Increase if Bangla conjuncts are clipped on your printer.">
            <input
              className="input num"
              type="number"
              min={0.6}
              max={2}
              step={0.05}
              value={form.fontScale}
              onChange={(e) => setForm({ ...form, fontScale: e.target.value })}
            />
          </Field>
          <div className="row row-4 row-wrap">
            <Switch
              checked={form.isDefault}
              onChange={(checked) => setForm({ ...form, isDefault: checked })}
              label="Use as the default for this document type"
            />
            <Switch
              checked={form.showClinicalFooter}
              onChange={(checked) => setForm({ ...form, showClinicalFooter: checked })}
              label="Include the clinical footer block"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Security ──────────────────────────────────────────────────────────── */

function SecurityTab({ canManage }: { canManage: boolean }): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const settings = useResource(() => call<Record<string, unknown>>('settings.get'), []);
  const [busy, setBusy] = useState(false);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await call('settings.update', patch);
      settings.reload();
      toast.success('Security setting saved');
    } catch (caught) {
      toast.error('Setting not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const minutes = Number(settings.data?.['auth.autoLockMinutes'] ?? 10);

  return (
    <div className="grid grid-2">
      <Card title="Automatic lock" icon="lock" subtitle="Applies to every user account on this workstation">
        <div className="stack stack-3">
          <Field label="Lock after inactivity" hint="Unsaved work is preserved and restored when the user signs back in.">
            <Select
              value={String(minutes)}
              onChange={(e) => {
                const next = Number(e.target.value);
                void save({ 'auth.autoLockMinutes': next });
                app.applyPreferences({ autoLockMinutes: next });
              }}
              options={AUTO_LOCK_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
              disabled={!canManage}
            />
          </Field>
          <Callout tone="info">
            Anyone walking up to an unlocked workstation can see the patient list. Ten minutes is the recommended
            balance between safety and interruption.
          </Callout>
        </div>
      </Card>

      <Card title="Password policy" icon="shield" subtitle="Applies to every new and reset password">
        <div className="stack stack-3">
          <Field label="Minimum length">
            <input
              className="input num"
              type="number"
              min={6}
              max={32}
              defaultValue={String(settings.data?.['auth.minPasswordLength'] ?? 8)}
              onBlur={(e) => canManage && void save({ 'auth.minPasswordLength': Number(e.target.value) })}
              disabled={!canManage}
            />
          </Field>
          <div className="stack stack-2">
            {([
              ['auth.requireLower', 'Require a lowercase letter'],
              ['auth.requireUpper', 'Require an uppercase letter'],
              ['auth.requireDigit', 'Require a digit'],
              ['auth.requireSymbol', 'Require a symbol'],
            ] as const).map(([key, label]) => (
              <Switch
                key={key}
                checked={settings.data?.[key] === true}
                onChange={(checked) => void save({ [key]: checked })}
                label={label}
                disabled={!canManage}
              />
            ))}
          </div>
          <Callout tone="info">
            Passwords are hashed with scrypt using a per-user salt, and the resulting hash is the only thing stored.
            Changing this policy does not affect existing passwords until each user next changes theirs.
          </Callout>
          <p className="text-xs text-3">{busy ? 'Saving…' : 'Policy changes apply to the next password set.'}</p>
        </div>
      </Card>
    </div>
  );
}

/* ── Backups ───────────────────────────────────────────────────────────── */

function BackupTab({ canManage, onDone }: { canManage: boolean; onDone: () => void }): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const settings = useResource(() => call<Record<string, unknown>>('settings.get'), []);
  const [busy, setBusy] = useState(false);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await call('settings.update', patch);
      settings.reload();
      toast.success('Backup setting saved');
      onDone();
    } catch (caught) {
      toast.error('Setting not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const result = await call<{ ran: boolean; name?: string; error?: string }>('backups.runAutomatic');
      if (result.error) toast.error('Automatic backup failed', result.error);
      else if (result.ran) toast.success('Backup created', result.name);
      else toast.info('Not due yet', 'The automatic backup has already run within the configured interval.');
    } catch (caught) {
      toast.error('Backup failed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const folder = String(settings.data?.['backup.folder'] ?? '');

  return (
    <div className="grid grid-2">
      <Card title="Automatic backups" icon="database" subtitle="Runs once per session when the schedule is due">
        <div className="stack stack-3">
          <Field label="Frequency">
            <Select
              value={String(settings.data?.['backup.frequencyDays'] ?? 7)}
              onChange={(e) => void save({ 'backup.frequencyDays': Number(e.target.value) })}
              options={BACKUP_FREQENCIES.map((f) => ({ value: String(f.value), label: f.label }))}
              disabled={!canManage}
            />
          </Field>
          <Field label="Backups kept" hint="Older automatic backups are deleted once this limit is reached.">
            <input
              className="input num"
              type="number"
              min={1}
              max={500}
              defaultValue={String(settings.data?.['backup.retentionCount'] ?? 20)}
              onBlur={(e) => canManage && void save({ 'backup.retentionCount': Number(e.target.value) })}
              disabled={!canManage}
            />
          </Field>
          <div className="detail-grid">
            <div className="detail-row">
              <span className="detail-label">Backup folder</span>
              <span className="detail-value mono text-xs">{folder || app.status?.backupFolder || '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Last automatic backup</span>
              <span className="detail-value">{String(settings.data?.['backup.lastAutomaticAt'] ?? '') || 'Never'}</span>
            </div>
          </div>
          {app.has('backup.create') ? (
            <Button icon="save" loading={busy} onClick={() => void runNow()}>Run the schedule check now</Button>
          ) : null}
          <p className="text-xs text-3">
            Change the folder itself from <strong>Administration → Backup &amp; Restore</strong>, where the backup list,
            validation and restore live.
          </p>
        </div>
      </Card>

      <Card title="What is included" icon="check-circle">
        <ul className="stack stack-2 text-sm text-2">
          <li className="row row-top"><Icon name="check" size={15} className="text-ok" /> The whole database, snapshotted consistently even while the clinic is working.</li>
          <li className="row row-top"><Icon name="check" size={15} className="text-ok" /> Every patient attachment, verified by SHA-256 checksum.</li>
          <li className="row row-top"><Icon name="check" size={15} className="text-ok" /> A manifest recording the application version and schema version.</li>
          <li className="row row-top"><Icon name="check" size={15} className="text-ok" /> An automatic safety backup taken before any restore.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ── Billing ───────────────────────────────────────────────────────────── */

function BillingTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const settings = useResource(() => call<Record<string, unknown>>('settings.get'), []);
  const methods = useResource(() => call<PaymentMethodRow[]>('paymentMethods.list'), []);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState({ code: '', label: '' });
  const [defaultTax, setDefaultTax] = useState('');

  useEffect(() => {
    if (settings.data && defaultTax === '') {
      setDefaultTax(String(Number(settings.data['financial.defaultTaxPercentBp'] ?? 0) / 100));
    }
  }, [settings.data, defaultTax]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await call('settings.update', patch);
      settings.reload();
      toast.success('Billing setting saved');
    } catch (caught) {
      toast.error('Setting not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const addMethod = async () => {
    if (!method.code.trim() || method.label.trim().length < 2) return;
    setBusy(true);
    try {
      await call('paymentMethods.save', { code: method.code.trim().toLowerCase(), label: method.label.trim(), isActive: true });
      setMethod({ code: '', label: '' });
      methods.reload();
      toast.success('Payment method added');
    } catch (caught) {
      toast.error('Method not added', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <Card title="Money" icon="wallet" subtitle="All amounts are stored in poisha as whole numbers">
        <div className="stack stack-3">
          <div className="detail-grid">
            <div className="detail-row">
              <span className="detail-label">Currency</span>
              <span className="detail-value">{String(settings.data?.['clinic.currencyCode'] ?? 'BDT')} ({String(settings.data?.['clinic.currencySymbol'] ?? '৳')})</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Invoice prefix</span>
              <span className="detail-value mono">{String(settings.data?.['financial.invoicePrefix'] ?? 'INV')}-0001</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Receipt prefix</span>
              <span className="detail-value mono">{String(settings.data?.['financial.paymentPrefix'] ?? 'PAY')}-0001</span>
            </div>
          </div>
          <Field label="Default tax (%)" hint="Bangladesh clinics are usually zero-rated. Leave at 0 unless you are VAT registered.">
            <input
              className="input num"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={defaultTax}
              onChange={(e) => setDefaultTax(e.target.value)}
              onBlur={() => void saveSettings({ 'financial.defaultTaxPercentBp': Math.round((Number(defaultTax) || 0) * 100) })}
              disabled={!canManage}
            />
          </Field>
          <Switch
            checked={settings.data?.['financial.allowOverpayment'] === true}
            onChange={(checked) => void saveSettings({ 'financial.allowOverpayment': checked })}
            label="Allow payments larger than the invoice balance"
            disabled={!canManage}
          />
          <Callout tone="warn">
            Overpayment is blocked by default. When it is enabled, the excess is recorded as unapplied credit on the
            patient&rsquo;s account and is never silently lost.
          </Callout>
        </div>
      </Card>

      <Card title="Payment methods" icon="payments" subtitle="Offered on receipts and in reports" flush>
        <DataTable
          rows={(methods.data ?? []).map((row) => ({ ...row, id: row.code }))}
          loading={methods.loading}
          error={methods.error}
          onRetry={methods.reload}
          columns={[
            { key: 'label', header: 'Method', render: (row) => <span className="truncate">{row.label}</span> },
            { key: 'code', header: 'Code', width: 140, render: (row) => <span className="mono text-sm">{row.code}</span> },
            {
              key: 'actions',
              header: '',
              width: 110,
              render: (row) =>
                canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setBusy(true);
                      void call('paymentMethods.save', { code: row.code, label: row.label, isActive: !row.is_active })
                        .then(() => {
                          methods.reload();
                          toast.success(row.is_active ? 'Method hidden' : 'Method enabled');
                        })
                        .catch((caught) => toast.error('Not saved', caught instanceof ApiError ? caught.message : undefined))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {row.is_active ? 'Hide' : 'Enable'}
                  </Button>
                ) : null,
            },
          ]}
          empty={<div className="state state--compact"><div className="state-title">No payment methods</div></div>}
        />
        {canManage ? (
          <div className="row row-2" style={{ padding: 'var(--sp-3) var(--sp-4)', borderTop: '1px solid var(--border)' }}>
            <input
              className="input input--sm"
              placeholder="code"
              value={method.code}
              onChange={(e) => setMethod({ ...method, code: e.target.value })}
              style={{ maxWidth: 130 }}
              aria-label="Payment method code"
            />
            <input
              className="input input--sm grow"
              placeholder="Label, e.g. bKash"
              value={method.label}
              onChange={(e) => setMethod({ ...method, label: e.target.value })}
              aria-label="Payment method label"
            />
            <Button size="sm" icon="plus" loading={busy} disabled={!method.code.trim() || method.label.trim().length < 2} onClick={() => void addMethod()}>
              Add
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title="Inventory alerts" icon="alert-triangle">
        <Field label="Warn about stock expiring within (days)">
          <input
            className="input num"
            type="number"
            min={0}
            max={3650}
            defaultValue={String(settings.data?.['inventory.expiryAlertDays'] ?? 60)}
            onBlur={(e) => canManage && void saveSettings({ 'inventory.expiryAlertDays': Number(e.target.value) })}
            disabled={!canManage}
          />
        </Field>
      </Card>
    </div>
  );
}

/* ── Maintenance ───────────────────────────────────────────────────────── */

function MaintenanceTab({
  confirm, toast, onDone,
}: {
  confirm: ReturnType<typeof useConfirm>;
  toast: ReturnType<typeof useToast>;
  onDone: () => void;
}): JSX.Element {
  const app = useApp();
  const [busy, setBusy] = useState('');
  const [wipeText, setWipeText] = useState('');
  const [wipeOpen, setWipeOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ path: string; bytes: number } | null>(null);

  const vacuum = async () => {
    setBusy('vacuum');
    try {
      const result = await call<{ ok: boolean; before: { page_count: number; freelist_count: number }; integrity: { ok: boolean; message: string } }>(
        'system2.maintenance',
      );
      toast.success('Maintenance finished', result.integrity.ok ? 'Integrity check passed.' : result.integrity.message);
      onDone();
    } catch (caught) {
      toast.error('Maintenance failed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy('');
    }
  };

  const exportDiagnostics = async () => {
    setBusy('diagnostics');
    try {
      const result = await call<{ path: string; bytes: number }>('system.exportDiagnosticReport');
      setDiagnostics(result);
      toast.success('Diagnostic report written', result.path);
    } catch (caught) {
      toast.error('Report failed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy('');
    }
  };

  const resetRoles = async () => {
    const ok = await confirm({
      title: 'Reset system roles?',
      message: 'The five built-in roles are restored to the permissions they ship with. Custom roles are not touched.',
      confirmLabel: 'Reset roles',
    });
    if (!ok) return;
    setBusy('roles');
    try {
      await call('settings.resetRoles');
      toast.success('System roles reset');
    } catch (caught) {
      toast.error('Reset failed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy('');
    }
  };

  const wipe = async () => {
    setBusy('wipe');
    try {
      await call('system2.wipe', { confirmation: 'DELETE' });
      toast.success('All data erased', 'The application will return to first-time setup.');
      onDone();
      window.setTimeout(() => window.location.reload(), 900);
    } catch (caught) {
      toast.error('Erase failed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy('');
    }
  };

  const size = useMemo(() => app.status?.dataDir ?? '', [app.status]);

  return (
    <div className="grid grid-2">
      <Card title="Database maintenance" icon="settings">
        <div className="stack stack-3">
          <p className="text-sm text-2">
            Compacts the database file, reclaims unused pages and runs SQLite&rsquo;s integrity check. It is safe to run
            while the clinic is working and takes a few seconds.
          </p>
          <div className="row row-2">
            <Button icon="settings" loading={busy === 'vacuum'} onClick={() => void vacuum()}>Run maintenance</Button>
            <Button icon="file-text" loading={busy === 'diagnostics'} onClick={() => void exportDiagnostics()}>
              Export diagnostics
            </Button>
          </div>
          {diagnostics ? (
            <Callout tone="info" title="Diagnostic report">
              Written to <span className="mono text-xs">{diagnostics.path}</span> ({diagnostics.bytes} bytes). It contains
              table counts, runtime versions, paths and the integrity result — never passwords or patient data.
            </Callout>
          ) : null}
        </div>
      </Card>

      <Card title="Roles" icon="shield" subtitle="Built-in roles ship with the application">
        <div className="stack stack-3">
          <p className="text-sm text-2">
            If the permission catalogue is edited in a way that leaves a built-in role unusable, restore the shipped
            defaults. Custom roles and user assignments are preserved.
          </p>
          <Button icon="refresh" loading={busy === 'roles'} onClick={() => void resetRoles()}>Reset system roles</Button>
        </div>
      </Card>

      <Card title="Erase all data" icon="alert-triangle">
        <div className="stack stack-3">
          <Callout tone="danger" title="Irreversible">
            This deletes every patient, visit, prescription, invoice, payment, inventory record, user account and
            setting from this workstation. Take a backup first. There is no undo.
          </Callout>
          <p className="text-sm text-2">Data folder: <span className="mono text-xs">{size}</span></p>
          <Button variant="danger" icon="trash" onClick={() => setWipeOpen(true)}>Erase all application data</Button>
        </div>
      </Card>

      <Modal
        open={wipeOpen}
        title="Erase all application data"
        subtitle="This cannot be undone"
        onClose={() => setWipeOpen(false)}
        width={560}
        closeOnBackdrop={false}
        footer={
          <>
            <Button onClick={() => setWipeOpen(false)}>Cancel</Button>
            <Button variant="danger" icon="trash" loading={busy === 'wipe'} disabled={wipeText !== 'DELETE'} onClick={() => void wipe()}>
              Erase everything
            </Button>
          </>
        }
      >
        <div className="stack stack-3">
          <Callout tone="danger">
            Every record in <span className="mono text-xs">{size}</span> is deleted and the application restarts at
            first-time setup. Make sure a backup exists first.
          </Callout>
          <Field label="Type DELETE to confirm" required>
            <TextInput value={wipeText} onChange={(event) => setWipeText(event.target.value)} className="mono" autoComplete="off" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
