import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { call } from '../lib/api';
import { useRoute } from '../app/router';
import { useApp } from '../app/state';
import { Button, EmptyState, IconButton, Spinner } from '../components/ui';
import { Icon } from '../components/Icons';
import { age, date } from '../lib/format';
import { useDebounced } from '../components/ui';

interface PatientHit {
  id: number;
  patient_code: string;
  full_name: string;
  phone: string | null;
  gender: string;
  age_years: number | null;
  age_months: number | null;
  date_of_birth: string | null;
  area: string | null;
  last_visit_at: string | null;
}

/**
 * Type-ahead patient search used by every clinical and financial form.
 * Bengali search works because the same normalised search index backs it.
 */
export function PatientPicker({
  value, label, onChange, autoFocus, placeholder = 'Search by name, code or phone…',
}: {
  value: number | null;
  label: string;
  onChange: (id: number | null, label: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query, 220);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void call<{ rows: PatientHit[] }>('patients.list', { search: debounced.trim() || undefined, pageSize: 8, sort: 'name' })
      .then((result) => {
        if (cancelled) return;
        setResults(result.rows);
        setIndex(0);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (hit: PatientHit) => {
    onChange(hit.id, `${hit.full_name} (${hit.patient_code})`);
    setOpen(false);
    setQuery('');
  };

  const createPatient = async () => {
    if (newName.trim().length < 2) {
      setSaveError('Enter the patient’s name.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const created = await call<{ id: number; patient_code: string }>('patients.create', {
        fullName: newName.trim(),
        phone: newPhone.trim() || undefined,
        gender: 'prefer_not_to_say',
      });
      onChange(created.id, `${newName.trim()} (${created.patient_code})`);
      setOpen(false);
      setQuery('');
      setCreating(false);
      setNewName('');
      setNewPhone('');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The patient could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = results[index];
      if (hit) choose(hit);
      else if (!results.length && newName.trim().length >= 2 && app.has('patients.create')) void createPatient();
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const helper = useMemo(() => (value ? label : 'No patient selected'), [value, label]);

  return (
    <div className="picker" ref={rootRef}>
      <div className={`picker-input ${open ? 'is-open' : ''}`}>
        <Icon name="patients" size={15} />
        <input
          ref={inputRef}
          className="picker-field"
          placeholder={value ? helper : placeholder}
          value={open ? query : ''}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="patient-picker-list"
          aria-label="Patient"
        />
        {loading ? <Spinner label="Searching" /> : null}
        {value ? (
          <IconButton
            icon="x"
            label="Clear patient"
            size={14}
            onClick={() => {
              onChange(null, '');
              setQuery('');
            }}
          />
        ) : null}
      </div>

      {open ? (
        <div className="picker-panel" id="patient-picker-list" role="listbox">
          {results.length === 0 && !loading ? (
            <EmptyState
              icon="patients"
              title={query.trim() ? 'No matching patient' : 'Type to search'}
              text={query.trim() ? 'Check the spelling, or create a new record.' : 'Search by name, patient code or phone number.'}
              compact
            />
          ) : (
            <ul className="picker-list">
              {results.map((hit, i) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === index}
                    className="picker-item"
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(hit)}
                  >
                    <span className="picker-item-main">
                      <span className="truncate">
                        {hit.full_name} <span className="mono text-xs text-3">{hit.patient_code}</span>
                      </span>
                      <span className="text-xs text-3">
                        {age(hit, app.prefs)} · {hit.phone || 'no phone'}
                        {hit.last_visit_at ? ` · last visit ${date(hit.last_visit_at, app.prefs)}` : ' · new patient'}
                      </span>
                    </span>
                    <Icon name="arrow-right" size={14} className="text-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {app.has('patients.create') ? (
            creating ? (
              <div className="picker-create">
                <input
                  className="input input--sm"
                  placeholder="Full name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  aria-label="New patient name"
                  autoFocus
                />
                <input
                  className="input input--sm"
                  placeholder="Phone (optional)"
                  value={newPhone}
                  onChange={(event) => setNewPhone(event.target.value)}
                  aria-label="New patient phone"
                  inputMode="tel"
                />
                <Button size="sm" variant="primary" loading={saving} onClick={() => void createPatient()}>
                  Create
                </Button>
              </div>
            ) : (
              <button type="button" className="picker-create-link" onClick={() => setCreating(true)}>
                <Icon name="user-plus" size={14} /> New patient — “{query.trim()}”
              </button>
            )
          ) : null}

          {saveError ? <p className="field-error picker-error">{saveError}</p> : null}
          {value ? (
            <button type="button" className="picker-open-link" onClick={() => route.navigate(`patients/${value}`)}>
              Open patient record <Icon name="external-link" size={13} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
