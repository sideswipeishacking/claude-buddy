// Minimal Win32 bindings (via koffi): list top-level windows in z-order so
// buddies can stand on title bars, and bring a window to the front on click.
'use strict';

let api = null;
try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  koffi.struct('POINT', { x: 'long', y: 'long' });
  api = {
    koffi,
    RECT,
    GetTopWindow: user32.func('void * __stdcall GetTopWindow(void *hwnd)'),
    GetWindow: user32.func('void * __stdcall GetWindow(void *hwnd, uint32_t cmd)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *hwnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(void *hwnd)'),
    IsZoomed: user32.func('bool __stdcall IsZoomed(void *hwnd)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hwnd, void *buf, int max)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(void *hwnd, void *buf, int max)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ RECT *rect)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)'),
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void *hwnd)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(void *hwnd, int cmd)'),
    keybd_event: user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
    GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vk)'),
    PostThreadMessageW: user32.func('bool __stdcall PostThreadMessageW(uint32_t thread, uint32_t msg, uintptr_t w, intptr_t l)'),
    PostMessageW: user32.func('bool __stdcall PostMessageW(void *hwnd, uint32_t msg, uintptr_t w, intptr_t l)'),
    FindWindowExW: user32.func('void * __stdcall FindWindowExW(void *parent, void *after, str16 cls, str16 title)'),
    GetDlgItem: user32.func('void * __stdcall GetDlgItem(void *dlg, int id)'),
    IsWindowEnabled: user32.func('bool __stdcall IsWindowEnabled(void *hwnd)'),
    GetDC: user32.func('void * __stdcall GetDC(void *hwnd)'),
    ReleaseDC: user32.func('int __stdcall ReleaseDC(void *hwnd, void *dc)'),
    GetPixel: koffi.load('gdi32.dll').func('uint32_t __stdcall GetPixel(void *dc, int x, int y)'),
    WindowFromPoint: user32.func('void * __stdcall WindowFromPoint(POINT pt)'),
    GetAncestor: user32.func('void * __stdcall GetAncestor(void *hwnd, uint32_t flags)'),
    OpenClipboard: user32.func('bool __stdcall OpenClipboard(void *owner)'),
    CloseClipboard: user32.func('bool __stdcall CloseClipboard()'),
    EmptyClipboard: user32.func('bool __stdcall EmptyClipboard()'),
    SetClipboardData: user32.func('void * __stdcall SetClipboardData(uint32_t format, void *mem)'),
    GetClipboardData: user32.func('void * __stdcall GetClipboardData(uint32_t format)'),
    IsClipboardFormatAvailable: user32.func('bool __stdcall IsClipboardFormatAvailable(uint32_t format)'),
    RegisterClipboardFormatW: user32.func('uint32_t __stdcall RegisterClipboardFormatW(str16 name)'),
    GlobalAlloc: kernel32.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t bytes)'),
    GlobalLock: kernel32.func('void * __stdcall GlobalLock(void *mem)'),
    GlobalUnlock: kernel32.func('bool __stdcall GlobalUnlock(void *mem)'),
    GlobalFree: kernel32.func('void * __stdcall GlobalFree(void *mem)'),
    GlobalSize: kernel32.func('size_t __stdcall GlobalSize(void *mem)'),
    EnumClipboardFormats: user32.func('uint32_t __stdcall EnumClipboardFormats(uint32_t format)'),
    RtlMoveMemory: kernel32.func('void __stdcall RtlMoveMemory(void *dst, const void *src, size_t n)'),
    DragQueryFileW: koffi.load('shell32.dll').func('uint32_t __stdcall DragQueryFileW(void *drop, uint32_t index, void *buf, uint32_t size)'),
    GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
    DwmGetWindowAttribute: dwmapi.func('long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, void *out, uint32_t size)'),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *proc, uint32_t flags, void *buf, _Inout_ uint32_t *size)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
  };
  const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
    dwSize: 'uint32_t', cntUsage: 'uint32_t', th32ProcessID: 'uint32_t', th32DefaultHeapID: 'uintptr_t', th32ModuleID: 'uint32_t',
    cntThreads: 'uint32_t', th32ParentProcessID: 'uint32_t', pcPriClassBase: 'int32_t', dwFlags: 'uint32_t', szExeFile: koffi.array('char16_t', 260, 'String'),
  });
  api.PROCESSENTRY32W = PROCESSENTRY32W;
  api.CreateToolhelp32Snapshot = kernel32.func('void * __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)');
  api.Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(void *snap, _Inout_ PROCESSENTRY32W *entry)');
  api.Process32NextW = kernel32.func('bool __stdcall Process32NextW(void *snap, _Inout_ PROCESSENTRY32W *entry)');
} catch (err) {
  console.warn('[win32] window scanning disabled:', err.message);
}

