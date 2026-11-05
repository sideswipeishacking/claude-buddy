# Installation

Claude Buddy has two parts:

- **The plugin** for Claude Code. It adds the `/buddy` command and hooks that tell the app what each session is doing.
- **The desktop app** (Electron). It draws the buddies. It lives in your user folder and needs no admin rights.

Every method below sets up both. Pick whichever you like.

- [Requirements](#requirements)
- [Option A: from the plugin marketplace (recommended)](#option-a-from-the-plugin-marketplace-recommended)
- [Option B: one terminal command](#option-b-one-terminal-command)
- [Option C: from a clone](#option-c-from-a-clone)
- [Per-OS notes](#per-os-notes)
- [Where things are installed](#where-things-are-installed)
- [Updating](#updating)
- [Uninstalling](#uninstalling)

## Requirements

- **Claude Code** (CLI, IDE extension or the Claude desktop app) with plugin support.
- **Node.js 18 or newer** on your `PATH`. The plugin's hooks run on Node, and the setup uses `npm`. Check with `node --version`.
- **Windows 10/11, macOS 12+, or Linux with X11 or XWayland.** See [platforms](platforms.md).
- About **300 MB** of disk space (most of it is Electron).

## Option A: from the plugin marketplace (recommended)

Inside Claude Code (any session):

```
/plugin marketplace add sideswipeishacking/claude-buddy
/plugin install claude-buddy@claude-buddy
```

Then activate it in the session you're in and summon your buddy:

```
/reload-plugins
/claude-buddy:buddy
```

A session loads its plugins when it starts, so sessions that were already open need `/reload-plugins` once (sessions you start later pick the plugin up by themselves). The same goes after updating the plugin.

The first `/buddy` notices the desktop app isn't installed yet and installs it in the background: it copies the app to your user folder and downloads Electron (about 100 MB). That takes a minute or two. Claude Code shows a short message, and your buddy is built on the desktop as soon as the app is ready. You don't need to do anything else.

Setup also adds a small personal command file so that plain **`/buddy`** works from then on.

> Prefer the menus? Run `/plugin`, choose **Add marketplace**, enter `sideswipeishacking/claude-buddy`, then install **claude-buddy** from the **Discover** tab.

## Option B: one terminal command

If you have Node.js, this installs the desktop app *and* registers the plugin with Claude Code in one go:

```bash
npx github:sideswipeishacking/claude-buddy
```

It needs the `claude` command on your `PATH` to register the plugin. If it can't find it, it prints the two `/plugin` commands to run inside Claude Code instead.

The same tool has a few more commands (`status`, `doctor`, `start`, `stop`, `uninstall`). See [commands](commands.md#the-claude-buddy-cli).

## Option C: from a clone

```bash
git clone https://github.com/sideswipeishacking/claude-buddy.git
cd claude-buddy
npm install
node bin/claude-buddy.js install
```

That copies the app into your user folder and registers this folder's copy as a local plugin marketplace. To run straight from the clone while developing, see [development](development.md).

## Per-OS notes

### Windows

Nothing special. Setup adds a **Claude Buddy** Start-menu shortcut and turns on starting at login (you can switch that off in the Overlord's options: click the eye in the top-left corner).

### macOS

- The first time the Overlord reads your usage limits, macOS asks whether Claude Buddy may use the **"Claude Code-credentials"** keychain item. Choose **Always Allow**. That's the login Claude Code saved; it's only sent to `api.anthropic.com` (see [privacy](privacy.md)).
- To drop files onto a buddy and have them pasted into Claude's prompt box, allow Claude Buddy under **System Settings → Privacy & Security → Accessibility**. Without it, the buddy leaves them on your clipboard and asks you to press ⌘V.
- *Type along* is off by default on macOS because it needs **Input Monitoring**. Turn it on in the Overlord's options (click the eye in the top-left corner) and macOS will ask.
- Starting at login uses a LaunchAgent in `~/Library/LaunchAgents`.

### Linux

- Buddies need **X11 or XWayland** to float above other windows. On a Wayland desktop the app automatically runs through XWayland. Windows of native Wayland apps aren't visible to it, so buddies just won't walk on those title bars.
- Ubuntu 24.04 and newer restrict Chromium's sandbox for apps installed in your home folder, so Claude Buddy is launched with `--no-sandbox`. It only ever shows its own local pages.
- Setup adds an app-launcher entry and an autostart entry under `~/.config/autostart`.
- If Electron complains about missing libraries, install your distribution's Electron/Chromium runtime packages (for example `libnss3`, `libgtk-3-0`, `libgbm1`, `libasound2` on Debian/Ubuntu).

## Where things are installed

| What | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Desktop app | `%LOCALAPPDATA%\ClaudeBuddy` | `~/Library/Application Support/ClaudeBuddy` | `~/.local/share/claude-buddy` |
| Settings, buddies, logs | `%APPDATA%\Claude Buddy` | `~/Library/Application Support/Claude Buddy` | `~/.config/Claude Buddy` |
| Plugin | Claude Code's plugin folder (`~/.claude/plugins`) | same | same |
| Plain `/buddy` command | `~/.claude/commands/buddy.md` | same | same |

Set `CLAUDE_BUDDY_HOME` to install the app somewhere else, and `CLAUDE_BUDDY_PORT` to change the local port (default `47321`).

## Updating

- **Marketplace install:** run `/plugin marketplace update claude-buddy` (or turn on auto-update for the marketplace in `/plugin`), then `/reload-plugins` in sessions that are already open. The next time a session starts, the plugin notices it's newer than the installed app and quietly updates the app.
- **Terminal install:** run `npx github:sideswipeishacking/claude-buddy` again.
- **Clone:** `git pull`, then `node bin/claude-buddy.js install`.

Your buddies, their looks and your settings are kept across updates.

## Uninstalling

```bash
npx github:sideswipeishacking/claude-buddy uninstall          # keeps your buddies and settings
npx github:sideswipeishacking/claude-buddy uninstall --purge  # removes those too
```

This stops the app and removes the plugin, the desktop app, the plain `/buddy` command, the start-at-login entry and the shortcut.

To do it by hand:

1. In Claude Code: `/plugin uninstall claude-buddy@claude-buddy` and `/plugin marketplace remove claude-buddy`.
2. Quit Claude Buddy (click the Overlord → **Quit**, or the tray icon).
3. Delete the desktop app folder and, if you like, the settings folder (see [the table above](#where-things-are-installed)).
4. Delete `~/.claude/commands/buddy.md` if it ends with `<!-- claude-buddy-command -->`.
5. Remove the start-at-login entry: on Windows, `ClaudeBuddy` under *Settings → Apps → Startup*; on macOS, `~/Library/LaunchAgents/io.github.sideswipeishacking.claude-buddy.plist`; on Linux, `~/.config/autostart/claude-buddy.desktop`.
