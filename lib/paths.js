// Where Claude Buddy lives on each operating system. Used by the app, the
// installer and the Claude Code hook (no dependencies, Node only).
'use strict';

const os = require('os');
const path = require('path');

const home = () => os.homedir();

/** The installed app (a copy of this repository plus its node_modules). */
function installDir() {
  if (process.env.CLAUDE_BUDDY_HOME) return process.env.CLAUDE_BUDDY_HOME;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home(), 'AppData', 'Local'), 'ClaudeBuddy');
  if (process.platform === 'darwin') return path.join(home(), 'Library', 'Application Support', 'ClaudeBuddy');
  return path.join(process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share'), 'claude-buddy');
}

/** Claude Code's config folder (respects CLAUDE_CONFIG_DIR). */
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(home(), '.claude');

/** The Electron binary inside an install. */
function electronBinary(dir = installDir()) {
  const dist = path.join(dir, 'node_modules', 'electron', 'dist');
  if (process.platform === 'win32') return path.join(dist, 'electron.exe');
  if (process.platform === 'darwin') return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return path.join(dist, 'electron');
}

const launchFile = (dir = installDir()) => path.join(dir, 'launch.json');
const PORT = Number(process.env.CLAUDE_BUDDY_PORT) || 47321;

module.exports = { installDir, claudeDir, electronBinary, launchFile, PORT };
