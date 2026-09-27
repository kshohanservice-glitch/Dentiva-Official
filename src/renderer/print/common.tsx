import type { JSX, ReactNode } from 'react';
import { date, time, money, age, hasBengali, type DisplayPrefs } from '../lib/format';

/** A tiny helper that tags non-Latin runs so the Bengali font and line-height apply. */
export function Scripted({ children }: { children: ReactNode }): JSX.Element {
  const text = typeof children === 'string' ? children : '';
  return hasBengali(text) ? <span lang="bn" className="bn">{children}</span> : <>{children}</>;
}

export interface ClinicIdentity {
  name?: string | null;
  tagline?: string | null;
  address_line?: string | null;
  area?: string | null;
  district?: string | null;
  thana?: string | null;
  postcode?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  website?: string | null;
  footer_message?: string | null;
  logo_attachment_id?: number | null;
  logoDataUrl?: string | null;
}

export function clinicAddressLine(clinic: ClinicIdentity): string {
  return [clinic.address_line, clinic.area, clinic.thana, clinic.district, clinic.postcode]
    .map((part) => (part ?? '').toString().trim())
    .filter(Boolean)
    .join(', ');
}

export function DocHeader({
  clinic, title, number, issuedAt, logo,
}: {
  clinic: ClinicIdentity;
  title: string;
  number?: string | null;
  issuedAt?: string | null;
  logo?: string | null;
}): JSX.Element {
  const contacts = [clinic.phone, clinic.email, clinic.website].map((part) => (part ?? '').toString().trim()).filter(Boolean);
  return (
    <header className="doc-head">
      {logo ? (
        <img className="doc-logo" src={logo} alt="" />
      ) : (
        // The monogram is a real glyph on the page, so a Bengali clinic name
        // gets the Bengali family here too — otherwise the letter prints in
        // the Latin fallback and comes out as a row of marks.
        <div className="doc-logo doc-logo--placeholder" aria-hidden="true">
          <Scripted>{(clinic.name ?? 'C').trim().charAt(0).toUpperCase()}</Scripted>
        </div>
      )}
      <div className="doc-head-main">
        <div className="doc-clinic-name"><Scripted>{clinic.name ?? 'Dental Clinic'}</Scripted></div>
        {clinic.tagline ? (
          <div className="doc-clinic-tagline"><Scripted>{clinic.tagline}</Scripted></div>
        ) : null}
        <div className="doc-clinic-contact">
          <div><Scripted>{clinicAddressLine(clinic)}</Scripted></div>
          {contacts.length ? <div>{contacts.join('  ·  ')}</div> : null}
        </div>
      </div>
      <div className="doc-head-side">
        <div className="doc-title">{title}</div>
        {number ? <div className="doc-no">{number}</div> : null}
        {issuedAt ? <div className="doc-date">Date: {issuedAt}</div> : null}
      </div>
    </header>
  );
}

export function KeyValue({ k, v, script }: { k: string; v: ReactNode; script?: boolean }): JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="k">{k}: </span>
      <span className="v">{script ? <Scripted>{v}</Scripted> : v}</span>
    </div>
  );
}

export function PatientStrip({
  entries, compact,
}: {
  entries: { k: string; v: ReactNode; script?: boolean }[];
  compact?: boolean;
}): JSX.Element {
  return (
    <div className={`doc-patient ${compact ? 'doc-patient--compact' : ''}`}>
      {entries.map((entry) => (
        <KeyValue key={entry.k} k={entry.k} v={entry.v} script={entry.script} />
      ))}
    </div>
  );
}

export function DocFooter({
  message, scheduleNote, signature,
}: {
  message?: ReactNode;
  scheduleNote?: ReactNode;
  signature?: ReactNode;
}): JSX.Element {
  return (
    <footer className="doc-foot">
      <div style={{ minWidth: 0 }}>
        {message ? <div className="doc-foot-message"><Scripted>{message}</Scripted></div> : null}
        {scheduleNote ? <div className="doc-foot-schedule"><Scripted>{scheduleNote}</Scripted></div> : null}
      </div>
      {signature}
    </footer>
  );
}

export function DoctorSignature({
  name, title, qualifications, registration, signatureImage,
}: {
  name: string;
  title?: string | null;
  qualifications?: string | null;
  registration?: string | null;
  signatureImage?: string | null;
}): JSX.Element {
  return (
    <div className="doc-signature">
      {signatureImage ? <img className="doc-signature__image" src={signatureImage} alt="" /> : null}
      <div className="doc-signature__line">
        <div className="doc-signature__name"><Scripted>{name}</Scripted></div>
        {title || qualifications ? (
          <div className="doc-signature__title"><Scripted>{[title, qualifications].filter(Boolean).join(', ')}</Scripted></div>
        ) : null}
        {registration ? <div className="doc-signature__reg">Reg. No: {registration}</div> : null}
      </div>
    </div>
  );
}

export function AgeText(patient: { age_years?: number | null; age_months?: number | null; date_of_birth?: string | null }, prefs: DisplayPrefs): string {
  return age({ age_years: patient.age_years ?? null, age_months: patient.age_months ?? null, date_of_birth: patient.date_of_birth ?? null }, prefs);
}

export function FormattedDate(value: string | null | undefined, prefs: DisplayPrefs): string {
  return date(value, prefs);
}

export function FormattedTime(value: string | null | undefined, prefs: DisplayPrefs): string {
  return time(value, prefs);
}

export function FormattedMoney(poisha: number | null | undefined, prefs: DisplayPrefs): string {
  return money(poisha, prefs);
}

export function AmountInWords(poisha: number, prefs: DisplayPrefs): string {
  return toBengaliEnglishWords(poisha, prefs.bengaliNumerals);
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underThousand(value: number): string {
  if (value === 0) return '';
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0 && rest < 20) parts.push(ONES[rest] as string);
  else if (rest >= 20) {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    parts.push(ones ? `${TENS[tens]}-${ONES[ones]}` : (TENS[tens] as string));
  }
  return parts.join(' ');
}

/** English amount in words with the Taka/Paisa split, as customary on Bangladeshi invoices. */
export function toBengaliEnglishWords(poisha: number, _bengali: boolean): string {
  const value = Math.abs(Math.round(poisha));
  const taka = Math.floor(value / 100);
  const paisa = value % 100;
  const crore = Math.floor(taka / 10000000);
  const lakh = Math.floor((taka % 10000000) / 100000);
  const thousand = Math.floor((taka % 100000) / 1000);
  const remainder = taka % 1000;
  const chunks: string[] = [];
  if (crore) chunks.push(`${underThousand(crore)} Crore`);
  if (lakh) chunks.push(`${underThousand(lakh)} Lakh`);
  if (thousand) chunks.push(`${underThousand(thousand)} Thousand`);
  if (remainder) chunks.push(underThousand(remainder));
  const takaWords = chunks.length ? chunks.join(' ') : 'Zero';
  if (paisa === 0) return `Taka ${takaWords} Only`;
  return `Taka ${takaWords} and ${underThousand(paisa)} Paisa Only`;
}
