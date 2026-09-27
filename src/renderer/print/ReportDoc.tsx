import type { JSX } from 'react';
import { DocHeader, Scripted, FormattedDate, FormattedMoney, FormattedTime } from './common';
import type { ClinicIdentity } from './common';
import type { DisplayPrefs } from '../lib/format';

export interface ReportModel {
  kind: string;
  from: string;
  to: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, unknown>[];
  totals: { label: string; valuePoisha: number }[];
  clinic: ClinicIdentity;
  generatedAt: string;
  title: string;
  logoDataUrl?: string | null;
}

function cellValue(row: Record<string, unknown>, key: string, column: { numeric?: boolean }): string {
  const raw = row[key];
  if (raw === null || raw === undefined || raw === '') return '—';
  if (column.numeric) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n.toLocaleString('en-US');
    return String(raw);
  }
  return String(raw);
}

export function ReportDocument({ model, prefs }: { model: ReportModel; prefs: DisplayPrefs }): JSX.Element {
  return (
    <>
      <DocHeader
        clinic={model.clinic}
        title={model.title}
        issuedAt={`${FormattedDate(model.from, prefs)} – ${FormattedDate(model.to, prefs)}`}
        logo={model.logoDataUrl ?? null}
      />

      <div className="doc-band">
        <div className="doc-band-item">
          <div className="doc-band-label">Period</div>
          <div className="doc-band-value" style={{ fontSize: '9.5pt' }}>
            {FormattedDate(model.from, prefs)} – {FormattedDate(model.to, prefs)}
          </div>
        </div>
        <div className="doc-band-item">
          <div className="doc-band-label">Records</div>
          <div className="doc-band-value">{model.rows.length}</div>
        </div>
        {model.totals.map((total) => (
          <div className="doc-band-item" key={total.label}>
            <div className="doc-band-label">{total.label}</div>
            <div className="doc-band-value">{FormattedMoney(total.valuePoisha, prefs)}</div>
          </div>
        ))}
      </div>

      {model.rows.length === 0 ? (
        <p className="doc-note">No records were found for this period.</p>
      ) : (
        <table className="doc-table">
          <thead>
            <tr>
              <th style={{ width: '5%' }}>#</th>
              {model.columns.map((column) => (
                <th key={column.key} className={column.numeric ? 'num' : undefined}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                {model.columns.map((column) => (
                  <td key={column.key} className={column.numeric ? 'num' : undefined}>
                    <Scripted>{cellValue(row, column.key, column)}</Scripted>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="doc-foot">
        <div className="doc-foot-message">
          Generated {FormattedTime(model.generatedAt, prefs)} · {model.rows.length} record(s) · Dentiva Pro
        </div>
        <div className="doc-signature">
          <div className="doc-signature__line" style={{ marginTop: 12 }}>
            <div className="doc-signature__title">Prepared by</div>
            <div className="doc-signature__reg">Authorised signature</div>
          </div>
        </div>
      </footer>
    </>
  );
}
