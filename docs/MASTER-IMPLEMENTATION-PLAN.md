# Dentiva Pro — Master Implementation Plan

> **Status:** Approved for implementation
> **Owner:** Shohan Khan &lt;helloiamshohan@gmail.com&gt;
> **Product:** Dentiva Pro 1.0.0 — offline-first Dental Clinic / Dental Practice Management System for Windows
> **Target markets:** Dental clinics in Bangladesh (currency BDT / ৳, Bengali Unicode support mandatory)

---

## 0. Executive summary

Dentiva Pro is a commercial, **fully offline**, single-machine Windows desktop application for a dental
clinic. It covers the complete clinic lifecycle: first-run setup and activation, patient records,
clinical documentation (visits, dental chart, treatments, prescriptions), scheduling and queue
management, invoicing and payments, inventory, accounting, staff and user administration with
granular RBAC, audit logging, search, notifications, printing, PDF export, backup/restore, and
reporting.

The application is a **3-tier desktop application**:

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Renderer (React 19 + TypeScript)  — presentation only, zero DB access    │
└───────────────▲───────────────────────────────────────────┬───────────────┘
                │ invoke('dentiva', { channel, payload })    │
┌───────────────┴───────────────────────────────────────────▼───────────────┐
│  Transport: Electron IPC (production)   |   local HTTP (dev + automated)  │
└───────────────▲───────────────────────────────────────────┬───────────────┘
                │                                           │
┌───────────────┴───────────────────────────────────────────▼───────────────┐
│  Core — services (business rules, permissions, money math, audit)         │
│  Repositories → SQLite (node-sqlite3-wasm) · Money · Auth · RBAC · Log     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Why Electron:** it embeds Chromium, which is the single best available *offline* print/PDF
engine on Windows. Dental prescriptions and invoices must render Bengali text with correct shaping
and ligatures, adapt to A4/A5/Mini/Thermal/custom paper, and produce byte-identical layout between
on-screen preview, `printToPDF`, and physical printing. Chromium gives one HTML/CSS pipeline for
all three, which no other reachable Windows stack does. Electron is MIT-licensed, offline, and
mature.

**No cloud, no paid services, no internet at runtime.** All data lives in a local SQLite file inside
the user data directory.

---

## 1. Product architecture

| Concern | Decision |
| --- | --- |
| Form factor | Single-window Windows desktop app (x64), 1 instance enforced |
| Data locality | One SQLite file + one attachment folder under `%APPDATA%\Dentiva Pro` |
| Multi-user | Multiple local user accounts with role-based permissions (not OS accounts) |
| Concurrency | Single-process owner of the DB; all writes serialised in a transaction queue |
| Offline guarantee | Zero network calls in any runtime code path (enforced by test + lint rule) |
| Currency | BDT only, integer **poisha** (1 BDT = 100 poisha) — never float |
| Language | English UI; Bengali accepted and correctly rendered everywhere data is entered/printed |
| Lifecycle | First run → Setup wizard → Activation → Login → Shell |

### Module map (sidebar)

| Group | Items |
| --- | --- |
| PRACTICE | Dashboard, Patients, Appointments, Queue |
| CLINICAL | Treatments, Prescriptions |
| BILLING | Invoice, Payments, Inventory, Accounting |
| ADMINISTRATION | Staff & Users, Backup & Restore, Settings, About |

Every sidebar entry maps to a real route with a real service; there are no decorative entries.

---

## 2. Technology selection and justification

| Layer | Choice | Version | License | Justification |
| --- | --- | --- | --- | --- |
| Desktop shell | Electron | 38.x | MIT | Chromium print/PDF engine, offline-first, mature, single toolchain for preview+print+PDF |
| Language | TypeScript (strict) | 5.9 | Apache-2.0 | Static guarantees on financial/permission code; single language across tiers |
| UI runtime | React | 19.2 | MIT | Mature concurrent renderer, small API surface, excellent accessibility semantics |
| Build tool | Vite | 7.1 | MIT | Fast renderer bundling, first-class TS/React, ESM |
| Database | SQLite via `node-sqlite3-wasm` | 3.4x (SQLite) / 0.8.x (wrapper) | SQLite: public domain / wrapper: MIT | Real ACID relational DB, single file, FK enforcement, **pure WASM → zero native modules → cross-platform packaging without a C++ toolchain**, synchronous API keeps the service layer simple and testable in plain Node |
| ORM / data access | Hand-written repositories + a thin query helper | — | — | The schema is ~40 tables with heavy aggregation; a hand-rolled repository layer is smaller, faster, fully typed, and avoids an ORM's runtime and migration baggage. **No ORM.** |
| State management | React Context + typed async data cache (`useResource`) | — | MIT | Server-state cache with invalidation; no Redux. Keeps bundle and complexity down. |
| Money | Integer poisha + `Money` value object | — | — | Exact arithmetic, round-half-up only at documented points, no float drift |
| Password hashing | `node:crypto` scrypt (N=2¹⁵, r=8, p=1, 32-byte salt, 64-byte key) | — | MIT | Memory-hard KDF, no native/3rd-party dependency, offline, NIST SP 800-132 compliant |
| Activation | HMAC-SHA256 verifier + canonicaliser, obfuscated constants | — | — | Fixed offline code; see §14 and §Security |
| PDF | Chromium `webContents.printToPDF` | — | — | Same renderer as print; full font embedding, Bengali shaping |
| Printing | Chromium `webContents.print` (silent + preview) | — | — | Native Windows printer enumeration, paper sizes, wireless/Bluetooth printers |
| Styling | Hand-authored design system (CSS custom properties + tokens) | — | — | Full control over the premium visual identity; zero runtime CSS dependency |
| Bundled fonts | Noto Sans Bengali (OFL 1.1) + Noto Sans/Inter (OFL 1.1) | — | OFL-1.1 | Guarantees Bengali rendering + PDF embedding regardless of installed Windows fonts |
| Installer | electron-builder → NSIS | 26.x | MIT | Per-user/per-machine install, shortcuts, upgrade-safe, uninstall without data loss |
| Unit/integration tests | Vitest | 3.2 | MIT | Fast, native TS, projects for unit vs integration |
| UI/E2E tests | Playwright (Chromium) + jsdom component tests | 1.56 | Apache-2.0 | Real browser E2E in CI; jsdom tests run everywhere |
| Static analysis | TypeScript `strict` + ESLint 9 flat config | 5.9 / 9.x | — | Enforced in CI as a release gate |
| CI/CD | GitHub Actions (`ubuntu-latest` CI, `windows-latest` release) | — | — | Windows runner is required for a genuine Windows installer |
| Logging | Structured JSON line logger with rotation | — | — | Separate app / error / security streams, secret redaction |

