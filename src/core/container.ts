import { Db, nowIso } from './db/connection';
import { runMigrations } from './db/migrations';
import { Logger, getLogger } from './log/logger';
import { resolvePaths, type AppPaths } from './paths';
import { SettingsService } from './services/settings';
import { seedRolesAndPermissions, resolvePermissions, createSessionToken, type Actor } from './security/rbac';
import {
  ACTIVATION_PROOF_KEYS,
  buildActivationRecord,
  buildInstallProof,
  readActivationRecord,
  type ActivationState,
} from './security/activation';
import { writeAudit, type AuditInput } from './audit/audit';
import { AppError } from './errors';
import { ABSOLUTE_SESSION_HOURS } from '../shared/constants';
import { toEnglishDigits } from './money/format';
import type { Permission } from '../shared/permissions';

export interface ContainerOptions {
  dataDir?: string;
  dbFile?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  consoleLog?: boolean;
  machine?: string;
  now?: () => Date;
}

export class Container {
  db: Db;
  readonly logger: Logger;
  readonly paths: AppPaths;
  settings: SettingsService;
  readonly machine: string;
  readonly now: () => Date;

  constructor(options: ContainerOptions = {}) {
    this.paths = resolvePaths(options.dataDir);
    this.logger = getLogger(this.paths.logsDir, { minLevel: options.logLevel ?? 'info', console: options.consoleLog });
    this.dbFile = options.dbFile ?? this.paths.dbFile;
    this.db = new Db(this.dbFile);
    this.machine = options.machine ?? process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'local';
    this.now = options.now ?? (() => new Date());
    this.settings = new SettingsService(this.db);
    runMigrations(this.db);
    seedRolesAndPermissions(this.db);
    this.seedSystemData();
  }

  readonly dbFile: string;

  /** Re-opens the database file after a restore replaced it on disk. */
  reopen(): void {
    this.settings.invalidate();
    this.db = new Db(this.dbFile);
    this.settings = new SettingsService(this.db);
    this.db.checkpoint();
  }

  /** Only genuinely required system data — never fake patients or money. */
  private seedSystemData(): void {
    const methods: [string, string, number, number][] = [
      ['cash', 'Cash', 1, 1],
      ['bank', 'Bank Transfer', 0, 2],
      ['card', 'Card', 0, 3],
      ['bkash', 'bKash', 0, 4],
      ['nagad', 'Nagad', 0, 5],
      ['rocket', 'Rocket', 0, 6],
      ['upay', 'Upay', 0, 7],
      ['other', 'Other', 0, 8],
    ];
    this.db.transaction(() => {
      for (const [code, label, isCash, order] of methods) {
        this.db.run(
          `INSERT INTO payment_methods (code, label, is_cash, sort_order) VALUES (?, ?, ?, ?)
           ON CONFLICT(code) DO UPDATE SET label = excluded.label, is_cash = excluded.is_cash, sort_order = excluded.sort_order`,
          [code, label, isCash, order],
        );
      }
      for (const [order, name] of ['Treatment Income', 'Consultation Fee', 'Other Income'].entries()) {
        this.db.run('INSERT OR IGNORE INTO income_categories (name, sort_order) VALUES (?, ?)', [name, order + 1]);
      }
      for (const [order, name] of [
        'Rent',
        'Electricity',
        'Internet',
        'Equipment',
        'Dental Accessories',
        'Supplies',
        'Staff Salary',
        'Maintenance',
        'Utilities',
        'Transportation',
        'Other',
      ].entries()) {
        this.db.run('INSERT OR IGNORE INTO expense_categories (name, sort_order) VALUES (?, ?)', [name, order + 1]);
      }
      for (const [order, name] of [
        'General Check-up',
        'Scaling',
        'Filling',
        'Root Canal Treatment',
        'Extraction',
        'Crown & Bridge',
        'Denture',
        'Orthodontic Treatment',
        'Teeth Whitening',
        'Child Scaling',
        'Fissure Sealant',
        'Implant',
      ].entries()) {
        this.db.run('INSERT OR IGNORE INTO treatment_categories (name, sort_order) VALUES (?, ?)', [name, order + 1]);
      }
    });
  }

  // ── Session handling ───────────────────────────────────────────────────

