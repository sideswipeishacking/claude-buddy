// Turns Claude Code hook events into per-session state in human terms:
// what kind of work is happening, which plan step it's on, and the last thing
// Claude said ("thought"). Emits events the world uses to drive animations.
'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const LABELS = {
  thinking: 'Thinking it through',
  deepThought: 'Deep in thought',
  planning: 'Planning the next steps',
  reading: 'Reading up on the code',
  searching: 'Looking for the right spot',
  scroll: 'Following a skill guide',
  coding: 'Writing code',
  building: 'Creating new files',
  debugging: 'Fixing a bug',
  testing: 'Running the tests',
  lifting: 'Building / installing',
  git: 'Working with git',
  launch: 'Shipping it',
  servers: 'Talking to servers',
  terminal: 'Running commands',
  web: 'Researching online',
  browsing: 'Using the browser',
  tools: 'Using its tools',
  delegating: 'Delegating to helpers',
  asking: 'Has a question for you',
  compacting: 'Tidying up its memory',
  idle: 'Waiting for your next prompt',
};

function classifyCommand(cmd) {
  const c = String(cmd || '').toLowerCase();
  if (/\b(pytest|jest|vitest|mocha|unittest|phpunit|rspec)\b|\b(npm|pnpm|yarn|bun) (run )?test\b|\b(cargo|go|dotnet|mvn|gradle) test\b/.test(c)) return 'testing';
  if (/\bgit (push|tag)\b|\bgh (pr|release)\b|\b(deploy|publish|release)\b|wrangler deploy|vercel/.test(c)) return 'launch';
  if (/\bgit\b/.test(c)) return 'git';
  if (/\b(npm|pnpm|yarn|bun|pip3?|uv|cargo|go|dotnet|mvn|gradle|poetry|choco|winget)\s+(i|install|add|build|ci|sync|restore|compile|upgrade)\b|\b(make|tsc|webpack|vite build|msbuild|cmake)\b/.test(c)) return 'lifting';
  if (/\b(docker|kubectl|ssh|scp|curl|wget|invoke-webrequest|systemctl|nginx|serve)\b/.test(c)) return 'servers';
  if (/^\s*(grep|rg|find|ls|dir|cat|head|tail|tree|get-childitem|select-string|get-content|type)\b/.test(c)) return 'searching';
  return 'terminal';
}

function classifyTool(name, input = {}) {
  if (/^(Read|NotebookRead|LS)$/.test(name)) return 'reading';
  if (/^(Grep|Glob|ToolSearch|LSP)$/.test(name)) return 'searching';
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(name)) return 'coding';
  if (name === 'Write') return 'building';
  if (/^(Bash|PowerShell|BashOutput|KillShell|KillBash|Monitor)$/.test(name)) return classifyCommand(input.command);
  if (/^(WebSearch|WebFetch)$/.test(name)) return 'web';
  if (/^(Task|Agent)$/.test(name)) return 'delegating';
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|EnterPlanMode|ExitPlanMode)$/.test(name) || /update_plan$/.test(name)) return 'planning';
  if (name === 'AskUserQuestion') return 'asking';
  if (name === 'Skill') return 'scroll';
  if (/browser|chrome|computer-use|playwright|puppeteer/i.test(name)) return 'browsing';
  return 'tools';
}

// Where a session runs. The app refines "IDE" / "Terminal" with the real app name once it finds the window.
const TERMINALS = {
  Apple_Terminal: 'Terminal', 'iTerm.app': 'iTerm2', WezTerm: 'WezTerm', ghostty: 'Ghostty', WarpTerminal: 'Warp',
  Hyper: 'Hyper', Tabby: 'Tabby', kitty: 'kitty', alacritty: 'Alacritty', rio: 'Rio', 'konsole': 'Konsole',
};
function sourceOf(ev) {
  const c = ev.client || {};
  const ep = c.entrypoint || ev.entrypoint || '';
  const term = c.term || ev.term_program || '';
  if (ep === 'claude-desktop') return 'Claude app';
  if (ep === 'claude-vscode') return 'IDE';
  if (/jetbrains/i.test(c.termEmu || '')) return 'JetBrains IDE';
  if (term === 'vscode') return 'IDE terminal';
  if (TERMINALS[term]) return TERMINALS[term];
  if (c.wt) return 'Windows Terminal';
  if (ep === 'cli' || term) return 'Terminal';
  return ep ? ep.replace(/^sdk-/, 'SDK ') : 'Claude Code';
}

