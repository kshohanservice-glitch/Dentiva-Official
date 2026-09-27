# Dentiva Pro — Security

Dentiva Pro holds patient records and money. This document states exactly what the application does to
protect them, what it does not do, and where the limits are.

Everything described here is covered by `tests/integration/security.test.ts` and
`tests/ui/print.test.tsx`. Anything claimed here that is not tested is marked as such.

---

## 1. Threat model in one paragraph

The realistic threats to a single-clinic desktop application are: someone who walks up to an unlocked
machine, someone who steals the disk, someone who obtains a backup file, and someone who talks a
staff member into revealing a password. Physical theft of the machine is an operating-system problem
(BitLocker, a Windows account password), not something an application can solve. Everything else is
in scope here.

---

## 2. Passwords

### Storage

Passwords are hashed with **scrypt** (`N=32768, r=8, p=1`, 64-byte output, 16-byte random salt) —
a memory-hard key derivation function from RFC 7914, recommended by NIST SP 800-132. Argon2 and
bcrypt were rejected because both need a native module, and a native module turns a single-file
Windows installer into an installer that has to match a compiler.

Stored form:

```
scrypt$32768$8$1$<salt-base64>$<key-base64>
```

There is no plaintext password anywhere: not in the source, not in a fixture, not in a comment, not
in a log, not in a backup manifest, not in the test suite. `grep -ri "password" src/ tests/ scripts/`
finds only the hashing code, the policy code and the fields that hold hashes.

### Verification

`verifyPassword` treats the stored string as untrusted input, because it comes out of the database and
a database can be edited:

- The cost parameters are bounds-checked before they are used. A hand-edited hash asking for `N=2`
  would otherwise turn verification into a cheap oracle, and a hash asking for a huge `N` would hang
  the application.
- The salt and key lengths are checked.
- The comparison is `timingSafeEqual`, so a wrong password cannot be found one byte at a time.
- Anything that fails any check returns `false` rather than throwing, so a corrupt hash denies access
  instead of crashing the sign-in screen.

### Re-hashing

On a successful sign-in, `needsRehash` compares the stored parameters with the current defaults. A hash
weaker than the default is upgraded to the current parameters immediately and transparently. A hash
*stronger* than the default is left alone, so raising the default later can never weaken an existing
account.

### Policy

`checkPasswordPolicy` enforces, by default: at least 8 characters, a lowercase letter, and a digit; at
most 256 characters. It additionally rejects a password equal to the username and any password in the
user's recent history. The thresholds are configurable in Settings → Security for a clinic that wants
stricter rules.

### First-run and forced change

- The administrator password is set during first-run setup. There is no default account and no
  documented default password, in this repository or in the documentation.
- A user created by an administrator, or one whose password is reset, is flagged
  `must_change_password` and is taken straight to the change screen after signing in. The application
  cannot be used until it is changed.

---

## 3. Sessions

- A session token is 32 bytes from `crypto.randomBytes`, base64url-encoded, and stored server-side in
  the `sessions` table. It is opaque; it carries no user data and is not a signed token, so there is
  nothing in it to forge.
- Every session has an **absolute** lifetime of 12 hours. It is not extended by activity, so a session
  cannot be held open indefinitely.
- The application also locks on idle (configurable, default 10 minutes) as a front-end measure.
- Signing out calls `revokeSession(token)`, which deletes the row. A copied token therefore stops
  working the moment the user signs out. This is covered by a test.
- An expired or revoked token is rejected by the registry before the operation's handler runs, and the
  renderer is returned to the sign-in screen.
- Changing a password revokes every other session for that user.

---

## 4. Brute-force resistance

- Five failed sign-in attempts lock the account for one minute. The counter resets on a successful
  sign-in and on lock.
- The lock message does not say whether the username exists — an unknown username and a wrong password
  return the identical message, so the form cannot be used to enumerate accounts.
- The response to a wrong password is deliberately uniform in wording, not in timing, and the
  verification cost is constant whether or not the user exists.
- Every attempt, successful or not, is written to `login_history` and visible in Settings → Security.

---

## 5. Roles and permissions

- **46 permissions** in 12 groups, declared as data in `src/shared/permissions.ts` and seeded into the
  `permissions` table on first run.
- Roles hold permissions through `role_permissions`; users hold roles through `user_roles`. A user may
  hold more than one role, and their permissions are the union.
- Four system roles are seeded: Administrator, Dentist, Receptionist and Accountant. The Administrator
  role cannot be deleted, and a clinic must always have at least one active administrator.
- **Every one of the 189 operations declares the permissions it needs** (or a `guard` that resolves
  them from the payload). The registry enforces this before the handler runs, so a handler cannot
  forget to check.
- The renderer hides navigation the current role cannot use. That is a convenience only. The core is
  the boundary, and a test asserts that calling a forbidden operation directly is refused even with a
  valid session.
- `tests/unit/contract.test.ts` walks the whole operation catalogue and fails if any destructive
  operation lacks a declared access rule.

### The interface boundary

The renderer runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. Its
entire capability surface is the fixed channel list in `src/main/preload.cjs`. It has no filesystem
access, no child-process access and no network access. Every file operation is a request to the main
process, which validates it.

---

## 6. Financial rules at the service boundary

These are enforced in `src/core/api/financial.ts`, not in the form. A user who bypasses the interface
gets the same refusal.

- A payment can only be allocated to invoices belonging to the same patient.
- Allocations cannot exceed the payment amount, and a payment's allocations must total exactly its
  amount.
