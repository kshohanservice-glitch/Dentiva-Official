/**
 * Dentiva Pro — application-wide constants.
 * Pure data + pure functions only; importable from every tier.
 */

export const APP = {
  id: 'com.dentiva.pro',
  name: 'Dentiva Pro',
  shortName: 'Dentiva',
  version: '1.0.0',
  copyright: '© 2026 Dentiva Pro. All rights reserved.',
  developer: 'Shohan Khan',
  developerEmail: 'helloiamshohan@gmail.com',
  currencyCode: 'BDT',
  currencySymbol: '৳',
  locale: 'en-BD',
} as const;

export const SCHEMA_VERSION = 2;

/** Money is stored and computed as integer POISHA. 1 BDT = 100 poisha. */
export const POISHA_PER_TAKA = 100;

export const DOC_KIND = {
  PRESCRIPTION: 'prescription',
  INVOICE: 'invoice',
  RECEIPT: 'receipt',
  PATIENT_SUMMARY: 'patient-summary',
  APPOINTMENT_SLIP: 'appointment-slip',
  REPORT: 'report',
  CERTIFICATE: 'certificate',
  EXPENSE_RECEIPT: 'expense-receipt',
} as const;
export type DocKind = (typeof DOC_KIND)[keyof typeof DOC_KIND];

/** Paper geometries understood by the print renderer, in millimetres. */
export type PaperSizeId =
  | 'a4'
  | 'a5'
  | 'letter'
  | 'mini'
  | 'thermal80'
  | 'thermal58'
  | 'custom';

export interface PaperGeometry {
  id: PaperSizeId;
  label: string;
  /** mm */
  width: number;
  /** mm; 0 = variable length (roll) */
  height: number;
  variable?: boolean;
  portrait: boolean;
}

export const PAPER_SIZES: Record<PaperSizeId, PaperGeometry> = {
  a4: { id: 'a4', label: 'A4 (210 × 297 mm)', width: 210, height: 297, portrait: true },
  a5: { id: 'a5', label: 'A5 (148 × 210 mm)', width: 148, height: 210, portrait: true },
  letter: { id: 'letter', label: 'US Letter (216 × 279 mm)', width: 215.9, height: 279.4, portrait: true },
  mini: { id: 'mini', label: 'Mini (74 × 120 mm)', width: 74, height: 120, portrait: true },
  thermal80: { id: 'thermal80', label: 'Thermal 80 mm roll', width: 80, height: 0, variable: true, portrait: true },
  thermal58: { id: 'thermal58', label: 'Thermal 58 mm roll', width: 58, height: 0, variable: true, portrait: true },
  custom: { id: 'custom', label: 'Custom', width: 100, height: 150, portrait: true },
};

export const AUTO_LOCK_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 0, label: 'Never' },
] as const;

export const BACKUP_FREQENCIES = [
  { value: 0, label: 'Disabled' },
  { value: 7, label: 'Every 7 days' },
  { value: 15, label: 'Every 15 days' },
  { value: 30, label: 'Every 30 days' },
] as const;

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
};

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 1;
export const ABSOLUTE_SESSION_HOURS = 12;

export const TOOTH_CONDITIONS = [
  { id: 'healthy', label: 'Healthy', color: 'var(--ok)', glyph: '' },
  { id: 'caries', label: 'Caries', color: 'var(--danger)', glyph: '●' },
  { id: 'restoration', label: 'Restoration', color: 'var(--info)', glyph: '▣' },
  { id: 'missing', label: 'Missing', color: 'var(--fg-3)', glyph: '✕' },
  { id: 'extracted', label: 'Extracted', color: 'var(--fg-3)', glyph: '✕' },
  { id: 'root_canal', label: 'Root Canal', color: 'var(--accent-700)', glyph: '◉' },
  { id: 'crown', label: 'Crown', color: 'var(--accent-500)', glyph: '◈' },
  { id: 'fracture', label: 'Fracture', color: 'var(--warn)', glyph: '⚡' },
  { id: 'mobility', label: 'Mobility', color: 'var(--warn-700)', glyph: '↔' },
  { id: 'impacted', label: 'Impacted', color: 'var(--warn-700)', glyph: '▲' },
  { id: 'infection', label: 'Infection', color: 'var(--danger-700)', glyph: '✱' },
  { id: 'implant', label: 'Implant', color: 'var(--accent-600)', glyph: '⬢' },
  { id: 'sealant', label: 'Sealant', color: 'var(--ok-600)', glyph: '◇' },
  { id: 'other', label: 'Other', color: 'var(--fg-2)', glyph: '○' },
] as const;
export type ToothConditionId = (typeof TOOTH_CONDITIONS)[number]['id'];

