// The buddy world: surfaces (taskbar floors, window title bars, screen walls
// and ceilings), physics, and each buddy's behaviour, driven by what its
// Claude session is doing. Sub-agents appear as small helper Clawds that
// follow their buddy around. All coordinates are global screen DIPs.
//
// Where a buddy "is" depends on its mode:
//   auto (floor/ledge): (x, y) is the feet, standing upright
//   wall: x is the wall line, y is the body's centre along the wall
//   ceil: y is the ceiling line, x is the body's centre
//   air / held: (x, y) is the feet, upright
//   birth: hatching in the middle of the screen
'use strict';

const Clawd = require('./sprites.js');

const G = 2400; // gravity, px/s^2
const BASE_SCALE = 4; // speeds below are tuned for this pixel scale
const SPEED = { walk: 55, run: 150, sneak: 38, pace: 32, climb: 36, ceil: 30 };
const SLEEP_AFTER = 3 * 60e3;
const GREET_COOLDOWN = 25e3; // friends meet up often when they have nothing to do
const STALE_AFTER = 12 * 3600e3;
const TYPING_HOLD = 1300;
const PANCAKE_MS = 2600;
// The Overlord builds each new buddy: fly in, scan beam, hologram, 3D-print, power on.
const BUILD = { arrive: 900, beam: 1500, holo: 2300, print: 4600, power: 5200, leave: 5700, drop: 8100, effects: 10500 };
// The usage limit: alarm, the Overlord arrives, the pit opens, each buddy is dragged in, the pit seals.
const DOOM = { alert: 2600, arrive: 1600, portal: 1200, grab: 1150, seal: 1400 };
// When it resets: the Overlord returns, the pit opens, each buddy is flung back up, then reviewed one by one.
const RISE = { arrive: 1500, portal: 1100, rise: 750, review: 1000, close: 1200 };
const LONG_WAIT_KINDS = new Set(['terminal', 'lifting', 'testing', 'servers']);
// Shaking a held buddy: direction changes add up (and wear off); enough of them and it gets dizzy, then sick.
const SHAKE = { wake: 2, dizzy: 7, sick: 20, decay: 1.6 };
const PUKE = ['#a4c639', '#8db22c', '#c8d96f', '#6f8f1f'];
const TW = Clawd.TOWER; // the skyscraper's layout, in art pixels
const OFFSTAGE = new Set(['birth', 'script', 'hell', 'doom', 'ride', 'enter', 'carried']); // not for grabbing, feeding or errands

const LOOK_DEFAULTS = {
  hat: null, hand: null, face: null, neck: null, back: null, body: Clawd.COL.body, eye: Clawd.COL.eye, size: 1,
  helpers: true, helper: { hat: null, body: Clawd.COL.body, size: 0.5 },
};
const fullLook = (look = {}) => ({ ...LOOK_DEFAULTS, ...look, helper: { ...LOOK_DEFAULTS.helper, ...(look.helper || {}) } });

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const halfW = (b) => 10 * b.scale; // half the body's width
const tall = (b) => 11.5 * b.scale; // body height
const spd = (b, kind) => (SPEED[kind] * b.scale * (b.speedMul || 1)) / BASE_SCALE;

function subtract(segs, a, b) {
  const out = [];
  for (const [s, e] of segs) {
    if (b <= s || a >= e) { out.push([s, e]); continue; }
    if (a > s) out.push([s, a]);
    if (b < e) out.push([b, e]);
  }
  return out;
}

function mergeSpans(list) {
  const merged = [];
  for (const f of list.sort((a, b) => a.y - b.y || a.x1 - b.x1)) {
    const last = merged[merged.length - 1];
    if (last && last.y === f.y && f.x1 <= last.x2 + 1) last.x2 = Math.max(last.x2, f.x2);
    else merged.push({ ...f });
  }
  return merged;
}

// ---------------------------------------------------------------- small talk
// Lines are drawn in the 3x5 pixel font, so they stay short and upper-case.
const FONT_OK = new Set(Object.keys(Clawd.FONT));
const say = (str, max = 22) => [...String(str || '').toUpperCase()].filter((c) => FONT_OK.has(c)).join('').replace(/\s+/g, ' ').trim().slice(0, max).trim();
const projectOf = (b) => say(b.session.name, 14) || 'A SECRET PROJECT';
const sourceOf = (b) => say(b.session.source, 12) || 'THE TERMINAL';
const hatName = (h) => say(h, 12);

function pickScene(a, b) {
  const pa = projectOf(a), pb = projectOf(b);
  const done = (x) => x.session.plan.filter((p) => p.status === 'completed').length;
  const pct = (x) => (x.session.context ? x.session.context.pct : 0);
  const scenes = [
    () => [[0, 'WHAT ARE YOU ON?'], [1, `I'M ON ${pb}`], [0, pick([`NICE! I'M ON ${pa}`, `COOL. ${pa} HERE`])],
      [1, pick(["HOW'S IT GOING?", 'ANY BUGS?', 'SHIPPED IT YET?'])],
      [0, pick(['TESTS ARE GREEN :)', 'ALMOST DONE!', 'SO MANY FILES...', 'IT COMPILES!', done(a) ? `${done(a)} TASKS DONE!` : 'JUST GETTING STARTED'])],
      ['both', '', 'cheer']],
    () => [[0, `HOW'S ${sourceOf(b)}?`], [1, pick(['COZY!', 'LOTS OF TABS', 'NEED MORE RAM', 'NEVER LEAVING'])], ['both', '', 'cheer']],
    () => [[0, `I'M AT ${pct(a) || Math.floor(rand(20, 70))}% CONTEXT`], [1, pick(['TIME TO COMPACT!', 'SAME. NAP TIME?', 'RESPECT.', 'LIGHTWEIGHT :P'])], ['both', '', 'cheer']],
    () => [[0, 'HIGH FIVE!'], ['both', ['YEAH!', 'YEAH!'], 'cheer', 'clap']],
    () => {
      const hands = ['ROCK', 'PAPER', 'SCISSORS'], x = Math.floor(rand(0, 3)), y = Math.floor(rand(0, 3));
      const winner = x === y ? -1 : (x - y + 3) % 3 === 1 ? 0 : 1;
      return [[0, 'ROCK, PAPER...'], [1, 'SCISSORS!'], ['both', [hands[x] + '!', hands[y] + '!'], 'alert', 'clap'],
        winner < 0 ? ['both', ['TIE?!', 'AGAIN!'], 'confused'] : [winner, 'I WIN!', 'cheer', 'done'],
        ...(winner < 0 ? [] : [[1 - winner, pick(['NOOO', 'BEST OF 3?', 'RIGGED!']), 'sadBase']])];
    },
    () => (b.look.hat ? [[0, `NICE ${hatName(b.look.hat)}!`], [1, 'THANKS! :)', 'love'], ['both', '', 'cheer']] : null),
    () => [[0, 'PSST... THE OVERLORD'], [1, "IT'S WATCHING US", 'startled'], [0, 'ACT NATURAL...'], ['both', '', 'idle']],
    () => [[0, 'WANT A COOKIE?'], [1, 'YES PLEASE!'], ['both', '', 'snack', 'munch']],
    () => [[0, 'DANCE PARTY!'], ['both', '', 'confetti', 'done'], ['both', '', 'celebrate']],
    () => [[0, 'TABS OR SPACES?'], [1, 'SPACES!'], [0, "WE CAN'T BE FRIENDS"], [1, '...', 'sadBase'], [0, 'JUST KIDDING :)'], ['both', '', 'love']],
    () => [[0, 'MAKE ME A SANDWICH'], [1, 'NO.'], [0, 'SUDO MAKE ME ONE'], [1, 'OKAY.', 'cheer']],
    () => [[0, 'IT WORKS ON MY MACHINE'], [1, "THEN WE SHIP YOUR MACHINE"], ['both', ['HAHA', 'HAHA'], 'cheer']],
    () => [[0, 'I FOUND A BUG'], [1, 'DID YOU SQUASH IT?'], [0, "IT'S A FEATURE NOW"], ['both', '', 'cheer']],
    () => [[0, 'HOW MANY TOKENS?'], [1, 'ALL OF THEM'], [0, 'LEGEND.', 'love']],
    () => [[0, 'GIT PUSH --FORCE?'], [1, 'NOT ON MAIN!', 'startled'], [0, '...TOO LATE', 'sadBase']],
  ];
  for (let i = 0; i < 6; i++) { const s = pick(scenes)(); if (s) return s; }
  return scenes[0]();
}

class Buddy {
  constructor(session, look) {
    this.id = session.id;
    this.session = session;
    this.look = fullLook(look);
    this.scale = BASE_SCALE;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.flip = false;
    this.mode = 'air'; // auto | air | held | wall | ceil | birth
    this.fallKind = 'spawn'; // why it is in the air: spawn | jump | throw | drop | nap | lost
    this.ground = null; // { win, offX } | { key }
    this.plat = null;
    this.wall = null; this.ceil = null; this.cdir = 0; // climbing direction (-1 up/left, 1 down/right)
    this.exit = null; this.exitKind = null; // planned walk off a platform end ('L' | 'R')
    this.climbPlan = null; this.climbStop = null; this.ceilStop = null; this.clingUntil = 0;
    this.anim = 'fall'; this.animAt = Date.now();
    this.walkTarget = null; this.walkSpeed = SPEED.walk; this.walkAnim = 'walk';
    this.action = null; // idle-time action
    this.task = null; // user-requested: come here, fetch, snack
    this.queue = []; // one-shot reactions: { anim, dur, bubble, sound, then, face }
    this.react = null;
    this.bubble = null;
    this.alpha = 1;
    this.idleSince = Date.now();
    this.sleeping = false;
    this.greetAt = 0;
    this.pokeAt = 0;
    this.hovered = false;
    this.ackDone = false;
    this.typingUntil = 0; this.typeKind = 'type'; this.taps = 0;
    this.workKind = null; this.workKindAt = 0; this.workAnim = null; this.paceAt = 0;
    this.spawned = true;
    this.leaving = false;
    this.pinned = false;
    this.muted = false;
    this.hide = null; // { until, phase: 'leaving' | 'gone' }
    this.birth = null; // { at, big, cx, cy }
    this.isMini = false; this.parent = null; this.slot = 0; this.speedMul = 1;
    this.carry = null; // files being eaten: { kinds: [...] }
    this.script = null; // scripted moves (eating files in a file dialog)
    this.stretch = 1; // vertical stretch while gulping several rows at once
    this.history = [];
  }

  setAnim(name) {
    if (this.anim !== name) { this.anim = name; this.animAt = Date.now(); }
  }

  push(anim, dur, extra = {}) { this.queue.push({ anim, dur, ...extra }); }
}

class World {
  /** hooks: { sound(name, x, y), focus(buddy), removed(id) } */
  constructor(hooks) {
    this.hooks = hooks;
    this.buddies = new Map();
    this.minis = []; // helper Clawds (Buddy with isMini), one per running sub-agent
    this.items = []; // snacks and fetch balls
    this.displays = [];
    this.windows = [];
    this.winById = new Map();
    this.platforms = []; // floors and window ledges: { key, x1, x2, y, win }
    this.walls = []; // { key, side: 'L' | 'R', x, y1, y2 }
    this.ceilings = []; // { key, x1, x2, y }
    this.bounds = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
    this.hiddenDisplays = new Set();
    this.cursor = { x: 0, y: 0, speed: 0 };
    this.sizes = { internal: 2, external: 4 }; // pixel scale on the laptop panel / other monitors
    this.itemSeq = 0;
    this.covers = []; // file-dialog items the buddy has "eaten": { x, y, w, h, p, color }
    // The Overlord lives fused into the top edge of the screens and builds the buddies.
    this.doom = null; // the usage-limit banishment, while it lasts
    this.ov = { present: false, mode: 'fused', x: 0, y: 0, tw: null, hovered: false, holdUntil: 0, peek: null, nextPeek: 0, lookX: 0, lookY: 0, blink: 0, build: null };
    // The skyscraper: one floor per buddy. h is how far it has risen out of the ground (0..1).
    this.tower = { open: false, h: 0, holdUntil: 0, residents: [], rides: [], car: { f: -1 } };
    this.puke = { drops: [], puddles: [] };
    this.fxInit(); // the Overlord's shows (spectacle.js)
  }

  sound(b, name) {
    if (!name || b.muted || (b.parent && b.parent.muted)) return;
    this.hooks.sound(name, b.x, b.y);
  }

  // ------------------------------------------------------------ environment
  /** displays: [{ id, bounds, workArea, internal }] */
  setDisplays(displays) {
    this.displays = displays;
    this.bounds = {
      x0: Math.min(...displays.map((d) => d.bounds.x)),
      y0: Math.min(...displays.map((d) => d.bounds.y)),
      x1: Math.max(...displays.map((d) => d.bounds.x + d.bounds.width)),
      y1: Math.max(...displays.map((d) => d.bounds.y + d.bounds.height)),
    };
    this.computeSurfaces();
  }

  /** windows: topmost first, rects already in DIPs. */
  setWindows(windows) {
    this.windows = windows;
    this.winById = new Map(windows.map((w) => [w.id, w]));
    this.computeSurfaces();
  }

  displayAt(x, y) {
    return this.displays.find((d) => x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height);
  }

  nearestDisplay(x, y) {
    let best = null, bestD = Infinity;
    for (const d of this.displays) {
      const b = d.bounds;
      const dx = Math.max(b.x - x, 0, x - (b.x + b.width)), dy = Math.max(b.y - y, 0, y - (b.y + b.height));
      if (dx + dy < bestD) { bestD = dx + dy; best = d; }
    }
    return best;
  }

  // With an auto-hiding taskbar the work area reaches the screen edge; keep a little room below the feet.
  floorY(d) { return Math.min(d.workArea.y + d.workArea.height, d.bounds.y + d.bounds.height - 20); }

  computeSurfaces() {
    const ds = this.displays;
    const plats = mergeSpans(ds.map((d) => ({ x1: d.workArea.x, x2: d.workArea.x + d.workArea.width, y: this.floorY(d) })))
      .map((f) => ({ key: `floor:${f.y}:${f.x1}`, x1: f.x1, x2: f.x2, y: f.y, win: null }));

    // Ledges: the visible parts of each window's top edge.
    this.windows.forEach((w, i) => {
      if (w.maximized) return;
      const y = w.rect.y;
      const d = this.displayAt(w.rect.x + w.rect.width / 2, y + 2);
      if (!d || y < d.workArea.y + 70 || y > d.workArea.y + d.workArea.height - 20) return;
      let segs = [[w.rect.x + 4, w.rect.x + w.rect.width - 4]];
      for (let j = 0; j < i; j++) {
        const o = this.windows[j].rect;
        if (o.y <= y + 2 && o.y + o.height >= y - 30) segs = subtract(segs, o.x, o.x + o.width);
      }
      for (const [a, b] of segs) if (b - a >= 60) plats.push({ key: `win:${w.id}:${Math.round(a)}`, x1: a, x2: b, y, win: w.id });
    });
    this.platforms = plats;

    // Walls: each display's left/right edge from its top down to its floor,
    // except where a neighbouring display continues (that part is open).
    const walls = [];
    for (const d of ds) {
      for (const side of ['L', 'R']) {
        const x = side === 'L' ? d.bounds.x : d.bounds.x + d.bounds.width;
        let segs = [[d.workArea.y, this.floorY(d)]];
        for (const n of ds) {
          if (n === d) continue;
          const nx = side === 'L' ? n.bounds.x + n.bounds.width : n.bounds.x;
          if (Math.abs(nx - x) <= 1) segs = subtract(segs, n.bounds.y, n.bounds.y + n.bounds.height);
        }
        for (const [a, b] of segs) if (b - a >= 40) walls.push({ key: `wall:${side}:${x}:${Math.round(a)}`, side, x, y1: a, y2: b });
      }
    }
    this.walls = walls;

    // Ceilings: each display's top edge, except under a display stacked above it.
    const ceils = [];
    for (const d of ds) {
      let segs = [[d.bounds.x, d.bounds.x + d.bounds.width]];
      for (const n of ds) if (n !== d && Math.abs(n.bounds.y + n.bounds.height - d.bounds.y) <= 1) segs = subtract(segs, n.bounds.x, n.bounds.x + n.bounds.width);
      for (const [a, b] of segs) ceils.push({ x1: a, x2: b, y: d.workArea.y });
    }
    this.ceilings = mergeSpans(ceils).map((c) => ({ key: `ceil:${c.y}:${c.x1}`, ...c }));
  }

