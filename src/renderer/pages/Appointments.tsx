import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call, ApiError } from '../lib/api';
import {
  Badge, Button, Callout, DataTable, Field, Modal, PageHeader, Select,
  TextArea, TextInput, useConfirm, useDebounced, useResource, useToast,
} from '../components/ui';
import { date, dateAndTime, shiftDateKey, STATUS_LABELS, time, todayKey } from '../lib/format';
import { APPOINTMENT_STATUSES, APPOINTMENT_TYPES, type AppointmentStatus } from '../../shared/constants';
import { PatientPicker } from './PatientPicker';

export type DentistRow = {
  id: number;
  full_name: string;
  title: string | null;
  designations: string | null;
  status: string;
  sort_order: number;
};

interface AppointmentRow {
  id: number;
  patient_id: number;
  dentist_id: number | null;
  appointment_date: string;
  start_time: string;
  duration_minutes: number;
  appointment_type: string;
  notes: string;
  status: string;
  queue_entry_id: number | null;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  dentist_name: string | null;
}

interface DayResult {
  date: string;
  rows: AppointmentRow[];
  summary: { total: number; completed: number; cancelled: number; no_show: number; pending: number };
}

const STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'primary'> = {
  scheduled: 'neutral', confirmed: 'info', arrived: 'primary', in_queue: 'primary',
  in_progress: 'warn', completed: 'ok', cancelled: 'neutral', no_show: 'danger',
};

