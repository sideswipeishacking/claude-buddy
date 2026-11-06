/* Overlay renderer: draws the buddies, the Overlord and their effects on one
 * monitor, hit-tests the mouse, shows the hover cards (buddy: context ring and
 * permission buttons; Overlord: usage limits and the buddy roster), takes file
 * drops, and plays 8-bit sounds. The main process owns the simulation; this
 * page draws it.
 *
 * Sprites are rasterised at a whole number of device pixels per art pixel and
 * drawn unscaled, so there are no half-covered edge rows (which showed up as
 * dark fringes on non-100% display scaling). */
'use strict';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const card = document.getElementById('card');
const ovcard = document.getElementById('ovcard');
const ovmenu = document.getElementById('ovmenu');
const permLayer = document.getElementById('perms');

let dpr = window.devicePixelRatio || 1;
let origin = { x: 0, y: 0 };
let buddies = [];
let items = [];
let overlord = null;
let covers = [];
let doom = null; // the usage-limit banishment, while it lasts
let tower = null; // the skyscraper (on the main display's overlay)
let puke = null; // someone was shaken too hard
let fx = null; // the Overlord's shows (overlay-fx.js)
let streams = []; // working sessions, for the token stream
let placing = false;
let dialogHot = null;
let anyHeld = false;
let receivedAt = performance.now();
let hoverId = null;
let grabbing = false;
let grabAt = 0;
let grabPointer = null;
let lastMouse = null;
let lastRealMouse = 0; // Linux doesn't forward mouse moves to click-through windows; frames carry the pointer instead
const cache = new Map();

// Keep in step with BUILD in world.js.
const BUILD = { arrive: 900, beam: 1500, holo: 2300, print: 4600, power: 5200, leave: 5700, drop: 8100, effects: 10500 };
const CY = '#3fd0ff', CY2 = '#9eeaff';

// Name tags stay readable even on tiny buddies; bubbles scale with the buddy.
const tagScale = (s) => Math.max(2, Math.round(s / 2));
const bubbleScale = (s) => Math.max(2, Math.round(s * 0.75));
const lookKey = (l) => (l ? [l.hat, l.hand, l.face, l.neck, l.back, l.body, l.eye, l.carry ? l.carry.kinds.join('+') : ''].join(',') : '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- rasterising
function raster(pixels, scale, colour) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pixels) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + 1); y1 = Math.max(y1, p.y + 1); }
  if (!pixels.length) { x0 = y0 = 0; x1 = y1 = 1; }
  const k = Math.max(1, Math.round(scale * dpr)); // device pixels per art pixel
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round((x1 - x0) * k));
  cv.height = Math.max(1, Math.round((y1 - y0) * k));
  const g = cv.getContext('2d');
  for (const p of pixels) {
    g.globalAlpha = p.a ?? 1;
    g.fillStyle = colour || p.c;
    g.fillRect(Math.round((p.x - x0) * k), Math.round((p.y - y0) * k), k, k);
  }
  const u = k / dpr; // DIP per art pixel as actually drawn
  return { cv, u, oxd: x0 * k, oyd: y0 * k, ox: x0 * u, oy: y0 * u, w: cv.width / dpr, h: cv.height / dpr };
}

function memo(key, make) {
  let v = cache.get(key);
  if (!v) { v = make(); cache.set(key, v); if (cache.size > 6000) cache.clear(); }
  return v;
}

// Rotate upright pixels (feet at the origin) onto a wall or the ceiling, so the
// feet touch the surface and the body sticks out into the screen.
function orient(pixels, o) {
  if (o === 'wallR') return pixels.map((p) => ({ ...p, x: p.y, y: -p.x - 1 }));
  if (o === 'wallL') return pixels.map((p) => ({ ...p, x: -p.y - 1, y: p.x }));
  if (o === 'ceil') return pixels.map((p) => ({ ...p, x: -p.x - 1, y: -p.y - 1 }));
  return pixels;
}

function sprite(anim, f, look, flip, o, s) {
  return memo(`s|${anim}|${f}|${lookKey(look)}|${flip ? 1 : 0}|${o}|${s}`, () => {
    const fr = Clawd.frame(anim, f, look, flip);
    const r = raster(orient(fr.pixels, o), s);
    r.hit = fr.hit; r.head = fr.head;
    return r;
  });
}

/** The same sprite as a hologram: bright cyan outline over a faint, scan-lined fill. */
function holoSprite(anim, f, look, flip, s) {
  return memo(`h|${anim}|${f}|${lookKey(look)}|${flip ? 1 : 0}|${s}`, () => {
    const px = Clawd.frame(anim, f, look, flip).pixels;
    const at = new Set(px.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    const has = (x, y) => at.has(`${x},${y}`);
    const out = px.map((p) => {
      const x = Math.round(p.x), y = Math.round(p.y);
      const edge = !has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1);
      return { x, y, c: edge ? CY2 : CY, a: edge ? 1 : y % 2 ? 0.22 : 0.5 };
    });
    return raster(out, s);
  });
}

const bubbleSprite = (kind, s) => memo(`b|${kind}|${s}`, () => raster(Clawd.bubble(kind).pixels, bubbleScale(s)));
const tagSprite = (name, s) => memo(`t|${name}|${s}`, () => raster(Clawd.text(name).pixels, tagScale(s), '#f6e9df'));
const textSprite = (str, s, colour) => memo(`x|${str}|${s}|${colour}`, () => raster(Clawd.text(str).pixels, s, colour));
const itemSprite = (kind, s) => memo(`i|${kind}|${s}`, () => raster(Clawd.item(kind).pixels, s));

/** Draw a sprite with its anchor at (x, y) in DIPs, pixel-exact. */
function blit(sp, x, y, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp.cv, Math.round(x * dpr + sp.oxd), Math.round(y * dpr + sp.oyd));
}

/** Same, stretched taller from the feet up (gulping several rows at once). */
function blitTall(sp, x, y, stretch, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp.cv, Math.round(x * dpr + sp.oxd), Math.round(y * dpr + sp.oyd * stretch), sp.cv.width, Math.round(sp.cv.height * stretch));
}

/** Draw a sprite so its bottom-centre sits at (x, y). */
function blitBase(sp, x, y, alpha = 1) { blit(sp, x - sp.ox - sp.w / 2, y - sp.oy - sp.h, alpha); }

const frameOf = (b, elapsed) => {
  const n = Clawd.frameCount(b.anim);
  return b.fo !== undefined ? b.fo % n : Math.floor(((b.t + elapsed) / 1000) * Clawd.fps(b.anim)) % n;
};

// ---------------------------------------------------------------- drawing helpers
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  cache.clear();
}
window.addEventListener('resize', resize);

const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const dip = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
const dev = () => ctx.setTransform(1, 0, 0, 1, 0, 0);

function brackets(x, y, w, h, len, th, colour, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.fillRect(Math.round(sx > 0 ? cx : cx - len), Math.round(sy > 0 ? cy : cy - th), len, th);
    ctx.fillRect(Math.round(sx > 0 ? cx : cx - th), Math.round(sy > 0 ? cy : cy - len), th, len);
  }
}

function pixelText(str, x, y, s, colour, alpha = 1, bg = null) {
  const sp = textSprite(str, s, colour);
  if (bg) { dip(); ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = bg; ctx.fillRect(Math.round(x - 4), Math.round(y - 4), sp.w + 8, sp.h + 8); dev(); }
  blit(sp, x - sp.ox, y - sp.oy, alpha);
  return sp;
}

// ---------------------------------------------------------------- the build (birth)
function buildGeom(b) {
  const B = b.birth, big = B.big;
  const sp = sprite('idle', 0, b.look, false, 'floor', big);
  const feet = B.y + (11.5 * big) / 2 - origin.y, cx = B.x - origin.x;
  return { cx, feet, left: cx + sp.ox, top: feet + sp.oy, w: sp.w, h: sp.h, big, mid: feet + sp.oy + sp.h / 2 };
}
const buildT = (b, elapsed) => b.birth.t + elapsed;

/** Behind the buddy: targeting brackets, the beam from the Overlord's eye, the pad and the scan grid. */
function drawBuildBack(b, elapsed) {
  const t = buildT(b, elapsed), g = buildGeom(b), ov = overlord;
  dip();
  if (t < BUILD.print) {
    const k = Math.min(1, t / BUILD.arrive), m = 70 * (1 - k) ** 2 + 12;
    const a = Math.min(1, t / 250) * (t > BUILD.holo ? Math.max(0.3, 1 - (t - BUILD.holo) / 900) : 1) * (Math.sin(t / 60) > -0.8 ? 1 : 0.4);
    brackets(g.left - m, g.top - m, g.w + 2 * m, g.h + 2 * m, Math.max(10, g.big * 2), Math.max(2, Math.round(g.big / 4)), CY2, a);
  }
  if (ov && t >= BUILD.arrive && t < BUILD.leave) {
    const k = clamp((t - BUILD.arrive) / 500, 0, 1) * (t > BUILD.power ? Math.max(0, 1 - (t - BUILD.power) / 400) : 1);
    const ex = ov.x - origin.x, ey = ov.y - origin.y, half = (g.w / 2 + 16) * k, L = g.feet - ey;
    const flick = 0.78 + 0.22 * Math.sin(t / 37) * Math.sin(t / 91);
    const grad = ctx.createLinearGradient(0, ey, 0, g.feet);
    grad.addColorStop(0, 'rgba(158,234,255,0.55)');
    grad.addColorStop(1, 'rgba(63,208,255,0.12)');
    ctx.globalAlpha = k * flick;
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(ex - 4, ey); ctx.lineTo(ex + 4, ey); ctx.lineTo(g.cx + half, g.feet); ctx.lineTo(g.cx - half, g.feet); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.6 * k;
    ctx.strokeStyle = CY2; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ex - 4, ey); ctx.lineTo(g.cx - half, g.feet); ctx.moveTo(ex + 4, ey); ctx.lineTo(g.cx + half, g.feet); ctx.stroke();
    // Energy bands flowing down the beam.
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
      const u = ((t / 900) + i / 6) % 1, yy = ey + L * u, hw = 4 + (half - 4) * u, xx = ex + (g.cx - ex) * u;
      ctx.globalAlpha = 0.35 * k * (1 - u * 0.5);
      ctx.fillRect(Math.round(xx - hw), Math.round(yy), Math.round(hw * 2), 2);
    }
  }
  if (t >= 500 && t < BUILD.drop + 1200) {
    const a = clamp((t - 500) / 400, 0, 1) * (t > BUILD.leave ? Math.max(0, 1 - (t - BUILD.leave) / 1800) : 1);
    const rx = g.w * 0.62, ry = Math.max(6, rx * 0.16), p = Math.max(2, Math.round(g.big / 3));
    ctx.globalAlpha = a * 0.16;
    ctx.fillStyle = CY;
    ctx.beginPath(); ctx.ellipse(g.cx, g.feet, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    const n = 40;
    for (let i = 0; i < n; i++) {
      if ((i + Math.floor(t / 90)) % 5 === 0) continue;
      const ang = (i / n) * Math.PI * 2;
      ctx.globalAlpha = a * (Math.sin(ang) > 0 ? 0.95 : 0.55);
      ctx.fillStyle = i % 5 === 1 ? '#ffffff' : CY2;
      ctx.fillRect(Math.round(g.cx + Math.cos(ang) * rx - p / 2), Math.round(g.feet + Math.sin(ang) * ry - p / 2), p, p);
    }
  }
  if (t >= BUILD.beam && t < BUILD.print) {
    const reveal = clamp((t - BUILD.beam) / 400, 0, 1);
    const a = (t > BUILD.holo ? Math.max(0.12, 1 - (t - BUILD.holo) / 1500) : 1) * 0.42;
    const step = Math.max(6, g.big * 2), x0 = g.left - step, x1 = g.left + g.w + step, yTop = g.feet - (g.h + step) * reveal;
    ctx.fillStyle = CY;
    ctx.globalAlpha = a * 0.6;
    for (let x = x0; x <= x1; x += step) ctx.fillRect(Math.round(x), Math.round(yTop), 1, Math.round(g.feet - yTop));
    for (let y = g.feet; y >= yTop; y -= step) ctx.fillRect(Math.round(x0), Math.round(y), Math.round(x1 - x0), 1);
    ctx.globalAlpha = a * 1.6;
    ctx.fillStyle = CY2;
    for (let x = x0; x <= x1; x += step) for (let y = g.feet; y >= yTop; y -= step) ctx.fillRect(Math.round(x - 1), Math.round(y - 1), 3, 3);
  }
  ctx.globalAlpha = 1;
  dev();
}