- Allocations cannot exceed the invoice's outstanding balance, so an invoice cannot be over-settled.
- A paid invoice cannot be cancelled. It can only be refunded, and the refund is a separate recorded
  transaction.
- Discounts and tax are bounded, and totals are computed in integer poisha, rounded once.
- Invoice and payment numbers are allocated from a counter inside a transaction, so two users cannot
  be issued the same number.

---

## 7. Attachments

X-rays and scans are the one place where the application writes to disk based on user input.

- The file is **sniffed** — its real type is detected from its own bytes, and the declared MIME type is
  ignored. A file that is not a recognised image type is refused.
- The stored name is generated by the application, never taken from the upload. The original name is
  kept in the database for display only.
- Reads resolve through `resolveWithin`, which rejects any path that escapes the attachment vault —
  including through `..` segments, absolute paths and symbolic links.
- The row is read *after* the owning entity has been authorised, so knowing an attachment id does not
  let anyone download another patient's X-ray.
- Deleting an attachment marks the row and removes the file, and the removal is audited.
- Restoring a backup only reads attachment paths named in that backup's manifest.

---

## 8. Activation

Activation is a **one-time, local, permanent** decision. There is no licence server, no phone-home and
no periodic check.

- The code is canonicalised (whitespace, dashes and case are normalised) and then compared, in constant
  time, against a **verifier**: an HMAC-SHA-256 over the canonical code using a key derived from
  compiled-in material and the machine identity.
- **The activation code is not in this repository.** Not in the source, not in a resource, not in a
  fixture, not in a test, not in a log. The verifier is a one-way derivation, so the repository does
  not contain anything that can be typed into the activation box. Tests activate by writing the record
  a successful activation would write, and cover the code-entry path separately by asserting that an
  invalid code is rejected.
- On activation a random per-install secret is generated and stored alongside an HMAC of the machine
  identity. This exists so the activation record cannot be forged by writing a single `1` into the
  database.
- On every start, the record is re-verified. A record that is present but does not verify is reported
  as **tampered**: the application says so plainly, records it in the audit log, and shows a danger
  callout on the activation screen. It does not silently re-activate.
- The activation gate is global. A deactivated install refuses every operation except the small exempt
  set (`system.status`, `system.activate`, `auth.login`, the setup wizard), enforced by the registry
  rather than by each handler.

### What activation is not

An activation code check running on the user's own machine is a licensing mechanism, not a security
boundary against someone who has administrative access to that machine. The verifier resists guessing
the code; it does not resist an attacker who can patch the binary or edit the database, and this
document does not claim otherwise.

---

## 9. Audit trail

- Every operation that changes money, clinical records, access control, settings or files writes an
  audit row: who, what, which entity, when, the result, and a human-readable summary.
- Failed sign-ins, failed permission checks and activation tampering are recorded too.
- The log is **append-only**. Nothing in the application updates or deletes a row in it.
- Sensitive values are excluded by construction: no password, no password hash, no activation code, no
  session token and no attachment content is ever written to an audit row, a log line or a metadata
  field. A test asserts the exclusion rather than trusting it.

---

## 10. Logging

- Logs go to `%APPDATA%\Dentiva Pro\logs\`, with rotation and a size cap.
- Passwords, activation codes, session tokens and patient record contents are never logged. The logger
  has a redaction step and a test asserts it.
- A stack trace is never shown to a user. An error shows its message; the trace goes to the log file
  and to the Diagnostics panel, which is a separate destination.

---

## 11. Data at rest

- The database is **not encrypted by this application**. It is an ordinary SQLite file protected by
  whatever the operating system provides — a Windows account password, BitLocker, or a locked cabinet.
  This is stated plainly rather than implied.
- Backups are not encrypted by this application either. A backup folder inherits the protection of the
  disk it is on.
- The recommendation in [ADMIN-GUIDE.md](ADMIN-GUIDE.md) is to turn on BitLocker for the system drive
  and to keep backups on a separate, access-controlled disk. Both are outside the application's
  control, which is exactly why they are documented rather than claimed.

---

## 12. What has been verified, and how

| Claim | Evidence |
|---|---|
| scrypt with a random salt; no plaintext anywhere | `security.test.ts`, `grep` over the tree |
| Weakened or hand-edited cost parameters are rejected and rehashed | `security.test.ts` |
| Password policy, username and history rejection | `security.test.ts` |
| Sign-out revokes the presented token | `security.test.ts` |
| Revoked and expired sessions are refused | `security.test.ts` |
| Five attempts locks the account; unknown user is indistinguishable | `security.test.ts` |
| Permission boundaries hold for a direct call, not just a hidden link | `security.test.ts`, `contract.test.ts` |
| Sensitive data is excluded from audit rows and logs | `security.test.ts` |
| Activation verification and tamper reporting | `security.test.ts` |
| No activation material in the repository | absence, plus a review of `activation.ts` |
| Attachments cannot escape the vault | `tests/unit/` attachment suite |
| Money is integral at every boundary | `contract.test.ts`, 28 operations |
| Bengali is not corrupted on the way to paper | `tests/ui/print.test.tsx` |

## 13. Known limitations

Stated here rather than discovered later:

- **No database encryption.** See §11.
- **No multi-factor authentication.** The lockout and the password policy are the controls.
- **Activation is not tamper-proof** against an attacker with administrative access to the machine. See §8.
- **No remote wipe.** A stolen machine is a disk problem, not an application problem.
- **Not yet penetration tested by a third party.** Everything above is the author's own testing. That
  is a real difference and should not be glossed over.
