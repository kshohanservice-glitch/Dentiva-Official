import { BrowserWindow, app, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import type { DentivaApp } from '../core';
import type { PrintController, PrintRequest } from './print';
import { safeFileName } from '../core/services/files';

const __dirnameCompat = __dirname;
const RENDERER_HTML = join(__dirnameCompat, '..', '..', 'dist', 'renderer', 'index.html');

export interface HostContext {
  app: DentivaApp;
  printController: PrintController;
  getWindow: () => BrowserWindow | null;
}

const CSV_MIME = 'text/csv';

/**
 * Host-only capabilities the renderer cannot perform itself: the file system,
 * native dialogs, and the operating system's own printer list.
 * Every handler validates its own inputs and contains its paths.
 */
export function registerHostChannels(ctx: HostContext): void {
  const { app: dentiva, printController, getWindow } = ctx;

  ipcMain.handle('host:info', () => ({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userData: app.getPath('userData'),
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('host:invoke', async (_event, message: { op: string; input: unknown; token: string | null }) => {
    return dentiva.invoke(message.op, message.input, { sessionToken: message.token, machine: app.getName() });
  });

  ipcMain.handle('host:printers', async () => {
    try {
      return await printController.listPrinters();
    } catch {
      return [];
    }
  });

  ipcMain.handle('host:printers:system', async () => {
    try {
      return await printController.listSystemPrinters();
    } catch {
      return [];
    }
  });

  ipcMain.handle('host:print', async (_event, request: Record<string, unknown>) => {
    const win = getWindow();
    if (!win) throw new Error('The application window is not available.');
    return printController.print(win, request as unknown as PrintRequest);
  });

  ipcMain.handle('host:pdf', async (_event, request: Record<string, unknown>) => {
    const win = getWindow();
    if (!win) throw new Error('The application window is not available.');
    return printController.savePdf(win, request as unknown as PrintRequest);
  });

  ipcMain.handle('host:preview', async (_event, request: Record<string, unknown>) => {
    const win = getWindow();
    if (!win) throw new Error('The application window is not available.');
    return printController.openPreview(win, request as unknown as PrintRequest);
  });

  ipcMain.handle('host:open-print-window', async (_event, payload: Record<string, unknown>) => {
    const win = getWindow();
    if (!win) throw new Error('The application window is not available.');
    return printController.openRenderWindow(win, payload);
  });

  ipcMain.handle('host:print-window-ready', async (event) => {
    const id = event.sender.id;
    return printController.notifyReady(id);
  });

  ipcMain.handle('host:print-window-render', async (_event, payload: Record<string, unknown>) => {
    return printController.deliver(payload);
  });

  ipcMain.handle('host:print-window-action', async (_event, payload: Record<string, unknown>) => {
    return printController.runAction(payload);
  });

  ipcMain.handle('host:print-window-closed', async (event) => {
    printController.handleClosed(event.sender.id);
  });

  ipcMain.handle('host:attachment-save', async (_event, payload: { id: number; token: string | null }) => {
    const result = await dentiva.invoke('attachments.path', { id: payload.id }, { sessionToken: payload.token });
    if (!result.ok) throw new Error(result.error?.message ?? 'Attachment not found.');
    const data = readFileSync((result.data as { path: string }).path);
    const name = (result.data as { fileName: string }).fileName;
    const win = getWindow();
    const save = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Save attachment',
      defaultPath: join(dentiva.container.paths.exportsDir, name),
      filters: [{ name: 'File', extensions: [extname(name).replace('.', '') || 'bin'] }],
    });
    if (save.canceled || !save.filePath) return { saved: false };
    writeFileSync(save.filePath, data);
    return { saved: true, path: save.filePath };
  });

  ipcMain.handle('host:attachment-open', async (_event, payload: { id: number; token: string | null }) => {
    const result = await dentiva.invoke('attachments.path', { id: payload.id }, { sessionToken: payload.token });
    if (!result.ok) throw new Error(result.error?.message ?? 'Attachment not found.');
    const error = await shell.openPath((result.data as { path: string }).path);
    if (error) throw new Error(error);
    return { opened: true };
  });

  ipcMain.handle('host:save-text', async (_event, payload: { suggestedName: string; content: string; mime?: string }) => {
    const win = getWindow();
    const name = safeFileName(basename(payload.suggestedName || 'export.txt'));
    const save = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Save file',
      defaultPath: join(dentiva.container.paths.exportsDir, name),
      filters: buildFilters(name),
    });
    if (save.canceled || !save.filePath) return { saved: false };
    mkdirSync(dirname(save.filePath), { recursive: true });
    writeFileSync(save.filePath, payload.content, 'utf8');
    return { saved: true, path: save.filePath };
  });

  ipcMain.handle('host:save-data', async (_event, payload: { suggestedName: string; dataBase64: string }) => {
    const win = getWindow();
    const name = safeFileName(basename(payload.suggestedName || 'export.bin'));
    const save = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Save file',
      defaultPath: join(dentiva.container.paths.exportsDir, name),
      filters: buildFilters(name),
    });
    if (save.canceled || !save.filePath) return { saved: false };
    writeFileSync(save.filePath, Buffer.from(payload.dataBase64, 'base64'));
    return { saved: true, path: save.filePath };
  });

  ipcMain.handle('host:choose-folder', async (_event, payload: { title?: string; defaultPath?: string }) => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: payload.title ?? 'Choose a folder',
      defaultPath: payload.defaultPath && existsSync(payload.defaultPath) ? payload.defaultPath : dentiva.container.paths.root,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('host:open-path', async (_event, payload: { path: string }) => {
    const error = await shell.openPath(payload.path);
    if (error) throw new Error(error);
    return { opened: true };
  });

  ipcMain.handle('host:open-external', async (_event, payload: { url: string }) => {
    if (!/^https?:\/\//i.test(payload.url)) throw new Error('Only http and https links can be opened.');
    await shell.openExternal(payload.url);
    return { opened: true };
  });

  ipcMain.handle('host:set-theme', async (_event, payload: { theme: 'light' | 'dark' }) => {
    nativeTheme.themeSource = payload.theme === 'dark' ? 'dark' : 'light';
    return { ok: true };
  });

  ipcMain.handle('host:window', async (_event, payload: { action: 'minimise' | 'maximise' | 'close' }) => {
    const win = getWindow();
    if (!win) return { ok: false };
    if (payload.action === 'minimise') win.minimize();
    else if (payload.action === 'close') win.close();
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true, maximised: win.isMaximized() };
  });

  ipcMain.handle('host:renderer-file', () => ({ html: RENDERER_HTML, csvMime: CSV_MIME }));
}

function buildFilters(name: string): Electron.FileFilter[] {
  const ext = extname(name).replace('.', '').toLowerCase();
  const map: Record<string, string[]> = {
    pdf: ['PDF'],
    csv: ['CSV', 'Text'],
    txt: ['Text'],
    jpg: ['JPEG image'],
    jpeg: ['JPEG image'],
    png: ['PNG image'],
  };
  if (map[ext]) return [{ name: map[ext][0] as string, extensions: [ext] }];
  return [{ name: 'All files', extensions: [ext || '*'] }];
}
