import { BrowserWindow, screen } from 'electron';
import { join, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PAPER_SIZES, type PaperSizeId } from '../shared/constants';
import * as APP_PATHS from './paths';

const { RENDERER_HTML, PRELOAD } = APP_PATHS;
const MM_PER_INCH = 25.4;

export interface PrintGeometry {
  docKind: string;
  entityId: number | null;
  entityLabel: string;
  paperId: PaperSizeId;
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
}

export interface PrintRequest extends PrintGeometry {
  data: unknown;
  output: 'preview' | 'print' | 'pdf';
  suggestedName?: string;
}

interface RenderWindow {
  win: BrowserWindow;
  request: PrintRequest;
  ready: Promise<void>;
  resolveReady: () => void;
  loaded: boolean;
}

/**
 * Print rendering.
 *
 * A dedicated offscreen window loads the same React bundle as the application
 * and renders the document with the requested paper geometry. The *same* DOM
 * then feeds the on-screen preview, Chromium's PDF writer and the Windows print
 * dialog, so what a dentist previews is what comes out of the printer.
 */
export class PrintController {
  private windows = new Map<number, RenderWindow>();

  constructor(private readonly dentiva: import('../core').DentivaApp) {}

  async listPrinters(): Promise<{ name: string; isDefault: boolean }[]> {
    return [{ name: '', isDefault: true }];
  }

  async listSystemPrinters(): Promise<string[]> {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    try {
      const printers = await win.webContents.getPrintersAsync();
      return printers.map((p) => p.name);
    } catch {
      return [];
    } finally {
      win.destroy();
    }
  }