const GW_HWNDNEXT = 2;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_EX_APPWINDOW = 0x40000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const SKIP_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', 'NotifyIconOverflowWindow', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow']);

const textBuf = Buffer.alloc(1024);
const exeCache = new Map();

function readText(fn, hwnd) {
  const n = fn(hwnd, textBuf, 511);
  return n > 0 ? textBuf.toString('utf16le', 0, n * 2) : '';
}

function exePath(pid) {
  if (exeCache.has(pid)) return exeCache.get(pid);
  let full = '';
  const h = api.OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
  if (h) {
    const size = [512];
    if (api.QueryFullProcessImageNameW(h, 0, textBuf, size)) full = textBuf.toString('utf16le', 0, size[0] * 2);
    api.CloseHandle(h);
  }
  exeCache.set(pid, full);
  if (exeCache.size > 500) exeCache.clear();
  return full;
}
const exeName = (pid) => exePath(pid).split('\\').pop();

function frameRect(hwnd) {
  const r = {};
  const buf = Buffer.alloc(16);
  if (api.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, buf, 16) === 0) {
    r.left = buf.readInt32LE(0); r.top = buf.readInt32LE(4); r.right = buf.readInt32LE(8); r.bottom = buf.readInt32LE(12);
    return r;
  }
  const out = {};
  return api.GetWindowRect(hwnd, out) ? out : null;
}

function cloaked(hwnd) {
  const buf = Buffer.alloc(4);
  return api.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, buf, 4) === 0 && buf.readUInt32LE(0) !== 0;
}

/**
 * Visible top-level windows, topmost first. Rects are in physical pixels.
 * Each entry keeps its native handle so callers can focus it later.
 */
function listWindows(ownPid) {
  if (!api) return [];
  const out = [];
  let h = api.GetTopWindow(null);
  for (let guard = 0; h && guard < 2000; guard++, h = api.GetWindow(h, GW_HWNDNEXT)) {
    if (!api.IsWindowVisible(h) || api.IsIconic(h)) continue;
    const ex = Number(api.GetWindowLongPtrW(h, GWL_EXSTYLE));
    if ((ex & WS_EX_TOOLWINDOW) && !(ex & WS_EX_APPWINDOW)) continue;
    if ((ex & WS_EX_NOACTIVATE) && !(ex & WS_EX_APPWINDOW)) continue;
    const cls = readText(api.GetClassNameW, h);
    if (SKIP_CLASSES.has(cls) || cloaked(h)) continue;
    const title = readText(api.GetWindowTextW, h);
    if (!title) continue;
    const pid = [0];
    api.GetWindowThreadProcessId(h, pid);
    if (pid[0] === ownPid) continue;
    const r = frameRect(h);
    if (!r || r.right - r.left < 120 || r.bottom - r.top < 60) continue;
    out.push({
      id: String(api.koffi.address(h)),
      handle: h,
      title,
      cls,
      exe: exeName(pid[0]),
      maximized: api.IsZoomed(h),
      rect: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top },
    });
  }
  return out;
}

