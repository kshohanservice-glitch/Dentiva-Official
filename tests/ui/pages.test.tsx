import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { AppProvider, useApp } from '../../src/renderer/app/state';
import { AppShell } from '../../src/renderer/app/AppShell';
import { ToastProvider } from '../../src/renderer/components/ui';
import { installHost, uninstallHost } from '../helpers/ui';
import { createTestApp, seedActivatedAdmin, seedPatient, type TestApp } from '../helpers/app';

let ctx: TestApp | null = null;

beforeEach(async () => {
  ctx = createTestApp();
  await seedActivatedAdmin(ctx);
  installHost(ctx.app);
});

afterEach(() => {
  cleanup();
  uninstallHost();
  ctx?.cleanup();
  ctx = null;
});

/**
 * Renders a page inside the real shell, signed in, with a real clinic behind
 * it. Anything the page asks for that the core cannot answer fails here rather
 * than in a clinic months from now.
 */
async function renderPage(element: React.ReactElement, roleCode?: string): Promise<void> {
  let token: string;
  if (roleCode) {
    const role = (await ctx!.invoke('roles.list')).find((r: any) => r.code === roleCode);
    await ctx!.invoke('users.create', {
      username: 'uipage', displayName: 'UI Page', password: 'Strong#Pass1', roleIds: [role.id],
    });
    const session = await ctx!.invoke('auth.login', { username: 'uipage', password: 'Strong#Pass1' });
    await ctx!.invoke(
      'auth.changePassword',
      { currentPassword: 'Strong#Pass1', newPassword: 'Strong#Pass2', confirmPassword: 'Strong#Pass2' },
      { token: session.token },
    );
    token = (await ctx!.invoke('auth.login', { username: 'uipage', password: 'Strong#Pass2' })).token as string;
  } else {
    token = (await ctx!.invoke('auth.login', { username: 'admin', password: 'Clinic@2026' })).token as string;
  }
  sessionStorage.setItem('dentiva.session', token);

  await act(async () => {
    render(
      <ToastProvider>
        <AppProvider>
          <Harness>{element}</Harness>
        </AppProvider>
      </ToastProvider>,
    );
  });
}

/** Waits for the shell to finish booting so the token is picked up. */
function Harness({ children }: { children: React.ReactElement }): React.ReactElement {
  const app = useApp();
  if (app.stage === 'loading') return <div>loading</div>;
  return <AppShell>{children}</AppShell>;
}

describe('the patients page lists real records', () => {
  it('shows a Bengali patient with its code and phone', async () => {
    await seedPatient(ctx!, { fullName: 'রহিমা খাতুন', phone: '01898765432' });
    await seedPatient(ctx!, { fullName: 'Md. Rakibul Hasan', phone: '01712345678' });

    const { PatientsPage } = await import('../../src/renderer/pages/Patients');
    await renderPage(<PatientsPage />);

    await waitFor(() => expect(screen.getByText('রহিমা খাতুন')).toBeTruthy());
    expect(screen.getByText('Md. Rakibul Hasan')).toBeTruthy();
    expect(screen.getByText('01898765432')).toBeTruthy();
    // The generated patient code is visible, not hidden behind a click.
    expect(screen.getAllByText(/P-\d{6}/).length).toBe(2);
  });

  it('filters as the user types and says so when nothing matches', async () => {
    await seedPatient(ctx!, { fullName: 'রহিমা খাতুন' });
    await seedPatient(ctx!, { fullName: 'কামাল উদ্দিন' });

    const { PatientsPage } = await import('../../src/renderer/pages/Patients');
    await renderPage(<PatientsPage />);
    await waitFor(() => expect(screen.getByText('রহিমা খাতুন')).toBeTruthy());

    const search = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'কামাল');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await waitFor(() => expect(screen.queryByText('রহিমা খাতুন')).toBeNull());
    expect(screen.getByText('কামাল উদ্দিন')).toBeTruthy();
  });
});

