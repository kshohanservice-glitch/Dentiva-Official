import type { JSX } from 'react';
import { DocHeader, PatientStrip, Scripted, FormattedDate, FormattedTime, AgeText, clinicAddressLine } from './common';
import type { ClinicIdentity } from './common';
import type { DisplayPrefs } from '../lib/format';

export interface AppointmentSlipModel {
  appointment: {
    id: number;
    appointment_date: string;
    start_time: string;
    end_time: string;
    status: string;
    type: string;
    notes: string;
    patient_name: string;
    patient_code: string;
    phone: string | null;
    gender: string;
    age_years: number | null;
    age_months: number | null;
    date_of_birth: string | null;
    dentist_name: string | null;
    dentist_title: string | null;
    designations: string | null;
  };
  clinic: ClinicIdentity;
  logoDataUrl?: string | null;
}

export function AppointmentSlipDocument({ model, prefs }: { model: AppointmentSlipModel; prefs: DisplayPrefs }): JSX.Element {
  const a = model.appointment;
  return (
    <>
      <DocHeader
        clinic={model.clinic}
        title="Appointment"
        issuedAt={FormattedDate(a.appointment_date, prefs)}
        logo={model.logoDataUrl ?? null}
      />

      <PatientStrip
        entries={[
          { k: 'Patient', v: a.patient_name, script: true },
          { k: 'Code', v: a.patient_code },
          { k: 'Age', v: AgeText(a, prefs) },
          { k: 'Phone', v: a.phone || '—' },
        ]}
      />

      <div className="doc-band">
        <div className="doc-band-item">
          <div className="doc-band-label">Date</div>
          <div className="doc-band-value">{FormattedDate(a.appointment_date, prefs)}</div>
        </div>
        <div className="doc-band-item">
          <div className="doc-band-label">Time</div>
          <div className="doc-band-value">
            {FormattedTime(a.start_time, prefs)}{a.end_time ? ` – ${FormattedTime(a.end_time, prefs)}` : ''}
          </div>
        </div>
        <div className="doc-band-item">
          <div className="doc-band-label">Dentist</div>
          <div className="doc-band-value" style={{ fontSize: '10pt' }}><Scripted>{a.dentist_name ?? 'Unassigned'}</Scripted></div>
        </div>
      </div>

      {a.notes ? (
        <div className="doc-section-block">
          <h3>Notes</h3>
          <div className="doc-section-body"><Scripted>{a.notes}</Scripted></div>
        </div>
      ) : null}

      <div className="doc-chip-list" style={{ marginTop: 4 }}>
        <span className="doc-chip">Status: {a.status}</span>
        {a.type ? <span className="doc-chip">Type: {a.type}</span> : null}
      </div>

      <footer className="doc-foot">
        <div className="doc-foot-message">
          <Scripted>
            Please arrive 10 minutes early. Bring this slip with you. For rescheduling, call{' '}
            {clinicAddressLine(model.clinic) ? model.clinic.phone : model.clinic.phone}.
          </Scripted>
        </div>
        <div className="doc-signature">
          <div className="doc-signature__line" style={{ marginTop: 12 }}>
            <div className="doc-signature__title">Appointment confirmed</div>
            <div className="doc-signature__reg">Signature of patient / attendant</div>
          </div>
        </div>
      </footer>
    </>
  );
}
