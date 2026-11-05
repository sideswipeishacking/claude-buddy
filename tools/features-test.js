// Headless checks for helpers (sub-agents), alert timing (! ? ✓), the hatch,
// and the right-click actions. Laptop panel with a taller monitor to its right.
'use strict';
const fs = require('fs');
const path = require('path');
const Clawd = require('../app/sprites');
const { World } = require('../app/world');
const { Sessions } = require('../app/sessions');

Clawd.loadPoses(JSON.parse(fs.readFileSync(path.join(__dirname, '../app/assets/poses.json'), 'utf8')));
let now = 1_700_000_000_000;
Date.now = () => now;
const timers = [];
global.setTimeout = (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; };
global.clearTimeout = () => {};

let overlordBorn = 0;
const worldErrors = [];
const world = new World({ sound: () => {}, focus: () => {}, removed: () => {}, overlordBorn: () => overlordBorn++, error: (err) => worldErrors.push(err) });
world.setDisplays([
  { id: 1, internal: true, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 832 } },
  { id: 2, internal: false, bounds: { x: 1536, y: 0, width: 1920, height: 1080 }, workArea: { x: 1536, y: 0, width: 1920, height: 1040 } },
]);
world.setWindows([{ id: 'w1', title: 'notes', maximized: false, rect: { x: 1900, y: 600, width: 700, height: 300 } }]);
const sessions = new Sessions();

let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failures++; };
function run(ms, until) {
  for (let t = 0; t < ms; t += 16) {
    now += 16;
    for (const tm of timers.filter((x) => x.at <= now)) { timers.splice(timers.indexOf(tm), 1); tm.fn(); }
    world.tick(now, 0.016, { x: 2600, y: 500, speed: 0 }, null);
    if (until && until()) return true;
  }
  return false;
}
const ev = (sid, e, extra = {}) => sessions.handle({ session_id: sid, cwd: 'C:/Projects/demo', hook_event_name: e, ...extra });

// ---- 1. The build: the Overlord appears, scans, prints and powers up the buddy, then it drops.
const s1 = sessions.get('hatch');
const b = world.add(s1, { look: { hat: 'crown' }, x: 2600 });
check('is built in the centre of the screen it was summoned on', b.mode === 'birth' && b.birth.cx === 1536 + 960 && b.birth.cy === 580);
check('the first buddy brings the Overlord into being, right at the build site', world.ov.present && world.ov.mode === 'building' && overlordBorn === 1 && Math.abs(world.ov.x - 2496) < 1);
run(1000);
check('a hologram stands big while the beam scans', b.anim === 'idle' && b.scale === b.birth.big, `scale ${b.scale}`);
run(3800);
check('printed and powered on: it cheers', ['cheer', 'welcome'].includes(b.anim));
run(1000);
check('the Overlord heads home once the build is done', ['returning', 'fused'].includes(world.ov.mode) && world.ov.build === null, world.ov.mode);
const fell = run(5000, () => b.mode === 'auto');
check('then drops to the bottom', fell && b.y === 1040, `y=${b.y}`);
check('and is back to its normal size (4 on the monitor)', b.scale === 4, `scale ${b.scale}`);
check('the Overlord fused back into the top edge', world.ov.mode === 'fused', world.ov.mode);
b.pinned = true; // keep it on this monitor while we watch the Overlord
run(12000, () => world.ov.peek);
const peek = () => world.ovSnapshot(now).peek;
run(400);
check('every few seconds an eye pokes out of the top-left corner', peek() && peek().out > 0.5 && peek().x === world.ovHome().x && peek().x >= 40, peek() && `x=${peek().x}`);
{
  const was = world.sizes;
  world.sizes = { internal: 10, external: 10 };
  const big = world.ovHome().x, ps = Math.max(2, Math.round(world.ovScale() * 0.6));
  world.sizes = was;
  check('a bigger Overlord sits further from the screen edge, so it never clips', big - world.displays[0].bounds.x >= 16 * ps, `x=${big} ps=${ps}`);
}
world.ov.hovered = true; run(400);
check('hovering the corner keeps the eye out, looking at you', peek() && peek().out === 1);
world.ov.hovered = false;
world.ovDetach(); run(600);
check('clicking detaches it out of the top edge', world.ov.mode === 'detached' && world.ov.y > 0, `${world.ov.mode} y=${Math.round(world.ov.y)}`);
run(9500, () => world.ov.mode === 'fused');
check('left alone, it fuses back into the top', world.ov.mode === 'fused');
b.pinned = false;
run(2000);

