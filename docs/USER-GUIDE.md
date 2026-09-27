# Dentiva Pro — User Guide

For receptionists, dentists, assistants and whoever takes money at the counter. You do not need any
technical knowledge to read this.

If you are installing Dentiva Pro for the first time, start with
[INSTALLATION.md](INSTALLATION.md). If you are the person who owns the practice and manages the people
and the backups, read [ADMIN-GUIDE.md](ADMIN-GUIDE.md) instead.

---

## Contents

1. [Starting and stopping](#1-starting-and-stopping)
2. [The screen](#2-the-screen)
3. [Patients](#3-patients)
4. [The patient record](#4-the-patient-record)
5. [The dental chart](#5-the-dental-chart)
6. [Visits and prescriptions](#6-visits-and-prescriptions)
7. [Appointments](#7-appointments)
8. [The waiting room](#8-the-waiting-room)
9. [Invoices](#9-invoices)
10. [Taking payment](#10-taking-payment)
11. [Inventory](#11-inventory)
12. [Reports](#12-reports)
13. [Printing](#13-printing)
14. [Bengali and numbers](#14-bengali-and-numbers)
15. [Finding things](#15-finding-things)
16. [When something goes wrong](#16-when-something-goes-wrong)

---

## 1. Starting and stopping

Open **Dentiva Pro** from the Start menu or the desktop shortcut. The application opens in one window.

**To sign in:** type your username and password and press Enter. Your password is not shown as you
type, and not saved by the application. If you get it wrong five times, the account is locked for one
minute.

**To sign out:** click your name in the bottom-left corner and choose **Sign out**, or close the
window. Signing out genuinely ends your session — if you copied your session somewhere, it stops
working.

**The application locks itself** after 10 minutes without activity, so a walk-away reception desk does
not leave patient records open. The timeout is configurable. Anything you were typing in a form is kept
as a draft and comes back when you sign in again.

**Closing the window** closes the application. There is nothing to shut down separately.

---

## 2. The screen

```
┌──────────────────────────────────────────────────────────────┐
│  Dentiva Pro            🔍 Search…                     – □ ✕ │
├────────────┬─────────────────────────────────────────────────┤
│  PRACTICE  │                                                 │
│  Dashboard │                                                 │
│  Patients  │                 The page you are on             │
│  Appointments│                                              │
│  Queue     │                                                 │
│  CLINICAL  │                                                 │
│  Treatments│                                                 │
│  Prescriptions                                                │
│  BILLING   │                                                 │
│  Invoice   │                                                 │
│  Payments  │                                                 │
│  Inventory │                                                 │
│  Accounting                                                  │
│  ADMINISTRATION                                              │
│  Staff & Users                                                │
│  Backup & Restore                                             │
│  Settings                                                     │
│  About        │                                              │
├────────────┴─────────────────────────────────────────────────┤
│  Clinic name            Signed in as …        Lock  Sign out │
└──────────────────────────────────────────────────────────────┘
```

The left column is the navigation. **You only see the sections your role allows.** If you cannot find a
section, ask your administrator — it is not hidden by accident.

The bar at the top is the global search box. Press `Ctrl+K` from anywhere to jump to it.

**Bengali input:** click into any text field and type in Bengali as you normally would — Windows
handles the keyboard layout. You can paste Bengali from anywhere.

---

## 3. Patients

**Patients → the list.**

- **Add a patient** with the **+ New patient** button, or press `Ctrl+N`.
- Fill in the name, phone and date of birth. Name and phone are the important ones.
- A patient code is generated automatically (for example `P-0001`). You do not type it.
- The same patient cannot be added twice: a matching phone number or name is detected and you are
  offered the existing record.

**Search.** Type in the search box to filter as you go. It matches name, code, phone — including
partial phone numbers, so `01712` finds everyone at that exchange. **Bengali names search in Bengali.**

**Sort** by newest, oldest, name or code using the column headers.

**Favourites.** The star on a patient marks them as a regular. Filter to favourites with the toggle at
the top of the list.

---

## 4. The patient record

Click a patient to open their record. It has tabs:

| Tab | What is on it |
|---|---|
| **Overview** | Demographics, address, allergies, medical and dental history, outstanding balance |
| **Visits** | Every visit, with the complaint, findings, diagnosis and what was done |
| **Chart** | The dental chart (see below) |
| **Billing** | Invoices, payments, and what the patient still owes |
| **Attachments** | X-rays and scans, with the ability to add, view and remove them |
| **Notes** | Free-form dated notes, with who wrote them |

**Outstanding balance** is shown in taka at the top. If a patient owes money, it is red.

**Archive** a patient who has left or died. Archiving hides them from the working list but keeps every
record, invoice and clinical note. You cannot archive a patient who still owes money — settle or write
it off first.

---

## 5. The dental chart

The **Chart** tab shows the teeth as a dentist expects: upper and lower, left and right, numbered 1–32
in FDI notation, with permanent teeth above and primary teeth below.

Click a tooth to open it. You can set its **condition** (healthy, caries, filled, missing, crowned,
root canal, impacted, fractured, extracted), add a **surface** (mesial, occlusal, distal, buccal,
lingual), and write a **note**.

Every change is kept with its date and who recorded it, so you can see how a tooth got to where it is
now. Nothing is overwritten.

The **surface view** shows which surfaces of the tooth are affected, drawn as a five-point diagram.

---

## 6. Visits and prescriptions

**Clinical → Prescriptions → + New prescription.**

1. Pick the patient.
2. Pick the dentist.
3. Write the **chief complaint**, **on examination**, **diagnosis** and **advice** — in Bengali if you
   want. These print exactly as typed.
4. Add medicines: name, strength, dose, and tick the times of day it is to be taken (morning, afternoon,
   evening, night), the duration and any extra instruction.
5. Print.

The prescription keeps a signature area at the bottom that is deliberately left clear for the doctor to
sign. Do not type over it.

**Clinical → Treatments** is the catalogue: the services the practice offers and their prices. Setting
a price here means the invoice form fills it in for you.

---

## 7. Appointments

**Practice → Appointments.** Shows a day or a week.

- **Book** with **+ New appointment**: patient, dentist, date, time, duration, and the reason.
- If the slot is already taken, Dentiva Pro says so and offers the nearest free times rather than
  silently doing something else.
- A patient cannot be booked twice into the same day's queue.
- Greyed-out times are outside the practice's working hours, or on a holiday. Both are configurable in
  **Settings → Practice**.

---

## 8. The waiting room

**Practice → Queue.** The live list of who is waiting.

- **Call** the next patient to move them from *Waiting* to *In treatment*.
- **Finish** to close the visit, which creates a visit record you can write up.
- **Re-call** puts someone back if they were called and did not arrive.
- The queue shows how long each person has been waiting, so a long wait is visible rather than
  forgotten.

The board is the fastest way for a busy waiting room to stay fair.

---

## 9. Invoices

**Billing → Invoice → + New invoice.**

1. Pick the patient.
2. Add lines. Type in the description box and pick from the treatment catalogue as you type — the price
   fills itself in. You can also type a line that is not in the catalogue, for example a one-off.
3. Set the **quantity** and the **price** if you need to change them.
4. Apply a **discount** and **tax** by percentage if the practice uses them.
5. Save, then **Print** or **PDF**.

**The totals are in taka and are exact.** There are no hidden decimals.

**Statuses:** *Unpaid*, *Part paid*, *Paid*, *Cancelled*.

- An **unpaid** invoice can be cancelled. A **paid** one cannot — it has to be refunded, which keeps
  the money trail intact.
- An invoice shows the **outstanding** amount and the **amount paid**.

**Invoice headers carry the clinic's identity only.** No doctor name and no signature, unless the
practice has explicitly turned that on in Settings → Printing.

---

## 10. Taking payment

**Billing → Payments → + New payment.**

1. Pick the patient.
2. Choose **cash**, **bKash**, **Nagad**, **card**, **bank** or **cheque**. The list is configurable.
3. Type the amount, or leave it to be worked out from the allocations.
4. **Allocate** the payment to the patient's invoices. You can split one payment across several
   invoices.
5. Save and print the receipt.

**Rules you will notice:**

- A payment can only be allocated to **that patient's** invoices.
- You cannot allocate more than the payment amount.
- You cannot overpay an invoice. If the patient genuinely paid too much, record a **refund** instead.

The patient's outstanding balance updates immediately and is shown everywhere their name appears.

---

## 11. Inventory

**Billing → Inventory** for materials — gloves, anaesthetic, burs, cement.

- **Items** are what the practice uses. Each has a unit, a reorder point and a sale price.
- **Suppliers** are who you buy from.
- **Stock** is tracked in **batches**, because dental materials expire and because they arrive at
  different prices. Each batch records quantity, unit cost, expiry date and supplier.
- Issuing stock to a patient creates a movement, and cost is calculated from the batches actually on
  hand (oldest first).
- **Wastage** is recorded as its own reason, so the books show what was thrown away and why.

**Warnings** appear at the top: items at or below their reorder point, and items out of stock.

---

## 12. Reports

**Billing → Accounting** for the day book, and **Reports** for everything else.

| Report | Answers |
|---|---|
| Daily summary | What came in today, by method |
| Collection | What was collected over a period |
| Outstanding | Who still owes money, and how much |
| Treatment revenue | Which treatments earn the most |
| Payment summary | Cash, bKash, card and bank, broken down |
| Income | The income ledger |
| Expense | The expense ledger |
| Inventory | Stock value at cost and at sale price |
| Patient list | Patients registered in a period |
| Audit | Who changed what |

Pick a date range, then **Preview**, **Print** or **Export CSV**.

**CSV files open correctly in Excel with Bengali intact** — they are written as UTF-8 with a byte order
mark for exactly this reason.

---

## 13. Printing

Every document has a **Print** button that opens a panel:

| Setting | |
|---|---|
| **Paper** | A4, A5, Letter, Mini, Thermal 80 mm, Thermal 58 mm, or custom |
| **Orientation** | Portrait or landscape |
| **Margins** | Each edge |
| **Font size** | 70% to 160% — the control that matters most for a long prescription |
| **Printer** | Any printer Windows knows about |
| **Copies** | 1 to 20 |

**Preview** shows exactly what will print, on a page-shaped sheet. **Print** sends it. **PDF** saves it
to a file.

Default profiles are sensible. Change them in **Settings → Printing** to set them once rather than
every time.

Full detail, including paper sizes and troubleshooting, is in [PRINTING.md](PRINTING.md).

---

## 14. Bengali and numbers

**You can type Bengali anywhere.** Names, addresses, complaints, diagnoses, advice, notes, item
descriptions, supplier names — all of it.

**Bengali works in:**

- the search box
- stored records
- printed documents
- PDF files
- CSV exports opened in Excel

**Bengali numerals** (`৭,৫০০.০০`) can be turned on in **Settings → Preferences**. This changes what you
see, never what is stored — an amount typed in Bengali numerals and the same amount in English numerals
are the same money, and adding them gives the same answer.

**Input tip:** install or enable a Bengali keyboard layout in Windows Settings → Time & Language →
Language. Windows handles the layout; Dentiva Pro receives the characters and stores them.

---

## 15. Finding things

| I want… | Do this |
|---|---|
| Any patient | `Ctrl+K`, then type a name, code or phone |
| Everything for one patient | Click their name |
| Today's appointments | **Practice → Appointments** |
| Who is waiting | **Practice → Queue** |
| Who still owes money | **Reports → Outstanding** |
| What we took today | **Billing → Accounting** |
| A specific invoice | **Billing → Invoice**, then search by number or patient |
| What a user changed | **Staff & Users → Audit log** |
| Where the data is | **Settings → Storage** |

---

## 16. When something goes wrong

**"Incorrect username or password."**
Check the keyboard's Caps Lock. The message is deliberately the same whether the username exists or
not, so nobody can use it to find out who has an account.

**"Too many failed attempts."**
Five wrong passwords lock the account for one minute. Wait, or ask an administrator to unlock it.

**An option is missing.**
Your role does not have that permission. Ask an administrator — Settings → Staff & Users → Roles
shows exactly what each role can do.

**Something will not save.**
Read the highlighted field. Validation messages name the field, not just the form. If a date is
rejected, it must be a real date in `YYYY-MM-DD` order.

**A Bengali PDF opens as boxes.**
The PDF is fine; the PDF reader is substituting a font that has no Bengali. Open it in a current
browser or in a current PDF reader. If it is *printed* as boxes, tell your administrator — the
printer driver is the likely cause, not the document.

**"The data directory is not writable."**
Windows is blocking the application from writing to `%APPDATA%`. Usually antivirus or a locked-down
policy. Settings → Storage shows the path; your IT person needs to allow write access to it.

**The application will not start.**
Open **Settings → About → Diagnostics** — but you need the application running for that. The log is at
`%APPDATA%\Dentiva Pro\logs\`. Send that file to your administrator. It never contains a password, an
activation code, or patient details.

**Something looks wrong in the data.**
**Settings → Maintenance → Check database integrity** runs a full check. If it reports a problem, make
a backup immediately and then restore from your most recent good one.

**You think you have lost data.**
Do not panic and do not reinstall. **Administration → Backup & Restore** lists every backup that was
ever created, with its date and size. Restoring one takes a couple of minutes and puts the clinic back
to that point. See [ADMIN-GUIDE.md](ADMIN-GUIDE.md#disaster-recovery).

---

## Getting help

| | |
|---|---|
| Day-to-day questions | Your practice administrator |
| Printing problems | [PRINTING.md](PRINTING.md) |
| Backups, users, permissions | [ADMIN-GUIDE.md](ADMIN-GUIDE.md) |
| Installation | [INSTALLATION.md](INSTALLATION.md) |
| Something is broken | The log at `%APPDATA%\Dentiva Pro\logs\`, then email <helloiamshohan@gmail.com> |