/** The buddy itself while it is being printed: solid below the print line, hologram above. */
function drawBuildBody(b, sp, x, y, elapsed) {
  const t = buildT(b, elapsed);
  if (t < BUILD.holo) return;
  const p = clamp((t - BUILD.holo) / (BUILD.print - BUILD.holo), 0, 1);
  const top = y + sp.oy, lineY = Math.round((top + sp.h - sp.h * p) * dpr);
  const hs = holoSprite(b.anim, frameOf(b, elapsed), b.look, b.flip, b.s);
  const fresh = t - BUILD.holo < 300;
  const glitch = Math.sin(t / 23) * Math.sin(t / 71) > 0.82 ? Math.round((hash(Math.floor(t / 50)) - 0.5) * b.s * 3) : 0;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, canvas.width, lineY); ctx.clip();
  if (!fresh || Math.random() > 0.45) blit(hs, x + glitch, y, (0.8 + 0.2 * Math.sin(t / 60)) * b.alpha);
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(0, lineY, canvas.width, canvas.height - lineY); ctx.clip();
  blit(sp, x, y, b.alpha);
  ctx.restore();
}

/** In front: scan line, print head, voxels flying from the eye, sparks, the power-on flash and debris. */
function drawBuildFront(b, elapsed) {
  const t = buildT(b, elapsed), g = buildGeom(b), ov = overlord;
  const ts = Math.max(2, Math.round(g.big / 5));
  dip();
  if (t >= BUILD.beam && t < BUILD.holo) {
    const k = (t - BUILD.beam) / (BUILD.holo - BUILD.beam), u = k < 0.5 ? k * 2 : 2 - k * 2;
    const yy = g.feet - (g.h + 10) * u;
    const grad = ctx.createLinearGradient(0, yy - 14, 0, yy + 14);
    grad.addColorStop(0, 'rgba(63,208,255,0)'); grad.addColorStop(0.5, 'rgba(158,234,255,0.45)'); grad.addColorStop(1, 'rgba(63,208,255,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = grad;
    ctx.fillRect(Math.round(g.left - 18), Math.round(yy - 14), Math.round(g.w + 36), 28);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(g.left - 18), Math.round(yy - 1), Math.round(g.w + 36), 2);
  }
  if (t >= BUILD.holo && t < BUILD.print) {
    const p = clamp((t - BUILD.holo) / (BUILD.print - BUILD.holo), 0, 1), lineY = g.feet - g.h * p;
    const grad = ctx.createLinearGradient(0, lineY - 10, 0, lineY + 10);
    grad.addColorStop(0, 'rgba(255,225,46,0)'); grad.addColorStop(0.5, 'rgba(255,240,170,0.5)'); grad.addColorStop(1, 'rgba(255,225,46,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = grad;
    ctx.fillRect(Math.round(g.left - 10), Math.round(lineY - 10), Math.round(g.w + 20), 20);
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(Math.round(g.left - 10), Math.round(lineY - 1), Math.round(g.w + 20), 2);
    const hx = g.left + g.w * (0.5 + 0.5 * Math.sin(t / 95));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(hx - 4), Math.round(lineY - 5), 8, 10);
    // Voxels streaming from the Overlord's eye to the print line.
    const vs = Math.max(2, Math.round(g.big * 0.55));
    const ex = ov ? ov.x - origin.x : g.cx, ey = ov ? ov.y - origin.y : g.top - 200;
    for (let i = 0; i < 18; i++) {
      const ph = (t / 430 + hash(i)) % 1, e = ph * ph;
      const tx = g.left + Math.round(hash(i + 7 + Math.floor(t / 430 + hash(i))) * g.w);
      ctx.globalAlpha = 0.9 * Math.min(1, ph * 4);
      ctx.fillStyle = i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? CY2 : b.look.body || '#d97757';
      ctx.fillRect(Math.round(ex + (tx - ex) * e - vs / 2), Math.round(ey + (lineY - ey) * e - vs / 2), vs, vs);
    }
    // Sparks where the print head lays down pixels.
    const ss = Math.max(2, Math.round(g.big / 3)), tick = Math.floor(t / 70);
    for (let i = 0; i < 10; i++) {
      const r = hash(i * 13 + tick * 7), sx = hx + (r - 0.5) * g.big * 6, sy = lineY - hash(i * 3 + tick) * g.big * 2;
      ctx.globalAlpha = 0.6 + 0.4 * hash(i + tick);
      ctx.fillStyle = i % 2 ? '#ffe12e' : '#ffffff';
      ctx.fillRect(Math.round(sx), Math.round(sy), ss, ss);
    }
    dev();
    pixelText(`PRINTING ${String(Math.round(p * 100)).padStart(2, ' ')}%`, g.left + g.w + 18, lineY - 3 * ts, ts, CY2, 0.95);
    dip();
  }
  if (t >= BUILD.beam && t < BUILD.holo) { dev(); pixelText('SCANNING', g.left + g.w + 18, g.mid - 3 * ts, ts, CY2, Math.sin(t / 90) > -0.3 ? 0.95 : 0.4); dip(); }
  if (t >= BUILD.print && t < BUILD.print + 700) {
    const k = (t - BUILD.print) / 700, r = g.h * (0.8 + k * 1.4);
    const grad = ctx.createRadialGradient(g.cx, g.mid, 0, g.cx, g.mid, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.4, 'rgba(158,234,255,0.5)'); grad.addColorStop(1, 'rgba(63,208,255,0)');
    ctx.globalAlpha = (1 - k) * 0.9; ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(g.cx, g.mid, r, 0, Math.PI * 2); ctx.fill();
  }
  for (const delay of [0, 170, 340]) {
    const tt = t - BUILD.print - delay;
    if (tt < 0 || tt >= 950) continue;
    const k = tt / 950, r = g.h * 0.6 + k * g.h * 3.2;
    ctx.globalAlpha = (1 - k) * 0.85;
    ctx.strokeStyle = delay === 170 ? '#ffffff' : CY2;
    ctx.lineWidth = Math.max(1.5, (g.big / 2) * (1 - k));
    ctx.beginPath(); ctx.ellipse(g.cx, g.mid, r, r * 0.85, 0, 0, Math.PI * 2); ctx.stroke();
  }
  if (t >= BUILD.print && t < BUILD.effects) {
    const tt = (t - BUILD.print) / 1000, colours = ['#ffffff', CY, b.look.body || '#d97757', '#ffe12e', CY2];
    for (let i = 0; i < 46; i++) {
      const ang = hash(i) * Math.PI * 2, speed = 220 + hash(i + 99) * 650;
      const x = g.cx + Math.cos(ang) * speed * tt, y = g.mid + (Math.sin(ang) * speed - 420) * tt + 0.5 * 1300 * tt * tt;
      const a = Math.max(0, 1 - tt / 3.2);
      if (a <= 0) continue;
      const sz = Math.max(2, Math.round(g.big / (i < 10 ? 1.6 : 2.8)));
      ctx.globalAlpha = a * (i % 7 === 0 && Math.sin(t / 50 + i) < 0 ? 0.3 : 1);
      ctx.fillStyle = colours[i % colours.length];
      ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
  }
  if (t >= BUILD.print + 150 && t < BUILD.power + 250) { // gone before the buddy holds up its welcome sign
    dev();
    const sp = textSprite('ONLINE', ts + 1, '#9fe0b8');
    blit(sp, g.cx - sp.w / 2 - sp.ox, g.top - sp.h - 28 - sp.oy, Math.floor(t / 140) % 4 === 0 ? 0.35 : 1);
    dip();
  }
  ctx.globalAlpha = 1;
  dev();
}

// ---------------------------------------------------------------- the usage limit: alarm, pit, beams, verdicts
const DOOM_LOUD = ['alert', 'arrive', 'portal', 'grab'];
const RESCUE = ['rise-arrive', 'rise-portal', 'rise', 'review', 'close'];
function clockTime(iso) {
  const at = Date.parse(iso || '');
  if (!at) return '';
  const d = new Date(at), far = at - Date.now() > 20 * 3600e3;
  return d.toLocaleString(undefined, far ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' }).toUpperCase();
}

function drawVignette(D, t) {
  if (!DOOM_LOUD.includes(D.phase)) return;
  const pulse = D.phase === 'alert' ? (Math.floor(t / 180) % 2 ? 0.55 : 0.25) : 0.22 + 0.1 * Math.sin(t / 260);
  dip();
  const w = innerWidth, h = innerHeight, g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(255,0,0,0)');
  g.addColorStop(1, `rgba(255,20,10,${pulse})`);
  ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  dev();
}

function drawBanner(D, t) {
  let a = 0, l1 = '', l2 = '', c1 = '#ff3b30';
  const until = clockTime(D.resetsAt);
  if (DOOM_LOUD.includes(D.phase)) { a = 1; l1 = D.kind === 'week' ? 'WEEKLY LIMIT REACHED' : 'SESSION LIMIT REACHED'; l2 = until ? `ALL BUDDIES BANISHED UNTIL ${until}` : 'ALL BUDDIES BANISHED'; }
  else if (D.phase === 'seal') { a = Math.max(0, 1 - t / 1400); l1 = D.kind === 'week' ? 'WEEKLY LIMIT REACHED' : 'SESSION LIMIT REACHED'; l2 = until ? `BACK AT ${until}` : ''; }
  else if (RESCUE.includes(D.phase) && D.phase !== 'close') { a = 1; l1 = 'LIMIT RESET'; l2 = 'THE OVERLORD REVIEWS YOUR BUDDIES'; c1 = '#9eeaff'; }
  else if (D.phase === 'close') { a = Math.max(0, 1 - t / 1200); l1 = 'LIMIT RESET'; c1 = '#9eeaff'; }
  if (a <= 0 || !l1) return;
  const s1 = clamp(Math.floor((innerWidth * 0.6) / (l1.length * 4)), 3, 10), s2 = Math.max(2, Math.round(s1 / 2.5));
  const flash = D.phase === 'alert' && Math.floor(t / 180) % 2 ? '#ffffff' : c1;
  const sp1 = textSprite(l1, s1, flash), y1 = Math.round(innerHeight * 0.07) + 3 * s1;
  dip();
  ctx.globalAlpha = 0.82 * a; ctx.fillStyle = '#120404';
  ctx.fillRect(Math.round(innerWidth / 2 - sp1.w / 2 - 3 * s1), y1 - 3 * s1, Math.round(sp1.w + 6 * s1), Math.round(sp1.h + 6 * s1 + (l2 ? 9 * s2 : 0)));
  ctx.globalAlpha = a; ctx.fillStyle = c1;
  ctx.fillRect(Math.round(innerWidth / 2 - sp1.w / 2 - 3 * s1), y1 - 3 * s1, Math.round(sp1.w + 6 * s1), Math.max(2, s2));
  dev();
  blit(sp1, innerWidth / 2 - sp1.w / 2 - sp1.ox, y1 - sp1.oy, a);
  if (l2) { const sp2 = textSprite(l2, s2, '#ffd0c4'); blit(sp2, innerWidth / 2 - sp2.w / 2 - sp2.ox, y1 + sp1.h + 3 * s2 - sp2.oy, a); }
}

/** The pit: a glowing hole in the floor full of pixel flames (a smouldering crack while sealed). */
function drawPit(D, t, front) {
  const x = D.pit.x - origin.x, y = D.pit.y - origin.y;
  if (x < -500 || x > innerWidth + 500 || D.open <= 0.01) return;
  const rx = Math.max(8, D.pit.w * D.open), ry = Math.max(3, rx * 0.26), p = Math.max(2, Math.round(D.pit.w / 22));
  const flameCol = ['#fff3a0', '#ffd23a', '#ff9a1a', '#ff5a1a', '#d42300', '#7a0d00'];
  dip();
  if (!front) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx * 2.6);
    g.addColorStop(0, `rgba(255,110,30,${0.5 * Math.min(1, D.open * 1.5)})`); g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y - rx * 0.4, rx * 2.6, rx * 1.7, 0, 0, Math.PI * 2); ctx.fill();
    const h = ctx.createRadialGradient(x, y, 0, x, y, rx);
    h.addColorStop(0, '#ffe066'); h.addColorStop(0.35, '#ff6a00'); h.addColorStop(0.75, '#8a0d00'); h.addColorStop(1, '#1a0200');
    ctx.fillStyle = h; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Flames: columns of pixels licking up out of the hole (the front ones over the buddies falling in).
  const cols = Math.floor((2 * rx) / p);
  for (let i = 0; i < cols; i++) {
    const fx = x - rx + i * p, u = (fx + p / 2 - x) / rx, edge = 1 - u * u;
    if (edge <= 0) continue;
    if (front !== (i % 3 === 0)) continue;
    const flick = 0.55 + 0.45 * Math.sin(t / 85 + i * 1.7) * Math.sin(t / 133 + i * 0.9);
    const hgt = Math.round(((rx * 0.95 * Math.sqrt(edge) * flick * Math.min(1, D.open * 1.3)) / p)) * p;
    const base = y + ry * Math.sqrt(edge) * (front ? 0.6 : -0.3);
    for (let k = 0; k < hgt; k += p) {
      const f = k / Math.max(p, hgt);
      ctx.globalAlpha = f > 0.8 ? 0.55 : 0.92;
      ctx.fillStyle = flameCol[Math.min(flameCol.length - 1, Math.floor(f * flameCol.length))];
      ctx.fillRect(Math.round(fx), Math.round(base - k - p), p, p);
    }
  }
  if (!front) {
    // Embers drifting up.
    for (let i = 0; i < 26; i++) {
      const life = ((t / 1000) * (40 + hash(i) * 50) + hash(i + 3) * 260) % 260;
      const ex = x + (hash(i + 7) - 0.5) * rx * 1.8 + Math.sin(t / 400 + i) * 6, ey = y - life;
      ctx.globalAlpha = Math.max(0, 1 - life / 260) * Math.min(1, D.open * 3);
      ctx.fillStyle = i % 3 ? '#ffb020' : '#ffef8a';
      const sz = Math.max(1, Math.round(p * (i % 2 ? 0.5 : 1)));
      ctx.fillRect(Math.round(ex), Math.round(ey), sz, sz);
    }
  }
  ctx.globalAlpha = 1;
  dev();
}

