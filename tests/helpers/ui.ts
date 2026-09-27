import type { DentivaApp } from '../../src/core';
import type { PrintRequestPayload } from '../../src/renderer/bridge';

const noopUnsubscribe = () => undefined;

type InvokeResult = ReturnType<DentivaApp['invoke']> extends Promise<infer T> ? T : never;

/**
 * Installs a host bridge backed by a real, in-process core. The interface and
 * the service then share exactly one code path, which is the only way a UI test
 * proves the two actually fit together.
 *
 * The returned record collects every print request and saved export, so a test
 * can assert on what the page would actually have sent to the printer or disk.
 */
export function installHost(app: DentivaApp, machine = 'test-machine') {
  const prints: PrintRequestPayload[] = [];
  const saved: string[] = [];

  const host = {
    runtime: 'main-window' as const,
    info: async () => ({ platform: process.platform, arch: process.arch, versions: { electron: 'test' } }),
    invoke: async (op: string, input: unknown, sessionToken: string | null): Promise<InvokeResult> => {
      const result = await app.invoke(op, input, { sessionToken, machine });
      if (result.ok) return { ok: true, data: result.data } as InvokeResult;
      const error = result.error as { code: string; message: string; detail?: string; issues?: { field: string; message: string }[] };
      return {
        ok: false,
        error: { code: error.code, message: error.message, detail: error.detail ?? '', issues: error.issues ?? [] },
      } as InvokeResult;
    },
    printing: {
      listSystemPrinters: async () => ['Microsoft Print to PDF', 'HP LaserJet'],
      preview: async (request: PrintRequestPayload) => {
        prints.push(request);
        return { ok: true, id: prints.length, path: null, message: 'Preview prepared.' };
      },
      print: async (request: PrintRequestPayload) => {
        prints.push(request);
        return { ok: true, id: prints.length, message: 'Sent to Microsoft Print to PDF.' };
      },
      pdf: async (request: PrintRequestPayload) => {
        prints.push(request);
        return { ok: true, id: prints.length, path: `/tmp/${request.suggestedName ?? 'document.pdf'}` };
      },
      signalReady: async () => ({ ok: true }),
      onData: () => noopUnsubscribe,
      deliver: async () => ({ ok: true }),
      action: async () => ({ ok: true }),
    },
    files: {
      saveAttachment: async () => ({ saved: true, path: '/tmp/attachment' }),
      openAttachment: async () => ({ opened: true }),
      saveText: async (name: string) => {
        saved.push(name);
        return { saved: true, path: `/tmp/${name}` };
      },
      saveData: async (name: string) => {
        saved.push(name);
        return { saved: true, path: `/tmp/${name}` };
      },
      chooseFolder: async () => ({ path: null }),
      openPath: async () => ({ opened: true }),
      openExternal: async () => ({ opened: true }),
    },
    appearance: { setTheme: async () => ({ ok: true }) },
    window: async () => ({ ok: true }),
  };

  (window as unknown as { dentivaHost: unknown }).dentivaHost = host;
  return { prints, saved };
}

export function uninstallHost(): void {
  delete (window as unknown as { dentivaHost?: unknown }).dentivaHost;
}
