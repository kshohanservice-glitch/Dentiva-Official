import { useEffect, useMemo, useState, type JSX } from 'react';
import { useApp } from '../app/state';
import { useShell } from '../app/AppShell';
import { call, ApiError, filesBridge } from '../lib/api';
import {
  Badge, Button, Callout, Card, Checkbox, DataTable, Field, IconButton, Modal, PageHeader, Pagination,
  Select, Tabs, TextArea, TextInput, useConfirm, useDebounced, useResource, useToast,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { date, dateAndTime, money, poishaToInput, relativeTime } from '../lib/format';
import { takaInputToPoisha } from '../../core/money/money';
import { PERMISSIONS, PERMISSION_GROUPS, ADMIN_ONLY_PERMISSIONS, type Permission } from '../../shared/permissions';

type Tab = 'staff' | 'dentists' | 'users' | 'roles' | 'audit' | 'logins';

export function StaffPage({ staffId }: { staffId?: string }): JSX.Element {
  const app = useApp();
  const canSee = app.has('staff.view') || app.has('users.view');
  const [tab, setTab] = useState<Tab>('staff');

  if (!canSee) {
    return (
      <>
        <PageHeader title="Staff & Users" icon="staff" />
        <Callout tone="warn" title="No access">
          Your role does not include staff or user administration.
        </Callout>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Staff & Users"
        icon="staff"
        subtitle="Staff records, dentist profiles, user accounts, roles and the audit trail"
        breadcrumb={[{ label: 'Administration', href: 'administration/settings' }, { label: 'Staff & Users' }]}
      />
      <div className="mt-3">
        <Tabs
          ariaLabel="Administration sections"
          value={tab}
          onChange={(next) => setTab(next as Tab)}
          items={[
            { id: 'staff', label: 'Staff', icon: 'staff', permission: 'staff.view' },
            { id: 'dentists', label: 'Dentists', icon: 'stethoscope', permission: 'staff.view' },
            { id: 'users', label: 'User accounts', icon: 'user', permission: 'users.view' },
            { id: 'roles', label: 'Roles', icon: 'shield', permission: 'users.view' },
            { id: 'audit', label: 'Audit log', icon: 'activity', permission: 'audit.view' },
            { id: 'logins', label: 'Sign-in history', icon: 'key', permission: 'users.view' },
          ]}
        />
      </div>
      <div className="mt-3">
        {tab === 'staff' ? <StaffList focusId={staffId} /> : null}
        {tab === 'dentists' ? <DentistList /> : null}
        {tab === 'users' ? <UserList /> : null}
        {tab === 'roles' ? <RoleList /> : null}
        {tab === 'audit' ? <AuditLog /> : null}
        {tab === 'logins' ? <LoginHistory /> : null}
      </div>
    </>
  );
}

/* ── Staff ─────────────────────────────────────────────────────────────── */

interface StaffRow {
  id: number;
  full_name: string;
  date_of_birth: string | null;
  gender: string;
  phone: string;
  blood_group: string;
  national_id: string;
  position: string;
  department: string;
  joining_date: string | null;
  salary_poisha: number;
  status: string;
  notes: string;
  address: string;
  created_at: string;
  username: string | null;
  user_status: string | null;
}

const EMPTY_STAFF = {
  fullName: '', dateOfBirth: '', gender: '', phone: '', bloodGroup: '', nationalId: '',
  position: '', department: '', joiningDate: '', salary: '', notes: '', address: '',
};

function StaffList({ focusId }: { focusId?: string }): JSX.Element {
  const app = useApp();
  const confirm = useConfirm();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 220);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useResource(
    () => call<{ rows: StaffRow[]; total: number; page: number; pageCount: number; pageSize: number }>('staff.list', { search: debounced || undefined, page }),
    [debounced, page],
  );

  useEffect(() => setPage(1), [debounced]);

  const remove = async (row: StaffRow) => {
    const ok = await confirm({
      title: `Delete ${row.full_name}?`,
      message: 'The staff record is removed. Records they created are kept, but will no longer show a name.',
      tone: 'danger',
      confirmLabel: 'Delete staff record',
    });
    if (!ok) return;
    try {
      await call('staff.delete', { id: row.id });
      toast.success('Staff record deleted', row.full_name);
      list.reload();
    } catch (caught) {
      toast.error('Not deleted', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <>
      <Card
        title="Staff"
        icon="staff"
        actions={
          app.has('staff.manage') ? (
            <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>Add staff</Button>
          ) : null
        }
        flush
      >
        <div className="card-head">
          <div className="filter-search">
            <TextInput
              aria-label="Search staff"
              placeholder="Search by name, phone, position or national ID…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              icon="search"
              inputSize="sm"
            />
          </div>
          <span className="spacer" />
          <span className="text-sm text-3">{list.data?.total ?? 0} record(s)</span>
        </div>
        <DataTable
          rows={list.data?.rows ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          selectedKey={focusId ? Number(focusId) : undefined}
          onRowClick={(row) => setEditing(row)}
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (row) => (
                <div className="stack stack-0" style={{ minWidth: 0 }}>
                  <span className="truncate">{row.full_name}</span>
                  <span className="text-xs text-3 truncate">{[row.position, row.department].filter(Boolean).join(' · ') || '—'}</span>
                </div>
              ),
            },
            { key: 'phone', header: 'Phone', width: 140, render: (row) => <span className="mono text-sm">{row.phone || '—'}</span> },
            { key: 'joining', header: 'Joined', width: 110, render: (row) => (row.joining_date ? date(row.joining_date, app.prefs) : '—') },
            { key: 'salary', header: 'Salary', width: 130, numeric: true, render: (row) => money(Number(row.salary_poisha ?? 0), app.prefs, { decimals: 0 }) },
            {
              key: 'account',
              header: 'Account',
              width: 160,
              render: (row) =>
                row.username ? (
                  <span className="truncate mono text-xs">{row.username}</span>
                ) : (
                  <span className="text-xs text-3">No login</span>
                ),
            },
            { key: 'status', header: 'Status', width: 110, render: (row) => <Badge tone={row.status === 'active' ? 'ok' : 'neutral'}>{row.status}</Badge> },
            {
              key: 'actions',
              header: '',
              width: 96,
              render: (row) =>
                app.has('staff.manage') ? (
                  <div className="row row-1 row-end">
                    <IconButton icon="edit" label="Edit staff" size={15} onClick={() => setEditing(row)} />
                    <IconButton icon="trash" label="Delete staff" size={15} onClick={() => void remove(row)} />
                  </div>
                ) : null,
            },
          ]}
          empty={<div className="state"><div className="state-title">No staff records</div><div className="state-text">Add receptionists, assistants and technicians here.</div></div>}
        />
        {(list.data?.pageCount ?? 1) > 1 ? (
          <div className="card-foot">
            <Pagination
              page={list.data?.page ?? 1}
              pageCount={list.data?.pageCount ?? 1}
              total={list.data?.total ?? 0}
              pageSize={list.data?.pageSize ?? 25}
              onPage={setPage}
            />
          </div>
        ) : null}
      </Card>

      {creating || editing ? (
        <StaffForm
          record={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); list.reload(); }}
        />
      ) : null}
    </>
  );
}