function drawBeams(D, t) {
  const o = overlord;
  if (!o) return;
  const ex = o.x - origin.x, ey = o.y - origin.y;
  dip();
  if (D.beam) {
    // A crackling red tractor beam.
    const bx = D.beam.x - origin.x, by = D.beam.y - origin.y, n = 9;
    for (const [w, c, a] of [[7, '#ff3b30', 0.35], [3, '#ff5a3a', 0.9], [1.5, '#ffffff', 0.95]]) {
      ctx.globalAlpha = a * (0.75 + 0.25 * Math.sin(t / 30)); ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(ex, ey);
      for (let i = 1; i < n; i++) {
        const k = i / n, j = (hash(i * 31 + Math.floor(t / 45)) - 0.5) * 16;
        ctx.lineTo(ex + (bx - ex) * k + j, ey + (by - ey) * k + j * 0.4);
      }
      ctx.lineTo(bx, by); ctx.stroke();
    }
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, 40);
    g.addColorStop(0, 'rgba(255,80,50,0.55)'); g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, 40, 0, Math.PI * 2); ctx.fill();
  }
  if (D.review) {
    // A cyan scanning cone, a scan line sweeping down the buddy.
    const rx = D.review.x - origin.x, ry = D.review.y - origin.y, half = 34;
    const grad = ctx.createLinearGradient(0, ey, 0, ry + half);
    grad.addColorStop(0, 'rgba(158,234,255,0.5)'); grad.addColorStop(1, 'rgba(63,208,255,0.12)');
    ctx.globalAlpha = 0.85; ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(ex - 3, ey); ctx.lineTo(ex + 3, ey); ctx.lineTo(rx + half, ry + half); ctx.lineTo(rx - half, ry + half); ctx.closePath(); ctx.fill();
    const sy = ry - half + 2 * half * D.review.k;
    ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(rx - half - 6), Math.round(sy), Math.round(2 * half + 12), 2);
  }
  ctx.globalAlpha = 1;
  dev();
}

/** RESUME / OK stamps over each reviewed buddy. */
function drawVerdicts(D, elapsed) {
  if (!D.verdicts || !['review', 'close'].includes(D.phase)) return;
  for (const b of buddies) {
    const v = D.verdicts[b.id];
    if (!v || !b._sp) continue;
    const s = tagScale(b.s) + 1, sp = textSprite(v === 'resume' ? 'RESUME' : 'OK', s, v === 'resume' ? '#1f1e1d' : '#0f2a18');
    const x = b.x - origin.x, y = b.y - origin.y + b._sp.oy - sp.h - 10 * s;
    dip();
    ctx.globalAlpha = 1; ctx.fillStyle = v === 'resume' ? '#ffb020' : '#5fd38d';
    ctx.fillRect(Math.round(x - sp.w / 2 - 2 * s), Math.round(y - 2 * s), Math.round(sp.w + 4 * s), Math.round(sp.h + 4 * s));
    dev();
    blit(sp, x - sp.w / 2 - sp.ox, y - sp.oy, 1);
  }
}

// ---------------------------------------------------------------- the Overlord
function ovSprite(o, t, s, opts = {}) {
  const tq = Math.floor(t / 120) % 105;
  const q = (v) => Math.round((v || 0) * 4) / 4;
  const lx = q(o.lookX), ly = q(o.lookY), bl = q(o.blink), red = !!(overlord && overlord.red);
  return memo(`o|${tq}|${lx}|${ly}|${bl}|${s}|${opts.fins === false ? 0 : 1}|${opts.cables === false ? 0 : 1}|${red ? 1 : 0}`, () =>
    raster(Clawd.overlord({ t: tq * 120, lookX: lx, lookY: ly, blink: bl, red, ...opts }).pixels, s));
}

/** Where the corner socket and the peeking eye are on this monitor. */
function ovGeom(o) {
  const ps = Math.max(2, Math.round(o.s * 0.6));
  const hx = o.home.x - origin.x, top = o.home.y - origin.y;
  const out = o.mode === 'fused' && o.peek ? o.peek.out : 0;
  const cy = top - 12 * ps + out * 20 * ps; // fully out: the whole eye clears the seam
  return { ps, hx, top, cy, out, bottom: cy + 11 * ps };
}

function socketPixels(lit) {
  const P = Clawd.OV, px = [];
  for (const x0 of [-16, 11]) {
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const edge = x === 0 || x === 4 || y === 4;
      let c = edge ? P.K : y === 0 ? P.h : P.m;
      if (!edge && y === 2 && x === 2) c = lit ? P.o : P.O;
      px.push({ x: x0 + x, y, c });
    }
  }
  for (let x = -12; x <= 10; x++) { px.push({ x, y: 0, c: P.K }); px.push({ x, y: 1, c: x % 4 === 0 ? P.l : P.d }); }
  return px;
}

/** Does this monitor's top edge face outward (no other monitor right above it)? */
function topDisplay(o) {
  const me = o.displays.find((d) => d.x === origin.x && d.y === origin.y);
  if (!me) return true;
  return !o.displays.some((d) => d !== me && Math.abs(d.y + d.h - me.y) <= 2 && d.x < me.x + me.w && d.x + d.w > me.x);
}

/** The Overlord fused into the top edge: a thin mechanical seam with light running along it. */
function drawSeam(o, t) {
  const k = Math.max(1, Math.round(dpr)), W = canvas.width, P = Clawd.OV;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = P.K; ctx.fillRect(0, 0, W, k);
  ctx.fillStyle = P.d; ctx.fillRect(0, k, W, k);
  ctx.fillStyle = P.l;
  const step = Math.round(48 * dpr), off = ((Math.round(-origin.x * dpr) % step) + step) % step;
  for (let x = off; x < W; x += step) ctx.fillRect(x, k, k, k);
  // A pulse of light travels across every screen, starting from the Overlord's corner.
  const minX = Math.min(...o.displays.map((d) => d.x)), maxX = Math.max(...o.displays.map((d) => d.x + d.w));
  const span = maxX - minX + 400, head = minX - 200 + ((t / 1000) * 420) % span;
  for (let i = 0; i < 24; i++) {
    const x = Math.round((head - origin.x - i * 4) * dpr);
    if (x < -k || x > W) continue;
    ctx.globalAlpha = (1 - i / 24) * 0.95;
    ctx.fillStyle = i < 3 ? '#ffffff' : CY;
    ctx.fillRect(x, k, Math.max(k, Math.round(3 * dpr)), k);
  }
  ctx.globalAlpha = 1;
}

function drawGlitch(sp, x, y, k) {
  const band = Math.max(2, Math.round(sp.cv.height / 12)), now = performance.now();
  for (let sy = 0; sy < sp.cv.height; sy += band) {
    if (hash(sy * 7 + Math.floor(now / 60)) > 0.25 + k * 0.85) continue;
    const off = Math.round((hash(sy + Math.floor(now / 45)) - 0.5) * (1 - k) * 70 * dpr), h = Math.min(band, sp.cv.height - sy);
    ctx.globalAlpha = 0.35 + 0.65 * k;
    ctx.drawImage(sp.cv, 0, sy, sp.cv.width, h, Math.round(x * dpr + sp.oxd) + off, Math.round(y * dpr + sp.oyd) + sy, sp.cv.width, h);
  }
  // The column of light it beams down in.
  dip();
  const r = sp.w * 0.5 * (1 - k * 0.7);
  const grad = ctx.createLinearGradient(x - r, 0, x + r, 0);
  grad.addColorStop(0, 'rgba(63,208,255,0)'); grad.addColorStop(0.5, 'rgba(225,250,255,0.75)'); grad.addColorStop(1, 'rgba(63,208,255,0)');
  ctx.globalAlpha = 1 - k; ctx.fillStyle = grad;
  ctx.fillRect(Math.round(x - r), 0, Math.round(r * 2), Math.round(y));
  dev();
}

