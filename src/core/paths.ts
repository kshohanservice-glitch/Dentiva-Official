import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Application-managed directories.
 *
 * Rule: every path the app writes to lives under ONE root. Uninstalling must
 * never remove it, and the app never writes anywhere else.
 */
export interface AppPaths {
  root: string;
  dbFile: string;
  logsDir: string;
  attachmentsDir: string;
  exportsDir: string;
  backupDefaultDir: string;
  cacheDir: string;
}

export function defaultDataRoot(): string {
  if (process.env.DENTIVA_DATA_DIR) return resolve(process.env.DENTIVA_DATA_DIR);
  const home = homedir();
  if (platform() === 'win32') {
    const appData = process.env.APPDATA;
    return appData ? join(appData, 'Dentiva Pro') : join(home, 'AppData', 'Roaming', 'Dentiva Pro');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'Dentiva Pro') : join(home, '.config', 'Dentiva Pro');
}

export function defaultBackupRoot(): string {
  if (process.env.DENTIVA_BACKUP_DIR) return resolve(process.env.DENTIVA_BACKUP_DIR);
  const home = homedir();
  if (platform() === 'win32') {
    const docs = process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Documents') : join(home, 'Documents');
    return join(docs, 'Dentiva Pro Backups');
  }
  return join(home, 'Documents', 'Dentiva Pro Backups');
}

export function resolvePaths(rootOverride?: string): AppPaths {
  const root = rootOverride ? resolve(rootOverride) : defaultDataRoot();
  const paths: AppPaths = {
    root,
    dbFile: join(root, 'dentiva.db'),
    logsDir: join(root, 'logs'),
    attachmentsDir: join(root, 'attachments'),
    exportsDir: join(root, 'exports'),
    backupDefaultDir: defaultBackupRoot(),
    cacheDir: join(root, 'cache'),
  };
  for (const dir of [paths.root, paths.logsDir, paths.attachmentsDir, paths.exportsDir, paths.cacheDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
