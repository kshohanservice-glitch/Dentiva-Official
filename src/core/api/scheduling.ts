import { nowIso } from '../db/connection';
import { fieldError, notFound, conflict, businessRule } from '../errors';
import { Validator } from '../validation/validate';
import { toLocalDateKey, addMinutes, minutesBetween } from '../money/format';
import { paginate, readPaging } from './patients';
import type { ApiSpec } from '../registry';
import type { Container } from '../container';
import type { Actor } from '../security/rbac';

const APPT_STATUSES = [
  'scheduled', 'confirmed', 'arrived', 'in_queue', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled',
] as const;
const APPT_TYPES = ['consultation', 'follow-up', 'treatment', 'scaling', 'extraction', 'root-canal', 'orthodontic', 'check-up', 'emergency', 'other'] as const;

const OPEN_STATUSES = ['scheduled', 'confirmed'] as const;

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function toTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Detects an overlapping booking for the same dentist (and same patient). */
function findConflict(
  c: Container,
  dentistId: number | null,
  dateKey: string,
  startTime: string,
  duration: number,
  excludeId?: number,
): Record<string, unknown> | null {
  const end = minutesOf(startTime) + duration;
  const rows = c.db.all<{ id: number; start_time: string; duration_minutes: number; patient_name: string; status: string }>(
    `SELECT a.id, a.start_time, a.duration_minutes, pt.full_name AS patient_name, a.status
       FROM appointments a JOIN patients pt ON pt.id = a.patient_id
      WHERE a.appointment_date = ? AND a.deleted_at IS NULL AND a.status NOT IN ('cancelled','no_show')
        AND (? IS NULL OR a.dentist_id = ?) AND a.id <> COALESCE(?, -1)`,
    [dateKey, dentistId, dentistId, excludeId ?? null],
  );
  for (const row of rows) {
    const s = minutesOf(String(row.start_time));
    const e = s + Number(row.duration_minutes);
    if (s < end && minutesOf(startTime) < e) return row;
  }
  return null;
}

