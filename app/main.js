// Claude Buddy: pixel Clawds that roam the desktop, one per Claude Code session,
// built and watched over by the Overlord. Hooks POST events to a local server;
// a world simulation turns them into buddies; transparent click-through
// overlays (one per monitor) draw them.
'use strict';

const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');
const platform = require('./platform');
const paths = require('../lib/paths');
const { setAutostart } = require('../lib/autostart');
const Clawd = require('./sprites');
const { Sessions } = require('./sessions');
const { World, fullLook } = require('./world');
const { runDemo } = require('./demo');
const { deliver, openSession, resolveApp } = require('./deliver');

// Sent to a session whose work the usage limit cut off, once the limit resets.
const RESUME_PROMPT = 'Proceed, but double-check everything to make sure that nothing is left half-done';

const PORT = paths.PORT;
const OS = process.platform;
const TICK_MS = 16;
const WINDOW_SCAN_MS = 140;
const PERMISSION_HOLD_MS = 585e3; // the hook gives up at 590 s
const USAGE_EVERY_MS = 3 * 60e3;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (OS === 'linux') {
  // Floating, click-through overlays need X11 (XWayland on a Wayland session) and transparent visuals.
  app.commandLine.appendSwitch('ozone-platform', process.env.CLAUDE_BUDDY_OZONE || 'x11'); // (tests use 'headless')
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
if (!app.requestSingleInstanceLock()) app.quit();

// A desktop pet must never pop error dialogs: log and keep going.
const logFile = () => path.join(app.getPath('userData'), 'error.log');
const errorSeen = new Map(); // message -> { at, repeats }
function logError(err, where = '') {
  try {
    const msg = String(err && err.message ? err.message : err);
    const seen = errorSeen.get(msg);
    if (seen && Date.now() - seen.at < 60e3) { seen.repeats++; return; } // the same error at most once a minute
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > 1e6) fs.renameSync(f, f + '.old');
    const repeats = seen && seen.repeats ? ` (repeated ${seen.repeats}x)` : '';
    errorSeen.set(msg, { at: Date.now(), repeats: 0 });
    if (errorSeen.size > 200) errorSeen.clear();
    fs.appendFileSync(f, `[${new Date().toISOString()}]${where ? ` [${where}]` : ''}${repeats} ${err && err.stack ? err.stack : err}\n`);
  } catch { /* nowhere to log */ }
}
process.on('uncaughtException', (err) => logError(err, 'uncaught'));
process.on('unhandledRejection', (err) => logError(err, 'promise'));
let quitting = false;
const timers = [];
let keyWatcher = null;
let lastKeyAt = 0;
const keyFlags = new Int32Array(new SharedArrayBuffer(4)); // [0] = swallow Enter for a watched file dialog
app.on('before-quit', () => {
  quitting = true;
  timers.forEach(clearInterval);
  keyWatcher?.stop();
  releaseAllPermissions();
  uia?.kill();
  // Quitting sends everyone home (they come back out when you turn them on, or with /buddy).
  // A restart for an update (/quit from the installer) keeps them out, so they're restored afterwards.
  if (quitStarted) for (const e of Object.values(store.registry)) e.active = false;
  try { clearTimeout(saveTimer); fs.writeFileSync(storeFile(), JSON.stringify(store, null, 2)); } catch (err) { logError(err, 'save on quit'); }
});

// ---------------------------------------------------------------- settings & the buddy registry
// registry: every buddy ever created, by session id: its look, name and whether it's on.
// sizes: pixel scale (DIP per sprite pixel) on the laptop's own panel and on other monitors.
const storeFile = () => path.join(app.getPath('userData'), 'state.json');
let store = { registry: {}, muted: false, autoSummon: false, hidden: false, typing: undefined, sizes: { internal: 2, external: 4 }, defaultLook: null, overlordBorn: false, startWithWindows: undefined, limit: null };
function loadStore() {
  try { store = { ...store, ...JSON.parse(fs.readFileSync(storeFile(), 'utf8')) }; } catch { /* first run */ }
  // Older versions kept only the active buddies in "summoned".
  if (store.summoned) {
    for (const [id, e] of Object.entries(store.summoned)) if (!id.startsWith('demo-')) store.registry[id] = { ...e, active: true, created: e.ts, lastSeen: e.ts };
    delete store.summoned;
  }
  const ids = Object.keys(store.registry).sort((a, b) => (store.registry[b].lastSeen || 0) - (store.registry[a].lastSeen || 0));
  for (const id of ids.slice(200)) delete store.registry[id];
}
let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(store, null, 2));
  }, 300);
}
const isOn = (id) => !!store.registry[id]?.active;

