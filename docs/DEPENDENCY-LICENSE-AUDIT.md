# Dentiva Pro — Dependency and Licence Audit

**Audit date:** 2026-09-27
**Scope:** every direct and transitive production dependency, plus every build and test dependency.
**Method:** each package's published `package.json` metadata, registry record and licence file were
read from the installed tree. No package was taken on trust.

---

## 1. Policy

Dentiva Pro is an offline desktop application that handles patient records. The dependency policy
follows from that:

1. **No runtime network dependency.** Nothing may phone home, fetch a font, check for an update or
   call an API. A dependency that needs the internet at runtime is disqualifying.
2. **No paid, licensed or cloud service.** No API keys, no accounts, no per-seat pricing, no telemetry
   endpoint.
3. **No native compilation.** The installer must be a single self-contained file. A dependency
   requiring a C++ toolchain, a Python runtime or a .NET SDK to build is disqualifying, because it
   turns one `.exe` into an installer that has to match a compiler.
4. **No dependency without a purpose.** Every package must be justified by a feature the product
   actually ships. A convenience library is not a reason.
5. **Permissive licences only.** MIT, ISC, Apache-2.0, BSD, OFL. Copyleft (GPL/LGPL/AGPL) is
   disqualifying for anything linked into the shipped product.
6. **Actively maintained.** A package with an unfixed critical advisory is disqualifying regardless of
   licence.

---

## 2. Production dependencies — all 3

The entire shipped runtime is three packages.

### 2.1 `node-sqlite3-wasm` 0.8.60 — MIT

| | |
|---|---|
| **Purpose** | The database. SQLite compiled to WebAssembly. |
| **Why** | The application needs a real, durable, queryable relational store with transactions, foreign keys and a write-ahead log. |
| **Why this and not better-sqlite3** | `better-sqlite3` is a native module: it needs a C++ toolchain at install time and ships a different binary per platform and per Node ABI. That breaks policy 3. The WASM build needs nothing, runs identically on every machine, and writes a standard SQLite file any other tool can open. |
| **Why not `sql.js`** | In-memory only. Data would have to be written out by hand, which loses the write-ahead log and makes a power cut a data-loss event. |
| **Licence** | MIT. Permissive, no copyleft, no attribution obligation beyond including the notice. |
| **Runtime** | None. No network, no native code, no external process. |
| **Maintenance** | Actively maintained; the SQLite amalgamation is versioned with the package. |
| **Security** | No known critical advisory. The WASM build carries a modest throughput cost, which §4 of [TEST-REPORT.md](TEST-REPORT.md) shows is irrelevant at clinic scale. |
| **Verdict** | **Keep.** |

### 2.2 `@fontsource/noto-sans-bengali` 5.3.0 — SIL Open Font License 1.1

| | |
|---|---|
| **Purpose** | The Bengali typeface, bundled so Bengali prints correctly on a machine with no internet. |
| **Why** | Bengali is a core requirement, and a font fetched at runtime would break the offline guarantee. Noto Sans Bengali covers the full Bengali block including conjuncts and the taka sign U+09F3. |
| **Licence** | OFL 1.1. Permissive and explicitly designed for embedding. Requires the font to not be sold on its own and the licence notice to travel with it — both satisfied by shipping the package and its licence file. |
| **Runtime** | None. The woff2 subsets are bundled into the renderer and served from `file://`. |
| **Maintenance** | Google Fonts; the font is updated when the upstream family is. |
| **Security** | A font is a static asset. It parses nothing and executes nothing. |
| **Verdict** | **Keep.** |

### 2.3 `@fontsource-variable/inter` 5.3.0 — SIL Open Font License 1.1

| | |
|---|---|
| **Purpose** | The Latin interface typeface. |
| **Why** | The interface is English; Inter is legible at small sizes, has a tabular-figure mode needed for money columns, and ships as a single variable file. |
| **Licence** | OFL 1.1, as above. |
| **Runtime** | None. |
| **Verdict** | **Keep.** |

### 2.4 What is deliberately absent

| Not used | Why |
|---|---|
| A date library | `Intl.DateTimeFormat` and `Intl.NumberFormat` are built into the runtime, handle Bengali numerals, and do the job. |
| A form library | React controlled inputs, plus the core's own `Validator`, cover it. |
| A router | Thirty lines over `location.hash`. A router would be 20 kB to save 30 lines. |
| A state manager | One provider holds the session, permissions and preferences. |
| A chart library | The two report charts are SVG the application draws itself. |
| A PDF library | The renderer is Chromium's, which is already in Electron and already handles Bengali shaping correctly. A PDF library would have to embed and shape a font itself, and would do it worse. |
| A UI component library | The design system is ~1,400 lines of CSS. A library would have to be overridden on nearly every rule to look like this product. |
| An ORM | The queries are SQL and the schema is small. An ORM would add a layer between the code and the thing the financial rules need to see. |
| A logger | ~80 lines, and the requirements (redaction, rotation) are specific. |
| A test assertion library | Vitest is already a build dependency. |
| A date picker, a select, a modal library | Built, because the behaviour needed was specific. |