export function AppointmentsPage(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();
  const toast = useToast();
  const confirm = useConfirm();

  const [dateKey, setDateKey] = useState(todayKey());
  const [dentistId, setDentistId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AppointmentRow | null>(null);
  const [creating, setCreating] = useState(route.query.get('new') === '1');
  const debouncedSearch = useDebounced(search, 250);

  const dentists = useResource(() => call<DentistRow[]>('dentists.list', { activeOnly: true }), []);
  const day = useResource(
    () =>
      call<DayResult>('appointments.day', {
        date: dateKey,
        dentistId: dentistId ? Number(dentistId) : undefined,
      }),
    [dateKey, dentistId, shell.refreshSignal],
  );

  const highlightId = route.query.get('highlight');

  useEffect(() => {
    if (!app.has('appointments.manage')) return;
    const handler = () => setCreating(true);
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [app]);

  const rows = useMemo(() => {
    const list = day.data?.rows ?? [];
    const needle = debouncedSearch.trim().toLowerCase();
    return list.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        row.patient_name.toLowerCase().includes(needle) ||
        row.patient_code.toLowerCase().includes(needle) ||
        (row.phone ?? '').includes(needle)
      );
    });
  }, [day.data, debouncedSearch, statusFilter]);

  const setStatus = async (row: AppointmentRow, status: AppointmentStatus) => {
    try {
      await call('appointments.setStatus', { id: row.id, status });
      day.reload();
    } catch (error) {
      toast.error('Status not changed', error instanceof Error ? error.message : undefined);
    }
  };

  const confirmAttendance = async (row: AppointmentRow, status: AppointmentStatus) => {
    const ok = await confirm({
      title: `Mark ${row.patient_name} as ${STATUS_LABELS[status] ?? status}?`,
      message: `Appointment at ${time(row.start_time, app.prefs)} on ${date(row.appointment_date, app.prefs)}.`,
      confirmLabel: `Yes, mark ${STATUS_LABELS[status] ?? status}`,
    });
    if (ok) await setStatus(row, status);
  };

  const checkIn = async (row: AppointmentRow) => {
    try {
      await call('queue.checkIn', {
        patientId: row.patient_id,
        dentistId: row.dentist_id ?? undefined,
        appointmentId: row.id,
        date: row.appointment_date,
      });
      await call('appointments.setStatus', { id: row.id, status: 'arrived' });
      toast.success(`${row.patient_name} checked in`, 'They are now on the queue board.');
      day.reload();
    } catch (error) {
      toast.error('Check-in failed', error instanceof Error ? error.message : undefined);
    }
  };

  const summary = day.data?.summary;

  return (
    <>
      <PageHeader
        icon="calendar"
        title="Appointments"
        subtitle={
          summary
            ? `${summary.total} booked · ${summary.pending} pending · ${summary.completed} completed`
            : undefined
        }
        actions={
          <>
            <Button icon="chevron-left" aria-label="Previous day" onClick={() => setDateKey(shiftDateKey(dateKey, -1))} />
            <Button onClick={() => setDateKey(todayKey())}>Today</Button>
            <Button icon="chevron-right" aria-label="Next day" onClick={() => setDateKey(shiftDateKey(dateKey, 1))} />
            {app.has('appointments.manage') ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New appointment</Button>
            ) : null}
          </>
        }
      />

      <div className="filter-bar">
        <Field className="inline" label="">
          <input
            className="input input--sm"
            type="date"
            value={dateKey}
            onChange={(event) => setDateKey(event.target.value || todayKey())}
            aria-label="Appointment date"
          />
        </Field>
        <Select
          aria-label="Dentist"
          inputSize="sm"
          style={{ width: 190 }}
          value={dentistId}
          onChange={(event) => setDentistId(event.target.value)}
          options={[
            { value: '', label: 'All dentists' },
            ...(dentists.data ?? []).map((d) => ({ value: String(d.id), label: d.full_name })),
          ]}
        />
        <Select
          aria-label="Status"
          inputSize="sm"
          style={{ width: 160 }}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          options={[
            { value: '', label: 'All statuses' },
            ...APPOINTMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s })),
          ]}
        />
        <div className="filter-search">
          <TextInput
            aria-label="Search appointments"
            placeholder="Filter by patient…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon="search"
            inputSize="sm"
          />
        </div>
        <span className="spacer" />
        <Button size="sm" icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
      </div>

      <div className="card">
        <DataTable
          rows={rows}
          loading={day.loading}
          error={day.error}
          onRetry={day.reload}
          selectedKey={highlightId ? Number(highlightId) : null}
          onRowClick={(row) => setEditing(row)}
          columns={[
            {
              key: 'time',
              header: 'Time',
              width: 118,
              render: (row) => (
                <div className="stack stack-0">
                  <strong className="mono">{time(row.start_time, app.prefs)}</strong>
                  <span className="text-xs text-3">{row.duration_minutes} min</span>
                </div>
              ),
            },
            {
              key: 'patient',
              header: 'Patient',
              render: (row) => (
                <div className="stack stack-0" style={{ minWidth: 0 }}>
                  <strong className="truncate">{row.patient_name}</strong>
                  <span className="text-xs text-3 mono">
                    {row.patient_code}{row.phone ? ` · ${row.phone}` : ''}
                  </span>
                </div>
              ),
            },
            { key: 'type', header: 'Type', width: 150, render: (row) => <span className="truncate">{row.appointment_type}</span> },
            { key: 'dentist', header: 'Dentist', width: 150, render: (row) => <span className="truncate">{row.dentist_name ?? 'Unassigned'}</span> },
            {
              key: 'status',
              header: 'Status',
              width: 130,
              render: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{STATUS_LABELS[row.status] ?? row.status}</Badge>,
            },
            {
              key: 'actions',
              header: '',
              width: app.has('queue.manage') ? 210 : 92,
              render: (row) =>
                app.has('appointments.manage') ? (
                  <div className="row row-1" style={{ gap: 4 }} onClick={(event) => event.stopPropagation()}>
                    {(row.status === 'scheduled' || row.status === 'confirmed') ? (
                      <>
                        {app.has('queue.manage') ? (
                          <Button size="sm" variant="soft" icon="queue" onClick={() => void checkIn(row)} title="Check in">
                            Check in
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          icon="check"
                          aria-label={`Mark ${row.patient_name} as no show`}
                          title="No show"
                          onClick={() => void confirmAttendance(row, 'no_show')}
                        />
                        <Button
                          size="sm"
                          icon="ban"
                          aria-label={`Cancel appointment for ${row.patient_name}`}
                          title="Cancel"
                          onClick={() => void confirmAttendance(row, 'cancelled')}
                        />
                      </>
                    ) : (
                      <Button
                        size="sm"
                        icon="rotate-ccw"
                        aria-label={`Reopen appointment for ${row.patient_name}`}
                        title="Reopen"
                        onClick={() => void setStatus(row, 'scheduled')}
                      />
                    )}
                  </div>
                ) : null,
            },
          ]}
          empty={
            <div className="state">
              <div className="state-title">Nothing booked for {date(dateKey, app.prefs)}</div>
              <div className="state-text">
                {dateKey === todayKey() ? 'No appointments for today.' : 'No appointments on this date.'}
              </div>
              {app.has('appointments.manage') ? (
                <div className="state-actions">
                  <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Book appointment</Button>
                </div>
              ) : null}
            </div>
          }
        />
      </div>

      <AppointmentForm
        open={creating}
        date={dateKey}
        dentists={dentists.data ?? []}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          day.reload();
          shell.requestRefresh();
        }}
      />

      <AppointmentForm
        open={Boolean(editing)}
        date={dateKey}
        appointment={editing}
        dentists={dentists.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          day.reload();
        }}
      />
    </>
  );
}

