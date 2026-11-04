// Worker thread: a global low-level keyboard hook so buddies can type along.
// Privacy: it reports only the *kind* of key press ('type', 'erase', 'enter'),
// never which key, keeps nothing, and skips shortcuts (Ctrl/Alt/Win held).
// The main process decides whether the focused window belongs to a buddy.
'use strict';

const { parentPort, workerData } = require('worker_threads');
const selfTest = !!(workerData && workerData.selfTest); // tools only: also report injected F24 presses
// Set by the main process while a watched file dialog is in front: Enter then
// goes to the buddy (which eats the files and presses Open itself).
const flags = workerData && workerData.flags ? new Int32Array(workerData.flags) : null;
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', { vkCode: 'uint32_t', scanCode: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', extra: 'uintptr_t' });
const MSG = koffi.struct('MSG', { hwnd: 'void *', message: 'uint32_t', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32_t', x: 'long', y: 'long', priv: 'uint32_t' });
const HookProc = koffi.proto('intptr_t __stdcall HookProc(int code, uintptr_t wParam, void *lParam)');
const SetWindowsHookExW = user32.func('void * __stdcall SetWindowsHookExW(int id, HookProc *proc, void *mod, uint32_t thread)');
const CallNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(void *hook, int code, uintptr_t wParam, void *lParam)');
const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void *hook)');
const GetMessageW = user32.func('int __stdcall GetMessageW(_Out_ MSG *msg, void *hwnd, uint32_t min, uint32_t max)');
const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vk)');
const GetModuleHandleW = kernel32.func('void * __stdcall GetModuleHandleW(void *name)');
const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()');

const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x100;
const LLKHF_INJECTED = 0x10;
const held = (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0;

function kindOf(vk) {
  if (vk === 0x08 || vk === 0x2e) return 'erase'; // Backspace, Delete
  if (vk === 0x0d) return 'enter';
  if (vk === 0x20 || (vk >= 0x30 && vk <= 0x5a) || (vk >= 0x60 && vk <= 0x6f) || (vk >= 0xba && vk <= 0xe2)) return 'type';
  return null; // arrows, F-keys, modifiers...
}

let hook = null;
const proc = koffi.register((code, wParam, lParam) => {
  try {
    if (code === 0 && Number(wParam) === WM_KEYDOWN) {
      const k = koffi.decode(lParam, KBDLLHOOKSTRUCT);
      if (selfTest && k.vkCode === 0x87) parentPort.postMessage({ key: 'selftest' });
      if (flags && Atomics.load(flags, 0) === 1 && k.vkCode === 0x0d && !(k.flags & LLKHF_INJECTED)) {
        parentPort.postMessage({ key: 'enter-blocked' });
        return 1; // swallow it
      }
      const kind = (k.flags & LLKHF_INJECTED) ? null : kindOf(k.vkCode);
      if (kind && !held(0x11) && !held(0x12) && !held(0x5b) && !held(0x5c)) parentPort.postMessage({ key: kind });
    }
  } catch { /* never let the hook throw */ }
  return CallNextHookEx(hook, code, wParam, lParam);
}, koffi.pointer(HookProc));

hook = SetWindowsHookExW(WH_KEYBOARD_LL, proc, GetModuleHandleW(null), 0);
parentPort.postMessage({ ready: !!hook, thread: GetCurrentThreadId() });

// Low-level hooks are delivered through this thread's message loop.
// The main process posts WM_QUIT here on shutdown, which ends the loop.
const msg = {};
while (GetMessageW(msg, null, 0, 0) > 0) { /* keep pumping */ }
if (hook) UnhookWindowsHookEx(hook);
koffi.unregister(proc);