function drawOverlord(o, elapsed) {
  const t = o.t + elapsed, g = ovGeom(o), hovered = hoverId === 'overlord';
  if (o.mode === 'fused') {
    if (g.out > 0) {
      const pk = o.peek;
      blit(ovSprite({ lookX: pk.lookX, lookY: pk.lookY, blink: pk.blink }, t, g.ps, { fins: false, cables: false }), g.hx, g.cy, 1);
    }
  } else {
    const x = o.x - origin.x, y = o.y - origin.y;
    // A soft anti-gravity glow underneath.
    dip();
    const r = 15 * o.s, grad = ctx.createRadialGradient(x, y + 12 * o.s, 0, x, y + 12 * o.s, r);
    grad.addColorStop(0, `rgba(63,208,255,${hovered ? 0.35 : 0.22})`); grad.addColorStop(1, 'rgba(63,208,255,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y + 12 * o.s, r, 0, Math.PI * 2); ctx.fill();
    dev();
    const bob = o.mode === 'detached' ? Math.round(Math.sin(t / 420) * o.s * 0.6) : 0;
    const sp = ovSprite(o, t, o.s);
    const m = o.materialize === null ? Infinity : o.materialize + elapsed;
    if (o.hidden) { /* blown to bits for a moment (boss fight) */ }
    else if (m < 1100) drawGlitch(sp, x, y, m / 1100);
    else blit(sp, x, y + bob, 1);
  }
  fxSafe(() => drawUsageRing(o, g));
  if (topDisplay(o)) drawSeam(o, t);
  blit(memo(`sock|${g.ps}|${hovered ? 1 : Math.floor(t / 600) % 2}`, () => raster(socketPixels(hovered || Math.floor(t / 600) % 2 === 1), g.ps)), g.hx, g.top, 1);
}

function hitOverlord(mx, my) {
  const o = overlord;
  if (!o) return false;
  if (o.mode === 'fused') {
    const g = ovGeom(o);
    return Math.abs(mx - g.hx) <= 14 * g.ps && my >= g.top - 2 && my <= Math.max(g.top + 6 * g.ps, g.bottom);
  }
  return Math.hypot(mx - (o.x - origin.x), my - (o.y - origin.y)) <= 13 * o.s;
}

// ---------------------------------------------------------------- the skyscraper
// One floor per buddy: lit when it's home, dark while it's out at work. A glass elevator on the
// right carries buddies up and down; it all sinks into the ground when you collapse it.
const TW = Clawd.TOWER;
const TC = {
  face: '#4a4458', dark: '#38333f', light: '#5d5770', slab: '#2b2733', frame: '#1d1a24', glass: '#9ad7f0', rail: '#6b7a8f',
  car: '#c9d1d9', carDark: '#8a95a8', door: '#6b4a2e', doorOpen: '#17131d', sign: '#ffc431', plate: '#d9d4c7', ledOn: '#5fd38d', ledOff: '#6b6560',
};

/** Where everything is on this monitor (DIPs), or null if the tower isn't here. */
function towerGeo(T) {
  if (!T || !T.floors) return null;
  const ts = T.ts, n = T.floors.length;
  const bx = T.x0 - origin.x, ground = T.ground - origin.y;
  if (bx > innerWidth || bx + TW.W * ts < 0 || ground < 0 || ground > innerHeight + 40) return null;
  const total = (TW.LOBBY + n * TW.FLOOR + TW.ROOF) * ts;
  const off = (1 - T.h) * (total - TW.PEEK * ts); // how far it has sunk into the ground
  const by = ground + off; // where the building's ground line is drawn
  const floorTop = (i) => by - (TW.LOBBY + (i + 1) * TW.FLOOR) * ts;
  const roofTop = by - total;
  return {
    ts, n, bx, ground, by, off, total, roofTop, floorTop,
    button: { x: bx + TW.BTN_X * ts, y: roofTop + 2 * ts, w: 8 * ts, h: 7 * ts },
    win: (i) => ({ x: bx + TW.WIN_X * ts, y: floorTop(i) + TW.WIN_Y * ts, w: TW.WIN_W * ts, h: TW.WIN_H * ts }),
    sw: (i) => ({ x: bx, y: floorTop(i) + 4 * ts, w: 5 * ts, h: 7 * ts }),
  };
}

const inBox = (r, x, y, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

/** What part of the tower is under the pointer: tower:toggle | tower:switch:<id> | tower:room:<id> | tower. */
function hitTower(mx, my) {
  const T = tower, g = towerGeo(T);
  if (!g || my > g.ground) return null;
  if (inBox(g.button, mx, my, 2)) return 'tower:toggle';
  const visibleTop = Math.max(g.roofTop, 0);
  if (mx < g.bx || mx > g.bx + TW.W * g.ts || my < visibleTop) return null;
  if (T.h < 0.98) return 'tower:toggle'; // sunk (or moving): the part that shows opens it
  for (let i = 0; i < g.n; i++) {
    const f = T.floors[i];
    if (inBox(g.sw(i), mx, my, 1)) return 'tower:switch:' + f.id;
    if (inBox(g.win(i), mx, my)) return 'tower:room:' + f.id;
  }
  return 'tower';
}

/** Where a buddy at home is in its room right now: it strolls to a new spot every few seconds. */
function roomSpot(id, now) {
  const seed = [...String(id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const lo = TW.WIN_X + 5, hi = TW.WIN_X + TW.WIN_W - 6, t = now + (seed % 9000), seg = Math.floor(t / 7000);
  const at = (n) => lo + hash(seed % 997 + n * 13.7) * (hi - lo);
  const k = Math.min(1, (t % 7000) / (Math.abs(at(seg) - at(seg - 1)) * 90 + 1)); // walks at about 11 art px a second
  return { x: Math.round(at(seg - 1) + (at(seg) - at(seg - 1)) * k), walking: k < 1 };
}

const roomSprite = (room, lit, ts) => memo(`room|${JSON.stringify(room || {})}|${lit ? 1 : 0}|${ts}`, () => raster(Clawd.roomPixels(room, lit), ts));
const miniSprite = (f, body, ts) => memo(`mini|${f}|${body}|${ts}`, () => raster(Clawd.mini(f, body).pixels, ts));

function drawTower(T) {
  const g = towerGeo(T);
  if (!g) return;
  const { ts, bx, by, n } = g, now = performance.now();
  // Everything is drawn on whole device pixels, k per art pixel, the same grid the room and
  // figure sprites are rasterised on (otherwise at 125% the rooms drift into the elevator shaft).
  const k = Math.max(1, Math.round(ts * dpr));
  const BX = Math.round(bx * dpr), BY = Math.round(by * dpr);
  const P = (x) => (BX + x * k) / dpr, Q = (y) => (BY + y * k) / dpr; // art pixel -> DIP, for blit()
  const R = (x, y, w, h, c, a = 1) => { ctx.globalAlpha = a; ctx.fillStyle = c; ctx.fillRect(BX + Math.round(x * k), BY + Math.round(y * k), Math.round(w * k), Math.round(h * k)); };
  const B = (sp, x, y) => blit(sp, P(x) - sp.ox, Q(y) - sp.oy, 1); // sprite whose own origin goes at art (x, y)
  const lobbyTop = -TW.LOBBY, top = -(TW.LOBBY + n * TW.FLOOR), roofTop = top - TW.ROOF;
  // Everything below the ground line is underground (sunk), so clip it away.
  ctx.save();
  dev();
  ctx.beginPath(); ctx.rect(0, 0, canvas.width, Math.round(g.ground * dpr)); ctx.clip();

  // The glass elevator shaft, ground to roof.
  R(TW.SHAFT_X, roofTop + 3, TW.SHAFT_W, -roofTop - 3, TC.glass, 0.16);
  R(TW.SHAFT_X, roofTop + 3, 1, -roofTop - 3, TC.rail);
  R(TW.SHAFT_X + TW.SHAFT_W - 1, roofTop + 3, 1, -roofTop - 3, TC.rail);
  for (let y = roofTop + 6; y < 0; y += 8) R(TW.SHAFT_X + 1, y, TW.SHAFT_W - 2, 1, TC.rail, 0.45);
  R(TW.SHAFT_X - 1, roofTop + 2, TW.SHAFT_W + 2, 2, TC.slab); // the winch housing on top

  // The building: body, floor slabs, a little shading.
  R(0, roofTop + 8, TW.BODY, -roofTop - 8, TC.face);
  R(0, roofTop + 8, 1, -roofTop - 8, TC.light);
  R(TW.BODY - 1, roofTop + 8, 1, -roofTop - 8, TC.dark);

  // Floors, bottom up.
  for (let i = 0; i < n; i++) {
    const f = T.floors[i], y0 = -(TW.LOBBY + (i + 1) * TW.FLOOR);
    R(0, y0 + TW.FLOOR - 2, TW.BODY, 2, TC.slab);
    R(TW.WIN_X - 1, y0 + TW.WIN_Y - 1, TW.WIN_W + 2, TW.WIN_H + 2, TC.frame);
    const room = roomSprite(f.room, f.lit, ts);
    blit(room, P(TW.WIN_X), Q(y0 + TW.WIN_Y), 1);
    // Its figure: strolling around its room, or walking between the room and the elevator.
    if (f.mini !== null && f.mini !== undefined) {
      const spot = roomSpot(f.id, now), m = f.mini, x = Math.round(spot.x + m * (TW.SHAFT_X + 4 - spot.x)), feet = y0 + TW.WIN_Y + TW.WIN_H - 2;
      const walking = (m > 0 && m < 1) || (m === 0 && spot.walking), fr = walking ? Math.floor(now / 140) % 2 : Math.floor(now / 900) % 2;
      const inRoom = x < TW.WIN_X + TW.WIN_W - 2;
      if (inRoom || x > TW.SHAFT_X + 1) {
        ctx.save(); ctx.beginPath();
        const clipX = inRoom ? TW.WIN_X : TW.SHAFT_X, clipW = inRoom ? TW.WIN_W : TW.SHAFT_W;
        ctx.rect(BX + clipX * k, BY + (y0 + TW.WIN_Y) * k, clipW * k, TW.WIN_H * k); ctx.clip();
        blit(miniSprite(fr, f.body, ts), P(x), Q(feet), 1);
        ctx.restore();
      }
    }
    // A warm glow spills out of lit windows.
    if (f.lit) R(TW.WIN_X, y0 + TW.WIN_Y + TW.WIN_H + 1, TW.WIN_W, 1, '#ffe7a0', 0.35);
    // The light switch: up (green) while the buddy is on, down while it's home.
    R(TW.SWITCH_X, y0 + 5, 3, 5, TC.plate);
    R(TW.SWITCH_X + 1, y0 + (f.on ? 6 : 7), 1, 2, '#3b3743');
    R(TW.SWITCH_X + 1, y0 + 4, 1, 1, f.on ? TC.ledOn : TC.ledOff, f.busy && Math.floor(now / 250) % 2 ? 0.3 : 1);
    if (hoverId === 'tower:switch:' + f.id || hoverId === 'tower:room:' + f.id) {
      const r = hoverId.startsWith('tower:switch') ? g.sw(i) : g.win(i);
      dip(); brackets(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 4 + ts, 2, '#ffc431', 0.95); dev();
    }
  }

  // Lobby: door, sign, glass front.
  R(0, lobbyTop, TW.BODY, TW.LOBBY, TC.dark);
  R(0, lobbyTop, TW.BODY, 1, TC.slab);
  R(TW.DOOR_X - 1, -TW.DOOR_H - 1, TW.DOOR_W + 2, TW.DOOR_H + 1, TC.frame);
  if (T.door) R(TW.DOOR_X, -TW.DOOR_H, TW.DOOR_W, TW.DOOR_H, TC.doorOpen);
  else {
    R(TW.DOOR_X, -TW.DOOR_H, TW.DOOR_W, TW.DOOR_H, TC.door);
    R(TW.DOOR_X + TW.DOOR_W / 2 - 1, -TW.DOOR_H, 1, TW.DOOR_H, TC.frame);
    R(TW.DOOR_X + 2, -Math.round(TW.DOOR_H / 2), 1, 1, TC.sign); R(TW.DOOR_X + TW.DOOR_W - 3, -Math.round(TW.DOOR_H / 2), 1, 1, TC.sign);
  }
  // A glass front for the lobby, in panes, with the sign above it.
  const glassL = TW.DOOR_X + TW.DOOR_W + 3, glassR = TW.BODY - 4;
  R(glassL, -9, glassR - glassL, 8, TC.frame);
  for (let x = glassL + 1; x < glassR - 1; x += 12) {
    const w = Math.min(11, glassR - 1 - x);
    R(x, -8, w, 6, TC.glass, 0.55);
    R(x + 1, -7, 3, 1, '#ffffff', 0.6);
  }
  const sign = textSprite('BUDDY HQ', ts, TC.sign), signW = Math.round(sign.w * dpr / k);
  B(sign, Math.round((glassL + glassR - signW) / 2), lobbyTop + 1);
  if (T.hidden > 0) B(textSprite(`+${T.hidden}`, ts, '#f6e9df'), 12, roofTop + 3);

  // Walking between the lobby door and the elevator.
  if (T.lobby) {
    const m = T.lobby.dir === 'in' ? T.lobby.k : 1 - T.lobby.k;
    const x = Math.round(TW.DOOR_X + TW.DOOR_W / 2 + m * (TW.SHAFT_X + 4 - TW.DOOR_X - TW.DOOR_W / 2));
    blit(miniSprite(Math.floor(now / 140) % 2, T.lobby.body, ts), P(x), Q(-1), 1);
  }

  // The elevator car. Its floor lines up with the rooms' floors (and the lobby's at the bottom).
  const f = T.car.f, carBottom = Math.round(f >= 0 ? -(TW.LOBBY + f * TW.FLOOR) - 5 : -1 + (f + 1) * (-TW.LOBBY - 4)), carTop = carBottom - 11;
  R(TW.SHAFT_X + TW.SHAFT_W / 2, roofTop + 4, 1, carTop - roofTop - 4, '#2f2f38', 0.8); // cable
  R(TW.SHAFT_X, carTop, TW.SHAFT_W, 11, TC.carDark);
  R(TW.SHAFT_X + 1, carTop + 1, TW.SHAFT_W - 2, 9, T.car.door ? '#3b3546' : TC.car);
  R(TW.SHAFT_X, carTop, TW.SHAFT_W, 1, '#ffffff', 0.5);
  if (T.car.rider) blit(miniSprite(Math.floor(now / 500) % 2, T.car.rider, ts), P(TW.SHAFT_X + 4), Q(carBottom - 1), 1);
  else if (!T.car.door) R(TW.SHAFT_X + 2, carTop + 2, TW.SHAFT_W - 4, 3, TC.glass, 0.6);

  // Roof: parapet, antenna with a blinking light, a water tank, a little garden, and the collapse button.
  R(-1, roofTop + 8, TW.BODY + 2, 2, TC.slab);
  R(TW.ANT_X, roofTop + 1, 1, 7, '#8d857e');
  R(TW.ANT_X - 2, roofTop + 7, 5, 1, '#8d857e');
  R(TW.ANT_X - 1, roofTop, 3, 1, Math.floor(now / 700) % 2 ? '#ff5a4e' : '#7a2a24');
  R(38, roofTop + 3, 9, 4, '#8b5a3c'); R(38, roofTop + 3, 9, 1, '#a8794f'); R(39, roofTop + 7, 1, 1, '#5a3a22'); R(45, roofTop + 7, 1, 1, '#5a3a22');
  for (let i = 0; i < 4; i++) { R(54 + i * 3, roofTop + 6, 2, 2, i % 2 ? '#3aa76d' : '#4fbf6a'); R(54 + i * 3, roofTop + 7, 2, 1, '#8b5a3c'); }
  const hot = hoverId === 'tower:toggle', btnY = roofTop + 2;
  R(TW.BTN_X - 1, btnY - 1, 10, 9, '#000000');
  R(TW.BTN_X, btnY, 8, 7, hot ? '#3fd0ff' : '#ffc431');
  R(TW.BTN_X, btnY, 8, 1, hot ? '#9eeaff' : '#ffe7a0');
  // ▼ collapses it, ▲ brings it up.
  const up = T.h < 0.5;
  for (let r = 0; r < 3; r++) {
    const w = up ? 1 + r * 2 : 5 - r * 2;
    R(TW.BTN_X + 4 - Math.ceil(w / 2), btnY + 2 + r, w, 1, '#1a1408');
  }
  ctx.restore();
  dev();

  // Hovering a floor: its name and what a click does.
  const hid = hoverId && hoverId.startsWith('tower:') ? hoverId.split(':') : null;
  if (hid && (hid[1] === 'switch' || hid[1] === 'room')) {
    const i = T.floors.findIndex((x) => x.id === hid[2]);
    const fl = T.floors[i];
    if (fl) {
      const ty = g.floorTop(i) + 2 * ts, tx = bx + TW.W * ts + 8;
      const what = hid[1] === 'room' ? 'CLICK TO DECORATE' : fl.busy ? 'ON THE WAY...' : fl.on ? 'CLICK: SEND HOME' : 'CLICK: GO TO WORK';
      pixelText(`${fl.name} - ${fl.status}`.toUpperCase().slice(0, 34), tx, ty, 2, '#f6e9df', 1, '#1f1e1d');
      pixelText(what, tx, ty + 16, 2, hid[1] === 'room' ? '#9eeaff' : '#ffc431', 1, '#1f1e1d');
    }
  } else if (hoverId === 'tower:toggle') {
    const ty = Math.max(8, g.button.y), tx = bx + TW.W * ts + 8;
    pixelText(T.h < 0.5 ? 'OPEN THE SKYSCRAPER' : 'TUCK IT AWAY', tx, ty, 2, '#f6e9df', 1, '#1f1e1d');
  }
}

// ---------------------------------------------------------------- being sick
function drawPuddles(P) {
  for (const q of P.puddles) {
    const k = q.s, x = q.x - origin.x, y = q.y - origin.y, rows = Math.min(3, 1 + Math.floor(q.v / 8));
    const w = Math.max(3, Math.round(q.w / k));
    const sink = q.sink * (rows + 1) * k;
    ctx.save();
    dev(); ctx.beginPath(); ctx.rect(0, 0, canvas.width, Math.round(y * dpr)); ctx.clip(); dip();
    ctx.globalAlpha = 1 - q.sink * 0.5;
    for (let r = 0; r < rows; r++) {
      const inset = r === 0 ? 0 : r === 1 ? 2 : 5, rw = w - inset * 2;
      if (rw <= 0) continue;
      ctx.fillStyle = r === rows - 1 ? '#c8d96f' : '#8db22c';
      ctx.fillRect(Math.round(x - (rw * k) / 2), Math.round(y - (r + 1) * k + sink), rw * k, k);
    }
    // Lumps.
    ctx.fillStyle = '#6f8f1f';
    for (let i = 0; i < Math.min(6, Math.floor(w / 5)); i++) {
      const lx = Math.floor(hash(q.seed + i) * (w - 2)) - Math.floor(w / 2) + 1;
      ctx.fillRect(Math.round(x + lx * k), Math.round(y - k + sink), k, k);
    }
    // The odd bubble.
    if (Math.floor(performance.now() / 400 + q.seed) % 5 === 0) {
      ctx.fillStyle = '#e4f0a8';
      ctx.fillRect(Math.round(x + (hash(q.seed + Math.floor(performance.now() / 2000)) - 0.5) * (w - 2) * k), Math.round(y - (rows + 1) * k + sink), k, k);
    }
    ctx.restore();
  }
  dev();
}

function drawDrops(P) {
  dip();
  for (const d of P.drops) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.c;
    ctx.fillRect(Math.round(d.x - origin.x - d.s), Math.round(d.y - origin.y - d.s), 2 * d.s, 2 * d.s);
  }
  dev();
}

// ---------------------------------------------------------------- speech bubbles
function wrapWords(text, max = 14) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(' ')) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** A white speech bubble with the text in the pixel font; its tail tip is at (tx, h + 2). */
function speechSprite(text, k) {
  return memo(`say|${text}|${k}`, () => {
    const lines = wrapWords(text), ink = '#2f2f38', paper = '#fffaf0', px = [];
    const w = Math.max(...lines.map((l) => l.length * 4 - 1)) + 6, h = lines.length * 6 + 4;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) continue; // rounded corners
      px.push({ x, y, c: x === 0 || y === 0 || x === w - 1 || y === h - 1 ? ink : paper });
    }
    const tx = Math.max(2, Math.floor(w / 2) - 2);
    px.push({ x: tx + 1, y: h - 1, c: paper }, { x: tx, y: h, c: ink }, { x: tx + 1, y: h, c: paper }, { x: tx + 2, y: h, c: ink }, { x: tx, y: h + 1, c: ink }, { x: tx + 1, y: h + 1, c: ink }, { x: tx, y: h + 2, c: ink });
    lines.forEach((l, i) => {
      const ox = Math.floor((w - (l.length * 4 - 1)) / 2);
      for (const p of Clawd.text(l).pixels) px.push({ x: ox + p.x, y: 3 + i * 6 + p.y, c: ink });
    });
    const r = raster(px, k);
    r.tipX = tx; r.tipY = h + 3;
    return r;
  });
}

