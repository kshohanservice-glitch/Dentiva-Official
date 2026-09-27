# Agent progress log — Dentiva Pro

This file is the running record of the build. It states what is done, what is
being worked on right now, what is left, and the honest test/build/release
status. It is updated after every significant change.

**Status of the product: NOT RELEASE-READY.** No installer has been built and no
clean-machine test has been run. See "Quality gates" at the bottom.

---

## Current phase

**Phase 13 — Testing (in progress), moving towards Phase 14 (security and
dependency/licence audit).**

The application code for phases 3–12 is written and typechecks. The immediate
work is proving that the written code actually behaves correctly at runtime, by
running the whole product through its own API in integration tests and fixing
what those tests find.

## Completed phases

| Phase | Deliverable | State |
| --- | --- | --- |
| 0 | Repository inspection | Done. Nothing reusable existed; useful config preserved. |
| 1 | `docs/MASTER-IMPLEMENTATION-PLAN.md` | Done. All 31 mandated sections plus executive summary, work phases and engineering decisions. |
| 2 | Design system | Done. Tokens and components in `src/renderer/components/` and the CSS layers. |
| 3 | Database | Done. Schema, append-only migrations, integrity check. Currently version 2. |
| 4 | Shell, auth, setup, activation | Done. Covered by `tests/integration/smoke.test.ts`. |
| 5 | Patients and clinical | Done. Covered by `workflows.test.ts`. |
| 6 | Appointments and queue | Done. Covered by `operations.test.ts`. |
| 7 | Prescription, print, PDF | Partially done. Print models covered by tests; the **actual printed Bengali output is still unverified** because no Electron binary can be downloaded in this sandbox. |
| 8 | Billing and payments | Done. Fixed-point reconciliation, overpayment control and archive blocking all covered. |
| 9 | Inventory and accounting | Done. Batch FEFO, valuation, low-stock and expiry alerts covered. |
| 10 | Staff, users, RBAC, audit | Done. Service-boundary denial covered. |
| 11 | Backup, restore, settings | Done. Create/validate/restore/guarded-delete covered, including attachment round-trip. |
| 12 | Search, notifications, reports | Done. Global search, notification feed and payload-dependent report authorisation covered. |
| 13 | Testing | In progress. 39 tests green. More coverage still to add. |
| 14 | Security + licence audit | Not started. |
| 15 | UI/UX audit | Not started. |
| 16 | Performance/stress | Not started. |
| 17 | Clean-machine installation | Not started. |
| 18 | Release packaging | Not started. |
| 19 | GitHub Actions release | Not started. |
| 20 | Final verification | Not started. |

## Current task

Writing integration tests that drive the real application through its own API,
and fixing every defect they surface. The test suites are:

- `tests/integration/smoke.test.ts` — setup, activation, authentication,
  account lockout, patient creation and search.
- `tests/integration/workflows.test.ts` — money end to end, Bengali storage,
  search, print model and CSV export, dental chart history, RBAC denial at the
  service boundary, backup/restore/guarded delete, audit trail.
- `tests/integration/operations.test.ts` — appointments and conflicts, waiting
  room, inventory batches, accounting, attachment containment, invoice and
  receipt print identity, password policy and forced change, session
  revocation, global search, notifications, database integrity.

## Remaining tasks

1. Finish runtime verification of the renderer pages (Patients, Appointments,
   Queue, Prescriptions, InvoiceForm/InvoiceDetail, Payments, Inventory,
   Accounting, Treatments, Settings, Staff, Backup, Reports, About) — these
   typecheck but have not been driven in a live interface.
2. Add tests for the remaining untested areas: treatment catalogue CRUD,
   referrals, discounts and tax on invoices, refunds, purchase orders,
   suppliers, role editing, dentist signature, print history, system wipe
   guard, data-folder diagnostics.
3. Bengali print/PDF verification at every paper size (needs a Windows or CI
   run).
4. `docs/README.md` and the eleven remaining mandatory documents.
5. Security review and `docs/SECURITY.md`.
6. `docs/DEPENDENCY-LICENSE-AUDIT.md` — every dependency reviewed for purpose,
   version, licence, runtime, maintenance and security.
7. UI/UX audit against 1280×720–1920×1080 and 125–200% DPI, including
   scrollable areas and clipping.
8. Performance and stress test with real numbers in `docs/PERFORMANCE.md`.
9. GitHub Actions CI and release workflows.
10. Build `Dentiva-Pro-Setup.exe` through CI, then test it on a clean machine
    and record the result in `docs/INSTALLATION-TEST.md`.
11. `docs/TEST-REPORT.md` and `docs/RELEASE-CHECKLIST.md`.

## Known issues and limitations

- **No Electron binary can be downloaded in this sandbox.** Electron release
  assets and every tested mirror are blocked. The renderer, the print
  pipeline and the installer therefore cannot be exercised here. They must be
  verified on Windows, and the primary route is the GitHub Actions workflow.
- **No Windows toolchain, no Wine, no Xvfb and no system Bengali font.** The
  application bundles Noto Sans Bengali specifically so it does not depend on
  the host having one.
- **Bengali is verified in the database, search, print models and CSV export,
  not yet in rendered print output.** On-screen correctness does not imply
  correct shaping on paper.
- The invoice print model deliberately carries no clinician details. If the
  clinic wants a dentist on an invoice it must turn on
  `print.showDentistOnInvoice` deliberately.
- There is no password recovery. This is a deliberate decision for an offline
  single-machine product and is stated plainly in the interface.
- The activation verifier is a locally derived cryptographic check. Any
  purely offline verifier can ultimately be reverse-engineered from a binary
  someone owns. This is documented rather than overclaimed.

## Test status

```
$ npx tsc -p tsconfig.json --noEmit
(no output — clean)

$ npx vitest run
Test Files  3 passed (3)
     Tests  39 passed (39)

$ npx vite build
✓ built in ~2.7s
index.js ~559.72 kB │ css ~80.77 kB
```

## Build status

Renderer build succeeds. The Electron main/preload compile and bundle step has
**not** been run, because packaging requires an Electron binary that this
sandbox cannot download.

## Release status

Not released. No installer exists. No workflow has been run. No clean machine
has been tested.

## Quality gates

| Gate | Required for release | State |
| --- | --- | --- |
| All automated tests pass | Yes | PASS (39/39) |
| TypeScript clean | Yes | PASS |
| Renderer builds | Yes | PASS |
| Security audit complete | Yes | NOT DONE |
| Dependency/licence audit complete | Yes | NOT DONE |
| UI/UX audit complete | Yes | NOT DONE |
| Performance/stress numbers recorded | Yes | NOT DONE |
| Bengali print/PDF verified on paper | Yes | NOT DONE |
| Windows installer built | Yes | NOT DONE |
| Clean-machine install tested | Yes | NOT DONE |
| All mandatory documents present | Yes | NOT DONE |
| CI and release workflows green | Yes | NOT DONE |

**Any gate that is not PASS means the product is not ready to release. Several
are outstanding, so Dentiva Pro is not ready to release.**
