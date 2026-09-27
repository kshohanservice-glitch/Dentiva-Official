# Dentiva Pro — Test Report

**Report date:** 2026-09-27
**Commit:** `bea8aa8` ("Verify Bengali on paper, not just on screen")
**Build environment:** Linux x64, Node v22.22.3
**Report author:** automated run, recorded verbatim below

This report states what was executed, what the result was, and — just as importantly — what was **not**
verified and why. No claim in this document is based on an assumed or inferred result.

---

## 1. Summary

| Gate | Command | Result |
|---|---|---|
| Typecheck (renderer + core, shared config) | `npm run typecheck` | **PASS** — no errors |
| Typecheck (main + core + scripts) | `npm run typecheck:node` | **PASS** — no errors |
| Automated tests | `npm test` | **PASS** — 106 tests, 9 files, 0 failures |
| Renderer build | `npm run build:renderer` | **PASS** — built in 2.71s |
| Core + main build | `npm run build:node` | **PASS** — no errors |
| Load profile | `npm run stress` | **PASS** — all operations within budget |
| Windows installer | `npm run pack:win` | **NOT RUN** — see §7 |
| Clean-machine installation | — | **NOT DONE** — see §7 |
| Printed Bengali on physical paper | — | **NOT DONE** — see §7 |

**The product is not release-ready.** Three mandatory gates have not been executed. This is stated at
the top because a report that buried it would be worse than useless.

---

## 2. What was executed

### 2.1 Typecheck

```
$ npx tsc -p tsconfig.json --noEmit
(no output — clean)

$ npx tsc -p tsconfig.node.json --noEmit
(no output — clean)
```

Both configurations run with `strict`, `noUncheckedIndexedAccess` and
`noFallthroughCasesInSwitch` enabled.

### 2.2 Automated tests

```
$ npx vitest run

 Test Files  9 passed (9)
      Tests  106 passed (106)
   Duration  44.48s
```

Every test runs against a **real** service core and a **real** SQLite database in a temporary
directory. There is no mocked database anywhere in this repository.

| File | Tests | Covers |
|---|---|---|
| `tests/integration/smoke.test.ts` | 9 | Fresh install, activation gate, setup, sign-in, lockout, first patient |
| `tests/ui/boot.test.tsx` | 13 | Activation screen, tampered activation, sign-in, lockout, forced password change, session revocation, unsaved-work drafts |
| `tests/integration/operations.test.ts` | 16 | Appointments, queue, inventory batches, accounting, attachments, print identity, passwords, search, notifications, data integrity |
| `tests/integration/workflows.test.ts` | 14 | End-to-end money flow, Bengali storage/search/print/export, dental chart, permissions, backup and restore, CSV quoting, audit |
| `tests/integration/clinical.test.ts` | 15 | Treatment catalogue, visits, invoice arithmetic, refunds, role administration, dentist records, print history, wipe safety |
| `tests/integration/security.test.ts` | 11 | scrypt, weakened parameters, password policy, activation, sensitive-data exclusion, permission boundaries, session revocation, lockout |
| `tests/ui/pages.test.tsx` | 14 | Real pages rendered in jsdom against the live core |
| `tests/ui/print.test.tsx` | 9 | Bengali on paper, print stylesheet, font bundling, signature area |
| `tests/unit/contract.test.ts` | 5 | Interface/core operation contract, money integrality |

### 2.3 Build

```
$ npx vite build
dist/renderer/assets/index-mfTt57s6.js   560.45 kB │ gzip: 153.16 kB
✓ built in 2.71s
```

The renderer bundle carries both Inter and Noto Sans Bengali, so the application has no runtime font
dependency.

### 2.4 Load profile

```
$ npm run stress -- --patients 8000 --invoices 24000

  seeded 8000 patients in 27.7s
  seeded 24000 invoices in 173.3s
  database:  31.6 MiB

  operation                                n     p50     p95     max   budget  result
  patient search (Bengali and English)    60    5.5    13.4    14.9    250ms  pass
  patient list, first page                40    2.9     4.4     5.0    400ms  pass
  patient detail                          60    1.3     2.3     5.4    120ms  pass
  invoice create                          75    6.1    16.6    19.7    150ms  pass
  payment allocation                      15    6.1    19.1    19.1    150ms  pass
  daily collection report                 12    3.7    10.0    10.0    800ms  pass
  backups.create                           1  220.8   220.8   220.8   4000ms  pass

  backup archive: 26.5 MiB written in 220.8ms
```

