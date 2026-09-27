import { useEffect, useRef, useState, type JSX } from 'react';
import { call, ApiError } from '../lib/api';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import {
  Button, Callout, Checkbox, Field, Modal, Select, TextArea, TextInput, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { BLOOD_GROUP_OPTIONS, GENDER_OPTIONS } from '../../shared/constants';
import { date, time } from '../lib/format';
import { useDraft } from '../lib/drafts';
import type { PatientFormProps } from './Patients';

interface DuplicateRow {
  id: number;
  patient_code: string;
  full_name: string;
  phone: string;
  created_at: string;
}

const EMPTY = {
  fullName: '',
  phone: '',
  altPhone: '',
  emergencyName: '',
  emergencyPhone: '',
  dateOfBirth: '',
  ageYears: '',
  ageMonths: '',
  gender: '',
  bloodGroup: '',
  address: '',
  area: '',
  district: '',
  thana: '',
  postcode: '',
  presentComplaint: '',
  medicalHistory: '',
  dentalHistory: '',
  allergies: '',
  notes: '',
};

export function PatientForm({ open, patient, onClose, onSaved }: PatientFormProps): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const toast = useToast();
  const editing = Boolean(patient);
  // A new patient's details are the hardest thing in the practice to make a
  // patient repeat, so they are kept if the machine locks mid-entry. An edit
  // is never discarded, because the original record is still there.
  const draft = useDraft('patient-form', EMPTY);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [recovered, setRecovered] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateRow[]>([]);
  const [ackDuplicate, setAckDuplicate] = useState(false);
  const [tab, setTab] = useState<'basics' | 'contact' | 'clinical'>('basics');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setTopError('');
    setDuplicates([]);
    setAckDuplicate(false);
    setTab('basics');
    if (patient) {
      void call<{ patient: Record<string, unknown> }>('patients.get', { id: patient.id }).then((result) => {
        const p = result.patient as Record<string, unknown>;
        setForm({
          fullName: String(p.full_name ?? ''),
          phone: String(p.phone ?? ''),
          altPhone: String(p.alt_phone ?? ''),
          emergencyName: String(p.emergency_name ?? ''),
          emergencyPhone: String(p.emergency_phone ?? ''),
          dateOfBirth: String(p.date_of_birth ?? ''),
          ageYears: p.age_years === null || p.age_years === undefined ? '' : String(p.age_years),
          ageMonths: p.age_months === null || p.age_months === undefined ? '' : String(p.age_months),
          gender: String(p.gender ?? ''),
          bloodGroup: String(p.blood_group ?? ''),
          address: String(p.address ?? ''),
          area: String(p.area ?? ''),
          district: String(p.district ?? ''),
          thana: String(p.thana ?? ''),
          postcode: String(p.postcode ?? ''),
          presentComplaint: String(p.present_complaint ?? ''),
          medicalHistory: String(p.medical_history ?? ''),
          dentalHistory: String(p.dental_history ?? ''),
          allergies: String(p.allergies ?? ''),
          notes: String(p.notes ?? ''),
        });
      });
    } else {
      setForm(EMPTY);
    }
    setRecovered(null);
  }, [open, patient]);

  // Adopt a recovered draft once, and only for a brand new patient. A draft
  // from a previous session must never overwrite a freshly opened form.
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (!open || editing) return;
    if (!draft.restored || draft.savedAt === null) return;
    if (adopted.current === draft.savedAt) return;
    adopted.current = draft.savedAt;
    if (!draft.value.fullName.trim() && !draft.value.phone.trim()) return;
    setForm(draft.value);
    setRecovered(draft.savedAt);
  }, [open, editing, draft.restored, draft.savedAt, draft.value]);

  useEffect(() => {
    if (editing) setRecovered(null);
  }, [editing]);

  const set = <K extends keyof typeof EMPTY>(key: K, value: string) => {
    setForm((c) => {
      const next = { ...c, [key]: value };
      draft.update(next);
      return next;
    });
    setRecovered(null);
    setErrors((c) => {
      if (!c[key]) return c;
      const next = { ...c };
      delete next[key];
      return next;
    });
  };

  // Live duplicate detection — a real safety net in a busy reception desk.
  useEffect(() => {
    if (!open || editing) return;
    const name = form.fullName.trim();
    const phone = form.phone.replace(/\D/g, '');
    if (name.length < 3 && phone.length < 7) {
      setDuplicates([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void call<DuplicateRow[]>('patients.duplicateCheck', { fullName: name, phone })
        .then((rows) => {
          setDuplicates(rows);
          setAckDuplicate(false);
        })
        .catch(() => setDuplicates([]));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form.fullName, form.phone, open, editing]);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (form.fullName.trim().length < 2) next.fullName = 'Enter the patient’s full name.';
    if (!form.dateOfBirth && form.ageYears === '' && form.ageMonths === '') {
      next.ageYears = 'Enter either a date of birth or an age.';
    }
    if (form.dateOfBirth && form.ageYears !== '') {
      next.ageYears = 'Provide either a date of birth or an age, not both.';
    }
    if (form.ageYears !== '' && (Number(form.ageYears) < 0 || Number(form.ageYears) > 120)) {
      next.ageYears = 'Age must be between 0 and 120 years.';
    }
    if (form.ageMonths !== '' && (Number(form.ageMonths) < 0 || Number(form.ageMonths) > 11)) {
      next.ageMonths = 'Months must be between 0 and 11.';
    }
    if (form.phone && !/^[0-9+\-\s()]{6,20}$/.test(form.phone.trim())) {
      next.phone = 'Enter a valid phone number.';
    }
    if (form.dateOfBirth && new Date(`${form.dateOfBirth}T00:00:00`).getTime() > Date.now()) {
      next.dateOfBirth = 'Date of birth cannot be in the future.';
    }
    setErrors(next);
    if (Object.keys(next).length) {
      setTab(next.fullName ? 'basics' : next.ageYears || next.dateOfBirth || next.phone ? 'basics' : 'basics');
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    if (duplicates.length > 0 && !ackDuplicate) {
      setTopError('This looks like an existing patient. Confirm it is a different person, or open the existing record.');
      return;
    }
    setBusy(true);
    setTopError('');
    const payload = {
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      altPhone: form.altPhone.trim(),
      emergencyPhone: form.emergencyPhone.trim(),
      emergencyName: form.emergencyName.trim(),
      dateOfBirth: form.dateOfBirth || undefined,
      ageYears: form.ageYears === '' ? undefined : Number(form.ageYears),
      ageMonths: form.ageMonths === '' ? undefined : Number(form.ageMonths),
      gender: form.gender || undefined,
      bloodGroup: form.bloodGroup || undefined,
      address: form.address.trim(),
      area: form.area.trim(),
      district: form.district.trim(),
      thana: form.thana.trim(),
      postcode: form.postcode.trim(),
      presentComplaint: form.presentComplaint.trim(),
      medicalHistory: form.medicalHistory.trim(),
      dentalHistory: form.dentalHistory.trim(),
      allergies: form.allergies.trim(),
      notes: form.notes.trim(),
    };
    try {
      draft.discard();
      if (editing && patient) {
        await call('patients.update', { id: patient.id, ...payload });
        toast.success('Patient updated', patient.patient_code);
        onSaved(patient.id);
      } else {
        const created = await call<{ id: number; patient_code: string }>('patients.create', payload);
        toast.success('Patient created', `${created.patient_code} · ${form.fullName.trim()}`);
        onSaved(created.id);
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        setTopError(caught.message);
      } else {
        setTopError(caught instanceof Error ? caught.message : 'The patient could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form, duplicates, ackDuplicate]);

  const genderOptions = GENDER_OPTIONS;

  return (
    <Modal
      open={open}
      title={editing ? `Edit ${patient?.full_name ?? 'patient'}` : 'New patient'}
      subtitle={
        editing
          ? `Patient code ${patient?.patient_code} · created ${date(patient?.created_at ?? null, app.prefs)}`
          : 'Only the name is required — everything else can be filled in later.'
      }
      onClose={onClose}
      width={760}
      closeOnBackdrop={false}
      footer={
        <>
          <span className="text-xs text-3 row row-1" style={{ gap: 4 }}>
            <span className="kbd">Ctrl</span> + <span className="kbd">S</span> to save
          </span>
          <span className="spacer" />
          {recovered ? (
            <Button
              onClick={() => {
                draft.discard();
                setForm(EMPTY);
                setRecovered(null);
                setErrors({});
                setTopError('');
              }}
            >
              Start again
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>
            {editing ? 'Save changes' : 'Create patient'}
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        {recovered ? (
          <Callout tone="info" title="Unsaved details recovered">
            This form still had details typed into it at {time(recovered, app.prefs)} when the application locked, so
            they have been put back. Use <strong>Start again</strong> below to clear them.
          </Callout>
        ) : null}
        {topError ? <Callout tone="danger">{topError}</Callout> : null}

        <div className="tabs" role="tablist" aria-label="Patient sections">
          {(['basics', 'contact', 'clinical'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {id === 'basics' ? 'Basics' : id === 'contact' ? 'Contact & address' : 'Clinical'}
            </button>
          ))}
        </div>

        {tab === 'basics' ? (
          <div className="stack stack-3">
            <div className="grid grid-2">
              <TextInput
                label="Full name"
                required
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                error={errors.fullName}
                placeholder="e.g. Rahim Uddin"
                hint="Bengali names are supported everywhere"
              />
              <Select
                label="Gender"
                value={form.gender}
                onChange={(e) => set('gender', e.target.value)}
                options={genderOptions}
              />
            </div>
            <div className="grid grid-2">
              <Field label="Age basis" required error={errors.ageYears} hint="Use either a date of birth or an age.">
                <div className="row row-2">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={120}
                    placeholder="Age (years)"
                    value={form.ageYears}
                    onChange={(e) => set('ageYears', e.target.value)}
                    aria-label="Age in years"
                  />
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={11}
                    placeholder="Months"
                    value={form.ageMonths}
                    onChange={(e) => set('ageMonths', e.target.value)}
                    aria-label="Age in months"
                    style={{ width: 110 }}
                  />
                </div>
              </Field>
              <TextInput
                label="Date of birth"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => {
                  set('dateOfBirth', e.target.value);
                  if (e.target.value) set('ageYears', '');
                }}
                error={errors.dateOfBirth}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="grid grid-2">
              <Select
                label="Blood group"
                value={form.bloodGroup}
                onChange={(e) => set('bloodGroup', e.target.value)}
                options={BLOOD_GROUP_OPTIONS}
              />
              <TextInput
                label="Allergies"
                value={form.allergies}
                onChange={(e) => set('allergies', e.target.value)}
                error={errors.allergies}
                placeholder="e.g. Penicillin, Latex"
                hint="Printed as a warning on every prescription"
              />
            </div>

            {duplicates.length > 0 ? (
              <Callout tone="warn" title={`${duplicates.length} possible duplicate${duplicates.length === 1 ? '' : 's'} found`}>
                <ul className="list-rows" style={{ marginTop: 6 }}>
                  {duplicates.map((row) => (
                    <li key={row.id}>
                      <button type="button" className="list-row" onClick={() => route.navigate(`patients/${row.id}`)}>
                        <span className="list-row-main">
                          <span className="truncate">{row.full_name}</span>
                          <span className="text-xs text-3 mono">{row.patient_code} · {row.phone}</span>
                        </span>
                        <span className="text-xs text-3">{date(row.created_at, app.prefs)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Checkbox
                  label="This is a different person — continue anyway"
                  checked={ackDuplicate}
                  onChange={(e) => setAckDuplicate(e.target.checked)}
                />
              </Callout>
            ) : null}
          </div>
        ) : null}

        {tab === 'contact' ? (
          <div className="stack stack-3">
            <div className="grid grid-2">
              <TextInput
                label="Phone"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                error={errors.phone}
                inputMode="tel"
                placeholder="01712345678"
                icon="phone"
              />
              <TextInput
                label="Alternate phone"
                value={form.altPhone}
                onChange={(e) => set('altPhone', e.target.value)}
                error={errors.altPhone}
                inputMode="tel"
              />
            </div>
            <div className="grid grid-2">
              <TextInput
                label="Emergency contact"
                value={form.emergencyName}
                onChange={(e) => set('emergencyName', e.target.value)}
                error={errors.emergencyName}
              />
              <TextInput
                label="Emergency phone"
                value={form.emergencyPhone}
                onChange={(e) => set('emergencyPhone', e.target.value)}
                error={errors.emergencyPhone}
                inputMode="tel"
              />
            </div>
            <TextInput
              label="Address"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              error={errors.address}
              placeholder="House, road, landmark"
            />
            <div className="grid grid-3">
              <TextInput label="Area" value={form.area} onChange={(e) => set('area', e.target.value)} error={errors.area} />
              <TextInput label="Thana" value={form.thana} onChange={(e) => set('thana', e.target.value)} error={errors.thana} />
              <TextInput label="District" value={form.district} onChange={(e) => set('district', e.target.value)} error={errors.district} />
            </div>
            <TextInput label="Postcode" value={form.postcode} onChange={(e) => set('postcode', e.target.value)} error={errors.postcode} />
          </div>
        ) : null}

        {tab === 'clinical' ? (
          <div className="stack stack-3">
            <TextArea
              label="Present complaint"
              value={form.presentComplaint}
              onChange={(e) => set('presentComplaint', e.target.value)}
              error={errors.presentComplaint}
              rows={2}
              placeholder="What brings the patient in today"
            />
            <TextArea
              label="Medical history"
              value={form.medicalHistory}
              onChange={(e) => set('medicalHistory', e.target.value)}
              error={errors.medicalHistory}
              rows={3}
              placeholder="Diabetes, hypertension, heart conditions, medication…"
            />
            <TextArea
              label="Dental history"
              value={form.dentalHistory}
              onChange={(e) => set('dentalHistory', e.target.value)}
              error={errors.dentalHistory}
              rows={3}
              placeholder="Previous extractions, prostheses, orthodontic treatment…"
            />
            <TextArea
              label="Internal notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              error={errors.notes}
              rows={2}
              hint="Only visible to clinical staff — never printed."
            />
            <p className="text-xs text-3 row row-1" style={{ gap: 6 }}>
              <Icon name="shield" size={13} /> Clinical notes are visible to staff with clinical permission only.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
