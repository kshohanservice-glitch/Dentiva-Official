# Dentiva Pro — Architecture

Dentiva Pro is a single-window Windows desktop application for a dental clinic. It runs entirely on the
clinic's own computer: no server, no cloud account, no network call of any kind after installation.

This document describes how the pieces fit together. For the data model see [DATABASE.md](DATABASE.md);
for the security model see [SECURITY.md](SECURITY.md).

---

## 1. The shape of the system

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Windows machine                                                          │
│                                                                          │
│  ┌──────────────────────── Electron main process ───────────────────────┐ │
│  │  src/main/                                                            │ │
│  │    index.ts   window, menu, navigation guards, theme, single instance│ │
│  │    host.ts    IPC: the only code allowed to touch the file system    │ │
│  │    print.ts   print preview window, printToPDF, silent printing      │ │
│  │    preload.cjs  the entire renderer-visible surface (contextIsolated)│ │
│  └───────────────┬──────────────────────────────────────────────────────┘ │
│                  │ contextBridge, contextIsolation: true, sandbox: true  │
│  ┌───────────────▼──────────────────────────────────────────────────────┐ │
│  │  Renderer — sandboxed, no Node, no filesystem                        │ │
│  │  src/renderer/                                                       │ │
│  │    bridge.ts        the single transport; picks Electron or preview  │ │
│  │    app/             shell, router, navigation, permissions, state    │ │
│  │    pages/           20 screens                                       │ │
│  │    print/           invoice, prescription, receipt, slip, report, …  │ │
│  └───────────────┬──────────────────────────────────────────────────────┘ │
│                  │ invoke(op, input, token) — nothing else               │
│  ┌───────────────▼──────────────────────────────────────────────────────┐ │
│  │  Service core — the only place business rules live                   │ │
│  │  src/core/                                                            │ │
│  │    registry.ts     activation gate, session, per-operation rules     │ │
│  │    api/            189 operations across 36 groups                   │ │
│  │    db/             schema, migrations, connection                    │ │
│  │    security/       scrypt, RBAC, activation verifier                 │ │
│  │    services/       backup, settings, safe file handling              │ │
│  └───────────────┬──────────────────────────────────────────────────────┘ │
│                  │ synchronous, same process                            │
│  ┌───────────────▼──────────────────────────────────────────────────────┐ │
│  │  dentiva.db — SQLite via node-sqlite3-wasm, on the local disk        │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

There is no separate backend. The Electron main process, the renderer and the service core are three
layers in one process, joined by two narrow interfaces: an IPC bridge for the renderer, and a
function call for the core.

---

## 2. The service core

Everything that must be true regardless of who is asking lives in `src/core/`. The renderer can never
write to the database, and the main process never makes a business decision.

### 2.1 Operations

The core exposes **189 operations in 36 groups**. They are declared as data, not as a class hierarchy:

```ts
// src/core/api/patients.ts
list: {
  perms: ['patients.view'],
  label: 'List patients',
  handler: ({ c }, input: unknown) => { /* … */ },
},
```

`src/core/registry.ts` walks every operation on every call and enforces, in this order:

1. **Activation** — unless the operation is explicitly exempt, a deactivated install refuses to do
   anything at all. This is a single global gate, not a check in each handler.
2. **Authentication** — the call must carry a live session token, unless the operation is `public`.
3. **Permission** — the actor's role must hold the operation's permissions, or satisfy its `guard`,
   a function that can decide from the payload.
4. **Validation** — the operation's own `Validator` normalises and bounds the input.
5. **The handler.**

Because steps 1–3 run before the handler, a handler can never forget to check them. The catalogue
returned by `operationCatalogue()` is what the contract tests assert against, so a new operation
without a declared permission is a test failure rather than a silent hole.

Of the 189 operations, 10 are `public` (status, setup, sign-in, activation) and 6 are `guarded`
(operations whose permission depends on the payload, such as the report printer and the per-role
attachment read).

### 2.2 Validation

`src/core/validation.ts` provides a `Validator` that accumulates field errors and reports them all at
once, so a form can highlight every bad field in one pass instead of one per attempt. It trims strings,
parses fixed-point integers, normalises phone numbers, checks date keys, and bounds every length.

### 2.3 Money

Money is **never** a floating-point number anywhere in the system.

- Storage: `INTEGER` columns named `*_poisha`. `৳7,500.00` is `750000`.
- Quantities: `*_milli` columns. One unit is `1000`.
- Percentages: `*PercentBp` in basis points. 10% is `1000`.
- Arithmetic: `src/core/money/money.ts` works in integers and rounds half-up at exactly one place,
  once, at the end of a calculation.

`tests/unit/contract.test.ts` runs a seeded audit over 28 financial and reporting operations and
asserts that every amount crossing the boundary is a whole number of poisha — the check that would
fail if a stray `* 0.01` ever crept in.

### 2.4 Error handling

Handlers throw `AppError` subclasses. The registry converts them to a serialised envelope:

```ts
{ ok: false, error: { code, message, issues: [{ field, message }], detail } }
```

`code` is a stable machine string (`validation`, `permission_denied`, `not_found`, `conflict`,
`unauthenticated`, `locked_out`, `not_activated`, …). `message` is written for a receptionist, never a
stack trace. Diagnostics live in the log file and in the Diagnostics panel, which is separate from
the message the user sees.

---

## 3. The transport bridge

