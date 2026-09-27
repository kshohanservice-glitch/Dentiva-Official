import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call, ApiError, filesBridge } from '../lib/api';
import {
  Badge, Button, Callout, Card, DataTable, ErrorState, Field, IconButton, Modal, PageHeader,
  Select, Stat, Tabs, TextArea, TextInput, useConfirm, useResource, useToast,
} from '../components/ui';
import { Icon, type IconName } from '../components/Icons';
import { age, date, dateAndTime, GENDER_LABELS, money, relativeTime, STATUS_LABELS, statusTone, todayKey } from '../lib/format';
import { ADULT_TEETH, PRIMARY_TEETH, TOOTH_CONDITIONS, TOOTH_SURFACES } from '../../shared/constants';
import { PatientForm } from './PatientForm';
import { InvoiceForm } from './InvoiceForm';
import { PaymentForm } from './PaymentForm';
import { runPrint, type PrintOutput } from '../lib/printing';

interface PatientDetailModel {
  patient: {
    id: number;
    patient_code: string;
    full_name: string;
    gender: string;
    date_of_birth: string | null;
    age_years: number | null;
    age_months: number | null;
    phone: string | null;
    alt_phone: string | null;
    address: string | null;
    area: string | null;
    district: string | null;
    thana: string | null;
    postcode: string | null;
    blood_group: string | null;
    allergies: string | null;
    medical_history: string | null;
    dental_history: string | null;
    present_complaint: string | null;
    notes: string;
    status: string;
    is_favourite: number;
    created_at: string;
    last_visit_at: string | null;
    photo_attachment_id: number | null;
  };
  summary: {
    total_visits: number;
    last_visit: string | null;
    total_prescriptions: number;
    total_treatments: number;
    upcoming_appointments: number;
    nextAppointment: { id: number; appointment_date: string; start_time: string; status: string; dentist_name: string | null } | null;
  };
  financial: { totalBilledPoisha: number; totalPaidPoisha: number; outstandingPoisha: number };
}

interface ToothRow {
  id: number;
  dentition: 'adult' | 'primary';
  tooth_code: string;
  condition: string;
  surface: string;
  severity: number;
  note: string;
  recorded_at: string;
}

interface VisitRow {
  id: number;
  visit_date: string;
  chief_complaint: string;
  diagnosis: string;
  treatment_plan: string;
  procedure_done: string;
  advice: string;
  status: string;
  dentist_name: string | null;
}

type Tab = 'overview' | 'visits' | 'chart' | 'billing' | 'timeline';

