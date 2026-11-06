// Headless checks for moving a buddy to another session (app/handover.js, World.rekey, the "take"
// command): the registry move and swap, picking a buddy, and reading which chat a transcript continues.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Clawd = require('../app/sprites');
const { World } = require('../app/world');
const { Sessions } = require('../app/sessions');
const H = require('../app/handover');

Clawd.loadPoses(JSON.parse(fs.readFileSync(path.join(__dirname, '../app/assets/poses.json'), 'utf8')));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failures++; };

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333', D = '44444444-4444-4444-8444-444444444444';

// ---- 1. The registry: the buddy's things move, the session's stay.
{
  const reg = {
    [A]: { look: { hat: 'crown' }, nickname: 'Erin', created: 1, active: true, muted: true, cwd: 'proj-a', name: 'proj-a', app: { exe: 'claude.exe' }, lastSeen: 5 },
  };
  const r = H.moveEntry(reg, A, B);
  check('moving to a session without a buddy: the entry moves over', !!r && !reg[A] && reg[B] && reg[B].nickname === 'Erin' && reg[B].look.hat === 'crown' && reg[B].created === 1 && reg[B].muted === true);
  check('…without the old session\'s folder and app', reg[B].cwd === undefined && reg[B].app === undefined && r.b === null);
  reg[C] = { look: { hat: 'wizard' }, nickname: 'Bob', created: 2, active: false, cwd: 'proj-c', name: 'proj-c' };
  H.moveEntry(reg, B, C);
  check('moving onto a session that has a buddy: they swap', reg[C].nickname === 'Erin' && reg[C].cwd === 'proj-c' && reg[B].nickname === 'Bob' && reg[B].active === false);
  check('nothing to move: no change', H.moveEntry(reg, D, A) === null && !reg[A]);
}

// ---- 2. Which buddy "/buddy take" means.
{
  const reg = {
    [A]: { nickname: 'Erin', lastSeen: 10 }, [B]: { name: 'claude-buddy', lastSeen: 30 }, [C]: { nickname: 'Erik', lastSeen: 20 }, 'demo-1': { nickname: 'Demo' },
  };
  check('take by exact name', H.pickBuddy(reg, D, 'erin').id === A);
  check('…or by the start of it', H.pickBuddy(reg, D, 'claude').id === B);
  check('…the one used last when several match', H.pickBuddy(reg, D, 'er').id === C);
  check('…never its own', H.pickBuddy(reg, A, 'erin').id !== A);
  check('no name: the buddy of the chat this one continues', H.pickBuddy(reg, D, '', [A, C]).id === C);
  const none = H.pickBuddy(reg, D, 'zelda');
  check('no match: lists the buddies to choose from (no demo ones)', !none.id && none.names.length === 3 && !none.names.includes('Demo'), none.names.join(', '));
}

// ---- 3. Which chat a transcript continues.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-handover-'));
const line = (sid, type = 'user') => JSON.stringify({ type, sessionId: sid, message: { content: 'x'.repeat(40) } }) + '\n';
const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
(async () => {
  const own = write('own.jsonl', line(B, 'queue-operation') + line(B) + line(B));
  check('a chat of its own has no ancestors', (await H.lineage(own, B)).length === 0);
  const fork = write('fork.jsonl', line(A, 'queue-operation') + line(A) + line(A) + line(B) + line(B));
  check('a fork names the chat it was copied from', JSON.stringify(await H.lineage(fork, B)) === JSON.stringify([A]));
  const fork2 = write('fork2.jsonl', line(A) + line(C) + line(C) + line(B));
  check('a fork of a fork names both, oldest first', JSON.stringify(await H.lineage(fork2, B)) === JSON.stringify([A, C]));
  // An id split across the 1 MB read boundary still counts.
  const pad = JSON.stringify({ type: 'pad', text: 'y'.repeat((1 << 20) - 30) }) + '\n';
  const big = write('big.jsonl', line(A) + pad + line(C) + line(B));
  check('…even with a long copied history', JSON.stringify(await H.lineage(big, B)) === JSON.stringify([A, C]));
  const empty = write('empty.jsonl', '');
  check('a transcript with nothing in it yet: try again later', await H.lineage(empty, B).then(() => false, () => true));
  check('no transcript at all: try again later', await H.lineage(path.join(dir, 'missing.jsonl'), B).then(() => false, () => true));
  fs.rmSync(dir, { recursive: true, force: true });

  // ---- 4. The world: a buddy changes hands without being rebuilt.
  let now = 1_700_000_000_000;
  Date.now = () => now;
  const world = new World({ sound: () => {}, focus: () => {}, removed: () => {}, overlordBorn: () => {}, error: (err) => { throw err; } });
  world.setDisplays([{ id: 1, internal: true, primary: true, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 832 } }]);
  world.setWindows([]);
  const sessions = new Sessions();
  const sa = sessions.get(A), sb = sessions.get(B), sc = sessions.get(C);
  const ba = world.add(sa, { look: { hat: 'crown' }, x: 400, birth: false });
  const bc = world.add(sc, { look: { hat: 'wizard' }, x: 900, birth: false });
  for (let t = 0; t < 2000; t += 16) { now += 16; world.tick(now, 0.016, { x: 2000, y: 500, speed: 0 }, null); }
  const x0 = ba.x;
  world.tower.rides.push({ id: A, dir: 'up', phase: 'call', at: now, look: {} });
  world.rekey(new Map([[A, sb]]));
  check('rekey: the same buddy now answers to the new session', world.get(B) === ba && !world.get(A) && ba.id === B && ba.session === sb);
  check('…right where it was, in the same clothes', ba.x === x0 && ba.look.hat === 'crown');
  check('…and rides booked under the old id follow', world.tower.rides[0].id === B);
  world.rekey(new Map([[B, sc], [C, sb]]));
  check('rekey both ways at once: two buddies swap sessions', world.get(C) === ba && world.get(B) === bc && ba.session === sc && bc.session === sb);
  sb.state = 'working';
  for (let t = 0; t < 500; t += 16) { now += 16; world.tick(now, 0.016, { x: 2000, y: 500, speed: 0 }, null); }
  check('…and each shows its new session\'s work', bc.session.state === 'working' && world.snapshot(now).buddies.find((x) => x.id === B));

  // ---- 5. The command answers in Claude Code.
  sessions.on('take', (s, name, out) => { out.message = `took ${name || 'the one before'} for ${s.id.slice(0, 4)}`; });
  const msg = sessions.handle({ session_id: D, hook_event_name: 'UserPromptSubmit', prompt: '/buddy take Erin', buddy_command: { action: 'take', value: 'Erin' } });
  check('"/buddy take Erin" gets the app\'s reply back', msg === 'took Erin for 4444', String(msg));

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
