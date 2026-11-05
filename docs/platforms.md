# Platforms

Claude Buddy runs on **Windows**, **macOS** and **Linux**, with Claude Code in a **terminal**, an **IDE** or the **Claude desktop app**. Browsers (claude.ai on the web) are not supported: a web page can't run Claude Code's hooks.

- [How a buddy finds its session's window](#how-a-buddy-finds-its-sessions-window)
- [Claude Code clients](#claude-code-clients)
- [Windows](#windows)
- [macOS](#macos)
- [Linux](#linux)

## How a buddy finds its session's window

Each Claude Code session tells its buddy which process it runs in. The app walks up from there to the program that owns a window: your terminal, your IDE or the Claude app. That's how it knows which window to bring forward when you click the buddy, which buddy to animate while you type, and where to paste files you drop on it.

When several sessions share one program (terminal tabs, several IDE windows, conversations in the Claude app), it picks the one whose project name is in the window title, else the most recently active one.

## Claude Code clients

| Client | Click to jump | Drop files into the prompt | Notes |
| --- | --- | --- | --- |
| **Claude app** (Windows, macOS) | ✅ opens that exact conversation | ✅ | Uses the app's `claude://code/continue?session=…` link |
| **VS Code-family IDE** with the Claude Code extension: VS Code, Cursor, Windsurf, Antigravity, VSCodium, … | ✅ opens that exact session's tab | ✅ | Uses the extension's `<editor>://anthropic.claude-code/open?session=…` link; the editor's own URL scheme is read from its `product.json` |
| **A standalone terminal**: Windows Terminal, PowerShell, cmd, macOS Terminal, iTerm2, WezTerm, Ghostty, kitty, Alacritty, GNOME Terminal, Konsole, … | ✅ its window | ✅ | With several tabs, the window comes up but the tab may not be the session's |
| **An IDE's built-in terminal** (VS Code terminal, JetBrains terminal) | ✅ the IDE window | 📋 left on your clipboard | The buddy can't be sure the terminal panel has focus, so it never pastes into your editor; paste it yourself |
| **tmux / screen** | – | 📋 left on your clipboard | The multiplexer hides which terminal window you're in |

## Windows

Everything is supported, including:

- feeding files to a buddy from the **"Open" / "Add files or photos"** dialog of the Claude app or your IDE (list, details and icon views),
- real file attachments when you drop files on a buddy (plus `@file` mentions),
- type along without any permission prompts.

Windows 10 and 11, with any display scaling and any number of monitors.

**The Microsoft Store version of the Claude app** runs everything its sessions start inside a sandbox with a private copy of `AppData`. Claude Buddy always starts itself (and its setup) outside that sandbox through Windows' WMI service, so your buddies and settings are the same whether the app was started from a Claude app session, a terminal or at login.

## macOS

> macOS support is new. If something looks off, please [open an issue](https://github.com/sideswipeishacking/claude-buddy/issues) with your macOS version.

**Permissions** (System Settings → Privacy & Security). Every one is optional; without it, only that feature is missing:

| Permission | What it's for | Without it |
| --- | --- | --- |
| **Accessibility** | Pasting dropped files (and the after-limit prompt) into Claude's prompt box | The text is left on your clipboard and the buddy asks you to press ⌘V |
| **Input Monitoring** | *Type along* (off by default; turn it on in the Overlord's Settings) | The buddy doesn't type along |
| **Screen Recording** | Reading other windows' *titles*, to tell several windows of one app apart | Window positions still work; with several windows of one app, the app picks which one comes forward |
| **Keychain: "Claude Code-credentials"** | Reading your usage limits with Claude Code's login (macOS asks the first time; choose *Always Allow*) | The Overlord's card can't show usage |

**Other notes**

- Buddies float over fullscreen apps and on every Space.
- Clicking a buddy activates its app (macOS decides which of the app's windows comes forward).
- No Dock icon; Claude Buddy lives in the menu bar.
- Feeding files from the "Open" dialog is Windows-only for now.

## Linux

> Linux support is new and has been tested under X11/XWayland. Reports from your distribution and desktop are welcome.

- **X11 or XWayland is required** for the buddies' overlay to float and click through. On a Wayland desktop, Claude Buddy automatically runs under XWayland.
- **Windows as ledges:** buddies walk on the title bars of X11 and XWayland windows. Native Wayland windows are invisible to it, so on a Wayland desktop buddies mostly stay on the screen edges and taskbar.
- **Pasting** uses XTest (part of every X11 install): `Ctrl+V` in apps, `Ctrl+Shift+V` in terminals.
- **Type along** uses the optional `uiohook-napi` package, which installs automatically where it can.
- **Sandbox:** Ubuntu 24.04+ restricts Chromium's sandbox for apps in your home folder, so Claude Buddy starts with `--no-sandbox`. It only ever loads its own local pages.
- **Libraries:** Electron needs the usual desktop libraries (`libnss3`, `libgtk-3-0`, `libgbm1`, `libasound2`, `libxtst6` on Debian/Ubuntu). Every desktop install has them.
- There is no official Claude desktop app for Linux, so Linux sessions are terminals and IDEs.
