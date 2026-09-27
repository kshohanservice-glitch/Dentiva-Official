import { mkdirSync, rmSync } from 'node:fs';
import { nowIso } from '../db/connection';
import { Container } from '../container';
import { fieldError, notFound, businessRule, permissionDenied, unauthenticated, AppError } from '../errors';
import { Validator } from '../validation/validate';
import { toLocalDateKey } from '../money/format';
import { readPaging, paginate, dateRangeFrom, patientFinancialSummary } from './patients';
import { getInvoiceModel } from './financial';
import { storeAttachmentFile, deleteAttachmentFile, readAttachmentFile, attachmentPath, vaultUsage, safeFileName, assertPlainFileName } from '../services/files';
import { BackupService } from '../services/backup';
import { refreshInvoiceTotals } from './financial';
import { PAPER_SIZES, type PaperSizeId } from '../../shared/constants';
import type { ApiSpec } from '../registry';
import type { Permission } from '../../shared/permissions';
import type { Actor } from '../security/rbac';

const SEVERITIES = ['info', 'success', 'warning', 'error'] as const;

function backupService(c: Container): BackupService {
  return new BackupService(c);
}

export const platformApi: ApiSpec = {
  dashboard: {
    summary: {
      // The dashboard is a landing page for every role; the handler shows only
      // the sections the signed-in user is actually allowed to see.
      permsAny: ['patients.view', 'appointments.view', 'queue.view', 'payments.view', 'accounting.view', 'inventory.view'],
      label: 'Dashboard summary',
      handler: ({ c, actor }) => {
        const today = toLocalDateKey(new Date());
        const canSeeMoney = actor?.permissions.has('payments.view') || actor?.permissions.has('accounting.view');
        const canSeeQueue = actor?.permissions.has('queue.view');
        const canSeeInventory = actor?.permissions.has('inventory.view');

        const appointments = c.db.get<Record<string, number>>(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_show,
             SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
             SUM(CASE WHEN status IN ('scheduled','confirmed') THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status = 'arrived' THEN 1 ELSE 0 END) AS arrived
           FROM appointments WHERE appointment_date = ? AND deleted_at IS NULL`,
          [today],
        );
        const queue = canSeeQueue
          ? c.db.get<Record<string, number>>(
              `SELECT COUNT(*) AS waiting,
                      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
                      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
                 FROM queue_entries WHERE queue_date = ? AND status NOT IN ('cancelled')`,
              [today],
            )
          : null;
        const visits = c.db.get<Record<string, number>>(
          'SELECT COUNT(*) AS total FROM visits WHERE visit_date = ? AND deleted_at IS NULL',
          [today],
        );
        const newPatients = c.db.get<Record<string, number>>(
          "SELECT COUNT(*) AS total FROM patients WHERE date(created_at) = ? AND deleted_at IS NULL",
          [today],
        );
        const monthStart = `${today.slice(0, 7)}-01`;
        const revenue = canSeeMoney
          ? c.db.get<Record<string, number>>(
              `SELECT
                 COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE deleted_at IS NULL AND type = 'receipt' AND payment_date = ?), 0) AS today_poisha,
                 COALESCE((SELECT SUM(amount_poisha) FROM payments WHERE deleted_at IS NULL AND type = 'receipt' AND payment_date >= ?), 0) AS month_poisha,
                 COALESCE((SELECT SUM(grand_total_poisha) FROM invoices WHERE deleted_at IS NULL AND status <> 'cancelled' AND issue_date = ?), 0) AS invoiced_today_poisha,
                 COALESCE((SELECT SUM(grand_total_poisha - paid_poisha) FROM invoices WHERE deleted_at IS NULL AND status <> 'cancelled' AND (grand_total_poisha - paid_poisha) > 0), 0) AS outstanding_poisha`,
              [today, monthStart, today],
            )
          : null;
        const lowStock = canSeeInventory
          ? c.db.get<Record<string, number>>('SELECT COUNT(*) AS total FROM inventory_items WHERE is_active = 1 AND current_stock <= min_stock')
          : null;
        const alertDays = c.settings.get('inventory.expiryAlertDays');
        const expiring = canSeeInventory
          ? c.db.get<Record<string, number>>(
              `SELECT COUNT(*) AS total FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
                WHERE (b.quantity_received - b.quantity_issued) > 0 AND b.expiry_date IS NOT NULL
                  AND b.expiry_date <= date('now', '+${Number(alertDays)} days')`,
            )
          : null;
        const recentPatients = c.db.all(
          `SELECT id, patient_code, full_name, phone, created_at FROM patients
            WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 6`,
        );
        const upcoming = c.db.all(
          `SELECT a.id, a.appointment_date, a.start_time, a.appointment_type, a.status,
                  p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
             FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
            WHERE a.appointment_date >= ? AND a.deleted_at IS NULL AND a.status IN ('scheduled','confirmed','arrived','in_queue')
            ORDER BY a.appointment_date, a.start_time LIMIT 8`,
          [today],
        );
        const recentPayments = canSeeMoney
          ? c.db.all(
              `SELECT pay.id, pay.payment_no, pay.payment_date, pay.method, pay.amount_poisha, p.full_name AS patient_name
                 FROM payments pay JOIN patients p ON p.id = pay.patient_id
                WHERE pay.deleted_at IS NULL ORDER BY pay.paid_at DESC LIMIT 6`,
            )
          : [];
        const todayAppointments = c.db.all(
          `SELECT a.id, a.start_time, a.duration_minutes, a.appointment_type, a.status,
                  p.id AS patient_id, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
             FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
            WHERE a.appointment_date = ? AND a.deleted_at IS NULL AND a.status <> 'cancelled'
            ORDER BY a.start_time LIMIT 10`,
          [today],
        );
        const revenueTrend = canSeeMoney
          ? c.db.all(
              `SELECT d.day,
                      (SELECT COALESCE(SUM(amount_poisha), 0) FROM payments WHERE deleted_at IS NULL AND type = 'receipt' AND payment_date = d.day) AS collected_poisha
                 FROM (SELECT DISTINCT payment_date AS day FROM payments WHERE deleted_at IS NULL AND payment_date >= date('now', '-13 days')) d
                ORDER BY d.day`,
            )
          : [];
        const topTreatments = c.db.all(
          `SELECT ii.description, SUM(ii.line_total_poisha) AS total_poisha
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.issue_date >= ?
            GROUP BY ii.description ORDER BY total_poisha DESC LIMIT 6`,
          [monthStart],
        );

        return {
          date: today,
          appointments: appointments ?? { total: 0 },
          queue: queue ?? null,
          visitsToday: Number(visits?.total ?? 0),
          newPatientsToday: Number(newPatients?.total ?? 0),
          revenue: revenue ? { ...revenue, todayPoisha: Number(revenue.today_poisha ?? 0) } : null,
          lowStock: lowStock ? Number(lowStock.total) : null,
          expiringSoon: expiring ? Number(expiring.total) : null,
          recentPatients,
          upcoming,
          recentPayments,
          todayAppointments,
          revenueTrend,
          topTreatments,
        };
      },
    },
  },

  search: {
    global: {
      // Results are already scoped to what the caller can see; the guard below
      // narrows them further for roles that may not see everything.
      guard: ({ c, actor }) => {
        if (!actor) throw unauthenticated();
        if (!actor.permissions.has('patients.view') && !actor.permissions.has('clinical.view') && !actor.permissions.has('appointments.view')) {
          throw permissionDenied('You do not have permission to search the clinic records.');
        }
        void c;
      },
      label: 'Global search',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const query = v.string('query', { required: true, min: 1, max: 120, label: 'Search' });
        const kinds = v.array('kinds', (x) => String(x), { maxItems: 20 });
        const limit = Math.min(50, v.int('limit', { min: 1, max: 50, label: 'Limit' }) || 8);
        v.throwIfInvalid('Type at least one character to search.');
        const needle = Container.normaliseForSearch(query);
        const like = `%${needle}%`;
        const wanted = (k: string) => kinds.length === 0 || kinds.includes(k);
        const results: Record<string, unknown>[] = [];

        if (wanted('patients')) {
          results.push(
            ...c.db.all(
              `SELECT id, patient_code AS code, full_name AS title, phone AS subtitle, 'patients' AS kind, 'patients/' || id AS route
                 FROM patients WHERE deleted_at IS NULL AND search_blob LIKE ? ORDER BY (patient_code = ?) DESC, created_at DESC LIMIT ?`,
              [like, needle, limit],
            ),
          );
        }
        if (wanted('appointments')) {
          results.push(
            ...c.db.all(
              `SELECT a.id, 'APPT ' || a.appointment_date AS code, p.full_name AS title,
                      a.start_time || ' · ' || a.status AS subtitle, 'appointments' AS kind, 'appointments?highlight=' || a.id AS route
                 FROM appointments a JOIN patients p ON p.id = a.patient_id
                WHERE a.deleted_at IS NULL AND p.search_blob LIKE ? AND a.appointment_date >= date('now', '-120 days')
                ORDER BY a.appointment_date DESC LIMIT ?`,
              [like, limit],
            ),
          );
        }
        if (wanted('prescriptions')) {
          results.push(
            ...c.db.all(
              `SELECT rx.id, rx.prescription_no AS code, p.full_name AS title, rx.issue_date AS subtitle,
                      'prescriptions' AS kind, 'patients/' || p.id || '/prescriptions/' || rx.id AS route
                 FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id
                WHERE rx.deleted_at IS NULL AND (p.search_blob LIKE ? OR rx.prescription_no LIKE ?) ORDER BY rx.issue_date DESC LIMIT ?`,
              [like, like, limit],
            ),
          );
        }
        if (wanted('invoices')) {
          results.push(
            ...c.db.all(
              `SELECT i.id, i.invoice_no AS code, p.full_name AS title, i.issue_date || ' · ' || i.status AS subtitle,
                      'invoices' AS kind, 'billing/invoices/' || i.id AS route
                 FROM invoices i JOIN patients p ON p.id = i.patient_id
                WHERE i.deleted_at IS NULL AND (p.search_blob LIKE ? OR i.invoice_no LIKE ?) ORDER BY i.issue_date DESC LIMIT ?`,
              [like, like, limit],
            ),
          );
        }
        if (wanted('payments')) {
          results.push(
            ...c.db.all(
              `SELECT pay.id, pay.payment_no AS code, p.full_name AS title, pay.payment_date || ' · ' || pay.method AS subtitle,
                      'payments' AS kind, 'billing/payments/' || pay.id AS route
                 FROM payments pay JOIN patients p ON p.id = pay.patient_id
                WHERE pay.deleted_at IS NULL AND (p.search_blob LIKE ? OR pay.payment_no LIKE ?) ORDER BY pay.paid_at DESC LIMIT ?`,
              [like, like, limit],
            ),
          );
        }
        if (wanted('visits')) {
          results.push(
            ...c.db.all(
              `SELECT v.id, v.visit_date AS code, p.full_name AS title, COALESCE(v.chief_complaint, v.diagnosis, 'Visit') AS subtitle,
                      'visits' AS kind, 'patients/' || p.id || '/visits/' || v.id AS route
                 FROM visits v JOIN patients p ON p.id = v.patient_id
                WHERE v.deleted_at IS NULL AND p.search_blob LIKE ? ORDER BY v.visit_date DESC LIMIT ?`,
              [like, limit],
            ),
          );
        }
        if (wanted('inventory')) {
          results.push(
            ...c.db.all(
              `SELECT id, sku AS code, name AS title, category AS subtitle, 'inventory' AS kind, 'billing/inventory/' || id AS route
                 FROM inventory_items WHERE is_active = 1 AND (name LIKE ? COLLATE NOCASE OR sku LIKE ? COLLATE NOCASE) LIMIT ?`,
              [`%${query}%`, `%${query}%`, limit],
            ),
          );
        }
        if (wanted('staff')) {
          results.push(
            ...c.db.all(
              `SELECT id, position AS code, full_name AS title, COALESCE(phone, department) AS subtitle, 'staff' AS kind,
                      'administration/staff/' || id AS route
                 FROM staff WHERE full_name LIKE ? COLLATE NOCASE OR position LIKE ? COLLATE NOCASE LIMIT ?`,
              [`%${query}%`, `%${query}%`, limit],
            ),
          );
        }
        if (wanted('treatments')) {
          results.push(
            ...c.db.all(
              `SELECT id, code, name AS title, COALESCE(description, '') AS subtitle, 'treatments' AS kind, 'clinical/treatments/' || id AS route
                 FROM treatments WHERE is_active = 1 AND (name LIKE ? COLLATE NOCASE OR code LIKE ? COLLATE NOCASE) LIMIT ?`,
              [`%${query}%`, `%${query}%`, limit],
            ),
          );
        }

        const groups: Record<string, { label: string; items: Record<string, unknown>[] }> = {};
        const order: [string, string][] = [
          ['patients', 'Patients'],
          ['appointments', 'Appointments'],
          ['prescriptions', 'Prescriptions'],
          ['visits', 'Visits'],
          ['invoices', 'Invoices'],
          ['payments', 'Payments'],
          ['inventory', 'Inventory'],
          ['staff', 'Staff'],
          ['treatments', 'Treatments'],
        ];
        for (const [kind, label] of order) {
          const items = results.filter((r) => r.kind === kind);
          if (items.length) groups[kind] = { label, items };
        }
        return { query, groups, total: results.length };
      },
    },
  },

  notifications: {
    list: {
      permsAny: ['patients.view', 'appointments.view', 'queue.view', 'payments.view', 'inventory.view', 'settings.view'],
      label: 'List notifications',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const unreadOnly = v.bool('unreadOnly');
        refreshGeneratedNotifications(c);
        const where = unreadOnly ? 'WHERE read_at IS NULL AND dismissed_at IS NULL' : 'WHERE dismissed_at IS NULL';
        const rows = c.db.all(`SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC LIMIT 100`);
        const unread = c.db.count('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL');
        return { rows, unread };
      },
    },
    markRead: {
      permsAny: ['patients.view', 'appointments.view', 'queue.view', 'payments.view', 'inventory.view', 'settings.view'],
      label: 'Mark notification read',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        c.db.run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?', [nowIso(), id]);
        c.audit(actor, { action: 'notifications.read', entity: 'notification', entityId: id, summary: 'Notification marked read' });
        return { ok: true };
      },
    },
    markAllRead: {
      permsAny: ['patients.view', 'appointments.view', 'queue.view', 'payments.view', 'inventory.view', 'settings.view'],
      label: 'Mark all notifications read',
      handler: ({ c, actor }) => {
        const n = c.db.run('UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND dismissed_at IS NULL', [nowIso()]).changes;
        c.audit(actor, { action: 'notifications.read_all', entity: 'notification', summary: `${n} notification(s) marked read` });
        return { ok: true, count: n };
      },
    },
    dismiss: {
      permsAny: ['patients.view', 'appointments.view', 'queue.view', 'payments.view', 'inventory.view', 'settings.view'],
      label: 'Dismiss notification',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        c.db.run('UPDATE notifications SET dismissed_at = ? WHERE id = ?', [nowIso(), id]);
        return { ok: true };
      },
    },
    create: {
      perms: ['settings.manage'],
      label: 'Create notification',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const title = v.string('title', { required: true, max: 160, label: 'Title' });
        const body = v.string('body', { max: 1000 });
        const severity = v.enum('severity', SEVERITIES);
        v.throwIfInvalid();
        const id = c.db.insert(
          'INSERT INTO notifications (kind, severity, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
          ['manual', severity, title, body, nowIso()],
        );
        c.audit(actor, { action: 'notifications.create', entity: 'notification', entityId: id, summary: `Notification "${title}" created` });
        return c.db.get('SELECT * FROM notifications WHERE id = ?', [id]);
      },
    },
  },

  /**
   * Unsaved form state.
   *
   * A receptionist who is called away mid-entry must not lose the record, and
   * the application auto-locks on idle. A draft belongs to the user who wrote
   * it — nobody else can read or clear it, and it is never included in an
   * export, a backup manifest or the audit log.
   */
  drafts: {
    save: {
      perms: [],
      label: 'Save unsaved form state',
      handler: ({ c, actor }, input: unknown) => {
        if (!actor) throw unauthenticated('Sign in to save your work.');
        const v = new Validator(input);
        const kind = v.string('kind', { required: true, max: 60, label: 'Draft type' });
        const entityId = v.optionalInt('entityId');
        const payload = v.string('payload', { required: true, max: 400000, label: 'Draft' });
        v.throwIfInvalid();
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          throw fieldError([{ field: 'payload', message: 'The saved form state was not valid.' }]);
        }
        if (parsed === null || typeof parsed !== 'object') {
          throw fieldError([{ field: 'payload', message: 'The saved form state was not valid.' }]);
        }
        const now = nowIso();
        c.db.run(
          `INSERT INTO drafts (owner, user_id, kind, entity_id, payload, updated_at)
           VALUES ('form', ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, kind, COALESCE(entity_id, 0))
           DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
          [actor.userId, kind, entityId, payload, now],
        );
        // Deliberately not audited: this is half-written work, not a change to
        // a record, and it must not fill the audit log with noise.
        return { savedAt: now };
      },
    },
    get: {
      perms: [],
      label: 'Read unsaved form state',
      handler: ({ c, actor }, input: unknown) => {
        if (!actor) throw unauthenticated('Sign in to read your work.');
        const v = new Validator(input);
        const kind = v.string('kind', { required: true, max: 60, label: 'Draft type' });
        const entityId = v.optionalInt('entityId');
        v.throwIfInvalid();
        const row = c.db.get<{ payload: string; updated_at: string }>(
          `SELECT payload, updated_at FROM drafts
            WHERE user_id = ? AND kind = ? AND COALESCE(entity_id, 0) = ?`,
          [actor.userId, kind, entityId ?? 0],
        );
        if (!row) return { payload: null, updatedAt: null };
        try {
          return { payload: JSON.parse(row.payload) as unknown, updatedAt: row.updated_at };
        } catch {
          // A draft that will not parse is worse than no draft: it would fail
          // the form on every load. Remove it and start clean.
          c.db.run(
            `DELETE FROM drafts WHERE user_id = ? AND kind = ? AND COALESCE(entity_id, 0) = ?`,
            [actor.userId, kind, entityId ?? 0],
          );
          return { payload: null, updatedAt: null };
        }
      },
    },
    list: {
      perms: [],
      label: 'List unsaved form state',
      handler: ({ c, actor }) => {
        if (!actor) return { rows: [] };
        const rows = c.db.all<{ kind: string; entity_id: number | null; updated_at: string; size: number }>(
          `SELECT kind, entity_id, updated_at, LENGTH(payload) AS size FROM drafts
            WHERE user_id = ? ORDER BY updated_at DESC`,
          [actor.userId],
        );
        return { rows };
      },
    },
    clear: {
      perms: [],
      label: 'Discard unsaved form state',
      handler: ({ c, actor }, input: unknown) => {
        if (!actor) throw unauthenticated('Sign in to discard your work.');
        const v = new Validator(input);
        const kind = v.string('kind', { required: true, max: 60, label: 'Draft type' });
        const entityId = v.optionalInt('entityId');
        v.throwIfInvalid();
        const changes = c.db.run(
          `DELETE FROM drafts WHERE user_id = ? AND kind = ? AND COALESCE(entity_id, 0) = ?`,
          [actor.userId, kind, entityId ?? 0],
        ).changes;
        return { cleared: changes };
      },
    },
  },

  attachments: {
    list: {
      guard: ({ c, actor }, input) => {
        if (!actor) throw unauthenticated();
        const v = new Validator(input);
        assertAttachmentAccess(c, actor, v.enum('ownerType', ['patient', 'visit', 'staff', 'dentist', 'clinic', 'expense'] as const, { required: true }), v.int('ownerId', { required: true, min: 1 }));
      },
      label: 'List attachments',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const ownerType = v.enum('ownerType', ['patient', 'visit', 'staff', 'dentist', 'clinic', 'expense'] as const, { required: true });
        const ownerId = v.int('ownerId', { required: true, min: 1 });
        v.throwIfInvalid();
        return c.db.all(
          'SELECT id, file_name, mime_type, byte_size, description, created_at FROM attachments WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
          [ownerType, ownerId],
        );
      },
    },
    add: {
      perms: ['attachments.add'],
      label: 'Add attachment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const ownerType = v.enum('ownerType', ['patient', 'visit', 'staff', 'dentist', 'clinic', 'expense'] as const, { required: true });
        const ownerId = v.int('ownerId', { required: true, min: 1 });
        const description = v.string('description', { max: 300 });
        const fileName = v.string('fileName', { required: true, max: 200, label: 'File name' });
        const mimeType = v.string('mimeType', { max: 120 });
        const base64 = v.string('dataBase64', { required: true, max: 40_000_000, label: 'File data' });
        v.throwIfInvalid('Choose a file to attach.');

        let buffer: Buffer;
        try {
          buffer = Buffer.from(base64, 'base64');
        } catch {
          throw fieldError([{ field: 'file', message: 'The file could not be read.' }], 'The file could not be read.');
        }
        if (ownerType === 'patient' && !c.db.get('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL', [ownerId])) throw notFound('Patient');
        assertPlainFileName(fileName);
        const stored = storeAttachmentFile(c.paths.attachmentsDir, buffer, mimeType || undefined);
        const id = c.db.insert(
          `INSERT INTO attachments (scope, owner_type, owner_id, file_name, stored_name, mime_type, byte_size, sha256, description, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ownerType, ownerType, ownerId, safeFileName(fileName), stored.storedName, stored.mimeType, stored.byteSize,
            stored.sha256, description, actor?.userId ?? null, nowIso()],
        );
        c.audit(actor, {
          action: 'attachments.add', entity: 'attachment', entityId: id,
          summary: `Attachment "${fileName}" added to ${ownerType} #${ownerId}`,
          metadata: { bytes: stored.byteSize, mime: stored.mimeType },
        });
        return c.db.get('SELECT id, file_name, mime_type, byte_size, description, created_at FROM attachments WHERE id = ?', [id]);
      },
    },
    read: {
      label: 'Read attachment bytes',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        // The row is only read once access has been proven, so a caller without
        // permission cannot even learn that the attachment exists.
        const owner = c.db.get<{ owner_type: string; owner_id: number }>(
          'SELECT owner_type, owner_id FROM attachments WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!owner) throw notFound('Attachment');
        assertAttachmentAccess(c, actor, owner.owner_type, Number(owner.owner_id));
        const row = c.db.get<{ stored_name: string; file_name: string; mime_type: string; description: string; owner_type: string; owner_id: number }>(
          'SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!row) throw notFound('Attachment');
        let data: Buffer;
        try {
          data = readAttachmentFile(c.paths.attachmentsDir, row.stored_name);
        } catch {
          throw new AppError('io_error', 'The stored file is missing from the attachment folder. It may have been removed outside Dentiva Pro.');
        }
        c.audit(actor, { action: 'attachments.open', entity: 'attachment', entityId: id, summary: `Opened "${row.file_name}"` });
        return {
          id,
          fileName: row.file_name,
          mimeType: row.mime_type,
          description: row.description,
          dataBase64: data.toString('base64'),
        };
      },
    },
    path: {
      label: 'Resolve attachment path for the host process',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const row = c.db.get<{ stored_name: string; owner_type: string; owner_id: number; file_name: string }>(
          'SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!row) throw notFound('Attachment');
        assertAttachmentAccess(c, actor, row.owner_type, Number(row.owner_id));
        // Resolved through the same containment primitive that wrote the file,
        // so a tampered stored name cannot reach outside the vault.
        return { path: attachmentPath(c.paths.attachmentsDir, row.stored_name), fileName: row.file_name };
      },
    },
    delete: {
      perms: ['attachments.delete'],
      label: 'Delete attachment',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const row = c.db.get<{ stored_name: string; file_name: string }>(
          'SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL',
          [id],
        );
        if (!row) throw notFound('Attachment');
        c.db.run('UPDATE attachments SET deleted_at = ? WHERE id = ?', [nowIso(), id]);
        try {
          deleteAttachmentFile(c.paths.attachmentsDir, row.stored_name);
        } catch {
          c.logger.warn('attachments.delete.file_failed', { id });
        }
        c.audit(actor, { action: 'attachments.delete', entity: 'attachment', entityId: id, summary: `Attachment "${row.file_name}" deleted` });
        return { ok: true };
      },
    },
    usage: {
      perms: ['settings.view'],
      label: 'Attachment storage usage',
      handler: ({ c }) => {
        const usage = vaultUsage(c.paths.attachmentsDir);
        return { bytes: usage.bytes, files: usage.files, folder: c.paths.attachmentsDir };
      },
    },
  },

  backups: {
    list: {
      perms: ['backup.create'],
      label: 'List backups',
      handler: ({ c }) => ({
        history: backupService(c).history(),
        available: backupService(c).listExisting(),
        folder: c.settings.get('backup.folder') || c.paths.backupDefaultDir,
        frequencyDays: c.settings.get('backup.frequencyDays'),
        retention: c.settings.get('backup.retentionCount'),
        lastAutomaticAt: c.settings.get('backup.lastAutomaticAt'),
      }),
    },
    create: {
      perms: ['backup.create'],
      label: 'Create backup',
      handler: ({ c, actor }) => {
        const result = backupService(c).create('manual', actor);
        return { id: result.id, name: result.name, path: result.path, bytes: result.bytes, createdAt: result.manifest.createdAt };
      },
    },
    validate: {
      perms: ['backup.restore'],
      label: 'Validate a backup',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const path = v.string('path', { required: true, max: 500, label: 'Backup location' });
        v.throwIfInvalid();
        const manifest = backupService(c).validate(path);
        c.audit(actor, { action: 'backup.validate', entity: 'backup', summary: `Backup "${path.split(/[\\/]/).pop()}" validated` });
        return manifest;
      },
    },
    setFolder: {
      perms: ['backup.create'],
      label: 'Set backup folder',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const folder = v.string('folder', { required: true, max: 500, label: 'Backup folder' });
        v.throwIfInvalid();
        backupService(c).setFolder(folder);
        c.audit(actor, { action: 'backup.folder', entity: 'settings', summary: `Backup folder set to ${folder}` });
        return { folder: c.settings.get('backup.folder') };
      },
    },
    restore: {
      perms: ['backup.restore'],
      label: 'Restore from backup',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const path = v.string('path', { required: true, max: 500, label: 'Backup location' });
        const confirmName = v.string('confirmName', { required: true, max: 120, label: 'Confirmation' });
        v.throwIfInvalid('Type the backup name to confirm the restore.');
        const name = path.split(/[\\/]/).pop() ?? '';
        if (name !== confirmName) {
          throw fieldError([{ field: 'confirmName', message: 'Type the backup name exactly to continue.' }], 'Type the backup name exactly to continue.');
        }
        const result = backupService(c).restore(path, actor);
        c.settings.invalidate();
        refreshInvoiceCaches(c);
        c.audit(actor, { action: 'backup.restore', entity: 'backup', summary: `Restored backup "${name}"` });
        return result;
      },
    },
    runAutomatic: {
      perms: ['backup.create'],
      label: 'Run automatic backup if due',
      handler: ({ c, actor }) => {
        const result = backupService(c).runAutomaticIfDue(actor);
        if (result.error) {
          pushNotification(c, {
            kind: 'backup-failed', severity: 'error', title: 'Automatic backup failed',
            body: result.error, dedupeKey: 'backup-auto-failed',
          });
        } else if (result.name) {
          pushNotification(c, {
            kind: 'backup-done', severity: 'success', title: 'Automatic backup completed',
            body: result.name, dedupeKey: '',
          });
        }
        return result;
      },
    },
    remove: {
      perms: ['backup.create'],
      label: 'Delete a backup from disk',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const path = v.string('path', { required: true, max: 500, label: 'Backup location' });
        const confirmName = v.string('confirmName', { required: true, max: 200, label: 'Confirmation' });
        v.throwIfInvalid('Type the backup name to confirm the deletion.');
        const removed = backupService(c).remove(path, confirmName, actor);
        return removed;
      },
    },
  },

  printerProfiles: {
    list: {
      perms: [],
      label: 'List printer profiles',
      handler: ({ c }) => c.db.all('SELECT * FROM printer_profiles ORDER BY doc_kind, is_default DESC, name'),
    },
    papers: {
      public: true,
      label: 'List supported paper sizes',
      handler: () => PAPER_SIZES,
    },
    save: {
      perms: ['settings.manage'],
      label: 'Save printer profile',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.optionalInt('id');
        const name = v.string('name', { required: true, min: 2, max: 60, label: 'Profile name' });
        const docKind = v.enum('docKind', ['prescription', 'invoice', 'receipt', 'patient-summary', 'appointment-slip', 'report'] as const, { required: true });
        const printerName = v.string('printerName', { max: 200 });
        const paperId = v.enum('paperId', ['a4', 'a5', 'letter', 'mini', 'thermal80', 'thermal58', 'custom'] as const, { required: true });
        const paperWidth = v.number('paperWidthMm', { min: 20, max: 1000 });
        const paperHeight = v.number('paperHeightMm', { min: 0, max: 2000 });
        const marginTop = v.number('marginTopMm', { min: 0, max: 60 });
        const marginRight = v.number('marginRightMm', { min: 0, max: 60 });
        const marginBottom = v.number('marginBottomMm', { min: 0, max: 60 });
        const marginLeft = v.number('marginLeftMm', { min: 0, max: 60 });
        const orientation = v.enum('orientation', ['portrait', 'landscape'] as const);
        const fontScale = v.number('fontScale', { min: 0.6, max: 2 });
        const copies = v.int('copies', { min: 1, max: 20 });
        const isDefault = v.bool('isDefault');
        const showClinicalFooter = v.bool('showClinicalFooter', true);
        v.throwIfInvalid('Please correct the highlighted fields.');

        if (c.db.get('SELECT id FROM printer_profiles WHERE name = ? AND doc_kind = ? AND id <> ?', [name, docKind, id ?? -1])) {
          throw businessRule(`A ${docKind} profile named "${name}" already exists.`);
        }
        return c.db.transaction(() => {
          if (isDefault) c.db.run('UPDATE printer_profiles SET is_default = 0 WHERE doc_kind = ?', [docKind]);
          const now = nowIso();
          if (id) {
            if (!c.db.get('SELECT id FROM printer_profiles WHERE id = ?', [id])) throw notFound('Printer profile');
            c.db.run(
              `UPDATE printer_profiles SET name = ?, printer_name = ?, paper_id = ?, paper_width_mm = ?, paper_height_mm = ?,
                 margin_top_mm = ?, margin_right_mm = ?, margin_bottom_mm = ?, margin_left_mm = ?, orientation = ?,
                 font_scale = ?, copies = ?, is_default = ?, show_clinical_footer = ? WHERE id = ?`,
              [name, printerName, paperId, paperWidth, paperHeight, marginTop, marginRight, marginBottom, marginLeft,
                orientation, fontScale, copies, isDefault ? 1 : 0, showClinicalFooter ? 1 : 0, id],
            );
            c.audit(actor, { action: 'printer.profile.update', entity: 'printer_profile', entityId: id, summary: `Printer profile "${name}" updated` });
            return c.db.get('SELECT * FROM printer_profiles WHERE id = ?', [id]);
          }
          const newId = c.db.insert(
            `INSERT INTO printer_profiles (name, doc_kind, printer_name, paper_id, paper_width_mm, paper_height_mm, margin_top_mm,
               margin_right_mm, margin_bottom_mm, margin_left_mm, orientation, font_scale, copies, show_clinical_footer, is_default, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, docKind, printerName, paperId, paperWidth, paperHeight, marginTop, marginRight, marginBottom, marginLeft,
              orientation, fontScale, copies, showClinicalFooter ? 1 : 0, isDefault ? 1 : 0, now],
          );
          c.audit(actor, { action: 'printer.profile.create', entity: 'printer_profile', entityId: newId, summary: `Printer profile "${name}" created` });
          return c.db.get('SELECT * FROM printer_profiles WHERE id = ?', [newId]);
        });
      },
    },
    delete: {
      perms: ['settings.manage'],
      label: 'Delete printer profile',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM printer_profiles WHERE id = ?', [id])) throw notFound('Printer profile');
        c.db.run('DELETE FROM printer_profiles WHERE id = ?', [id]);
        c.audit(actor, { action: 'printer.profile.delete', entity: 'printer_profile', entityId: id, summary: 'Printer profile deleted' });
        return { ok: true };
      },
    },
    resolve: {
      public: true,
      label: 'Resolve the effective print settings for a document',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const docKind = v.enum('docKind', ['prescription', 'invoice', 'receipt', 'patient-summary', 'appointment-slip', 'report'] as const, { required: true });
        const profileId = v.optionalInt('profileId');
        v.throwIfInvalid();
        const profile = profileId
          ? c.db.get('SELECT * FROM printer_profiles WHERE id = ?', [profileId])
          : c.db.get('SELECT * FROM printer_profiles WHERE doc_kind = ? ORDER BY is_default DESC, id LIMIT 1', [docKind]);
        const fallbackPaper = (docKind === 'prescription' ? c.settings.get('print.prescriptionPaper') : c.settings.get('print.invoicePaper')) as PaperSizeId;
        const geometry = PAPER_SIZES[profile ? (profile.paper_id as PaperSizeId) : fallbackPaper] ?? PAPER_SIZES.a4;
        if (profile) {
          return { ...profile, resolvedWidthMm: Number(profile.paper_width_mm) || geometry.width, resolvedHeightMm: Number(profile.paper_height_mm) };
        }
        return {
          id: null, name: 'Default', doc_kind: docKind, printer_name: '', paper_id: geometry.id,
          paper_width_mm: geometry.width, paper_height_mm: geometry.height,
          margin_top_mm: 10, margin_right_mm: 10, margin_bottom_mm: 10, margin_left_mm: 10,
          orientation: 'portrait', font_scale: 1, copies: 1, show_clinical_footer: 1, is_default: 1,
          resolvedWidthMm: geometry.width, resolvedHeightMm: geometry.height,
        };
      },
    },
  },

  printHistory: {
    list: {
      // The signed-in user's own printing activity; each entry already carries
      // the user who produced it.
      guard: ({ actor }) => {
        if (!actor) throw unauthenticated();
      },
      label: 'List print history',
      handler: ({ c }, input: unknown) => {
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 100 });
        const total = c.db.count('SELECT COUNT(*) AS n FROM print_history');
        const rows = c.db.all(
          'SELECT ph.*, u.display_name AS user_name FROM print_history ph LEFT JOIN users u ON u.id = ph.created_by ORDER BY ph.created_at DESC LIMIT ? OFFSET ?',
          [pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    record: {
      guard: ({ actor }) => {
        if (!actor) throw unauthenticated();
      },
      label: 'Record print history',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const docKind = v.enum('docKind', ['prescription', 'invoice', 'receipt', 'patient-summary', 'appointment-slip', 'report'] as const, { required: true });
        const entityId = v.optionalInt('entityId');
        const entityLabel = v.string('entityLabel', { max: 200 });
        const output = v.enum('output', ['preview', 'print', 'pdf'] as const);
        const paperId = v.string('paperId', { max: 24 });
        const path = v.string('path', { max: 600 });
        v.throwIfInvalid();
        const id = c.db.insert(
          'INSERT INTO print_history (doc_kind, entity_id, entity_label, output, paper_id, path, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [docKind, entityId, entityLabel, output, paperId, path, nowIso(), actor?.userId ?? null],
        );
        c.audit(actor, { action: 'print', entity: docKind, entityId: entityId ?? null, summary: `${output} ${docKind}: ${entityLabel}` });
        return { id };
      },
    },
  },

  documents: {
    prescription: {
      perms: ['prescriptions.view'],
      label: 'Prescription print model',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const prescription = c.db.get(
          `SELECT rx.*, p.full_name AS patient_name, p.patient_code, p.gender, p.age_years, p.age_months, p.date_of_birth,
                  p.phone, p.address, p.area, p.district, p.blood_group, p.allergies,
                  d.full_name AS dentist_name, d.title AS dentist_title, d.designations, d.qualifications,
                  d.registration_no, d.consultation_hours, d.degree_prefix, d.signature_attachment_id, d.phone AS dentist_phone,
                  cl.name AS clinic_name, cl.tagline, cl.address_line AS clinic_address, cl.area AS clinic_area,
                  cl.district AS clinic_district, cl.thana AS clinic_thana, cl.postcode AS clinic_postcode,
                  cl.phone AS clinic_phone, cl.alt_phone AS clinic_alt_phone, cl.email AS clinic_email,
                  cl.website, cl.footer_message, cl.logo_attachment_id, cl.business_start, cl.business_end
             FROM prescriptions rx
             JOIN patients p ON p.id = rx.patient_id
             LEFT JOIN dentists d ON d.id = rx.dentist_id
             CROSS JOIN clinic cl
            WHERE rx.id = ? AND rx.deleted_at IS NULL`,
          [id],
        );
        if (!prescription) throw notFound('Prescription');
        const items = c.db.all('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order, id', [id]);
        return {
          prescription,
          items,
          footerMessage: c.settings.get('print.prescriptionFooter') || '',
          clinic: readClinic(c),
          settings: { bengaliNumerals: c.settings.get('display.bengaliNumerals'), dateFormat: c.settings.get('format.dateFormat'), timeFormat: c.settings.get('format.timeFormat') },
        };
      },
    },
    patientSummary: {
      perms: ['clinical.view'],
      label: 'Patient summary print model',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const patientId = v.int('patientId', { required: true, min: 1 });
        v.throwIfInvalid();
        const patient = c.db.get(
          'SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL',
          [patientId],
        );
        if (!patient) throw notFound('Patient');
        const visits = c.db.all(
          `SELECT v.*, d.full_name AS dentist_name FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id
            WHERE v.patient_id = ? AND v.deleted_at IS NULL ORDER BY v.visit_date DESC, v.id DESC LIMIT 50`,
          [patientId],
        );
        const prescriptions = c.db.all(
          `SELECT rx.id, rx.prescription_no, rx.issue_date, rx.cc, d.full_name AS dentist_name,
                  (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = rx.id) AS item_count
             FROM prescriptions rx LEFT JOIN dentists d ON d.id = rx.dentist_id
            WHERE rx.patient_id = ? AND rx.deleted_at IS NULL ORDER BY rx.issue_date DESC LIMIT 20`,
          [patientId],
        );
        const treatments = c.db.all(
          `SELECT tr.*, d.full_name AS dentist_name FROM treatment_records tr LEFT JOIN dentists d ON d.id = tr.performed_by
            WHERE tr.patient_id = ? ORDER BY tr.performed_at DESC LIMIT 50`,
          [patientId],
        );
        const chart = c.db.all('SELECT * FROM current_tooth_chart WHERE patient_id = ? ORDER BY dentition, tooth_code', [patientId]);
        const hasMoney = c.db.get<{ n: number }>('SELECT 1 AS n FROM users WHERE 1 = 0');
        void hasMoney;
        return {
          patient,
          visits,
          prescriptions,
          treatments,
          chart,
          financial: patientFinancialSummary(c, patientId),
          clinic: readClinic(c),
        };
      },
    },
    appointmentSlip: {
      perms: ['appointments.view'],
      label: 'Appointment slip print model',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const row = c.db.get(
          `SELECT a.*, p.full_name AS patient_name, p.patient_code, p.phone, p.gender, p.age_years, p.age_months, p.date_of_birth,
                  d.full_name AS dentist_name, d.title AS dentist_title, d.designations
             FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
            WHERE a.id = ? AND a.deleted_at IS NULL`,
          [id],
        );
        if (!row) throw notFound('Appointment');
        return { appointment: row, clinic: readClinic(c) };
      },
    },
    report: {
      label: 'Report print model',
      // The required permission depends on which report is being produced, so
      // it is resolved from the payload at the service boundary.
      guard: ({ actor }, input: unknown) => {
        const body = (input ?? {}) as Record<string, unknown>;
        const kind = typeof body.kind === 'string' ? body.kind : '';
        const needed = REPORT_PERMISSION[kind] ?? ['reports.view'];
        if (!actor || !needed.some((perm) => actor.permissions.has(perm))) {
          throw permissionDenied(`The "${kind || 'requested'}" report needs the "${needed[0]}" permission.`);
        }
      },
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const kind = v.enum('kind', ['daily-summary', 'payment-summary', 'collection', 'treatment-revenue', 'outstanding', 'inventory', 'expense', 'income', 'patient-list', 'audit'] as const, { required: true });
        const { from, to } = dateRangeFrom(input);
        const toDate = to ?? toLocalDateKey(new Date());
        const fromDate = from ?? toDate;
        const limit = Math.min(2000, v.int('limit', { min: 1, max: 2000, label: 'Limit' }) || 500);
        const params: (string | number)[] = [fromDate, toDate];
        let columns: { key: string; label: string; numeric?: boolean }[] = [];
        let rows: Record<string, unknown>[] = [];
        let totals: { label: string; valuePoisha: number }[] = [];

        switch (kind) {
          case 'payment-summary':
            columns = [
              { key: 'payment_no', label: 'Receipt' }, { key: 'payment_date', label: 'Date' },
              { key: 'patient_name', label: 'Patient' }, { key: 'method', label: 'Method' },
              { key: 'amount_poisha', label: 'Amount', numeric: true }, { key: 'received_by_name', label: 'Received by' },
            ];
            rows = c.db.all(
              `SELECT pay.payment_no, pay.payment_date, pay.payment_date AS date, p.full_name AS patient_name, pay.method,
                      pay.amount_poisha, pay.type, COALESCE(u.display_name,'') AS received_by_name
                 FROM payments pay JOIN patients p ON p.id = pay.patient_id LEFT JOIN users u ON u.id = pay.received_by
                WHERE pay.deleted_at IS NULL AND pay.payment_date BETWEEN ? AND ? ORDER BY pay.payment_date DESC LIMIT ?`,
              [...params, limit],
            );
            totals = [
              { label: 'Total received', valuePoisha: rows.filter((r) => r.type === 'receipt').reduce((a, r) => a + Number(r.amount_poisha), 0) },
              { label: 'Total refunded', valuePoisha: Math.abs(rows.filter((r) => r.type === 'refund').reduce((a, r) => a + Number(r.amount_poisha), 0)) },
            ];
            break;
          case 'collection':
            columns = [
              { key: 'issue_date', label: 'Date' }, { key: 'invoice_no', label: 'Invoice' },
              { key: 'patient_name', label: 'Patient' }, { key: 'grand_total_poisha', label: 'Total', numeric: true },
              { key: 'paid_poisha', label: 'Paid', numeric: true }, { key: 'balance_poisha', label: 'Balance', numeric: true },
            ];
            rows = c.db.all(
              `SELECT i.issue_date, i.invoice_no, p.full_name AS patient_name, i.grand_total_poisha, i.paid_poisha,
                      (i.grand_total_poisha - i.paid_poisha) AS balance_poisha
                 FROM invoices i JOIN patients p ON p.id = i.patient_id
                WHERE i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.issue_date BETWEEN ? AND ?
                ORDER BY i.issue_date DESC LIMIT ?`,
              [...params, limit],
            );
            totals = [
              { label: 'Total invoiced', valuePoisha: rows.reduce((a, r) => a + Number(r.grand_total_poisha), 0) },
              { label: 'Total collected', valuePoisha: rows.reduce((a, r) => a + Number(r.paid_poisha), 0) },
              { label: 'Total outstanding', valuePoisha: rows.reduce((a, r) => a + Number(r.balance_poisha), 0) },
            ];
            break;
          case 'outstanding':
            columns = [
              { key: 'patient_code', label: 'Code' }, { key: 'patient_name', label: 'Patient' },
              { key: 'phone', label: 'Phone' }, { key: 'last_invoice', label: 'Last invoice' },
              { key: 'invoices', label: 'Invoices', numeric: true }, { key: 'outstanding_poisha', label: 'Outstanding', numeric: true },
            ];
            rows = c.db.all(
              `SELECT p.patient_code, p.full_name AS patient_name, p.phone, MAX(i.issue_date) AS last_invoice,
                      COUNT(i.id) AS invoices, SUM(i.grand_total_poisha - i.paid_poisha) AS outstanding_poisha
                 FROM patients p JOIN invoices i ON i.patient_id = p.id
                WHERE i.deleted_at IS NULL AND i.status <> 'cancelled' AND (i.grand_total_poisha - i.paid_poisha) > 0
                GROUP BY p.id ORDER BY outstanding_poisha DESC LIMIT ?`,
              [limit],
            );
            totals = [{ label: 'Total outstanding', valuePoisha: rows.reduce((a, r) => a + Number(r.outstanding_poisha), 0) }];
            break;
          case 'treatment-revenue':
            columns = [
              { key: 'description', label: 'Treatment' }, { key: 'count', label: 'Times', numeric: true },
              { key: 'total_poisha', label: 'Revenue', numeric: true },
            ];
            rows = c.db.all(
              `SELECT ii.description, COUNT(*) AS count, SUM(ii.line_total_poisha) AS total_poisha
                 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                WHERE i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.issue_date BETWEEN ? AND ?
                GROUP BY ii.description ORDER BY total_poisha DESC LIMIT ?`,
              [...params, limit],
            );
            totals = [{ label: 'Total revenue', valuePoisha: rows.reduce((a, r) => a + Number(r.total_poisha), 0) }];
            break;
          case 'expense':
            columns = [
              { key: 'entry_date', label: 'Date' }, { key: 'category_name', label: 'Category' },
              { key: 'description', label: 'Description' }, { key: 'vendor', label: 'Vendor' },
              { key: 'method', label: 'Method' }, { key: 'amount_poisha', label: 'Amount', numeric: true },
            ];
            rows = c.db.all(
              `SELECT e.entry_date, COALESCE(ec.name,'Uncategorised') AS category_name, e.description, e.vendor, e.method, e.amount_poisha
                 FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
                WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date DESC LIMIT ?`,
              [...params, limit],
            );
            totals = [{ label: 'Total expenses', valuePoisha: rows.reduce((a, r) => a + Number(r.amount_poisha), 0) }];
            break;
          case 'income':
            columns = [
              { key: 'entry_date', label: 'Date' }, { key: 'category_name', label: 'Category' },
              { key: 'description', label: 'Description' }, { key: 'method', label: 'Method' },
              { key: 'amount_poisha', label: 'Amount', numeric: true },
            ];
            rows = c.db.all(
              `SELECT e.entry_date, COALESCE(ic.name,'Other') AS category_name, e.description, e.method, e.amount_poisha
                 FROM income_entries e LEFT JOIN income_categories ic ON ic.id = e.category_id
                WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date DESC LIMIT ?`,
              [...params, limit],
            );
            totals = [{ label: 'Total income', valuePoisha: rows.reduce((a, r) => a + Number(r.amount_poisha), 0) }];
            break;
          case 'inventory': {
            columns = [
              { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' },
              { key: 'unit', label: 'Unit' }, { key: 'current_stock', label: 'Stock', numeric: true },
              { key: 'min_stock', label: 'Minimum', numeric: true }, { key: 'next_expiry', label: 'Next expiry' },
            ];
            rows = c.db.all(
              `SELECT sku, name, category, unit, current_stock, min_stock,
                      (SELECT MIN(b.expiry_date) FROM inventory_batches b WHERE b.item_id = inventory_items.id AND (b.quantity_received - b.quantity_issued) > 0) AS next_expiry
                 FROM inventory_items WHERE is_active = 1 ORDER BY name LIMIT ?`,
              [limit],
            );
            break;
          }
          case 'patient-list':
            columns = [
              { key: 'patient_code', label: 'Code' }, { key: 'full_name', label: 'Name' },
              { key: 'gender', label: 'Gender' }, { key: 'age_years', label: 'Age', numeric: true },
              { key: 'phone', label: 'Phone' }, { key: 'area', label: 'Area' }, { key: 'last_visit_at', label: 'Last visit' },
            ];
            rows = c.db.all(
              `SELECT patient_code, full_name, gender, age_years, age_months, phone, area, last_visit_at, created_at
                 FROM patients WHERE deleted_at IS NULL AND date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC LIMIT ?`,
              [...params, limit],
            );
            break;
          case 'audit':
            columns = [
              { key: 'at', label: 'Time' }, { key: 'username', label: 'User' }, { key: 'action', label: 'Action' },
              { key: 'entity', label: 'Entity' }, { key: 'summary', label: 'Summary' }, { key: 'result', label: 'Result' },
            ];
            rows = c.db.all(
              'SELECT at, username, action, entity, entity_id, summary, result FROM audit_logs WHERE date(at) BETWEEN ? AND ? ORDER BY at DESC LIMIT ?',
              [...params, limit],
            );
            break;
          case 'daily-summary':
          default:
            columns = [
              { key: 'day', label: 'Date' }, { key: 'income_poisha', label: 'Income', numeric: true },
              { key: 'expense_poisha', label: 'Expenses', numeric: true },
              { key: 'invoiced_poisha', label: 'Invoiced', numeric: true },
            ];
            rows = c.db.all(
              `SELECT d.day,
                      (SELECT COALESCE(SUM(amount_poisha), 0) FROM income_entries WHERE deleted_at IS NULL AND entry_date = d.day) AS income_poisha,
                      (SELECT COALESCE(SUM(amount_poisha), 0) FROM expenses WHERE deleted_at IS NULL AND entry_date = d.day) AS expense_poisha,
                      (SELECT COALESCE(SUM(grand_total_poisha), 0) FROM invoices WHERE deleted_at IS NULL AND status <> 'cancelled' AND issue_date = d.day) AS invoiced_poisha
                 FROM (
                   SELECT entry_date AS day FROM income_entries WHERE deleted_at IS NULL AND entry_date BETWEEN ? AND ?
                   UNION SELECT entry_date FROM expenses WHERE deleted_at IS NULL AND entry_date BETWEEN ? AND ?
                   UNION SELECT issue_date FROM invoices WHERE deleted_at IS NULL AND issue_date BETWEEN ? AND ?
                 ) d ORDER BY d.day LIMIT ?`,
              [fromDate, toDate, fromDate, toDate, fromDate, toDate, limit],
            );
            totals = [
              { label: 'Income', valuePoisha: rows.reduce((a, r) => a + Number(r.income_poisha), 0) },
              { label: 'Expenses', valuePoisha: rows.reduce((a, r) => a + Number(r.expense_poisha), 0) },
            ];
            break;
        }

        return { kind, from: fromDate, to: toDate, columns, rows, totals, clinic: readClinic(c), generatedAt: nowIso() };
      },
    },
    invoice: {
      perms: ['invoices.view'],
      label: 'Invoice print model',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const { invoice, items, allocations } = getInvoiceModel(c, id);
        return {
          invoice,
          items,
          allocations,
          clinic: readClinic(c),
          showDentist: c.settings.get('print.showDentistOnInvoice'),
          footerMessage: c.settings.get('print.invoiceFooter') || '',
        };
      },
    },
  },

  exports: {
    csv: {
      label: 'Export rows as CSV',
      // The permission that applies depends on which dataset is being exported, so
      // the check happens at the service boundary rather than in the UI.
      guard: ({ actor }, input: unknown) => {
        const body = (input ?? {}) as Record<string, unknown>;
        const dataset = typeof body.dataset === 'string' ? body.dataset : '';
        const needed = EXPORT_PERMISSION[dataset] ?? ['reports.view'];
        if (!actor || !needed.every((perm) => actor.permissions.has(perm))) {
          throw permissionDenied(`Exporting ${dataset || 'this data'} needs the "${needed[0]}" permission.`);
        }
      },
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const dataset = v.enum('dataset', ['patients', 'invoices', 'payments', 'inventory', 'expenses', 'income', 'appointments', 'prescriptions'] as const, { required: true });
        const { from, to } = dateRangeFrom(input);
        v.throwIfInvalid();
        const { columns, rows } = exportDataset(c, dataset, from, to);
        const csv = toCsv(columns, rows);
        return { filename: `DentivaPro-${dataset}-${toLocalDateKey(new Date())}.csv`, content: csv, rows: rows.length };
      },
    },
  },

  maintenance: {
    wipe: {
      perms: ['system.wipe'],
      label: 'Erase all application data',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        // Compared without trimming: erasing the entire database must not be one
        // stray keystroke away from a paste that gained a space in the clipboard.
        const confirmation = v.raw('confirmation');
        if (typeof confirmation !== 'string' || confirmation !== 'DELETE') {
          throw fieldError([{ field: 'confirmation', message: 'Type DELETE to confirm.' }], 'Type DELETE to confirm.');
        }
        // A safety copy first: erasing every record is the one operation in the
        // product that cannot be undone from inside it.
        let preWipeBackup: string | null = null;
        try {
          preWipeBackup = backupService(c).create('pre-restore', actor).name;
        } catch (error) {
          throw new AppError(
            'backup_error',
            `A safety backup could not be created, so nothing was erased. Check the backup folder and try again. (${(error as Error).message})`,
            { cause: error },
          );
        }

        c.audit(actor, {
          action: 'system.wipe', entity: 'app_state', summary: 'All application data erased',
          metadata: { preWipeBackup },
        });
        const tables = c.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
        c.db.transaction(() => {
          for (const table of tables) {
            if (table.name === 'schema_migrations') continue;
            c.db.run(`DELETE FROM "${table.name}"`);
          }
        });
        c.settings.invalidate();
        c.settings.set('app.setupCompleted', false);
        c.db.run("DELETE FROM app_state WHERE key LIKE 'activation.%'");
        c.settings.invalidate();
        // Patient files are part of the clinic's data, not a cache.
        rmSync(c.paths.attachmentsDir, { recursive: true, force: true });
        mkdirSync(c.paths.attachmentsDir, { recursive: true });
        c.db.vacuum();
        return { ok: true, preWipeBackup };
      },
    },
    run: {
      perms: ['settings.manage'],
      label: 'Database maintenance',
      handler: ({ c, actor }) => {
        const before = c.db.get<{ page_count: number; freelist_count: number }>('PRAGMA page_count');
        c.db.vacuum();
        const integrity = c.integrityCheck();
        c.audit(actor, { action: 'system.maintenance', entity: 'app_state', summary: 'Database maintenance run' });
        return { ok: integrity.ok, before, integrity };
      },
    },
  },
};

function readClinic(c: Container): Record<string, unknown> {
  return c.db.get('SELECT * FROM clinic WHERE id = 1') ?? {};
}

function assertAttachmentAccess(c: Container, actor: Actor | null, ownerType: string, ownerId: number): void {
  if (!actor) throw new AppError('unauthenticated', 'Your session has ended. Please sign in again.');
  if (ownerType === 'patient') {
    if (!actor.permissions.has('patients.view')) throw new AppError('permission_denied', 'You do not have permission to view this patient.');
  } else if (ownerType === 'visit') {
    if (!actor.permissions.has('clinical.view')) throw new AppError('permission_denied', 'You do not have permission to view clinical attachments.');
  } else if (ownerType === 'expense') {
    if (!actor.permissions.has('accounting.view')) throw new AppError('permission_denied', 'You do not have permission to view financial attachments.');
  } else if (ownerType === 'staff') {
    if (!actor.permissions.has('staff.view')) throw new AppError('permission_denied', 'You do not have permission to view staff records.');
  } else if (!actor.permissions.has('settings.view')) {
    throw new AppError('permission_denied', 'You do not have permission to view this document.');
  }
  void c;
  void ownerId;
}

export function pushNotification(
  c: Container,
  input: { kind: string; severity: (typeof SEVERITIES)[number]; title: string; body: string; entity?: string; entityId?: number; actionRoute?: string; dedupeKey?: string },
): void {
  try {
    c.db.run(
      `INSERT OR IGNORE INTO notifications (kind, severity, title, body, entity, entity_id, action_route, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.kind, input.severity, input.title, input.body, input.entity ?? '', input.entityId ?? null, input.actionRoute ?? '', input.dedupeKey ?? '', nowIso()],
    );
  } catch {
    /* a notification must never break the operation that raised it */
  }
}

function refreshGeneratedNotifications(c: Container): void {
  const today = toLocalDateKey(new Date());
  const lowStock = c.db.all<{ id: number; name: string; current_stock: number; min_stock: number }>(
    'SELECT id, name, current_stock, min_stock FROM inventory_items WHERE is_active = 1 AND current_stock <= min_stock LIMIT 20',
  );
  for (const item of lowStock) {
    pushNotification(c, {
      kind: 'low-stock', severity: item.current_stock <= 0 ? 'error' : 'warning',
      title: item.current_stock <= 0 ? `Out of stock: ${item.name}` : `Low stock: ${item.name}`,
      body: `${item.current_stock} remaining (minimum ${item.min_stock})`,
      entity: 'inventory_item', entityId: item.id, actionRoute: `billing/inventory/${item.id}`,
      dedupeKey: `low-stock-${item.id}-${today}`,
    });
  }
  const alertDays = c.settings.get('inventory.expiryAlertDays');
  const expiring = c.db.all<{ batch_id: number; name: string; expiry_date: string; quantity: number }>(
    `SELECT b.id AS batch_id, i.name, b.expiry_date, (b.quantity_received - b.quantity_issued) AS quantity
       FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
      WHERE (b.quantity_received - b.quantity_issued) > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= date('now', '+${Number(alertDays)} days')
      LIMIT 20`,
  );
  for (const batch of expiring) {
    const expired = batch.expiry_date < today;
    pushNotification(c, {
      kind: expired ? 'expired-stock' : 'expiring-stock', severity: expired ? 'error' : 'warning',
      title: `${expired ? 'Expired' : 'Expiring soon'}: ${batch.name}`,
      body: `${batch.quantity} unit(s) · ${expired ? 'expired on' : 'expires'} ${batch.expiry_date}`,
      entity: 'inventory_batch', entityId: batch.batch_id, actionRoute: 'billing/inventory',
      dedupeKey: `expiry-${batch.batch_id}`,
    });
  }
  const upcoming = c.db.all<{ id: number; appointment_date: string; start_time: string; patient_name: string }>(
    `SELECT a.id, a.appointment_date, a.start_time, p.full_name AS patient_name FROM appointments a
       JOIN patients p ON p.id = a.patient_id
      WHERE a.deleted_at IS NULL AND a.status IN ('scheduled','confirmed') AND a.appointment_date = ? LIMIT 20`,
    [today],
  );
  for (const appt of upcoming) {
    pushNotification(c, {
      kind: 'upcoming-appointment', severity: 'info',
      title: `Appointment at ${appt.start_time}`,
      body: appt.patient_name,
      entity: 'appointment', entityId: appt.id, actionRoute: `appointments?highlight=${appt.id}`,
      dedupeKey: `appt-${appt.id}`,
    });
  }
  const waiting = c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM queue_entries WHERE queue_date = ? AND status = 'waiting'", [today]);
  if (Number(waiting?.n ?? 0) > 0) {
    pushNotification(c, {
      kind: 'queue', severity: 'info', title: `${waiting?.n} patient(s) waiting in the queue`,
      body: 'Open the Queue to call the next patient.', actionRoute: 'queue', dedupeKey: `queue-${today}`,
    });
  }
  const lastBackup = c.db.get<{ created_at: string; status: string }>(
    "SELECT created_at, status FROM backups WHERE status = 'success' ORDER BY created_at DESC LIMIT 1",
  );
  if (!lastBackup) {
    pushNotification(c, {
      kind: 'backup', severity: 'warning', title: 'No backup has been created yet',
      body: 'Create a backup to protect your clinic data.', actionRoute: 'administration/backup', dedupeKey: 'backup-none',
    });
  }
  const failed = c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM backups WHERE status = 'failed' AND created_at >= datetime('now','-7 days')");
  if (Number(failed?.n ?? 0) > 0) {
    pushNotification(c, {
      kind: 'backup-failed', severity: 'error', title: `${failed?.n} backup attempt(s) failed in the last 7 days`,
      body: 'Open Backup & Restore to review and fix the backup folder.', actionRoute: 'administration/backup',
      dedupeKey: 'backup-failed',
    });
  }
  const lockedOut = c.db.all<{ username: string }>("SELECT username FROM users WHERE locked_until IS NOT NULL AND locked_until > datetime('now')");
  for (const user of lockedOut) {
    pushNotification(c, {
      kind: 'security', severity: 'warning', title: `Account locked: ${user.username}`,
      body: 'Too many failed sign-in attempts.', actionRoute: 'administration/users', dedupeKey: `locked-${user.username}`,
    });
  }
}

function refreshInvoiceCaches(c: Container): void {
  const rows = c.db.all<{ id: number }>('SELECT id FROM invoices WHERE deleted_at IS NULL');
  c.db.transaction(() => {
    for (const row of rows) refreshInvoiceTotals(c, row.id);
  });
}

/** Which permission unlocks each report. Checked before any rows are read. */
const REPORT_PERMISSION: Record<string, Permission[]> = {
  'daily-summary': ['accounting.view'],
  'payment-summary': ['payments.view'],
  collection: ['invoices.view'],
  'treatment-revenue': ['treatments.view'],
  outstanding: ['payments.view'],
  inventory: ['inventory.view'],
  expense: ['accounting.view'],
  income: ['accounting.view'],
  'patient-list': ['patients.view'],
  audit: ['audit.view'],
};

/** Which permission unlocks each exportable dataset. Checked before any rows are read. */
const EXPORT_PERMISSION: Record<string, Permission[]> = {
  patients: ['patients.export', 'patients.view'],
  invoices: ['invoices.view'],
  payments: ['payments.view'],
  inventory: ['inventory.view'],
  expenses: ['accounting.view'],
  income: ['accounting.view'],
  appointments: ['appointments.view'],
  prescriptions: ['prescriptions.view'],
};

function exportDataset(
  c: Container,
  dataset: string,
  from: string | null,
  to: string | null,
): { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] } {
  const toDate = to ?? toLocalDateKey(new Date());
  const fromDate = from ?? `${toDate.slice(0, 4)}-01-01`;
  switch (dataset) {
    case 'patients':
      return {
        columns: [
          { key: 'patient_code', label: 'Code' }, { key: 'full_name', label: 'Name' }, { key: 'gender', label: 'Gender' },
          { key: 'age_years', label: 'Age' }, { key: 'phone', label: 'Phone' }, { key: 'address', label: 'Address' },
          { key: 'created_at', label: 'Registered' },
        ],
        rows: c.db.all(
          'SELECT patient_code, full_name, gender, age_years, phone, address, created_at FROM patients WHERE deleted_at IS NULL ORDER BY patient_code LIMIT 100000',
        ),
      };
    case 'invoices':
      return {
        columns: [
          { key: 'invoice_no', label: 'Invoice' }, { key: 'issue_date', label: 'Date' }, { key: 'patient_name', label: 'Patient' },
          { key: 'patient_code', label: 'Code' }, { key: 'grand_total_poisha', label: 'Total (poisha)' },
          { key: 'paid_poisha', label: 'Paid (poisha)' }, { key: 'status', label: 'Status' },
        ],
        rows: c.db.all(
          `SELECT i.invoice_no, i.issue_date, p.full_name AS patient_name, p.patient_code, i.grand_total_poisha, i.paid_poisha, i.status
             FROM invoices i JOIN patients p ON p.id = i.patient_id
            WHERE i.deleted_at IS NULL AND i.issue_date BETWEEN ? AND ? ORDER BY i.issue_date DESC LIMIT 100000`,
          [fromDate, toDate],
        ),
      };
    case 'payments':
      return {
        columns: [
          { key: 'payment_no', label: 'Receipt' }, { key: 'payment_date', label: 'Date' }, { key: 'patient_name', label: 'Patient' },
          { key: 'method', label: 'Method' }, { key: 'amount_poisha', label: 'Amount (poisha)' }, { key: 'type', label: 'Type' },
        ],
        rows: c.db.all(
          `SELECT pay.payment_no, pay.payment_date, p.full_name AS patient_name, pay.method, pay.amount_poisha, pay.type
             FROM payments pay JOIN patients p ON p.id = pay.patient_id
            WHERE pay.deleted_at IS NULL AND pay.payment_date BETWEEN ? AND ? ORDER BY pay.payment_date DESC LIMIT 100000`,
          [fromDate, toDate],
        ),
      };
    case 'inventory':
      return {
        columns: [
          { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' },
          { key: 'current_stock', label: 'Stock' }, { key: 'min_stock', label: 'Minimum' }, { key: 'unit', label: 'Unit' },
        ],
        rows: c.db.all('SELECT sku, name, category, current_stock, min_stock, unit FROM inventory_items WHERE is_active = 1 ORDER BY name LIMIT 100000'),
      };
    case 'expenses':
      return {
        columns: [
          { key: 'entry_date', label: 'Date' }, { key: 'category_name', label: 'Category' }, { key: 'description', label: 'Description' },
          { key: 'vendor', label: 'Vendor' }, { key: 'method', label: 'Method' }, { key: 'amount_poisha', label: 'Amount (poisha)' },
        ],
        rows: c.db.all(
          `SELECT e.entry_date, COALESCE(ec.name,'Uncategorised') AS category_name, e.description, e.vendor, e.method, e.amount_poisha
             FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
            WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date DESC LIMIT 100000`,
          [fromDate, toDate],
        ),
      };
    case 'income':
      return {
        columns: [
          { key: 'entry_date', label: 'Date' }, { key: 'category_name', label: 'Category' }, { key: 'description', label: 'Description' },
          { key: 'method', label: 'Method' }, { key: 'amount_poisha', label: 'Amount (poisha)' },
        ],
        rows: c.db.all(
          `SELECT e.entry_date, COALESCE(ic.name,'Other') AS category_name, e.description, e.method, e.amount_poisha
             FROM income_entries e LEFT JOIN income_categories ic ON ic.id = e.category_id
            WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date DESC LIMIT 100000`,
          [fromDate, toDate],
        ),
      };
    case 'appointments':
      return {
        columns: [
          { key: 'appointment_date', label: 'Date' }, { key: 'start_time', label: 'Time' }, { key: 'patient_name', label: 'Patient' },
          { key: 'dentist_name', label: 'Dentist' }, { key: 'appointment_type', label: 'Type' }, { key: 'status', label: 'Status' },
        ],
        rows: c.db.all(
          `SELECT a.appointment_date, a.start_time, p.full_name AS patient_name, d.full_name AS dentist_name, a.appointment_type, a.status
             FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
            WHERE a.deleted_at IS NULL AND a.appointment_date BETWEEN ? AND ? ORDER BY a.appointment_date DESC, a.start_time LIMIT 100000`,
          [fromDate, toDate],
        ),
      };
    case 'prescriptions':
    default:
      return {
        columns: [
          { key: 'prescription_no', label: 'Rx' }, { key: 'issue_date', label: 'Date' }, { key: 'patient_name', label: 'Patient' },
          { key: 'dentist_name', label: 'Dentist' }, { key: 'cc', label: 'C/C' }, { key: 'advice', label: 'Advice' },
        ],
        rows: c.db.all(
          `SELECT rx.prescription_no, rx.issue_date, p.full_name AS patient_name, d.full_name AS dentist_name, rx.cc, rx.advice
             FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id LEFT JOIN dentists d ON d.id = rx.dentist_id
            WHERE rx.deleted_at IS NULL AND rx.issue_date BETWEEN ? AND ? ORDER BY rx.issue_date DESC LIMIT 100000`,
          [fromDate, toDate],
        ),
      };
  }
}

export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(',')).join('\n');
  // UTF-8 BOM so Excel renders Bengali correctly.
  return `﻿${head}${body ? `\n${body}` : ''}\n`;
}
