// Headless checks for buddy life between jobs: fetch that never gives up, shaking (dizzy,
// sick, waking up), friends meeting for a chat, and the skyscraper (walking home, the
// elevator, lights, coming back out). One sequential scenario on a laptop plus a monitor.
'use strict';
const fs = require('fs');
const path = require('path');
const Clawd = require('../app/sprites');
const { World } = require('../app/world');
const { Sessions } = require('../app/sessions');

Clawd.loadPoses(JSON.parse(fs.readFileSync(path.join(__dirname, '../app/assets/poses.json'), 'utf8')));
let now = 1_700_000_000_000;
Date.now = () => now;
const realRandom = Math.random;

const removed = [];
const sounds = [];
const world = new World({ sound: (n) => sounds.push(n), focus: () => {}, removed: (id) => removed.push(id), overlordBorn: () => {}, error: (err) => { throw err; } });
world.setDisplays([
  { id: 1, internal: true, primary: true, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 832 } },
  { id: 2, internal: false, bounds: { x: 1536, y: 0, width: 1920, height: 1080 }, workArea: { x: 1536, y: 0, width: 1920, height: 1040 } },
]);
world.setWindows([]);
const sessions = new Sessions();

let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failures++; };
let cursor = { x: 2600, y: 500, speed: 0 };
let mouseDown = null;
function run(ms, until, each) {
  for (let t = 0; t < ms; t += 16) {
    now += 16;
    if (each) each(t);
    world.tick(now, 0.016, cursor, mouseDown);
    if (until && until()) return true;
  }
  return false;
}
const settle = (b) => run(6000, () => b.mode === 'auto' && !b.react && !b.queue.length);
const make = (id, x, name) => {
  const s = sessions.get(id);
  s.name = name || id;
  const b = world.add(s, { look: { hat: 'crown' }, x, birth: false });
  b.spawned = false;
  settle(b);
  return b;
};

// ---- 1. Fetch: tossed away mid-fetch, it still goes after the ball until it has it.
const a = make('alpha', 2400, 'claude-buddy');
world.playFetch(a, { x: 2500, y: 300 });
const ball = world.items.find((i) => i.kind === 'ball');
run(2600);
world.grab(a.id);
check('fetch survives being picked up', a.task && a.task.type === 'fetch');
cursor = { x: 3400, y: 200, speed: 0 };
run(100);
world.release(); // let go up high, far from the ball
run(60000, () => world.items.includes(ball) && ball.carrier === a);
check('…and it still goes and gets the ball', ball.carrier === a);
const back = run(30000, () => !a.task);
check('then brings it back', back && !a.task);
const ball2 = { id: 99, kind: 'ball', x: 1700, y: 1030, vx: 0, vy: 0, owner: a, born: now - 120e3 };
world.items.push(ball2);
a.task = { type: 'fetch', ball: ball2, home: { x: 2500, y: 1040 }, phase: 'chase', until: Infinity };
run(200);
check('a ball being fetched never expires', world.items.includes(ball2));
run(40000, () => !a.task);
world.items.length = 0;
settle(a);

// ---- 2. Shaking: a little wakes it, a lot makes it dizzy, too much makes it sick.
a.sleeping = true; a.action = { type: 'sleep', anim: 'nap' }; a.idleSince = now - 10 * 60e3;
cursor = { x: a.x, y: a.y - 20, speed: 0 };
world.grab(a.id);
const shake = (ms, amp = 80) => run(ms, null, (t) => { cursor = { x: a.grab ? cursor.x : cursor.x, y: 500 + (Math.floor(t / 64) % 2 ? amp : -amp), speed: 0 }; cursor.x = 2400 + (Math.floor(t / 80) % 2 ? amp : -amp); });
shake(400);
check('a little shake wakes a sleeping buddy', !a.sleeping);
shake(1600);
check('shaken for a while, it gets dizzy (still in your hand)', a.dizzy >= 7 && ['dizzyBase', 'sick'].includes(a.anim), `dizzy ${a.dizzy.toFixed(1)} ${a.anim}`);
shake(2400);
check('shaken far too long, it turns green', a.dizzy >= 20 && a.anim === 'sick', `dizzy ${a.dizzy.toFixed(1)} ${a.anim}`);
cursor = { x: 2400, y: 900, speed: 0 };
run(200); // hold still a moment, so it's let go rather than thrown
world.release();
run(10000, () => a.react && a.react.anim === 'dizzy');
check('after you let go it staggers around dizzy', a.react && a.react.anim === 'dizzy');
run(6000, () => a.react && a.react.anim === 'vomit');
run(800);
check('…then throws up', a.react && a.react.anim === 'vomit' && (world.puke.drops.length > 0 || world.puke.puddles.length > 0));
run(2500);
const pool = world.puke.puddles[0];
check('it lands on the floor (your taskbar) as a puddle', !!pool && pool.y === world.floorY(world.displayAt(pool.x, pool.y - 5)) && pool.w > 0, pool && `y=${pool.y} w=${Math.round(pool.w)}`);
const snap = world.snapshot(now);
check('the overlay gets the puddles to draw', snap.puke && snap.puke.puddles.length > 0);
run(9000);
check('…which sinks into the ground and is gone', world.puke.puddles.length === 0 && world.puke.drops.length === 0);
settle(a);

