// Handing a buddy over to another session. A buddy's id is its session's id, so when a chat carries
// on under a new id (the Claude app gives a forked or continued chat a new session), the buddy has
// to move with it, by hand (its menu, "/buddy take <name>") or on its own (main.js followCheck).
// No Electron in here, so tools/handover-test.js can run it.
'use strict';
const fs = require('fs');

/** What belongs to the buddy in a registry entry. Everything else (folder, app, transcript...) is the session's. */
const BUDDY_KEYS = ['look', 'muted', 'pinned', 'annoy', 'nickname', 'created', 'active', 'homeAfterEnd'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const buddyPart = (e) => Object.fromEntries(BUDDY_KEYS.filter((k) => e && e[k] !== undefined).map((k) => [k, e[k]]));
const sessionPart = (e) => { const o = { ...(e || {}) }; for (const k of BUDDY_KEYS) delete o[k]; return o; };
const label = (e) => (e && (e.nickname || e.name)) || 'buddy';

/**
 * Move the buddy registered under `fromId` to `toId` in the registry. If `toId` had a buddy of its
 * own, the two trade places. Returns { a, b }: the moved entry and the one it swapped with (or null).
 */
function moveEntry(registry, fromId, toId) {
  const A = registry[fromId], B = registry[toId] || null;
  if (!A || fromId === toId) return null;
  registry[toId] = { ...sessionPart(B), ...buddyPart(A) };
  if (B) registry[fromId] = { ...sessionPart(A), ...buddyPart(B) };
  else delete registry[fromId];
  return { a: registry[toId], b: B ? registry[fromId] : null };
}

/**
 * The sessions whose chat this transcript carries on, oldest first. A fork starts with a copy of the
 * conversation it came from, every line still marked with that session's id, so the ids before the
 * session's own are its ancestors. Stops at the first line of its own (that's usually the very first
 * line, so most transcripts cost one small read). Resolves [] for a chat of its own.
 */
function lineage(file, ownId, { maxMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('no transcript'));
    const seen = [], started = Date.now();
    let tail = '', done = false, any = false;
    const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
    const finish = (err) => {
      if (done) return;
      done = true;
      stream.destroy();
      if (err) reject(err); else resolve(seen);
    };
    stream.on('data', (chunk) => {
      if (done) return;
      const text = tail + chunk;
      const re = /"sessionId":"([0-9a-f-]{36})"/gi;
      let m;
      while ((m = re.exec(text))) {
        any = true;
        if (m[1] === ownId) return finish();
        if (!seen.includes(m[1])) seen.push(m[1]);
      }
      tail = text.slice(-80);
      if (Date.now() - started > maxMs) finish(); // a huge copied history: what it found so far will do
    });
    stream.on('end', () => (any ? finish() : finish(new Error('nothing written yet'))));
    stream.on('error', finish);
  });
}

/**
 * Which buddy "/buddy take [name]" means: by name (exact, else the start of it, else anywhere in it;
 * the one used most recently if several match), or with no name the newest ancestor that has one.
 * Returns { id } or { names } (the buddies to choose from).
 */
function pickBuddy(registry, exceptId, query, ancestors = []) {
  const all = Object.entries(registry).filter(([id]) => id !== exceptId && !id.startsWith('demo-'))
    .sort((x, y) => (y[1].lastSeen || 0) - (x[1].lastSeen || 0));
  const q = String(query || '').trim().toLowerCase();
  if (q) {
    for (const test of [(n) => n === q, (n) => n.startsWith(q), (n) => n.includes(q)]) {
      const hit = all.find(([, e]) => test(label(e).toLowerCase()));
      if (hit) return { id: hit[0] };
    }
  } else {
    const id = [...ancestors].reverse().find((x) => registry[x] && x !== exceptId);
    if (id) return { id };
  }
  return { names: all.slice(0, 8).map(([, e]) => label(e)) };
}

/** "just now", "5 min ago", "3 h ago". */
function ago(t, now = Date.now()) {
  const m = Math.round((now - t) / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

module.exports = { BUDDY_KEYS, UUID, moveEntry, lineage, pickBuddy, label, ago };