// Hook-event timeline (names and timing only) to diagnose stray or late alerts.
const events = [];
function logEvent(ev) {
  const line = { t: new Date().toISOString(), sid: String(ev.session_id || '').slice(0, 8), ev: ev.hook_event_name, tool: ev.tool_name, type: ev.notification_type };
  events.push(line);
  if (events.length > 400) events.shift();
  try {
    const f = path.join(app.getPath('userData'), 'events.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 1e6) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, JSON.stringify(line) + '\n');
  } catch { /* logging is best effort */ }
}

// ---------------------------------------------------------------- core objects
const sessions = new Sessions();
const overlays = new Map(); // display id -> { win, display, ready, caps }
let poses = null;
let tray = null;
let gallery = null;
const workshops = new Map(); // session id -> customizer window
let placing = null; // { ids, until } while you pick a spot for "Come here"

const world = new World({
  sound(name, x, y) {
    if (store.muted) return;
    const target = overlayAt(x, y - 10) || [...overlays.values()][0];
    if (target?.ready && !target.win.isDestroyed()) target.win.webContents.send('sound', name);
  },
  focus(b) { focusSession(b.session); },
  removed(id) { if (store.registry[id]) { store.registry[id].active = false; saveStore(); } refreshTray(); },
  stale(id) { sendHome(id); },
  overlordBorn() { store.overlordBorn = true; saveStore(); },
  error(err, where) { logError(err, where); },
  released(results) { onReleased(results); },
});

function overlayAt(x, y) {
  for (const o of overlays.values()) {
    const b = o.display.bounds;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return o;
  }
  return null;
}

// ---------------------------------------------------------------- summoning & looks
function pickHat(preferred) {
  if (preferred && Clawd.HATS[preferred]) return preferred;
  const used = world.usedHats();
  return Clawd.HAT_ORDER.find((h) => !used.has(h)) || Clawd.HAT_ORDER[Math.floor(Math.random() * Clawd.HAT_ORDER.length)];
}

/** A buddy's look: what it wore last time, or your default with a hat no other buddy is wearing. */
function lookFor(saved, cmd = {}) {
  if (saved?.look) return fullLook(saved.look);
  const base = fullLook(store.defaultLook || {});
  base.hat = cmd.action === 'hat' ? pickHat(cmd.value) : store.defaultLook?.hat || pickHat(saved?.hat);
  return base;
}

function remember(s, b, active = true) {
  if (s.id.startsWith('demo-')) return;
  const prev = store.registry[s.id] || { created: Date.now() };
  store.registry[s.id] = {
    ...prev, active, lastSeen: Date.now(), ts: Date.now(),
    look: b ? b.look : prev.look, muted: b ? b.muted : prev.muted, pinned: b ? b.pinned : prev.pinned, where: s.where || prev.where,
    name: s.name || prev.name, nickname: s.nickname || prev.nickname || '', source: s.source || prev.source, cwd: s.cwd || prev.cwd, transcript: s.transcript || prev.transcript,
    client: s.client || prev.client, app: appRecord(s) || prev.app,
  };
  saveStore();
  updateResidents();
}

/** The skyscraper's floors: every known buddy, oldest at the bottom. */
function updateResidents() {
  const list = Object.entries(store.registry)
    .filter(([id]) => !id.startsWith('demo-'))
    .sort((a, b) => (a[1].created || 0) - (b[1].created || 0))
    .map(([id, e]) => ({
      id, name: e.nickname || e.name || 'buddy', body: (e.look && e.look.body) || Clawd.COL.body, hat: e.look && e.look.hat,
      room: e.look && e.look.room, created: e.created || 0, seen: e.lastSeen || 0,
    }));
  world.setResidents(list);
}

/** The app a session runs in, worth keeping across restarts (its window owner's pid survives our restart). */
const appRecord = (s) => (s.app && s.app.pid ? { pid: s.app.pid, exe: s.app.exe, path: s.app.path, kind: s.app.kind, name: s.app.name, scheme: s.app.scheme } : null);

/** Fill a session from its saved registry entry (after a restart, or when turned on again). */
function hydrate(s, saved) {
  Object.assign(s, {
    name: saved.name || s.name, nickname: s.nickname || saved.nickname || '', source: s.source !== 'Claude Code' && s.sourceRefined ? s.source : saved.source || s.source,
    where: s.where || saved.where || whereFromSource(saved.source), cwd: s.cwd || saved.cwd || '', transcript: s.transcript || saved.transcript || '',
  });
  if (!s.client && saved.client) s.client = saved.client;
  if (!s.app && saved.app) s.app = { ...saved.app, at: 0 }; // re-checked (and kept if that program still runs)
  if (saved.source && !s.sourceRefined) s.sourceRefined = !['IDE', 'IDE terminal', 'Terminal', 'JetBrains IDE'].includes(saved.source);
}

function summon(s, cmd = {}, { birth = true } = {}) {
  let b = world.get(s.id);
  if (!b) {
    const saved = store.registry[s.id];
    if (saved && !s.nickname) s.nickname = saved.nickname || '';
    const look = lookFor(saved, cmd);
    // A buddy that already lives in the skyscraper takes the elevator down; only brand-new buddies get printed.
    b = saved && birth ? world.leaveHome(s, look) : world.add(s, { look, x: screen.getCursorScreenPoint().x, birth });
    if (saved) { b.muted = !!saved.muted; b.pinned = !!saved.pinned; }
  } else if (world.homeBound(b)) {
    b.task = null; // it was on its way home: it stays out after all
  } else if (cmd.action === 'hat' && Clawd.HATS[cmd.value]) {
    world.setLook(s.id, { ...b.look, hat: cmd.value });
  }
  remember(s, b, true);
  refreshTray();
  return b;
}

/** Off duty: it walks back to the skyscraper and rides up to its floor (demo buddies just poof). */
function sendHome(id, { hurry = false } = {}) {
  const s = sessions.map.get(id);
  const demo = String(id).startsWith('demo-');
  if (store.registry[id]) { store.registry[id].active = false; saveStore(); }
  else if (s && !demo) remember(s, world.get(id), false);
  if (demo || !store.registry[id] || !world.goHome(id, { hurry })) world.remove(id);
  updateResidents();
}

/** Quitting: everyone hurries home first (a few seconds at most), then the app closes. */
let quitStarted = false;
function quitApp() {
  if (quitStarted) return;
  quitStarted = true;
  for (const b of [...world.buddies.values()]) sendHome(b.id, { hurry: true });
  const until = Date.now() + 8000;
  const wait = setInterval(() => {
    const out = [...world.buddies.values()].filter((b) => b.mode !== 'hell');
    if (!out.length || Date.now() > until) { clearInterval(wait); setTimeout(() => app.quit(), out.length ? 0 : 900); }
  }, 100);
}

/** Turn a registered buddy back on (from the Overlord), even if its session is quiet right now. */
function turnOn(id) {
  const saved = store.registry[id];
  if (!saved) return;
  const s = sessions.get(id);
  hydrate(s, saved);
  if (!s.lastEventAt || s.lastEventAt < Date.now() - 3600e3) s.lastEventAt = Date.now();
  summon(s);
}

sessions.on('summon', (s, cmd) => summon(s, cmd));
sessions.on('dismiss', (s) => sendHome(s.id));
sessions.on('start', (s) => { if (store.autoSummon || isOn(s.id)) summon(s); });
sessions.on('update', (s) => {
  if (s.state === 'ended') return;
  if (!world.has(s.id) && (isOn(s.id) || store.autoSummon)) summon(s);
  else if (store.registry[s.id]) { store.registry[s.id].lastSeen = Date.now(); store.registry[s.id].ts = Date.now(); saveStore(); }
});
sessions.on('end', (s) => sendHome(s.id));
sessions.on('done', (s) => world.onDone(s.id));
sessions.on('error', (s, streak) => world.onError(s.id, streak));
sessions.on('crashed', (s) => world.onCrashed(s.id));
sessions.on('limit-hit', (s) => onLimitHit(s));
sessions.on('context-high', (s) => {
  const b = world.get(s.id);
  if (b && b.mode !== 'hell') { world.wake(b); b.push('startled', 900, { bubble: 'ctx', sound: 'alert' }); }
});
sessions.on('attention', (s, kind) => world.onAttention(s.id, kind));
sessions.on('permission-resolved', (s) => releasePermissions(s.id, null));
sessions.on('custom', (s) => { summon(s); openWorkshop(s.id); });
sessions.on('helpers', (s, on) => {
  const b = summon(s);
  world.setLook(s.id, { ...b.look, helpers: on });
  remember(s, b);
});

// "/buddy size 3" sets the size for the kind of screen the buddy is on;
// "/buddy size laptop 2" or "/buddy size external 5" target one explicitly.
function setSize(which, n) {
  store.sizes = { ...store.sizes, [which]: Math.max(1, Math.min(12, Math.round(n))) };
  world.sizes = store.sizes;
  saveStore();
  refreshTray();
}
sessions.on('size', (s, value) => {
  const m = String(value).match(/^(?:(laptop|internal|external|monitor|other)\s+)?(\d+)$/);
  if (!m) return;
  let which = m[1] ? (/laptop|internal/.test(m[1]) ? 'internal' : 'external') : null;
  if (!which) {
    const b = world.get(s.id);
    const c = b ? world.centre(b) : screen.getCursorScreenPoint();
    const d = world.displayAt(c.x, c.y) || world.nearestDisplay(c.x, c.y);
    which = d && d.internal ? 'internal' : 'external';
  }
  setSize(which, Number(m[2]));
});

// Bring back the buddies that were on before the app restarted (quietly, no build show).
function restoreBuddies() {
  for (const [id, saved] of Object.entries(store.registry)) {
    if (!saved.active) continue;
    if (Date.now() - (saved.lastSeen || 0) > 12 * 3600e3) { saved.active = false; continue; }
    const s = sessions.get(id);
    hydrate(s, saved);
    s.lastEventAt = saved.lastSeen;
    const b = world.restore(s, lookFor(saved));
    b.muted = !!saved.muted;
    b.pinned = !!saved.pinned;
  }
  saveStore();
}

// ---------------------------------------------------------------- permissions from the buddy
// The PermissionRequest hook POSTs to /permission and waits. We hold the
// response until you press Allow / Always / Deny on the buddy, or the prompt
// is answered elsewhere (then we release it empty-handed).
const heldPermissions = new Map(); // session id -> [{ res, timer }]

function holdPermission(s, res) {
  const entry = { res, timer: setTimeout(() => answer(s.id, entry, null), PERMISSION_HOLD_MS) };
  const list = heldPermissions.get(s.id) || [];
  list.push(entry);
  heldPermissions.set(s.id, list);
  s.permHeld = true;
  res.on('close', () => {
    // The hook went away (Claude Code resolved the prompt itself).
    const l = heldPermissions.get(s.id) || [];
    if (l.includes(entry) && !entry.done) {
      entry.done = true;
      clearTimeout(entry.timer);
      l.splice(l.indexOf(entry), 1);
      if (!l.length) { s.permHeld = false; if (s.attention === 'permission') sessions.resolvePermission(s); }
    }
  });
}

function answer(sid, entry, decision) {
  if (entry.done) return;
  entry.done = true;
  clearTimeout(entry.timer);
  try { entry.res.writeHead(200, { 'Content-Type': 'application/json' }); entry.res.end(JSON.stringify({ decision })); } catch { /* hook already gone */ }
  const list = heldPermissions.get(sid) || [];
  if (list.includes(entry)) list.splice(list.indexOf(entry), 1);
  const s = sessions.map.get(sid);
  if (s && !list.length) s.permHeld = false;
}

function releasePermissions(sid, decision) {
  for (const entry of [...(heldPermissions.get(sid) || [])]) answer(sid, entry, decision);
}
function releaseAllPermissions() { for (const sid of heldPermissions.keys()) releasePermissions(sid, null); }

function decide(id, decision) {
  const list = heldPermissions.get(id) || [];
  if (!list.length || !['allow', 'always', 'deny'].includes(decision)) return false;
  answer(id, list[0], decision);
  const s = sessions.map.get(id);
  if (s && !(heldPermissions.get(id) || []).length) sessions.resolvePermission(s);
  world.onDecision(id, decision);
  return true;
}
ipcMain.on('decide', (e, { id, decision }) => decide(id, decision));

// ---------------------------------------------------------------- focus on click
function focusSession(s) {
  if (s.pendingResume) { sendResume(s, { fromClick: true }); return; }
  openSession(s).catch((err) => logError(err, 'focus'));
}

// ---------------------------------------------------------------- whose window is this?
// The session whose process runs inside the window's app (its terminal, IDE or the Claude app).
// Several sessions in one app (tabs, editor windows): the one whose project is in the title, else the busiest.
function buddyForWindow(fg) {
  if (!fg || !fg.pid) return null;
  const live = [...world.buddies.values()].filter((b) => !b.leaving && b.mode !== 'hell');
  let mine = live.filter((b) => { try { return resolveApp(b.session).pid === fg.pid; } catch { return false; } });
  if (!mine.length && fg.exe) mine = live.filter((b) => { try { const a = resolveApp(b.session); return !a.pid && a.exe && a.exe.toLowerCase() === fg.exe.toLowerCase(); } catch { return false; } });
  if (mine.length <= 1) return mine[0] || null;
  const title = (fg.title || '').toLowerCase();
  const named = mine.filter((b) => { const n = (b.session.name || '').toLowerCase(); return n && title.includes(n); });
  const pool = named.length ? named : mine;
  return pool.sort((a, b) => b.session.lastEventAt - a.session.lastEventAt)[0];
}

function startKeyWatcher() {
  if (keyWatcher || !store.typing) return;
  keyWatcher = platform.keyWatcher((key) => {
    if (key === 'enter-blocked') { interceptOpen('enter'); return; }
    lastKeyAt = Date.now();
    if (!store.typing || quitting) return;
    const b = buddyForWindow(platform.foregroundInfo());
    if (b) world.onKey(b.id, key);
  }, { flags: keyFlags.buffer });
}

// ---------------------------------------------------------------- "Add files or photos" dialogs
// When the buddy's session opens a file dialog, the Open button (and Enter) go
// to the buddy first: it eats the selected rows or icons, then presses Open.
let watched = null; // { id, dialog, buddyId, state: 'armed' | 'eating' }
let uia = null;
let uiaWaiters = [];

function startUia() {
  if (uia && !uia.killed && uia.exitCode === null) return uia;
  uia = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'uia-helper.ps1')], { windowsHide: true });
  let buf = '';
  uia.stdout.setEncoding('utf8');
  uia.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) continue;
      const w = uiaWaiters.shift();
      if (w) w(msg);
    }
  });
  uia.on('exit', () => { for (const w of uiaWaiters.splice(0)) w({ ok: false, error: 'helper exited' }); uia = null; });
  uia.on('error', logError);
  return uia;
}

