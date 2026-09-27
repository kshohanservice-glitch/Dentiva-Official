import { useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useShell } from '../app/AppShell';
import { call, ApiError, filesBridge } from '../lib/api';
import {
  Badge, Button, Callout, Card, DataTable, Field, Modal, PageHeader, Stat, TextInput,
  useConfirm, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { dateAndTime, relativeTime } from '../lib/format';

interface BackupRow {
  id: number;
  folder: string;
  name: string;
  path: string;
  bytes: number;
}

interface HistoryRow {
  id: number;
  name: string;
  path: string;
  kind: string;
  size_bytes: number;
  file_count: number;
  checksum: string | null;
  created_at: string;
  created_by_name: string | null;
  note: string | null;
}

interface BackupOverview {
  history: HistoryRow[];
  available: BackupRow[];
  folder: string;
  frequencyDays: number;
  retention: number;
  lastAutomaticAt: string | null;
}

interface Manifest {
  format: number;
  app: string;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  machine: string;
  hasAttachments: boolean;
  attachmentCount: number;
  files: { name: string; bytes: number; sha256: string }[];
}

function megabytes(bytes: number): string {
  if (!bytes) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupPage(): JSX.Element {
  const app = useApp();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();

  const overview = useResource(() => call<BackupOverview>('backups.list'), [shell.refreshSignal]);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<BackupRow | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [validating, setValidating] = useState('');

  const data = overview.data;
  const currentFolder = folder || data?.folder || '';

  const saveFolder = async () => {
    const value = currentFolder.trim();
    if (!value) return;
    setBusy(true);
    try {
      await call('backups.setFolder', { folder: value });
      toast.success('Backup folder updated', value);
      setFolder('');
      overview.reload();
    } catch (caught) {
      toast.error('Folder not saved', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    const result = await filesBridge().chooseFolder('Choose a folder for backups', currentFolder || undefined);
    if (result.path) setFolder(result.path);
  };

  const createBackup = async () => {
    setBusy(true);
    try {
      const result = await call<{ name: string; path: string; bytes: number }>('backups.create');
      toast.success('Backup created', `${result.name} · ${megabytes(result.bytes)}`);
      overview.reload();
    } catch (caught) {
      toast.error('Backup failed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const validate = async (row: BackupRow) => {
    setValidating(row.path);
    setRestoring(row);
    setManifest(null);
    setConfirmName('');
    setRestoreError('');
    try {
      const result = await call<Manifest>('backups.validate', { path: row.path });
      setManifest(result);
    } catch (caught) {
      setRestoreError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'This backup could not be validated.');
    } finally {
      setValidating('');
    }
  };

  const restore = async () => {
    if (!restoring) return;
    setBusy(true);
    setRestoreError('');
    try {
      const result = await call<{ name: string; preRestoreBackup: string | null; integrityOk: boolean }>('backups.restore', {
        path: restoring.path,
        confirmName: confirmName.trim(),
      });
      toast.success('Backup restored', result.integrityOk ? 'Integrity check passed.' : 'Restored, but run the integrity check.');
      setRestoring(null);
      overview.reload();
      shell.requestRefresh();
    } catch (caught) {
      setRestoreError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'The restore failed.');
    } finally {
      setBusy(false);
    }
  };

  const deleteBackup = async (row: BackupRow) => {
    const ok = await confirm({
      title: `Delete ${row.name}?`,
      message: 'The backup folder and its contents are removed from disk. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete backup',
      requireText: row.name,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await call<{ removed: string; freedBytes: number }>('backups.remove', {
        path: row.path,
        confirmName: row.name,
      });
      toast.success('Backup deleted', `${result.removed} · ${megabytes(result.freedBytes)} freed`);
      overview.reload();
    } catch (caught) {
      toast.error('Backup not deleted', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!app.has('backup.create') && !app.has('backup.restore')) {
    return (
      <>
        <PageHeader title="Backup & Restore" icon="database" />
        <Callout tone="warn" title="No access">
          Your role does not include backup permissions. Ask an administrator to run backups for this workstation.
        </Callout>
      </>
    );
  }

  const totalBytes = (data?.available ?? []).reduce((sum, row) => sum + Number(row.bytes ?? 0), 0);
  const lastAutomatic = data?.lastAutomaticAt ? relativeTime(data.lastAutomaticAt) : 'never';

  return (
    <>
      <PageHeader
        title="Backup & Restore"
        icon="database"
        subtitle="Everything is written to a local folder. No copy ever leaves this computer."
        actions={
          app.has('backup.create') ? (
            <Button variant="primary" icon="save" loading={busy} onClick={() => void createBackup()}>
              Back up now
            </Button>
          ) : null
        }
      />

      {overview.error ? (
        <Callout tone="danger" title="Backups could not be listed">
          {overview.error instanceof Error ? overview.error.message : 'Unknown error.'}{' '}
          <button type="button" className="link-btn" onClick={overview.reload}>Try again</button>
        </Callout>
      ) : null}

      <div className="stat-grid stat-grid--compact">
        <Stat
          label="Backups on disk"
          value={data?.available.length ?? 0}
          meta={`${megabytes(totalBytes)} total`}
          icon="database"
        />
        <Stat
          label="Automatic schedule"
          value={data?.frequencyDays ? `Every ${data.frequencyDays} day${data.frequencyDays === 1 ? '' : 's'}` : 'Off'}
          meta={`Last run ${lastAutomatic}`}
          icon="clock"
          tone={data?.frequencyDays ? 'ok' : 'warn'}
        />
        <Stat label="Backups kept" value={data?.retention ?? 0} meta="Older automatic backups are pruned" icon="trash" />
        <Stat
          label="Last manual backup"
          value={data?.history[0] ? relativeTime(data.history[0].created_at) : 'never'}
          meta={data?.history[0]?.name ?? 'No backup has been taken yet'}
          icon="clock"
        />
      </div>

      <div className="grid grid-2-1 mt-4">
        <div className="stack stack-3">
          <Card title="Backups on disk" icon="database" subtitle="Restore replaces everything currently in the database" flush>
            <DataTable
              rows={data?.available ?? []}
              loading={overview.loading}
              columns={[
                { key: 'name', header: 'Backup', render: (row) => <span className="mono text-sm">{row.name}</span> },
                { key: 'size', header: 'Size', width: 96, numeric: true, render: (row) => megabytes(Number(row.bytes ?? 0)) },
                { key: 'path', header: 'Location', render: (row) => <span className="mono text-xs truncate">{row.path}</span> },
                {
                  key: 'actions',
                  header: '',
                  width: 210,
                  render: (row) => (
                    <div className="row row-2 row-end">
                      <Button size="sm" icon="folder-open" onClick={() => void filesBridge().openPath(row.path)}>Open</Button>
                      {app.has('backup.restore') ? (
                        <Button
                          size="sm"
                          variant="primary"
                          icon="upload"
                          loading={validating === row.path}
                          onClick={() => void validate(row)}
                        >
                          Restore
                        </Button>
                      ) : null}
                      {app.has('backup.create') ? (
                        <Button size="sm" variant="ghost" icon="trash" aria-label="Delete backup" onClick={() => void deleteBackup(row)} />
                      ) : null}
                    </div>
                  ),
                },
              ]}
              empty={<div className="state"><div className="state-title">No backups yet</div><div className="state-text">Take the first backup now, then keep the schedule on.</div></div>}
            />
          </Card>

          <Card title="Backup history" icon="activity" subtitle="Every backup ever taken from this workstation" flush>
            <DataTable
              rows={data?.history ?? []}
              loading={overview.loading}
              columns={[
                { key: 'created', header: 'When', width: 170, render: (row) => dateAndTime(row.created_at, '', app.prefs) },
                { key: 'name', header: 'Backup', render: (row) => <span className="mono text-xs truncate">{row.name}</span> },
                { key: 'kind', header: 'Type', width: 110, render: (row) => <Badge tone={row.kind === 'automatic' ? 'info' : 'neutral'}>{row.kind}</Badge> },
                { key: 'by', header: 'By', width: 140, render: (row) => <span className="truncate">{row.created_by_name ?? 'System'}</span> },
                { key: 'size', header: 'Size', width: 96, numeric: true, render: (row) => megabytes(Number(row.size_bytes ?? 0)) },
                { key: 'files', header: 'Files', width: 76, numeric: true, render: (row) => String(row.file_count ?? 0) },
              ]}
              empty={<div className="state state--compact"><div className="state-title">No history yet</div></div>}
            />
          </Card>
        </div>

        <div className="stack stack-3">
          {app.has('backup.create') ? (
            <Card title="Backup folder" icon="folder">
              <div className="stack stack-3">
                <Field label="Folder" hint="Backups are written here. Point it at a drive you also copy elsewhere.">
                  <TextInput
                    value={currentFolder}
                    onChange={(event) => setFolder(event.target.value)}
                    className="mono text-xs"
                    spellCheck={false}
                  />
                </Field>
                <div className="row row-2">
                  <Button icon="folder-open" onClick={() => void chooseFolder()}>Browse…</Button>
                  <Button variant="primary" icon="check" loading={busy} disabled={!folder.trim()} onClick={() => void saveFolder()}>
                    Save folder
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <Card title="How backups work" icon="info-circle">
            <ul className="stack stack-2 text-sm text-2">
              <li>The database is snapshotted with SQLite&rsquo;s own backup API, so a backup taken while the clinic is working is still consistent.</li>
              <li>Patient attachments are copied in full, and every file is recorded with a SHA-256 checksum in the manifest.</li>
              <li>A safety backup of the current data is taken automatically before any restore.</li>
              <li>Automatic backups run once per session when the schedule is due, and failures are reported rather than hidden.</li>
            </ul>
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(restoring)}
        title="Restore from backup"
        subtitle={restoring?.name}
        onClose={() => setRestoring(null)}
        width={640}
        closeOnBackdrop={false}
        footer={
          <>
            <Button onClick={() => setRestoring(null)}>Cancel</Button>
            <Button
              variant="danger"
              icon="upload"
              loading={busy}
              disabled={!manifest || confirmName.trim() !== restoring?.name}
              onClick={() => void restore()}
            >
              Restore and restart data
            </Button>
          </>
        }
      >
        <div className="stack stack-3">
          {restoreError ? <Callout tone="danger" title="Restore stopped">{restoreError}</Callout> : null}
          <Callout tone="warn" title="This replaces everything">
            Patients, invoices, payments, settings and accounts in the live database are replaced by the contents of
            this backup. A safety backup of the current data is taken first, and your session ends afterwards.
          </Callout>

          {!manifest && !restoreError ? <div className="skeleton" style={{ height: 120 }} /> : null}

          {manifest ? (
            <div className="detail-grid">
              <div className="detail-row">
                <span className="detail-label">Created</span>
                <span className="detail-value">{dateAndTime(manifest.createdAt, '', app.prefs)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Application</span>
                <span className="detail-value">{manifest.app} {manifest.appVersion}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Schema version</span>
                <span className="detail-value">{manifest.schemaVersion}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Attachments</span>
                <span className="detail-value">{manifest.hasAttachments ? `${manifest.attachmentCount} file(s)` : 'None'}</span>
              </div>
              <div className="detail-row detail-row--wide">
                <span className="detail-label">Checksums verified</span>
                <span className="detail-value text-ok">
                  <Icon name="check" size={13} /> {manifest.files.length} file(s) matched their SHA-256 checksum
                </span>
              </div>
            </div>
          ) : null}

          <Field
            label={`Type ${restoring?.name ?? ''} to confirm`}
            required
            hint="The name must match exactly."
          >
            <TextInput
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              className="mono text-sm"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
