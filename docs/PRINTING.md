# Dentiva Pro — Printing and PDF

Dentiva Pro produces six kinds of document: invoice, prescription, payment receipt, appointment slip,
clinical report, and patient summary. All six are rendered by the same engine, so what you see in the
preview is what comes out of the printer.

---

## 1. Supported paper

| Id | Paper | Size | Typical use |
|---|---|---|---|
| `a4` | A4 | 210 × 297 mm | Prescriptions, reports, summaries |
| `a5` | A5 | 148 × 210 mm | Prescriptions, two-up |
| `letter` | US Letter | 215.9 × 279.4 mm | — |
| `mini` | Mini | 74 × 120 mm | Appointment slips, payment receipts |
| `thermal80` | Thermal 80 mm | 80 mm roll | Receipt printers |
| `thermal58` | Thermal 58 mm | 58 mm roll | Small receipt printers |
| `custom` | Custom | any | Anything else |

Thermal sizes have no fixed height; the document grows to fit its content. Every other size is a fixed
page box.

---

## 2. Printer profiles

A **printer profile** binds a document kind to a paper size, margins, orientation, font scale, printer
name and number of copies. Profiles are stored per document kind, so a clinic can put a prescription on
A5 on the doctor's desk and a receipt on 80 mm thermal at the counter, and neither setting touches the
other.

| Setting | Range | Default |
|---|---|---|
| Paper | any id above | A4 |
| Orientation | portrait / landscape | portrait |
| Margins | 0–30 mm, each edge | 10 mm top/bottom, 12 mm left/right |
| Font scale | 0.7 – 1.6 | 1.0 |
| Printer | any name the OS reports | system default |
| Copies | 1 – 20 | 1 |

The font scale is the control that matters most in practice. Long Bengali diagnoses and long
medicine lists need a smaller scale to stay on one page; a clinic with a large font can drop to 0.8
without changing anything else.

Manage profiles in **Settings → Printing**. Every document screen also has its own print panel with the
same settings, so a one-off change does not require a trip to Settings.

---

## 3. How a document is produced

```
User clicks Print
        │
        ├─► documents.*  ──► the core builds a print model
        │                    (clinic, patient, lines, totals, footer, signature)
        │
        ├─► printing.preview  ──► a print window opens, renders the model
        │                       against the profile, on a grey desk background
        │
        └─► printing.print / printing.pdf
                 │
                 ├─► print  → webContents.print({ silent, deviceName, copies })
                 └─► pdf    → webContents.printToPDF({ printBackground: true })
```

The same React component renders the preview, the print and the PDF. There is no second, PDF-only
renderer that can drift from the preview.

Print models are built in the core, not the renderer, so a document always reflects exactly what the
service considers true — the same totals, the same outstanding balance, the same permissions.

---

## 4. Bengali on paper

This is the part that most often goes wrong, so it is worth being precise about what is done.

**The font is bundled, not fetched.** Noto Sans Bengali ships inside the application (SIL Open Font
License). Nothing is downloaded at runtime, so a clinic with no internet still prints correct Bengali.
The font stack is `Noto Sans Bengali → Nirmala UI → Vrinda → Shonar Bangla → sans`, and the Latin
stack ends in `'Noto Sans Bengali'` as well, so the taka sign `৳` (U+09F3) has a guaranteed source
instead of falling through to whatever the machine happens to have installed.

**Bengali runs are tagged.** Any string containing Bengali is wrapped in a span with `class="bn"` and
`lang="bn"`. The print stylesheet gives those runs the Bengali family, a taller line height, and
normal letter spacing. Without this a Bengali run falls back to a Latin font and prints as
disconnected marks.

**Latin tracking is undone for Bengali.** The document headings use tight negative tracking, which
looks right for Latin and pulls the two halves of a Bengali conjunct apart. Bengali runs reset it.
Likewise `word-break: break-word` would split every Bengali word; the document uses
`overflow-wrap: anywhere`, which only breaks inside a word that genuinely cannot fit.

