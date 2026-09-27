import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { Button, TextInput } from '../components/ui';
import { Icon } from '../components/Icons';
import { ApiError } from '../lib/api';
import { useApp } from '../app/state';

/**
 * The application lock.
 *
 * The session stays valid so no unsaved work is lost, but every screen is
 * covered and the password is verified through the service layer before the
 * lock lifts.
 */
export function LockScreen(): JSX.Element {
  const app = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await app.unlock(password);
      setPassword('');
    } catch (caught) {
      setPassword('');
      setError(caught instanceof ApiError ? caught.message : 'That password is not correct.');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Application locked">
      <div className="lock-card">
        <span className="lock-icon"><Icon name="lock" size={28} /></span>
        <h1 className="lock-title">Dentiva Pro is locked</h1>
        <p className="lock-text">
          Signed in as <strong>{app.user?.displayName}</strong>. Your work is exactly where you left it.
        </p>
        <form className="stack stack-3" onSubmit={submit}>
          <TextInput
            ref={inputRef}
            label="Password to unlock"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            error={error || undefined}
            icon="key"
          />
          <div className="row row-2">
            <Button type="submit" variant="primary" loading={busy} icon="lock">Unlock</Button>
            <Button variant="ghost" icon="logout" onClick={() => void app.logout()}>Sign out instead</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
