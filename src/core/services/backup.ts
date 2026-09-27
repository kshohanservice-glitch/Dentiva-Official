import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Container } from '../container';
import { AppError } from '../errors';
import { nowIso } from '../db/connection';
import { resolveWithin, timestampSlug } from './files';
import { APP, SCHEMA_VERSION } from '../../shared/constants';
import type { Actor } from '../security/rbac';

export interface BackupManifest {
  format: 1;
  app: string;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  machine: string;
  hasAttachments: boolean;
  attachmentCount: number;
  files: { name: string; bytes: number; sha256: string }[];
}

export interface BackupRecord {
  id: number;
  folder: string;
  name: string;
  path: string;
  bytes: number;
}

const DB_FILE = 'data.db';
const MANIFEST_FILE = 'manifest.json';
const ATTACHMENT_FILE = 'attachments.json';

/**
 * Local, offline backup.
 *
 * A backup is a folder (not a zip) so a clinic can copy it with Explorer even
 * if Dentiva Pro is uninstalled. `data.db` is produced with `VACUUM INTO`,
 * which yields a transactionally consistent snapshot while the app keeps
 * running — no downtime and no risk of a torn copy.
 */
export class BackupService {
  constructor(private readonly container: Container) {}

  private get folder(): string {
    return this.container.settings.get('backup.folder') || this.container.paths.backupDefaultDir;
  }

  setFolder(folder: string): void {
    if (!folder.trim()) throw new AppError('validation', 'Choose a folder for backups.');
    const resolved = folder;
    try {
      mkdirSync(resolved, { recursive: true });
    } catch (error) {
      throw new AppError('backup_error', `The backup folder cannot be created: ${(error as Error).message}`, { cause: error });
    }
    this.container.settings.set('backup.folder', resolved);
  }

  listExisting(): BackupRecord[] {
    const root = this.folder;
    if (!existsSync(root)) return [];
    const out: BackupRecord[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('DentivaPro_Backup_')) continue;
      const manifestPath = join(root, entry.name, MANIFEST_FILE);
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
        const dbPath = join(root, entry.name, DB_FILE);
        const size = existsSync(dbPath) ? statSync(dbPath).size : 0;
        out.push({ id: 0, folder: root, name: entry.name, path: join(root, entry.name), bytes: size || manifest.files.reduce((a, f) => a + f.bytes, 0) });
      } catch {
        out.push({ id: 0, folder: root, name: entry.name, path: join(root, entry.name), bytes: 0 });
      }
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  private uniqueFolderName(base: string): string {
    let name = base;
    let i = 1;
    while (existsSync(join(this.folder, name))) {
      i += 1;
      name = `${base}-${i}`;
    }
    return name;
  }

