// Drive sessions + world without Electron: two fake monitors, one floating
// window, two demo sessions on a simulated clock. Prints each buddy's timeline.
'use strict';
const fs = require('fs');
const path = require('path');
const Clawd = require('../app/sprites');
const { Sessions } = require('../app/sessions');
const { World } = require('../app/world');

Clawd.loadPoses(JSON.parse(fs.readFileSync(path.join(__dirname, '../app/assets/poses.json'), 'utf8')));

// Simulated clock so the 70 s demo runs instantly.
let now = 1_700_000_000_000;
Date.now = () => now;
const timers = [];
global.setTimeout = (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; };
global.clearTimeout = () => {};

const sounds = [];
const world = new World({ sound: (n) => sounds.push(n), focus: () => {}, removed: (id) => console.log(`  [removed ${id}]`) });
world.setDisplays([
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } },
  { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1032 } },
]);
world.setWindows([{ id: 'w1', title: 'notes', maximized: false, rect: { x: 400, y: 600, width: 700, height: 400 } }]);
console.log('platforms:', world.platforms.map((p) => `${p.key} y=${p.y} [${p.x1}..${p.x2}]`).join(' | '));

const sessions = new Sessions();
const summoned = new Set();
sessions.on('summon', (s) => { if (!world.has(s.id)) world.add(s, { look: { hat: 'wizard' }, x: 700, birth: false }); summoned.add(s.id); });
sessions.on('dismiss', (s) => world.remove(s.id));
sessions.on('end', (s) => world.remove(s.id));
sessions.on('done', (s) => world.onDone(s.id));
sessions.on('error', (s, n) => world.onError(s.id, n));
sessions.on('attention', (s, k) => world.onAttention(s.id, k));

const { runDemo } = require('../app/demo');
const id1 = runDemo((ev) => sessions.handle(ev));
now += 1500;
const id2 = runDemo((ev) => sessions.handle(ev));

const log = new Map();
const end = now + 260_000;
let cursor = { x: 50, y: 50, speed: 0 };
while (now < end) {
  now += 16;
  for (const t of timers.filter((t) => t.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
  world.tick(now, 0.016, cursor, null);
  for (const b of world.buddies.values()) {
    const key = `${b.anim}${b.bubble ? ' ' + b.bubble : ''}${world.minis.filter((m) => m.parent === b).length ? ` +${world.minis.filter((m) => m.parent === b).length} helpers` : ''}`;
    const list = log.get(b.id) || [];
    if (!list.length || list[list.length - 1].key !== key) list.push({ t: now, key, x: Math.round(b.x), y: Math.round(b.y), mode: b.mode, card: b.session.card() });
    log.set(b.id, list);
  }
  if (now === end - 200_000) { console.log('-- card mid-run:', JSON.stringify(world.get(id1)?.session.card())); }
}
const t0 = end - 260_000;
for (const [id, list] of log) {
  console.log(`\n${id}  (${list.length} animation changes)`);
  for (const e of list.slice(0, 70)) console.log(`  ${((e.t - t0) / 1000).toFixed(1).padStart(6)}s  ${e.mode.padEnd(4)} (${e.x},${e.y})  ${e.key.padEnd(24)} ${e.card.status}${e.card.phase ? ' | ' + e.card.phase : ''}`);
}
console.log('\nsounds:', [...new Set(sounds)].join(', '));
const last = world.get(id1);
console.log('final:', last && { anim: last.anim, sleeping: last.sleeping, y: last.y });
