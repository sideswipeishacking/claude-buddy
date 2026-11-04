// Live check of the file-dialog path (opens a real Open dialog for a few seconds):
// find the dialog, select files with UI Automation, read the selection with
// app/uia-helper.ps1, then press Open the way the buddy does and see which
// files the dialog returned.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
// Match Electron: per-monitor DPI aware, so window rects and UI Automation agree on physical pixels.
try { require('koffi').load('user32.dll').func('bool __stdcall SetProcessDpiAwarenessContext(intptr_t ctx)')(-4); } catch { /* older Windows */ }
const win32 = require('../app/win32');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-dialog-'));
const names = ['alpha.txt', 'bravo.txt', 'charlie.png', 'delta.txt', 'echo.zip', 'foxtrot.txt'];
for (const n of names) fs.writeFileSync(path.join(dir, n), n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failures++; };

const ps = (script) => spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8' });

(async () => {
  const dialogProc = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
    Add-Type -AssemblyName System.Windows.Forms
    $d = New-Object System.Windows.Forms.OpenFileDialog
    $d.InitialDirectory = '${dir}'; $d.Multiselect = $true; $d.Title = 'Claude Buddy dialog test'
    if ($d.ShowDialog() -eq 'OK') { $d.FileNames | ForEach-Object { [IO.Path]::GetFileName($_) } } else { 'CANCELLED' }`]);
  let picked = '';
  dialogProc.stdout.on('data', (d) => { picked += d; });

  let dlg = null;
  for (let i = 0; i < 60 && !dlg; i++) { await sleep(250); dlg = win32.fileDialogs(process.pid).find((d) => d.title === 'Claude Buddy dialog test'); }
  check('found the open-file dialog and its Open button', !!dlg && !!dlg.open, dlg ? `${dlg.exe}` : 'none');
  if (!dlg) { dialogProc.kill(); process.exit(1); }
  await sleep(1200); // let the file list populate
  if (process.argv.includes('--icons')) {
    // Switch the dialog to Large icons, like picking it in the View menu (a command to its shell view).
    const koffi = require('koffi');
    const u32 = koffi.load('user32.dll');
    const FindWindowExW = u32.func('void * __stdcall FindWindowExW(void *parent, void *after, str16 cls, str16 title)');
    const PostMessageW = u32.func('bool __stdcall PostMessageW(void *hwnd, uint32_t msg, uintptr_t w, intptr_t l)');
    const find = (parent, cls, depth = 0) => {
      const direct = FindWindowExW(parent, null, cls, null);
      if (direct || depth > 6) return direct;
      for (let c = FindWindowExW(parent, null, null, null); c; c = FindWindowExW(parent, c, null, null)) { const hit = find(c, cls, depth + 1); if (hit) return hit; }
      return null;
    };
    const defView = find(dlg.handle, 'SHELLDLL_DefView');
    check('found the dialog shell view', !!defView);
    if (defView) PostMessageW(defView, 0x0111, 0x704f /* large icons */, 0);
    await sleep(1200);
  }

  // Select bravo, charlie (touching) and echo (apart) like a user would.
  const sel = ps(`
    Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
    $AE = [System.Windows.Automation.AutomationElement]
    $root = $AE::FromHandle([IntPtr][Int64]${dlg.id})
    $list = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'UIItemsView')))
    $first = $true
    foreach ($n in 'bravo','charlie','echo') {
      $it = $list.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $n)))
      if (-not $it) { $it = $list.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $n + '.' + @{bravo='txt';charlie='png';echo='zip'}[$n]))) }
      $p = $it.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($first) { $p.Select(); $first = $false } else { $p.AddToSelection() }
    }
    'selected'`);
  check('selected three files through UI Automation', /selected/.test(sel.stdout), (sel.stderr || '').split('\n')[0]);
  await sleep(400);

  const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'app', 'uia-helper.ps1')]);
  let out = '';
  helper.stdout.on('data', (d) => { out += d; });
  helper.stdin.write(`items ${dlg.id}\n`);
  for (let i = 0; i < 40 && out.split('\n').filter(Boolean).length < 2; i++) await sleep(200);
  helper.kill();
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  check('the helper says it is ready', lines[0] === '{"ready":true}', lines[0]);
  let scan = {};
  try { scan = JSON.parse(lines[1] || '{}'); } catch { /* checked below */ }
  const items = Array.isArray(scan.items) ? scan.items : scan.items ? [scan.items] : [];
  check('the helper reads the three selected files with their rectangles', scan.ok && items.length === 3 && items.every((it) => it.w > 0 && it.h > 0), items.map((it) => `${it.name}@${Math.round(it.x)},${Math.round(it.y)} ${Math.round(it.w)}x${Math.round(it.h)}`).join(' | '));
  check('…and the file list rectangle', scan.list && scan.list.w > 100 && scan.list.h > 50, scan.list && `${Math.round(scan.list.w)}x${Math.round(scan.list.h)}`);
  const view = items.length ? items.reduce((s, it) => s + it.w / it.h, 0) / items.length > 3 ? 'rows' : 'icons' : '?';
  if (process.argv.includes('--icons')) check('the dialog is in an icon view', view === 'icons', view);
  const own = win32.windowPixels(dlg.handle, [[scan.list.x + scan.list.w - 26, scan.list.y + scan.list.h - 8], [scan.list.x + 30, scan.list.y + scan.list.h - 8]]);
  console.log(`      view looks like: ${view}; screen pixel: ${win32.pixel(scan.list.x + scan.list.w - 26, scan.list.y + scan.list.h - 8)}; dialog's own pixels: ${own.join(' ')}`);
  check('reads the list background only where the dialog is on top', own.every((c) => c === own[0]) && (own.length === 0 || own[0] === win32.pixel(scan.list.x + scan.list.w - 26, scan.list.y + scan.list.h - 8)), own.join(' ') || 'dialog covered here');

  if (process.argv.includes('--app')) {
    // End to end through the running app: hand the dialog to a buddy, "click Open", film the meal.
    const api = (q) => fetch(`http://127.0.0.1:47321/debug/act?${q}`, { method: 'POST' }).then((r) => r.json());
    check('the running app watches the dialog', !(await api('do=watchdialog')).error);
    const shots = [];
    const start = Date.now();
    api('do=dialogopen');
    for (const at of [700, 1500, 2300, 3100]) {
      await sleep(Math.max(0, at - (Date.now() - start)));
      const r = await fetch('http://127.0.0.1:47321/debug/capture', { method: 'POST' }).then((x) => x.json());
      const to = path.join(process.argv[process.argv.indexOf('--app') + 1] || os.tmpdir(), `eat-${at}.png`);
      fs.copyFileSync(r.files[0], to);
      shots.push(to);
    }
    console.log(`      frames: ${shots.join(', ')}`);
    for (let i = 0; i < 60 && dialogProc.exitCode === null; i++) await sleep(200);
    check('Open was pressed only after the buddy finished eating', Date.now() - start > 1500, `${Date.now() - start} ms`);
  } else check('pressing Open the buddy way', win32.pressOpen(dlg));
  for (let i = 0; i < 20 && dialogProc.exitCode === null; i++) await sleep(200);
  const got = picked.trim().split(/\r?\n/).filter(Boolean);
  check('the dialog closed and returned exactly the selected files', got.length === 3 && ['bravo.txt', 'charlie.png', 'echo.zip'].every((n) => got.includes(n)), got.join(', '));
  if (dialogProc.exitCode === null) dialogProc.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
