import { app, BrowserWindow, ipcMain, shell, session, dialog, nativeTheme } from 'electron';
import { join } from 'node:path';
import { DentivaApp } from '../core';
import { registerHostChannels } from './host';
import { PrintController } from './print';

const __dirnameCompat = __dirname;
const isDev = process.env.DENTIVA_DEV === '1' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let dentiva: DentivaApp | null = null;
let printController: PrintController | null = null;

const RENDERER_HTML = join(__dirnameCompat, '..', '..', 'dist', 'renderer', 'index.html');

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 660,
    show: false,
    backgroundColor: '#f4f6f9',
    title: 'Dentiva Pro',
    autoHideMenuBar: true,
    icon: join(__dirnameCompat, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: join(__dirnameCompat, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !isDev,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    win.maximize();
  });

  // Never allow the renderer to navigate anywhere except the bundled app.
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const allowed = new URL(RENDERER_HTML);
    if (target.protocol === 'file:' && target.pathname === allowed.pathname) return;
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (isDev && process.env.DENTIVA_DEV_URL) {
    void win.loadURL(process.env.DENTIVA_DEV_URL);
  } else {
    void win.loadFile(RENDERER_HTML);
  }
  return win;
}

function applyContentSecurityPolicy(): void {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

async function bootstrap(): Promise<void> {
  dentiva = new DentivaApp({
    logLevel: isDev ? 'debug' : 'info',
    consoleLog: isDev,
  });
  dentiva.container.settings.setState('app.dirty', '1');

  const integrity = dentiva.container.integrityCheck();
  if (!integrity.ok) {
    dentiva.container.logger.error('startup.integrity', { message: integrity.message });
  }

  applyContentSecurityPolicy();
  nativeTheme.themeSource = dentiva.container.settings.get('display.theme') === 'dark' ? 'dark' : 'light';
  printController = new PrintController(dentiva);
  registerHostChannels({ app: dentiva, printController, getWindow: () => mainWindow });

  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Keep the native window chrome in step with the in-app theme preference.
  ipcMain.on('host:theme-changed', (_event, theme: 'light' | 'dark') => {
    nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light';
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap).catch((error: Error) => {
    dialog.showErrorBox('Dentiva Pro could not start', `${error.message}\n\nNo data was changed.`);
    app.quit();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
      mainWindow = createWindow();
    }
  });

  app.on('before-quit', () => {
    try {
      if (dentiva) {
        dentiva.container.settings.setState('app.dirty', '0');
        dentiva.close();
      }
    } catch {
      /* shutting down must never throw */
    }
  });
}

export { };