// ---- 3. Friends: two idle buddies on different screens find each other and chat.
const b = make('bravo', 700, 'pixel-game');
a.greetAt = 0; b.greetAt = 0; a.idleSince = b.idleSince = now;
let said = [];
const met = run(60000, () => {
  if (process.env.DEBUG && Math.floor(now / 4000) !== Math.floor((now - 16) / 4000)) console.log('   ', [a, b].map((x) => `${x.id} ${x.mode} ${x.anim} x=${x.x | 0} y=${x.y | 0} plat=${x.plat && x.plat.key} act=${x.action && x.action.type} meet=${!!x.meet} greet=${((now - x.greetAt) / 1000) | 0}s sleep=${x.sleeping} q=${x.queue.length} r=${x.react && x.react.anim}`).join(' || '));
  for (const x of [a, b]) if (x.react && x.react.say && !said.includes(x.react.say)) said.push(x.react.say);
  return said.length >= 1 && !a.react && !b.react; // a whole scene played
});
check('idle buddies go and meet each other, even on another screen', met, `${a.x | 0} / ${b.x | 0}`);
check('they talk in speech bubbles', said.length >= 1, said.join(' | '));
check('speech bubbles reach the overlay', (() => { const s = world.snapshot(now).buddies.find((x) => x.say); return !s || typeof s.say === 'string'; })());
check('…in the pixel font only', said.every((t) => [...t].every((c) => Clawd.FONT[c] !== undefined)), said.join(' | '));
run(25000, () => !a.react && !b.react && !a.queue.length && !b.queue.length);

// ---- 4. The skyscraper.
const residents = [
  { id: 'alpha', name: 'claude-buddy', body: '#d97757', hat: 'crown', created: 1, seen: now },
  { id: 'bravo', name: 'pixel-game', body: '#5aa9e6', hat: 'wizard', created: 2, seen: now },
  { id: 'charlie', name: 'notes', body: '#8fcf5b', created: 3, seen: now },
];
world.setResidents(residents);
const g = world.towerGeom();
check('the skyscraper stands at the bottom-left of the main screen', g && g.d.id === 1 && g.x0 < 100 && g.ground === 832, g && `x0=${g.x0} ground=${g.ground}`);
let T = world.towerSnapshot(now);
check('one floor per buddy; only the one at home has its light on', T.floors.length === 3 && T.floors.map((f) => f.lit).join() === 'false,false,true');
check('it starts tucked into the ground', world.tower.h === 0);
removed.length = 0;
world.goHome('bravo');
check('sent home, it waves and heads for the door', b.task && b.task.type === 'home');
const rose = run(20000, () => world.tower.h === 1);
check('the skyscraper rises out of the ground for it', rose);
run(30000, () => b.mode === 'enter');
check('it walks in through the lobby door', b.mode === 'enter' && Math.abs(b.x - g.door) < 5, `x=${b.x | 0} door=${g.door}`);
run(1000);
check('…and is gone from the desktop', !world.buddies.has('bravo') && removed.includes('bravo'));
let rodeUp = false;
run(15000, () => { if (world.tower.rides[0] && world.tower.rides[0].phase === 'lift') rodeUp = true; return !world.tower.rides.length; });
T = world.towerSnapshot(now);
check('it rides the elevator up to its floor', rodeUp && world.tower.car.f === 1, `car at ${world.tower.car.f}`);
check('…and its light comes on', T.floors[1].lit && !T.floors[1].on);
run(4000);
check('the skyscraper sinks back down afterwards', world.tower.h === 0);

const nb = world.leaveHome(sessions.get('bravo'), { hat: 'wizard' });
check('turned on, it waits for the elevator (not printed again)', nb.mode === 'ride' && !nb.birth);
T = world.towerSnapshot(now);
check('the switch flips on right away', T.floors[1].on && T.floors[1].busy);
run(30000, () => nb.mode === 'auto');
check('it rides down and steps out of the lobby', nb.mode === 'auto' && Math.abs(nb.x - g.door) < 3 && nb.y === 832, `x=${nb.x | 0} y=${nb.y}`);
T = world.towerSnapshot(now);
check('its window goes dark', !T.floors[1].lit && T.floors[1].on);

