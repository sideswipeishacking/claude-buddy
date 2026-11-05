# Commands

- [`/buddy` in Claude Code](#buddy-in-claude-code)
- [The buddy menu (right-click)](#the-buddy-menu-right-click)
- [The Overlord's panel](#the-overlords-panel)
- [The skyscraper](#the-skyscraper)
- [The tray icon](#the-tray-icon)
- [The `claude-buddy` CLI](#the-claude-buddy-cli)
- [Environment variables](#environment-variables)

## `/buddy` in Claude Code

All `/buddy` commands are handled by the plugin's hook. They never reach the model, cost no tokens and answer immediately. `/claude-buddy:buddy` is the same command under its plugin name.

| Command | What it does |
| --- | --- |
| `/buddy` | Summon a buddy for this session (installs the app the first time). A buddy you've met before comes out of the skyscraper |
| `/buddy off` | Send it home to the skyscraper (also: `bye`, `dismiss`, `away`, `stop`) |
| `/buddy name <nickname>` | Give it a nickname (shown on hover and on its floor) |
| `/buddy hat <hat>` | Change its hat, e.g. `/buddy hat wizard` |
| `/buddy custom` | Open the Buddy Workshop (also: `customize`, `look`, `wardrobe`, `style`) |
| `/buddy helpers on` · `/buddy helpers off` | Show or hide helper buddies for this session's sub-agents |
| `/buddy size <1-12>` | Pixel size on the kind of screen the buddy is on |
| `/buddy size laptop <1-12>` | Pixel size on a laptop's built-in screen |
| `/buddy size external <1-12>` | Pixel size on other monitors |

**Hats:** wizard, hardhat, crown, sprout, ninja, headset, cap, bow, tophat, beanie, cowboy, chef, party, viking, pirate, santa, propeller, halo, horns, bunny, cat, gradcap, beret, fez, tiara, mushroom, antenna, bandana, witch, detective, sombrero, knight, jester, flowercrown, police, firefighter, unicorn, ufo, raincloud, frog, pumpkin, eggshell, duck, laurel, bucket, mohawk.

The default sizes are **2** on a laptop's own screen and **4** on other monitors. A buddy resizes as it walks from one to the other.

## The buddy menu (right-click)

| Item | What it does |
| --- | --- |
| **Customize…** | Open the Buddy Workshop for this buddy |
| **Decorate its room…** | The Workshop's Room tab: its floor in the skyscraper |
| **Wake up** | Wake it from a nap (a gentle shake works too) |
| **Come here** | Click anywhere to plant a flag; the buddy goes there (right-click cancels) |
| **Stay put** | It stays exactly where it is: no wandering, and wherever you drop it, it stays |
| **Show helpers** | Helper buddies for sub-agents on/off |
| **Give a snack** | A treat for your hard-working buddy |
| **Play fetch** | Throw a ball for it |
| **Open project folder** | Open the session's working folder |
| **Mute this buddy** | Silence its sounds |
| **Hide for…** | 5, 10, 30 or 60 minutes (it comes back early if Claude needs you) |
| **Send home** | Same as `/buddy off` |

**Mouse:** hover for the card, click to jump to the session, drag to move, fling to throw, shake a little to wake it.

## The Overlord's panel

Hover the **top-left corner** of your screen. The panel stays open while the pointer is on it:

- **Usage**: the current session (5-hour) and weekly limits, with reset times.
- **Gather everyone**: plant a flag and they all come.
- **Wake everyone**: for when they've all dozed off.
- **Show / tuck away the skyscraper**.
- **Summon a demo buddy**: a fake session that shows off the animations.
- **Animation gallery**: every animation, for the curious (this one *is* a spoiler).
- **Settings**: sound effects, type along, a buddy for every session automatically (no `/buddy` needed), start at login, hide all buddies, and the pixel size on the laptop screen and on other monitors.
- **Quit Claude Buddy**: everyone walks home first.

## The skyscraper

The tower at the bottom-left of your main screen has one floor per buddy you've made (oldest at the bottom).

| Part | What it does |
| --- | --- |
| **The roof** (when tucked away) | Click it to bring the skyscraper up |
| **▼ on the roof** | Tuck it back into the ground |
| **The switch** left of a floor | Turn that buddy on (it rides down and heads out) or send it home |
| **A window** | Decorate that room (opens the Workshop's Room tab) |

A lit window means the buddy is home. In the Room tab, **Move out** forgets a buddy for good.

## The tray icon

The tray (Windows/Linux) or menu-bar (macOS) icon has the running buddies, the demo, the gallery and the same settings (including showing the skyscraper), in case the Overlord is hiding.

## The `claude-buddy` CLI

Use it through `npx` without installing anything else:

```bash
npx github:sideswipeishacking/claude-buddy <command>
```

or, inside a clone, `node bin/claude-buddy.js <command>`.

| Command | What it does |
| --- | --- |
| `install` *(default)* | Install or update the desktop app and register the plugin with Claude Code |
| `install --github` | Same, but register the GitHub marketplace instead of the local copy |
| `setup` | Install or update only the desktop app (what the plugin runs on first `/buddy`) |
| `start` · `stop` | Start or quit the desktop app |
| `status` | Is it installed, which version, is it running, how many buddies |
| `doctor` | Check Node, npm, Claude Code, the install and the app, with fixes |
| `uninstall` | Remove the plugin, the app, the plain `/buddy` command, autostart and shortcuts |
| `uninstall --purge` | …and your buddies and settings too |

## Environment variables

| Variable | Default | Use |
| --- | --- | --- |
| `CLAUDE_BUDDY_HOME` | see [installation](installation.md#where-things-are-installed) | Where the desktop app is installed |
| `CLAUDE_BUDDY_PORT` | `47321` | The local port the hooks and the app talk on (set it for both) |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code's config folder (Claude Buddy follows it) |
| `ELECTRON_MIRROR` | – | Download Electron from a mirror if GitHub downloads are blocked (see [troubleshooting](troubleshooting.md#electron-wont-download)) |
