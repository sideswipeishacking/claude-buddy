// Headless checks for climbing, crossing monitors, throws, naps, typing and
// per-display sizes. Laptop panel (internal) with a taller monitor to its right.
'use strict';
const fs = require('fs');
const path = require('path');
const Clawd = require('../app/sprites');
const { World } = require('../app/world');

Clawd.loadPoses(JSON.parse(fs.readFileSync(path.join(__dirname, '../app/assets/poses.json'), 'utf8')));
let now = 1_700_000_000_000;
Date.now = () => now;

const world = new World({ sound: () => {}, focus: () => {}, removed: () => {} });
world.setDisplays([
  { id: 1, internal: true, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 832 } },
  { id: 2, internal: false, bounds: { x: 1536, y: 0, width: 1920, height: 1080 }, workArea: { x: 1536, y: 0, width: 1920, height: 1040 } },
]);
world.setWindows([]);
console.log('floors  ', world.platforms.map((p) => `[${p.x1}..${p.x2}]@${p.y}`).join(' '));
console.log('walls   ', world.walls.map((w) => `${w.side}@x=${w.x} y ${w.y1}..${w.y2}`).join(' | '));
console.log('ceilings', world.ceilings.map((c) => `[${c.x1}..${c.x2}]@${c.y}`).join(' '));

const session = (id) => ({ id, displayName: id, name: id, state: 'idle', kind: 'idle', attention: null, subagents: 0, lastEventAt: now, card: () => ({}) });
let failures = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };

function run(b, ms, watch) {
  const seen = [];
  let last = '';
  for (let t = 0; t < ms; t += 16) {
    now += 16;
    world.tick(now, 0.016, { x: -999, y: -999, speed: 0 }, null);
    const key = `${b.mode}${b.mode === 'wall' ? b.wall.side : ''}`;
    if (key !== last) { seen.push(`${key}(${Math.round(b.x)},${Math.round(b.y)} s${b.scale})`); last = key; }
    if (watch && watch(b)) break;
  }
  return seen;
}

function onFloor(id, x, y) {
  const b = world.add(session(id), { look: { hat: 'crown' }, x, birth: false });
  b.spawned = false;
  b.fallKind = 'nap';
  b.greetAt = Infinity; // no wandering off to chat with the others mid-check
  run(b, 3000, (q) => q.mode === 'auto');
  b.queue = []; b.react = null; b.y = y;
  return b;
}

// 1. Full lap on the laptop: floor -> left wall -> ceiling -> ... -> floor.
const a = onFloor('lap', 300, 832);
check('laptop buddy uses laptop size 2', a.scale === 2);
world.walkTo(a, -100, 200); a.exit = 'L'; a.exitKind = 'climb'; a.climbPlan = { next: 'ceil', frac: 0.5 }; a.action = { type: 'walk' };
let path1 = run(a, 120000, (q) => q.mode === 'ceil');
check('walks to the left edge, climbs the wall, reaches the ceiling', path1.join(' ').includes('wallL') && a.mode === 'ceil');
a.clingUntil = 0; a.cdir = -1; a.ceilStop = null; // crawl left back to the same wall and climb down
path1 = path1.concat(run(a, 120000, (q) => q.mode === 'auto'));
console.log('      lap:', path1.join(' -> '));
check('climbs back down to the floor (or drops) and stands again', a.mode === 'auto');

// 2. Walk off the laptop's right edge onto the lower external floor.
const c = onFloor('cross', 1450, 832);
c.queue = [];
c.exit = 'R'; c.exitKind = 'drop'; c.walkTarget = 1600; c.walkSpeed = 80; c.action = { type: 'walk' };
console.log('      cross:', run(c, 20000, (q) => q.mode === 'auto' && q.x > 1536).join(' -> '));
check('crossed onto the external monitor floor', c.mode === 'auto' && c.y === 1040 && c.x > 1536);
check('external buddy uses size 4', c.scale === 4);

// 3. Climb the step back up from the external floor onto the laptop floor.
c.queue = []; c.react = null;
c.exit = 'L'; c.exitKind = 'climb'; c.climbPlan = { next: 'ceil', frac: 0.5 }; c.walkTarget = 1400; c.walkSpeed = 120; c.action = { type: 'walk' };
console.log('      step:', run(c, 60000, (q) => q.mode === 'auto' && q.x < 1536).join(' -> '));
check('climbed the step wall back onto the laptop floor', c.mode === 'auto' && c.x < 1536 && c.y === 832);

// 4. Throw into the external monitor's right edge: it clings.
const t = onFloor('throw', 3200, 1040);
t.queue = [];
world.drop(t, 'throw'); t.y = 700; t.vx = 1800; t.vy = -200;
console.log('      throw:', run(t, 3000, (q) => q.mode === 'wall').join(' -> '));
check('thrown buddy clings to the right screen edge', t.mode === 'wall' && t.wall.side === 'R');

// 5. Typing while on the wall: types right there.
world.onKey(t.id, 'type');
run(t, 50);
check('types along while clinging to the wall', t.anim === 'typing' && t.mode === 'wall');

// 6. Nap time on the wall: lets go, lands softly (no pancake), sleeps on the floor.
t.typingUntil = 0;
t.idleSince = now - 4 * 60e3;
const napPath = run(t, 8000, (q) => q.sleeping);
console.log('      nap:', napPath.join(' -> '));
check('sleepy buddy dropped to the floor and fell asleep', t.sleeping && t.mode === 'auto' && t.y === 1040);
check('no pancake on a nap landing', !napPath.join(' ').includes('pancake') && t.anim !== 'pancake');

// 7. Hard drop from the ceiling (not napping): pancake.
const p = onFloor('pancake', 2400, 1040);
p.queue = [];
world.enterCeil(p, world.ceilings.find((q) => p.x >= q.x1 && p.x <= q.x2), 0);
world.letGo(p, 'drop');
let sawPancake = false;
run(p, 4000, (q) => { if (q.anim === 'pancake') sawPancake = true; return false; });
check('hard landing from the ceiling squashes it into a pancake', sawPancake);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
