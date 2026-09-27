import type { JSX } from 'react';
import { DocHeader, PatientStrip, Scripted, AgeText, FormattedDate, FormattedMoney, DoctorSignature } from './common';
import type { ClinicIdentity } from './common';
import { TOOTH_CONDITIONS } from '../../shared/constants';
import type { DisplayPrefs } from '../lib/format';

export interface PatientSummaryModel {
  patient: {
    id: number;
    patient_code: string;
    full_name: string;
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
    medical_history: string | null;
    dental_history: string | null;
    present_complaint: string | null;
  };
  visits: {
    id: number; visit_date: string; chief_complaint: string; diagnosis: string; treatment_plan: string;
    procedure_done: string; advice: string; status: string; dentist_name: string | null;
  }[];
  prescriptions: { id: number; prescription_no: string; issue_date: string; cc: string; dentist_name: string | null; item_count: number }[];
  treatments: { id: number; tooth_code: string | null; description: string; status: string; performed_at: string; dentist_name: string | null }[];
  chart: { patient_id: number; dentition: string; tooth_code: string; condition: string; surface: string; severity: string; note: string; recorded_at: string }[];
  financial: { totalBilledPoisha: number; totalPaidPoisha: number; outstandingPoisha: number } | null;
  clinic: ClinicIdentity;
  logoDataUrl?: string | null;
}

const CONDITION_LABEL: Record<string, string> = Object.fromEntries(TOOTH_CONDITIONS.map((c) => [c.id, c.label]));

