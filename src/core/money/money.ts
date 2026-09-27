import { POISHA_PER_TAKA } from '../../shared/constants';
import { toEnglishDigits } from './format';

/**
 * Money is represented as an integer number of POISHA.
 * 1 BDT (৳) = 100 poisha. Integer arithmetic only — never a float.
 */
export type Poisha = number;

export const ZERO: Poisha = 0;

export function takaToPoisha(taka: number): Poisha {
  return Math.round(taka * POISHA_PER_TAKA);
}

export function poishaToTaka(p: Poisha): number {
  return p / POISHA_PER_TAKA;
}

/** Quantities are stored as integer THOUSANDTHS so 0.5 steps are exact. */
export type MilliQuantity = number;

export function qtyToMilli(qty: number): MilliQuantity {
  return Math.round(qty * 1000);
}

export function milliToQty(m: MilliQuantity): number {
  return m / 1000;
}

export function add(...values: Poisha[]): Poisha {
  return values.reduce((a, b) => a + b, 0);
}

export function sum(values: readonly Poisha[]): Poisha {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function negate(p: Poisha): Poisha {
  return -p;
}

export function multiplyByMilliQuantity(price: Poisha, qtyMilli: MilliQuantity): Poisha {
  // Integer-only: (price * qtyMilli) / 1000 rounded half-up, avoiding float.
  const product = price * qtyMilli;
  return product >= 0 ? Math.floor((product + 500) / 1000) : -Math.floor((-product + 500) / 1000);
}

export function percentOf(amount: Poisha, percentBasisPoints: number): Poisha {
  // percentBasisPoints: 10000 = 100%
  const product = amount * percentBasisPoints;
  return product >= 0 ? Math.floor((product + 5000) / 10000) : -Math.floor((-product + 5000) / 10000);
}

export function isZero(p: Poisha): boolean {
  return p === 0;
}

export function assertIntegerPoisha(value: unknown, label: string): Poisha {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer number of poisha.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} is out of the supported range.`);
  }
  return value;
}

export function assertNonNegativePoisha(value: unknown, label: string): Poisha {
  const p = assertIntegerPoisha(value, label);
  if (p < 0) throw new RangeError(`${label} cannot be negative.`);
  return p;
}

/** Format a money amount for display. `decimals` is almost always 2. */
export function formatMoney(p: Poisha, opts: { decimals?: number; symbol?: boolean } = {}): string {
  const decimals = opts.decimals ?? 2;
  const negative = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / POISHA_PER_TAKA);
  const frac = abs % POISHA_PER_TAKA;
  const grouped = groupDigits(whole);
  const body = decimals > 0 ? `${grouped}.${String(frac).padStart(decimals, '0')}` : grouped;
  const sign = negative ? '-' : '';
  return opts.symbol === false ? `${sign}${body}` : `${sign}৳${body}`;
}

export function parseMoneyInput(text: string): Poisha {
  const cleaned = String(text).replace(/[^\d.-]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * POISHA_PER_TAKA);
}

export function formatQuantity(qtyMilli: MilliQuantity): string {
  if (qtyMilli % 1000 === 0) return String(qtyMilli / 1000);
  return (qtyMilli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function groupDigits(n: number): string {
  const s = String(n);
  let out = '';
  let count = 0;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    out = s[i] + out;
    count += 1;
    if (count % 3 === 0 && i > 0) out = ',' + out;
  }
  return out;
}

/**
 * Parse a user-typed taka amount into integer poisha.
 *
 * Input is treated as a decimal string and converted with integer arithmetic
 * only, so a value typed as "1250.75" becomes exactly 125075 poisha — never
 * 125074.99999999999. Bengali digits are accepted so a Bangla keyboard works.
 */
export function takaInputToPoisha(input: string): Poisha | null {
  const normalised = toEnglishDigits(String(input)).trim().replace(/,/g, '').replace(/\s|৳|BDT/gi, '');
  if (!normalised) return null;
  if (!/^\d*(\.\d{0,2})?$/.test(normalised)) return null;
  const [whole = '0', frac = ''] = normalised.split('.');
  const taka = Number(whole || '0');
  if (!Number.isFinite(taka)) return null;
  const paisa = Number(frac.padEnd(2, '0') || '0');
  return taka * 100 + paisa;
}

/** Render integer poisha as a plain taka string for editing. */
export function poishaToTakaInput(poisha: Poisha): string {
  if (poisha === 0) return '';
  const negative = poisha < 0;
  const abs = Math.abs(poisha);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
