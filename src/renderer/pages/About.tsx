import { type JSX } from 'react';
import { useApp } from '../app/state';
import { call, filesBridge } from '../lib/api';
import { Badge, Button, Card, DataTable, PageHeader, useResource, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { date } from '../lib/format';

interface Notice {
  name: string;
  version: string;
  license: string;
  use: string;
}

interface AboutModel {
  name: string;
  version: string;
  buildNumber: string;
  developer: string;
  email: string;
  copyright: string;
  license: string;
  activated: boolean;
  dataDir: string;
  platform: string;
  arch: string;
  node: string;
  electron: string;
  chromium: string;
  sqlite: string;
  schemaVersion: number;
  thirdPartyNotices: Notice[];
  offline: boolean;
  uncleanShutdown: boolean;
}

const RUNTIME_LABELS: { key: keyof AboutModel; label: string }[] = [
  { key: 'platform', label: 'Operating system' },
  { key: 'arch', label: 'Architecture' },
  { key: 'electron', label: 'Electron' },
  { key: 'chromium', label: 'Chromium' },
  { key: 'node', label: 'Node.js' },
  { key: 'sqlite', label: 'SQLite' },
  { key: 'schemaVersion', label: 'Database schema' },
  { key: 'buildNumber', label: 'Build' },
];

export function AboutPage(): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const about = useResource(() => call<AboutModel>('system.about'), [app.token]);

  const openDataFolder = async () => {
    const result = await filesBridge().openPath(about.data?.dataDir ?? '');
    if (!result.opened) toast.warning('Could not open the folder', 'Open it manually from the path below.');
  };

  const data = about.data;

  return (
    <>
      <PageHeader title="About Dentiva Pro" icon="info-circle" subtitle="Version, licence and runtime information" />

      <div className="grid grid-2-1">
        <div className="stack stack-3">
          <Card title={data?.name ?? 'Dentiva Pro'} icon="tooth">
            <div className="stack stack-3">
              <div className="row row-wrap row-2">
                <Badge tone="primary">Version {data?.version ?? '—'}</Badge>
                {data?.activated ? <Badge tone="ok">Activated</Badge> : <Badge tone="warn">Not activated</Badge>}
                <Badge tone="info">Fully offline</Badge>
              </div>
              <p className="text-sm text-2" style={{ lineHeight: 'var(--lh-relaxed)' }}>
                Dentiva Pro is a dental clinic management system for Bangladeshi practices. Every record is stored in a
                local SQLite database on this workstation. The application never connects to the internet, and no
                patient data is ever transmitted anywhere.
              </p>
              <div className="divider" />
              <div className="detail-grid">
                <div className="detail-row detail-row--wide">
                  <span className="detail-label">Licence</span>
                  <span className="detail-value">{data?.license ?? '—'}</span>
                </div>
                <div className="detail-row detail-row--wide">
                  <span className="detail-label">Data folder</span>
                  <span className="detail-value row row-2">
                    <span className="mono text-xs truncate">{data?.dataDir ?? '—'}</span>
                    <Button size="sm" icon="folder-open" onClick={() => void openDataFolder()}>Open</Button>
                  </span>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Runtime" icon="settings" subtitle="What this installation is running on" flush>
            <DataTable
              rows={data ? RUNTIME_LABELS.map((entry) => ({ id: String(entry.key), label: entry.label, value: String(data[entry.key] ?? '—') })) : []}
              loading={about.loading}
              columns={[
                { key: 'label', header: 'Component', width: 220, render: (row) => row.label },
                { key: 'value', header: 'Version', render: (row) => <span className="mono text-sm">{row.value}</span> },
              ]}
              empty={<div className="state state--compact"><div className="state-title">Loading runtime information…</div></div>}
            />
          </Card>

          <Card
            title="Third-party notices"
            icon="file-text"
            subtitle="Open-source components used by Dentiva Pro"
            flush
          >
            <DataTable
              rows={(data?.thirdPartyNotices ?? []).map((notice, index) => ({ ...notice, id: `${notice.name}-${index}` }))}
              columns={[
                { key: 'name', header: 'Component', width: 200, render: (row) => <span className="truncate">{row.name}</span> },
                { key: 'version', header: 'Version', width: 140, render: (row) => row.version },
                { key: 'license', header: 'Licence', width: 150, render: (row) => row.license },
                { key: 'use', header: 'Purpose', render: (row) => <span className="truncate">{row.use}</span> },
              ]}
              empty={<div className="state state--compact"><div className="state-title">Loading notices…</div></div>}
            />
          </Card>
        </div>

        <div className="stack stack-3">
          <Card title="Developer" icon="user">
            <div className="stack stack-2">
              <div>
                <div className="detail-label">Developed by</div>
                <div className="detail-value">{data?.developer ?? '—'}</div>
              </div>
              <div>
                <div className="detail-label">Contact</div>
                <div className="detail-value mono text-sm">{data?.email ?? '—'}</div>
              </div>
              <div>
                <div className="detail-label">Copyright</div>
                <div className="detail-value text-sm">{data?.copyright ?? '—'}</div>
              </div>
              <Button
                icon="mail"
                onClick={() => void filesBridge().openExternal(`mailto:${data?.email ?? ''}`)}
              >
                Email the developer
              </Button>
            </div>
          </Card>

          <Card title="Privacy" icon="lock">
            <ul className="stack stack-2 text-sm text-2">
              <li className="row row-top"><Icon name="check" size={15} className="text-ok" /> No analytics, telemetry or crash reporting is sent anywhere.</li>
              <li className="row row-top"><Icon name="check" size={15} className="text-ok" /> No account, subscription or cloud service is required.</li>
              <li className="row row-top"><Icon name="check" size={15} className="text-ok" /> Passwords are hashed with a memory-hard function and never stored or logged in plain text.</li>
              <li className="row row-top"><Icon name="check" size={15} className="text-ok" /> Every change to a clinical or financial record is written to the audit log.</li>
            </ul>
          </Card>

          {data?.uncleanShutdown ? (
            <Card title="Shutdown notice" icon="alert-triangle">
              <p className="text-sm text-2">
                The previous session ended unexpectedly. The database integrity check ran automatically at start-up and
                passed. Run a backup from <strong>Backup &amp; Restore</strong> as soon as convenient.
              </p>
            </Card>
          ) : null}

          <Card title="Shortcuts" icon="activity">
            <div className="kbd-list">
              <div className="kbd-row"><span>Command palette</span><span><span className="kbd">Ctrl</span> + <span className="kbd">K</span></span></div>
              <div className="kbd-row"><span>Global search</span><span><span className="kbd">Ctrl</span> + <span className="kbd">Shift</span> + <span className="kbd">F</span></span></div>
              <div className="kbd-row"><span>New patient</span><span><span className="kbd">Ctrl</span> + <span className="kbd">N</span></span></div>
              <div className="kbd-row"><span>Lock workstation</span><span><span className="kbd">Ctrl</span> + <span className="kbd">L</span></span></div>
            </div>
          </Card>

          <p className="text-xs text-3" style={{ textAlign: 'center' }}>
            Installed {date(app.status?.activatedAt ?? null, app.prefs) ? `· activated ${date(app.status?.activatedAt ?? null, app.prefs)}` : ''}
          </p>
        </div>
      </div>
    </>
  );
}
