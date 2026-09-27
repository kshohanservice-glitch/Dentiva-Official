import { useState, type JSX } from 'react';
import { Button, Callout, Modal, TextInput, useToast } from '../components/ui';
import { call, ApiError } from '../lib/api';
import { useApp } from '../app/state';

/**
 * Shown after a password reset by an administrator. The user cannot dismiss
 * it: until the password is changed the account keeps the temporary one.
 */
export function ForcePasswordChange(): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      await call('auth.changePassword', { currentPassword: current, newPassword: next, confirmPassword: confirm });
      toast.success('Password updated', 'Use your new password the next time you sign in.');
      await app.refreshUser();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setFieldErrors(map);
      } else {
        setError('The password could not be changed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Choose a new password"
      subtitle="Your password was reset by an administrator. Set a new one to continue."
      onClose={() => undefined}
      closeOnBackdrop={false}
      width={520}
      footer={
        <>
          <Button onClick={() => void app.logout()}>Sign out</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Save password</Button>
        </>
      }
    >
      <div className="stack stack-3">
        <Callout tone="warn" title="Temporary password">
          You cannot work with the temporary password. Pick something only you know — at least 10 characters mixing
          letters, digits and a symbol.
        </Callout>
        <TextInput
          label="Temporary password"
          type="password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          error={fieldErrors.currentPassword}
        />
        <TextInput
          label="New password"
          type="password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          error={fieldErrors.newPassword}
        />
        <TextInput
          label="Confirm new password"
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          error={fieldErrors.confirmPassword}
        />
        {error && !Object.keys(fieldErrors).length ? <Callout tone="danger">{error}</Callout> : null}
      </div>
    </Modal>
  );
}
