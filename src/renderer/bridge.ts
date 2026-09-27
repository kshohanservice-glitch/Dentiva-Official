/**
 * Transport bridge.
 *
 * In the packaged Windows app this talks to the Electron host over IPC. In the
 * development preview it talks to the same service container over a local HTTP
 * endpoint. Both call the identical operation surface, so nothing behaves
 * differently between the preview and the shipped product.
 */

export interface HostBridge {
  runtime: 'electron' | 'browser';
  info(): Promise<Record<string, unknown>>;
  invoke<T = unknown>(op: string, input: unknown, token: string | null): Promise<InvokeEnvelope<T>>;
  printing: PrintingBridge;
  files: FilesBridge;
  appearance: { setTheme(theme: 'light' | 'dark'): Promise<unknown> };
  window(action: 'minimise' | 'maximise' | 'close'): Promise<unknown>;
}

export interface InvokeEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; issues: { field: string; message: string }[]; detail?: string };
}

export interface PrintRequestPayload {
  docKind: string;
  entityId: number | null;
  entityLabel: string;
  paperId: string;
  widthMm: number;
  heightMm: number;
  orientation: 'portrait' | 'landscape';
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  fontScale: number;
  printerName: string;
  copies: number;
  showClinicalFooter: boolean;
  data: unknown;
  output: 'preview' | 'print' | 'pdf';
  suggestedName?: string;
}

export interface PrintingBridge {
  listSystemPrinters(): Promise<string[]>;
  preview(request: PrintRequestPayload): Promise<Record<string, unknown>>;
  print(request: PrintRequestPayload): Promise<Record<string, unknown>>;
  pdf(request: PrintRequestPayload): Promise<Record<string, unknown>>;
  signalReady(): Promise<unknown>;
  onData(handler: (payload: PrintRequestPayload) => void): () => void;
  deliver(id: number, request: PrintRequestPayload): Promise<unknown>;
  action(id: number, request: PrintRequestPayload): Promise<Record<string, unknown>>;
}

export interface FilesBridge {
  saveAttachment(id: number, token: string | null): Promise<{ saved: boolean; path?: string }>;
  openAttachment(id: number, token: string | null): Promise<{ opened: boolean }>;
  saveText(suggestedName: string, content: string): Promise<{ saved: boolean; path?: string }>;
  saveData(suggestedName: string, dataBase64: string): Promise<{ saved: boolean; path?: string }>;
  chooseFolder(title?: string, defaultPath?: string): Promise<{ path: string | null }>;
  openPath(path: string): Promise<{ opened: boolean }>;
  openExternal(url: string): Promise<{ opened: boolean }>;
}

interface AttachmentPayload {
  id: number;
  fileName: string;
  mimeType: string;
  description: string;
  dataBase64: string;
}

interface ElectronHost {
  runtime: 'main-window' | 'print-window';
  info(): Promise<Record<string, unknown>>;
  invoke(op: string, input: unknown, token: string | null): Promise<InvokeEnvelope>;
  printing: {
    listPrinters(): Promise<{ name: string; isDefault: boolean }[]>;
    listSystemPrinters(): Promise<string[]>;
    preview(request: unknown): Promise<Record<string, unknown>>;
    print(request: unknown): Promise<Record<string, unknown>>;
    pdf(request: unknown): Promise<Record<string, unknown>>;
    openWindow(request: unknown): Promise<{ id: number }>;
    signalReady(): Promise<unknown>;
    deliver(id: number, request: unknown): Promise<unknown>;
    action(id: number, request: unknown): Promise<Record<string, unknown>>;
    closed(): Promise<unknown>;
    onData(handler: (payload: PrintRequestPayload) => void): () => void;
  };
  files: FilesBridge;
  appearance: { setTheme(theme: 'light' | 'dark'): Promise<unknown> };
  window(action: 'minimise' | 'maximise' | 'close'): Promise<unknown>;
}

declare global {
  interface Window {
    dentivaHost?: ElectronHost;
  }
}