function foregroundId() {
  if (!api) return null;
  const h = api.GetForegroundWindow();
  return h ? String(api.koffi.address(h)) : null;
}

/** Title and executable of the window you're working in. */
function foregroundInfo() {
  if (!api) return null;
  const h = api.GetForegroundWindow();
  if (!h) return null;
  const pid = [0];
  api.GetWindowThreadProcessId(h, pid);
  return { id: String(api.koffi.address(h)), title: readText(api.GetWindowTextW, h), exe: exeName(pid[0]), pid: pid[0] };
}

function rectOf(h) {
  const r = {};
  if (!h || !api.GetWindowRect(h, r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/**
 * Open-file dialogs ("Add files or photos") currently on screen: standard
 * Windows item dialogs (#32770 with a shell view) and who owns them.
 * Rects are physical pixels.
 */
function fileDialogs(ownPid) {
  if (!api) return [];
  const out = [];
  let h = api.GetTopWindow(null);
  for (let guard = 0; h && guard < 2000; guard++, h = api.GetWindow(h, GW_HWNDNEXT)) {
    if (!api.IsWindowVisible(h) || api.IsIconic(h)) continue;
    if (readText(api.GetClassNameW, h) !== '#32770') continue;
    if (!api.FindWindowExW(h, null, 'DUIViewWndClassName', null)) continue; // not a file dialog
    const pid = [0];
    api.GetWindowThreadProcessId(h, pid);
    if (pid[0] === ownPid) continue;
    const owner = api.GetWindow(h, 4 /* GW_OWNER */);
    const open = api.GetDlgItem(h, 1 /* IDOK */);
    out.push({
      id: String(api.koffi.address(h)),
      handle: h,
      exe: exeName(pid[0]),
      title: readText(api.GetWindowTextW, h),
      ownerTitle: owner ? readText(api.GetWindowTextW, owner) : '',
      rect: rectOf(h),
      open: open && api.IsWindowVisible(open) ? { handle: open, rect: rectOf(open), enabled: api.IsWindowEnabled(open) } : null,
    });
  }
  return out;
}

/** Press a dialog's default button (Open), as if clicked. */
function pressOpen(dialog) {
  if (!api || !dialog || !dialog.open) return false;
  return api.PostMessageW(dialog.handle, 0x0111 /* WM_COMMAND */, 1 /* IDOK, BN_CLICKED */, Number(api.koffi.address(dialog.open.handle)));
}

/** Screen colour at a physical pixel, as #rrggbb (to paint over "eaten" files). */
function pixel(x, y) {
  if (!api) return null;
  const dc = api.GetDC(null);
  const c = api.GetPixel(dc, Math.round(x), Math.round(y));
  api.ReleaseDC(null, dc);
  if (c === 0xffffffff) return null;
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(c & 0xff)}${hex((c >> 8) & 0xff)}${hex((c >> 16) & 0xff)}`;
}

/**
 * Screen colours at points (physical px) where this window is the one on top, as
 * #rrggbb. Points covered by another window are skipped (our click-through
 * overlays don't count as covering).
 */
function windowPixels(handle, points) {
  if (!api || !handle) return [];
  const own = String(api.koffi.address(handle));
  const dc = api.GetDC(null);
  const out = [];
  const hex = (n) => n.toString(16).padStart(2, '0');
  try {
    for (const [x, y] of points) {
      const pt = { x: Math.round(x), y: Math.round(y) };
      const at = api.WindowFromPoint(pt);
      const root = at && api.GetAncestor(at, 2 /* GA_ROOT */);
      if (!root || String(api.koffi.address(root)) !== own) continue;
      const c = api.GetPixel(dc, pt.x, pt.y);
      if (c !== 0xffffffff) out.push(`#${hex(c & 0xff)}${hex((c >> 8) & 0xff)}${hex((c >> 16) & 0xff)}`);
    }
  } finally {
    api.ReleaseDC(null, dc);
  }
  return out;
}

