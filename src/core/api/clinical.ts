import { nowIso } from '../db/connection';
import { Container } from '../container';
import { fieldError, notFound, conflict, businessRule } from '../errors';
import { Validator } from '../validation/validate';
import { toLocalDateKey, toLocalTimeKey } from '../money/format';
import { ADULT_TOOTH_SET, PRIMARY_TOOTH_SET, TOOTH_CONDITIONS, MEDICINE_FORMS } from '../../shared/constants';
import { paginate, readPaging, type Page } from './patients';
import type { ApiSpec } from '../registry';

const VISIT_STATUSES = ['open', 'completed', 'cancelled'] as const;
const CONDITION_IDS = TOOTH_CONDITIONS.map((t) => t.id) as unknown as readonly string[];
const SURFACES = ['mesial', 'occlusal', 'distal', 'buccal', 'lingual', 'full'] as const;
const DENTITIONS = ['adult', 'primary'] as const;

function assertTooth(code: string, dentition: 'adult' | 'primary'): void {
  const set = dentition === 'adult' ? ADULT_TOOTH_SET : PRIMARY_TOOTH_SET;
  if (!set.has(code)) {
    throw fieldError(
      [{ field: 'toothCode', message: `Tooth ${code} is not valid for the ${dentition} dentition.` }],
      `Tooth ${code} is not valid for the ${dentition} dentition.`,
    );
  }
}

