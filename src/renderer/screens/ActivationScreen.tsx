import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Button, Callout, TextInput, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { call, ApiError } from '../lib/api';
import { useApp } from '../app/state';
import { date } from '../lib/format';

interface ActivationInfo {
  activated: boolean;
  activatedAt: string | null;
  machine: string;
  machineFingerprint: string;
}

export function ActivationScreen(): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await call<ActivationInfo>('system.activationStatus');
      setCode('');
      setError('');
      void info;
      await app.boot();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read the activation state.');
    }
  }, [app]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const value = code.replace(/\s+/g, '');
    if (value.length !== 16) {
      setError('The activation code is 16 characters long. Check the card or email you received.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await call('system.activate', { code: value });
      toast.success('Dentiva Pro is activated', 'You can now complete the one-time clinic setup.');
      await app.boot();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Activation failed.';
      setError(message);
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark brand-mark--lg"><Icon name="tooth" size={30} /></span>
          <div>
            <h1 className="auth-title">Dentiva Pro</h1>
            <p className="auth-sub">Activate this installation to continue</p>
          </div>
        </div>

        {app.status?.activationTampered ? (
          <Callout tone="danger" title="The activation record could not be verified">
            The local database says this installation was activated, but the record no longer matches the proof
            written when it was activated. That usually means the data folder was edited, copied between
            machines, or restored from an incomplete backup. Nothing has been changed. Contact your seller with
            the machine reference below, or restore a Dentiva Pro backup of this computer.
          </Callout>
        ) : null}

        <Callout tone="info" title="One-time activation">
          Enter the 16-character activation code supplied with your purchase. The code is validated on this
          computer and stored permanently in the local database — it is never sent anywhere.
        </Callout>

        <form
          className="stack stack-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <TextInput
            ref={inputRef}
            label="Activation code"
            required
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16));
              setError('');
            }}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            maxLength={19}
            className="mono tracking"
            error={error || undefined}
            hint="Letters and digits only. Dashes and spaces are ignored."
          />
          <Button type="submit" variant="primary" block size="lg" loading={busy} icon="check-circle">
            Activate Dentiva Pro
          </Button>
        </form>

        <div className="auth-foot">
          <p className="text-xs text-3">
            Activation is performed locally. Dentiva Pro does not contact any server at any point.
          </p>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void refresh()}>
            Re-check activation status
          </Button>
        </div>
      </div>

      <aside className="auth-aside">
        <h2>Before you continue</h2>
        <ul className="auth-list">
          <li><Icon name="check" size={15} /> Find the code on your purchase email or the card supplied by the seller.</li>
          <li><Icon name="check" size={15} /> The code is bound to this computer and cannot be reused elsewhere.</li>
          <li><Icon name="check" size={15} /> If you reinstall Dentiva Pro on this computer, the same code keeps working.</li>
          <li><Icon name="check" size={15} /> Lost your code? Contact your seller for a replacement — no data is lost.</li>
        </ul>
        <div className="auth-aside-note">
          <strong>Data location</strong>
          <p className="mono text-xs">{app.status?.dataDir ?? '—'}</p>
        </div>
        {app.status?.integrity && !app.status.integrity.ok ? (
          <Callout tone="warn" title="Database check">{app.status.integrity.message}</Callout>
        ) : null}
        {app.status?.activatedAt ? (
          <p className="text-xs text-3">Previously activated on {date(app.status.activatedAt, app.prefs)}.</p>
        ) : null}
      </aside>
    </div>
  );
}
