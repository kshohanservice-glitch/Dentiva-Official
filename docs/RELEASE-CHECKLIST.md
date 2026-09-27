# Dentiva Pro — Release Checklist

Every box must be ticked, by a person, with evidence, before a release is announced. A box that cannot
be ticked is a **NO**, and a single NO means the release does not happen.

**This checklist has not been completed. The current status is NO.**

---

## Current status: **NO — not ready to release**

| Blocking gate | Status | Evidence |
|---|---|---|
| Windows installer built | ❌ **NO** | Electron binaries unreachable from the build environment |
| Clean-machine installation tested | ❌ **NO** | Nothing to install |
| Bengali verified on printed paper and PDF | ❌ **NO** | No Chromium available to run `printToPDF` |
| Tested on the target OS (Windows) | ❌ **NO** | All testing was on Linux |

Everything else is green. The detail is in [TEST-REPORT.md](TEST-REPORT.md).

---

## How to use this checklist

1. Work top to bottom. Do not skip forward.
2. Tick a box only with evidence — a log line, a screenshot, a file hash, a note of who did it and when.
3. A failed box is a blocker, not a note. Fix it and start again from the top.
4. The release owner signs §12 at the end.

---

## 1. Code quality

| # | Gate | Command | Expected | ✓ | Evidence |
|---|---|---|---|:---:|---|
| 1.1 | Typecheck, renderer and core | `npm run typecheck` | no output | ☐ | |
| 1.2 | Typecheck, main and scripts | `npm run typecheck:node` | no output | ☐ | |
| 1.3 | Tests pass | `npm test` | all pass, 0 failures (106 at the time of writing) | ☐ | |
| 1.4 | Renderer builds | `npm run build:renderer` | exit 0 | ☐ | |
| 1.5 | Core and main build | `npm run build:node` | exit 0 | ☐ | |
| 1.6 | Release preparation passes | `node scripts/package-release.mjs` | exit 0 | ☐ | |
| 1.7 | No activation literal in the build | part of 1.6 | no match | ☐ | |
| 1.8 | Bengali font in the bundle | part of 1.6 | ≥ 1 subset | ☐ | |
| 1.9 | No unfinished work marker in `src/` | `grep -rnE "TODO\b\|FIXME\|coming soon\|not implemented yet" src/` | no match | ☐ | |
| 1.10 | No debug artefact in the source | `grep -rnE "console\.(log\|debug\|dir)\|debugger\b" src/` | no match | ☐ | |
| 1.11 | No credential, secret or real patient data in git | `git log -p \| grep -iE "password.*=.*['\"]"`, review `tests/` fixtures | no match | ☐ | |
| 1.12 | `.gitignore` covers build output, data, logs, secrets | review | complete | ☐ | |

---

## 2. Dependencies and licensing

| # | Gate | Command | Expected | ✓ | Evidence |
|---|---|---|---|:---:|---|
| 2.1 | Clean install from the lockfile | `rm -rf node_modules && npm ci` | exit 0 | ☐ | |
| 2.2 | No high or critical advisories in production | `npm audit --omit=dev --audit-level=high` | 0 found | ☐ | |
| 2.3 | Every shipped dependency is on the approved licence list | part of `package-release.mjs` | exit 0 | ☐ | |
| 2.4 | Every shipped licence text is bundled | `ls build-licences/` | 3 files | ☐ | |
| 2.5 | `THIRD-PARTY-NOTICES.txt` is accurate | read it | matches §2 of the audit | ☐ | |
| 2.6 | Audit document is current | [DEPENDENCY-LICENSE-AUDIT.md](DEPENDENCY-LICENSE-AUDIT.md) | dated today | ☐ | |
| 2.7 | No runtime network dependency | `grep -rnoE "https?://[^\"'\` ]+" src/core src/renderer src/main \| grep -viE "localhost\|127\\.0\\.0\\.1\|w3\\.org\|schema\\.org\|fontsource\\.org"` | no match | ☐ | |

---

## 3. Functionality

Each of these must be performed **by a person, in the packaged application, on Windows.**

