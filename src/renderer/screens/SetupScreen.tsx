import { useMemo, useState, type JSX } from 'react';
import { Button, Callout, Checkbox, Field, IconButton, Select, TextInput, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { call, ApiError } from '../lib/api';
import { useApp } from '../app/state';
import { getBridge } from '../bridge';
import { AUTO_LOCK_OPTIONS, BACKUP_FREQENCIES } from '../../shared/constants';

interface DentistDraft {
  fullName: string;
  title: string;
  designations: string;
  qualifications: string;
  registrationNo: string;
  phone: string;
  email: string;
  consultationHours: string;
  degreePrefix: string;
}

const EMPTY_DENTIST: DentistDraft = {
  fullName: '', title: '', designations: '', qualifications: '', registrationNo: '',
  phone: '', email: '', consultationHours: '', degreePrefix: '',
};

const STEPS = [
  { id: 'clinic', label: 'Clinic', icon: 'info' as const },
  { id: 'dentists', label: 'Dentists', icon: 'stethoscope' as const },
  { id: 'admin', label: 'Administrator', icon: 'shield' as const },
  { id: 'preferences', label: 'Preferences', icon: 'settings' as const },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface FormState {
  clinicName: string;
  address: string;
  area: string;
  district: string;
  phone: string;
  email: string;
  website: string;
  footer: string;
  businessStart: string;
  businessEnd: string;
  workingDays: number[];
  dentists: DentistDraft[];
  adminName: string;
  username: string;
  password: string;
  confirmPassword: string;
  dateFormat: 'dmy' | 'ymd' | 'mdy';
  timeFormat: '12h' | '24h';
  autoLockMinutes: number;
  bengaliNumerals: boolean;
  backupFrequencyDays: number;
  backupFolder: string;
}

export function SetupScreen(): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState('');
  const [form, setForm] = useState<FormState>({
    clinicName: '',
    address: '',
    area: '',
    district: '',
    phone: '',
    email: '',
    website: '',
    footer: 'Thank you for visiting. Please keep this document for your records.',
    businessStart: '10:00',
    businessEnd: '20:00',
    workingDays: [1, 2, 3, 4, 5, 6],
    dentists: [{ ...EMPTY_DENTIST }],
    adminName: '',
    username: '',
    password: '',
    confirmPassword: '',
    dateFormat: 'dmy',
    timeFormat: '12h',
    autoLockMinutes: 10,
    bengaliNumerals: false,
    backupFrequencyDays: 7,
    backupFolder: '',
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  const setDentist = (index: number, patch: Partial<DentistDraft>) => {
    setForm((current) => ({
      ...current,
      dentists: current.dentists.map((dentist, i) => (i === index ? { ...dentist, ...patch } : dentist)),
    }));
    setErrors((current) => {
      const key = `dentists.${index}`;
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const addDentist = () => setForm((c) => ({ ...c, dentists: [...c.dentists, { ...EMPTY_DENTIST }] }));
  const removeDentist = (index: number) => {
    if (form.dentists.length === 1) return;
    setForm((c) => ({ ...c, dentists: c.dentists.filter((_, i) => i !== index) }));
  };

  const validateStep = (index: number): boolean => {
    const next: Record<string, string> = {};
    if (index === 0) {
      if (form.clinicName.trim().length < 2) next['clinic.name'] = 'Enter the clinic name.';
      if (form.phone.trim() && !/^[0-9+\-\s()]{6,20}$/.test(form.phone.trim())) {
        next['clinic.phone'] = 'Enter a valid phone number.';
      }
      if (!form.businessStart || !form.businessEnd) next['clinic.businessEnd'] = 'Set both opening and closing time.';
      else if (form.businessEnd <= form.businessStart) next['clinic.businessEnd'] = 'Closing time must be after opening time.';
      if (form.workingDays.length === 0) next['clinic.workingDays'] = 'Select at least one working day.';
    }
    if (index === 1) {
      form.dentists.forEach((dentist, i) => {
        if (dentist.fullName.trim().length < 2) next[`dentists.${i}`] = 'Enter the dentist’s full name.';
      });
      if (form.dentists.length === 0) next['dentists'] = 'Add at least one dentist.';
    }
    if (index === 2) {
      if (form.adminName.trim().length < 2) next['admin.displayName'] = 'Enter the administrator’s name.';
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(form.username.trim())) {
        next['admin.username'] = 'Use 3–40 letters, digits, dot, dash or underscore.';
      }
      if (form.password.length < 10) next['admin.password'] = 'Use at least 10 characters.';
      if (form.password !== form.confirmPassword) next['admin.confirmPassword'] = 'The two passwords do not match.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const canLeave = (index: number) => (index < step ? true : validateStep(index));

  const next = () => {
    if (!validateStep(step)) return;
    setTopError('');
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const chooseBackupFolder = async () => {
    const result = await getBridge().files.chooseFolder('Choose the backup folder', form.backupFolder || app.status?.backupFolder);
    if (result.path) {
      set('backupFolder', result.path);
      toast.success('Backup folder chosen', result.path);
    }
  };

  const submit = async () => {
    for (let i = 0; i < STEPS.length; i += 1) {
      if (!validateStep(i)) {
        setStep(i);
        return;
      }
    }
    setBusy(true);
    setTopError('');
    try {
      await call('setup.run', {
        clinic: {
          name: form.clinicName.trim(),
          address: form.address.trim(),
          area: form.area.trim(),
          district: form.district.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          website: form.website.trim(),
          footer: form.footer.trim(),
          businessStart: form.businessStart,
          businessEnd: form.businessEnd,
          workingDays: form.workingDays,
        },
        dentists: form.dentists
          .filter((dentist) => dentist.fullName.trim())
          .map((dentist) => ({
            fullName: dentist.fullName.trim(),
            title: dentist.title.trim(),
            designations: dentist.designations.split(',').map((d) => d.trim()).filter(Boolean),
            qualifications: dentist.qualifications.trim(),
            registrationNo: dentist.registrationNo.trim(),
            phone: dentist.phone.trim(),
            email: dentist.email.trim(),
            consultationHours: dentist.consultationHours.trim(),
            degreePrefix: dentist.degreePrefix.trim(),
          })),
        admin: {
          displayName: form.adminName.trim(),
          username: form.username.trim(),
          password: form.password,
          confirmPassword: form.confirmPassword,
        },
        prefs: {
          dateFormat: form.dateFormat,
          timeFormat: form.timeFormat,
          autoLockMinutes: form.autoLockMinutes,
          backupFolder: form.backupFolder.trim(),
          backupFrequencyDays: form.backupFrequencyDays,
          bengaliNumerals: form.bengaliNumerals,
        },
      });
      toast.success('Setup complete', 'You can now sign in with the administrator account you just created.');
      await app.boot();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const next: Record<string, string> = {};
        for (const issue of caught.issues) next[issue.field] = issue.message;
        setErrors(next);
        const targetStep = Object.keys(next)[0]?.startsWith('dentists') ? 1 : Object.keys(next)[0]?.startsWith('admin') ? 2 : 0;
        setStep(targetStep);
        setTopError(caught.message);
      } else {
        setTopError(caught instanceof Error ? caught.message : 'Setup could not be completed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const strength = useMemo(() => {
    const p = form.password;
    let score = 0;
    if (p.length >= 10) score += 1;
    if (p.length >= 14) score += 1;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
    if (/[0-9]/.test(p)) score += 1;
    if (/[^A-Za-z0-9]/.test(p)) score += 1;
    return score;
  }, [form.password]);

  return (
    <div className="setup-screen">
      <header className="setup-head">
        <div className="row row-2">
          <span className="brand-mark"><Icon name="tooth" size={20} /></span>
          <div>
            <h1 className="auth-title" style={{ fontSize: 20 }}>Welcome to Dentiva Pro</h1>
            <p className="auth-sub">First-time setup — this takes about two minutes and can only be done once.</p>
          </div>
        </div>
        <ol className="setup-steps">
          {STEPS.map((item, index) => (
            <li
              key={item.id}
              className="setup-step"
              data-state={index === step ? 'active' : index < step ? 'done' : 'todo'}
            >
              <button type="button" onClick={() => canLeave(index) && setStep(index)}>
                <span className="setup-step-num">{index < step ? <Icon name="check" size={13} /> : index + 1}</span>
                <span className="setup-step-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </header>

      <div className="setup-body">
        <div className="setup-panel">
          {topError ? (
            <div style={{ marginBottom: 14 }}>
              <Callout tone="danger" title="Setup could not be saved">{topError}</Callout>
            </div>
          ) : null}

          {step === 0 ? (
            <section className="stack stack-3">
              <h2 className="section-title">Clinic details</h2>
              <p className="text-sm text-3">These details appear on every prescription, invoice and report you print.</p>
              <div className="grid grid-2">
                <TextInput
                  label="Clinic name"
                  required
                  value={form.clinicName}
                  onChange={(e) => set('clinicName', e.target.value)}
                  error={errors['clinic.name']}
                  placeholder="e.g. Rahman Dental Care"
                />
                <TextInput
                  label="Phone"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  error={errors['clinic.phone']}
                  placeholder="01712345678"
                  inputMode="tel"
                />
              </div>
              <TextInput
                label="Address"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="House / road / landmark"
              />
              <div className="grid grid-2">
                <TextInput label="Area" value={form.area} onChange={(e) => set('area', e.target.value)} placeholder="e.g. Dhanmondi" />
                <TextInput label="District" value={form.district} onChange={(e) => set('district', e.target.value)} placeholder="e.g. Dhaka" />
              </div>
              <div className="grid grid-2">
                <TextInput label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
                <TextInput label="Website" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="example.com" />
              </div>
              <div className="grid grid-2">
                <Field label="Opens" required error={errors['clinic.businessEnd']}>
                  <input className="input" type="time" value={form.businessStart} onChange={(e) => set('businessStart', e.target.value)} />
                </Field>
                <Field label="Closes" required>
                  <input className="input" type="time" value={form.businessEnd} onChange={(e) => set('businessEnd', e.target.value)} />
                </Field>
              </div>
              <Field label="Working days" required error={errors['clinic.workingDays']}>
                <div className="row row-wrap" style={{ gap: 6 }}>
                  {WEEKDAYS.map((day, index) => (
                    <Checkbox
                      key={day}
                      label={day.slice(0, 3)}
                      checked={form.workingDays.includes(index)}
                      onChange={(e) => {
                        const nextDays = e.target.checked
                          ? [...form.workingDays, index].sort((a, b) => a - b)
                          : form.workingDays.filter((d) => d !== index);
                        set('workingDays', nextDays);
                      }}
                    />
                  ))}
                </div>
              </Field>
              <TextInput
                label="Footer message"
                value={form.footer}
                onChange={(e) => set('footer', e.target.value)}
                hint="Printed at the bottom of prescriptions and documents. Bengali is fully supported."
              />
            </section>
          ) : null}

          {step === 1 ? (
            <section className="stack stack-3">
              <div className="row row-2" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h2 className="section-title">Dentists</h2>
                  <p className="text-sm text-3">The first dentist is the default prescriber. Add more for a multi-chair clinic.</p>
                </div>
                <Button icon="plus" onClick={addDentist}>Add dentist</Button>
              </div>
              {errors.dentists ? <Callout tone="danger">{errors.dentists}</Callout> : null}
              {form.dentists.map((dentist, index) => (
                <fieldset className="setup-card" key={index}>
                  <legend>
                    Dentist {index + 1}
                    {form.dentists.length > 1 ? (
                      <IconButton icon="trash" label={`Remove dentist ${index + 1}`} size={15} onClick={() => removeDentist(index)} />
                    ) : null}
                  </legend>
                  {errors[`dentists.${index}`] ? <p className="field-error">{errors[`dentists.${index}`]}</p> : null}
                  <div className="grid grid-2">
                    <TextInput
                      label="Full name"
                      required
                      value={dentist.fullName}
                      onChange={(e) => setDentist(index, { fullName: e.target.value })}
                      placeholder="e.g. Dr. Nusrat Jahan"
                    />
                    <TextInput
                      label="Title"
                      value={dentist.title}
                      onChange={(e) => setDentist(index, { title: e.target.value })}
                      placeholder="e.g. BDS, MS"
                    />
                  </div>
                  <div className="grid grid-2">
                    <TextInput
                      label="Designations"
                      value={dentist.designations}
                      onChange={(e) => setDentist(index, { designations: e.target.value })}
                      hint="Separate with commas"
                      placeholder="Senior Lecturer, Consultant"
                    />
                    <TextInput
                      label="Qualifications"
                      value={dentist.qualifications}
                      onChange={(e) => setDentist(index, { qualifications: e.target.value })}
                      placeholder="BDS, MS (Oral & Maxillofacial Surgery)"
                    />
                  </div>
                  <div className="grid grid-2">
                    <TextInput
                      label="Registration no."
                      value={dentist.registrationNo}
                      onChange={(e) => setDentist(index, { registrationNo: e.target.value })}
                    />
                    <TextInput
                      label="Degree prefix"
                      value={dentist.degreePrefix}
                      onChange={(e) => setDentist(index, { degreePrefix: e.target.value })}
                      placeholder="Dr."
                      hint="Printed above the name on prescriptions"
                    />
                  </div>
                  <div className="grid grid-2">
                    <TextInput label="Phone" value={dentist.phone} onChange={(e) => setDentist(index, { phone: e.target.value })} />
                    <TextInput
                      label="Consultation hours"
                      value={dentist.consultationHours}
                      onChange={(e) => setDentist(index, { consultationHours: e.target.value })}
                      placeholder="Sat–Thu, 5pm–9pm"
                    />
                  </div>
                </fieldset>
              ))}
            </section>
          ) : null}

          {step === 2 ? (
            <section className="stack stack-3">
              <h2 className="section-title">Administrator account</h2>
              <Callout tone="info" title="This account has every permission">
                Use it for setup and configuration. Create a personal staff login for day-to-day use so the audit log
                always shows who did what.
              </Callout>
              <div className="grid grid-2">
                <TextInput
                  label="Your name"
                  required
                  value={form.adminName}
                  onChange={(e) => set('adminName', e.target.value)}
                  error={errors['admin.displayName']}
                />
                <TextInput
                  label="Username"
                  required
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                  error={errors['admin.username']}
                  autoComplete="username"
                  className="mono"
                />
              </div>
              <div className="grid grid-2">
                <TextInput
                  label="Password"
                  required
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  error={errors['admin.password']}
                  autoComplete="new-password"
                  hint="At least 10 characters, mixing letters, digits and a symbol."
                />
                <TextInput
                  label="Confirm password"
                  required
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => set('confirmPassword', e.target.value)}
                  error={errors['admin.confirmPassword']}
                  autoComplete="new-password"
                />
              </div>
              {form.password ? (
                <Field label="Password strength">
                  <div className="pw-meter" aria-label={`Password strength ${strength} of 5`}>
                    {[1, 2, 3, 4, 5].map((level) => (
                      <span key={level} data-on={strength >= level} data-tone={strength <= 2 ? 'weak' : strength <= 3 ? 'mid' : 'strong'} />
                    ))}
                  </div>
                </Field>
              ) : null}
            </section>
          ) : null}

          {step === 3 ? (
            <section className="stack stack-3">
              <h2 className="section-title">Preferences</h2>
              <p className="text-sm text-3">These apply to the whole workstation. You can change them later in Settings.</p>
              <div className="grid grid-2">
                <Select
                  label="Date format"
                  value={form.dateFormat}
                  onChange={(e) => set('dateFormat', e.target.value as FormState['dateFormat'])}
                  options={[
                    { value: 'dmy', label: '31/12/2026 (day first)' },
                    { value: 'ymd', label: '2026-12-31 (year first)' },
                    { value: 'mdy', label: '12/31/2026 (month first)' },
                  ]}
                />
                <Select
                  label="Time format"
                  value={form.timeFormat}
                  onChange={(e) => set('timeFormat', e.target.value as FormState['timeFormat'])}
                  options={[
                    { value: '12h', label: '2:30 PM (12-hour)' },
                    { value: '24h', label: '14:30 (24-hour)' },
                  ]}
                />
              </div>
              <div className="grid grid-2">
                <Select
                  label="Auto-lock"
                  value={String(form.autoLockMinutes)}
                  onChange={(e) => set('autoLockMinutes', Number(e.target.value))}
                  options={AUTO_LOCK_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                  hint="Locks the workstation after inactivity."
                />
                <Select
                  label="Automatic backups"
                  value={String(form.backupFrequencyDays)}
                  onChange={(e) => set('backupFrequencyDays', Number(e.target.value))}
                  options={BACKUP_FREQENCIES.map((o) => ({ value: String(o.value), label: o.label }))}
                />
              </div>
              <Checkbox
                label="Show Bengali numerals (০১২৩) in the interface"
                checked={form.bengaliNumerals}
                onChange={(e) => set('bengaliNumerals', e.target.checked)}
              />
              <Field label="Backup folder" hint="Leave empty to use the default folder created during installation.">
                <div className="row row-2">
                  <input
                    className="input"
                    value={form.backupFolder}
                    onChange={(e) => set('backupFolder', e.target.value)}
                    placeholder={app.status?.backupFolder ?? 'C:\\DentivaPro\\Backups'}
                  />
                  <Button icon="folder-open" onClick={() => void chooseBackupFolder()}>Browse</Button>
                </div>
              </Field>
              <Callout tone="warn" title="Back up early, back up often">
                Point the backup folder at a drive you copy elsewhere. Open <strong>Backup &amp; Restore</strong> after
                setup to confirm backups are being written.
              </Callout>
            </section>
          ) : null}

          <footer className="setup-foot">
            <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} icon="arrow-left">
              Back
            </Button>
            <span className="text-sm text-3">Step {step + 1} of {STEPS.length}</span>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" iconRight="arrow-right" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" icon="check-circle" loading={busy} onClick={() => void submit()}>
                Finish setup
              </Button>
            )}
          </footer>
        </div>

        <aside className="setup-aside">
          <Callout tone="ok" title="Everything stays on this computer">
            Dentiva Pro has no internet connection, no account and no cloud. Patient data never leaves this machine.
          </Callout>
          <h3>What happens next</h3>
          <ul className="auth-list">
            <li><Icon name="check" size={15} /> You will sign in as the administrator.</li>
            <li><Icon name="check" size={15} /> Add your staff and give each person their own login.</li>
            <li><Icon name="check" size={15} /> Print a test prescription to check your printer profile.</li>
            <li><Icon name="check" size={15} /> Create your first backup and store it somewhere safe.</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