This is a real database with 8,000 patients, 24,000 invoices and 8,000 payments, built through the real
operations. A single-clinic practice is unlikely to exceed this within several years, and every
interaction a receptionist has is under 20 ms at that size.

### 2.5 GitHub Actions CI

CI has been executed on every push to this branch. Seven runs:

| Run | Event | Result |
|---|---|---|
| 36308595064 | push | success |
| 36308679905 | pull request | success |
| 36309433700 | push | **failure** — load profile step |
| 36309435651 | pull request | success |
| 36309881087 | push | success |
| 36309883354 | pull request | **failure** — load profile step |
| 36310006047 | pull request | success |
| 36310003437 | push | success |
| 36310131156 | push | success |
| 36310133429 | pull request | success |

**The two failures were not diagnosed, and are recorded as unexplained.** Both were the load-profile
step. The GitHub Actions log service and the artefact storage service are both unreachable from the
environment this work was done in, so the runner output could not be retrieved either time — there is
no way to state a cause without guessing. The identical command passes locally in 26 seconds and on
every run since. The step now retries once and announces the retry rather than hiding it.

The honest summary: **CI is green now, and it has failed twice for a reason nobody has been able to
read.** That is not the same as "CI is reliable", and it should be watched.

Reproduce with:

```
npm run stress                          # the default profile above
npm run stress -- --patients 20000 --invoices 60000
npm run stress -- --json                # machine-readable
```

### 2.6 Release builds

Every release attempt is recorded, including the failures.

| Run | Tag → commit | Result | What it proves |
|---|---|---|---|
| 36310526904 | `v1.0.0` → `a83d50b` | **failure** — packaging | The Windows build produced nothing: `win.publisherName` is not an electron-builder option (defect 17) |
| 36310672953 | `v1.0.0` → `7d2ccb2` | **failure** — packaging | Diagnostic build, run to recover the cause of the above. It failed identically, and printed the cause as a check annotation |
| 36310881319 | `v1.0.0` → `97a91f7` | **failure** — publication | **The Windows installer built and passed its own checks.** The publish step then failed on its own mistakes (defect 18) |
| 36311134819 | `v1.0.0` → `fb30765` | green — **but wrong** | The installer built again, and a release was created — on the tag `v`. The run passed. (defect 19) |
| 36311479523 | `v1.0.0` → `49e718d` | see §9 | Version plumbing and publication guards applied |

The recovery is worth recording as a process point, because it is unusual. Runs 1 and 2 could not be
diagnosed by reading their logs: the GitHub Actions log service and the artefact storage service are
both unreachable from this environment, and no amount of retrying changed that. The cause was recovered
instead by making the build raise its own failure as a **check annotation**, which is served by a
different API and is always retrievable. That is a hack, and it is recorded as one: it exists because
the normal channel was unavailable, and the correct permanent answer is a working log store.

Two conclusions follow, and both are stated without hedging:

- **A Windows installer has been built.** Run 36310881319 produced `Dentiva-Pro-Setup.exe` and that
  job passed, which includes checking that the file exists, is over 40 MB, and begins with the `MZ`
  header of a Windows executable. This is evidence that the build works; it is **not** evidence that
  the installer runs.
- **A release is not the same as a successful run.** Run 36310881319 built the product and still
  failed, for two reasons that had nothing to do with the product. Both are fixed in run 36311134819.

---

## 3. What the tests actually caught

A test suite that has never failed is a test suite nobody trusts. These are real defects that were
found and fixed during this work.

