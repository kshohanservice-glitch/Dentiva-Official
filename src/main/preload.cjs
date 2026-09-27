// Electron preload bridge.
//
// The renderer gets exactly this narrow, typed surface and nothing else:
// no Node, no `require`, no file system, no ipcRenderer. Every call is a plain
// IPC invoke into the host, which routes it to the service container.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE_CHANNELS = new Set([
  'host:info',
  'host:invoke',
  'host:printers',
  'host:printers:system',
  'host:print',
  'host:pdf',
  'host:preview',
  'host:open-print-window',
  'host:print-window-ready',
  'host:print-window-render',
  'host:print-window-action',
  'host:print-window-closed',
  'host:attachment-save',
  'host:attachment-open',
  'host:save-text',
  'host:save-data',
  'host:choose-folder',
  'host:open-path',
  'host:open-external',
  'host:set-theme',
  'host:window',
  'host:renderer-file',
]);

const isPrintWindow = process.argv.some((arg) => arg === '--dentiva-print-window');

const api = {
  runtime: isPrintWindow ? 'print-window' : 'main-window',
  info: () => ipcRenderer.invoke('host:info'),
  invoke: (op, input, token) => ipcRenderer.invoke('host:invoke', { op, input, token: token ?? null }),

  printing: {
    listPrinters: () => ipcRenderer.invoke('host:printers'),
    listSystemPrinters: () => ipcRenderer.invoke('host:printers:system'),
    preview: (request) => ipcRenderer.invoke('host:preview', request),
    print: (request) => ipcRenderer.invoke('host:print', request),
    pdf: (request) => ipcRenderer.invoke('host:pdf', request),
    openWindow: (request) => ipcRenderer.invoke('host:open-print-window', request),
    signalReady: () => ipcRenderer.invoke('host:print-window-ready'),
    deliver: (id, request) => ipcRenderer.invoke('host:print-window-render', { id, request }),
    action: (id, request) => ipcRenderer.invoke('host:print-window-action', { id, request }),
    closed: () => ipcRenderer.invoke('host:print-window-closed'),
    onData: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('print:data', listener);
      return () => ipcRenderer.removeListener('print:data', listener);
    },
  },

  files: {
    saveAttachment: (id, token) => ipcRenderer.invoke('host:attachment-save', { id, token }),
    openAttachment: (id, token) => ipcRenderer.invoke('host:attachment-open', { id, token }),
    saveText: (suggestedName, content) => ipcRenderer.invoke('host:save-text', { suggestedName, content }),
    saveData: (suggestedName, dataBase64) => ipcRenderer.invoke('host:save-data', { suggestedName, dataBase64 }),
    chooseFolder: (title, defaultPath) => ipcRenderer.invoke('host:choose-folder', { title, defaultPath }),
    openPath: (path) => ipcRenderer.invoke('host:open-path', { path }),
    openExternal: (url) => ipcRenderer.invoke('host:open-external', { url }),
  },

  appearance: {
    setTheme: (theme) => ipcRenderer.invoke('host:set-theme', { theme }),
  },

  window: (action) => ipcRenderer.invoke('host:window', { action }),
};

contextBridge.exposeInMainWorld('dentivaHost', api);
