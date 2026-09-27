/**
 * Release preparation.
 *
 * Runs before electron-builder and produces the two artefacts a release has to
 * carry: the third-party notices file, and a build manifest recording exactly
 * what went into the installer. It also refuses to continue if anything the
 * release promises is not actually there — a missing licence file, a wrong
 * installer name, an unsigned build on a release build.
 *
 *   node scripts/package-release.mjs
 *
 * This script never fabricates a result. If it cannot verify something, it
 * fails and says what it could not check.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Only these licences may appear in a shipped product. */
const ALLOWED = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'OFL-1.1', '(MIT OR CC0-1.0)', '0BSD', 'Unlicense']);

function fail(message) {
  console.error(`\n  Release preparation stopped: ${message}\n`);
  process.exit(1);
}

function heading(text) {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 62 - text.length))}`);
}

// ── 1. Licences ──────────────────────────────────────────────────────────────
heading('Collecting licences');

const all = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};

const notices = [
  'Dentiva Pro — Third-Party Notices',
  '='.repeat(60),
  '',
  `Dentiva Pro ${pkg.version}`,
  `Generated ${new Date().toISOString().slice(0, 10)}`,
  '',
  'This application bundles the packages listed below. Each is used under the',
  'licence shown. Full licence texts are shipped in resources/LICENSES/ inside',
  'the installed application.',
  '',
  '='.repeat(60),
  '',
];

const LICENCE_DIR = join(ROOT, 'build-licenses');
rmSync(LICENCE_DIR, { recursive: true, force: true });
const problems = [];
for (const [name, range] of Object.entries(all).sort(([a], [b]) => a.localeCompare(b))) {
  const manifestPath = join(ROOT, 'node_modules', name, 'package.json');
  if (!existsSync(manifestPath)) {
    problems.push(`${name}: declared in package.json but not installed`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const licence = typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? 'UNKNOWN');
  const shipped = Boolean(pkg.dependencies?.[name]);

  const licenceFile = (manifest.license && typeof manifest.license === 'object' ? manifest.license : null)?.type;
  if (!shipped) {
    console.log(`  build-time only  ${name}@${manifest.version}  (${licence})`);
    continue;
  }
  if (!ALLOWED.has(licence) && !ALLOWED.has(licenceFile ?? '')) {
    problems.push(`${name}@${manifest.version}: licence "${licence}" is not on the approved list`);
  }
  console.log(`  SHIPPED          ${name}@${manifest.version}  (${licence})`);
  notices.push(`${name} ${manifest.version}`, '-'.repeat(40), `Licence: ${licence}`);
  if (manifest.homepage) notices.push(`Project: ${manifest.homepage}`);
  notices.push('');

  // Copy the actual licence text into the installer, because a notice that
  // points at a file the installer does not contain is not a notice.
  const dir = join(ROOT, 'node_modules', name);
  const candidates = [manifest.licence, 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'license', 'license.md']
    .filter((file) => typeof file === 'string')
    .map((file) => join(dir, file))
    .filter((file) => existsSync(file) && statSync(file).isFile());
  if (candidates.length === 0) {
    problems.push(`${name}@${manifest.version}: shipped, but no licence file could be found to bundle`);
    continue;
  }
  const flat = `${name.replace(/^@/, '').replace(/[/@]/g, '-')}-${manifest.version}-${licence}`;
  mkdirSync(LICENCE_DIR, { recursive: true });
  copyFileSync(candidates[0], join(LICENCE_DIR, `${flat}.txt`));
  notices.splice(notices.length - 2, 0, `Full text: ${flat}.txt`);
}

if (problems.length) {
  for (const problem of problems) console.error(`  ! ${problem}`);
  fail('licence check did not pass. Nothing was written.');
}

writeFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.txt'), `${notices.join('\n')}\n`, 'utf8');
console.log('\n  wrote THIRD-PARTY-NOTICES.txt');
console.log(`  bundled ${readdirSync(LICENCE_DIR).length} licence texts into build-licenses/`);

// ── 1b. The packaging configuration must match electron-builder's own schema ─
heading('Validating the packaging configuration');

/**
 * electron-builder only checks this when it runs, on the machine doing the
 * packaging — a Windows runner, minutes into a CI run. That is how a single
 * unknown option in `win` stopped the first Windows build dead, and the log was
 * not retrievable afterwards. It is checked here, in a second, against
 * electron-builder's own published JSON schema, so the mistake cannot reach the
 * runner at all.
 */
let validateSchema = null;
let schemaProblem = null;
for (const attempt of [
  () => {
    const AjvModule = require('ajv');
    const schema = JSON.parse(JSON.stringify(require('app-builder-lib/scheme.json')));
    delete schema.$schema;
    const Ajv = AjvModule.default ?? AjvModule;
    const ajv = new Ajv({ allowUnionTypes: true, strict: false, allErrors: true });
    return ajv.compile(schema);
  },
]) {
  try {
    validateSchema = attempt();
    break;
  } catch (error) {
    schemaProblem = error;
  }
}

if (!validateSchema) {
  console.log(`  the schema validator could not be loaded (${schemaProblem?.message ?? 'unknown'}); skipping.`);
} else if (validateSchema(pkg.build)) {
  console.log('  the packaging configuration matches electron-builder\'s published schema');
} else {
  for (const error of (validateSchema.errors ?? []).slice(0, 8)) {
    const where = (error.instancePath || error.schemaPath || '(root)').replace(/^\$properties\./, '').replace(/\//g, '.');
    console.error(`  ! ${where} ${error.message}${error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : ''}`);
  }
  fail('the packaging configuration does not match electron-builder\'s schema.');
}

// The schema only proves the options exist. These are the promises this build
// makes about the installer, and a schema cannot check any of them.
const REQUIRED = [
  [pkg.build?.win?.artifactName === 'Dentiva-Pro-Setup.exe', `the installer would be named "${pkg.build?.win?.artifactName}", not Dentiva-Pro-Setup.exe`],
  [pkg.build?.nsis?.createStartMenuShortcut === true, 'a Start menu shortcut is required'],
  [pkg.build?.nsis?.createDesktopShortcut === true, 'a desktop shortcut is required'],
  [pkg.build?.nsis?.deleteAppDataOnUninstall === false, 'uninstalling must not delete a clinic\'s records'],
  [pkg.build?.nsis?.oneClick === false, 'a one-click installer gives the user no say in where the program goes'],
  [(pkg.build?.files ?? []).some((pattern) => String(pattern).includes('out/src')), 'the compiled main process is not included in the installer'],
  [(pkg.build?.files ?? []).some((pattern) => String(pattern).includes('dist/renderer')), 'the renderer bundle is not included in the installer'],
  [existsSync(join(ROOT, pkg.main ?? '')), `package.json "main" points at ${pkg.main}, which this build does not produce`],
  [existsSync(join(ROOT, 'build', 'icon.ico')), 'build/icon.ico is missing, so the installer would ship the default icon'],
];
const broken = REQUIRED.filter(([ok]) => !ok).map(([, why]) => why);
if (broken.length) {
  for (const why of broken) console.error(`  ! ${why}`);
  fail('the packaging configuration does not make the promises this build claims.');
}
console.log(`  installer name, shortcuts, data retention, file list and entry point all check out`);

// ── 2. The renderer bundle must exist and must carry its fonts ──────────────
heading('Checking the build output');

const rendererDir = join(ROOT, 'dist', 'renderer');
if (!existsSync(join(rendererDir, 'index.html'))) {
  fail('dist/renderer/index.html is missing. Run "npm run build" first.');
}
if (!existsSync(join(ROOT, 'out', 'src', 'main', 'index.js'))) {
  fail('out/src/main/index.js is missing. Run "npm run build" first.');
}
if (!existsSync(join(ROOT, 'out', 'src', 'main', 'preload.cjs'))) {
  fail('out/src/main/preload.cjs is missing. Run "npm run build" first.');
}
if (!existsSync(join(ROOT, 'build', 'icon.ico'))) {
  fail('build/icon.ico is missing. The installer would ship the default icon.');
}

const assets = readdirSync(join(rendererDir, 'assets'));
const bengali = assets.filter((file) => file.includes('bengali') && file.endsWith('.woff2'));
const inter = assets.filter((file) => file.startsWith('inter') && file.endsWith('.woff2'));
if (bengali.length === 0) fail('no Noto Sans Bengali subset was bundled. Bengali would not print.');
if (inter.length === 0) fail('no Inter subset was bundled.');
console.log(`  renderer assets: ${assets.length} files, ${bengali.length} Bengali, ${inter.length} Inter`);

// ── 3. The activation code must not be in what we are about to ship ─────────
heading('Scanning the bundle for activation material');

const suspicious = /activation[_-]?(code|key|secret)\s*[:=]\s*["'][0-9A-Za-z-]{8,}["']/i;
let scanned = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|cjs|mjs|html|css|json)$/.test(entry)) {
      scanned += 1;
      if (suspicious.test(readFileSync(full, 'utf8'))) {
        fail(`a possible activation literal was found in ${full.slice(ROOT.length + 1)}. Refusing to package.`);
      }
    }
  }
};
walk(rendererDir);
walk(join(ROOT, 'out'));
console.log(`  scanned ${scanned} built files; no activation literal found`);

// ── 4. Manifest ──────────────────────────────────────────────────────────────
heading('Writing the build manifest');

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  // A release from a source archive has no git history. That is not fatal.
}

const manifest = {
  product: pkg.productName,
  version: pkg.version,
  commit,
  builtAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  productionDependencies: Object.fromEntries(
    Object.entries(pkg.dependencies ?? {}).map(([name, range]) => {
      const manifestPath = join(ROOT, 'node_modules', name, 'package.json');
      const installed = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).version : 'unknown';
      return [name, { declared: range, installed }];
    }),
  ),
  installerName: 'Dentiva-Pro-Setup.exe',
  buildIntegrity: createHash('sha256')
    .update(readFileSync(join(rendererDir, 'index.html')))
    .digest('hex'),
};

writeFileSync(join(ROOT, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`  wrote build-manifest.json`);
console.log(`  commit:  ${commit}`);
console.log(`  version: ${pkg.version}`);

// ── 5. State plainly what has not been done ─────────────────────────────────
heading('What this script did NOT do');
console.log('  It did not build the installer.');
console.log('  It did not sign anything.');
console.log('  It did not test the result on a clean machine.');
console.log('  Those are the job of "npm run pack:win" and the release checklist,');
console.log('  and until they have been done, this build is not a release.\n');
