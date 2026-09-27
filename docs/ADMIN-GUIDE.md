# Dentiva Pro — Administrator Guide

For the practice owner or manager: the person who sets up the system, decides who can see what, and is
responsible for the backups.

---

## Contents

1. [Your responsibilities in one page](#1-your-responsibilities-in-one-page)
2. [Users and roles](#2-users-and-roles)
3. [The built-in roles](#3-the-built-in-roles)
4. [Building your own roles](#4-building-your-own-roles)
5. [Passwords](#5-passwords)
6. [Security settings](#6-security-settings)
7. [The audit log](#7-the-audit-log)
8. [Backups](#8-backups)
9. [Disaster recovery](#9-disaster-recovery)
10. [Data protection](#10-data-protection)
11. [Practice settings](#11-practice-settings)
12. [Printing settings](#12-printing-settings)
13. [Maintenance](#13-maintenance)
14. [Staff records](#14-staff-records)
15. [Moving on or away](#15-moving-on-or-away)

---

## 1. Your responsibilities in one page

You are responsible for five things. None of them take long once set up.

| | How often | Where |
|---|---|---|
| **Check that backups are succeeding** | Weekly glance, monthly proper check | Administration → Backup & Restore |
| **Keep one backup off this computer** | Every backup cycle | A separate disk, or a locked cupboard |
| **Remove access when someone leaves** | The day they leave | Staff & Users |
| **Review who can see what** | Twice a year | Staff & Users → Roles |
| **Turn on disk encryption** | Once | Windows Settings, not Dentiva Pro |

**The single most important thing on this page is the second row.** A backup on the same disk as the
data is not a backup against a stolen computer, a fire, or ransomware.

---

## 2. Users and roles

**Administration → Staff & Users → Users.**

### Creating a user

1. **+ New user**.
2. **Display name** — the real name, which appears in the audit log.
3. **Username** — what they type to sign in. Lower case; no spaces.
4. **Role** — pick one. See below.
5. A **temporary password**. The user must change it at first sign-in and cannot do anything until they
   have.

**One user per person.** Do not share an account. The audit log records who did what, and a shared
account makes that worthless — which is the entire point of having it.

### Disabling and enabling

- **Disable** a user when they are on leave, or when their account is being investigated. They cannot
  sign in, and their session is ended. Their history stays intact.
- **Delete** removes the account. It is refused if the person still has clinical or billing records
  attributed to them, which is the correct behaviour: the record of who did what should not be erasable.
  Disable instead.

### Resetting a password

**Reset password** sets a new temporary password and flags the account as needing a change. Every other
session for that user is ended immediately, so a forgotten password genuinely revokes access.

**There is no way to recover a forgotten password.** Nobody, including the developer, can read it. That
is the point of storing a hash rather than the password.

---

## 3. The built-in roles

| | Administrator | Dentist | Receptionist | Accountant |
|---|:---:|:---:|:---:|:---:|
| Patients | view, add, edit, archive | view, add, edit | view, add, edit | view |
| Clinical notes and chart | ✅ | ✅ | ❌ | ❌ |
| Prescriptions | ✅ | ✅ | view, print | ❌ |
| Appointments and queue | ✅ | ✅ | ✅ | ❌ |
| Treatment catalogue | ✅ | ✅ | view | view |
| Invoices | ✅ | view | add, edit, print | view, add, edit |
| Payments | ✅ | view | ✅ | ✅ |
| Refunds | ✅ | ❌ | ❌ | ✅ |
| Accounting and reports | ✅ | ❌ | ❌ | ✅ |
| Inventory | ✅ | view | view | ✅ |
| Attachments | ✅ | ✅ | add | ❌ |
| **Staff and user accounts** | ✅ | ❌ | ❌ | ❌ |
| **Roles and permissions** | ✅ | ❌ | ❌ | ❌ |
| **Restore from backup** | ✅ | ❌ | ❌ | ❌ |
| **Change settings** | ✅ | ❌ | ❌ | ❌ |
| **Erase all data** | ✅ | ❌ | ❌ | ❌ |
| **Audit log** | ✅ | ❌ | ❌ | ❌ |

**Seven permissions are administrator-only regardless of role:** managing users, managing roles,
restoring a backup, changing settings, erasing all data, viewing the audit log, and permanently
deleting a patient. This is deliberate — the person who can erase the audit log should not be the same
person who takes money.

---

## 4. Building your own roles

**Staff & Users → Roles → + New role.**

Name it, tick the permissions, save. Roles can be edited at any time; changes take effect at the user's
next operation, without needing a new sign-in.

A role for a **dental assistant**, for example:

- `patients.view`, `patients.edit`
- `clinical.view`, `toothchart.edit`
- `prescriptions.view`, `prescriptions.print`
- `appointments.view`, `queue.view`, `queue.manage`
- `attachments.add`
- **not** `invoices.view`, **not** `payments.create`, **not** `audit.view`

A role for a **practice manager** who does not need clinical access: everything in Billing, Payments,
Accounting, Inventory and Reports, plus `reports.view` and `audit.view`, but nothing in Clinical.

**Give people the access their job needs and no more.** It is the cheapest security control there is,
and it makes the audit log readable.

Roles in use cannot be deleted — reassign the people first.

---

## 5. Passwords

**A forgotten password cannot be recovered.** It is stored as a scrypt hash, and a hash cannot be
turned back into a password. Reset the user instead.

**For yourself:** use a long password. Something you can type without a sticky note.

**Policy** is at **Settings → Security** and applies to everyone:

| Rule | Default | Note |
|---|---|---|
| Minimum length | 8 | **Set this to 10 or more.** |
| Lowercase letter | required | |
| Uppercase letter | optional | Turn on for administrative accounts |
| Digit | required | |
| Symbol | optional | Turn on for administrative accounts |
| Must differ from username | always | Cannot be turned off |
| Must differ from previous passwords | always | Cannot be turned off |

**A stronger policy is a real trade-off.** Very strict rules push people towards `Password1!` written on
a sticky note. Ten characters minimum, with a digit, beats eight characters with a symbol requirement,
in practice.

---

## 6. Security settings

**Administration → Settings → Security.**

| Setting | Default | What to do |
|---|---|---|
| **Auto-lock after inactivity** | 10 minutes | **5 minutes** at a shared reception desk. |
| **Password policy** | 8 chars, lower, digit | Raise to 10+; add upper and symbol for administrators |
| **Maximum failed attempts** | 5 | Leave it. It is a sensible number. |
| **Lockout duration** | 1 minute | Leave it. Longer locks out a real user during a busy morning. |
| **Session length** | 12 hours | Leave it, or shorten it if the machine is shared. |

**In addition to Dentiva Pro's own controls**, on the Windows machine itself:

- **BitLocker** on the system drive — Settings → Privacy & security → Device encryption.
- **A Windows account password** on every user account.
- **Automatic screen lock** on the Windows sign-in screen.
- **Physical security** of the reception desk. A locked screen protects nothing.

---

## 7. The audit log

**Staff & Users → Audit log.** Also **Reports → Audit** to print it.

Every operation that changes money, clinical records, access control, settings or files is recorded
with **who, what, which record, when, and whether it succeeded**. Failed sign-ins and refused permission
checks are recorded too.

**It cannot be edited or deleted** — not by an administrator, not by anyone. That is the point of it.

### What to look for

| Pattern | What it might mean |
|---|---|
| Several failed sign-ins for one user at 3am | A shared or guessed password |
| A refund just after a payment, repeatedly | Worth understanding before it becomes a habit |
| `system.wipe` | Somebody is about to erase everything. Find out why first |
| A user disabled and re-enabled | Someone covering their tracks, or a genuine absence |
| Backups stopping | **The most important one.** Check first |

### Filtering

Filter by user, by action, by date range, and by result. Export to CSV for your own records — the
export contains no passwords, no hashes and no activation codes, by construction.

---

## 8. Backups

**Administration → Backup & Restore.**

### What a backup contains

- The complete database
- Every attachment (X-rays and scans)
- A manifest recording what was included, its checksums, and the schema version

### Automatic backups

| Setting | Recommended |
|---|---|
| **Frequency** | Every day |
| **Keep** | 30 generations |
| **Folder** | **A different drive from the system drive** |

The default folder is inside the application's own data directory, which is convenient and is *not* a
real backup against a disk failure. Change it in the first week.

### Manual backups

**Back up now** creates one immediately. Do this before:

- any upgrade
- any bulk change (a price list, a staff import)
- anything that makes you nervous

### Checking a backup

**Validate** reads a backup and checks its checksums against its contents. Run it on anything you plan
to rely on. A backup that has never been validated is a hope, not a plan.

### Restoring

1. Pick a backup from the list. Its size and date are shown.
2. **Validate** it first.
3. Choose **Restore**. You must type the backup's name exactly to confirm.
4. The application is closed and reopened with the restored data.

> Restoring **replaces** current data. Take a backup of the present state first if there is anything in
> it you want.

The confirmation is deliberately awkward. It is the last moment to notice you picked the wrong backup.

---

## 9. Disaster recovery

### The computer will not start

Nothing is lost. The data is on disk, not inside the application.

1. Install Dentiva Pro on a replacement machine.
2. Activate it (a new code is needed — activation is per machine).
3. Set up with a placeholder administrator.
4. Restore the most recent backup from the old machine's `backups\` folder.

You lose whatever happened between the last backup and the failure. That is what the backup frequency
is for.

### Ransomware or a virus

1. **Disconnect the machine from the network.** Do not power it off — leave it available for
   forensics if that matters to you.
2. Restore from a backup **on clean, separate media**. A backup on a connected disk may be encrypted too.
3. Reimage the machine, then restore.
4. Change every password, because the attacker may have had access to the application.

### A backup will not restore

1. Try an older backup. Restore the most recent backup each week, so a weekly restore is routine.
2. **Settings → Maintenance → Check database integrity** on the current data.
3. `dentiva.db` is a standard SQLite file. Any SQLite tool can open it, and
   [DATABASE.md](DATABASE.md) documents every table, so a professional can read the records out even
   if the application will not start.

### Routine you can rely on

| When | Do |
|---|---|
| **Weekly** | Look at the backup list. Confirm the newest one is from the last 24 hours. |
| **Monthly** | Restore the most recent backup onto a spare machine and check the records. |
| **Quarterly** | Copy the backup folder to separate, offline media. |

---

## 10. Data protection

**Dentiva Pro does not encrypt the database.** It is an ordinary file, protected by whatever protects
the disk. That is a decision, and it is your decision to act on.

### What to do

1. **Turn on BitLocker** for the system drive. It is free on Windows 10 Pro and Windows 11, and it
   means a stolen laptop yields nothing without the recovery key. **Store the recovery key somewhere
   other than that laptop.**
2. **Use a Windows account password** on every account, not a PIN.
3. **Back up to a different, access-controlled disk.** Not the same machine, not a shared network drive
   that anyone can write to.
4. **Keep the backup folder physically controlled.** A backup folder holds every patient record in the
   practice in one place.
5. **Limit who is an administrator.** Anyone who can erase all data can erase the evidence.

### What Dentiva Pro does do

| | |
|---|---|
| Passwords | scrypt, memory-hard, random salt, no plaintext anywhere |
| Sessions | Opaque 256-bit tokens, 12-hour absolute lifetime, revoked on sign-out |
| Sign-in | Five attempts then a lockout; the message does not reveal whether a username exists |
| Permissions | 46 permissions enforced in the service, not in the form |
| Attachments | Type-sniffed, renamed on storage, and confined to their folder |
| Audit | Every change, append-only, with sensitive values excluded |
| Logs | Passwords, activation codes and tokens are never written |

Full detail, including what is *not* protected, is in [SECURITY.md](SECURITY.md).

---

## 11. Practice settings

**Administration → Settings → Practice.**

| Setting | Notes |
|---|---|
| Clinic name, address, contact | Appears on every printed document |
| Footer message | Printed at the foot of documents. Put payment instructions here. |
| Opening and closing time | Used to grey out times outside working hours |
| Working days | |
| Holidays | Named closures, shown in the appointment book |
| Dentists | Degrees, registration number, consultation hours, signature image |
| Treatment catalogue | Codes, names and default prices. These feed the invoice form. |
| Payment methods | Cash, bKash, Nagad, card, bank, cheque — reorder or remove as the practice uses them |

**Set the treatment catalogue before the first real day.** An invoice typed line by line is slow and
error-prone; one picked from the catalogue fills its own price.

---

## 12. Printing settings

**Administration → Settings → Printing.** Full detail in [PRINTING.md](PRINTING.md).

| Setting | Notes |
|---|---|
| Default profile per document | Set once, rather than every time |
| Show dentist on invoice | **Off by default.** Invoice headers carry the clinic's identity only. |
| Invoice footer | |
| Prescription font scale | Lower it to 0.8–0.9 if long prescriptions spill to a second page |
| Receipt paper | Thermal 80 mm or 58 mm for a receipt printer |

**Print one of every document type and look at it** before the first real day. It takes five minutes and
catches a paper-size mistake while it is still cheap.

---

## 13. Maintenance

**Administration → Settings → Maintenance.**

| Tool | When | Notes |
|---|---|---|
| **Check database integrity** | Monthly, and whenever something looks wrong | Reads the whole file and reports any problem |
| **Optimise database** | Quarterly, or after a large deletion | Reclaims space; safe to run |
| **Export diagnostics** | When reporting a problem | Contains no passwords, no activation codes and no patient records |
| **Erase all data** | Selling the machine, or starting completely fresh | Requires the exact word to be typed. **Takes a full backup first, automatically.** |

**Diagnostics** is the file to send when reporting a problem. It records versions, the data directory
layout, the last few errors and the log tail — and nothing sensitive.

---

## 14. Staff records

**Staff & Users → Staff.**

Dentists have their own record with degrees, registration number and a **signature image** that prints
on prescriptions. Other staff — receptionists, assistants, hygienists — are recorded here with their
role and contact details, and are not clinical users.

A dentist's signature image is their professional signature. Only upload one they have agreed to.

---

## 15. Moving on or away

### The practice is sold or handed over

1. Take a final backup and copy it off the machine.
2. **Disable** every user you are not handing over.
3. **Change the administrator password** if you know it.
4. **Erase all data** if the practice is being decommissioned. This backs up first, then erases the
   database and the attachments, and records the erasure in the audit log.

### The machine is being sold

Erase all data, then sell. If the disk is not being wiped by the seller's process, use a disk-wiping
tool first. If BitLocker was on and the recovery key is destroyed, the data is unreadable regardless —
which is the point of turning it on.

### Upgrading Dentiva Pro

See [INSTALLATION.md §6](INSTALLATION.md#6-upgrading). Back up, close, install, start. Data is migrated
automatically and is never touched.
