# Troubleshooting

Start with the doctor. It checks Node, npm, Claude Code, the install and the app, and tells you what to fix:

```bash
npx github:sideswipeishacking/claude-buddy doctor
```

- [`/buddy` says "Unknown command"](#buddy-says-unknown-command)
- [Claude answers `/buddy` instead of the plugin](#claude-answers-buddy-instead-of-the-plugin)
- [Nothing appears after `/buddy`](#nothing-appears-after-buddy)
- [Electron won't download](#electron-wont-download)
- [The buddy doesn't react to what Claude is doing](#the-buddy-doesnt-react-to-what-claude-is-doing)
- [Clicking a buddy brings up the wrong window](#clicking-a-buddy-brings-up-the-wrong-window)
- [Dropped files don't land in the prompt box](#dropped-files-dont-land-in-the-prompt-box)
- [The Overlord can't show usage](#the-overlord-cant-show-usage)
- [Linux: no buddies, or a black screen](#linux-no-buddies-or-a-black-screen)
- [macOS: the buddy won't paste or type along](#macos-the-buddy-wont-paste-or-type-along)
- [Logs](#logs)
- [Starting over](#starting-over)

## `/buddy` says "Unknown command"

Right after a marketplace install, the command is `/claude-buddy:buddy`. Plain `/buddy` comes from a small personal command file that the first setup adds. If you removed it, run `npx github:sideswipeishacking/claude-buddy setup` to add it back.

## Claude answers `/buddy` instead of the plugin

Claude replying "the Claude Buddy plugin isn't active in this session" means the plugin's hooks haven't been loaded in this session. A session loads its plugins when it starts, so a session that was already open when you installed or updated the plugin doesn't have them yet. Run:

```
/reload-plugins
```

and then `/buddy` again (or start a new session). Check that the plugin is enabled with `/plugin` → *Installed*.

## Nothing appears after `/buddy`

- **First time?** Setup downloads about 100 MB in the background and builds your buddy when it's done. Give it a minute or two. Progress is written to `setup.log` in the [install folder](installation.md#where-things-are-installed).
- **Is the app running?** `npx github:sideswipeishacking/claude-buddy status`. Start it with `… start`, or from the Start menu / app launcher.
- **Is Node.js on the PATH Claude Code sees?** The hooks run `node`. If you installed Node after starting your terminal, IDE or the Claude app, restart it.
- **Hidden?** Check *Hide buddies* in the Overlord's Settings or the tray menu, and whether a fullscreen app is running on that screen.

## Electron won't download

Some networks block GitHub's release downloads, where Electron comes from. Point Electron at a mirror and run the setup again:

```bash
# macOS / Linux
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" ELECTRON_CUSTOM_DIR="{{ version }}" npx github:sideswipeishacking/claude-buddy setup
```

```powershell
# Windows (PowerShell)
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; $env:ELECTRON_CUSTOM_DIR='{{ version }}'; npx github:sideswipeishacking/claude-buddy setup
```

Electron's installer still verifies the download against the official checksums.

## The buddy doesn't react to what Claude is doing

- The session must have the plugin loaded: start it after installing the plugin, or run `/reload-plugins` in it.
- Each session needs its own `/buddy`, unless you turned on *Buddy for every session* in Settings.
- If another tool also uses port `47321`, set `CLAUDE_BUDDY_PORT` to something else, for both Claude Code and the app.

## Clicking a buddy brings up the wrong window

- With several windows of the same program, the buddy picks the window whose title contains the session's **project folder name**. Show the folder name in your terminal's title, or open one project per IDE window.
- In terminals with several **tabs**, the window comes forward but the tab might not switch.
- Sessions inside **tmux/screen** can't be matched to a window.
- On **macOS**, apps decide which of their windows comes forward; allowing Screen Recording lets Claude Buddy read window titles.

## Dropped files don't land in the prompt box

- If the buddy's card says the files are on your **clipboard**, paste them yourself (`Ctrl+V` / `⌘V`). That happens for sessions in an IDE's built-in terminal panel or inside tmux, and on macOS without Accessibility permission.
- The session's app has to come to the front. If another window grabs focus at that moment, the buddy doesn't paste.
- In the Claude app the files arrive as attachments and/or `@file` mentions; in terminals and IDE panels, as `@file` mentions. Claude Code reads the files when you send the message.

## The Overlord can't show usage

The card shows the reason:

- *Not signed in to Claude Code*: usage needs a Claude subscription login (not an API key). Sign in with `/login` in Claude Code.
- *Login expired*: open Claude Code once; it refreshes the login.
- On macOS, allow the "Claude Code-credentials" keychain prompt (choose *Always Allow*).
- *Usage unavailable (4xx/5xx)*: the usage service didn't answer. It retries every few minutes.

## Linux: no buddies, or a black screen

- You need **X11 or XWayland**. Under pure Wayland without XWayland, the overlay can't float or be transparent.
- A black, opaque overlay means there's no compositor. Enable compositing in your desktop settings (most desktops have it on by default).
- If Electron exits right away, run `~/.local/share/claude-buddy/node_modules/electron/dist/electron --no-sandbox ~/.local/share/claude-buddy` in a terminal to see the error. It's usually a missing library (see [platforms](platforms.md#linux)).

## macOS: the buddy won't paste or type along

Open **System Settings → Privacy & Security** and allow Claude Buddy (it may be listed as *Electron*) under **Accessibility** (pasting) and **Input Monitoring** (type along). Then quit Claude Buddy from the menu-bar icon and start it again.

## Logs

The settings folder ([where](installation.md#where-things-are-installed)) has:

- `error.log`: errors from the app (the same error is logged at most once a minute).
- `events.log`: the timing of hook events (event names only, nothing from your sessions).

The install folder has `setup.log` from installs and updates.

When you share logs in an issue, look through them first: they can include folder names from your computer.

## Starting over

```bash
npx github:sideswipeishacking/claude-buddy uninstall --purge
npx github:sideswipeishacking/claude-buddy
```
