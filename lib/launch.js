// Start Claude Buddy (or its setup) as its own program, detached from whoever
// asked for it.
//
// Why not just spawn it: on Windows, the Microsoft Store version of the Claude
// app is an MSIX package, and every process it starts (its Claude Code
// sessions, their hooks, anything those run) lives inside the package, which
// keeps a private copy of AppData. Claude Buddy started from there would save
// its buddies and settings, and even its install, into that private copy, while
// the same app started at login or from a terminal uses the real folders. So on
// Windows we ask WMI to create the process: it is then started by Windows itself,
// outside any package. Node only, no dependencies.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const argQuote = (s) => (/[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s));

/** Start `command args…` detached. Returns true if it was started. */
function launchDetached(command, args = [], { cwd } = {}) {
  if (process.platform === 'win32') {
    const commandLine = [command, ...args].map(argQuote).join(' ');
    const ps = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; CurrentDirectory = ${psQuote(cwd || path.dirname(command))} }; exit [int]$r.ReturnValue`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 30000, stdio: 'ignore' });
    if (r.status === 0) return true;
    // WMI unavailable (locked-down machine): start it directly instead.
  }
  try {
    spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch { return false; }
}

let sandboxed = null;
/**
 * Do this process's writes to AppData end up in some package's private copy?
 * (Processes started by the Store version of the Claude app do, even though they
 * have no package identity of their own, so we test the effect itself: write a
 * probe file and see whether it lands under %LOCALAPPDATA%\Packages\*\LocalCache.)
 */
function inPackageSandbox() {
  if (process.platform !== 'win32' || !process.env.APPDATA || !process.env.LOCALAPPDATA) return false;
  if (sandboxed !== null) return sandboxed;
  const name = `claude-buddy-probe-${process.pid}-${Date.now()}.tmp`;
  const probe = path.join(process.env.APPDATA, name);
  sandboxed = false;
  try { fs.writeFileSync(probe, ''); } catch { return sandboxed; }
  try {
    const packages = path.join(process.env.LOCALAPPDATA, 'Packages');
    sandboxed = fs.readdirSync(packages).some((p) => fs.existsSync(path.join(packages, p, 'LocalCache', 'Roaming', name)));
  } catch { /* no Packages folder */ }
  try { fs.rmSync(probe, { force: true }); } catch { /* fine */ }
  return sandboxed;
}

module.exports = { launchDetached, inPackageSandbox };