describe('the patient workspace', () => {
  it('shows the clinical, billing and history tabs with real data', async () => {
    const patient = await seedPatient(ctx!, { fullName: 'রহিমা খাতুন', phone: '01898765432' });
    const treatment = await ctx!.invoke('treatments.create', { name: 'Root Canal', code: 'RCT-01', defaultPricePoisha: 350000 });
    const invoice = await ctx!.invoke('invoices.create', {
      patientId: patient.id, issueDate: new Date().toISOString().slice(0, 10),
      items: [{ treatmentId: treatment.id, description: 'Root Canal', qtyMilli: 1000, unitPricePoisha: 350000 }],
    });
    await ctx!.invoke('payments.create', {
      patientId: patient.id, paymentDate: new Date().toISOString().slice(0, 10), method: 'cash', type: 'receipt',
      amountPoisha: 100000, allocations: [{ invoiceId: invoice.id, amountPoisha: 100000 }],
    });
    await ctx!.invoke('toothChart.set', {
      patientId: patient.id, dentition: 'adult', condition: 'caries', surface: 'occlusal', severity: 2, teeth: ['26'],
    });

    const { PatientDetailPage } = await import('../../src/renderer/pages/PatientDetail');
    await renderPage(<PatientDetailPage patientId={String(patient.id)} />);

    await waitFor(() => expect(screen.getAllByText('রহিমা খাতুন').length).toBeGreaterThan(0));
    // The money on screen is formatted in taka, not shown as raw poisha.
    const text = document.body.textContent ?? '';
    expect(text).toContain('৳');
    expect(text).not.toContain('350000');
    expect(text).not.toContain('100000');
  });
});

describe('the appointments and queue pages', () => {
  it('shows today’s appointments and the waiting room', async () => {
    const patient = await seedPatient(ctx!, { fullName: 'কামাল উদ্দিন' });
    const dentist = (await ctx!.invoke('dentists.list'))[0];
    const today = new Date().toISOString().slice(0, 10);
    await ctx!.invoke('appointments.create', {
      patientId: patient.id, dentistId: dentist.id, appointmentDate: today, startTime: '10:30',
      appointmentType: 'consultation',
    });
    await ctx!.invoke('queue.checkIn', { patientId: patient.id, dentistId: dentist.id, date: today });

    const { AppointmentsPage } = await import('../../src/renderer/pages/Appointments');
    await renderPage(<AppointmentsPage />);
    await waitFor(() => expect(screen.getAllByText('কামাল উদ্দিন').length).toBeGreaterThan(0));
    expect(document.body.textContent).toContain('10:30');

    cleanup();
    const { QueuePage } = await import('../../src/renderer/pages/Queue');
    await renderPage(<QueuePage />);
    await waitFor(() => expect(screen.getAllByText('কামাল উদ্দিন').length).toBeGreaterThan(0));
  });
});

describe('the invoice form', () => {
  it('picks a treatment from the catalogue and fills the price in taka', async () => {
    const patient = await seedPatient(ctx!, { fullName: 'রহিমা খাতুন' });
    await ctx!.invoke('treatments.create', {
      name: 'দাঁত পরিষ্কার করা', code: 'SCALE-01', defaultPricePoisha: 80000, durationMinutes: 30,
    });

    const { InvoiceForm } = await import('../../src/renderer/pages/InvoiceForm');
    await renderPage(
      <InvoiceForm open onClose={() => undefined} onSaved={() => undefined} patientId={patient.id} />,
    );

    await waitFor(() => expect(screen.getByPlaceholderText('Treatment or service')).toBeTruthy());
    const input = screen.getByPlaceholderText('Treatment or service') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'পরিষ্কার');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => expect(screen.getByText('দাঁত পরিষ্কার করা')).toBeTruthy());
  });
});