  /** Pixel scale for wherever a buddy is: smaller on the laptop's own panel, times its size setting. */
  scaleAt(b) {
    let x = b.x, y = b.y - 1;
    if (b.mode === 'wall') { x = b.wall.side === 'L' ? b.wall.x + 1 : b.wall.x - 1; y = b.y; }
    if (b.mode === 'ceil') y = b.ceil.y + 1;
    const d = this.displayAt(x, y) || this.nearestDisplay(x, y);
    const base = Number(d && d.internal ? this.sizes.internal : this.sizes.external) || BASE_SCALE;
    const mult = b.isMini ? b.parent.look.helper.size : b.look.size;
    return clamp(Math.round(base * (Number(mult) || 1)), 1, 16);
  }

  /** The highest floor or ledge under a point (or the nearest floor). */
  platformUnder(x, y) {
    let best = null;
    for (const p of this.platforms) if (x >= p.x1 && x <= p.x2 && p.y >= y - 2 && (!best || p.y < best.y)) best = p;
    if (best) return best;
    for (const p of this.platforms) if (!p.win && (!best || Math.abs((p.x1 + p.x2) / 2 - x) < Math.abs((best.x1 + best.x2) / 2 - x))) best = p;
    return best;
  }

  // ------------------------------------------------------------ buddies
  has(id) { return this.buddies.has(id); }
  get(id) { return this.buddies.get(id); }
  usedHats() { return new Set([...this.buddies.values()].map((b) => b.look.hat)); }

  /** Summon a buddy. With birth (the default) it hatches big in the middle of the screen first. */
  add(session, { look, x, birth = true } = {}) {
    if (this.buddies.has(session.id)) return this.buddies.get(session.id);
    const b = new Buddy(session, look);
    const px = x ?? this.cursor.x;
    const d = this.displayAt(px, this.cursor.y) || this.displayAt(px, (this.bounds.y0 + this.bounds.y1) / 2) || this.nearestDisplay(px, this.cursor.y) || this.displays[0];
    b.x = x ?? d.workArea.x + d.workArea.width / 2;
    b.y = d.bounds.y - 10;
    b.scale = this.scaleAt(b);
    b.x = clamp(b.x, d.workArea.x + halfW(b), d.workArea.x + d.workArea.width - halfW(b));
    b.vy = 200;
    if (this.doom && this.doom.phase === 'sealed') { this.buddies.set(b.id, b); this.toHell(b); return b; }
    if (birth && !this.doom) {
      b.mode = 'birth';
      b.birth = { at: Date.now(), big: clamp(b.scale * 4, 8, 14), cx: d.bounds.x + d.bounds.width / 2, cy: d.bounds.y + d.bounds.height / 2 + 40 };
      this.ovBuild(b);
    }
    this.buddies.set(b.id, b);
    return b;
  }

  /** Restore a buddy quietly (app restart): drop onto the floor, asleep if idle. */
  restore(session, look) {
    const b = this.add(session, { look, x: rand(this.bounds.x0 + 200, this.bounds.x1 - 200), birth: false });
    b.spawned = false;
    b.fallKind = 'nap';
    b.idleSince = Date.now() - SLEEP_AFTER + 20e3;
    return b;
  }

  setLook(id, look) {
    const b = this.buddies.get(id);
    if (!b) return;
    b.look = fullLook(look);
    for (const m of this.minis) if (m.parent === b) m.look = this.miniLook(b);
  }

  miniLook(b) { return { hat: b.look.helper.hat, body: b.look.helper.body, eye: b.look.eye }; }

  remove(id, { goodbye = true } = {}) {
    const b = this.buddies.get(id);
    if (!b || b.leaving) return;
    b.leaving = true;
    b.task = null;
    b.hide = null;
    if (!goodbye || ['hell', 'doom', 'ride', 'enter'].includes(b.mode)) {
      this.tower.rides = this.tower.rides.filter((r) => r.id !== id || r.dir === 'up');
      this.buddies.delete(id); this.hooks.removed?.(id); return;
    }
    if (b.mode === 'held' || b.mode === 'carried') { b.mode = 'air'; b.fallKind = 'drop'; }
    if (b.mode === 'birth') { b.mode = 'air'; b.fallKind = 'drop'; b.birth = null; if (this.ov.build === b.id) this.ovReturn(); }
    if (b.mode === 'script') { const S = b.script; b.script = null; b.stretch = 1; this.drop(b, 'drop'); S.onDone?.(); }
    b.queue = [];
    b.react = null;
    b.push('wave', 1300, { sound: 'bye' });
    b.push('poof', 1000, { then: () => { this.buddies.delete(id); this.hooks.removed?.(id); } });
  }

  // Session-driven one-shot reactions.
  onDone(id) {
    const b = this.buddies.get(id);
    if (!b) return;
    b.ackDone = false;
    this.wake(b);
    b.push(pick(Clawd.ACTIVITY_ANIMS.celebrate), 2800, { sound: 'done' });
  }

  onError(id, streak) {
    const b = this.buddies.get(id);
    if (!b) return;
    const set = streak >= 3 ? 'error3' : streak === 2 ? 'error2' : 'error1';
    b.queue = b.queue.filter((q) => !q.error);
    b.push(pick(Clawd.ACTIVITY_ANIMS[set]), 2300, { sound: 'error', error: true });
  }

  onCrashed(id) {
    const b = this.buddies.get(id);
    if (b) b.push(pick(Clawd.ACTIVITY_ANIMS.crashed), 4000, { sound: 'error' });
  }

  onAttention(id, kind) {
    const b = this.buddies.get(id);
    if (!b || (kind !== 'permission' && kind !== 'question')) return;
    this.wake(b);
    this.sound(b, 'alert');
  }

  /** You answered a permission request on the buddy. */
  onDecision(id, decision) {
    const b = this.buddies.get(id);
    if (!b) return;
    const anim = decision === 'deny' ? 'xblock' : decision === 'always' ? 'shield' : 'check';
    b.queue = b.queue.filter((q) => q.then);
    b.push(anim, 1000, { sound: decision === 'deny' ? 'bonk' : 'chirp' });
  }

  /** The user pressed a key in this buddy's window: 'type' | 'erase' | 'enter'. */
  onKey(id, kind) {
    const b = this.buddies.get(id);
    if (!b || b.leaving || b.hide || ['held', 'air', 'birth', 'hell', 'doom', 'script'].includes(b.mode)) return;
    const now = Date.now();
    b.sleeping = false;
    b.action = null;
    b.idleSince = now;
    b.typeKind = kind;
    if (kind === 'enter') {
      b.typingUntil = 0;
      if (b.mode === 'auto') b.push('cheer', 450, { sound: 'chirp' });
      return;
    }
    if (kind === 'type') b.taps++;
    b.typingUntil = now + TYPING_HOLD;
  }

  wake(b) {
    b.idleSince = Date.now();
    if (b.sleeping) {
      b.sleeping = false;
      b.action = null;
      b.push('startled', 600);
    }
  }

  setHover(id) {
    for (const b of this.buddies.values()) {
      const h = b.id === id;
      if (h && !b.hovered) b.hoverAt = Date.now();
      b.hovered = h;
    }
  }

  // ------------------------------------------------------------ right-click actions
  /** Leap or run over to a point (the mouse pointer), across monitors if needed. */
  comeHere(b, point) {
    if (!b || b.leaving || OFFSTAGE.has(b.mode) || this.homeBound(b)) return;
    b.hide = null;
    // The marker lands on the ledge (or floor) below where you clicked.
    const p = this.platformUnder(point.x, point.y);
    const x = p ? clamp(point.x, p.x1 + halfW(b), p.x2 - halfW(b)) : point.x;
    b.task = { type: 'come', x, y: p ? p.y : point.y, until: Date.now() + 25000 };
    this.wake(b);
  }

  giveSnack(b) {
    if (!b || b.leaving || OFFSTAGE.has(b.mode) || this.homeBound(b)) return;
    b.hide = null;
    const d = this.displayAt(b.x, b.y - 2) || this.nearestDisplay(b.x, b.y);
    this.items.push({ id: ++this.itemSeq, kind: 'cookie', x: b.x, y: d.bounds.y - 10, vx: 0, vy: 0, owner: b, born: Date.now() });
    b.task = { type: 'snack', until: Date.now() + 9000 };
    this.wake(b);
  }

  playFetch(b, point) {
    if (!b || b.leaving || OFFSTAGE.has(b.mode) || this.homeBound(b)) return;
    b.hide = null;
    const mid = (this.bounds.x0 + this.bounds.x1) / 2;
    const dir = point.x < mid ? 1 : -1;
    const ball = { id: ++this.itemSeq, kind: 'ball', x: point.x, y: point.y, vx: dir * rand(450, 850), vy: -rand(450, 800), owner: b, born: Date.now() };
    this.items.push(ball);
    b.task = { type: 'fetch', ball, home: { x: point.x, y: point.y }, phase: 'watch', until: Infinity };
    this.wake(b);
  }

  hideFor(b, minutes) {
    if (!b || b.leaving) return;
    b.task = null;
    b.hide = { until: Date.now() + minutes * 60e3, phase: 'leaving' };
  }

  /** Stay put: no wandering, and dropped anywhere it simply floats there. */
  setPinned(b, on) {
    if (!b) return;
    b.pinned = on;
    if (on) {
      // Stop right here: no finishing the walk or climb it was on.
      b.walkTarget = null; b.exit = null; b.action = null; b.climbPlan = null; b.climbStop = null; b.ceilStop = null;
      b.cdir = 0; b.separating = false;
      if (b.task && b.task.type !== 'come') this.endTask(b);
    } else if (b.mode === 'float') this.drop(b, 'drop');
  }

  /** Files dropped on the buddy: lift the stack overhead, then munch them one by one. */
  ingest(b, names) {
    if (!b || b.leaving || !names.length || b.mode === 'hell' || b.mode === 'doom' || b.mode === 'ride' || b.mode === 'enter') return;
    const kinds = names.map((n) => Clawd.fileKind(n));
    this.keepErrand(b);
    b.hide = null;
    this.wake(b);
    b.queue = b.queue.filter((q) => q.then);
    b.push('holdUp', 1300, { carry: { kinds }, sound: 'chirp' });
    for (let i = kinds.length; i > 0; i--) b.push('munchFile', 1700, { carry: { kinds: kinds.slice(0, i) }, sound: 'munch' });
    b.push('cheer', 700, { sound: 'done' });
  }

  /**
   * Eat the selected items of a file dialog, then call onDone (which presses Open).
   * groups: [{ x, y, w, h, count, view: 'rows' | 'icons', color }] in DIPs; adjacent items come pre-merged.
   */
  eatDialog(b, groups, onDone) {
    if (!b || b.leaving || OFFSTAGE.has(b.mode)) { onDone(); return; }
    const c = this.centre(b); // measure first: centre() needs the wall it's on
    if (b.mode === 'wall' || b.mode === 'ceil') this.uprightFrom(b);
    if (b.mode === 'held') { b.grab = null; }
    const steps = [];
    for (const g of groups) {
      const cover = this.covers.push({ x: g.x, y: g.y, w: g.w, h: g.h, p: 0, color: g.color }) - 1;
      const unit = g.view === 'rows' ? g.h / Math.max(1, g.count) : g.h;
      const s = g.view === 'rows' ? clamp(Math.round((unit * 1.25) / 11.5), 1, 6) : clamp(Math.round((g.h * 1.15) / 11.5), 2, 14);
      const stretch = g.view === 'rows' ? Math.max(1, (g.h * 1.15) / (11.5 * s)) : 1;
      const cy = g.y + g.h / 2;
      steps.push({ type: 'dash', x: g.x - 9 * s, y: cy, s, stretch, ms: 380 });
      steps.push({ type: 'eat', x0: g.x - 9 * s, x1: g.x + g.w + 4 * s, y: cy, s, stretch, cover, g, ms: clamp(g.w * 1.3, 420, 1100) });
    }
    steps.push({ type: 'gulp', ms: 450 });
    this.keepErrand(b); b.walkTarget = null; b.react = null; b.queue = b.queue.filter((q) => q.then);
    b.script = { steps, i: 0, at: Date.now(), cx: c.x, cy: c.y, s0: b.scale, onDone };
    b.mode = 'script';
  }

  clearCovers() { this.covers = []; }

  scriptTick(b, now) {
    const S = b.script, st = S.steps[S.i];
    if (!st) {
      // Done: press Open, then drop back down to the floor at normal size.
      b.script = null;
      b.stretch = 1;
      const from = b.scale;
      this.drop(b, 'jump');
      b.shrink = { from, at: now };
      S.onDone?.();
      return;
    }
    const k = Math.min(1, (now - S.at) / st.ms);
    const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    if (st.type === 'dash') {
      if (!st.from) st.from = { x: S.cx, y: S.cy, s: b.scale, stretch: b.stretch };
      S.cx = st.from.x + (st.x - st.from.x) * ease;
      S.cy = st.from.y + (st.y - st.from.y) * ease;
      b.scale = Math.max(1, Math.round(st.from.s + (st.s - st.from.s) * ease));
      b.stretch = st.from.stretch + (st.stretch - st.from.stretch) * ease;
      b.flip = st.x < st.from.x;
      b.setAnim('zoom');
    } else if (st.type === 'eat') {
      S.cx = st.x0 + (st.x1 - st.x0) * k;
      S.cy = st.y;
      b.scale = st.s; b.stretch = st.stretch; b.flip = false;
      b.setAnim('chomp');
      const cv = this.covers[st.cover];
      if (cv) cv.p = clamp((S.cx + 6 * st.s - st.g.x) / st.g.w, cv.p, 1);
      if (!st.crunched && k > 0.3) { st.crunched = true; this.sound(b, 'munch'); }
    } else if (st.type === 'gulp') {
      b.stretch = 1 + (b.stretch - 1) * (1 - k);
      b.setAnim('cheer');
      if (!st.sounded) { st.sounded = true; this.sound(b, 'done'); }
    }
    b.x = S.cx;
    b.y = S.cy + (11.5 * b.scale * b.stretch) / 2;
    if (k >= 1) { S.i++; S.at = now; }
  }

  /** Fetching and going home survive being picked up, fed or tossed; other errands end. */
  keepErrand(b) { if (b.task && b.task.type !== 'fetch' && b.task.type !== 'home') b.task = null; }

  homeBound(b) { return !!(b.task && b.task.type === 'home'); }

  grab(id) {
    const b = this.buddies.get(id);
    if (!b || b.leaving || OFFSTAGE.has(b.mode)) return;
    if (b.mode === 'wall' || b.mode === 'ceil') this.uprightFrom(b);
    b.mode = 'held';
    b.grab = { dx: this.cursor.x - b.x, dy: this.cursor.y - b.y, x: this.cursor.x, y: this.cursor.y, at: Date.now(), moved: false, from: b.ground };
    b.history = [];
    b.walkTarget = null;
    b.action = null;
    b.react = null;
    b.exit = null;
    this.keepErrand(b);
    b.queue = b.queue.filter((q) => q.then);
    b.dizzy = 0;
  }

  release() {
    for (const b of this.buddies.values()) {
      if (b.mode !== 'held') continue;
      const g = b.grab;
      b.queasy = b.dizzy >= SHAKE.sick ? 2 : b.dizzy >= SHAKE.dizzy ? 1 : 0;
      b.dizzy = 0;
      if (!g.moved && g.from) {
        // A click, not a drag: hop and bring the session's window forward.
        b.mode = 'auto';
        b.ground = g.from;
        this.hooks.focus(b);
        this.wake(b);
        b.ackDone = true;
        b.push('cheer', 650, { sound: 'chirp' });
        continue;
      }
      if (!g.moved) { this.hooks.focus(b); b.ackDone = true; }
      if (b.pinned && g.moved) {
        // Pinned: it stays exactly where you let go, floating if need be.
        b.mode = 'float'; b.vx = 0; b.vy = 0; b.ground = null; b.plat = null;
        const under = this.platforms.find((p) => b.x >= p.x1 && b.x <= p.x2 && Math.abs(p.y - b.y) < 6);
        if (under) this.standOn(b, under, b.x);
        this.queasyShow(b);
        continue;
      }
      const h = b.history;
      const now = Date.now();
      const old = h.find((p) => now - p.t <= 90) || h[0];
      const last = h[h.length - 1];
      const dt = old && last ? Math.max(0.016, (last.t - old.t) / 1000) : 1;
      b.vx = old ? clamp((last.x - old.x) / dt, -2600, 2600) : 0;
      b.vy = old ? clamp((last.y - old.y) / dt, -2600, 2600) : 0;
      b.mode = 'air';
      b.ground = null;
      b.fallKind = 'throw';
      b.noClingUntil = 0;
    }
  }

