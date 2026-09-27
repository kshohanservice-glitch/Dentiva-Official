import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { call, ApiError } from '../lib/api';
import { Button, Callout, Checkbox, Field, IconButton, Modal, TextArea, useDebounced, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { money, poishaToInput, quantityLabel, todayKey } from '../lib/format';
import { PatientPicker } from './PatientPicker';
import { takaInputToPoisha } from '../../core/money/money';

interface TreatmentRow {
  id: number;
  code: string;
  name: string;
  category_id: number | null;
  category_name: string | null;
  description: string;
  default_price_poisha: number;
  duration_minutes: number;
  is_active: number;
}

interface LineDraft {
  key: string;
  treatmentId: number | null;
  description: string;
  toothCode: string;
  qtyMilli: number;
  unitPricePoisha: number;
  discountPoisha: number;
}

const newLine = (): LineDraft => ({
  key: Math.random().toString(36).slice(2),
  treatmentId: null,
  description: '',
  toothCode: '',
  qtyMilli: 1000,
  unitPricePoisha: 0,
  discountPoisha: 0,
});

export function InvoiceForm({
  open, onClose, onSaved, patientId, visitId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  patientId?: number;
  visitId?: number;
}): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [selectedPatient, setSelectedPatient] = useState<number | null>(patientId ?? null);
  const [patientLabel, setPatientLabel] = useState('');
  const [issueDate, setIssueDate] = useState(todayKey());
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [discountPercent, setDiscountPercent] = useState('0');
  const [taxPercent, setTaxPercent] = useState('0');
  const [notes, setNotes] = useState('');
  const [treatments, setTreatments] = useState<TreatmentRow[]>([]);
  const [search, setSearch] = useState('');
  const [pickerLine, setPickerLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [applyToLines, setApplyToLines] = useState(false);
  const debounced = useDebounced(search, 200);

  useEffect(() => {
    if (!open) return;
    setSelectedPatient(patientId ?? null);
    setPatientLabel(patientId ? '' : '');
    setIssueDate(todayKey());
    setDueDate('');
    setLines([newLine()]);
    setDiscountPercent('0');
    setTaxPercent('0');
    setNotes('');
    setTopError('');
    setErrors({});
    setApplyToLines(false);
    setSearch('');
    setPickerLine(null);
  }, [open, patientId]);

  useEffect(() => {
    if (!open) return;
    void call<{ rows: TreatmentRow[] }>('treatments.list', { search: debounced.trim() || undefined, pageSize: 30 })
      .then((result) => setTreatments(result.rows))
      .catch(() => setTreatments([]));
  }, [debounced, open]);

  useEffect(() => {
    if (!pickerLine) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.line-picker')) return;
      setPickerLine(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerLine(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerLine]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + line.qtyMilli * line.unitPricePoisha, 0) / 1000;
    const lineDiscount = lines.reduce((sum, line) => sum + line.discountPoisha, 0);
    const subtotalPoisha = Math.round(subtotal);
    const percentBp = Math.round((Number(discountPercent) || 0) * 100);
    const percentDiscount = Math.round((subtotalPoisha * percentBp) / 10000);
    const discountTotal = applyToLines ? lineDiscount : percentDiscount;
    const afterDiscount = subtotalPoisha - discountTotal;
    const taxBp = Math.round((Number(taxPercent) || 0) * 100);
    const taxPoisha = Math.round((afterDiscount * taxBp) / 10000);
    return { subtotalPoisha, discountTotal, taxPoisha, grandTotalPoisha: afterDiscount + taxPoisha };
  }, [lines, discountPercent, taxPercent, applyToLines]);

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const pickTreatment = (key: string, treatment: TreatmentRow) => {
    updateLine(key, {
      treatmentId: treatment.id,
      description: treatment.name,
      unitPricePoisha: Number(treatment.default_price_poisha) || 0,
    });
    setSearch('');
    setPickerLine(null);
  };

  const clearTreatment = (key: string) => {
    updateLine(key, { treatmentId: null });
  };

  const submit = async () => {
    if (!selectedPatient) {
      setErrors({ patientId: 'Select a patient.' });
      return;
    }
    const validLines = lines.filter((line) => line.description.trim() && line.unitPricePoisha > 0);
    if (validLines.length === 0) {
      setTopError('Add at least one line with a description and a price.');
      return;
    }
    setBusy(true);
    setTopError('');
    try {
      const created = await call<{ id: number; invoice_no: string; grand_total_poisha: number }>('invoices.create', {
        patientId: selectedPatient,
        visitId,
        issueDate,
        dueDate: dueDate || undefined,
        discountPercentBp: applyToLines ? 0 : Math.round((Number(discountPercent) || 0) * 100),
        taxPercentBp: Math.round((Number(taxPercent) || 0) * 100),
        notes: notes.trim(),
        items: validLines.map((line) => ({
          treatmentId: line.treatmentId ?? undefined,
          description: line.description.trim(),
          toothCode: line.toothCode.trim() || undefined,
          qtyMilli: line.qtyMilli,
          unitPricePoisha: line.unitPricePoisha,
          discountPoisha: applyToLines ? line.discountPoisha : 0,
        })),
      });
      toast.success('Invoice created', `${created.invoice_no} · ${money(created.grand_total_poisha, app.prefs)}`);
      onSaved(created.id);
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        setTopError(caught.message);
      } else {
        setTopError(caught instanceof Error ? caught.message : 'The invoice could not be created.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="New invoice"
      subtitle="Amounts are stored in poisha — no floating-point money anywhere"
      onClose={onClose}
      width={980}
      closeOnBackdrop={false}
      footer={
        <>
          <span className="text-sm">
            Total <strong className="mono">{money(totals.grandTotalPoisha, app.prefs)}</strong>
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>Create invoice</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {topError ? <Callout tone="danger">{topError}</Callout> : null}

        <div className="grid grid-3">
          <Field label="Patient" required error={errors.patientId}>
            <PatientPicker
              value={selectedPatient}
              label={patientLabel}
              onChange={(id, label) => {
                setSelectedPatient(id);
                setPatientLabel(label);
              }}
            />
          </Field>
          <Field label="Invoice date" required error={errors.issueDate}>
            <input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Due date" error={errors.dueDate} hint="Optional">
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Line items</h2>
              <div className="card-subtitle">Pick from the treatment catalogue or type a custom line</div>
            </div>
            <Button size="sm" icon="plus" onClick={() => setLines((c) => [...c, newLine()])}>Add line</Button>
          </div>
          <div className="card-body--flush">
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th style={{ minWidth: 240 }}>Description</th>
                    <th style={{ width: 78 }}>Tooth</th>
                    <th style={{ width: 96 }} className="num">Qty</th>
                    <th style={{ width: 132 }} className="num">Rate (৳)</th>
                    <th style={{ width: 132 }} className="num">Amount</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const amount = Math.round((line.qtyMilli * line.unitPricePoisha) / 1000);
                    const active = pickerLine === line.key;
                    const linked = line.treatmentId
                      ? treatments.find((t) => t.id === line.treatmentId) ?? null
                      : null;
                    const suggestions = treatments.filter((t) =>
                      `${t.name} ${t.code} ${t.category_name ?? ''}`
                        .toLowerCase()
                        .includes(search.trim().toLowerCase()),
                    );
                    return (
                      <tr key={line.key} className="line-picker">
                        <td>
                          <input
                            className="input input--sm"
                            value={line.description}
                            onFocus={() => setPickerLine(line.key)}
                            onChange={(e) => {
                              updateLine(line.key, { description: e.target.value });
                              setSearch(e.target.value);
                              setPickerLine(line.key);
                            }}
                            placeholder="Treatment or service"
                            aria-label="Line description"
                            aria-expanded={active}
                            role="combobox"
                            autoComplete="off"
                          />
                          {active ? (
                            <div className="picker-panel picker-panel--inline">
                              {suggestions.length > 0 ? (
                                <ul className="picker-list">
                                  {suggestions.map((treatment) => (
                                    <li key={treatment.id}>
                                      <button
                                        type="button"
                                        className="picker-item"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => pickTreatment(line.key, treatment)}
                                      >
                                        <span className="picker-item-main">
                                          <span className="truncate">
                                            {treatment.name}{' '}
                                            <span className="mono text-xs text-3">{treatment.code}</span>
                                          </span>
                                          <span className="text-xs text-3">
                                            {treatment.category_name ?? 'Uncategorised'} ·{' '}
                                            {money(treatment.default_price_poisha, app.prefs)}
                                          </span>
                                        </span>
                                        <Icon name="check" size={14} className="text-3" />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="picker-empty">
                                  No catalogue match — the line will be saved as a custom charge.
                                </div>
                              )}
                            </div>
                          ) : null}
                          {linked ? (
                            <div className="line-picker__linked">
                              <Icon name="check" size={12} />
                              <span className="truncate">
                                Linked to catalogue item {linked.code} — rate was applied automatically
                              </span>
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => clearTreatment(line.key)}
                              >
                                Unlink
                              </button>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <input
                            className="input input--sm"
                            value={line.toothCode}
                            onChange={(e) => updateLine(line.key, { toothCode: e.target.value })}
                            placeholder="—"
                            aria-label="Tooth code"
                            maxLength={3}
                          />
                        </td>
                        <td>
                          <input
                            className="input input--sm num"
                            type="number"
                            min={0}
                            step="0.25"
                            value={quantityLabel(line.qtyMilli)}
                            onChange={(e) => updateLine(line.key, { qtyMilli: Math.max(0, Math.round(Number(e.target.value || 0) * 1000)) })}
                            aria-label="Quantity"
                          />
                        </td>
                        <td>
                          <input
                            className="input input--sm num"
                            inputMode="decimal"
                            value={poishaToInput(line.unitPricePoisha)}
                            onChange={(e) => {
                              const poisha = takaInputToPoisha(e.target.value);
                              if (poisha !== null) updateLine(line.key, { unitPricePoisha: poisha });
                            }}
                            placeholder="0.00"
                            aria-label="Unit price"
                          />
                        </td>
                        <td className="num mono">{money(amount, app.prefs)}</td>
                        <td>
                          {lines.length > 1 ? (
                            <IconButton
                              icon="trash"
                              label="Remove line"
                              size={15}
                              onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="stack stack-2">
            <Checkbox
              label="Apply discount per line instead of the whole invoice"
              checked={applyToLines}
              onChange={(event) => setApplyToLines(event.target.checked)}
            />
            {!applyToLines ? (
              <Field label="Invoice discount (%)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                />
              </Field>
            ) : null}
            <Field label="Tax (%)" hint="Leave at 0 unless you are registered for VAT.">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
              />
            </Field>
            <TextArea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} />
          </div>

          <div className="totals-box">
            <div className="totals-row">
              <span>Subtotal</span>
              <span className="mono">{money(totals.subtotalPoisha, app.prefs)}</span>
            </div>
            {totals.discountTotal > 0 ? (
              <div className="totals-row">
                <span>Discount</span>
                <span className="mono text-ok">−{money(totals.discountTotal, app.prefs)}</span>
              </div>
            ) : null}
            {totals.taxPoisha > 0 ? (
              <div className="totals-row">
                <span>Tax</span>
                <span className="mono">{money(totals.taxPoisha, app.prefs)}</span>
              </div>
            ) : null}
            <div className="totals-row totals-row--grand">
              <span>Grand total</span>
              <span className="mono">{money(totals.grandTotalPoisha, app.prefs)}</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
