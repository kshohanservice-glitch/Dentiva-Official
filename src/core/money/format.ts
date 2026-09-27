/**
 * Date / time / numeral formatting for a Bangladesh dental clinic.
 *
 * All storage is ASCII ISO-8601. Formatting is display-only. Bengali numerals
 * are a presentation choice driven by settings; the stored value never changes.
 */

const EN_DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export type DateFormatId = 'dmy' | 'ymd' | 'mdy';
export type TimeFormatId = '12h' | '24h';

export const DATE_FORMATS: { id: DateFormatId; label: string; example: string }[] = [
  { id: 'dmy', label: 'DD/MM/YYYY', example: '27/09/2026' },
  { id: 'ymd', label: 'YYYY-MM-DD', example: '2026-09-27' },
  { id: 'mdy', label: 'MM/DD/YYYY', example: '09/27/2026' },
];

export const TIME_FORMATS: { id: TimeFormatId; label: string; example: string }[] = [
  { id: '12h', label: '12-hour (AM/PM)', example: '07:30 PM' },
  { id: '24h', label: '24-hour', example: '19:30' },
];

export function toBengaliDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const idx = EN_DIGITS.indexOf(ch);
    out += idx >= 0 ? BN_DIGITS[idx] : ch;
  }
  return out;
}

export function toEnglishDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const idx = BN_DIGITS.indexOf(ch);
    out += idx >= 0 ? EN_DIGITS[idx] : ch;
  }
  return out;
}

export function applyNumeralStyle(text: string, bengaliNumerals: boolean): string {
  return bengaliNumerals ? toBengaliDigits(text) : toEnglishDigits(text);
}

/** Local business date string `YYYY-MM-DD` for a given Date, in local time. */
export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toLocalTimeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(value: string | Date | null | undefined, format: DateFormatId = 'dmy', bengali = false): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  let out: string;
  switch (format) {
    case 'ymd':
      out = `${yyyy}-${mm}-${dd}`;
      break;
    case 'mdy':
      out = `${mm}/${dd}/${yyyy}`;
      break;
    default:
      out = `${dd}/${mm}/${yyyy}`;
  }
  return applyNumeralStyle(out, bengali);
}

export function formatTime(value: string | Date | null | undefined, format: TimeFormatId = '12h', bengali = false): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(/^\d{2}:\d{2}$/.test(value) ? `2000-01-01T${value}:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  const h24 = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  let out: string;
  if (format === '24h') {
    out = `${String(h24).padStart(2, '0')}:${m}`;
  } else {
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    out = `${h12}:${m} ${h24 < 12 ? 'AM' : 'PM'}`;
  }
  return applyNumeralStyle(out, bengali);
}

export function formatDateTime(value: string | Date | null | undefined, dateFormat: DateFormatId = 'dmy', timeFormat: TimeFormatId = '12h', bengali = false): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDate(d, dateFormat, bengali)}, ${formatTime(d, timeFormat, bengali)}`;
}

export function relativeTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = now.getTime() - d.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return future ? `in ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return future ? `in ${hours} h` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return future ? `in ${days} d` : `${days} d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return future ? `in ${months} mo` : `${months} mo ago`;
  const years = Math.round(months / 12);
  return future ? `in ${years} y` : `${years} y ago`;
}

export function ageFrom(dateOfBirth: string | null, ageYears: number | null, ageMonths: number | null, on: Date = new Date()): string {
  if (dateOfBirth) {
    const dob = new Date(`${dateOfBirth}T00:00:00`);
    if (!Number.isNaN(dob.getTime())) {
      let years = on.getFullYear() - dob.getFullYear();
      let months = on.getMonth() - dob.getMonth();
      if (on.getDate() < dob.getDate()) months -= 1;
      if (months < 0) {
        years -= 1;
        months += 12;
      }
      if (years < 0) return '—';
      return months === 0 ? `${years} yr` : `${years} yr ${months} mo`;
    }
  }
  if (ageYears == null && ageMonths == null) return '—';
  const y = ageYears ?? 0;
  const m = ageMonths ?? 0;
  if (y <= 0 && m <= 0) return `${m} mo`;
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}
