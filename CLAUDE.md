# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Claude Buddy is an Electron desktop app for Windows, macOS and Linux. Pixel buddies roam the desktop, one per Claude Code session, driven by Claude Code hook events. This repository is both a Claude Code **plugin** (`.claude-plugin/plugin.json`, `hooks/`, `commands/`, `scripts/`) and its own **marketplace** (`.claude-plugin/marketplace.json`, `"source": "./"`). The hook forwards events to the app on `127.0.0.1:47321`. User docs are in `README.md` and `docs/`; architecture is in `docs/development.md`.

## Commands

```bash
npm install
npm start                                   # run the app from this folder
npm test                                    # tools/features-test.js + tools/climb-test.js
node tools/headless-test.js                 # behaviour trace for two simulated sessions
node tools/privacy-check.js                 # personal-data scan; must pass before any commit (pre-commit hook in .githooks)
node bin/claude-buddy.js install            # copy to the install dir, npm install, register the plugin (local marketplace)
node bin/claude-buddy.js setup              # update only the installed app (stops/restarts it)
node bin/claude-buddy.js doctor|status|start|stop|uninstall [--purge]
node tools/dialog-test.js [--icons] [--app <dir>]          # Windows only: opens a REAL file dialog on screen
node_modules/electron/dist/electron.exe tools/paste-test.js   # clipboard paste into a Chromium page
claude plugin validate .                    # validate marketplace.json (and .claude-plugin/plugin.json)
```

- There is no test framework: each tool prints `PASS`/`FAIL` lines and exits non-zero on failure. `features-test.js` is one sequential scenario (later sections depend on earlier state), so single checks can't run alone.
- Headless tests fake `Date.now`/`setTimeout`, step `World` in 16 ms ticks and run on any OS. Behaviour is random: to make a buddy hold still in a check, `world.setPinned(b, true)` rather than relying on timing.
- The installed app runs from the install dir (`lib/paths.js`: `%LOCALAPPDATA%\ClaudeBuddy`, `~/Library/Application Support/ClaudeBuddy`, `~/.local/share/claude-buddy`), not this folder. After changing code, run `node bin/claude-buddy.js setup` to see it in the real app. Plugin changes also need a version bump in `package.json`, `.claude-plugin/plugin.json` and `marketplace.json` (keep all three equal; the hook updates the installed app when the plugin is newer) and a new Claude Code session.
- `install` registers `<install dir>/marketplace` (a clean copy without `node_modules`) as the local marketplace, because Claude Code copies the whole marketplace source into its plugin cache.
- A plain `node` process isn't DPI-aware but Electron is. Tools that compare window rects with UI Automation coordinates call `SetProcessDpiAwarenessContext(-4)` first.
- Linux without a desktop: `CLAUDE_BUDDY_OZONE=headless` runs Electron with no visible window (`/debug/capture` still works). Linux launches need `--no-sandbox`.

## Debugging the running app

- `GET /debug/state` returns everything, including each buddy's resolved app.
- `POST /debug/capture` saves overlay PNGs to the temp folder.
- `POST /debug/demo` starts a demo session.
- `POST /debug/hover?id=<session>|overlord` opens a hover card.
- `POST /debug/forget?id=` removes a buddy and its registry entry.
- `POST /debug/act?do=…` triggers behaviours. `do=limit&secs=N&id=<session>` plays the usage-limit show and never sends a real prompt.
- Logs and `state.json` are in Electron's userData (`%APPDATA%\Claude Buddy`, `~/Library/Application Support/Claude Buddy`, `~/.config/Claude Buddy`). `error.log` writes the same message at most once a minute; `events.log` has hook timing only. The install dir has `setup.log`.

## Architecture

Data flows one way: **hook → HTTP → `Sessions` → `World` → overlay renderers.**

- **`scripts/buddy-hook.js`** handles every hook event:
  - It adds an `ev.client` block: the hook's parent pid, entrypoint, `TERM_PROGRAM`, the JetBrains marker, `VSCODE_PID`, Windows Terminal, tmux.
  - It answers `/buddy …` prompts itself with `decision: block`.
  - It holds `PermissionRequest` open (up to 590 s) so the buddy's buttons can answer.
  - On the first `/buddy` without an installed app, it runs `bin/claude-buddy.js setup` detached and posts the pending summon afterwards. On `SessionStart` it updates the app if the plugin is newer.