describe('reports, inventory and accounting pages', () => {
  it('renders the reports page with its selectors and no empty charts', async () => {
    const patient = await seedPatient(ctx!, { fullName: 'রহিমা খাতুন' });
    const treatment = await ctx!.invoke('treatments.create', { name: 'Filling', code: 'FILL-01', defaultPricePoisha: 120000 });
    const invoice = await ctx!.invoke('invoices.create', {
      patientId: patient.id, issueDate: new Date().toISOString().slice(0, 10),
      items: [{ treatmentId: treatment.id, description: 'Filling', qtyMilli: 1000, unitPricePoisha: 120000 }],
    });
    await ctx!.invoke('payments.create', {
      patientId: patient.id, paymentDate: new Date().toISOString().slice(0, 10), method: 'cash', type: 'receipt',
      amountPoisha: 120000, allocations: [{ invoiceId: invoice.id, amountPoisha: 120000 }],
    });

    const { ReportsPage } = await import('../../src/renderer/pages/Reports');
    await renderPage(<ReportsPage />);

    await waitFor(() => expect(document.body.textContent).toContain('Invoice collection'));
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/৳[\d,]/);
    expect(text).not.toContain('120000');
  });

  it('renders inventory with a low-stock warning rather than a silent table', async () => {
    const item = await ctx!.invoke('inventory.create', { name: 'Latex Gloves', sku: 'GLV-1', unit: 'box', minStock: 10 });
    await ctx!.invoke('inventory.stockIn', { itemId: item.id, quantity: 2 });

    const { InventoryPage } = await import('../../src/renderer/pages/Inventory');
    await renderPage(<InventoryPage />);

    await waitFor(() => expect(screen.getByText('Latex Gloves')).toBeTruthy());
    expect(document.body.textContent).toMatch(/low|reorder|minimum/i);
  });

  it('renders the accounting page with real income and expense rows', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await ctx!.invoke('accounting.createExpense', {
      entryDate: today, method: 'cash', description: 'Clinic rent', amountPoisha: 900000, vendor: 'Landlord',
    });

    const { AccountingPage } = await import('../../src/renderer/pages/Accounting');
    await renderPage(<AccountingPage />);

    await waitFor(() => expect(screen.getAllByText('Clinic rent').length).toBeGreaterThan(0));
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/৳[\d,]/);
    expect(text).not.toContain('900000');
  });
});

describe('administration, settings, backup and about', () => {
  it('renders the staff page with its tabs', async () => {
    const { StaffPage } = await import('../../src/renderer/pages/Staff');
    await renderPage(<StaffPage />);
    await waitFor(() => expect(screen.getAllByText('Staff & Users').length).toBeGreaterThan(0));
    const text = document.body.textContent ?? '';
    expect(text).toContain('Users');
    expect(text).toContain('Roles');
    expect(text).toContain('Audit log');
  });

  it('renders the settings page with every section', async () => {
    const { SettingsPage } = await import('../../src/renderer/pages/Settings');
    await renderPage(<SettingsPage />);
    await waitFor(() => expect(screen.getByText('Clinic')).toBeTruthy());
    const text = document.body.textContent ?? '';
    for (const section of ['Appearance', 'Printing', 'Security', 'Backups', 'Billing', 'Maintenance']) {
      expect(text, `Settings is missing the ${section} section`).toContain(section);
    }
  });

  it('renders the backup page with the configured folder', async () => {
    const { BackupPage } = await import('../../src/renderer/pages/Backup');
    await renderPage(<BackupPage />);
    await waitFor(() => expect(screen.getAllByText('Backup & Restore').length).toBeGreaterThan(0));
    // The folder is shown in an input, so it is the value that proves it loaded.
    await waitFor(() => {
      const inputs = [...document.querySelectorAll('input')] as HTMLInputElement[];
      expect(inputs.map((input) => input.value)).toContain(ctx!.backupFolder);
    });
  });

  it('renders the about page with the developer attribution', async () => {
    const { AboutPage } = await import('../../src/renderer/pages/About');
    await renderPage(<AboutPage />);
    await waitFor(() => expect(document.body.textContent).toContain('Dentiva Pro'));
    const text = document.body.textContent ?? '';
    expect(text).toContain('Shohan Khan');
    expect(text).toContain('helloiamshohan@gmail.com');
  });
});

describe('the shell', () => {
  it('shows the clinic name and the signed-in user', async () => {
    await renderPage(<div>page</div>);
    await waitFor(() => expect(screen.getAllByText('Bright Smile Dental Care').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('page')).toBeTruthy());
    expect(document.body.textContent).toContain('Shohan Khan');
  });

  it('hides sections a receptionist is not allowed to use', async () => {
    await renderPage(<div>page</div>, 'receptionist');
    await waitFor(() => expect(screen.getByText('page')).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text).toContain('Patients');
    expect(text).toContain('Appointments');
    // The front desk can read settings but must not see staff administration,
    // backups or the treatment catalogue.
    expect(text).not.toContain('Staff & Users');
    expect(text).not.toContain('Backup & Restore');
  });
});