/** What kind of place: the Claude app, an IDE's Claude Code panel, a terminal inside an IDE, or a terminal. */
function kindOf(ev) {
  const c = ev.client || {};
  const ep = c.entrypoint || ev.entrypoint || '';
  if (ep === 'claude-desktop') return 'desktop';
  if (ep === 'claude-vscode') return 'ide';
  if (/jetbrains/i.test(c.termEmu || '') || (c.term || ev.term_program) === 'vscode') return 'ide-terminal';
  return 'terminal';
}

function projectName(cwd) {
  if (!cwd) return 'claude';
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop(); // either separator, whatever OS sent it
  return /^scratch-\d{4}-\d\d-\d\d/.test(base) ? 'scratch' : base;
}

// "**Fixed** the `foo` bug ([link](x))." -> "Fixed the foo bug (link)."
function plain(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(text, max) {
  const t = plain(text);
  const m = t.match(/^.{20,}?[.!?:](\s|$)/);
  const s = m ? m[0].trim() : t;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

// Read the tail of a transcript: Claude's latest words (its newest text block,
// or its newest thinking summary if that came later) and the latest token usage.
function readTranscriptTail(file) {
  const out = { text: '', usage: null, model: '' };
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0 && !(out.text && out.usage); i--) {
      if (!lines[i].includes('"assistant"')) continue;
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      const msg = entry?.message;
      if (entry.type !== 'assistant' || !msg || !Array.isArray(msg.content)) continue;
      if (!out.usage && msg.usage && !entry.isSidechain) { out.usage = msg.usage; out.model = msg.model || ''; }
      for (let j = msg.content.length - 1; j >= 0 && !out.text; j--) {
        const c = msg.content[j];
        if (c.type === 'text' && c.text && c.text.trim()) out.text = c.text;
        else if (c.type === 'thinking' && c.thinking && c.thinking.trim()) out.text = c.thinking;
      }
    }
  } catch { /* transcript not readable yet */ }
  return out;
}

const short = (v, n = 64) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** What a permission prompt is asking, for the Allow / Always / Deny buttons. */
function describePermission(ev) {
  const t = ev.tool_name || 'a tool', i = ev.tool_input || {};
  if (/^(Bash|PowerShell)$/.test(t)) return { label: 'Run a command', detail: short(i.command) };
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(t)) return { label: 'Edit a file', detail: short(path.basename(i.file_path || i.notebook_path || '')) };
  if (t === 'Write') return { label: 'Create a file', detail: short(path.basename(i.file_path || '')) };
  if (t === 'Read') return { label: 'Read a file', detail: short(path.basename(i.file_path || '')) };
  if (t === 'WebFetch') { let h = ''; try { h = new URL(i.url).hostname; } catch { /* not a URL */ } return { label: 'Open a web page', detail: h || short(i.url) }; }
  if (t === 'WebSearch') return { label: 'Search the web', detail: short(i.query) };
  if (/^mcp__/.test(t)) { const [, server, tool] = t.split('__'); return { label: `Use ${server}`, detail: short(tool) }; }
  return { label: `Use ${t}`, detail: '' };
}

class Session {
  constructor(id) {
    this.id = id;
    this.cwd = '';
    this.name = 'claude';
    this.nickname = '';
    this.source = 'Claude Code';
    this.transcript = '';
    this.state = 'idle'; // idle | working | ended
    this.kind = 'idle';
    this.kindSince = Date.now();
    this.workSince = 0;
    this.attention = null; // permission | question | done
    this.attentionSince = 0;
    this.task = '';
    this.thought = '';
    this.plan = []; // [{content, status}]
    this.tasks = new Map(); // CLI Task tools: id -> subject
    this.errorStreak = 0;
    this.lastErrorAt = 0;
    this.subagents = 0;
    this.lastEventAt = Date.now();
    this.lastHookAt = 0; // its last real hook event
    this.agents = new Set(); // running sub-agents (SubagentStart/Stop carry an agent_id)
    this.agentEvents = false; // true once this session reports SubagentStart events
    this.note = null; // { text, until }: a short line for the card (e.g. a file that couldn't be handed over)
    this.limitHitAt = 0; // when a usage limit last cut this session's turn off
    this.pendingPermission = null; // { label, detail, canAlways } while a permission prompt is open
    this.permHeld = false; // the app is holding the hook, so the buddy's buttons can answer
    this.context = null; // { used, size, pct }
    this.ctxMax = 0;
  }

  get displayName() { return this.nickname || this.name; }