// ---- 2. Alerts only when a prompt is really on screen.
world.setPinned(b, true); run(3000, () => b.mode === 'auto' || b.mode === 'float'); // a bubble can't show mid-hop
ev('hatch', 'UserPromptSubmit', { prompt: 'do things' });
ev('hatch', 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {} });
run(200);
check('no ? when Claude merely decides to ask', s1.attention === null && b.bubble === null);
ev('hatch', 'PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: {} });
run(200);
check('? appears once the question is on screen', s1.attention === 'question' && b.bubble === '?');
ev('hatch', 'PostToolUse', { tool_name: 'AskUserQuestion', tool_response: {} });
run(200);
check('? goes away once answered', s1.attention === null && b.bubble !== '?');
ev('hatch', 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: 'x1' });
ev('hatch', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, permission_suggestions: [{ type: 'addRules' }] });
run(200);
check('! with details for a permission prompt', s1.attention === 'permission' && b.bubble === '!' && s1.pendingPermission.detail === 'rm -rf build' && s1.pendingPermission.canAlways);
let released = 0;
sessions.on('permission-resolved', () => released++);
ev('hatch', 'PostToolUse', { tool_name: 'Bash', tool_response: {} });
run(200);
check('answered elsewhere: ! clears and the held hook is released', s1.attention === null && released === 1);
ev('hatch', 'Stop', {});
run(3500);
check('finished turn: celebrate, then a green ✓', b.bubble === '✓' && s1.attention === 'done');
ev('hatch', 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
run(500);
check('the 60 s "waiting for input" notice does not bring back a !', s1.attention === 'done' && b.bubble !== '!' && b.bubble !== '?', b.bubble);
world.setHover('hatch'); run(600); world.setHover(null); run(100);
check('✓ stays until you hover it', b.bubble === null && b.ackDone);
world.setPinned(b, false);

// ---- 3. Helpers follow their buddy, including up a wall.
ev('hatch', 'UserPromptSubmit', { prompt: 'use helpers' });
ev('hatch', 'PreToolUse', { tool_name: 'Task', tool_input: {}, tool_use_id: 'task1' });
ev('hatch', 'PreToolUse', { tool_name: 'Task', tool_input: {}, tool_use_id: 'task2' });
run(800);
const mine = () => world.minis.filter((m) => m.parent === b);
check('two helpers appear for two sub-agents', mine().length === 2);
check('helpers are small (half size)', mine().every((m) => m.scale === 2), mine().map((m) => m.scale).join(','));
run(2000);
check('helpers walk beside their buddy', mine().every((m) => m.mode === 'auto' && Math.abs(m.x - b.x) < 120), mine().map((m) => Math.round(m.x - b.x)).join(','));
// Send the buddy up the right screen edge and let the helpers follow.
s1.state = 'idle';
b.idleSince = now;
world.walkTo(b, 3600, 400); b.exit = 'R'; b.exitKind = 'climb'; b.climbPlan = { next: 'ceil', frac: 0.5 }; b.action = { type: 'walk' };
run(25000, () => b.mode === 'ceil');
run(9000, () => mine().every((m) => m.mode === 'ceil'));
check('buddy climbed to the ceiling', b.mode === 'ceil');
check('helpers climbed after it onto the ceiling', mine().every((m) => m.mode === 'ceil'), mine().map((m) => m.mode).join(','));
world.letGo(b, 'drop');
run(8000, () => b.mode === 'auto' && mine().every((m) => m.mode === 'auto'));
check('helpers come back down when their buddy drops', mine().every((m) => m.mode === 'auto'), mine().map((m) => m.mode).join(','));
world.setLook('hatch', { ...b.look, helpers: false });
run(1500);
check('helpers can be switched off per session', mine().length === 0);
ev('hatch', 'PostToolUse', { tool_name: 'Task', tool_response: {}, tool_use_id: 'task1' });
ev('hatch', 'PostToolUse', { tool_name: 'Task', tool_response: {}, tool_use_id: 'task2' });
ev('hatch', 'Stop', {});
b.queue = []; b.react = null;
run(4000);

// ---- 4. Right-click actions.
world.comeHere(b, { x: 2200, y: 590 }); // onto the window ledge at y=600
const came = run(8000, () => !b.task && b.mode === 'auto');
check('"Come here" leaps onto the ledge under the pointer', came && b.y === 600 && Math.abs(b.x - 2200) < 10, `x=${Math.round(b.x)} y=${b.y}`);
run(1500);
world.giveSnack(b);
const ate = run(6000, () => b.anim === 'snack');
check('a snack drops in and gets eaten', ate);
run(4000);
world.playFetch(b, { x: 1700, y: 300 });
let carried = false;
const fetched = run(30000, () => { if (world.items.some((i) => i.carrier === b)) carried = true; return carried && !b.task; });
check('fetch: chases the ball, picks it up and brings it back', fetched && carried);
run(3000);
world.hideFor(b, 1);
run(40000, () => b.hide && b.hide.phase === 'gone' && b.alpha === 0); // it may have a long way to sneak
check('hide: sneaks off to the edge and vanishes', b.hide && b.alpha === 0);
run(62000);
check('…and comes back after the time is up', !b.hide && b.alpha > 0.9);

// ---- 5. Round 5: feeding files, the file dialog, Stay put, the marker, sub-agent counts.
run(8000, () => b.mode === 'auto' && !b.react && !b.queue.length);
world.setPinned(b, true); // no wandering off (or jumping) mid-check
run(3000, () => !b.react && !b.queue.length);
b.dragHint = now; run(100);
check('files dragged over it: arms up, ready to catch', b.anim === 'holdUp');
b.dragHint = 0; run(400);
world.ingest(b, ['notes.txt', 'photo.png', 'src.zip']);
run(2500, () => b.anim === 'holdUp'); // (if it was mid-jump, it catches them once it lands)
check('dropped files: it holds the stack above its head', b.anim === 'holdUp' && b.carry && b.carry.kinds.join() === 'file,image,zip', `${b.mode} ${b.anim}`);
run(2000, () => b.anim === 'munchFile');
check('…then munches them one by one', b.anim === 'munchFile' && b.carry.kinds.length === 3);
run(1800);
check('…one fewer each round', b.anim === 'munchFile' && b.carry.kinds.length === 2, b.carry && b.carry.kinds.length);
run(5000, () => !b.react && !b.queue.length);
check('…until they are all gone', !b.carry);
world.setPinned(b, false);

let opened = 0;
const groups = [
  { x: 1700, y: 300, w: 400, h: 66, count: 3, view: 'rows', color: '#ffffff' },
  { x: 1700, y: 410, w: 400, h: 22, count: 1, view: 'rows', color: '#ffffff' },
];
world.eatDialog(b, groups, () => opened++);
run(200);
world.grab(b.id);
check('file dialog: it dashes over to the selected rows (and can\'t be grabbed meanwhile)', b.mode === 'script');
let tallest = 1;
run(6000, () => { tallest = Math.max(tallest, b.stretch); return opened > 0; });
check('three touching rows go down in one stretched gulp', tallest > 1.5, tallest.toFixed(2));
check('every eaten row is covered up', world.covers.length === 2 && world.covers.every((c) => c.p === 1));
check('Open is pressed only once it has finished eating', opened === 1);
const back = run(5000, () => b.mode === 'auto');
check('then it drops back down at its normal size', back && b.scale === 4 && b.stretch === 1, `scale ${b.scale}`);
world.clearCovers();

world.setPinned(b, true);
world.grab(b.id);
b.grab.moved = true;
world.cursor = { x: 2300, y: 300, speed: 0 };
b.x = 2300; b.y = 300; b.history = [{ t: now - 50, x: 2290, y: 310 }, { t: now, x: 2300, y: 300 }];
world.release();
run(3000);
check('Stay put: dropped in mid-air, it floats right there', b.mode === 'float' && Math.round(b.x) === 2300 && Math.round(b.y) === 300, `${b.mode} ${Math.round(b.x)},${Math.round(b.y)}`);
world.grab(b.id);
check('a floating buddy can still be picked up', b.mode === 'held');
world.release();
world.setPinned(b, false);
const dropped = run(3000, () => b.mode === 'auto');
check('turning Stay put off lets it fall', dropped);

world.comeHere(b, { x: 2250, y: 420 }); // in mid-air above the window ledge at y=600
check('the "Come here" marker lands on the ledge under the click', b.task && b.task.y === 600 && b.task.x === 2250);
const snapMarker = world.snapshot(now).buddies.find((x) => x.id === b.id).marker;
check('…and is drawn there until it arrives', snapMarker && snapMarker.y === 600);
const arrived = run(9000, () => !b.task);
check('…and it gets there', arrived && b.y === 600 && Math.abs(b.x - 2250) < 12, `x=${Math.round(b.x)} y=${b.y}`);

const s2 = sessions.get('agents');
ev('agents', 'UserPromptSubmit', { prompt: 'fan out' });
ev('agents', 'PreToolUse', { tool_name: 'Task', tool_input: {}, tool_use_id: 't1' });
ev('agents', 'SubagentStart', { agent_id: 'a1' });
ev('agents', 'PreToolUse', { tool_name: 'Task', tool_input: {}, tool_use_id: 't2' });
ev('agents', 'SubagentStart', { agent_id: 'a2' });
check('sub-agents: two Task calls with start events count as two, not four', s2.subagents === 2, s2.subagents);
ev('agents', 'SubagentStop', { agent_id: 'a1' });
ev('agents', 'PostToolUse', { tool_name: 'Task', tool_response: {}, tool_use_id: 't1' });
check('one finishes: one left', s2.subagents === 1, s2.subagents);
ev('agents', 'SubagentStop', { agent_id: 'a2' });
ev('agents', 'PostToolUse', { tool_name: 'Task', tool_response: {}, tool_use_id: 't2' });
check('both finish: no helpers left', s2.subagents === 0, s2.subagents);
const delegating = Clawd.ACTIVITY_ANIMS.delegating;
check('the "delegating" pose no longer draws extra little Clawds', delegating.every((a) => !/deleg|agents|helpers/i.test(a)), delegating.join(','));

// ---- 6. Round 6: the dialog crash, Stay put for real, the usage limit, fullscreen alerts.
const cleanRun = (ms, until) => { const before = worldErrors.length; const r = run(ms, until); return { r, errors: worldErrors.length - before }; };

// The freeze: "Open" clicked while the buddy was climbing a wall.
run(4000, () => b.mode === 'auto' && !b.react && !b.queue.length);
const wallR = world.walls.find((w) => w.side === 'R' && w.x > 3000);
world.enterWall(b, wallR, -1, 700);
check('setup: buddy is on the right screen wall', b.mode === 'wall' && !!b.wall);
let opened2 = 0;
let threw = null;
try { world.eatDialog(b, [{ x: 2600, y: 300, w: 300, h: 22, count: 1, view: 'rows', color: '#171717' }], () => opened2++); } catch (err) { threw = err; }
check('eating a dialog row while on a wall no longer throws', !threw, threw && threw.message);
const ate2 = cleanRun(8000, () => opened2 > 0 && b.mode === 'auto');
check('…it eats the row, presses Open and lands normally', opened2 === 1 && b.mode === 'auto' && ate2.errors === 0, `${b.mode}, errors ${ate2.errors}`);
world.clearCovers();

// Any buddy that ends up in an impossible state is put right instead of freezing everything.
b.mode = 'wall'; b.wall = null;
const rec = cleanRun(3000, () => b.mode === 'auto');
check('a broken buddy is recovered (and the world keeps running)', b.mode === 'auto' && rec.errors >= 1, `${b.mode}, ${rec.errors} logged`);
const ovBefore = world.ov.mode;
b.mode = 'wall'; b.wall = null; run(100);
check('…the Overlord keeps going meanwhile', world.ov.mode === ovBefore || world.ov.mode === 'fused');
run(3000, () => b.mode === 'auto');

// Stay put on the floor: not one step, working or idle.
s1.state = 'working'; s1.kind = 'thinking'; s1.kindSince = now;
run(500);
world.walkTo(b, b.x + 300, 200); // it was walking somewhere when you pinned it
world.setPinned(b, true);
const fx = b.x, fy = b.y;
run(20000);
s1.state = 'idle'; s1.kind = 'idle';
run(200000);
check('Stay put on the floor: it does not move at all (working, idle, napping)', Math.abs(b.x - fx) < 1 && Math.abs(b.y - fy) < 1, `moved ${Math.round(b.x - fx)},${Math.round(b.y - fy)}`);
world.setPinned(b, false);
run(3000);

// Stay put on a wall and on the ceiling: it stays there instead of climbing down or letting go.
world.enterWall(b, wallR, -1, 600);
world.setPinned(b, true);
const wy = b.y;
s1.state = 'working'; s1.kind = 'coding';
run(30000);
s1.state = 'idle'; s1.kind = 'idle';
run(60000);
check('Stay put on a wall: it clings right there', b.mode === 'wall' && Math.abs(b.y - wy) < 1, `${b.mode} moved ${Math.round(b.y - wy)}`);
world.setPinned(b, false);
run(15000, () => b.mode === 'auto');
const ceil = world.ceilings.find((c) => c.x1 < 2500 && c.x2 > 2500);
world.enterCeil(b, ceil, 1);
b.x = 2500;
world.setPinned(b, true);
run(60000);
check('Stay put on the ceiling: it stays up there', b.mode === 'ceil' && Math.abs(b.x - 2500) < 1, `${b.mode} x=${Math.round(b.x)}`);
world.setPinned(b, false);
run(15000, () => b.mode === 'auto');

// Hiding a floating (pinned) buddy used to read a missing platform.
world.setPinned(b, true);
world.grab(b.id); b.grab.moved = true; b.x = 2400; b.y = 350; b.history = [];
world.release();
const hid = cleanRun(4000, () => { if (b.mode === 'float' && !b.hide) world.hideFor(b, 1); return b.hide && b.alpha === 0; });
check('hiding a floating buddy fades it out in place (no crash)', b.hide && b.alpha === 0 && hid.errors === 0, `errors ${hid.errors}`);
b.hide = null; world.setPinned(b, false);
run(4000, () => b.mode === 'auto');

// Fullscreen: hidden, except when it matters.
const d2 = world.displays[1].id;
world.hiddenDisplays.add(d2);
s1.attention = null; b.ackDone = true;
world.setPinned(b, true); // stays on the fullscreen monitor for these checks
const vis = () => (world.snapshot(now).buddies.find((x) => x.id === b.id) || {}).alpha;
check('over a fullscreen app it stays hidden normally', vis() === 0);
s1.attention = 'permission'; s1.attentionSince = now;
check('…but shows up when it needs your permission', vis() > 0);
s1.attention = 'done'; s1.attentionSince = now; b.ackDone = false;
check('…and when it finished a prompt', vis() > 0);
s1.attention = null; s1.ctxAlertAt = now; s1.context = { used: 182000, size: 200000, pct: 91 };
check('…and when its context is about to compact (90%)', vis() > 0);
run(13000);
check('…then it hides again', vis() === 0);
world.hiddenDisplays.clear();
world.setPinned(b, true); run(3000, () => (b.mode === 'auto' || b.mode === 'float') && !b.react);
check('the context alert keeps a % bubble on the buddy', b.bubble === 'ctx', b.bubble);
world.setPinned(b, false);
s1.context = { used: 50000, size: 200000, pct: 25 }; s1.ctxAlertAt = 0;

// The usage limit.
let stopped = 0, limitHits = 0;
sessions.on('crashed', () => stopped++);
sessions.on('limit-hit', () => limitHits++);
ev('hatch', 'StopFailure', { error: 'rate_limit' });
check('a turn cut off by the limit is recognised (not shown as a crash)', limitHits === 1 && stopped === 0 && s1.limitHitAt === now);
const sB = sessions.get('second');
sB.name = 'other';
const b2 = world.add(sB, { look: {}, x: 1700, birth: false });
run(3000, () => b2.mode === 'auto');
let reviewed = null;
world.hooks.released = (r) => { reviewed = r; };
world.banish({ kind: 'session', resetsAt: new Date(now + 3600e3).toISOString() });
run(800);
check('limit reached: everyone panics, running around with a !', b.bubble === '!' && b2.bubble === '!' && ['zoom', 'startled'].includes(b.anim));
run(2600);
check('the Overlord comes to the middle of the screen, red-eyed', world.ov.mode === 'doom' && world.ov.red === true);
run(14000, () => world.doom && world.doom.phase === 'sealed');
check('a pit opens and both buddies are dragged into hell', [b, b2].every((x) => x.mode === 'hell') && world.doom.phase === 'sealed', `${b.mode},${b2.mode} ${world.doom && world.doom.phase}`);
check('banished buddies are not drawn or clickable', !world.snapshot(now).buddies.some((x) => x.id === b.id || x.id === b2.id));
run(1500);
check('the Overlord goes home, its eye still red', world.ov.mode === 'fused' && world.ov.red);
const s3 = sessions.get('late');
const b3 = world.add(s3, { look: {}, x: 2000 });
check('a buddy summoned during the limit goes straight down too', b3.mode === 'hell');
world.remove('late');
world.unbanish(new Set(['hatch']));
run(30000, () => reviewed !== null);
check('at the reset they are brought back up and reviewed', reviewed !== null && reviewed.length === 2);
const verdict = (id) => (reviewed || []).find((r) => r.id === id)?.verdict;
check('only the interrupted one is told to resume', verdict('hatch') === 'resume' && verdict('second') === 'ok', JSON.stringify(reviewed));
check('afterwards everyone is back to normal, a bit sooty', [b, b2].every((x) => x.mode === 'auto' || x.mode === 'air') && !!b.soot && world.doom === null);
run(2000);
check('…and the Overlord is calm again', world.ov.red === false && ['fused', 'returning'].includes(world.ov.mode), world.ov.mode);
world.remove('second', { goodbye: false });

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
