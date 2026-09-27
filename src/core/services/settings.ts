import { Db, nowIso } from '../db/connection';
import { AppError } from '../errors';
import { Validator } from '../validation/validate';
import type { DateFormatId, TimeFormatId } from '../money/format';

export type ThemeName = 'light' | 'dark';
export type DensityName = 'comfortable' | 'compact';

export interface SettingsShape {
  'app.setupCompleted': boolean;
  'app.installedAt': string;
  'app.buildNumber': string;

  'auth.autoLockMinutes': number;
  'auth.minPasswordLength': number;
  'auth.requireDigit': boolean;
  'auth.requireLower': boolean;
  'auth.requireUpper': boolean;
  'auth.requireSymbol': boolean;

  'display.theme': ThemeName;
  'display.density': DensityName;
  'display.animations': boolean;
  'display.sidebarCollapsed': boolean;
  'display.bengaliNumerals': boolean;
  'display.dashboardWidgets': string[];

  'format.dateFormat': DateFormatId;
  'format.timeFormat': TimeFormatId;

  'print.prescriptionPaper': string;
  'print.invoicePaper': string;
  'print.prescriptionFooter': string;
  'print.invoiceFooter': string;
  'print.showDentistOnInvoice': boolean;

  'backup.folder': string;
  'backup.frequencyDays': number;
  'backup.retentionCount': number;
  'backup.lastAutomaticAt': string;

  'clinic.currencyCode': string;
  'clinic.currencySymbol': string;
  'clinic.footerMessage': string;

  'financial.defaultTaxPercentBp': number;
  'financial.invoicePrefix': string;
  'financial.paymentPrefix': string;
  'financial.allowOverpayment': boolean;

  'inventory.expiryAlertDays': number;

  'patients.nextCode': number;
}

export const DEFAULT_SETTINGS: SettingsShape = {
  'app.setupCompleted': false,
  'app.installedAt': '',
  'app.buildNumber': '',

  'auth.autoLockMinutes': 10,
  'auth.minPasswordLength': 8,
  'auth.requireDigit': true,
  'auth.requireLower': true,
  'auth.requireUpper': false,
  'auth.requireSymbol': false,

  'display.theme': 'light',
  'display.density': 'comfortable',
  'display.animations': true,
  'display.sidebarCollapsed': false,
  'display.bengaliNumerals': false,
  'display.dashboardWidgets': [
    'today-appointments',
    'waiting-queue',
    'revenue',
    'outstanding',
    'low-stock',
    'upcoming',
    'recent-patients',
    'recent-payments',
  ],

  'format.dateFormat': 'dmy',
  'format.timeFormat': '12h',

  'print.prescriptionPaper': 'a4',
  'print.invoicePaper': 'a4',
  'print.prescriptionFooter': '',
  'print.invoiceFooter': '',
  'print.showDentistOnInvoice': false,

  'backup.folder': '',
  'backup.frequencyDays': 7,
  'backup.retentionCount': 20,
  'backup.lastAutomaticAt': '',

  'clinic.currencyCode': 'BDT',
  'clinic.currencySymbol': '৳',
  'clinic.footerMessage': '',

  'financial.defaultTaxPercentBp': 0,
  'financial.invoicePrefix': 'INV',
  'financial.paymentPrefix': 'PAY',
  'financial.allowOverpayment': false,

  'inventory.expiryAlertDays': 60,

  'patients.nextCode': 1,
};

export class SettingsService {
  private cache: Map<string, unknown> | null = null;

  constructor(private readonly db: Db) {}

  private load(): Map<string, unknown> {
    if (this.cache) return this.cache;
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const map = new Map<string, unknown>();
    for (const row of rows) {
      try {
        map.set(row.key, JSON.parse(row.value));
      } catch {
        map.set(row.key, row.value);
      }
    }
    this.cache = map;
    return map;
  }

  invalidate(): void {
    this.cache = null;
  }