- **`app/sessions.js`** turns hook JSON into session state and emits events: status, thought, context %, sub-agents, attention, `limit-hit` (`StopFailure` with `error: "rate_limit"`) and `context-high`. `sourceOf`/`kindOf` label the client:
  - `desktop`: the Claude app;
  - `ide`: the Claude Code extension;
  - `ide-terminal`: an IDE's terminal, or JetBrains;
  - `terminal`: a standalone terminal.
- **`app/world.js`** is the simulation in global DIPs. Buddy `mode` decides what `(x, y)` means:
  - `auto`, `air`, `held`, `float`: the feet;
  - `wall`, `ceil`: on a surface;
  - `birth`, `script`, `doom`: animation-driven;
  - `hell`: banished and hidden.

  `think()` is a priority list: hide → limit panic → reaction queue → drag hint → typing → task → hover → work/idle. `world.ov` is the Overlord and `world.doom` the usage-limit state machine. `tick()` isolates each buddy in try/catch and calls `recover()`.
- **`app/main.js`** is the Electron main process: store and registry, the HTTP server and the 60 Hz tick, per-display click-through overlays, menus, usage polling, limit detection and the resume prompt, and the Windows file-dialog watcher.
  - When an event arrives it calls `noteClient()` to resolve the session's app right away. The hook's own process is short-lived, so this can't be done lazily later.
- **`app/platform.js`** is a façade over `win32.js` / `darwin.js` / `linux.js`, all koffi FFI:
  - window list, foreground window, focus, process tree, mouse and modifier state;
  - clipboard, paste/Enter key presses, and the type-along watcher (`keys.js` worker on Windows, optional `uiohook-napi` elsewhere);
  - `coords` says whether window rects are physical pixels (`toDip()` in main converts them) or already DIPs (macOS).
  - File-dialog features (`fileDialogs`, `pressOpen`, `uia-helper.ps1`) are Windows-only.
- **`app/deliver.js`**:
  - `resolveApp(s)` walks up the process tree from `client.pid` to the window-owning app, reads a VS Code-family editor's `product.json` for its name and URL scheme, and renames the session's source (e.g. "Cursor").
  - `openSession()` uses `<scheme>://anthropic.claude-code/open?session=<id>`, `claude://code/continue?session=local_<id>` (mapped through the Claude app's `claude-code-sessions/**/local_*.json` → `cliSessionId`), or focuses the window.
  - `deliver()` pastes files/text and presses Enter only for a submit, after re-checking the foreground. IDE-terminal and tmux sessions get the text left on the clipboard instead.
- **`app/overlay.js`** is the renderer and holds no simulation state. It uses an integer device-pixel raster (`memo()` cache). On Linux it hover-tests the pointer position sent in frames, because click-through windows get no forwarded mouse moves there.
- **`app/sprites.js`** (UMD) is the sprite engine. `BUILD`/`DOOM`/`RISE` timings live in `world.js`; `BUILD` is duplicated in `overlay.js`, so keep them in step.

## Gotchas

- **Never commit personal data.** `tools/privacy-check.js` looks up this machine's home path, account name, hostname and global git identity at run time. Commits must use a GitHub noreply email (repo-local `git config user.email`). Never hard-code personal values in the checker.
- In Git Bash on this project, quoted heredocs still mangle backslashes, so patch files containing `\n` or `\\` with the Edit tool.
- Electron 45's main-process `clipboard` is the async web API (`readText()` returns a Promise). On Windows use `win32.saveClipboard` / `restoreClipboard` / `setClipboard`; those need an owner window (`setClipboardOwner`, set to an overlay) or Chromium apps paste nothing.
- `uprightFrom()` converts a wall/ceiling position to feet and sets mode `air`. Measure with `centre(b)` first, since `centre()` needs the wall/ceiling object.
- The usage-limit `RESUME_PROMPT` must only go to sessions recorded as interrupted (`StopFailure` rate_limit during or shortly before the confirmed limit).
