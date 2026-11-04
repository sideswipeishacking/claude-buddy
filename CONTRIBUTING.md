# Contributing

Thanks for wanting to make the buddies better! Bug reports, platform reports, new hats, accessories and animations, and code are all welcome.

## Reporting a bug

[Open an issue](https://github.com/sideswipeishacking/claude-buddy/issues/new/choose) with:

- your OS and version, and where Claude Code runs (terminal, IDE + extension, Claude app),
- what you did, what you expected, what happened,
- the output of `npx github:sideswipeishacking/claude-buddy doctor`,
- relevant lines from `error.log` (see [troubleshooting](docs/troubleshooting.md#logs)).

**Before pasting logs or screenshots, remove anything personal:** your user name in folder paths, project names, window titles.

## macOS and Linux reports

Windows is the most tested platform. If you use Claude Buddy on macOS or Linux, even a short "works on Fedora 41 / GNOME / X11" or "on macOS 15 the buddy can't paste" helps a lot. Mention your desktop environment and whether you're on X11 or Wayland.

## Making changes

1. Fork, then clone your fork.
2. `npm install`, then turn on the privacy check for your commits:
   ```bash
   git config core.hooksPath .githooks
   ```
3. Make your change. Keep the existing style: plain CommonJS, no build step, small focused functions, comments that explain *why*.
4. Run the tests: `npm test` (and `node tools/headless-test.js` if you touched behaviour).
5. Try it for real: `npm start`, or `node bin/claude-buddy.js install` to run it with your Claude Code sessions. The [development guide](docs/development.md) has the debug routes.
6. Open a pull request describing what changed and how you tested it.

### Good first contributions

- New hats or accessories (`app/sprites.js`; preview with `node tools/preview.js out.png <hat>`).
- Window matching for a terminal or IDE that isn't recognised yet (`app/deliver.js`, `app/sessions.js`).
- Docs: clearer setup notes for your OS or desktop.

## Ground rules

- **Privacy first.** Claude Buddy must keep working without sending anything anywhere except the usage check. Don't add analytics, remote assets or new network calls. The keyboard watcher must never learn which key was pressed.
- **Never block Claude Code.** Hooks must fail silently and quickly when the app isn't there.
- **Degrade gracefully.** On a platform or setup that can't do something, skip that feature; don't break the rest.
- Be kind. This is a toy that's meant to make people smile.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