export const TOOTH_SURFACES = ['mesial', 'occlusal', 'distal', 'buccal', 'lingual', 'full'] as const;
export type ToothSurface = (typeof TOOTH_SURFACES)[number];

export const MEDICINE_FORMS = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Suspension',
  'Cream',
  'Gel',
  'Drops',
  'Injection',
  'Ointment',
  'Inhaler',
  'Spray',
  'Other',
] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];

/** FDI two-digit adult dentition. */
export const ADULT_TEETH = [
  ...range(18, 11),
  ...range(21, 28),
  ...range(38, 31),
  ...range(41, 48),
] as const;
/** FDI two-digit primary (deciduous) dentition. */
export const PRIMARY_TEETH = [
  ...range(55, 51),
  ...range(61, 65),
  ...range(75, 71),
  ...range(81, 85),
] as const;

function range(from: number, to: number): number[] {
  const out: number[] = [];
  const step = from <= to ? 1 : -1;
  for (let i = from; step < 0 ? i >= to : i <= to; i += step) out.push(i);
  return out;
}

export const ADULT_TOOTH_SET = new Set<string>(ADULT_TEETH.map(String));
export const PRIMARY_TOOTH_SET = new Set<string>(PRIMARY_TEETH.map(String));
export const ALL_TOOTH_SET = new Set<string>([...ADULT_TEETH, ...PRIMARY_TEETH].map(String));

export function isValidTooth(code: string, dentition: 'adult' | 'primary'): boolean {
  return dentition === 'adult' ? ADULT_TOOTH_SET.has(code) : PRIMARY_TOOTH_SET.has(code);
}

export const PAYMENT_METHOD_CODES = [
  'cash',
  'bank',
  'card',
  'bkash',
  'nagad',
  'rocket',
  'upay',
  'other',
] as const;
export type PaymentMethodCode = (typeof PAYMENT_METHOD_CODES)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodCode, string> = {
  cash: 'Cash',
  bank: 'Bank',
  card: 'Card',
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  upay: 'Upay',
  other: 'Other',
};

export const GENDER_CODES = ['male', 'female', 'other', 'prefer_not_to_say'] as const;
export type GenderCode = (typeof GENDER_CODES)[number];

export const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Not specified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export const BLOOD_GROUP_CODES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroupCode = (typeof BLOOD_GROUP_CODES)[number];

export const BLOOD_GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Unknown' },
  ...BLOOD_GROUP_CODES.map((b) => ({ value: b, label: b })),
];

export const PATIENT_STATUSES = ['active', 'inactive', 'archived', 'deceased'] as const;

export const APPOINTMENT_STATUSES = [
  'scheduled', 'confirmed', 'arrived', 'in_queue', 'in_progress', 'completed', 'cancelled', 'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_TYPES = [
  'Consultation', 'Follow-up', 'Emergency', 'Routine check-up', 'Orthodontics', 'Prosthodontics',
  'Oral surgery', 'Scaling & polishing', 'Root canal', 'Extraction', 'Other',
] as const;

export const VISIT_STATUSES = ['open', 'completed', 'cancelled'] as const;

export const STAFF_STATUSES = ['active', 'inactive', 'resigned'] as const;

export const INVENTORY_CATEGORIES = [
  'Consumable', 'Instrument', 'Material', 'Medication', 'Implant', 'Orthodontic', 'Laboratory', 'Other',
] as const;

export const INVENTORY_UNITS = [
  'pcs', 'box', 'packet', 'bottle', 'tube', 'sachet', 'ml', 'g', 'kg', 'set', 'pair', 'roll', 'sheet',
] as const;

export const EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Salaries', 'Supplies', 'Equipment', 'Maintenance', 'Marketing',
  'Transport', 'Laboratory', 'Utilities & internet', 'Tax & fees', 'Other',
] as const;

export const INCOME_CATEGORIES = [
  'Service revenue', 'Other revenue', 'Interest', 'Grant', 'Refund received', 'Other',
] as const;