function drawSpeech(b, sp, x, y) {
  const k = tagScale(b.s), bs = speechSprite(b.say, k);
  const headX = x, headTop = y + sp.oy;
  let left = headX - bs.tipX * bs.u, topY = headTop - bs.tipY * bs.u - 2;
  left = clamp(left, 4, innerWidth - bs.w - 4);
  topY = Math.max(4, topY);
  blit(bs, left - bs.ox, topY - bs.oy, b.alpha);
}

/** The Overlord's shows must never take the buddies down with them: draw them in isolation. */
let fxFailedAt = 0;
function fxSafe(fn) {
  try { fn(); } catch (err) {
    ctx.restore?.(); dev(); ctx.globalAlpha = 1;
    if (performance.now() - fxFailedAt > 60e3) { fxFailedAt = performance.now(); console.error('overlay fx', err); }
  }
}

// ---------------------------------------------------------------- the main loop
function draw() {
  requestAnimationFrame(draw);
  dev();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const elapsed = performance.now() - receivedAt;

  // File-dialog rows and icons the buddy has eaten: painted over with the list's own background.
  if (covers.length) {
    dip();
    for (const c of covers) {
      const x = c.x - origin.x, y = c.y - origin.y, w = c.w * c.p;
      ctx.globalAlpha = 1; ctx.fillStyle = c.color;
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(c.h));
      if (c.p < 1) { // a bitten edge
        const n = Math.max(3, Math.round(c.h / 5));
        for (let i = 0; i < n; i++) if (i % 2) ctx.fillRect(Math.floor(x + w), Math.floor(y + (i * c.h) / n), 3, Math.ceil(c.h / n));
      }
    }
    dev();
  }

  // "Come here" flags.
  for (const b of buddies) {
    if (!b.marker) continue;
    const mx = b.marker.x - origin.x, my = b.marker.y - origin.y, fs = Math.max(2, Math.round(b.s * 0.8));
    dip();
    const pulse = (performance.now() % 1200) / 1200;
    ctx.globalAlpha = 0.7 * (1 - pulse); ctx.strokeStyle = '#d97757'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(mx, my, 6 + pulse * 10 * fs, 2 + pulse * 3 * fs, 0, 0, Math.PI * 2); ctx.stroke();
    dev();
    blitBase(itemSprite('flag', fs), mx + 2 * fs, my, 1);
  }

  const dt = doom ? doom.t + elapsed : 0;
  if (doom) { drawVignette(doom, dt); drawPit(doom, performance.now(), false); }
  canvas.style.transform = doom && doom.phase === 'alert' ? `translate(${Math.round((Math.random() - 0.5) * 8)}px, ${Math.round((Math.random() - 0.5) * 6)}px)` : '';

  if (tower) drawTower(tower);
  if (puke) drawPuddles(puke);
  fxSafe(() => { if (fx) { drawWeatherBack(fx.weather); drawBossBack(fx.boss); } });

  for (const b of buddies) if (b.birth && b.birth.t + elapsed < BUILD.drop + 1200) drawBuildBack(b, elapsed);

  for (const it of items) blit(itemSprite(it.kind, it.s), it.x - origin.x, it.y - origin.y, it.a);

  for (const b of [...buddies].sort((a, c) => a.y - c.y)) {
    if (b.alpha <= 0) { b._sp = null; continue; }
    const x = b.x - origin.x, y = b.y - origin.y;

    for (const m of b.minis) {
      if (m.alpha <= 0) continue;
      blit(sprite(m.anim, frameOf(m, elapsed), m.look, m.flip, m.o, m.s), m.x - origin.x, m.y - origin.y, m.alpha);
    }

    const sp = sprite(b.anim, frameOf(b, elapsed), b.look, b.flip, b.o, b.s);
    b._sp = sp;
    if (b.birth && b.birth.t + elapsed < BUILD.print) { drawBuildBody(b, sp, x, y, elapsed); continue; }
    if (b.clipY !== undefined) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, canvas.width, Math.round((b.clipY - origin.y) * dpr)); ctx.clip(); }
    if (b.stretch) blitTall(sp, x, y, b.stretch, b.alpha);
    else blit(sp, x, y, b.alpha);
    if (b.clipY !== undefined) ctx.restore();
    if (b.reach) fxSafe(() => drawReach(b));
    if (b.soot > 0) {
      // Back from hell: sooty, smoking a little.
      const ss = memo(`soot|${b.anim}|${frameOf(b, elapsed)}|${lookKey(b.look)}|${b.flip ? 1 : 0}|${b.o}|${b.s}`, () => raster(orient(Clawd.frame(b.anim, frameOf(b, elapsed), b.look, b.flip).pixels, b.o), b.s, '#1a0f0c'));
      blit(ss, x, y, b.alpha * b.soot * 0.6);
      dip();
      for (let i = 0; i < 3; i++) {
        const life = ((performance.now() / 1000) * 30 + i * 18) % 54;
        ctx.globalAlpha = b.soot * 0.5 * (1 - life / 54); ctx.fillStyle = '#6b6560';
        const sz = Math.max(2, Math.round(b.s * (0.8 + i * 0.3)));
        ctx.fillRect(Math.round(x - 4 * b.s + i * 4 * b.s + Math.sin(life / 8 + i) * 3), Math.round(y + sp.oy - life), sz, sz);
      }
      dev();
    }

    if (b.say) drawSpeech(b, sp, x, y);
    else if (b.bubble) {
      const bs = bubbleSprite(b.bubble, b.s);
      const bob = b.bubble === '✓' ? 0 : Math.round(Math.sin(performance.now() / 160) * 2);
      const bx = b.o === 'floor' ? x + Math.max(sp.head.r * sp.u - 6, 4.5 * sp.u) : x + sp.ox + sp.w - 2;
      const by = y + sp.oy - bs.h - 2 + bob;
      blit(bs, bx - bs.ox, by - bs.oy, b.alpha);
    }

    // Name tag under the buddy, only while hovered.
    if (!b.hovered) continue;
    const tag = tagSprite(b.name, b.s);
    const cx = b.o === 'floor' ? x : x + sp.ox + sp.w / 2;
    const tx = Math.round(cx - tag.w / 2), ty = b.o === 'floor' ? y + 5 : y + sp.oy + sp.h + 5;
    dip();
    ctx.globalAlpha = b.alpha * 0.95;
    ctx.fillStyle = '#1f1e1d';
    ctx.fillRect(tx - 5, ty - 4, tag.w + 10, tag.h + 8);
    ctx.fillStyle = '#d97757';
    ctx.fillRect(tx - 5, ty + tag.h + 3, tag.w + 10, 1.5);
    dev();
    blit(tag, tx - tag.ox, ty - tag.oy, b.alpha);
  }

  for (const b of buddies) if (b.birth && b.birth.t + elapsed < BUILD.effects) drawBuildFront(b, elapsed);
  if (puke) drawDrops(puke);
  fxSafe(() => {
    if (overlord && overlord.stream) drawStreams(streams, overlord);
    for (const b of buddies) if (b.inspect) drawTag(b);
    if (fx) { drawScan(fx.scan, overlord); drawDrones(fx.drones); drawBossFront(fx.boss, overlord); }
  });

  if (doom) { drawPit(doom, performance.now(), true); drawBeams(doom, dt); }
  if (overlord) drawOverlord(overlord, elapsed);
  fxSafe(() => { if (fx) { drawWeatherFront(fx.weather); drawReport(fx.report); drawOvSay(fx.say, overlord); drawNotes(fx.notes); drawFakeError(fx.fakeError); } });
  if (doom) { drawVerdicts(doom, elapsed); drawBanner(doom, dt); }

  // The Open button of a watched file dialog: the buddy will eat what you picked.
  if (dialogHot && hoverId === 'dialog') {
    dip();
    const r = dialogHot, x = r.x - origin.x, y = r.y - origin.y;
    brackets(x - 3, y - 3, r.w + 6, r.h + 6, 7, 2, '#d97757', 0.95);
    dev();
  }

  // Placing a "Come here" flag: it follows the pointer until you click.
  if (placing && lastMouse) {
    blitBase(itemSprite('flag', 3), lastMouse.x + 6, lastMouse.y, 0.8);
    pixelText('CLICK TO PLACE   RIGHT-CLICK CANCELS', lastMouse.x + 18, lastMouse.y + 16, 2, '#f6e9df', 1, '#1f1e1d');
  }

  ctx.globalAlpha = 1;
  // Things move out from under a still cursor; release the mouse if so.
  if (hoverId && !grabbing && lastMouse) updateHover(lastMouse.x, lastMouse.y);
  updateCard();
  updateOvCard();
  updateOvMenu();
  updatePermPanels();
}