  phase() {
    const cur = this.plan.find((p) => p.status === 'in_progress');
    if (!cur) return '';
    return firstSentence(cur.activeForm || cur.content, 70);
  }

  card() {
    const done = this.plan.filter((p) => p.status === 'completed').length;
    let status;
    if (this.attention === 'permission') status = 'Needs your permission';
    else if (this.attention === 'question') status = 'Has a question for you';
    else if (this.state === 'idle') status = this.attention === 'done' ? 'Finished, your turn!' : LABELS.idle;
    else status = LABELS[this.kind] || 'Working';
    return {
      name: this.displayName,
      source: this.source,
      status,
      phase: this.phase(),
      progress: this.plan.length ? `${done}/${this.plan.length}` : '',
      thought: this.thought,
      task: this.task,
      since: this.state === 'working' ? this.workSince : 0,
      subagents: this.subagents,
      context: this.context,
      note: this.note && this.note.until > Date.now() ? this.note.text : '',
    };
  }
}

class Sessions extends EventEmitter {
  constructor() {
    super();
    this.map = new Map();
    this.recent = new Map(); // dedupe identical events from overlapping hook configs
    this.thoughtTimers = new Map();
  }

  get(id) {
    let s = this.map.get(id);
    if (!s) { s = new Session(id); this.map.set(id, s); }
    return s;
  }