export const schedulingApi: ApiSpec = {
  appointments: {
    list: {
      perms: ['appointments.view'],
      label: 'List appointments',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const from = v.optionalString('from', 10) ?? toLocalDateKey(new Date());
        const to = v.optionalString('to', 10) ?? from;
        const dentistId = v.optionalInt('dentistId');
        const status = v.enum('status', ['', ...APPT_STATUSES] as const);
        const search = v.string('search', { max: 120 });
        const { page, pageSize, offset } = readPaging(input, { pageSize: 50, maxPageSize: 500 });
        const where = ['a.deleted_at IS NULL', 'a.appointment_date BETWEEN ? AND ?'];
        const params: (string | number)[] = [from, to];
        if (dentistId) { where.push('a.dentist_id = ?'); params.push(dentistId); }
        if (status) { where.push('a.status = ?'); params.push(status); }
        if (search) {
          where.push('(pt.full_name LIKE ? COLLATE NOCASE OR pt.patient_code LIKE ? COLLATE NOCASE OR pt.phone LIKE ?)');
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        const whereSql = where.join(' AND ');
        const total = c.db.count(
          `SELECT COUNT(*) AS n FROM appointments a JOIN patients pt ON pt.id = a.patient_id WHERE ${whereSql}`,
          params,
        );
        const rows = c.db.all(
          `SELECT a.*, pt.full_name AS patient_name, pt.patient_code, pt.phone, d.full_name AS dentist_name
             FROM appointments a JOIN patients pt ON pt.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
            WHERE ${whereSql} ORDER BY a.appointment_date, a.start_time, a.id LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    day: {
      perms: ['appointments.view'],
      label: 'Day view',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const date = v.dateKey('date', { label: 'Date' }) || toLocalDateKey(new Date());
        const dentistId = v.optionalInt('dentistId');
        const params: (string | number)[] = [date];
        let dentistFilter = '';
        if (dentistId) { dentistFilter = ' AND a.dentist_id = ?'; params.push(dentistId); }
        const rows = c.db.all(
          `SELECT a.*, pt.full_name AS patient_name, pt.patient_code, pt.phone, d.full_name AS dentist_name,
                  (SELECT q.id FROM queue_entries q WHERE q.appointment_id = a.id AND q.status NOT IN ('cancelled','completed') ORDER BY q.id DESC LIMIT 1) AS queue_entry_id
             FROM appointments a JOIN patients pt ON pt.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
            WHERE a.appointment_date = ? AND a.deleted_at IS NULL${dentistFilter}
            ORDER BY a.start_time, a.id`,
          params,
        );
        const summary = c.db.get<Record<string, number>>(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
             SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) AS no_show,
             SUM(CASE WHEN a.status IN ('scheduled','confirmed') THEN 1 ELSE 0 END) AS pending
           FROM appointments a WHERE a.appointment_date = ? AND a.deleted_at IS NULL${dentistFilter}`,
          params,
        );
        return { date, rows, summary: summary ?? { total: 0 } };
      },
    },
    week: {
      perms: ['appointments.view'],
      label: 'Week view',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const anchor = v.dateKey('date', { label: 'Date' }) || toLocalDateKey(new Date());
        const start = new Date(`${anchor}T00:00:00`);
        const dow = start.getDay();
        start.setDate(start.getDate() - dow);
        const days: { date: string; count: number; rows: Record<string, unknown>[] }[] = [];
        const dentistId = v.optionalInt('dentistId');
        for (let i = 0; i < 7; i += 1) {
          const d = new Date(start);
          d.setDate(d.getDate() + i);
          const key = toLocalDateKey(d);
          const params: (string | number)[] = [key];
          let filter = '';
          if (dentistId) { filter = ' AND a.dentist_id = ?'; params.push(dentistId); }
          const rows = c.db.all(
            `SELECT a.*, pt.full_name AS patient_name, pt.patient_code, d.full_name AS dentist_name
               FROM appointments a JOIN patients pt ON pt.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
              WHERE a.appointment_date = ? AND a.deleted_at IS NULL${filter} ORDER BY a.start_time, a.id`,
            params,
          );
          days.push({ date: key, count: rows.length, rows });
        }
        return { start: toLocalDateKey(start), days };
      },
    },
    month: {
      perms: ['appointments.view'],
      label: 'Month view',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const anchor = v.dateKey('date', { label: 'Date' }) || toLocalDateKey(new Date());
        const base = new Date(`${anchor}T00:00:00`);
        const first = new Date(base.getFullYear(), base.getMonth(), 1);
        const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
        const rows = c.db.all(
          `SELECT a.appointment_date AS date, COUNT(*) AS count FROM appointments a
            WHERE a.appointment_date BETWEEN ? AND ? AND a.deleted_at IS NULL
              AND a.status NOT IN ('cancelled')
            GROUP BY a.appointment_date ORDER BY a.appointment_date`,
          [toLocalDateKey(first), toLocalDateKey(last)],
        );
        return { month: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`, days: rows };
      },
    },
    conflicts: {
      perms: ['appointments.view'],
      label: 'Check appointment conflicts',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const dentistId = v.optionalInt('dentistId');
        const date = v.dateKey('dateKey', { required: true, label: 'Date' });
        const startTime = v.timeKey('startTime', { required: true, label: 'Start time' });
        const duration = v.int('durationMinutes', { min: 5, max: 600 });
        const excludeId = v.optionalInt('excludeId');
        v.throwIfInvalid();
        return findConflict(c, dentistId, date, startTime, duration, excludeId ?? undefined);
      },
    },
    create: {
      perms: ['appointments.manage'],
      label: 'Create appointment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const dentistId = v.optionalInt('dentistId', { min: 1 });
        const appointmentDate = v.dateKey('appointmentDate', { required: true, label: 'Appointment date' });
        const startTime = v.timeKey('startTime', { required: true, label: 'Start time' });
        const duration = v.int('durationMinutes', { min: 5, max: 600 });
        const type = v.enum('appointmentType', APPT_TYPES);
        const notes = v.string('notes', { max: 1000 });
        const status = v.enum('status', APPT_STATUSES);
        const force = v.bool('force');
        v.throwIfInvalid('Please correct the highlighted fields.');

        if (!c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId])) throw notFound('Patient');
        if (dentistId && !c.db.get('SELECT id FROM dentists WHERE id = ?', [dentistId])) throw notFound('Dentist');
        if (c.db.get('SELECT id FROM holidays WHERE date_key = ?', [appointmentDate])) {
          throw businessRule('The clinic is marked closed on this date. Choose another date or remove the holiday.');
        }
        if (!force) {
          const clash = findConflict(c, dentistId || null, appointmentDate, startTime, duration);
          if (clash) {
            throw fieldError(
              [{ field: 'startTime', message: `This slot overlaps an existing appointment for ${clash.patient_name} at ${clash.start_time}.` }],
              `This slot overlaps an existing appointment for ${clash.patient_name} at ${clash.start_time}.`,
            );
          }
        }
        const id = c.db.transaction(() => {
          const now = nowIso();
          const newId = c.db.insert(
            `INSERT INTO appointments (patient_id, dentist_id, appointment_date, start_time, duration_minutes, appointment_type, notes, status, created_at, created_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [patientId, dentistId, appointmentDate, startTime, duration, type, notes, status, now, actor?.userId ?? null, now],
          );
          c.audit(actor, { action: 'appointments.create', entity: 'appointment', entityId: newId, summary: `Appointment on ${appointmentDate} ${startTime}` });
          return newId;
        });
        return c.db.get('SELECT * FROM appointments WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['appointments.manage'],
      label: 'Update appointment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const existing = c.db.get<{ status: string }>('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL', [id]);
        if (!existing) throw notFound('Appointment');
        const dentistId = v.optionalInt('dentistId', { min: 1 });
        const appointmentDate = v.dateKey('appointmentDate', { required: true, label: 'Appointment date' });
        const startTime = v.timeKey('startTime', { required: true, label: 'Start time' });
        const duration = v.int('durationMinutes', { min: 5, max: 600 });
        const type = v.enum('appointmentType', APPT_TYPES);
        const notes = v.string('notes', { max: 1000 });
        const status = v.enum('status', APPT_STATUSES);
        const force = v.bool('force');
        v.throwIfInvalid();
        if (!force && OPEN_STATUSES.includes(status as (typeof OPEN_STATUSES)[number])) {
          const clash = findConflict(c, dentistId || null, appointmentDate, startTime, duration, id);
          if (clash) {
            throw fieldError(
              [{ field: 'startTime', message: `This slot overlaps an existing appointment for ${clash.patient_name} at ${clash.start_time}.` }],
              `This slot overlaps an existing appointment for ${clash.patient_name} at ${clash.start_time}.`,
            );
          }
        }
        c.db.run(
          `UPDATE appointments SET dentist_id = ?, appointment_date = ?, start_time = ?, duration_minutes = ?,
             appointment_type = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?`,
          [dentistId, appointmentDate, startTime, duration, type, notes, status, nowIso(), id],
        );
        c.audit(actor, { action: 'appointments.update', entity: 'appointment', entityId: id, summary: `Appointment #${id} updated (${status})` });
        return c.db.get('SELECT * FROM appointments WHERE id = ?', [id]);
      },
    },
    setStatus: {
      perms: ['appointments.manage'],
      label: 'Change appointment status',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const status = v.enum('status', APPT_STATUSES, { required: true });
        v.throwIfInvalid();
        const row = c.db.get<{ appointment_date: string; start_time: string; status: string; visit_id: number | null }>(
          'SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!row) throw notFound('Appointment');
        if (row.status === status) return c.db.get('SELECT * FROM appointments WHERE id = ?', [id]);
        if (row.status === 'completed' && status !== 'rescheduled') {
          throw conflict('A completed appointment cannot be moved to another status.');
        }
        c.db.run('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), id]);
        if (status === 'cancelled' || status === 'no_show') {
          c.db.run("UPDATE queue_entries SET status = 'cancelled', updated_at = ? WHERE appointment_id = ? AND status NOT IN ('completed','cancelled')", [nowIso(), id]);
        }
        c.audit(actor, { action: 'appointments.status', entity: 'appointment', entityId: id, summary: `Appointment #${id} → ${status}` });
        return c.db.get('SELECT * FROM appointments WHERE id = ?', [id]);
      },
    },
    reschedule: {
      perms: ['appointments.manage'],
      label: 'Reschedule appointment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const appointmentDate = v.dateKey('appointmentDate', { required: true, label: 'New date' });
        const startTime = v.timeKey('startTime', { required: true, label: 'New time' });
        const force = v.bool('force');
        v.throwIfInvalid();
        const existing = c.db.get<{ dentist_id: number | null; duration_minutes: number; status: string; patient_id: number }>(
          'SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!existing) throw notFound('Appointment');
        if (existing.status === 'completed') throw conflict('A completed appointment cannot be rescheduled.');
        if (!force) {
          const clash = findConflict(c, existing.dentist_id, appointmentDate, startTime, Number(existing.duration_minutes), id);
          if (clash) {
            throw fieldError([{ field: 'startTime', message: `This slot overlaps an appointment for ${clash.patient_name} at ${clash.start_time}.` }]);
          }
        }
        c.db.run("UPDATE appointments SET status = 'rescheduled', updated_at = ? WHERE id = ?", [nowIso(), id]);
        const newId = c.db.insert(
          `INSERT INTO appointments (patient_id, dentist_id, appointment_date, start_time, duration_minutes, appointment_type, notes, status, previous_appointment_id, created_at, created_by, updated_at)
           SELECT patient_id, dentist_id, ?, ?, duration_minutes, appointment_type, ?, 'scheduled', id, ?, ?, ? FROM appointments WHERE id = ?`,
          [appointmentDate, startTime, nowIso(), nowIso(), actor?.userId ?? null, nowIso(), id],
        );
        c.audit(actor, { action: 'appointments.reschedule', entity: 'appointment', entityId: id, summary: `Appointment #${id} rescheduled to ${appointmentDate} ${startTime}` });
        return c.db.get('SELECT * FROM appointments WHERE id = ?', [newId]);
      },
    },
    convertToVisit: {
      perms: ['clinical.create', 'appointments.manage'],
      label: 'Convert appointment to visit',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const chiefComplaint = v.string('chiefComplaint', { max: 1000 });
        const diagnosis = v.string('diagnosis', { max: 2000 });
        v.throwIfInvalid();
        const appt = c.db.get<{ patient_id: number; dentist_id: number | null; appointment_date: string; status: string; visit_id: number | null }>(
          'SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!appt) throw notFound('Appointment');
        if (appt.visit_id) return c.db.get('SELECT * FROM visits WHERE id = ?', [appt.visit_id]);
        if (appt.status === 'cancelled') throw conflict('A cancelled appointment cannot be converted into a visit.');

        return c.db.transaction(() => {
          const now = nowIso();
          const visitId = c.db.insert(
            `INSERT INTO visits (patient_id, dentist_id, appointment_id, visit_date, started_at, chief_complaint, diagnosis, status, created_at, created_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
            [appt.patient_id, appt.dentist_id, id, appt.appointment_date, now, chiefComplaint, diagnosis, now, actor?.userId ?? null, now],
          );
          c.db.run("UPDATE appointments SET status = 'in_progress', visit_id = ?, updated_at = ? WHERE id = ?", [visitId, now, id]);
          c.db.run("UPDATE queue_entries SET status = 'in_progress', visit_id = ? WHERE id = (SELECT id FROM queue_entries WHERE appointment_id = ? LIMIT 1)", [visitId, id]);
          c.db.run('UPDATE patients SET last_visit_at = ?, updated_at = ? WHERE id = ?', [appt.appointment_date, now, appt.patient_id]);
          c.audit(actor, { action: 'clinical.visit.from_appointment', entity: 'visit', entityId: visitId, summary: `Visit created from appointment #${id}` });
          return c.db.get('SELECT * FROM visits WHERE id = ?', [visitId]);
        });
      },
    },
    delete: {
      perms: ['appointments.manage'],
      label: 'Delete appointment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        if (c.db.get('SELECT id FROM visits WHERE appointment_id = ?', [id])) {
          throw businessRule('A visit has been created from this appointment. Complete or archive the visit first.');
        }
        c.db.run('UPDATE appointments SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id]);
        c.audit(actor, { action: 'appointments.delete', entity: 'appointment', entityId: id, summary: `Appointment #${id} deleted` });
        return { ok: true };
      },
    },
  },

  queue: {
    board: {
      perms: ['queue.view'],
      label: 'Queue board',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const date = v.dateKey('date', { label: 'Date' }) || toLocalDateKey(new Date());
        const dentistId = v.optionalInt('dentistId');
        const params: (string | number)[] = [date];
        let filter = '';
        if (dentistId) { filter = ' AND q.dentist_id = ?'; params.push(dentistId); }
        const rows = c.db.all(
          `SELECT q.*, p.full_name AS patient_name, p.patient_code, p.phone, p.age_years, p.age_months, p.date_of_birth,
                  d.full_name AS dentist_name,
                  a.appointment_type, a.start_time
             FROM queue_entries q JOIN patients p ON p.id = q.patient_id
             LEFT JOIN dentists d ON d.id = q.dentist_id LEFT JOIN appointments a ON a.id = q.appointment_id
            WHERE q.queue_date = ? AND q.status NOT IN ('cancelled')${filter}
            ORDER BY q.dentist_id, q.queue_no`,
          params,
        );
        const summary = c.db.get<Record<string, number>>(
          `SELECT SUM(CASE WHEN q.status IN ('waiting', 'called') THEN 1 ELSE 0 END) AS waiting,
                  SUM(CASE WHEN q.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
                  SUM(CASE WHEN q.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                  COUNT(*) AS total
             FROM queue_entries q WHERE q.queue_date = ?${filter}`,
          params,
        );
        return { date, rows, summary: summary ?? { waiting: 0, in_progress: 0, completed: 0, total: 0 } };
      },
    },
    checkIn: {
      perms: ['queue.manage'],
      label: 'Check a patient in',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const dentistId = v.int('dentistId', { required: true, min: 1 });
        const appointmentId = v.optionalInt('appointmentId');
        const priority = v.enum('priority', ['normal', 'urgent'] as const);
        const note = v.string('note', { max: 500 });
        const date = v.dateKey('date', { label: 'Date' }) || toLocalDateKey(new Date());
        v.throwIfInvalid();

        if (!c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId])) throw notFound('Patient');
        if (!c.db.get('SELECT id FROM dentists WHERE id = ?', [dentistId])) throw notFound('Dentist');
        const existing = c.db.get<{ id: number }>(
          "SELECT id FROM queue_entries WHERE patient_id = ? AND queue_date = ? AND status NOT IN ('cancelled','completed')",
          [patientId, date],
        );
        if (existing) throw conflict('This patient is already in the queue for today.');

        const id = c.db.transaction(() => {
          const maxRow = c.db.get<{ m: number }>(
            'SELECT COALESCE(MAX(queue_no), 0) AS m FROM queue_entries WHERE queue_date = ? AND dentist_id = ?',
            [date, dentistId],
          );
          const queueNo = priority === 'urgent' ? 0 : Number(maxRow?.m ?? 0) + 1;
          const now = nowIso();
          const newId = c.db.insert(
            `INSERT INTO queue_entries (patient_id, dentist_id, appointment_id, queue_no, queue_date, arrived_at, status, priority, note, created_at, created_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?)`,
            [patientId, dentistId, appointmentId, queueNo, date, now, priority, note, now, actor?.userId ?? null, now],
          );
          if (queueNo === 0) renumberUrgent(c, date, dentistId);
          if (appointmentId) {
            c.db.run("UPDATE appointments SET status = 'in_queue', updated_at = ? WHERE id = ?", [now, appointmentId]);
          }
          c.audit(actor, { action: 'queue.checkin', entity: 'queue_entry', entityId: newId, summary: `Patient #${patientId} checked in for ${date}` });
          return newId;
        });
        return c.db.get('SELECT * FROM queue_entries WHERE id = ?', [id]);
      },
    },
    updateStatus: {
      perms: ['queue.manage'],
      label: 'Change queue entry status',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const status = v.enum('status', ['waiting', 'called', 'in_progress', 'completed', 'skipped', 'cancelled'] as const, { required: true });
        v.throwIfInvalid();
        const entry = c.db.get<{ queue_date: string; dentist_id: number | null; patient_id: number; status: string }>(
          'SELECT * FROM queue_entries WHERE id = ?',
          [id],
        );
        if (!entry) throw notFound('Queue entry');
        if (entry.status === 'completed' && status !== 'completed') {
          throw conflict('A completed queue entry cannot be reopened. Create a new visit instead.');
        }
        const now = nowIso();
        c.db.transaction(() => {
          c.db.run(
            'UPDATE queue_entries SET status = ?, called_at = CASE WHEN ? = 1 THEN COALESCE(called_at, ?) ELSE called_at END, started_at = CASE WHEN ? = 1 THEN COALESCE(started_at, ?) ELSE started_at END, completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END, updated_at = ? WHERE id = ?',
            [status, status === 'called' ? 1 : 0, now, status === 'in_progress' ? 1 : 0, now, status === 'completed' ? 1 : 0, now, now, id],
          );
          if (status === 'in_progress' || status === 'completed') {
            const startedAt = status === 'completed' ? now : now;
            const visitId = c.db.insert(
              `INSERT INTO visits (patient_id, dentist_id, queue_entry_id, visit_date, started_at, chief_complaint, status, created_at, created_by, updated_at)
               VALUES (?, ?, ?, ?, ?, '', 'open', ?, ?, ?)`,
              [entry.patient_id, entry.dentist_id, id, entry.queue_date, startedAt, now, actor?.userId ?? null, now],
            );
            c.db.run("UPDATE queue_entries SET visit_id = ? WHERE id = ?", [visitId, id]);
            c.db.run('UPDATE patients SET last_visit_at = ?, updated_at = ? WHERE id = ?', [entry.queue_date, now, entry.patient_id]);
            c.audit(actor, { action: 'queue.start_visit', entity: 'visit', entityId: visitId, summary: `Visit started from queue entry #${id}` });
          }
        });
        c.audit(actor, { action: 'queue.status', entity: 'queue_entry', entityId: id, summary: `Queue entry #${id} → ${status}` });
        return c.db.get('SELECT * FROM queue_entries WHERE id = ?', [id]);
      },
    },
    reorder: {
      perms: ['queue.manage'],
      label: 'Reorder the queue',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const dentistId = v.int('dentistId', { required: true, min: 1 });
        const date = v.dateKey('date', { label: 'Date' }) || toLocalDateKey(new Date());
        const order = v.array('order', (x) => v.int('order[]', { min: 1 }) || Number(x), { required: true, minItems: 1, maxItems: 500 });
        const rawOrder = Array.isArray((input as Record<string, unknown>)?.order) ? ((input as Record<string, unknown>).order as unknown[]) : [];
        const ids = rawOrder.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
        v.throwIfInvalid();
        if (!ids.length) throw fieldError([{ field: 'order', message: 'No queue entries were supplied.' }]);
        void order;
        c.db.transaction(() => {
          ids.forEach((entryId, index) => {
            c.db.run(
              "UPDATE queue_entries SET queue_no = ?, updated_at = ? WHERE id = ? AND queue_date = ? AND dentist_id = ?",
              [index + 1, nowIso(), entryId, date, dentistId],
            );
          });
        });
        c.audit(actor, { action: 'queue.reorder', entity: 'queue', entityId: dentistId, summary: `Queue reordered for ${date}` });
        return { ok: true };
      },
    },
    remove: {
      perms: ['queue.manage'],
      label: 'Remove queue entry',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const row = c.db.get<{ visit_id: number | null }>('SELECT * FROM queue_entries WHERE id = ?', [id]);
        if (!row) throw notFound('Queue entry');
        if (row.visit_id) throw businessRule('A visit has been started from this queue entry and cannot be removed.');
        c.db.run("UPDATE queue_entries SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowIso(), id]);
        c.audit(actor, { action: 'queue.remove', entity: 'queue_entry', entityId: id, summary: `Queue entry #${id} cancelled` });
        return { ok: true };
      },
    },
  },
};

function renumberUrgent(c: Container, date: string, dentistId: number): void {
  const rows = c.db.all<{ id: number; priority: string }>(
    "SELECT id, priority FROM queue_entries WHERE queue_date = ? AND dentist_id = ? AND status NOT IN ('cancelled') ORDER BY queue_no, id",
    [date, dentistId],
  );
  let urgent = 0;
  let normal = 0;
  for (const row of rows) {
    const next = row.priority === 'urgent' ? urgent++ : ++normal;
    c.db.run('UPDATE queue_entries SET queue_no = ? WHERE id = ?', [next, row.id]);
  }
}

export { findConflict, toTime, minutesOf };
export type { Actor };
export { addMinutes, minutesBetween };