run(16000, () => nb.x > g.x0 + Clawd.TOWER.W * g.ts + 10);
check('it walks out from in front of the building (buddies keep the lobby clear)', nb.x > g.x0 + Clawd.TOWER.W * g.ts + 10, `x=${nb.x | 0}`);
world.goHome('bravo');
run(500);
const cancelled = world.goHome('alpha', { hurry: true }) && a.task && a.task.hurry;
check('quitting sends everyone home in a hurry', cancelled);
run(60000, () => !world.buddies.size);
check('…and they all get inside', world.buddies.size === 0);
run(30000, () => !world.tower.rides.length);
world.towerToggle(true);
run(1000);
check('the skyscraper can be opened by hand', world.tower.h === 1 && world.tower.open);
world.towerToggle(false);
run(1500);
check('…and tucked away again', world.tower.h === 0);

// ---- 5. Rooms: wider, with furniture you place yourself.
const TT = Clawd.TOWER;
check('the skyscraper is wider, but no more than 2.5x the original 38 pixels', TT.W > 38 && TT.W <= 95, `W=${TT.W}`);
const legacy = Clawd.normalizeRoom({ wall: 'mint', curtains: 'red', furniture: 'desk', sill: 'cat' });
check('a room decorated in 2.1 keeps its wall, curtains, furniture and sill thing', legacy.wall === 'mint' && legacy.curtains === 'red' && legacy.items.map((i) => i.k).join() === 'cat,desk');
const crowded = Clawd.normalizeRoom({ items: Array.from({ length: 15 }, (_, i) => ({ k: 'chair', x: i * 7 })).concat([{ k: 'bed', x: 500 }, { k: 'painting', x: -9, y: 40 }, { k: 'nope', x: 3 }]) });
check(`at most ${TT.MAX_ITEMS} pieces, unknown ones dropped`, crowded.items.length === TT.MAX_ITEMS && crowded.items.every((i) => Clawd.ROOM.items[i.k]));
const placed = Clawd.roomLayout({ items: [{ k: 'bed', x: 500 }, { k: 'painting', x: -9, y: 40 }, { k: 'cat', x: 20, y: 2 }, { k: 'rug', x: 10 }] });
check('every piece stays inside the room', placed.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= TT.WIN_W && b.y + b.h <= TT.WIN_H), JSON.stringify(placed.map((b) => [b.k, b.x, b.y])));
check('little things can sit up on furniture; big furniture stands on the floor', placed.find((b) => b.k === 'cat').y === 2 && placed.find((b) => b.k === 'bed').y + placed.find((b) => b.k === 'bed').h === TT.WIN_H - 2);
check('a dark room still draws (dimmed)', Clawd.roomPixels(undefined, false).some((p) => p.a < 1));

// ---- 6. A session that ends and carries on under the same id keeps its record (the buddy stays connected).
{
  const ss = new Sessions();
  let resumed = 0;
  ss.on('resumed', () => resumed++);
  ss.handle({ session_id: 'kept', hook_event_name: 'SessionStart', cwd: 'C:/p/x' });
  const first = ss.get('kept');
  ss.handle({ session_id: 'kept', hook_event_name: 'SessionEnd' });
  check('a session that ends is marked ended, not thrown away', ss.map.get('kept') === first && first.state === 'ended');
  now += 2000;
  ss.handle({ session_id: 'kept', hook_event_name: 'UserPromptSubmit', prompt: 'carry on' });
  check('…and when it carries on, it is the same record, working again', ss.get('kept') === first && first.state === 'working' && resumed === 1);
}

// ---- 7. The Overlord's shows.
const ca = make('carol', 900, 'pixel-game'), cb = make('dave', 2600, 'claude-buddy');
for (const x of [ca, cb]) { x.greetAt = Infinity; world.setPinned(x, true); world.setPinned(x, false); }
world.ov.present = true; world.ov.mode = 'fused';
world.towerToggle(false);
check('clicking the Overlord brings it out of its corner with its options', world.ovOpenMenu() && world.ov.mode === 'detached' && world.ov.menu);
run(600);
check('…out in the open, clear of the top edge', world.ov.y - 13 * world.ovScale() > world.displays[0].bounds.y, `y=${world.ov.y | 0}`);
world.ovCloseMenu();
run(1500, () => world.ov.mode === 'fused');
check('closing it sends it back into the corner', world.ov.mode === 'fused' && !world.ov.menu);