function uiaItems(dialogId, timeout = 3000) {
  return new Promise((resolve) => {
    const helper = startUia();
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    uiaWaiters.push(finish);
    setTimeout(() => { uiaWaiters = uiaWaiters.filter((w) => w !== finish); finish({ ok: false, error: 'timeout' }); }, timeout);
    helper.stdin.write(`items ${dialogId}\n`);
  });
}

function watchDialogs() {
  if (OS !== 'win32') return; // eating files out of the "Open" dialog is Windows-only
  const dialogs = platform.fileDialogs(process.pid);
  if (watched && !dialogs.some((d) => d.id === watched.id)) {
    // The dialog closed: the eaten files reappear (they're attached now).
    watched = null;
    world.clearCovers();
  }
  if (!watched) {
    for (const d of dialogs) {
      const b = buddyForWindow({ pid: d.pid, exe: d.exe, title: d.ownerTitle });
      if (b && d.open) { watched = { id: d.id, dialog: d, buddyId: b.id, state: 'armed' }; break; }
    }
  } else {
    watched.dialog = dialogs.find((d) => d.id === watched.id) || watched.dialog;
  }
  const armed = watched && watched.state === 'armed' && watched.dialog.open && watched.dialog.open.enabled;
  Atomics.store(keyFlags, 0, armed && platform.foregroundId() === watched.id ? 1 : 0);
}

const physToDip = (r) => screen.screenToDipRect(null, { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.w ?? r.width)), height: Math.max(1, Math.round(r.h ?? r.height)) });

/** Group the selected items: neighbouring rows (or icons on one line) get eaten in one go. */
function planGroups(scan, dialogHandle) {
  const list = scan.list;
  // Folders get opened, not attached, so the buddy leaves them alone.
  const items = [].concat(scan.items || [])
    .filter((it) => !/folder|ordner|dossier|carpeta|cartella|pasta|map$/i.test(it.type || ''))
    .map((it) => ({ ...it, x: Math.max(it.x, list.x), w: Math.min(it.x + it.w, list.x + list.w) - Math.max(it.x, list.x) }))
    .filter((it) => it.w > 4 && it.y + it.h > list.y && it.y < list.y + list.h);
  if (!items.length) return [];
  const rows = items.reduce((s, it) => s + it.w / it.h, 0) / items.length > 3;
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const groups = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    // Rows in a details view sit a few pixels apart (30 px rows, 35 px pitch), icons a bit more.
    const touching = g && (rows
      ? Math.abs(it.x - g.x) < 4 && it.y - (g.y + g.h) <= Math.max(6, it.h * 0.4)
      : Math.abs(it.y - g.y) < 6 && it.x - (g.x + g.w) <= Math.max(8, it.w * 0.3));
    if (touching) { g.w = Math.max(g.x + g.w, it.x + it.w) - g.x; g.h = Math.max(g.y + g.h, it.y + it.h) - g.y; g.count++; }
    else groups.push({ x: it.x, y: it.y, w: it.w, h: it.h, count: 1 });
  }
  // Paint "eaten" items with the list's own background colour: the most common of a few
  // samples from the list's empty margins, where the dialog itself is on top.
  const pts = [[list.x + list.w - 26, list.y + list.h - 8], [list.x + list.w / 2, list.y + list.h - 8], [list.x + 30, list.y + list.h - 8],
    [list.x + list.w - 26, list.y + list.h / 2], [list.x + list.w - 26, list.y + 12]];
  let samples = platform.windowPixels(dialogHandle, pts);
  if (!samples.length) samples = pts.map(([x, y]) => platform.pixel(x, y)).filter(Boolean);
  const color = samples.sort((a, b) => samples.filter((c) => c === b).length - samples.filter((c) => c === a).length)[0] || '#ffffff';
  return groups.map((g) => ({ ...physToDip(g), count: g.count, view: rows ? 'rows' : 'icons', color })).map((g) => ({ x: g.x, y: g.y, w: g.width, h: g.height, count: g.count, view: g.view, color: g.color }));
}

async function interceptOpen(how) {
  const w = watched;
  if (!w || w.state !== 'armed') return;
  w.state = 'eating';
  Atomics.store(keyFlags, 0, 0);
  let pressed = false;
  const press = () => {
    if (pressed) return;
    pressed = true;
    platform.pressOpen(w.dialog);
    // Still open (it was a folder, or a typed path): put the files back and watch the next Open.
    setTimeout(() => { if (watched === w) { w.state = 'armed'; world.clearCovers(); } }, 900);
  };
  const failsafe = setTimeout(press, 12000);
  try {
    const b = world.get(w.buddyId);
    const scan = b ? await uiaItems(w.id) : { ok: false };
    const groups = scan.ok ? planGroups(scan, w.dialog.handle) : [];
    if (!b || !groups.length) { clearTimeout(failsafe); press(); return; }
    world.eatDialog(b, groups, () => { clearTimeout(failsafe); setTimeout(press, 150); });
  } catch (err) {
    logError(err);
    clearTimeout(failsafe);
    press();
  }
  logEvent({ session_id: w.buddyId, hook_event_name: `dialog-open:${how}` });
}

// ---------------------------------------------------------------- the Overlord: usage limits
let usage = { at: 0, data: null, error: null, loading: false };

