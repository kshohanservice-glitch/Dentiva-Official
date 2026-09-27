/**
 * Development host.
 *
 * The packaged Windows app reaches the service core over Electron IPC. The
 * browser preview reaches the same core over three local HTTP endpoints, which
 * are the only routes this process exposes. There is no other server, no
 * network listener beyond the loopback interface, and no remote anything: the
 * preview behaves like the shipped product because it is the same container
 * with a different pipe.
 *
 *   npm run dev            vite on 5183, this host on 5184
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DentivaApp } from '../src/core';

const PORT = Number(process.env.DENTIVA_API_PORT ?? 5184);
const HOST = '127.0.0.1';
const MAX_BODY = 24 * 1024 * 1024;

const dentiva = new DentivaApp({ machine: 'Dentiva Pro (development preview)' });

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(raw));
      } catch {
        reject(new Error('Request body was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) {
      send(res, 404, { error: 'Not found. The development host serves /api/* only.' });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = ((await readBody(req)) ?? {}) as Record<string, unknown>;
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : 'Bad request.' });
      return;
    }

    try {
      switch (url.pathname) {
        case '/api/host-info':
          send(res, 200, {
            platform: process.platform,
            arch: process.arch,
            version: process.env.npm_package_version ?? '0.0.0',
            node: process.versions.node,
            chrome: 'development preview',
            electron: 'none',
            userData: dentiva.container.paths.root,
            isPackaged: false,
          });
          return;
        case '/api/printers':
          // The preview runs headless, so there is no printer list to hand back.
          // The print window still works; it just cannot pre-select a device.
          send(res, 200, []);
          return;
        case '/api/invoke': {
          const result = await dentiva.invoke(String(body.op ?? ''), body.input, {
            sessionToken: typeof body.token === 'string' ? body.token : null,
            machine: 'Dentiva Pro (development preview)',
          });
          send(res, 200, result);
          return;
        }
        default:
          send(res, 404, { error: `Unknown endpoint ${url.pathname}.` });
      }
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : 'Host failure.' });
    }
  })();
});

server.listen(PORT, HOST, () => {
  const paths = dentiva.container.paths;
  console.log(`Dentiva development host listening on http://${HOST}:${PORT}`);
  console.log(`  data:     ${paths.root}`);
  console.log(`  backups:  ${paths.backupDefaultDir}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      dentiva.close();
      process.exit(0);
    });
  });
}