### Explicitly rejected

| Rejected | Reason |
| --- | --- |
| .NET MAUI / WPF / WinUI 3 | Windows-only build toolchain; cannot be produced or validated in this environment; adds .NET runtime dependency to installers |
| Tauri | Windows cross-compilation unsupported; Rust toolchain not present |
| PyInstaller | Cannot cross-compile to Windows; packaging fidelity poor for an Electron-class app |
| Firebase / Supabase / MongoDB Atlas / AWS | Banned by requirement §75; breaks offline-first |
| Node `better-sqlite3` | Requires a native C++ build per target platform; breaks Linux→Windows packaging |
| Redux / MobX | Unnecessary state layer for a single-window app |
| Tailwind / MUI / AntD | Imposes a visual identity that would compromise the premium bespoke design; heavy runtime |
| Paywalled PDF/OCR/medical APIs | Banned by §75 |

---

## 3. Application architecture

### 3.1 Layers

1. **`src/core` — domain (no Electron, no React, no DOM).** Pure, fully testable in Node.
   * `db/` — connection, pragmas, migration runner, schema SQL
   * `repositories/` — one repository per aggregate, all SQL lives here
   * `services/` — business rules; **this is the permission boundary**
   * `security/` — password hashing, session/auto-lock policy, activation verifier, RBAC
   * `money/` — `Money`, `MoneyMath`, formatting (English + Bengali numerals)
   * `audit/` — audit writer
   * `log/` — structured logger with redaction
   * `errors/` — typed error taxonomy mapped to user-safe messages
2. **`src/main` — Electron host.** Window lifecycle, single-instance lock, secure `BrowserWindow`
   (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP, navigation blocking,
   external-link allow-list), IPC channel registry, print/PDF service, attachment vault, backup &
   restore engine, auto-lock watcher, single-file bundling of core+main.
3. **`src/renderer` — React app.** Design system, shell, pages, print documents. Talks only through
   the typed service bridge.

### 3.2 Transport abstraction (the key testability decision)

`core` exposes a single `ServiceContainer` with a flat, typed map of **operations**
(`patients.list`, `invoices.create`, …). Two transports bind to the same container:

| Transport | Used by | Implementation |
| --- | --- | --- |
| Electron IPC | Production | `preload.ts` exposes `window.dentiva.invoke(op, input)` over `ipcRenderer.invoke`; main routes to the container |
| Local HTTP | Development preview + browser E2E | `scripts/dev-api.ts` serves the built renderer and `POST /api/invoke` on `127.0.0.1`, Vite proxies `/api` |

