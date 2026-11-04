#!/usr/bin/env node
// Claude Buddy installer and control. Works on Windows, macOS and Linux.
//
//   claude-buddy install     install the desktop app and the Claude Code plugin (default)
//   claude-buddy setup       install/update only the desktop app (the plugin runs this on first /buddy)
//   claude-buddy start | stop | status | doctor
//   claude-buddy uninstall [--purge]
//
// From GitHub, without cloning:   npx github:sideswipeishacking/claude-buddy
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const paths = require('../lib/paths');
const { setAutostart } = require('../lib/autostart');

const REPO = 'sideswipeishacking/claude-buddy';
const MARKETPLACE = 'claude-buddy';
const PLUGIN = `claude-buddy@${MARKETPLACE}`;
const SRC = path.resolve(__dirname, '..');
// What a running install needs (no docs, tests or dev tools).
const SHIP = ['app', 'lib', 'bin', 'scripts', 'hooks', 'commands', '.claude-plugin', 'package.json', 'package-lock.json', 'README.md', 'LICENSE'];
const MARK = '<!-- claude-buddy-command -->';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const quiet = flag('quiet');
const log = (...a) => { if (!quiet) console.log(...a); logFile(a.join(' ')); };
const step = (t) => log(`\x1b[36m→\x1b[0m ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function logFile(line) {
  try { fs.mkdirSync(paths.installDir(), { recursive: true }); fs.appendFileSync(path.join(paths.installDir(), 'setup.log'), `[${new Date().toISOString()}] ${line}\n`); } catch { /* best effort */ }
}

function request(method, route, body, timeout = 1500) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({ host: '127.0.0.1', port: paths.PORT, path: route, method, timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { try { resolve(JSON.parse(text)); } catch { resolve({}); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(data);
  });
}
const running = async () => !!(await request('GET', '/health'));

function run(cmd, cmdArgs, opts = {}) {
  // Windows needs a shell for npm.cmd / claude.cmd, and the shell needs paths with spaces quoted.
  const win = process.platform === 'win32';
  const a = win ? cmdArgs.map((x) => (/[\s&()^]/.test(x) ? `"${x}"` : x)) : cmdArgs;
  const r = spawnSync(win && /[\s]/.test(cmd) ? `"${cmd}"` : cmd, a, { stdio: quiet ? 'ignore' : 'inherit', shell: win, ...opts });
  return r.status === 0;
}
const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;

// ---------------------------------------------------------------- the desktop app
async function setup({ from = SRC, start = true } = {}) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) throw new Error(`Node.js 18 or newer is needed (this is ${process.versions.node}).`);
  const dir = paths.installDir();
  const wasRunning = await running();
  if (wasRunning) { step('Stopping the running Claude Buddy'); await request('POST', '/quit'); await sleep(1500); }

  if (path.resolve(from).toLowerCase() !== path.resolve(dir).toLowerCase()) {
    step(`Copying Claude Buddy to ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const old of ['plugin', 'install.ps1', 'uninstall.ps1', 'tools']) fs.rmSync(path.join(dir, old), { recursive: true, force: true }); // from 1.x installs
    for (const item of SHIP) {
      const src = path.join(from, item);
      if (!fs.existsSync(src)) continue;
      fs.rmSync(path.join(dir, item), { recursive: true, force: true });
      fs.cpSync(src, path.join(dir, item), { recursive: true });
    }
    // Reuse dependencies that are already downloaded (Electron is ~100 MB).
    const srcElectron = paths.electronBinary(from);
    if (fs.existsSync(srcElectron) && !fs.existsSync(paths.electronBinary(dir))) {
      step('Reusing the downloaded Electron');
      fs.cpSync(path.join(from, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true });
    }
  }

  step('Installing dependencies (Electron, koffi); the first time downloads about 100 MB');
  if (!run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir })) throw new Error('npm install failed. Is npm on your PATH? (See docs/troubleshooting.md)');
  if (!fs.existsSync(paths.electronBinary(dir))) run(process.execPath, [path.join(dir, 'node_modules', 'electron', 'install.js')], { cwd: dir });
  if (!fs.existsSync(paths.electronBinary(dir))) throw new Error("Electron didn't download. If GitHub downloads are blocked, set ELECTRON_MIRROR (see docs/troubleshooting.md) and run this again.");

  // A clean copy (no node_modules) to register as the local plugin marketplace: Claude Code copies the whole source.
  const market = path.join(dir, 'marketplace');
  fs.rmSync(market, { recursive: true, force: true });
  for (const item of SHIP) if (fs.existsSync(path.join(dir, item))) fs.cpSync(path.join(dir, item), path.join(market, item), { recursive: true });

  step('Writing launch info for the /buddy hook');
  fs.writeFileSync(paths.launchFile(dir), JSON.stringify({ command: paths.electronBinary(dir), args: launchArgs(dir) }, null, 2));

  addPlainCommand(dir);
  addLauncher(dir);

  if (start) await startApp();
  return dir;
}