/** Claude Code's login: a file in its config folder, or (macOS) the "Claude Code-credentials" keychain item. */
async function readClaudeLogin() {
  try { return JSON.parse(fs.readFileSync(path.join(paths.claudeDir(), '.credentials.json'), 'utf8')); } catch { /* not a file here */ }
  if (OS === 'darwin') {
    const text = await new Promise((resolve) => execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 15000 }, (err, out) => resolve(err ? '' : out)));
    if (text.trim()) return JSON.parse(text.trim());
  }
  throw new Error('Not signed in to Claude Code');
}
async function fetchUsage() {
  if (usage.loading) return;
  usage.loading = true;
  try {
    // Same login and endpoint Claude Code's own /usage uses. The token only goes to api.anthropic.com.
    const o = (await readClaudeLogin()).claudeAiOauth || {};
    if (!o.accessToken) throw new Error('Not signed in to Claude Code');
    if (o.expiresAt && o.expiresAt < Date.now()) throw new Error('Login expired - open Claude Code to refresh it');
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${o.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Usage unavailable (${res.status})`);
    const j = await res.json();
    const win = (x) => (x && x.utilization !== undefined && x.utilization !== null ? { pct: Math.round(Number(x.utilization)), resets: typeof x.resets_at === 'number' ? new Date(x.resets_at * 1000).toISOString() : x.resets_at } : null);
    usage = { at: Date.now(), data: { session: win(j.five_hour), week: win(j.seven_day), opus: win(j.seven_day_opus), sonnet: win(j.seven_day_sonnet) }, error: null };
  } catch (err) {
    usage = { at: Date.now(), data: usage.data, error: String(err.message || err) };
  } finally {
    usage.loading = false;
  }
  try { checkLimit(); } catch (err) { logError(err, 'limit'); }
}

function usageEvery() {
  const u = usage.data;
  const near = u && [u.session, u.week].some((v) => v && v.pct >= 85);
  return store.limit ? 45e3 : near ? 60e3 : USAGE_EVERY_MS;
}

// ---------------------------------------------------------------- the usage limit
// A turn cut off by the limit (StopFailure, rate_limit) marks that session as
// interrupted. When the usage API confirms the limit (100%), every buddy is
// banished until it resets; then the Overlord reviews them and the interrupted
// ones get RESUME_PROMPT. Sessions that weren't mid-work get nothing.
const limitHits = new Map(); // session id -> when its turn was cut off

function onLimitHit(s) {
  limitHits.set(s.id, Date.now());
  if (store.limit && !store.limit.interrupted.includes(s.id)) { store.limit.interrupted.push(s.id); saveStore(); }
  usage.at = 0;
  fetchUsage(); // is it really the usage limit? (a short rate limit doesn't banish anyone)
}

function limitReached() {
  const u = usage.data;
  if (!u) return null;
  if (u.session && u.session.pct >= 100) return { kind: 'session', resetsAt: u.session.resets };
  if (u.week && u.week.pct >= 100) return { kind: 'week', resetsAt: u.week.resets };
  return null;
}

function checkLimit() {
  const hit = limitReached();
  const L = store.limit;
  if (hit && !L) {
    const recent = [...limitHits.entries()].filter(([, at]) => Date.now() - at < 15 * 60e3).map(([id]) => id);
    store.limit = { kind: hit.kind, resetsAt: hit.resetsAt, at: Date.now(), interrupted: recent };
    saveStore();
    world.banish({ kind: hit.kind, resetsAt: hit.resetsAt });
    logEvent({ session_id: 'limit', hook_event_name: `limit-reached:${hit.kind}` });
  } else if (hit && L) {
    if (hit.resetsAt !== L.resetsAt || hit.kind !== L.kind) { L.resetsAt = hit.resetsAt; L.kind = hit.kind; saveStore(); world.banish({ kind: hit.kind, resetsAt: hit.resetsAt }); }
  } else if (!hit && L && usage.data && !usage.error) {
    endLimit();
  }
}

/** It reset: bring them back up for review. */
function endLimit({ send = true } = {}) {
  const L = store.limit;
  if (!L) return;
  store.limit = null;
  saveStore();
  const interrupted = new Set(L.interrupted.filter((id) => world.has(id)));
  releaseSend = send;
  if (!world.unbanish(interrupted)) onReleased([]);
  logEvent({ session_id: 'limit', hook_event_name: `limit-reset:${interrupted.size}` });
}

let releaseSend = true;
const resumeQueue = [];
/** The review is over: hand the interrupted sessions their prompt, one at a time. */
function onReleased(results) {
  for (const r of results) {
    if (r.verdict !== 'resume') continue;
    const s = sessions.map.get(r.id);
    if (!s) continue;
    if (!releaseSend) { logEvent({ session_id: r.id, hook_event_name: 'resume-skipped (test)' }); continue; }
    s.pendingResume = true;
    resumeQueue.push(s);
  }
  pumpResumes();
}

let pumping = false;
async function pumpResumes() {
  if (pumping) return;
  pumping = true;
  try {
    while (resumeQueue.length) {
      // Wait for a pause in your typing so we don't type over you (at most 20 s).
      for (let i = 0; i < 40 && Date.now() - lastKeyAt < 2500; i++) await new Promise((r) => setTimeout(r, 500));
      const s = resumeQueue.shift();
      await sendResume(s);
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally { pumping = false; }
}

async function sendResume(s, { fromClick = false } = {}) {
  // From a click into a terminal it's only pasted: the terminal's active tab might not be Claude's, so you press Enter.
  const intoTerminal = fromClick && resolveApp(s).kind === 'terminal';
  const r = await deliver(s, { text: RESUME_PROMPT, submit: !intoTerminal, strict: !fromClick });
  logEvent({ session_id: s.id, hook_event_name: `resume-sent:${r.ok ? 'ok' : r.onClipboard ? 'clipboard' : 'failed'}` });
  const b = world.get(s.id);
  if (r.ok) {
    s.pendingResume = false;
    s.note = { text: intoTerminal ? 'Resume prompt pasted: press Enter to send it.' : 'Told to proceed and double-check after the limit reset.', until: Date.now() + 120e3 };
    if (b) b.push('cheer', 900, { sound: 'chirp' });
  } else if (r.onClipboard) {
    s.pendingResume = false;
    s.note = { text: `The resume prompt couldn't be typed in for you: ${r.why}.`, until: Date.now() + 3600e3 };
    if (b) b.push('alert', 1500, { bubble: '!', sound: 'alert' });
  } else {
    // Couldn't reach its prompt box: it waits with a ! until you click it.
    s.note = { text: `Has a resume prompt for you (${r.why}). Click it to send.`, until: Date.now() + 3600e3 };
    if (b) b.push('alert', 1500, { bubble: '!', sound: 'alert' });
  }
}

function overlordCard() {
  if (Date.now() - usage.at > 60e3) fetchUsage();
  const live = [...world.buddies.values()].filter((b) => !b.leaving && b.mode !== 'ride');
  const L = store.limit;
  return {
    usage: usage.data, error: usage.error,
    counts: { out: live.length, home: Object.keys(store.registry).filter((id) => !world.has(id)).length, sleeping: live.filter((b) => b.sleeping).length },
    settings: {
      hidden: !!store.hidden, sound: !store.muted, typing: !!store.typing, auto: !!store.autoSummon, login: !!store.startWithWindows,
      tower: !!world.tower.open, internal: store.sizes.internal, external: store.sizes.external, mac: OS === 'darwin',
    },
    limit: L ? { kind: L.kind, resetsAt: L.resetsAt, interrupted: L.interrupted.length } : null,
  };
}

function setHidden(on) {
  store.hidden = on;
  saveStore();
  for (const o of overlays.values()) on ? o.win.hide() : o.win.showInactive();
}

function setTyping(on) {
  store.typing = on;
  saveStore();
  if (on) startKeyWatcher(); else { keyWatcher?.stop(); keyWatcher = null; }
}

function toggleTower(open) {
  world.towerToggle(open);
  store.towerOpen = world.tower.open;
  saveStore();
}

/** Buttons on the Overlord's hover panel. */
ipcMain.on('ov-action', (e, { act, value } = {}) => {
  world.ovKeep(3000);
  const live = [...world.buddies.values()].filter((b) => !b.leaving && !['ride', 'enter', 'hell', 'doom'].includes(b.mode));
  if (act === 'gather') { if (live.length) startPlacing(live.map((b) => b.id)); }
  else if (act === 'wake') { for (const b of live) if (b.sleeping) world.wake(b); }
  else if (act === 'demo') runDemo((ev) => sessions.handle(ev));
  else if (act === 'gallery') openGallery();
  else if (act === 'tower') toggleTower();
  else if (act === 'hidden') setHidden(!store.hidden);
  else if (act === 'sound') { store.muted = !store.muted; saveStore(); }
  else if (act === 'typing') setTyping(!store.typing);
  else if (act === 'auto') { store.autoSummon = !store.autoSummon; saveStore(); }
  else if (act === 'login') { store.startWithWindows = !store.startWithWindows; setLoginItem(store.startWithWindows); saveStore(); }
  else if (act === 'size') {
    const [which, d] = String(value || '').split(':');
    if (store.sizes[which] !== undefined) setSize(which, store.sizes[which] + (Number(d) || 0));
  } else if (act === 'quit') quitApp();
  refreshTray();
});

/** Clicks on the skyscraper: the collapse button, a floor's light switch, or its window (decorate the room). */
ipcMain.on('tower', (e, { act, id } = {}) => {
  if (act === 'toggle') return toggleTower();
  if (act === 'switch' && id) {
    const b = world.get(id);
    if (b && world.homeBound(b)) { b.task = null; if (store.registry[id]) { store.registry[id].active = true; saveStore(); } } // changed its mind
    else if (b && b.mode !== 'enter') sendHome(id);
    else if (!b && store.registry[id]) turnOn(id);
    return;
  }
  if (act === 'room' && id && store.registry[id]) openWorkshop(id, 'room');
});

// ---------------------------------------------------------------- menus (buddy right-click)
function startPlacing(ids) {
  placing = { ids, until: Date.now() + 20000 };
}

function buddyItems(b, point) {
  const s = b.session, id = b.id;
  const save = () => remember(s, b);
  return [
    { label: 'Customize…', click: () => openWorkshop(id) },
    { label: 'Decorate its room…', click: () => openWorkshop(id, 'room') },
    { label: 'Wake up', enabled: !!b.sleeping, click: () => world.wake(b) },
    { label: 'Come here (place a marker)', click: () => startPlacing([id]) },
    { label: 'Stay put', type: 'checkbox', checked: b.pinned, click: (i) => { world.setPinned(b, i.checked); save(); } },
    { label: 'Show helpers (sub-agents)', type: 'checkbox', checked: b.look.helpers !== false, click: (i) => { world.setLook(id, { ...b.look, helpers: i.checked }); save(); } },
    { type: 'separator' },
    { label: 'Give a snack', click: () => world.giveSnack(b) },
    { label: 'Play fetch', click: () => world.playFetch(b, point) },
    { type: 'separator' },
    { label: 'Open project folder', enabled: !!s.cwd, click: () => shell.openPath(s.cwd) },
    { label: 'Mute this buddy', type: 'checkbox', checked: b.muted, click: (i) => { b.muted = i.checked; save(); } },
    { label: 'Hide for…', submenu: [5, 10, 30, 60].map((m) => ({ label: `${m} minutes`, click: () => world.hideFor(b, m) })) },
    { label: 'Send home', click: () => sendHome(id) },
  ];
}

function showBuddyMenu(id, overlay) {
  const b = world.get(id);
  if (!b) return;
  const point = screen.getCursorScreenPoint();
  const menu = Menu.buildFromTemplate([{ label: `${b.session.displayName}  ·  ${b.session.card().status}`, enabled: false }, { type: 'separator' }, ...buddyItems(b, point)]);
  menu.popup(overlay && !overlay.win.isDestroyed() ? { window: overlay.win } : {});
}

function settingsItems() {
  return [
    { label: 'Hide buddies', type: 'checkbox', checked: store.hidden, click: (i) => setHidden(i.checked) },
    { label: 'Show the skyscraper', type: 'checkbox', checked: !!world.tower.open, click: (i) => toggleTower(i.checked) },
    { label: 'Sound effects', type: 'checkbox', checked: !store.muted, click: (i) => { store.muted = !i.checked; saveStore(); } },
    { label: OS === 'darwin' ? 'Type along when I type (asks for Input Monitoring)' : 'Type along when I type', type: 'checkbox', checked: !!store.typing, click: (i) => setTyping(i.checked) },
    ...[['internal', 'Size on the laptop screen'], ['external', 'Size on other monitors']].map(([which, label]) => ({
      label: `${label}: ${store.sizes[which]}`,
      submenu: [1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ label: String(n), type: 'radio', checked: store.sizes[which] === n, click: () => setSize(which, n) })),
    })),
    { label: 'Buddy for every session (no /buddy needed)', type: 'checkbox', checked: store.autoSummon, click: (i) => { store.autoSummon = i.checked; saveStore(); } },
    { label: 'Start at login', type: 'checkbox', checked: !!store.startWithWindows, click: (i) => { store.startWithWindows = i.checked; setLoginItem(i.checked); saveStore(); } },
  ];
}

