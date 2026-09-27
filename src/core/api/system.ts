import { APP, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MINUTES, ABSOLUTE_SESSION_HOURS } from '../../shared/constants';
import { ALL_PERMISSIONS, type Permission } from '../../shared/permissions';
import { AppError, conflict, fieldError, notFound, unauthenticated } from '../errors';
import { Validator } from '../validation/validate';
import { nowIso } from '../db/connection';
import { hashPassword, verifyPassword, checkPasswordPolicy, DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from '../security/password';
import { verifyActivationCode } from '../security/activation';
import { seedRolesAndPermissions } from '../security/rbac';
import { applySettingsPatch, type SettingsShape } from '../services/settings';
import { timestampSlug, writeFileAtomic } from '../services/files';
import { join } from 'node:path';
import type { ApiSpec } from '../registry';

const THIRD_PARTY_NOTICES = [
  { name: 'Electron', version: '38.x', license: 'MIT', use: 'Application shell, Chromium print/PDF engine' },
  { name: 'Chromium', version: 'bundled with Electron', license: 'BSD-3-Clause', use: 'Rendering, printing, PDF generation' },
  { name: 'React', version: '19.x', license: 'MIT', use: 'User interface runtime' },
  { name: 'SQLite (WASM build via node-sqlite3-wasm)', version: '3.4x', license: 'SQLite is public domain; wrapper MIT', use: 'Local database engine' },
  { name: 'Noto Sans Bengali', version: 'bundled', license: 'SIL Open Font License 1.1', use: 'Bengali text rendering' },
  { name: 'Noto Sans / Inter', version: 'bundled', license: 'SIL Open Font License 1.1', use: 'Latin text rendering' },
  { name: 'Vite', version: '7.x', license: 'MIT', use: 'Build tooling (not shipped at runtime)' },
  { name: 'TypeScript', version: '5.x', license: 'Apache-2.0', use: 'Build tooling (not shipped at runtime)' },
];

export const systemApi: ApiSpec = {
  system: {
    status: {
      public: true,
      label: 'Read application status',
      handler: ({ c }) => {
        const setupCompleted = c.settings.get('app.setupCompleted');
        const activation = c.activation();
        const clinic = c.db.get<{ name: string }>('SELECT name FROM clinic WHERE id = 1');
        const hasAdmin = c.db.count("SELECT COUNT(*) AS n FROM users WHERE status = 'active'") > 0;
        const integrity = c.integrityCheck();
        return {
          version: APP.version,
          schemaVersion: c.db.get<{ v: number }>('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations')?.v ?? 0,
          setupCompleted,
          activated: activation.activated,
          activatedAt: activation.activatedAt,
          clinicName: clinic?.name ?? null,
          hasAdmin,
          integrity,
          dataDir: c.paths.root,
          backupFolder: c.settings.get('backup.folder') || c.paths.backupDefaultDir,
        };
      },
    },

    activate: {
      public: true,
      label: 'Activate Dentiva Pro',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const code = v.string('code', { required: true, max: 64 });
        v.throwIfInvalid('Enter the 16-digit activation code.');

        const existing = c.activation();
        if (existing.activated) {
          throw conflict('This installation is already activated.');
        }
        if (!verifyActivationCode(code)) {
          c.logger.security('activation.failed', { machine: c.machine });
          c.audit(null, { action: 'system.activate', entity: 'app_state', result: 'failure', summary: 'Invalid activation code entered' });
          throw fieldError([{ field: 'code', message: 'That activation code is not valid.' }], 'That activation code is not valid.');
        }
        const now = nowIso();
        const record = c.writeActivation(now);
        c.logger.security('activation.success', { machine: c.machine, at: now });
        c.audit(null, { action: 'system.activate', entity: 'app_state', summary: 'Application activated' });
        return { activated: true, activatedAt: record.activatedAt };
      },
    },

    activationStatus: {
      public: true,
      label: 'Read activation status',
      handler: ({ c }) => c.activation(),
    },

    about: {
      label: 'About Dentiva Pro',
      handler: ({ c }) => {
        const state = c.settings.getState('app.dirty');
        return {
          name: APP.name,
          version: APP.version,
          buildNumber: c.settings.get('app.buildNumber') || process.env.DENTIVA_BUILD || 'local',
          developer: APP.developer,
          email: APP.developerEmail,
          copyright: APP.copyright,
          license: 'Proprietary — licensed to the purchasing clinic. All rights reserved.',
          activated: c.activation().activated,
          dataDir: c.paths.root,
          platform: process.platform,
          arch: process.arch,
          node: process.versions.node,
          electron: process.versions.electron ?? 'n/a',
          chromium: process.versions.chrome ?? 'n/a',
          sqlite: (c.db.get<{ v: string }>('SELECT sqlite_version() AS v')?.v ?? '').toString(),
          schemaVersion: c.db.get<{ v: number }>('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations')?.v ?? 0,
          thirdPartyNotices: THIRD_PARTY_NOTICES,
          offline: true,
          uncleanShutdown: state === '1',
        };
      },
    },

    markClean: {
      public: true,
      label: 'Mark clean shutdown',
      handler: ({ c }) => {
        c.settings.setState('app.dirty', '0');
        c.db.checkpoint();
        return { ok: true };
      },
    },

    flush: {
      perms: ['settings.manage'],
      label: 'Flush pending work',
      handler: ({ c }) => {
        c.db.checkpoint();
        return { ok: true };
      },
    },

    exportDiagnosticReport: {
      perms: ['settings.view'],
      label: 'Export diagnostic report',
      handler: ({ c }) => {
        const counts: Record<string, number> = {};
        for (const table of [
          'patients', 'visits', 'prescriptions', 'appointments', 'invoices', 'payments',
          'expenses', 'income_entries', 'inventory_items', 'audit_logs', 'attachments', 'notifications',
        ]) {
          counts[table] = c.db.count(`SELECT COUNT(*) AS n FROM ${table}`);
        }
        const content = JSON.stringify(
          {
            generatedAt: nowIso(),
            app: { name: APP.name, version: APP.version, build: c.settings.get('app.buildNumber') },
            runtime: { platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron ?? 'n/a' },
            sqlite: c.db.get<{ v: string }>('SELECT sqlite_version() AS v')?.v,
            integrity: c.integrityCheck(),
            paths: { data: c.paths.root, backups: c.settings.get('backup.folder') || c.paths.backupDefaultDir },
            counts,
            logs: c.logger.listLogs(),
          },
          null,
          2,
        );
        const path = join(c.paths.exportsDir, `DentivaPro-Diagnostics-${timestampSlug()}.json`);
        writeFileAtomic(path, content);
        return { path, bytes: Buffer.byteLength(content) };
      },
    },
  },

  setup: {
    run: {
      public: true,
      label: 'Run first-time setup',
      handler: ({ c }, input: unknown) => {
        if (c.settings.get('app.setupCompleted')) {
          throw conflict('Setup has already been completed for this installation.');
        }
        if (!c.settings.getState('activation.activated')) {
          throw new AppError('not_activated', 'Activate Dentiva Pro before completing setup.');
        }
        const v = new Validator(input);

        // Clinic
        const clinicName = v.string('clinic.name', { required: true, min: 2, max: 160, label: 'Clinic name' });
        const clinicAddress = v.string('clinic.address', { max: 300 });
        const clinicArea = v.string('clinic.area', { max: 100 });
        const clinicDistrict = v.string('clinic.district', { max: 100 });
        const clinicPhone = v.phone('clinic.phone', { label: 'Clinic phone' });
        const clinicEmail = v.string('clinic.email', { max: 160 });
        const clinicWebsite = v.string('clinic.website', { max: 160 });
        const clinicFooter = v.string('clinic.footer', { max: 500 });
        const businessStart = v.timeKey('clinic.businessStart', { label: 'Opening time' });
        const businessEnd = v.timeKey('clinic.businessEnd', { label: 'Closing time' });
        const workingDays = v.array('clinic.workingDays', (x) => Number(x), { minItems: 1, label: 'Working days' });

        // Dentists
        const dentists = v.array('dentists', (item) => {
          const d = new Validator(item, 'dentists');
          const fullName = d.string('fullName', { required: true, min: 2, max: 120, label: 'Full name' });
          const title = d.string('title', { max: 60 });
          const designations = d.array('designations', (x) => d.string(String(x), { max: 80 }).slice(0, 0) || String(x).trim()).filter(Boolean).slice(0, 6);
          const qualifications = d.string('qualifications', { max: 200 });
          const registrationNo = d.string('registrationNo', { max: 80 });
          const phone = d.phone('phone');
          const email = d.string('email', { max: 160 });
          const consultationHours = d.string('consultationHours', { max: 300 });
          const degreePrefix = d.string('degreePrefix', { max: 40 });
          d.throwIfInvalid();
          return { fullName, title, designations, qualifications, registrationNo, phone, email, consultationHours, degreePrefix };
        }, { required: true, minItems: 1, maxItems: 50, label: 'Dentists' });

        // Admin
        const adminName = v.string('admin.displayName', { required: true, min: 2, max: 120, label: 'Administrator name' });
        const username = v.string('admin.username', { required: true, min: 3, max: 40, label: 'Username' });
        if (!/^[A-Za-z0-9._-]+$/.test(username)) {
          v.issue('admin.username', 'Username may contain letters, digits, dot, dash and underscore only.');
        }
        const adminInput = ((input as Record<string, unknown>)?.admin ?? {}) as Record<string, unknown>;
        const password = String(adminInput.password ?? '');
        const confirmPassword = String(adminInput.confirmPassword ?? '');
        if (!password) v.issue('admin.password', 'Password is required.');
        if (password !== confirmPassword) {
          v.issue('admin.confirmPassword', 'The two passwords do not match.');
        }
        const problems = checkPasswordPolicy(password, passwordPolicyFrom(c.settings.all()), { username });
        for (const problem of problems) v.issue('admin.password', problem);

        // Preferences
        const dateFormat = v.enum('prefs.dateFormat', ['dmy', 'ymd', 'mdy'] as const);
        const timeFormat = v.enum('prefs.timeFormat', ['12h', '24h'] as const);
        const autoLockMinutes = v.int('prefs.autoLockMinutes', { min: 0, max: 240 });
        const backupFolder = v.string('prefs.backupFolder', { max: 400 });
        const backupFrequencyDays = v.int('prefs.backupFrequencyDays', { min: 0, max: 365 });
        const bengaliNumerals = v.bool('prefs.bengaliNumerals');

        v.throwIfInvalid('Please correct the highlighted fields.');

        if (businessStart && businessEnd && businessEnd <= businessStart) {
          throw fieldError([{ field: 'clinic.businessEnd', message: 'Closing time must be after the opening time.' }]);
        }

        const now = nowIso();
        const passwordHash = hashPassword(password);

        c.db.transaction(() => {
          c.db.run(
            `INSERT INTO clinic (id, name, address_line, area, district, phone, email, website, footer_message,
                                 business_start, business_end, invoice_prefix, payment_prefix, updated_at)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INV', 'PAY', ?)`,
            [clinicName, clinicAddress, clinicArea, clinicDistrict, clinicPhone, clinicEmail, clinicWebsite, clinicFooter, businessStart, businessEnd, now],
          );

          for (const [i, d] of dentists.entries()) {
            const dentistId = c.db.insert(
              `INSERT INTO dentists (full_name, title, designations, qualifications, registration_no, phone, email,
                                     consultation_hours, degree_prefix, status, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
              [d.fullName, d.title, d.designations.join(', '), d.qualifications, d.registrationNo, d.phone, d.email, d.consultationHours, d.degreePrefix, i, now, now],
            );
            for (let day = 0; day < 7; day += 1) {
              const isOpen = workingDays.includes(day) ? 1 : 0;
              c.db.run(
                'INSERT OR REPLACE INTO working_hours (dentist_id, day_of_week, is_open, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
                [dentistId, day, isOpen, businessStart || '09:00', businessEnd || '14:00'],
              );
            }
          }

          const adminId = c.db.insert(
            `INSERT INTO users (username, password_hash, display_name, status, password_changed_at, created_at, updated_at)
             VALUES (?, ?, ?, 'active', ?, ?, ?)`,
            [username.toLowerCase(), passwordHash, adminName, now, now, now],
          );
          const adminRole = c.db.get<{ id: number }>("SELECT id FROM roles WHERE code = 'administrator'");
          c.db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [adminId, Number(adminRole?.id ?? 0)]);
          c.db.run(
            'INSERT INTO login_history (user_id, attempted, success, reason, at) VALUES (?, ?, 1, ?, ?)',
            [adminId, username.toLowerCase(), 'Initial setup', now],
          );

          c.settings.setMany({
            'app.setupCompleted': true,
            'app.installedAt': now,
            'format.dateFormat': dateFormat,
            'format.timeFormat': timeFormat,
            'auth.autoLockMinutes': autoLockMinutes,
            'backup.folder': backupFolder || c.paths.backupDefaultDir,
            'backup.frequencyDays': backupFrequencyDays,
            'clinic.footerMessage': clinicFooter,
            'display.bengaliNumerals': bengaliNumerals,
          });
        });

        c.settings.invalidate();
        c.audit(null, { action: 'setup.complete', entity: 'clinic', entityId: 1, summary: `Clinic "${clinicName}" configured`, metadata: { dentists: dentists.length } });
        c.logger.info('setup.completed', { clinic: clinicName, dentists: dentists.length });
        return { ok: true, clinicName };
      },
    },

    status: {
      public: true,
      label: 'Read setup status',
      handler: ({ c }) => ({
        setupCompleted: c.settings.get('app.setupCompleted'),
        required: true,
        steps: ['clinic', 'dentists', 'administrator', 'preferences'],
      }),
    },
  },

  auth: {
    login: {
      public: true,
      label: 'Sign in',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const username = v.string('username', { required: true, max: 60 });
        const password = String((input as Record<string, unknown>)?.password ?? '');
        v.throwIfInvalid('Enter your username and password.');

        const user = c.db.get<{
          id: number; username: string; password_hash: string; display_name: string; status: string;
          failed_count: number; locked_until: string | null; staff_id: number | null; must_change_password: number;
        }>('SELECT * FROM users WHERE username = ?', [username.toLowerCase()]);

        if (!user) {
          recordLogin(c, null, username, false, 'Unknown username');
          c.logger.security('auth.login.failed', { attempted: username, reason: 'unknown-user' });
          throw unauthenticated('Incorrect username or password.');
        }

        if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
          recordLogin(c, user.id, username, false, 'Account locked');
          const minutes = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000));
          throw new AppError('locked_out', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
        }

        if (!verifyPassword(password, user.password_hash)) {
          const failed = Number(user.failed_count) + 1;
          const shouldLock = failed >= LOGIN_MAX_ATTEMPTS;
          const lockUntil = shouldLock ? new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60000).toISOString() : null;
          c.db.run('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?', [shouldLock ? 0 : failed, lockUntil, user.id]);
          recordLogin(c, user.id, username, false, shouldLock ? 'Locked after repeated failures' : 'Wrong password');
          c.logger.security('auth.login.failed', { username: user.username, failedCount: failed, locked: shouldLock });
          c.audit(null, { action: 'auth.login', entity: 'user', entityId: user.id, result: 'failure', summary: 'Failed sign-in' });
          if (shouldLock) {
            throw new AppError(
              'locked_out',
              `Too many failed attempts. This account is locked for ${LOGIN_LOCKOUT_MINUTES} minute(s).`,
            );
          }
          throw unauthenticated('Incorrect username or password.');
        }

        if (user.status !== 'active') {
          recordLogin(c, user.id, username, false, 'Account disabled');
          throw unauthenticated('This account has been disabled. Contact an Administrator.');
        }

        c.db.run('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?', [user.id]);
        const session = c.createSession(user.id);
        recordLogin(c, user.id, username, true, '');
        c.audit({ userId: user.id, username: user.username, displayName: user.display_name, permissions: new Set(), isAdministrator: false, sessionId: session.token.slice(0, 12), staffId: user.staff_id, mustChangePassword: Boolean(user.must_change_password) }, {
          action: 'auth.login',
          entity: 'user',
          entityId: user.id,
          summary: 'Signed in',
        });
        c.logger.security('auth.login.success', { username: user.username });

        const permissions = resolveUserPermissions(c, user.id);
        return {
          token: session.token,
          expiresAt: session.expiresAt,
          user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name || user.username,
            staffId: user.staff_id,
            mustChangePassword: Boolean(user.must_change_password),
            permissions: [...permissions.permissions],
            isAdministrator: permissions.isAdministrator,
          },
        };
      },
    },

    logout: {
      label: 'Sign out',
      handler: ({ c, actor }) => {
        if (actor) c.audit(actor, { action: 'auth.logout', entity: 'user', entityId: actor.userId, summary: 'Signed out' });
        c.logger.security('auth.logout', { username: actor?.username });
        return { ok: true };
      },
    },

    me: {
      label: 'Read current session',
      handler: ({ c, actor }) => {
        if (!actor) throw unauthenticated();
        const user = c.db.get<{ id: number; username: string; display_name: string; staff_id: number | null; must_change_password: number; last_login_at: string | null }>(
          'SELECT id, username, display_name, staff_id, must_change_password, last_login_at FROM users WHERE id = ?',
          [actor.userId],
        );
        if (!user) throw unauthenticated();
        return {
          id: user.id,
          username: user.username,
          displayName: user.display_name || user.username,
          staffId: user.staff_id,
          mustChangePassword: Boolean(user.must_change_password),
          lastLoginAt: user.last_login_at,
          permissions: [...actor.permissions],
          isAdministrator: actor.isAdministrator,
          allPermissions: ALL_PERMISSIONS,
          sessionExpiresInHours: ABSOLUTE_SESSION_HOURS,
        };
      },
    },

    unlock: {
      label: 'Unlock the application',
      handler: ({ c }, input: unknown) => {
        const password = String((input as Record<string, unknown>)?.password ?? '');
        if (!password) throw fieldError([{ field: 'password', message: 'Password is required.' }]);
        const user = c.db.get<{ id: number; password_hash: string; status: string }>('SELECT id, password_hash, status FROM users WHERE id = (SELECT user_id FROM sessions WHERE revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1)');
        if (!user) throw unauthenticated('Your session has ended. Please sign in again.');
        if (user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
          c.logger.security('auth.unlock.failed', { userId: user.id });
          throw unauthenticated('That password is not correct.');
        }
        c.logger.security('auth.unlock.success', { userId: user.id });
        return { ok: true };
      },
    },

    changePassword: {
      label: 'Change own password',
      handler: ({ c, actor }, input: unknown) => {
        if (!actor) throw unauthenticated();
        const v = new Validator(input);
        const currentPassword = String((input as Record<string, unknown>)?.currentPassword ?? '');
        const newPassword = String((input as Record<string, unknown>)?.newPassword ?? '');
        const confirmPassword = String((input as Record<string, unknown>)?.confirmPassword ?? '');
        v.throwIfInvalid('Enter your current password and choose a new one.');

        const row = c.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [actor.userId]);
        if (!row) throw notFound('User');
        if (!verifyPassword(currentPassword, row.password_hash)) {
          c.logger.security('auth.password.change.failed', { userId: actor.userId });
          throw fieldError([{ field: 'currentPassword', message: 'That is not your current password.' }], 'That is not your current password.');
        }
        if (newPassword !== confirmPassword) {
          throw fieldError([{ field: 'confirmPassword', message: 'The two passwords do not match.' }]);
        }
        const problems = checkPasswordPolicy(newPassword, passwordPolicyFrom(c.settings.all()), { username: actor.username });
        if (problems.length) throw fieldError([{ field: 'newPassword', message: problems[0] as string }], problems[0] as string);

        c.db.run('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?', [
          hashPassword(newPassword),
          nowIso(),
          actor.userId,
        ]);
        c.audit(actor, { action: 'auth.password.change', entity: 'user', entityId: actor.userId, summary: 'Own password changed' });
        return { ok: true };
      },
    },

    recentActivity: {
      perms: [],
      label: 'Read recent logins',
      handler: ({ c, actor }) => {
        if (!actor) throw unauthenticated();
        return c.db.all(
          `SELECT at, attempted, success, reason FROM login_history
            WHERE user_id = ? OR attempted = ? ORDER BY at DESC LIMIT 10`,
          [actor.userId, actor.username],
        );
      },
    },
  },

  settings: {
    get: {
      perms: ['settings.view'],
      label: 'Read settings',
      handler: ({ c }) => c.settings.all(),
    },
    publicPrefs: {
      public: true,
      label: 'Read display preferences',
      handler: ({ c }) => {
        const s = c.settings.all();
        return {
          theme: s['display.theme'],
          density: s['display.density'],
          animations: s['display.animations'],
          bengaliNumerals: s['display.bengaliNumerals'],
          dateFormat: s['format.dateFormat'],
          timeFormat: s['format.timeFormat'],
          sidebarCollapsed: s['display.sidebarCollapsed'],
          autoLockMinutes: s['auth.autoLockMinutes'],
        };
      },
    },
    update: {
      perms: ['settings.manage'],
      label: 'Update settings',
      handler: ({ c, actor }, input: unknown) => {
        const patch = applySettingsPatch(input);
        c.db.transaction(() => {
          c.settings.setMany(patch);
        });
        c.settings.invalidate();
        c.audit(actor, { action: 'settings.update', entity: 'settings', summary: 'Settings updated', metadata: { keys: Object.keys(patch) } });
        return c.settings.all();
      },
    },
    clinic: {
      perms: ['settings.view'],
      label: 'Read clinic profile',
      handler: ({ c }) => c.db.get('SELECT * FROM clinic WHERE id = 1') ?? null,
    },
    updateClinic: {
      perms: ['settings.manage'],
      label: 'Update clinic profile',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const name = v.string('name', { required: true, min: 2, max: 160 });
        const tagline = v.string('tagline', { max: 200 });
        const address = v.string('address', { max: 300 });
        const area = v.string('area', { max: 100 });
        const district = v.string('district', { max: 100 });
        const thana = v.string('thana', { max: 100 });
        const postcode = v.string('postcode', { max: 20 });
        const phone = v.phone('phone');
        const altPhone = v.phone('altPhone');
        const email = v.string('email', { max: 160 });
        const website = v.string('website', { max: 160 });
        const footer = v.string('footerMessage', { max: 500 });
        const start = v.timeKey('businessStart', { label: 'Opening time' });
        const end = v.timeKey('businessEnd', { label: 'Closing time' });
        const invoicePrefix = v.string('invoicePrefix', { required: true, max: 12 });
        const paymentPrefix = v.string('paymentPrefix', { required: true, max: 12 });
        v.throwIfInvalid('Please correct the highlighted fields.');
        if (start && end && end <= start) {
          throw fieldError([{ field: 'businessEnd', message: 'Closing time must be after the opening time.' }]);
        }
        c.db.run(
          `UPDATE clinic SET name = ?, tagline = ?, address_line = ?, area = ?, district = ?, thana = ?, postcode = ?,
             phone = ?, alt_phone = ?, email = ?, website = ?, footer_message = ?, business_start = ?, business_end = ?,
             invoice_prefix = ?, payment_prefix = ?, updated_at = ?
           WHERE id = 1`,
          [name, tagline, address, area, district, thana, postcode, phone, altPhone, email, website, footer, start, end, invoicePrefix, paymentPrefix, nowIso()],
        );
        c.settings.set('clinic.footerMessage', footer);
        c.settings.set('financial.invoicePrefix', invoicePrefix);
        c.settings.set('financial.paymentPrefix', paymentPrefix);
        c.audit(actor, { action: 'clinic.update', entity: 'clinic', entityId: 1, summary: `Clinic profile updated (${name})` });
        return c.db.get('SELECT * FROM clinic WHERE id = 1');
      },
    },
    workingHours: {
      perms: ['settings.view'],
      label: 'Read working hours',
      handler: ({ c }) => c.db.all('SELECT * FROM working_hours ORDER BY dentist_id, day_of_week'),
    },
    setWorkingHours: {
      perms: ['settings.manage'],
      label: 'Set working hours',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const dentistId = v.int('dentistId', { required: true, min: 1 });
        const hours = v.array('hours', (x) => {
          const h = new Validator(x, 'hours');
          const day = h.int('day', { required: true, min: 0, max: 6 });
          const isOpen = h.bool('isOpen');
          const start = h.timeKey('start', { label: 'Start time' });
          const end = h.timeKey('end', { label: 'End time' });
          h.throwIfInvalid();
          return { day, isOpen, start, end };
        }, { minItems: 1, maxItems: 7 });
        v.throwIfInvalid();
        c.db.transaction(() => {
          for (const h of hours) {
            c.db.run(
              'INSERT OR REPLACE INTO working_hours (dentist_id, day_of_week, is_open, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
              [dentistId, h.day, h.isOpen ? 1 : 0, h.start, h.end],
            );
          }
        });
        c.audit(actor, { action: 'clinic.working_hours', entity: 'dentist', entityId: dentistId, summary: 'Working hours updated' });
        return c.db.all('SELECT * FROM working_hours WHERE dentist_id = ? ORDER BY day_of_week', [dentistId]);
      },
    },
    holidays: {
      perms: ['settings.view'],
      label: 'List holidays',
      handler: ({ c }) => c.db.all('SELECT * FROM holidays ORDER BY date_key DESC'),
    },
    saveHoliday: {
      perms: ['settings.manage'],
      label: 'Save holiday',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const title = v.string('title', { required: true, max: 120 });
        const dateKey = v.dateKey('dateKey', { required: true, label: 'Date' });
        const notes = v.string('notes', { max: 300 });
        v.throwIfInvalid();
        const existing = c.db.get<{ id: number }>('SELECT id FROM holidays WHERE date_key = ?', [dateKey]);
        if (existing) {
          c.db.run('UPDATE holidays SET title = ?, notes = ? WHERE id = ?', [title, notes, existing.id]);
          c.audit(actor, { action: 'clinic.holiday.update', entity: 'holiday', entityId: existing.id, summary: `Holiday ${dateKey} updated` });
          return c.db.get('SELECT * FROM holidays WHERE id = ?', [existing.id]);
        }
        const id = c.db.insert('INSERT INTO holidays (title, date_key, is_closed, notes, created_at) VALUES (?, ?, 1, ?, ?)', [title, dateKey, notes, nowIso()]);
        c.audit(actor, { action: 'clinic.holiday.create', entity: 'holiday', entityId: id, summary: `Holiday ${dateKey} added` });
        return c.db.get('SELECT * FROM holidays WHERE id = ?', [id]);
      },
    },
    deleteHoliday: {
      perms: ['settings.manage'],
      label: 'Delete holiday',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const row = c.db.get<{ date_key: string }>('SELECT date_key FROM holidays WHERE id = ?', [id]);
        if (!row) throw notFound('Holiday');
        c.db.run('DELETE FROM holidays WHERE id = ?', [id]);
        c.audit(actor, { action: 'clinic.holiday.delete', entity: 'holiday', entityId: id, summary: `Holiday ${row.date_key} deleted` });
        return { ok: true };
      },
    },
    resetRoles: {
      perms: ['roles.manage'],
      label: 'Reset system roles to their shipped permissions',
      handler: ({ c, actor }) => {
        seedRolesAndPermissions(c.db);
        c.audit(actor, { action: 'settings.roles.reset', entity: 'role', summary: 'System roles reset to defaults' });
        return { ok: true };
      },
    },
  },
};

function recordLogin(c: import('../container').Container, userId: number | null, attempted: string, success: boolean, reason: string): void {
  c.db.run('INSERT INTO login_history (user_id, attempted, success, reason, at) VALUES (?, ?, ?, ?, ?)', [
    userId,
    attempted.slice(0, 60),
    success ? 1 : 0,
    reason,
    nowIso(),
  ]);
}

function resolveUserPermissions(c: import('../container').Container, userId: number): { permissions: Permission[]; isAdministrator: boolean } {
  const rows = c.db.all<{ permission: string; role_code: string }>(
    `SELECT rp.permission AS permission, r.code AS role_code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE ur.user_id = ?`,
    [userId],
  );
  const set = new Set<Permission>();
  let isAdministrator = false;
  for (const row of rows) {
    if (row.role_code === 'administrator') isAdministrator = true;
    if (row.permission) set.add(row.permission as Permission);
  }
  if (isAdministrator) for (const p of ALL_PERMISSIONS) set.add(p);
  return { permissions: [...set], isAdministrator };
}

export function passwordPolicyFrom(s: SettingsShape): PasswordPolicy {
  return {
    minLength: s['auth.minPasswordLength'] || DEFAULT_PASSWORD_POLICY.minLength,
    requireLower: s['auth.requireLower'],
    requireUpper: s['auth.requireUpper'],
    requireDigit: s['auth.requireDigit'],
    requireSymbol: s['auth.requireSymbol'],
  };
}
