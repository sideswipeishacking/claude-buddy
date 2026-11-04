# Getting started

This is a short tour. It covers what you can *do* with your buddies and leaves most of what they *do on their own* for you to discover.

- [1. Summon your first buddy](#1-summon-your-first-buddy)
- [2. Watch it work](#2-watch-it-work)
- [3. Hover, click, drag](#3-hover-click-drag)
- [4. When Claude needs you](#4-when-claude-needs-you)
- [5. Meet the Overlord](#5-meet-the-overlord)
- [6. Make it yours: the Buddy Workshop](#6-make-it-yours-the-buddy-workshop)
- [7. Feed it files](#7-feed-it-files)
- [8. More than one session](#8-more-than-one-session)
- [9. Sending a buddy home](#9-sending-a-buddy-home)

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
- **Right-click** for its menu: Customize, Come here, Stay put, helpers on/off, a snack, a game of fetch, open the project folder, mute, hide for a while, send home. See [commands](commands.md#the-buddy-menu-right-click).

*Come here* asks you to click where it should go: a little flag marks the spot and it makes its way there. *Stay put* makes it stay exactly where it is, even mid-air or upside down on the ceiling.

## 4. When Claude needs you

Your buddy is the polite way to notice Claude is waiting:

| You see | It means |
| --- | --- |
| `!` | Claude is asking for **permission** (to run a command, edit a file, …) |
| `?` | Claude asked you a **question** |
| `✓` | Claude **finished** its turn. It stays until you hover or click the buddy |
| a red `%` | the session's context is over **90%** full, so compaction is near |

For permission prompts the buddy shows **Allow / Always / Deny** buttons, both floating above it and in its hover card. Answer there or in Claude Code itself; whichever you use first counts. *Always* adds the same "don't ask again" rule Claude Code would.

If an app is running **fullscreen** (a game, a video, a presentation), buddies on that screen hide, but they still pop up for a permission request, a question, a finished turn, or a nearly full context.

## 5. Meet the Overlord

The first buddy you ever summon gets built by **the Overlord**: a mechanical eye that, afterwards, lives in the **top edge of your screen**. Every now and then it peeks out of the top-left corner to look around.

- **Hover the top-left corner** to see the Overlord's card: your **current session (5-hour) usage** and **weekly usage** with reset times, plus every buddy you've ever made and whether it's on.
- **Click the corner** and the Overlord drops down with a menu. You can turn any buddy on or off (it remembers each one's look and name), reach every buddy's options, gather all buddies at a spot, open the animation gallery, and change settings (sizes, sounds, typing along, start at login).

And if you ever hit your usage limit… well. You'll see.

## 6. Make it yours: the Buddy Workshop

Type `/buddy custom` (or right-click → **Customize…**) to open the Buddy Workshop, an RPG-style character screen with a live preview:

- **Hat:** 28 of them (wizard, crown, hard hat, viking, propeller cap, halo, cat ears…)
- **Hand:** wand, staff, broom, sword, balloon, flag, mug, flower, torch
- **Face, Neck, Back:** glasses, monocle, mustache, scarf, bow tie, capes, wings…
- **Colour:** body and eye colours, including a custom colour picker
- **Size** and the look of its **helpers**

Changes preview live on your desktop. **Equip** keeps them, closing the window throws them away, and **Use as default** makes new buddies start from this look (each still gets its own hat so you can tell them apart). Give it a nickname while you're there.

Quick changes without the Workshop: `/buddy hat crown`, `/buddy name Pixel`, `/buddy size 3`. See [commands](commands.md).

## 7. Feed it files

Drag one or more files from your file manager onto a buddy and let go. It happily eats them, and the files land in **that session's prompt box**, ready for your next message. You don't have to switch windows first.

- In the Claude app and IDE extensions they appear as attachments or `@file` mentions; in a terminal, as `@file` mentions. Claude Code turns either into the file's contents.
- On **Windows** you can also feed it from the Claude app's or your IDE's **"Add files"** dialog: select files and click **Open** while its buddy is around. Try it in both a list view and an icon view.
- On **macOS** this needs Accessibility permission; see [platforms](platforms.md#macos).

## 8. More than one session

Each Claude Code session gets its own buddy, so it's easy to keep an eye on several at once. A few things help:

- Give them nicknames (`/buddy name api`, `/buddy name docs`) so their hover cards and the Overlord's roster are easy to read.
- Different hats are picked automatically, and you can set a default look in the Workshop.
- Separate sizes for your laptop screen and external monitors: `/buddy size laptop 2`, `/buddy size external 4`.
- Buddies that hang around each other get friendly.

## 9. Sending a buddy home

`/buddy off` in the session (or right-click → **Send home**) waits for a little goodbye and then it's gone. Buddies also leave on their own when their session ends. The Overlord remembers them, so turning one back on from its menu brings it back with the same look and name.

---

Next: [tips & tricks](tips.md) · [commands](commands.md) · [troubleshooting](troubleshooting.md)
