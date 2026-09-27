# Dentiva Pro

**An offline dental clinic management application for Windows.**

Dentiva Pro runs entirely on the clinic's own computer. There is no server, no account, no monthly
fee, and no network connection of any kind after installation. Patient records, invoices and backups
never leave the machine.

Built for Bangladeshi dental clinics: the interface is in English, Bengali works everywhere a name or a
diagnosis can appear, money is in taka, and the dental chart is a real FDI chart rather than a list of
teeth.

---

## Status

> **This build is not released.** The application is complete and its test suite passes, but the
> Windows installer has not been produced, and the clean-machine installation test and the printed
> Bengali check have not been done. [docs/TEST-REPORT.md](docs/TEST-REPORT.md) §7 and §9 list exactly
> what is outstanding and why.

---

## What it does

| Area | |
|---|---|
| **Patients** | Registration, Bengali names, search by name/code/phone, allergies, medical and dental history, attachments (X-rays), soft-archive that never loses history |
| **Clinical** | Visits, tooth conditions on a full FDI chart with per-tooth history, recorded treatment, medicine catalogue, prescriptions with daily timing slots |
| **Scheduling** | Appointment book with overlap detection, working hours and holidays, a live waiting-room queue |
| **Billing** | Invoices from the treatment catalogue or free text, percentage discount and tax, payments allocated across invoices, refunds, outstanding balances, CSV export |
| **Inventory** | Items, suppliers, batches with expiry, FIFO cost valuation, wastage, low-stock and out-of-stock alerts |
| **Accounting** | Income and expense ledger by category, daily summary, collection and outstanding reports |
| **Administration** | Users, roles, 46 individual permissions, audit log of everything that changes, password policy, forced password change, sign-in lockout |
| **Data** | Automatic and manual backups with checksums, validate-before-restore, restore with a typed confirmation, integrity check, diagnostics bundle |
| **Printing** | Invoice, prescription, receipt, appointment slip, report and patient summary, on A4/A5/Letter/mini/thermal 80 mm/thermal 58 mm/custom, with a real preview and PDF export |

Every document prints correct Bengali, on a machine with no internet, because the Bengali typeface
ships inside the application.

---

## Why it is built this way

**Money is never a floating-point number.** Every amount is an integer count of poisha. `৳7,500.00`
is stored as `750000`. There is no `REAL` money column anywhere in the schema, and a test suite walks
28 financial and reporting operations to prove every amount that crosses a boundary is a whole
number of poisha.

**The rules live in the service, not in the form.** A receptionist cannot settle another patient's
invoice, overpay without a recorded refund, delete a role somebody is still using, or reach an
operation their role does not hold — not because the button is hidden, but because the service refuses.
The interface test suite renders real pages against a real database; it found four defects that
typechecked cleanly and would otherwise have shipped broken.

**Activation is local and permanent.** One activation, on one machine, with no licence server and no
phone-home. The activation code is not in this repository in any form, so nothing here can be typed
into the activation box.

**Nothing is fetched at runtime.** Not a font, not an update check, not an error report. Pull the
network cable out and the application behaves identically.

---

## Requirements

| | |
|---|---|
| **Operating system** | Windows 10 (1809 or later) or Windows 11, 64-bit |
| **Processor** | Any x64 CPU from the last decade |
| **Memory** | 4 GB (2 GB works; 4 GB is comfortable) |
| **Disk** | 300 MB for the application, plus room for the clinic's records and backups |
| **Display** | 1280 × 720 or larger; scales correctly to 1920 × 1080 and to 125–200% DPI |
| **Printer** | Any Windows printer. A thermal receipt printer is supported for receipts and slips. |
| **Internet** | Not required, at any point, ever |

---

## Installation

1. Download **`Dentiva-Pro-Setup.exe`**.
2. Verify it if a `.sha256` file was published alongside it.
3. Run it. It installs per-user, so administrator rights are not required.
4. Launch **Dentiva Pro** from the Start menu or the desktop shortcut.
5. Enter the activation code you were given.
6. Complete first-run setup: clinic details, your dentists, and the administrator account.

Full instructions, including uninstallation and where your data lives, are in
[docs/INSTALLATION.md](docs/INSTALLATION.md).

---

## Documentation

| Document | For |
|---|---|
| [USER-GUIDE.md](docs/USER-GUIDE.md) | Everyone who uses the application day to day |
| [INSTALLATION.md](docs/INSTALLATION.md) | Whoever installs it, and whoever has to move it to a new machine |
| [ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) | The practice owner or manager |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Developers |
| [DATABASE.md](docs/DATABASE.md) | Developers and whoever has to recover the data |
| [SECURITY.md](docs/SECURITY.md) | Anyone asking what the application does with patient data |
| [PRINTING.md](docs/PRINTING.md) | Anyone setting up a printer |
| [TEST-REPORT.md](docs/TEST-REPORT.md) | Anyone asking whether it actually works |
| [RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) | Whoever ships it |
| [DEPENDENCY-LICENSE-AUDIT.md](docs/DEPENDENCY-LICENSE-AUDIT.md) | Legal and procurement |
| [MASTER-IMPLEMENTATION-PLAN.md](docs/MASTER-IMPLEMENTATION-PLAN.md) | The build plan this was made from |
| [AGENT-PROGRESS.md](docs/AGENT-PROGRESS.md) | What is done and what is not |

---

## Your data

Everything is in one folder:

```
%APPDATA%\Dentiva Pro\
```

`dentiva.db` is the database, `attachments/` holds uploaded X-rays, `backups/` holds backup folders,
and `logs/` holds the diagnostic log. **Settings → Storage** shows the exact path on screen.

To move a clinic to a new machine: back up on the old machine, install on the new one, activate, set
up, and restore.

The database is **not encrypted by the application.** It is protected by whatever protects the disk —
a Windows account password, and BitLocker if you turn it on. The
[admin guide](docs/ADMIN-GUIDE.md#data-protection) says what to do about that.

---

## Privacy

Dentiva Pro collects nothing, sends nothing and shares nothing. There is no telemetry, no analytics, no
crash reporting, no update check and no licence server. The only network code in the application is the
loopback development host, which does not exist in a packaged build.

---

## Building it yourself

```bash
npm ci                 # install from the lockfile
npm run dev            # run it in a browser against a real local core
npm run verify         # typecheck, test and build
npm test               # 93 tests
npm run stress         # load profile against a real database
```

Node 22 or later. You do not need .NET, a C++ toolchain, or any global package.

To build the Windows installer you need Windows (or wine with the NSIS toolchain) — the Electron
runtime and the NSIS installer are Windows binaries and are downloaded at package time:

```bash
npm run pack:win       # → release/Dentiva-Pro-Setup.exe
```

---

## Licence and attribution

Dentiva Pro is developed by **Shohan Khan** — <helloiamshohan@gmail.com>.

Bundled third-party components and their licences are listed in
[docs/DEPENDENCY-LICENSE-AUDIT.md](docs/DEPENDENCY-LICENSE-AUDIT.md) and shipped inside the installer
as `THIRD-PARTY-NOTICES.txt` and `resources/LICENCES/`.