/** Ask a thread's message loop to finish (WM_QUIT). */
function postQuit(threadId) {
  return !!api && !!threadId && api.PostThreadMessageW(threadId, 0x12, 0, 0);
}

/** Bring a window to the front (restoring it if minimised). */
function focus(handle) {
  if (!api || !handle) return false;
  if (api.IsIconic(handle)) api.ShowWindow(handle, 9 /* SW_RESTORE */);
  // Windows only lets the foreground process hand focus away; a synthetic Alt
  // press unlocks SetForegroundWindow for us.
  api.keybd_event(0x12, 0, 0, 0);
  api.keybd_event(0x12, 0, 2, 0);
  return api.SetForegroundWindow(handle);
}

/** All windows (including minimised ones) for focus lookups. */
function listAllAppWindows(ownPid) {
  if (!api) return [];
  const out = [];
  let h = api.GetTopWindow(null);
  for (let guard = 0; h && guard < 2000; guard++, h = api.GetWindow(h, GW_HWNDNEXT)) {
    if (!api.IsWindowVisible(h)) continue;
    const title = readText(api.GetWindowTextW, h);
    if (!title) continue;
    const pid = [0];
    api.GetWindowThreadProcessId(h, pid);
    if (pid[0] === ownPid) continue;
    out.push({ handle: h, id: String(api.koffi.address(h)), title, exe: exeName(pid[0]), path: exePath(pid[0]), pid: pid[0] });
  }
  return out;
}

/** Every process: pid -> { ppid, exe }, to walk up from a Claude session to the window it runs in. */
function processTree() {
  const map = new Map();
  if (!api) return map;
  const snap = api.CreateToolhelp32Snapshot(0x2 /* TH32CS_SNAPPROCESS */, 0);
  if (!snap || api.koffi.address(snap) === 0xffffffffffffffffn) return map;
  try {
    const e = { dwSize: api.koffi.sizeof(api.PROCESSENTRY32W) };
    for (let ok = api.Process32FirstW(snap, e); ok; ok = api.Process32NextW(snap, e)) {
      map.set(e.th32ProcessID, { ppid: e.th32ParentProcessID, exe: e.szExeFile });
      e.dwSize = api.koffi.sizeof(api.PROCESSENTRY32W);
    }
  } finally {
    api.CloseHandle(snap);
  }
  return map;
}

// ---------------------------------------------------------------- clipboard and keys (handing things to a session's input)
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Windows wants a window to own what we put on the clipboard (one of our overlays).
let clipOwner = null;
function setClipboardOwner(hwndBuffer) {
  try { clipOwner = hwndBuffer ? api.koffi.decode(hwndBuffer, 'void *') : null; } catch { clipOwner = null; }
}
function openClipboard() {
  for (let i = 0; i < 15; i++) { if (api.OpenClipboard(clipOwner)) return true; pause(20); }
  return false;
}

// Formats held as GDI handles rather than memory can't be copied this way (Windows re-creates them from the others).
const GDI_FORMATS = new Set([2, 3, 9, 14, 0x80, 0x82, 0x83, 0x8e]);

/** Everything on the clipboard, copied out (to put it back after we've used it). */
function saveClipboard() {
  if (!api || !openClipboard()) return null;
  const saved = [];
  try {
    let total = 0;
    for (let f = api.EnumClipboardFormats(0); f; f = api.EnumClipboardFormats(f)) {
      if (GDI_FORMATS.has(f)) continue;
      const h = api.GetClipboardData(f);
      if (!h) continue;
      const size = Number(api.GlobalSize(h));
      if (!size || (total += size) > 64e6) continue;
      const p = api.GlobalLock(h);
      if (!p) continue;
      const buf = Buffer.alloc(size);
      api.RtlMoveMemory(buf, p, size);
      api.GlobalUnlock(h);
      saved.push({ f, buf });
    }
  } finally {
    api.CloseClipboard();
  }
  return saved;
}

