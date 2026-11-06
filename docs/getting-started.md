# Getting started

This is a short tour. It covers what you can *do* with your buddies and leaves most of what they *do on their own* for you to discover.

- [1. Summon your first buddy](#1-summon-your-first-buddy)
- [2. Watch it work](#2-watch-it-work)
- [3. Hover, click, drag](#3-hover-click-drag)
- [4. When Claude needs you](#4-when-claude-needs-you)
- [5. Meet the Overlord](#5-meet-the-overlord)
- [6. The skyscraper](#6-the-skyscraper)
- [7. Make it yours: the Buddy Workshop](#7-make-it-yours-the-buddy-workshop)
- [8. Feed it files](#8-feed-it-files)
- [9. More than one session](#9-more-than-one-session)
- [10. Sending a buddy home](#10-sending-a-buddy-home)

## 1. Summon your first buddy

With Claude Buddy [installed](installation.md), open a **new** Claude Code session anywhere (a terminal, your IDE's Claude Code panel, or the Claude app) and type:

```
/buddy
```

(Right after a fresh marketplace install, use `/claude-buddy:buddy` the first time; plain `/buddy` works from the next session on.)

`/buddy` is handled entirely by the plugin: it never reaches Claude, costs no tokens and answers instantly. Your buddy gets built in the middle of the screen you're using, then drops down and makes itself at home.

Each session has its own buddy. If you `/buddy` in a session that already has one, nothing changes.

## 2. Watch it work

Give Claude something to do and keep an eye on the buddy. It mirrors the session:

- what kind of work Claude is doing (reading, searching, editing, running commands, tests, builds, git, the web, planning…),
- whether Claude is thinking, waiting on you, or finished,
- sub-agents: each one Claude starts shows up as a small **helper** that follows your buddy around.

When nothing is happening it lives its own life on your desktop. Leave it alone for a while and see what it gets up to.

## 3. Hover, click, drag

- **Hover** a buddy to see its name and a card with its session's status: the current step of Claude's plan, Claude's latest thought, how long it's been working, and a **context ring** showing how full the session's context window is.
- **Click** a buddy to jump to its session: it brings the right terminal, IDE window or Claude app conversation to the front. (In an IDE with the Claude Code extension it opens that exact session's tab.)
- **Drag** a buddy to move it. Let go mid-fling and you'll throw it.
- **Shake** it gently while holding it to wake it up if it's napping. (Gently.)
- **Right-click** for its menu: Customize, decorate its room, wake up, Come here, Stay put, helpers on/off, a snack, a game of fetch, open the project folder, mute, hide for a while, send home. See [commands](commands.md#the-buddy-menu-right-click).

When they have nothing to do, buddies look each other up (even on another screen) and hang out for a bit.

*Come here* asks you to click where it should go: a little flag marks the spot and it makes its way there. *Stay put* makes it stay exactly where it is, even mid-air or upside down on the ceiling.

## 4. When Claude needs you

Your buddy is the polite way to notice Claude is waiting:

| You see | It means |
| --- | --- |
| `!` | Claude is asking for **permission** (to run a command, edit a file, …) |
| `?` | Claude asked you a **question** |
| `✓` | Claude **finished** its turn. It stays until you hover or click the buddy (which jumps up at your cursor to make sure you notice) |
| a red `%` | the session's context is over **90%** full, so compaction is near |

For permission prompts the buddy shows **Allow / Always / Deny** buttons, both floating above it and in its hover card. Answer there or in Claude Code itself; whichever you use first counts. *Always* adds the same "don't ask again" rule Claude Code would.

If an app is running **fullscreen** (a game, a video, a presentation), buddies on that screen hide, but they still pop up for a permission request, a question, a finished turn, or a nearly full context.

## 5. Meet the Overlord

Every brand-new buddy gets built by **the Overlord**: a mechanical eye that, afterwards, lives in the **top edge of your screen**. Every now and then it peeks out of the top-left corner to look around.

**Hover the top-left corner** for its card: your **current session (5-hour) usage** and **weekly usage** with reset times, how many buddies are working, out and at home, and **today's numbers** (prompts, tool calls, files edited, minutes worked, sub-agents, your busiest buddy).

**Click it** and it comes all the way out of its corner with its options:

- **Gather everyone** at a spot. Buddies on another monitor get flown over by drone.
- **Wake everyone**.
- **Inspection patrol**: it flies over and scans each buddy, leaving a little holographic read-out above it. It also does this by itself now and then.
- **Holo-report**: today's numbers per buddy, projected big. Click it to close.
- **Snacks by drone**.
- **Boss fight!** Your buddies take on the Overlord; click it to help them land hits.
- **Weather**: rain, snow or a thunderstorm (or let it decide now and then).
- Show or tuck away the skyscraper, a demo buddy, the animation gallery.
- **Settings**: sounds, typing along, the token stream (glowing data flowing from busy buddies into the Overlord), its remarks, patrols, a buddy for every session, start at login, hide buddies, and the pixel sizes.
- **Quit** (everyone goes home first).

Drop files on the Overlord and a drone delivers them to the buddy that was busy most recently.

And if you ever hit your usage limit… well. You'll see.

## 6. The skyscraper

Buddies don't vanish when they're off duty: they live in **the skyscraper** at the bottom-left of your main screen, one floor each (oldest at the bottom).

- It's tucked into the ground until you want it. **Click the little roof** that peeks out to bring it up; the **▼ button** on the roof tucks it away again. It also pops up by itself whenever someone comes or goes.
- A **lit window** means that buddy is home; a **dark** one means it's out on your desktop.
- The **switch** on the left of each floor turns that buddy on (it rides down and heads out to work) or off (it walks home and rides up).
- **Click a window** to furnish the room (or open the Workshop's **Room** tab): wall and floor colours, curtains, and up to 10 pieces of furniture and decor. Pick a piece to add it, then drag it where you want it. Little things (a plant, a lamp, the cat) and wall decor can go up and down too, so they can sit on a desk or hang anywhere on the wall. While it's home, the buddy strolls around its room.

Only brand-new buddies get built by the Overlord; ones you've met before simply come out of the skyscraper.

## 7. Make it yours: the Buddy Workshop

Type `/buddy custom` (or right-click → **Customize…**) to open the Buddy Workshop, an RPG-style character screen with a live preview:

- **Hat:** 46 of them (wizard, crown, hard hat, viking, witch, knight, sombrero, UFO, rain cloud, frog, rubber duck…)
- **Hand:** wand, staff, broom, sword, balloon, umbrella, ice cream, magnifier, wrench, trophy, fishing rod…
- **Face, Neck, Back:** glasses, heart glasses, visor, eye patch, beard, scarf, bow tie, medal, lei, capes, wings, backpack, jetpack…
- **Colour:** body and eye colours, including a custom colour picker
- **Size** and the look of its **helpers**
- **Room:** its floor in the skyscraper (see above)

Changes preview live on your desktop. **Equip** keeps them, closing the window throws them away, and **Use as default** makes new buddies start from this look (each still gets its own hat so you can tell them apart). Give it a nickname while you're there.

Quick changes without the Workshop: `/buddy hat crown`, `/buddy name Pixel`, `/buddy size 3`. See [commands](commands.md).

## 8. Feed it files

Drag one or more files from your file manager onto a buddy and let go. It happily eats them, and the files land in **that session's prompt box**, ready for your next message. You don't have to switch windows first.

- In the Claude app and IDE extensions they appear as attachments or `@file` mentions; in a terminal, as `@file` mentions. Claude Code turns either into the file's contents.
- On **Windows** you can also feed it from the Claude app's or your IDE's **"Add files"** dialog: select files and click **Open** while its buddy is around. Try it in both a list view and an icon view.
- On **macOS** this needs Accessibility permission; see [platforms](platforms.md#macos).

## 9. More than one session

Each Claude Code session gets its own buddy, so it's easy to keep an eye on several at once. A few things help:

- Give them nicknames (`/buddy name api`, `/buddy name docs`) so their hover cards and the Overlord's roster are easy to read.
- Different hats are picked automatically, and you can set a default look in the Workshop.
- Separate sizes for your laptop screen and external monitors: `/buddy size laptop 2`, `/buddy size external 4`.
- Buddies that hang around each other get friendly.
- **Forked or continued a chat?** The Claude app runs it as a new session. Its buddy moves over by itself once the old session has gone quiet; to move it right away, type `/buddy take <name>` in the new session (or just `/buddy take`), or right-click the buddy → **Move to session**.

## 10. Sending a buddy home

`/buddy off` in the session (or right-click → **Send home**, or its switch in the skyscraper) and it waves goodbye and walks home to its floor. Buddies also go home on their own when their session ends, and everyone goes home when you quit Claude Buddy. Flip its switch (or `/buddy` again) to bring it back out with the same look and name.

---

Next: [tips & tricks](tips.md) · [commands](commands.md) · [troubleshooting](troubleshooting.md)