| # | Scenario | ✓ | Evidence |
|---|---|:---:|---|
| 3.1 | Install from the installer; launch from Start menu and desktop shortcut | ☐ | |
| 3.2 | Activation screen appears; an invalid code is refused with a readable message | ☐ | |
| 3.3 | A valid code activates; the record survives a restart | ☐ | |
| 3.4 | First-run setup completes: clinic, hours, dentist, administrator | ☐ | |
| 3.5 | Sign in; a wrong password is refused; five attempts lock the account | ☐ | |
| 3.6 | Create a patient with a Bengali name; find them by search, code and partial phone | ☐ | |
| 3.7 | Open the dental chart; set a condition; confirm the history is kept | ☐ | |
| 3.8 | Record a visit; record treatment against a tooth | ☐ | |
| 3.9 | Write a prescription in Bengali; add medicines with timing slots | ☐ | |
| 3.10 | Book an appointment; confirm an overlapping slot is refused with a suggestion | ☐ | |
| 3.11 | Move a patient through the waiting-room queue to *Finished* | ☐ | |
| 3.12 | Create an invoice from the catalogue; apply a discount and tax; check the total in taka | ☐ | |
| 3.13 | Take a payment; allocate it across two invoices; check the outstanding balance | ☐ | |
| 3.14 | Attempt to overpay: **must be refused** | ☐ | |
| 3.15 | Attempt to allocate to another patient's invoice: **must be refused** | ☐ | |
| 3.16 | Refund a paid invoice; confirm the balance returns | ☐ | |
| 3.17 | Record stock in two batches at different costs; issue stock; check FIFO valuation | ☐ | |
| 3.18 | Record wastage; check it appears separately | ☐ | |
| 3.19 | Run every report; check none is empty or wrong | ☐ | |
| 3.20 | Export CSV; open in Excel; **confirm Bengali displays correctly** | ☐ | |
| 3.21 | Sign in as a receptionist; **confirm Staff, Backups and restricted reports are unavailable** | ☐ | |
| 3.22 | Sign in as a receptionist; **confirm the forbidden operation is refused by the service, not merely hidden** | ☐ | |
| 3.23 | Create a user; confirm they must change their password at first sign-in | ☐ | |
| 3.24 | Change a role's permissions; confirm the effect at the next operation | ☐ | |
| 3.25 | Review the audit log; confirm the actions above are all recorded | ☐ | |
| 3.26 | Sign out; confirm the session is genuinely revoked | ☐ | |
| 3.27 | Leave the machine idle past the auto-lock timeout; confirm it locks and drafts survive | ☐ | |
| 3.28 | Create a backup; validate it; restore it; confirm the data came back | ☐ | |
| 3.29 | Attempt a restore with the wrong name typed: **must be refused** | ☐ | |
| 3.30 | Run a database integrity check | ☐ | |
| 3.31 | Export diagnostics; confirm no password, code or patient record is in it | ☐ | |
| 3.32 | Global search from `Ctrl+K` | ☐ | |
| 3.33 | Check every notification the dashboard shows | ☐ | |
| 3.34 | Sign in as a user with no permissions; confirm the refusal is readable | ☐ | |

---

## 4. Bengali verification — **the one most often assumed and least often checked**

On-screen Bengali proves nothing. Each of these must be done on a **printed** page or a **saved PDF**,
with Bengali content typed by a person who writes Bengali.

| # | Check | ✓ | Evidence |
|---|---|:---:|---|
| 4.1 | Type Bengali patient name, address and complaint; confirm no boxes or question marks anywhere | ☐ | |
| 4.2 | Print a prescription in Bengali on **A4**; examine the physical page | ☐ | |
| 4.3 | Confirm conjuncts (ক, ক্ত, র্ণ, দ্ধ) are joined, not split | ☐ | |
| 4.4 | Print a prescription on **A5** and on **thermal 80 mm**; examine each | ☐ | |
| 4.5 | Print a long prescription at 0.8 font scale; confirm it stays on one page | ☐ | |
| 4.6 | Save a PDF of each document; open it; confirm Bengali displays | ☐ | |
| 4.7 | **Select the Bengali text in the PDF**; confirm it is real text, not an image | ☐ | |
| 4.8 | Copy the text out of the PDF into Notepad; confirm it is correct Bengali | ☐ | |
| 4.9 | Print an invoice with a Bengali line description; confirm the taka sign `৳` is present and correct | ☐ | |
| 4.10 | Turn on Bengali numerals; print again; confirm the figures are Bengali and the totals still reconcile | ☐ | |
| 4.11 | Print on a **real** printer, not "Microsoft Print to PDF"; examine it | ☐ | |
| 4.12 | Print on a **thermal receipt printer**; examine the roll | ☐ | |
| 4.13 | Confirm the prescription signature area is clear and large enough to sign | ☐ | |
| 4.14 | Confirm the invoice header shows the clinic only — no doctor, no signature | ☐ | |
| 4.15 | Open a Bengali CSV in Excel; confirm the text is correct | ☐ | |

> A PDF where the Bengali is an image rather than selectable text is a **NO**, not a pass. It means the
> text is not in the document, and it cannot be searched, copied or indexed.

---

## 5. Interface quality

