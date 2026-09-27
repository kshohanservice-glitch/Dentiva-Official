# Agent progress log — Dentiva Pro

This file is the running record of the build. It states what is done, what is being worked on right
now, what is left, and the honest test/build/release status. It is updated after every significant
change.

**Status of the product: NOT RELEASE-READY.** Four gates are open: the Windows installer has not been
built, the clean-machine installation test has not been run, printed Bengali has not been examined on
paper, and nothing has been tested on Windows. See [Quality gates](#quality-gates) at the bottom and
[TEST-REPORT.md §7](TEST-REPORT.md).

---

## Current phase

**Phase 14 — Security, licence and documentation audit, complete. Phase 15 (packaging) and Phase 16
(clean-machine validation) are the remaining work, and both are blocked on the build environment.**

Everything that can be built and verified in this environment has been built and verified. The
application is feature-complete: 193 operations across 37 groups, 48 tables, 46 permissions, 20 screens,
6 printable document types. What remains cannot be done here, and the reason is recorded rather than
worked around.

## Completed phases

| Phase | Deliverable | State |
| --- | --- | --- |
| 0 | Repository inspection | Done. Nothing reusable existed; useful configuration preserved. |
| 1 | `docs/MASTER-IMPLEMENTATION-PLAN.md` | Done. All 31 mandated sections plus executive summary, work phases and engineering decisions. |
| 2 | Design system | Done. Tokens and components in `src/renderer/components/` and the CSS layers. |
| 3 | Database | Done. 48 tables, append-only migrations with checksums, integrity check. Schema version 2. |
| 4 | Shell, auth, setup, activation | Done. Covered by `tests/integration/smoke.test.ts`. |
| 5 | Patients and clinical | Done. Covered by `workflows.test.ts` and `clinical.test.ts`. |
| 6 | Appointments and queue | Done. Covered by `operations.test.ts`. |
| 7 | Prescription, print, PDF | Code done and covered by `tests/ui/print.test.tsx`. **The printed Bengali output on paper is still unverified** — no Electron or Chromium binary can be downloaded here. |
| 8 | Billing and payments | Done. Fixed-point reconciliation, overpayment control and archive blocking all covered. |
| 9 | Inventory and accounting | Done. Batch FIFO valuation, low-stock and expiry alerts covered. |
| 10 | Staff, users, RBAC, audit | Done. Service-boundary denial covered. |
| 11 | Backup, restore, settings | Done. Create/validate/restore/guarded-delete covered, including attachment round-trip. |
| 12 | Search, notifications, reports | Done. Global search, notification feed and payload-dependent report authorisation covered. |
| 13 | Testing | Done. 106 tests across 9 files: unit, integration, interface, boot flow and print. |
| 14 | Security, licence and documentation audit | Done. Security suite, dependency audit, and all 12 mandatory documents. |
| 15 | Packaging | **Code and configuration done; the installer has not been produced.** `electron-builder` config, release-preparation script, icon and both GitHub Actions workflows are in place. |
| 16 | Clean-machine validation | **Not started.** Blocked on Phase 15. |
| 17 | Release | **Not started.** Blocked on Phase 16. |

---

## What has been verified, and how

Every claim below was executed. The full log is in [TEST-REPORT.md](TEST-REPORT.md).

| | Result |
|---|---|
| `npm run typecheck` (renderer + core) | clean |
| `npm run typecheck:node` (main + scripts) | clean |
| `npm test` | **106 passed, 0 failed**, 9 files |
| `npm run build:renderer` | built, 560 kB bundle including both typefaces |
| `npm run build:node` | clean |
| `node scripts/package-release.mjs` | exit 0; licences collected, fonts confirmed, no activation literal in the build |
| `npm run stress` | all 7 operations within budget at 8,000 patients / 24,000 invoices (31.6 MiB) |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |

**Load profile at practice scale** (8,000 patients, 24,000 invoices, 8,000 payments):

| Operation | p50 | p95 | max | budget |
|---|---|---|---|---|
| Patient search (Bengali and English) | 5.5 ms | 13.4 ms | 14.9 ms | 250 ms |
| Patient list, first page | 2.9 ms | 4.4 ms | 5.0 ms | 400 ms |
| Patient detail | 1.3 ms | 2.3 ms | 5.4 ms | 120 ms |
| Invoice create | 6.1 ms | 16.6 ms | 19.7 ms | 150 ms |
| Payment allocation | 6.1 ms | 19.1 ms | 19.1 ms | 150 ms |
| Daily collection report | 3.7 ms | 10.0 ms | 10.0 ms | 800 ms |
| Full backup (26.5 MiB) | 220.8 ms | — | 220.8 ms | 4,000 ms |

---

## What testing has actually caught

Recorded because a suite that has never failed proves nothing. Sixteen real defects were found and
fixed. The five that typechecked cleanly and would all have shipped broken are worth reading about.

| # | Defect | Found by |
|---|---|---|
| 1 | Inventory page read `alerts.data.low`; the core returns `lowStock`. The page threw on every visit. | Interface tests |
| 2 | Inventory valuation asked for four fields the core never returned. | Interface tests |
| 3 | The host bridge was cached module-wide; a reloaded window kept calling a dead preload. | Interface tests |
| 4 | Sidebar items had an empty permission string, so Staff, Backups and Settings were shown to every role and then refused. | Interface tests |
| 5 | Latin heading tracking was inherited by Bengali runs, splitting conjuncts on paper. | Print tests |
| 6 | `word-break: break-word` split every Bengali word. | Print tests |
| 7 | The sans font stack had no source for the taka sign `৳`. | Print tests |
| 8 | The clinic monogram and "For &lt;clinic&gt;" rendered Bengali unstyled. | Print tests |
| 9 | Signing out did not revoke the presented session token. | Security tests |
| 10 | A stored scrypt hash with weakened cost parameters was trusted. | Security tests |
| 11 | `Inventory.tsx` called `inventory.suppliers.list`, which does not exist. | Contract tests |
| 12 | `package.json` `main` pointed at a path the compiler never emits; the main process resolved its renderer HTML one level short. | Release-preparation script |
| 13 | There was no electron-builder configuration, so the installer would not have been named `Dentiva-Pro-Setup.exe` and the preload would not have been packaged. | Release-preparation script |
| 14 | The API client read the session token from render state, so the first calls after sign-in went out with no token and the session was cleared again. | Boot-flow tests |
| 15 | Unsaved form state went nowhere on auto-lock: the `drafts` table existed but only held prescription drafts. | Review against the requirements |
| 16 | The browser preview opened `/print.html`, which has never existed. | Print work |

---

## What remains

### 1. Build the Windows installer — blocking

`npm run pack:win` has never been run successfully. `electron-builder` downloads the Electron binary
and the NSIS toolchain at package time, and every route to those artefacts is blocked from this
environment:

| Source | Result |
|---|---|
| `github.com/electron/electron` release assets | blocked |
| `npmmirror.com` Electron mirror | SSL failure |
| `cdn.jsdelivr.net` Electron mirror | SSL failure |
| `edgedl.me.gvt1.com` | blocked |
| `storage.googleapis.com/chrome-for-testing-public` | blocked |

**This is an environment limitation, not a code defect.** The configuration, the release script, the
icon and both workflows are in place and ready. The next step is a `git push` of the `v1.0.0` tag,
which triggers `.github/workflows/release.yml` on `windows-latest` where those downloads work.

**Fallback if GitHub Release publication fails:** the installer is uploaded as a workflow artefact
before publication is attempted, and the `publish` job is `continue-on-error: true`, so a permissions
or CDN problem cannot lose the build. The artefact is retrievable from the run page.

### 2. Clean-machine installation test — blocking

Windows 10 or 11, 64-bit, with no development runtimes. The full procedure is
[RELEASE-CHECKLIST.md §10](RELEASE-CHECKLIST.md). Roughly two hours including a restore test.

### 3. Printed Bengali verification — blocking

Fifteen checks, [RELEASE-CHECKLIST.md §4](RELEASE-CHECKLIST.md). Print a prescription in Bengali on A4,
A5 and thermal; confirm conjuncts are joined; save a PDF and confirm the Bengali is **selectable
text**, not an image. The automated suite has verified everything that can be verified without
paper — the document model, the font application, the stylesheet rules, the font's code-point coverage
— but shaping, rasterisation and printer-driver substitution are outside its reach, and only a real
print settles them.

### 4. Test on Windows — blocking

Everything so far was executed on Linux. Node, SQLite, filesystem paths, printer integration and
Electron packaging all differ. This is the single largest remaining risk.

### 5. Smaller outstanding items

| Item | Why it is still open |
|---|---|
| Print-window chrome is not covered by the interface suite | The print *documents* are; the preview toolbar around them is not. The five boot-flow screens are now covered by 13 tests |
| No automated 1280×720 / 1920×1080 / 125–200% DPI sweep | Needs a real display; the checklist covers it manually |
| No long soak test | The load profile reaches 31.6 MiB, not 5 GiB |
| No third-party security or accessibility review | Not commissioned |

---

## Quality gates

Per the project's own rule: **if any final quality gate is NO, the product is not ready and must not be
released.**

| Gate | Status |
|---|---|
| Typecheck | **YES** |
| Automated tests | **YES** — 106/106 |
| Renderer and core build | **YES** |
| Release preparation | **YES** |
| Load within budget | **YES** |
| Dependencies reviewed, licensed and audited | **YES** |
| Documentation complete (12 documents) | **YES** |
| CI workflow | **YES** — executed on every push; green on the last four runs, with two earlier unexplained failures recorded in [TEST-REPORT.md §2.5](TEST-REPORT.md) |
| Release workflow | **YES** — written, never executed. Needs to be on `main` before it can be dispatched. |
| **Windows installer built** | **NO** |
| **Clean-machine installation tested** | **NO** |
| **Bengali verified on printed paper and PDF** | **NO** |
| **Tested on the target operating system** | **NO** |
| Third-party security review | **NO** |

**Overall: NO — not ready for release.**

---

## Environment constraints encountered

Recorded so the same walls are not hit twice.

- Electron, Chromium and Chrome-for-Testing binaries cannot be downloaded. nsmmirror, jsDelivr,
  Google's CDN and GitHub release assets are all blocked or fail SSL.
- The .NET SDK is unavailable (`dot.net` fails SSL), which rules out any .NET-based packaging route.
- npmjs.org and the npm registry API are reachable; that is how dependencies were installed.
- `convert` (ImageMagick) is available and was used to produce `build/icon.ico` from the generated
  source image.

---

## Commit history

| Commit | What it did |
|---|---|
| `fb1917e` | Load profile retried once, loudly; its output uploaded as an artefact |
| `31bc4dd`, `918f960` | Load profile output moved to the job summary and an artefact, after two CI failures whose logs could not be retrieved |
| *(earlier)* | Boot-flow interface tests; session-token race fixed; unsaved-work drafts kept across auto-lock |
| `b27457b` | Windows build made possible (paths, preload copy, electron-builder config); architecture, database, security, printing, dependency-audit and test-report documents; icon |
| `bea8aa8` | Bengali-on-paper verification; four print faults fixed; dead `/print.html` path removed |
| `94ba547` | Development host restored; `scripts/stress.ts` load harness; dead package scripts removed; `@playwright/test` dropped |
| `facc515` | Interface tests rendering real pages against the live core; Inventory crash and stale-bridge bugs fixed; navigation permissions corrected |
| `e11f70b` | Session, password and activation hardening; 11-test security suite |
| `734ffbc` | Activation made a real global gate with a tamper-evident record |
| `65405a0` | Contract test keeping the interface and the core in step |
| (earlier) | Schema and migrations, fixed-point money, validation, security, settings, audit, paths, container, all domain APIs, shell, pages, print documents |

---

## How to pick this up again

```bash
npm ci
npm run verify            # typecheck, test, build — all green at HEAD
npm run dev               # run it in a browser against a real local core
npm test                  # 106 tests
npm run stress            # load profile
```

Then, in order:

1. Push the `v1.0.0` tag and let `.github/workflows/release.yml` build the installer.
2. Download `Dentiva-Pro-Setup.exe` and run [RELEASE-CHECKLIST.md §10](RELEASE-CHECKLIST.md) on a
   clean Windows machine.
3. Run [RELEASE-CHECKLIST.md §4](RELEASE-CHECKLIST.md) for the printed Bengali checks.
4. Fill in the results, update this file and [TEST-REPORT.md](TEST-REPORT.md), and release.
