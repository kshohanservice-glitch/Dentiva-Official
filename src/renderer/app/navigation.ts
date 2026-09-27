import type { IconName } from '../components/Icons';

export interface NavItem {
  id: string;
  path: string;
  label: string;
  icon: IconName;
  /**
   * Permissions that grant access to this screen. A role holding any one of
   * them sees the link; the core enforces the same rule on every call, so a
   * hidden link is convenience, not security.
   */
  permissions: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    id: 'practice',
    label: 'Practice',
    items: [
      { id: 'dashboard', path: 'dashboard', label: 'Dashboard', icon: 'dashboard', permissions: [] },
      { id: 'patients', path: 'patients', label: 'Patients', icon: 'patients', permissions: ['patients.view'] },
      { id: 'appointments', path: 'appointments', label: 'Appointments', icon: 'calendar', permissions: ['appointments.view'] },
      { id: 'queue', path: 'queue', label: 'Queue', icon: 'queue', permissions: ['queue.view'] },
    ],
  },
  {
    id: 'clinical',
    label: 'Clinical',
    items: [
      { id: 'treatments', path: 'clinical/treatments', label: 'Treatments', icon: 'treatments', permissions: ['treatments.view'] },
      { id: 'prescriptions', path: 'clinical/prescriptions', label: 'Prescriptions', icon: 'prescription', permissions: ['prescriptions.view'] },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    items: [
      { id: 'invoices', path: 'billing/invoices', label: 'Invoice', icon: 'invoice', permissions: ['invoices.view'] },
      { id: 'payments', path: 'billing/payments', label: 'Payments', icon: 'payments', permissions: ['payments.view'] },
      { id: 'inventory', path: 'billing/inventory', label: 'Inventory', icon: 'inventory', permissions: ['inventory.view'] },
      { id: 'accounting', path: 'billing/accounting', label: 'Accounting', icon: 'accounting', permissions: ['accounting.view'] },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      { id: 'staff', path: 'administration/staff', label: 'Staff & Users', icon: 'staff', permissions: ['users.view', 'roles.manage', 'audit.view'] },
      { id: 'backup', path: 'administration/backup', label: 'Backup & Restore', icon: 'backup', permissions: ['backup.create', 'backup.restore'] },
      { id: 'settings', path: 'administration/settings', label: 'Settings', icon: 'settings', permissions: ['settings.view'] },
      { id: 'about', path: 'administration/about', label: 'About', icon: 'info', permissions: [] },
    ],
  },
];

export const TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  patients: 'Patients',
  appointments: 'Appointments',
  queue: 'Queue',
  'clinical/treatments': 'Treatments',
  'clinical/prescriptions': 'Prescriptions',
  'billing/invoices': 'Invoices',
  'billing/payments': 'Payments',
  'billing/inventory': 'Inventory',
  'billing/accounting': 'Accounting',
  'administration/staff': 'Staff & Users',
  'administration/backup': 'Backup & Restore',
  'administration/settings': 'Settings',
  'administration/about': 'About Dentiva Pro',
  reports: 'Reports',
  search: 'Search',
};

export interface Shortcut {
  keys: string;
  description: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl + K', description: 'Global search (patients, invoices, payments…)' },
  { keys: 'Ctrl + N', description: 'New record for the current screen' },
  { keys: 'Ctrl + S', description: 'Save the current form' },
  { keys: 'Ctrl + P', description: 'Print the open document' },
  { keys: 'Ctrl + L', description: 'Lock Dentiva Pro' },
  { keys: 'Ctrl + B', description: 'Collapse or expand the sidebar' },
  { keys: 'F5', description: 'Refresh the current screen' },
  { keys: 'Esc', description: 'Close the open dialog' },
  { keys: '↑ ↓', description: 'Move through search results' },
  { keys: 'Enter', description: 'Open the highlighted result' },
];