/** Ubuntu 24.04+ blocks Chromium's sandbox for apps outside /opt; Claude Buddy only shows its own local pages. */
const launchArgs = (dir) => (process.platform === 'linux' ? ['--no-sandbox', dir] : [dir]);

/** Plugin commands are namespaced (/claude-buddy:buddy); a personal command makes plain /buddy work. */
function addPlainCommand(dir) {
  try {
    const target = path.join(paths.claudeDir(), 'commands', 'buddy.md');
    if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(MARK)) return; // the user's own /buddy: leave it
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(path.join(dir, 'commands', 'buddy.md'), 'utf8') + `\n${MARK}\n`);
  } catch (err) { log(`  (couldn't add the plain /buddy command: ${err.message})`); }
}

/** A Start menu shortcut (Windows) or app launcher entry (Linux). */
function addLauncher(dir) {
  const electron = paths.electronBinary(dir);
  try {
    if (process.platform === 'win32') {
      const lnk = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Claude Buddy.lnk');
      const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}');$s.TargetPath='${electron.replace(/'/g, "''")}';$s.Arguments='"${dir.replace(/'/g, "''")}"';$s.WorkingDirectory='${dir.replace(/'/g, "''")}';$s.Description='Claude Buddy';$s.Save()`;
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
    } else if (process.platform === 'linux') {
      const file = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications', 'claude-buddy.desktop');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Claude Buddy\nComment=Pixel buddies for your Claude Code sessions\nExec="${electron}" --no-sandbox "${dir}"\nTerminal=false\nCategories=Utility;\n`);
    }
  } catch { /* optional */ }
}

