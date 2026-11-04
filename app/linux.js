// Linux (X11, including XWayland): the window list, focus, mouse and modifier
// state through libX11, key presses through XTest (both ship with every desktop
// that can run Electron), the process tree through /proc.
//
// On a Wayland session the app runs under XWayland (main.js asks Electron for
// X11), so the overlays can float and click through; windows of native Wayland
// apps aren't visible to X11, so buddies just don't use them as ledges.
'use strict';

const fs = require('fs');

let api = null;
let dpy = null;
let root = 0n;
try {
  const koffi = require('koffi');
  const X = koffi.load('libX11.so.6');
  const ErrorHandler = koffi.proto('int XErrorHandlerProto(void *dpy, void *event)');
  api = {
    koffi,
    XOpenDisplay: X.func('void *XOpenDisplay(const char *name)'),
    XDefaultRootWindow: X.func('unsigned long XDefaultRootWindow(void *dpy)'),
    XInternAtom: X.func('unsigned long XInternAtom(void *dpy, const char *name, int onlyIfExists)'),
    XGetWindowProperty: X.func('int XGetWindowProperty(void *dpy, unsigned long w, unsigned long prop, long off, long len, int del, unsigned long reqType, _Out_ unsigned long *actualType, _Out_ int *actualFormat, _Out_ unsigned long *nitems, _Out_ unsigned long *bytesAfter, _Out_ void **prop)'),
    XGetGeometry: X.func('int XGetGeometry(void *dpy, unsigned long d, _Out_ unsigned long *root, _Out_ int *x, _Out_ int *y, _Out_ unsigned int *w, _Out_ unsigned int *h, _Out_ unsigned int *border, _Out_ unsigned int *depth)'),
    XTranslateCoordinates: X.func('int XTranslateCoordinates(void *dpy, unsigned long src, unsigned long dst, int x, int y, _Out_ int *dx, _Out_ int *dy, _Out_ unsigned long *child)'),
    XQueryPointer: X.func('int XQueryPointer(void *dpy, unsigned long w, _Out_ unsigned long *root, _Out_ unsigned long *child, _Out_ int *rx, _Out_ int *ry, _Out_ int *wx, _Out_ int *wy, _Out_ unsigned int *mask)'),
    XSendEvent: X.func('int XSendEvent(void *dpy, unsigned long w, int propagate, long mask, void *event)'),
    XKeysymToKeycode: X.func('uint8_t XKeysymToKeycode(void *dpy, unsigned long keysym)'),
    XFlush: X.func('int XFlush(void *dpy)'),
    XFree: X.func('int XFree(void *data)'),
    XSetErrorHandler: X.func('void *XSetErrorHandler(XErrorHandlerProto *handler)'),
  };
  try {
    const XT = koffi.load('libXtst.so.6');
    api.XTestFakeKeyEvent = XT.func('int XTestFakeKeyEvent(void *dpy, unsigned int keycode, int isPress, unsigned long delay)');
  } catch { /* no XTest: no pasting */ }
  dpy = api.XOpenDisplay(null);
  if (!dpy) throw new Error('no X display (Wayland without XWayland?)');
  // X's default error handler exits the process; a window closing mid-read is normal here.
  api.XSetErrorHandler(koffi.register(() => 0, koffi.pointer(ErrorHandler)));
  root = BigInt(api.XDefaultRootWindow(dpy));
} catch (err) {
  api = null;
  console.warn('[linux] window scanning disabled:', err.message);
}

const atoms = new Map();
const atom = (name) => { if (!atoms.has(name)) atoms.set(name, BigInt(api.XInternAtom(dpy, name, 0))); return atoms.get(name); };

/** A window property as an array of numbers (format 32) or a string (format 8). */
function prop(win, name, type = 0n /* AnyPropertyType */, max = 4096) {
  const at = [0], fmt = [0], n = [0], after = [0], data = [null];
  if (api.XGetWindowProperty(dpy, win, atom(name), 0, max, 0, type, at, fmt, n, after, data) !== 0 || !data[0]) return null;
  try {
    const count = Number(n[0]);
    if (fmt[0] === 8) return Buffer.from(api.koffi.decode(data[0], 'uint8_t', count)).toString('utf8');
    if (fmt[0] === 32) return api.koffi.decode(data[0], 'unsigned long', count).map((v) => BigInt(v));
    return null;
  } finally {
    api.XFree(data[0]);
  }
}

const SKIP_TYPES = ['_NET_WM_WINDOW_TYPE_DOCK', '_NET_WM_WINDOW_TYPE_DESKTOP', '_NET_WM_WINDOW_TYPE_SPLASH', '_NET_WM_WINDOW_TYPE_NOTIFICATION', '_NET_WM_WINDOW_TYPE_TOOLTIP', '_NET_WM_WINDOW_TYPE_MENU', '_NET_WM_WINDOW_TYPE_DROPDOWN_MENU', '_NET_WM_WINDOW_TYPE_POPUP_MENU'];

