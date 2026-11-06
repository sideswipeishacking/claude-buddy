// One API over the three operating systems. Everything here is optional: when a
// piece isn't available (no X11, no permission, missing library) the buddies
// still roam, they just know less about your windows.
//
//   listWindows(ownPid)     app windows front to back: { id, title, exe, pid, maximized, rect }
//   listAllAppWindows(pid)  the same with { handle, path } for focusing
//   foregroundInfo()        the window you're using: { id, title, exe, pid }
//   focus(win)              bring a window (macOS: its app) to the front
//   processTree()           pid -> { ppid, exe }
//   mouseDown()             is the left button held (null if unknown)
//   coords                  'physical' (needs converting to Electron's DIPs) or 'dip'
//   clipboard / paste / pressEnter / keyWatcher, below
//   file dialogs            Windows only (fileDialogs, pressOpen, pixel, windowPixels)
'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const OS = process.platform;
const impl = OS === 'win32' ? require('./win32') : OS === 'darwin' ? require('./darwin') : require('./linux');

const none = () => [];
const base = {
  available: false, coords: 'physical',
  listWindows: none, listAllAppWindows: none, topWindowAt: () => null, cursorShowing: () => true, minimize: () => false,
  cursorPos: () => null, slowDrag: async () => ({ ok: false }), captureId: () => null, releaseCapture: () => false, windowInfoAt: () => null, foregroundInfo: () => null, foregroundId: () => null, focus: () => false,
  processTree: () => new Map(), exePath: () => '', mouseDown: () => null, modifiersDown: () => false,
  fileDialogs: none, pressOpen: () => false, pixel: () => null, windowPixels: none, setClipboardOwner: () => {}, postQuit: () => {},
};
const P = { ...base, ...impl, os: OS };
// Callers pass a window from listAllAppWindows; the Windows module wants its raw handle.
if (OS === 'win32') P.focus = (win) => !!win && impl.focus(win.handle || win);

/** Walk up from a process (a Claude session) to the first ancestor that owns a window. */
P.windowOwner = function windowOwner(pid, windows = P.listAllAppWindows(process.pid), tree = P.processTree()) {
  const owners = new Map();
  for (const w of windows) if (w.pid && !owners.has(w.pid)) owners.set(w.pid, w);
  const chain = [];
  for (let p = Number(pid), i = 0; p && i < 30; i++) {
    if (owners.has(p)) return { pid: p, window: owners.get(p), chain };
    const e = tree.get(p);
    if (!e) break;
    chain.push(e.exe);
    if (e.ppid === p) break;
    p = e.ppid;
  }
  return { pid: 0, window: null, chain };
};

// ---------------------------------------------------------------- clipboard
// Windows: every format is copied out and back, and real file lists can be put on it.
// macOS / Linux: Electron 45's (async) clipboard, text only. Dropped files go in as @-mentions.
let electronClipboard = null;
const ec = () => electronClipboard || (electronClipboard = require('electron').clipboard);

P.saveClipboard = async () => {
  try {
    if (OS === 'win32') return { win: impl.saveClipboard() };
    return { text: await ec().readText() };
  } catch { return null; }
};
P.restoreClipboard = async (saved) => {
  try {
    if (!saved) return;
    if (OS === 'win32') { if (saved.win) impl.restoreClipboard(saved.win); return; }
    await ec().writeText(saved.text || '');
  } catch { /* leave it */ }
};
P.setClipboard = async ({ files = [], text = '' } = {}) => {
  try {
    if (OS === 'win32') return impl.setClipboard({ files, text });
    await ec().writeText(text);
    return true;
  } catch { return false; }
};
P.clipboardHoldsFiles = OS === 'win32';

// ---------------------------------------------------------------- key presses into other apps
P.canType = impl.canType || (() => OS === 'win32');
P.paste = impl.paste || (() => { impl.keyCombo([0x11], 0x56); return true; }); // Ctrl+V
P.pressEnter = impl.pressEnter || (() => { impl.keyCombo([], 0x0d); return true; });
P.pasteKey = OS === 'darwin' ? '⌘V' : 'Ctrl+V';

// ---------------------------------------------------------------- type along: which kind of key you pressed, never which key
// onKey('type' | 'erase' | 'enter' | 'enter-blocked'). Returns { stop(), thread }.
P.keyWatcher = function keyWatcher(onKey, { flags } = {}) {
  if (OS === 'win32') {
    if (!impl.available) return null;
    const worker = new Worker(path.join(__dirname, 'keys.js'), { workerData: { flags } });
    const handle = { thread: 0, stop: () => impl.postQuit(handle.thread) };
    worker.on('message', (m) => { if (m.thread) handle.thread = m.thread; else if (m.key) onKey(m.key); });
    worker.on('error', () => {});
    return handle;
  }
  // macOS / Linux: the optional uiohook-napi package (macOS asks for Input Monitoring the first time).
  let hook;
  try { hook = require('uiohook-napi'); } catch { return null; }
  const { uIOhook, UiohookKey: K } = hook;
  const notTyping = new Set([K.Escape, K.Tab, K.Ctrl, K.CtrlRight, K.Shift, K.ShiftRight, K.Alt, K.AltRight, K.Meta, K.MetaRight, K.CapsLock]);
  const kind = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return null; // shortcuts aren't typing
    if (e.keycode === K.Backspace || e.keycode === K.Delete) return 'erase';
    if (e.keycode === K.Enter || e.keycode === K.NumpadEnter) return 'enter';
    if (notTyping.has(e.keycode)) return null;
    return e.keycode < 0x40 ? 'type' : null; // the main block: letters, digits, punctuation, space
  };
  uIOhook.on('keydown', (e) => { const k = kind(e); if (k) onKey(k); });
  try { uIOhook.start(); } catch { return null; }
  return { thread: 0, stop: () => { try { uIOhook.stop(); } catch { /* already stopped */ } } };
};

module.exports = P;
