import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { call, configureApi } from '../lib/api';
import type { DisplayPrefs } from '../lib/format';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  staffId: number | null;
  mustChangePassword: boolean;
  permissions: string[];
  isAdministrator: boolean;
}

export type AppStage = 'loading' | 'activation' | 'setup' | 'login' | 'app';

export interface SystemStatus {
  version: string;
  schemaVersion: number;
  setupCompleted: boolean;
  activated: boolean;
  activatedAt: string | null;
  /** The stored activation record exists but no longer verifies. */
  activationTampered?: boolean;
  clinicName: string | null;
  hasAdmin: boolean;
  integrity: { ok: boolean; message: string };
  dataDir: string;
  backupFolder: string;
}

interface AppStateValue {
  stage: AppStage;
  status: SystemStatus | null;
  user: SessionUser | null;
  token: string | null;
  prefs: DisplayPrefs & {
    theme: 'light' | 'dark';
    density: 'comfortable' | 'compact';
    animations: boolean;
    sidebarCollapsed: boolean;
    autoLockMinutes: number;
  };
  sidebarCollapsed: boolean;
  locked: boolean;
  boot: () => Promise<void>;
  setToken: (token: string | null) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  lock: () => void;
  unlock: (password: string) => Promise<void>;
  setSidebarCollapsed: (collapsed: boolean) => void;
  applyPreferences: (prefs: Partial<AppStateValue['prefs']>) => void;
  has: (permission: string) => boolean;
  hasAny: (...permissions: string[]) => boolean;
  clinicName: string;
}

const DEFAULT_PREFS: AppStateValue['prefs'] = {
  theme: 'light',
  density: 'comfortable',
  animations: true,
  bengaliNumerals: false,
  dateFormat: 'dmy',
  timeFormat: '12h',
  sidebarCollapsed: false,
  autoLockMinutes: 10,
};

const AppStateContext = createContext<AppStateValue | null>(null);

const TOKEN_KEY = 'dentiva.session';

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [stage, setStage] = useState<AppStage>('loading');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setTokenState] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [prefs, setPrefs] = useState<AppStateValue['prefs']>(DEFAULT_PREFS);
  const [locked, setLocked] = useState(false);

  // The API client asks for the token through a ref rather than through
  // render state. A page's own effects run before this provider's, so with a
  // state-based provider the first calls after signing in went out with no
  // token, came back unauthorised, and cleared the session that had just been
  // established — leaving an empty sidebar and "this could not be loaded" on
  // a perfectly good sign-in. The ref is written the moment the token changes.
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;

  const setToken = useCallback((next: string | null) => {
    if (next) sessionStorage.setItem(TOKEN_KEY, next);
    else sessionStorage.removeItem(TOKEN_KEY);
    tokenRef.current = next;
    setTokenState(next);
  }, []);

  const applyPreferences = useCallback((partial: Partial<AppStateValue['prefs']>) => {
    setPrefs((current) => ({ ...current, ...partial }));
  }, []);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setLocked(false);
  }, [setToken]);

  useEffect(() => {
    configureApi({
      getToken: () => tokenRef.current,
      onAuthLost: clearSession,
    });
  }, [clearSession]);

  // Reflect preferences onto the document so CSS tokens switch instantly.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.density;
    root.dataset.motion = prefs.animations ? 'on' : 'off';
  }, [prefs.theme, prefs.density, prefs.animations]);

  const loadPreferences = useCallback(async () => {
    try {
      const publicPrefs = await call<Partial<AppStateValue['prefs']>>('settings.publicPrefs');
      applyPreferences({ ...DEFAULT_PREFS, ...publicPrefs });
    } catch {
      /* defaults are fine when preferences cannot be read yet */
    }
  }, [applyPreferences]);

  const boot = useCallback(async () => {
    setStage('loading');
    try {
      const next = await call<SystemStatus>('system.status');
      setStatus(next);
      await loadPreferences();
      if (!next.activated) {
        setStage('activation');
        return;
      }
      if (!next.setupCompleted) {
        setStage('setup');
        return;
      }
      if (token) {
        try {
          const me = await call<SessionUser>('auth.me');
          setUser(me);
          setStage('app');
          return;
        } catch {
          clearSession();
        }
      }
      setStage('login');
    } catch (error) {
      setStatus({
        version: '1.0.0',
        schemaVersion: 0,
        setupCompleted: false,
        activated: false,
        activatedAt: null,
        activationTampered: false,
        clinicName: null,
        hasAdmin: false,
        integrity: { ok: false, message: error instanceof Error ? error.message : 'Startup failed.' },
        dataDir: '',
        backupFolder: '',
      });
      setStage('activation');
    }
  }, [token, clearSession, loadPreferences]);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await call<{ token: string; user: SessionUser }>('auth.login', { username, password });
      setToken(result.token);
      setUser(result.user);
      setLocked(false);
      await loadPreferences();
      setStage('app');
    },
    [setToken, loadPreferences],
  );

  const logout = useCallback(async () => {
    try {
      await call('auth.logout');
    } catch {
      /* signing out locally is enough if the server call fails */
    }
    clearSession();
    setStage('login');
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const me = await call<SessionUser>('auth.me');
    setUser(me);
  }, []);

  const lock = useCallback(() => setLocked(true), []);
  const unlock = useCallback(
    async (password: string) => {
      await call('auth.unlock', { password });
      setLocked(false);
    },
    [],
  );

  const permissionSet = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const has = useCallback((permission: string) => permissionSet.has(permission), [permissionSet]);
  const hasAny = useCallback(
    (...permissions: string[]) => permissions.length === 0 || permissions.some((permission) => permissionSet.has(permission)),
    [permissionSet],
  );

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setPrefs((current) => ({ ...current, sidebarCollapsed: collapsed }));
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      stage,
      status,
      user,
      token,
      prefs,
      sidebarCollapsed: prefs.sidebarCollapsed,
      locked,
      boot,
      setToken,
      login,
      logout,
      refreshUser,
      lock,
      unlock,
      setSidebarCollapsed,
      applyPreferences,
      has,
      hasAny,
      clinicName: status?.clinicName ?? 'Dental Clinic',
    }),
    [stage, status, user, token, prefs, locked, boot, setToken, login, logout, refreshUser, lock, unlock, setSidebarCollapsed, applyPreferences, has, hasAny],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useApp(): AppStateValue {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useApp must be used inside <AppProvider>.');
  return context;
}

/** Permission gate for a whole screen. */
export function usePermission(permission: string): boolean {
  return useApp().has(permission);
}