| # | Defect | Found by | Consequence had it shipped |
|---|---|---|---|
| 1 | `Inventory.tsx` read `alerts.data.low`; the core returns `lowStock` | `tests/ui/pages.test.tsx` | The inventory page threw on every visit — it never rendered at all |
| 2 | Inventory valuation asked for `totalItems`, `totalUnits`, `costValue` and `retailValue`, none of which existed | `tests/ui/pages.test.tsx` | Stock valuation and margins were unreachable |
| 3 | The host bridge was cached module-wide | `tests/ui/pages.test.tsx` | A reloaded window kept calling a preload that had gone away |
| 4 | Sidebar items had an empty permission string | `tests/ui/pages.test.tsx` | Staff, Backups and Settings were shown to every role and then refused by the core |
| 5 | Latin heading tracking was inherited by Bengali runs | `tests/ui/print.test.tsx` | Conjuncts printed split in half on paper |
| 6 | `word-break: break-word` split every Bengali word | `tests/ui/print.test.tsx` | Bengali broke mid-word in every document |
| 7 | The sans font stack had no source for the taka sign `৳` | `tests/ui/print.test.tsx` | The currency sign depended on whatever the machine had installed |
| 8 | The clinic monogram and "For &lt;clinic&gt;" rendered Bengali unstyled | `tests/ui/print.test.tsx` | Two Bengali runs per document printed in a Latin fallback |
| 9 | Signing out did not revoke the presented token | `tests/integration/security.test.ts` | A copied session token survived sign-out |
| 10 | A stored scrypt hash with weakened cost parameters was trusted | `tests/integration/security.test.ts` | A hand-edited hash turned verification into a cheap oracle |
| 11 | `Inventory.tsx` called `inventory.suppliers.list`, which does not exist | `tests/unit/contract.test.ts` | The supplier selector threw when opened |
| 12 | The browser preview opened `/print.html`, which does not exist | Manual review during the print work | Preview printing was a dead path |
| 13 | `package.json` `main` pointed at `out/main/index.js`; the compiler emits `out/src/main/index.js`, and the main process resolved its renderer HTML one level short | Release-preparation script | The packaged application could not have started at all |
| 14 | There was no electron-builder configuration | Release-preparation script | The installer would have been named by a default, not `Dentiva-Pro-Setup.exe`, and the preload would not have been included |
| 15 | The API client read the session token from render state, so the first calls after signing in went out with no token | `tests/ui/boot.test.tsx` | **After every sign-in the sidebar came up empty and the dashboard said "This could not be loaded"** — the application looked broken to a receptionist on first use |
| 16 | Unsaved form state was not kept anywhere: the `drafts` table existed but only held prescription drafts | Review against the requirements | An auto-lock threw away a half-typed patient record, a long invoice, or a split payment |
| 17 | `win.publisherName` is not an electron-builder 26 option — it is not an NSIS option either | **The first Windows release build (run 36310526904)** | There was no installer at all. The build died on a schema check before producing a single byte |
| 18 | The publish step asked for `release/THIRD-PARTY-NOTICES.txt` and `release/build-manifest.json`, which the release script writes to the repository root, with `fail_on_unmatched_files: true` | Release run 36310881319 | The installer built, and then publication failed anyway — twice over, since the step also named the release `1.0.0` when the tag was `v1.0.0` |

Defect 17 is the one worth dwelling on. The packaging configuration passed every local gate,
typechecked, and passed the release-preparation script — because nothing in the local toolchain
validates the electron-builder configuration at all. It is validated only when electron-builder runs,
which happens on a Windows runner, minutes into a CI run. The run then failed, and the log could not
be retrieved from the environment this work was done in, so for a full cycle the cause was unknown.
It is now known: the option is not in electron-builder's schema. `scripts/package-release.mjs` compiles
that schema with ajv and fails the build locally if the configuration does not match, and separately
checks the things a schema cannot express — the installer's name, the shortcuts, the refusal to delete
a clinic's data on uninstall, and that `package.json` `main` is a path the build actually produces.
Each of those five checks was confirmed to fail when the corresponding value was broken.

Defect 18 is the lesson that a green build is not a released product. Two separate mistakes in the
publication step, neither of which affects the installer, each sufficient on its own to fail the run.

Defect 19 is worse, and it is why that run is recorded as green *and* wrong. The verify job's `version`
output was **always** empty: the step wrote `value=1.0.0` to `GITHUB_OUTPUT` while the job output read
`steps.version.outputs.version`, so the two names never met. Every downstream consumer therefore
received an empty string, and the release was created on the tag `v` — a published release attached to a
meaningless tag, with `release-info.txt` recording no version. The run stayed green throughout, because
the publish step was marked `continue-on-error` and nothing afterwards checked whether the release
existed at all.

