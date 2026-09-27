import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call, ApiError } from '../lib/api';
import {
  Badge, Button, Callout, Checkbox, Field, Modal, PageHeader, Select, TextInput, useConfirm, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { age, date, relativeTime, shiftDateKey, time, todayKey } from '../lib/format';
import { PatientPicker } from './PatientPicker';
import type { DentistRow } from './Appointments';

interface QueueRow {
  id: number;
  patient_id: number;
  dentist_id: number | null;
  appointment_id: number | null;
  queue_no: number;
  queue_date: string;
  arrived_at: string | null;
  called_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  priority: string;
  note: string;
  visit_id: number | null;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  age_years: number | null;
  age_months: number | null;
  date_of_birth: string | null;
  dentist_name: string | null;
  appointment_type: string | null;
  start_time: string | null;
}

interface BoardResult {
  date: string;
  rows: QueueRow[];
  summary: { waiting: number; in_progress: number; completed: number };
}

const STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'primary'> = {
  waiting: 'info', called: 'warn', in_progress: 'primary', completed: 'ok', skipped: 'neutral', cancelled: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  waiting: 'Waiting', called: 'Called', in_progress: 'In chair', completed: 'Completed', skipped: 'Skipped', cancelled: 'Cancelled',
};

export function QueuePage(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();
  const toast = useToast();
  const confirm = useConfirm();

  const [dateKey, setDateKey] = useState(todayKey());
  const [dentistId, setDentistId] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);

  const dentists = useResource(() => call<DentistRow[]>('dentists.list', { activeOnly: true }), []);
  const board = useResource(
    () => call<BoardResult>('queue.board', { date: dateKey, dentistId: dentistId ? Number(dentistId) : undefined }),
    [dateKey, dentistId, shell.refreshSignal],
  );

  const columns = useMemo(() => {
    const ids = Array.from(new Set((board.data?.rows ?? []).map((r) => r.dentist_id ?? 0)));
    return ids.length ? ids : [null];
  }, [board.data]);

  const byDentist = useMemo(() => {
    const map = new Map<number | null, QueueRow[]>();
    for (const id of columns) map.set(id, []);
    for (const row of board.data?.rows ?? []) {
      const key = row.dentist_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(row);
    }
    return map;
  }, [board.data, columns]);

  const updateStatus = async (row: QueueRow, status: string) => {
    try {
      await call('queue.updateStatus', { id: row.id, status });
      board.reload();
      shell.requestRefresh();
    } catch (error) {
      toast.error('Queue not updated', error instanceof Error ? error.message : undefined);
    }
  };

  const nextAction = (row: QueueRow): { label: string; icon: 'play' | 'check' | 'user-check'; status: string } | null => {
    if (row.status === 'waiting') return { label: 'Call', icon: 'user-check', status: 'called' };
    if (row.status === 'called') return { label: 'Start', icon: 'play', status: 'in_progress' };
    if (row.status === 'in_progress') return { label: 'Complete', icon: 'check', status: 'completed' };
    return null;
  };

  const remove = async (row: QueueRow) => {
    const ok = await confirm({
      title: `Remove ${row.patient_name} from the queue?`,
      message: 'The patient keeps their appointment; only the queue entry is cancelled.',
      tone: 'danger',
      confirmLabel: 'Remove from queue',
    });
    if (!ok) return;
    try {
      await call('queue.remove', { id: row.id });
      board.reload();
    } catch (error) {
      toast.error('Could not remove', error instanceof Error ? error.message : undefined);
    }
  };

  const summary = board.data?.summary;
  const active = (board.data?.rows ?? []).filter((r) => r.status !== 'completed');

  return (
    <>
      <PageHeader
        icon="queue"
        title="Patient queue"
        subtitle={
          summary
            ? `${summary.waiting} waiting · ${summary.in_progress} in chair · ${summary.completed} done`
            : undefined
        }
        actions={
          <>
            <Button icon="chevron-left" aria-label="Previous day" onClick={() => setDateKey(shiftDateKey(dateKey, -1))} />
            <Button onClick={() => setDateKey(todayKey())}>Today</Button>
            <Button icon="chevron-right" aria-label="Next day" onClick={() => setDateKey(shiftDateKey(dateKey, 1))} />
            {app.has('queue.manage') ? (
              <Button variant="primary" icon="user-check" onClick={() => setCheckingIn(true)}>
                Check in patient
              </Button>
            ) : null}
          </>
        }
      />

      <div className="filter-bar">
        <input
          className="input input--sm"
          type="date"
          value={dateKey}
          onChange={(event) => setDateKey(event.target.value || todayKey())}
          aria-label="Queue date"
        />
        <Select
          aria-label="Chair / dentist"
          inputSize="sm"
          style={{ width: 200 }}
          value={dentistId}
          onChange={(event) => setDentistId(event.target.value)}
          options={[
            { value: '', label: 'All chairs' },
            ...(dentists.data ?? []).map((d) => ({ value: String(d.id), label: d.full_name })),
          ]}
        />
        <span className="spacer" />
        <Button size="sm" icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
      </div>

      {board.error ? <Callout tone="danger">{board.error instanceof Error ? board.error.message : 'The queue could not be loaded.'}</Callout> : null}

      {board.loading && !board.data ? (
        <div className="queue-grid">
          {[0, 1, 2].map((i) => (
            <div className="card" key={i}>
              <div className="card-body"><div className="skeleton" style={{ height: 180 }} /></div>
            </div>
          ))}
        </div>
      ) : active.length === 0 && !board.loading ? (
        <div className="card">
          <div className="state">
            <div className="state-icon"><Icon name="queue" size={24} /></div>
            <div className="state-title">Nobody is waiting</div>
            <div className="state-text">
              Check in a patient to start the queue for {date(dateKey, app.prefs)}.
            </div>
            {app.has('queue.manage') ? (
              <div className="state-actions">
                <Button variant="primary" icon="user-check" onClick={() => setCheckingIn(true)}>Check in patient</Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="queue-grid">
          {columns.map((id) => {
            const rows = byDentist.get(id) ?? [];
            const dentist = dentists.data?.find((d) => d.id === id);
            return (
              <section className="card queue-column" key={id ?? 'unassigned'}>
                <header className="card-head">
                  <div style={{ minWidth: 0 }}>
                    <h2 className="card-title">
                      <Icon name="stethoscope" size={16} />
                      <span className="truncate">{dentist?.full_name ?? 'Unassigned chair'}</span>
                    </h2>
                    <div className="card-subtitle">
                      {rows.filter((r) => r.status !== 'completed').length} active · {rows.length} total
                    </div>
                  </div>
                </header>
                <div className="card-body stack stack-2">
                  {rows.length === 0 ? (
                    <p className="text-sm text-3">No patients in this chair.</p>
                  ) : (
                    rows.map((row) => {
                      const action = nextAction(row);
                      return (
                        <article
                          className="queue-card"
                          key={row.id}
                          data-status={row.status}
                          data-priority={row.priority}
                        >
                          <div className="queue-card-head">
                            <span className="queue-no">{row.queue_no === 0 ? 'U' : row.queue_no}</span>
                            <button
                              type="button"
                              className="queue-patient"
                              onClick={() => route.navigate(`patients/${row.patient_id}`)}
                            >
                              <span className="truncate">{row.patient_name}</span>
                              <span className="text-xs text-3 mono">
                                {row.patient_code} · {age(row, app.prefs)}
                              </span>
                            </button>
                            <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
                          </div>

                          <div className="queue-card-meta">
                            {row.appointment_type ? (
                              <span><Icon name="stethoscope" size={12} /> {row.appointment_type}</span>
                            ) : null}
                            {row.start_time ? (
                              <span><Icon name="clock" size={12} /> {time(row.start_time, app.prefs)}</span>
                            ) : null}
                            {row.arrived_at ? (
                              <span title={row.arrived_at}><Icon name="check" size={12} /> arrived {relativeTime(row.arrived_at)}</span>
                            ) : null}
                            {row.priority === 'urgent' ? (
                              <span className="text-warn"><Icon name="alert-triangle" size={12} /> urgent</span>
                            ) : null}
                          </div>

                          {row.note ? <p className="queue-note">{row.note}</p> : null}

                          {app.has('queue.manage') && row.status !== 'completed' ? (
                            <div className="row row-2" style={{ marginTop: 8 }}>
                              {action ? (
                                <Button
                                  size="sm"
                                  variant={action.status === 'in_progress' ? 'primary' : 'default'}
                                  icon={action.icon}
                                  onClick={() => void updateStatus(row, action.status)}
                                >
                                  {action.label}
                                </Button>
                              ) : null}
                              {row.status === 'in_progress' && row.visit_id ? (
                                <Button
                                  size="sm"
                                  variant="soft"
                                  icon="file-text"
                                  onClick={() => route.navigate(`patients/${row.patient_id}/visits`)}
                                >
                                  Open visit
                                </Button>
                              ) : null}
                              {row.status === 'waiting' ? (
                                <Button size="sm" variant="ghost" icon="arrow-right" onClick={() => void updateStatus(row, 'skipped')}>
                                  Skip
                                </Button>
                              ) : null}
                              {row.status !== 'in_progress' ? (
                                <Button size="sm" variant="ghost" icon="trash" onClick={() => void remove(row)}>
                                  Remove
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <CheckInModal
        open={checkingIn}
        dentists={dentists.data ?? []}
        date={dateKey}
        onClose={() => setCheckingIn(false)}
        onSaved={() => {
          setCheckingIn(false);
          board.reload();
          shell.requestRefresh();
        }}
      />
    </>
  );
}

function CheckInModal({
  open, dentists, date, onClose, onSaved,
}: {
  open: boolean;
  dentists: DentistRow[];
  date: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const [patientId, setPatientId] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPatientId(null);
    setLabel('');
    setDentistId(dentists[0] ? String(dentists[0].id) : '');
    setPriority('normal');
    setNote('');
    setError('');
  }, [open, dentists]);

  const submit = async () => {
    if (!patientId) {
      setError('Select a patient first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await call('queue.checkIn', {
        patientId,
        dentistId: dentistId ? Number(dentistId) : undefined,
        priority,
        note: note.trim(),
        date,
      });
      toast.success('Patient checked in', 'They appear on the queue board now.');
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'Check-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Check in a patient"
      subtitle={`Adds the patient to the queue for ${date}`}
      onClose={onClose}
      width={560}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="user-check" loading={busy} onClick={() => void submit()}>Check in</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Field label="Patient" required>
          <PatientPicker
            value={patientId}
            label={label}
            autoFocus
            onChange={(id, nextLabel) => {
              setPatientId(id);
              setLabel(nextLabel);
            }}
          />
        </Field>
        <div className="grid grid-2">
          <Select
            label="Chair / dentist"
            value={dentistId}
            onChange={(event) => setDentistId(event.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...dentists.map((d) => ({ value: String(d.id), label: d.full_name })),
            ]}
          />
          <Field label="Priority">
            <Checkbox
              label="Urgent — move to the front"
              checked={priority === 'urgent'}
              onChange={(event) => setPriority(event.target.checked ? 'urgent' : 'normal')}
            />
          </Field>
        </div>
        <TextInput
          label="Note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. In pain, can only stay 20 minutes"
        />
      </div>
    </Modal>
  );
}