  handle(ev) {
    if (!ev || !ev.session_id || !ev.hook_event_name) return;
    const key = JSON.stringify([ev.session_id, ev.hook_event_name, ev.tool_use_id, ev.agent_id, ev.prompt, ev.tool_name, ev.message]);
    const now = Date.now();
    if (this.recent.has(key) && now - this.recent.get(key) < 1500) return;
    this.recent.set(key, now);
    if (this.recent.size > 300) for (const [k, t] of this.recent) if (now - t > 5000) this.recent.delete(k);

    const s = this.get(ev.session_id);
    // A session that ended can carry on under the same id (Claude apps restart their sessions after
    // updates and plugin reloads, and when you resume a conversation): it's the same session.
    if (s.state === 'ended' && ev.hook_event_name !== 'SessionEnd') { s.state = 'idle'; s.endedAt = 0; this.emit('resumed', s); }
    // Forget sessions that ended a good while ago.
    if (this.map.size > 40) for (const [id, x] of this.map) if (x.state === 'ended' && now - x.endedAt > 3600e3) this.map.delete(id);
    s.lastEventAt = now;
    s.lastHookAt = now; // (lastEventAt is also bumped when a buddy is turned on; this is only real use)
    if (ev.cwd) { s.cwd = ev.cwd; s.name = projectName(ev.cwd); }
    if (ev.transcript_path) s.transcript = ev.transcript_path;
    if (ev.client || ev.entrypoint !== undefined) {
      if (!s.sourceRefined) s.source = sourceOf(ev); // the app may have named it better (e.g. "Cursor")
      s.where = kindOf(ev);
      if (ev.client) s.client = ev.client;
    }

    const name = ev.hook_event_name;
    if (ev.buddy_command) return this.command(s, ev.buddy_command);
    if (ev.buddy_thought) s.thought = ev.buddy_thought; // demo sessions have no transcript

    switch (name) {
      case 'SessionStart':
        s.state = 'idle';
        this.emit('start', s);
        break;
      case 'UserPromptSubmit': {
        const prompt = plain(ev.prompt);
        if (prompt && !prompt.startsWith('<')) s.task = firstSentence(prompt, 110);
        s.plan = s.plan.filter((p) => p.status !== 'completed').length ? s.plan : [];
        s.errorStreak = 0;
        this.setWorking(s, 'thinking');
        this.resolvePermission(s);
        this.clearAttention(s);
        break;
      }
      case 'PreToolUse': {
        const kind = classifyTool(ev.tool_name, ev.tool_input || {});
        this.trackPlan(s, ev.tool_name, ev.tool_input || {});
        if (kind === 'delegating' && !s.agentEvents) { s.subagents++; this.emit('update', s); }
        // A new tool starting means an earlier prompt was answered (parallel
        // tool calls can overlap for a moment, hence the grace period).
        if (s.attention === 'permission' || s.attention === 'question') { if (now - s.attentionSince > 1500) this.resolvePermission(s); }
        else this.clearAttention(s);
        const debugging = kind === 'coding' && now - s.lastErrorAt < 90000;
        this.setWorking(s, debugging ? 'debugging' : kind);
        this.refreshThought(s);
        break;
      }
      // Fired when a prompt is actually on screen. AskUserQuestion shows its
      // questions through this same prompt, so that's when "?" appears.
      case 'PermissionRequest':
        if (ev.tool_name === 'AskUserQuestion') this.setAttention(s, 'question');
        else {
          s.pendingPermission = { ...describePermission(ev), canAlways: Array.isArray(ev.permission_suggestions) && ev.permission_suggestions.length > 0 };
          this.setAttention(s, 'permission');
        }
        break;
      case 'PermissionDenied':
        this.resolvePermission(s);
        break;
      case 'Notification': {
        const type = ev.notification_type || '';
        if (type === 'permission_prompt' || (!type && /permission/i.test(String(ev.message || '')))) {
          if (s.attention !== 'permission' && s.attention !== 'question') { s.pendingPermission = null; this.setAttention(s, 'permission'); }
        } else if (type === 'elicitation_dialog') {
          this.setAttention(s, 'question');
        }
        // idle_prompt ("waiting for your input") is ignored: the ✓ already says it's your turn.
        break;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (/^(Task|Agent)$/.test(ev.tool_name) && !s.agentEvents) { s.subagents = Math.max(0, s.subagents - 1); this.emit('update', s); }
        if (/^(TaskCreate)$/.test(ev.tool_name)) this.trackTaskCreated(s, ev);
        const failed = name === 'PostToolUseFailure' || this.looksFailed(ev.tool_response);
        const interrupted = /interrupt/i.test(String(ev.error || '')) || ev.is_interrupt;
        if (failed && !interrupted) {
          s.errorStreak++;
          s.lastErrorAt = now;
          this.emit('error', s, s.errorStreak);
        } else if (!failed) {
          s.errorStreak = Math.max(0, s.errorStreak - 1);
        }
        if (s.attention === 'permission' || s.attention === 'question') this.resolvePermission(s);
        this.setWorking(s, 'thinking');
        this.refreshThought(s);
        break;
      }
      // Exact helper count: each sub-agent reports its own start and stop.
      case 'SubagentStart':
        if (!s.agentEvents) { s.agentEvents = true; s.agents.clear(); }
        s.agents.add(ev.agent_id || `${now}`);
        s.subagents = s.agents.size;
        s.agentsAt = now;
        this.emit('update', s);
        break;
      case 'SubagentStop':
        if (s.agentEvents) { s.agents.delete(ev.agent_id); s.subagents = s.agents.size; }
        else s.subagents = Math.max(0, s.subagents - 1);
        s.agentsAt = now;
        this.emit('update', s);
        break;
      case 'PreCompact':
        this.setWorking(s, 'compacting');
        break;
      case 'Stop':
        this.resolvePermission(s);
        s.state = 'idle';
        s.kind = 'idle';
        // Background sub-agents can outlive the turn; without start/stop events, assume they're done.
        if (!s.agentEvents || now - (s.agentsAt || 0) > 20 * 60e3) { s.agents.clear(); s.subagents = 0; }
        this.refreshThought(s, 0);
        this.setAttention(s, 'done');
        this.emit('done', s);
        break;
      case 'StopFailure':
        s.state = 'idle';
        s.kind = 'idle';
        // The turn was cut off by a usage limit (or another rate limit; the app checks which).
        if (ev.error === 'rate_limit') { s.limitHitAt = now; this.emit('limit-hit', s, ev); }
        else this.emit('crashed', s);
        break;
      case 'SessionEnd':
        this.resolvePermission(s);
        s.state = 'ended';
        s.endedAt = now;
        this.emit('end', s); // (the record is kept: see 'resumed' above)
        break;
      default:
        break;
    }
    this.emit('update', s);
  }

  /** A /buddy command. Returns the reply to show in Claude Code, when the app has one ("take"). */
  command(s, cmd) {
    const out = {};
    if (cmd.action === 'take') this.emit('take', s, cmd.value || '', out);
    else if (cmd.action === 'off') this.emit('dismiss', s);
    else if (cmd.action === 'name') { s.nickname = cmd.value.slice(0, 18); this.emit('summon', s, cmd); }
    else if (cmd.action === 'size') this.emit('size', s, cmd.value);
    else if (cmd.action === 'custom') this.emit('custom', s);
    else if (cmd.action === 'helpers') this.emit('helpers', s, cmd.value !== 'off');
    else if (cmd.action === 'annoy') this.emit('annoy', s, cmd.value !== 'off');
    else this.emit('summon', s, cmd);
    this.emit('update', s);
    return out.message;
  }