A green run is a claim, and that run made a false one. The fix is not a retry: the version is now
rejected if it is empty or is not `MAJOR.MINOR.PATCH` before the Windows build begins, and the final
step fails the run unless a release exists on the expected tag carrying the installer, its checksum and
its release info — naming whichever is missing. The `continue-on-error` is gone, and the tag `v` that
run created has been deleted.

Defect 15 is the one that would have been reported on day one in a clinic: sign in, and the
application comes up with an empty sidebar and "this could not be loaded" on the dashboard. It
typechecked cleanly, it passed every unit test, and no code review would have caught it — a page's
effects run before the provider's, so the first calls after sign-in went out with no token.

Defects 1–4 and 13–16 are the clearest argument for the interface suite and the release script: all
six typechecked cleanly, and all six would have shipped broken.

---

## 4. Coverage of the security requirements

| Requirement | Where verified | Result |
|---|---|---|
| Memory-hard password hashing, no plaintext | `security.test.ts` → *scrypt with a per-password salt* | PASS |
| Weakened cost parameters rejected | `security.test.ts` → *refuses a hash whose cost was weakened by hand* | PASS |
| Password policy enforced | `security.test.ts` → *applies the clinic password policy and the username rule* | PASS |
| No plaintext admin password anywhere | `security.test.ts` + review of the tree | PASS |
| Sessions revoked on sign-out | `security.test.ts` → *refuses a token from a revoked or expired session* | PASS |
| Absolute session lifetime | `container.ts` (`ABSOLUTE_SESSION_HOURS = 12`) | PASS (by construction) |
| Login lockout | `security.test.ts` → *counts and locks repeated failures* | PASS |
| User enumeration prevented | `security.test.ts` → *does not reveal whether a patient exists* | PASS |
| RBAC at the service boundary | `security.test.ts`, `workflows.test.ts`, `contract.test.ts` | PASS |
| Financial rules at the service boundary | `workflows.test.ts` → *blocks overpayment*, *refuses to archive a patient who still owes money* | PASS |
| Activation verifier, no code in the repository | `security.test.ts` → three activation tests + review of `activation.ts` | PASS |
| Tampered activation detected | `security.test.ts` → *reports an edited record as unactivated* | PASS |
| No secrets in database, logs, exports or diagnostics | `security.test.ts` → *nothing sensitive is written to disk* | PASS |
| Attachment traversal refused | `operations.test.ts` → *stores a file, reads it back byte for byte, and refuses traversal* | PASS |
| No raw stack trace to the user | `errors.ts` (reviewed; `smoke.test.ts` asserts message shape) | PASS |

---

## 5. Coverage of the Bengali requirement

| Surface | Verified how | Result |
|---|---|---|
| Database storage | `workflows.test.ts` → *round-trips Bengali names*; `print.test.tsx` asserts code-point equality | PASS |
| Search | `smoke.test.ts` → *finds a Bengali-named patient through global search* | PASS |
| Print models | `print.test.tsx` → *prints the Bengali the doctor typed, character for character* | PASS |
| Font application | `print.test.tsx` → *styles every Bengali run*; DOM walk over all six documents | PASS |
| Font shipped offline | `print.test.tsx` → *bundles Noto Sans Bengali*; file existence and size asserted | PASS |
| Taka sign coverage | `print.test.tsx` → the font's declared code-point range is checked to contain U+09F3 | PASS |
| CSV export | `workflows.test.ts` → *writes UTF-8 with a byte order mark* | PASS |
| Bengali numerals as display only | `print.test.tsx` → *a display choice, never a storage change* | PASS |
| **Printed output on paper** | — | **NOT VERIFIED** — see §7 |

---

## 6. Interface coverage

Fourteen pages are rendered in jsdom against the live core: Patients, Patient Detail, Appointments,
Queue, Invoice Form, Reports, Inventory, Accounting, Staff, Settings, Backup, About, and the shell
(chrome, navigation, and role-based hiding).

**Now covered by the interface suite:** the first-run setup gate, the activation screen (including a
tampered activation record), the sign-in screen, the forced password change, session revocation, and
draft recovery — 13 tests in `tests/ui/boot.test.tsx`.

**Still not covered:** the print **window** chrome (the preview toolbar around the documents). The print
*documents* are covered; the window that hosts them is not. That is a real, if narrow, gap.

---

## 7. What was NOT verified, and why

This section is the most important one in the report.

