# Dentiva Pro — Installation

For whoever installs Dentiva Pro on a clinic's computer, and whoever has to move it to a new machine
later.

---

## 1. What you need

| | |
|---|---|
| **Operating system** | Windows 10 version 1809 or later, or Windows 11 — 64-bit |
| **Memory** | 4 GB |
| **Free disk** | 300 MB for the application, plus room for records and backups |
| **Display** | 1280 × 720 or larger |
| **Administrator rights** | **Not required.** The installer is per-user. |
| **Internet** | Not required, to install or to run |

**No prerequisites.** You do not need to install .NET, Node.js, Python, Visual C++ redistributables,
SQLite, or anything else. The installer carries everything it needs.

Check your Windows version: press `Win + R`, type `winver`, press Enter.

---

## 2. Install

1. **Download** `Dentiva-Pro-Setup.exe` to your Desktop or Downloads folder.

2. **Verify it** if a `.sha256` file was published with it. Open PowerShell in the same folder:

   ```powershell
   Get-FileHash .\Dentiva-Pro-Setup.exe -Algorithm SHA256
   ```

   Compare the output with the contents of `Dentiva-Pro-Setup.exe.sha256`. If they differ, do not run
   it — download it again.

3. **Run it.** Double-click the file. Windows SmartScreen may show a blue "Windows protected your PC"
   message on an unsigned build. Choose **More info**, then **Run anyway** — the publisher name should
   be **Shohan Khan**. If the publisher is anything else, stop.

4. **Choose where it goes.** The installer lets you pick the folder. The default is fine.

5. **Finish.** A **Dentiva Pro** shortcut appears on the Desktop and in the Start menu.

The installation takes under a minute.

---

## 3. First run

### 3.1 Activate

Enter the **activation code** you were given, in four groups of four digits.

- The code is checked on this computer, once. There is no licence server and no phone-home.
- Type it carefully; the field accepts digits and dashes and ignores spacing.
- If it is rejected, check for a mistyped digit and try again. After repeated failures, restart the
  application and try once more.