// ---------------------------------------------------------------- the Buddy Workshop (customizer)
// A Workshop window is kept loaded in the background, so opening one is instant (the first open
// used to load for a while, and could end up under the buddies' overlay).
let spareWorkshop = null;
function makeWorkshopWindow() {
  const win = new BrowserWindow({
    width: 980, height: 680, frame: false, resizable: false, backgroundColor: '#15121c', show: false,
    title: 'Buddy Workshop', autoHideMenuBar: true, skipTaskbar: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver', 1); // above the overlays, which sit at 'screen-saver' too
  win.loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.loadFile(path.join(__dirname, 'customizer.html'));
  return win;
}
function prepareSpareWorkshop() {
  if (!spareWorkshop || spareWorkshop.isDestroyed()) spareWorkshop = makeWorkshopWindow();
}

/** Open the Buddy Workshop for a buddy (out and about, or at home in the skyscraper). */
function openWorkshop(id, tab) {
  // Called from menus: wait until the menu has closed before opening a window.
  setTimeout(() => openWorkshopNow(id, tab).catch((err) => logError(err, 'workshop')), 60);
}
async function openWorkshopNow(id, tab) {
  const b = world.get(id);
  const saved = store.registry[id];
  if (!b && !saved) return;
  const existing = workshops.get(id);
  if (existing && !existing.isDestroyed()) { if (tab) existing.webContents.send('init-tab', tab); existing.show(); existing.moveTop(); existing.focus(); return; }
  const look = b ? b.look : fullLook(saved.look || {});
  const s = b ? b.session : null;
  prepareSpareWorkshop();
  const win = spareWorkshop;
  spareWorkshop = null;
  workshops.set(id, win);
  win.workshop = { id, original: JSON.parse(JSON.stringify(look)), saved: false };
  win.on('closed', () => {
    // Closing without equipping puts the old look back.
    if (!win.workshop.saved && world.get(id)) world.setLook(id, win.workshop.original);
    workshops.delete(id);
  });
  for (const o of overlays.values()) { o.caps.hover = false; applyCapture(o); } // nothing of ours may sit on top of it
  await win.loaded;
  win.webContents.send('init', {
    poses, id, look, name: s ? s.displayName : saved.nickname || saved.name || 'buddy', nickname: (s ? s.nickname : saved.nickname) || '', project: s ? s.name : saved.name,
    sizes: store.sizes, isDefault: !!store.defaultLook && JSON.stringify({ ...store.defaultLook, room: undefined }) === JSON.stringify({ ...look, room: undefined }),
    tab: tab || 'hat', home: !b,
  });
  win.center();
  win.show();
  win.moveTop();
  win.focus();
  setTimeout(prepareSpareWorkshop, 1500); // ready for the next one
}

const workshopOf = (sender) => [...workshops.values()].find((w) => !w.isDestroyed() && w.webContents === sender);
ipcMain.on('look-preview', (e, look) => { const w = workshopOf(e.sender); if (w) world.setLook(w.workshop.id, look); });
ipcMain.on('look-save', (e, { look, nickname, asDefault }) => {
  const w = workshopOf(e.sender);
  if (!w) return;
  const b = world.get(w.workshop.id);
  if (b) {
    world.setLook(b.id, look);
    b.session.nickname = String(nickname || '').slice(0, 18);
    if (asDefault) store.defaultLook = { ...b.look, room: undefined };
    remember(b.session, b);
    b.push('cheer', 800, { sound: 'done' });
  } else if (store.registry[w.workshop.id]) {
    // At home in the skyscraper: just save the new look (and room).
    const e = store.registry[w.workshop.id];
    e.look = fullLook(look);
    e.nickname = String(nickname || '').slice(0, 18);
    if (asDefault) store.defaultLook = { ...e.look, room: undefined };
    saveStore();
  }
  updateResidents();
  w.workshop.saved = true;
  w.close();
});
ipcMain.on('buddy-forget', (e) => {
  // "Move out" in the Workshop: the buddy and its floor are gone for good.
  const w = workshopOf(e.sender);
  if (!w) return;
  const id = w.workshop.id;
  w.workshop.saved = true;
  w.close();
  if (world.get(id)) world.remove(id);
  delete store.registry[id];
  saveStore();
  updateResidents();
  refreshTray();
});
ipcMain.on('win-close', (e) => { const w = workshopOf(e.sender) || BrowserWindow.fromWebContents(e.sender); w?.close(); });

// ---------------------------------------------------------------- overlays
function createOverlay(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false, show: false,
    backgroundColor: '#00000000', alwaysOnTop: true, title: 'Claude Buddy overlay',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (OS === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'overlay.html'));
  // Files dropped anywhere but on a buddy must never navigate the overlay away.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const o = { win, display, ready: false, caps: { hover: false, drop: false }, captureOn: false };
  win.once('ready-to-show', () => { win.setBounds(b); if (!store.hidden) win.showInactive(); });
  win.webContents.on('did-finish-load', () => {
    o.ready = true;
    win.webContents.send('init', { origin: { x: b.x, y: b.y }, poses });
  });
  overlays.set(display.id, o);
}

/** An overlay takes the mouse only while something of ours is under it (or you're placing a marker). */
function applyCapture(o) {
  if (o.win.isDestroyed()) return;
  const on = !!(o.caps.hover || o.caps.drop || placing);
  if (on !== o.captureOn) { o.captureOn = on; o.win.setIgnoreMouseEvents(!on, { forward: true }); }
}

function rebuildOverlays() {
  const displays = screen.getAllDisplays();
  for (const [id, o] of overlays) {
    const d = displays.find((x) => x.id === id);
    if (!d || JSON.stringify(d.bounds) !== JSON.stringify(o.display.bounds)) { o.win.destroy(); overlays.delete(id); }
    else o.display = d;
  }
  for (const d of displays) if (!overlays.has(d.id)) createOverlay(d);
  const owner = [...overlays.values()][0];
  if (owner) platform.setClipboardOwner(owner.win.getNativeWindowHandle()); // Windows: what we paste needs an owner window
  const primary = screen.getPrimaryDisplay().id;
  world.setDisplays(displays.map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, internal: !!d.internal, primary: d.id === primary })));
}

