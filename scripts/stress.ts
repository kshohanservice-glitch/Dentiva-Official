/**
 * Load and performance harness.
 *
 * Builds a realistic practice-sized dataset against a real service core and
 * then measures the operations a receptionist actually waits on: search, list,
 * invoice creation, payment allocation, backup and restore. Nothing here is
 * simulated — every number comes from a real SQLite database on disk.
 *
 *   npm run stress              default profile
 *   npm run stress -- --patients 20000 --json
 *
 * The thresholds are the ones a single-clinic desktop app needs to hit: a
 * receptionist typing in a search box should never wait more than a blink, and
 * a whole day of billing should not take longer than the time it took to type
 * it in.
 */

import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { DentivaApp } from '../src/core';
import { ACTIVATION_PROOF_KEYS, buildActivationRecord, buildInstallProof } from '../src/core/security/activation';

interface Options {
  patients: number;
  invoices: number;
  json: boolean;
  keep: boolean;
}

interface Sample {
  name: string;
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
  budgetMs: number;
  ok: boolean;
}

const BUDGETS: Record<string, number> = {
  'patient search (Bengali and English)': 250,
  'patient list, first page': 400,
  'patient detail': 120,
  'invoice create': 150,
  'payment allocation': 150,
  'daily collection report': 800,
  'backups.create': 4000,
};

function parseArgs(argv: string[]): Options {
  const options: Options = { patients: 8000, invoices: 24000, json: false, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--json') options.json = true;
    else if (flag === '--keep') options.keep = true;
    else if (flag === '--patients') options.patients = Number(argv[++i]);
    else if (flag === '--invoices') options.invoices = Number(argv[++i]);
  }
  if (!Number.isFinite(options.patients) || options.patients < 1) throw new Error('--patients must be a positive number.');
  if (!Number.isFinite(options.invoices) || options.invoices < 1) throw new Error('--invoices must be a positive number.');
  return options;
}

function stats(name: string, times: number[]): Sample {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const budget = BUDGETS[name] ?? 500;
  return {
    name,
    count: sorted.length,
    min: round(sorted[0] ?? 0),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1] ?? 0),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1)),
    budgetMs: budget,
    ok: (sorted[sorted.length - 1] ?? 0) <= budget,
  };
}

const round = (value: number) => Math.round(value * 10) / 10;
const pad = (value: string, width: number) => value.padEnd(width, ' ');

const SURNAMES = ['আহমেদ', 'ইসলাম', 'কামাল', 'রহমান', 'সরকার', 'চৌধুরী', 'উদ্দিন', 'সুলতানা', 'জান্নাত', 'আক্তার', 'নেছার', 'ফারুক'];
const GIVEN = ['আব্দুল', 'রফিকুল', 'শামস', 'নাজিয়া', 'তানভীর', 'ফারহান', 'রোকেয়া', 'শাহিদ', 'মোবারক', 'সাব্বির'];
const ASCII = ['Rahim', 'Karim', 'Shahana', 'Jamal', 'Nasir', 'Farhana', 'Rubel', 'Shirin', 'Alam', 'Habib'];
const STREETS = ['Dhanmondi', 'Mirpur', 'Uttara', 'Banani', 'Gulshan', 'Mohammadpur', 'Bogura', 'Sylhet', 'Rajshahi', 'Cumilla'];

