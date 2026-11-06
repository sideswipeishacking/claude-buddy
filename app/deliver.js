// Which app each session runs in, and handing things to it.
//
// A session's hook reports the pid it ran from; walking up the process tree
// reaches the app that owns a window: the Claude app, a VS Code-family editor
// (VS Code, Cursor, Windsurf, Antigravity, VSCodium, …), a JetBrains IDE, or a
// terminal. That is used to bring the session to the front when you click its
// buddy, to know which buddy you're typing for, and to put dropped files (or
// the usage-limit resume prompt) straight into the session's prompt box:
//
//   Claude Code extension: <scheme>://anthropic.claude-code/open?session=<id>
//     (the scheme comes from the editor's product.json: vscode, cursor, windsurf, …)
//   Claude app:            claude://code/continue?session=local_<id>
//     (the app's own session record maps the CLI session id to its local id)
//   terminal:              its window
//
// then paste (Windows: a real file list plus @-mentions; macOS/Linux: @-mentions,
// which Claude Code turns into attachments) and, for a prompt, Enter. The
// clipboard is put back afterwards. Nothing is pasted unless the right app is in
// front, and Enter is only pressed after checking again. A Claude Code session
// running in an IDE's own terminal panel can't be targeted (the editor would get
// the paste), so there the text is left on the clipboard for you.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { shell } = require('electron');
const P = require('./platform');
const { launchDetached } = require('../lib/launch');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- what is this app?
const products = new Map();
/** A VS Code-family editor's product.json, found next to its executable. */
function editorProduct(exePath) {
  if (!exePath) return null;
  if (products.has(exePath)) return products.get(exePath);
  let found = null;
  let dir = path.dirname(exePath);
  for (let i = 0; i < 6 && !found; i++) {
    for (const rel of [['resources', 'app', 'product.json'], ['Resources', 'app', 'product.json']]) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, ...rel), 'utf8'));
        if (p.urlProtocol || p.nameShort) { found = { name: p.nameShort === 'Code' ? 'VS Code' : p.nameShort || p.nameLong, scheme: p.urlProtocol || null }; break; }
      } catch { /* not here */ }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  products.set(exePath, found);
  return found;
}

