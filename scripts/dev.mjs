/**
 * Development launcher.
 *
 * Starts the service host and the renderer dev server together, and shuts both
 * down on the first exit. Written against node:child_process so the project
 * needs no process-runner dependency just to preview the app.
 *
 *   npm run dev
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let shuttingDown = false;

function run(name, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${name}] `;
  const forward = (stream, target) => {
    let pending = '';
    stream.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) target.write(prefix + line + '\n');
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stdout.write(`${prefix}exited (${signal ?? code}) — stopping the other process.\n`);
    shutdown(typeof code === 'number' ? code : 0);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

run('host', [resolve(root, 'out/scripts/dev-host.js')]);
run('ui', [resolve(root, 'node_modules/vite/bin/vite.js')]);
