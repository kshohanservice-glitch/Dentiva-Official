import type { IconName } from '../components/Icons';

export interface NavItem {
  id: string;
  path: string;
  label: string;
  icon: IconName;
  permission: string;
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
      { id: 'dashboard', path: 'dashboard', label: 'Dashboard', icon: 'dashboard', permission: '' },
      { id: 'patients', path: 'patients', label: 'Patients', icon: 'patients', permission: 'patients.view' },
      { id: 'appointments', path: 'appointments', label: 'Appointments', icon: 'calendar', permission: 'appointments.view' },
      { id: 'queue', path: 'queue', label: 'Queue', icon: 'queue', permission: 'queue.view' },
    ],
  },
  {
    id: 'clinical',
    label: 'Clinical',
    items: [
      { id: 'treatments', path: 'clinical/treatments', label: 'Treatments', icon: 'treatments', permission: 'treatments.view' },
      { id: 'prescriptions', path: 'clinical/prescriptions', label: 'Prescriptions', icon: 'prescription', permission: 'prescriptions.view' },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    items: [
      { id: 'invoices', path: 'billing/invoices', label: 'Invoice', icon: 'invoice', permission: 'invoices.view' },
      { id: 'payments', path: 'billing/payments', label: 'Payments', icon: 'payments', permission: 'payments.view' },
      { id: 'inventory', path: 'billing/inventory', label: 'Inventory', icon: 'inventory', permission: 'inventory.view' },
      { id: 'accounting', path: 'billing/accounting', label: 'Accounting', icon: 'accounting', permission: 'accounting.view' },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      { id: 'staff', path: 'administration/staff', label: 'Staff & Users', icon: 'staff', permission: '' },
      { id: 'backup', path: 'administration/backup', label: 'Backup & Restore', icon: 'backup', permission: '' },
      { id: 'settings', path: 'administration/settings', label: 'Settings', icon: 'settings', permission: '' },
      { id: 'about', path: 'administration/about', label: 'About', icon: 'info', permission: '' },
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