const JETBRAINS = { idea: 'IntelliJ IDEA', pycharm: 'PyCharm', webstorm: 'WebStorm', phpstorm: 'PhpStorm', goland: 'GoLand', rider: 'Rider', clion: 'CLion', rubymine: 'RubyMine', datagrip: 'DataGrip', studio: 'Android Studio', rustrover: 'RustRover' };
const TERMINAL_NAMES = {
  windowsterminal: 'Windows Terminal', 'gnome-terminal-server': 'GNOME Terminal', konsole: 'Konsole', 'xfce4-terminal': 'Xfce Terminal',
  tilix: 'Tilix', terminator: 'Terminator', kitty: 'kitty', alacritty: 'Alacritty', wezterm: 'WezTerm', 'wezterm-gui': 'WezTerm',
  ghostty: 'Ghostty', iterm2: 'iTerm2', terminal: 'Terminal', warp: 'Warp', hyper: 'Hyper', tabby: 'Tabby', mintty: 'mintty',
  conhost: 'Console', openconsole: 'Console', 'cmd': 'Command Prompt', powershell: 'PowerShell', pwsh: 'PowerShell',
};
const baseName = (exe) => String(exe || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

/** Find (and remember for a minute) the app and window owner of a session. */
function resolveApp(s, { fresh = false } = {}) {
  if (s.app && !fresh && Date.now() - s.app.at < 60e3) return s.app;
  const c = s.client || {};
  const wins = P.listAllAppWindows(process.pid);
  const tree = P.processTree();
  let own = c.pid ? P.windowOwner(c.pid, wins, tree) : { pid: 0, window: null };
  if (!own.window && c.idePid) own = P.windowOwner(c.idePid, wins, tree);
  // The hook's own process is gone by now: keep the app found earlier while it's still running.
  const same = (pid, exe) => { const e = tree.get(pid); return !!e && (!exe || baseName(e.exe) === baseName(exe)); };
  if (!own.window && s.app && s.app.pid && same(s.app.pid, s.app.exe)) own = P.windowOwner(s.app.pid, wins, tree);
  const w = own.window;
  const kind = s.where || 'terminal';
  // Nothing running under the old process ids (the app restarted since): remember which program it
  // was anyway, so typing along can match the session's window by program until the next hook event.
  const prev = !w && s.app && s.app.exe ? s.app : null;
  const app = { at: Date.now(), kind, pid: w ? own.pid : 0, exe: w ? w.exe : prev ? prev.exe : '', path: w ? w.path || P.exePath(own.pid) : prev ? prev.path || '' : '', name: '', scheme: null, tmux: !!c.tmux };
  if ((w || prev) && (kind === 'ide' || kind === 'ide-terminal')) {
    const prod = editorProduct(app.path);
    if (prod) { app.name = prod.name; app.scheme = prod.scheme; }
    else { const jb = Object.keys(JETBRAINS).find((k) => baseName(app.exe).startsWith(k)); if (jb) app.name = JETBRAINS[jb]; }
  } else if ((w || prev) && kind === 'terminal') {
    app.name = TERMINAL_NAMES[baseName(app.exe)] || '';
  }
  // Name the source after the real app ("Cursor", "WezTerm", "PyCharm terminal").
  if (app.name) {
    const label = kind === 'ide-terminal' ? `${app.name} terminal` : app.name;
    if (s.source !== label && ['IDE', 'IDE terminal', 'JetBrains IDE', 'Terminal'].includes(s.source)) { s.source = label; s.sourceRefined = true; }
  }
  s.app = app;
  return app;
}

/**
 * Ask an IDE to show a project folder: VS Code-family editors and JetBrains IDEs bring up the
 * window that has it open, or open it (the same as "Open with…" in a file manager).
 */
function openProject(exePath, folder) {
  try {
    if (!fs.existsSync(folder)) return false;
    if (process.platform === 'darwin') {
      const bundle = P.bundleOf && P.bundleOf(exePath);
      if (!bundle) return false;
      require('child_process').execFile('open', ['-a', bundle, folder], () => {});
      return true;
    }
    return launchDetached(exePath, [folder], { cwd: folder });
  } catch { return false; }
}

/** Of several windows of one app, the one whose title names the session's project. */
function pickWindow(s, app) {
  const wins = P.listAllAppWindows(process.pid).filter((w) => (app.pid && w.pid === app.pid) || (!app.pid && app.exe && w.exe === app.exe));
  const name = (s.name || '').toLowerCase();
  return wins.find((w) => name && w.title.toLowerCase().includes(name)) || wins[0] || null;
}

// ---------------------------------------------------------------- the Claude app's own session ids
const localIds = new Map();
function desktopRoots() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), ad = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const roots = [path.join(ad, 'Claude', 'claude-code-sessions')];
    try { for (const d of fs.readdirSync(path.join(la, 'Claude-Data'))) roots.push(path.join(la, 'Claude-Data', d, 'claude-code-sessions')); } catch { /* not the Store version */ }
    return roots;
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')];
  return [path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude', 'claude-code-sessions')];
}
/** The Claude app's id (local_…) for a Claude Code session id, from its session records. */
function desktopSessionId(cliId) {
  if (localIds.has(cliId)) return localIds.get(cliId);
  const needle = `"cliSessionId":"${cliId}"`;
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) { const hit = walk(full, depth + 1); if (hit) return hit; }
      else if (e.isFile() && /^local_.*\.json$/.test(e.name)) {
        try {
          const text = fs.readFileSync(full, 'utf8');
          if (text.replace(/\s/g, '').includes(needle)) return JSON.parse(text).sessionId || e.name.slice(0, -5);
        } catch { /* being written */ }
      }
    }
    return null;
  };
  for (const r of desktopRoots()) { const id = walk(r, 0); if (id) { localIds.set(cliId, id); return id; } }
  return null;
}

// ---------------------------------------------------------------- bringing a session to the front
async function waitFor(test, ms) {
  for (let t = 0; t < ms; t += 100) { if (test()) return true; await sleep(100); }
  return test();
}
const fg = () => P.foregroundInfo() || {};
const inFront = (app) => () => {
  const f = fg();
  if (app.pid || app.exe) return !!f.pid && (f.pid === app.pid || (!!app.exe && f.exe === app.exe));
  return app.kind === 'desktop' && /^claude(\.exe)?$/i.test(f.exe || ''); // the Claude app, before its window was matched
};

/**
 * Bring the session to the front, its prompt box focused when the app allows.
 * Returns { ok, app, check, input } (input: the prompt box itself has focus) or { ok: false, why }.
 */