function overlayFor(sender) {
  for (const o of overlays.values()) if (o.win.webContents === sender) return o;
  return null;
}

ipcMain.on('hover', (e, id) => {
  const o = overlayFor(e.sender);
  if (o) { o.caps.hover = !!id; applyCapture(o); }
  world.ov.hovered = id === 'overlord';
  if (id === 'overlord') world.ovKeep(2500);
  world.setHover(id && id !== 'overlord' && id !== 'dialog' && !String(id).startsWith('tower') ? id : null);
});
ipcMain.on('grab', (e, id) => world.grab(id));
ipcMain.on('release', () => world.release());
ipcMain.on('context', (e, id) => (id === 'overlord' ? null : showBuddyMenu(id, overlayFor(e.sender))));
ipcMain.on('dialog-open-click', () => interceptOpen('click'));
ipcMain.on('drag-over', (e, id) => { const b = world.get(id); if (b) b.dragHint = Date.now(); });
ipcMain.on('files-dropped', (e, { id, paths }) => {
  const b = world.get(id);
  if (!b || !Array.isArray(paths) || !paths.length) return;
  feedFiles(b, paths.filter((p) => typeof p === 'string' && p));
});

/** The buddy eats the files and they land in its session's prompt box right away. */
function feedFiles(b, paths) {
  const s = b.session;
  world.ingest(b, paths.map((p) => path.basename(p)));
  logEvent({ session_id: b.id, hook_event_name: 'files-dropped', tool_name: String(paths.length) });
  setTimeout(async () => {
    const r = await deliver(s, { files: paths });
    logEvent({ session_id: b.id, hook_event_name: `files-delivered:${r.ok ? 'ok' : 'failed'}` });
    if (!r.ok) {
      s.note = { text: `Couldn't put the file${paths.length > 1 ? 's' : ''} in the prompt box: ${r.why}.`, until: Date.now() + 60e3 };
      const bb = world.get(b.id);
      if (bb) { bb.queue = bb.queue.filter((q) => q.then); bb.push('error1', 1600, { sound: 'error' }); }
    }
  }, 500);
}
ipcMain.on('place', (e, point) => {
  if (!placing) return;
  const ids = placing.ids;
  placing = null;
  ids.forEach((id, i) => { const b = world.get(id); if (b) world.comeHere(b, { x: point.x + i * 26 * (i % 2 ? -1 : 1), y: point.y }); });
  for (const o of overlays.values()) applyCapture(o);
});
ipcMain.on('place-cancel', () => { placing = null; for (const o of overlays.values()) applyCapture(o); });

// ---------------------------------------------------------------- loops
let lastCursor = { x: 0, y: 0, t: Date.now() };
let cursorSpeed = 0;
let idleFrames = 0;

function tick() {
  const now = Date.now();
  const dt = Math.min(0.05, (now - (tick.last || now)) / 1000) || TICK_MS / 1000;
  tick.last = now;
  const c = screen.getCursorScreenPoint();
  const ct = (now - lastCursor.t) / 1000;
  if (ct > 0) cursorSpeed = cursorSpeed * 0.6 + (Math.hypot(c.x - lastCursor.x, c.y - lastCursor.y) / ct) * 0.4;
  lastCursor = { x: c.x, y: c.y, t: now };
  if (placing && now > placing.until) placing = null;

  const anyHeld = [...world.buddies.values()].some((b) => b.mode === 'held');
  const down = platform.mouseDown();
  try { world.tick(now, dt, { x: c.x, y: c.y, speed: cursorSpeed }, anyHeld ? down : null); } catch (err) { logError(err, 'world'); }

  // Dragging files from Explorer: make the buddy under the pointer a drop target.
  let dropOver = null;
  if (down && !anyHeld) {
    for (const b of world.buddies.values()) {
      if (b.leaving || ['birth', 'script', 'hell', 'doom', 'ride', 'enter'].includes(b.mode) || b.hide) continue;
      const m = world.centre(b), r = 10 * b.scale + 10, h = 6 * b.scale + 10;
      if (Math.abs(c.x - m.x) < r && Math.abs(c.y - m.y) < h) { dropOver = overlayAt(c.x, c.y); break; }
    }
  }
  for (const o of overlays.values()) { o.caps.drop = o === dropOver; applyCapture(o); }

  const snap = world.snapshot(now);
  if (snap.overlord && snap.overlord.hovered) snap.overlord.card = overlordCard();
  const dialogHot = watched && watched.state === 'armed' && watched.dialog.open ? physToDip({ ...watched.dialog.open.rect }) : null;
  const busy = snap.buddies.length || snap.items.length || snap.overlord || snap.covers.length || snap.doom || placing || snap.tower || snap.puke;
  const tower = snap.tower && !world.hiddenDisplays.has(snap.tower.d) ? snap.tower : null;
  if (!busy) { if (idleFrames++ > 2) return; } else idleFrames = 0;
  for (const o of overlays.values()) {
    if (!o.ready || o.win.isDestroyed()) continue;
    const b = o.display.bounds, m = 400;
    const near = (x, y) => x > b.x - m && x < b.x + b.width + m && y > b.y - m && y < b.y + b.height + m;
    const mine = snap.buddies.filter((s) => near(s.x, s.y) || (s.birth && near(s.birth.x, s.birth.y)) || (s.marker && near(s.marker.x, s.marker.y)) || s.minis.some((mi) => near(mi.x, mi.y)));
    o.win.webContents.send('frame', {
      buddies: mine, items: snap.items.filter((it) => near(it.x, it.y)), overlord: snap.overlord, covers: snap.covers, doom: snap.doom, tower,
      puke: snap.puke && { drops: snap.puke.drops.filter((d) => near(d.x, d.y)), puddles: snap.puke.puddles.filter((q) => near(q.x, q.y)) },
      cursor: OS === 'linux' ? { x: c.x - b.x, y: c.y - b.y } : null,
      placing: !!placing, anyHeld, dialogHot: dialogHot ? { x: dialogHot.x, y: dialogHot.y, w: dialogHot.width, h: dialogHot.height } : null,
    });
  }
}