| # | Check | ✓ | Evidence |
|---|---|:---:|---|
| 5.1 | Runs at **1280 × 720** with no clipping | ☐ | |
| 5.2 | Runs at **1920 × 1080** with no wasted space | ☐ | |
| 5.3 | At **125% DPI** — no clipping, no overlapping text | ☐ | |
| 5.4 | At **150% DPI** — no clipping, no overlapping text | ☐ | |
| 5.5 | At **200% DPI** — no clipping, no overlapping text | ☐ | |
| 5.6 | Every scrollable area actually scrolls; nothing is cut off with no way to reach it | ☐ | |
| 5.7 | The whole application is reachable with the keyboard alone | ☐ | |
| 5.8 | Focus is visible on every interactive element | ☐ | |
| 5.9 | The application opens and is usable in **under 5 seconds** from a cold start | ☐ | |
| 5.10 | Any screen with a long list of records is responsive at 10,000+ patients | ☐ | |
| 5.11 | Light and dark themes both render every screen correctly | ☐ | |
| 5.12 | Windows dark mode is respected | ☐ | |
| 5.13 | No screen shows a raw error code or stack trace to a user | ☐ | |
| 5.14 | Every error message says what to do next | ☐ | |
| 5.15 | Unsaved work survives an auto-lock and a crash | ☐ | |
| 5.16 | Numbers in tables line up (tabular figures); no jitter | ☐ | |
| 5.17 | The application does not steal focus while typing in a form | ☐ | |

---

## 6. Performance

| # | Check | Budget | ✓ | Evidence |
|---|---|---|:---:|:---:|---|
| 6.1 | `npm run stress` — every operation within budget | see [TEST-REPORT.md §2.4](TEST-REPORT.md) | ☐ | |
| 6.2 | Cold start, application closed → usable | < 5 s | ☐ | |
| 6.3 | Patient search, 10,000 patients | < 250 ms | ☐ | |
| 6.4 | Open a patient with 200 visits | < 1 s | ☐ | |
| 6.5 | Create an invoice with 20 lines | < 150 ms | ☐ | |
| 6.6 | Daily summary report over a year | < 2 s | ☐ | |
| 6.7 | Full backup, 5,000 patients | < 60 s | ☐ | |
| 6.8 | Full restore, 5,000 patients | < 120 s | ☐ | |
| 6.9 | A full day of clinic work leaves the application responsive | subjective | ☐ | |
| 6.10 | Memory does not grow without bound over a working day | < 500 MB | ☐ | |

---

## 7. Data integrity and recovery

