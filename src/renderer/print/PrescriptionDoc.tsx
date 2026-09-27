import type { JSX } from 'react';
import { DocHeader, PatientStrip, DocFooter, DoctorSignature, Scripted, AgeText, FormattedDate } from './common';
import type { ClinicIdentity } from './common';
import type { DisplayPrefs } from '../lib/format';

export interface PrescriptionItem {
  id: number;
  name: string;
  form: string;
  strength: string;
  dose: string;
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
  before_food: number;
  duration: string;
  quantity: string;
  instructions: string;
  prn: number;
  extra_instruction: string;
}

export interface PrescriptionModel {
  prescription: {
    id: number;
    prescription_no: string;
    issue_date: string;
    cc: string;
    oe: string;
    diagnosis: string;
    advice: string;
    next_visit: string | null;
    dentist_name: string | null;
    dentist_title: string | null;
    designations: string | null;
    qualifications: string | null;
    registration_no: string | null;
    consultation_hours: string | null;
    degree_prefix: string | null;
    signature_attachment_id: number | null;
    patient_name: string;
    patient_code: string;
    gender: string;
    age_years: number | null;
    age_months: number | null;
    date_of_birth: string | null;
    phone: string | null;
    address: string | null;
    area: string | null;
    district: string | null;
    blood_group: string | null;
    allergies: string | null;
  };
  items: PrescriptionItem[];
  footerMessage: string;
  clinic: ClinicIdentity;
  settings: { bengaliNumerals: boolean; dateFormat: DisplayPrefs['dateFormat']; timeFormat: DisplayPrefs['timeFormat'] };
  signatureDataUrl?: string | null;
  logoDataUrl?: string | null;
}

const TIMING_SLOTS: { key: 'morning' | 'afternoon' | 'evening' | 'night'; short: string; label: string }[] = [
  { key: 'morning', short: 'M', label: 'Morning' },
  { key: 'afternoon', short: 'A', label: 'Afternoon' },
  { key: 'evening', short: 'E', label: 'Evening' },
  { key: 'night', short: 'N', label: 'Night' },
];

export function PrescriptionDocument({ model, prefs, showClinicalFooter }: { model: PrescriptionModel; prefs: DisplayPrefs; showClinicalFooter: boolean }): JSX.Element {
  const rx = model.prescription;
  const sections: { label: string; body: string }[] = [
    { label: 'Chief Complaint', body: rx.cc ?? '' },
    { label: 'On Examination', body: rx.oe ?? '' },
    { label: 'Diagnosis', body: rx.diagnosis ?? '' },
    { label: 'Treatment Plan / Advice', body: rx.advice ?? '' },
  ].filter((section) => section.body.trim().length > 0);

  return (
    <>
      <DocHeader
        clinic={model.clinic}
        title="Prescription"
        number={rx.prescription_no}
        issuedAt={FormattedDate(rx.issue_date, prefs)}
        logo={model.logoDataUrl ?? null}
      />

      <PatientStrip
        entries={[
          { k: 'Patient', v: rx.patient_name, script: true },
          { k: 'Code', v: rx.patient_code },
          { k: 'Age', v: AgeText(rx, prefs) },
          { k: 'Gender', v: rx.gender ? rx.gender.charAt(0).toUpperCase() + rx.gender.slice(1) : '—' },
          { k: 'Phone', v: rx.phone || '—' },
          ...(rx.blood_group ? [{ k: 'Blood group', v: rx.blood_group }] : []),
          ...(rx.allergies?.trim() ? [{ k: 'Allergies', v: rx.allergies, script: true }] : []),
        ]}
      />

      {rx.allergies?.trim() ? (
        <p className="doc-note" style={{ marginTop: '-2mm', color: '#b42318', fontWeight: 600 }}>
          <span aria-hidden="true">⚠</span> Known allergy: <Scripted>{rx.allergies}</Scripted>
        </p>
      ) : null}

      <div className="doc-rx">
        <div className="doc-rx__clinical">
          {sections.length === 0 ? (
            <div className="doc-section">
              <div className="doc-section-label">Clinical Notes</div>
              <div className="doc-section-body">No clinical notes were recorded with this prescription.</div>
            </div>
          ) : (
            sections.map((section) => (
              <div className="doc-section" key={section.label}>
                <div className="doc-section-label">{section.label}</div>
                <div className="doc-section-body"><Scripted>{section.body}</Scripted></div>
              </div>
            ))
          )}
        </div>

        <div className="doc-rx__meds">
          <div className="doc-section-label" style={{ marginBottom: 2 }}>℞ Medicines</div>
          {model.items.length === 0 ? (
            <div className="doc-section-body">No medicines were prescribed.</div>
          ) : (
            <div className="doc-meds">
              {model.items.map((item, index) => (
                <div className="doc-med" key={item.id}>
                  <div className="doc-med__name">
                    <span className="doc-med__index">{index + 1}</span>
                    <Scripted>{item.name}</Scripted>
                    {item.strength ? <span style={{ fontWeight: 500 }}> — {item.strength}</span> : null}
                    {item.form ? <span style={{ fontWeight: 400, color: '#5a6b7a' }}> ({item.form})</span> : null}
                  </div>
                  {item.prn ? <div style={{ fontSize: '7.6pt', fontWeight: 700, color: '#a45c07' }}>PRN</div> : null}
                  <div className="doc-med__meta">
                    {item.dose ? <div><strong>Dose:</strong> <Scripted>{item.dose}</Scripted></div> : null}
                    <div className="doc-timing">
                      {TIMING_SLOTS.map((slot) => (
                        <span key={slot.key} className={item[slot.key] ? 'on' : ''} title={slot.label}>
                          {slot.label}
                          {item[slot.key] ? ' ●' : ' ○'}
                        </span>
                      ))}
                    </div>
                    <div className="doc-timing" style={{ marginTop: 0.8 }}>
                      <span className="on">{item.before_food ? 'Before food' : 'After food'}</span>
                      {item.duration ? <span><Scripted>{item.duration}</Scripted></span> : null}
                      {item.quantity ? <span>Qty: {item.quantity}</span> : null}
                    </div>
                    {item.instructions ? <div><strong>Note:</strong> <Scripted>{item.instructions}</Scripted></div> : null}
                    {item.extra_instruction ? <div><Scripted>{item.extra_instruction}</Scripted></div> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showClinicalFooter ? (
        <DocFooter
          message={model.footerMessage}
          scheduleNote={rx.next_visit ? `Next visit: ${FormattedDate(rx.next_visit, prefs)}` : null}
          signature={
            rx.dentist_name ? (
              <DoctorSignature
                name={rx.degree_prefix ? `${rx.degree_prefix} ${rx.dentist_name}` : rx.dentist_name}
                title={rx.dentist_title}
                qualifications={rx.qualifications}
                registration={rx.registration_no}
                signatureImage={model.signatureDataUrl ?? null}
              />
            ) : null
          }
        />
      ) : null}
    </>
  );
}