async function openSession(s, { strict = false } = {}) {
  const app = resolveApp(s, { fresh: true });
  const check = inFront(app);

  if (app.kind === 'desktop') {
    const local = desktopSessionId(s.id);
    if (local) await shell.openExternal(`claude://code/continue?session=${encodeURIComponent(local)}`);
    else if (strict) return { ok: false, why: "couldn't find this session in the Claude app" };
    else { const w = pickWindow(s, app); if (w) P.focus(w); }
    if (!(await waitFor(check, 3500))) return { ok: false, why: "the Claude app didn't come to the front" };
    await sleep(local ? 1000 : 300);
    return { ok: true, app, check, input: !!local };
  }

  if ((app.kind === 'ide' || app.kind === 'ide-terminal') && app.path && s.cwd && openProject(app.path, s.cwd)) {
    await waitFor(check, 3000); // the editor brings up (or opens) the window for this project
    await sleep(500);
    if (app.kind === 'ide-terminal' || !app.scheme) return { ok: true, app, check, input: false };
    await shell.openExternal(`${app.scheme}://anthropic.claude-code/open?session=${encodeURIComponent(s.id)}`);
    await sleep(800);
    return { ok: true, app, check, input: true };
  }

  if (app.kind === 'ide' && app.scheme) {
    const w = pickWindow(s, app);
    if (w) { P.focus(w); await sleep(200); } // the link goes to the editor window in front
    await shell.openExternal(`${app.scheme}://anthropic.claude-code/open?session=${encodeURIComponent(s.id)}`);
    if (!(await waitFor(check, 3000))) return { ok: false, why: "the editor didn't come to the front" };
    await sleep(800); // its Claude Code tab opens and the prompt box takes focus
    return { ok: true, app, check, input: true };
  }

  // A terminal, or an IDE without a link we know: bring its window up.
  const w = pickWindow(s, app);
  if (!w) return { ok: false, why: app.tmux ? 'it runs inside tmux, so its window is unknown' : "couldn't find its window" };
  P.focus(w);
  if (!(await waitFor(check, 2000))) return { ok: false, why: "its window didn't come to the front" };
  await sleep(250);
  // In a standalone terminal the prompt is where you type; in an IDE's terminal panel it may not be.
  const named = (s.name || '') && (fg().title || '').toLowerCase().includes((s.name || '').toLowerCase());
  return { ok: true, app, check, input: app.kind === 'terminal' && (!strict || named || /claude/i.test(fg().title || '')) };
}

// ---------------------------------------------------------------- pasting
/** @-mentions Claude Code turns into attachments; quoted when the path has spaces. */
const mentions = (files) => files.map((f) => `@${/\s/.test(f) ? `"${f}"` : f}`).join(' ') + ' ';

let busy = Promise.resolve();

/**
 * Put files and/or text into the session's prompt box; submit presses Enter afterwards.
 * Runs one at a time. Resolves { ok } or { ok: false, why, onClipboard }.
 */
function deliver(s, { files = [], text = '', submit = false, strict = submit } = {}) {
  const job = busy.then(async () => {
    const body = (files.length ? mentions(files) : '') + text;
    const target = await openSession(s, { strict });
    const leaveIt = async (why) => { await P.setClipboard({ files: P.clipboardHoldsFiles && !submit ? files : [], text: body }); return { ok: false, why, onClipboard: true }; };
    if (!target.ok) return strict ? target : leaveIt(target.why);
    if (!target.input) return leaveIt(`it's in ${target.app.name || 'an IDE'}'s terminal panel, so it's on your clipboard: paste it there with ${P.pasteKey}`);
    if (!P.canType()) return leaveIt(`press ${P.pasteKey} to paste it${P.accessibilityHelp ? ` (${P.accessibilityHelp} to let the buddy do it)` : ''}`);
    for (let i = 0; i < 20 && P.modifiersDown(); i++) await sleep(50); // don't mix with keys you're holding
    const saved = await P.saveClipboard();
    if (!(await P.setClipboard({ files: P.clipboardHoldsFiles && !submit ? files : [], text: body }))) { await P.restoreClipboard(saved); return { ok: false, why: 'the clipboard is busy' }; }
    await sleep(60);
    if (!target.check()) { await P.restoreClipboard(saved); return { ok: false, why: 'another window came to the front' }; }
    P.paste({ terminal: target.app.kind === 'terminal' });
    let sent = !submit;
    if (submit) {
      await sleep(600);
      if (target.check()) sent = P.pressEnter();
    }
    setTimeout(() => P.restoreClipboard(saved), 1500);
    return sent ? { ok: true } : { ok: false, why: 'pasted, but another window came to the front before sending' };
  });
  busy = job.catch(() => {});
  return job.catch((err) => ({ ok: false, why: String(err.message || err) }));
}

module.exports = { deliver, openSession, resolveApp, pickWindow, desktopSessionId, editorProduct, mentions };
