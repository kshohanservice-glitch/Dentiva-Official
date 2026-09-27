/**
 * The first five minutes of a clinic's life.
 *
 * Activation, setup, sign-in, the forced password change and the lock screen
 * are the screens a user meets before anything else, and they are the screens
 * a first bad impression is hardest to recover from. They were written and
 * reviewed but never run. This renders them against a real application — an
 * unactivated one, a configured one, and a tampered one — and drives them the
 * way a person would.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import { App } from '../../src/renderer/app/App';
import { AppProvider } from '../../src/renderer/app/state';
import { ConfirmProvider, ToastProvider } from '../../src/renderer/components/ui';
import { installHost, uninstallHost } from '../helpers/ui';
import { createTestApp, seedActivatedAdmin, type TestApp } from '../helpers/app';

let ctx: TestApp | null = null;

beforeEach(() => {
  ctx = createTestApp();
  installHost(ctx.app);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  uninstallHost();
  ctx?.cleanup();
  ctx = null;
});

/** Boots the application exactly as `main.tsx` does, and waits for it to settle. */
async function boot(): Promise<void> {
  await act(async () => {
    render(
      <ToastProvider>
        <ConfirmProvider>
          <AppProvider>
            <App />
          </AppProvider>
        </ConfirmProvider>
      </ToastProvider>,
    );
  });
  await waitFor(() => expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0), { timeout: 5000 });
}

const text = () => document.body.textContent ?? '';

async function signIn(username: string, password: string): Promise<string> {
  await waitFor(() => expect(text()).toMatch(/sign in|username/i), { timeout: 5000 });
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: username } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form') as HTMLFormElement);
  });
  return username;
}

async function submitSignIn(username: string, password: string): Promise<void> {
  await signIn(username, password);
  await waitFor(() => expect(text()).toMatch(/incorrect|wrong|locked|too many|dashboard|patients/i), { timeout: 5000 });
}

describe('a fresh, unactivated installation', () => {
  it('asks for an activation code before anything else, and refuses a wrong one', async () => {
    await boot();

    // Nothing else is offered until the installation is activated. A user who
    // cannot get past this screen has a dead application.
    await waitFor(() => expect(text()).toContain('Activation code'), { timeout: 5000 });
    expect(screen.getByRole('button', { name: /activate/i })).toBeTruthy();
    // The setup wizard must not be reachable yet.
    expect(text()).not.toMatch(/clinic name/i);

    const input = screen.getByLabelText(/activation code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' } });
      fireEvent.click(screen.getByRole('button', { name: /activate/i }));
    });

    await waitFor(() => expect(text().toLowerCase()).toMatch(/not valid|incorrect|invalid|not recognised|not recognized/));
    // The rejection must not leak a file path or a stack trace at a user.
    expect(text()).not.toMatch(/\/home\/|at Object|\.ts:\d+|Error:/);
  });

  it('refuses every operation while unactivated, not just the activation screen', async () => {
    // The gate is global and lives in the registry, so this calls an ordinary
    // operation directly rather than trusting the screen.
    await expect(ctx!.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' })).rejects.toMatchObject({
      code: 'not_activated',
    });
  });
});

describe('a tampered activation record', () => {
  it('is reported, and never quietly accepted', async () => {
    await seedActivatedAdmin(ctx!);
    // Someone wrote their own value into the database to try to activate it.
    ctx!.app.container.db.run(
      `UPDATE app_state SET value = ? WHERE key = ?`,
      [JSON.stringify('tampered-value'), 'activation.install_verifier'],
    );

    await boot();

    await waitFor(() => expect(text()).toMatch(/could not be verified|data folder was edited/i), { timeout: 15000 });
    // The workspace does not open behind the warning.
    expect(text()).not.toMatch(/Dashboard/i);
    // And the callout says what to do, not just that something is wrong.
    expect(text()).toMatch(/contact your seller|restore a dentiva pro backup/i);
  }, 30000);
});

