# Dentiva Pro — Database

The database is a single SQLite file on the clinic's own disk. There is no server, no replication and
no connection string to configure. This document describes what is stored, how money is stored, and
how the schema changes over time.

---

## 1. Location

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\Dentiva Pro\dentiva.db` |
| Development | `$DENTIVA_DATA_DIR`, or a temporary directory in tests |

The folder also holds `attachments/`, `exports/`, `backups/`, `cache/` and `logs/`. Settings →
Storage shows the exact path, and so does the Diagnostics panel, so a clinic never has to guess
where its records are.

The engine is `node-sqlite3-wasm` — SQLite compiled to WebAssembly, loaded from the local
application directory. It needs no compiler, no service and no network, and it writes a real,
standards-conforming SQLite file that any other SQLite tool can open.

---

## 2. Money and quantities

**No floating-point value is used for money anywhere.** Every amount is an `INTEGER` count of poisha,
where `৳1.00` is `100`.

| Concept | Column suffix | Storage | Example |
|---|---|---|---|
| Money | `_poisha` | integer | `৳7,500.00` → `750000` |
| Quantity | `_milli` | integer | `2.5` units → `2500` |
| Percentage | `PercentBp` | integer basis points | 10% → `1000` |
| Rate/charge | `_bp` | integer basis points | 5% VAT → `500` |

`৳` amounts that arrive as text from a form are parsed by `parseMoneyInput`, which rejects anything
ambiguous rather than guessing. There is no `REAL` money column in the schema, and the contract test
suite asserts that every amount crossing an operation boundary is a whole number of poisha.

Rounding happens once, at the end of a calculation, half-up, in `src/core/money/money.ts`. An invoice
total is computed from integer line amounts, reduced by an integer discount, increased by integer tax,
and rounded once — never step by step.

---

## 3. Text and Bengali

All text is stored as UTF-8. Bengali is stored exactly as it is typed: no transliteration, no
normalisation that would decompose conjuncts, no length limit measured in bytes.

- Patient names, addresses and complaints keep Bengali script.
- Search uses `LIKE` with `COLLATE NOCASE`, which matches Bengali by code point, so a receptionist
  typing `কামাল` finds `কামাল`.
- Bengali numerals are a **display** choice. `৳7,500.00` and `৳৭,৫০০.০০` are the same stored number;
  Settings → Preferences decides which one appears.
- The dental chart stores tooth numbers and FDI notation, never tooth names, so a chart is
  language-independent and printable in either script.

`tests/ui/print.test.tsx` asserts that Bengali written into the database comes back code-point for
code-point, and that every Bengali run in a printed document is inside a styled span so the right font
is applied.

---

## 4. Tables

48 tables in eight groups.

### Platform

| Table | Holds |
|---|---|
| `settings` | Clinic preferences, feature toggles, activation state, printer defaults |
| `app_state` | Small key/value state that must survive a restart and must not pollute `settings` |
| `print_history` | What was printed, by whom, when, and whether it succeeded |

### Identity and access

| Table | Holds |
|---|---|
| `users` | Username, scrypt hash, display name, status, failed count, lockout, must-change-password |
| `roles` | Named role, its description, whether it is a system role |
| `permissions` | The 46 permission keys with their human labels |
| `role_permissions` | Which role holds which permission |
| `user_roles` | Which user holds which role (a user may hold more than one) |
| `sessions` | Live session tokens with issue and expiry times |
| `login_history` | Sign-in attempts, successful and failed, for the security panel |

There is no password column anywhere else, and no password hash is ever logged, exported, or included
in a backup manifest.

### Clinic

| Table | Holds |
|---|---|
| `clinic` | The single clinic row: identity, contact, footer, business hours, logo |
| `dentists` | Practising dentists, degrees, registration numbers, consultation hours, signature image |
| `staff` | Non-dentist staff: reception, assistants, hygienists |
| `suppliers` | Inventory suppliers |
| `working_hours` | Per-weekday opening hours |
| `holidays` | Closed days and one-off holidays |

### Patients and clinical

| Table | Holds |
|---|---|
| `patients` | Demographics, contact, address, medical and dental history, allergies, flags |
| `patient_notes` | Free clinical notes, dated and attributed |
| `attachments` | X-rays and scans: stored name, original name, MIME type, size, hash, owning entity |
| `visits` | A visit: date, dentist, complaint, findings, diagnosis, treatment plan, next visit |
| `treatment_categories` | Catalogue grouping |
| `treatments` | The treatment catalogue: code, name, default price, duration |
| `treatment_records` | What was actually done at a visit: tooth, surface, treatment, material, cost |
| `tooth_conditions` | The current state of each tooth per patient |
| `tooth_condition_history` | Every change to a tooth's state, with the date and who recorded it |
| `medicines` | The medicine catalogue, with form and strength |
| `prescriptions` | The prescription header: patient, dentist, complaint, findings, advice, status |
| `prescription_items` | Each medicine: name, dose, timing slots, duration, instructions |
| `referrals` | Referrals out to a specialist, and back |

Every clinical table uses `deleted_at`, never a hard delete. A deleted record disappears from the
interface but stays in the database, so the history of a patient's mouth is never lost to a misclick.

### Scheduling

| Table | Holds |
|---|---|
| `appointments` | Booked slot: patient, dentist, date, start, duration, type, status |
| `queue_entries` | The live waiting room: called at, waiting since, status, and the visit it created |

### Billing

| Table | Holds |
|---|---|
| `invoices` | Header: number, patient, date, discount, tax, subtotal, grand total, status |
| `invoice_items` | Each line: treatment, description, quantity, unit price, line total |
| `payments` | Money received or refunded: number, patient, date, method, type, amount |
| `payment_allocations` | Which invoice each payment settled, and how much |
| `payment_methods` | Configured methods (cash, bKash, Nagad, card, bank, cheque) with ordering |
| `income_categories`, `expense_categories` | Ledger categories |
| `income_entries`, `expenses` | The accounting ledger |

A payment is allocated to invoices belonging to the same patient — enforced in the service layer, not
in the form. A patient cannot pay off another patient's bill by accident, and overpayment is rejected
unless a refund is recorded against it.

### Inventory

| Table | Holds |
|---|---|
| `inventory_items` | Catalogue: name, unit, category, reorder point, sale price |
| `inventory_batches` | Stock by batch: quantity received, remaining, unit cost, expiry, supplier |
| `inventory_transactions` | Every movement: in, out, adjustment, wastage, with a reason |

Stock on hand is the sum of remaining batch quantities. Cost valuation uses the actual batch costs
(FIFO), not the catalogue price, so a margin report is a margin report.

### Audit

| Table | Holds |
|---|---|
| `audit_logs` | Who did what, to which entity, when, with the result and a summary |
| `notifications` | In-app alerts, with a dedupe key so the same alert is not repeated |
| `drafts` | Unsaved form state, so a locked or closed window does not lose work |

The audit log is append-only. Nothing in the application updates or deletes a row in it.

---

## 5. Referential integrity

Foreign keys are declared on every relationship and `PRAGMA foreign_keys = ON` is set on every
connection. Deletion is restricted or nullified deliberately:

- Deleting a patient is a soft delete; clinical history stays reachable through the patient's record.
- Deleting a role with users attached is refused; reassign the users first.
- Deleting a treatment used on an invoice is refused; deactivate it instead.
- Deleting an attachment referenced by a clinical record is refused unless the record permits it.
- Attachments are deleted by marking `deleted_at` and removing the file, and the removal is audited.

`PRAGMA integrity_check` runs at startup and on demand from Settings → Maintenance, and the result is
surfaced in the status the application shows.

---

## 6. Migrations

Migrations live in `src/core/db/migrations.ts` as an ordered list. Each one has a version, a name, its
SQL, and a SHA-256 checksum of that SQL.

- A database records which migrations it has run in `app_state`.
- On startup, pending migrations are applied in version order, each in its own transaction.
- If a migration's recorded checksum does not match the checksum in this build, the application stops
  and says so, rather than running a different change than the one the database was built with.
- Migrations are never edited after release. A change that has shipped gets a new version.

There are two migrations so far:

| Version | Name | Change |
|---|---|---|
| 1 | `initial_schema` | The full 48-table schema |
| 2 | `queue_entry_visit_link` | `queue_entries.visit_id`, so a queue entry can link to the visit it created |

Migrations are covered by a test that builds a version 1 database, applies version 2, and checks the
new column exists and existing rows are intact.

---

## 7. Concurrency and durability

- One process, one connection, so there is no write contention to resolve.
- `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL`, which is the right trade for a
  single-user desktop application: a crash loses at most the last few transactions, and a power cut
  cannot corrupt the file.
- `PRAGMA foreign_keys = ON` on every connection.
- Multi-row writes that must succeed or fail together — an invoice and its lines, a payment and its
  allocations, a backup and its manifest — run inside `db.transaction()`.

---

## 8. Backups

`BackupService` writes a timestamped folder containing a copy of the database, the `attachments/`
directory, and a `manifest.json` describing what was included, its checksums, and the schema version.

- A backup can be validated before it is restored; the checksums are checked first.
- Restore refuses to run against a manifest it does not recognise.
- Attachments are restored only from paths named in the manifest, so a tampered manifest cannot make
  the application read outside the backup folder.
- Automatic backups run on the configured schedule and keep the configured number of generations.

See [ADMIN-GUIDE.md](ADMIN-GUIDE.md) for the operational procedure.

---

## 9. Inspecting the database

The file is ordinary SQLite, so a clinic's own IT person can look at it with any SQLite tool. It is
encrypted at rest only in the sense that the operating system's own file protection applies — Dentiva
Pro does not implement database encryption, and does not pretend to. For a machine that is already
protected by a Windows login and disk encryption, this is a deliberate choice rather than an oversight;
it is recorded here so nobody is surprised.