function restoreClipboard(saved) {
  if (!api || !saved || !openClipboard()) return false;
  try {
    api.EmptyClipboard();
    for (const { f, buf } of saved) putClip(f, buf);
    return true;
  } finally {
    api.CloseClipboard();
  }
}
function putClip(format, buf) {
  const mem = api.GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, buf.length);
  if (!mem) return false;
  const p = api.GlobalLock(mem);
  api.RtlMoveMemory(p, buf, buf.length);
  api.GlobalUnlock(mem);
  if (!api.SetClipboardData(format, mem)) { api.GlobalFree(mem); return false; }
  return true;
}

/** Put files (as a real file list, like Explorer's Copy) and/or text on the clipboard. */
function setClipboard({ files = [], text = '' } = {}) {
  if (!api || !openClipboard()) return false;
  try {
    api.EmptyClipboard();
    if (files.length) {
      const head = Buffer.alloc(20);
      head.writeUInt32LE(20, 0); // DROPFILES.pFiles: the list starts right after this header
      head.writeUInt32LE(1, 16); // fWide: UTF-16 paths
      putClip(15 /* CF_HDROP */, Buffer.concat([head, Buffer.from(files.join('\0') + '\0\0', 'utf16le')]));
      const effect = Buffer.alloc(4);
      effect.writeUInt32LE(1, 0); // DROPEFFECT_COPY
      putClip(api.RegisterClipboardFormatW('Preferred DropEffect'), effect);
    }
    if (text) putClip(13 /* CF_UNICODETEXT */, Buffer.from(text + '\0', 'utf16le'));
    return true;
  } finally {
    api.CloseClipboard();
  }
}

/** The files on the clipboard (if someone copied files in Explorer), to put them back afterwards. */
function clipboardFiles() {
  if (!api || !api.IsClipboardFormatAvailable(15) || !openClipboard()) return [];
  const out = [];
  try {
    const drop = api.GetClipboardData(15);
    if (!drop) return out;
    const n = api.DragQueryFileW(drop, 0xffffffff, null, 0);
    for (let i = 0; i < n && i < 500; i++) {
      const len = api.DragQueryFileW(drop, i, null, 0);
      const buf = Buffer.alloc((len + 1) * 2);
      api.DragQueryFileW(drop, i, buf, len + 1);
      out.push(buf.toString('utf16le', 0, len * 2));
    }
  } finally {
    api.CloseClipboard();
  }
  return out;
}

/** Are Shift, Ctrl, Alt or Win physically held? */
function modifiersDown() {
  return !!api && [0x10, 0x11, 0x12, 0x5b, 0x5c].some((vk) => (api.GetAsyncKeyState(vk) & 0x8000) !== 0);
}

/** Press a key with modifiers held, e.g. keyCombo([0x11], 0x56) for Ctrl+V. */
function keyCombo(mods, vk) {
  if (!api) return;
  for (const m of mods) api.keybd_event(m, 0, 0, 0);
  api.keybd_event(vk, 0, 0, 0);
  api.keybd_event(vk, 0, 2 /* KEYEVENTF_KEYUP */, 0);
  for (const m of [...mods].reverse()) api.keybd_event(m, 0, 2, 0);
}

/** Is the primary mouse button physically down? (null if unknown) */
function mouseDown() {
  if (!api) return null;
  const swapped = api.GetSystemMetrics(23 /* SM_SWAPBUTTON */) !== 0;
  return (api.GetAsyncKeyState(swapped ? 0x02 : 0x01) & 0x8000) !== 0;
}

module.exports = {
  available: !!api, listWindows, listAllAppWindows, foregroundId, foregroundInfo, postQuit, focus, mouseDown, fileDialogs, pressOpen, pixel, windowPixels,
  setClipboard, clipboardFiles, saveClipboard, restoreClipboard, setClipboardOwner, modifiersDown, keyCombo, processTree, exePath,
};