  create(kind: 'manual' | 'automatic' | 'pre-restore', actor: Actor | null): { id: number; name: string; path: string; bytes: number; manifest: BackupManifest } {
    const base = `DentivaPro_Backup_${timestampSlug()}`;
    const name = this.uniqueFolderName(base);
    const target = join(this.folder, name);
    const temp = `${target}.partial`;
    try {
      mkdirSync(temp, { recursive: true });
    } catch (error) {
      const message = `Backups cannot be written to "${this.folder}". Check that the folder exists and is writable.`;
      this.recordFailure(kind, this.folder, name, message, actor);
      throw new AppError('backup_error', message, { cause: error });
    }

    let bytes = 0;
    try {
      const dbTarget = join(temp, DB_FILE);
      this.container.db.vacuumInto(dbTarget);
      const dbBytes = statSync(dbTarget).size;
      bytes += dbBytes;

      // The attachment vault can be very large; record a manifest of the files
      // and copy only what exists. Content integrity is verified per file.
      const attachmentDir = this.container.paths.attachmentsDir;
      const files: BackupManifest['files'] = [
        { name: DB_FILE, bytes: dbBytes, sha256: sha256File(dbTarget) },
      ];
      let attachmentCount = 0;
      if (existsSync(attachmentDir)) {
        const copied = copyTree(attachmentDir, join(temp, 'attachments'));
        attachmentCount = copied.count;
        for (const entry of copied.files) {
          // Names are recorded relative to the backup folder, so validation and
          // restore can resolve them without guessing where attachments live.
          files.push({ ...entry, name: `attachments/${entry.name}` });
          bytes += entry.bytes;
        }
      }
      writeFileSync(join(temp, ATTACHMENT_FILE), JSON.stringify({ count: attachmentCount }, null, 2));

      const manifest: BackupManifest = {
        format: 1,
        app: APP.name,
        appVersion: APP.version,
        schemaVersion: SCHEMA_VERSION,
        createdAt: nowIso(),
        machine: this.container.machine,
        hasAttachments: attachmentCount > 0,
        attachmentCount,
        files,
      };
      writeFileSync(join(temp, MANIFEST_FILE), JSON.stringify(manifest, null, 2));

      this.container.db.checkpoint();
      rmSync(target, { recursive: true, force: true });
      renameSync(temp, target);
      const id = this.container.db.insert(
        `INSERT INTO backups (kind, folder, file_name, size_bytes, status, app_version, schema_version, created_at, created_by)
         VALUES (?, ?, ?, ?, 'success', ?, ?, ?, ?)`,
        [kind, this.folder, name, bytes, APP.version, SCHEMA_VERSION, nowIso(), actor?.userId ?? null],
      );
      this.container.audit(actor, { action: 'backup.create', entity: 'backup', entityId: id, summary: `${kind} backup "${name}" created (${bytes} bytes)` });
      this.container.logger.info('backup.created', { kind, name, bytes });
      this.pruneAutomatic(kind);
      return { id, name, path: target, bytes, manifest };
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      const message = `The backup could not be completed: ${(error as Error).message}`;
      this.recordFailure(kind, this.folder, name, message, actor);
      this.container.logger.error('backup.failed', { kind, error: (error as Error).message });
      throw new AppError('backup_error', message, { cause: error });
    }
  }

  private recordFailure(kind: string, folder: string, fileName: string, error: string, actor: Actor | null): void {
    try {
      this.container.db.insert(
        `INSERT INTO backups (kind, folder, file_name, size_bytes, status, error, app_version, schema_version, created_at, created_by)
         VALUES (?, ?, ?, 0, 'failed', ?, ?, ?, ?, ?)`,
        [kind, folder, fileName, error, APP.version, SCHEMA_VERSION, nowIso(), actor?.userId ?? null],
      );
    } catch {
      /* never let bookkeeping mask the original failure */
    }
  }