**Backgrounds are preserved.** Chromium drops background colours in print unless asked not to, which
would take the header band, the table stripes and the dental chart fills with it. The print stylesheet
sets `print-color-adjust: exact` on the document and `@page { margin: 0 }` so the browser's own page
margins do not clip the layout.

**Storage is untouched.** Bengali is stored as typed, in UTF-8, and survives a round trip through
SQLite code-point for code-point. Bengali numerals are a display choice only: the same stored poisha
prints as `৳7,500.00` or `৳৭,৫০০.০০` depending on Settings → Preferences.

`tests/ui/print.test.tsx` asserts all of the above against the real document components with real
Bengali content, including that **no** Bengali run appears outside a styled span in any of the six
documents.

---

## 5. Document rules

### Invoice

- The header carries the **clinic identity only** — name, address, phone, email, logo.
- No doctor name, no clinical footer and no doctor signature, unless the clinic explicitly turns on
  Settings → Printing → *Show dentist on invoice*.
- Line descriptions are free text. A line linked to the treatment catalogue keeps the link; a typed
  line does not, and stays free text.
- Totals are in taka, with the discount and tax shown as separate lines when either is non-zero.
- The clinic footer message appears at the bottom if one is configured.

### Prescription

- Chief complaint, findings, diagnosis, advice and follow-up, then the medicine list.
- Each medicine shows name, strength, dose, the daily slots ticked (morning / afternoon / evening /
  night), duration and any extra instruction.
- The **signature area is reserved and unobstructed**: it is its own block at the foot of the page,
  with the image capped so it cannot grow over the medicine list. This is asserted by a test, because
  a doctor who cannot sign a prescription cannot use it.
- The doctor name, degrees, registration number and signature image come from the dentist record.

### Payment receipt

- Receipts and refunds share one document, distinguished by a heading and a stamp.
- Allocations to invoices are itemised, so the patient can see exactly what they paid off.
- On mini and thermal paper the layout collapses to a single column with the allocations in a
  borderless table.

### Appointment slip

- Date, time, dentist, and the reason for the visit.
- Sized for mini or thermal paper by default; it is handed to the patient at the counter.

### Report

- Ten report kinds: daily summary, payment summary, collection, treatment revenue, outstanding,
  inventory, expense, income, patient list and audit.
- The report's required permission is resolved from its kind, so a receptionist can print a collection
  report while an accountant prints a ledger report, and neither can print the other.
- Long reports flow across pages with a repeating header row.

### Patient summary

- Demographics, allergies, visit history and the current dental chart.
- Intended as a take-away or a referral document.

---

## 6. Print history

Every print, preview and PDF is recorded in `print_history`: document kind, entity, who printed it,
when, the printer used, and whether it succeeded. Settings → Printing shows the history. It is
append-only and appears in the audit log as well.

---

## 7. Troubleshooting

**Bengali prints as boxes or disconnected marks.**
The Bengali font is not being applied. Confirm the clinic has not disabled custom fonts at the Windows
level (that affects all applications), and that the document is not being printed through a driver that
substitutes its own fonts. Printing to "Microsoft Print to PDF" and opening the result is the quickest
way to tell whether the problem is Dentiva Pro or the printer driver.

**Bengali looks spaced out, or conjuncts look split.**
The font scale or the page is wrong. Lower the font scale in the profile and check the document is not
being printed in landscape by accident. Both are in the print panel.

**The preview looks right and the printout does not.**
Almost always the printer driver. Select "Print as PDF" from the destination to compare — if the PDF is
correct, the document is correct and the driver is substituting fonts.

**Content spills onto a second page.**
Reduce the font scale, or choose a larger paper. A4 → A5 does not help here; A5 → A4 or lowering the
scale does. The prescription's `showClinicalFooter` setting can also be turned off to reclaim the
footer space.

**The print window is blank.**
The print window is the same bundle as the main window. If it is blank, the renderer failed to load —
check Settings → Diagnostics for the log file path and the last error.

**No printers listed.**
The list comes from the operating system. In the development preview there is no printer list, and the
browser's own print dialog is used instead; this is a preview limitation, not a defect in the packaged
application.