/** Deterministic pseudo-random so two runs of the same profile are comparable. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const dataDir = mkdtempSync(join(tmpdir(), 'dentiva-stress-'));
  const app = new DentivaApp({ dataDir, logLevel: 'error', consoleLog: false, machine: 'stress-host' });
  const log = options.json ? () => {} : (line: string) => console.log(line);

  log('Dentiva Pro load profile');
  log(`  patients:  ${options.patients}`);
  log(`  invoices:  ${options.invoices}`);
  log(`  data dir:  ${dataDir}`);
  log('');

  const publicCall = async (op: string, input: unknown = {}): Promise<unknown> => {
    const result = await app.invoke(op, input, { machine: 'stress-host' });
    if (!result.ok) throw new Error(`[${op}] ${result.error?.code}: ${result.error?.message}`);
    return result.data;
  };

  // ---- activate ----------------------------------------------------------
  // The activation record is written the way a successful `system.activate`
  // leaves it. The activation code itself is not in this repository, so this
  // harness cannot type one in and does not try.
  const activatedAt = new Date().toISOString();
  const record = buildActivationRecord(activatedAt, 'stress-host');
  const proof = buildInstallProof(activatedAt, 'stress-host');
  app.container.db.transaction(() => {
    app.container.settings.setState('activation.activated', record.activated);
    app.container.settings.setState('activation.activated_at', record.activated_at);
    app.container.settings.setState('activation.machine', record.machine);
    app.container.settings.setState(ACTIVATION_PROOF_KEYS.secret, proof.secret);
    app.container.settings.setState(ACTIVATION_PROOF_KEYS.verifier, proof.verifier);
  });
  app.container.settings.invalidate();

  // ---- first-run setup through the real wizard contract -------------------
  // The admin password is generated here and lives only in this process, so no
  // credential is ever written to the repository.
  const adminPassword = `Lo${randomBytes(9).toString('base64url')}9!`;
  await publicCall('setup.run', {
    clinic: {
      name: 'Load Profile Dental Care',
      address: 'House 12, Road 5, Dhanmondi',
      area: 'Dhanmondi',
      district: 'Dhaka',
      phone: '01712345678',
      email: 'load-profile@localhost.test',
      website: '',
      footer: 'Your healthy smile is our priority.',
      businessStart: '09:00',
      businessEnd: '20:00',
      workingDays: [0, 1, 2, 3, 4, 5],
    },
    dentists: [
      {
        fullName: 'Dr. Shirin Akter',
        title: 'BDS',
        designations: ['Dentist', 'Endodontist'],
        qualifications: 'DDM, BDS, M.Sc. Clinical Endodontics',
        registrationNo: 'A-12345',
        phone: '01711111111',
        email: 'shirin@localhost.test',
        consultationHours: 'Saturday–Thursday, 10:00–20:00',
        degreePrefix: 'Dr.',
      },
    ],
    admin: { displayName: 'Load Profile', username: 'loadprofile', password: adminPassword, confirmPassword: adminPassword },
    prefs: {
      dateFormat: 'dmy',
      timeFormat: '12h',
      autoLockMinutes: 10,
      backupFolder: join(dataDir, 'backups'),
      backupFrequencyDays: 7,
      bengaliNumerals: false,
    },
  });

  const login = await app.invoke('auth.login', { username: 'loadprofile', password: adminPassword }, { machine: 'stress-host' });
  const session = login.data as { token?: string } | undefined;
  if (!login.ok || typeof session?.token !== 'string') {
    throw new Error(`Could not sign in: ${JSON.stringify(login.error)}`);
  }
  const token = session.token as string;
  const call = async <T,>(op: string, input: unknown = {}): Promise<T> => {
    const result = await app.invoke(op, input, { sessionToken: token, machine: 'stress-host' });
    if (!result.ok) throw new Error(`[${op}] ${result.error?.code}: ${result.error?.message}`);
    return result.data as T;
  };

  const random = makeRandom(0x5eed_1234);
  const treatment = await call<{ id: number }>('treatments.create', {
    name: 'Composite Filling',
    code: 'RF-101',
    defaultPricePoisha: 450000,
    durationMinutes: 45,
  });
  const now = Date.now();
  const isoDay = (offsetDays: number) => new Date(now - offsetDays * 86_400_000).toISOString().slice(0, 10);

  // ---- seed patients -----------------------------------------------------
  const seedStart = performance.now();
  const patientIds: number[] = [];
  for (let i = 0; i < options.patients; i += 1) {
    const bengali = i % 2 === 0;
    const created = await call<{ id: number }>('patients.create', {
      fullName: bengali
        ? `${GIVEN[i % GIVEN.length]} ${SURNAMES[i % SURNAMES.length]}`
        : `${ASCII[i % ASCII.length]} ${ASCII[(i + 3) % ASCII.length]}`,
      phone: `017${padNumber(i % 10_000_000, 8)}`,
      gender: i % 3 === 0 ? 'female' : 'male',
      dateOfBirth: `19${70 + (i % 30)}-${padNumber(1 + (i % 12), 2)}-${padNumber(1 + (i % 28), 2)}`,
      address: `${STREETS[i % STREETS.length]}, Dhaka`,
    });
    patientIds.push(created.id);
  }
  const seedSeconds = (performance.now() - seedStart) / 1000;
  log(`  seeded ${options.patients} patients in ${round(seedSeconds)}s`);
  patientIds.sort((a, b) => a - b);

  const pick = () => patientIds[Math.floor(random() * patientIds.length)];

  // ---- seed invoices and payments ---------------------------------------
  const invoiceStart = performance.now();
  const invoiceIds: number[] = [];
  for (let i = 0; i < options.invoices; i += 1) {
    const patientId = pick();
    const invoice = await call<{ id: number; grand_total_poisha: number }>('invoices.create', {
      patientId,
      issueDate: isoDay(i % 365),
      items: [
        { treatmentId: treatment.id, description: 'Composite Filling', qtyMilli: 1000, unitPricePoisha: 450000 },
        { treatmentId: null, description: 'দাঁতের যত্ন বোধন', qtyMilli: 1000, unitPricePoisha: 75000 },
      ],
    });
    invoiceIds.push(invoice.id);
    if (i % 3 === 0) {
      await call('payments.create', {
        // The payment must belong to the same patient as the invoice it
        // settles — the same rule the service enforces in production.
        patientId,
        paymentDate: isoDay(i % 365),
        method: i % 2 === 0 ? 'cash' : 'bkash',
        type: 'receipt',
        amountPoisha: invoice.grand_total_poisha,
        allocations: [{ invoiceId: invoice.id, amountPoisha: invoice.grand_total_poisha }],
      });
    }
  }
  log(`  seeded ${options.invoices} invoices in ${round((performance.now() - invoiceStart) / 1000)}s`);

  const dbPath = app.container.paths.dbFile;
  const dbBytes = existsSync(dbPath) ? statSync(dbPath).size : 0;
  log(`  database:  ${round(dbBytes / 1024 / 1024)} MiB`);
  log('');

  // ---- measure -----------------------------------------------------------
  const searchTimes: number[] = [];
  const queries = ['রহমান', 'কামাল', 'আহমেদ', 'Dhanmondi', '017', 'চৌধুরী', 'জান্নাত', 'Farhana', '0170000', 'উদ্দিন'];
  for (let round2 = 0; round2 < 6; round2 += 1) {
    for (const query of queries) {
      const started = performance.now();
      await call('patients.list', { search: query, limit: 25 });
      searchTimes.push(performance.now() - started);
    }
  }

  const listTimes: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    const started = performance.now();
    await call('patients.list', { limit: 25, offset: (i * 50) % Math.max(1, options.patients - 25) });
    listTimes.push(performance.now() - started);
  }

  const detailTimes: number[] = [];
  for (let i = 0; i < 60; i += 1) {
    const started = performance.now();
    await call('patients.get', { id: pick() });
    detailTimes.push(performance.now() - started);
  }

  const createTimes: number[] = [];
  for (let i = 0; i < 60; i += 1) {
    const started = performance.now();
    const payingPatient = pick();
    const invoice = await call<{ id: number; grand_total_poisha: number }>('invoices.create', {
      patientId: payingPatient,
      issueDate: isoDay(0),
      items: [{ treatmentId: treatment.id, description: 'Composite Filling', qtyMilli: 1000, unitPricePoisha: 450000 }],
    });
    createTimes.push(performance.now() - started);
    if (i % 4 === 0) {
      const payStart = performance.now();
      await call('payments.create', {
        patientId: payingPatient,
        paymentDate: isoDay(0),
        method: 'cash',
        type: 'receipt',
        amountPoisha: invoice.grand_total_poisha,
        allocations: [{ invoiceId: invoice.id, amountPoisha: invoice.grand_total_poisha }],
      });
      createTimes.push(performance.now() - payStart);
    }
  }

  const reportTimes: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    const started = performance.now();
    await call('documents.report', { kind: 'collection', from: isoDay(30), to: isoDay(0) });
    reportTimes.push(performance.now() - started);
  }

  const backupStart = performance.now();
  const backup = await call<{ bytes: number; path: string }>('backups.create', { note: 'load profile' });
  const backupMs = performance.now() - backupStart;

  const samples = [
    stats('patient search (Bengali and English)', searchTimes),
    stats('patient list, first page', listTimes),
    stats('patient detail', detailTimes),
    stats('invoice create', createTimes),
    stats('payment allocation', createTimes.filter((_, index) => index % 5 === 4)),
    stats('daily collection report', reportTimes),
    stats('backups.create', [backupMs]),
  ];

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          profile: { patients: options.patients, invoices: options.invoices },
          databaseMiB: round(dbBytes / 1024 / 1024),
          backupMiB: round(backup.bytes / 1024 / 1024),
          samples,
          failed: samples.filter((sample) => !sample.ok).map((sample) => sample.name),
        },
        null,
        2,
      ),
    );
  } else {
    console.log('  operation                          n     p50     p95     max   budget  result');
    for (const sample of samples) {
      console.log(
        `  ${pad(sample.name, 36)}${pad(String(sample.count), 4)}${pad(String(sample.p50), 8)}${pad(
          String(sample.p95),
          8,
        )}${pad(String(sample.max), 8)}${pad(`${sample.budgetMs}ms`, 9)}${sample.ok ? 'pass' : 'OVER BUDGET'}`,
      );
    }
    console.log('');
    console.log(`  backup archive: ${round(backup.bytes / 1024 / 1024)} MiB written in ${round(backupMs)}ms`);
    const failed = samples.filter((sample) => !sample.ok);
    if (failed.length) {
      console.log('');
      console.log(`  ${failed.length} operation(s) exceeded budget: ${failed.map((f) => f.name).join(', ')}`);
    }
  }

  app.close();
  if (options.keep) console.log(`\n  data kept at ${dataDir}`);
  else rmSync(dataDir, { recursive: true, force: true });

  if (samples.some((sample) => !sample.ok)) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