  // ------------------------------------------------------------ simulation
  tick(now, dt, cursor, mouseDown) {
    this.cursor = cursor;
    this.guard('overlord', () => this.ovTick(now));
    this.guard('doom', () => this.doomTick(now));
    for (const b of [...this.buddies.values()]) {
      // One buddy getting into a bad state must never stop the others (or the Overlord).
      try { this.tickBuddy(b, now, dt, mouseDown); } catch (err) { this.recover(b, err); }
    }
    this.guard('helpers', () => this.tickMinis(now, dt));
    this.guard('items', () => this.tickItems(now, dt));
    this.guard('tower', () => this.towerTick(now, dt));
    this.guard('puke', () => this.tickPuke(now, dt));
    this.guard('fx', () => this.fxTick(now, dt));
  }

  guard(what, fn) {
    try { fn(); } catch (err) { this.hooks.error?.(err, what); }
  }

  /** Put a buddy that threw back into a safe state: falling from where it was, normal size. */
  recover(b, err) {
    this.hooks.error?.(err, `buddy ${String(b.id).slice(0, 8)} (${b.mode})`);
    const S = b.script;
    b.script = null; b.stretch = 1; b.wall = null; b.ceil = null; b.cdir = 0; b.grab = null; b.birth = null; b.shrink = null;
    // Fetching and going home carry on afterwards (unless it keeps failing).
    const again = b.recoveredAt && Date.now() - b.recoveredAt < 3000;
    b.recoveredAt = Date.now();
    const keep = !again && b.task && (b.task.type === 'fetch' || b.task.type === 'home') ? b.task : null;
    if (again && b.task && b.task.type === 'home') { this.buddies.delete(b.id); this.hooks.removed?.(b.id); return; }
    b.queue = []; b.react = null; b.task = keep; b.action = null; b.walkTarget = null; b.exit = null; b.hide = null;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      const d = this.displays[0];
      b.x = d ? d.workArea.x + d.workArea.width / 2 : 400; b.y = d ? d.bounds.y + 20 : 20;
    }
    if (b.mode !== 'hell') { b.mode = 'air'; b.fallKind = 'drop'; b.vx = 0; b.vy = 0; b.ground = null; b.plat = null; }
    try { b.scale = this.scaleAt(b); } catch { b.scale = BASE_SCALE; }
    if (S && S.onDone) { try { S.onDone(); } catch { /* the dialog still gets its Open */ } }
  }

  tickBuddy(b, now, dt, mouseDown) {
    {
      if (b.mode === 'hell' || b.mode === 'doom' || b.mode === 'ride' || b.mode === 'carried') return; // banished, dragged by the Overlord, in the elevator, or under a drone
      if (b.mode === 'enter') { this.enterTick(b, now); return; }
      if (b.mode === 'birth') { this.birthTick(b, now); return; }
      if (b.script) { this.scriptTick(b, now); return; }
      b.scale = this.scaleAt(b);
      if (b.shrink) {
        // Shrinking back to normal size while falling after the build.
        const k = (now - b.shrink.at) / 450;
        if (k >= 1) b.shrink = null;
        else b.scale = Math.round(b.shrink.from + (b.scale - b.shrink.from) * k);
      }
      if (b.birth && now - b.birth.at > BUILD.effects) b.birth = null;
      if (b.soot && now > b.soot.until) b.soot = null;
      if (!b.hide && b.alpha < 1) b.alpha = Math.min(1, b.alpha + dt * 2);
      if (b.mode === 'held') { this.held(b, now, mouseDown); return; }
      if (b.mode === 'air') { this.air(b, dt, now); return; }
      if (b.mode === 'auto') { this.followGround(b); if (b.mode !== 'auto') return; }
      this.checkPoke(b, now);
      this.think(b, now, dt);
      this.move(b, dt, now);
    }
  }

  move(b, dt, now) {
    if (b.mode === 'auto') this.walk(b, dt);
    else if (b.mode === 'wall') this.climb(b, dt, now);
    else if (b.mode === 'ceil') this.crawl(b, dt, now);
  }

  /** The build: the renderer draws beam, hologram and 3D-print from b.birth.t; here we just keep time. */
  birthTick(b, now) {
    const B = b.birth, t = now - B.at;
    if (t >= BUILD.drop) {
      // Built: drop to the bottom, shrinking to normal size on the way.
      b.mode = 'air'; b.fallKind = 'spawn'; b.spawned = 'birth';
      b.vx = 0; b.vy = 0;
      b.shrink = { from: B.big, at: now };
      return;
    }
    if (t >= BUILD.beam && !B.scanning) { B.scanning = true; this.sound(b, 'scan'); }
    if (t >= BUILD.holo && !B.printing) { B.printing = true; this.sound(b, 'print'); }
    if (t >= BUILD.print && !B.powered) { B.powered = true; this.sound(b, 'birth'); }
    if (t >= BUILD.leave && !B.released) { B.released = true; this.ovReturn(); }
    b.scale = B.big;
    b.x = B.cx;
    b.y = B.cy + (11.5 * B.big) / 2;
    b.setAnim(t < BUILD.print ? 'idle' : t < BUILD.power + 300 ? 'cheer' : 'welcome');
    b.bubble = null;
  }

  // ------------------------------------------------------------ the Overlord
  /** Top-left corner of the whole desktop: the Overlord's home. */
  ovHome() {
    const d = [...this.displays].sort((a, c) => a.bounds.x - c.bounds.x || a.bounds.y - c.bounds.y)[0];
    if (!d) return { x: 40, y: 0, d: null };
    // The socket and the peeking eye are about 16 of their pixels either side of this point.
    const ps = Math.max(2, Math.round(this.ovScaleFor(d) * 0.6));
    return { x: d.bounds.x + Math.max(40, 17 * ps + 8), y: d.bounds.y, d };
  }

  ovScaleFor(d) {
    const base = Number(d && d.internal ? this.sizes.internal : this.sizes.external) || BASE_SCALE;
    return clamp(Math.round(base * 1.25), 2, 8);
  }

  ovScale() { return this.ovScaleFor(this.ovHome().d); }

  ovTween(to, ms, then, big) {
    const o = this.ov;
    o.tw = { fx: o.x, fy: o.y, tx: to.x, ty: to.y, at: Date.now(), ms, then, fb: o.big || 1, tb: big ?? (o.big || 1) };
  }

  /** Called when a buddy is summoned: fly over (or materialise the first time) and build it. */
  ovBuild(b) {
    this.fxCancel(); // a new buddy comes first
    const o = this.ov, s = this.ovScale();
    const target = { x: b.birth.cx, y: b.birth.cy - 11.5 * b.birth.big - 20 - 14 * s };
    o.build = b.id;
    if (!o.present) {
      // The very first buddy: the Overlord materialises right where it will build.
      o.present = true;
      o.mode = 'building';
      o.x = target.x; o.y = target.y;
      o.materialize = Date.now();
      this.hooks.overlordBorn?.();
      return;
    }
    if (o.mode === 'fused') { const h = this.ovHome(); o.x = h.x; o.y = h.y - 14 * s; o.peek = null; }
    o.mode = 'building';
    this.ovTween(target, BUILD.arrive - 100);
  }

  /** First start with buddies already around (an upgrade): materialise mid-screen, look around, then fuse. */
  ovAppear() {
    const o = this.ov;
    if (o.present) return;
    const { d } = this.ovHome();
    o.present = true;
    o.mode = 'detached';
    o.x = d ? d.bounds.x + d.bounds.width / 2 : 400;
    o.y = d ? d.bounds.y + d.bounds.height * 0.35 : 300;
    o.materialize = Date.now();
    o.holdUntil = Date.now() + 4000;
    this.hooks.sound('scan', o.x, o.y);
    this.hooks.overlordBorn?.();
  }

  ovReturn() {
    const o = this.ov, h = this.ovHome(), s = this.ovScale();
    o.build = null; o.menu = false; o.lookAt = null; o.patrol = null;
    o.mode = 'returning';
    this.ovTween({ x: h.x, y: h.y - 14 * s }, 700, () => { o.mode = 'fused'; o.nextPeek = Date.now() + 2500; }, 1);
  }

  /** Clicked in the corner: drop down out of the top edge so its menu can open. */
  ovDetach() {
    const o = this.ov;
    if (!o.present || o.mode === 'building' || o.mode === 'doom') return false;
    const h = this.ovHome(), s = this.ovScale();
    if (o.mode === 'fused') { o.x = h.x; o.y = h.y - 14 * s; }
    o.mode = 'detached';
    o.peek = null;
    o.holdUntil = Date.now() + 8000;
    this.ovTween({ x: h.x + 30 + 14 * s, y: h.y + 24 + 16 * s }, 420);
    return true;
  }

  ovKeep(ms = 6000) { this.ov.holdUntil = Math.max(this.ov.holdUntil, Date.now() + ms); }

  ovTick(now) {
    const o = this.ov;
    if (!o.present) return;
    if (o.tw) {
      const k = Math.min(1, (now - o.tw.at) / o.tw.ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      o.x = o.tw.fx + (o.tw.tx - o.tw.fx) * e;
      o.y = o.tw.fy + (o.tw.ty - o.tw.fy) * e;
      o.big = o.tw.fb + (o.tw.tb - o.tw.fb) * e;
      if (k >= 1) { const then = o.tw.then; o.tw = null; then?.(); }
    }
    // Eyes: follow the cursor when out, look down while building, blink now and then.
    const c = this.cursor;
    const look = (tx, ty) => { const dx = tx - o.x, dy = ty - o.y, m = Math.hypot(dx, dy) || 1; o.lookX = clamp(dx / m, -1, 1); o.lookY = clamp(dy / m, -1, 1); };
    if (o.mode === 'building') { o.lookX *= 0.9; o.lookY = 0.85; }
    else if (o.mode === 'doom' && this.doom && this.doom.look) look(this.doom.look.x, this.doom.look.y);
    else if (o.lookAt) look(o.lookAt.x, o.lookAt.y);
    else look(c.x, c.y);
    o.blink = (now % 4200) < 140 ? 1 - Math.abs((now % 4200) - 70) / 70 : 0;
    if (o.mode === 'detached' && now > o.holdUntil && !o.hovered) this.ovReturn();
    // Fused: every few seconds a little eye pokes out of the top-left corner and looks around.
    if (o.mode === 'fused') {
      if (o.hovered || (this.fx.say && now < this.fx.say.until)) { if (!o.peek || !o.peek.hold) o.peek = { at: now, hold: true }; } // (out while it talks, too)
      else if (o.peek && o.peek.hold) o.peek = { at: now - 2300, lx: 0, ly: 0 }; // slide back up
      else if (o.peek && now - o.peek.at > 2600) { o.peek = null; o.nextPeek = now + rand(4000, 9000); }
      else if (!o.peek && now > o.nextPeek) o.peek = { at: now, lx: rand(-1, 1), ly: rand(0, 1) };
    } else o.peek = null;
  }

  ovSnapshot(now) {
    const o = this.ov;
    if (!o.present) return null;
    const h = this.ovHome(), s = this.ovScale();
    let peek = null;
    if (o.mode === 'fused' && o.peek) {
      const t = now - o.peek.at;
      // Slide down, glance around, slide back up.
      const out = o.peek.hold ? Math.min(1, t / 220) : t < 300 ? t / 300 : t > 2300 ? Math.max(0, 1 - (t - 2300) / 300) : 1;
      const wander = Math.floor(t / 550);
      peek = {
        x: h.x, y: h.y, out, t,
        lookX: o.hovered ? o.lookX : Math.sin(wander * 2.3 + (o.peek.lx || 0) * 3),
        lookY: o.hovered ? o.lookY : 0.35 + 0.5 * Math.cos(wander * 1.7),
        blink: !o.hovered && t > 1500 && t < 1640 ? 1 - Math.abs(t - 1570) / 70 : 0,
      };
    }
    return {
      mode: o.mode, x: Math.round(o.x), y: Math.round(o.y), s: Math.round(s * (o.big || 1)), red: !!o.red, t: now, lookX: o.lookX, lookY: o.lookY, blink: o.blink,
      materialize: o.materialize ? now - o.materialize : null, peek, hovered: o.hovered, menu: !!o.menu,
      hidden: !!(this.fx.boss && this.fx.boss.boom && now - this.fx.boss.boom < 1500),
      home: { x: h.x, y: h.y, w: 56, h: 44 },
      displays: this.displays.map((d) => ({ x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height })),
    };
  }

  held(b, now, mouseDown) {
    const c = this.cursor;
    if (!b.grab.moved && Math.hypot(c.x - b.grab.x, c.y - b.grab.y) > 5) b.grab.moved = true;
    const px = b.x, py = b.y;
    b.x = c.x - b.grab.dx;
    b.y = c.y - b.grab.dy;
    this.shake(b, b.x - px, b.y - py, now);
    b.history.push({ t: now, x: b.x, y: b.y });
    if (b.history.length > 12) b.history.shift();
    b.setAnim(!b.grab.moved ? b.anim : b.dizzy >= SHAKE.sick ? 'sick' : b.dizzy >= SHAKE.dizzy ? 'dizzyBase' : 'held');
    b.bubble = null;
    // Safety net: if the button came up somewhere we didn't see, drop it.
    if (mouseDown === false && now - b.grab.at > 150) this.release();
  }

  /** Shaking a held buddy: sharp changes of direction make it dizzy; a little shake wakes a sleeper. */
  shake(b, dx, dy, now) {
    const g = b.grab, dt = Math.min(0.1, (now - (g.st || now)) / 1000);
    g.st = now;
    b.dizzy = Math.max(0, (b.dizzy || 0) - dt * SHAKE.decay);
    for (const [v, k] of [[dx, 'sx'], [dy, 'sy']]) {
      if (Math.abs(v) < 5) continue;
      const sign = Math.sign(v);
      if (g[k] && sign !== g[k]) b.dizzy = Math.min(40, b.dizzy + 1);
      g[k] = sign;
    }
    if (b.sleeping && b.dizzy >= SHAKE.wake) this.wake(b);
  }

  /** After a good shake: dizzy for a bit, and if it was too much, sick (on your taskbar). */
  queasyShow(b) {
    const q = b.queasy;
    b.queasy = 0;
    if (!q) return;
    b.push('dizzy', 2600, { sound: 'dizzy' });
    if (q < 2) return;
    b.push('sick', 1000, { sound: 'gulp' });
    b.push('vomit', 2300, { sound: 'blech', start: () => { b.vomiting = { until: Date.now() + 1900 }; } });
    b.push('sadBase', 1500);
  }

  air(b, dt, now) {
    const prevX = b.x, prevY = b.y, hw = halfW(b), h = tall(b);
    b.vy += G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Thrown buddies grab hold of the screen edges they fly into.
    if (b.fallKind === 'throw' && now > (b.noClingUntil || 0)) {
      const mid = b.y - h / 2;
      for (const w of this.walls) {
        if (mid < w.y1 + hw || mid > w.y2 - hw) continue;
        const hit = w.side === 'R' ? prevX + hw <= w.x + 1 && b.x + hw >= w.x : prevX - hw >= w.x - 1 && b.x - hw <= w.x;
        if (hit) return this.enterWall(b, w, 0, mid, now);
      }
      if (b.vy < -300) {
        for (const c of this.ceilings) {
          if (b.x < c.x1 + hw || b.x > c.x2 - hw) continue;
          if (prevY - h >= c.y - 1 && b.y - h <= c.y) return this.enterCeil(b, c, 0, now);
        }
      }
    }

    const { x0, x1, y0 } = this.bounds;
    if (b.x < x0 + hw / 2) { b.x = x0 + hw / 2; b.vx = Math.abs(b.vx) * 0.5; }
    if (b.x > x1 - hw / 2) { b.x = x1 - hw / 2; b.vx = -Math.abs(b.vx) * 0.5; }
    if (b.y - h < y0 && b.vy < 0) { b.y = y0 + h; b.vy = 0; }
    b.flip = b.vx < -20 ? true : b.vx > 20 ? false : b.flip;
    b.setAnim(b.fallKind === 'throw' ? 'held' : b.vy < 0 ? 'jump' : b.fallKind === 'nap' ? 'nap' : 'fall');
    b.bubble = null;
    if (b.vy >= 0) {
      let best = null;
      for (const p of this.platforms) {
        if (b.ignorePlat === p.key && now < b.ignoreUntil) continue;
        if (prevY <= p.y + 1 && b.y >= p.y && b.x >= p.x1 && b.x <= p.x2 && (!best || p.y < best.y)) best = p;
      }
      if (best) return this.land(b, best);
    }
    if (b.y > this.bounds.y1 + 400) {
      // Fell into a gap between monitors: drop back in from the top of the main display.
      const d = this.displays[0];
      b.x = d.workArea.x + d.workArea.width / 2;
      b.y = d.bounds.y - 10;
      b.vx = 0; b.vy = 0;
    }
  }

  land(b, p) {
    const impact = b.vy, kind = b.fallKind;
    this.standOn(b, p, b.x);
    if (b.isMini) { b.queue.unshift({ anim: 'land', dur: 120 }); return; }
    if (b.spawned === 'birth') {
      b.spawned = false;
      b.queue.unshift({ anim: 'land', dur: 160, sound: 'land' }, { anim: 'hi', dur: 1400 });
    } else if (b.spawned) {
      b.spawned = false;
      b.queue.unshift({ anim: 'land', dur: 150 }, { anim: 'welcome', dur: 2600, sound: 'summon' }, { anim: 'hi', dur: 1400 });
    } else if (kind === 'nap') {
      b.queue.unshift({ anim: 'land', dur: 120 }); // falling asleep: no drama
    } else if ((kind === 'throw' && impact > 1100) || ((kind === 'drop' || kind === 'lost') && impact > 1200) || impact > 2300) {
      b.queue.unshift({ anim: 'pancake', dur: PANCAKE_MS, sound: 'bonk' }, { anim: 'land', dur: 160 });
    } else {
      b.queue.unshift({ anim: 'land', dur: 140, sound: impact > 600 ? 'land' : null });
    }
    if (b.queasy) this.queasyShow(b);
  }

  standOn(b, p, x) {
    b.x = x; b.y = p.y; b.vy = 0; b.vx = 0;
    b.mode = 'auto';
    b.plat = p;
    b.ground = p.win ? { win: p.win, offX: x - this.winById.get(p.win).rect.x } : { key: p.key };
    b.wall = null; b.ceil = null; b.cdir = 0;
    b.walkTarget = null; b.exit = null; b.fallKind = null; b.action = null;
  }

  drop(b, kind = 'lost') {
    b.mode = 'air';
    b.fallKind = kind;
    b.ground = null;
    b.plat = null;
    b.vx = 0; b.vy = 0;
    b.walkTarget = null;
    b.action = null;
    b.exit = null;
  }

  /** Convert a wall/ceiling position to an upright one (feet), without moving the body. */
  uprightFrom(b) {
    const hw = halfW(b), h = tall(b);
    if (b.mode === 'wall') {
      const w = b.wall;
      b.x = w.side === 'R' ? w.x - hw - 1 : w.x + hw + 1;
      b.y += h / 2;
    } else if (b.mode === 'ceil') {
      b.y = b.ceil.y + h;
    }
    // Never leave "on a wall" without a wall: callers set the real mode next.
    if (b.mode === 'wall' || b.mode === 'ceil') b.mode = 'air';
    b.wall = null; b.ceil = null; b.cdir = 0;
  }

  /** Let go of a wall or ceiling and fall. */
  letGo(b, kind) {
    const side = b.wall && b.wall.side;
    this.uprightFrom(b);
    this.drop(b, kind);
    b.vx = side === 'R' ? -40 : side === 'L' ? 40 : 0;
    b.noClingUntil = Date.now() + 400;
  }

  /** Ballistic leap to a point on a platform (for "come here" and fetch). */
  leapTo(b, tx, p) {
    if (b.mode === 'wall' || b.mode === 'ceil') this.uprightFrom(b);
    const dx = tx - b.x, dy = p.y - b.y;
    const T = clamp(0.55 + Math.abs(dx) / 1600 + (dy < 0 ? 0.2 : 0), 0.55, 1.5);
    const from = b.plat;
    this.drop(b, 'jump');
    b.vx = dx / T;
    b.vy = clamp((dy - 0.5 * G * T * T) / T, -2800, 1500);
    b.flip = dx < 0;
    b.ignorePlat = from?.key;
    b.ignoreUntil = Date.now() + 150;
    this.sound(b, 'jump');
  }

  enterWall(b, w, cdir, along, now = Date.now()) {
    const hw = halfW(b);
    b.mode = 'wall';
    b.wall = w; b.ceil = null;
    b.x = w.x;
    b.y = clamp(along, w.y1 + hw, w.y2 - hw);
    b.cdir = cdir;
    b.climbStop = null;
    b.vx = 0; b.vy = 0;
    b.ground = null; b.plat = null; b.walkTarget = null; b.exit = null; b.action = null; b.fallKind = null;
    if (!cdir) {
      // Clung on after a throw: hang on for a moment, then decide.
      b.clingUntil = now + rand(1200, 3000);
      b.climbPlan = { next: pick(['down', 'ceil', 'drop']) };
      this.sound(b, 'land');
    }
  }

  enterCeil(b, c, cdir, now = Date.now()) {
    const hw = halfW(b);
    b.mode = 'ceil';
    b.ceil = c; b.wall = null;
    b.y = c.y;
    b.x = clamp(b.x, c.x1 + hw, c.x2 - hw);
    b.cdir = cdir;
    b.vx = 0; b.vy = 0;
    b.ground = null; b.plat = null; b.walkTarget = null; b.exit = null; b.action = null; b.fallKind = null;
    b.ceilStop = cdir && !b.isMini && Math.random() < 0.6 ? b.x + cdir * rand(150, 600) : null;
    if (!cdir) b.clingUntil = now + rand(1200, 3000);
  }

  followGround(b) {
    const g = b.ground;
    if (!g) return this.drop(b);
    if (g.win) {
      const w = this.winById.get(g.win);
      if (!w) return this.drop(b);
      const x = w.rect.x + g.offX;
      const p = this.platforms.find((q) => q.win === g.win && x >= q.x1 - 2 && x <= q.x2 + 2);
      if (!p) return this.drop(b);
      b.x = x; b.y = p.y; b.plat = p;
    } else {
      const p = this.platforms.find((q) => q.key === g.key);
      if (!p || b.x < p.x1 - 4 || b.x > p.x2 + 4) {
        // The floor changed (display added/removed or the taskbar moved): find the one underneath.
        const under = this.platforms.find((q) => !q.win && b.x >= q.x1 && b.x <= q.x2 && Math.abs(q.y - b.y) < 80);
        if (under) { b.ground = { key: under.key }; b.y = under.y; b.plat = under; return; }
        return this.drop(b);
      }
      b.y = p.y; b.plat = p;
    }
  }

  /** A climbable wall at one end of a floor, if any. */
  wallAtEnd(p, end, b) {
    if (!p || p.win) return null;
    const x = end === 'R' ? p.x2 : p.x1;
    return this.walls.find((w) => w.side === end && Math.abs(w.x - x) <= 2 && w.y2 >= p.y - 40 && w.y1 <= p.y - 3 * halfW(b)) || null;
  }

  walk(b, dt) {
    if (b.walkTarget === null || !b.plat) return;
    const p = b.plat, hw = halfW(b);
    const target = b.exit ? b.walkTarget : clamp(b.walkTarget, p.x1 + hw / 2, p.x2 - hw / 2);
    const dx = target - b.x;
    if (Math.abs(dx) < 2) { b.walkTarget = null; return; }
    const dir = Math.sign(dx);
    b.flip = dir < 0;
    b.x += dir * Math.min(Math.abs(dx), b.walkSpeed * dt);

    if (b.exit) {
      const edge = b.exit === 'R' ? p.x2 : p.x1;
      const wall = this.wallAtEnd(p, b.exit, b);
      if (wall && (b.exit === 'R' ? b.x >= edge - hw : b.x <= edge + hw)) {
        // Reached the screen edge: start climbing.
        const plan = b.climbPlan || { next: 'down', frac: 0.5 };
        this.enterWall(b, wall, -1, p.y - hw);
        b.climbPlan = plan;
        b.climbStop = plan.next === 'ceil' || plan.next === 'follow' ? null : wall.y2 - hw - (wall.y2 - wall.y1 - 2 * hw) * plan.frac;
        return;
      }
      if (!wall && (b.exit === 'R' ? b.x > edge : b.x < edge)) {
        // Walked off the end: step onto a neighbouring floor at the same height or above, else fall.
        const next = this.platforms.find((q) => q !== p && b.x >= q.x1 && b.x <= q.x2 && q.y <= p.y + 2 && q.y >= p.y - 3 * hw && (!q.win || !p.win));
        if (next && !p.win) { this.standOn(b, next, b.x); return; }
        const kind = b.exitKind || 'drop';
        this.drop(b, kind);
        b.vx = dir * b.walkSpeed;
        return;
      }
    }
    if (b.ground && b.ground.win) b.ground.offX = b.x - this.winById.get(b.ground.win).rect.x;
  }

  walkTo(b, x, speed = spd(b, 'walk'), anim = 'walk') {
    b.walkTarget = x; b.walkSpeed = speed; b.walkAnim = anim; b.exit = null;
  }

  climb(b, dt, now) {
    if (!b.cdir) return;
    const w = b.wall, hw = halfW(b);
    b.y += b.cdir * spd(b, 'climb') * dt;
    if (b.cdir < 0 && b.climbStop !== null && b.y <= b.climbStop) {
      b.cdir = 0; b.climbStop = null; b.clingUntil = now + rand(2000, 5000);
      return;
    }
    if (b.cdir < 0 && b.y <= w.y1 + hw) return this.wallTop(b, now);
    if (b.cdir > 0 && b.y >= w.y2 - hw) return this.wallBottom(b);
  }

  wallTop(b, now) {
    const w = b.wall, hw = halfW(b);
    const c = this.ceilings.find((q) => Math.abs(q.y - w.y1) <= 4 && w.x >= q.x1 - 2 && w.x <= q.x2 + 2);
    if (c && b.climbPlan?.next !== 'down') {
      b.x = w.x + (w.side === 'L' ? hw : -hw);
      this.enterCeil(b, c, w.side === 'L' ? 1 : -1, now);
      return;
    }
    // The top of a step between two monitors: climb over onto the higher floor.
    const f = this.platforms.find((p) => !p.win && Math.abs(p.y - w.y1) <= 40 &&
      (w.side === 'L' ? p.x2 >= w.x - 2 && p.x1 < w.x - hw : p.x1 <= w.x + 2 && p.x2 > w.x + hw));
    if (f) return this.standOn(b, f, w.side === 'L' ? w.x - hw - 2 : w.x + hw + 2);
    b.y = w.y1 + hw;
    b.cdir = 0;
    b.climbPlan = { next: pick(['down', 'drop']) };
    b.clingUntil = now + rand(1500, 3000);
  }

  wallBottom(b) {
    const w = b.wall, hw = halfW(b);
    const f = this.platforms.find((p) => !p.win && Math.abs(p.y - w.y2) <= 40 &&
      (w.side === 'R' ? p.x2 >= w.x - 2 && p.x1 <= w.x - hw : p.x1 <= w.x + 2 && p.x2 >= w.x + hw));
    if (f) return this.standOn(b, f, w.side === 'R' ? w.x - hw : w.x + hw);
    this.letGo(b, 'drop');
  }

  crawl(b, dt, now) {
    if (!b.cdir) return;
    const c = b.ceil, hw = halfW(b);
    b.x += b.cdir * spd(b, 'ceil') * dt;
    if (b.ceilStop !== null && (b.cdir > 0 ? b.x >= b.ceilStop : b.x <= b.ceilStop)) {
      b.cdir = 0; b.ceilStop = null; b.clingUntil = now + rand(1500, 4000);
      return;
    }
    const atLeft = b.x <= c.x1 + hw, atRight = b.x >= c.x2 - hw;
    if (!atLeft && !atRight) return;
    const side = atLeft ? 'L' : 'R', ex = atLeft ? c.x1 : c.x2;
    const w = this.walls.find((q) => q.side === side && Math.abs(q.x - ex) <= 2 && Math.abs(q.y1 - c.y) <= 4);
    if (w) {
      this.enterWall(b, w, 1, w.y1 + hw, now);
      b.climbPlan = { next: 'down' };
      return;
    }
    this.letGo(b, 'drop');
  }

  /** Centre of the body, whatever surface it is on. */
  centre(b) {
    const h = tall(b);
    if (b.mode === 'wall') return { x: b.wall.side === 'R' ? b.wall.x - h / 2 : b.wall.x + h / 2, y: b.y };
    if (b.mode === 'ceil') return { x: b.x, y: b.ceil.y + h / 2 };
    return { x: b.x, y: b.y - h / 2 };
  }

  checkPoke(b, now) {
    const c = this.cursor;
    if (b.hovered || b.hide || c.speed < 1400 || now - b.pokeAt < 1500) return;
    const m = this.centre(b);
    if (Math.abs(c.x - m.x) < halfW(b) && Math.abs(c.y - m.y) < tall(b) / 2 + 4) {
      b.pokeAt = now;
      this.wake(b);
      b.queue = b.queue.filter((q) => q.then);
      b.push('startled', 700, { sound: 'poke', bubble: '!' });
    }
  }

  // ------------------------------------------------------------ behaviour
  think(b, now, dt) {
    const s = b.session;
    // Stay put: floating in mid-air, or clinging to a wall or the ceiling, counts as standing.
    const grounded = b.mode === 'auto' || b.mode === 'float' || (b.pinned && (b.mode === 'wall' || b.mode === 'ceil'));
    if (b.pinned && (b.mode === 'wall' || b.mode === 'ceil')) b.cdir = 0;

    // 0. Hiding: sneak to the nearest screen edge, vanish, come back later
    //    (or straight away when Claude needs you).
    if (b.hide) {
      const H = b.hide;
      if (now >= H.until || s.attention === 'permission' || s.attention === 'question') { b.hide = null; }
      else {
        if (!grounded) return this.letGo(b, 'drop');
        if (H.phase === 'leaving' && !b.plat) H.phase = 'gone'; // floating or clinging: fade out right there
        if (H.phase === 'leaving') {
          if (b.walkTarget === null) {
            const p = b.plat;
            const toLeft = b.x - p.x1 < p.x2 - b.x;
            const edge = toLeft ? p.x1 + halfW(b) / 2 : p.x2 - halfW(b) / 2;
            if (Math.abs(edge - b.x) < 4) H.phase = 'gone';
            else this.walkTo(b, edge, spd(b, 'sneak') * 2, 'ninja');
          }
          b.setAnim(b.walkTarget !== null ? b.walkAnim : 'idle');
        } else {
          b.walkTarget = null;
          b.alpha = Math.max(0, b.alpha - dt * 2);
          b.setAnim('idle');
        }
        b.bubble = null;
        return;
      }
    }

    // 0b. The usage limit was hit: total panic until the Overlord takes them.
    if (this.panicking()) {
      b.sleeping = false; b.typingUntil = 0; b.queue = []; b.react = null; b.task = null; b.carry = null;
      if (!grounded) return this.letGo(b, 'drop');
      b.bubble = '!';
      if (b.plat && (b.walkTarget === null || Math.random() < 0.02)) {
        const tx = clamp(b.x + rand(-1, 1) * 70 * b.scale, b.plat.x1 + halfW(b), b.plat.x2 - halfW(b));
        this.walkTo(b, tx, spd(b, 'run') * 2.2, 'zoom');
        b.flip = tx < b.x;
      }
      b.setAnim(b.walkTarget !== null ? 'zoom' : 'startled');
      return;
    }

    // 1. One-shot reactions (celebrations, errors, greetings, landings) play in
    //    order, on the ground: a climbing buddy lets go first.
    if (b.react && now >= b.react.until) { const then = b.react.then; b.react = null; then?.(); }
    if (!b.react && b.queue.length) {
      if (!grounded) return this.letGo(b, 'drop');
      const q = b.queue.shift();
      b.react = { ...q, until: now + q.dur };
      if (q.sound) this.sound(b, q.sound);
      if (q.start) q.start();
      if (q.face !== undefined) b.flip = q.face;
    }
    b.carry = b.react && b.react.carry ? b.react.carry : null;
    if (b.react) {
      b.walkTarget = null;
      b.setAnim(b.react.anim);
      b.bubble = b.react.bubble || null;
      return;
    }
    if (b.leaving) { if (!grounded) this.letGo(b, 'drop'); return; }

    // 1b. Files are being dragged over it: arms up, ready to catch them.
    if (b.dragHint && now - b.dragHint < 300) {
      b.walkTarget = null; b.exit = null; b.cdir = 0; b.action = null; b.sleeping = false; b.idleSince = now;
      b.setAnim(grounded ? 'holdUp' : 'look');
      b.bubble = null;
      return;
    }

    // 2. You're typing in its window: type along, wherever it is (walls included).
    if (now < b.typingUntil) {
      b.walkTarget = null; b.exit = null; b.cdir = 0; b.action = null;
      b.setAnim(b.typeKind === 'erase' ? 'typeErase' : 'typing');
      b.bubble = null;
      return;
    }

    // 3. Something you asked for: come here, fetch, snack.
    if (b.task && this.doTask(b, now)) return;

    // 4. Being looked at: stop and face the user.
    const alert = this.alertBubble(s);
    if (b.hovered) {
      b.walkTarget = null; b.exit = null; b.cdir = 0;
      if (s.attention === 'done' && now - b.hoverAt > 400) b.ackDone = true;
      if (!grounded) { b.setAnim('look'); b.bubble = alert || this.doneBubble(s, b); return; }
      if (s.state !== 'working' || alert) { b.setAnim(alert ? 'alert' : 'idle'); b.bubble = alert || this.doneBubble(s, b); return; }
    }

    // Work, alerts and naps happen on the ground; sleepy buddies drop gently.
    if (!grounded) {
      if (s.state === 'working' || alert) return this.letGo(b, 'drop');
      if (now - b.idleSince > SLEEP_AFTER) return this.letGo(b, 'nap');
      return this.idleUp(b, now);
    }

    // 5. Don't stand on top of each other (the newer buddy steps aside).
    if (b.separating && b.walkTarget !== null) { b.setAnim('walk'); return; }
    b.separating = false;
    const crowd = !b.pinned && !b.meet && this.nearby(b, 6 * b.scale + 36, (o) => o.id < b.id && !o.meet);
    if (crowd && b.plat) {
      const away = b.x >= crowd.x ? 1 : -1, gap = 25 * b.scale;
      let tx = crowd.x + away * gap;
      if (tx < b.plat.x1 + halfW(b) || tx > b.plat.x2 - halfW(b)) tx = crowd.x - away * gap;
      this.walkTo(b, tx, spd(b, 'walk'), 'walk');
      b.separating = true;
      b.action = null;
      b.setAnim('walk');
      return;
    }
    // …and keep the skyscraper's front clear (the left screen edge is a popular spot).
    const clear = !b.pinned && b.plat && !b.plat.win && b.walkTarget === null && this.towerClearX(b);
    if (clear) {
      this.walkTo(b, clear, spd(b, 'walk') * 1.6, 'walk');
      b.separating = true;
      b.action = null;
      b.setAnim('walk');
      return;
    }

    // 6. Claude needs the user (a real permission prompt or question on screen): bounce with ! or ?.
    if (alert) {
      b.walkTarget = null;
      b.sleeping = false;
      b.setAnim('alert');
      b.bubble = alert;
      return;
    }

    // A finished turn just shows a ✓ (until you hover or click); it doesn't interrupt anything.
    b.bubble = this.doneBubble(s, b) || (s.context && s.context.pct >= 90 && s.kind !== 'compacting' ? 'ctx' : null);
    if (s.state === 'working') return this.work(b, now);
    return this.idle(b, now);
  }

  alertBubble(s) {
    if (s.attention === 'permission') return '!';
    if (s.attention === 'question') return '?';
    return null;
  }

  doneBubble(s, b) { return s.attention === 'done' && !b.ackDone ? '✓' : null; }

  /** User-requested tasks. Returns true while the task drives the buddy. */
  doTask(b, now) {
    const T = b.task;
    const grounded = b.mode === 'auto';
    if (now > T.until) { this.endTask(b); return false; }
    b.bubble = null;
    if (T.type === 'snack') {
      if (!grounded) { this.letGo(b, 'drop'); return true; }
      b.walkTarget = null;
      b.setAnim('look');
      return true;
    }
    if (T.type === 'come') {
      const p = this.platformUnder(T.x, T.y);
      if (!p) { this.endTask(b); return false; }
      if (grounded && b.plat && b.plat.key === p.key) {
        if (Math.abs(T.x - b.x) < 3 || b.walkTarget === null && T.walked) {
          this.endTask(b);
          b.flip = this.cursor.x < b.x;
          b.push('cheer', 700, { sound: 'chirp' });
          return true;
        }
        if (b.walkTarget === null) { this.walkTo(b, T.x, spd(b, 'run') * 1.6, 'zoom'); T.walked = true; }
        b.setAnim(b.walkAnim);
        return true;
      }
      if (!T.leapt || now - T.leapt > 1600) { T.leapt = now; this.leapTo(b, clamp(T.x, p.x1 + halfW(b), p.x2 - halfW(b)), p); }
      return true;
    }
    if (T.type === 'home') return this.homeTask(b, T, now);
    if (T.type === 'boss') return this.bossTask(b, T, now);
    if (T.type === 'fetch') {
      const ball = T.ball;
      if (!this.items.includes(ball)) { this.endTask(b); return false; }
      // Wherever it ended up (tossed onto a wall, the ceiling, left floating), it gets back down and carries on.
      if (b.mode === 'wall' || b.mode === 'ceil') { this.letGo(b, 'drop'); return true; }
      if (b.mode === 'float') { this.drop(b, 'drop'); return true; }
      if (T.phase === 'watch') {
        if (!grounded) return true;
        b.walkTarget = null;
        b.flip = ball.x < b.x;
        b.setAnim('look');
        if (ball.rest || now - ball.born > 2500) T.phase = 'chase';
        return true;
      }
      if (T.phase === 'return' && ball.carrier !== b) T.phase = 'chase'; // dropped it somehow: go get it again
      const target = T.phase === 'chase' ? { x: ball.x, y: ball.y } : T.home;
      const p = T.phase === 'chase' && ball.rest ? ball.rest : this.platformUnder(target.x, target.y);
      if (!p) { b.setAnim('look'); return true; }
      // No closer for a long while (the ball is somewhere it can't get to): the ball rolls down to it,
      // or, on the way back, it drops the ball where it is. Never stuck for good.
      const dist = Math.abs(target.x - b.x) + Math.abs(p.y - b.y);
      if (T.best === undefined || dist < T.best - 10) { T.best = dist; T.progressAt = now; }
      else if (now - (T.progressAt || now) > 40e3) {
        T.best = undefined; T.progressAt = now;
        if (T.phase === 'return') { T.home = { x: b.x, y: b.y }; }
        else if (b.plat) { Object.assign(ball, { rest: null, carrier: null, x: clamp(b.x + (b.x < (b.plat.x1 + b.plat.x2) / 2 ? 1 : -1) * 70, b.plat.x1 + 12, b.plat.x2 - 12), y: b.plat.y - 260, vx: 0, vy: 0 }); }
      }
      if (!grounded) return true; // mid-leap
      if (b.plat && b.plat.key === p.key) {
        if (Math.abs(target.x - b.x) < halfW(b) * 0.8) {
          if (T.phase === 'chase') {
            if (!ball.rest) { b.setAnim('look'); return true; } // wait for it to settle
            ball.carrier = b; ball.rest = null; T.phase = 'return';
            this.sound(b, 'chirp');
          } else {
            ball.carrier = null; ball.rest = b.plat; ball.y = b.plat.y; ball.x = b.x + (b.flip ? -1 : 1) * halfW(b); ball.vx = 0; ball.vy = 0; ball.fadeAt = now;
            this.endTask(b);
            b.flip = this.cursor.x < b.x;
            b.push('cheer', 900, { sound: 'done' });
          }
          b.walkTarget = null;
          return true;
        }
        this.walkTo(b, target.x, spd(b, 'run') * 1.6, 'zoom');
        b.setAnim('zoom');
        return true;
      }
      if (!T.leapt || now - T.leapt > 1600) { T.leapt = now; this.leapTo(b, clamp(target.x, p.x1 + halfW(b), p.x2 - halfW(b)), p); }
      return true;
    }
    this.endTask(b);
    return false;
  }

  // ------------------------------------------------------------ the skyscraper
  /** main.js keeps this list: every known buddy (oldest first), with what its floor shows. */
  setResidents(list) { this.tower.residents = list; }

  /** Where the skyscraper stands: the bottom-left corner of the main display. */
  towerGeom() {
    const d = this.displays.find((x) => x.primary) || this.displays[0];
    if (!d) return null;
    const base = Number(d.internal ? this.sizes.internal : this.sizes.external) || BASE_SCALE;
    // One art pixel in DIPs as it really appears: a whole number of device pixels (2.4 at 125%, not 2).
    const sf = Number(d.scale) || 1, ts = Math.max(1, Math.round(clamp(Math.round(base * 0.75), 2, 4) * sf)) / sf;
    const ground = this.floorY(d);
    const x0 = d.workArea.x + 10;
    const room = ground - (d.workArea.y + 90) - (TW.LOBBY + TW.ROOF) * ts;
    const max = Math.max(1, Math.floor(room / (TW.FLOOR * ts)));
    const all = this.tower.residents;
    // More buddies than floors fit: the most recently seen ones get the floors.
    const shown = all.length > max ? [...all].sort((a, c) => (c.seen || 0) - (a.seen || 0)).slice(0, max).sort((a, c) => (a.created || 0) - (c.created || 0)) : all;
    return {
      d, ts, ground, x0, n: shown.length, shown, hidden: all.length - shown.length,
      door: x0 + (TW.DOOR_X + TW.DOOR_W / 2) * ts,
    };
  }

  towerFloor(g) {
    return this.platforms.find((p) => !p.win && g.door >= p.x1 && g.door <= p.x2 && Math.abs(p.y - g.ground) < 2) || this.platformUnder(g.door, g.ground - 4);
  }

  /** A buddy standing in front of the skyscraper: where to step to so it's visible again (or null). */
  towerClearX(b) {
    const g = this.towerGeom();
    if (!g || !g.n || Math.abs(b.plat.y - g.ground) > 2) return null;
    const right = g.x0 + TW.W * g.ts + halfW(b) + 6;
    if (b.x >= right || b.x <= g.x0 - halfW(b) || right + 70 > b.plat.x2) return null;
    return right + rand(10, 60);
  }

  towerToggle(open = !this.tower.open) {
    this.tower.open = open;
    if (!open) this.tower.holdUntil = 0;
  }

  /** Send a buddy home: it walks (or leaps) to the skyscraper, goes in, and rides up to its floor. */
  goHome(id, { hurry = false } = {}) {
    const b = this.buddies.get(id);
    if (!b || b.leaving) return false;
    if (b.mode === 'ride') {
      // Turned off again before it got out: it never left.
      this.tower.rides = this.tower.rides.filter((r) => r.id !== id);
      this.buddies.delete(id); this.hooks.removed?.(id);
      return true;
    }
    if (b.mode === 'enter') return true;
    if (this.homeBound(b)) { if (hurry) b.task.hurry = true; return true; }
    const g = this.towerGeom();
    if (!g || !this.towerFloor(g) || ['hell', 'doom', 'birth'].includes(b.mode) || this.doom) return false;
    if (b.mode === 'script') { const S = b.script; b.script = null; b.stretch = 1; this.drop(b, 'drop'); S.onDone?.(); }
    b.hide = null; b.pinned = false; b.sleeping = false; b.action = null; b.react = null;
    b.queue = b.queue.filter((q) => q.then);
    if (this.items.some((it) => it.carrier === b)) this.endTask(b);
    b.task = { type: 'home', until: Infinity, hurry };
    if (!hurry) b.push('wave', 900, { sound: 'bye' });
    return true;
  }

  homeTask(b, T, now) {
    const g = this.towerGeom(), p = g && this.towerFloor(g);
    if (!p) { b.task = null; this.remove(b.id); return true; }
    T.at = T.at || now;
    if (now - T.at > 60e3 && b.mode === 'auto') {
      // Can't find its way to the door: it fades out here and turns up in the elevator anyway.
      b.task = null; b.mode = 'enter'; b.enterAt = now; this.sound(b, 'door');
      return true;
    }
    if (b.mode === 'wall' || b.mode === 'ceil') { this.letGo(b, 'drop'); return true; }
    if (b.mode === 'float') { this.drop(b, 'drop'); return true; }
    if (b.mode !== 'auto') return true; // in the air
    b.bubble = null;
    if (b.plat && b.plat.key === p.key) {
      if (Math.abs(g.door - b.x) < 4) {
        b.walkTarget = null;
        b.x = g.door;
        // Wait on the doorstep until the building has risen out of the ground.
        if (this.tower.h < 1) { b.flip = true; b.setAnim('look'); return true; }
        b.task = null;
        b.mode = 'enter';
        b.enterAt = now;
        b.flip = false;
        b.setAnim('walk');
        this.sound(b, 'door');
        return true;
      }
      if (b.walkTarget === null || Math.abs(b.walkTarget - g.door) > 2) {
        const far = T.hurry || Math.abs(g.door - b.x) > 260;
        this.walkTo(b, g.door, spd(b, far ? 'run' : 'walk') * (T.hurry ? 2.2 : 1.2), far ? 'zoom' : 'walk');
      }
      b.setAnim(b.walkAnim);
      return true;
    }
    if (!T.leapt || now - T.leapt > 1600) { T.leapt = now; this.leapTo(b, clamp(g.door + 50 * b.scale, p.x1 + halfW(b), p.x2 - halfW(b)), p); }
    return true;
  }

  /** Stepping through the lobby door. */
  enterTick(b, now) {
    const k = (now - b.enterAt) / 550;
    b.alpha = Math.max(0, 1 - k);
    b.setAnim('walk');
    b.bubble = null;
    if (k < 1) return;
    this.buddies.delete(b.id);
    this.tower.rides.push({ id: b.id, dir: 'up', phase: 'call', at: now, look: { body: b.look.body, hat: b.look.hat } });
    this.hooks.removed?.(b.id);
  }

  /** Turn a buddy on from its floor: it rides the elevator down and walks out of the lobby. */
  leaveHome(session, look) {
    if (this.buddies.has(session.id)) return this.buddies.get(session.id);
    const g = this.towerGeom();
    if (!g || !this.towerFloor(g) || this.doom) return this.add(session, { look, birth: false });
    const b = new Buddy(session, look);
    b.mode = 'ride'; b.alpha = 0; b.spawned = false;
    b.x = g.door; b.y = g.ground;
    b.scale = this.scaleAt(b);
    this.buddies.set(b.id, b);
    this.tower.rides.push({ id: b.id, dir: 'down', phase: 'call', at: Date.now(), look: { body: b.look.body, hat: b.look.hat } });
    return b;
  }

  towerTick(now, dt) {
    const W = this.tower, g = this.towerGeom();
    if (!g) return;
    const coming = [...this.buddies.values()].some((b) => this.homeBound(b) || b.mode === 'enter');
    if (coming || W.rides.length) W.holdUntil = now + 1800; // rises for arrivals and departures, then sinks again
    const up = W.open || now < W.holdUntil;
    W.h = clamp(W.h + ((up ? 1 : -1) * dt) / 0.6, 0, 1);
    const R = W.rides[0];
    if (!R || W.h < 1) return;
    const floor = g.shown.findIndex((r) => r.id === R.id);
    if (floor < 0) return this.finishRide(R, g, now); // no floor on screen for it (too many buddies)
    const speed = Math.max(3, g.n / 1.5); // floors per second
    const toward = (f) => {
      const d = f - W.car.f;
      if (Math.abs(d) <= speed * dt) { W.car.f = f; return true; }
      W.car.f += Math.sign(d) * speed * dt;
      return false;
    };
    const t = now - R.at;
    const next = (phase) => { R.phase = phase; R.at = now; };
    if (R.dir === 'up') {
      if (R.phase === 'call') { if (toward(-1)) next('board'); }
      else if (R.phase === 'board') { if (t > 600) next('lift'); }
      else if (R.phase === 'lift') { if (toward(floor)) { next('exit'); this.hooks.sound('chirp', g.door, g.ground); } }
      else if (t > 800) this.finishRide(R, g, now);
    } else if (R.phase === 'call') { if (toward(floor)) next('leave'); }
    else if (R.phase === 'leave') { if (t > 800) next('lift'); }
    else if (R.phase === 'lift') { if (toward(-1)) next('out'); }
    else if (t > 600) this.finishRide(R, g, now);
  }

  finishRide(R, g, now) {
    this.tower.rides = this.tower.rides.filter((r) => r !== R);
    if (R.dir !== 'down') return;
    const b = this.buddies.get(R.id), p = this.towerFloor(g);
    if (!b || b.mode !== 'ride' || !p) return;
    this.standOn(b, p, g.door);
    b.alpha = 0.15;
    b.flip = false;
    b.idleSince = now;
    const out = clamp(g.door + rand(25, 60) * b.scale, p.x1 + halfW(b), p.x2 - halfW(b));
    b.push('hi', 1300, { sound: 'greet', then: () => { if (b.mode === 'auto' && b.session.state !== 'working') { this.walkTo(b, out); b.action = { type: 'walk' }; } } });
  }

  towerSnapshot(now) {
    const W = this.tower, g = this.towerGeom();
    if (!g || !g.n) return null;
    const R = W.rides[0], t = R ? now - R.at : 0;
    const floors = g.shown.map((r) => {
      const b = this.buddies.get(r.id);
      const ride = W.rides.find((x) => x.id === r.id);
      // Lit = at home. mini: where its little figure stands (0 in the room .. 1 at the elevator).
      let lit = !b && !(ride && ride.dir === 'up'), mini = lit ? 0 : null;
      if (ride && ride.dir === 'down' && (ride !== R || R.phase === 'call')) { lit = true; mini = 0; }
      if (ride && ride === R && R.dir === 'down' && R.phase === 'leave') { lit = true; mini = clamp(t / 800, 0, 1); }
      if (ride && ride === R && R.dir === 'up' && R.phase === 'exit') { lit = true; mini = 1 - clamp(t / 800, 0, 1); }
      const on = !!b && !this.homeBound(b) && b.mode !== 'enter';
      const busy = !!ride || (!!b && (this.homeBound(b) || b.mode === 'enter'));
      const status = !b || b.mode === 'ride' ? (ride ? 'on the way' : 'home') : this.homeBound(b) || b.mode === 'enter' ? 'coming home' : b.session.state === 'working' ? 'at work' : 'out and about';
      return { id: r.id, name: r.name, body: r.body, hat: r.hat, room: r.room, lit, mini, on, busy, status };
    });
    let lobby = null;
    if (R && R.phase === 'board') lobby = { k: clamp(t / 600, 0, 1), dir: 'in', body: R.look.body };
    if (R && R.phase === 'out') lobby = { k: clamp(t / 600, 0, 1), dir: 'out', body: R.look.body };
    const entering = [...this.buddies.values()].some((b) => b.mode === 'enter' || (this.homeBound(b) && b.plat && Math.abs(b.x - g.door) < 30 * b.scale));
    return {
      d: g.d.id, x0: g.x0, ground: g.ground, ts: g.ts, h: W.h, open: W.open, floors, hidden: g.hidden,
      car: { f: W.car.f, rider: R && R.phase === 'lift' ? R.look.body : null, door: !!R && ['board', 'out', 'exit', 'leave'].includes(R.phase) },
      lobby, door: entering || !!lobby,
    };
  }

  // ------------------------------------------------------------ being sick
  tickPuke(now, dt) {
    const P = this.puke;
    for (const b of this.buddies.values()) {
      if (!b.vomiting) continue;
      if (now > b.vomiting.until || (b.mode !== 'auto' && b.mode !== 'float')) { b.vomiting = null; continue; }
      if (Math.random() < 0.8) {
        const dir = b.flip ? -1 : 1, s = Math.max(2, Math.round(b.scale * 0.75));
        P.drops.push({ x: b.x + dir * 2 * b.scale, y: b.y - 5.5 * b.scale, vx: dir * rand(70, 280) + rand(-40, 40), vy: rand(-280, -60), s, c: pick(PUKE) });
      }
    }
    // It falls past window ledges onto the floor (your taskbar), pools there, spreads, and sinks in.
    for (const d of [...P.drops]) {
      const prevY = d.y;
      d.vy += G * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      const fl = this.platforms.find((q) => !q.win && d.x >= q.x1 && d.x <= q.x2 && prevY <= q.y + 1 && d.y >= q.y);
      if (fl) {
        P.drops.splice(P.drops.indexOf(d), 1);
        let pd = P.puddles.find((q) => q.y === fl.y && Math.abs(q.x - d.x) < q.w / 2 + 8 * d.s);
        if (!pd) { pd = { x: d.x, y: fl.y, w: 4 * d.s, v: 0, s: d.s, seed: Math.floor(Math.random() * 1000), last: now }; P.puddles.push(pd); }
        pd.v++; pd.last = now;
        pd.w = Math.min(70 * pd.s, pd.w + 1.5 * d.s);
        pd.x += (d.x - pd.x) * 0.08;
      } else if (d.y > this.bounds.y1 + 200) P.drops.splice(P.drops.indexOf(d), 1);
    }
    for (const pd of [...P.puddles]) {
      const age = now - pd.last;
      pd.w = Math.min(80 * pd.s, pd.w + dt * pd.s * (age < 2500 ? 5 : 1.5));
      pd.sink = clamp((age - 2500) / 4500, 0, 1);
      if (pd.sink >= 1) P.puddles.splice(P.puddles.indexOf(pd), 1);
    }
  }

  endTask(b) {
    const T = b.task;
    b.task = null;
    b.walkTarget = null;
    if (T && T.type === 'fetch' && T.ball) { T.ball.carrier = null; T.ball.fadeAt = T.ball.fadeAt || Date.now(); }
  }

  work(b, now) {
    const s = b.session;
    b.action = null;
    b.meet = null;
    b.exit = null;
    b.idleSince = now;
    if (b.sleeping) this.wake(b);
    let kind = s.kind === 'thinking' && now - s.kindSince > 25e3 ? 'deepThought' : s.kind;
    if (!Clawd.ACTIVITY_ANIMS[kind]) kind = 'thinking';
    // With real helpers walking around, the pack's "minis" pose would double them up.
    if (kind === 'delegating' && b.look.helpers !== false) kind = 'planning';

    // Hold each activity for a moment so rapid tool calls don't flicker,
    // and re-pick a variant now and then during long stretches.
    const switchKind = kind !== b.workKind && now - b.workKindAt > 1200;
    if (!b.workKind || switchKind || now - b.workKindAt > 14e3) {
      b.workKind = kind;
      b.workKindAt = now;
      b.workAnim = pick(Clawd.ACTIVITY_ANIMS[kind]);
      b.walkTarget = null;
    }

    if (b.workKind === 'thinking' && b.plat && !b.hovered && !b.pinned && !this.nearby(b, 28 * b.scale, () => true)) {
      // Pace back and forth while thinking.
      if (b.walkTarget === null && now > b.paceAt) {
        b.paceAt = now + rand(3500, 7000);
        if (Math.random() < 0.6) this.walkTo(b, b.x + rand(10, 22) * b.scale * (Math.random() < 0.5 ? -1 : 1), spd(b, 'pace'), 'thinkWalk');
      }
      b.setAnim(b.walkTarget !== null ? 'thinkWalk' : b.workAnim);
      return;
    }
    b.walkTarget = null;
    let anim = b.workAnim;
    if (LONG_WAIT_KINDS.has(s.kind) && now - s.kindSince > 30e3 && Math.floor((now - s.kindSince) / 6000) % 2) anim = 'hourglass';
    b.setAnim(anim);
  }

  idle(b, now) {
    const s = b.session;
    b.workKind = null;
    if (now - s.lastEventAt > STALE_AFTER && !b.leaving) { if (this.hooks.stale) this.hooks.stale(b.id); else this.remove(b.id); return; }

    // On the way to meet a friend (this survives leaps and landings, unlike b.action).
    if (b.meet) {
      if (this.meetTick(b, b.meet, now)) return;
      b.meet = null;
    }

    const a = b.action;
    if (a) {
      if (a.type === 'walk') {
        // A long stroll can be cut short when there's a friend to see.
        if (b.walkTarget !== null && now - b.greetAt > GREET_COOLDOWN && Math.random() < 0.004) {
          const friend = this.findFriend(b, now);
          if (friend) { b.greetAt = friend.greetAt = now; b.meet = { other: friend, until: now + 30000, leapt: 0 }; this.stopWalk(b); return; }
        }
        if (b.walkTarget !== null) { b.setAnim(b.walkAnim); return; }
        b.action = null;
      } else if (a.type === 'sleep') {
        b.setAnim(a.anim);
        return;
      } else if (a.type === 'jump') {
        if (now < a.until) { b.setAnim('crouch'); return; }
        b.action = null;
        return this.launch(b, a);
      } else if (now < a.until) {
        b.setAnim(a.anim);
        if (a.anim === 'look') this.faceCursor(b);
        return;
      } else {
        b.action = null;
      }
    }

    // Nap time: always on the bottom floor, next to a sleeping friend if one is close.
    if (now - b.idleSince > SLEEP_AFTER) {
      if (b.plat && b.plat.win && !b.pinned) {
        const end = b.x - b.plat.x1 < b.plat.x2 - b.x ? 'L' : 'R';
        this.walkTo(b, end === 'R' ? b.plat.x2 + 40 : b.plat.x1 - 40, spd(b, 'walk'));
        b.exit = end; b.exitKind = 'nap';
        b.action = { type: 'walk' };
        return;
      }
      const friend = !b.pinned && this.nearby(b, 105 * b.scale, (o) => o.sleeping);
      if (friend && Math.abs(friend.x - b.x) > 19 * b.scale && !b.sleepWalked) {
        b.sleepWalked = true;
        this.walkTo(b, friend.x + (b.x < friend.x ? -17 : 17) * b.scale);
        b.action = { type: 'walk' };
        return;
      }
      b.sleeping = true;
      b.sleepWalked = false;
      b.action = { type: 'sleep', anim: Math.random() < 0.6 ? 'nap' : 'sleeping' };
      return;
    }

    // Pinned buddies stay where they are and just fidget.
    if (b.pinned) {
      b.action = { type: 'anim', anim: Math.random() < 0.5 ? pick(Clawd.ACTIVITY_ANIMS.fidget) : pick(['look', 'idle']), until: now + rand(3000, 6500) };
      return;
    }

    if (this.maybeSnowball(b, now)) return;

    // Nothing to do: go and find a friend (on any screen) to hang out with.
    if (now - b.greetAt > GREET_COOLDOWN && Math.random() < 0.6) {
      const friend = this.findFriend(b, now);
      if (friend) {
        b.greetAt = friend.greetAt = now;
        b.meet = { other: friend, until: now + 30000, leapt: 0 };
        b.action = null;
        return;
      }
    }

    const r = Math.random();
    if (r < 0.26) {
      const dist = rand(15, 75) * b.scale * (Math.random() < 0.5 ? -1 : 1);
      const style = Math.abs(dist) > 45 * b.scale && Math.random() < 0.3 ? pick(['zoom', 'ninja']) : 'walk';
      this.walkTo(b, b.x + dist, spd(b, style === 'zoom' ? 'run' : style === 'ninja' ? 'sneak' : 'walk'), style);
      b.action = { type: 'walk' };
    } else if (r < 0.40 && this.planJump(b, now)) {
      // planJump set the action
    } else if (r < 0.56 && !this.isWet(now) && this.planClimb(b)) {
      // walking to a screen edge to climb it
    } else if (r < 0.62 && this.planCross(b)) {
      // wandering over to the next monitor
    } else if (r < 0.82) {
      b.action = { type: 'anim', anim: pick(Clawd.ACTIVITY_ANIMS.fidget), until: now + rand(4000, 7500) };
    } else {
      b.action = { type: 'anim', anim: Math.random() < 0.5 ? 'look' : 'idle', until: now + rand(1800, 4000) };
    }
  }

  // ------------------------------------------------------------ friends
  /** Free for a chat: awake, not working, nothing else on. Lenient: also while it climbs, falls or finishes a reaction. */
  sociable(o, now, lenient = false) {
    if (!o || this.buddies.get(o.id) !== o || o.leaving || o.hide || o.sleeping || o.pinned || o.isMini || o.task || this.panicking()) return false;
    if (o.session.state === 'working' || o.session.attention === 'permission' || o.session.attention === 'question') return false;
    if (lenient) return ['auto', 'wall', 'ceil', 'air'].includes(o.mode);
    return o.mode === 'auto' && !!o.plat && !o.react && !o.queue.length;
  }

  /** Stop where you are (dropping any plan to walk off an edge, climb or cross). */
  stopWalk(b) { b.walkTarget = null; b.exit = null; b.exitKind = null; b.climbPlan = null; b.action = null; }

  findFriend(b, now) {
    if (!b.plat || b.pinned) return null;
    let best = null, bestD = Infinity;
    for (const o of this.buddies.values()) {
      if (o === b || !this.sociable(o, now, true) || o.mode === 'air' || now - o.greetAt < GREET_COOLDOWN * 0.5) continue;
      if (o.meet) continue;
      const d = Math.abs(o.x - b.x) + Math.abs(o.y - b.y) * 2 + (o.plat && o.plat.key === b.plat.key ? 0 : 400);
      if (d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  /** Walking (or leaping) over to a friend. Returns false when the meeting is off. */
  meetTick(b, a, now) {
    const o = a.other;
    if (now > a.until || !this.sociable(o, now, true) || !b.plat) return false;
    if (o.mode !== 'auto' || !o.plat || o.react || o.queue.length) {
      // Up on a wall or the ceiling (or still busy with something): call it down and wait for it.
      if (o.mode === 'wall' || o.mode === 'ceil') o.callDown = now;
      b.walkTarget = null;
      b.flip = o.x < b.x;
      b.setAnim('look');
      return true;
    }
    const gap = Math.max(15 * Math.max(b.scale, o.scale), 6 * b.scale + 40);
    if (b.plat.key === o.plat.key) {
      if (Math.abs(o.x - b.x) <= gap + 8) { this.greet(b, o, now); return true; }
      this.stopWalk(o); o.action = { type: 'anim', anim: 'look', until: now + 1500 }; o.flip = b.x < o.x; // it waits for you
      let tx = o.x + (b.x < o.x ? -gap : gap);
      if (tx < b.plat.x1 + halfW(b) || tx > b.plat.x2 - halfW(b)) tx = o.x + (b.x < o.x ? gap : -gap);
      if (b.walkTarget === null || Math.abs(b.walkTarget - tx) > 24) {
        const far = Math.abs(tx - b.x) > 320;
        this.walkTo(b, tx, spd(b, far ? 'run' : 'walk'), far ? 'zoom' : 'walk');
      }
      b.setAnim(b.walkAnim);
      return true;
    }
    if (!a.leapt || now - a.leapt > 1800) {
      a.leapt = now;
      const p = o.plat, side = b.x < o.x ? -1 : 1;
      this.leapTo(b, clamp(o.x + side * gap, p.x1 + halfW(b), p.x2 - halfW(b)), p);
    }
    return true;
  }

  /** Idle behaviour while hanging on a wall or the ceiling. */
  idleUp(b, now) {
    if (b.callDown && now - b.callDown < 1500) { b.callDown = 0; return this.letGo(b, 'jump'); } // a friend wants to chat: hop down
    if (!b.pinned && this.isWet(now)) return this.letGo(b, 'jump'); // rain: down to the ground, umbrella up
    if (b.mode === 'wall') {
      if (!b.cdir && now >= b.clingUntil) {
        const next = b.pinned ? 'down' : b.climbPlan?.next || pick(['down', 'drop', 'ceil']);
        if (next === 'drop') return this.letGo(b, 'drop');
        b.climbPlan = { next };
        b.cdir = next === 'down' ? 1 : -1;
      }
      const up = b.cdir < 0;
      if (b.cdir) b.flip = b.wall.side === 'R' ? !up : up; // sprites face "forward" = up on a right wall
      b.setAnim(b.cdir ? 'walk' : 'look');
      return;
    }
    if (!b.cdir && now >= b.clingUntil) {
      if (b.pinned || Math.random() < 0.45) return this.letGo(b, 'drop');
      b.cdir = Math.random() < 0.5 ? -1 : 1;
      b.ceilStop = Math.random() < 0.6 ? b.x + b.cdir * rand(150, 600) : null;
    }
    if (b.cdir) b.flip = b.cdir > 0; // upside down, "forward" is left
    b.setAnim(b.cdir ? 'walk' : 'look');
  }

  faceCursor(b) {
    const c = this.cursor;
    if (Math.hypot(c.x - b.x, c.y - b.y) < 260) b.flip = c.x < b.x;
  }

  nearby(b, range, filter) {
    let best = null;
    for (const o of this.buddies.values()) {
      if (o === b || o.mode !== 'auto' || o.leaving || o.hide || !o.plat || !b.plat || o.plat.key !== b.plat.key) continue;
      const d = Math.abs(o.x - b.x);
      if (d < range && filter(o) && (!best || d < Math.abs(best.x - b.x))) best = o;
    }
    return best;
  }

  greet(b, other, now) {
    b.action = null;
    b.meet = null;
    if (!this.buddies.has(other.id) || other.mode !== 'auto' || other.session.state === 'working') return;
    other.meet = null;
    this.stopWalk(other);
    this.stopWalk(b);
    b.greetAt = other.greetAt = now;
    const bFaceLeft = other.x < b.x;
    b.push('hi', 1400, { face: bFaceLeft, sound: 'greet' });
    other.push('ola', 1400, { face: !bFaceLeft });
    const scene = pickScene(b, other);
    const pair = [b, other], faces = [bFaceLeft, !bFaceLeft];
    for (const [who, text, anim, sound] of scene) {
      if (who === 'both') {
        const dur = 1700;
        pair.forEach((x, i) => x.push(anim, dur, { face: faces[i], say: Array.isArray(text) ? text[i] : text || undefined, sound: i === 0 ? sound : undefined }));
        continue;
      }
      const dur = clamp(1000 + text.length * 60, 1500, 3000);
      pair.forEach((x, i) => x.push(i === who ? anim || 'talk' : 'look', dur, { face: faces[i], say: i === who ? text : undefined, sound: i === who ? sound || 'chat' : undefined }));
    }
  }

  /** Walk to a screen edge and climb it. */
  planClimb(b) {
    const p = b.plat;
    if (!p || p.win) return false;
    const ends = ['L', 'R'].filter((end) => this.wallAtEnd(p, end, b));
    if (!ends.length) return false;
    const dist = (end) => Math.abs((end === 'R' ? p.x2 : p.x1) - b.x);
    const end = Math.random() < 0.7 ? ends.sort((a, c) => dist(a) - dist(c))[0] : pick(ends);
    const fast = dist(end) > 500;
    this.walkTo(b, end === 'R' ? p.x2 + 100 : p.x1 - 100, spd(b, fast ? 'run' : 'walk'), fast ? 'zoom' : 'walk');
    b.exit = end;
    b.exitKind = 'climb';
    b.climbPlan = { next: pick(['ceil', 'ceil', 'down', 'drop']), frac: rand(0.3, 0.85) };
    b.action = { type: 'walk' };
    return true;
  }

  /** Walk off an open floor end onto the next monitor. */
  planCross(b) {
    const p = b.plat;
    if (!p || p.win) return false;
    const ends = ['L', 'R'].filter((end) => !this.wallAtEnd(p, end, b) &&
      this.platforms.some((q) => q !== p && !q.win && (end === 'R' ? Math.abs(q.x1 - p.x2) <= 2 : Math.abs(q.x2 - p.x1) <= 2)));
    if (!ends.length) return false;
    const end = pick(ends);
    this.walkTo(b, end === 'R' ? p.x2 + 60 : p.x1 - 60, spd(b, 'walk'));
    b.exit = end;
    b.exitKind = 'drop';
    b.action = { type: 'walk' };
    return true;
  }

  planJump(b, now) {
    const cands = [];
    for (const p of this.platforms) {
      if (p === b.plat) continue;
      const dy = p.y - b.y;
      if (dy < -300 || dy > 900 || p.x2 - p.x1 < 70) continue;
      const nearX = clamp(b.x, p.x1 + 30, p.x2 - 30);
      if (Math.abs(nearX - b.x) > 420) continue;
      cands.push({ p, tx: clamp(nearX + rand(-80, 80), p.x1 + 30, p.x2 - 30) });
    }
    if (!cands.length) {
      if (Math.random() < 0.4) { b.action = { type: 'jump', until: now + 160, hop: true }; return true; }
      return false;
    }
    // Prefer going up onto windows; sometimes hop down.
    const up = cands.filter((c) => c.p.y < b.y);
    const target = up.length && Math.random() < 0.75 ? pick(up) : pick(cands);
    b.action = { type: 'jump', until: now + 180, ...target };
    return true;
  }

  launch(b, a) {
    const from = b.plat;
    if (a.hop) {
      b.vx = 0; b.vy = -620;
    } else {
      const dx = a.tx - b.x, dy = a.p.y - b.y;
      const T = clamp(0.42 + Math.abs(dx) / 1400 + (dy < 0 ? 0.12 : 0), 0.42, 0.95);
      b.vx = dx / T;
      b.vy = (dy - 0.5 * G * T * T) / T;
      if (b.vy < -1500) return;
      b.flip = dx < 0;
    }
    b.mode = 'air';
    b.fallKind = 'jump';
    b.ground = null;
    b.ignorePlat = a.hop ? null : from?.key;
    b.ignoreUntil = Date.now() + 120;
    this.sound(b, 'jump');
  }

  // ------------------------------------------------------------ helpers (sub-agents)
  tickMinis(now, dt) {
    // Keep one helper per running sub-agent (up to 5) for buddies that show them.
    for (const b of this.buddies.values()) {
      const on = !b.leaving && !b.hide && !['birth', 'hell', 'doom'].includes(b.mode) && b.look.helpers !== false;
      const want = on ? Math.min(5, b.session.subagents || 0) : 0;
      const mine = this.minis.filter((m) => m.parent === b && !m.leaving);
      for (let i = want; i < mine.length; i++) mine[i].leaving = true;
      const used = new Set(mine.slice(0, want).map((m) => m.slot));
      for (let n = mine.length; n < want; n++) {
        let slot = 0;
        while (used.has(slot)) slot++;
        used.add(slot);
        const m = new Buddy(b.session, this.miniLook(b));
        m.isMini = true; m.parent = b; m.slot = slot; m.speedMul = 2.4; m.alpha = 0; m.spawned = false;
        m.scale = this.scaleAt(m);
        if (b.mode === 'auto' && b.plat) { this.standOn(m, b.plat, b.x); m.queue.push({ anim: 'cheer', dur: 400 }); }
        else { const c = this.centre(b); m.x = c.x; m.y = c.y; m.mode = 'air'; m.fallKind = 'drop'; }
        this.minis.push(m);
      }
    }
    for (const m of [...this.minis]) {
      const p = m.parent;
      if (!this.buddies.has(p.id)) m.leaving = true;
      m.alpha = m.leaving ? m.alpha - dt * 2.5 : Math.min(1, m.alpha + dt * 3);
      if (m.leaving && m.alpha <= 0) { this.minis.splice(this.minis.indexOf(m), 1); continue; }
      m.scale = this.scaleAt(m);
      if (m.mode === 'air') { this.air(m, dt, now); continue; }
      if (m.mode === 'auto') { this.followGround(m); if (m.mode !== 'auto') continue; }
      this.thinkMini(m, now);
      this.move(m, dt, now);
    }
  }

  /** Helpers follow their buddy: walk beside it, leap up to it, climb after it. */
  thinkMini(m, now) {
    const p = m.parent;
    if (m.react && now >= m.react.until) m.react = null;
    if (!m.react && m.queue.length) {
      if (m.mode !== 'auto') return this.letGo(m, 'drop');
      const q = m.queue.shift();
      m.react = { ...q, until: now + q.dur };
    }
    if (m.react) { m.walkTarget = null; m.setAnim(m.react.anim); return; }

    const hwm = halfW(m), side = m.slot % 2 ? -1 : 1;
    const off = side * (halfW(p) + hwm + 3 + Math.floor(m.slot / 2) * (2 * hwm + 3));
    const fast = spd(m, 'run');

    if (m.mode === 'wall') {
      if (p.mode === 'wall' && p.wall === m.wall) {
        const ty = clamp(p.y + (m.slot + 1) * (2 * hwm + 3), m.wall.y1 + hwm, m.wall.y2 - hwm);
        m.cdir = Math.abs(ty - m.y) < 3 ? 0 : Math.sign(ty - m.y);
        m.climbPlan = { next: 'follow' };
      } else if (p.mode === 'ceil') { m.cdir = -1; m.climbPlan = { next: 'ceil' }; }
      else { m.cdir = 1; m.climbPlan = { next: 'down' }; }
      if (m.cdir) m.flip = m.wall.side === 'R' ? m.cdir > 0 : m.cdir < 0;
      m.setAnim(m.cdir ? 'walk' : 'look');
      return;
    }
    if (m.mode === 'ceil') {
      if (p.mode === 'ceil') { const tx = p.x + off; m.cdir = Math.abs(tx - m.x) < 3 ? 0 : Math.sign(tx - m.x); }
      else if (p.mode === 'wall') m.cdir = p.wall.x < m.x ? -1 : 1;
      else return this.letGo(m, 'drop');
      m.ceilStop = null;
      if (m.cdir) m.flip = m.cdir > 0;
      m.setAnim(m.cdir ? 'walk' : 'look');
      return;
    }

    // On a floor or ledge.
    if (p.mode === 'auto' && p.plat && m.plat) {
      if (p.plat.key === m.plat.key) {
        const tx = clamp(p.x + off, m.plat.x1 + hwm, m.plat.x2 - hwm);
        if (Math.abs(tx - m.x) > 3) this.walkTo(m, tx, fast, 'walk');
        if (m.walkTarget === null) m.flip = p.x < m.x;
        m.setAnim(m.walkTarget !== null ? 'walk' : 'idle');
        return;
      }
      if (p.plat.y < m.y - 4) {
        if (!m.leapAt || now - m.leapAt > 1500) { m.leapAt = now; this.leapTo(m, clamp(p.x + off, p.plat.x1 + hwm, p.plat.x2 - hwm), p.plat); }
        return;
      }
      const end = p.x < m.x ? 'L' : 'R';
      this.walkTo(m, end === 'R' ? m.plat.x2 + 30 : m.plat.x1 - 30, fast);
      m.exit = end; m.exitKind = 'drop';
      m.setAnim('walk');
      return;
    }
    if ((p.mode === 'wall' || p.mode === 'ceil') && m.plat && !m.plat.win) {
      const want = p.mode === 'wall' ? p.wall.side : p.x < (m.plat.x1 + m.plat.x2) / 2 ? 'L' : 'R';
      const w = this.wallAtEnd(m.plat, want, m) || this.wallAtEnd(m.plat, want === 'L' ? 'R' : 'L', m);
      if (w) {
        if (m.exit !== w.side) {
          this.walkTo(m, w.side === 'R' ? m.plat.x2 + 40 : m.plat.x1 - 40, fast);
          m.exit = w.side; m.exitKind = 'climb';
          m.climbPlan = { next: p.mode === 'ceil' ? 'ceil' : 'follow', frac: 0 };
        }
        m.setAnim('walk');
        return;
      }
    }
    m.walkTarget = null;
    m.flip = p.x < m.x;
    m.setAnim('look');
  }

  // ------------------------------------------------------------ items (snacks, fetch balls)
  tickItems(now, dt) {
    const { x0, x1 } = this.bounds;
    for (const it of [...this.items]) {
      const fetching = it.kind === 'ball' && !it.fadeAt && it.owner && this.buddies.get(it.owner.id) === it.owner && it.owner.task && it.owner.task.ball === it;
      if (fetching && it.y > this.bounds.y1 + 300) {
        // Fell out of the world: it drops back in from the top of the main screen.
        const d = this.displays.find((x) => x.primary) || this.displays[0];
        Object.assign(it, { x: d.workArea.x + d.workArea.width / 2, y: d.bounds.y + 10, vx: 0, vy: 0, rest: null });
      }
      const dead = (!fetching && now - it.born > 45000) || (it.fadeAt && now - it.fadeAt > 1800) || it.y > this.bounds.y1 + 300;
      if (dead) { this.items.splice(this.items.indexOf(it), 1); continue; }
      const o = it.owner;
      it.s = o ? o.scale : BASE_SCALE;
      if (it.carrier) {
        const c = this.centre(it.carrier);
        it.x = c.x + (it.carrier.flip ? -1 : 1) * halfW(it.carrier) * 0.9;
        it.y = c.y + tall(it.carrier) * 0.15;
        continue;
      }
      if (it.kind === 'snowball') {
        // A snowball: flies at its target, bursts on a hit or when it lands.
        it.vy += G * dt; it.x += it.vx * dt; it.y += it.vy * dt;
        const T = it.target;
        if (T && this.buddies.get(T.id) === T && T.mode === 'auto') {
          const c = this.centre(T);
          if (Math.abs(it.x - c.x) < halfW(T) && Math.abs(it.y - c.y) < tall(T) / 2) {
            this.items.splice(this.items.indexOf(it), 1);
            if (!T.react) T.push('startled', 650, { sound: 'poke' });
            continue;
          }
        }
        const fl = this.platforms.find((p) => it.x >= p.x1 && it.x <= p.x2 && it.y >= p.y && it.y - it.vy * dt <= p.y + 1);
        if (fl || now - it.born > 3000) this.items.splice(this.items.indexOf(it), 1);
        continue;
      }
      if (it.kind === 'cookie' && o) {
        // The snack drops onto its buddy and gets eaten on arrival.
        it.x += (o.x - it.x) * Math.min(1, dt * 6);
        it.vy += G * 0.5 * dt;
        it.y += it.vy * dt;
        if ((o.mode === 'auto' || o.mode === 'float') && it.y >= o.y - tall(o) * 0.85) {
          this.items.splice(this.items.indexOf(it), 1);
          if (o.task && o.task.type === 'snack') o.task = null;
          o.push('snack', 2600, { sound: 'munch' });
          o.push('cheer', 600);
          continue;
        }
        if (it.y > o.y + 40) this.items.splice(this.items.indexOf(it), 1);
        continue;
      }
      if (it.rest) {
        if (!this.platforms.includes(it.rest)) { it.rest = null; }
        else { it.y = it.rest.y - 2.5 * it.s; continue; }
      }
      const prevY = it.y;
      it.vy += G * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      if (it.x < x0 + 6) { it.x = x0 + 6; it.vx = Math.abs(it.vx) * 0.7; }
      if (it.x > x1 - 6) { it.x = x1 - 6; it.vx = -Math.abs(it.vx) * 0.7; }
      if (it.vy > 0) {
        const r = 2.5 * it.s;
        for (const p of this.platforms) {
          if (prevY + r <= p.y + 1 && it.y + r >= p.y && it.x >= p.x1 && it.x <= p.x2) {
            it.y = p.y - r;
            if (it.vy > 260) { it.vy = -it.vy * 0.55; it.vx *= 0.8; this.hooks.sound('land', it.x, it.y); }
            else { it.vy = 0; it.vx = 0; it.rest = p; }
            break;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ the usage limit: banished to hell until it resets
  /** Where the pit opens: the screen with the most buddies (or the Overlord's own). */
  pitSpot() {
    const count = new Map();
    for (const b of this.buddies.values()) {
      if (b.mode === 'hell') continue;
      const c = b.mode === 'wall' || b.mode === 'ceil' ? this.centre(b) : { x: b.x, y: b.y - 2 };
      const d = this.displayAt(c.x, c.y) || this.nearestDisplay(c.x, c.y);
      if (d) count.set(d, (count.get(d) || 0) + 1);
    }
    const d = [...count.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] || this.ovHome().d || this.displays[0];
    const x = d.workArea.x + d.workArea.width / 2;
    const floor = this.platforms.find((p) => !p.win && x >= p.x1 && x <= p.x2 && p.y > d.bounds.y && p.y <= d.bounds.y + d.bounds.height);
    return { x, y: floor ? floor.y : d.workArea.y + d.workArea.height, d: d.id, w: clamp(d.bounds.width * 0.085, 70, 170), top: d.bounds.y + d.bounds.height * 0.4 };
  }

  /** The usage limit was hit: alarm and panic, the Overlord arrives, a pit opens, and in they all go. */
  banish({ kind = 'session', resetsAt = null, quiet = false } = {}) {
    const now = Date.now();
    if (this.doom) { this.doom.kind = kind; this.doom.resetsAt = resetsAt; return; }
    this.fxCancel();
    this.doom = { phase: quiet ? 'sealed' : 'alert', at: now, kind, resetsAt, pit: this.pitSpot(), open: quiet ? 0.12 : 0, cur: null, beam: null, verdicts: {}, slots: [], i: 0 };
    if (quiet) {
      for (const b of this.buddies.values()) this.toHell(b);
      this.ov.red = true;
      return;
    }
    this.hooks.sound('siren', this.doom.pit.x, this.doom.pit.y);
    for (const b of this.buddies.values()) { b.hide = null; b.sleeping = false; b.action = null; b.task = null; }
  }

  /** It reset: the Overlord fetches them back up and reviews each one. interrupted: ids whose work the limit cut off. */
  unbanish(interrupted = new Set()) {
    const D = this.doom;
    if (!D) return false;
    D.interrupted = interrupted;
    if (D.phase !== 'sealed') { D.releasePending = true; return true; }
    D.phase = 'rise-arrive'; D.at = Date.now(); D.verdicts = {}; D.i = 0; D.cur = null;
    const d = this.displays.find((x) => x.id === D.pit.d);
    if (d) D.pit.top = d.bounds.y + d.bounds.height * 0.4;
    this.ov.red = false;
    this.ovSummon(D);
    this.hooks.sound('rise', D.pit.x, D.pit.y);
    return true;
  }

  toHell(b) {
    if (b.script) { const S = b.script; b.script = null; S.onDone?.(); }
    b.stretch = 1; b.birth = null; b.shrink = null; b.grab = null; b.wall = null; b.ceil = null; b.cdir = 0;
    b.queue = []; b.react = null; b.task = null; b.action = null; b.walkTarget = null; b.hide = null; b.bubble = null; b.carry = null;
    b.mode = 'hell'; b.alpha = 0; b.ground = null; b.plat = null;
  }

  panicking() { return !!this.doom && ['alert', 'arrive', 'portal', 'grab'].includes(this.doom.phase); }

  /** Fly to the middle of the pit's screen, big: red-eyed for the banishing, cyan for the review. */
  ovSummon(D) {
    const o = this.ov, s = this.ovScale(), h = this.ovHome();
    if (!o.present) { o.present = true; this.hooks.overlordBorn?.(); o.x = h.x; o.y = h.y - 14 * s; }
    if (o.mode === 'fused') { o.x = h.x; o.y = h.y - 14 * s; }
    o.mode = 'doom'; o.peek = null; o.build = null;
    this.ovTween({ x: D.pit.x, y: D.pit.top }, 1300, null, 1.9);
  }

  doomTick(now) {
    const D = this.doom;
    if (!D) return;
    const t = now - D.at;
    const next = (phase) => { D.phase = phase; D.at = now; D.i = 0; D.cur = null; };
    D.beam = null; D.review = null;
    switch (D.phase) {
      case 'alert':
        if (t > DOOM.alert) { next('arrive'); this.ov.red = true; this.ovSummon(D); this.hooks.sound('doom', D.pit.x, D.pit.y); }
        break;
      case 'arrive':
        D.look = { x: D.pit.x, y: D.pit.y };
        if (t > DOOM.arrive) { next('portal'); this.hooks.sound('portal', D.pit.x, D.pit.y); }
        break;
      case 'portal':
        D.open = clamp(t / DOOM.portal, 0, 1);
        if (t > DOOM.portal) next('grab');
        break;
      case 'grab': {
        D.open = 1;
        if (!D.cur) {
          // The nearest buddy still up here goes next (new arrivals get caught too).
          const left = [...this.buddies.values()].filter((b) => b.mode !== 'hell' && b.mode !== 'doom' && !b.leaving);
          if (!left.length) { next('seal'); this.ovReturn(); this.hooks.sound('portal', D.pit.x, D.pit.y); break; }
          const b = left.sort((a, c) => Math.abs(a.x - D.pit.x) - Math.abs(c.x - D.pit.x))[0];
          this.seize(b);
          D.cur = { id: b.id, at: now, from: { x: b.x, y: b.y, s: b.scale }, screamed: false };
        }
        const b = this.buddies.get(D.cur.id);
        if (!b) { D.cur = null; break; }
        const k = (now - D.cur.at) / DOOM.grab, F = D.cur.from, s = F.s;
        const above = { x: D.pit.x, y: D.pit.y - 150 };
        if (k < 0.3) {
          const e = k / 0.3;
          b.x = F.x + Math.sin(now / 35) * 3; b.y = F.y - 60 * e;
          b.setAnim('held'); b.bubble = '!';
        } else if (k < 0.72) {
          const e = (k - 0.3) / 0.42, ee = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2;
          b.x = F.x + (above.x - F.x) * ee + Math.sin(now / 35) * 2; b.y = F.y - 60 + (above.y - (F.y - 60)) * ee;
          b.setAnim('held'); b.bubble = '!';
        } else {
          const e = (k - 0.72) / 0.28;
          if (!D.cur.screamed) { D.cur.screamed = true; this.sound(b, 'scream'); }
          b.x = above.x; b.y = above.y + (D.pit.y + 24 - above.y) * e * e;
          b.scale = Math.max(1, Math.round(s * (1 - 0.6 * e)));
          b.alpha = e > 0.7 ? Math.max(0, 1 - (e - 0.7) / 0.3) : 1;
          b.setAnim('fall'); b.bubble = null;
        }
        if (k < 0.72) D.beam = { x: b.x, y: b.y - (11.5 * b.scale) / 2 };
        D.look = { x: b.x, y: b.y };
        if (k >= 1) { this.toHell(b); this.hooks.sound('sizzle', D.pit.x, D.pit.y); D.cur = null; }
        break;
      }
      case 'seal':
        D.open = 1 - 0.88 * clamp(t / DOOM.seal, 0, 1);
        if (t > DOOM.seal) {
          next('sealed');
          D.open = 0.12;
          if (D.releasePending) { D.releasePending = false; this.unbanish(D.interrupted || new Set()); }
        }
        break;
      case 'sealed':
        D.open = 0.12;
        for (const b of this.buddies.values()) if (b.mode !== 'hell' && !b.leaving) this.toHell(b); // summoned meanwhile
        break;
      case 'rise-arrive':
        D.look = { x: D.pit.x, y: D.pit.y };
        if (t > RISE.arrive) { next('rise-portal'); this.hooks.sound('portal', D.pit.x, D.pit.y); }
        break;
      case 'rise-portal':
        D.open = 0.12 + 0.88 * clamp(t / RISE.portal, 0, 1);
        if (t > RISE.portal) { next('rise'); D.slots = this.lineUp(D); }
        break;
      case 'rise': {
        D.open = 1;
        const slot = D.slots[D.i];
        if (!slot) { next('review'); break; }
        const b = this.buddies.get(slot.id);
        if (!b) { D.i++; break; }
        if (!D.cur) { D.cur = { at: now }; b.mode = 'doom'; this.sound(b, 'jump'); }
        const k = Math.min(1, (now - D.cur.at) / RISE.rise);
        b.x = D.pit.x + (slot.x - D.pit.x) * k;
        b.y = D.pit.y + (slot.y - D.pit.y) * k - Math.sin(k * Math.PI) * 170;
        b.scale = Math.max(1, Math.round(slot.s * (0.4 + 0.6 * Math.min(1, k * 1.6))));
        b.alpha = Math.min(1, k * 4);
        b.flip = slot.x < D.pit.x;
        b.setAnim(k < 0.88 ? 'fall' : 'land');
        D.look = { x: b.x, y: b.y };
        if (k >= 1) { b.x = slot.x; b.y = slot.y; b.scale = slot.s; b.soot = { until: now + 12000 }; b.setAnim('idle'); this.sound(b, 'land'); D.i++; D.cur = null; }
        break;
      }
      case 'review': {
        const slot = D.slots[D.i];
        if (!slot) { next('close'); this.ovReturn(); break; }
        const b = this.buddies.get(slot.id);
        if (!b) { D.i++; break; }
        if (!D.cur) D.cur = { at: now };
        const k = (now - D.cur.at) / RISE.review;
        D.look = { x: b.x, y: b.y };
        if (k < 0.6) { D.review = { x: b.x, y: b.y - (11.5 * b.scale) / 2, k: k / 0.6 }; b.setAnim('look'); }
        else if (!D.verdicts[b.id]) {
          const v = D.interrupted && D.interrupted.has(b.id) ? 'resume' : 'ok';
          D.verdicts[b.id] = v;
          this.sound(b, v === 'resume' ? 'stamp' : 'chirp');
          b.setAnim(v === 'resume' ? 'cheer' : 'check');
        }
        if (k >= 1) { D.i++; D.cur = null; }
        break;
      }
      case 'close':
        D.open = Math.max(0, 1 - t / RISE.close);
        if (t > RISE.close + 1600) {
          // Back to normal life, still a bit sooty.
          const results = [];
          for (const slot of D.slots) {
            const b = this.buddies.get(slot.id);
            if (!b || b.mode !== 'doom') continue;
            const p = this.platformUnder(b.x, b.y - 4);
            b.mode = 'auto'; b.alpha = 1; b.scale = this.scaleAt(b); b.idleSince = now;
            if (p) this.standOn(b, p, b.x); else this.drop(b, 'drop');
            b.bubble = null;
            results.push({ id: b.id, verdict: D.verdicts[b.id] || 'ok' });
          }
          for (const b of this.buddies.values()) if (b.mode === 'hell' || b.mode === 'doom') { b.alpha = 1; b.x = D.pit.x; b.y = D.pit.y - 40; this.drop(b, 'drop'); }
          this.doom = null;
          this.hooks.released?.(results);
        }
        break;
      default:
        break;
    }
  }

  /** Grab a buddy for the trip down: whatever it was doing ends now. */
  seize(b) {
    if (b.mode === 'wall' || b.mode === 'ceil') { const c = this.centre(b); this.uprightFrom(b); b.x = c.x; b.y = c.y + tall(b) / 2; }
    if (b.script) { const S = b.script; b.script = null; S.onDone?.(); }
    b.stretch = 1; b.birth = null; b.shrink = null; b.grab = null;
    b.queue = []; b.react = null; b.task = null; b.action = null; b.walkTarget = null; b.exit = null; b.hide = null; b.carry = null;
    b.alpha = 1; b.mode = 'doom'; b.ground = null; b.plat = null;
  }

  /** Spots on the floor around the pit where the risen buddies stand for review. */
  lineUp(D) {
    const d = this.displays.find((x) => x.id === D.pit.d) || this.displays[0];
    const ids = [...this.buddies.values()].filter((b) => b.mode === 'hell' && !b.leaving).map((b) => b.id);
    const sizeAt = (id) => this.scaleAt({ x: D.pit.x, y: D.pit.y, mode: 'auto', isMini: false, look: this.buddies.get(id).look });
    const n = ids.length, s = n ? sizeAt(ids[0]) : BASE_SCALE;
    const room = (d.workArea.width / 2 - D.pit.w - 30) / Math.max(1, Math.ceil(n / 2));
    const gap = Math.min(30 * s, Math.max(12, room));
    return ids.map((id, i) => {
      const side = i % 2 ? 1 : -1, rank = Math.floor(i / 2);
      const x = clamp(D.pit.x + side * (D.pit.w + 14 * s + rank * gap), d.workArea.x + 20, d.workArea.x + d.workArea.width - 20);
      return { id, x, y: D.pit.y, s: sizeAt(id) };
    }).sort((a, c) => a.x - c.x);
  }

  /** Urgent enough to show even over a fullscreen app. */
  urgent(b, now) {
    const s = b.session;
    if (b.mode === 'doom' || (this.doom && this.doom.phase !== 'sealed')) return true;
    if (s.attention === 'permission' || s.attention === 'question') return true;
    if (s.attention === 'done' && !b.ackDone && now - s.attentionSince < 20000) return true;
    if (s.ctxAlertAt && now - s.ctxAlertAt < 12000) return true;
    return false;
  }

  doomSnapshot(now) {
    const D = this.doom;
    if (!D) return null;
    return {
      phase: D.phase, t: now - D.at, kind: D.kind, resetsAt: D.resetsAt, open: D.open,
      pit: { x: Math.round(D.pit.x), y: Math.round(D.pit.y), w: Math.round(D.pit.w) },
      beam: D.beam && { x: Math.round(D.beam.x), y: Math.round(D.beam.y) },
      review: D.review && { x: Math.round(D.review.x), y: Math.round(D.review.y), k: D.review.k },
      verdicts: D.verdicts,
      banished: [...this.buddies.values()].filter((b) => b.mode === 'hell').length,
    };
  }

  // ------------------------------------------------------------ output
  snapshot(now) {
    const out = [];
    const short = (l, carry) => ({ hat: l.hat, hand: l.hand, face: l.face, neck: l.neck, back: l.back, body: l.body, eye: l.eye, carry: carry || undefined });
    const W = this.fx.weather, wet = (W.kind === 'rain' || W.kind === 'storm') && this.weatherLevel(now) > 0.3; // umbrellas out
    const tagOf = (b) => {
      const t = this.fx.tags.find((x) => x.id === b.id);
      if (!t) return null;
      const c = b.session.card(), st = this.hooks.stats?.(b.id) || {};
      return { k: (now - t.at) / (t.until - t.at), name: b.session.displayName, status: c.status, ctx: c.context ? c.context.pct : null, mins: Math.round((st.workMs || 0) / 60e3), tools: st.tools || 0, edits: st.edits || 0 };
    };
    for (const b of this.buddies.values()) {
      if (b.mode === 'hell' || b.mode === 'ride') continue;
      try {
      const c = ['birth', 'script', 'doom'].includes(b.mode) ? { x: b.x, y: b.y } : this.centre(b);
      const d = this.displayAt(c.x, c.y);
      // Over a fullscreen app only when it matters: a prompt, a question, a finished turn, 90% context, the limit.
      const alpha = d && this.hiddenDisplays.has(d.id) && !this.urgent(b, now) ? 0 : b.alpha;
      const s = b.session;
      out.push({
        id: b.id,
        x: Math.round(b.x),
        y: Math.round(b.y),
        o: b.mode === 'wall' ? (b.wall.side === 'L' ? 'wallL' : 'wallR') : b.mode === 'ceil' ? 'ceil' : 'floor',
        s: b.scale,
        flip: b.flip && Clawd.canFlip(b.anim),
        anim: b.anim,
        t: now - b.animAt,
        fo: b.anim === 'typing' ? b.taps : undefined, // typing frames advance per key, not per tick
        look: wet && !b.look.hand && (b.mode === 'auto' || b.mode === 'float') ? { ...short(b.look, b.carry), hand: 'umbrella' } : short(b.look, b.carry),
        stream: s.state === 'working' && this.ov.present ? Math.max(0.35, 1 - (now - (this.fx.pulses.get(b.id) || 0)) / 4000) : 0,
        inspect: tagOf(b),
        stretch: b.stretch !== 1 ? b.stretch : undefined,
        pinned: b.pinned,
        held: b.mode === 'held',
        marker: b.task && b.task.type === 'come' ? { x: Math.round(b.task.x), y: Math.round(b.task.y) } : null,
        queued: (b.session.attachments || []).length,
        name: s.displayName,
        alpha,
        bubble: b.bubble,
        say: b.react && b.react.say && b.mode === 'auto' ? b.react.say : null,
        sleeping: b.sleeping || undefined,
        hovered: b.hovered,
        birth: b.birth ? { t: now - b.birth.at, x: Math.round(b.birth.cx), y: Math.round(b.birth.cy), big: b.birth.big } : null,
        interactive: !['birth', 'script', 'doom', 'enter', 'carried'].includes(b.mode) && !b.hide && alpha > 0,
        soot: b.soot ? Math.max(0, Math.min(1, (b.soot.until - now) / 9000)) : 0,
        perm: s.attention === 'permission' && s.pendingPermission ? { ...s.pendingPermission, held: !!s.permHeld } : null,
        minis: this.minis.filter((m) => m.parent === b).map((m) => ({
          x: Math.round(m.x), y: Math.round(m.y), s: m.scale, flip: m.flip && Clawd.canFlip(m.anim), anim: m.anim, t: now - m.animAt,
          o: m.mode === 'wall' ? (m.wall.side === 'L' ? 'wallL' : 'wallR') : m.mode === 'ceil' ? 'ceil' : 'floor',
          look: m.look, alpha: m.alpha * alpha,
        })),
        card: b.hovered ? s.card() : null,
      });
      } catch (err) { this.hooks.error?.(err, 'snapshot'); }
    }
    const items = this.items.map((it) => ({ kind: it.kind, x: Math.round(it.x), y: Math.round(it.y), s: it.s || BASE_SCALE, a: it.fadeAt ? Math.max(0, 1 - (now - it.fadeAt) / 1800) : 1 }));
    const P = this.puke;
    const puke = P.drops.length || P.puddles.length ? {
      drops: P.drops.map((d) => ({ x: Math.round(d.x), y: Math.round(d.y), s: d.s, c: d.c })),
      puddles: P.puddles.map((q) => ({ x: Math.round(q.x), y: q.y, w: Math.round(q.w), s: q.s, v: q.v, sink: q.sink || 0, seed: q.seed })),
    } : null;
    let tower = null;
    try { tower = this.towerSnapshot(now); } catch (err) { this.hooks.error?.(err, 'tower snapshot'); }
    let fx = null;
    try { fx = this.fxSnapshot(now); } catch (err) { this.hooks.error?.(err, 'fx snapshot'); }
    return { buddies: out, items, overlord: this.ovSnapshot(now), covers: this.covers.filter((c) => c.p > 0), doom: this.doomSnapshot(now), tower, puke, fx };
  }
}

Object.assign(World.prototype, require('./spectacle')({ G, clamp, rand, pick, halfW, tall, spd }));

module.exports = { World, fullLook, LOOK_DEFAULTS };
