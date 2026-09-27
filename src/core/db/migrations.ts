import { createHash } from 'node:crypto';
import { SCHEMA_SQL } from './schema';
import { Db, nowIso } from './connection';
import { AppError } from '../errors';
import { SCHEMA_VERSION } from '../../shared/constants';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

/**
 * Migrations are append-only and immutable. Editing a released migration is a
 * release blocker, so the checksum of every applied migration is verified on
 * every startup and a mismatch aborts before any data is touched.
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial_schema', sql: SCHEMA_SQL, checksum: checksumOf(SCHEMA_SQL) },
  {
    // The waiting room creates a visit when a patient is called, and the queue
    // board needs to link back to it.
    version: 2,
    name: 'queue_entry_visit_link',
    sql: 'ALTER TABLE queue_entries ADD COLUMN visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL;',
    checksum: checksumOf('ALTER TABLE queue_entries ADD COLUMN visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL;'),
  },
];

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export interface MigrationResult {
  applied: number[];
  alreadyApplied: number;
  version: number;
}

export function runMigrations(db: Db): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const rows = db.all<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM schema_migrations',
  );
  const byVersion = new Map(rows.map((r) => [Number(r.version), r]));

  const latest = Math.max(...MIGRATIONS.map((m) => m.version));
  for (const applied of byVersion.values()) {
    const known = MIGRATIONS.find((m) => m.version === Number(applied.version));
    if (!known) {
      throw new AppError(
        'database_error',
        'This database was created by a newer version of Dentiva Pro. Please update the application.',
      );
    }
    if (applied.checksum !== known.checksum) {
      throw new AppError(
        'database_error',
        `Database migration ${known.version} (${known.name}) does not match the installed application. ` +
          'The database file has not been modified. Restore a backup or reinstall the matching version.',
      );
    }
  }

  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (byVersion.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.run('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [
        migration.version,
        migration.name,
        migration.checksum,
        nowIso(),
      ]);
    });
    db.clearCache();
    applied.push(migration.version);
  }

  return { applied, alreadyApplied: rows.length, version: latest };
}

export function currentSchemaVersion(db: Db): number {
  const row = db.get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');
  const v = row ? Number(row.v) : 0;
  return v === 0 ? SCHEMA_VERSION : v;
}