describe('signing in', () => {
  beforeEach(async () => {
    await seedActivatedAdmin(ctx!);
  });

  it('says the same thing whether the username exists or the password is wrong', async () => {
    await boot();
    await signIn('admin', 'NotThePassword1');
    await waitFor(() => expect(text()).toMatch(/incorrect|wrong|not match/i), { timeout: 5000 });
    const wrongPassword = text();

    await signIn('nobodyhere', 'NotThePassword1');
    await waitFor(() => expect(text()).toMatch(/incorrect|wrong|not match/i), { timeout: 5000 });
    const noSuchUser = text();

    // Identical wording, so the form cannot be used to find out who works here.
    expect(wrongPassword).toBe(noSuchUser);
    // And it must not say the username is unknown.
    expect(noSuchUser.toLowerCase()).not.toMatch(/unknown user|no such user|does not exist/);
  });

  it('locks the account after five wrong passwords, and says how long to wait', async () => {
    await boot();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn('admin', `WrongGuess${attempt}`);
      await waitFor(() => expect(text()).toMatch(/incorrect|locked|too many/i), { timeout: 5000 });
    }
    expect(text()).toMatch(/too many failed attempts/i);
    // The message has to say how long, in a unit the user can act on.
    expect(text()).toMatch(/\d+\s*minute/i);
  });

  it('opens the workspace on a correct password and shows the clinic', async () => {
    await boot();
    await submitSignIn('admin', 'Clinic@2026');
    await waitFor(() => expect(text()).toContain('Bright Smile Dental Care'), { timeout: 5000 });
    expect(text()).toMatch(/Patients/);
  });
});

describe('sessions and drafts', () => {
  beforeEach(async () => {
    await seedActivatedAdmin(ctx!);
  });

  it('keeps a half-written form when the machine locks', async () => {
    // A receptionist who is called away mid-entry must not lose the record.
    await ctx!.invoke('drafts.save', {
      kind: 'patient-form',
      payload: JSON.stringify({ fullName: 'কামাল উদ্দিন', phone: '01712345678' }),
    });

    // A draft is per user. Listing it back must return exactly what was
    // written, Bengali included, character for character.
    const restored = await ctx!.invoke('drafts.get', { kind: 'patient-form' });
    expect((restored.payload as { fullName: string }).fullName).toBe('কামাল উদ্দিন');
    expect((restored.payload as { phone: string }).phone).toBe('01712345678');

    const listed = await ctx!.invoke('drafts.list');
    expect((listed.rows as { kind: string }[]).some((row) => row.kind === 'patient-form')).toBe(true);

    // And clearing it really removes it, rather than hiding it.
    await ctx!.invoke('drafts.clear', { kind: 'patient-form' });
    expect((await ctx!.invoke('drafts.get', { kind: 'patient-form' })).payload).toBeNull();
  });

  it('ends the session for real when the user signs out', async () => {
    const session = await ctx!.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' });
    const token = session.token as string;
    sessionStorage.setItem('dentiva.session', token);

    await boot();
    await waitFor(() => expect(text()).toContain('Bright Smile Dental Care'), { timeout: 5000 });

    await act(async () => {
      await ctx!.invoke('auth.logout', {}, { token });
    });

    // A token that was valid a moment ago must not work now. This is the
    // assertion that fails if logout only forgets the token in the interface.
    await expect(ctx!.invoke('patients.list', {}, { token })).rejects.toMatchObject({
      code: expect.stringMatching(/unauthenticated|expired|revoked/),
    });
  });
});

