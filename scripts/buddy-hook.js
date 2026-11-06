#!/usr/bin/env node
// Claude Buddy hook: forwards Claude Code hook events to the Claude Buddy
// desktop app on 127.0.0.1. It never fails or slows a session: if the app
// isn't running, events are dropped silently.
//
// `/buddy ...` prompts are handled here and blocked, so they never reach the
// model (instant, no tokens). If the app isn't running, /buddy starts it; if it
// isn't installed yet (fresh from the plugin marketplace), /buddy installs it
// in the background first. A newer plugin quietly updates the installed app.
//
// Permission prompts: Claude Code shows its normal dialog and runs this hook
// at the same time. The hook waits for you to press Allow / Always / Deny on
// the buddy; whichever you answer first wins.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../lib/paths');
// Starts things outside the sandbox of the Store version of the Claude app (see lib/launch.js).
const { launchDetached } = require('../lib/launch');

const PORT = paths.PORT;
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const COMMAND = /^\s*\/(?:claude-buddy:)?buddy(?:\s+([\s\S]*))?$/i;
const PERMISSION_WAIT_MS = 590e3; // just under the hook's 600 s timeout

let hardStop = setTimeout(() => process.exit(0), 12000);
hardStop.unref();

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => main().catch(() => {}).finally(() => process.exit(0)));

function request(route, body, timeout) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: route, method: 'POST', agent: false, timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(String(res.statusCode)));
        try { resolve(JSON.parse(text || '{}')); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}
const post = (body, timeout) => request('/event', body, timeout);

function parseCommand(prompt) {
  const m = COMMAND.exec(String(prompt || ''));
  if (!m) return null;
  const args = (m[1] || '').trim();
  const [word, ...rest] = args.split(/\s+/);
  const value = rest.join(' ').trim();
  const w = (word || '').toLowerCase();
  if (!w || w === 'on' || w === 'summon') return { action: 'summon' };
  if (['off', 'bye', 'dismiss', 'away', 'stop'].includes(w)) return { action: 'off' };
  if ((w === 'name' || w === 'rename') && value) return { action: 'name', value };
  if (w === 'hat' && value) return { action: 'hat', value: value.toLowerCase() };
  if (w === 'size' && value) return { action: 'size', value: value.toLowerCase() };
  if (['custom', 'customize', 'customise', 'look', 'wardrobe', 'style'].includes(w)) return { action: 'custom' };
  if (w === 'helpers' || w === 'subagents') return { action: 'helpers', value: /^(off|no|hide|false)$/i.test(value) ? 'off' : 'on' };
  if (w === 'annoy' || w === 'mischief') return { action: 'annoy', value: /^(off|no|stop|false)$/i.test(value) ? 'off' : 'on' };
  if (['take', 'adopt', 'claim'].includes(w)) return { action: 'take', value };
  return { action: 'summon' };
}

function launchConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(paths.launchFile(), 'utf8'));
    return fs.existsSync(cfg.command) ? cfg : null;
  } catch { return null; }
}

function launchApp() {
  const cfg = launchConfig();
  if (!cfg) return false;
  return launchDetached(cfg.command, cfg.args || [], { cwd: paths.installDir() });
}

const version = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || '0'; } catch { return '0'; } };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

