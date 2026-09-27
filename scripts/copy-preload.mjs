/**
 * Copies the preload script next to the compiled main process.
 *
 * `preload.cjs` is CommonJS and is loaded by Electron directly, not compiled
 * by TypeScript, so the compiler leaves it behind. The main process resolves it
 * as a sibling of its own file, so it has to travel with it.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src', 'main', 'preload.cjs');
const TARGET_DIR = join(ROOT, 'out', 'src', 'main');
const TARGET = join(TARGET_DIR, 'preload.cjs');

mkdirSync(TARGET_DIR, { recursive: true });
copyFileSync(SOURCE, TARGET);
console.log(`  copied preload.cjs → out/src/main/preload.cjs`);