function StaffForm({ record, onClose, onSaved }: { record: StaffRow | null; onClose: () => void; onSaved: () => void }): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [form, setForm] = useState(
    record
      ? {
          fullName: record.full_name,
          dateOfBirth: record.date_of_birth ?? '',
          gender: record.gender ?? '',
          phone: record.phone ?? '',
          bloodGroup: record.blood_group ?? '',
          nationalId: record.national_id ?? '',
          position: record.position ?? '',
          department: record.department ?? '',
          joiningDate: record.joining_date ?? '',
          salary: poishaToInput(Number(record.salary_poisha ?? 0)),
          notes: record.notes ?? '',
          address: record.address ?? '',
        }
      : EMPTY_STAFF,
  );
  const [status, setStatus] = useState(record?.status ?? 'active');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const salaryPoisha = form.salary.trim() ? takaInputToPoisha(form.salary) : 0;
    try {
      const payload = {
        fullName: form.fullName.trim(),
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender || undefined,
        phone: form.phone || undefined,
        bloodGroup: form.bloodGroup || undefined,
        nationalId: form.nationalId || undefined,
        position: form.position,
        department: form.department,
        joiningDate: form.joiningDate || undefined,
        salaryPoisha: salaryPoisha ?? 0,
        notes: form.notes,
        address: form.address,
      };
      if (record) await call('staff.update', { id: record.id, status, ...payload });
      else await call('staff.create', payload);
      toast.success(record ? 'Staff record updated' : 'Staff record created', form.fullName);
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        toast.error('Not saved', caught.message);
      } else {
        toast.error('Not saved', caught instanceof Error ? caught.message : undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={record ? `Edit ${record.full_name}` : 'New staff record'}
      subtitle="Staff records are separate from user logins"
      onClose={onClose}
      width={760}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>
            {record ? 'Save changes' : 'Create staff record'}
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        <div className="grid grid-2">
          <TextInput label="Full name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={errors.fullName} />
          <TextInput label="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} error={errors.position} placeholder="e.g. Senior dental assistant" />
        </div>
        <div className="grid grid-3">
          <Field label="Date of birth">
            <input className="input" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
          </Field>
          <Select
            label="Gender"
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
            options={[
              { value: '', label: 'Not specified' },
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <Select
            label="Blood group"
            value={form.bloodGroup}
            onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
            options={['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => ({ value: bg, label: bg || 'Unknown' }))}
          />
        </div>
        <div className="grid grid-2">
          <TextInput label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} inputMode="tel" />
          <TextInput label="National ID" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} error={errors.nationalId} className="mono" />
        </div>
        <TextInput label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} error={errors.address} />
        <div className="grid grid-3">
          <TextInput label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} error={errors.department} />
          <Field label="Joining date">
            <input className="input" type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} />
          </Field>
          <TextInput
            label="Monthly salary (৳)"
            value={form.salary}
            onChange={(e) => setForm({ ...form, salary: e.target.value })}
            inputMode="decimal"
            className="num"
            error={errors.salaryPoisha}
          />
        </div>
        {record ? (
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'resigned', label: 'Resigned' },
              ]}
            />
          </Field>
        ) : null}
        <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} error={errors.notes} />
        <p className="text-xs text-3">
          Created {date(record?.created_at ?? new Date().toISOString(), app.prefs)} · salary is shown in the staff list but
          never printed on patient documents.
        </p>
      </div>
    </Modal>
  );
}