`src/renderer/bridge.ts` is the renderer's only way out. It returns one of two implementations:

| | Packaged app | Development preview |
|---|---|---|
| Runtime | `electron` | `browser` |
| Transport | `contextBridge` IPC | `fetch` to `/api/*` on loopback |
| Printing | native print controller, `printToPDF` | the browser print dialog |
| Files | native dialogs, `shell.openPath` | browser download |

Both speak the same operation surface and the same envelope, so a preview behaves like the shipped
product. The only differences are the ones that genuinely cannot be reproduced in a browser: the
system printer list, native file dialogs, and PDF file writing.

The bridge caches itself against the exact `window.dentivaHost` object it was built from. If the
preload is replaced — which is what a window reload does — the bridge rebuilds, so a reloaded window
can never keep talking to a host that has gone away.

### 3.1 What the renderer may reach

`src/main/preload.cjs` exposes a fixed set of channels: `host:info`, `host:invoke`, `host:printers`,
`host:print`, `host:print:pdf`, `host:print:open`, `host:print:ready`, `host:print:deliver`,
`host:print:action`, `host:print:closed`, `host:file:*`, `host:appearance`, `host:window`. Nothing else
crosses the boundary, `contextIsolation` is on, `sandbox` is on, and `nodeIntegration` is off.

---

## 4. The renderer

- **React 19**, built by Vite into a single bundle under `dist/renderer/`.
- **No router library.** `src/renderer/app/router.tsx` is about thirty lines over `location.hash`.
  The route is always visible in the URL, which matters for support ("what were you on when it
  happened?") and costs nothing to keep.
- **State** lives in one provider (`app/state.tsx`): the session, the actor's permissions, the clinic
  identity, display preferences, and a `refreshSignal` counter that pages subscribe to.
- **Data loading** is `useResource(fn, deps)`, which re-runs when the signal changes. There is no
  client-side cache to invalidate, because there is no cache.
- **Navigation permissions** mirror the core's. A role that cannot reach an operation does not see a
  link to it. This is a convenience, not a security boundary — the core is what enforces it, and a
  hidden link is never the only thing standing between a user and a record.

### 4.1 Printing

Every printable document is a React component that takes a model and returns a laid-out page. The
same component serves the on-screen preview, the printer and the PDF, so what you preview is what
prints. See [PRINTING.md](PRINTING.md).

---

## 5. Storage on disk

```
%APPDATA%\Dentiva Pro\            (Windows)
├── dentiva.db                    SQLite database
├── dentiva.db-wal  /  -shm       write-ahead log
├── attachments\                  uploaded X-rays, reports
├── exports\                      default destination for CSV exports
├── backups\                      default backup folder
├── cache\
└── logs\                         rolling log files
```

Paths are resolved in `src/core/paths.ts` and created on demand. The location is shown in
Settings → Storage, and `system.status` returns it, so a clinic can find its data without guessing.

---

## 6. The development preview

`npm run dev` starts two processes:

- `scripts/dev-host.ts` — a loopback HTTP server exposing exactly three routes: `POST /api/invoke`,
  `POST /api/host-info`, `POST /api/printers`. It serves the **same container** the packaged app
  uses. It binds to `127.0.0.1` only.
- Vite on port 5183, which proxies `/api` to that host.

This exists so the interface can be worked on and tested without a Windows packaging step. It is not
a mock: a UI test that renders a page here is rendering it against the real service core, which is
how `tests/ui/` found a crash on the inventory page and a stale-transport bug that no amount of
typechecking would have caught.

---

## 7. Build and packaging

| Step | Command | Output |
|---|---|---|
| Compile core and main | `npm run build:node` | `out/` (CommonJS) |
| Build the renderer | `npm run build:renderer` | `dist/renderer/` |
| Package for Windows | `npm run pack:win` | `release/Dentiva-Pro-Setup.exe` |

`electron-builder` produces an NSIS installer named `Dentiva-Pro-Setup.exe`. The two build trees are
kept apart on purpose: `out/` is Node code that must never reach the renderer, and `dist/renderer/`
is the only thing the window is allowed to load.

---

## 8. Testing strategy

| Layer | Location | What it proves |
|---|---|---|
| Unit | `tests/unit/` | Money, validation, the dental chart, the queue, attachment safety |
| Integration | `tests/integration/` | Real operations against a real database in a temp directory |
| Interface | `tests/ui/` | Real pages, real transport, real core, in jsdom |
| Contract | `tests/unit/contract.test.ts` | Every renderer call resolves; permissions are declared; money stays integral |
| Security | `tests/integration/security.test.ts` | Hashing, sessions, lockout, activation, permission boundaries |
| Print | `tests/ui/print.test.tsx` | Bengali reaches the page intact, in the right font, with a usable signature area |
| Load | `scripts/stress.ts` | Latency at practice-sized data, against a real database |

The integration and interface suites share `tests/helpers/`, which builds a real container in a
temporary directory. No mocks stand in for the database anywhere in this repository.

---

## 9. Deliberate non-goals

- **No telemetry.** Nothing is measured, reported or phoned home. There is no analytics, no crash
  reporting and no update check.
- **No cloud sync.** Two clinics cannot share a database. If a clinic needs a second machine, that is
  a future product decision, not an assumption baked in here.
- **No network code.** The application contains no HTTP client for anything except the local
  development host. Removing the preview would leave a build with no way to reach the internet.