  createSession(userId: number): { token: string; expiresAt: string } {
    const token = createSessionToken();
    const issued = new Date();
    const expires = new Date(issued.getTime() + ABSOLUTE_SESSION_HOURS * 3600 * 1000);
    this.db.run('INSERT INTO sessions (token, user_id, issued_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', [
      token,
      userId,
      issued.toISOString(),
      expires.toISOString(),
      issued.toISOString(),
    ]);
    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [issued.toISOString(), userId]);
    return { token, expiresAt: expires.toISOString() };
  }

  resolveActor(token: string): Actor | null {
    const row = this.db.get<{
      token: string;
      user_id: number;
      expires_at: string;
      revoked_at: string | null;
      username: string;
      display_name: string;
      status: string;
      staff_id: number | null;
      must_change_password: number;
    }>(
      `SELECT s.token, s.user_id, s.expires_at, s.revoked_at, u.username, u.display_name, u.status, u.staff_id,
              u.must_change_password
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
      [token],
    );
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.status !== 'active') return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    const { permissions, isAdministrator } = resolvePermissions(this.db, row.user_id);
    return {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name || row.username,
      permissions: permissions as Set<Permission>,
      isAdministrator,
      sessionId: row.token.slice(0, 12),
      staffId: row.staff_id,
      mustChangePassword: Boolean(row.must_change_password),
    };
  }

  touchSession(token: string | null): void {
    if (!token) return;
    try {
      this.db.run('UPDATE sessions SET last_seen_at = ? WHERE token = ?', [nowIso(), token]);
    } catch {
      /* a lost heartbeat must never fail the operation */
    }
  }

  revokeSession(token: string): void {
    this.db.run('UPDATE sessions SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL', [nowIso(), token]);
  }

  revokeAllSessions(userId: number): void {
    this.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), userId]);
  }

  // ── Audit ──────────────────────────────────────────────────────────────

  audit(actor: Actor | null, input: AuditInput): void {
    writeAudit(this.db, actor, input);
  }

  auditFailure(actor: Actor | null, input: AuditInput): void {
    try {
      writeAudit(this.db, actor, { ...input, result: 'failure' });
    } catch {
      /* auditing a failure must not mask the original error */
    }
  }

  // ── Identifier generation ──────────────────────────────────────────────

  nextPatientCode(): string {
    const next = this.settings.get('patients.nextCode');
    this.settings.set('patients.nextCode', next + 1);
    return `P-${String(next).padStart(6, '0')}`;
  }

  nextDocumentNo(prefix: string, table: 'invoices' | 'payments' | 'prescriptions', column: string, pad = 5): string {
    const year = new Date().getFullYear();
    const like = `${prefix}-${year}-%`;
    const row = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE ?`,
      [like],
    );
    const count = Number(row?.n ?? 0);
    return `${prefix}-${year}-${String(count + 1).padStart(pad, '0')}`;
  }

  // ── Search normalisation ───────────────────────────────────────────────

  static normaliseForSearch(value: string): string {
    return toEnglishDigits(String(value ?? ''))
      .toLowerCase()
      .normalize('NFC')
      .replace(/[‐-―]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  buildSearchBlob(parts: (string | null | undefined)[]): string {
    return Container.normaliseForSearch(parts.filter(Boolean).join(' '));
  }

  // ── Activation ─────────────────────────────────────────────────────────

  /**
   * Reads the activation record and checks it against the per-install proof, so
   * a hand-edited database is treated as unactivated rather than trusted.
   */
  activation(): ActivationState {
    return readActivationRecord(
      {
        activated: this.settings.getState('activation.activated'),
        activated_at: this.settings.getState('activation.activated_at'),
        machine: this.settings.getState('activation.machine'),
      },
      {
        secret: this.settings.getState(ACTIVATION_PROOF_KEYS.secret),
        verifier: this.settings.getState(ACTIVATION_PROOF_KEYS.verifier),
      },
    );
  }

  /** Writes the activation record together with its proof. */
  writeActivation(now: string): ActivationState {
    const record = buildActivationRecord(now, this.machine);
    const proof = buildInstallProof(now, this.machine);
    this.db.transaction(() => {
      this.settings.setState('activation.activated', record.activated);
      this.settings.setState('activation.activated_at', record.activated_at);
      this.settings.setState('activation.machine', record.machine);
      this.settings.setState(ACTIVATION_PROOF_KEYS.secret, proof.secret);
      this.settings.setState(ACTIVATION_PROOF_KEYS.verifier, proof.verifier);
    });
    this.settings.invalidate();
    return { activated: true, activatedAt: now, machine: this.machine };
  }

  // ── Health ─────────────────────────────────────────────────────────────

  integrityCheck(): { ok: boolean; message: string } {
    const result = this.db.quickCheck();
    if (result === 'ok') return { ok: true, message: 'Database integrity verified.' };
    return { ok: false, message: `Database integrity problem detected: ${result}` };
  }

  assertWritable(): void {
    const row = this.db.get<{ free: number }>('PRAGMA freelist_count');
    if (row && Number(row.free) > 0) {
      this.logger.debug('db.freelist', { pages: Number(row.free) });
    }
  }

  close(): void {
    try {
      this.db.checkpoint();
    } catch {
      /* ignore */
    }
    this.db.close();
  }
}

export function requireClinicRow(c: Container): Record<string, unknown> {
  const row = c.db.get<Record<string, unknown>>('SELECT * FROM clinic WHERE id = 1');
  if (!row) {
    throw new AppError('not_configured', 'The clinic profile has not been set up yet.');
  }
  return row;
}