/* ── Dentists ──────────────────────────────────────────────────────────── */

interface DentistRow {
  id: number;
  full_name: string;
  title: string;
  designations: string;
  qualifications: string;
  registration_no: string;
  phone: string;
  email: string;
  consultation_hours: string;
  degree_prefix: string;
  status: string;
  signature_attachment_id: number | null;
}

function DentistList(): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const list = useResource(() => call<DentistRow[]>('dentists.list', { includeInactive: true }), []);
  const [editing, setEditing] = useState<DentistRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [hours, setHours] = useState<{ dentist_id: number; day_of_week: number; is_open: number; start_time: string; end_time: string }[]>([]);

  useEffect(() => {
    if (!editing) return;
    void call<typeof hours>('settings.workingHours')
      .then((rows) => setHours(rows.filter((row) => row.dentist_id === editing.id)))
      .catch(() => setHours([]));
  }, [editing]);

  const setStatus = async (row: DentistRow, status: string) => {
    try {
      await call('dentists.update', {
        id: row.id,
        fullName: row.full_name,
        title: row.title,
        designations: row.designations,
        qualifications: row.qualifications,
        registrationNo: row.registration_no,
        phone: row.phone,
        email: row.email,
        consultationHours: row.consultation_hours,
        degreePrefix: row.degree_prefix,
        status,
      });
      toast.success(`Dr. ${row.full_name} set to ${status}`);
      list.reload();
    } catch (caught) {
      toast.error('Not updated', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <>
      <Card
        title="Dentists"
        icon="stethoscope"
        subtitle="These details appear on prescriptions and the appointment book"
        actions={
          app.has('settings.manage') ? (
            <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>Add dentist</Button>
          ) : null
        }
        flush
      >
        <DataTable
          rows={list.data ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => setEditing(row)}
          columns={[
            {
              key: 'name',
              header: 'Dentist',
              render: (row) => (
                <div className="stack stack-0" style={{ minWidth: 0 }}>
                  <span className="truncate">{row.degree_prefix} {row.full_name}</span>
                  <span className="text-xs text-3 truncate">{[row.qualifications, row.designations].filter(Boolean).join(' · ') || '—'}</span>
                </div>
              ),
            },
            { key: 'reg', header: 'Registration', width: 150, render: (row) => <span className="mono text-xs">{row.registration_no || '—'}</span> },
            { key: 'phone', header: 'Phone', width: 140, render: (row) => <span className="mono text-sm">{row.phone || '—'}</span> },
            { key: 'hours', header: 'Consultation', width: 190, render: (row) => <span className="truncate">{row.consultation_hours || '—'}</span> },
            {
              key: 'status',
              header: 'Status',
              width: 140,
              render: (row) =>
                app.has('settings.manage') ? (
                  <Select
                    inputSize="sm"
                    value={row.status}
                    onChange={(e) => void setStatus(row, e.target.value)}
                    aria-label={`Status for ${row.full_name}`}
                    options={[
                      { value: 'active', label: 'Active' },
                      { value: 'inactive', label: 'Inactive' },
                    ]}
                  />
                ) : (
                  <Badge tone={row.status === 'active' ? 'ok' : 'neutral'}>{row.status}</Badge>
                ),
            },
          ]}
          empty={<div className="state"><div className="state-title">No dentists yet</div><div className="state-text">Add the treating dentists whose names appear on prescriptions.</div></div>}
        />
      </Card>

      {creating || editing ? (
        <DentistForm
          record={editing}
          hours={hours}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); list.reload(); }}
        />
      ) : null}
    </>
  );
}

