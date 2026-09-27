import type { DateFormatId, TimeFormatId } from '../../core/money/format';

export interface DisplayPrefs {
  bengaliNumerals: boolean;
  dateFormat: DateFormatId;
  timeFormat: TimeFormatId;
}

const EN = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function numerals(text: string, bengali: boolean): string {
  if (!bengali) return text;
  let out = '';
  for (const ch of text) {
    const idx = EN.indexOf(ch);
    out += idx >= 0 ? BN[idx] : ch;
  }
  return out;
}

function stripEnglishDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const idx = BN.indexOf(ch);
    out += idx >= 0 ? EN[idx] : ch;
  }
  return out;
}

/** Poisha → "৳1,250.00" using ASCII or Bengali digits. */
export function money(poisha: number | null | undefined, prefs: DisplayPrefs, opts: { decimals?: number; symbol?: boolean } = {}): string {
  const value = Number(poisha ?? 0);
  const decimals = opts.decimals ?? 2;
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decimals > 0 ? `${grouped}.${String(frac).padStart(decimals, '0')}` : grouped;
  const sign = negative ? '-' : '';
  return numerals(opts.symbol === false ? `${sign}${body}` : `${sign}৳${body}`, prefs.bengaliNumerals);
}

export function moneyCompact(poisha: number | null | undefined, prefs: DisplayPrefs): string {
  const taka = Math.abs(Number(poisha ?? 0)) / 100;
  const sign = Number(poisha ?? 0) < 0 ? '-' : '';
  if (taka >= 100000) return `${sign}৳${numerals((taka / 100000).toFixed(1), prefs.bengaliNumerals)}L`;
  if (taka >= 1000) return `${sign}৳${numerals((taka / 1000).toFixed(1), prefs.bengaliNumerals)}K`;
  return money(poisha, prefs);
}

export function poishaToInput(poisha: number | null | undefined): string {
  const value = Number(poisha ?? 0) / 100;
  return value === 0 ? '' : value.toFixed(2);
}

export function quantityLabel(milli: number): string {
  if (milli % 1000 === 0) return String(milli / 1000);
  return (milli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function date(value: string | Date | null | undefined, prefs: DisplayPrefs): string {
  const d = toDate(value);
  if (!d) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  const out = prefs.dateFormat === 'ymd' ? `${yyyy}-${mm}-${dd}` : prefs.dateFormat === 'mdy' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
  return numerals(out, prefs.bengaliNumerals);
}

export function time(value: string | Date | null | undefined, prefs: DisplayPrefs): string {
  if (!value) return '—';
  const text = String(value);
  const d = /^\d{2}:\d{2}/.test(text) ? new Date(`2000-01-01T${text.slice(0, 5)}:00`) : toDate(text);
  if (!d) return '—';
  const h24 = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const out =
    prefs.timeFormat === '24h'
      ? `${String(h24).padStart(2, '0')}:${m}`
      : `${h24 % 12 === 0 ? 12 : h24 % 12}:${m} ${h24 < 12 ? 'AM' : 'PM'}`;
  return numerals(out, prefs.bengaliNumerals);
}

export function dateTime(value: string | Date | null | undefined, prefs: DisplayPrefs): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${date(d, prefs)}, ${time(d, prefs)}`;
}

/** Date + time from separate stored columns (business date + clock time). */
export function dateAndTime(dateKey: string | null | undefined, timeKey: string | null | undefined, prefs: DisplayPrefs): string {
  if (!dateKey) return '—';
  if (!timeKey) return date(dateKey, prefs);
  return `${date(dateKey, prefs)}, ${time(timeKey, prefs)}`;
}

export function age(
  patient: {
    date_of_birth?: string | null;
    age_years?: number | null;
    age_months?: number | null;
  },
  prefs?: DisplayPrefs,
): string {
  if (patient.date_of_birth) {
    const dob = toDate(patient.date_of_birth);
    if (dob) {
      const now = new Date();
      let years = now.getFullYear() - dob.getFullYear();
      let months = now.getMonth() - dob.getMonth();
      if (now.getDate() < dob.getDate()) months -= 1;
      if (months < 0) {
        years -= 1;
        months += 12;
      }
      if (years < 0) return '—';
      return months === 0
        ? numerals(`${years} yr`, prefs?.bengaliNumerals ?? false)
        : numerals(`${years} yr ${months} mo`, prefs?.bengaliNumerals ?? false);
    }
  }
  const y = patient.age_years ?? null;
  const m = patient.age_months ?? null;
  if (y === null && m === null) return '—';
  const years = y ?? 0;
  const months = m ?? 0;
  const bengali = prefs?.bengaliNumerals ?? false;
  if (years <= 0) return numerals(`${months} mo`, bengali);
  return months === 0
    ? numerals(`${years} yr`, bengali)
    : numerals(`${years} yr ${months} mo`, bengali);
}

export function relativeTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return future ? `in ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return future ? `in ${hours} h` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return future ? `in ${days} d` : `${days} d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return future ? `in ${months} mo` : `${months} mo ago`;
  return future ? `in ${Math.round(months / 12)} y` : `${Math.round(months / 12)} y ago`;
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftDateKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shortDate(value: string | null | undefined, prefs: DisplayPrefs): string {
  const d = toDate(value);
  if (!d) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return numerals(`${d.getDate()} ${months[d.getMonth()]}`, prefs.bengaliNumerals);
}

export function bytesLabel(count: number): string {
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`;
  if (count < 1024 * 1024 * 1024) return `${(count / (1024 * 1024)).toFixed(1)} MB`;
  return `${(count / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const GENDER_LABELS: Record<string, string> = {
  '': 'Not specified',
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

export const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
  deceased: 'Deceased',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  in_queue: 'In Queue',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  rescheduled: 'Rescheduled',
  waiting: 'Waiting',
  called: 'Called',
  skipped: 'Skipped',
  open: 'Open',
  draft: 'Draft',
  issued: 'Issued',
  unpaid: 'Unpaid',
  partial: 'Partially Paid',
  paid: 'Paid',
  referred: 'Referred',
  'followed-up': 'Followed up',
  done: 'Done',
  planned: 'Planned',
  disabled: 'Disabled',
  resigned: 'Resigned',
  receipt: 'Receipt',
  refund: 'Refund',
};

export const STATUS_TONES: Record<string, 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'primary'> = {
  active: 'ok',
  completed: 'ok',
  paid: 'ok',
  issued: 'ok',
  done: 'ok',
  scheduled: 'info',
  confirmed: 'info',
  arrived: 'info',
  in_queue: 'info',
  in_progress: 'primary',
  called: 'primary',
  waiting: 'warn',
  draft: 'neutral',
  unpaid: 'danger',
  partial: 'warn',
  cancelled: 'danger',
  no_show: 'danger',
  skipped: 'neutral',
  archived: 'neutral',
  inactive: 'neutral',
  disabled: 'neutral',
  open: 'warn',
  resigned: 'neutral',
  referred: 'info',
  'followed-up': 'primary',
  planned: 'neutral',
  receipt: 'ok',
  refund: 'warn',
};

export function statusTone(status: string): 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'primary' {
  return STATUS_TONES[status] ?? 'neutral';
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** True when a string contains Bengali script (used to pick the font class). */
export function hasBengali(value: string): boolean {
  return /[ঀ-৿]/.test(value);
}

export function textFor(value: string): string {
  return stripEnglishDigits(value);
}