// ---------------------------------------------------------------- buddy hover card
let cardKey = '';
let cardFor = null;
function minutes(ms) {
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'just started' : m < 60 ? `working for ${m}m` : `working for ${Math.floor(m / 60)}h ${m % 60}m`;
}
const kTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

function permButtons(b, host) {
  host.textContent = '';
  const p = b.perm;
  const label = document.createElement('div');
  label.className = 'perm-label';
  label.textContent = p.detail ? `${p.label}: ${p.detail}` : p.label;
  host.append(label);
  if (!p.held) {
    const note = document.createElement('div');
    note.className = 'perm-note';
    note.textContent = "Answer it in Claude's window.";
    host.append(note);
    return;
  }
  const row = document.createElement('div');
  row.className = 'perm-row';
  const opts = [['allow', 'Allow'], ...(p.canAlways ? [['always', 'Always']] : []), ['deny', 'Deny']];
  for (const [decision, text] of opts) {
    const btn = document.createElement('button');
    btn.className = `pbtn ${decision}`;
    btn.textContent = text;
    btn.dataset.decision = decision;
    btn.dataset.id = b.id;
    row.append(btn);
  }
  host.append(row);
}

function updateCard() {
  const b = buddies.find((x) => x.id === hoverId && x.card);
  if (!b || !b._sp) { card.classList.add('hidden'); cardKey = ''; cardFor = null; return; }
  const c = b.card;
  const key = JSON.stringify([c, b.perm]) + Math.floor(Date.now() / 30000);
  if (key !== cardKey) {
    cardKey = key;
    cardFor = b.id;
    const set = (sel, text) => { const el = card.querySelector(sel); el.textContent = text; el.classList.toggle('empty', !text); };
    set('.name', c.name);
    set('.src', c.source);
    set('.status', c.status);
    const phase = card.querySelector('.phase');
    phase.textContent = '';
    if (c.phase) {
      const label = document.createElement('b');
      label.textContent = c.progress ? `Step ${c.progress}` : 'Now';
      phase.append(label, ` · ${c.phase}`);
    }
    phase.classList.toggle('empty', !c.phase);
    set('.thought', c.thought ? `“${c.thought}”` : '');
    set('.task', c.task ? `Task: ${c.task}` : '');
    const meta = [c.since ? minutes(Date.now() - c.since) : '', c.subagents ? `${c.subagents} helper${c.subagents > 1 ? 's' : ''} out` : ''].filter(Boolean).join(' · ');
    set('.meta', meta);
    set('.queued', c.note || '');
    // Context ring: how full the session's context window is.
    const ring = card.querySelector('.ctx');
    if (c.context) {
      const pct = c.context.pct;
      const fg = ring.querySelector('.fg');
      fg.setAttribute('stroke-dasharray', `${(pct / 100) * 94.25} 94.25`);
      fg.setAttribute('stroke', pct < 50 ? '#5fd38d' : pct < 80 ? '#f2c14e' : '#f06a5d');
      ring.querySelector('span').textContent = `${pct}%`;
      ring.title = `Context: ${kTokens(c.context.used)} of ${kTokens(c.context.size)} tokens`;
      ring.classList.remove('empty');
    } else ring.classList.add('empty');
    const perm = card.querySelector('.perm');
    if (b.perm) permButtons(b, perm);
    perm.classList.toggle('empty', !b.perm);
  }
  const sp = b._sp, x = b.x - origin.x, y = b.y - origin.y;
  const h = card.offsetHeight || 140;
  const cx = x + sp.ox + sp.w / 2;
  let top = y + sp.oy - h - 16;
  if (top < 8) top = y + sp.oy + sp.h + 24;
  card.style.left = `${Math.round(Math.min(Math.max(8, cx - 150), innerWidth - 308))}px`;
  card.style.top = `${Math.round(top)}px`;
  card.classList.remove('hidden');
}

