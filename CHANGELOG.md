# Changelog

## 2.3.0

- **The Overlord, hover vs click.** Hovering it shows only your usage limits, who's working / out / home / asleep, and today's numbers (prompts, tool calls, files edited, minutes worked, sub-agents, busiest buddy). Clicking it brings it all the way out of its corner with every option.
- **New Overlord shows:**
  - **Token stream**: glowing data flows from every working buddy into the Overlord, and a ring around its eye (or a meter by its corner) shows your session usage.
  - **Inspection patrols**: it flies over and scans each buddy, leaving a holographic read-out (status, context, today's numbers). Now and then by itself, or from its options.
  - **Remarks**: dry comments about your usage, late nights, loafing buddies and more.
  - **Holo-report**: today's numbers per buddy, projected across the screen.
  - **Drones**: snacks for everyone, files dropped on the Overlord delivered to the most recently busy buddy, and buddies on other monitors flown over when you gather them.
  - **Weather**: rain, snow and thunderstorms (pick one, or let it happen now and then). Buddies put up umbrellas, snow settles on windows, and idle buddies have snowball fights.
  - **Boss fight**: your buddies take on the Overlord for a minute; click it to help.
- **Fixed:** a buddy could stop showing what Claude was doing (while typing along still worked) after its session was restarted by the Claude app under the same id. Sessions now carry on as the same session, a session that ends waits 45 seconds before its buddy walks home, and buddies are re-linked to their session on every event.
- **Fixed:** a game of fetch or the walk home could, in rare cases, keep a buddy busy for good; both now find a way to finish.
- **Fixed:** the click safety net from 2.1.1 could mistake a click on the taskbar (or another always-on-top window) above a buddy for a missed click and rebuild the overlay. It now checks what is really under the pointer.

## 2.2.0

- **A wider skyscraper** (about 2.4x as wide) with rooms you furnish yourself: wall and floor colours, curtains, and up to 10 pieces from 40 (beds, desks, a gaming setup, couches, bookshelves, a piano, an aquarium, a server rack, plants, a cat, paintings, a neon sign, fairy lights, rugs…). Drag them where you want them; little things can sit on furniture and wall decor can hang at any height. Rooms decorated in 2.1 keep their look.
- Buddies at home stroll around their rooms.
- **Fixed:** at 125% display scaling the rooms were drawn slightly wider than the building.

## 2.1.1

- **Fixed:** buddies, the Overlord's panel and the skyscraper could stop taking left-clicks (right-clicks and hovering still worked) until Claude Buddy was restarted. Skyscraper buttons now act when you let go of the mouse rather than when you press it, the overlay never turns click-through in the middle of a click, and if an overlay ever stops seeing left presses anyway, Claude Buddy notices and resets it on its own (the event is noted in `error.log`).

## 2.1.0

- **The skyscraper.** Every buddy has a floor in a little tower at the bottom-left of the main screen: lit while it's home, dark while it's out. A switch on each floor turns that buddy on or sends it home, and it takes the glass elevator either way. The tower sinks into the ground when you don't need it (click its roof to bring it up). Click a window to decorate the room.
- **Printing is for new buddies only.** Buddies you've met before come out of the skyscraper instead of being built again, and walk back home when you send them off, when their session ends, or when you quit.
- **The Overlord's panel.** Hovering the Overlord now shows its options (gather, wake everyone, the skyscraper, demo, gallery, settings, sizes, quit) next to your usage. Clicking it does nothing any more, and its menu is gone.
- **A life between jobs.** Idle buddies look each other up much more often, even across screens, and have little conversations in speech bubbles.
- **Shake to wake** a napping buddy (or use the new **Wake up** menu item / *Wake everyone*). Don't shake too hard.
- **Wardrobe:** 18 new hats, 22 new accessories and 5 new colours.
- **Fixed:** feeding files through the Open dialog stopped working in the Claude app and IDEs.
- **Fixed:** a game of fetch ended as soon as you picked the buddy up; it now goes after the ball until it has it.
- **Fixed:** at large sizes the Overlord clipped into the side of the screen; it now keeps its distance at any size.
- **Fixed:** the first *Customize…* after starting could open nothing (or open behind the buddies).
- **Fixed:** the welcome sign after a buddy is built stopped before it was finished.
- **Fixed:** after restarting the app, a buddy turned back on wasn't reconnected to its session (no typing along, clicks didn't find the window) until you ran `/buddy` again.
- **Fixed:** clicking a buddy from an IDE didn't open that project's folder in the IDE the way it does for the Claude app.

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