export const clinicalApi: ApiSpec = {
  visits: {
    list: {
      perms: ['clinical.view'],
      label: 'List visits',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.optionalInt('patientId');
        const dentistId = v.optionalInt('dentistId');
        const from = v.optionalString('from', 10);
        const to = v.optionalString('to', 10);
        const status = v.enum('status', ['', ...VISIT_STATUSES] as const);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where = ['v.deleted_at IS NULL'];
        const params: (string | number)[] = [];
        if (patientId) { where.push('v.patient_id = ?'); params.push(patientId); }
        if (dentistId) { where.push('v.dentist_id = ?'); params.push(dentistId); }
        if (from) { where.push('v.visit_date >= ?'); params.push(from); }
        if (to) { where.push('v.visit_date <= ?'); params.push(to); }
        if (status) { where.push('v.status = ?'); params.push(status); }
        const whereSql = where.join(' AND ');
        const total = c.db.count(`SELECT COUNT(*) AS n FROM visits v WHERE ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT v.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
             FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN dentists d ON d.id = v.dentist_id
            WHERE ${whereSql} ORDER BY v.visit_date DESC, v.id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    get: {
      perms: ['clinical.view'],
      label: 'Read visit',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const visit = c.db.get(
          `SELECT v.*, p.full_name AS patient_name, p.patient_code, p.gender, p.age_years, p.age_months, p.date_of_birth,
                  d.full_name AS dentist_name
             FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN dentists d ON d.id = v.dentist_id
            WHERE v.id = ? AND v.deleted_at IS NULL`,
          [id],
        );
        if (!visit) throw notFound('Visit');
        const treatments = c.db.all(
          `SELECT tr.*, t.code AS treatment_code FROM treatment_records tr
             LEFT JOIN treatments t ON t.id = tr.treatment_id
            WHERE tr.visit_id = ? ORDER BY tr.id`,
          [id],
        );
        const attachments = c.db.all(
          "SELECT id, file_name, mime_type, description, created_at FROM attachments WHERE scope = 'visit' AND owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC",
          [id],
        );
        const invoices = c.db.all('SELECT id, invoice_no, grand_total_poisha, paid_poisha, status FROM invoices WHERE visit_id = ? AND deleted_at IS NULL', [id]);
        return { visit, treatments, attachments, invoices };
      },
    },
    create: {
      perms: ['clinical.create'],
      label: 'Create visit',
      handler: (ctx, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const dentistId = v.optionalInt('dentistId', { min: 1 });
        const visitDate = v.dateKey('visitDate', { label: 'Visit date' });
        const chiefComplaint = v.string('chiefComplaint', { max: 1000 });
        const history = v.string('history', { max: 3000 });
        const examination = v.string('examination', { max: 3000 });
        const diagnosis = v.string('diagnosis', { max: 2000 });
        const treatmentPlan = v.string('treatmentPlan', { max: 3000 });
        const procedureDone = v.string('procedureDone', { max: 3000 });
        const advice = v.string('advice', { max: 2000 });
        const followUp = v.optionalString('followUpDate', 10);
        const notes = v.string('notes', { max: 3000 });
        const appointmentId = v.optionalInt('appointmentId');
        const status = v.enum('status', VISIT_STATUSES);
        v.throwIfInvalid('Please correct the highlighted fields.');

        const patient = ctx.c.db.get<{ full_name: string }>('SELECT full_name FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId]);
        if (!patient) throw notFound('Patient');
        if (dentistId) ensureDentistExists(ctx.c, dentistId);

        const id = ctx.c.db.transaction(() => {
          const now = nowIso();
          const newId = ctx.c.db.insert(
            `INSERT INTO visits (patient_id, dentist_id, appointment_id, queue_entry_id, visit_date, started_at, ended_at,
               chief_complaint, history, examination, diagnosis, treatment_plan, procedure_done, advice, follow_up_date,
               notes, status, created_at, created_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [patientId, dentistId, appointmentId, null, visitDate || toLocalDateKey(new Date()),
              `${visitDate || toLocalDateKey(new Date())}T${toLocalTimeKey(new Date())}:00.000Z`, null,
              chiefComplaint, history, examination, diagnosis, treatmentPlan, procedureDone, advice, followUp || null,
              notes, status, now, ctx.actor?.userId ?? null, now],
          );
          ctx.c.db.run('UPDATE patients SET last_visit_at = ?, updated_at = ? WHERE id = ?', [visitDate, now, patientId]);
          if (appointmentId) {
            ctx.c.db.run("UPDATE appointments SET status = 'completed', visit_id = ?, updated_at = ? WHERE id = ?", [newId, now, appointmentId]);
          }
          ctx.c.audit(ctx.actor, { action: 'clinical.visit.create', entity: 'visit', entityId: newId, summary: `Visit recorded for ${patient.full_name}` });
          return newId;
        });
        return ctx.c.db.get('SELECT * FROM visits WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['clinical.edit'],
      label: 'Update visit',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const existing = c.db.get<{ patient_id: number }>('SELECT * FROM visits WHERE id = ? AND deleted_at IS NULL', [id]);
        if (!existing) throw notFound('Visit');
        const dentistId = v.optionalInt('dentistId', { min: 1 });
        const visitDate = v.dateKey('visitDate', { label: 'Visit date' });
        const chiefComplaint = v.string('chiefComplaint', { max: 1000 });
        const history = v.string('history', { max: 3000 });
        const examination = v.string('examination', { max: 3000 });
        const diagnosis = v.string('diagnosis', { max: 2000 });
        const treatmentPlan = v.string('treatmentPlan', { max: 3000 });
        const procedureDone = v.string('procedureDone', { max: 3000 });
        const advice = v.string('advice', { max: 2000 });
        const followUp = v.optionalString('followUpDate', 10);
        const notes = v.string('notes', { max: 3000 });
        const status = v.enum('status', VISIT_STATUSES);
        v.throwIfInvalid();
        if (dentistId) ensureDentistExists(c, dentistId);
        c.db.run(
          `UPDATE visits SET dentist_id = ?, visit_date = ?, chief_complaint = ?, history = ?, examination = ?,
             diagnosis = ?, treatment_plan = ?, procedure_done = ?, advice = ?, follow_up_date = ?, notes = ?, status = ?, updated_at = ?
           WHERE id = ?`,
          [dentistId, visitDate, chiefComplaint, history, examination, diagnosis, treatmentPlan, procedureDone,
            advice, followUp || null, notes, status, nowIso(), id],
        );
        c.audit(actor, { action: 'clinical.visit.update', entity: 'visit', entityId: id, summary: 'Visit updated' });
        return c.db.get('SELECT * FROM visits WHERE id = ?', [id]);
      },
    },
    complete: {
      perms: ['clinical.edit'],
      label: 'Complete visit',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const visit = c.db.get<{ patient_id: number; visit_date: string; status: string; queue_entry_id: number | null }>(
          'SELECT * FROM visits WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!visit) throw notFound('Visit');
        if (visit.status === 'completed') throw conflict('This visit is already completed.');
        c.db.run("UPDATE visits SET status = 'completed', ended_at = ?, updated_at = ? WHERE id = ?", [nowIso(), nowIso(), id]);
        if (visit.queue_entry_id) {
          c.db.run("UPDATE queue_entries SET status = 'completed', completed_at = ? WHERE id = ?", [nowIso(), visit.queue_entry_id]);
        }
        c.audit(actor, { action: 'clinical.visit.complete', entity: 'visit', entityId: id, summary: 'Visit completed' });
        return c.db.get('SELECT * FROM visits WHERE id = ?', [id]);
      },
    },
    delete: {
      perms: ['clinical.edit'],
      label: 'Archive visit',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const linked = c.db.count('SELECT COUNT(*) AS n FROM invoices WHERE visit_id = ? AND deleted_at IS NULL', [id]);
        if (linked > 0) {
          throw businessRule('This visit is linked to an invoice and cannot be archived. Remove the invoice link first.');
        }
        c.db.run('UPDATE visits SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id]);
        c.audit(actor, { action: 'clinical.visit.delete', entity: 'visit', entityId: id, summary: 'Visit archived' });
        return { ok: true };
      },
    },
  },

  treatments: {
    categories: {
      perms: ['treatments.view'],
      label: 'List treatment categories',
      handler: ({ c }) => c.db.all('SELECT * FROM treatment_categories ORDER BY sort_order, name'),
    },
    list: {
      perms: ['treatments.view'],
      label: 'List treatments',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        const categoryId = v.optionalInt('categoryId');
        const includeInactive = v.bool('includeInactive');
        const { page, pageSize, offset } = readPaging(input, { pageSize: 50, maxPageSize: 500 });
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (!includeInactive) where.push('t.is_active = 1');
        if (categoryId) { where.push('t.category_id = ?'); params.push(categoryId); }
        if (search) {
          where.push('(t.name LIKE ? COLLATE NOCASE OR t.code LIKE ? COLLATE NOCASE)');
          params.push(`%${search}%`, `%${search}%`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = c.db.count(`SELECT COUNT(*) AS n FROM treatments t ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT t.*, tc.name AS category_name FROM treatments t LEFT JOIN treatment_categories tc ON tc.id = t.category_id
            ${whereSql} ORDER BY t.name COLLATE NOCASE LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    get: {
      perms: ['treatments.view'],
      label: 'Read treatment',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const row = c.db.get('SELECT * FROM treatments WHERE id = ?', [id]);
        if (!row) throw notFound('Treatment');
        return row;
      },
    },
    create: {
      perms: ['treatments.manage'],
      label: 'Create treatment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const name = v.string('name', { required: true, min: 2, max: 120, label: 'Treatment name' });
        const code = v.string('code', { required: true, max: 24, label: 'Code' });
        const categoryId = v.optionalInt('categoryId');
        const description = v.string('description', { max: 1000 });
        const price = v.int('defaultPricePoisha', { min: 0, max: 100000000000 });
        const duration = v.int('durationMinutes', { min: 0, max: 600 });
        const notes = v.string('notes', { max: 500 });
        const active = v.bool('isActive', true);
        v.throwIfInvalid();
        if (c.db.get('SELECT id FROM treatments WHERE code = ?', [code])) throw conflict(`Treatment code "${code}" is already in use.`);
        const now = nowIso();
        const id = c.db.insert(
          `INSERT INTO treatments (code, name, category_id, description, default_price_poisha, duration_minutes, is_active, is_system, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [code, name, categoryId, description, price, duration, active ? 1 : 0, notes, now, now],
        );
        c.audit(actor, { action: 'treatments.create', entity: 'treatment', entityId: id, summary: `Treatment "${name}" created` });
        return c.db.get('SELECT * FROM treatments WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['treatments.manage'],
      label: 'Update treatment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const name = v.string('name', { required: true, min: 2, max: 120, label: 'Treatment name' });
        const code = v.string('code', { required: true, max: 24, label: 'Code' });
        const categoryId = v.optionalInt('categoryId');
        const description = v.string('description', { max: 1000 });
        const price = v.int('defaultPricePoisha', { min: 0, max: 100000000000 });
        const duration = v.int('durationMinutes', { min: 0, max: 600 });
        const notes = v.string('notes', { max: 500 });
        const active = v.bool('isActive', true);
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM treatments WHERE id = ?', [id])) throw notFound('Treatment');
        const clash = c.db.get<{ id: number }>('SELECT id FROM treatments WHERE code = ? AND id <> ?', [code, id]);
        if (clash) throw conflict(`Treatment code "${code}" is already in use.`);
        c.db.run(
          `UPDATE treatments SET code = ?, name = ?, category_id = ?, description = ?, default_price_poisha = ?,
             duration_minutes = ?, is_active = ?, notes = ?, updated_at = ? WHERE id = ?`,
          [code, name, categoryId, description, price, duration, active ? 1 : 0, notes, nowIso(), id],
        );
        c.audit(actor, { action: 'treatments.update', entity: 'treatment', entityId: id, summary: `Treatment "${name}" updated` });
        return c.db.get('SELECT * FROM treatments WHERE id = ?', [id]);
      },
    },
    delete: {
      perms: ['treatments.manage'],
      label: 'Deactivate treatment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const row = c.db.get<{ name: string }>('SELECT name FROM treatments WHERE id = ?', [id]);
        if (!row) throw notFound('Treatment');
        const used = c.db.count('SELECT COUNT(*) AS n FROM treatment_records WHERE treatment_id = ?', [id]);
        if (used > 0) {
          c.db.run('UPDATE treatments SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
          c.audit(actor, { action: 'treatments.deactivate', entity: 'treatment', entityId: id, summary: `Treatment "${row.name}" deactivated (has history)` });
          return { ok: true, deactivated: true };
        }
        c.db.run('DELETE FROM treatments WHERE id = ?', [id]);
        c.audit(actor, { action: 'treatments.delete', entity: 'treatment', entityId: id, summary: `Treatment "${row.name}" deleted` });
        return { ok: true, deactivated: false };
      },
    },
  },

  toothChart: {
    get: {
      perms: ['clinical.view'],
      label: 'Read dental chart',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId])) throw notFound('Patient');
        const current = c.db.all(
          'SELECT * FROM current_tooth_chart WHERE patient_id = ? ORDER BY dentition, tooth_code',
          [patientId],
        );
        const history = c.db.all(
          `SELECT h.*, d.full_name AS dentist_name FROM tooth_condition_history h
             LEFT JOIN dentists d ON d.id = h.recorded_by
            WHERE h.patient_id = ? ORDER BY h.recorded_at DESC, h.id DESC LIMIT 300`,
          [patientId],
        );
        return { current, history };
      },
    },
    set: {
      perms: ['toothchart.edit'],
      label: 'Update dental chart',
      handler: (ctx, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const dentition = v.enum('dentition', DENTITIONS, { required: true });
        const condition = v.enum('condition', CONDITION_IDS, { required: true, label: 'Condition' });
        const surface = v.enum('surface', SURFACES);
        const severity = v.int('severity', { min: 1, max: 3 });
        const note = v.string('note', { max: 500 });
        const visitId = v.optionalInt('visitId');
        const recordedBy = v.optionalInt('recordedBy');
        const teeth = v.array('teeth', (x) => String(x).trim(), { required: true, minItems: 1, maxItems: 64, label: 'Teeth' });
        v.throwIfInvalid('Select at least one tooth and a condition.');

        if (!ctx.c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId])) throw notFound('Patient');
        const unique = [...new Set(teeth)];
        for (const tooth of unique) assertTooth(tooth, dentition);

        const now = nowIso();
        const result = ctx.c.db.transaction(() => {
          const ids: number[] = [];
          for (const tooth of unique) {
            const existing = ctx.c.db.get<{ id: number }>(
              'SELECT id FROM tooth_conditions WHERE patient_id = ? AND dentition = ? AND tooth_code = ? AND is_current = 1',
              [patientId, dentition, tooth],
            );
            if (existing) {
              // Retire the previous state rather than duplicating it: the chart
              // already wrote a history row when the condition was first
              // recorded, so that row is simply marked as superseded.
              ctx.c.db.run('UPDATE tooth_conditions SET superseded_at = ?, is_current = 0 WHERE id = ?', [now, existing.id]);
              ctx.c.db.run('UPDATE tooth_condition_history SET superseded_at = ? WHERE condition_id = ?', [now, existing.id]);
            }
            const id = ctx.c.db.insert(
              `INSERT INTO tooth_conditions (patient_id, dentition, tooth_code, condition, surface, severity, note, visit_id, recorded_by, recorded_at, is_current)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
              [patientId, dentition, tooth, condition, surface, severity, note, visitId, recordedBy, now],
            );
            ctx.c.db.run(
              'INSERT INTO tooth_condition_history (condition_id, patient_id, dentition, tooth_code, condition, surface, severity, note, visit_id, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [id, patientId, dentition, tooth, condition, surface, severity, note, visitId, recordedBy, now],
            );
            ids.push(id);
          }
          ctx.c.audit(ctx.actor, {
            action: 'clinical.toothchart.update', entity: 'patient', entityId: patientId,
            summary: `Dental chart updated: ${unique.join(', ')} → ${condition}`,
            metadata: { dentition, teeth: unique, condition },
          });
          return ids;
        });
        return { updated: result.length, teeth: unique, condition, dentition };
      },
    },
    history: {
      perms: ['clinical.view'],
      label: 'Read tooth history',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const tooth = v.string('toothCode', { max: 4 });
        v.throwIfInvalid();
        if (tooth) {
          return c.db.all(
            `SELECT h.*, d.full_name AS dentist_name FROM tooth_condition_history h
               LEFT JOIN dentists d ON d.id = h.recorded_by
              WHERE h.patient_id = ? AND h.tooth_code = ? ORDER BY h.recorded_at DESC, h.id DESC`,
            [patientId, tooth],
          );
        }
        return c.db.all(
          `SELECT h.*, d.full_name AS dentist_name FROM tooth_condition_history h
             LEFT JOIN dentists d ON d.id = h.recorded_by
            WHERE h.patient_id = ? ORDER BY h.recorded_at DESC, h.id DESC LIMIT 500`,
          [patientId],
        );
      },
    },
  },

  treatmentRecords: {
    listForVisit: {
      perms: ['clinical.view'],
      label: 'List treatments performed in a visit',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const visitId = v.int('visitId', { required: true, min: 1 });
        v.throwIfInvalid();
        return c.db.all(
          `SELECT tr.*, t.code AS treatment_code, d.full_name AS dentist_name
             FROM treatment_records tr LEFT JOIN treatments t ON t.id = tr.treatment_id
             LEFT JOIN dentists d ON d.id = tr.performed_by
            WHERE tr.visit_id = ? ORDER BY tr.id`,
          [visitId],
        );
      },
    },
    listForPatient: {
      perms: ['clinical.view'],
      label: 'List treatments for a patient',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        v.throwIfInvalid();
        return c.db.all(
          `SELECT tr.*, t.code AS treatment_code, d.full_name AS dentist_name, v.visit_date
             FROM treatment_records tr LEFT JOIN treatments t ON t.id = tr.treatment_id
             LEFT JOIN dentists d ON d.id = tr.performed_by LEFT JOIN visits v ON v.id = tr.visit_id
            WHERE tr.patient_id = ? ORDER BY tr.performed_at DESC, tr.id DESC`,
          [patientId],
        );
      },
    },
    create: {
      perms: ['clinical.create'],
      label: 'Record a treatment',
      handler: (ctx, input: unknown) => {
        const v = new Validator(input);
        const visitId = v.int('visitId', { required: true, min: 1 });
        const treatmentId = v.optionalInt('treatmentId');
        const nameSnapshot = v.string('name', { required: true, max: 160, label: 'Treatment' });
        const toothCode = v.optionalString('toothCode', 4);
        const qtyMilli = v.int('qtyMilli', { min: 1, max: 1000000 });
        const unitPrice = v.int('unitPricePoisha', { min: 0, max: 100000000000 });
        const performedBy = v.optionalInt('performedBy');
        const performedAt = v.string('performedAt', { max: 30 });
        const status = v.enum('status', ['planned', 'done', 'cancelled'] as const);
        const notes = v.string('notes', { max: 1000 });
        v.throwIfInvalid('Please correct the highlighted fields.');

        const visit = ctx.c.db.get<{ patient_id: number }>('SELECT * FROM visits WHERE id = ? AND deleted_at IS NULL', [visitId]);
        if (!visit) throw notFound('Visit');
        if (toothCode) {
          const chart = ctx.c.db.get<{ dentition: string }>(
            'SELECT dentition FROM current_tooth_chart WHERE patient_id = ? AND tooth_code = ? LIMIT 1',
            [visit.patient_id, toothCode],
          );
          assertTooth(toothCode, (chart?.dentition as 'adult' | 'primary') ?? 'adult');
        }
        const id = ctx.c.db.insert(
          `INSERT INTO treatment_records (visit_id, patient_id, treatment_id, name_snapshot, tooth_code, qty_milli,
             unit_price_poisha, performed_by, performed_at, status, notes, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [visitId, visit.patient_id, treatmentId, nameSnapshot, toothCode || null, qtyMilli, unitPrice,
            performedBy, performedAt || nowIso(), status, notes, nowIso(), ctx.actor?.userId ?? null],
        );
        ctx.c.audit(ctx.actor, { action: 'clinical.treatment.create', entity: 'treatment_record', entityId: id, summary: `Treatment "${nameSnapshot}" recorded` });
        return ctx.c.db.get('SELECT * FROM treatment_records WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['clinical.edit'],
      label: 'Update a treatment record',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const nameSnapshot = v.string('name', { required: true, max: 160, label: 'Treatment' });
        const toothCode = v.optionalString('toothCode', 4);
        const qtyMilli = v.int('qtyMilli', { min: 1, max: 1000000 });
        const unitPrice = v.int('unitPricePoisha', { min: 0, max: 100000000000 });
        const status = v.enum('status', ['planned', 'done', 'cancelled'] as const);
        const notes = v.string('notes', { max: 1000 });
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM treatment_records WHERE id = ?', [id])) throw notFound('Treatment record');
        c.db.run(
          'UPDATE treatment_records SET name_snapshot = ?, tooth_code = ?, qty_milli = ?, unit_price_poisha = ?, status = ?, notes = ? WHERE id = ?',
          [nameSnapshot, toothCode || null, qtyMilli, unitPrice, status, notes, id],
        );
        c.audit(actor, { action: 'clinical.treatment.update', entity: 'treatment_record', entityId: id, summary: `Treatment "${nameSnapshot}" updated` });
        return c.db.get('SELECT * FROM treatment_records WHERE id = ?', [id]);
      },
    },
    delete: {
      perms: ['clinical.edit'],
      label: 'Delete a treatment record',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const used = c.db.count('SELECT COUNT(*) AS n FROM invoice_items WHERE treatment_id = (SELECT treatment_id FROM treatment_records WHERE id = ?)', [id]);
        if (used > 0) throw businessRule('This treatment is already on an invoice and cannot be removed.');
        c.db.run('DELETE FROM treatment_records WHERE id = ?', [id]);
        c.audit(actor, { action: 'clinical.treatment.delete', entity: 'treatment_record', entityId: id, summary: 'Treatment record deleted' });
        return { ok: true };
      },
    },
  },

  medicines: {
    list: {
      perms: ['prescriptions.view'],
      label: 'List medicines',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        const limit = Math.min(200, v.int('limit', { min: 1, max: 200, label: 'Limit' }) || 50);
        if (search) {
          return c.db.all(
            'SELECT * FROM medicines WHERE is_active = 1 AND (name LIKE ? COLLATE NOCASE OR strength LIKE ? COLLATE NOCASE) ORDER BY name COLLATE NOCASE LIMIT ?',
            [`%${search}%`, `%${search}%`, limit],
          );
        }
        return c.db.all('SELECT * FROM medicines WHERE is_active = 1 ORDER BY name COLLATE NOCASE LIMIT ?', [limit]);
      },
    },
    save: {
      perms: ['prescriptions.create'],
      label: 'Save medicine to catalogue',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const name = v.string('name', { required: true, min: 2, max: 160, label: 'Medicine name' });
        const form = v.enum('form', MEDICINE_FORMS);
        const strength = v.string('strength', { max: 60 });
        const manufacturer = v.string('manufacturer', { max: 120 });
        v.throwIfInvalid();
        const existing = c.db.get<{ id: number }>('SELECT id FROM medicines WHERE name = ? AND form = ? AND strength = ?', [name, form, strength]);
        if (existing) return c.db.get('SELECT * FROM medicines WHERE id = ?', [existing.id]);
        const id = c.db.insert('INSERT INTO medicines (name, form, strength, manufacturer, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [
          name, form, strength, manufacturer, nowIso(),
        ]);
        c.audit(actor, { action: 'medicines.create', entity: 'medicine', entityId: id, summary: `Medicine "${name}" added to catalogue` });
        return c.db.get('SELECT * FROM medicines WHERE id = ?', [id]);
      },
    },
  },

  prescriptions: {
    list: {
      perms: ['prescriptions.view'],
      label: 'List prescriptions',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.optionalInt('patientId');
        const from = v.optionalString('from', 10);
        const to = v.optionalString('to', 10);
        const search = v.string('search', { max: 120 });
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where = ['p.deleted_at IS NULL'];
        const params: (string | number)[] = [];
        if (patientId) { where.push('p.patient_id = ?'); params.push(patientId); }
        if (from) { where.push('p.issue_date >= ?'); params.push(from); }
        if (to) { where.push('p.issue_date <= ?'); params.push(to); }
        if (search) {
          where.push('(p.prescription_no LIKE ? COLLATE NOCASE OR pt.full_name LIKE ? COLLATE NOCASE OR pt.patient_code LIKE ? COLLATE NOCASE)');
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        const whereSql = where.join(' AND ');
        const total = c.db.count(
          `SELECT COUNT(*) AS n FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id WHERE ${whereSql}`,
          params,
        );
        const rows = c.db.all(
          `SELECT p.*, pt.full_name AS patient_name, pt.patient_code, d.full_name AS dentist_name,
                  (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = p.id) AS item_count
             FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id LEFT JOIN dentists d ON d.id = p.dentist_id
            WHERE ${whereSql} ORDER BY p.issue_date DESC, p.id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    get: {
      perms: ['prescriptions.view'],
      label: 'Read prescription',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const prescription = c.db.get(
          `SELECT p.*, pt.full_name AS patient_name, pt.patient_code, pt.gender, pt.age_years, pt.age_months,
                  pt.date_of_birth, pt.phone, pt.address, d.full_name AS dentist_name, d.title AS dentist_title,
                  d.designations, d.registration_no, d.consultation_hours, d.degree_prefix, d.signature_attachment_id,
                  cl.name AS clinic_name, cl.address_line AS clinic_address, cl.area AS clinic_area, cl.district AS clinic_district,
                  cl.phone AS clinic_phone, cl.email AS clinic_email, cl.footer_message, cl.logo_attachment_id
             FROM prescriptions p
             JOIN patients pt ON pt.id = p.patient_id
             LEFT JOIN dentists d ON d.id = p.dentist_id
             CROSS JOIN clinic cl
            WHERE p.id = ? AND p.deleted_at IS NULL`,
          [id],
        );
        if (!prescription) throw notFound('Prescription');
        const items = c.db.all('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order, id', [id]);
        return { prescription, items };
      },
    },
    create: {
      perms: ['prescriptions.create'],
      label: 'Create prescription',
      handler: (ctx, input: unknown) => createPrescription(ctx.c, ctx.actor, input),
    },
    update: {
      perms: ['prescriptions.edit'],
      label: 'Update prescription',
      handler: (ctx, input: unknown) => updatePrescription(ctx.c, ctx.actor, input),
    },
    saveDraft: {
      perms: ['prescriptions.create'],
      label: 'Save prescription draft',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const entityId = v.optionalInt('entityId');
        const payload = JSON.stringify(input ?? {});
        c.db.run(
          `INSERT INTO drafts (owner, user_id, kind, entity_id, payload, updated_at) VALUES ('prescription', ?, 'prescription', ?, ?, ?)
           ON CONFLICT(user_id, kind, COALESCE(entity_id, 0)) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
          [actor?.userId ?? null, entityId, payload.slice(0, 200000), nowIso()],
        );
        return { ok: true };
      },
    },
    loadDraft: {
      perms: ['prescriptions.create'],
      label: 'Load prescription draft',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const entityId = v.optionalInt('entityId');
        const row = c.db.get<{ payload: string }>(
          "SELECT payload FROM drafts WHERE user_id = ? AND kind = 'prescription' AND COALESCE(entity_id, 0) = ?",
          [actor?.userId ?? null, entityId ?? 0],
        );
        if (!row) return null;
        try {
          return JSON.parse(row.payload);
        } catch {
          return null;
        }
      },
    },
    discardDraft: {
      perms: ['prescriptions.create'],
      label: 'Discard prescription draft',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const entityId = v.optionalInt('entityId');
        c.db.run("DELETE FROM drafts WHERE user_id = ? AND kind = 'prescription' AND COALESCE(entity_id, 0) = ?", [
          actor?.userId ?? null, entityId ?? 0,
        ]);
        return { ok: true };
      },
    },
    delete: {
      perms: ['prescriptions.edit'],
      label: 'Archive prescription',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const row = c.db.get<{ prescription_no: string }>('SELECT prescription_no FROM prescriptions WHERE id = ? AND deleted_at IS NULL', [id]);
        if (!row) throw notFound('Prescription');
        c.db.run('UPDATE prescriptions SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id]);
        c.audit(actor, { action: 'prescriptions.delete', entity: 'prescription', entityId: id, summary: `Prescription ${row.prescription_no} archived` });
        return { ok: true };
      },
    },
  },

  referrals: {
    list: {
      perms: ['clinical.view'],
      label: 'List referrals',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.optionalInt('patientId');
        const params: (string | number)[] = [];
        let where = '';
        if (patientId) { where = 'WHERE r.patient_id = ?'; params.push(patientId); }
        return c.db.all(
          `SELECT r.*, p.full_name AS patient_name, p.patient_code, df.full_name AS from_name, dt.full_name AS to_name
             FROM referrals r JOIN patients p ON p.id = r.patient_id
             LEFT JOIN dentists df ON df.id = r.from_dentist_id LEFT JOIN dentists dt ON dt.id = r.to_dentist_id
             ${where} ORDER BY r.refer_date DESC, r.id DESC LIMIT 500`,
          params,
        );
      },
    },
    create: {
      perms: ['clinical.create'],
      label: 'Create referral',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        const referDate = v.dateKey('referDate', { required: true, label: 'Referral date' });
        const fromDentistId = v.optionalInt('fromDentistId');
        const toDentistId = v.optionalInt('toDentistId');
        const toClinic = v.string('toClinic', { max: 200 });
        const reason = v.string('reason', { required: true, max: 1000, label: 'Reason' });
        const notes = v.string('notes', { max: 2000 });
        const followUp = v.optionalString('followUpDate', 10);
        v.throwIfInvalid('Please correct the highlighted fields.');
        if (!toClinic && !toDentistId) {
          throw fieldError([{ field: 'toClinic', message: 'Enter the clinic or doctor the patient is referred to.' }]);
        }
        if (!c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId])) throw notFound('Patient');
        const id = c.db.insert(
          `INSERT INTO referrals (patient_id, referred_at, refer_date, from_dentist_id, to_dentist_id, to_clinic, reason, notes, status, follow_up_date, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'referred', ?, ?, ?)`,
          [patientId, nowIso(), referDate, fromDentistId, toDentistId, toClinic, reason, notes, followUp || null, nowIso(), actor?.userId ?? null],
        );
        c.audit(actor, { action: 'clinical.referral.create', entity: 'referral', entityId: id, summary: `Referral created for patient #${patientId}` });
        return c.db.get('SELECT * FROM referrals WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['clinical.edit'],
      label: 'Update referral',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const status = v.enum('status', ['referred', 'followed-up', 'completed', 'cancelled'] as const, { required: true });
        const outcome = v.string('outcome', { max: 1000 });
        const followUp = v.optionalString('followUpDate', 10);
        const notes = v.string('notes', { max: 2000 });
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM referrals WHERE id = ?', [id])) throw notFound('Referral');
        c.db.run('UPDATE referrals SET status = ?, outcome = ?, follow_up_date = ?, notes = ? WHERE id = ?', [status, outcome, followUp || null, notes, id]);
        c.audit(actor, { action: 'clinical.referral.update', entity: 'referral', entityId: id, summary: `Referral marked ${status}` });
        return c.db.get('SELECT * FROM referrals WHERE id = ?', [id]);
      },
    },
  },
};

