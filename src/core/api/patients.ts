import { nowIso } from '../db/connection';
import { Container } from '../container';
import { fieldError, notFound, conflict, businessRule } from '../errors';
import { Validator } from '../validation/validate';
import { toLocalDateKey } from '../money/format';
import { writeAudit } from '../audit/audit';
import type { ApiSpec, OpContext } from '../registry';
import type { Actor } from '../security/rbac';

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function paginate<T>(rows: T[], total: number, page: number, pageSize: number): Page<T> {
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function readPaging(input: unknown, defaults: { pageSize?: number; maxPageSize?: number } = {}): { page: number; pageSize: number; offset: number } {
  const v = new Validator(input);
  const page = Math.max(1, v.int('page', { min: 1, max: 100000, label: 'Page' }) || 1);
  const pageSize = Math.min(
    defaults.maxPageSize ?? 200,
    Math.max(5, v.int('pageSize', { min: 5, max: defaults.maxPageSize ?? 200, label: 'Page size' }) || defaults.pageSize || 25),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function dateRangeFrom(input: unknown): { from: string | null; to: string | null } {
  const body = (input ?? {}) as Record<string, unknown>;
  const preset = typeof body.range === 'string' ? body.range : 'all';
  const today = toLocalDateKey(new Date());
  const shift = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return toLocalDateKey(d);
  };
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: shift(6), to: today };
    case '30d':
      return { from: shift(29), to: today };
    case '90d':
      return { from: shift(89), to: today };
    case '1y':
      return { from: shift(364), to: today };
    case 'custom':
      return {
        from: typeof body.from === 'string' && body.from ? body.from : null,
        to: typeof body.to === 'string' && body.to ? body.to : null,
      };
    default:
      return { from: null, to: null };
  }
}

export const RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: '1y', label: 'Last year' },
  { id: 'custom', label: 'Custom range' },
  { id: 'all', label: 'All time' },
];

function patientCodeExists(c: Container, code: string, exceptId?: number): boolean {
  const row = c.db.get<{ id: number }>('SELECT id FROM patients WHERE patient_code = ? AND id <> ?', [code, exceptId ?? -1]);
  return Boolean(row);
}

const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const;
const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const STATUSES = ['active', 'inactive', 'archived', 'deceased'] as const;

