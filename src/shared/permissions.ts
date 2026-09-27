/**
 * Granular permission catalogue.
 *
 * This is the single source of truth for authorisation. The UI derives button
 * and route visibility from it, and — critically — the service container
 * enforces it at the operation boundary regardless of which client calls.
 */

export const PERMISSIONS = {
  'patients.view': 'View patients and patient profiles',
  'patients.create': 'Create new patients',
  'patients.edit': 'Edit patient demographics',
  'patients.delete': 'Permanently delete a patient record',
  'patients.archive': 'Archive a patient',
  'patients.export': 'Export patient data',

  'clinical.view': 'View visits and clinical records',
  'clinical.create': 'Create visits and clinical records',
  'clinical.edit': 'Edit visits and clinical records',
  'toothchart.edit': 'Update the dental chart',

  'treatments.view': 'View the treatment catalogue',
  'treatments.manage': 'Manage the treatment catalogue',

  'prescriptions.view': 'View prescriptions',
  'prescriptions.create': 'Create prescriptions',
  'prescriptions.edit': 'Edit prescriptions',
  'prescriptions.print': 'Print or export prescriptions',

  'appointments.view': 'View appointments',
  'appointments.manage': 'Create, reschedule and cancel appointments',

  'queue.view': 'View the patient queue',
  'queue.manage': 'Operate the patient queue',

  'invoices.view': 'View invoices',
  'invoices.create': 'Create invoices',
  'invoices.edit': 'Edit invoices',
  'invoices.delete': 'Delete invoices',
  'invoices.print': 'Print or export invoices',

  'payments.view': 'View payments and receivables',
  'payments.create': 'Record payments',
  'payments.refund': 'Issue refunds',

  'accounting.view': 'View income, expenses and reports',
  'accounting.manage': 'Create and edit income and expenses',

  'inventory.view': 'View inventory and stock',
  'inventory.manage': 'Manage inventory, suppliers and stock movements',

  'staff.view': 'View staff records',
  'staff.manage': 'Manage staff records',

  'users.view': 'View user accounts',
  'users.manage': 'Create, disable and reset user accounts',
  'roles.manage': 'Create roles and assign permissions',

  'attachments.add': 'Add attachments to a patient',
  'attachments.delete': 'Delete attachments',

  'reports.view': 'View reports',

  'audit.view': 'View the audit log',
  'backup.create': 'Create backups',
  'backup.restore': 'Restore from a backup',
  'settings.view': 'View settings',
  'settings.manage': 'Change settings',
  'system.wipe': 'Erase all application data',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: 'Patients', permissions: ['patients.view', 'patients.create', 'patients.edit', 'patients.delete', 'patients.archive', 'patients.export'] },
  { label: 'Clinical', permissions: ['clinical.view', 'clinical.create', 'clinical.edit', 'toothchart.edit', 'treatments.view', 'treatments.manage'] },
  { label: 'Prescriptions', permissions: ['prescriptions.view', 'prescriptions.create', 'prescriptions.edit', 'prescriptions.print'] },
  { label: 'Appointments & Queue', permissions: ['appointments.view', 'appointments.manage', 'queue.view', 'queue.manage'] },
  { label: 'Billing', permissions: ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.print'] },
  { label: 'Payments', permissions: ['payments.view', 'payments.create', 'payments.refund'] },
  { label: 'Accounting', permissions: ['accounting.view', 'accounting.manage'] },
  { label: 'Inventory', permissions: ['inventory.view', 'inventory.manage'] },
  { label: 'Staff & Users', permissions: ['staff.view', 'staff.manage', 'users.view', 'users.manage', 'roles.manage'] },
  { label: 'Attachments', permissions: ['attachments.add', 'attachments.delete'] },
  { label: 'Reports & Audit', permissions: ['reports.view', 'audit.view'] },
  { label: 'Administration', permissions: ['backup.create', 'backup.restore', 'settings.view', 'settings.manage', 'system.wipe'] },
];

/** Permissions that are additionally restricted to the built-in Administrator role. */
export const ADMIN_ONLY_PERMISSIONS: Permission[] = [
  'users.manage',
  'roles.manage',
  'backup.restore',
  'settings.manage',
  'system.wipe',
  'audit.view',
  'patients.delete',
];

export const ADMIN_PERMISSIONS: Permission[] = [...ALL_PERMISSIONS];

export const DENTIST_PERMISSIONS: Permission[] = [
  'patients.view',
  'patients.create',
  'patients.edit',
  'clinical.view',
  'clinical.create',
  'clinical.edit',
  'toothchart.edit',
  'treatments.view',
  'prescriptions.view',
  'prescriptions.create',
  'prescriptions.edit',
  'prescriptions.print',
  'appointments.view',
  'appointments.manage',
  'queue.view',
  'queue.manage',
  'staff.view',
  'attachments.add',
  'reports.view',
  'settings.view',
];

export const RECEPTIONIST_PERMISSIONS: Permission[] = [
  'patients.view',
  'patients.create',
  'patients.edit',
  'patients.archive',
  'clinical.view',
  'treatments.view',
  'prescriptions.view',
  'prescriptions.print',
  'appointments.view',
  'appointments.manage',
  'queue.view',
  'queue.manage',
  'invoices.view',
  'invoices.create',
  'invoices.print',
  'payments.view',
  'payments.create',
  'attachments.add',
  'reports.view',
  'settings.view',
];

export const ACCOUNTANT_PERMISSIONS: Permission[] = [
  'patients.view',
  'invoices.view',
  'invoices.create',
  'invoices.edit',
  'invoices.print',
  'payments.view',
  'payments.create',
  'payments.refund',
  'accounting.view',
  'accounting.manage',
  'inventory.view',
  'inventory.manage',
  'appointments.view',
  'reports.view',
  'settings.view',
];

export type RoleCode = 'administrator' | 'dentist' | 'receptionist' | 'accountant';

export interface RoleSeed {
  code: RoleCode;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: Permission[];
}

export const SEED_ROLES: RoleSeed[] = [
  {
    code: 'administrator',
    name: 'Administrator',
    description: 'Full access to every part of Dentiva Pro, including administration and destructive operations.',
    isSystem: true,
    permissions: ADMIN_PERMISSIONS,
  },
  {
    code: 'dentist',
    name: 'Dentist',
    description: 'Clinical focus: patients, visits, dental chart, treatments and prescriptions. No financial access.',
    isSystem: true,
    permissions: DENTIST_PERMISSIONS,
  },
  {
    code: 'receptionist',
    name: 'Receptionist',
    description: 'Front-desk focus: patients, scheduling, queue, invoicing and payment collection. No clinical editing.',
    isSystem: true,
    permissions: RECEPTIONIST_PERMISSIONS,
  },
  {
    code: 'accountant',
    name: 'Accountant',
    description: 'Financial focus: invoicing, payments, accounting and inventory. No clinical record access.',
    isSystem: true,
    permissions: ACCOUNTANT_PERMISSIONS,
  },
];
