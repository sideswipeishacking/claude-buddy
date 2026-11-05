# Development

- [Running from source](#running-from-source)
- [How it fits together](#how-it-fits-together)
- [Code map](#code-map)
- [Tests](#tests)
- [Debugging the running app](#debugging-the-running-app)
- [Adding hats, accessories and animations](#adding-hats-accessories-and-animations)
- [Releasing](#releasing)

## Running from source

```bash
git clone https://github.com/sideswipeishacking/claude-buddy.git
cd claude-buddy
npm install
npm start                       # runs the app from this folder
```

To get hook events from Claude Code into your dev copy, install the plugin from this folder:

```bash
node bin/claude-buddy.js install    # copies to the install folder, registers this repo as a local marketplace
```

or point Claude Code at the folder directly: `/plugin marketplace add ./path/to/claude-buddy`. Only one copy of the app can run at a time, because it holds a single-instance lock and port `47321`.

## How it fits together

```
Claude Code session ──hook events──▶ scripts/buddy-hook.js ──HTTP 127.0.0.1:47321──▶ app (Electron main)
                                                                                     │
                                       Sessions (what is each session doing?) ◀──────┤
                                       World (physics, behaviour, the Overlord) ◀────┤
                                                                                     ▼
                                                  one transparent overlay window per display (renderer)
```

1. **The hook** (`scripts/buddy-hook.js`) runs for every Claude Code hook event (`hooks/hooks.json`):
   - It forwards the event to the app, with a small `client` block saying where the session runs.
   - `/buddy …` prompts are handled right there and blocked, so they never reach the model.
   - `PermissionRequest` is synchronous: the hook waits so the buddy's Allow/Always/Deny buttons can answer.
   - On the first `/buddy` it installs the app (`bin/claude-buddy.js setup`), and on `SessionStart` it updates the app if the plugin is newer.
2. **`Sessions`** (`app/sessions.js`) turns raw events into human state: status, plan step, thought, context %, sub-agents, attention (permission/question/done), usage-limit stops, 90% context alerts.
3. **`World`** (`app/world.js`) is the simulation in global screen DIPs:
   - surfaces: floors, window title bars, screen walls and ceilings;
   - each buddy's mode (`auto`, `air`, `held`, `wall`, `ceil`, `float`, `birth`, `script`, `doom`, `hell`) and its priority-ordered `think()`;
   - helpers for sub-agents, the Overlord, and the usage-limit sequence.
4. **Main** (`app/main.js`) owns:
   - the store and buddy registry, the HTTP server and the 60 Hz tick;
   - overlays that take the mouse only while something of ours is under it;
   - menus, the Workshop and the usage polling;
   - limit detection, the resume prompt and the file-dialog watcher (Windows).
5. **The renderer** (`app/overlay.js`) draws frames and holds no simulation state. Sprites are rasterised at a whole number of device pixels per art pixel, so pixel art stays crisp at any display scaling.
6. **The platform layer** (`app/platform.js` → `win32.js` / `darwin.js` / `linux.js`, through koffi FFI) covers the window list, foreground window, focus, process tree, mouse state, clipboard and key presses. Everything is optional; missing pieces degrade gracefully.
7. **`app/deliver.js`** works out each session's app by walking up the process tree from the hook's process to the program that owns a window. It focuses the session through the Claude Code extension's or the Claude app's deep link, and pastes into the prompt box.

## Code map

| Path | What |
| --- | --- |
| `.claude-plugin/` | `plugin.json` and `marketplace.json`: this repo is both the plugin and its marketplace |
| `hooks/hooks.json`, `scripts/buddy-hook.js`, `commands/buddy.md` | The Claude Code plugin |
| `bin/claude-buddy.js` | Cross-platform installer / CLI (`install`, `setup`, `doctor`, …) |
| `lib/` | Shared by the app, CLI and hook: install paths, start at login, starting the app outside the Claude app's sandbox (`launch.js`) |
| `app/main.js` | Electron main process |
| `app/world.js`, `app/sessions.js` | Simulation and session state (no Electron, testable in Node) |
| `app/spectacle.js` | The Overlord's shows, mixed into `World`: its options menu, patrols, remarks, holo-report, drones, weather, boss fight |
| `app/overlay-fx.js` | Draws those shows (and the token stream) on the overlays; particles are functions of the clock, so they cross monitors seamlessly |
| `app/sprites.js` | Sprite engine: poses, faces, hats, accessories, animations, the Overlord |
| `app/overlay.*`, `app/customizer.html`, `app/gallery.html` | Renderers |
| `app/platform.js`, `win32.js`, `darwin.js`, `linux.js`, `keys.js`, `uia-helper.ps1` | OS integration |
| `app/deliver.js` | Session ↔ window matching and pasting into prompt boxes |
| `tools/` | Tests, the privacy check, sprite and art tools |

## Tests

There's no test framework. Each tool is a script that prints `PASS`/`FAIL` lines and exits non-zero on failure:

```bash
npm test                          # features-test + climb-test + life-test + fx-smoke-test
node tools/features-test.js       # the build, Overlord, alerts, helpers, files, dialogs, stay put, usage limit, fullscreen
node tools/climb-test.js          # walls/ceilings, monitor crossing, per-display sizes, landings
node tools/life-test.js           # fetch, shaking, friends chatting, the skyscraper, sessions that carry on, the Overlord's shows
node tools/fx-smoke-test.js       # runs every overlay-fx.js draw function against a fake canvas (catches errors, not looks)
node tools/headless-test.js       # two simulated sessions, prints a behaviour trace
node tools/dialog-test.js [--icons] [--app <dir>]               # Windows: opens a REAL Open dialog for a few seconds
node_modules/electron/dist/electron.exe tools/paste-test.js     # what a Chromium text box receives from the buddy's paste
node tools/privacy-check.js       # personal data / secrets scan (also the pre-commit hook)
```

The headless suites fake time (`Date.now` and `setTimeout`), step the `World` in 16 ms ticks on a fixed two-monitor layout, and run on any OS. Buddy behaviour is random. When a check needs a buddy to hold still, pin it with `world.setPinned(b, true)`.

## Debugging the running app

The app's HTTP server has debug routes:

| Route | What |
| --- | --- |
| `GET /debug/state` | Everything: displays, surfaces, buddies (with the resolved app), the Overlord, usage, registry |
| `POST /debug/capture` | Save PNG screenshots of every overlay to the temp folder |
| `POST /debug/demo` | Start a demo session |
| `POST /debug/hover?id=<session>\|overlord` | Open a hover card (`?id=` closes it) |
| `POST /debug/act?do=…&id=<session>` | `climb`, `cross`, `type`, `throw&vx=&vy=`, `come&x=&y=`, `snack`, `fetch`, `hide&min=`, `drop`, `context`, `place`, `detach`, `usage`, `watchdialog`, `dialogopen`, `limit&secs=30` (the whole usage-limit show with a fake limit; never sends a real prompt) |
| `POST /debug/forget?id=<session>` | Remove a buddy and its registry entry |
| `POST /quit` | Quit |

To test on Linux without a desktop, run with `CLAUDE_BUDDY_OZONE=headless`: Electron's headless display backend, so nothing shows on screen and `/debug/capture` still works.

## Adding hats, accessories and animations

- Hats live in `HATS` / `HAT_ORDER` in `app/sprites.js`, as small pixel grids with a palette. Accessories are in `ACCESSORIES` (hand, face, neck, back).
- The skyscraper's layout is `TOWER` (art pixels) and room decor is `ROOM` (walls, floors, curtains, items with a `floor` / `wall` / `rug` layer) in `app/sprites.js`. A room is `{ wall, floor, curtains, items: [{ k, x, y? }] }`; `normalizeRoom()` clamps it (and converts 2.1 rooms), `roomLayout()` places the items and `roomPixels()` draws it. `World` owns the tower state (`tower`, `goHome`, `leaveHome`, the elevator rides) and `overlay.js` draws it (`drawTower`).
- Conversation lines are in `pickScene()` in `app/world.js`. They're drawn in the 3x5 pixel font (`FONT` in `sprites.js`), so they have to stay upper-case and short.
- Animations are entries in `ANIMS` (a pose or procedural map, a face, fps, frame count and `fx` effects). `ACTIVITY_ANIMS` maps what Claude is doing to sets of animations.
- `node tools/preview.js out.png [hat]` renders every animation into a contact sheet; the Animation gallery in the app shows them live.
- `tools/build-sprites.py` regenerates `app/assets/poses.json` from an SVG pose pack.

## Releasing

1. Bump the version in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (keep them equal; installed apps update when the plugin's version is newer).
2. `npm test` and `node tools/privacy-check.js`.
3. Update `CHANGELOG.md`, commit, tag `vX.Y.Z`, push.

**Publishing safely:** commit with a GitHub *noreply* identity (`git config user.email <id>+<username>@users.noreply.github.com`; your exact address is under GitHub → Settings → Emails). Enable the pre-commit privacy check once per clone: `git config core.hooksPath .githooks`.