Consequences: the entire product (all 40+ screens' business logic) runs and is testable **without an
Electron binary**, and the production binary reuses the identical code path — there is no
"dev-only behaviour" divergence that could make a release differ from what was tested.

### 3.3 Concurrency

SQLite allows a single writer. All mutating operations go through a serialised async queue
(`SerialExecutor`) inside the container; reads run concurrently. Every multi-statement mutation is
wrapped in `BEGIN IMMEDIATE … COMMIT` with rollback on throw, so a crash can never leave a
half-written financial record.

---

## 4. Folder / module architecture

```
dentiva-pro/
├─ build/                     icons, NSIS extras, release metadata
├─ docs/                      all required documentation
├─ scripts/                   dev-api server, seed, packaging, stress test
├─ src/
│  ├─ core/
│  │  ├─ index.ts             createContainer(): wires db, repos, services, audit
│  │  ├─ container.ts         operation registry (the single RPC surface)
│  │  ├─ operations.ts        typed operation map
│  │  ├─ db/{connection,migrations,schema}.ts
│  │  ├─ repositories/*.ts
│  │  ├─ services/*.ts
│  │  ├─ security/{password,activation,rbac,session}.ts
│  │  ├─ money/{money,format}.ts
│  │  ├─ audit/audit.ts
│  │  ├─ log/logger.ts
│  │  ├─ validation/*.ts
│  │  └─ errors.ts
│  ├─ main/                   Electron host: window, ipc, print, files, backup, autolock
│  ├─ renderer/               React UI (app shell, pages, components, styles, print docs)
│  └─ shared/                 types + constants shared by every tier
├─ tests/{unit,integration,e2e}/
├─ .github/workflows/{ci,release}.yml
└─ dist/                      FINAL RELEASE ARTIFACT (Dentiva-Pro-Setup-1.0.0.exe)
```

---

## 5. Database architecture

**Engine:** SQLite 3, file `dentiva.db`, `journal_mode=WAL`, `foreign_keys=ON`,
`synchronous=NORMAL`, `busy_timeout=5000`, `temp_store=MEMORY`.

**Migrations:** ordered, immutable SQL files applied by a runner that records
`schema_migrations(version, name, checksum, applied_at)`. A changed checksum aborts startup with a
clear message. Version target: `1.0.0` → `schema_version = 1`.

**Money columns:** every monetary column is `INTEGER` **poisha**. Display formatting converts to
`৳ 1,250.00`.

**Timestamps:** `TEXT` ISO-8601 UTC (`2026-09-27T07:12:33.000Z`); local business dates are separate
`TEXT` columns in clinic-local `YYYY-MM-DD` so day-boundary reports never drift across timezones.

**Soft delete:** `deleted_at TEXT NULL` on clinical/financial entities. Lists filter
`deleted_at IS NULL`; archives remain queryable for audit and reconciliation.

### 5.1 Entity map

| Group | Tables |
| --- | --- |
| Security | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `login_history`, `sessions` |
| Clinic | `clinic`, `dentists`, `staff`, `suppliers`, `working_hours`, `holidays` |
| Patients | `patients`, `patient_notes`, `patient_attachments`, `patient_merges` |
| Clinical | `visits`, `visit_treatments`, `tooth_conditions`, `tooth_condition_history`, `treatments`, `treatment_categories`, `prescriptions`, `prescription_items`, `medicines`, `referrals` |
| Scheduling | `appointments`, `queue_entries` |
| Financial | `invoices`, `invoice_items`, `payments`, `payment_allocations`, `payment_methods`, `expenses`, `expense_categories`, `income_entries`, `income_categories` |
| Inventory | `inventory_items`, `inventory_batches`, `inventory_transactions` |
| Platform | `settings`, `audit_logs`, `notifications`, `printer_profiles`, `backups`, `attachments` |

### 5.2 Referential integrity rules

* `ON DELETE RESTRICT` for clinical history (visits, treatments, invoices, payments, audit).
* `ON DELETE CASCADE` only for pure join/child rows (permission maps, invoice line items on a
  never-invoiced draft, notification read-state).
* Deleting a patient with history is **impossible**; the UI offers *Archive*, and the
  `patients.delete` permission is additionally gated by a "clean record" check.
* A patient with an outstanding balance can be archived but not purged.
* `UNIQUE` on: `patients.patient_code`, `users.username`, `staff.national_id`,
  `invoices.invoice_no`, `treatment_codes`, `inventory_items.sku`, `audit` index targets.

---

## 6. UI/UX architecture

See `docs/DESIGN-SYSTEM.md` (produced in Phase 2) for the full token set. Summary:

* **Theme:** calm clinical light theme; a dark theme is available in Settings. Both are token-driven
  (no component-level colour literals).
* **Density:** comfortable / compact, applied through `--row-h` / `--pad-*` tokens.
* **Shell:** fixed 56px top bar + collapsible 248px/64px left rail; the rail is part of the grid so
  it can never overlap content.
* **Grids:** all card grids use balanced column counts (3+3, 4+4, 2+2) — never accidental 4+2 or 5+1.
* **Every screen implements:** Loading (skeleton), Empty (icon + explanation + primary/secondary
  action), Error (message + retry + diagnostics link for admins), Success (toast), Populated.
* **Motion:** 120–180ms, transform/opacity only; fully disabled under `prefers-reduced-motion` and
  under the Settings "Animations: off" switch.
* **Accessibility:** full keyboard operation, visible 2px focus ring on every interactive element,
  logical tab order, ≥4.5:1 body contrast, ARIA roles on all composite widgets, tables with scoped
  headers.
* **Window behaviour:** content is fluid between 1180px and 2560px; at 1280×720 the rail auto-
  collapses to icons and secondary columns stack; modals are capped at `min(920px, 92vw)` with an
  internal scroll region; every scroll region actually scrolls.

---

## 7. Security architecture

| Threat | Control |
| --- | --- |
| Weak passwords | scrypt N=2¹⁵ r=8 p=1, 16-byte random salt, constant-time compare; configurable minimum length (default 8) and complexity policy |
| Credential stuffing | 5 failed attempts → 60s lockout, exponential back-off, `login_history` records every attempt |
| Privilege escalation | Every operation is registered in a permission map; the container checks the permission *before* the service runs. UI hiding is cosmetic only. |
| Financial data exposure | `accounting.view`, `payments.view`, `invoices.view` are separate permissions, checked in `services/financial.ts` at the operation boundary |
| SQL injection | 100% parameterised statements; no string interpolation of values anywhere (enforced by ESLint `no-restricted-syntax` on `db.prepare` templates) |
| Path traversal | Attachment/backup paths resolved with `path.resolve` + containment assertion against the vault root; filenames sanitised to `[A-Za-z0-9._-]` |
| Unsafe file upload | Extension + magic-byte allow-list, 25 MB cap, stored outside any executable path, never executed, `Content-Disposition: attachment` on export |
| Backup tampering | Backup = `manifest.json` (schema version, created-at, SHA-256 of payload, app version) + `data.db` + `attachments.zip`; restore validates checksum and app version **before** touching live data |
| Destructive actions | Typed `DangerLevel` on operations; `destructive` operations require `permission`, an explicit confirmation token carrying the target identifier, and (for `system.wipe`) the literal word `DELETE` |
| Secret leakage | Central logger redacts `password`, `passcode`, `activation`, `token`, `secret`; stack traces never reach the UI; About/activation screens never echo the code |
| Renderer compromise | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, `will-navigate`/`setWindowOpenHandler` blocked except `https:` links opened in the OS browser, no remote module |
| Update tampering | Release artifacts are SHA-256 hashed in CI and checksum published with the release |
| Privilege | The app runs as a normal user; it never requests elevation, never writes outside its data dir, never installs services |

---

## 8. Authentication architecture

```
App start ──▶ DB missing?  ──▶ Setup Wizard (creates clinic, dentist, admin, settings) ──▶ Activation gate
              │                                                                              │
              └─ DB present ──▶ Activation gate ──▶ Login screen ──▶ session ──▶ Shell
```

* **Session:** random 32-byte token stored in `sessions` with `issued_at`, `expires_at`,
  `last_seen_at`, `user_id`, `failed_count`, `locked_until`. The token lives only in memory in the
  renderer and in the SQLite row; it is never written to disk in plaintext beyond the DB (which is
  already access-controlled by the OS user).
* **Auto-lock:** configurable 5/10/15/30 min or never. Locks the window into a lock screen that
  requires password re-entry. The process keeps running, so unsaved drafts are not lost.
* **Session timeout:** absolute 12 h cap, re-authentication required.
* **Password policy:** min length 8 (configurable 6–32), must not equal the username, must not equal
  any of the last 5 passwords.
* **Forgot password:** intentionally **not** implemented — a local offline app has no recovery
  channel. The UI states this explicitly and directs the user to the admin account. This is a
  deliberate documented decision, not a stub.

---

## 9. RBAC architecture

* `permissions` is a fixed catalogue of ~40 atomic permission codes (seeded, immutable).
* `roles` are user-definable; the three seeded roles are `Administrator`, `Dentist`, `Receptionist`,
  plus `Accountant`.
* `role_permissions` maps roles → permissions. `users → user_roles → roles → permissions`.
* Users with `*` (Administrator) bypass explicitly.
* The container resolves the caller's permission set **once per invocation** and passes it into the
  service; services call `requirePermission(ctx, 'patients.delete')` at the top of the operation.
  Navigation, buttons, and routes are all derived from the same map, so hiding a button and refusing
  the action can never disagree.
* 8 high-risk permissions are additionally guarded by a "requires admin role" rule:
  `users.manage`, `roles.manage`, `backup.create`, `backup.restore`, `system.settings`,
  `system.wipe`, `audit.view`, `patients.delete`.

---

## 10. Backup / restore architecture

**Layout** (user-selected folder, default `%USERPROFILE%\Documents\Dentiva Pro Backups`):

```
DentivaPro_Backup_2026-09-27_07-30-00/
├─ manifest.json      { appVersion, schemaVersion, createdAt, files:[{name,sha256,bytes}] }
├─ data.db            SQLite snapshot (VACUUM INTO — consistent while the app is running)
└─ attachments.zip    Attachment vault (stored, deflate)
```

* **Creation:** `VACUUM INTO` gives a transactionally consistent snapshot without stopping the app.
  Attachments are zip-streamed. Filename contains date/time → overwrites are impossible; a collision
  appends `-1`, `-2`.
* **Schedule:** off / 7 / 15 / 30 days, checked on app start and hourly; a missed or failed run is
  recorded in `backups` with `status='failed'` + error text and surfaces as a notification. Failures
  are never silent.
* **Retention:** keep last N (default 20) automatic backups; manual backups are never auto-deleted.
* **Restore pipeline:** `validate(manifest + checksum + schema compat) → pre-restore safety backup →
  user confirms with target id → swap DB file atomically (write new, rename old aside, rename new in)
  → reopen → post-restore integrity check → on any failure, roll back to the pre-restore copy.`

---

## 11. Printing architecture

* A hidden, offscreen `BrowserWindow` renders the print document route (`#/print/<kind>/<id>`).
* The document is **one React component per document type, parameterised by paper size** — a single
  flexible renderer, not five fragile templates. Paper geometry is driven by CSS custom properties
  injected from the printer profile: `width`, `min-height`, `padding`, `--font-scale`, columns.
* Supported geometries: A4 (210×297), A5 (148×210), Letter (216×279), Mini (74×120), Thermal 80mm
  (80×variable), Thermal 58mm (58×variable), and fully custom width/height in mm.
* Output paths, all from the same DOM:
  * **Preview** — shown in-app, pixel-accurate (`@media screen` uses the same mm-sized page box).
  * **PDF** — `printToPDF({ printBackground: true, pageSize })` → written by the main process to a
    user-chosen path (Electron `showSaveDialog`) or the attachments/report folder.
  * **Print** — `webContents.print({ silent: false, deviceName, pageSize, copies, margins })` so the
    user gets the real Windows print dialog with printer selection, paper, copies, orientation.
* **Windows printers** (USB, shared, Wi-Fi, Bluetooth) appear automatically in the OS dialog;
  Dentiva Pro stores only the *profile* (name, paper, margins, orientation, scale, copies, default).
* Consistency guarantee: the same HTML/CSS renders preview, PDF and print. Bengali text is covered
  by a bundled OFL font so PDF embedding never depends on the print machine's installed fonts.

---

## 12. PDF architecture

As above. Additionally:
* Every printable document (`prescription`, `invoice`, `receipt`, `patient-summary`, `report-*`,
  `certificate`, `appointment-slip`) has: data fetch → render → preview → print → save-PDF.
* PDFs are written through the main process only; the renderer never touches the file system.
* A `document` service produces the *render model* (a pure function of the DB record) so the same
  model feeds screen, print and PDF — impossible for them to disagree.

---

## 13. Bengali Unicode strategy

1. **Storage:** SQLite TEXT, UTF-8 end to end. No normalisation is applied on write (Bengali
   `ক` U+0995 and `ক` U+0995+U+09CD must survive round-trip identically), and comparison is done on
   the NFC form of the *query* only.
2. **Fonts:** Noto Sans Bengali (SIL OFL 1.1) bundled as WOFF2 and installed into the document font
   stack ahead of the OS font, with `Nirmala UI` / `Vrinda` as Windows fallbacks. Bundling removes
   the "works on my machine" class of bug and guarantees PDF embedding.
3. **Shaping:** Chromium performs OpenType Bengali shaping (reph, conjuncts, matra reordering). No
   manual reordering is performed — doing so would corrupt text.
4. **Search:** Bengali queries are matched with `LIKE '%q%'` against a generated `search_blob`
   column (code + name + phone + address, NFC-normalised) so an ASCII-digit query matches Bengali
   numerals and vice-versa via digit folding.
5. **Numerals:** all money/dates are formatted in English digits by default; Settings offers
   Bengali numerals (০–৯) for display and for invoice/prescription output. Stored values are always
   ASCII digits.
6. **Line breaking:** `word-break: normal; overflow-wrap: anywhere;` so long Bengali compounds wrap
   instead of clipping.
7. **Verification:** dedicated unit tests for round-trip storage, plus visual PDF regression renders
   of a Bengali prescription and a Bengali invoice committed as baseline images.

---

## 14. Patient data model

`patients`: id, patient_code (unique, auto-generated `P-000001`), full_name, age_years, age_months,
date_of_birth, gender (male/female/other/prefer_not_to_say), blood_group, phone, alt_phone,
emergency_contact_name, emergency_phone, address, area, district, thana, postcode,
present_complaint, medical_history, dental_history, allergies, notes, photo_attachment_id,
referred_by, status (active/inactive/archived/deceased), created_at, created_by, updated_at,
updated_by, deleted_at, search_blob, favourite (int 0/1), last_visit_at.

**Patient profile tabs:** Overview · Personal · Clinical Timeline · Visits · Appointments ·
Treatments · Prescriptions · Dental Chart · Invoices · Payments · Financial · Referrals ·
Attachments · Notes · Audit (permission-gated).

**Summary cards:** total visits, last visit, next appointment, total billed, total paid,
outstanding, #prescriptions, #treatments.

---

## 15. Clinical data model

* `visits`: patient, dentist, appointment?, started_at, ended_at, chief_complaint, history,
  examination, diagnosis, treatment_plan, advice, follow_up_date, notes, status, queue_entry_id,
  created_by, deleted_at.
* `tooth_conditions`: patient, dentition (`adult`|`primary`), tooth_code (FDI, e.g. `11`, `51`),
  condition, surface, severity, recorded_at, visit_id, note, is_current, superseded_at.
  `tooth_condition_history` keeps the full revision chain.
* **FDI numbering:** adult 11–18, 21–28, 31–38, 41–48 (upper right → upper left → lower left →
  lower right), primary 51–55, 61–65, 71–75, 81–85.
* `treatments` (catalogue): code, name, category, description, default_price_poisha, duration_minutes,
  chair_time, is_active, notes, is_system.
* `treatment_records`: visit, patient, treatment, tooth_code?, quantity, price_poisha, performed_by,
  performed_at, notes.
* `prescriptions`: patient, visit?, dentist, issued_at, cc, oe, re, advice, notes, follow_up_date,
  status, created_by, deleted_at.
* `prescription_items`: medicine, name, form, strength, dose, morning/afternoon/evening/night flags,
  before/after food, duration, quantity, instructions, prn, extra_instruction, sort_order.
* `referrals`: patient, referred_at, from_dentist, to_dentist, to_clinic, reason, notes, status,
  follow_up_date, outcome.

---

## 16. Billing / accounting model

* `payment_methods` (seeded): Cash, Bank, Card, bKash, Nagad, Rocket, Upay, Other.
* `invoices`: invoice_no (unique, per-clinic configurable prefix + sequence), patient, issue_date,
  due_date, visit?, subtotal_poisha, discount_poisha, discount_percent_bp, tax_poisha, tax_percent_bp,
  grand_total_poisha, paid_poisha (cached, authoritative = sum of allocations), status, notes,
  created_by, deleted_at.
* `invoice_items`: invoice, treatment?, description, quantity_milli (quantity ×1000 stored as integer
  to allow 0.5 steps), unit_price_poisha, discount_poisha, tax_poisha, line_total_poisha, tooth_code.
* `payments`: payment_no, patient, date, method, amount_poisha, reference, notes, received_by,
  type (`receipt`|`refund`), deleted_at.
* `payment_allocations`: payment ↔ invoice, amount_poisha. **A payment may be split across invoices**
  and an invoice may have many allocations. This is the only source of truth for balances; the
  `invoices.paid_poisha` cache is recomputed inside the same transaction and verified by a
  reconciliation test.
* `expenses` / `expense_categories`, `income_entries` / `income_categories`.

### Financial invariants (enforced by tests, §104)

```
invoice.grand_total_poisha = subtotal - discount + tax
invoice.paid_poisha        = Σ allocations
invoice.balance_poisha     = grand_total - paid
patient.outstanding        = Σ invoice.balance (non-archived, non-deleted)
net_income                 = Σ income - Σ expenses
inventory.current_stock    = Σ batch.quantity_received - Σ batch.quantity_issued  (per item)
```

Overpayment is **rejected** with a clear message unless the operator explicitly allocates the excess
to a second invoice; a pure unallocated overpayment is refused at the service layer, not just the UI.

---

## 17. Inventory model

* `inventory_items`: sku (unique), name, category, unit, min_stock, reorder_level, current_stock
  (cached, recomputed transactionally), selling_price_poisha, is_active, notes, expiry_alert_days.
* `inventory_batches`: item, batch_no, expiry_date, purchase_date, supplier, unit_cost_poisha,
  quantity_received, quantity_issued, location.
* `inventory_transactions`: item, batch?, type (`in`|`out`|`adjust`|`dispose`), quantity, unit_cost,
  reference, note, performed_by, performed_at, invoice_item?. **History is never rewritten by a
  stock change.**
* FEFO (first-expiry-first-out) is the default issue order; a manual batch may be selected.
* Alerts: `current_stock <= 0` → Out of stock; `<= min_stock` → Low stock;
  `expiry_date <= today + expiry_alert_days` → Expiring; `< today` → Expired.

---

## 18. Staff / user model

* `staff`: name, photo_attachment_id, date_of_birth, gender, address, phone, blood_group,
  national_id (unique, nullable), position, department, joining_date, salary_poisha, status,
  notes, user_id (nullable link), created_at, deleted_at.
* `users`: username (unique, lower-cased), password_hash, staff_id (nullable), status, last_login_at,
  failed_count, locked_until, must_change_password, created_at.
* `user_roles`, `roles`, `role_permissions`, `permissions` (catalogue).
* `login_history`: user_id, username_attempted, success, ip?, machine, reason, at.

---

## 19. Audit model

`audit_logs`: id, at, user_id, username, action (dotted code), entity, entity_id, result
(`success`|`failure`), summary, metadata_json, machine, session_id.

* Written **inside the same transaction as the change** for data mutations, so the audit trail
  cannot diverge from the data.
* Immutable: no update/delete operations exist in the container.
* Redaction pass over `metadata_json` before write.
* `audit.view` permission; UI offers filtering by date, user, action, entity, result.

---

## 20. Notification model

`notifications`: id, kind, severity (`info`|`success`|`warning`|`error`), title, body, entity,
entity_id, action_route, created_at, read_at, dismissed_at, dedupe_key (unique while unread).

Generated on demand (low-stock, expiring stock, upcoming/missed appointments, outstanding balances,
backup result, security events) plus persisted ones (restore results, system events). Dedupe by
`dedupe_key` + day so the centre never spams.

---

## 21. Search architecture

Global search (`Ctrl+K`) posts a query to `search.global` which runs one parameterised SQL statement
with `LIKE` across a pre-computed `search_blob` per table and returns a grouped, ranked result list
(exact code/name > prefix > substring; recency as tie-breaker). Results are paginated (25/page) and
never load whole tables into the renderer. Individual screens have their own indexed filters
(`created_at`, `status`, `dentist_id`, `date`).

---

## 22. Queue architecture

`queue_entries`: id, patient, dentist, appointment?, queue_no (per dentist, per day, gap-free),
arrived_at, called_at, started_at, completed_at, status (`waiting`|`called`|`in_progress`|`completed`|
`skipped`|`cancelled`), priority (`normal`|`urgent`), note, created_by.

The queue screen subscribes to a server-sent event channel (`notify` push) so updates are instant
without polling; a 15 s reconciliation poll is kept as a safety net for restore/session changes.
Reordering uses a service operation that re-writes the whole dentist-day sequence in one
transaction (gap-free `queue_no`).

---

## 23. Testing architecture

| Layer | Tool | Location | Count target |
| --- | --- | --- | --- |
| Unit | Vitest | `tests/unit` | 300+ specs over money, permissions, validation, dates, inventory maths, patient balance, activation, password, print models |
| Integration | Vitest + real SQLite WASM in temp dirs | `tests/integration` | 120+ specs over repositories, services, auth, RBAC enforcement, backup/restore, migrations, reconciliation |
| UI component | Vitest + jsdom + Testing Library | `tests/ui` | 60+ specs over forms, tables, empty/loading/error states, dental chart rendering, design-token presence |
| E2E | Playwright (Chromium + Electron) | `tests/e2e` | 47 mandated flows (§80) + negative flows (§81) |
| Visual regression | Playwright screenshots | `tests/e2e/visual` | 16 critical screens |
| Stress | `scripts/stress.ts` | — | 10k patients / 50k visits / 50k appointments / 50k invoices / 100k audit rows with measured timings |

**Release gate:** typecheck + lint + unit + integration + UI must be green before packaging.

---

## 24. CI/CD architecture

| Workflow | Trigger | Runner | Jobs |
| --- | --- | --- | --- |
| `ci.yml` | push & PR | ubuntu-latest | deps → typecheck → lint → unit → integration → UI → renderer build → secret scan |
| `release.yml` | tag `v*` or `workflow_dispatch` | windows-latest | deps → typecheck → lint → tests → production build → **electron-builder NSIS** → artefact validation (exists, >20 MB, correct filename, embedded version) → compute SHA-256 → upload artefact → publish GitHub Release |

**Fallback (§93):** the workflow always writes the final installer to
`dist/Dentiva-Pro-Setup-<version>.exe` (and uploads it as an Actions artefact) even if the Release
publication step fails; a `finally`-style job marks the run accordingly.

---

## 25. Installer architecture

* electron-builder, target `nsis`, arch `x64`, `oneClick: false` (allows install-folder choice and
  shows a proper wizard), `perMachine: false` (no elevation needed), `allowToChangeInstallationDirectory: true`.
* `createDesktopShortcut`, `createStartMenuShortcut`, `shortcutName: Dentiva Pro`.
* `deleteAppDataOnUninstall: false` — uninstalling must never destroy a clinic's patient records.
* Custom NSIS include adds a final-page note about where data is stored and the uninstall path to it.
* `artifactName: Dentiva-Pro-Setup-${version}.${ext}`.
* Reinstall/upgrade is safe: user data lives in `%APPDATA%`, never in the install directory.

---

## 26. Release architecture

* Version = `package.json.version`; build number = `YYYYMMDD` + short SHA, embedded in About.
* Release artifacts: installer `.exe`, `SHA256SUMS.txt`, third-party notices `.txt`, user guide PDF
  is not required (markdown ships in the repo).
* Release notes generated from the commit range.
* `docs/RELEASE-CHECKLIST.md` is the human gate; `scripts/package-release.mjs` is the automated gate.

---

## 27. Dependency / license strategy

Only **one** runtime dependency (`node-sqlite3-wasm`, MIT). Everything else is dev tooling or the
Electron/Chromium runtime (MIT + BSD-3). Bundled fonts are OFL-1.1 and are redistributed with the
required notice. Full audit in `docs/DEPENDENCY-LICENSE-AUDIT.md`; third-party notices are shown
in-app under About → Third-party notices.

**Rule:** a new runtime dependency requires a written justification in the audit document. Runtime
network calls are forbidden (verified by a unit test that greps the compiled core for
`http(s)://` usage in non-comment code).

---

## 28. Performance strategy

* **Indexes** on every foreign key, every `*_at` date column used for filtering, and composite
  indexes for the hot aggregations (`appointments(dentist_id, appointment_date)`,
  `audit_logs(at)`, `patients(search_blob)`, `tooth_conditions(patient_id, is_current)`).
* **Pagination everywhere** — no screen loads an unbounded table; lists default to 25/50 per page
  with server-side total counts.
* **No N+1** — dashboard widgets are a single SQL statement with CTEs/sub-queries; patient profile
  cards are one aggregate query.
* **Serialised writes** with `BEGIN IMMEDIATE` prevents SQLITE_BUSY storms; reads use WAL snapshots.
* **Prepared-statement cache** for hot queries.
* **Renderer discipline** — no full-table fetches; virtualised rendering for the audit log and
  patient list above 200 rows.
* **Budgets (measured, see `docs/TEST-REPORT.md`):** dashboard < 250 ms, patient search < 120 ms,
  patient profile open < 300 ms, invoice create+PDF < 900 ms, backup of 10k-patient DB < 4 s.

---

## 29. Failure / recovery strategy

| Failure | Behaviour |
| --- | --- |
| Unexpected crash | Next start detects a stale `dirty` marker → integrity check (`PRAGMA quick_check`) → auto-recovers a WAL snapshot; user is told what happened |
| Disk full | Pre-flight free-space check before DB writes, backups, and attachments; operations fail with a clear message; never a partial write |
| Locked DB | 5 s busy timeout, then a user-facing "another window is using the database" error |
| Printer unavailable | Print dialog reports it; PDF export remains available; the failure is logged, not swallowed |
| Backup folder missing/unwritable | Falls back to the default folder, records `failed` status + error, raises a notification, and tells the user exactly what to fix |
| Restore failure | Pre-restore copy is retained and the app rolls back to it; the user is told where the copy is |
| Corrupt attachment | Listed as *unavailable* with the reason; the record survives; the app never crashes |
| Invalid settings | Settings are schema-validated on read; invalid values fall back to documented defaults and a warning notification is raised |
| Migration failure | Startup aborts before touching data with a precise message; the DB file is never modified in place without a recorded migration |

**Crash recovery of drafts:** prescription/invoice/visit drafts are persisted in a `drafts` table on
a 1.5 s debounce, so an unexpected close restores the in-progress work.

---

## 30. Acceptance criteria

A build is acceptable only when **all** of the following are true and demonstrably tested:

1. Installs and uninstalls on a clean Windows 10/11 x64 machine; Start Menu + desktop shortcuts and
   the correct icon are present.
2. First launch shows the setup wizard; completing it creates a clinic, a dentist and an admin.
3. Activation succeeds with the fixed code exactly once and persists across restarts.
4. Login, auto-lock, unlock, logout, and re-login all work; a wrong password is rejected and audited.
5. A patient can be created, searched globally, and their profile opened; the clinical timeline,
   dental chart (adult + primary), visits, prescriptions, invoices and payments all work.
6. A prescription with multiple medicines renders, previews, prints, and saves as a PDF with correct
   Bengali shaping at A4, A5, Mini and custom sizes.
7. An invoice with discount/tax reconciles: `grand_total − paid = balance` for every invoice and
   `billed − paid = outstanding` for every patient.
8. Inventory stock in/out/adjust reconciles and low-stock/expiry alerts fire.
9. Accounting reports are computed from real records and reconcile to `income − expenses = net`.
10. A user without a financial permission is refused **at the service layer**, verified by a test that
    calls the operation directly with a non-UI client.
11. Backup, automatic backup, pre-restore backup, and restore all work and are auditable.
12. `npm run verify` is green: typecheck, lint, unit, integration, UI.
13. The installer builds in CI, is >20 MB, is correctly named, and its SHA-256 is published.
14. Every document listed in §95 exists and matches the implementation.

---

## 31. Definition of Done

Dentiva Pro is done when the §113 checklist of the master prompt is fully satisfied:

- all mandatory features implemented with **real** behaviour (no fake buttons, charts, search,
  printing, PDF, backup, restore, auth, permissions, notifications, inventory, accounting, history);
- all mandatory tests executed and passing, with the actual counts reported honestly;
- security review, dependency/license audit, UI/UX audit, performance and stress testing completed
  and their findings fixed;
- clean-machine installation and installer validation completed;
- production build produced by GitHub Actions and the artefact present in a GitHub Release **or** in
  `dist/Dentiva-Pro-Setup-1.0.0.exe`;
- documentation matching the implementation;
- no TODO/FIXME representing incomplete mandatory functionality, no dead code, no debug artefacts;
- `docs/AGENT-PROGRESS.md` current, so the work is resumable after any interruption.

---

## 32. Work phases (as mandated)

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 0 | Repository inspection | Repo understood, nothing destroyed |
| 1 | This plan | Plan validates against the master prompt |
| 2 | Design system + UX architecture | `docs/DESIGN-SYSTEM.md`, tokens in code |
| 3 | Database/schema | Migrations run; integrity check passes |
| 4 | Shell, auth, setup, activation | Login + setup + activation E2E green |
| 5 | Patient + clinical system | Patient journey E2E green |
| 6 | Appointments + queue | Scheduling E2E green |
| 7 | Prescription, printing, PDF | Bengali PDF verified at all paper sizes |
| 8 | Billing + payments | Reconciliation tests green |
| 9 | Inventory + accounting | Stock + report tests green |
| 10 | Staff, users, RBAC, audit | RBAC matrix green |
| 11 | Backup, restore, settings | Backup/restore cycle green |
| 12 | Search, notifications, reports | Search + report tests green |
| 13 | Testing | Full suite green |
| 14 | Security + dependency/license audit | `docs/SECURITY.md`, `docs/DEPENDENCY-LICENSE-AUDIT.md` |
| 15 | UI/UX audit | `docs/UI-AUDIT.md` |
| 16 | Performance/stress | `docs/PERFORMANCE.md` with real numbers |
| 17 | Clean-machine installation | `docs/INSTALLATION-TEST.md` |
| 18 | Release packaging | `dist/Dentiva-Pro-Setup-1.0.0.exe` |
| 19 | GitHub Actions release | Workflow green |
| 20 | Final release verification | `docs/TEST-REPORT.md`, `docs/RELEASE-CHECKLIST.md`, `docs/AGENT-PROGRESS.md` |

---

## 33. Documented engineering decisions

1. **Electron over native Windows stacks** — the only reachable stack that gives one HTML pipeline for
   preview/PDF/print with correct Bengali shaping, and the only one buildable and testable in this
   environment without a Windows toolchain.
2. **WASM SQLite over native SQLite** — removes the C++ toolchain requirement for cross-platform
   packaging while keeping a real, ACID, FK-enforcing relational database. Performance is adequate
   for the mandated volumes (verified in Phase 16).
3. **No ORM** — the schema is large and aggregation-heavy; explicit repositories are smaller, faster
   and fully typed. Migrations are hand-written and immutable.
4. **scrypt over Argon2/bcrypt** — avoids a native dependency while remaining a memory-hard,
   NIST-recommended KDF.
5. **Print documents as one parameterised renderer** — a single React component per document type
   driven by paper geometry variables, so adding a paper size cannot fork the layout logic.
6. **Bundled OFL Bengali font** — guarantees correct shaping and PDF embedding on any Windows machine.
7. **Money as integer poisha** — eliminates floating-point financial error entirely.
8. **Payments ↔ invoices via an allocation table** — enables partial payments, split settlement and
   exact reconciliation.
9. **Local activation with an HMAC verifier** — honest about its limits: any purely local verifier
   can ultimately be reverse-engineered by someone with the binary. Mitigation is obfuscation,
   derivation rather than storage, and no trivial comparison. Documented in `docs/SECURITY.md`.
10. **No password recovery** — an offline single-machine product has no secure recovery channel;
    shipping a weak one would be worse. Stated plainly in the UI and in `docs/USER-GUIDE.md`.
11. **Transport abstraction for testability** — enables the complete product to be exercised in CI
    and locally without an Electron binary, and guarantees dev and production share one code path.

---

*End of master plan. Implementation proceeds in the phase order above.*
