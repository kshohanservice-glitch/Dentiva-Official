import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { Button, Callout, TextInput } from '../components/ui';
import { Icon } from '../components/Icons';
import { ApiError } from '../lib/api';
import { useApp } from '../app/state';

export function LoginScreen(): JSX.Element {
  const app = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) setLockedUntil(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lockedUntil) return;
    setBusy(true);
    setError('');
    try {
      await app.login(username.trim(), password);
      setPassword('');
    } catch (caught) {
      setPassword('');
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.code === 'locked_out') {
          const match = /(\d+)\s*minute/i.exec(caught.message);
          if (match) setLockedUntil(new Date(Date.now() + Number(match[1]) * 60_000));
        }
      } else {
        setError('Sign-in failed. Please try again.');
      }
      firstRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen auth-screen--login">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark brand-mark--lg"><Icon name="tooth" size={30} /></span>
          <div>
            <h1 className="auth-title">Dentiva Pro</h1>
            <p className="auth-sub">{app.clinicName}</p>
          </div>
        </div>

        <form className="stack stack-3" onSubmit={submit}>
          <TextInput
            ref={firstRef}
            label="Username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="mono"
            icon="user"
            spellCheck={false}
          />
          <TextInput
            label="Password"
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            icon="lock"
          />
          {error ? <Callout tone="danger">{error}</Callout> : null}
          {lockedUntil ? (
            <Callout tone="warn" title="Account temporarily locked">
              Try again in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}.
            </Callout>
          ) : null}
          <Button type="submit" variant="primary" block size="lg" loading={busy} disabled={Boolean(lockedUntil)} icon="logout">
            Sign in
          </Button>
        </form>

        <p className="text-xs text-3" style={{ textAlign: 'center' }}>
          Session locks automatically after {app.prefs.autoLockMinutes > 0 ? `${app.prefs.autoLockMinutes} minutes` : 'a long time'} of inactivity.
          Press <span className="kbd">Ctrl</span> + <span className="kbd">L</span> to lock now.
        </p>
      </div>

      <aside className="auth-aside">
        <h2>Offline by design</h2>
        <ul className="auth-list">
          <li><Icon name="check" size={15} /> No internet connection is required or attempted.</li>
          <li><Icon name="check" size={15} /> Patient records never leave this computer.</li>
          <li><Icon name="check" size={15} /> Passwords are stored with memory-hard hashing, never in plain text.</li>
        </ul>
        <div className="auth-aside-note">
          <strong>Data folder</strong>
          <p className="mono text-xs">{app.status?.dataDir ?? '—'}</p>
        </div>
        {app.status && !app.status.integrity.ok ? (
          <Callout tone="warn" title="Database check">{app.status.integrity.message}</Callout>
        ) : null}
      </aside>
    </div>
  );
}