interface AppointmentFormProps {
  open: boolean;
  /** Required only when creating; ignored when editing. */
  date?: string;
  dentists: DentistRow[];
  appointment?: AppointmentRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function AppointmentForm({ open, date: defaultDate = todayKey(), dentists, appointment, onClose, onSaved }: AppointmentFormProps): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [dateKey, setDateKey] = useState(defaultDate);
  const [startTime, setStartTime] = useState('10:00');
  const [duration, setDuration] = useState(30);
  const [type, setType] = useState<string>('Consultation');
  const [status, setStatus] = useState<string>('scheduled');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setTopError('');
    setConflicts([]);
    if (appointment) {
      setPatientId(appointment.patient_id);
      setPatientLabel(`${appointment.patient_name} (${appointment.patient_code})`);
      setDentistId(appointment.dentist_id ? String(appointment.dentist_id) : '');
      setDateKey(appointment.appointment_date);
      setStartTime(appointment.start_time);
      setDuration(appointment.duration_minutes);
      setType(appointment.appointment_type);
      setStatus(appointment.status);
      setNotes(appointment.notes);
    } else {
      setPatientId(null);
      setPatientLabel('');
      setDentistId(dentists[0] ? String(dentists[0].id) : '');
      setDateKey(defaultDate);
      setStartTime(nextSlot());
      setDuration(30);
      setType('Consultation');
      setStatus('scheduled');
      setNotes('');
    }
  }, [open, appointment, defaultDate, dentists]);

  // Real conflict detection before saving — the service layer is the authority,
  // this simply warns the receptionist earlier.
  useEffect(() => {
    if (!open || !dateKey || !startTime) return;
    const timer = window.setTimeout(() => {
      void call<{ conflicts: { patient_name: string; start_time: string; end_time: string }[] }>('appointments.conflicts', {
        dentistId: dentistId ? Number(dentistId) : undefined,
        dateKey,
        startTime,
        durationMinutes: duration,
        excludeId: appointment?.id,
      })
        .then((result) => {
          setConflicts((result.conflicts ?? []).map((c) => `${c.patient_name} (${c.start_time}–${c.end_time})`));
        })
        .catch(() => setConflicts([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, dateKey, startTime, duration, dentistId, appointment?.id]);

  const save = async (force = false) => {
    if (!patientId) {
      setErrors({ patientId: 'Select a patient.' });
      return;
    }
    setBusy(true);
    setTopError('');
    try {
      const payload = {
        patientId,
        dentistId: dentistId ? Number(dentistId) : undefined,
        appointmentDate: dateKey,
        startTime,
        durationMinutes: duration,
        appointmentType: type,
        status,
        notes: notes.trim(),
        force,
      };
      if (appointment) {
        await call('appointments.update', { id: appointment.id, ...payload });
        toast.success('Appointment updated', `${dateAndTime(dateKey, startTime, app.prefs)}`);
      } else {
        await call('appointments.create', payload);
        toast.success('Appointment booked', `${dateAndTime(dateKey, startTime, app.prefs)}`);
      }
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        if (map.startTime && conflicts.length > 0) {
          setTopError('This slot overlaps another appointment.');
        } else {
          setTopError(caught.message);
        }
      } else {
        setTopError(caught instanceof Error ? caught.message : 'The appointment could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={appointment ? `Appointment #${appointment.id}` : 'New appointment'}
      subtitle={appointment ? `${appointment.patient_name} · ${appointment.patient_code}` : 'Book a slot for a patient'}
      onClose={onClose}
      width={640}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {conflicts.length > 0 && !appointment ? (
            <Button variant="danger-soft" onClick={() => void save(true)} loading={busy}>
              Book anyway
            </Button>
          ) : null}
          <Button variant="primary" icon="save" loading={busy} onClick={() => void save(false)}>
            {appointment ? 'Save changes' : 'Book appointment'}
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        {topError ? <Callout tone="danger">{topError}</Callout> : null}
        {conflicts.length > 0 ? (
          <Callout tone="warn" title="Overlapping slot">
            {conflicts.join(', ')} already occupies this time with the selected dentist. Adjust the time, choose another
            dentist, or book anyway.
          </Callout>
        ) : null}

        <Field label="Patient" required error={errors.patientId}>
          <PatientPicker
            value={patientId}
            label={patientLabel}
            onChange={(id, label) => {
              setPatientId(id);
              setPatientLabel(label);
              setErrors((c) => {
                const next = { ...c };
                delete next.patientId;
                return next;
              });
            }}
          />
        </Field>

        <div className="grid grid-2">
          <Select
            label="Dentist"
            value={dentistId}
            onChange={(event) => setDentistId(event.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...dentists.map((d) => ({ value: String(d.id), label: d.full_name })),
            ]}
          />
          <Select
            label="Type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            options={APPOINTMENT_TYPES.map((t) => ({ value: t, label: t }))}
          />
        </div>

        <div className="grid grid-3">
          <Field label="Date" required error={errors.appointmentDate}>
            <input className="input" type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />
          </Field>
          <Field label="Start time" required error={errors.startTime}>
            <input className="input" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </Field>
          <Field label="Duration" required error={errors.durationMinutes}>
            <select
              className="select"
              value={String(duration)}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              {[10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </Field>
        </div>

        {appointment ? (
          <Select
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={APPOINTMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
          />
        ) : null}

        <TextArea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={errors.notes}
          placeholder="Reason for visit, preparation needed…"
        />
      </div>
    </Modal>
  );
}

function nextSlot(): string {
  const now = new Date();
  const minutes = Math.ceil((now.getHours() * 60 + now.getMinutes() + 10) / 5) * 5;
  const clamped = Math.min(minutes, 22 * 60);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
