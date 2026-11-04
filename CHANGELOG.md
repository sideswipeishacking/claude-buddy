# Changelog

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