export const patientsApi: ApiSpec = {
  patients: {
    list: {
      perms: ['patients.view'],
      label: 'List patients',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        const status = v.enum('status', ['', 'active', 'inactive', 'archived', 'deceased'] as const);
        const sort = v.enum('sort', ['newest', 'oldest', 'name', 'code'] as const);
        const favouritesOnly = v.bool('favouritesOnly');
        const dentistId = v.optionalInt('dentistId');
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const { from, to } = dateRangeFrom(input);

        const where: string[] = ['p.deleted_at IS NULL'];
        const params: (string | number)[] = [];
        if (status) {
          where.push('p.status = ?');
          params.push(status);
        }
        if (favouritesOnly) where.push('p.is_favourite = 1');
        if (search) {
          where.push('p.search_blob LIKE ?');
          params.push(`%${Container.normaliseForSearch(search)}%`);
        }
        if (from) {
          where.push('date(p.created_at) >= ?');
          params.push(from);
        }
        if (to) {
          where.push('date(p.created_at) <= ?');
          params.push(to);
        }
        if (dentistId) {
          where.push('EXISTS (SELECT 1 FROM visits v WHERE v.patient_id = p.id AND v.dentist_id = ? AND v.deleted_at IS NULL)');
          params.push(dentistId);
        }
        const orderBy =
          sort === 'oldest' ? 'p.created_at ASC, p.id ASC'
          : sort === 'name' ? 'p.full_name COLLATE NOCASE ASC'
          : sort === 'code' ? 'p.patient_code ASC'
          : 'p.created_at DESC, p.id DESC';

        const whereSql = where.join(' AND ');
        const total = c.db.count(`SELECT COUNT(*) AS n FROM patients p WHERE ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT p.id, p.patient_code, p.full_name, p.gender, p.date_of_birth, p.age_years, p.age_months,
                  p.phone, p.alt_phone, p.status, p.is_favourite, p.created_at, p.last_visit_at,
                  p.blood_group, p.area, p.district, p.present_complaint, p.photo_attachment_id,
                  (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS visit_count,
                  f.total_billed_poisha, f.total_paid_poisha
             FROM patients p
             LEFT JOIN patient_financials f ON f.patient_id = p.id
            WHERE ${whereSql}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },

    countByStatus: {
      perms: ['patients.view'],
      label: 'Patient counts',
      handler: ({ c }) => c.db.all("SELECT status, COUNT(*) AS n FROM patients WHERE deleted_at IS NULL GROUP BY status"),
    },

    get: {
      perms: ['patients.view'],
      label: 'Read patient profile',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const patient = c.db.get('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL', [id]);
        if (!patient) throw notFound('Patient');
        const summary = c.db.get(
          `SELECT
             (SELECT COUNT(*) FROM visits v WHERE v.patient_id = ? AND v.deleted_at IS NULL) AS total_visits,
             (SELECT MAX(visit_date) FROM visits v WHERE v.patient_id = ? AND v.deleted_at IS NULL) AS last_visit,
             (SELECT COUNT(*) FROM prescriptions p WHERE p.patient_id = ? AND p.deleted_at IS NULL) AS total_prescriptions,
             (SELECT COUNT(*) FROM treatment_records t WHERE t.patient_id = ? AND t.status = 'done') AS total_treatments,
             (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = ? AND a.appointment_date >= date('now') AND a.deleted_at IS NULL AND a.status IN ('scheduled','confirmed','arrived','in_queue')) AS upcoming_appointments`,
          [id, id, id, id, id],
        );
        const nextAppointment = c.db.get(
          `SELECT a.id, a.appointment_date, a.start_time, a.status, d.full_name AS dentist_name
             FROM appointments a LEFT JOIN dentists d ON d.id = a.dentist_id
            WHERE a.patient_id = ? AND a.deleted_at IS NULL AND a.appointment_date >= date('now')
              AND a.status IN ('scheduled','confirmed')
            ORDER BY a.appointment_date, a.start_time LIMIT 1`,
          [id],
        );
        const finance = c.db.get<{ total_billed_poisha: number; total_paid_poisha: number }>(
          'SELECT * FROM patient_financials WHERE patient_id = ?',
          [id],
        );
        const billed = Number(finance?.total_billed_poisha ?? 0);
        const paid = Number(finance?.total_paid_poisha ?? 0);
        return {
          patient,
          summary: { ...(summary as Record<string, unknown>), nextAppointment: nextAppointment ?? null },
          financial: { totalBilledPoisha: billed, totalPaidPoisha: paid, outstandingPoisha: billed - paid },
        };
      },
    },

    create: {
      perms: ['patients.create'],
      label: 'Create patient',
      handler: (ctx, input: unknown) => {
        const v = new Validator(input);
        const fullName = v.string('fullName', { required: true, min: 2, max: 120, label: 'Full name' });
        const phone = v.phone('phone', { label: 'Phone' });
        const altPhone = v.phone('altPhone');
        const emergencyPhone = v.phone('emergencyPhone');
        const emergencyName = v.string('emergencyName', { max: 120 });
        const dateOfBirth = v.optionalString('dateOfBirth', 10);
        const ageYears = v.optionalInt('ageYears', { min: 0, max: 120 });
        const ageMonths = v.optionalInt('ageMonths', { min: 0, max: 11 });
        const gender = v.enum('gender', GENDERS);
        const bloodGroup = v.enum('bloodGroup', BLOOD_GROUPS);
        const address = v.string('address', { max: 300 });
        const area = v.string('area', { max: 100 });
        const district = v.string('district', { max: 100 });
        const thana = v.string('thana', { max: 100 });
        const postcode = v.string('postcode', { max: 20 });
        const presentComplaint = v.string('presentComplaint', { max: 1000 });
        const medicalHistory = v.string('medicalHistory', { max: 2000 });
        const dentalHistory = v.string('dentalHistory', { max: 2000 });
        const allergies = v.string('allergies', { max: 500 });
        const notes = v.string('notes', { max: 2000 });
        const requestedCode = v.string('patientCode', { max: 24 });
        v.throwIfInvalid('Please correct the highlighted fields.');

        if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
          throw fieldError([{ field: 'dateOfBirth', message: 'Date of birth must be a valid date.' }]);
        }
        if (dateOfBirth && new Date(`${dateOfBirth}T00:00:00`).getTime() > Date.now()) {
          throw fieldError([{ field: 'dateOfBirth', message: 'Date of birth cannot be in the future.' }]);
        }
        if (dateOfBirth && ageYears !== null) {
          throw fieldError([{ field: 'ageYears', message: 'Provide either a date of birth or an age, not both.' }]);
        }
        if (!dateOfBirth && ageYears === null && ageMonths === null) {
          throw fieldError([{ field: 'ageYears', message: 'Provide the patient age or date of birth.' }]);
        }

        return createPatientRecord(ctx.c, ctx.actor, {
          fullName, phone, altPhone, emergencyPhone, emergencyName, dateOfBirth: dateOfBirth || null,
          ageYears, ageMonths, gender, bloodGroup, address, area, district, thana, postcode,
          presentComplaint, medicalHistory, dentalHistory, allergies, notes, requestedCode: requestedCode || null,
        });
      },
    },

    update: {
      perms: ['patients.edit'],
      label: 'Update patient',
      handler: (ctx, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const existing = ctx.c.db.get<Record<string, unknown>>('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL', [id]);
        if (!existing) throw notFound('Patient');

        const fullName = v.string('fullName', { required: true, min: 2, max: 120, label: 'Full name' });
        const phone = v.phone('phone', { label: 'Phone' });
        const altPhone = v.phone('altPhone');
        const emergencyPhone = v.phone('emergencyPhone');
        const emergencyName = v.string('emergencyName', { max: 120 });
        const dateOfBirth = v.optionalString('dateOfBirth', 10);
        const ageYears = v.optionalInt('ageYears', { min: 0, max: 120 });
        const ageMonths = v.optionalInt('ageMonths', { min: 0, max: 11 });
        const gender = v.enum('gender', GENDERS);
        const bloodGroup = v.enum('bloodGroup', BLOOD_GROUPS);
        const address = v.string('address', { max: 300 });
        const area = v.string('area', { max: 100 });
        const district = v.string('district', { max: 100 });
        const thana = v.string('thana', { max: 100 });
        const postcode = v.string('postcode', { max: 20 });
        const presentComplaint = v.string('presentComplaint', { max: 1000 });
        const medicalHistory = v.string('medicalHistory', { max: 2000 });
        const dentalHistory = v.string('dentalHistory', { max: 2000 });
        const allergies = v.string('allergies', { max: 500 });
        const notes = v.string('notes', { max: 2000 });
        v.throwIfInvalid('Please correct the highlighted fields.');

        if (dateOfBirth && ageYears !== null) {
          throw fieldError([{ field: 'ageYears', message: 'Provide either a date of birth or an age, not both.' }]);
        }

        const code = fullName as string;
        const searchBlob = ctx.c.buildSearchBlob([
          String(existing.patient_code), fullName, phone, altPhone, emergencyPhone, address, area, district, thana,
        ]);
        ctx.c.db.run(
          `UPDATE patients SET full_name = ?, date_of_birth = ?, age_years = ?, age_months = ?, gender = ?, blood_group = ?,
             phone = ?, alt_phone = ?, emergency_name = ?, emergency_phone = ?, address = ?, area = ?, district = ?, thana = ?,
             postcode = ?, present_complaint = ?, medical_history = ?, dental_history = ?, allergies = ?, notes = ?,
             search_blob = ?, updated_at = ?, updated_by = ?
           WHERE id = ?`,
          [fullName, dateOfBirth || null, ageYears, ageMonths, gender, bloodGroup, phone, altPhone, emergencyName,
            emergencyPhone, address, area, district, thana, postcode, presentComplaint, medicalHistory, dentalHistory,
            allergies, notes, searchBlob, nowIso(), ctx.actor?.userId ?? null, id],
        );
        void code;
        ctx.c.audit(ctx.actor, { action: 'patients.update', entity: 'patient', entityId: id, summary: `Patient ${fullName} updated` });
        return ctx.c.db.get('SELECT * FROM patients WHERE id = ?', [id]);
      },
    },

    setStatus: {
      perms: ['patients.archive'],
      label: 'Archive or restore patient',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const status = v.enum('status', STATUSES, { required: true });
        v.throwIfInvalid();
        const patient = c.db.get<{ patient_code: string; full_name: string }>(
          'SELECT patient_code, full_name FROM patients WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!patient) throw notFound('Patient');
        if (status === 'archived') {
          const outstanding = patientOutstanding(c, id);
          if (outstanding > 0) {
            throw businessRule(
              `${patient.full_name} still has an outstanding balance of ৳${(outstanding / 100).toFixed(2)}. ` +
                'Settle the balance before archiving this record.',
            );
          }
        }
        c.db.run('UPDATE patients SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?', [status, nowIso(), actor?.userId ?? null, id]);
        c.audit(actor, { action: 'patients.status', entity: 'patient', entityId: id, summary: `Patient ${patient.patient_code} set to ${status}` });
        return c.db.get('SELECT * FROM patients WHERE id = ?', [id]);
      },
    },

    toggleFavourite: {
      perms: ['patients.view'],
      label: 'Pin or unpin patient',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        c.db.run('UPDATE patients SET is_favourite = CASE is_favourite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
        c.audit(actor, { action: 'patients.favourite', entity: 'patient', entityId: id, summary: 'Favourite toggled' });
        return c.db.get('SELECT is_favourite FROM patients WHERE id = ?', [id]);
      },
    },

    delete: {
      perms: ['patients.delete'],
      label: 'Delete patient',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const confirmCode = v.string('confirmPatientCode', { required: true, max: 24, label: 'Patient code confirmation' });
        v.throwIfInvalid('Type the patient code to confirm deletion.');

        const patient = c.db.get<{ patient_code: string; full_name: string }>(
          'SELECT patient_code, full_name FROM patients WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!patient) throw notFound('Patient');
        if (patient.patient_code !== confirmCode) {
          throw fieldError([{ field: 'confirmPatientCode', message: 'The patient code does not match.' }], 'The patient code does not match.');
        }

        const blockers: string[] = [];
        const visitCount = c.db.count('SELECT COUNT(*) AS n FROM visits WHERE patient_id = ?', [id]);
        if (visitCount) blockers.push(`${visitCount} visit record(s)`);
        const rxCount = c.db.count('SELECT COUNT(*) AS n FROM prescriptions WHERE patient_id = ?', [id]);
        if (rxCount) blockers.push(`${rxCount} prescription(s)`);
        const invCount = c.db.count('SELECT COUNT(*) AS n FROM invoices WHERE patient_id = ?', [id]);
        if (invCount) blockers.push(`${invCount} invoice(s)`);
        const payCount = c.db.count('SELECT COUNT(*) AS n FROM payments WHERE patient_id = ?', [id]);
        if (payCount) blockers.push(`${payCount} payment(s)`);
        const treatCount = c.db.count('SELECT COUNT(*) AS n FROM treatment_records WHERE patient_id = ?', [id]);
        if (treatCount) blockers.push(`${treatCount} treatment record(s)`);

        if (blockers.length) {
          throw businessRule(
            `${patient.full_name} cannot be deleted because the record contains ${blockers.join(', ')}. ` +
              'Archive the patient instead so the clinical history stays intact.',
          );
        }

        c.db.transaction(() => {
          c.db.run('DELETE FROM patient_notes WHERE patient_id = ?', [id]);
          c.db.run('DELETE FROM tooth_conditions WHERE patient_id = ?', [id]);
          c.db.run('DELETE FROM tooth_condition_history WHERE patient_id = ?', [id]);
          c.db.run('DELETE FROM referrals WHERE patient_id = ?', [id]);
          c.db.run('DELETE FROM appointments WHERE patient_id = ?', [id]);
          c.db.run('DELETE FROM queue_entries WHERE patient_id = ?', [id]);
          c.db.run('UPDATE patients SET deleted_at = ?, status = ? WHERE id = ?', [nowIso(), 'archived', id]);
          c.db.run('UPDATE patients SET deleted_at = ? WHERE id = ?', [nowIso(), id]);
        });
        c.audit(actor, {
          action: 'patients.delete', entity: 'patient', entityId: id,
          summary: `Patient ${patient.patient_code} (${patient.full_name}) permanently deleted`,
          metadata: { code: patient.patient_code },
        });
        return { ok: true };
      },
    },

    notes: {
      perms: ['clinical.view'],
      label: 'List patient notes',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        v.throwIfInvalid();
        return c.db.all(
          `SELECT n.*, u.display_name AS author
             FROM patient_notes n LEFT JOIN users u ON u.id = n.created_by
            WHERE n.patient_id = ? ORDER BY n.is_pinned DESC, n.created_at DESC`,
          [patientId],
        );
      },
    },
    addNote: {
      perms: ['clinical.create'],
      label: 'Add patient note',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const body = v.string('body', { required: true, max: 4000, label: 'Note' });
        const pinned = v.bool('isPinned');
        v.throwIfInvalid();
        const patient = c.db.get<{ full_name: string }>('SELECT full_name FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId]);
        if (!patient) throw notFound('Patient');
        const id = c.db.insert('INSERT INTO patient_notes (patient_id, body, is_pinned, created_at, created_by) VALUES (?, ?, ?, ?, ?)', [
          patientId, body, pinned ? 1 : 0, nowIso(), actor?.userId ?? null,
        ]);
        c.audit(actor, { action: 'patient.note.create', entity: 'patient_note', entityId: id, summary: `Note added for ${patient.full_name}` });
        return c.db.get('SELECT * FROM patient_notes WHERE id = ?', [id]);
      },
    },
    deleteNote: {
      perms: ['clinical.edit'],
      label: 'Delete patient note',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        c.db.run('DELETE FROM patient_notes WHERE id = ?', [id]);
        c.audit(actor, { action: 'patient.note.delete', entity: 'patient_note', entityId: id, summary: 'Note deleted' });
        return { ok: true };
      },
    },

    duplicateCheck: {
      perms: ['patients.view'],
      label: 'Check for possible duplicate patients',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const phone = v.string('phone', { max: 40 });
        const name = v.string('fullName', { max: 120 });
        v.throwIfInvalid();
        const results: Record<string, unknown>[] = [];
        if (phone) {
          const digits = phone.replace(/\D/g, '').slice(-7);
          if (digits.length >= 7) {
            results.push(
              ...c.db.all(
                `SELECT id, patient_code, full_name, phone, created_at FROM patients
                  WHERE deleted_at IS NULL AND replace(replace(phone,' ',''),'-','') LIKE ? LIMIT 5`,
                [`%${digits}`],
              ),
            );
          }
        }
        if (name && name.length >= 3) {
          results.push(
            ...c.db.all(
              `SELECT id, patient_code, full_name, phone, created_at FROM patients
                WHERE deleted_at IS NULL AND search_blob LIKE ? LIMIT 5`,
              [`%${Container.normaliseForSearch(name)}%`],
            ),
          );
        }
        const seen = new Set<number>();
        const unique = results.filter((r) => {
          const id = Number(r.id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        return unique;
      },
    },

    timeline: {
      perms: ['clinical.view'],
      label: 'Patient clinical timeline',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const filter = v.enum('filter', ['all', 'visits', 'prescriptions', 'invoices', 'payments', 'appointments', 'referrals', 'attachments', 'notes'] as const);
        const search = v.string('search', { max: 120 });
        v.throwIfInvalid();
        const limit = Math.min(500, v.int('limit', { min: 1, max: 500, label: 'Limit' }) || 200);
        const events: Record<string, unknown>[] = [];
        const like = `%${Container.normaliseForSearch(search)}%`;

        if (filter === 'all' || filter === 'visits') {
          for (const row of c.db.all(
            `SELECT v.id, v.visit_date, v.chief_complaint, v.diagnosis, v.treatment_plan, v.status, d.full_name AS dentist_name
               FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id
              WHERE v.patient_id = ? AND v.deleted_at IS NULL AND (? = 'all' OR ? = '') ORDER BY v.visit_date DESC, v.id DESC LIMIT ?`,
            [patientId, filter === 'all' ? '' : filter, search, limit],
          )) {
            if (search && !JSON.stringify(row).toLowerCase().includes(like.replace(/%/g, ''))) continue;
            events.push({ type: 'visit', at: row.visit_date, id: row.id, title: row.chief_complaint || 'Visit', detail: row.diagnosis, staff: row.dentist_name, status: row.status, route: `patients/${patientId}/visits/${row.id}` });
          }
        }
        if (filter === 'all' || filter === 'prescriptions') {
          for (const row of c.db.all(
            `SELECT p.id, p.issue_date, p.prescription_no, p.cc, p.advice, d.full_name AS dentist_name,
                    (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = p.id) AS item_count
               FROM prescriptions p LEFT JOIN dentists d ON d.id = p.dentist_id
              WHERE p.patient_id = ? AND p.deleted_at IS NULL AND (? = 'all' OR ? = '') ORDER BY p.issue_date DESC, p.id DESC LIMIT ?`,
            [patientId, filter === 'all' ? '' : filter, search, limit],
          )) {
            if (search && !JSON.stringify(row).toLowerCase().includes(like.replace(/%/g, ''))) continue;
            events.push({ type: 'prescription', at: row.issue_date, id: row.id, title: `Prescription ${row.prescription_no}`, detail: `${row.item_count} medicine(s)`, staff: row.dentist_name, route: `patients/${patientId}/prescriptions/${row.id}` });
          }
        }
        if (filter === 'all' || filter === 'invoices') {
          for (const row of c.db.all(
            `SELECT id, invoice_no, issue_date, grand_total_poisha, paid_poisha, status FROM invoices
              WHERE patient_id = ? AND deleted_at IS NULL AND (? = 'all' OR ? = '') ORDER BY issue_date DESC, id DESC LIMIT ?`,
            [patientId, filter === 'all' ? '' : filter, search, limit],
          )) {
            events.push({ type: 'invoice', at: row.issue_date, id: row.id, title: `Invoice ${row.invoice_no}`, detail: `৳${(Number(row.grand_total_poisha) / 100).toFixed(2)} · ${row.status}`, route: `billing/invoices/${row.id}` });
          }
        }
        if (filter === 'all' || filter === 'payments') {
          for (const row of c.db.all(
            `SELECT id, payment_no, payment_date, amount_poisha, method, type FROM payments
              WHERE patient_id = ? AND deleted_at IS NULL AND (? = 'all' OR ? = '') ORDER BY payment_date DESC, id DESC LIMIT ?`,
            [patientId, filter === 'all' ? '' : filter, search, limit],
          )) {
            events.push({ type: 'payment', at: row.payment_date, id: row.id, title: `${row.type === 'refund' ? 'Refund' : 'Payment'} ${row.payment_no}`, detail: `${String(row.method).toUpperCase()} · ৳${(Number(row.amount_poisha) / 100).toFixed(2)}`, route: `billing/payments/${row.id}` });
          }
        }
        if (filter === 'all' || filter === 'appointments') {
          for (const row of c.db.all(
            `SELECT a.id, a.appointment_date, a.start_time, a.status, a.appointment_type, d.full_name AS dentist_name
               FROM appointments a LEFT JOIN dentists d ON d.id = a.dentist_id
              WHERE a.patient_id = ? AND a.deleted_at IS NULL AND (? = 'all' OR ? = '') ORDER BY a.appointment_date DESC, a.id DESC LIMIT ?`,
            [patientId, filter === 'all' ? '' : filter, search, limit],
          )) {
            events.push({ type: 'appointment', at: row.appointment_date, id: row.id, title: `${row.appointment_type} at ${row.start_time}`, detail: row.status, staff: row.dentist_name, route: `appointments?highlight=${row.id}` });
          }
        }
        if (filter === 'all' || filter === 'referrals') {
          for (const row of c.db.all(
            `SELECT r.id, r.refer_date, r.reason, r.to_clinic, r.status, df.full_name AS from_name, dt.full_name AS to_name
               FROM referrals r LEFT JOIN dentists df ON df.id = r.from_dentist_id LEFT JOIN dentists dt ON dt.id = r.to_dentist_id
              WHERE r.patient_id = ? AND (? = 'all' OR ? = '') ORDER BY r.refer_date DESC LIMIT ?`,
            [patientId, filter === 'all' ? '' : filter, search, limit],
          )) {
            events.push({ type: 'referral', at: row.refer_date, id: row.id, title: `Referral — ${row.to_clinic || row.to_name || 'external'}`, detail: row.reason, staff: row.from_name, route: `patients/${patientId}/referrals` });
          }
        }
        if (filter === 'all' || filter === 'notes') {
          for (const row of c.db.all(
            `SELECT n.id, n.created_at, n.body, u.display_name AS author FROM patient_notes n
               LEFT JOIN users u ON u.id = n.created_by
              WHERE n.patient_id = ? AND (? = 'all' OR ? = '') ORDER BY n.created_at DESC LIMIT ?`,
            [patientId, filter === 'all' ? '' : filter, search, limit],
          )) {
            events.push({ type: 'note', at: String(row.created_at).slice(0, 10), id: row.id, title: 'Note', detail: row.body, staff: row.author, route: `patients/${patientId}/notes` });
          }
        }
        if (filter === 'all' || filter === 'attachments') {
          for (const row of c.db.all(
            `SELECT id, created_at, file_name, description, mime_type FROM attachments
              WHERE owner_type = 'patient' AND owner_id = ? AND deleted_at IS NULL
                AND (? = 'all' OR ? = '') ORDER BY created_at DESC LIMIT ?`,
            [patientId, filter === 'all' ? '' : filter, search, limit],
          )) {
            events.push({ type: 'attachment', at: String(row.created_at).slice(0, 10), id: row.id, title: row.description || row.file_name, detail: row.mime_type, route: `patients/${patientId}/attachments` });
          }
        }
        const patient = c.db.get<{ created_at: string; full_name: string; patient_code: string }>(
          'SELECT created_at, full_name, patient_code FROM patients WHERE id = ?',
          [patientId],
        );
        if (filter === 'all' && patient) {
          events.push({ type: 'registration', at: String(patient.created_at).slice(0, 10), id: patientId, title: 'Patient registered', detail: patient.patient_code, route: `patients/${patientId}` });
        }

        events.sort((a, b) => (String(b.at) > String(a.at) ? 1 : String(b.at) < String(a.at) ? -1 : 0));
        return events.slice(0, limit);
      },
    },
  },
};

export interface NewPatientInput {
  fullName: string; phone: string; altPhone: string; emergencyPhone: string; emergencyName: string;
  dateOfBirth: string | null; ageYears: number | null; ageMonths: number | null; gender: string; bloodGroup: string;
  address: string; area: string; district: string; thana: string; postcode: string;
  presentComplaint: string; medicalHistory: string; dentalHistory: string; allergies: string; notes: string;
  requestedCode: string | null;
}

export function createPatientRecord(c: Container, actor: Actor | null, input: NewPatientInput): Record<string, unknown> {
  return c.db.transaction(() => {
    const now = nowIso();
    let code = input.requestedCode ?? c.nextPatientCode();
    if (patientCodeExists(c, code)) {
      throw conflict(`Patient code "${code}" is already in use.`);
    }
    const searchBlob = c.buildSearchBlob([
      code, input.fullName, input.phone, input.altPhone, input.emergencyPhone,
      input.address, input.area, input.district, input.thana, input.postcode,
    ]);
    const id = c.db.insert(
      `INSERT INTO patients (patient_code, full_name, date_of_birth, age_years, age_months, gender, blood_group,
         phone, alt_phone, emergency_name, emergency_phone, address, area, district, thana, postcode,
         present_complaint, medical_history, dental_history, allergies, notes, status, search_blob, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [code, input.fullName, input.dateOfBirth, input.ageYears, input.ageMonths, input.gender, input.bloodGroup,
        input.phone, input.altPhone, input.emergencyName, input.emergencyPhone, input.address, input.area,
        input.district, input.thana, input.postcode, input.presentComplaint, input.medicalHistory,
        input.dentalHistory, input.allergies, input.notes, searchBlob, now, actor?.userId ?? null, now, actor?.userId ?? null],
    );
    writeAudit(c.db, actor, {
      action: 'patients.create', entity: 'patient', entityId: id,
      summary: `Patient ${code} — ${input.fullName} registered`,
      metadata: { code, name: input.fullName },
    });
    return c.db.get('SELECT * FROM patients WHERE id = ?', [id]) as Record<string, unknown>;
  });
}

export function patientOutstanding(c: Container, patientId: number): number {
  const row = c.db.get<{ total_billed_poisha: number; total_paid_poisha: number }>(
    'SELECT * FROM patient_financials WHERE patient_id = ?',
    [patientId],
  );
  return Number(row?.total_billed_poisha ?? 0) - Number(row?.total_paid_poisha ?? 0);
}

export function patientFinancialSummary(c: Container, patientId: number): {
  totalBilledPoisha: number; totalPaidPoisha: number; outstandingPoisha: number;
  invoices: Record<string, unknown>[]; payments: Record<string, unknown>[];
} {
  const finance = c.db.get<{ total_billed_poisha: number; total_paid_poisha: number }>(
    'SELECT * FROM patient_financials WHERE patient_id = ?',
    [patientId],
  );
  const invoices = c.db.all(
    `SELECT i.*, (i.grand_total_poisha - i.paid_poisha) AS balance_poisha
       FROM invoices i WHERE i.patient_id = ? AND i.deleted_at IS NULL ORDER BY i.issue_date DESC, i.id DESC`,
    [patientId],
  );
  const payments = c.db.all(
    `SELECT p.*, COALESCE((SELECT SUM(a.amount_poisha) FROM payment_allocations a WHERE a.payment_id = p.id), 0) AS allocated_poisha
       FROM payments p WHERE p.patient_id = ? AND p.deleted_at IS NULL ORDER BY p.payment_date DESC, p.id DESC`,
    [patientId],
  );
  const billed = Number(finance?.total_billed_poisha ?? 0);
  const paid = Number(finance?.total_paid_poisha ?? 0);
  return { totalBilledPoisha: billed, totalPaidPoisha: paid, outstandingPoisha: billed - paid, invoices, payments };
}

export type { OpContext };