  setWorking(s, kind) {
    if (s.state !== 'working') { s.state = 'working'; s.workSince = Date.now(); }
    if (s.kind !== kind) { s.kind = kind; s.kindSince = Date.now(); }
  }

  setAttention(s, kind) {
    s.attention = kind;
    s.attentionSince = Date.now();
    this.emit('attention', s, kind);
  }

  clearAttention(s) {
    if (s.attention) { s.attention = null; this.emit('attention', s, null); }
  }

  /** The open prompt was answered (here or elsewhere): drop it and release any held hook. */
  resolvePermission(s) {
    const had = s.attention === 'permission' || s.attention === 'question' || s.pendingPermission;
    s.pendingPermission = null;
    if (s.attention === 'permission' || s.attention === 'question') this.clearAttention(s);
    if (had) this.emit('permission-resolved', s);
  }

  looksFailed(resp) {
    if (!resp || typeof resp !== 'object') return false;
    if (resp.is_error === true || resp.success === false) return true;
    if (resp.interrupted) return false;
    return typeof resp.exitCode === 'number' ? resp.exitCode !== 0 : typeof resp.exit_code === 'number' && resp.exit_code !== 0;
  }

  trackPlan(s, tool, input) {
    if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
      s.plan = input.todos.map((t) => ({ content: t.content, activeForm: t.activeForm, status: t.status }));
    } else if (/update_plan$/.test(tool)) {
      // Claude desktop app plan tool: full lists or incremental advance/done/start.
      if (Array.isArray(input.items)) s.plan = input.items.map((t) => ({ content: t.content, status: t.status }));
      else {
        const cur = s.plan.findIndex((p) => p.status === 'in_progress');
        if (input.advance) {
          if (cur >= 0) s.plan[cur].status = 'completed';
          const next = s.plan.findIndex((p) => p.status === 'pending');
          if (next >= 0) s.plan[next].status = 'in_progress';
        }
        for (const i of input.done || []) if (s.plan[i - 1]) s.plan[i - 1].status = 'completed';
        if (input.start && s.plan[input.start - 1]) {
          s.plan.forEach((p) => { if (p.status === 'in_progress') p.status = 'pending'; });
          s.plan[input.start - 1].status = 'in_progress';
        }
      }
    } else if (tool === 'TaskUpdate' && input.taskId) {
      const id = String(input.taskId);
      const known = s.tasks.get(id) || { content: input.subject || `Task ${id}` };
      if (input.subject) known.content = input.subject;
      if (input.activeForm) known.activeForm = input.activeForm;
      if (input.status) known.status = input.status;
      s.tasks.set(id, known);
      s.plan = [...s.tasks.values()];
    } else if (tool === 'TaskCreate') {
      s.pendingTask = { content: input.subject || input.description || 'New task', activeForm: input.activeForm, status: 'pending' };
    }
  }

  trackTaskCreated(s, ev) {
    const m = JSON.stringify(ev.tool_response || '').match(/#?(\d+)/);
    if (m && s.pendingTask) { s.tasks.set(m[1], s.pendingTask); s.plan = [...s.tasks.values()]; }
    s.pendingTask = null;
  }

  // Transcript writes can lag the hook slightly, so read a moment later.
  refreshThought(s, delay = 350) {
    if (!s.transcript) return;
    clearTimeout(this.thoughtTimers.get(s.id));
    this.thoughtTimers.set(s.id, setTimeout(() => {
      const tail = readTranscriptTail(s.transcript);
      if (tail.text) {
        const t = firstSentence(tail.text, 150);
        if (t && t !== s.thought) s.thought = t;
      }
      if (tail.usage) {
        // Context in use = everything the model read for its last reply, plus what it wrote.
        const u = tail.usage;
        const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
        if (used > 200000 || /1m/i.test(tail.model)) s.ctxMax = 1000000; // 1M-context sessions
        const size = s.ctxMax || 200000;
        s.context = { used, size, pct: Math.min(100, Math.round((used / size) * 100)) };
        // Close to compacting: tell the buddy once each time it crosses 90%.
        if (s.context.pct >= 90 && !s.ctxAlerted) { s.ctxAlerted = true; s.ctxAlertAt = Date.now(); this.emit('context-high', s); }
        else if (s.context.pct < 85) s.ctxAlerted = false;
      }
      this.emit('update', s);
    }, delay));
  }
}

module.exports = { Sessions, LABELS, classifyTool, classifyCommand, firstSentence, describePermission, sourceOf, kindOf };