/** Window rectangles from the OS in Electron's coordinates (DIPs). */
function toDip(r) {
  if (platform.coords === 'dip') return r;
  if (OS === 'win32') return screen.screenToDipRect(null, r);
  const k = screen.getPrimaryDisplay().scaleFactor || 1; // Linux scales every screen the same
  return { x: r.x / k, y: r.y / k, width: r.width / k, height: r.height / k };
}

function scanWindows() {
  if (!platform.available) return;
  const list = platform.listWindows(process.pid);
  const wins = list.map((w) => ({ id: w.id, title: w.title, exe: w.exe, maximized: w.maximized, rect: toDip(w.rect) }));
  world.setWindows(wins);
  watchDialogs();

  // Hide buddies on a monitor that has a fullscreen app (games, videos, presentations).
  const fg = platform.foregroundId();
  const fgWin = wins.find((w) => w.id === fg);
  world.hiddenDisplays.clear();
  if (fgWin) {
    for (const d of world.displays) {
      const r = fgWin.rect, db = d.bounds;
      if (Math.abs(r.x - db.x) <= 2 && Math.abs(r.y - db.y) <= 2 && Math.abs(r.width - db.width) <= 2 && Math.abs(r.height - db.height) <= 2) world.hiddenDisplays.add(d.id);
    }
  }
}

// ---------------------------------------------------------------- local server (hooks talk to this)
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}

/** Buddies saved by 1.x only knew a label. */
function whereFromSource(src = '') {
  if (src === 'Claude app') return 'desktop';
  if (/terminal$/i.test(src) && src !== 'Terminal' && src !== 'Windows Terminal') return 'ide-terminal';
  if (/antigravity|IDE|code|cursor|windsurf/i.test(src)) return 'ide';
  return 'terminal';
}

/** Find the session's app now, while the hook that sent this (and its shell) still exist to walk up from. */
function noteClient(ev) {
  if (!ev.client || !ev.client.pid) return;
  const s = sessions.map.get(ev.session_id);
  if (!s || (s.app && s.app.pid && Date.now() - s.app.at < 120e3)) return;
  try {
    resolveApp(s, { fresh: true });
    const saved = store.registry[s.id];
    if (saved && appRecord(s)) { saved.app = appRecord(s); saved.client = s.client; saved.where = s.where; saved.source = s.source; saveStore(); }
  } catch (err) { logError(err, 'resolve app'); }
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return reply(200, { ok: true, app: 'claude-buddy', buddies: world.buddies.size });
      if (req.method === 'POST' && url.pathname === '/event') {
        const ev = await readJson(req);
        logEvent(ev);
        sessions.handle(ev);
        noteClient(ev);
        return reply(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/permission') {
        // Hold the hook until you decide on the buddy; answer at once if this session has no buddy.
        const ev = await readJson(req);
        logEvent(ev);
        sessions.handle(ev);
        noteClient(ev);
        const s = sessions.map.get(ev.session_id);
        if (!s || !world.has(s.id) || s.attention !== 'permission') return reply(200, { decision: null });
        return holdPermission(s, res);
      }
      if (req.method === 'GET' && url.pathname === '/debug/state') {
        return reply(200, {
          displays: world.displays, platforms: world.platforms, overlord: world.ovSnapshot(Date.now()), watched: watched && { id: watched.id, state: watched.state, buddy: watched.buddyId, open: watched.dialog.open && watched.dialog.open.rect },
          limit: store.limit, doom: world.doomSnapshot(Date.now()), tower: world.towerSnapshot(Date.now()),
          buddies: [...world.buddies.values()].map((b) => ({ id: b.id, name: b.session.displayName, source: b.session.source, where: b.session.where,
            app: (() => { try { const a = resolveApp(b.session); return { kind: a.kind, name: a.name, exe: a.exe, pid: a.pid, scheme: a.scheme }; } catch { return null; } })(), x: b.x, y: b.y, mode: b.mode, anim: b.anim, look: b.look, pinned: b.pinned, state: b.session.state, kind: b.session.kind, attention: b.session.attention, pendingResume: !!b.session.pendingResume, helpers: world.minis.filter((m) => m.parent === b).map((m) => ({ mode: m.mode, x: Math.round(m.x), y: Math.round(m.y), anim: m.anim, s: m.scale })), card: b.session.card() })),
          items: world.items.map((it) => ({ kind: it.kind, x: Math.round(it.x), y: Math.round(it.y), rest: !!it.rest, carried: !!it.carrier })),
          registry: Object.fromEntries(Object.entries(store.registry).map(([id, e]) => [id, { name: e.nickname || e.name, active: e.active }])),
          usage: { at: usage.at, data: usage.data, error: usage.error },
        });
      }
      if (req.method === 'GET' && url.pathname === '/debug/events') return reply(200, events.slice(-200));
      if (req.method === 'POST' && url.pathname === '/debug/forget') {
        // Remove a buddy completely (tests): ?id=<session>
        const id = url.searchParams.get('id');
        world.remove(id, { goodbye: false });
        delete store.registry[id];
        saveStore();
        return reply(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/debug/decide') return reply(200, { ok: decide(url.searchParams.get('id'), url.searchParams.get('decision')) });
      if (req.method === 'POST' && url.pathname === '/debug/demo') { runDemo((ev) => sessions.handle(ev)); return reply(200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/debug/capture') {
        const files = await Promise.all([...overlays.values()].map(async (o, i) => {
          const img = await o.win.webContents.capturePage();
          const file = path.join(app.getPath('temp'), `claude-buddy-capture-${i}.png`);
          fs.writeFileSync(file, img.toPNG());
          return file;
        }));
        const shots = await Promise.all([...workshops.values()].filter((w) => !w.isDestroyed()).map(async (w, i) => {
          const file = path.join(app.getPath('temp'), `claude-buddy-workshop-${i}.png`);
          fs.writeFileSync(file, (await w.webContents.capturePage()).toPNG());
          return file;
        }));
        return reply(200, { files: files.concat(shots) });
      }
      if (req.method === 'POST' && url.pathname === '/debug/hover') {
        // Show a hover card without moving the mouse (for screenshots): ?id=<session>|overlord, ?id= closes it.
        const id = url.searchParams.has('id') ? url.searchParams.get('id') || null : [...world.buddies.keys()][0] || null;
        world.ov.hovered = id === 'overlord';
        world.setHover(id === 'overlord' ? null : id);
        for (const o of overlays.values()) if (o.ready) o.win.webContents.send('debugHover', id);
        return reply(200, { id });
      }
      if (req.method === 'POST' && url.pathname === '/debug/act') {
        // Trigger behaviours for testing: do=climb|cross|type|erase|enter|throw|come|snack|fetch|hide|workshop|drop|detach|usage.
        const b = world.get(url.searchParams.get('id')) || [...world.buddies.values()][0];
        const act = url.searchParams.get('do');
        if (act === 'detach') { world.ovDetach(); return reply(200, { ok: true }); }
        if (act === 'tower') { toggleTower(url.searchParams.has('open') ? url.searchParams.get('open') === '1' : undefined); return reply(200, { open: world.tower.open }); }
        if (act === 'on') { turnOn(url.searchParams.get('id')); return reply(200, { ok: true }); }
        if (act === 'usage') { await fetchUsage(); return reply(200, { at: usage.at, ok: !!usage.data, error: usage.error }); }
        if (act === 'limit') {
          // Pretend the session limit was hit; it "resets" after ?secs. Marks ?id as interrupted. No prompt is really sent.
          const secs = Number(url.searchParams.get('secs')) || 30;
          const ids = url.searchParams.get('id') ? [url.searchParams.get('id')] : [];
          store.limit = { kind: 'session', resetsAt: new Date(Date.now() + secs * 1000).toISOString(), at: Date.now(), interrupted: ids, test: true };
          world.banish({ kind: 'session', resetsAt: store.limit.resetsAt });
          setTimeout(() => { if (store.limit && store.limit.test) endLimit({ send: false }); }, secs * 1000);
          return reply(200, { ok: true });
        }
        if (!b) return reply(404, { error: 'no buddy' });
        const point = { x: Number(url.searchParams.get('x')) || screen.getCursorScreenPoint().x, y: Number(url.searchParams.get('y')) || screen.getCursorScreenPoint().y };
        if (act === 'climb') world.planClimb(b);
        else if (act === 'cross') world.planCross(b);
        else if (['type', 'erase', 'enter'].includes(act)) world.onKey(b.id, act);
        else if (act === 'come') world.comeHere(b, point);
        else if (act === 'snack') world.giveSnack(b);
        else if (act === 'fetch') world.playFetch(b, point);
        else if (act === 'hide') world.hideFor(b, Number(url.searchParams.get('min')) || 1);
        else if (act === 'workshop') openWorkshop(b.id, url.searchParams.get('tab') || undefined);
        else if (act === 'home') sendHome(b.id);
        else if (act === 'wake') world.wake(b);
        else if (act === 'shake') { b.queasy = Number(url.searchParams.get('n')) || 2; world.queasyShow(b); }
        else if (act === 'meet') {
          const o = [...world.buddies.values()].find((x) => x !== b && x.mode === 'auto' && !x.isMini);
          if (!o) return reply(404, { error: 'needs a second buddy' });
          world.greet(b, o, Date.now());
        }
        else if (act === 'place') startPlacing([b.id]);
        else if (act === 'watchdialog') {
          // Hand an open file dialog (any app) to this buddy, as if its session had opened it.
          const d = platform.fileDialogs(process.pid).find((x) => x.open);
          if (!d) return reply(404, { error: 'no file dialog' });
          watched = { id: d.id, dialog: d, buddyId: b.id, state: 'armed' };
        } else if (act === 'dialogopen') { await interceptOpen('debug'); return reply(200, { ok: !!watched, state: watched && watched.state }); }
        else if (act === 'drop') { const names = (url.searchParams.get('files') || 'notes.txt,photo.png,archive.zip').split(','); world.ingest(b, names); } // animation only
        else if (act === 'context') { b.session.ctxAlertAt = Date.now(); b.session.context = { used: 182000, size: 200000, pct: 91 }; b.push('startled', 900, { bubble: 'ctx', sound: 'alert' }); }
        else if (act === 'throw') {
          if (b.mode === 'wall' || b.mode === 'ceil') world.uprightFrom(b);
          world.drop(b, 'throw');
          b.y -= 5;
          b.vx = Number(url.searchParams.get('vx')) || 0; b.vy = Number(url.searchParams.get('vy')) || 0;
        }
        return reply(200, { id: b.id, mode: b.mode, anim: b.anim });
      }
      if (req.method === 'POST' && url.pathname === '/quit') {
        reply(200, { ok: true });
        if (url.searchParams.get('home') === '1') quitStarted = true; // "claude-buddy stop": a real quit
        setTimeout(() => app.quit(), 100);
        return;
      }
      return reply(404, { error: 'not found' });
    } catch (err) {
      return reply(400, { error: String(err) });
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { console.error(`[claude-buddy] port ${PORT} is busy; is another copy running?`); app.quit(); }
  });
  server.listen(PORT, '127.0.0.1');
}

// ---------------------------------------------------------------- tray
function trayIcon() {
  const rows = [
    '                ', '                ', '                ',
    '  ############  ', '  ############  ', '  ##e######e##  ', '  ##e######e##  ', '  ############  ',
    '################', '################', '  ############  ', '  #  #    #  #  ', '  #  #    #  #  ',
    '                ', '                ', '                ',
  ];
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = 16 * scale;
    const buf = Buffer.alloc(size * size * 4);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === ' ') return;
      const [r, g, b] = ch === 'e' ? [0x2f, 0x2f, 0x38] : [0xd9, 0x77, 0x57];
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = ((y * scale + dy) * size + (x * scale + dx)) * 4;
        buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255; // BGRA
      }
    }));
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: buf });
  }
  return img;
}