### 7.1 The Windows installer was never built

```
$ npm run pack:win
> electron-builder --win nsis --x64
```

**Not executed.** `electron-builder` downloads the Electron binary and the NSIS toolchain at package
time. In this build environment every route to those artefacts is blocked:

| Source | Result |
|---|---|
| `github.com/electron/electron` release assets | blocked |
| `npmmirror.com` Electron mirror | SSL failure |
| `cdn.jsdelivr.net` Electron mirror | SSL failure |
| `edgedl.me.gvt1.com` (Google CDN) | blocked |
| `storage.googleapis.com/chrome-for-testing-public` | blocked |

This is an environment limitation, not a code defect. `package.json` declares the build configuration
and `.github/workflows/release.yml` runs it on Windows, where these downloads work. **That workflow has
never run.** The installer has never been produced, so no claim is made about it.

### 7.2 No clean-machine installation test

Because there is no installer, there is nothing to install. A clean-machine test means: a Windows
machine with no development tooling, no Node, no .NET, running `Dentiva-Pro-Setup.exe`, completing
activation, setup, and creating a real invoice — with the full checklist in
[RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md). This has not been done.

### 7.3 No Bengali PDF was produced from the real print path

`printToPDF` is a Chromium API. Chromium cannot be downloaded in this environment (§7.1), so no PDF
has been generated by the application's own pipeline.

What **has** been done instead, in `tests/ui/print.test.tsx`:

- The six real document components were rendered with real Bengali content built by the real core.
- The rendered DOM was walked, and the test fails if any Bengali run is not inside a styled span.
- The print stylesheet was asserted to reset Latin tracking on Bengali, to break words only when
  necessary, to preserve background colours, and to zero the page margin.
- The font was confirmed to be present in the repository, non-empty, and to declare coverage of the
  taka sign.
- Bengali was confirmed to survive the database round trip code-point for code-point.

**What this does not prove:** how the glyphs look on physical paper. Shaping, rasterisation, printer
driver substitution and paper are all outside it. Only a real print settles that, and it is recorded as
outstanding rather than assumed.

### 7.4 No third-party security review

Every security result in §4 is the author's own testing. There has been no penetration test by an
independent party. [SECURITY.md](SECURITY.md) §13 records this.

### 7.5 No third-party accessibility audit

The interface has been reviewed against the contrast, focus-order and keyboard requirements, and the
print stylesheet is structured for readability, but no automated or manual audit with assistive
technology has been performed.

### 7.6 Not tested on Windows

Everything in this report was executed on Linux. The application targets Windows. Node, SQLite, the
filesystem paths, the printer integration and the Electron packaging all differ. This is a genuine gap
and it is the single largest reason the product is not ready.

---

## 8. Honest statement of limits

Software testing establishes the presence of defects, never their absence. This report says "106 tests
pass", not "Dentiva Pro is bug-free". The specific limits of this run are:

- One platform (Linux), not the target platform (Windows).
- One resolution and DPI setting; no 1280×720 / 1920×1080 / 125–200% DPI sweep has been automated.
- No long-running soak test. The load profile measures a 31.6 MiB database, not a 5 GiB one.
- No concurrent-user testing. The application is single-process and single-user by design; two
  Windows sessions on the same file were not tested.
- No upgrade test from an older installer, because there is no older installer.
- The interface suite covers 14 of 20 pages, plus the five boot-flow screens; the print window chrome is not covered.

---

## 9. Release gate

Per the project's own rule: **if any final quality gate is NO, the product is not ready and must not
be released.**

| Gate | Status |
|---|---|
| Typecheck | **YES** |
| Automated tests | **YES** |
| Renderer and core build | **YES** |
| Load within budget | **YES** |
| Dependencies reviewed and licensed | **YES** — see [DEPENDENCY-LICENSE-AUDIT.md](DEPENDENCY-LICENSE-AUDIT.md) |
| Documentation complete | **YES** |
| Windows installer built | **NO** |
| Clean-machine installation tested | **NO** |
| Bengali verified on printed paper and PDF | **NO** |
| Tested on Windows | **NO** |

**Overall: NO — not ready for release.** The remaining four gates are recorded as tracked work in
[AGENT-PROGRESS.md](AGENT-PROGRESS.md) and detailed step by step in
[RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).
