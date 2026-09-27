import { fieldError, type FieldIssue } from '../errors';

/** Small, dependency-free validation toolkit used by every service. */

export class Validator {
  private readonly issues: FieldIssue[] = [];
  private readonly data: Record<string, unknown>;

  constructor(data: unknown, private readonly prefix = '') {
    this.data = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  }

  private key(field: string): string {
    return this.prefix ? `${this.prefix}.${field}` : field;
  }

  private fail(field: string, message: string): void {
    this.issues.push({ field: this.key(field), message });
  }

  /** Record a custom validation issue against a dotted path such as `admin.password`. */
  issue(field: string, message: string): void {
    this.fail(field, message);
  }

  get problems(): FieldIssue[] {
    return this.issues;
  }

  get ok(): boolean {
    return this.issues.length === 0;
  }

  throwIfInvalid(message = 'Please correct the highlighted fields.'): void {
    if (this.issues.length) throw fieldError(this.issues, message);
  }

  /** Resolve a possibly dotted path (`clinic.name`, `items[0].dose`) from the input. */
  raw(field: string): unknown {
    return readPath(this.data, field);
  }

  string(field: string, opts: { required?: boolean; min?: number; max?: number; label?: string; trim?: boolean } = {}): string {
    const label = opts.label ?? humanise(field);
    const v = this.raw(field);
    if (v === undefined || v === null || v === '') {
      if (opts.required) this.fail(field, `${label} is required.`);
      return '';
    }
    if (typeof v !== 'string') {
      this.fail(field, `${label} must be text.`);
      return '';
    }
    const s = opts.trim === false ? v : v.trim();
    if (opts.required && s === '') this.fail(field, `${label} is required.`);
    if (opts.min !== undefined && s.length > 0 && s.length < opts.min) this.fail(field, `${label} must be at least ${opts.min} characters.`);
    if (opts.max !== undefined && s.length > opts.max) this.fail(field, `${label} must be at most ${opts.max} characters.`);
    return s;
  }