  private createRenderWindow(parent: BrowserWindow, request: PrintRequest): RenderWindow {
    const win = new BrowserWindow({
      parent,
      show: false,
      width: 900,
      height: 1100,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        additionalArguments: ['--dentiva-print-window'],
      },
    });
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const entry: RenderWindow = { win, request, ready, resolveReady, loaded: false };
    this.windows.set(win.webContents.id, entry);
    win.on('closed', () => this.windows.delete(win.webContents.id));
    void win.loadFile(RENDERER_HTML, { hash: 'print' });
    return entry;
  }

  async openRenderWindow(parent: BrowserWindow, payload: Record<string, unknown>): Promise<{ id: number }> {
    const request = payload.request as PrintRequest;
    const entry = this.createRenderWindow(parent, request);
    await entry.ready;
    return { id: entry.win.webContents.id };
  }

  notifyReady(webContentsId: number): void {
    const entry = this.windows.get(webContentsId);
    if (!entry) return;
    entry.loaded = true;
    entry.resolveReady();
  }

  handleClosed(webContentsId: number): void {
    this.windows.delete(webContentsId);
  }

  async deliver(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
    const entry = this.windows.get(Number(payload.id));
    if (!entry) return { ok: false };
    entry.request = { ...entry.request, ...(payload.request as PrintRequest) };
    entry.win.webContents.send('print:data', entry.request);
    return { ok: true };
  }

  async runAction(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const entry = this.windows.get(Number(payload.id));
    if (!entry) return { ok: false, error: 'The print window is no longer available.' };
    const request = { ...entry.request, ...(payload.request as Partial<PrintRequest>) };
    if (request.output === 'pdf') return this.writePdf(entry, request);
    if (request.output === 'print') return this.doPrint(entry, request);
    return this.showPreview(entry, request);
  }

  /** Re-uses an already-rendered window to show the on-screen preview. */
  private async showPreview(entry: RenderWindow, request: PrintRequest): Promise<Record<string, unknown>> {
    entry.win.setTitle(`Preview — ${request.entityLabel}`);
    entry.win.show();
    entry.win.focus();
    return { ok: true };
  }

  // ── Renderer entry points used by the main window ──────────────────────

  async openPreview(parent: BrowserWindow, request: PrintRequest): Promise<Record<string, unknown>> {
    const entry = this.createRenderWindow(parent, request);
    await entry.ready;
    entry.win.webContents.send('print:data', request);
    const bounds = parent.getBounds();
    const display = screen.getDisplayMatching(bounds).workAreaSize;
    const width = Math.min(980, display.width - 80);
    const height = Math.min(1100, display.height - 80);
    entry.win.setBounds({
      width,
      height,
      x: bounds.x + Math.max(0, Math.round((bounds.width - width) / 2)),
      y: bounds.y + Math.max(0, Math.round((bounds.height - height) / 2)),
    });
    entry.win.setTitle(`Preview — ${request.entityLabel}`);
    entry.win.show();
    entry.win.focus();
    return { ok: true };
  }

  async savePdf(parent: BrowserWindow, request: PrintRequest): Promise<Record<string, unknown>> {
    const entry = this.createRenderWindow(parent, request);
    await entry.ready;
    entry.win.webContents.send('print:data', request);
    await this.waitForRender(entry);
    return this.writePdf(entry, request);
  }

  async print(parent: BrowserWindow, request: PrintRequest): Promise<Record<string, unknown>> {
    const entry = this.createRenderWindow(parent, request);
    await entry.ready;
    entry.win.webContents.send('print:data', request);
    await this.waitForRender(entry);
    return this.doPrint(entry, request);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async waitForRender(entry: RenderWindow): Promise<void> {
    await entry.ready;
    await new Promise((resolve) => setTimeout(resolve, 220));
    await entry.win.webContents.executeJavaScript(
      'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true',
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  private geometry(request: PrintRequest): { width: number; height: number } {
    const fallback = PAPER_SIZES[request.paperId] ?? PAPER_SIZES.a4;
    let width = request.widthMm > 0 ? request.widthMm : fallback.width;
    let height = request.heightMm > 0 ? request.heightMm : fallback.height;
    if (request.orientation === 'landscape' && height > 0 && width < height) [width, height] = [height, width];
    return { width, height };
  }

  private async writePdf(entry: RenderWindow, request: PrintRequest): Promise<Record<string, unknown>> {
    const { width, height } = this.geometry(request);
    const contentHeight = await this.measureHeight(entry);
    const useHeight = height > 0 ? height : contentHeight;
    try {
      const data = await entry.win.webContents.printToPDF({
        printBackground: true,
        pageSize: {
          width: Math.max(1, Math.round((width / MM_PER_INCH) * 10000)) / 10000,
          height: Math.max(0.1, Math.round((useHeight / MM_PER_INCH) * 10000)) / 10000,
        },
        margins: {
          top: request.marginTopMm / MM_PER_INCH,
          bottom: request.marginBottomMm / MM_PER_INCH,
          left: request.marginLeftMm / MM_PER_INCH,
          right: request.marginRightMm / MM_PER_INCH,
        },
        preferCSSPageSize: false,
        generateDocumentOutline: false,
      });
      const target = this.defaultOutputPath(request);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      void this.dentiva.invoke(
        'printHistory.record',
        { docKind: request.docKind, entityId: request.entityId, entityLabel: request.entityLabel, output: 'pdf', paperId: request.paperId, path: target },
        {},
      );
      return { ok: true, path: target, bytes: data.length };
    } finally {
      if (!entry.win.isDestroyed()) entry.win.destroy();
    }
  }

  private async doPrint(entry: RenderWindow, request: PrintRequest): Promise<Record<string, unknown>> {
    const { width, height } = this.geometry(request);
    const contentHeight = await this.measureHeight(entry);
    const useHeight = height > 0 ? height : contentHeight;
    try {
      const printed = await new Promise<Record<string, unknown>>((resolve, reject) => {
        entry.win.webContents.print(
          {
            silent: false,
            printBackground: true,
            deviceName: request.printerName || undefined,
            copies: Math.max(1, Math.min(20, request.copies || 1)),
            pageSize: {
              width: Math.max(1, Math.round((width / MM_PER_INCH) * 10000)) / 10000,
              height: Math.max(0.1, Math.round((useHeight / MM_PER_INCH) * 10000)) / 10000,
            },
            margins: {
              marginType: 'none',
              top: request.marginTopMm / MM_PER_INCH,
              bottom: request.marginBottomMm / MM_PER_INCH,
              left: request.marginLeftMm / MM_PER_INCH,
              right: request.marginRightMm / MM_PER_INCH,
            },
          },
          (success, failureReason) => (success ? resolve({ ok: true }) : reject(new Error(failureReason || 'Printing was cancelled or failed.'))),
        );
      });
      void this.dentiva.invoke(
        'printHistory.record',
        { docKind: request.docKind, entityId: request.entityId, entityLabel: request.entityLabel, output: 'print', paperId: request.paperId },
        {},
      );
      return printed;
    } finally {
      if (!entry.win.isDestroyed()) entry.win.destroy();
    }
  }

  private async measureHeight(entry: RenderWindow): Promise<number> {
    try {
      const px = await entry.win.webContents.executeJavaScript(
        'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)',
        true,
      );
      const dpi = entry.win.webContents.getZoomFactor() > 0 ? 96 : 96;
      return Math.max(40, (Number(px) * 25.4) / dpi);
    } catch {
      return 120;
    }
  }

  private defaultOutputPath(request: PrintRequest): string {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const safeLabel = request.entityLabel.replace(/[^A-Za-z0-9 _.-]/g, '').trim().replace(/\s+/g, '-') || request.docKind;
    return join(this.dentiva.container.paths.exportsDir, `${request.docKind}-${safeLabel}-${stamp}.pdf`);
  }
}