export function PatientSummaryDocument({ model, prefs }: { model: PatientSummaryModel; prefs: DisplayPrefs }): JSX.Element {
  const p = model.patient;
  const financial = model.financial ?? { totalBilledPoisha: 0, totalPaidPoisha: 0, outstandingPoisha: 0 };
  const chartByDentition = new Map<string, typeof model.chart>();
  for (const entry of model.chart) {
    const list = chartByDentition.get(entry.dentition) ?? [];
    list.push(entry);
    chartByDentition.set(entry.dentition, list);
  }

  return (
    <>
      <DocHeader
        clinic={model.clinic}
        title="Patient Summary"
        number={p.patient_code}
        issuedAt={FormattedDate(new Date().toISOString(), prefs)}
        logo={model.logoDataUrl ?? null}
      />

      <PatientStrip
        entries={[
          { k: 'Name', v: p.full_name, script: true },
          { k: 'Code', v: p.patient_code },
          { k: 'Age', v: AgeText(p, prefs) },
          { k: 'Gender', v: p.gender ? p.gender.charAt(0).toUpperCase() + p.gender.slice(1) : '—' },
          { k: 'Phone', v: p.phone || '—' },
          { k: 'Address', v: [p.address, p.area, p.district].filter(Boolean).join(', ') || '—', script: true },
        ]}
      />

      {p.allergies?.trim() || p.medical_history?.trim() ? (
        <div className="doc-section-block" style={{ marginTop: 2 }}>
          <h3>Medical Alerts</h3>
          {p.allergies?.trim() ? <p className="doc-note" style={{ color: '#b42318' }}>Allergy: <Scripted>{p.allergies}</Scripted></p> : null}
          {p.medical_history?.trim() ? <p className="doc-note"><Scripted>{p.medical_history}</Scripted></p> : null}
        </div>
      ) : null}

      <div className="doc-band">
        <div className="doc-band-item">
          <div className="doc-band-label">Total billed</div>
          <div className="doc-band-value">{FormattedMoney(financial.totalBilledPoisha, prefs)}</div>
        </div>
        <div className="doc-band-item">
          <div className="doc-band-label">Total paid</div>
          <div className="doc-band-value" style={{ color: '#067a56' }}>{FormattedMoney(financial.totalPaidPoisha, prefs)}</div>
        </div>
        <div className="doc-band-item">
          <div className="doc-band-label">Outstanding</div>
          <div className="doc-band-value" style={{ color: financial.outstandingPoisha > 0 ? '#b42318' : '#067a56' }}>
            {FormattedMoney(financial.outstandingPoisha, prefs)}
          </div>
        </div>
      </div>

      {model.chart.length > 0 ? (
        <div className="doc-section-block">
          <h3>Dental chart (current)</h3>
          <div className="doc-chart">
            {[...chartByDentition.entries()].map(([dentition, entries]) => (
              <div key={dentition}>
                <div className="doc-band-label" style={{ marginBottom: 0.8 }}>{dentition === 'adult' ? 'Adult (permanent)' : 'Primary'}</div>
                <div className="doc-chart-row" style={{ flexWrap: 'wrap' }}>
                  {entries.map((entry) => (
                    <div
                      className="doc-chart-tooth"
                      data-filled={entry.condition !== 'healthy'}
                      key={`${entry.tooth_code}-${entry.surface}`}
                      title={`${entry.tooth_code} · ${CONDITION_LABEL[entry.condition] ?? entry.condition}${entry.surface ? ` (${entry.surface})` : ''}${entry.note ? ` — ${entry.note}` : ''}`}
                    >
                      {entry.tooth_code}
                      {entry.surface && entry.surface !== 'full' ? <span style={{ fontSize: '5pt' }}>{entry.surface.charAt(0).toUpperCase()}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {model.visits.length > 0 ? (
        <div className="doc-section-block">
          <h3>Visit history</h3>
          <table className="doc-table">
            <thead>
              <tr>
                <th style={{ width: '18%' }}>Date</th>
                <th style={{ width: '22%' }}>Dentist</th>
                <th>Complaint &amp; diagnosis</th>
              </tr>
            </thead>
            <tbody>
              {model.visits.map((visit) => (
                <tr key={visit.id}>
                  <td>{FormattedDate(visit.visit_date, prefs)}</td>
                  <td><Scripted>{visit.dentist_name ?? '—'}</Scripted></td>
                  <td>
                    {visit.chief_complaint ? <div><Scripted>{visit.chief_complaint}</Scripted></div> : null}
                    {visit.diagnosis ? <div style={{ color: '#0a8076' }}><Scripted>{visit.diagnosis}</Scripted></div> : null}
                    {visit.procedure_done ? <div style={{ color: '#4a5b6a' }}><Scripted>{visit.procedure_done}</Scripted></div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {model.treatments.length > 0 ? (
        <div className="doc-section-block">
          <h3>Treatment records</h3>
          <table className="doc-table">
            <thead>
              <tr>
                <th style={{ width: '18%' }}>Date</th>
                <th style={{ width: '12%' }}>Tooth</th>
                <th style={{ width: '22%' }}>Dentist</th>
                <th>Treatment</th>
                <th style={{ width: '14%' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {model.treatments.map((treatment) => (
                <tr key={treatment.id}>
                  <td>{FormattedDate(treatment.performed_at, prefs)}</td>
                  <td>{treatment.tooth_code ?? '—'}</td>
                  <td><Scripted>{treatment.dentist_name ?? '—'}</Scripted></td>
                  <td><Scripted>{treatment.description}</Scripted></td>
                  <td style={{ textTransform: 'capitalize' }}>{treatment.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {model.prescriptions.length > 0 ? (
        <div className="doc-section-block">
          <h3>Prescriptions</h3>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Number</th>
                <th style={{ width: '18%' }}>Date</th>
                <th style={{ width: '26%' }}>Dentist</th>
                <th style={{ width: '26%' }}>Complaint</th>
                <th className="num" style={{ width: '12%' }}>Items</th>
              </tr>
            </thead>
            <tbody>
              {model.prescriptions.map((rx) => (
                <tr key={rx.id}>
                  <td>{rx.prescription_no}</td>
                  <td>{FormattedDate(rx.issue_date, prefs)}</td>
                  <td><Scripted>{rx.dentist_name ?? '—'}</Scripted></td>
                  <td><Scripted>{rx.cc || '—'}</Scripted></td>
                  <td className="num">{rx.item_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <footer className="doc-foot">
        <div className="doc-foot-message">
          {p.dental_history?.trim() ? <Scripted>{p.dental_history}</Scripted> : model.clinic.footer_message ? <Scripted>{model.clinic.footer_message}</Scripted> : null}
        </div>
        <DoctorSignature name="Treating dentist" title="Verified by" />
      </footer>
    </>
  );
}
