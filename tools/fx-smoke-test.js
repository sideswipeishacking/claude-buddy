// Smoke test for the Overlord's overlay effects (app/overlay-fx.js): runs every draw function
// against a fake canvas with frames from a real World, so typos and bad data paths show up
// without starting Electron. It checks that nothing throws, not what it looks like.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Clawd = require('../app/sprites');
const { World } = require('../app/world');
const { Sessions } = require('../app/sessions');

Clawd.loadPoses(JSON.parse(fs.readFileSync(path.join(__dirname, '../app/assets/poses.json'), 'utf8')));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failures++; };

// A world with two buddies and every show going at once.
let now = 1_700_000_000_000;
Date.now = () => now;
const world = new World({ sound: () => {}, focus: () => {}, removed: () => {}, overlordBorn: () => {}, error: (e) => { throw e; }, stats: () => ({ tools: 4, edits: 1, workMs: 600e3 }) });
world.setDisplays([{ id: 1, internal: true, primary: true, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 832 } }]);
world.setWindows([{ id: 'w', title: 't', maximized: false, rect: { x: 300, y: 400, width: 600, height: 300 } }]);
const sessions = new Sessions();
const a = world.add(sessions.get('a'), { look: { hat: 'crown' }, x: 400, birth: false });
const b = world.add(sessions.get('b'), { look: { hat: 'wizard' }, x: 1100, birth: false });
a.session.state = 'working'; world.pulse('a');
const step = (ms) => { for (let t = 0; t < ms; t += 16) { now += 16; world.tick(now, 0.016, { x: 700, y: 400, speed: 0 }, null); } };
step(3000);
world.ov.present = true; world.ov.mode = 'fused';

const ctxCalls = new Set();
const ctx = new Proxy({}, {
  get(target, k) {
    if (k in target) return target[k];
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
    return (...args) => { ctxCalls.add(k); for (const v of args) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`ctx.${String(k)} got ${v}`); };
  },
  set(target, k, v) { target[k] = v; return true; },
});
const sandbox = {
  Clawd, ctx, console, Math, JSON, Date, String, Number, Array, Object, Set, Map, performance: { now: () => now },
  dpr: 1.25, origin: { x: 0, y: 0 }, innerWidth: 1536, innerHeight: 864, canvas: { width: 1920, height: 1080 },
  fx: null, hoverId: null,
  clamp: (v, x, y) => Math.max(x, Math.min(y, v)),
  hash: (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); },
  dip() {}, dev() {}, brackets() {},
  memo: (k, make) => make(),
  raster: (pixels, s) => ({ w: 10 * s, h: 10 * s, ox: 0, oy: 0, oxd: 0, oyd: 0, u: s, cv: {} }),
  blit(sp, x, y) { if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`blit at ${x},${y}`); },
  textSprite: (str, s) => ({ w: str.length * 4 * s, h: 5 * s, ox: 0, oy: 0 }),
  pixelText(str, x, y) { if (typeof str !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`pixelText ${str} at ${x},${y}`); },
  itemSprite: (k, s) => { if (!Clawd.ITEMS && !Clawd.item(k)) throw new Error('no item ' + k); return { w: 5 * s, h: 5 * s, ox: -2.5 * s, oy: -2.5 * s }; },
  wrapWords: (t) => String(t).split(' '),
  ovGeom: () => ({ ps: 3, hx: 60, top: 0, cy: 10, out: 1, bottom: 40 }),
  tagScale: (s) => Math.max(2, Math.round(s / 2)),
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/overlay-fx.js'), 'utf8') + '\n;this.api = { drawStreams, drawUsageRing, drawOvSay, drawScan, drawTag, drawDrones, drawWeatherBack, drawWeatherFront, drawReport, hitReport, drawBossBack, drawBossFront };', sandbox);
const api = sandbox.api;
const run = (label, fn) => { try { fn(); check(label, true); } catch (err) { check(label, false, err.message); } };

const frame = () => world.snapshot(now);
let snap = frame();
const streams = snap.buddies.filter((x) => x.stream > 0).map((x) => ({ x: x.x, y: x.y - 8 * x.s, k: x.stream, c: x.look.body }));
check('a working buddy feeds the token stream', streams.length === 1);
run('token stream (Overlord tucked in)', () => api.drawStreams(streams, { ...snap.overlord, mode: 'fused' }));
run('token stream (Overlord out)', () => api.drawStreams(streams, { ...snap.overlord, mode: 'detached' }));
run('usage meter (tucked in)', () => api.drawUsageRing({ ...snap.overlord, usage: 64, mode: 'fused' }, sandbox.ovGeom()));
run('usage ring (out)', () => api.drawUsageRing({ ...snap.overlord, usage: 91, mode: 'patrol' }, sandbox.ovGeom()));

world.ovSay('Inspection time.');
world.ovPatrol([a.id, b.id]);
let scanned = null;
for (let i = 0; i < 400 && !scanned; i++) { step(16); scanned = frame().fx.scan; }
snap = frame();
run('remark bubble', () => api.drawOvSay(snap.fx.say || { text: 'TEST', t: 300, left: 2000 }, snap.overlord));
run('scan beam', () => api.drawScan(scanned, snap.overlord));
step(2500);
snap = frame();
const tagged = snap.buddies.find((x) => x.inspect);
run('stat tag', () => { if (!tagged) throw new Error('no tag'); api.drawTag({ ...tagged, _sp: { oy: -40, ox: -20, w: 40, h: 40 } }); });

world.patrolEnd();
step(1500);
world.ovReport({ date: 'THU 5 NOV', rows: [{ name: 'a', body: '#d97757', prompts: 1, tools: 5, edits: 2, minutes: 3 }], totals: { prompts: 1, tools: 5, edits: 2, minutes: 3, agents: 0 }, usage: { session: 12, week: null } });
step(1200);
snap = frame();
sandbox.fx = snap.fx;
run('holo-report', () => api.drawReport(snap.fx.report));
check('the report can be clicked', api.hitReport(snap.fx.report.rect.x + 10, snap.fx.report.rect.y + 10));
world.reportClose();

world.droneLaunch('snack', a); world.droneCarry(b, { x: 200, y: 832 });
step(1500);
snap = frame();
run('drones (with a tractor beam)', () => api.drawDrones(snap.fx.drones));

for (const kind of ['snow', 'rain', 'storm']) {
  world.setWeather(kind, 1);
  step(kind === 'storm' ? 9000 : 7000);
  snap = frame();
  run(`weather: ${kind}`, () => { api.drawWeatherBack(snap.fx.weather); api.drawWeatherFront(snap.fx.weather); });
}
world.setWeather('clear');
step(9000);

step(6000);
world.bossStart();
step(9000);
snap = frame();
run('boss fight: laser, shots, sparks, health bar', () => { api.drawBossBack(snap.fx.boss); api.drawBossFront(snap.fx.boss, snap.overlord); });
while (world.fx.boss && world.fx.boss.phase === 'fight') { world.bossHit(); step(30); }
step(300);
snap = frame();
run('boss fight: the explosion', () => api.drawBossFront(snap.fx.boss, snap.overlord));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