// ---------------------------------------------------------------- Overlord hover card
let ovKey = '';
function resetsText(iso) {
  const at = Date.parse(iso);
  if (!at) return '';
  const ms = at - Date.now();
  if (ms <= 0) return 'resetting now';
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  if (h < 24) return `resets in ${h ? `${h}h ` : ''}${m}m`;
  return `resets ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

function ovButton(host, label, act, opts = {}) {
  const b = document.createElement('button');
  b.className = 'ovbtn' + (opts.cls ? ' ' + opts.cls : '') + (opts.on === true ? ' on' : opts.on === false ? ' off' : '');
  b.dataset.act = act;
  if (opts.value !== undefined) b.dataset.value = opts.value;
  if (opts.on !== undefined) { const i = document.createElement('i'); b.append(i); }
  b.append(document.createTextNode(label));
  if (opts.disabled) b.disabled = true;
  if (opts.title) b.title = opts.title;
  host.append(b);
  return b;
}

function usageRows(host, c) {
  host.textContent = '';
  const u = c.usage || {};
  const rows = [['Current session (5h)', u.session], ['This week (all models)', u.week], ['This week (Opus)', u.opus], ['This week (Sonnet)', u.sonnet]].filter(([, v], i) => i < 2 || v);
  for (const [label, v] of rows) {
    const row = document.createElement('div');
    row.className = 'urow';
    const head = document.createElement('div');
    head.className = 'uhead';
    const l = document.createElement('span'); l.textContent = label;
    const p = document.createElement('b'); p.textContent = v ? `${v.pct}%` : '…';
    head.append(l, p);
    const bar = document.createElement('div');
    bar.className = 'ubar';
    const fill = document.createElement('i');
    const pct = v ? clamp(v.pct, 0, 100) : 0;
    fill.style.width = `${pct}%`;
    fill.style.background = pct < 50 ? '#5fd38d' : pct < 80 ? '#f2c14e' : '#f06a5d';
    bar.append(fill);
    const sub = document.createElement('div');
    sub.className = 'usub';
    sub.textContent = v && v.resets ? resetsText(v.resets) : v ? '' : c.error ? '' : 'reading your usage…';
    row.append(head, bar, sub);
    host.append(row);
  }
}

/** Hovering the Overlord: your usage limits and today's numbers. Its options open when you click it. */
function updateOvCard() {
  const o = overlord;
  if (hoverId !== 'overlord' || !o || !o.card || o.menu || ['boss', 'report', 'patrol'].includes(o.mode)) { ovcard.classList.add('hidden'); ovKey = ''; return; }
  const c = o.card;
  const key = JSON.stringify([c.usage, c.error, c.limit, c.today, c.counts]) + Math.floor(Date.now() / 30000);
  if (key !== ovKey) {
    ovKey = key;
    usageRows(ovcard.querySelector('.usage'), c);
    const err = ovcard.querySelector('.err');
    const lim = c.limit ? `${c.limit.kind === 'week' ? 'Weekly' : 'Session'} limit reached: buddies banished until ${clockTime(c.limit.resetsAt).toLowerCase() || 'it resets'}${c.limit.resetsAt ? ` (${resetsText(c.limit.resetsAt)})` : ''}.${c.limit.interrupted ? ` ${c.limit.interrupted} will be told to resume.` : ''}` : '';
    err.textContent = lim || (c.error ? `Usage: ${c.error}` : '');
    err.classList.toggle('empty', !lim && !c.error);
    const n = c.counts || {}, t = c.today || {};
    ovcard.querySelector('.ovsum').textContent = `${n.working || 0} working · ${n.out || 0} out · ${n.home || 0} at home${n.sleeping ? ` · ${n.sleeping} asleep` : ''}`;
    const grid = ovcard.querySelector('.ovstats');
    grid.textContent = '';
    for (const [v, label] of [[t.prompts, 'prompts'], [t.tools, 'tool calls'], [t.edits, 'files edited'], [t.minutes, 'min worked'], [t.agents, 'sub-agents'], [t.busiest || '–', 'busiest']]) {
      const cell = document.createElement('div');
      const b = document.createElement('b'); b.textContent = v ?? 0;
      const sp = document.createElement('span'); sp.textContent = label;
      cell.append(b, sp);
      grid.append(cell);
    }
  }
  placeNextToOverlord(ovcard, o, 320);
}

function placeNextToOverlord(el, o, w) {
  const h = el.offsetHeight || 360;
  let left, top;
  if (o.mode === 'fused') {
    const g = ovGeom(o);
    left = g.hx - 16 * g.ps; top = Math.max(g.top + 6 * g.ps, g.bottom) + 14;
  } else {
    const x = o.x - origin.x, y = o.y - origin.y;
    left = x + 17 * o.s + 12; top = y - 40;
    if (left + w > innerWidth - 8) left = x - 17 * o.s - 12 - w;
  }
  el.style.left = `${Math.round(clamp(left, 8, innerWidth - w - 8))}px`;
  el.style.top = `${Math.round(clamp(top, 8, innerHeight - h - 8))}px`;
  el.classList.remove('hidden');
}

/** Click the Overlord: it comes out of its corner with all of its options. */
let optKey = '';
function updateOvMenu() {
  const o = overlord;
  const here = o && o.menu && o.mode !== 'fused' && o.x - origin.x > -40 && o.x - origin.x < innerWidth + 40;
  if (!here || !o.card) { ovmenu.classList.add('hidden'); optKey = ''; return; }
  const c = o.card, st = c.settings || {}, n = c.counts || {};
  const k2 = JSON.stringify([n, st]);
  if (k2 !== optKey) {
    optKey = k2;
    const acts = ovmenu.querySelector('.ovacts');
    acts.textContent = '';
    ovButton(acts, 'Gather everyone', 'gather', { disabled: !n.out });
    ovButton(acts, 'Wake everyone', 'wake', { disabled: !n.sleeping });
    ovButton(acts, 'Inspection patrol', 'patrol', { disabled: !n.out, title: 'It flies over and scans every buddy' });
    ovButton(acts, 'Holo-report', 'report', { title: "Today's numbers, projected big" });
    ovButton(acts, 'Snacks by drone', 'snacks', { disabled: !n.out });
    ovButton(acts, 'Boss fight!', 'boss', { disabled: !n.out, cls: 'boss', title: 'Your buddies against the Overlord. Click it to help.' });
    ovButton(acts, st.tower ? 'Tuck the skyscraper away' : 'Show the skyscraper', 'tower');
    ovButton(acts, 'Summon a demo buddy', 'demo');
    ovButton(acts, 'Animation gallery', 'gallery');
    const wx = ovmenu.querySelector('.ovweather');
    wx.textContent = '';
    for (const [kind, label] of [['rain', 'Rain'], ['snow', 'Snow'], ['storm', 'Storm'], ['clear', 'Clear']]) ovButton(wx, label, 'weather', { value: kind, cls: 'chip' + (st.weather === kind ? ' sel' : '') });
    ovButton(wx, 'Now and then', 'weatherAuto', { on: st.weatherAuto, cls: 'auto' });
    const sets = ovmenu.querySelector('.ovsets');
    sets.textContent = '';
    ovButton(sets, 'Sound effects', 'sound', { on: st.sound });
    ovButton(sets, st.mac ? 'Type along (Input Monitoring)' : 'Type along when I type', 'typing', { on: st.typing });
    ovButton(sets, 'Token stream to the Overlord', 'stream', { on: st.stream });
    ovButton(sets, 'Overlord remarks', 'commentary', { on: st.commentary });
    ovButton(sets, 'Inspection patrols now and then', 'patrols', { on: st.patrols });
    ovButton(sets, 'Buddy for every session', 'auto', { on: st.auto });
    ovButton(sets, 'Start at login', 'login', { on: st.login });
    ovButton(sets, 'Hide buddies', 'hidden', { on: st.hidden });
    const sizes = ovmenu.querySelector('.ovsizes');
    sizes.textContent = '';
    for (const [which, label] of [['internal', 'Laptop screen size'], ['external', 'Other monitors size']]) {
      const row = document.createElement('div');
      row.className = 'ovsize';
      const l = document.createElement('span'); l.textContent = label;
      row.append(l);
      ovButton(row, '−', 'size', { value: `${which}:-1`, cls: 'step', disabled: st[which] <= 1 });
      const v = document.createElement('b'); v.textContent = st[which];
      row.append(v);
      ovButton(row, '+', 'size', { value: `${which}:1`, cls: 'step', disabled: st[which] >= 12 });
      sizes.append(row);
    }
  }
  placeNextToOverlord(ovmenu, o, 340);
}

// Floating Allow / Always / Deny above any buddy waiting on a permission.
const permPanels = new Map();
function updatePermPanels() {
  const want = new Set();
  for (const b of buddies) {
    // The hover card carries the same buttons, so the floating panel steps aside while it's open.
    if (!b.perm || !b.perm.held || !b._sp || b.alpha <= 0 || (b.id === cardFor && !card.classList.contains('hidden'))) continue;
    want.add(b.id);
    let el = permPanels.get(b.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'perm-float';
      el.dataset.id = b.id;
      permLayer.append(el);
      permPanels.set(b.id, el);
    }
    const key = JSON.stringify(b.perm);
    if (el.dataset.key !== key) { el.dataset.key = key; permButtons(b, el); }
    const sp = b._sp, x = b.x - origin.x, y = b.y - origin.y;
    const w = el.offsetWidth || 200, h = el.offsetHeight || 54;
    el.style.left = `${Math.round(Math.min(Math.max(6, x + sp.ox + sp.w / 2 - w / 2), innerWidth - w - 6))}px`;
    el.style.top = `${Math.round(Math.max(6, y + sp.oy - h - 30))}px`;
  }
  for (const [id, el] of permPanels) if (!want.has(id)) { el.remove(); permPanels.delete(id); }
}

// ---------------------------------------------------------------- mouse
function hitTest(mx, my, pad = 0) {
  for (const b of [...buddies].sort((a, c) => c.y - a.y)) {
    const sp = b._sp;
    if (!sp || b.alpha <= 0 || !b.interactive) continue;
    const x = b.x - origin.x, y = b.y - origin.y, u = sp.u;
    let x0, x1, y0, y1;
    if (b.o === 'floor') {
      x0 = x + Math.min(sp.hit.x0 * u, -9 * u) - 4; x1 = x + Math.max(sp.hit.x1 * u, 9 * u) + 4;
      // Stop just below the feet so the title bar under a buddy stays clickable.
      y0 = y + Math.min(sp.hit.y0 * u, -10 * u) - 4; y1 = y + 4;
    } else {
      x0 = x + sp.ox - 4; x1 = x + sp.ox + sp.w + 4; y0 = y + sp.oy - 4; y1 = y + sp.oy + sp.h + 4;
    }
    if (mx >= x0 - pad && mx <= x1 + pad && my >= y0 - pad && my <= y1 + pad) return b.id;
  }
  return null;
}

const inDialogHot = (mx, my) => !!dialogHot && mx >= dialogHot.x - origin.x && mx <= dialogHot.x - origin.x + dialogHot.w && my >= dialogHot.y - origin.y && my <= dialogHot.y - origin.y + dialogHot.h;
const inside = (el, x, y) => { if (!el || el.classList.contains('hidden')) return false; const r = el.getBoundingClientRect(); return x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2; };

/** What's under the pointer: a buddy id, 'overlord', 'dialog', or nothing. */
function whatsAt(mx, my) {
  if (fakeErrorOkAt(mx, my)) return 'fakeerr';
  if (inFakeError(mx, my)) return 'fakeerr-box';
  const note = noteAt(mx, my);
  if (note) return 'note:' + note.id;
  return hitTest(mx, my) || (inDialogHot(mx, my) ? 'dialog' : null) || (hitReport(mx, my) ? 'report' : null) || (hitOverlord(mx, my) ? 'overlord' : null) || hitTower(mx, my);
}
const isBuddyId = (id) => !!id && id !== 'overlord' && id !== 'dialog' && id !== 'report' && !id.startsWith('tower') && !id.startsWith('note:') && !id.startsWith('fakeerr');

// The cards and permission buttons count as part of what they belong to, with
// a short grace period so you can move the mouse onto them.
let leaveTimer = null;
function updateHover(mx, my) {
  let id = whatsAt(mx, my);
  if (!id && cardFor && inside(card, mx, my)) id = cardFor;
  if (!id && (inside(ovcard, mx, my) || inside(ovmenu, mx, my))) id = 'overlord';
  if (!id) for (const [pid, el] of permPanels) if (inside(el, mx, my)) { id = pid; break; }
  if (id) { clearTimeout(leaveTimer); leaveTimer = null; return setHover(id); }
  if (hoverId && !leaveTimer) leaveTimer = setTimeout(() => { leaveTimer = null; setHover(null); }, 320);
}

function setHover(id) {
  if (id === hoverId) return;
  hoverId = id;
  document.body.classList.toggle('grab', isBuddyId(id));
  document.body.classList.toggle('point', id === 'dialog' || id === 'overlord' || id === 'report' || id === 'fakeerr' || (!!id && (id.startsWith('tower:') || id.startsWith('note:'))));
  buddy.send('hover', id);
}

const onUi = (e) => !!(e.target.closest && e.target.closest('.card, .perm-float'));
// (the Overlord's card is a .card too, so its buttons never start a grab)

function endGrab(e) {
  if (!grabbing) return;
  grabbing = false;
  document.body.classList.remove('grabbing');
  try { if (grabPointer !== null && canvas.hasPointerCapture(grabPointer)) canvas.releasePointerCapture(grabPointer); } catch { /* already released */ }
  grabPointer = null;
  buddy.send('release');
  if (e && e.clientX !== undefined) updateHover(e.clientX, e.clientY);
}

// Debug: the last mouse events as this overlay saw them (read by /debug/overlay).
const inputLog = [];
function logInput(e) {
  const t = e.target, tag = t && (t.id || (typeof t.className === 'string' && t.className) || t.tagName);
  inputLog.push({ t: Math.round(performance.now()), type: e.type, button: e.button, x: Math.round(e.clientX), y: Math.round(e.clientY), target: String(tag || ''), at: whatsAt(e.clientX, e.clientY), hover: hoverId, grabbing, placing });
  if (inputLog.length > 40) inputLog.shift();
}
for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'contextmenu']) window.addEventListener(type, logInput, true);
window.__buddyDebug = () => ({
  hoverId, grabbing, placing, cardFor, lastMouse, inputLog,
  buttons: ovmenu.classList.contains('hidden') ? [] : [...ovmenu.querySelectorAll('.ovbtn')].map((b) => { const r = b.getBoundingClientRect(); return { act: b.dataset.act, value: b.dataset.value, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }),
  tower: tower && towerGeo(tower) ? (() => { const g = towerGeo(tower); return { button: g.button, n: g.n, h: tower.h }; })() : null,
});

window.addEventListener('mousemove', (e) => {
  lastRealMouse = performance.now();
  lastMouse = { x: e.clientX, y: e.clientY };
  if (!grabbing) updateHover(e.clientX, e.clientY);
});
window.addEventListener('mouseleave', () => { lastMouse = null; if (!grabbing) { clearTimeout(leaveTimer); leaveTimer = null; setHover(null); } });
window.addEventListener('click', (e) => {
  // The skyscraper and the file dialog's Open button act on the finished click (button released),
  // never on the press: whatever they open or change must not take the mouse away mid-click.
  if (e.button === 0 && pressedOn && (pressedOn === 'dialog' || pressedOn.startsWith('tower:'))) {
    const id = whatsAt(e.clientX, e.clientY), was = pressedOn;
    pressedOn = null;
    if (id !== was) return; // pressed on one thing, let go over another: no click
    if (id === 'dialog') { buddy.send('dialog-open-click'); return; }
    const [, act, bid] = id.split(':');
    buddy.send('tower', { act, id: bid });
    return;
  }
  const btn = e.target.closest && e.target.closest('.pbtn');
  if (btn) { buddy.send('decide', { id: btn.dataset.id, decision: btn.dataset.decision }); return; }
  const ob = e.target.closest && e.target.closest('.ovbtn');
  if (ob && !ob.disabled) { buddy.send('ov-action', { act: ob.dataset.act, value: ob.dataset.value }); optKey = ''; }
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (placing) { buddy.send('place-cancel'); return; }
  const id = whatsAt(e.clientX, e.clientY) || (onUi(e) ? hoverId : null);
  if (isBuddyId(id)) buddy.send('context', id); // the Overlord and the skyscraper have no menus: hover / click them
});
let pressedOn = null; // the skyscraper part or dialog button a left press started on
window.addEventListener('pointerdown', (e) => {
  if (e.button === 0) buddy.send('press'); // tells main this overlay is receiving left presses (see unstick in main.js)
  pressedOn = null;
  if (placing) {
    if (e.button === 0) buddy.send('place', { x: e.clientX + origin.x, y: e.clientY + origin.y });
    else buddy.send('place-cancel');
    return;
  }
  if (e.button !== 0 || onUi(e)) return;
  if (grabbing) endGrab(); // a grab whose release we never saw
  const id = whatsAt(e.clientX, e.clientY);
  if (!id) return;
  if (id === 'overlord') { buddy.send('overlord-click', { x: e.clientX + origin.x, y: e.clientY + origin.y }); return; } // its options (or, mid-fight, a hit)
  if (id === 'report') { buddy.send('ov-action', { act: 'report-close' }); return; }
  if (id.startsWith('note:')) { buddy.send('mischief', { act: 'note-off', id: Number(id.slice(5)) }); return; }
  if (id === 'fakeerr') { buddy.send('mischief', { act: 'error-ok' }); return; }
  if (id === 'fakeerr-box') return;
  if (id === 'dialog' || id.startsWith('tower')) { pressedOn = id; return; } // acted on in 'click'
  grabbing = true;
  grabAt = performance.now();
  grabPointer = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* still works without capture */ }
  document.body.classList.add('grabbing');
  buddy.send('grab', id);
});
window.addEventListener('pointerup', endGrab);
window.addEventListener('pointercancel', endGrab);
canvas.addEventListener('lostpointercapture', () => endGrab());

// ---------------------------------------------------------------- feeding files (drag and drop)
let dragSent = 0;
let dragId = null;
window.addEventListener('dragenter', (e) => e.preventDefault());
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  dragId = hitTest(e.clientX, e.clientY, 12) || (hitOverlord(e.clientX, e.clientY) ? 'overlord' : null); // the Overlord sends them by drone
  e.dataTransfer.dropEffect = dragId ? 'copy' : 'none';
  if (dragId && performance.now() - dragSent > 100) { dragSent = performance.now(); buddy.send('drag-over', dragId); }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const id = hitTest(e.clientX, e.clientY, 12) || (hitOverlord(e.clientX, e.clientY) ? 'overlord' : null) || dragId;
  dragId = null;
  const paths = [...(e.dataTransfer.files || [])].map((f) => buddy.pathForFile(f)).filter(Boolean);
  if (id && paths.length) buddy.send('files-dropped', { id, paths });
});

// ---------------------------------------------------------------- sound (tiny WebAudio synth)
let audio = null;
function tone(freq, at, dur, type = 'square', vol = 0.045, slide = 0) {
  audio = audio || new AudioContext();
  const t = audio.currentTime + at;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.linearRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
const SOUNDS = {
  summon: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.1)),
  crack: () => [0, 0.35, 0.7, 1.05].forEach((at) => tone(320 + Math.random() * 120, at, 0.05, 'square', 0.03, -120)),
  scan: () => { tone(300, 0, 0.4, 'sine', 0.04, 900); tone(1200, 0.4, 0.4, 'sine', 0.035, -900); },
  print: () => { for (let i = 0; i < 24; i++) tone(500 + i * 28 + (i % 3) * 90, i * 0.095, 0.04, 'square', 0.018); },
  birth: () => { tone(110, 0, 0.5, 'sawtooth', 0.03, 440); [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.3 + i * 0.06, 0.16, 'triangle', 0.06)); tone(2093, 0.7, 0.4, 'sine', 0.03); },
  done: () => [659, 784, 988, 1319].forEach((f, i) => tone(f, i * 0.08, 0.13, 'triangle', 0.06)),
  alert: () => { tone(880, 0, 0.08); tone(880, 0.14, 0.08); },
  error: () => { tone(330, 0, 0.13, 'sawtooth', 0.03, -120); tone(220, 0.13, 0.18, 'sawtooth', 0.03, -80); },
  poke: () => tone(600, 0, 0.12, 'square', 0.04, 500),
  bonk: () => tone(170, 0, 0.14, 'square', 0.05, -80),
  greet: () => { tone(988, 0, 0.06); tone(1319, 0.08, 0.08); },
  chirp: () => tone(1100, 0, 0.07, 'square', 0.035, 300),
  munch: () => [0, 0.18, 0.36, 0.54].forEach((at) => tone(180 + Math.random() * 60, at, 0.06, 'square', 0.03)),
  bye: () => [784, 659, 523].forEach((f, i) => tone(f, i * 0.09, 0.11, 'triangle', 0.05)),
  land: () => tone(140, 0, 0.05, 'triangle', 0.05),
  jump: () => tone(420, 0, 0.08, 'square', 0.02, 260),
  siren: () => { for (let i = 0; i < 6; i++) { tone(620, i * 0.42, 0.21, 'sawtooth', 0.045, 280); tone(900, i * 0.42 + 0.21, 0.21, 'sawtooth', 0.045, -280); } },
  doom: () => { tone(70, 0, 1.4, 'sawtooth', 0.06, -30); tone(105, 0.05, 1.2, 'square', 0.03, -40); },
  portal: () => { for (let i = 0; i < 10; i++) tone(90 + Math.random() * 140, i * 0.07, 0.12, 'sawtooth', 0.03, -60); },
  scream: () => tone(1500, 0, 0.55, 'square', 0.035, -1250),
  sizzle: () => { for (let i = 0; i < 6; i++) tone(2400 + Math.random() * 1600, i * 0.04, 0.03, 'square', 0.015); },
  rise: () => [196, 262, 330, 392, 523].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.05)),
  stamp: () => { tone(160, 0, 0.09, 'square', 0.06, -60); tone(880, 0.1, 0.12, 'triangle', 0.05); },
  thunder: () => { for (let i = 0; i < 8; i++) tone(50 + Math.random() * 40, i * 0.09, 0.4, 'sawtooth', 0.035, -20); },
  chat: () => { const f = 480 + Math.random() * 380; tone(f, 0, 0.045, 'square', 0.022); tone(f * 1.25, 0.06, 0.045, 'square', 0.022); tone(f * 0.9, 0.12, 0.05, 'square', 0.022); },
  clap: () => { for (let i = 0; i < 3; i++) tone(1700 + Math.random() * 900, i * 0.02, 0.03, 'square', 0.03); },
  door: () => { tone(330, 0, 0.08, 'triangle', 0.04); tone(440, 0.09, 0.1, 'triangle', 0.04); },
  dizzy: () => [880, 740, 880, 740, 660].forEach((f, i) => tone(f, i * 0.09, 0.08, 'triangle', 0.035)),
  gulp: () => tone(260, 0, 0.12, 'square', 0.04, -120),
  blech: () => { tone(160, 0, 0.5, 'sawtooth', 0.05, -60); for (let i = 0; i < 5; i++) tone(90 + Math.random() * 60, 0.1 + i * 0.08, 0.06, 'square', 0.03); },
};

// ---------------------------------------------------------------- wiring
buddy.on('init', (d) => {
  origin = d.origin;
  Clawd.loadPoses(d.poses);
  resize();
  requestAnimationFrame(draw);
});
buddy.on('frame', (data) => {
  // Keep last frame's sprite refs so hit-testing works between paints.
  const prev = new Map(buddies.map((b) => [b.id, b._sp]));
  for (const b of data.buddies) b._sp = prev.get(b.id) || null;
  buddies = data.buddies;
  items = data.items || [];
  overlord = data.overlord || null;
  covers = data.covers || [];
  doom = data.doom || null;
  fx = data.fx || null;
  streams = data.streams || [];
  tower = data.tower || null;
  puke = data.puke && (data.puke.drops.length || data.puke.puddles.length) ? data.puke : null;
  dialogHot = data.dialogHot || null;
  anyHeld = !!data.anyHeld;
  if (placing !== !!data.placing) { placing = !!data.placing; document.body.classList.toggle('placing', placing); }
  receivedAt = performance.now();
  if (data.cursor && !grabbing && receivedAt - lastRealMouse > 150) {
    const { x, y } = data.cursor;
    if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) { lastMouse = { x, y }; updateHover(x, y); }
    else if (lastMouse) { lastMouse = null; if (hoverId && !leaveTimer) leaveTimer = setTimeout(() => { leaveTimer = null; setHover(null); }, 320); }
  }
  // Watchdog: the world dropped the buddy (button released somewhere we didn't see).
  if (grabbing && !anyHeld && receivedAt - grabAt > 600) endGrab();
  if (isBuddyId(hoverId) && !buddies.some((b) => b.id === hoverId) && !grabbing) setHover(null);
});
buddy.on('sound', (name) => { try { SOUNDS[name]?.(); } catch { /* audio unavailable */ } });
buddy.on('debugHover', (id) => { hoverId = id; cardKey = ''; ovKey = ''; optKey = ''; lastMouse = null; });
