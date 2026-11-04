// Start Claude Buddy when you log in: a Run entry on Windows, a LaunchAgent on
// macOS, an XDG autostart entry on Linux. Node only (used by the app and the
// installer).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NAME = 'ClaudeBuddy';
const LABEL = 'io.github.sideswipeishacking.claude-buddy';
const plist = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const desktopFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'claude-buddy.desktop');
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Turn starting at login on (for `electron appDir`) or off. */
function setAutostart(on, { electron, appDir } = {}) {
  try {
    if (process.platform === 'win32') {
      if (on) execFileSync('reg', ['add', RUN_KEY, '/v', NAME, '/t', 'REG_SZ', '/d', `"${electron}" "${appDir}"`, '/f'], { stdio: 'ignore' });
      else execFileSync('reg', ['delete', RUN_KEY, '/v', NAME, '/f'], { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      if (on) {
        fs.mkdirSync(path.dirname(plist()), { recursive: true });
        fs.writeFileSync(plist(), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(electron)}</string><string>${xml(appDir)}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`);
      } else fs.rmSync(plist(), { force: true });
    } else if (on) {
      fs.mkdirSync(path.dirname(desktopFile()), { recursive: true });
      fs.writeFileSync(desktopFile(), `[Desktop Entry]\nType=Application\nName=Claude Buddy\nExec="${electron}" --no-sandbox "${appDir}"\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`);
    } else fs.rmSync(desktopFile(), { force: true });
    return true;
  } catch {
    return false; // nothing to remove, or no permission
  }
}

module.exports = { setAutostart };