| # | Check | ✓ | Evidence |
|---|---|:---:|---|
| 7.1 | A backup restores to a byte-identical record count | ☐ | |
| 7.2 | Attachments survive backup and restore | ☐ | |
| 7.3 | A restore into a clinic with newer data is understood and confirmed | ☐ | |
| 7.4 | Killing the application mid-operation leaves the database consistent | ☐ | |
| 7.5 | `PRAGMA integrity_check` passes after a forced kill | ☐ | |
| 7.6 | The upgrade path from the previous version preserves all data | ☐ | |
| 7.7 | Uninstalling leaves the data intact | ☐ | |
| 7.8 | Reinstalling over an existing install preserves the data | ☐ | |
| 7.9 | The full recovery procedure in [ADMIN-GUIDE §9](ADMIN-GUIDE.md#9-disaster-recovery) has been followed once, end to end, on a spare machine | ☐ | |

---

## 8. Offline guarantee

| # | Check | ✓ | Evidence |
|---|---|:---:|---|
| 8.1 | The machine has **no network connection**; the application starts and works fully | ☐ | |
| 8.2 | Bengali, Inter, icons and all assets render with no network | ☐ | |
| 8.3 | No update prompt appears | ☐ | |
| 8.4 | No telemetry, analytics or crash-report prompt | ☐ | |
| 8.5 | **Packet capture during a full working session shows no outbound traffic** | ☐ | |

> 8.5 is the one that matters. Everything else can be taken on trust; a packet capture cannot be faked
> by the application under test.

---

## 9. Packaging

| # | Check | ✓ | Evidence |
|---|---|:---:|---|
| 9.1 | The installer is named exactly **`Dentiva-Pro-Setup.exe`** | ☐ | |
| 9.2 | It is a Windows x64 PE executable (MZ header) | ☐ | |
| 9.3 | It is larger than 40 MB — a smaller file cannot contain Chromium | ☐ | |
| 9.4 | It installs **per-user**, with no administrator prompt | ☐ | |
| 9.5 | The install folder can be chosen | ☐ | |
| 9.6 | Desktop and Start menu shortcuts are created, named **Dentiva Pro** | ☐ | |
| 9.7 | The icon is Dentiva Pro's, not Electron's default | ☐ | |
| 9.8 | Uninstalling removes the program, the shortcuts and the registry entries | ☐ | |
| 9.9 | Uninstalling **does not** delete the clinic's data | ☐ | |
| 9.10 | The application icon and window title are correct at 100%, 150% and 200% DPI | ☐ | |
| 9.11 | `THIRD-PARTY-NOTICES.txt` is present in the installed folder | ☐ | |
| 9.12 | `resources/LICENCES/` contains each shipped licence text | ☐ | |
| 9.13 | `build-manifest.json` records the version and the commit it was built from | ☐ | |
| 9.14 | Only **one** instance runs; opening a second does not corrupt anything | ☐ | |
| 9.15 | A SHA-256 file is published alongside the installer | ☐ | |

---

## 10. Clean-machine test

**A machine that has never had Node, .NET, or a development tool installed, and has never run this
application.**

| # | Step | ✓ | Evidence |
|---|---|:---:|---|
| 10.1 | Record the machine: Windows version, build, CPU, RAM, free disk | ☐ | |
| 10.2 | Confirm no development runtimes are installed | ☐ | |
| 10.3 | Verify the installer's SHA-256 | ☐ | |
| 10.4 | Install. Record how long it took and whether it asked for administrator rights | ☐ | |
| 10.5 | Launch from the desktop shortcut | ☐ | |
| 10.6 | Activate | ☐ | |
| 10.7 | Complete first-run setup | ☐ | |
| 10.8 | Create a user for a second person; confirm the forced password change | ☐ | |
| 10.9 | Run one complete patient journey (§3.6 – §3.16) | ☐ | |
| 10.10 | Print at least one document of each type (§4) | ☐ | |
| 10.11 | Create a backup; validate it; restore it | ☐ | |
| 10.12 | Close the network entirely; repeat one patient journey | ☐ | |
| 10.13 | Reboot; confirm everything still works | ☐ | |
| 10.14 | Uninstall; reinstall; confirm the data survived | ☐ | |
| 10.15 | Record total elapsed time and anything that surprised you | ☐ | |

---

## 11. Documentation

| # | Document | ✓ |
|---|---|:---:|
| 11.1 | `README.md` | ☐ |
| 11.2 | `docs/USER-GUIDE.md` | ☐ |
| 11.3 | `docs/INSTALLATION.md` | ☐ |
| 11.4 | `docs/ADMIN-GUIDE.md` | ☐ |
| 11.5 | `docs/TEST-REPORT.md` — **with this release's actual results filled in** | ☐ |
| 11.6 | `docs/RELEASE-CHECKLIST.md` — **this file, fully ticked** | ☐ |
| 11.7 | `docs/DEPENDENCY-LICENSE-AUDIT.md` | ☐ |
| 11.8 | `docs/ARCHITECTURE.md` | ☐ |
| 11.9 | `docs/DATABASE.md` | ☐ |
| 11.10 | `docs/SECURITY.md` | ☐ |
| 11.11 | `docs/PRINTING.md` | ☐ |
| 11.12 | `docs/AGENT-PROGRESS.md` updated | ☐ |
| 11.13 | Every command in the documentation has been run, and works as written | ☐ |
| 11.14 | No document claims anything that was not executed | ☐ |

---

## 12. Release

| # | Step | ✓ | Evidence |
|---|---|:---:|---|
| 12.1 | Every box above is ticked | ☐ | |
| 12.2 | Version number is final, in `package.json` | ☐ | |
| 12.3 | Tagged `vX.Y.Z` and pushed | ☐ | |
| 12.4 | CI green on that tag | ☐ | |
| 12.5 | `release.yml` produced `Dentiva-Pro-Setup.exe` | ☐ | |
| 12.6 | The installer from CI is the one that was tested — compare SHA-256 against the tested build | ☐ | |
| 12.7 | GitHub Release created with the installer attached | ☐ | |
| 12.8 | If the GitHub Release could not be published, the installer is in `dist/` and the fallback is documented | ☐ | |
| 12.9 | Release notes state what is new and what changed | ☐ | |
| 12.10 | `TEST-REPORT.md` updated with this release's real results | ☐ | |
| 12.11 | `AGENT-PROGRESS.md` updated | ☐ | |
| 12.12 | No secret, credential or real patient data anywhere in the repository history | ☐ | |
| 12.13 | Release owner signs below | ☐ | |

---

```
Release owner: ______________________________________

Date: ______________

Outcome:   ☐  RELEASED        ☐  NOT RELEASED (open blockers: ____________________)
```

---

## If a box cannot be ticked

Do not tick it, and do not release.

Open an issue describing what was attempted, what happened, and what it would take to fix. The
checklist is a tool for finding out the truth before a clinic's records depend on it — a ticked box
that was not earned is worse than an empty one, because it is believed.