async function startApp() {
  if (await running()) return true;
  const launch = JSON.parse(fs.readFileSync(paths.launchFile(), 'utf8'));
  step('Starting Claude Buddy');
  spawn(launch.command, launch.args || [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 60; i++) { if (await running()) return true; await sleep(500); }
  log("  Claude Buddy didn't answer yet. Check setup.log and the app's error.log (see docs/troubleshooting.md).");
  return false;
}

// ---------------------------------------------------------------- the Claude Code plugin
function claude(cmdArgs) { return run('claude', cmdArgs, { stdio: quiet ? 'ignore' : ['ignore', 'inherit', 'inherit'] }); }

function registerPlugin(dir) {
  if (!has('claude')) {
    log('\n  Claude Code (the `claude` command) was not found, so the plugin was not added.');
    log(`  In Claude Code, run:  /plugin marketplace add ${REPO}   then   /plugin install ${PLUGIN}`);
    return false;
  }
  // Start clean: older versions registered "claude-buddy-local", and a re-install may switch source.
  const quietly = (a) => run('claude', a, { stdio: 'ignore' });
  quietly(['plugin', 'uninstall', 'claude-buddy@claude-buddy-local']);
  quietly(['plugin', 'marketplace', 'remove', 'claude-buddy-local']);
  quietly(['plugin', 'uninstall', PLUGIN]);
  quietly(['plugin', 'marketplace', 'remove', MARKETPLACE]);
  const source = flag('github') ? REPO : path.join(dir, 'marketplace');
  step(`Adding the plugin marketplace (${flag('github') ? 'GitHub' : 'this install'})`);
  claude(['plugin', 'marketplace', 'add', source]);
  claude(['plugin', 'marketplace', 'update', MARKETPLACE]);
  step('Installing the claude-buddy plugin');
  claude(['plugin', 'install', PLUGIN]);
  return true;
}

// ---------------------------------------------------------------- commands
async function install() {
  const dir = await setup();
  registerPlugin(dir);
  log(`
\x1b[32mClaude Buddy is installed.\x1b[0m
  1. Start a new Claude Code session (terminal, IDE extension or the Claude app),
     or run /reload-plugins in one that's already open.
  2. Type  /buddy
  Your buddy gets built on your desktop. /buddy off sends it home. Click the eye in the top-left corner for everything else.
`);
}

async function uninstall() {
  const dir = paths.installDir();
  if (await running()) { step('Stopping Claude Buddy'); await request('POST', '/quit'); await sleep(1500); }
  if (has('claude')) {
    step('Removing the Claude Code plugin');
    claude(['plugin', 'uninstall', PLUGIN]);
    claude(['plugin', 'marketplace', 'remove', MARKETPLACE]);
    claude(['plugin', 'uninstall', 'claude-buddy@claude-buddy-local']);
    claude(['plugin', 'marketplace', 'remove', 'claude-buddy-local']);
  }
  const cmd = path.join(paths.claudeDir(), 'commands', 'buddy.md');
  try { if (fs.readFileSync(cmd, 'utf8').includes(MARK)) fs.rmSync(cmd); } catch { /* not there */ }
  setAutostart(false);
  try {
    if (process.platform === 'win32') fs.rmSync(path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Claude Buddy.lnk'), { force: true });
    if (process.platform === 'linux') fs.rmSync(path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications', 'claude-buddy.desktop'), { force: true });
  } catch { /* fine */ }
  step(`Removing ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
  if (flag('purge')) {
    const data = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Claude Buddy')
      : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude Buddy')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude Buddy');
    step(`Removing settings and buddies (${data})`);
    fs.rmSync(data, { recursive: true, force: true });
  }
  log('\nClaude Buddy is uninstalled.' + (flag('purge') ? '' : ' (Your buddies and settings were kept; add --purge to remove them too.)'));
}

async function status() {
  const dir = paths.installDir();
  const health = await request('GET', '/health');
  let version = '-';
  try { version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch { /* not installed */ }
  console.log(`installed:  ${fs.existsSync(paths.launchFile(dir)) ? `yes, ${version} (${dir})` : 'no'}`);
  console.log(`running:    ${health ? `yes, ${health.buddies} buddies` : 'no'}`);
}

async function doctor() {
  const ok = (good, text, fix = '') => console.log(`${good ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${text}${!good && fix ? `\n    ${fix}` : ''}`);
  const dir = paths.installDir();
  ok(Number(process.versions.node.split('.')[0]) >= 18, `Node.js ${process.versions.node}`, 'Install Node.js 18 or newer: https://nodejs.org');
  ok(has('npm'), 'npm is on the PATH', 'npm comes with Node.js');
  ok(has('claude'), 'Claude Code CLI is on the PATH', 'Only needed for the terminal installer; the plugin can be added from inside Claude Code too.');
  ok(fs.existsSync(paths.electronBinary(dir)), `app installed in ${dir}`, 'Run: npx github:sideswipeishacking/claude-buddy   (or type /buddy once the plugin is installed)');
  ok(await running(), 'app is running', 'Start it with: claude-buddy start   (or just type /buddy)');
  if (process.platform === 'linux') ok(!!process.env.DISPLAY, 'an X11 display is available (XWayland is fine)', 'Without X11 the buddies can still roam but can\'t see your windows. See docs/platforms.md.');
  if (process.platform === 'darwin') console.log('  macOS: pasting files and prompts needs Accessibility, typing along needs Input Monitoring (System Settings → Privacy & Security).');
}

(async () => {
  const cmd = args.find((a) => !a.startsWith('--')) || 'install';
  try {
    if (cmd === 'install') await install();
    else if (cmd === 'setup') {
      await setup({ from: opt('from') || SRC, start: !flag('no-start') });
      const pending = opt('then-post');
      if (pending) { try { await request('POST', '/event', JSON.parse(fs.readFileSync(pending, 'utf8')), 3000); } finally { fs.rmSync(pending, { force: true }); } }
    } else if (cmd === 'uninstall') await uninstall();
    else if (cmd === 'start') { if (!(await startApp())) process.exitCode = 1; }
    else if (cmd === 'stop') await request('POST', '/quit');
    else if (cmd === 'status') await status();
    else if (cmd === 'doctor') await doctor();
    else { console.log('Usage: claude-buddy [install|setup|start|stop|status|doctor|uninstall [--purge]]'); process.exitCode = 1; }
  } catch (err) {
    log(`\x1b[31mClaude Buddy: ${err.message}\x1b[0m`);
    process.exitCode = 1;
  }
})();