Activation is tied to this machine. Moving to a new computer needs a fresh code — see
[Moving to a new computer](#7-moving-to-a-new-computer).

> If the screen says the activation record is **damaged**, do not reinstall. Contact support; the
> record can usually be repaired without a new code.

### 3.2 First-run setup

The setup wizard asks for:

| | |
|---|---|
| **Clinic details** | Name, address, area, district, phone, email, website, and the message that appears at the foot of printed documents |
| **Opening hours** | Opening and closing time, and which days you work |
| **Dentists** | Each dentist's name, degrees, registration number, phone, consultation hours, and optionally a signature image |
| **Administrator account** | Your display name, a username, and a password |

**About the password.** The minimum is 8 characters with a lowercase letter and a digit. Make it
longer and more complicated than that — this password protects every patient record on the machine.
There is no default password and no way to recover a forgotten one, so write it down somewhere safe.

**Completion** takes a couple of minutes. Nothing is sent anywhere while it happens.

### 3.3 Add the rest of your team

**Administration → Staff & Users.** Create a user for each person, give them a role, and give them a
role that matches what they actually do:

| Role | For |
|---|---|
| **Administrator** | The owner or manager. Full access. |
| **Dentist** | Clinical work, prescriptions, viewing billing. |
| **Receptionist** | Patients, appointments, queue, invoices, payments. No clinical notes, no staff administration, no backups. |
| **Accountant** | Invoices, payments, inventory, accounting and reports. No clinical access. |

You can change any permission on any role in **Staff & Users → Roles**, and create your own roles.
Anyone you create is made to change their password at first sign-in.

---

## 4. Where your data lives

```
%APPDATA%\Dentiva Pro\
├── dentiva.db              all records
├── attachments\            uploaded X-rays and scans
├── backups\                backup folders
├── exports\                default place for CSV exports
└── logs\                   diagnostic logs
```

To open it: press `Win + R`, type `%APPDATA%\Dentiva Pro` and press Enter.

**The same path is shown in the application** at **Administration → Settings → Storage**, so you never
have to guess.

---

## 5. Uninstalling

**Settings → Apps → Dentiva Pro → Uninstall**, or **Control Panel → Programs → Uninstall**.

**Your data is not deleted.** Dental records are not something to throw away with an application, so
the data folder is deliberately left in place.

To remove it as well, delete `%APPDATA%\Dentiva Pro\` — **but take a backup first**. To keep the
records without the application, copy the whole folder somewhere safe; `dentiva.db` is a standard
SQLite file and the backup folders are self-contained.

---

## 6. Upgrading

1. **Back up first.** Administration → Backup & Restore → **Back up now**.
2. Close Dentiva Pro on every computer that uses it.
3. Run the new `Dentiva-Pro-Setup.exe` over the old one.
4. Start it. The database is migrated automatically; you will see a short progress line.

**Your data is never touched by an upgrade.** Migrations only add to the schema, and a migration whose
contents do not match what the database was built with stops the application rather than guessing.

**Downgrading is not supported.** If the new version does not work, restore your backup and install the
previous version.

---

## 7. Moving to a new computer

1. On the **old** computer: Administration → Backup & Restore → **Back up now**. Copy the backup
   folder to a USB drive.
2. On the **new** computer: install Dentiva Pro and activate it.
3. Complete first-run setup with a placeholder administrator — you will not keep it.
4. Administration → Backup & Restore → **Restore**, and pick the backup from the USB drive. The name
   must be typed back exactly to confirm.
5. Sign in and check: patient count, the last invoice, and the dental chart on a known patient.
6. Delete the placeholder account and create the real ones.

**Attachments come with the backup**, so X-rays move across too.

---

## 8. Setting up printing

Dentiva Pro uses whatever printers Windows already knows about.

1. **Settings → Devices → Printers & scanners**, and add the practice's printer or receipt printer.
2. Print a test page from Windows to confirm the hardware works.
3. Start Dentiva Pro, open any invoice, and press **Print**. The printer list in the print panel comes
  from Windows.
4. Set the default profile in **Administration → Settings → Printing** so you do not have to choose
   every time.

**For a thermal receipt printer**, choose *Thermal 80 mm* or *Thermal 58 mm* as the paper. The document
adapts to a single column.

If Bengali prints as boxes, the printer driver is substituting a font. Print to *Microsoft Print to
PDF* to check whether the document itself is right — see [PRINTING.md](PRINTING.md#troubleshooting).

---

## 9. Recommended first-week settings

| Setting | Where | Suggested |
|---|---|---|
| **Back up automatically** | Backup & Restore | **Every day**, keep **30** generations |
| **Backup folder** | Backup & Restore | A **different disk** from the system drive |
| **Auto-lock** | Settings → Security | 5–10 minutes |
| **Password policy** | Settings → Security | At least 10 characters, upper, lower, digit, symbol |
| **Bengali numerals** | Settings → Preferences | Your choice — a display preference |
| **Date format** | Settings → Preferences | `DD/MM/YYYY` for Bangladesh |
| **Invoice footer** | Settings → Printing | Your clinic's tagline or payment instructions |

**Turn on BitLocker** for the system drive (Settings → Privacy & security → Device encryption). Dentiva
Pro does not encrypt the database itself; BitLocker is what protects it if the machine is stolen.
This takes a few minutes and needs no subscription on Windows 10 Pro or Windows 11.

---

## 10. If installation fails

| Symptom | Cause | What to do |
|---|---|---|
| "This app can't run on your PC" | 32-bit Windows, or older than 1809 | Dentiva Pro needs 64-bit Windows 10 1809+ |
| SmartScreen warning | Unsigned build | **More info → Run anyway**, after checking the publisher is Shohan Khan |
| "Cannot be opened" / file is corrupt | Download was interrupted | Delete it and download again; verify the SHA-256 |
| Antivirus quarantined it | Heuristic false positive on a large unsigned installer | Add an exclusion, or have your IT vendor sign the build |
| Installs but will not start | Security software blocked the files | Check `%APPDATA%\Dentiva Pro\logs\` and your antivirus quarantine |
| "The data directory is not writable" | Group policy or antivirus | Allow write access to `%APPDATA%\Dentiva Pro\` |
| Installation is slow | Antivirus scanning the unpacked Chromium | Exclude the install folder temporarily, install, then re-enable |

**Logs** are at `%APPDATA%\Dentiva Pro\logs\`. They never contain passwords, activation codes or patient
details. Attach the most recent one when reporting a problem to <helloiamshohan@gmail.com>.