/** Browser fallback used by the development preview. */
function createBrowserBridge(): HostBridge {
  let pendingPrint: PrintRequestPayload | null = null;
  const printListeners = new Set<(payload: PrintRequestPayload) => void>();

  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `${path} failed with ${response.status}`);
    }
    return (await response.json()) as T;
  };

  return {
    runtime: 'browser',
    info: () => post('host-info', {}),
    invoke: <T,>(op: string, input: unknown, token: string | null) => post<InvokeEnvelope<T>>('invoke', { op, input, token }),
    printing: {
      listSystemPrinters: () => post<string[]>('printers', {}),
      preview: async (request) => {
        const win = window.open('/print.html', '_blank', 'width=1000,height=1200');
        if (!win) throw new Error('The browser blocked the print window. Allow pop-ups for this application.');
        win.postMessage({ type: 'dentiva:print-data', request }, window.location.origin);
        return { ok: true };
      },
      print: async (request) => {
        const win = window.open('/print.html', '_blank', 'width=1000,height=1200');
        if (!win) throw new Error('The browser blocked the print window. Allow pop-ups for this application.');
        win.postMessage({ type: 'dentiva:print-data', request, auto: 'print' }, window.location.origin);
        return { ok: true };
      },
      pdf: async (request) => {
        const win = window.open('/print.html', '_blank', 'width=1000,height=1200');
        if (!win) throw new Error('The browser blocked the print window. Allow pop-ups for this application.');
        win.postMessage({ type: 'dentiva:print-data', request, auto: 'pdf' }, window.location.origin);
        return {
          ok: true,
          path: '',
          browserPrint: true,
          message: 'Use “Save as PDF” as the destination in the print dialog to store the PDF.',
        };
      },
      signalReady: async () => {
        for (const listener of printListeners) listener(pendingPrint as PrintRequestPayload);
        return { ok: true };
      },
      onData: (handler) => {
        printListeners.add(handler);
        return () => printListeners.delete(handler);
      },
      deliver: async (id, request) => {
        pendingPrint = request;
        void id;
        return { ok: true };
      },
      action: async (id, request) => {
        pendingPrint = request;
        void id;
        return { ok: true };
      },
    },
    files: {
      saveAttachment: async (id, token) => {
        const result = await post<InvokeEnvelope<AttachmentPayload>>('invoke', {
          op: 'attachments.read',
          input: { id },
          token,
        });
        if (!result.ok) return { saved: false };
        const anchor = document.createElement('a');
        anchor.href = `data:${result.data?.mimeType ?? 'application/octet-stream'};base64,${result.data?.dataBase64 ?? ''}`;
        anchor.download = result.data?.fileName ?? 'attachment';
        anchor.click();
        return { saved: true };
      },
      openAttachment: async (id, token) => {
        const result = await post<InvokeEnvelope<AttachmentPayload>>('invoke', {
          op: 'attachments.read',
          input: { id },
          token,
        });
        if (!result.ok) throw new Error(result.error?.message ?? 'Attachment not found.');
        const bytes = Uint8Array.from(atob(result.data?.dataBase64 ?? ''), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: result.data?.mimeType ?? 'application/octet-stream' });
        window.open(URL.createObjectURL(blob), '_blank', 'noopener');
        return { opened: true };
      },
      saveText: async (suggestedName, content) => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = suggestedName;
        anchor.click();
        URL.revokeObjectURL(anchor.href);
        return { saved: true, path: suggestedName };
      },
      saveData: async (suggestedName, dataBase64) => {
        const anchor = document.createElement('a');
        anchor.href = `data:application/octet-stream;base64,${dataBase64}`;
        anchor.download = suggestedName;
        anchor.click();
        return { saved: true, path: suggestedName };
      },
      chooseFolder: async () => ({ path: null }),
      openPath: async () => ({ opened: false }),
      openExternal: async (url) => {
        window.open(url, '_blank', 'noopener');
        return { opened: true };
      },
    },
    appearance: { setTheme: async () => ({ ok: true }) },
    window: async () => ({ ok: false }),
  };
}

let bridge: HostBridge | null = null;

export function getBridge(): HostBridge {
  if (bridge) return bridge;
  const host = window.dentivaHost;
  if (!host) {
    bridge = createBrowserBridge();
    return bridge;
  }
  const electronBridge: HostBridge = {
    runtime: 'electron',
    info: () => host.info(),
    invoke: <T,>(op: string, input: unknown, token: string | null) => host.invoke(op, input, token) as Promise<InvokeEnvelope<T>>,
    printing: {
      listSystemPrinters: () => host.printing.listSystemPrinters(),
      preview: (request) => host.printing.preview(request),
      print: (request) => host.printing.print(request),
      pdf: (request) => host.printing.pdf(request),
      signalReady: () => host.printing.signalReady(),
      onData: (handler) => host.printing.onData(handler),
      deliver: (id, request) => host.printing.deliver(id, request) as Promise<unknown>,
      action: (id, request) => host.printing.action(id, request) as Promise<Record<string, unknown>>,
    },
    files: host.files,
    appearance: host.appearance,
    window: (action) => host.window(action),
  };
  bridge = electronBridge;
  return electronBridge;
}

export function isPrintWindowRuntime(): boolean {
  return window.dentivaHost?.runtime === 'print-window' || window.location.search.includes('print-window=1');
}
