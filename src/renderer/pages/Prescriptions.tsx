import { useEffect, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call, ApiError } from '../lib/api';
import {
  Badge, Button, Callout, Card, DataTable, Field, Modal, PageHeader, Pagination, Select, Tabs,
  TextArea, TextInput, useConfirm, useDebounced, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { date, todayKey } from '../lib/format';
import { MEDICINE_FORMS } from '../../shared/constants';
import { runPrint } from '../lib/printing';
import { PatientPicker } from './PatientPicker';
import type { DentistRow } from './Appointments';

interface RxRow {
  id: number;
  prescription_no: string;
  patient_id: number;
  dentist_id: number | null;
  issue_date: string;
  next_visit: string | null;
  cc: string;
  advice: string;
  status: string;
  patient_name: string;
  patient_code: string;
  dentist_name: string | null;
  item_count: number;
}

interface RxPage {
  rows: RxRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface Medicine {
  id: number;
  name: string;
  form: string;
  strength: string;
  manufacturer: string;
}

interface MedicineDraft {
  key: string;
  name: string;
  form: string;
  strength: string;
  dose: string;
  morning: boolean;
  afternoon: boolean;
  evening: boolean;
  night: boolean;
  beforeFood: boolean;
  duration: string;
  quantity: string;
  instructions: string;
  prn: boolean;
  extra: string;
}

const newMedicine = (): MedicineDraft => ({
  key: Math.random().toString(36).slice(2),
  name: '',
  form: 'Tablet',
  strength: '',
  dose: '',
  morning: true,
  afternoon: false,
  evening: false,
  night: false,
  beforeFood: true,
  duration: '',
  quantity: '',
  instructions: '',
  prn: false,
  extra: '',
});

export function PrescriptionsPage({ patientId }: { patientId?: string }): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();

  const [tab, setTab] = useState<'list' | 'catalogue'>('list');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(shiftMonth(-1));
  const [to, setTo] = useState(todayKey());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [composing, setComposing] = useState(Boolean(patientId) || route.query.get('new') === '1');
  const [editing, setEditing] = useState<RxRow | null>(null);
  const [viewing, setViewing] = useState<RxRow | null>(null);
  const [medicineSearch, setMedicineSearch] = useState('');
  const debounced = useDebounced(search, 250);
  const debouncedMedicine = useDebounced(medicineSearch, 220);

  const list = useResource(
    () =>
      tab === 'list'
        ? call<RxPage>('prescriptions.list', {
            patientId: patientId ? Number(patientId) : undefined,
            search: debounced.trim() || undefined,
            from,
            to,
            page,
            pageSize,
          })
        : Promise.resolve(null),
    [tab, patientId, debounced, from, to, page, pageSize, shell.refreshSignal],
  );

  const catalogue = useResource(
    () => (tab === 'catalogue' ? call<Medicine[]>('medicines.list', { search: debouncedMedicine.trim() || undefined, limit: 200 }) : Promise.resolve(null)),
    [tab, debouncedMedicine],
  );

  useEffect(() => setPage(1), [debounced, from, to, pageSize, patientId]);

  useEffect(() => {
    if (!app.has('prescriptions.create')) return;
    const handler = () => setComposing(true);
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [app]);

  const archive = async (row: RxRow) => {
    const ok = await confirm({
      title: `Archive ${row.prescription_no}?`,
      message: 'The prescription is hidden from lists but stays in the patient’s history and the print record.',
      tone: 'danger',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    try {
      await call('prescriptions.delete', { id: row.id });
      toast.success('Prescription archived', row.prescription_no);
      list.reload();
    } catch (error) {
      toast.error('Could not archive', error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <>
      <PageHeader
        icon="prescription"
        title="Prescriptions"
        subtitle={patientId ? 'Prescriptions for this patient' : 'Every prescription issued by the clinic'}
        actions={
          app.has('prescriptions.create') ? (
            <Button variant="primary" icon="plus" onClick={() => setComposing(true)}>New prescription</Button>
          ) : null
        }
      />

      <Tabs
        ariaLabel="Prescription views"
        value={tab}
        onChange={(id) => setTab(id as typeof tab)}
        items={[
          { id: 'list', label: 'Issued prescriptions', icon: 'file-text' },
          { id: 'catalogue', label: 'Medicine catalogue', icon: 'prescription', permission: 'prescriptions.create' },
        ]}
      />

      {tab === 'list' ? (
        <>
          <div className="filter-bar mt-3">
            <div className="filter-search">
              <TextInput
                aria-label="Search prescriptions"
                placeholder="Search by number, patient or code…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                icon="search"
                inputSize="sm"
              />
            </div>
            <input className="input input--sm" style={{ width: 148 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <input className="input input--sm" style={{ width: 148 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            <span className="spacer" />
            <Button size="sm" icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
          </div>

          <div className="card">
            <DataTable
              rows={list.data?.rows ?? []}
              loading={list.loading}
              error={list.error}
              onRetry={list.reload}
              onRowClick={(row) => setViewing(row)}
              columns={[
                { key: 'no', header: 'Number', width: 140, render: (row) => <span className="mono text-sm">{row.prescription_no}</span> },
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
                { key: 'date', header: 'Date', width: 110, render: (row) => date(row.issue_date, app.prefs) },
                { key: 'dentist', header: 'Dentist', width: 150, render: (row) => <span className="truncate">{row.dentist_name ?? '—'}</span> },
                { key: 'items', header: 'Items', width: 70, numeric: true, render: (row) => row.item_count },
                {
                  key: 'actions',
                  header: '',
                  width: 132,
                  render: (row) => (
                    <div className="row row-1" style={{ gap: 4 }} onClick={(event) => event.stopPropagation()}>
                      {app.has('prescriptions.print') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="printer"
                          aria-label={`Print ${row.prescription_no}`}
                          onClick={() => setViewing(row)}
                        />
                      ) : null}
                      {app.has('prescriptions.edit') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="edit"
                          aria-label={`Edit ${row.prescription_no}`}
                          onClick={() => setEditing(row)}
                        />
                      ) : null}
                      {app.has('prescriptions.edit') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="trash"
                          aria-label={`Archive ${row.prescription_no}`}
                          onClick={() => void archive(row)}
                        />
                      ) : null}
                    </div>
                  ),
                },
              ]}
              empty={
                <div className="state">
                  <div className="state-title">No prescriptions in this period</div>
                  <div className="state-text">Write a prescription and it will be listed here, ready to print or export as PDF.</div>
                  {app.has('prescriptions.create') ? (
                    <div className="state-actions">
                      <Button variant="primary" icon="plus" onClick={() => setComposing(true)}>Write prescription</Button>
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
        </>
      ) : (
        <Card
          className="mt-3"
          title="Medicine catalogue"
          icon="prescription"
          subtitle="Saved names make prescribing fast and consistent"
          actions={
            <div className="filter-search" style={{ maxWidth: 280 }}>
              <TextInput
                aria-label="Search medicines"
                placeholder="Search medicines…"
                value={medicineSearch}
                onChange={(event) => setMedicineSearch(event.target.value)}
                icon="search"
                inputSize="sm"
              />
            </div>
          }
          flush
        >
          <DataTable
            loading={catalogue.loading}
            rows={(catalogue.data ?? []).map((m) => ({ ...m, id: m.id }))}
            columns={[
              { key: 'name', header: 'Medicine', render: (row) => <strong>{row.name}</strong> },
              { key: 'form', header: 'Form', width: 110, render: (row) => row.form },
              { key: 'strength', header: 'Strength', width: 130, render: (row) => row.strength || '—' },
              { key: 'manufacturer', header: 'Manufacturer', render: (row) => row.manufacturer || '—' },
            ]}
            empty={
              <div className="state">
                <div className="state-title">The catalogue is empty</div>
                <div className="state-text">
                  Type a medicine name while writing a prescription and choose “Save to catalogue” to build your own
                  list.
                </div>
              </div>
            }
          />
        </Card>
      )}

      <PrescriptionEditor
        open={composing}
        presetPatientId={patientId ? Number(patientId) : null}
        onClose={() => setComposing(false)}
        onSaved={() => {
          setComposing(false);
          list.reload();
          shell.requestRefresh();
        }}
      />

      <PrescriptionEditor
        open={Boolean(editing)}
        prescription={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          list.reload();
        }}
      />

      {viewing ? (
        <PrescriptionViewer
          prescription={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
        />
      ) : null}
    </>
  );
}

function shiftMonth(delta: number): string {
  const now = new Date();
  now.setMonth(now.getMonth() + delta);
  return now.toISOString().slice(0, 10);
}

function PrescriptionEditor({
  open, prescription, presetPatientId, onClose, onSaved,
}: {
  open: boolean;
  prescription?: RxRow | null;
  presetPatientId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [issueDate, setIssueDate] = useState(todayKey());
  const [nextVisit, setNextVisit] = useState('');
  const [cc, setCc] = useState('');
  const [oe, setOe] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [advice, setAdvice] = useState('');
  const [medicines, setMedicines] = useState<MedicineDraft[]>([newMedicine()]);
  const [dentists, setDentists] = useState<DentistRow[]>([]);
  const [catalogue, setCatalogue] = useState<Medicine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingMedicine, setSavingMedicine] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPatientId(presetPatientId ?? null);
    setPatientLabel('');
    setIssueDate(todayKey());
    setNextVisit('');
    setCc('');
    setOe('');
    setDiagnosis('');
    setAdvice('');
    setMedicines([newMedicine()]);
    setError('');
    setErrors({});
    void call<DentistRow[]>('dentists.list', { activeOnly: true }).then(setDentists).catch(() => setDentists([]));
    void call<Medicine[]>('medicines.list', { limit: 200 }).then(setCatalogue).catch(() => setCatalogue([]));
  }, [open, presetPatientId]);

  useEffect(() => {
    if (!open || !prescription) return;
    void (async () => {
      try {
        const model = await call<{ prescription: Record<string, unknown>; items: Record<string, unknown>[] }>('prescriptions.get', {
          id: prescription.id,
        });
        const p = model.prescription;
        setPatientId(Number(p.patient_id));
        setPatientLabel(`${String(p.patient_name)} (${String(p.patient_code)})`);
        setDentistId(p.dentist_id ? String(p.dentist_id) : '');
        setIssueDate(String(p.issue_date ?? todayKey()));
        setNextVisit(String(p.next_visit ?? ''));
        setCc(String(p.cc ?? ''));
        setOe(String(p.oe ?? ''));
        setDiagnosis(String(p.diagnosis ?? ''));
        setAdvice(String(p.advice ?? ''));
        setMedicines(
          model.items.length
            ? model.items.map((item) => ({
                key: Math.random().toString(36).slice(2),
                name: String(item.name ?? ''),
                form: String(item.form ?? 'Tablet'),
                strength: String(item.strength ?? ''),
                dose: String(item.dose ?? ''),
                morning: Boolean(item.morning),
                afternoon: Boolean(item.afternoon),
                evening: Boolean(item.evening),
                night: Boolean(item.night),
                beforeFood: Boolean(item.before_food),
                duration: String(item.duration ?? ''),
                quantity: String(item.quantity ?? ''),
                instructions: String(item.instructions ?? ''),
                prn: Boolean(item.prn),
                extra: String(item.extra_instruction ?? ''),
              }))
            : [newMedicine()],
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The prescription could not be loaded.');
      }
    })();
  }, [open, prescription]);

  const update = (key: string, patch: Partial<MedicineDraft>) => {
    setMedicines((current) => current.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  };

  const saveToCatalogue = async (draft: MedicineDraft) => {
    if (draft.name.trim().length < 2) return;
    setSavingMedicine(draft.key);
    try {
      await call('medicines.save', {
        name: draft.name.trim(),
        form: draft.form,
        strength: draft.strength.trim(),
      });
      const refreshed = await call<Medicine[]>('medicines.list', { limit: 200 });
      setCatalogue(refreshed);
      toast.success('Saved to catalogue', draft.name.trim());
    } catch (caught) {
      toast.error('Could not save medicine', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setSavingMedicine(null);
    }
  };

  const saveDraft = async () => {
    try {
      await call('prescriptions.saveDraft', { ...draftPayload(), entityId: prescription?.id ?? undefined });
      toast.success('Draft saved', 'You can come back to this prescription later on this computer.');
    } catch (caught) {
      toast.error('Draft not saved', caught instanceof Error ? caught.message : undefined);
    }
  };

  const draftPayload = () => ({
    patientId,
    dentistId: dentistId ? Number(dentistId) : undefined,
    issueDate,
    nextVisit: nextVisit || undefined,
    cc,
    oe,
    diagnosis,
    advice,
    medicines,
  });

  const submit = async (publish: boolean) => {
    if (!patientId) {
      setErrors({ patientId: 'Select a patient.' });
      return;
    }
    const valid = medicines.filter((m) => m.name.trim());
    if (publish && valid.length === 0) {
      setError('Add at least one medicine, or write clinical notes only.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...draftPayload(),
        items: valid.map((m, index) => ({
          name: m.name.trim(),
          form: m.form,
          strength: m.strength.trim(),
          dose: m.dose.trim(),
          morning: m.morning ? 1 : 0,
          afternoon: m.afternoon ? 1 : 0,
          evening: m.evening ? 1 : 0,
          night: m.night ? 1 : 0,
          beforeFood: m.beforeFood ? 1 : 0,
          duration: m.duration.trim(),
          quantity: m.quantity.trim(),
          instructions: m.instructions.trim(),
          prn: m.prn ? 1 : 0,
          extraInstruction: m.extra.trim(),
          sortOrder: index,
        })),
      };
      if (prescription) {
        await call('prescriptions.update', { id: prescription.id, ...payload });
        toast.success('Prescription updated', prescription.prescription_no);
      } else {
        const created = await call<{ id: number; prescription_no: string }>('prescriptions.create', payload);
        toast.success('Prescription issued', created.prescription_no);
      }
      await call('prescriptions.discardDraft', { entityId: prescription?.id ?? undefined });
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'The prescription could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={prescription ? `Edit ${prescription.prescription_no}` : 'New prescription'}
      subtitle="Bengali text is fully supported and prints correctly"
      onClose={onClose}
      width={1000}
      closeOnBackdrop={false}
      footer={
        <>
          <Button icon="save" onClick={() => void saveDraft()}>Save draft</Button>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={busy} onClick={() => void submit(true)}>
            {prescription ? 'Save & close' : 'Issue prescription'}
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}

        <div className="grid grid-4">
          <Field label="Patient" required error={errors.patientId}>
            <PatientPicker
              value={patientId}
              label={patientLabel}
              onChange={(id, label) => {
                setPatientId(id);
                setPatientLabel(label);
              }}
            />
          </Field>
          <Select
            label="Dentist"
            value={dentistId}
            onChange={(event) => setDentistId(event.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...dentists.map((d) => ({ value: String(d.id), label: d.full_name })),
            ]}
            error={errors.dentistId}
          />
          <Field label="Date" required error={errors.issueDate}>
            <input className="input" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
          </Field>
          <Field label="Next visit" error={errors.nextVisit}>
            <input className="input" type="date" value={nextVisit} onChange={(event) => setNextVisit(event.target.value)} min={issueDate} />
          </Field>
        </div>

        <div className="grid grid-2">
          <TextArea label="Chief complaint (CC)" rows={2} value={cc} onChange={(e) => setCc(e.target.value)} error={errors.cc} />
          <TextArea label="On examination (O/E)" rows={2} value={oe} onChange={(e) => setOe(e.target.value)} error={errors.oe} />
        </div>
        <div className="grid grid-2">
          <TextArea label="Diagnosis" rows={2} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} error={errors.diagnosis} />
          <TextArea label="Treatment plan / advice" rows={2} value={advice} onChange={(e) => setAdvice(e.target.value)} error={errors.advice} />
        </div>

        <Card
          title="Medicines"
          icon="prescription"
          actions={<Button size="sm" icon="plus" onClick={() => setMedicines((c) => [...c, newMedicine()])}>Add medicine</Button>}
          flush
        >
          <div className="card-body stack stack-2">
            {medicines.length === 0 ? (
              <p className="text-sm text-3">No medicines added. A prescription with clinical notes only is also valid.</p>
            ) : (
              medicines.map((medicine, index) => (
                <div className="med-row" key={medicine.key}>
                  <div className="med-row-head">
                    <span className="med-index">{index + 1}</span>
                    <input
                      className="input input--sm grow"
                      list="medicine-catalogue"
                      value={medicine.name}
                      onChange={(event) => update(medicine.key, { name: event.target.value })}
                      placeholder="Medicine name"
                      aria-label={`Medicine ${index + 1} name`}
                    />
                    <select
                      className="select input--sm"
                      style={{ width: 118 }}
                      value={medicine.form}
                      onChange={(event) => update(medicine.key, { form: event.target.value })}
                      aria-label="Form"
                    >
                      {MEDICINE_FORMS.map((form) => (
                        <option key={form} value={form}>{form}</option>
                      ))}
                    </select>
                    <input
                      className="input input--sm"
                      style={{ width: 108 }}
                      value={medicine.strength}
                      onChange={(event) => update(medicine.key, { strength: event.target.value })}
                      placeholder="500 mg"
                      aria-label="Strength"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="save"
                      loading={savingMedicine === medicine.key}
                      aria-label="Save to catalogue"
                      onClick={() => void saveToCatalogue(medicine)}
                    />
                    {medicines.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        aria-label="Remove medicine"
                        onClick={() => setMedicines((c) => c.filter((m) => m.key !== medicine.key))}
                      />
                    ) : null}
                  </div>
                  <div className="med-row-body">
                    <div className="row row-wrap" style={{ gap: 4 }}>
                      {(['morning', 'afternoon', 'evening', 'night'] as const).map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          className="timing-chip"
                          aria-pressed={medicine[slot]}
                          onClick={() => update(medicine.key, { [slot]: !medicine[slot] } as Partial<MedicineDraft>)}
                        >
                          {slot.charAt(0).toUpperCase() + slot.slice(1)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="timing-chip"
                        aria-pressed={medicine.beforeFood}
                        onClick={() => update(medicine.key, { beforeFood: !medicine.beforeFood })}
                      >
                        {medicine.beforeFood ? 'Before food' : 'After food'}
                      </button>
                      <button
                        type="button"
                        className="timing-chip timing-chip--prn"
                        aria-pressed={medicine.prn}
                        onClick={() => update(medicine.key, { prn: !medicine.prn })}
                      >
                        PRN
                      </button>
                    </div>
                    <div className="row row-2">
                      <input
                        className="input input--sm grow"
                        value={medicine.dose}
                        onChange={(event) => update(medicine.key, { dose: event.target.value })}
                        placeholder="Dose, e.g. 1 tablet"
                        aria-label="Dose"
                      />
                      <input
                        className="input input--sm"
                        style={{ width: 128 }}
                        value={medicine.duration}
                        onChange={(event) => update(medicine.key, { duration: event.target.value })}
                        placeholder="7 days"
                        aria-label="Duration"
                      />
                      <input
                        className="input input--sm"
                        style={{ width: 96 }}
                        value={medicine.quantity}
                        onChange={(event) => update(medicine.key, { quantity: event.target.value })}
                        placeholder="Qty"
                        aria-label="Quantity"
                      />
                    </div>
                    <input
                      className="input input--sm"
                      value={medicine.instructions}
                      onChange={(event) => update(medicine.key, { instructions: event.target.value })}
                      placeholder="Extra instruction printed under the medicine"
                      aria-label="Instructions"
                    />
                  </div>
                </div>
              ))
            )}
            <datalist id="medicine-catalogue">
              {catalogue.map((medicine) => (
                <option key={medicine.id} value={medicine.name}>
                  {medicine.form} {medicine.strength}
                </option>
              ))}
            </datalist>
          </div>
        </Card>

        <p className="text-xs text-3 row row-1" style={{ gap: 6 }}>
          <Icon name="printer" size={13} /> Issue the prescription, then print it from the list with a preview first.
        </p>
      </div>
    </Modal>
  );
}

function PrescriptionViewer({
  prescription, onClose, onEdit,
}: {
  prescription: RxRow;
  onClose: () => void;
  onEdit: () => void;
}): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [output, setOutput] = useState<'preview' | 'print' | 'pdf' | ''>('');
  const [error, setError] = useState('');
  interface RxItem {
    name: string;
    form: string;
    strength: string;
    dose: string;
    morning: number;
    afternoon: number;
    evening: number;
    night: number;
    before_food: number;
    duration: string;
    prn: number;
  }
  const detail = useResource(
    () => call<{ prescription: Record<string, unknown>; items: RxItem[] }>('prescriptions.get', { id: prescription.id }),
    [prescription.id],
  );

  const print = async (target: 'preview' | 'print' | 'pdf') => {
    setOutput(target);
    setError('');
    try {
      const model = await call<Record<string, unknown>>('documents.prescription', { id: prescription.id });
      const dentistId = Number(detail.data?.prescription.dentist_id ?? 0);
      const signatureAttachmentId = dentistId
        ? Number((await call<{ rows: { id: number; signature_attachment_id: number | null }[] }>('dentists.list', { activeOnly: false })).rows.find((d) => d.id === dentistId)?.signature_attachment_id ?? 0) || null
        : null;
      await runPrint(
        {
          docKind: 'prescription',
          entityId: prescription.id,
          entityLabel: `${prescription.prescription_no} — ${prescription.patient_name}`,
          signatureAttachmentId,
          data: model,
        },
        target,
        app.token,
      );
      if (target === 'pdf') toast.success('PDF saved to your exports folder');
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'Printing failed.';
      setError(message);
      toast.error('Print failed', message);
    } finally {
      setOutput('');
    }
  };

  const items = detail.data?.items ?? [];

  return (
    <Modal
      open
      title={prescription.prescription_no}
      subtitle={`${prescription.patient_name} · ${date(prescription.issue_date, app.prefs)}`}
      onClose={onClose}
      width={720}
      footer={
        <>
          {app.has('prescriptions.edit') ? (
            <Button icon="edit" onClick={onEdit}>Edit</Button>
          ) : null}
          <span className="spacer" />
          <Button icon="eye" loading={output === 'preview'} onClick={() => void print('preview')}>Preview</Button>
          <Button icon="printer" loading={output === 'print'} onClick={() => void print('print')}>Print</Button>
          <Button variant="primary" icon="download" loading={output === 'pdf'} onClick={() => void print('pdf')}>Save PDF</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="grid grid-2">
          <div className="stack stack-1">
            <strong>Chief complaint</strong>
            <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{String(detail.data?.prescription.cc ?? '') || '—'}</p>
          </div>
          <div className="stack stack-1">
            <strong>Diagnosis</strong>
            <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{String(detail.data?.prescription.diagnosis ?? '') || '—'}</p>
          </div>
        </div>
        <Card title={`Medicines (${items.length})`} flush>
          <DataTable
            compact
            loading={detail.loading}
            rows={items.map((item, i) => ({ ...item, id: i }))}
            columns={[
              { key: 'name', header: 'Medicine', render: (row) => <strong>{String(row.name)}</strong> },
              { key: 'dose', header: 'Dose', width: 150, render: (row) => String(row.dose ?? '—') },
              {
                key: 'timing',
                header: 'Timing',
                width: 180,
                render: (row) => (
                  <div className="row row-1" style={{ gap: 3 }}>
                    {(['morning', 'afternoon', 'evening', 'night'] as const)
                      .filter((slot) => Boolean(row[slot]))
                      .map((slot) => (
                        <Badge key={slot} tone="info">
                          {slot.charAt(0).toUpperCase()}
                        </Badge>
                      ))}
                    {row.before_food ? <Badge tone="neutral">BF</Badge> : <Badge tone="neutral">AF</Badge>}
                    {row.prn ? <Badge tone="warn">PRN</Badge> : null}
                  </div>
                ),
              },
              { key: 'duration', header: 'Duration', width: 100, render: (row) => String(row.duration ?? '—') },
            ]}
          />
        </Card>
      </div>
    </Modal>
  );
}