function DentistForm({
  record, hours, onClose, onSaved,
}: {
  record: DentistRow | null;
  hours: { dentist_id: number; day_of_week: number; is_open: number; start_time: string; end_time: string }[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const app = useApp();
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: record?.full_name ?? '',
    title: record?.title ?? '',
    designations: record?.designations ?? '',
    qualifications: record?.qualifications ?? '',
    registrationNo: record?.registration_no ?? '',
    phone: record?.phone ?? '',
    email: record?.email ?? '',
    consultationHours: record?.consultation_hours ?? '',
    degreePrefix: record?.degree_prefix ?? 'Dr.',
  });
  const [schedule, setSchedule] = useState(
    Array.from({ length: 7 }, (_, day) => {
      const found = hours.find((row) => row.day_of_week === day);
      return { day, isOpen: found ? Boolean(found.is_open) : day > 0 && day < 6, start: found?.start_time || '17:00', end: found?.end_time || '21:00' };
    }),
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        fullName: form.fullName.trim(),
        title: form.title,
        designations: form.designations ? form.designations.split(',').map((d) => d.trim()).filter(Boolean) : [],
        qualifications: form.qualifications,
        registrationNo: form.registrationNo,
        phone: form.phone,
        email: form.email,
        consultationHours: form.consultationHours,
        degreePrefix: form.degreePrefix,
      };
      const saved = record
        ? ((await call<{ id: number }>('dentists.update', { id: record.id, ...payload })) as { id: number })
        : ((await call<{ id: number }>('dentists.create', payload)) as { id: number });
      await call('settings.setWorkingHours', {
        dentistId: saved.id,
        hours: schedule.map((row) => ({ day: row.day, isOpen: row.isOpen, start: row.start, end: row.end })),
      });
      toast.success(record ? 'Dentist updated' : 'Dentist created', form.fullName);
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        toast.error('Not saved', caught.message);
      } else {
        toast.error('Not saved', caught instanceof Error ? caught.message : undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  const setSignature = async (file: File) => {
    if (!record) return;
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const created = await call<{ id: number }>('attachments.add', {
        ownerType: 'dentist',
        ownerId: record.id,
        fileName: file.name,
        mimeType: file.type || 'image/png',
        description: 'Signature',
        dataBase64,
      });
      await call('dentists.setSignature', { dentistId: record.id, attachmentId: created.id });
      toast.success('Signature image saved');
      onSaved();
    } catch (caught) {
      toast.error('Signature not saved', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const removeSignature = async () => {
    if (!record?.signature_attachment_id) return;
    try {
      await call('dentists.setSignature', { dentistId: record.id, attachmentId: null });
      toast.success('Signature removed');
      onSaved();
    } catch (caught) {
      toast.error('Signature not removed', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <Modal
      open
      title={record ? `Edit ${record.full_name}` : 'New dentist'}
      subtitle="The signature image is printed at the bottom of prescriptions"
      onClose={onClose}
      width={860}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>
            {record ? 'Save changes' : 'Create dentist'}
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        <div className="grid grid-2">
          <TextInput label="Full name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={errors.fullName} />
          <TextInput label="Degree prefix" value={form.degreePrefix} onChange={(e) => setForm({ ...form, degreePrefix: e.target.value })} hint="Printed above the name, e.g. Dr." />
        </div>
        <div className="grid grid-2">
          <TextInput label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} placeholder="e.g. Professor" />
          <TextInput label="Qualifications" value={form.qualifications} onChange={(e) => setForm({ ...form, qualifications: e.target.value })} error={errors.qualifications} placeholder="e.g. BDS, MS" />
        </div>
        <TextInput
          label="Designations"
          value={form.designations}
          onChange={(e) => setForm({ ...form, designations: e.target.value })}
          error={errors.designations}
          hint="Comma separated, e.g. Consultant Endodontist, Ex-Principal"
        />
        <div className="grid grid-2">
          <TextInput label="Registration no." value={form.registrationNo} onChange={(e) => setForm({ ...form, registrationNo: e.target.value })} error={errors.registrationNo} className="mono" />
          <TextInput label="Consultation hours" value={form.consultationHours} onChange={(e) => setForm({ ...form, consultationHours: e.target.value })} error={errors.consultationHours} placeholder="Sat–Thu, 5pm–9pm" />
        </div>
        <div className="grid grid-2">
          <TextInput label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} inputMode="tel" />
          <TextInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        </div>

        <div className="divider" />

        <div>
          <h3 className="section-title">Weekly schedule</h3>
          <p className="text-xs text-3" style={{ marginBottom: 8 }}>Used to warn when an appointment falls outside this dentist&rsquo;s hours.</p>
          <div className="stack stack-2">
            {schedule.map((row, index) => (
              <div className="row row-2" key={row.day}>
                <Checkbox
                  label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][row.day]}
                  checked={row.isOpen}
                  onChange={(e) =>
                    setSchedule((rows) => rows.map((r, i) => (i === index ? { ...r, isOpen: e.target.checked } : r)))
                  }
                />
                <input
                  className="input input--sm num"
                  type="time"
                  value={row.start}
                  disabled={!row.isOpen}
                  onChange={(e) => setSchedule((rows) => rows.map((r, i) => (i === index ? { ...r, start: e.target.value } : r)))}
                  aria-label={`Start time for day ${row.day}`}
                />
                <span className="text-3">to</span>
                <input
                  className="input input--sm num"
                  type="time"
                  value={row.end}
                  disabled={!row.isOpen}
                  onChange={(e) => setSchedule((rows) => rows.map((r, i) => (i === index ? { ...r, end: e.target.value } : r)))}
                  aria-label={`End time for day ${row.day}`}
                />
              </div>
            ))}
          </div>
        </div>

        {record ? (
          <div>
            <h3 className="section-title">Signature image</h3>
            <p className="text-xs text-3" style={{ marginBottom: 8 }}>
              A transparent PNG prints in the signature block of prescriptions. Leave it empty to print just the name.
            </p>
            <div className="row row-2 row-wrap">
              <input
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Signature image"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void setSignature(file);
                  event.target.value = '';
                }}
              />
              {record.signature_attachment_id ? (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => void removeSignature()}>Remove signature</Button>
              ) : null}
              {record.signature_attachment_id ? (
                <Button
                  size="sm"
                  icon="save"
                  onClick={() => void filesBridge().saveAttachment(record.signature_attachment_id as number, app.token)}
                >
                  Save a copy
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ── Users ─────────────────────────────────────────────────────────────── */

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  status: string;
  last_login_at: string | null;
  must_change_password: number;
  created_at: string;
  staff_id: number | null;
  staff_name: string | null;
  roles: string | null;
}

interface RoleRow {
  id: number;
  code: string;
  name: string;
  description: string;
  is_system: number;
  permission_count: number;
  user_count: number;
}

function UserList(): JSX.Element {
  const app = useApp();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 220);
  const [page, setPage] = useState(1);
  const list = useResource(
    () => call<{ rows: UserRow[]; total: number; page: number; pageCount: number; pageSize: number }>('users.list', { search: debounced || undefined, page }),
    [debounced, page],
  );
  const roles = useResource(() => call<RoleRow[]>('roles.list'), []);
  const staff = useResource(() => call<{ rows: StaffRow[] }>('staff.list', { pageSize: 200 }), []);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const toggleStatus = async (row: UserRow) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    const ok = await confirm({
      title: `${next === 'disabled' ? 'Disable' : 'Enable'} ${row.display_name}?`,
      message:
        next === 'disabled'
          ? 'The account can no longer sign in and every open session is ended immediately. Records they created are kept.'
          : 'The account can sign in again with its existing password.',
      tone: next === 'disabled' ? 'danger' : 'default',
      confirmLabel: next === 'disabled' ? 'Disable account' : 'Enable account',
    });
    if (!ok) return;
    try {
      await call('users.update', { id: row.id, displayName: row.display_name, status: next, staffId: row.staff_id ?? undefined });
      toast.success(`Account ${next}`, row.display_name);
      list.reload();
    } catch (caught) {
      toast.error('Not updated', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const unlock = async (row: UserRow) => {
    try {
      await call('users.unlockUser', { id: row.id });
      toast.success('Account unlocked', row.display_name);
      list.reload();
    } catch (caught) {
      toast.error('Not unlocked', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <>
      <Card
        title="User accounts"
        icon="user"
        subtitle="Every sign-in is recorded; permissions come from roles"
        actions={
          app.has('users.manage') ? (
            <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>Add user</Button>
          ) : null
        }
        flush
      >
        <div className="card-head">
          <div className="filter-search">
            <TextInput
              aria-label="Search users"
              placeholder="Search by display name or username…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              icon="search"
              inputSize="sm"
            />
          </div>
          <span className="spacer" />
          <span className="text-sm text-3">{list.data?.total ?? 0} account(s)</span>
        </div>
        <DataTable
          rows={list.data?.rows ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => setEditing(row)}
          columns={[
            {
              key: 'name',
              header: 'User',
              render: (row) => (
                <div className="stack stack-0" style={{ minWidth: 0 }}>
                  <span className="truncate">{row.display_name}</span>
                  <span className="text-xs text-3 mono truncate">{row.username}</span>
                </div>
              ),
            },
            { key: 'roles', header: 'Roles', render: (row) => <span className="truncate">{row.roles ?? '—'}</span> },
            { key: 'staff', header: 'Linked staff', width: 170, render: (row) => <span className="truncate">{row.staff_name ?? '—'}</span> },
            {
              key: 'last',
              header: 'Last sign-in',
              width: 160,
              render: (row) => (row.last_login_at ? relativeTime(row.last_login_at) : <span className="text-3">Never</span>),
            },
            {
              key: 'status',
              header: 'Status',
              width: 130,
              render: (row) => (
                <div className="row row-1">
                  <Badge tone={row.status === 'active' ? 'ok' : 'neutral'}>{row.status}</Badge>
                  {row.must_change_password ? <Badge tone="warn">must reset</Badge> : null}
                </div>
              ),
            },
            {
              key: 'actions',
              header: '',
              width: 150,
              render: (row) =>
                app.has('users.manage') ? (
                  <div className="row row-1 row-end">
                    {row.must_change_password ? (
                      <IconButton icon="lock" label="Reset password" size={15} onClick={() => setResetting(row)} />
                    ) : null}
                    <IconButton icon="edit" label="Edit user" size={15} onClick={() => setEditing(row)} />
                    <IconButton
                      icon={row.status === 'active' ? 'ban' : 'user-check'}
                      label={row.status === 'active' ? 'Disable account' : 'Enable account'}
                      size={15}
                      onClick={() => void toggleStatus(row)}
                    />
                    <IconButton icon="key" label="Unlock account" size={15} onClick={() => void unlock(row)} />
                  </div>
                ) : null,
            },
          ]}
          empty={<div className="state"><div className="state-title">No user accounts</div></div>}
        />
        {(list.data?.pageCount ?? 1) > 1 ? (
          <div className="card-foot">
            <Pagination
              page={list.data?.page ?? 1}
              pageCount={list.data?.pageCount ?? 1}
              total={list.data?.total ?? 0}
              pageSize={list.data?.pageSize ?? 25}
              onPage={setPage}
            />
          </div>
        ) : null}
      </Card>

      {creating || editing ? (
        <UserForm
          record={editing}
          roles={roles.data ?? []}
          staff={staff.data?.rows ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); list.reload(); shell.requestRefresh(); }}
        />
      ) : null}

      {resetting ? <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} onSaved={() => setResetting(null)} /> : null}
    </>
  );
}

function UserForm({
  record, roles, staff, onClose, onSaved,
}: {
  record: UserRow | null;
  roles: RoleRow[];
  staff: StaffRow[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const [form, setForm] = useState({
    username: record?.username ?? '',
    displayName: record?.display_name ?? '',
    password: '',
    staffId: record?.staff_id ? String(record.staff_id) : '',
  });
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!record) return;
    void call<{ roles: { id: number }[] }>('users.get', { id: record.id })
      .then((result) => setRoleIds(result.roles.map((role) => role.id)))
      .catch(() => setRoleIds([]));
  }, [record]);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (record) {
        await call('users.update', {
          id: record.id,
          displayName: form.displayName.trim(),
          status: record.status,
          staffId: form.staffId ? Number(form.staffId) : undefined,
        });
        if (roleIds.length) await call('users.setRoles', { id: record.id, roleIds });
      } else {
        await call('users.create', {
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          password: form.password,
          roleIds,
          staffId: form.staffId ? Number(form.staffId) : undefined,
        });
      }
      toast.success(record ? 'User updated' : 'User created', form.displayName || form.username);
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const issue of caught.issues) map[issue.field] = issue.message;
        setErrors(map);
        toast.error('Not saved', caught.message);
      } else {
        toast.error('Not saved', caught instanceof Error ? caught.message : undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={record ? `Edit ${record.display_name}` : 'New user account'}
      subtitle={record ? 'Usernames cannot be changed' : 'The user must change this password at first sign-in'}
      onClose={onClose}
      width={680}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>
            {record ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        <div className="grid grid-2">
          <TextInput
            label="Username"
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            error={errors.username}
            className="mono"
            disabled={Boolean(record)}
            autoComplete="off"
          />
          <TextInput label="Display name" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} error={errors.displayName} />
        </div>
        {!record ? (
          <TextInput
            label="Temporary password"
            required
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={errors.password}
            autoComplete="new-password"
            hint="Must satisfy the password policy. The user is forced to change it at first sign-in."
          />
        ) : null}
        <Field label="Linked staff record" hint="Links the login to a staff profile so documents and the audit log show one name.">
          <Select
            value={form.staffId}
            onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            options={[{ value: '', label: 'Not linked' }, ...staff.map((row) => ({ value: String(row.id), label: row.full_name }))]}
          />
        </Field>
        <Field label="Roles" required error={errors.roleIds} hint="Permissions are the union of every assigned role.">
          <div className="stack stack-2">
            {roles.map((role) => (
              <Checkbox
                key={role.id}
                label={
                  <span className="row row-1">
                    <strong>{role.name}</strong>
                    <span className="text-xs text-3">{role.description}</span>
                    {role.is_system ? <Badge tone="info">built-in</Badge> : null}
                  </span>
                }
                checked={roleIds.includes(role.id)}
                onChange={(e) =>
                  setRoleIds((ids) => (e.target.checked ? [...ids, role.id] : ids.filter((id) => id !== role.id)))
                }
              />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await call('users.resetPassword', { id: user.id, newPassword: password });
      toast.success('Password reset', `${user.display_name} must choose a new one at next sign-in.`);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'The reset failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Reset password for ${user.display_name}`}
      subtitle="Every open session for this account ends immediately"
      onClose={onClose}
      width={520}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="key" loading={busy} disabled={password.length < 6 || password !== confirm} onClick={() => void submit()}>
            Reset password
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <TextInput label="New password" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <TextInput label="Confirm password" required type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
    </Modal>
  );
}

/* ── Roles ─────────────────────────────────────────────────────────────── */

function RoleList(): JSX.Element {
  const app = useApp();
  const confirm = useConfirm();
  const toast = useToast();
  const list = useResource(() => call<RoleRow[]>('roles.list'), []);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<RoleRow | null>(null);

  const remove = async (row: RoleRow) => {
    const ok = await confirm({
      title: `Delete role "${row.name}"?`,
      message: 'Users assigned to this role must be reassigned first.',
      tone: 'danger',
      confirmLabel: 'Delete role',
    });
    if (!ok) return;
    try {
      await call('roles.delete', { id: row.id });
      toast.success('Role deleted', row.name);
      list.reload();
    } catch (caught) {
      toast.error('Not deleted', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <>
      <Card
        title="Roles and permissions"
        icon="shield"
        subtitle="Permissions are enforced at the service boundary, not only hidden in the interface"
        actions={
          app.has('roles.manage') ? (
            <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>Add role</Button>
          ) : null
        }
        flush
      >
        <DataTable
          rows={list.data ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(row) => setViewing(row)}
          columns={[
            {
              key: 'name',
              header: 'Role',
              render: (row) => (
                <div className="stack stack-0" style={{ minWidth: 0 }}>
                  <span className="row row-1">
                    <span className="truncate">{row.name}</span>
                    {row.is_system ? <Badge tone="info">built-in</Badge> : null}
                  </span>
                  <span className="text-xs text-3 truncate">{row.description}</span>
                </div>
              ),
            },
            { key: 'perms', header: 'Permissions', width: 130, numeric: true, render: (row) => String(row.permission_count) },
            { key: 'users', header: 'Users', width: 100, numeric: true, render: (row) => String(row.user_count) },
            {
              key: 'actions',
              header: '',
              width: 96,
              render: (row) =>
                app.has('roles.manage') && !row.is_system ? (
                  <div className="row row-1 row-end">
                    <IconButton icon="edit" label="Edit role" size={15} onClick={() => setEditing(row)} />
                    <IconButton icon="trash" label="Delete role" size={15} onClick={() => void remove(row)} />
                  </div>
                ) : null,
            },
          ]}
          empty={<div className="state"><div className="state-title">No roles</div></div>}
        />
      </Card>

      {creating || editing ? (
        <RoleForm
          record={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); list.reload(); }}
        />
      ) : null}

      {viewing ? <RoleDetail role={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function RoleDetail({ role, onClose }: { role: RoleRow; onClose: () => void }): JSX.Element {
  const data = useResource(() => call<{ permissions: string[] }>('roles.get', { id: role.id }), [role.id]);
  const byGroup = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of PERMISSION_GROUPS) map.set(group.label, []);
    for (const permission of data.data?.permissions ?? []) {
      const group = PERMISSION_GROUPS.find((g) => g.permissions.includes(permission as Permission));
      map.get(group?.label ?? 'Other')?.push(permission);
    }
    return map;
  }, [data.data]);

  return (
    <Modal open title={`${role.name} — permissions`} subtitle={role.description} onClose={onClose} width={700}>
      <div className="stack stack-3">
        {data.loading ? <div className="skeleton" style={{ height: 200 }} /> : null}
        {[...byGroup.entries()].map(([label, permissions]) =>
          permissions.length === 0 ? null : (
            <div key={label}>
              <div className="caps">{label}</div>
              <ul className="stack stack-1" style={{ marginTop: 6 }}>
                {permissions.map((permission) => (
                  <li key={permission} className="row row-2 text-sm">
                    <Icon name="check" size={14} className="text-ok shrink-0" />
                    <span className="truncate">{PERMISSIONS[permission as Permission] ?? permission}</span>
                    <span className="mono text-xs text-3">{permission}</span>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>
    </Modal>
  );
}

function RoleForm({ record, onClose, onSaved }: { record: RoleRow | null; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!record) return;
    void call<{ permissions: string[] }>('roles.get', { id: record.id })
      .then((result) => setPermissions(result.permissions as Permission[]))
      .catch(() => setPermissions([]));
  }, [record]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (record) await call('roles.update', { id: record.id, name: name.trim(), description, permissions });
      else await call('roles.create', { name: name.trim(), description, permissions });
      toast.success(record ? 'Role updated' : 'Role created', name);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'The role could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={record ? `Edit ${record.name}` : 'New role'}
      subtitle="Tick everything this role should be allowed to do"
      onClose={onClose}
      width={800}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>
            {record ? 'Save role' : 'Create role'}
          </Button>
        </>
      }
    >
      <div className="stack stack-3">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="grid grid-2">
          <TextInput label="Role name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Front desk" />
          <TextInput label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for" />
        </div>
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="row row-2">
              <div className="caps">{group.label}</div>
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  setPermissions((current) => {
                    const all = group.permissions.every((p) => current.includes(p));
                    return all
                      ? current.filter((p) => !group.permissions.includes(p))
                      : [...new Set([...current, ...group.permissions])];
                  })
                }
              >
                {group.permissions.every((p) => permissions.includes(p)) ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-2" style={{ marginTop: 6 }}>
              {group.permissions.map((permission) => (
                <Checkbox
                  key={permission}
                  label={
                    <span className="stack stack-0" style={{ minWidth: 0 }}>
                      <span className="text-sm truncate">{PERMISSIONS[permission]}</span>
                      {ADMIN_ONLY_PERMISSIONS.includes(permission) ? (
                        <span className="text-xs text-warn">Administrator only</span>
                      ) : null}
                    </span>
                  }
                  checked={permissions.includes(permission)}
                  onChange={(e) =>
                    setPermissions((current) =>
                      e.target.checked ? [...current, permission] : current.filter((p) => p !== permission),
                    )
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ── Audit log ─────────────────────────────────────────────────────────── */

interface AuditRow {
  id: number;
  at: string;
  username: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  result: string;
  summary: string;
  ip: string | null;
}

function AuditLog(): JSX.Element {
  const app = useApp();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState('7d');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 250);
  const stats = useResource(
    () => call<{ total: number; failures: number; last24h: number; failedLogins: number }>('audit.stats'),
    [page],
  );
  const list = useResource(
    () =>
      call<{ rows: AuditRow[]; total: number; page: number; pageCount: number; pageSize: number; actions: string[] }>('audit.list', {
        range,
        action: action || undefined,
        search: debounced || undefined,
        page,
      }),
    [range, action, debounced, page],
  );

  return (
    <div className="stack stack-3">
      <Card title="Audit activity" icon="activity" subtitle="Every clinical and financial change, with the user who made it" flush>
        <div className="card-head">
          <div className="filter-search">
            <TextInput
              aria-label="Search audit log"
              placeholder="Search summaries, users or actions…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              icon="search"
              inputSize="sm"
            />
          </div>
          <Select
            aria-label="Date range"
            inputSize="sm"
            value={range}
            onChange={(e) => { setRange(e.target.value); setPage(1); }}
            options={[
              { value: 'today', label: 'Today' },
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: '90d', label: 'Last 90 days' },
              { value: '1y', label: 'Last year' },
              { value: 'all', label: 'All time' },
            ]}
          />
          <Select
            aria-label="Action"
            inputSize="sm"
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            options={[{ value: '', label: 'All actions' }, ...(list.data?.actions ?? []).map((a) => ({ value: a, label: a }))]}
            style={{ width: 220 }}
          />
          <span className="spacer" />
          <span className="text-sm text-3">{list.data?.total ?? 0} entries</span>
        </div>
        <DataTable
          rows={list.data?.rows ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          maxHeight={560}
          columns={[
            { key: 'at', header: 'When', width: 170, render: (row) => dateAndTime(row.at, '', app.prefs) },
            { key: 'user', header: 'User', width: 140, render: (row) => <span className="truncate">{row.username ?? 'system'}</span> },
            { key: 'action', header: 'Action', width: 190, render: (row) => <span className="mono text-xs truncate">{row.action}</span> },
            { key: 'summary', header: 'Detail', render: (row) => <span className="truncate">{row.summary}</span> },
            {
              key: 'result',
              header: 'Result',
              width: 100,
              render: (row) => <Badge tone={row.result === 'failure' ? 'danger' : 'ok'}>{row.result}</Badge>,
            },
          ]}
          empty={<div className="state"><div className="state-title">No entries in this range</div></div>}
        />
        <div className="card-foot">
          <Pagination
            page={list.data?.page ?? 1}
            pageCount={list.data?.pageCount ?? 1}
            total={list.data?.total ?? 0}
            pageSize={list.data?.pageSize ?? 50}
            onPage={setPage}
          />
        </div>
      </Card>

      <Card title="Audit totals" icon="chart">
        <div className="stat-grid stat-grid--compact">
          <StatTile label="Entries" value={stats.data?.total ?? 0} />
          <StatTile label="Last 24 hours" value={stats.data?.last24h ?? 0} />
          <StatTile label="Failures" value={stats.data?.failures ?? 0} tone={stats.data?.failures ? 'danger' : 'ok'} />
          <StatTile label="Failed sign-ins (24h)" value={stats.data?.failedLogins ?? 0} tone={stats.data?.failedLogins ? 'warn' : 'ok'} />
        </div>
      </Card>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'danger' }): JSX.Element {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value mono" style={{ color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'danger' ? 'var(--danger)' : undefined }}>
        {value}
      </span>
    </div>
  );
}

/* ── Login history ─────────────────────────────────────────────────────── */

interface LoginRow {
  id: number;
  at: string;
  attempted: string;
  success: number;
  reason: string;
  display_name: string | null;
}

function LoginHistory(): JSX.Element {
  const app = useApp();
  const [page, setPage] = useState(1);
  const list = useResource(() => call<{ rows: LoginRow[]; total: number; page: number; pageCount: number; pageSize: number }>('usersSecurity.loginHistory', { page }), [page]);

  return (
    <Card title="Sign-in history" icon="key" subtitle="Successful and failed attempts, newest first" flush>
      <DataTable
        rows={list.data?.rows ?? []}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        maxHeight={560}
        columns={[
          { key: 'at', header: 'When', width: 180, render: (row) => dateAndTime(row.at, '', app.prefs) },
          { key: 'attempted', header: 'Username tried', width: 180, render: (row) => <span className="mono text-sm">{row.attempted || '—'}</span> },
          { key: 'who', header: 'Account', render: (row) => <span className="truncate">{row.display_name ?? 'Unknown user'}</span> },
          { key: 'reason', header: 'Reason', render: (row) => <span className="truncate">{row.reason}</span> },
          {
            key: 'result',
            header: 'Result',
            width: 110,
            render: (row) => <Badge tone={row.success ? 'ok' : 'danger'}>{row.success ? 'Success' : 'Failed'}</Badge>,
          },
        ]}
        empty={<div className="state"><div className="state-title">No sign-ins recorded</div></div>}
      />
      <div className="card-foot">
        <Pagination
          page={list.data?.page ?? 1}
          pageCount={list.data?.pageCount ?? 1}
          total={list.data?.total ?? 0}
          pageSize={list.data?.pageSize ?? 50}
          onPage={setPage}
        />
      </div>
    </Card>
  );
}
