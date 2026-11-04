// A scripted fake Claude Code session, fed through the same event pipeline as
// real hooks. Used by the tray's "Summon a demo buddy" and for testing.
'use strict';

const PROJECTS = ['demo-app', 'website', 'api-server', 'notes', 'game'];

function script(id, project) {
  const base = { session_id: id, cwd: `/projects/${project}`, entrypoint: 'claude-vscode' };
  const tool = (name, input, thought) => [
    { ...base, hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: Math.random().toString(36).slice(2), buddy_thought: thought },
  ];
  const ok = (name) => ({ ...base, hook_event_name: 'PostToolUse', tool_name: name, tool_response: {} });
  const plan = (cur) => ({
    todos: ['Explore the settings code', 'Add the dark theme', 'Fix failing tests', 'Ship it'].map((content, i) => ({
      content, activeForm: content.replace(/^(\w+)/, (w) => ({ Explore: 'Exploring', Add: 'Adding', Fix: 'Fixing', Ship: 'Shipping' })[w] || w),
      status: i < cur ? 'completed' : i === cur ? 'in_progress' : 'pending',
    })),
  });
  return [
    [0, { ...base, hook_event_name: 'UserPromptSubmit', prompt: '/buddy', buddy_command: { action: 'summon' } }],
    [4500, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Add a dark mode toggle to the settings page and make sure the tests pass.' }],
    [3500, ...tool('TodoWrite', plan(0), "I'll start by getting the lay of the land in the settings code.")],
    [3000, ok('TodoWrite')],
    [800, ...tool('Grep', { pattern: 'theme' }, 'Looking for where the theme is decided.')],
    [3500, ok('Grep')],
    [600, ...tool('Read', { file_path: 'settings.tsx' }, 'The settings page already has a preferences section, so the toggle fits there.')],
    [5000, ok('Read')],
    [600, ...tool('TodoWrite', plan(1), 'Now adding the dark theme.')],
    [2500, ...tool('Edit', { file_path: 'theme.css' }, 'Adding dark colour tokens next to the light ones.')],
    [6000, ok('Edit')],
    [500, ...tool('Write', { file_path: 'ThemeToggle.tsx' }, 'Creating a small toggle component.')],
    [5000, ok('Write')],
    [500, ...tool('Bash', { command: 'npm test' }, 'Running the tests to see what broke.')],
    [6000, { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', error: 'Exit code 1' }],
    [3000, ...tool('TodoWrite', plan(2), 'Two snapshot tests expect the old colours.')],
    [1500, ...tool('Edit', { file_path: 'settings.test.tsx' }, 'Updating the snapshots for the new theme.')],
    [5000, ok('Edit')],
    [500, ...tool('Task', { description: 'Check accessibility contrast' }, 'Asking a helper to double-check colour contrast while I verify the tests.')],
    [700, ...tool('Task', { description: 'Review the toggle UX' }, 'And another helper to review the toggle.')],
    [6000, ok('Task')],
    [2500, ok('Task')],
    [500, ...tool('Bash', { command: 'npm test' }, 'Running the tests again.')],
    [6000, ok('Bash')],
    [500, ...tool('TodoWrite', plan(3), 'All green. Committing the change.')],
    [1500, ...tool('Bash', { command: 'git commit -am "Add dark mode"' }, 'Committing the change.')],
    [4000, ok('Bash')],
    [800, { ...base, hook_event_name: 'Stop', buddy_thought: 'Dark mode is in, with a toggle on the settings page, and all tests pass.' }],
  ];
}

let counter = 0;

/** Play a demo session; `send` receives each event. Returns the session id. */
function runDemo(send) {
  counter++;
  const id = `demo-${Date.now().toString(36)}-${counter}`;
  const project = PROJECTS[(counter - 1) % PROJECTS.length];
  let t = 0;
  for (const [delay, ...events] of script(id, project)) {
    t += delay;
    for (const ev of events) setTimeout(() => send(ev), t);
  }
  return id;
}

module.exports = { runDemo };
