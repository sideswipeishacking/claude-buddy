# Changelog

## 2.0.2

- **Windows + the Store version of the Claude app:** everything a Claude app session starts runs inside the app's sandbox, which keeps a private copy of AppData. Claude Buddy started from there (a `/buddy` when the app wasn't running, or first-time setup) saved its buddies, settings and even parts of its install into that private copy, so they could seem to reset depending on how it was started. The app and its setup now always start outside the sandbox (through Windows' WMI), and the installer moves itself outside when it's run from inside it.
- **Fixed:** clicking a buddy didn't bring its session to the front on Windows since 2.0.0.

## 2.0.1

- When a session doesn't have the plugin loaded yet (it was open when you installed or updated it), `/buddy` now tells you to run `/reload-plugins` instead of starting a new session. The install guide and troubleshooting say the same.

## 2.0.0

The open-source release.

- **Windows, macOS and Linux.** A new platform layer (window list, focus, mouse, clipboard, key presses) for each OS; X11/XWayland on Linux.
- **Any Claude Code client.** Buddies find their session's window by walking up from the session's process: any terminal, any VS Code-family IDE with the Claude Code extension (with a direct link to the session's tab), JetBrains IDEs, and the Claude app (opening the exact conversation).
- **Install from the plugin marketplace.** This repository is its own marketplace. The first `/buddy` installs the desktop app, and plugin updates update it. One-command alternative: `npx github:sideswipeishacking/claude-buddy`.
- **`claude-buddy` CLI**: `install`, `setup`, `start`, `stop`, `status`, `doctor`, `uninstall [--purge]`.
- Dropped files go straight into the session's prompt box.
- The usage limit is now an event. Interrupted sessions are told to carry on once it resets.
- Fullscreen apps: buddies stay hidden unless something needs you (permission, question, done, 90% context).
- Stay put really stays (floor, walls, ceiling, mid-air).
- Robustness: one misbehaving buddy can no longer freeze the others; repeated errors are logged once a minute.

## 1.x

Private versions: the buddies, their animations, helpers for sub-agents, the Buddy Workshop, permission buttons, the context ring, the Overlord with usage limits, feeding files, typing along, multi-monitor sizes, walls and ceilings.