/** Install (or update) the desktop app from this plugin in the background; then send `ev` (e.g. the summon). */
function setupInBackground(ev) {
  const setupScript = path.join(PLUGIN_ROOT, 'bin', 'claude-buddy.js');
  if (!fs.existsSync(setupScript)) return false;
  const lock = path.join(os.tmpdir(), 'claude-buddy-setup.lock');
  try { if (Date.now() - fs.statSync(lock).mtimeMs < 10 * 60e3) return true; } catch { /* no setup running */ }
  fs.writeFileSync(lock, String(process.pid));
  const args = [setupScript, 'setup', '--quiet', '--outside', '--from', PLUGIN_ROOT];
  // The summon rides along on the command line (a temp file could land in a sandbox's private copy).
  if (ev) args.push('--then-post-b64', Buffer.from(JSON.stringify(ev)).toString('base64'));
  return launchDetached(process.execPath, args, { cwd: PLUGIN_ROOT }); // the lock expires after 10 minutes
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SETUP_MESSAGE = 'Setting up Claude Buddy for the first time: the desktop app is downloading (about 100 MB, a minute or two). Your buddy will be built on your desktop as soon as it is ready. Nothing else to do.';

const MESSAGES = {
  summon: 'Buddy summoned! It is on your desktop and will act out what this session is doing. (/buddy off sends it home)',
  off: 'Buddy dismissed for this session.',
  name: (v) => `Your buddy is now called ${v}.`,
  hat: (v) => `Your buddy put on the ${v}.`,
  size: (v) => `Buddy size set: ${v} (laptop screen and other monitors have separate sizes).`,
  custom: 'Opening the Buddy Workshop on your desktop.',
  helpers: (v) => (v === 'off' ? 'Helper Clawds are hidden for this session.' : 'Helper Clawds will show up when this session uses sub-agents.'),
  annoy: (v) => (v === 'off' ? 'Annoy mode is off. Your buddy is on its best behaviour.' : 'Annoy mode is on. When it has nothing to do for a while, expect mischief. (/buddy annoy off stops it)'),
  take: 'Your buddy moved over to this session.', // (the app says which one)
};

async function permission(ev) {
  // Questions (AskUserQuestion) are answered in Claude's own dialog; just tell the buddy.
  if (ev.tool_name === 'AskUserQuestion') { await post(ev, 1500).catch(() => {}); return; }
  clearTimeout(hardStop);
  hardStop = setTimeout(() => process.exit(0), PERMISSION_WAIT_MS + 5000);
  hardStop.unref();
  const res = await request('/permission', ev, PERMISSION_WAIT_MS).catch(() => null);
  if (!res || !res.decision) return; // answered elsewhere, or no buddy for this session
  const suggestions = Array.isArray(ev.permission_suggestions) ? ev.permission_suggestions : [];
  const decision = res.decision === 'deny'
    ? { behavior: 'deny', message: 'Denied from the Claude Buddy on the desktop.' }
    : { behavior: 'allow', ...(res.decision === 'always' && suggestions.length ? { updatedPermissions: suggestions } : {}) };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
}

async function main() {
  let ev;
  try { ev = JSON.parse(raw); } catch { return; }
  ev.entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT || '';
  ev.term_program = process.env.TERM_PROGRAM || '';
  // Where this session runs, so its buddy can find (and focus) the right window.
  // Stays on this machine: it only goes to the app on 127.0.0.1.
  const env = process.env;
  ev.client = {
    pid: process.ppid, // the shell Claude Code ran this hook from; its parents lead to the terminal / IDE / app
    entrypoint: ev.entrypoint,
    term: ev.term_program,
    termEmu: env.TERMINAL_EMULATOR || '', // JetBrains-JediTerm in JetBrains IDEs
    idePid: Number(env.VSCODE_PID) || 0, // VS Code-family editors
    wt: !!env.WT_SESSION,
    tmux: !!env.TMUX,
    platform: process.platform,
  };

  if (ev.hook_event_name === 'PermissionRequest') return permission(ev);

  const cmd = ev.hook_event_name === 'UserPromptSubmit' ? parseCommand(ev.prompt) : null;
  if (!cmd) {
    // A plugin update brought a newer app than the one installed: update it quietly.
    if (ev.hook_event_name === 'SessionStart' && launchConfig() && newer(version(PLUGIN_ROOT), version(paths.installDir()))) setupInBackground(null);
    await post(ev, ev.hook_event_name === 'UserPromptSubmit' ? 600 : 1500).catch(() => null);
    return;
  }

  ev.buddy_command = cmd;
  const wait = cmd.action === 'take' ? 3000 : 800; // (it may read the transcript to see which chat this one continues)
  let res = await post(ev, wait).catch(() => null);
  let ok = !!res;
  if (!ok && cmd.action !== 'off' && !launchConfig()) {
    // Fresh from the plugin marketplace: install the desktop app, then build this buddy.
    const started = setupInBackground(ev);
    process.stdout.write(JSON.stringify({ decision: 'block', reason: started ? SETUP_MESSAGE : 'Claude Buddy could not set itself up. Run: npx github:sideswipeishacking/claude-buddy' }));
    return;
  }
  if (!ok && cmd.action !== 'off' && launchApp()) {
    for (let i = 0; i < 25 && !ok; i++) {
      await sleep(300);
      res = await post(ev, wait).catch(() => null);
      ok = !!res;
    }
  }
  const msg = MESSAGES[cmd.action];
  const reason = ok
    ? (res && typeof res.message === 'string' && res.message) || (typeof msg === 'function' ? msg(cmd.value) : msg)
    : 'The Claude Buddy app is not running and could not be started. Run `npx github:sideswipeishacking/claude-buddy doctor` in a terminal to see why.';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}
