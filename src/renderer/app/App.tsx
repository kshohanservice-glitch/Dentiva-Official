import { useEffect, type JSX } from 'react';
import { useApp } from './state';
import { useRoute, NotFound } from './router';
import { AppShell } from './AppShell';
import { PrintWindow } from '../print/PrintWindow';
import { isPrintWindowRuntime } from '../bridge';
import { Spinner } from '../components/ui';
import { ActivationScreen } from '../screens/ActivationScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { LockScreen } from '../screens/LockScreen';
import { ForcePasswordChange } from '../screens/ForcePasswordChange';
import { DashboardPage } from '../pages/Dashboard';
import { PatientsPage } from '../pages/Patients';
import { PatientDetailPage } from '../pages/PatientDetail';
import { AppointmentsPage } from '../pages/Appointments';
import { QueuePage } from '../pages/Queue';
import { TreatmentsPage } from '../pages/Treatments';
import { PrescriptionsPage } from '../pages/Prescriptions';
import { InvoicesPage } from '../pages/Invoices';
import { InvoiceDetailPage } from '../pages/InvoiceDetail';
import { PaymentsPage } from '../pages/Payments';
import { InventoryPage } from '../pages/Inventory';
import { AccountingPage } from '../pages/Accounting';
import { ReportsPage } from '../pages/Reports';
import { StaffPage } from '../pages/Staff';
import { BackupPage } from '../pages/Backup';
import { SettingsPage } from '../pages/Settings';
import { AboutPage } from '../pages/About';
import { Callout } from '../components/ui';

function resolvePage(path: string): JSX.Element {
  const segments = path.split('/').filter(Boolean);
  const [first, second, third] = segments;
  switch (first) {
    case undefined:
    case 'dashboard':
      return <DashboardPage />;
    case 'patients':
      if (second && third === 'prescriptions') return <PrescriptionsPage patientId={second} />;
      if (second && third === 'visits') return <PatientDetailPage initialTab="visits" patientId={second} />;
      if (second && third === 'billing') return <PatientDetailPage initialTab="billing" patientId={second} />;
      if (second) return <PatientDetailPage patientId={second} />;
      return <PatientsPage />;
    case 'appointments':
      return <AppointmentsPage />;
    case 'queue':
      return <QueuePage />;
    case 'clinical':
      if (second === 'treatments') return <TreatmentsPage />;
      if (second === 'prescriptions') return <PrescriptionsPage />;
      break;
    case 'billing':
      if (second === 'invoices') return third ? <InvoiceDetailPage invoiceId={third} /> : <InvoicesPage />;
      if (second === 'payments') return <PaymentsPage />;
      if (second === 'inventory') return <InventoryPage itemId={third} />;
      if (second === 'accounting') return <AccountingPage />;
      break;
    case 'administration':
      if (second === 'staff') return <StaffPage staffId={third} />;
      if (second === 'backup') return <BackupPage />;
      if (second === 'settings') return <SettingsPage />;
      if (second === 'about') return <AboutPage />;
      break;
    case 'reports':
      return <ReportsPage />;
    default:
      break;
  }
  return <NotFound path={path} />;
}

function Workspace(): JSX.Element {
  const app = useApp();
  const route = useRoute();

  if (app.stage === 'loading') {
    return (
      <div className="boot-screen">
        <span className="brand-mark brand-mark--lg"><Spinner label="Starting Dentiva Pro" /></span>
        <p className="text-sm text-3">Starting Dentiva Pro…</p>
      </div>
    );
  }

  if (app.stage === 'activation') return <ActivationScreen />;
  if (app.stage === 'setup') return <SetupScreen />;
  if (app.stage === 'login') return <LoginScreen />;

  if (app.status && !app.status.integrity.ok) {
    return (
      <div className="boot-screen boot-screen--error">
        <Callout tone="danger" title="The database needs attention">
          {app.status.integrity.message} Back up the data folder before continuing, then run the integrity check from
          Backup &amp; Restore.
        </Callout>
        <button className="btn" type="button" onClick={() => void app.boot()}>Check again</button>
      </div>
    );
  }

  // A forced password change replaces the whole workspace rather than sitting
  // on top of it, so no page can fire an operation the core will now refuse.
  if (app.user?.mustChangePassword) {
    return (
      <div className="boot-screen">
        <ForcePasswordChange />
      </div>
    );
  }

  return (
    <>
      <AppShell>{resolvePage(route.path)}</AppShell>
      {app.locked ? <LockScreen /> : null}
    </>
  );
}

export function App(): JSX.Element {
  const isPrint = isPrintWindowRuntime() || window.location.hash.replace(/^#\/?/, '') === 'print';

  useEffect(() => {
    if (!isPrint) return;
    document.body.classList.add('print-body');
    return () => document.body.classList.remove('print-body');
  }, [isPrint]);

  if (isPrint) return <PrintWindow />;
  return <Workspace />;
}