function setLoginItem(on) {
  setAutostart(on, { electron: process.execPath, appDir: app.getAppPath() });
}

function openGallery() {
  if (gallery && !gallery.isDestroyed()) return gallery.focus();
  gallery = new BrowserWindow({
    width: 1100, height: 800, title: 'Claude Buddy - animation gallery', backgroundColor: '#1f1e1d', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  gallery.loadFile(path.join(__dirname, 'gallery.html'));
  gallery.webContents.on('did-finish-load', () => gallery.webContents.send('init', { poses, hats: Clawd.HAT_ORDER }));
}

let trayKey = '';
function refreshTray() {
  if (!tray) return;
  const live = [...world.buddies.values()].filter((b) => !b.leaving);
  const key = JSON.stringify([live.map((b) => [b.id, b.session.displayName, b.session.card().status]), store]);
  if (key === trayKey) return;
  trayKey = key;
  const menu = Menu.buildFromTemplate([
    { label: 'Claude Buddy (hover the Overlord in the top-left corner for more)', enabled: false },
    ...(live.length ? live.map((b) => ({ label: `${b.session.displayName}  ·  ${b.session.card().status}`, submenu: buddyItems(b, screen.getCursorScreenPoint()) }))
      : [{ label: 'No buddies yet. Type /buddy in a Claude Code session.', enabled: false }]),
    { type: 'separator' },
    { label: 'Summon a demo buddy', click: () => runDemo((ev) => sessions.handle(ev)) },
    { label: 'Animation gallery…', click: openGallery },
    { type: 'separator' },
    ...settingsItems(),
    { type: 'separator' },
    { label: 'Quit', click: quitApp },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Claude Buddy (${live.length} ${live.length === 1 ? 'buddy' : 'buddies'})`);
}

// ---------------------------------------------------------------- startup
app.whenReady().then(() => {
  loadStore();
  world.sizes = store.sizes;
  world.tower.open = !!store.towerOpen;
  world.tower.h = world.tower.open ? 1 : 0;
  updateResidents();
  poses = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'poses.json'), 'utf8'));
  Clawd.loadPoses(poses);

  // Start at login by default the first time the installed copy runs (not
  // from a dev checkout); afterwards the settings checkbox decides.
  const installed = path.resolve(app.getAppPath()).toLowerCase() === path.resolve(paths.installDir()).toLowerCase();
  if (OS === 'darwin') app.dock?.hide(); // a desktop pet, not a dock app
  if (store.typing === undefined) store.typing = OS !== 'darwin'; // macOS asks for Input Monitoring, so it's opt-in there
  if (installed && !store.loginDefaultApplied) {
    store.startWithWindows = true;
    store.loginDefaultApplied = true;
    saveStore();
  }
  if (installed) setLoginItem(!!store.startWithWindows);

  rebuildOverlays();
  screen.on('display-added', rebuildOverlays);
  screen.on('display-removed', rebuildOverlays);
  screen.on('display-metrics-changed', rebuildOverlays);

  // The Overlord appears with the first buddy ever and lives in the top edge from then on.
  if (store.overlordBorn) {
    const o = world.ov, h = world.ovHome();
    Object.assign(o, { present: true, mode: 'fused', x: h.x, y: h.y - 14 * world.ovScale(), nextPeek: Date.now() + 3000 });
  } else if (Object.values(store.registry).some((e) => e.active)) {
    setTimeout(() => world.ovAppear(), 1500); // buddies from an older version: the Overlord shows up now
  }

  tray = new Tray(trayIcon());
  tray.on('click', () => tray.popUpContextMenu());
  refreshTray();

  startServer();
  scanWindows();
  restoreBuddies();
  startKeyWatcher();
  setTimeout(() => { if (!quitting) prepareSpareWorkshop(); }, 5000); // the first Customize opens instantly
  if (store.limit) {
    if (store.limit.test) store.limit = null;
    else world.banish({ kind: store.limit.kind, resetsAt: store.limit.resetsAt, quiet: true });
  }
  fetchUsage();
  const guarded = (fn) => () => { if (!quitting) try { fn(); } catch (err) { logError(err); } };
  timers.push(
    setInterval(guarded(refreshTray), 3000), setInterval(guarded(scanWindows), WINDOW_SCAN_MS),
    setInterval(guarded(tick), TICK_MS),
    setInterval(guarded(() => {
      if (Date.now() - usage.at > usageEvery()) fetchUsage();
      // If the API can't be reached, the limit still ends when it said it would.
      const L = store.limit;
      if (L && !L.test && L.resetsAt && Date.now() > Date.parse(L.resetsAt) + 90e3 && usage.error) endLimit();
    }), 15e3),
  );
});

app.on('second-instance', () => tray?.popUpContextMenu());
app.on('window-all-closed', (e) => e.preventDefault());