  all(): SettingsShape {
    const map = this.load();
    const out = {} as SettingsShape;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsShape)[]) {
      const value = map.get(key as string);
      out[key] = (value === undefined ? DEFAULT_SETTINGS[key] : value) as never;
    }
    return out;
  }

  get<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
    const map = this.load();
    if (!map.has(key as string)) return DEFAULT_SETTINGS[key];
    return map.get(key as string) as SettingsShape[K];
  }

  set<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key as string, JSON.stringify(value), nowIso()],
    );
    this.cache?.set(key as string, value);
  }

  setMany(values: Partial<SettingsShape>): void {
    for (const [k, v] of Object.entries(values)) this.set(k as keyof SettingsShape, v as never);
  }

  getState(key: string): string {
    const row = this.db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [key]);
    if (!row) return '';
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return typeof parsed === 'string' ? parsed : String(row.value);
    } catch {
      return row.value;
    }
  }

  setState(key: string, value: string): void {
    this.db.run(
      `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), nowIso()],
    );
  }

  deleteState(key: string): void {
    this.db.run('DELETE FROM app_state WHERE key = ?', [key]);
  }
}

/**
 * Validates and coerces a settings patch. Every key is explicitly typed, so an
 * unexpected value type is rejected instead of silently corrupting a setting.
 */
export function applySettingsPatch(patch: unknown): Partial<SettingsShape> {
  const body = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const v = new Validator({}, '');

  for (const [key, value] of Object.entries(body)) {
    if (!(key in DEFAULT_SETTINGS)) {
      throw new AppError('validation', `Unknown setting: ${key}`);
    }
    const fallback = DEFAULT_SETTINGS[key as keyof SettingsShape];
    const label = key.startsWith('display.') ? key.slice(8) : key;

    if (Array.isArray(fallback)) {
      if (!Array.isArray(value)) throw new AppError('validation', `${label} must be a list.`);
      if (value.length > 64) throw new AppError('validation', `${label} has too many entries.`);
      out[key] = value.map((x) => String(x));
      continue;
    }
    if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') throw new AppError('validation', `${label} must be true or false.`);
      out[key] = value;
      continue;
    }
    if (typeof fallback === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new AppError('validation', `${label} must be a number.`);
      const bounds: Record<string, [number, number]> = {
        'auth.autoLockMinutes': [0, 240],
        'auth.minPasswordLength': [6, 32],
        'backup.frequencyDays': [0, 365],
        'backup.retentionCount': [1, 500],
        'financial.defaultTaxPercentBp': [0, 10000],
        'inventory.expiryAlertDays': [0, 3650],
        'patients.nextCode': [1, 100000000],
      };
      const range = bounds[key];
      if (range && (value < range[0] || value > range[1])) {
        throw new AppError('validation', `${label} must be between ${range[0]} and ${range[1]}.`);
      }
      out[key] = value;
      continue;
    }
    if (typeof value !== 'string') throw new AppError('validation', `${label} must be text.`);
    if ((value as string).length > 2000) throw new AppError('validation', `${label} is too long.`);
    if (key === 'display.theme' && value !== 'light' && value !== 'dark') {
      throw new AppError('validation', 'Theme must be light or dark.');
    }
    if (key === 'display.density' && value !== 'comfortable' && value !== 'compact') {
      throw new AppError('validation', 'Density must be comfortable or compact.');
    }
    if (key === 'format.dateFormat' && !['dmy', 'ymd', 'mdy'].includes(value)) {
      throw new AppError('validation', 'Date format must be DD/MM/YYYY, YYYY-MM-DD or MM/DD/YYYY.');
    }
    if (key === 'format.timeFormat' && !['12h', '24h'].includes(value)) {
      throw new AppError('validation', 'Time format must be 12-hour or 24-hour.');
    }
    if ((key === 'print.prescriptionPaper' || key === 'print.invoicePaper') && !/^[a-z0-9]{1,24}$/.test(value)) {
      throw new AppError('validation', 'Paper size is not valid.');
    }
    if (key === 'financial.invoicePrefix' && !/^[A-Za-z0-9-]{1,12}$/.test(value)) {
      throw new AppError('validation', 'Invoice prefix may contain letters, digits and hyphens only.');
    }
    if (key === 'financial.paymentPrefix' && !/^[A-Za-z0-9-]{1,12}$/.test(value)) {
      throw new AppError('validation', 'Payment prefix may contain letters, digits and hyphens only.');
    }
    out[key] = value;
  }

  void v;
  return out as Partial<SettingsShape>;
}
