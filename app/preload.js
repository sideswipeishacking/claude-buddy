// Narrow bridge between the overlay/gallery/workshop pages and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const IN = new Set(['init', 'init-tab', 'frame', 'sound', 'debugHover']);
const OUT = new Set([
  'hover', 'grab', 'release', 'context', 'decide', 'look-preview', 'look-save', 'win-close',
  'ov-action', 'tower', 'buddy-forget', 'files-dropped', 'drag-over', 'dialog-open-click', 'place', 'place-cancel',
]);

contextBridge.exposeInMainWorld('buddy', {
  on(channel, fn) { if (IN.has(channel)) ipcRenderer.on(channel, (_e, data) => fn(data)); },
  send(channel, data) { if (OUT.has(channel)) ipcRenderer.send(channel, data); },
  // Files dropped on a buddy: their real paths (File.path is gone in this Electron).
  pathForFile(file) { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
});
