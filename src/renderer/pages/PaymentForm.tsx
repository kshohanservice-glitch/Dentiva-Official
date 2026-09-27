import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { call, ApiError } from '../lib/api';
import { Button, Callout, Checkbox, Field, Modal, Select, TextArea, TextInput, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { date, money, poishaToInput, todayKey } from '../lib/format';
import { takaInputToPoisha } from '../../core/money/money';
import { PAYMENT_METHOD_CODES, PAYMENT_METHOD_LABELS } from '../../shared/constants';
import { PatientPicker } from './PatientPicker';

interface OutstandingRow {
  id: number;
  invoice_no: string;
  issue_date: string;
  grand_total_poisha: number;
  paid_poisha: number;
  balance_poisha: number;
}

interface AllocationDraft {
  invoiceId: number;
  invoiceNo: string;
  issueDate: string;
  balancePoisha: number;
  amountPoisha: number;
  selected: boolean;
}

export function PaymentForm({
  open, onClose, onSaved, patientId, patientLabel, presetAllocations,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  patientId?: number;
  patientLabel?: string;
  presetAllocations?: { invoiceId: number; amountPoisha: number }[];
}): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [selectedPatient, setSelectedPatient] = useState<number | null>(patientId ?? null);
  const [label, setLabel] = useState(patientLabel ?? '');
  const [method, setMethod] = useState<string>('cash');
  const [paymentDate, setPaymentDate] = useState(todayKey());
  const [amountInput, setAmountInput] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState<'receipt' | 'refund'>('receipt');
  const [rows, setRows] = useState<AllocationDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState('');
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const amountPoisha = amountInput.trim() === '' ? null : takaInputToPoisha(amountInput);
  const allocatedTotal = rows.filter((r) => r.selected).reduce((sum, r) => sum + r.amountPoisha, 0);
  const unallocated = amountPoisha === null ? 0 : (type === 'refund' ? amountPoisha - allocatedTotal : amountPoisha - allocatedTotal);

  const loadOutstanding = async (id: number) => {
    setLoadingInvoices(true);
    try {
      const list = await call<OutstandingRow[]>('payments.outstandingFor', { patientId: id });
      setRows(
        list.map((row) => ({
          invoiceId: row.id,
          invoiceNo: row.invoice_no,
          issueDate: row.issue_date,
          balancePoisha: Number(row.balance_poisha),
          amountPoisha: Number(row.balance_poisha),
          selected: false,
        })),
      );
    } catch {
      setRows([]);
    } finally {
      setLoadingInvoices(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelectedPatient(patientId ?? null);
    setLabel(patientLabel ?? '');
    setMethod('cash');
    setPaymentDate(todayKey());
    setAmountInput('');
    setReference('');
    setNotes('');
    setType('receipt');
    setTopError('');
    setRows([]);
    if (patientId) void loadOutstanding(patientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId, patientLabel]);

  useEffect(() => {
    if (!open || !presetAllocations?.length) return;
    setRows((current) => {
      const next = current.map((row) => {
        const preset = presetAllocations.find((p) => p.invoiceId === row.invoiceId);
        return preset ? { ...row, amountPoisha: preset.amountPoisha, selected: true } : row;
      });
      return next;
    });
  }, [open, presetAllocations]);

  // Preset allocations can arrive before the outstanding list; apply once loaded.
  useEffect(() => {
    if (!open || !selectedPatient || !presetAllocations?.length) return;
    setRows((current) => {
      if (!current.length) return current;
      let changed = false;
      const next = current.map((row) => {
        const preset = presetAllocations.find((p) => p.invoiceId === row.invoiceId);
        if (preset && !row.selected) {
          changed = true;
          return { ...row, amountPoisha: preset.amountPoisha, selected: true };
        }
        return row;
      });
      return changed ? next : current;
    });
  }, [open, selectedPatient, presetAllocations]);

  const onPatientChange = (id: number | null, nextLabel: string) => {
    setSelectedPatient(id);
    setLabel(nextLabel);
    setRows([]);
    if (id) void loadOutstanding(id);
  };

  const applyFullAmount = () => {
    if (amountPoisha === null) return;
    let remaining = amountPoisha;
    setRows((current) =>
      current.map((row) => {
        if (remaining <= 0) return { ...row, selected: false, amountPoisha: 0 };
        const take = Math.min(row.balancePoisha, remaining);
        remaining -= take;
        return { ...row, selected: true, amountPoisha: take };
      }),
    );
  };

  const submit = async () => {
    if (!selectedPatient) {
      setTopError('Select a patient.');
      return;
    }
    if (amountPoisha === null || amountPoisha <= 0) {
      setTopError('Enter the amount received.');
      return;
    }
    const selected = rows.filter((r) => r.selected);
    if (type === 'refund' && selected.length === 0) {
      setTopError('A refund must be applied to an invoice.');
      return;
    }
    setBusy(true);
    setTopError('');
    try {
      const created = await call<{ id: number; payment_no: string }>('payments.create', {
        patientId: selectedPatient,
        amountPoisha,
        method,
        paymentDate,
        reference: reference.trim(),
        notes: notes.trim(),
        type,
        allocations: selected.map((r) => ({ invoiceId: r.invoiceId, amountPoisha: r.amountPoisha })),
      });
      toast.success(type === 'refund' ? 'Refund recorded' : 'Payment recorded', `${created.payment_no} · ${money(amountPoisha, app.prefs)}`);
      onSaved();
    } catch (caught) {
      setTopError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'The payment could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const methodOptions = useMemo(
    () => PAYMENT_METHOD_CODES.map((code) => ({ value: code, label: PAYMENT_METHOD_LABELS[code] })),
    [],
  );

  return (
    <Modal
      open={open}
      title={type === 'refund' ? 'Record a refund' : 'Record a payment'}
      subtitle="Every taka must be allocated to an invoice so the ledger always balances"
      onClose={onClose}
      width={720}
      closeOnBackdrop={false}
      footer={
        <>
          <span className="text-sm text-3">
            Allocated <strong className="mono">{money(allocatedTotal, app.prefs)}</strong>
            {amountPoisha !== null && unallocated !== 0 ? (
              <span className={unallocated > 0 ? ' text-warn' : ' text-danger'}>
                {' '}· {unallocated > 0 ? 'unallocated' : 'over-allocated'} {money(Math.abs(unallocated), app.prefs)}
              </span>
            ) : null}
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>Record</Button>
        </>
      }
    >
      <div className="stack stack-3">
        {topError ? <Callout tone="danger">{topError}</Callout> : null}

        {!patientId ? (
          <Field label="Patient" required>
            <PatientPicker value={selectedPatient} label={label} onChange={onPatientChange} />
          </Field>
        ) : null}

        <div className="grid grid-3">
          <Field label="Type" required>
            <Select
              value={type}
              onChange={(event) => setType(event.target.value as 'receipt' | 'refund')}
              options={[
                { value: 'receipt', label: 'Payment received' },
                { value: 'refund', label: 'Refund given' },
              ]}
            />
          </Field>
          <Field label="Amount (৳)" required>
            <input
              className="input mono"
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="0.00"
              aria-label="Amount in taka"
            />
          </Field>
          <Field label="Method" required>
            <Select value={method} onChange={(event) => setMethod(event.target.value)} options={methodOptions} />
          </Field>
        </div>

        <div className="grid grid-3">
          <Field label="Date" required>
            <input className="input" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </Field>
          <TextInput
            label="Reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder={method === 'bkash' ? 'bKash TrxID' : method === 'bank' ? 'Cheque / transaction no.' : 'Optional'}
          />
          <Field label="">
            <Button icon="check" onClick={applyFullAmount} disabled={amountPoisha === null || rows.length === 0}>
              Allocate to oldest first
            </Button>
          </Field>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Apply to invoices</h2>
              <div className="card-subtitle">
                {loadingInvoices ? 'Loading outstanding invoices…' : `${rows.length} outstanding invoice(s)`}
              </div>
            </div>
          </div>
          <div className="card-body--flush">
            {rows.length === 0 && !loadingInvoices ? (
              <div className="state state--compact">
                <div className="state-title">No outstanding invoices</div>
                <div className="state-text">
                  {selectedPatient
                    ? 'This patient has nothing to pay. The service will reject a receipt that is not allocated.'
                    : 'Select a patient to see their outstanding invoices.'}
                </div>
              </div>
            ) : (
              <ul className="alloc-list">
                {rows.map((row) => (
                  <li className="alloc-row" key={row.invoiceId} data-selected={row.selected}>
                    <Checkbox
                      label=""
                      checked={row.selected}
                      onChange={(event) => {
                        setRows((current) =>
                          current.map((r) =>
                            r.invoiceId === row.invoiceId
                              ? {
                                  ...r,
                                  selected: event.target.checked,
                                  amountPoisha: event.target.checked ? Math.max(0, Number(r.balancePoisha)) : 0,
                                }
                              : r,
                          ),
                        );
                      }}
                    />
                    <div className="grow stack stack-0" style={{ minWidth: 0 }}>
                      <strong className="mono text-sm">{row.invoiceNo}</strong>
                      <span className="text-xs text-3">{date(row.issueDate, app.prefs)} · due {money(row.balancePoisha, app.prefs)}</span>
                    </div>
                    {row.selected ? (
                      <input
                        className="input input--sm mono num"
                        style={{ width: 118 }}
                        inputMode="decimal"
                        value={poishaToInput(row.amountPoisha)}
                        onChange={(event) => {
                          const poisha = takaInputToPoisha(event.target.value);
                          if (poisha === null) return;
                          setRows((current) =>
                            current.map((r) => (r.invoiceId === row.invoiceId ? { ...r, amountPoisha: poisha } : r)),
                          );
                        }}
                        aria-label={`Amount applied to ${row.invoiceNo}`}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <TextArea label="Notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />

        {type === 'refund' ? (
          <Callout tone="warn" title="Refunds are permanent">
            A refund reverses money already collected. It is recorded as a negative receipt so the ledger stays
            consistent, and it cannot be deleted — only reversed again with a reason.
          </Callout>
        ) : null}

        <p className="text-xs text-3 row row-1" style={{ gap: 6 }}>
          <Icon name="shield" size={13} /> Overpayment is blocked at the service layer unless an administrator enables
          advances in Financial settings.
        </p>
      </div>
    </Modal>
  );
}