function ensureDentistExists(c: Container, dentistId: number): void {
  if (!c.db.get('SELECT id FROM dentists WHERE id = ?', [dentistId])) throw notFound('Dentist');
}

interface PrescriptionItemInput {
  medicineId: number | null; name: string; form: string; strength: string; dose: string;
  morning: number; afternoon: number; evening: number; night: number; beforeFood: number;
  duration: string; quantity: string; instructions: string; prn: number; extraInstruction: string;
}

function readPrescriptionItems(v: Validator, input: unknown): PrescriptionItemInput[] {
  const body = (input ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: PrescriptionItemInput[] = [];
  rawItems.forEach((raw, index) => {
    const item = new Validator(raw, `items[${index}]`);
    const name = item.string('name', { required: true, min: 2, max: 160, label: 'Medicine name' });
    if (!name) return;
    items.push({
      medicineId: item.optionalInt('medicineId'),
      name,
      form: item.enum('form', MEDICINE_FORMS),
      strength: item.string('strength', { max: 60 }),
      dose: item.string('dose', { max: 120 }),
      morning: item.bool('morning') ? 1 : 0,
      afternoon: item.bool('afternoon') ? 1 : 0,
      evening: item.bool('evening') ? 1 : 0,
      night: item.bool('night') ? 1 : 0,
      beforeFood: item.bool('beforeFood', true) ? 1 : 0,
      duration: item.string('duration', { max: 80 }),
      quantity: item.string('quantity', { max: 80 }),
      instructions: item.string('instructions', { max: 300 }),
      prn: item.bool('prn') ? 1 : 0,
      extraInstruction: item.string('extraInstruction', { max: 300 }),
    });
    item.throwIfInvalid('Please correct the medicine details.');
  });
  void v;
  return items;
}

function createPrescription(c: Container, actor: import('../security/rbac').Actor | null, input: unknown): Record<string, unknown> {
  const v = new Validator(input);
  const patientId = v.int('patientId', { required: true, min: 1 });
  const visitId = v.optionalInt('visitId');
  const dentistId = v.optionalInt('dentistId', { min: 1 });
  const issueDate = v.dateKey('issueDate', { required: true, label: 'Issue date' });
  const cc = v.string('cc', { max: 1000 });
  const oe = v.string('oe', { max: 2000 });
  const re = v.string('re', { max: 2000 });
  const advice = v.string('advice', { max: 2000 });
  const notes = v.string('notes', { max: 2000 });
  const followUp = v.optionalString('followUpDate', 10);
  const status = v.enum('status', ['draft', 'issued', 'cancelled'] as const);
  const items = readPrescriptionItems(v, input);
  v.throwIfInvalid('Please correct the highlighted fields.');

  if (status !== 'draft' && items.length === 0) {
    throw fieldError([{ field: 'items', message: 'Add at least one medicine before issuing a prescription.' }]);
  }
  const patient = c.db.get<{ full_name: string }>('SELECT full_name FROM patients WHERE id = ? AND deleted_at IS NULL', [patientId]);
  if (!patient) throw notFound('Patient');
  if (dentistId) ensureDentistExists(c, dentistId);

  return c.db.transaction(() => {
    const now = nowIso();
    const prescriptionNo = c.nextDocumentNo('RX', 'prescriptions', 'prescription_no', 5);
    const id = c.db.insert(
      `INSERT INTO prescriptions (prescription_no, patient_id, visit_id, dentist_id, issued_at, issue_date, cc, oe, re, advice, notes, follow_up_date, status, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prescriptionNo, patientId, visitId, dentistId, now, issueDate, cc, oe, re, advice, notes, followUp || null, status, now, actor?.userId ?? null, now],
    );
    writeItems(c, id, items);
    c.audit(actor, {
      action: 'prescriptions.create', entity: 'prescription', entityId: id,
      summary: `Prescription ${prescriptionNo} created for ${patient.full_name} (${items.length} medicine(s))`,
      metadata: { no: prescriptionNo, items: items.length },
    });
    return c.db.get('SELECT * FROM prescriptions WHERE id = ?', [id]) as Record<string, unknown>;
  });
}

function updatePrescription(c: Container, actor: import('../security/rbac').Actor | null, input: unknown): Record<string, unknown> {
  const v = new Validator(input);
  const id = v.int('id', { required: true, min: 1 });
  const existing = c.db.get<{ patient_id: number; status: string }>('SELECT * FROM prescriptions WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!existing) throw notFound('Prescription');
  const visitId = v.optionalInt('visitId');
  const dentistId = v.optionalInt('dentistId', { min: 1 });
  const issueDate = v.dateKey('issueDate', { required: true, label: 'Issue date' });
  const cc = v.string('cc', { max: 1000 });
  const oe = v.string('oe', { max: 2000 });
  const re = v.string('re', { max: 2000 });
  const advice = v.string('advice', { max: 2000 });
  const notes = v.string('notes', { max: 2000 });
  const followUp = v.optionalString('followUpDate', 10);
  const status = v.enum('status', ['draft', 'issued', 'cancelled'] as const);
  const items = readPrescriptionItems(v, input);
  v.throwIfInvalid('Please correct the highlighted fields.');
  if (status !== 'draft' && items.length === 0) {
    throw fieldError([{ field: 'items', message: 'A prescription must contain at least one medicine.' }]);
  }
  if (dentistId) ensureDentistExists(c, dentistId);

  return c.db.transaction(() => {
    c.db.run(
      `UPDATE prescriptions SET visit_id = ?, dentist_id = ?, issue_date = ?, cc = ?, oe = ?, re = ?, advice = ?,
         notes = ?, follow_up_date = ?, status = ?, updated_at = ? WHERE id = ?`,
      [visitId, dentistId, issueDate, cc, oe, re, advice, notes, followUp || null, status, nowIso(), id],
    );
    c.db.run('DELETE FROM prescription_items WHERE prescription_id = ?', [id]);
    writeItems(c, id, items);
    c.audit(actor, { action: 'prescriptions.update', entity: 'prescription', entityId: id, summary: `Prescription #${id} updated (${items.length} medicine(s))` });
    return c.db.get('SELECT * FROM prescriptions WHERE id = ?', [id]) as Record<string, unknown>;
  });
}

function writeItems(c: Container, prescriptionId: number, items: PrescriptionItemInput[]): void {
  items.forEach((item, index) => {
    c.db.run(
      `INSERT INTO prescription_items (prescription_id, medicine_id, name, form, strength, dose, morning, afternoon,
         evening, night, before_food, duration, quantity, instructions, prn, extra_instruction, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prescriptionId, item.medicineId, item.name, item.form, item.strength, item.dose, item.morning, item.afternoon,
        item.evening, item.night, item.beforeFood, item.duration, item.quantity, item.instructions, item.prn,
        item.extraInstruction, index],
    );
  });
}

export type { Page };
