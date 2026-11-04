// macOS: the window list, mouse and modifier state, and key presses through
// CoreGraphics (via koffi), the process tree through `ps`.
//
// Permissions: the window list and mouse state need none (window *titles* need
// Screen Recording, so without it windows are known by their app name). Pasting
// into another app (dropped files, the resume prompt) needs Accessibility.
// Window coordinates are already in the same points Electron uses.
'use strict';

const { execFile, execFileSync } = require('child_process');

let api = null;
try {
  const koffi = require('koffi');
  const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const AS = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
  const CGRect = koffi.struct('CGRect', { x: 'double', y: 'double', w: 'double', h: 'double' });
  api = {
    koffi,
    CGWindowListCopyWindowInfo: CG.func('void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeToWindow)'),
    CGRectMakeWithDictionaryRepresentation: CG.func('bool CGRectMakeWithDictionaryRepresentation(void *dict, _Out_ CGRect *rect)'),
    CGEventSourceButtonState: CG.func('bool CGEventSourceButtonState(int32_t state, uint32_t button)'),
    CGEventSourceFlagsState: CG.func('uint64_t CGEventSourceFlagsState(int32_t state)'),
    CGEventCreateKeyboardEvent: CG.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t key, bool down)'),
    CGEventSetFlags: CG.func('void CGEventSetFlags(void *event, uint64_t flags)'),
    CGEventPost: CG.func('void CGEventPost(uint32_t tap, void *event)'),
    AXIsProcessTrusted: AS.func('bool AXIsProcessTrusted()'),
    CFArrayGetCount: CF.func('long CFArrayGetCount(void *arr)'),
    CFArrayGetValueAtIndex: CF.func('void *CFArrayGetValueAtIndex(void *arr, long i)'),
    CFDictionaryGetValue: CF.func('void *CFDictionaryGetValue(void *dict, void *key)'),
    CFNumberGetValue: CF.func('bool CFNumberGetValue(void *num, long type, _Out_ double *out)'),
    CFStringCreateWithCString: CF.func('void *CFStringCreateWithCString(void *alloc, const char *s, uint32_t enc)'),
    CFStringGetCString: CF.func('bool CFStringGetCString(void *s, void *buf, long size, uint32_t enc)'),
    CFRelease: CF.func('void CFRelease(void *x)'),
  };
} catch (err) {
  console.warn('[darwin] window scanning disabled:', err.message);
}

const UTF8 = 0x08000100;
const keys = new Map();
const key = (name) => { if (!keys.has(name)) keys.set(name, api.CFStringCreateWithCString(null, name, UTF8)); return keys.get(name); };
const strBuf = Buffer.alloc(1024);
function num(dict, name) {
  const v = api.CFDictionaryGetValue(dict, key(name));
  if (!v) return null;
  const out = [0];
  return api.CFNumberGetValue(v, 13 /* kCFNumberDoubleType */, out) ? out[0] : null;
}
function str(dict, name) {
  const v = api.CFDictionaryGetValue(dict, key(name));
  if (!v || !api.CFStringGetCString(v, strBuf, strBuf.length, UTF8)) return '';
  const end = strBuf.indexOf(0);
  return strBuf.toString('utf8', 0, end < 0 ? strBuf.length : end);
}

/** On-screen app windows, front to back. */
function allWindows(ownPid) {
  if (!api) return [];
  const arr = api.CGWindowListCopyWindowInfo(1 | 16 /* on screen only, no desktop elements */, 0);
  if (!arr) return [];
  const out = [];
  try {
    const n = Number(api.CFArrayGetCount(arr));
    for (let i = 0; i < n; i++) {
      const d = api.CFArrayGetValueAtIndex(arr, i);
      if (num(d, 'kCGWindowLayer') !== 0) continue; // menus, the Dock, overlays…
      const pid = num(d, 'kCGWindowOwnerPID');
      if (!pid || pid === ownPid || num(d, 'kCGWindowAlpha') === 0) continue;
      const b = api.CFDictionaryGetValue(d, key('kCGWindowBounds'));
      const r = {};
      if (!b || !api.CGRectMakeWithDictionaryRepresentation(b, r) || r.w < 80 || r.h < 50) continue;
      const owner = str(d, 'kCGWindowOwnerName');
      out.push({ id: String(num(d, 'kCGWindowNumber')), title: str(d, 'kCGWindowName') || owner, exe: owner, pid, maximized: false, rect: { x: r.x, y: r.y, width: r.w, height: r.h } });
    }
  } finally {
    api.CFRelease(arr);
  }
  return out;
}

const listWindows = (ownPid) => allWindows(ownPid);
function listAllAppWindows(ownPid) {
  const tree = processTree();
  return allWindows(ownPid).map((w) => ({ ...w, handle: w.id, path: (tree.get(w.pid) || {}).exe || '' }));
}
function foregroundInfo() { return allWindows(process.pid)[0] || null; }
function foregroundId() { const f = foregroundInfo(); return f ? f.id : null; }

/** The .app bundle an executable lives in (…/Foo.app/Contents/MacOS/Foo -> …/Foo.app). */
const bundleOf = (exe) => { const m = /^(.*?\.app)(\/|$)/.exec(exe || ''); return m ? m[1] : null; };

/** Bring an app to the front (macOS picks which of its windows). No permissions needed. */
function focus(win) {
  const bundle = bundleOf(win && win.path);
  if (bundle) execFile('open', ['-a', bundle], () => {});
  return !!bundle;
}

let treeCache = { at: 0, map: new Map() };
function processTree() {
  if (Date.now() - treeCache.at < 1500) return treeCache.map;
  const map = new Map();
  try {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 3000 });
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (m) map.set(Number(m[1]), { ppid: Number(m[2]), exe: m[3].trim() });
    }
  } catch { /* ps unavailable */ }
  treeCache = { at: Date.now(), map };
  return map;
}
const exePath = (pid) => (processTree().get(pid) || {}).exe || '';

function mouseDown() { return api ? !!api.CGEventSourceButtonState(0 /* combined session */, 0 /* left */) : null; }
function modifiersDown() {
  if (!api) return false;
  const f = BigInt(api.CGEventSourceFlagsState(0));
  return (f & 0x1e0000n) !== 0n; // shift | control | option | command
}

/** Can we press keys in other apps? (System Settings → Privacy & Security → Accessibility) */
const canType = () => !!api && !!api.AXIsProcessTrusted();
function tap(keyCode, flags = 0n) {
  for (const down of [true, false]) {
    const e = api.CGEventCreateKeyboardEvent(null, keyCode, down);
    if (flags) api.CGEventSetFlags(e, flags);
    api.CGEventPost(0 /* kCGHIDEventTap */, e);
    api.CFRelease(e);
  }
}
function paste() { if (!canType()) return false; tap(9 /* v */, 0x100000n /* command */); return true; }
function pressEnter() { if (!canType()) return false; tap(36 /* return */); return true; }

module.exports = {
  available: !!api, coords: 'dip', listWindows, listAllAppWindows, foregroundInfo, foregroundId, focus, processTree, exePath,
  mouseDown, modifiersDown, paste, pressEnter, canType, bundleOf,
  accessibilityHelp: 'Allow Claude Buddy under System Settings → Privacy & Security → Accessibility',
};