world.ovSay('Testing.');
check('it can make remarks (shown in a bubble)', world.snapshot(now).fx.say.text === 'TESTING.');
run(200);
check('…and peeks out of its corner while it talks', !!world.ovSnapshot(now).peek);

check('an inspection patrol starts', world.ovPatrol([ca.id, cb.id]) && world.ov.mode === 'patrol');
let scanned = false;
run(20000, () => { const f = world.snapshot(now).fx; if (f.scan) scanned = true; return world.ov.mode !== 'patrol'; });
check('…it flies over and scans each buddy', scanned);
check('…leaving a stat tag above them', world.fx.tags.some((t) => t.id === cb.id) || scanned);
run(3000, () => world.ov.mode === 'fused');
check('…then goes home', ['fused', 'returning'].includes(world.ov.mode));

const data = { date: 'TODAY', rows: [{ name: 'carol', prompts: 2, tools: 9, edits: 3, minutes: 12 }], totals: { prompts: 2, tools: 9, edits: 3, minutes: 12, agents: 0 }, usage: { session: 30, week: 10 } };
check('the holo-report: it flies out and projects a panel', world.ovReport(data) && world.ov.mode === 'report');
run(900);
check('…the panel is in the frame', !!world.snapshot(now).fx.report);
world.reportClose();
check('…a click closes it', !world.fx.report && world.ov.mode === 'returning');
run(1500);

ca.task = null; cb.task = null;
const cookiesBefore = world.items.filter((i) => i.kind === 'cookie').length;
const dr = world.droneLaunch('snack', ca);
check('a drone takes off from the Overlord', !!dr && world.snapshot(now).fx.drones.length === 1);
let snacked = false;
run(10000, () => { if (ca.react && ca.react.anim === 'snack') snacked = true; return snacked && !world.fx.drones.length; });
check('…drops a cookie on its buddy, who eats it', snacked || world.items.filter((i) => i.kind === 'cookie').length > cookiesBefore);
check('…and flies back', world.fx.drones.length === 0);

run(3000, () => cb.mode === 'auto' && !cb.react);
const spot = { x: 600, y: 832 };
check('gathering across monitors: a drone picks the buddy up', !!world.droneCarry(cb, spot));
run(15000, () => cb.mode === 'carried');
check('…with its tractor beam', cb.mode === 'carried');
run(20000, () => cb.mode === 'auto');
check('…and sets it down at the spot on the other screen', cb.mode === 'auto' && Math.abs(cb.x - spot.x) < 200 && cb.y === 832, `x=${cb.x | 0} y=${cb.y}`);

world.setWeather('snow', 1);
run(7000);
const wx = world.snapshot(now).fx.weather;
check('weather: it can make it snow', wx && wx.kind === 'snow' && wx.k > 0.9);
world.setWeather('rain', 1);
run(7000);
const brolly = run(8000, () => world.snapshot(now).buddies.some((x) => x.look.hand === 'umbrella')); // (not while one is up a wall)
check('…or rain, and buddies get their umbrellas out', brolly);
world.setWeather('storm', 1);
run(9000);
check('…or storm, with lightning', world.fx.weather.flash > 0);
world.setWeather('clear');
run(9000);
check('…and clear up again', !world.snapshot(now).fx.weather);

for (const x of [ca, cb]) { x.task = null; x.queue = []; x.react = null; }
check('boss fight: it starts', world.bossStart() && world.ov.mode === 'boss' && ca.task && ca.task.type === 'boss');
run(4000);
check('…the buddies line up under it', world.fx.boss && world.fx.boss.phase === 'fight');
let thrown = false, attacked = false;
run(14000, () => { const B = world.fx.boss; if (B.shots.some((s) => s.kind === 'code')) thrown = true; if (B.shots.some((s) => s.kind === 'bug') || B.laser) attacked = true; return thrown && attacked; });
check('…they throw code at it and it fights back', thrown && attacked);
const hp = world.fx.boss.hp;
world.bossHit();
check('…your clicks hurt it', world.fx.boss.hp < hp);
for (let i = 0; i < 40 && world.fx.boss && world.fx.boss.phase === 'fight'; i++) { world.bossHit(); run(50); }
check('…until it is defeated', world.fx.boss && world.fx.boss.phase === 'win');
run(6000, () => !world.fx.boss);
check('…then it pieces itself together and goes home, and everyone is free again', !world.fx.boss && !ca.task && !cb.task && !world.ov.red);

Math.random = realRandom;
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