export function PatientDetailPage({
  patientId, initialTab = 'overview',
}: {
  patientId: string;
  initialTab?: string;
}): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();

  const id = Number(patientId);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || 'overview');
  const [editing, setEditing] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [newVisit, setNewVisit] = useState(false);
  const [chartEdit, setChartEdit] = useState(false);
  const [printing, setPrinting] = useState<PrintOutput | ''>('');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const detail = useResource(() => call<PatientDetailModel>('patients.get', { id }), [id, shell.refreshSignal]);
  const chart = useResource(
    () => (tab === 'chart' || tab === 'overview' ? call<{ current: ToothRow[] }>('toothChart.get', { patientId: id }) : Promise.resolve(null)),
    [tab, id, shell.refreshSignal],
  );
  const visits = useResource(
    () => (tab === 'visits' || tab === 'timeline' ? call<{ rows: VisitRow[] }>('visits.list', { patientId: id, pageSize: 50 }) : Promise.resolve(null)),
    [tab, id, shell.refreshSignal],
  );
  const invoices = useResource(
    () => (tab === 'billing' ? call<{ rows: InvoiceLite[] }>('invoices.list', { patientId: id, pageSize: 50 }) : Promise.resolve(null)),
    [tab, id, shell.refreshSignal],
  );
  const payments = useResource(
    () => (tab === 'billing' ? call<{ rows: PaymentLite[] }>('payments.list', { patientId: id, pageSize: 50 }) : Promise.resolve(null)),
    [tab, id, shell.refreshSignal],
  );
  const notes = useResource(
    () => (tab === 'overview' ? call<{ id: number; body: string; is_pinned: number; created_at: string; author: string }[]>('patients.notes', { patientId: id }) : Promise.resolve(null)),
    [tab, id, shell.refreshSignal],
  );
  const timeline = useResource(
    () =>
      tab === 'timeline'
        ? call<{ type: string; at: string; id: number; title: string; detail: string; staff: string | null; route: string }[]>('patients.timeline', { patientId: id, limit: 200 })
        : Promise.resolve(null),
    [tab, id, shell.refreshSignal],
  );

  const patient = detail.data?.patient;

  const setStatus = async (status: string) => {
    if (!patient) return;
    const ok = await confirm({
      title: `Set ${patient.full_name} to ${STATUS_LABELS[status] ?? status}?`,
      message:
        status === 'archived'
          ? 'Archiving hides the patient from day-to-day lists but keeps every clinical and financial record. Patients with an outstanding balance cannot be archived.'
          : 'The status change is recorded in the audit log.',
      tone: status === 'archived' ? 'danger' : 'default',
      confirmLabel: `Set to ${STATUS_LABELS[status] ?? status}`,
    });
    if (!ok) return;
    try {
      await call('patients.setStatus', { id, status });
      toast.success('Status updated', patient.full_name);
      detail.reload();
    } catch (caught) {
      toast.error('Could not change status', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const printSummary = async (output: PrintOutput) => {
    setPrinting(output);
    try {
      const model = await call<Record<string, unknown>>('documents.patientSummary', { patientId: id });
      await runPrint(
        { docKind: 'patient-summary', entityId: id, entityLabel: patient?.full_name ?? 'Patient summary', data: model },
        output,
        app.token,
      );
      if (output === 'pdf') toast.success('Summary PDF saved');
    } catch (caught) {
      toast.error('Could not print', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPrinting('');
    }
  };

  const addNote = async () => {
    if (note.trim().length < 2) return;
    setSavingNote(true);
    try {
      await call('patients.addNote', { patientId: id, body: note.trim() });
      setNote('');
      notes.reload();
      toast.success('Note added');
    } catch (caught) {
      toast.error('Note not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setSavingNote(false);
    }
  };

  const exportPatientCsv = async () => {
    const result = await call<{ filename: string; content: string; rows: number }>('exports.csv', { dataset: 'patients' });
    const saved = await filesBridge().saveText(`Patient-${patient?.patient_code}.csv`, result.content);
    toast.success('Export ready', saved.saved ? result.filename : 'The download was cancelled.');
  };

  if (detail.loading && !detail.data) {
    return (
      <>
        <PageHeader title="Loading patient…" icon="patients" breadcrumb={[{ label: 'Patients', href: 'patients' }]} />
        <Card><div className="skeleton" style={{ height: 200 }} /></Card>
      </>
    );
  }

  if (detail.error || !detail.data || !patient) {
    return (
      <>
        <PageHeader title="Patient" icon="patients" breadcrumb={[{ label: 'Patients', href: 'patients' }]} />
        <ErrorState error={detail.error ?? 'This patient could not be found.'} onRetry={detail.reload} />
      </>
    );
  }

  const financial = detail.data.financial;
  const summary = detail.data.summary;

  return (
    <>
      <PageHeader
        icon="patients"
        title={patient.full_name}
        subtitle={`${patient.patient_code} · ${age(patient, app.prefs)} · ${GENDER_LABELS[patient.gender] ?? patient.gender}`}
        breadcrumb={[{ label: 'Patients', href: 'patients' }, { label: patient.full_name }]}
        actions={
          <>
            <Badge tone={statusTone(patient.status)}>{STATUS_LABELS[patient.status] ?? patient.status}</Badge>
            {app.has('patients.export') ? (
              <Button icon="download" onClick={() => void exportPatientCsv()}>Export</Button>
            ) : null}
            {app.has('clinical.view') ? (
              <Button icon="file-text" loading={printing === 'preview'} onClick={() => void printSummary('preview')}>Summary</Button>
            ) : null}
            {app.has('clinical.view') ? (
              <Button icon="printer" loading={printing === 'print'} onClick={() => void printSummary('print')}>Print summary</Button>
            ) : null}
            {app.has('patients.edit') ? (
              <Button variant="primary" icon="edit" onClick={() => setEditing(true)}>Edit patient</Button>
            ) : null}
          </>
        }
      />

      {patient.allergies?.trim() ? (
        <div className="mb-3">
          <Callout tone="danger" title="Allergy alert">
            <strong>{patient.allergies}</strong> — shown on every prescription for this patient.
          </Callout>
        </div>
      ) : null}

      <div className="stat-grid stat-grid--compact">
        <Stat label="Visits" value={summary.total_visits} meta={summary.last_visit ? `Last ${date(summary.last_visit, app.prefs)}` : 'No visits yet'} icon="stethoscope" />
        <Stat label="Prescriptions" value={summary.total_prescriptions} icon="prescription" tone="info" href={`clinical/prescriptions?patient=${id}`} />
        <Stat label="Treatments done" value={summary.total_treatments} icon="treatments" />
        {app.has('invoices.view') ? (
          <>
            <Stat label="Outstanding" value={money(financial.outstandingPoisha, app.prefs, { decimals: 0 })} icon="wallet" tone={financial.outstandingPoisha > 0 ? 'warn' : 'ok'} />
            <Stat label="Lifetime billed" value={money(financial.totalBilledPoisha, app.prefs, { decimals: 0 })} icon="invoice" tone="primary" />
          </>
        ) : null}
        <Stat
          label="Next appointment"
          value={summary.nextAppointment ? dateAndTime(summary.nextAppointment.appointment_date, summary.nextAppointment.start_time, app.prefs) : 'None'}
          meta={summary.nextAppointment?.dentist_name ?? undefined}
          icon="calendar"
          tone="info"
        />
      </div>

      <div className="mt-4">
        <Tabs
          ariaLabel="Patient sections"
          value={tab}
          onChange={(id2) => setTab(id2 as Tab)}
          items={[
            { id: 'overview', label: 'Overview', icon: 'info-circle' },
            { id: 'visits', label: 'Visits', icon: 'stethoscope', count: summary.total_visits, permission: 'clinical.view' },
            { id: 'chart', label: 'Dental chart', icon: 'tooth', permission: 'clinical.view' },
            { id: 'billing', label: 'Billing', icon: 'invoice', permission: 'invoices.view' },
            { id: 'timeline', label: 'Timeline', icon: 'activity', permission: 'clinical.view' },
          ]}
        />
      </div>

      <div className="mt-3">
        {tab === 'overview' ? (
          <div className="grid grid-2-1">
            <div className="stack stack-3">
              <Card title="Demographics" icon="user">
                <div className="detail-grid">
                  <DetailRow label="Phone" value={patient.phone || '—'} />
                  <DetailRow label="Alternate phone" value={patient.alt_phone || '—'} />
                  <DetailRow label="Blood group" value={patient.blood_group || '—'} />
                  <DetailRow label="Date of birth" value={patient.date_of_birth ? date(patient.date_of_birth, app.prefs) : '—'} />
                  <DetailRow
                    label="Address"
                    value={[patient.address, patient.area, patient.thana, patient.district, patient.postcode].filter(Boolean).join(', ') || '—'}
                    wide
                  />
                  <DetailRow label="Registered" value={`${date(patient.created_at, app.prefs)} (${relativeTime(patient.created_at)})`} wide />
                </div>
              </Card>

              <Card title="Clinical background" icon="clipboard">
                <div className="stack stack-3">
                  <div>
                    <div className="field-label">Present complaint</div>
                    <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{patient.present_complaint || '—'}</p>
                  </div>
                  <div>
                    <div className="field-label">Medical history</div>
                    <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{patient.medical_history || '—'}</p>
                  </div>
                  <div>
                    <div className="field-label">Dental history</div>
                    <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{patient.dental_history || '—'}</p>
                  </div>
                </div>
              </Card>

              <Card
                title="Dental chart snapshot"
                icon="tooth"
                actions={
                  app.has('toothchart.edit') ? (
                    <Button size="sm" icon="edit" onClick={() => setChartEdit(true)}>Update chart</Button>
                  ) : null
                }
              >
                <ToothChart readOnly current={chart.data?.current ?? []} />
              </Card>
            </div>

            <div className="stack stack-3">
              <Card
                title="Quick actions"
                actions={
                  <IconButton icon="more-vertical" label="More" size={16} onClick={() => undefined} />
                }
              >
                <div className="stack stack-2">
                  {app.has('clinical.create') ? (
                    <Button block icon="stethoscope" onClick={() => setNewVisit(true)}>Start a visit</Button>
                  ) : null}
                  {app.has('invoices.create') ? (
                    <Button block icon="invoice" onClick={() => setInvoicing(true)}>Create invoice</Button>
                  ) : null}
                  {app.has('payments.create') && financial.outstandingPoisha > 0 ? (
                    <Button block icon="payments" onClick={() => setPaying(true)}>Record payment</Button>
                  ) : null}
                  {app.has('appointments.manage') ? (
                    <Button block icon="calendar" onClick={() => route.navigate('appointments?new=1')}>Book appointment</Button>
                  ) : null}
                  {app.has('prescriptions.create') ? (
                    <Button block icon="prescription" onClick={() => route.navigate(`clinical/prescriptions?new=1&patient=${id}`)}>
                      Write prescription
                    </Button>
                  ) : null}
                </div>
              </Card>

              {app.has('clinical.view') ? (
                <Card
                  title="Notes"
                  icon="clipboard"
                  actions={
                    <Button size="sm" icon="plus" onClick={() => document.getElementById('patient-note-input')?.focus()}>
                      Add
                    </Button>
                  }
                >
                  <div className="stack stack-2">
                    <TextArea
                      id="patient-note-input"
                      rows={2}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Internal note — never printed"
                    />
                    <Button size="sm" variant="soft" loading={savingNote} disabled={note.trim().length < 2} onClick={() => void addNote()}>
                      Save note
                    </Button>
                    <ul className="note-list">
                      {(notes.data ?? []).map((entry) => (
                        <li className="note-item" key={entry.id} data-pinned={entry.is_pinned ? 'true' : 'false'}>
                          <div className="row row-1" style={{ justifyContent: 'space-between' }}>
                            <strong className="text-xs">{entry.author ?? 'System'}</strong>
                            <span className="text-xs text-3">{relativeTime(entry.created_at)}</span>
                          </div>
                          <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</p>
                          {app.has('clinical.edit') ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="trash"
                              aria-label="Delete note"
                              onClick={() => {
                                void (async () => {
                                  const ok = await confirm({ title: 'Delete this note?', message: 'The note is removed permanently.', tone: 'danger', confirmLabel: 'Delete' });
                                  if (!ok) return;
                                  await call('patients.deleteNote', { id: entry.id });
                                  notes.reload();
                                })();
                              }}
                            />
                          ) : null}
                        </li>
                      ))}
                      {(notes.data ?? []).length === 0 ? <p className="text-sm text-3">No notes yet.</p> : null}
                    </ul>
                  </div>
                </Card>
              ) : null}

              {app.has('patients.archive') ? (
                <Card title="Record status">
                  <div className="stack stack-2">
                    {(['active', 'inactive', 'archived'] as const)
                      .filter((status) => status !== patient.status)
                      .map((status) => (
                        <Button
                          key={status}
                          variant={status === 'archived' ? 'danger-soft' : 'default'}
                          block
                          onClick={() => void setStatus(status)}
                        >
                          Mark as {STATUS_LABELS[status] ?? status}
                        </Button>
                      ))}
                  </div>
                </Card>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === 'visits' ? (
          <Card
            title="Visit history"
            icon="stethoscope"
            actions={
              app.has('clinical.create') ? (
                <Button size="sm" variant="primary" icon="plus" onClick={() => setNewVisit(true)}>New visit</Button>
              ) : null
            }
            flush
          >
            <DataTable
              rows={visits.data?.rows ?? []}
              loading={visits.loading}
              error={visits.error}
              onRetry={visits.reload}
              onRowClick={(row) => route.navigate(`patients/${id}/visits?visit=${row.id}`)}
              columns={[
                { key: 'date', header: 'Date', width: 120, render: (row) => date(row.visit_date, app.prefs) },
                {
                  key: 'complaint',
                  header: 'Complaint',
                  render: (row) => (
                    <div className="stack stack-0" style={{ minWidth: 0 }}>
                      <span className="truncate">{row.chief_complaint || '—'}</span>
                      {row.diagnosis ? <span className="text-xs text-3 truncate">{row.diagnosis}</span> : null}
                    </div>
                  ),
                },
                { key: 'dentist', header: 'Dentist', width: 150, render: (row) => <span className="truncate">{row.dentist_name ?? '—'}</span> },
                {
                  key: 'status',
                  header: 'Status',
                  width: 110,
                  render: (row) => <Badge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</Badge>,
                },
              ]}
              empty={<div className="state"><div className="state-title">No visits recorded</div><div className="state-text">Start a visit to record the examination, diagnosis and treatment performed.</div></div>}
            />
          </Card>
        ) : null}

        {tab === 'chart' ? (
          <Card
            title="Dental chart"
            icon="tooth"
            subtitle="Click a tooth to record its current condition"
            actions={
              app.has('toothchart.edit') ? (
                <Button size="sm" variant="primary" icon="edit" onClick={() => setChartEdit(true)}>Update chart</Button>
              ) : null
            }
          >
            <ToothChart current={chart.data?.current ?? []} editable={app.has('toothchart.edit')} onSelect={() => setChartEdit(true)} />
          </Card>
        ) : null}

        {tab === 'billing' ? (
          <div className="grid grid-2-1">
            <div className="stack stack-3">
              <Card
                title="Invoices"
                icon="invoice"
                actions={
                  app.has('invoices.create') ? (
                    <Button size="sm" icon="plus" onClick={() => setInvoicing(true)}>New invoice</Button>
                  ) : null
                }
                flush
              >
                <DataTable
                  rows={invoices.data?.rows ?? []}
                  loading={invoices.loading}
                  error={invoices.error}
                  onRetry={invoices.reload}
                  onRowClick={(row) => route.navigate(`billing/invoices/${row.id}`)}
                  columns={[
                    { key: 'no', header: 'Invoice', width: 130, render: (row) => <span className="mono text-sm">{row.invoice_no}</span> },
                    { key: 'date', header: 'Date', width: 110, render: (row) => date(row.issue_date, app.prefs) },
                    { key: 'total', header: 'Total', numeric: true, render: (row) => money(row.grand_total_poisha, app.prefs) },
                    { key: 'paid', header: 'Paid', numeric: true, render: (row) => <span className="text-ok">{money(row.paid_poisha, app.prefs)}</span> },
                    {
                      key: 'balance',
                      header: 'Balance',
                      numeric: true,
                      render: (row) => (
                        <span className={Number(row.balance_poisha) > 0 ? 'text-danger' : ''}>
                          {money(row.balance_poisha, app.prefs)}
                        </span>
                      ),
                    },
                    { key: 'status', header: 'Status', width: 110, render: (row) => <Badge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</Badge> },
                  ]}
                  empty={<div className="state state--compact"><div className="state-title">No invoices</div></div>}
                />
              </Card>

              <Card title="Payments" icon="payments" flush>
                <DataTable
                  rows={payments.data?.rows ?? []}
                  loading={payments.loading}
                  error={payments.error}
                  onRetry={payments.reload}
                  columns={[
                    { key: 'no', header: 'Receipt', width: 140, render: (row) => <span className="mono text-sm">{row.payment_no}</span> },
                    { key: 'date', header: 'Date', width: 110, render: (row) => date(row.payment_date, app.prefs) },
                    { key: 'method', header: 'Method', width: 100, render: (row) => row.method },
                    {
                      key: 'amount',
                      header: 'Amount',
                      numeric: true,
                      render: (row) => (
                        <span className={row.type === 'refund' ? 'text-danger' : 'text-ok'}>
                          {row.type === 'refund' ? '−' : ''}{money(Math.abs(Number(row.amount_poisha)), app.prefs)}
                        </span>
                      ),
                    },
                  ]}
                  empty={<div className="state state--compact"><div className="state-title">No payments recorded</div></div>}
                />
              </Card>
            </div>

            <Card title="Balance" icon="wallet">
              <div className="stack stack-2">
                <div className="row-between"><span className="text-sm text-3">Total billed</span><span className="mono">{money(financial.totalBilledPoisha, app.prefs)}</span></div>
                <div className="row-between"><span className="text-sm text-3">Total paid</span><span className="mono text-ok">{money(financial.totalPaidPoisha, app.prefs)}</span></div>
                <div className="divider" />
                <div className="row-between">
                  <span className="text-sm">Outstanding</span>
                  <span className={financial.outstandingPoisha > 0 ? 'mono text-danger' : 'mono text-ok'}>
                    {money(financial.outstandingPoisha, app.prefs)}
                  </span>
                </div>
                {app.has('payments.create') && financial.outstandingPoisha > 0 ? (
                  <Button block variant="primary" icon="payments" onClick={() => setPaying(true)}>Record payment</Button>
                ) : null}
              </div>
            </Card>
          </div>
        ) : null}

        {tab === 'timeline' ? (
          <Card title="Clinical timeline" icon="activity" subtitle="Everything that happened to this patient" flush>
            {timeline.loading ? (
              <div style={{ padding: 12 }}><div className="skeleton" style={{ height: 160 }} /></div>
            ) : (timeline.data ?? []).length === 0 ? (
              <div className="state"><div className="state-title">Nothing recorded yet</div></div>
            ) : (
              <ul className="timeline">
                {timeline.data?.map((event) => (
                  <li className="timeline-item" key={`${event.type}-${event.id}`}>
                    <span className={`timeline-dot timeline-dot--${event.type}`}>
                      <Icon name={TIMELINE_ICONS[event.type] ?? 'activity'} size={13} />
                    </span>
                    <button type="button" className="timeline-body" onClick={() => route.navigate(event.route)}>
                      <span className="timeline-title">{event.title}</span>
                      <span className="timeline-meta">
                        {date(event.at, app.prefs)}
                        {event.staff ? ` · ${event.staff}` : ''}
                        {event.detail ? ` · ${event.detail}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      <PatientForm
        open={editing}
        patient={patient}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          detail.reload();
          shell.requestRefresh();
        }}
      />

      <InvoiceForm
        open={invoicing}
        patientId={id}
        onClose={() => setInvoicing(false)}
        onSaved={() => {
          setInvoicing(false);
          detail.reload();
          invoices.reload();
          shell.requestRefresh();
        }}
      />

      <PaymentForm
        open={paying}
        patientId={id}
        patientLabel={`${patient.full_name} (${patient.patient_code})`}
        onClose={() => setPaying(false)}
        onSaved={() => {
          setPaying(false);
          detail.reload();
          payments.reload();
          invoices.reload();
          shell.requestRefresh();
        }}
      />

      <VisitForm
        open={newVisit}
        patientId={id}
        onClose={() => setNewVisit(false)}
        onSaved={() => {
          setNewVisit(false);
          detail.reload();
          visits.reload();
          shell.requestRefresh();
        }}
      />

      {chartEdit ? (
        <ToothChartEditor
          patientId={id}
          current={chart.data?.current ?? []}
          onClose={() => setChartEdit(false)}
          onSaved={() => {
            setChartEdit(false);
            chart.reload();
            shell.requestRefresh();
          }}
        />
      ) : null}
    </>
  );
}

const TIMELINE_ICONS: Record<string, IconName> = {
  visit: 'stethoscope',
  prescription: 'prescription',
  invoice: 'invoice',
  payment: 'payments',
  appointment: 'calendar',
  referral: 'send',
  attachment: 'paperclip',
  note: 'clipboard',
};

function DetailRow({ label, value, wide }: { label: string; value: string; wide?: boolean }): JSX.Element {
  return (
    <div className={wide ? 'detail-row detail-row--wide' : 'detail-row'}>
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

interface InvoiceLite {
  id: number;
  invoice_no: string;
  issue_date: string;
  grand_total_poisha: number;
  paid_poisha: number;
  balance_poisha: number;
  status: string;
}

interface PaymentLite {
  id: number;
  payment_no: string;
  payment_date: string;
  method: string;
  amount_poisha: number;
  type: string;
}

function ToothChart({
  current, editable, onSelect, readOnly,
}: {
  current: ToothRow[];
  editable?: boolean;
  onSelect?: (tooth: string, dentition: 'adult' | 'primary') => void;
  readOnly?: boolean;
}): JSX.Element {
  const byTooth = useMemo(() => {
    const m = new Map<string, ToothRow>();
    for (const row of current) if (row.surface === 'full') m.set(`${row.dentition}:${row.tooth_code}`, row);
    for (const row of current) if (row.surface !== 'full' && !m.has(`${row.dentition}:${row.tooth_code}`)) {
      m.set(`${row.dentition}:${row.tooth_code}`, row);
    }
    return m;
  }, [current]);

  const meta = (id: string) => TOOTH_CONDITIONS.find((c) => c.id === id) ?? TOOTH_CONDITIONS[0];

  // Upper arch reads left→right for the patient, so the right side is reversed
  // to mirror the anatomical layout clinicians expect.
  const quadrant = (
    label: string,
    teeth: readonly number[],
    dentition: 'adult' | 'primary',
    reverse: boolean,
  ) => {
    const codes = teeth.map(String);
    return (
      <div className="dental-quadrant" key={`${dentition}-${label}`}>
        <div className="dental-quadrant__label">{label}</div>
        <div className="dental-row">
          {(reverse ? [...codes].reverse() : codes).map((code) => {
            const condition = byTooth.get(`${dentition}:${code}`);
            const info = meta(condition?.condition ?? 'healthy');
            const glyph = condition && condition.condition !== 'healthy' ? info.glyph : '';
            const title = condition
              ? `${code} — ${info.label}${condition.surface !== 'full' ? ` (${condition.surface})` : ''}` +
                `${condition.severity ? `, severity ${condition.severity}` : ''}${condition.note ? `: ${condition.note}` : ''}`
              : `${code} — healthy`;
            return (
              <button
                key={code}
                type="button"
                className="tooth"
                data-condition={condition?.condition ?? 'healthy'}
                data-flagged={condition && condition.condition !== 'healthy' ? 'true' : 'false'}
                title={title}
                aria-label={title}
                onClick={() => (editable && !readOnly ? onSelect?.(code, dentition) : undefined)}
                disabled={!editable || readOnly}
              >
                <span className="tooth__no">{code}</span>
                <span className="tooth__body">{glyph}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="dental-chart">
      {quadrant('Upper right', ADULT_TEETH.slice(0, 8), 'adult', false)}
      {quadrant('Upper left', ADULT_TEETH.slice(8), 'adult', true)}
      {quadrant('Lower right', ADULT_TEETH.slice(16, 24), 'adult', false)}
      {quadrant('Lower left', ADULT_TEETH.slice(24), 'adult', true)}
      <div className="chart-legend">
        {TOOTH_CONDITIONS.map((condition) => (
          <span className="chart-legend-item" key={condition.id}>
            <span className="chart-swatch" data-condition={condition.id} /> {condition.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ToothChartEditor({
  patientId, current, onClose, onSaved,
}: {
  patientId: number;
  current: ToothRow[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const [dentition, setDentition] = useState<'adult' | 'primary'>('adult');
  const [teeth, setTeeth] = useState<string[]>([]);
  const [condition, setCondition] = useState('caries');
  const [surface, setSurface] = useState('full');
  const [severity, setSeverity] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const teethList = dentition === 'adult' ? ADULT_TEETH : PRIMARY_TEETH;
  const chartMap = useMemo(() => {
    const m = new Map<string, ToothRow>();
    for (const row of current) if (row.dentition === dentition) m.set(row.tooth_code, row);
    return m;
  }, [current, dentition]);

  const toggle = (code: string) => {
    setTeeth((currentTeeth) =>
      currentTeeth.includes(code) ? currentTeeth.filter((t) => t !== code) : [...currentTeeth, code].sort(),
    );
  };

  const submit = async () => {
    if (teeth.length === 0) {
      setError('Select at least one tooth.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await call<{ updated: number }>('toothChart.set', {
        patientId,
        dentition,
        condition,
        surface,
        severity: Number(severity),
        note: note.trim(),
        teeth,
      });
      toast.success('Dental chart updated', `${result.updated} tooth record(s) saved.`);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'The chart could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Update dental chart"
      subtitle="Every change is kept in the tooth history with the dentist who made it"
      onClose={onClose}
      width={900}
      closeOnBackdrop={false}
      footer={
        <>
          <span className="text-sm text-3">{teeth.length} tooth/teeth selected</span>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>Save to chart</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="grid grid-3">
          <SegmentedDentition value={dentition} onChange={(value) => { setDentition(value); setTeeth([]); }} />
          <Select
            label="Condition"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
            options={TOOTH_CONDITIONS.map((c) => ({ value: c.id, label: c.label }))}
          />
          <Select
            label="Surface"
            value={surface}
            onChange={(event) => setSurface(event.target.value)}
            options={TOOTH_SURFACES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          />
        </div>
        <div className="grid grid-2">
          <Select
            label="Severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            options={[
              { value: '1', label: '1 — Mild' },
              { value: '2', label: '2 — Moderate' },
              { value: '3', label: '3 — Severe' },
            ]}
          />
          <TextInput label="Note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional detail printed on summaries" />
        </div>

        <div className="dental-row dental-row--picker">
          {teethList.map((tooth) => {
            const code = String(tooth);
            const existing = chartMap.get(code);
            const info = TOOTH_CONDITIONS.find((c) => c.id === existing?.condition) ?? TOOTH_CONDITIONS[0];
            return (
              <button
                key={code}
                type="button"
                className="tooth"
                data-condition={existing?.condition ?? 'healthy'}
                title={`Tooth ${code}${existing ? ` — currently ${info.label}` : ' — healthy'}`}
                aria-pressed={teeth.includes(code)}
                onClick={() => toggle(code)}
              >
                <span className="tooth__no">{code}</span>
                <span className="tooth__body">{existing && existing.condition !== 'healthy' ? info.glyph : ''}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-3">Tap a tooth to add it to this update. Selected teeth are outlined in the accent colour.</p>

        <p className="text-xs text-3">
          Selected: {teeth.length ? teeth.join(', ') : 'none yet'} · {TOOTH_CONDITIONS.find((c) => c.id === condition)?.label} on{' '}
          {surface} · severity {severity}
        </p>
      </div>
    </Modal>
  );
}

function SegmentedDentition({
  value, onChange,
}: {
  value: 'adult' | 'primary';
  onChange: (value: 'adult' | 'primary') => void;
}): JSX.Element {
  return (
    <Field label="Dentition" required>
      <div className="segmented" role="group" aria-label="Dentition">
        <button type="button" aria-pressed={value === 'adult'} onClick={() => onChange('adult')}>Adult</button>
        <button type="button" aria-pressed={value === 'primary'} onClick={() => onChange('primary')}>Primary</button>
      </div>
    </Field>
  );
}

function VisitForm({
  open, patientId, onClose, onSaved,
}: {
  open: boolean;
  patientId: number;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [dentists, setDentists] = useState<{ id: number; full_name: string }[]>([]);
  const [form, setForm] = useState({
    visitDate: todayKey(),
    dentistId: '',
    chiefComplaint: '',
    history: '',
    examination: '',
    diagnosis: '',
    treatmentPlan: '',
    procedureDone: '',
    advice: '',
    followUpDate: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({
      visitDate: todayKey(),
      dentistId: '',
      chiefComplaint: '',
      history: '',
      examination: '',
      diagnosis: '',
      treatmentPlan: '',
      procedureDone: '',
      advice: '',
      followUpDate: '',
      notes: '',
    });
    setError('');
    void call<{ id: number; full_name: string }[]>('dentists.list', { activeOnly: true })
      .then((rows) => {
        setDentists(rows);
        setForm((c) => ({ ...c, dentistId: rows[0] ? String(rows[0].id) : '' }));
      })
      .catch(() => setDentists([]));
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await call('visits.create', {
        patientId,
        dentistId: form.dentistId ? Number(form.dentistId) : undefined,
        visitDate: form.visitDate,
        chiefComplaint: form.chiefComplaint.trim(),
        history: form.history.trim(),
        examination: form.examination.trim(),
        diagnosis: form.diagnosis.trim(),
        treatmentPlan: form.treatmentPlan.trim(),
        procedureDone: form.procedureDone.trim(),
        advice: form.advice.trim(),
        followUpDate: form.followUpDate || undefined,
        notes: form.notes.trim(),
      });
      toast.success('Visit recorded', date(form.visitDate, app.prefs));
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'The visit could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="New visit"
      subtitle="Record what you found and what you did — printed on the patient summary"
      onClose={onClose}
      width={840}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>Save visit</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="grid grid-3">
          <Field label="Visit date" required>
            <input className="input" type="date" value={form.visitDate} onChange={(e) => setForm({ ...form, visitDate: e.target.value })} />
          </Field>
          <Select
            label="Dentist"
            value={form.dentistId}
            onChange={(event) => setForm({ ...form, dentistId: event.target.value })}
            options={[{ value: '', label: 'Unassigned' }, ...dentists.map((d) => ({ value: String(d.id), label: d.full_name }))]}
          />
          <Field label="Follow-up date">
            <input className="input" type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} min={form.visitDate} />
          </Field>
        </div>
        <div className="grid grid-2">
          <TextArea label="Chief complaint" rows={2} value={form.chiefComplaint} onChange={(e) => setForm({ ...form, chiefComplaint: e.target.value })} />
          <TextArea label="History" rows={2} value={form.history} onChange={(e) => setForm({ ...form, history: e.target.value })} />
        </div>
        <div className="grid grid-2">
          <TextArea label="Examination" rows={3} value={form.examination} onChange={(e) => setForm({ ...form, examination: e.target.value })} />
          <TextArea label="Diagnosis" rows={3} value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
        </div>
        <div className="grid grid-2">
          <TextArea label="Treatment plan" rows={3} value={form.treatmentPlan} onChange={(e) => setForm({ ...form, treatmentPlan: e.target.value })} />
          <TextArea label="Procedure done" rows={3} value={form.procedureDone} onChange={(e) => setForm({ ...form, procedureDone: e.target.value })} />
        </div>
        <div className="grid grid-2">
          <TextArea label="Advice" rows={2} value={form.advice} onChange={(e) => setForm({ ...form, advice: e.target.value })} />
          <TextArea label="Internal notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} hint="Never printed." />
        </div>
      </div>
    </Modal>
  );
}