  optionalString(field: string, max = 4000): string {
    const v = this.raw(field);
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') {
      this.fail(field, `${humanise(field)} must be text.`);
      return '';
    }
    const s = v.trim();
    if (s.length > max) this.fail(field, `${humanise(field)} must be at most ${max} characters.`);
    return s;
  }

  int(field: string, opts: { required?: boolean; min?: number; max?: number; label?: string } = {}): number {
    const label = opts.label ?? humanise(field);
    const v = this.raw(field);
    if (v === undefined || v === null || v === '') {
      if (opts.required) this.fail(field, `${label} is required.`);
      return 0;
    }
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      this.fail(field, `${label} must be a whole number.`);
      return 0;
    }
    if (opts.min !== undefined && n < opts.min) this.fail(field, `${label} must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) this.fail(field, `${label} must be at most ${opts.max}.`);
    return n;
  }

  optionalInt(field: string, opts: { min?: number; max?: number; label?: string } = {}): number | null {
    const v = this.raw(field);
    if (v === undefined || v === null || v === '') return null;
    return this.int(field, opts);
  }

  bool(field: string, fallback = false): boolean {
    const v = this.raw(field);
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1 || v === '1') return true;
    if (v === 'false' || v === 0 || v === '0') return false;
    this.fail(field, `${humanise(field)} must be true or false.`);
    return fallback;
  }

  number(field: string, opts: { required?: boolean; min?: number; max?: number; label?: string } = {}): number {
    const label = opts.label ?? humanise(field);
    const v = this.raw(field);
    if (v === undefined || v === null || v === '') {
      if (opts.required) this.fail(field, `${label} is required.`);
      return 0;
    }
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    if (!Number.isFinite(n)) {
      this.fail(field, `${label} must be a number.`);
      return 0;
    }
    if (opts.min !== undefined && n < opts.min) this.fail(field, `${label} must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) this.fail(field, `${label} must be at most ${opts.max}.`);
    return n;
  }

  enum<T extends string>(field: string, allowed: readonly T[], opts: { required?: boolean; label?: string } = {}): T {
    const label = opts.label ?? humanise(field);
    const v = this.raw(field);
    if (v === undefined || v === null || v === '') {
      if (opts.required) this.fail(field, `${label} is required.`);
      return allowed[0] as T;
    }
    if (typeof v !== 'string' || !allowed.includes(v as T)) {
      this.fail(field, `${label} must be one of: ${allowed.join(', ')}.`);
      return allowed[0] as T;
    }
    return v as T;
  }

  array<T>(field: string, item: (v: unknown, index: number) => T, opts: { required?: boolean; minItems?: number; maxItems?: number; label?: string } = {}): T[] {
    const label = opts.label ?? humanise(field);
    const v = this.raw(field);
    if (v === undefined || v === null) {
      if (opts.required) this.fail(field, `${label} is required.`);
      if (opts.minItems) this.fail(field, `${label} must contain at least ${opts.minItems} item(s).`);
      return [];
    }
    if (!Array.isArray(v)) {
      this.fail(field, `${label} must be a list.`);
      return [];
    }
    if (opts.minItems !== undefined && v.length < opts.minItems) this.fail(field, `${label} must contain at least ${opts.minItems} item(s).`);
    if (opts.maxItems !== undefined && v.length > opts.maxItems) this.fail(field, `${label} must contain at most ${opts.maxItems} item(s).`);
    return v.map(item);
  }

  /** Bangladeshi mobile or landline, tolerant of spacing/dashes. */
  phone(field: string, opts: { required?: boolean; label?: string } = {}): string {
    const label = opts.label ?? humanise(field);
    const raw = this.raw(field);
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (opts.required) this.fail(field, `${label} is required.`);
      return '';
    }
    const s = String(raw).trim();
    const normalised = s.replace(/[\s\-()]/g, '');
    if (!/^\+?\d{6,15}$/.test(normalised)) {
      this.fail(field, `${label} must be a valid phone number (6–15 digits).`);
      return s;
    }
    return s;
  }

  dateKey(field: string, opts: { required?: boolean; label?: string } = {}): string {
    const label = opts.label ?? humanise(field);
    const raw = this.raw(field);
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (opts.required) this.fail(field, `${label} is required.`);
      return '';
    }
    const s = String(raw).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      this.fail(field, `${label} must be a valid date.`);
      return '';
    }
    const d = new Date(`${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) {
      this.fail(field, `${label} must be a valid date.`);
      return '';
    }
    return s;
  }

  timeKey(field: string, opts: { required?: boolean; label?: string } = {}): string {
    const label = opts.label ?? humanise(field);
    const raw = this.raw(field);
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (opts.required) this.fail(field, `${label} is required.`);
      return '';
    }
    const s = String(raw).trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) {
      this.fail(field, `${label} must be a valid time (HH:MM).`);
      return '';
    }
    return s;
  }

  isoDateTime(field: string, opts: { required?: boolean; label?: string } = {}): string {
    const label = opts.label ?? humanise(field);
    const raw = this.raw(field);
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (opts.required) this.fail(field, `${label} is required.`);
      return '';
    }
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) {
      this.fail(field, `${label} must be a valid date and time.`);
      return '';
    }
    return d.toISOString();
  }

  oneOfObjects<T>(field: string, values: readonly T[], predicate: (v: T) => boolean, message: string): T {
    const v = this.raw(field);
    if (v === undefined || v === null || !values.some((c) => predicate(c))) {
      this.fail(field, message);
      return values[0] as T;
    }
    return values.find((c) => predicate(c)) as T;
  }

  get(field: string): unknown {
    return readPath(this.data, field);
  }
}

function readPath(data: Record<string, unknown>, path: string): unknown {
  if (!(path in data) && !path.includes('.') && !path.includes('[')) return data[path];
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s.length > 0);
  let current: unknown = data;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function humanise(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function str(data: Record<string, unknown>, field: string): string {
  const v = data[field];
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

export function num(data: Record<string, unknown>, field: string): number {
  const v = data[field];
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

export function boolOf(data: Record<string, unknown>, field: string): boolean {
  const v = data[field];
  return v === true || v === 1 || v === '1' || v === 'true';
}
