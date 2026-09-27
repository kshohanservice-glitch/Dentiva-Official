import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { useApp } from './state';
import { useRoute, buildQuery, NotFound } from './router';
import { NAVIGATION, TITLES } from './navigation';
import { Icon, type IconName } from '../components/Icons';
import {
  Avatar, Badge, Button, EmptyState, IconButton, MenuItem, MenuSeparator, Popover, useToast,
} from '../components/ui';
import { call } from '../lib/api';
import { date, relativeTime } from '../lib/format';

export interface ShellContext {
  refreshSignal: number;
  requestRefresh: () => void;
  openNew: () => void;
}

import { createContext, useContext } from 'react';
export const ShellCtx = createContext<ShellContext>({ refreshSignal: 0, requestRefresh: () => {}, openNew: () => {} });
export function useShell(): ShellContext {
  return useContext(ShellCtx);
}

export interface NotificationRow {
  id: number;
  kind: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body: string;
  action_route: string;
  created_at: string;
  read_at: string | null;
}

const NOTIF_ICONS: Record<string, IconName> = {
  'low-stock': 'inventory',
  'out-of-stock': 'inventory',
  'expiring-stock': 'alert-triangle',
  'expired-stock': 'alert-triangle',
  'upcoming-appointment': 'calendar',
  queue: 'queue',
  backup: 'backup',
  'backup-done': 'check-circle',
  'backup-failed': 'alert-triangle',
  security: 'shield',
};

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const toast = useToast();
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const notifRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const lockTimer = useRef<number | null>(null);

  const requestRefresh = useCallback(() => setRefreshSignal((n) => n + 1), []);
  const openNew = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dentiva:new'));
  }, []);

  const visibleGroups = useMemo(
    () =>
      NAVIGATION.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.permissions.length === 0 || app.hasAny(...item.permissions)),
      })).filter((group) => group.items.length > 0),
    [app],
  );

  const activePath = route.segments.length >= 2 ? route.segments.slice(0, 2).join('/') : route.segments[0] ?? 'dashboard';

  // ── Notifications ──────────────────────────────────────────────────────
  const loadNotifications = useCallback(async () => {
    try {
      const result = await call<{ rows: NotificationRow[]; unread: number }>('notifications.list', { limit: 60 });
      setNotifications(result.rows);
      setUnread(result.unread);
    } catch {
      /* the bell is non-critical — never surface an error for it */
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(loadNotifications, 60_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications, refreshSignal]);

  // ── Automatic backup check (once per session) ──────────────────────────
  useEffect(() => {
    if (!app.has('backup.create')) return;
    void call<{ ran?: boolean; name?: string | null; error?: string | null }>('backups.runAutomatic', {})
      .then((result) => {
        if (result.error) toast.error('Automatic backup failed', result.error);
        else if (result.name) toast.success('Automatic backup completed', result.name);
      })
      .catch(() => undefined);
  }, [app, toast]);

  // ── Idle auto-lock ─────────────────────────────────────────────────────
  const resetIdle = useCallback(() => {
    if (app.stage !== 'app' || app.locked) return;
    if (lockTimer.current) window.clearTimeout(lockTimer.current);
    const minutes = app.prefs.autoLockMinutes;
    if (minutes <= 0) return;
    lockTimer.current = window.setTimeout(() => app.lock(), minutes * 60_000);
  }, [app]);

  useEffect(() => {
    const minutes = app.prefs.autoLockMinutes;
    if (app.stage !== 'app' || app.locked || minutes <= 0) return;
    if (lockTimer.current) window.clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(() => app.lock(), minutes * 60_000);
    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'wheel', 'touchstart', 'mousemove'];
    for (const event of events) window.addEventListener(event, resetIdle, { passive: true });
    return () => {
      if (lockTimer.current) window.clearTimeout(lockTimer.current);
      for (const event of events) window.removeEventListener(event, resetIdle);
    };
  }, [app, resetIdle]);

  // ── Global keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        app.lock();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        app.setSidebarCollapsed(!app.sidebarCollapsed);
        return;
      }
      if (typing) return;
      if (event.key === 'F5') {
        event.preventDefault();
        requestRefresh();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, requestRefresh]);

  const onNew = useCallback(() => openNew(), [openNew]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (custom.detail) route.navigate(custom.detail);
      else onNew();
    };
    window.addEventListener('dentiva:new', handler);
    return () => window.removeEventListener('dentiva:new', handler);
  }, [route, onNew]);

  const title = TITLES[activePath] ?? 'Dentiva Pro';

  return (
    <ShellCtx.Provider value={{ refreshSignal, requestRefresh, openNew: onNew }}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <header className="topbar">
          <IconButton
            icon="panel-left"
            label={app.sidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
            onClick={() => app.setSidebarCollapsed(!app.sidebarCollapsed)}
            active={!app.sidebarCollapsed}
          />
          <div className="brand">
            <span className="brand-mark"><Icon name="tooth" size={19} /></span>
            <span className="brand-text">
              <span className="brand-name">Dentiva Pro</span>
              <span className="brand-clinic truncate">{app.clinicName}</span>
            </span>
          </div>
          <span className="topbar-divider" aria-hidden="true" />
          <span className="text-sm text-2 text-nowrap">{title}</span>
          <span className="topbar-spacer" />
          <Button variant="soft" size="sm" icon="search" onClick={() => setPaletteOpen(true)}>
            Search <span className="kbd" style={{ marginLeft: 4 }}>Ctrl K</span>
          </Button>
          <div className="topbar-meta">
            <span className="topbar-user">{date(new Date().toISOString(), app.prefs)}</span>
            <span className="topbar-role">{app.user?.displayName ?? ''} · {app.user?.isAdministrator ? 'Administrator' : 'Staff'}</span>
          </div>
          <IconButton
            ref={notifRef}
            icon="bell"
            label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
            badge={unread}
            onClick={() => setNotifOpen((open) => !open)}
            active={notifOpen}
          />
          <button
            ref={menuRef}
            type="button"
            className="row row-2"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            <Avatar name={app.user?.displayName ?? 'U'} size="sm" />
            <Icon name="chevron-down" size={14} className="text-3" />
          </button>
        </header>

        <div className="shell-body" data-collapsed={app.sidebarCollapsed}>
          <nav className="sidebar" aria-label="Main navigation">
            <div className="sidebar-scroll">
              {visibleGroups.map((group) => (
                <div className="sidebar-group" key={group.id}>
                  <div className="sidebar-group-label">{group.label}</div>
                  {group.items.map((item) => {
                    const selected = activePath === item.path || (item.path === 'administration/staff' && activePath === 'administration/staff');
                    return (
                      <a
                        key={item.id}
                        href={`#/${item.path}`}
                        className="sidebar-item"
                        aria-current={selected ? 'page' : undefined}
                        title={app.sidebarCollapsed ? item.label : undefined}
                      >
                        <Icon name={item.icon} size={17} />
                        <span className="sidebar-item-label">{item.label}</span>
                      </a>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="sidebar-foot">
              <Button
                variant="ghost"
                size="sm"
                icon="lock"
                className="sidebar-foot-text"
                onClick={() => app.lock()}
                title="Lock application (Ctrl+L)"
              >
                Lock
              </Button>
            </div>
          </nav>

          <main className="content" id="main-content" tabIndex={-1}>
            <div className="content-inner">{children}</div>
          </main>
        </div>
      </div>

      <Popover open={notifOpen} onClose={() => setNotifOpen(false)} anchorRef={notifRef} width={420}>
        <div className="popover-head">
          <strong>Notifications</strong>
          <div className="row row-1">
            {unread > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void call('notifications.markAllRead', {}).then(() => loadNotifications());
                }}
              >
                Mark all read
              </Button>
            ) : null}
            <IconButton icon="refresh" label="Refresh" size={15} onClick={() => void loadNotifications()} />
          </div>
        </div>
        <div className="popover-body">
          {notifications.length === 0 ? (
            <EmptyState icon="bell" title="Nothing needs your attention" text="Low stock, expiring items, upcoming appointments and backup results appear here." compact />
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                className={`notif notif--${item.severity}`}
                data-unread={item.read_at ? 'false' : 'true'}
                role="button"
                tabIndex={0}
                onClick={() => {
                  void call('notifications.markRead', { id: item.id }).then(() => loadNotifications());
                  if (item.action_route) {
                    route.navigate(item.action_route);
                    setNotifOpen(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.currentTarget.click();
                  }
                }}
              >
                <span className="notif-icon"><Icon name={NOTIF_ICONS[item.kind] ?? 'info-circle'} size={16} /></span>
                <div className="grow">
                  <div className="notif-title">{item.title}</div>
                  {item.body ? <div className="notif-body">{item.body}</div> : null}
                  <div className="notif-time">{relativeTime(item.created_at)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </Popover>

      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef}>
        <div className="menu-label caps">Signed in as {app.user?.username}</div>
        <MenuItem icon="key" onClick={() => { setMenuOpen(false); route.navigate('administration/staff?tab=password'); }}>
          Change password
        </MenuItem>
        <MenuItem icon="settings" onClick={() => { setMenuOpen(false); route.navigate('administration/settings'); }}>
          Settings
        </MenuItem>
        <MenuItem icon="info" onClick={() => { setMenuOpen(false); route.navigate('administration/about'); }}>
          About Dentiva Pro
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="lock" onClick={() => { setMenuOpen(false); app.lock(); }}>
          Lock application
        </MenuItem>
        <MenuItem icon="logout" danger onClick={() => { setMenuOpen(false); void app.logout(); }}>
          Sign out
        </MenuItem>
      </Popover>

      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
    </ShellCtx.Provider>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }): JSX.Element {
  const route = useRoute();
  const app = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ groups: Record<string, { label: string; items: { id: number; code: string; title: string; subtitle: string; kind: string; route: string }[] }> } | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const flat = useMemo(() => {
    if (!results) return [];
    return Object.values(results.groups).flatMap((group) => group.items);
  }, [results]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void call<typeof results>('search.global', { query: query.trim() })
        .then((result) => {
          if (cancelled) return;
          setResults(result);
          setIndex(0);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const quickLinks = useMemo(
    () =>
      NAVIGATION.flatMap((group) => group.items)
        .filter((item) => item.permissions.length === 0 || app.hasAny(...item.permissions))
        .filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 6)
        .map((item) => ({ id: -1, code: '', title: item.label, subtitle: groupLabelFor(item.path), kind: 'nav', route: item.path })),
    [query, app],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const total = quickLinks.length + flat.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => (total ? (i + 1) % total : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => (total ? (i - 1 + total) % total : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = quickLinks[index] ?? flat[index - quickLinks.length];
      if (target) {
        route.navigate(target.route);
        onClose();
      }
    } else if (event.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Global search">
        <div className="palette-input-row">
          <Icon name="search" size={18} className="text-3" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search patients, invoices, payments, stock…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search"
            spellCheck={false}
          />
          {loading ? <span className="spinner" /> : null}
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-results">
          {quickLinks.length > 0 ? (
            <>
              <div className="palette-group-label">Go to</div>
              {quickLinks.map((item, i) => (
                <button
                  key={`nav-${item.route}`}
                  type="button"
                  className="palette-item"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => { route.navigate(item.route); onClose(); }}
                >
                  <Icon name="arrow-right" size={15} className="text-3" />
                  <span className="grow truncate">{item.title}</span>
                  <span className="text-xs text-3">{item.subtitle}</span>
                </button>
              ))}
            </>
          ) : null}

          {query.trim().length > 0 && results ? (
            flat.length === 0 && quickLinks.length === 0 ? (
              <EmptyState icon="search" title="No matches" text={`Nothing found for “${query}”.`} compact />
            ) : (
              Object.entries(results.groups).map(([kind, group]) => (
                <div key={kind}>
                  <div className="palette-group-label">{group.label}</div>
                  {group.items.map((item) => {
                    const flatIndex = quickLinks.length + flat.indexOf(item);
                    return (
                      <button
                        key={`${kind}-${item.id}`}
                        type="button"
                        className="palette-item"
                        aria-selected={flatIndex === index}
                        onMouseEnter={() => setIndex(flatIndex)}
                        onClick={() => { route.navigate(item.route); onClose(); }}
                      >
                        <span className="truncate">{item.title}</span>
                        <Badge>{item.code || item.subtitle}</Badge>
                      </button>
                    );
                  })}
                </div>
              ))
            )
          ) : null}

          {query.trim().length === 0 ? (
            <div style={{ padding: 12 }}>
              <div className="palette-group-label">Try</div>
              <div className="row row-wrap" style={{ gap: 6 }}>
                {['P-000001', '01712345678', 'INV', 'Rakibul'].map((sample) => (
                  <Button key={sample} size="sm" variant="soft" onClick={() => setQuery(sample)}>{sample}</Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="palette-foot">
          <span className="row row-1"><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span>
          <span className="row row-1"><span className="kbd">Enter</span> open</span>
          <span className="row row-1"><span className="kbd">Esc</span> close</span>
        </div>
      </div>
    </div>
  );
}

function groupLabelFor(path: string): string {
  for (const group of NAVIGATION) {
    if (group.items.some((item) => item.path === path)) return group.label;
  }
  return '';
}

export { NotFound, buildQuery };
