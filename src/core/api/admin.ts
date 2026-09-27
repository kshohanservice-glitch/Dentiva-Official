import { nowIso } from '../db/connection';
import { fieldError, notFound, conflict, businessRule, AppError } from '../errors';
import { Validator } from '../validation/validate';
import { hashPassword, checkPasswordPolicy, verifyPassword } from '../security/password';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSIONS, ADMIN_ONLY_PERMISSIONS, type Permission } from '../../shared/permissions';
import { readPaging, paginate, dateRangeFrom } from './patients';
import { passwordPolicyFrom } from './system';
import type { ApiSpec } from '../registry';

const GENDERS = ['', 'male', 'female', 'other'] as const;
const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const STAFF_STATUSES = ['active', 'inactive', 'resigned'] as const;

export const adminApi: ApiSpec = {
  staff: {
    list: {
      perms: ['staff.view'],
      label: 'List staff',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        const status = v.enum('status', ['', ...STAFF_STATUSES] as const);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (status) { where.push('status = ?'); params.push(status); }
        if (search) {
          where.push('(full_name LIKE ? COLLATE NOCASE OR phone LIKE ? OR position LIKE ? COLLATE NOCASE OR national_id LIKE ?)');
          params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = c.db.count(`SELECT COUNT(*) AS n FROM staff ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT s.*, u.username, u.status AS user_status FROM staff s LEFT JOIN users u ON u.id = s.user_id
             ${whereSql} ORDER BY s.full_name COLLATE NOCASE LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    get: {
      perms: ['staff.view'],
      label: 'Read staff record',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const staff = c.db.get(
          `SELECT s.*, u.username, u.status AS user_status, u.last_login_at FROM staff s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
          [id],
        );
        if (!staff) throw notFound('Staff member');
        return staff;
      },
    },
    create: {
      perms: ['staff.manage'],
      label: 'Create staff record',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const fullName = v.string('fullName', { required: true, min: 2, max: 120, label: 'Full name' });
        const dateOfBirth = v.optionalString('dateOfBirth', 10);
        const gender = v.enum('gender', GENDERS);
        const address = v.string('address', { max: 300 });
        const phone = v.phone('phone');
        const bloodGroup = v.enum('bloodGroup', BLOOD_GROUPS);
        const nationalId = v.optionalString('nationalId', 40);
        const position = v.string('position', { max: 80 });
        const department = v.string('department', { max: 80 });
        const joiningDate = v.optionalString('joiningDate', 10);
        const salary = v.int('salaryPoisha', { min: 0, max: 100000000000 });
        const notes = v.string('notes', { max: 1000 });
        v.throwIfInvalid('Please correct the highlighted fields.');
        if (nationalId && c.db.get('SELECT id FROM staff WHERE national_id = ?', [nationalId])) {
          throw conflict('That national ID is already recorded for another staff member.');
        }
        const now = nowIso();
        const id = c.db.insert(
          `INSERT INTO staff (full_name, date_of_birth, gender, address, phone, blood_group, national_id, position, department,
             joining_date, salary_poisha, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          [fullName, dateOfBirth || null, gender, address, phone, bloodGroup, nationalId || null, position, department,
            joiningDate || null, salary, notes, now, now],
        );
        c.audit(actor, { action: 'staff.create', entity: 'staff', entityId: id, summary: `Staff record "${fullName}" created` });
        return c.db.get('SELECT * FROM staff WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['staff.manage'],
      label: 'Update staff record',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const fullName = v.string('fullName', { required: true, min: 2, max: 120, label: 'Full name' });
        const dateOfBirth = v.optionalString('dateOfBirth', 10);
        const gender = v.enum('gender', GENDERS);
        const address = v.string('address', { max: 300 });
        const phone = v.phone('phone');
        const bloodGroup = v.enum('bloodGroup', BLOOD_GROUPS);
        const nationalId = v.optionalString('nationalId', 40);
        const position = v.string('position', { max: 80 });
        const department = v.string('department', { max: 80 });
        const joiningDate = v.optionalString('joiningDate', 10);
        const salary = v.int('salaryPoisha', { min: 0, max: 100000000000 });
        const status = v.enum('status', STAFF_STATUSES);
        const notes = v.string('notes', { max: 1000 });
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM staff WHERE id = ?', [id])) throw notFound('Staff member');
        if (nationalId && c.db.get('SELECT id FROM staff WHERE national_id = ? AND id <> ?', [nationalId, id])) {
          throw conflict('That national ID is already recorded for another staff member.');
        }
        c.db.run(
          `UPDATE staff SET full_name = ?, date_of_birth = ?, gender = ?, address = ?, phone = ?, blood_group = ?,
             national_id = ?, position = ?, department = ?, joining_date = ?, salary_poisha = ?, status = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
          [fullName, dateOfBirth || null, gender, address, phone, bloodGroup, nationalId || null, position, department,
            joiningDate || null, salary, status, notes, nowIso(), id],
        );
        c.audit(actor, { action: 'staff.update', entity: 'staff', entityId: id, summary: `Staff record "${fullName}" updated` });
        return c.db.get('SELECT * FROM staff WHERE id = ?', [id]);
      },
    },
    delete: {
      perms: ['staff.manage'],
      label: 'Delete staff record',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const linked = c.db.get<{ username: string }>('SELECT username FROM users WHERE staff_id = ?', [id]);
        if (linked) {
          throw businessRule(`This staff member is linked to the user account "${linked.username}". Disable the account instead.`);
        }
        const row = c.db.get<{ full_name: string }>('SELECT full_name FROM staff WHERE id = ?', [id]);
        if (!row) throw notFound('Staff member');
        c.db.run('DELETE FROM staff WHERE id = ?', [id]);
        c.audit(actor, { action: 'staff.delete', entity: 'staff', entityId: id, summary: `Staff record "${row.full_name}" deleted` });
        return { ok: true };
      },
    },
  },

  dentists: {
    list: {
      perms: ['clinical.view'],
      label: 'List dentists',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const includeInactive = v.bool('includeInactive');
        const where = includeInactive ? '' : "WHERE status = 'active'";
        return c.db.all(`SELECT * FROM dentists ${where} ORDER BY sort_order, full_name COLLATE NOCASE`);
      },
    },
    get: {
      perms: ['clinical.view'],
      label: 'Read dentist',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const dentist = c.db.get('SELECT * FROM dentists WHERE id = ?', [id]);
        if (!dentist) throw notFound('Dentist');
        const hours = c.db.all('SELECT * FROM working_hours WHERE dentist_id = ? ORDER BY day_of_week', [id]);
        return { dentist, hours };
      },
    },
    create: {
      perms: ['settings.manage'],
      label: 'Create dentist',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const fullName = v.string('fullName', { required: true, min: 2, max: 120, label: 'Full name' });
        const title = v.string('title', { max: 60 });
        const designations = v.array('designations', (x) => String(x).trim(), { maxItems: 8 });
        const qualifications = v.string('qualifications', { max: 200 });
        const registrationNo = v.string('registrationNo', { max: 80 });
        const phone = v.phone('phone');
        const email = v.string('email', { max: 160 });
        const consultationHours = v.string('consultationHours', { max: 300 });
        const degreePrefix = v.string('degreePrefix', { max: 40 });
        v.throwIfInvalid('Please correct the highlighted fields.');
        const now = nowIso();
        const maxRow = c.db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM dentists');
        const id = c.db.insert(
          `INSERT INTO dentists (full_name, title, designations, qualifications, registration_no, phone, email, consultation_hours, degree_prefix, status, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          [fullName, title, designations.filter(Boolean).join(', '), qualifications, registrationNo, phone, email, consultationHours, degreePrefix, Number(maxRow?.m ?? -1) + 1, now, now],
        );
        c.audit(actor, { action: 'dentists.create', entity: 'dentist', entityId: id, summary: `Dentist "${fullName}" added` });
        return c.db.get('SELECT * FROM dentists WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['settings.manage'],
      label: 'Update dentist',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const fullName = v.string('fullName', { required: true, min: 2, max: 120, label: 'Full name' });
        const title = v.string('title', { max: 60 });
        const designations = v.array('designations', (x) => String(x).trim(), { maxItems: 8 });
        const qualifications = v.string('qualifications', { max: 200 });
        const registrationNo = v.string('registrationNo', { max: 80 });
        const phone = v.phone('phone');
        const email = v.string('email', { max: 160 });
        const consultationHours = v.string('consultationHours', { max: 300 });
        const degreePrefix = v.string('degreePrefix', { max: 40 });
        const status = v.enum('status', ['active', 'inactive'] as const);
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM dentists WHERE id = ?', [id])) throw notFound('Dentist');
        c.db.run(
          `UPDATE dentists SET full_name = ?, title = ?, designations = ?, qualifications = ?, registration_no = ?,
             phone = ?, email = ?, consultation_hours = ?, degree_prefix = ?, status = ?, updated_at = ? WHERE id = ?`,
          [fullName, title, designations.filter(Boolean).join(', '), qualifications, registrationNo, phone, email,
            consultationHours, degreePrefix, status, nowIso(), id],
        );
        c.audit(actor, { action: 'dentists.update', entity: 'dentist', entityId: id, summary: `Dentist "${fullName}" updated` });
        return c.db.get('SELECT * FROM dentists WHERE id = ?', [id]);
      },
    },
    setSignature: {
      perms: ['settings.manage'],
      label: 'Set dentist signature image',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const dentistId = v.int('dentistId', { required: true, min: 1 });
        const attachmentId = v.optionalInt('attachmentId');
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM dentists WHERE id = ?', [dentistId])) throw notFound('Dentist');
        c.db.run('UPDATE dentists SET signature_attachment_id = ?, updated_at = ? WHERE id = ?', [attachmentId, nowIso(), dentistId]);
        c.audit(actor, { action: 'dentists.signature', entity: 'dentist', entityId: dentistId, summary: 'Signature image updated' });
        return c.db.get('SELECT signature_attachment_id FROM dentists WHERE id = ?', [dentistId]);
      },
    },
  },

  users: {
    list: {
      perms: ['users.view'],
      label: 'List users',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        const status = v.enum('status', ['', 'active', 'disabled'] as const);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (status) { where.push('u.status = ?'); params.push(status); }
        if (search) {
          where.push('(u.username LIKE ? COLLATE NOCASE OR u.display_name LIKE ? COLLATE NOCASE)');
          params.push(`%${search}%`, `%${search}%`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = c.db.count(`SELECT COUNT(*) AS n FROM users u ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT u.id, u.username, u.display_name, u.status, u.last_login_at, u.must_change_password, u.created_at,
                  u.staff_id, s.full_name AS staff_name,
                  (SELECT GROUP_CONCAT(r.name, ', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
             FROM users u LEFT JOIN staff s ON s.id = u.staff_id ${whereSql}
            ORDER BY u.display_name COLLATE NOCASE, u.username LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    get: {
      perms: ['users.view'],
      label: 'Read user',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const user = c.db.get(
          `SELECT u.id, u.username, u.display_name, u.status, u.last_login_at, u.staff_id, u.must_change_password, u.created_at, s.full_name AS staff_name
             FROM users u LEFT JOIN staff s ON s.id = u.staff_id WHERE u.id = ?`,
          [id],
        );
        if (!user) throw notFound('User');
        const roles = c.db.all<{ id: number; code: string; name: string }>(
          'SELECT r.id, r.code, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?',
          [id],
        );
        const permissions = c.db.all<{ permission: string }>(
          'SELECT DISTINCT rp.permission FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = ?',
          [id],
        );
        return { user, roles, permissions: permissions.map((p) => p.permission) };
      },
    },
    create: {
      perms: ['users.manage'],
      label: 'Create user',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const username = v.string('username', { required: true, min: 3, max: 40, label: 'Username' });
        if (!/^[A-Za-z0-9._-]+$/.test(username)) {
          v.issue('username', 'Username may contain letters, digits, dot, dash and underscore only.');
        }
        const displayName = v.string('displayName', { required: true, min: 2, max: 120, label: 'Display name' });
        const staffId = v.optionalInt('staffId');
        const roleIds = v.array('roleIds', (x) => v.int('roleIds[]', { min: 1 }) || Number(x), { required: true, minItems: 1, maxItems: 10, label: 'Roles' });
        const rawRoles = Array.isArray((input as Record<string, unknown>)?.roleIds) ? ((input as Record<string, unknown>).roleIds as unknown[]) : [];
        const ids = rawRoles.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
        const password = String((input as Record<string, unknown>)?.password ?? '');
        v.throwIfInvalid('Please correct the highlighted fields.');
        if (!password) throw fieldError([{ field: 'password', message: 'Password is required.' }]);
        const problems = checkPasswordPolicy(password, passwordPolicyFrom(c.settings.all()), { username });
        if (problems.length) throw fieldError([{ field: 'password', message: problems[0] as string }], problems[0] as string);
        if (c.db.get('SELECT id FROM users WHERE username = ?', [username.toLowerCase()])) {
          throw conflict(`The username "${username}" is already taken.`);
        }
        if (!ids.length) throw fieldError([{ field: 'roleIds', message: 'Assign at least one role.' }]);
        for (const roleId of ids) {
          if (!c.db.get('SELECT id FROM roles WHERE id = ?', [roleId])) throw fieldError([{ field: 'roleIds', message: 'One of the selected roles no longer exists.' }]);
        }
        if (staffId && !c.db.get('SELECT id FROM staff WHERE id = ?', [staffId])) throw notFound('Staff member');

        const id = c.db.transaction(() => {
          const now = nowIso();
          const userId = c.db.insert(
            `INSERT INTO users (username, password_hash, display_name, staff_id, status, must_change_password, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
            [username.toLowerCase(), hashPassword(password), displayName, staffId, now, now, actor?.userId ?? null],
          );
          for (const roleId of ids) {
            c.db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
          }
          if (staffId) c.db.run('UPDATE staff SET user_id = ? WHERE id = ?', [userId, staffId]);
          c.audit(actor, { action: 'users.create', entity: 'user', entityId: userId, summary: `User "${username}" created`, metadata: { roles: ids } });
          void roleIds;
          return userId;
        });
        return c.db.get('SELECT id, username, display_name, status FROM users WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['users.manage'],
      label: 'Update user',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const displayName = v.string('displayName', { required: true, min: 2, max: 120, label: 'Display name' });
        const status = v.enum('status', ['active', 'disabled'] as const, { required: true });
        const staffId = v.optionalInt('staffId');
        v.throwIfInvalid();
        const user = c.db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [id]);
        if (!user) throw notFound('User');
        if (status === 'disabled') {
          const admins = c.db.get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = ? AND r.code = 'administrator'`,
            [id],
          );
          if (Number(admins?.n ?? 0) > 0) {
            const otherAdmins = c.db.get<{ n: number }>(
              `SELECT COUNT(DISTINCT ur.user_id) AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                WHERE r.code = 'administrator' AND ur.user_id <> ? AND u.status = 'active'
               JOIN users u ON u.id = ur.user_id`,
              [id],
            );
            if (Number(otherAdmins?.n ?? 0) === 0) {
              throw businessRule('This is the last active Administrator. Assign another administrator before disabling this account.');
            }
          }
        }
        c.db.run('UPDATE users SET display_name = ?, status = ?, staff_id = ?, updated_at = ? WHERE id = ?', [
          displayName, status, staffId, nowIso(), id,
        ]);
        if (status === 'disabled') c.revokeAllSessions(id);
        c.audit(actor, { action: 'users.update', entity: 'user', entityId: id, summary: `User "${user.username}" updated (${status})` });
        return c.db.get('SELECT id, username, display_name, status FROM users WHERE id = ?', [id]);
      },
    },
    setRoles: {
      perms: ['roles.manage'],
      label: 'Assign roles to a user',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const rawRoles = Array.isArray((input as Record<string, unknown>)?.roleIds) ? ((input as Record<string, unknown>).roleIds as unknown[]) : [];
        const ids = rawRoles.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
        if (!ids.length) throw fieldError([{ field: 'roleIds', message: 'Assign at least one role.' }]);
        const user = c.db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [id]);
        if (!user) throw notFound('User');
        for (const roleId of ids) {
          if (!c.db.get('SELECT id FROM roles WHERE id = ?', [roleId])) throw fieldError([{ field: 'roleIds', message: 'One of the selected roles no longer exists.' }]);
        }
        c.db.transaction(() => {
          c.db.run('DELETE FROM user_roles WHERE user_id = ?', [id]);
          for (const roleId of ids) c.db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, roleId]);
        });
        c.revokeAllSessions(id);
        c.audit(actor, { action: 'users.roles', entity: 'user', entityId: id, summary: `Roles reassigned for "${user.username}"`, metadata: { roles: ids } });
        return { ok: true };
      },
    },
    resetPassword: {
      perms: ['users.manage'],
      label: 'Reset user password',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const body = (input ?? {}) as Record<string, unknown>;
        const newPassword = String(body.newPassword ?? '');
        const user = c.db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [id]);
        if (!user) throw notFound('User');
        if (!newPassword) throw fieldError([{ field: 'newPassword', message: 'Enter a new password.' }]);
        const problems = checkPasswordPolicy(newPassword, passwordPolicyFrom(c.settings.all()), { username: user.username });
        if (problems.length) throw fieldError([{ field: 'newPassword', message: problems[0] as string }], problems[0] as string);
        c.db.run('UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = ?, updated_at = ? WHERE id = ?', [
          hashPassword(newPassword), nowIso(), nowIso(), id,
        ]);
        c.revokeAllSessions(id);
        c.audit(actor, { action: 'users.reset_password', entity: 'user', entityId: id, summary: `Password reset for "${user.username}"` });
        c.logger.security('users.password.reset', { userId: id, by: actor?.username });
        return { ok: true };
      },
    },
    unlockUser: {
      perms: ['users.manage'],
      label: 'Unlock user account',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        c.db.run('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?', [id]);
        c.audit(actor, { action: 'users.unlock', entity: 'user', entityId: id, summary: 'Account unlocked' });
        return { ok: true };
      },
    },
  },

  roles: {
    list: {
      perms: ['users.view'],
      label: 'List roles',
      handler: ({ c }) =>
        c.db.all(
          `SELECT r.*, (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
                  (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
             FROM roles r ORDER BY r.id`,
        ),
    },
    permissions: {
      perms: [],
      label: 'Permission catalogue',
      handler: () => ({
        groups: PERMISSION_GROUPS.map((g) => ({ label: g.label, permissions: g.permissions.map((p) => ({ code: p, label: PERMISSIONS[p] })) })),
        all: ALL_PERMISSIONS,
        adminOnly: ADMIN_ONLY_PERMISSIONS,
      }),
    },
    get: {
      perms: ['users.view'],
      label: 'Read role',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const role = c.db.get('SELECT * FROM roles WHERE id = ?', [id]);
        if (!role) throw notFound('Role');
        const permissions = c.db.all<{ permission: string }>('SELECT permission FROM role_permissions WHERE role_id = ?', [id]);
        return { role, permissions: permissions.map((p) => p.permission) };
      },
    },
    create: {
      perms: ['roles.manage'],
      label: 'Create role',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const name = v.string('name', { required: true, min: 2, max: 60, label: 'Role name' });
        const description = v.string('description', { max: 300 });
        v.throwIfInvalid();
        const code = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `role_${Date.now()}`;
        if (c.db.get('SELECT id FROM roles WHERE code = ?', [code])) throw conflict(`A role named "${name}" already exists.`);
        const rawPerms = Array.isArray((input as Record<string, unknown>)?.permissions) ? ((input as Record<string, unknown>).permissions as unknown[]) : [];
        const permissions = rawPerms.map(String).filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
        const id = c.db.transaction(() => {
          const newId = c.db.insert('INSERT INTO roles (code, name, description, is_system, created_at) VALUES (?, ?, ?, 0, ?)', [code, name, description, nowIso()]);
          for (const p of permissions) {
            if (ADMIN_ONLY_PERMISSIONS.includes(p) && actor && !actor.isAdministrator) continue;
            c.db.run('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)', [newId, p]);
          }
          c.audit(actor, { action: 'roles.create', entity: 'role', entityId: newId, summary: `Role "${name}" created with ${permissions.length} permission(s)` });
          return newId;
        });
        return c.db.get('SELECT * FROM roles WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['roles.manage'],
      label: 'Update role',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const name = v.string('name', { required: true, min: 2, max: 60, label: 'Role name' });
        const description = v.string('description', { max: 300 });
        v.throwIfInvalid();
        const role = c.db.get<{ code: string; is_system: number }>('SELECT * FROM roles WHERE id = ?', [id]);
        if (!role) throw notFound('Role');
        if (role.code === 'administrator') {
          throw businessRule('The Administrator role always holds every permission and cannot be edited.');
        }
        const rawPerms = Array.isArray((input as Record<string, unknown>)?.permissions) ? ((input as Record<string, unknown>).permissions as unknown[]) : [];
        const permissions = rawPerms.map(String).filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
        c.db.transaction(() => {
          c.db.run('UPDATE roles SET name = ?, description = ? WHERE id = ?', [name, description, id]);
          c.db.run('DELETE FROM role_permissions WHERE role_id = ?', [id]);
          for (const p of permissions) c.db.run('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)', [id, p]);
          c.db.run(
            'UPDATE sessions SET revoked_at = ? WHERE user_id IN (SELECT user_id FROM user_roles WHERE role_id = ?) AND revoked_at IS NULL',
            [nowIso(), id],
          );
        });
        c.audit(actor, { action: 'roles.update', entity: 'role', entityId: id, summary: `Role "${name}" updated (${permissions.length} permission(s))` });
        return c.db.get('SELECT * FROM roles WHERE id = ?', [id]);
      },
    },
    delete: {
      perms: ['roles.manage'],
      label: 'Delete role',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const role = c.db.get<{ code: string; name: string }>('SELECT * FROM roles WHERE id = ?', [id]);
        if (!role) throw notFound('Role');
        if (role.code === 'administrator') throw businessRule('The Administrator role cannot be deleted.');
        const assigned = c.db.count('SELECT COUNT(*) AS n FROM user_roles WHERE role_id = ?', [id]);
        if (assigned > 0) throw businessRule(`${assigned} user(s) are assigned to "${role.name}". Reassign them first.`);
        c.db.run('DELETE FROM roles WHERE id = ?', [id]);
        c.audit(actor, { action: 'roles.delete', entity: 'role', entityId: id, summary: `Role "${role.name}" deleted` });
        return { ok: true };
      },
    },
  },

  audit: {
    list: {
      perms: ['audit.view'],
      label: 'List audit entries',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        const action = v.string('action', { max: 60 });
        const entity = v.string('entity', { max: 40 });
        const result = v.enum('result', ['', 'success', 'failure'] as const);
        const userId = v.optionalInt('userId');
        const { from, to } = dateRangeFrom(input);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 50, maxPageSize: 500 });
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (action) { where.push('a.action = ?'); params.push(action); }
        if (entity) { where.push('a.entity = ?'); params.push(entity); }
        if (result) { where.push('a.result = ?'); params.push(result); }
        if (userId) { where.push('a.user_id = ?'); params.push(userId); }
        if (from) { where.push('date(a.at) >= ?'); params.push(from); }
        if (to) { where.push('date(a.at) <= ?'); params.push(to); }
        if (search) {
          where.push('(a.summary LIKE ? COLLATE NOCASE OR a.username LIKE ? COLLATE NOCASE OR a.action LIKE ? COLLATE NOCASE)');
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = c.db.count(`SELECT COUNT(*) AS n FROM audit_logs a ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT a.* FROM audit_logs a ${whereSql} ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        const actions = c.db.all<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 300');
        return { ...paginate(rows, total, page, pageSize), actions: actions.map((a) => a.action) };
      },
    },
    stats: {
      perms: ['audit.view'],
      label: 'Audit statistics',
      handler: ({ c }) => ({
        total: c.db.count('SELECT COUNT(*) AS n FROM audit_logs'),
        failures: c.db.count("SELECT COUNT(*) AS n FROM audit_logs WHERE result = 'failure'"),
        last24h: c.db.count("SELECT COUNT(*) AS n FROM audit_logs WHERE at >= datetime('now', '-1 day')"),
        failedLogins: c.db.count("SELECT COUNT(*) AS n FROM login_history WHERE success = 0 AND at >= datetime('now', '-1 day')"),
      }),
    },
  },

  usersSecurity: {
    loginHistory: {
      perms: ['users.view'],
      label: 'List login history',
      handler: ({ c }, input: unknown) => {
        const { page, pageSize, offset } = readPaging(input, { pageSize: 50, maxPageSize: 200 });
        const total = c.db.count('SELECT COUNT(*) AS n FROM login_history');
        const rows = c.db.all(
          'SELECT l.*, u.display_name FROM login_history l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.at DESC LIMIT ? OFFSET ?',
          [pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
  },
};

export function assertActorPassword(c: import('../container').Container, userId: number, password: string): void {
  const row = c.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [userId]);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError('unauthenticated', 'That password is not correct.');
  }
}
