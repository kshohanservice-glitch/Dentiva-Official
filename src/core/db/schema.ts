/**
 * Dentiva Pro schema — version 1.
 *
 * Conventions
 * -----------
 *  • All timestamps are ISO-8601 UTC TEXT (`2026-09-27T07:12:33.000Z`).
 *  • All *business* dates (the day a thing happened in clinic time) are separate
 *    `YYYY-MM-DD` columns so day-boundary reports never drift.
 *  • All money is INTEGER poisha (1 BDT = 100 poisha). Never REAL.
 *  • Quantities are INTEGER thousandths (`qty_milli`) so 0.5 steps are exact.
 *  • `deleted_at` implements soft delete; clinical/financial history is never
 *    hard-deleted, only archived.
 */

export const SCHEMA_SQL = `
-- ─────────────────────────── Platform ───────────────────────────
-- NOTE: schema_migrations is created by the migration runner itself, so it is
-- deliberately absent here.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE app_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ─────────────────────────── Security ───────────────────────────

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  category    TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  username              TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  display_name          TEXT NOT NULL DEFAULT '',
  staff_id              INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  failed_count          INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,
  last_login_at         TEXT,
  password_changed_at   TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE user_roles (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attempted    TEXT NOT NULL,
  success      INTEGER NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  at           TEXT NOT NULL
);
CREATE INDEX idx_login_history_at ON login_history(at DESC);
CREATE INDEX idx_login_history_user ON login_history(user_id, at DESC);

-- ─────────────────────────── Clinic / people ───────────────────────────

CREATE TABLE clinic (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  name              TEXT NOT NULL,
  tagline           TEXT NOT NULL DEFAULT '',
  address_line      TEXT NOT NULL DEFAULT '',
  area              TEXT NOT NULL DEFAULT '',
  district          TEXT NOT NULL DEFAULT '',
  thana             TEXT NOT NULL DEFAULT '',
  postcode          TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  alt_phone         TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  website           TEXT NOT NULL DEFAULT '',
  logo_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  footer_message    TEXT NOT NULL DEFAULT '',
  business_start    TEXT NOT NULL DEFAULT '09:00',
  business_end      TEXT NOT NULL DEFAULT '20:00',
  invoice_prefix    TEXT NOT NULL DEFAULT 'INV',
  payment_prefix    TEXT NOT NULL DEFAULT 'PAY',
  updated_at        TEXT NOT NULL
);

CREATE TABLE dentists (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  designations    TEXT NOT NULL DEFAULT '',       -- comma separated
  qualifications  TEXT NOT NULL DEFAULT '',
  registration_no TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  consultation_hours TEXT NOT NULL DEFAULT '',
  signature_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  photo_attachment_id     INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  degree_prefix   TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE staff (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT NOT NULL,
  photo_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  date_of_birth   TEXT,
  gender          TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  blood_group     TEXT NOT NULL DEFAULT '',
  national_id     TEXT UNIQUE,
  position        TEXT NOT NULL DEFAULT '',
  department      TEXT NOT NULL DEFAULT '',
  joining_date    TEXT,
  salary_poisha   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','resigned')),
  notes           TEXT NOT NULL DEFAULT '',
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_staff_name ON staff(full_name);

CREATE TABLE suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  contact_person TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE working_hours (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id  INTEGER REFERENCES dentists(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  is_open     INTEGER NOT NULL DEFAULT 1,
  start_time  TEXT NOT NULL DEFAULT '09:00',
  end_time    TEXT NOT NULL DEFAULT '14:00',
  UNIQUE (dentist_id, day_of_week)
);

CREATE TABLE holidays (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT NOT NULL,
  date_key  TEXT NOT NULL UNIQUE,
  is_closed INTEGER NOT NULL DEFAULT 1,
  notes     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- ─────────────────────────── Patients ───────────────────────────

CREATE TABLE patients (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_code        TEXT NOT NULL UNIQUE,
  full_name           TEXT NOT NULL,
  date_of_birth       TEXT,
  age_years           INTEGER,
  age_months          INTEGER,
  gender              TEXT NOT NULL DEFAULT '' CHECK (gender IN ('','male','female','other','prefer_not_to_say')),
  blood_group         TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  alt_phone           TEXT NOT NULL DEFAULT '',
  emergency_name      TEXT NOT NULL DEFAULT '',
  emergency_phone     TEXT NOT NULL DEFAULT '',
  address             TEXT NOT NULL DEFAULT '',
  area                TEXT NOT NULL DEFAULT '',
  district            TEXT NOT NULL DEFAULT '',
  thana               TEXT NOT NULL DEFAULT '',
  postcode            TEXT NOT NULL DEFAULT '',
  present_complaint   TEXT NOT NULL DEFAULT '',
  medical_history     TEXT NOT NULL DEFAULT '',
  dental_history      TEXT NOT NULL DEFAULT '',
  allergies           TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  photo_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived','deceased')),
  is_favourite        INTEGER NOT NULL DEFAULT 0,
  last_visit_at       TEXT,
  search_blob         TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TEXT NOT NULL,
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at          TEXT
);
CREATE INDEX idx_patients_name ON patients(full_name);
CREATE INDEX idx_patients_created ON patients(created_at DESC);
CREATE INDEX idx_patients_status ON patients(status, deleted_at);
CREATE INDEX idx_patients_blob ON patients(search_blob);

CREATE TABLE patient_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_patient_notes_patient ON patient_notes(patient_id, created_at DESC);

CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL,             -- 'patient' | 'staff' | 'dentist' | 'clinic' | 'expense' | 'visit'
  owner_type    TEXT NOT NULL DEFAULT '',
  owner_id      INTEGER,
  file_name     TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  sha256        TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id);

-- ─────────────────────────── Clinical ───────────────────────────

CREATE TABLE treatment_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE treatments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  category_id         INTEGER REFERENCES treatment_categories(id) ON DELETE SET NULL,
  description         TEXT NOT NULL DEFAULT '',
  default_price_poisha INTEGER NOT NULL DEFAULT 0,
  duration_minutes    INTEGER NOT NULL DEFAULT 30,
  is_active           INTEGER NOT NULL DEFAULT 1,
  is_system           INTEGER NOT NULL DEFAULT 0,
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_treatments_name ON treatments(name);
CREATE INDEX idx_treatments_category ON treatments(category_id, is_active);

CREATE TABLE visits (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id        INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  appointment_id    INTEGER,
  queue_entry_id    INTEGER,
  visit_date        TEXT NOT NULL,
  started_at        TEXT,
  ended_at          TEXT,
  chief_complaint   TEXT NOT NULL DEFAULT '',
  history           TEXT NOT NULL DEFAULT '',
  examination       TEXT NOT NULL DEFAULT '',
  diagnosis         TEXT NOT NULL DEFAULT '',
  treatment_plan    TEXT NOT NULL DEFAULT '',
  procedure_done    TEXT NOT NULL DEFAULT '',
  advice            TEXT NOT NULL DEFAULT '',
  follow_up_date    TEXT,
  notes             TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  created_at        TEXT NOT NULL,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX idx_visits_patient ON visits(patient_id, visit_date DESC, id DESC);
CREATE INDEX idx_visits_dentist_date ON visits(dentist_id, visit_date);
CREATE INDEX idx_visits_date ON visits(visit_date);

CREATE TABLE treatment_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id      INTEGER REFERENCES visits(id) ON DELETE CASCADE,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  treatment_id  INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  name_snapshot  TEXT NOT NULL DEFAULT '',
  tooth_code    TEXT,
  qty_milli     INTEGER NOT NULL DEFAULT 1000,
  unit_price_poisha INTEGER NOT NULL DEFAULT 0,
  performed_by  INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  performed_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','cancelled')),
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_treatment_records_patient ON treatment_records(patient_id, performed_at DESC);
CREATE INDEX idx_treatment_records_visit ON treatment_records(visit_id);

CREATE TABLE tooth_conditions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  dentition    TEXT NOT NULL CHECK (dentition IN ('adult','primary')),
  tooth_code   TEXT NOT NULL,
  condition    TEXT NOT NULL,
  surface      TEXT NOT NULL DEFAULT '',
  severity     INTEGER NOT NULL DEFAULT 1,
  note         TEXT NOT NULL DEFAULT '',
  visit_id     INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  recorded_by  INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  recorded_at  TEXT NOT NULL,
  is_current   INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT
);
CREATE INDEX idx_tooth_current ON tooth_conditions(patient_id, is_current);
CREATE INDEX idx_tooth_tooth ON tooth_conditions(patient_id, dentition, tooth_code);

CREATE TABLE tooth_condition_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_id   INTEGER NOT NULL REFERENCES tooth_conditions(id) ON DELETE CASCADE,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  dentition      TEXT NOT NULL,
  tooth_code     TEXT NOT NULL,
  condition      TEXT NOT NULL,
  surface        TEXT NOT NULL DEFAULT '',
  severity       INTEGER NOT NULL DEFAULT 1,
  note           TEXT NOT NULL DEFAULT '',
  visit_id       INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  recorded_by    INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  recorded_at    TEXT NOT NULL,
  superseded_at  TEXT
);
CREATE INDEX idx_tooth_history_patient ON tooth_condition_history(patient_id, recorded_at DESC);

CREATE TABLE medicines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  form         TEXT NOT NULL DEFAULT '',
  strength     TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  UNIQUE (name, form, strength)
);

CREATE TABLE prescriptions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_no   TEXT NOT NULL UNIQUE,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id          INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentist_id        INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  issued_at         TEXT NOT NULL,
  issue_date        TEXT NOT NULL,
  cc                TEXT NOT NULL DEFAULT '',
  oe                TEXT NOT NULL DEFAULT '',
  re                TEXT NOT NULL DEFAULT '',
  advice            TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  follow_up_date    TEXT,
  status            TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','cancelled')),
  created_at        TEXT NOT NULL,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id, issue_date DESC, id DESC);

CREATE TABLE prescription_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id  INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id      INTEGER REFERENCES medicines(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  form             TEXT NOT NULL DEFAULT '',
  strength         TEXT NOT NULL DEFAULT '',
  dose             TEXT NOT NULL DEFAULT '',
  morning          INTEGER NOT NULL DEFAULT 0,
  afternoon        INTEGER NOT NULL DEFAULT 0,
  evening          INTEGER NOT NULL DEFAULT 0,
  night            INTEGER NOT NULL DEFAULT 0,
  before_food      INTEGER NOT NULL DEFAULT 1,
  duration         TEXT NOT NULL DEFAULT '',
  quantity         TEXT NOT NULL DEFAULT '',
  instructions     TEXT NOT NULL DEFAULT '',
  prn              INTEGER NOT NULL DEFAULT 0,
  extra_instruction TEXT NOT NULL DEFAULT '',
  sort_order       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_prescription_items_rx ON prescription_items(prescription_id, sort_order);

CREATE TABLE referrals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  referred_at     TEXT NOT NULL,
  refer_date      TEXT NOT NULL,
  from_dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  to_dentist_id   INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  to_clinic       TEXT NOT NULL DEFAULT '',
  reason          TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'referred' CHECK (status IN ('referred','followed-up','completed','cancelled')),
  follow_up_date  TEXT,
  outcome         TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_referrals_patient ON referrals(patient_id, refer_date DESC);

-- ─────────────────────────── Scheduling ───────────────────────────

CREATE TABLE appointments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id        INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  appointment_date  TEXT NOT NULL,
  start_time        TEXT NOT NULL,
  duration_minutes  INTEGER NOT NULL DEFAULT 30,
  appointment_type  TEXT NOT NULL DEFAULT 'consultation',
  notes             TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','confirmed','arrived','in_queue','in_progress','completed','cancelled','no_show','rescheduled')),
  visit_id          INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  previous_appointment_id INTEGER,
  created_at        TEXT NOT NULL,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX idx_appt_dentist_date ON appointments(dentist_id, appointment_date, start_time);
CREATE INDEX idx_appt_patient ON appointments(patient_id, appointment_date DESC);
CREATE INDEX idx_appt_date_status ON appointments(appointment_date, status);

CREATE TABLE queue_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id      INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  appointment_id  INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  queue_no        INTEGER NOT NULL,
  queue_date      TEXT NOT NULL,
  arrived_at      TEXT NOT NULL,
  called_at       TEXT,
  started_at      TEXT,
  completed_at    TEXT,
  status          TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','called','in_progress','completed','skipped','cancelled')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_queue_day ON queue_entries(queue_date, dentist_id, queue_no);
CREATE INDEX idx_queue_patient ON queue_entries(patient_id, queue_date DESC);

-- ─────────────────────────── Financial ───────────────────────────

CREATE TABLE payment_methods (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  is_cash     INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE invoices (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no         TEXT NOT NULL UNIQUE,
  patient_id         INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id           INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  issue_date         TEXT NOT NULL,
  due_date           TEXT,
  subtotal_poisha    INTEGER NOT NULL DEFAULT 0,
  discount_poisha    INTEGER NOT NULL DEFAULT 0,
  discount_percent_bp INTEGER NOT NULL DEFAULT 0,
  tax_poisha         INTEGER NOT NULL DEFAULT 0,
  tax_percent_bp     INTEGER NOT NULL DEFAULT 0,
  grand_total_poisha INTEGER NOT NULL DEFAULT 0,
  paid_poisha        INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'unpaid'
                     CHECK (status IN ('unpaid','partial','paid','cancelled')),
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX idx_invoices_patient ON invoices(patient_id, issue_date DESC, id DESC);
CREATE INDEX idx_invoices_date ON invoices(issue_date DESC);
CREATE INDEX idx_invoices_status ON invoices(status, deleted_at);

CREATE TABLE invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  treatment_id  INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  description   TEXT NOT NULL,
  tooth_code    TEXT,
  qty_milli     INTEGER NOT NULL DEFAULT 1000,
  unit_price_poisha INTEGER NOT NULL DEFAULT 0,
  discount_poisha INTEGER NOT NULL DEFAULT 0,
  tax_poisha    INTEGER NOT NULL DEFAULT 0,
  line_total_poisha INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id, sort_order);

CREATE TABLE payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no    TEXT NOT NULL UNIQUE,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  payment_date  TEXT NOT NULL,
  paid_at       TEXT NOT NULL,
  method        TEXT NOT NULL,
  amount_poisha INTEGER NOT NULL,
  type          TEXT NOT NULL DEFAULT 'receipt' CHECK (type IN ('receipt','refund')),
  reference     TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  received_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_payments_patient ON payments(patient_id, paid_at DESC);
CREATE INDEX idx_payments_date ON payments(payment_date DESC, type);

CREATE TABLE payment_allocations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id    INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_poisha INTEGER NOT NULL
);
CREATE INDEX idx_alloc_invoice ON payment_allocations(invoice_id);
CREATE INDEX idx_alloc_payment ON payment_allocations(payment_id);

CREATE TABLE income_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE expense_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE income_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date    TEXT NOT NULL,
  amount_poisha INTEGER NOT NULL,
  category_id   INTEGER REFERENCES income_categories(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'other',
  method        TEXT NOT NULL DEFAULT 'cash',
  description   TEXT NOT NULL DEFAULT '',
  vendor        TEXT NOT NULL DEFAULT '',
  reference     TEXT NOT NULL DEFAULT '',
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_income_date ON income_entries(entry_date DESC);

CREATE TABLE expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date    TEXT NOT NULL,
  amount_poisha INTEGER NOT NULL,
  category_id   INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  method        TEXT NOT NULL DEFAULT 'cash',
  description   TEXT NOT NULL DEFAULT '',
  vendor        TEXT NOT NULL DEFAULT '',
  reference     TEXT NOT NULL DEFAULT '',
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  staff_id      INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_expenses_date ON expenses(entry_date DESC);

-- ─────────────────────────── Inventory ───────────────────────────

CREATE TABLE inventory_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sku                 TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT '',
  unit                TEXT NOT NULL DEFAULT 'pcs',
  min_stock           INTEGER NOT NULL DEFAULT 0,
  expiry_alert_days   INTEGER NOT NULL DEFAULT 60,
  selling_price_poisha INTEGER NOT NULL DEFAULT 0,
  current_stock       INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_inventory_name ON inventory_items(name);

CREATE TABLE inventory_batches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id             INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_no            TEXT NOT NULL DEFAULT '',
  expiry_date         TEXT,
  purchase_date       TEXT,
  supplier_id         INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  unit_cost_poisha    INTEGER NOT NULL DEFAULT 0,
  quantity_received   INTEGER NOT NULL DEFAULT 0,
  quantity_issued     INTEGER NOT NULL DEFAULT 0,
  location            TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_batches_item ON inventory_batches(item_id);
CREATE INDEX idx_batches_expiry ON inventory_batches(expiry_date);

CREATE TABLE inventory_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_id      INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('in','out','adjust','dispose')),
  quantity      INTEGER NOT NULL,
  unit_cost_poisha INTEGER NOT NULL DEFAULT 0,
  reference     TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  invoice_item_id INTEGER REFERENCES invoice_items(id) ON DELETE SET NULL,
  performed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  performed_at  TEXT NOT NULL
);
CREATE INDEX idx_inv_tx_item ON inventory_transactions(item_id, performed_at DESC);
CREATE INDEX idx_inv_tx_date ON inventory_transactions(performed_at DESC);

-- ─────────────────────────── Platform data ───────────────────────────

CREATE TABLE notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','error')),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  entity       TEXT NOT NULL DEFAULT '',
  entity_id    INTEGER,
  action_route TEXT NOT NULL DEFAULT '',
  dedupe_key   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  read_at      TEXT,
  dismissed_at TEXT
);
CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key <> '' AND dismissed_at IS NULL;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

CREATE TABLE audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  user_id      INTEGER,
  username     TEXT NOT NULL DEFAULT '',
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL DEFAULT '',
  entity_id    TEXT NOT NULL DEFAULT '',
  result       TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
  summary      TEXT NOT NULL DEFAULT '',
  metadata     TEXT NOT NULL DEFAULT '{}',
  machine      TEXT NOT NULL DEFAULT '',
  session_id   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_audit_at ON audit_logs(at DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id, at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE printer_profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  doc_kind      TEXT NOT NULL,
  printer_name  TEXT NOT NULL DEFAULT '',
  paper_id      TEXT NOT NULL DEFAULT 'a4',
  paper_width_mm  REAL NOT NULL DEFAULT 210,
  paper_height_mm REAL NOT NULL DEFAULT 297,
  margin_top_mm    REAL NOT NULL DEFAULT 10,
  margin_right_mm  REAL NOT NULL DEFAULT 10,
  margin_bottom_mm REAL NOT NULL DEFAULT 10,
  margin_left_mm   REAL NOT NULL DEFAULT 10,
  orientation  TEXT NOT NULL DEFAULT 'portrait',
  font_scale   REAL NOT NULL DEFAULT 1,
  copies       INTEGER NOT NULL DEFAULT 1,
  show_clinical_footer INTEGER NOT NULL DEFAULT 1,
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_printer_profiles_unique ON printer_profiles(name, doc_kind);

CREATE TABLE backups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('manual','automatic','pre-restore')),
  folder        TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','failed','restored')),
  error         TEXT NOT NULL DEFAULT '',
  app_version   TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  restored_at   TEXT
);
CREATE INDEX idx_backups_created ON backups(created_at DESC);

CREATE TABLE print_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_kind      TEXT NOT NULL,
  entity_id     INTEGER,
  entity_label  TEXT NOT NULL DEFAULT '',
  output        TEXT NOT NULL DEFAULT 'preview' CHECK (output IN ('preview','print','pdf')),
  paper_id      TEXT NOT NULL DEFAULT 'a4',
  path          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_print_history_created ON print_history(created_at DESC);

CREATE TABLE drafts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner         TEXT NOT NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  entity_id     INTEGER,
  payload       TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_drafts_unique ON drafts(user_id, kind, COALESCE(entity_id, 0));

-- Quarterly_clinical summary view used by the dashboard and patient profile.
CREATE VIEW patient_financials AS
SELECT
  p.id AS patient_id,
  COALESCE((SELECT SUM(i.grand_total_poisha) FROM invoices i
             WHERE i.patient_id = p.id AND i.deleted_at IS NULL AND i.status <> 'cancelled'), 0) AS total_billed_poisha,
  COALESCE((SELECT SUM(i.paid_poisha) FROM invoices i
             WHERE i.patient_id = p.id AND i.deleted_at IS NULL AND i.status <> 'cancelled'), 0) AS total_paid_poisha
FROM patients p;

CREATE VIEW current_tooth_chart AS
SELECT patient_id, dentition, tooth_code, condition, surface, severity, note, recorded_at, visit_id
FROM tooth_conditions
WHERE is_current = 1;
`;