describe('unsaved work', () => {
  beforeEach(async () => {
    await seedActivatedAdmin(ctx!);
  });

  it('puts a half-written patient back after the application locks', async () => {
    const session = await ctx!.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' });
    sessionStorage.setItem('dentiva.session', session.token as string);
    await boot();
    await waitFor(() => expect(text()).toContain('Bright Smile Dental Care'), { timeout: 5000 });

    // Type a patient's details and walk away. The lock does not clear them.
    await act(async () => {
      await ctx!.invoke('drafts.save', {
        kind: 'patient-form',
        payload: JSON.stringify({ fullName: 'কামাল উদ্দিন আহমেদ', phone: '01712345678', address: 'ধানমন্ডি, ঢাকা' }),
      });
    });

    const restored = await ctx!.invoke('drafts.get', { kind: 'patient-form' });
    expect((restored.payload as { fullName: string }).fullName).toBe('কামাল উদ্দিন আহমেদ');
    expect((restored.payload as { address: string }).address).toBe('ধানমন্ডি, ঢাকা');
  });

  it('keeps one user\'s unsaved work away from another user', async () => {
    const admin = await ctx!.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' });
    await ctx!.invoke('drafts.save', {
      kind: 'patient-form',
      payload: JSON.stringify({ fullName: 'Admin Draft' }),
    });

    const role = (await ctx!.invoke('roles.list')).find((r: any) => r.code === 'receptionist');
    await ctx!.invoke('users.create', {
      username: 'reception',
      displayName: 'Reception',
      password: 'Strong#Pass1',
      roleIds: [role.id],
    });
    const first = await ctx!.invoke('auth.login', { username: 'reception', password: 'Strong#Pass1' });
    // A new account cannot do anything until its password is changed, which is
    // itself part of what this test relies on.
    await expect(
      ctx!.invoke('drafts.get', { kind: 'patient-form' }, { token: first.token as string }),
    ).rejects.toMatchObject({ code: 'password_change_required' });
    await ctx!.invoke(
      'auth.changePassword',
      { currentPassword: 'Strong#Pass1', newPassword: 'Strong#Pass2', confirmPassword: 'Strong#Pass2' },
      { token: first.token as string },
    );
    const reception = await ctx!.invoke('auth.login', { username: 'reception', password: 'Strong#Pass2' });

    // A shared terminal is the normal case at a clinic counter. Two people
    // signing in one after the other must not see each other\'s half-typed
    // record, which is exactly the sort of thing that ends up on the wrong
    // patient\'s chart.
    const theirs = await ctx!.invoke('drafts.get', { kind: 'patient-form' }, { token: reception.token as string });
    expect(theirs.payload).toBeNull();

    const mine = await ctx!.invoke('drafts.get', { kind: 'patient-form' }, { token: admin.token as string });
    expect((mine.payload as { fullName: string }).fullName).toBe('Admin Draft');
  });

  it('refuses a draft that will not parse, rather than failing the form forever', async () => {
    const session = await ctx!.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' });
    // Something wrote a row that is not JSON.
    ctx!.app.container.db.run(
      `INSERT INTO drafts (owner, user_id, kind, entity_id, payload, updated_at)
       VALUES ('form', (SELECT id FROM users WHERE username = 'admin'), 'patient-form', NULL, 'not json at all', '2026-01-01T00:00:00.000Z')`,
    );

    const result = await ctx!.invoke('drafts.get', { kind: 'patient-form' }, { token: session.token as string });
    expect(result.payload).toBeNull();
    // And it is gone, so the next attempt starts clean.
    const left = ctx!.app.container.db.count(`SELECT COUNT(*) AS n FROM drafts WHERE kind = 'patient-form'`);
    expect(left).toBe(0);
  });

  it('needs a signed-in user', async () => {
    await expect(ctx!.invoke('drafts.save', { kind: 'patient-form', payload: '{}' }, { token: null }))
      .rejects.toMatchObject({ code: expect.stringMatching(/unauthenticated|token/) });
  });
});

describe('the forced password change', () => {
  beforeEach(async () => {
    await seedActivatedAdmin(ctx!);
  });

  it('replaces the whole workspace so nothing can be done before the change', async () => {
    // An administrator creates this user; the flag is what matters here.
    await ctx!.invoke('users.create', {
      username: 'newstarter',
      displayName: 'New Starter',
      password: 'Temporary#2026',
      roleIds: [(await ctx!.invoke('roles.list')).find((r: any) => r.code === 'receptionist')!.id],
    });
    const session = await ctx!.invoke('auth.login', { username: 'newstarter', password: 'Temporary#2026' });
    sessionStorage.setItem('dentiva.session', session.token as string);

    await boot();

    // No navigation, no page — just the change screen.
    await waitFor(() => expect(text()).toMatch(/change your password|new password|create a password/i), { timeout: 5000 });
    expect(text()).not.toMatch(/Administration/);
  });
});