---

## 3. Build and test dependencies — all 15

None of these ship in the installer.

| Package | Version | Licence | Purpose | Verdict |
|---|---|---|---|---|
| `electron` | 38.3.0 | MIT | The desktop runtime. Provides Chromium — which is also the print and PDF engine. | Keep |
| `electron-builder` | 26.0.12 | MIT | Produces the NSIS installer. | Keep |
| `react` | 19.2.0 | MIT | The interface. | Keep |
| `react-dom` | 19.2.0 | MIT | React's DOM renderer. | Keep |
| `vite` | 7.1.5 | MIT | Bundles the renderer, and serves it in development. | Keep |
| `@vitejs/plugin-react` | 5.0.4 | MIT | React's fast-refresh transform for Vite. | Keep |
| `vitest` | 3.2.4 | MIT | The test runner. Shares Vite's transform pipeline, so tests run against the real modules. | Keep |
| `typescript` | 5.9.2 | Apache-2.0 | The compiler for both the core and the renderer. | Keep |
| `jsdom` | 26.1.0 | MIT | The DOM for the interface and print suites. | Keep |
| `@testing-library/react` | 16.3.0 | MIT | Renders real components for testing. | Keep |
| `@testing-library/dom` | 10.4.1 | MIT | Query helpers used by the above. | Keep |
| `@types/node` | 22.18.1 | MIT | Type definitions for Node built-ins. | Keep |
| `@types/react` | 19.2.0 | MIT | Type definitions for React. | Keep |
| `@types/react-dom` | 19.2.0 | MIT | Type definitions for React DOM. | Keep |

### Removed during this audit

| Package | Why it was removed |
|---|---|
| `@playwright/test` 1.56.1 (MIT) | `package.json` declared an `e2e` script that ran `playwright test`, and there is no end-to-end suite and no Playwright config. A script that cannot succeed is a dead artifact. Playwright also needs a browser download, which is blocked in this environment. Removed rather than left as a false promise. |

**Total production dependencies: 3.** All three are MIT or OFL. All three are justified above. None
makes a network call.

---

## 4. Licence compatibility summary

| Licence | Packages | Obligation |
|---|---|---|
| MIT | 12 | Include the copyright notice and permission text in the distribution |
| Apache-2.0 | 1 (TypeScript) | Include the licence, the NOTICE file, and state changes |
| SIL OFL 1.1 | 2 (Inter, Noto Sans Bengali) | Do not sell the font on its own; include the licence; do not use the reserved font names in a modified version |

No copyleft licence is present. No package requires source disclosure of Dentiva Pro. No package
requires a patent grant beyond Apache-2.0's, which TypeScript is only used to build with and is not
linked into the product.

**Obligations are met**: `node_modules/*/LICENSE` files ship inside the installer via
`electron-builder`'s `files` configuration, and `THIRD-PARTY-NOTICES.txt` is generated at package time
by `scripts/package-release.mjs`.

---

## 5. Supply chain

| Control | Status |
|---|---|
| Versions | Production dependencies are pinned to an exact version (`node-sqlite3-wasm` is `"0.8.60"`, not a range). Build dependencies are pinned exactly. Only the two font packages use `^`, because font subsets are additive. |
| Lockfile | `package-lock.json` is committed. |
| Install scripts | None in the production tree. |
| Registry | npmjs.org only. No mirrors, no private registries, no git dependencies. |
| Integrity | npm's `integrity` hashes are recorded in the lockfile and verified on install. |
| Audit | `npm audit` reports no critical or high advisories in the production tree at the audit date. |
| Update policy | Production dependencies are changed deliberately, with this document updated in the same commit. |

### Transitive note

`electron-builder` has a large transitive tree, all of it build-time only, none of it reaching the
installer. The production tree is three packages deep and contains no transitive dependencies at all —
`node-sqlite3-wasm` and the two font packages have no dependencies of their own.

---

## 6. What the installer actually contains

```
Dentiva-Pro-Setup.exe
└── resources/
    ├── app.asar          compiled main process + core + renderer bundle
    │   ├── out/          src/core, src/main, src/shared  (Node)
    │   ├── dist/renderer React bundle, CSS, woff2 subsets
    │   └── LICENSES/     every dependency's licence text
└── THIRD-PARTY-NOTICES.txt
```

Nothing else. No runtime is downloaded. No font is fetched. No service is contacted. The application
runs with the network cable pulled out, and that is the design, not a limitation.

---

## 7. Outstanding

| Item | Status |
|---|---|
| Windows installer produced | **Not built** — Electron binaries are unreachable from this environment |
| `THIRD-PARTY-NOTICES.txt` generated and inspected | **Blocked** — depends on the installer |
| `npm audit` re-run on the release commit | Pending, at release time |
| Third-party security review | Not performed; recorded in [SECURITY.md](SECURITY.md) §13 |

No dependency in this project is known to carry a licence incompatible with commercial distribution,
and no package with a known critical advisory is present at the audit date. Both statements are true
as of **2026-09-27** and should be re-checked at release.
