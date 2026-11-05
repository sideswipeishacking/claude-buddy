# Tips & tricks

Small things that make living with buddies nicer.

### Getting around

- **Click a buddy to jump to its session.** Faster than hunting through terminal tabs and editor windows.
- **The `✓` is a to-do list.** A buddy with a `✓` has finished and is waiting for you. Hover or click it to clear it.
- **Hover the top-left corner** any time to see your usage limits and every buddy at a glance.
- **Nickname busy sessions** (`/buddy name api`, `/buddy name tests`) so the roster reads like a dashboard.

### Answering Claude

- **Allow / Always / Deny on the buddy** works even when Claude's window is buried. Move the mouse onto the buddy's card: the buttons are there too.
- **Answer wherever is closer.** The buddy and Claude Code's own prompt are the same question; the first answer wins.
- **Watch the context ring** in the hover card. When the buddy shows a red `%`, the session is close to compacting, which is a good moment to wrap up or start fresh.

### Files

- **Drag files onto a buddy** to put them in its session's prompt box, without switching windows first. Several at once is fine.
- On **Windows**, picking files in the Claude app's or your IDE's "Add files" dialog while the buddy is nearby is more fun than it should be. Try it in an icon view.

### Keeping the peace

- **Stay put** (right-click) parks a buddy exactly where it is, even in mid-air. Great for keeping one next to the window it belongs to.
- **Hide for…** sends a buddy away for a while; it still comes back early if Claude needs you.
- **Mute** silences a single buddy; turn all sounds off in the Overlord's **Settings**.
- **Fullscreen apps are safe.** Buddies hide on that screen and only reappear for things that need you.
- **Sizes per screen**: smaller on the laptop, bigger on the monitor: `/buddy size laptop 2`, `/buddy size external 5`.

### Customising

- In the Workshop, **Use as default** gives every new buddy your favourite outfit (each still gets its own hat).
- **Randomize** in the Workshop is a fun way to meet new looks.
- Helpers (the sub-agent buddies) have their own colour, hat and size in the Workshop.

### Power users

- **A buddy for every session**: click the Overlord → *Buddy for every session*. No more `/buddy`.
- **`npx github:sideswipeishacking/claude-buddy doctor`** checks your whole setup and says what to fix.
- **Run the demo** (click the Overlord → *Summon a demo buddy*) to see what a busy session looks like without spending tokens. Run two, and once they're done working, watch what they get up to.
- **The skyscraper's switches** are the quickest way to bring back a buddy whose session is quiet.
- **Change the port** with `CLAUDE_BUDDY_PORT` if `47321` is taken. Set it where both Claude Code and the app can see it.
