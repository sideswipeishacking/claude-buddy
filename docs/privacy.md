# Privacy

Claude Buddy is a local desktop toy. It has no accounts, servers, analytics or telemetry. This page lists everything it reads, keeps and sends.

## What leaves your computer

**One request, to Anthropic, for your usage limits.** The Overlord's card shows your session and weekly usage. To get them, the app calls `https://api.anthropic.com/api/oauth/usage` with the login Claude Code already saved (the same request Claude Code's own `/usage` makes), every few minutes while it's running. The login token is read when needed, sent only to `api.anthropic.com`, and never stored, copied or logged by Claude Buddy.

The setup also downloads Electron and npm packages when you install or update, like any npm install.

Nothing else goes over the network.

## What stays on your computer

| What | Why | Where it goes |
| --- | --- | --- |
| **Claude Code hook events**: event names, tool names and inputs, permission details, the text of your prompts, session id, working folder, transcript path | To animate the session and show its status (the card shows the task from your prompt) | Sent by the hook to the app on `127.0.0.1` only. Kept in memory |
| **The end of the session transcript** | The buddy's card shows Claude's latest thought, and the context ring needs token counts | Read locally, never stored |
| **Which app the session runs in**: the process ID the hook ran from, `TERM_PROGRAM`, the editor's process ID, whether it's Windows Terminal or tmux | To find the session's window | Kept in memory |
| **Your window list**: positions, titles, program names | Buddies walk on title bars and avoid fullscreen apps | Read every fraction of a second, kept in memory |
| **Keyboard**: only *whether* you pressed a letter-ish key, Backspace or Enter, never which key, and nothing while you hold Ctrl/Alt/Cmd | *Type along* | Not stored. On macOS it's off unless you turn it on |
| **Clipboard** | When you drop files on a buddy (or after the usage limit), it briefly puts text on the clipboard to paste it, then puts your clipboard back | Not stored |
| **Your buddies**: names, looks, which session they belong to, the project folder | So buddies keep their looks and the Overlord can list them | `state.json` in the settings folder |
| **Logs**: errors, and the timing of hook events (names only) | Troubleshooting | `error.log` and `events.log` in the settings folder |

The settings folder is listed in [installation](installation.md#where-things-are-installed). Uninstall with `--purge` to remove it.

## Things Claude Buddy can do on your computer

So you're never surprised:

- **Bring windows to the front** when you click a buddy, or when it delivers dropped files.
- **Paste and press Enter** in a Claude Code session's prompt box: when you drop files on a buddy (no Enter), and once after a usage limit resets for sessions the limit interrupted (with Enter). It only does this after checking the right app is in front, and never in an IDE's built-in terminal panel.
- **Answer a permission prompt**, only when you press Allow, Always or Deny on the buddy.
- **Press "Open"** in a file dialog (Windows), after you clicked Open or pressed Enter there yourself.

## Open source

All of this is in the code: the hook is [`scripts/buddy-hook.js`](../scripts/buddy-hook.js), the network call is `fetchUsage` in [`app/main.js`](../app/main.js), the keyboard watcher is [`app/keys.js`](../app/keys.js) (Windows) and `keyWatcher` in [`app/platform.js`](../app/platform.js).
