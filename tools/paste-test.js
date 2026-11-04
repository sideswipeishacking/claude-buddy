// Run with Electron: node_modules/electron/dist/electron.exe tools/paste-test.js
// Opens a small window with a text box, puts two files on the clipboard the way
// the buddy does (file list + @-mentions), presses Ctrl+V into it, and reports
// what a Chromium page receives: real files, text, or both. The clipboard is
// restored afterwards.
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const win32 = require('../app/win32');
const { mentions } = require('../app/deliver');

const page = `<!doctype html><textarea id=t style="width:95%;height:120px"></textarea><script>
const t = document.getElementById('t'); t.focus();
const { ipcRenderer } = require('electron');
t.addEventListener('paste', (e) => {
  const files = [...e.clipboardData.files].map((f) => f.name);
  setTimeout(() => ipcRenderer.send('pasted', { files, types: [...e.clipboardData.types], text: t.value }), 300);
});
</script>`;

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-paste-'));
  const files = ['notes.txt', 'my photo.png'].map((n) => { const f = path.join(dir, n); fs.writeFileSync(f, n); return f; });
  const saved = win32.saveClipboard();
  const win = new BrowserWindow({ width: 500, height: 220, title: 'Claude Buddy paste test', webPreferences: { nodeIntegration: true, contextIsolation: false } });
  await win.loadURL('data:text/html,' + encodeURIComponent(page));
  win.focus();
  win32.setClipboardOwner(win.getNativeWindowHandle());
  await new Promise((r) => setTimeout(r, 500));
  win32.setClipboard({ files, text: mentions(files) });
  win.webContents.paste(); // the same as Ctrl+V: Chromium reads the system clipboard
  const got = await new Promise((r) => { ipcMain.once('pasted', (e, d) => r(d)); setTimeout(() => r(null), 4000); });
  console.log(JSON.stringify(got, null, 1));
  console.log('clipboard restored:', win32.restoreClipboard(saved), `(${saved ? saved.length : 0} formats)`);
  fs.rmSync(dir, { recursive: true, force: true });
  app.exit(0);
});