  validate(backupPath: string): BackupManifest {
    if (!existsSync(backupPath)) throw new AppError('restore_error', 'That backup folder no longer exists.');
    const manifestPath = join(backupPath, MANIFEST_FILE);
    if (!existsSync(manifestPath)) throw new AppError('restore_error', 'This folder is not a Dentiva Pro backup (manifest.json is missing).');
    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
    } catch {
      throw new AppError('restore_error', 'The backup manifest is corrupted and cannot be read.');
    }
    if (manifest.app !== APP.name) throw new AppError('restore_error', 'This backup was not created by Dentiva Pro.');
    if (!manifest.files?.some((f) => f.name === DB_FILE)) {
      throw new AppError('restore_error', 'This backup does not contain a database file.');
    }
    for (const file of manifest.files) {
      const path = resolveWithin(backupPath, file.name);
      if (!existsSync(path)) throw new AppError('restore_error', `The backup is incomplete — "${file.name}" is missing.`);
      if (file.bytes > 0 && statSync(path).size !== file.bytes) {
        throw new AppError('restore_error', `The backup is corrupted — "${file.name}" has the wrong size.`);
      }
      if (file.sha256 && sha256File(path) !== file.sha256) {
        throw new AppError('restore_error', `The backup is corrupted — the checksum for "${file.name}" does not match.`);
      }
    }
    if (Number(manifest.schemaVersion) > SCHEMA_VERSION) {
      throw new AppError('restore_error', `This backup was created by a newer version of Dentiva Pro (schema ${manifest.schemaVersion}). Please update the application first.`);
    }
    return manifest;
  }

  /**
   * Delete a backup from disk. The path must resolve inside the configured
   * backup folder and point at a real Dentiva Pro backup, so a crafted
   * request can never remove arbitrary files.
   */
  remove(backupPath: string, confirmName: string, actor: Actor | null): { removed: string; freedBytes: number } {
    const root = resolve(this.folder);
    const target = resolve(backupPath);
    const name = target.split(/[\\/]/).pop() ?? '';
    if (target === root) {
      throw new AppError('validation', 'The backup folder itself cannot be deleted.');
    }
    if (dirname(target) !== root) {
      throw new AppError('validation', 'Only backups inside the configured backup folder can be deleted.');
    }
    if (!name.startsWith('DentivaPro_Backup_')) {
      throw new AppError('validation', 'That folder is not a Dentiva Pro backup.');
    }
    if (name !== confirmName) {
      throw new AppError('validation', 'Type the backup name exactly to confirm the deletion.');
    }
    if (!existsSync(target)) {
      throw new AppError('not_found', 'That backup has already been deleted.');
    }
    const manifest = this.validate(target);
    const bytes = manifest.files.reduce((sum, file) => sum + Number(file.bytes ?? 0), 0);
    rmSync(target, { recursive: true, force: true });
    this.container.db.run('DELETE FROM backups WHERE folder = ? AND file_name = ?', [this.folder, name]);
    this.container.audit(actor, {
      action: 'backup.delete', entity: 'backup',
      summary: `Backup "${name}" deleted from disk`,
      metadata: { bytes },
    });
    return { removed: name, freedBytes: bytes };
  }

  /**
   * Restore is deliberately conservative:
   *   1. validate, 2. pre-restore safety backup, 3. swap the database file,
   *   4. reopen and integrity-check, 5. roll back on any failure.
   * The live database is never removed before a viable replacement exists.
   */
  restore(backupPath: string, actor: Actor | null): { name: string; preRestoreBackup: string | null; integrityOk: boolean } {
    this.validate(backupPath);
    const name = backupPath.split(/[\\/]/).pop() ?? 'backup';

    let preRestoreName: string | null = null;
    try {
      preRestoreName = this.create('pre-restore', actor).name;
    } catch (error) {
      throw new AppError(
        'restore_error',
        `A safety backup could not be created, so the restore was stopped. Fix the backup folder first. (${(error as Error).message})`,
        { cause: error },
      );
    }

    const liveDb = this.container.paths.dbFile;
    const liveDir = join(this.container.paths.root, 'restore');
    mkdirSync(liveDir, { recursive: true });
    const restoreSource = join(backupPath, DB_FILE);
    const stagedDb = join(liveDir, `restore-${Date.now()}.db`);
    const oldDb = join(liveDir, `previous-${Date.now()}.db`);

    try {
      copyTreeFile(restoreSource, stagedDb);
      this.container.db.checkpoint();
      this.container.db.close();

      const hadDb = existsSync(liveDb);
      if (hadDb) {
        for (const suffix of ['-wal', '-shm']) {
          const side = `${liveDb}${suffix}`;
          if (existsSync(side)) rmSync(side, { force: true });
        }
        renameSync(liveDb, oldDb);
      }
      renameSync(stagedDb, liveDb);

      const manifest = JSON.parse(readFileSync(join(backupPath, MANIFEST_FILE), 'utf8')) as BackupManifest;
      const attachmentFiles = manifest.files.filter((f) => f.name.startsWith('attachments/'));
      if (manifest.hasAttachments || attachmentFiles.length > 0) {
        // Replace the vault wholesale so files deleted since the backup do not
        // linger and point at records that no longer exist.
        rmSync(this.container.paths.attachmentsDir, { recursive: true, force: true });
        mkdirSync(this.container.paths.attachmentsDir, { recursive: true });
        for (const file of attachmentFiles) {
          const relative = file.name.slice('attachments/'.length);
          copyTreeFile(resolveWithin(backupPath, file.name), resolveWithin(this.container.paths.attachmentsDir, relative));
        }
      }

      const integrity = this.reopenAndCheck();
      if (!integrity.ok) {
        this.container.close();
        rmSync(liveDb, { force: true });
        if (hadDb && existsSync(oldDb)) renameSync(oldDb, liveDb);
        this.container.reopen();
        throw new AppError('restore_error', 'The restored database failed its integrity check. The previous data has been put back.');
      }

      this.container.db.run("UPDATE backups SET status = 'restored', restored_at = ? WHERE file_name = ?", [nowIso(), name]);
      this.container.logger.info('backup.restored', { name, preRestore: preRestoreName });
      return { name, preRestoreBackup: preRestoreName, integrityOk: true };
    } catch (error) {
      try {
        if (!existsSync(liveDb) && existsSync(oldDb)) renameSync(oldDb, liveDb);
        this.container.reopen();
      } catch {
        /* reported below */
      }
      rmSync(stagedDb, { force: true });
      if (error instanceof AppError) throw error;
      throw new AppError('restore_error', `The restore could not be completed: ${(error as Error).message}`, { cause: error });
    }
  }

  private reopenAndCheck(): { ok: boolean; message: string } {
    this.container.reopen();
    return this.container.integrityCheck();
  }

  /** Keep the newest N automatic backups; manual and pre-restore are never pruned. */
  private pruneAutomatic(kind: string): void {
    if (kind !== 'automatic') return;
    const keep = this.container.settings.get('backup.retentionCount');
    if (keep <= 0) return;
    const rows = this.container.db.all<{ id: number; folder: string; file_name: string }>(
      "SELECT id, folder, file_name FROM backups WHERE kind = 'automatic' AND status = 'success' ORDER BY created_at DESC, id DESC",
    );
    for (const row of rows.slice(keep)) {
      const path = join(row.folder, row.file_name);
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
      this.container.db.run('DELETE FROM backups WHERE id = ?', [row.id]);
    }
  }

  history(): Record<string, unknown>[] {
    return this.container.db.all(
      `SELECT b.*, u.display_name AS created_by_name FROM backups b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC, b.id DESC LIMIT 100`,
    );
  }

  /** Runs the automatic schedule. Failures are recorded and surfaced, never silent. */
  runAutomaticIfDue(actor: Actor | null): { ran: boolean; name?: string; error?: string } {
    const frequency = this.container.settings.get('backup.frequencyDays');
    if (!frequency) return { ran: false };
    const last = this.container.settings.get('backup.lastAutomaticAt');
    if (last) {
      const elapsedDays = (Date.now() - new Date(last).getTime()) / 86400000;
      if (elapsedDays < frequency) return { ran: false };
    }
    try {
      const result = this.create('automatic', actor);
      this.container.settings.set('backup.lastAutomaticAt', nowIso());
      return { ran: true, name: result.name };
    } catch (error) {
      this.container.settings.set('backup.lastAutomaticAt', nowIso());
      return { ran: true, error: (error as Error).message };
    }
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function copyTreeFile(source: string, target: string): void {
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, readFileSync(source));
}

function copyTree(source: string, target: string): { count: number; files: { name: string; bytes: number; sha256: string }[] } {
  mkdirSync(target, { recursive: true });
  let count = 0;
  const files: { name: string; bytes: number; sha256: string }[] = [];
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      const nested = copyTree(from, to);
      count += nested.count;
      files.push(...nested.files.map((f) => ({ ...f, name: `${entry.name}/${f.name}` })));
    } else {
      copyTreeFile(from, to);
      const bytes = statSync(to).size;
      files.push({ name: entry.name, bytes, sha256: sha256File(to) });
      count += 1;
    }
  }
  return { count, files };
}