function describe(w, desk) {
  const state = prop(w, '_NET_WM_STATE') || [];
  if (state.includes(atom('_NET_WM_STATE_HIDDEN'))) return null; // minimised
  const types = prop(w, '_NET_WM_WINDOW_TYPE') || [];
  if (types.some((t) => SKIP_TYPES.some((s) => atom(s) === t))) return null;
  const wd = prop(w, '_NET_WM_DESKTOP');
  if (desk !== null && wd && wd[0] !== desk && wd[0] !== 0xffffffffn) return null; // on another workspace
  const r = [0n], gx = [0], gy = [0], gw = [0], gh = [0], bw = [0], dp = [0];
  if (!api.XGetGeometry(dpy, w, r, gx, gy, gw, gh, bw, dp)) return null;
  const ax = [0], ay = [0], child = [0];
  api.XTranslateCoordinates(dpy, w, root, 0, 0, ax, ay, child);
  // Include the title bar the window manager draws around it.
  const ext = prop(w, '_NET_FRAME_EXTENTS') || [0n, 0n, 0n, 0n];
  const [L, R, T, B] = ext.map(Number);
  const rect = { x: ax[0] - L, y: ay[0] - T, width: gw[0] + L + R, height: gh[0] + T + B };
  if (rect.width < 80 || rect.height < 50) return null;
  const pidProp = prop(w, '_NET_WM_PID');
  const pid = pidProp ? Number(pidProp[0]) : 0;
  const title = prop(w, '_NET_WM_NAME', atom('UTF8_STRING')) || prop(w, 'WM_NAME') || '';
  return {
    id: String(w), handle: w, title, pid, exe: exeName(pid), rect,
    maximized: state.includes(atom('_NET_WM_STATE_MAXIMIZED_VERT')) && state.includes(atom('_NET_WM_STATE_MAXIMIZED_HORZ')),
  };
}

/** Normal app windows on the current workspace, front to back. */
function allWindows(ownPid) {
  if (!api) return [];
  const list = prop(root, '_NET_CLIENT_LIST_STACKING') || prop(root, '_NET_CLIENT_LIST') || [];
  const cur = prop(root, '_NET_CURRENT_DESKTOP');
  const out = [];
  for (const w of [...list].reverse()) {
    const d = describe(w, cur ? cur[0] : null);
    if (d && d.pid !== ownPid) out.push(d);
  }
  return out;
}

const listWindows = (ownPid) => allWindows(ownPid);
const listAllAppWindows = (ownPid) => allWindows(ownPid).map((w) => ({ ...w, path: exePath(w.pid) }));

function foregroundInfo() {
  if (!api) return null;
  const a = prop(root, '_NET_ACTIVE_WINDOW');
  if (!a || !a[0]) return null;
  return describe(a[0], null);
}
function foregroundId() { const f = foregroundInfo(); return f ? f.id : null; }

/** Ask the window manager to activate a window (_NET_ACTIVE_WINDOW). */
function focus(win) {
  if (!api || !win || !win.handle) return false;
  const ev = Buffer.alloc(192); // sizeof(XEvent) on 64-bit
  ev.writeInt32LE(33, 0); // ClientMessage
  ev.writeInt32LE(1, 16); // send_event
  ev.writeBigUInt64LE(BigInt(win.handle), 32); // window
  ev.writeBigUInt64LE(atom('_NET_ACTIVE_WINDOW'), 40); // message_type
  ev.writeInt32LE(32, 48); // format
  ev.writeBigInt64LE(2n, 56); // source: a pager (so the WM honours it)
  api.XSendEvent(dpy, root, 0, (1 << 20) | (1 << 19) /* SubstructureRedirect | SubstructureNotify */, ev);
  api.XFlush(dpy);
  return true;
}

function processTree() {
  const map = new Map();
  let entries = [];
  try { entries = fs.readdirSync('/proc'); } catch { return map; }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${e}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const ppid = Number(stat.slice(close + 2).split(' ')[1]);
      map.set(Number(e), { ppid, exe: stat.slice(stat.indexOf('(') + 1, close) });
    } catch { /* gone */ }
  }
  return map;
}
function exePath(pid) { try { return fs.readlinkSync(`/proc/${pid}/exe`); } catch { return ''; } }
function exeName(pid) { const p = exePath(pid); return p ? p.split('/').pop() : ''; }

function pointerMask() {
  if (!api) return null;
  const r = [0], c = [0], rx = [0], ry = [0], wx = [0], wy = [0], mask = [0];
  return api.XQueryPointer(dpy, root, r, c, rx, ry, wx, wy, mask) ? mask[0] : null;
}
function mouseDown() { const m = pointerMask(); return m === null ? null : (m & (1 << 8)) !== 0; }
function modifiersDown() { const m = pointerMask(); return m !== null && (m & (1 | 4 | 8 | 64)) !== 0; } // shift, control, alt, super

const canType = () => !!api && !!api.XTestFakeKeyEvent;
function tap(keysyms) {
  const codes = keysyms.map((k) => api.XKeysymToKeycode(dpy, k));
  for (const c of codes) api.XTestFakeKeyEvent(dpy, c, 1, 0);
  for (const c of [...codes].reverse()) api.XTestFakeKeyEvent(dpy, c, 0, 0);
  api.XFlush(dpy);
}
/** Terminals paste with Ctrl+Shift+V, everything else with Ctrl+V. */
function paste({ terminal = false } = {}) {
  if (!canType()) return false;
  tap(terminal ? [0xffe3, 0xffe1, 0x76] : [0xffe3, 0x76]); // Control_L (+ Shift_L) + v
  return true;
}
function pressEnter() { if (!canType()) return false; tap([0xff0d]); return true; }

module.exports = {
  available: !!api, coords: 'physical', listWindows, listAllAppWindows, foregroundInfo, foregroundId, focus, processTree, exePath,
  mouseDown, modifiersDown, paste, pressEnter, canType,
};
