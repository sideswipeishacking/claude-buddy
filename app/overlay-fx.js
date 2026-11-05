/* The Overlord's shows, drawn on each overlay from the frame's `fx` (see spectacle.js):
 * the token stream, its usage ring, remarks, inspection scans and tags, drones, the weather,
 * the holo-report and the boss fight. Loaded after overlay.js and uses its helpers
 * (ctx, dpr, origin, blit, raster, memo, textSprite, pixelText, hash, clamp, ...).
 * Particles are worked out from the clock rather than simulated, so every monitor's overlay
 * draws the same ones and they cross from screen to screen seamlessly.
 */
'use strict';

const HOLO = '#3fd0ff', HOLO2 = '#9eeaff', HOLO_BG = 'rgba(12, 40, 56, 0.72)';

/** Where the token stream flows to: the Overlord's eye (or its corner while it's tucked in). */
function ovTarget(o) {
  if (!o) return null;
  if (o.mode === 'fused') return { x: o.home.x, y: o.home.y + 8 };
  return { x: o.x, y: o.y };
}

// ---------------------------------------------------------------- token stream
function drawStreams(list, o) {
  const T = ovTarget(o);
  if (!T || !list || !list.length) return;
  const now = Date.now();
  dip();
  list.forEach((st, j) => {
    const sx = st.x, sy = st.y, n = 12, life = 1500 - st.k * 500;
    const mx = (sx + T.x) / 2 + (hash(j + 3) - 0.5) * 160, my = Math.min(sy, T.y) - 90 - hash(j + 7) * 80;
    for (let m = 0; m < n; m++) {
      const p = ((now / life) + m / n + hash(j * 13 + 1)) % 1;
      if (p > st.k + 0.15 && m % 2) continue; // quieter sessions send fewer
      const q = 1 - p, x = q * q * sx + 2 * q * p * mx + p * p * T.x, y = q * q * sy + 2 * q * p * my + p * p * T.y;
      const lx = x - origin.x, ly = y - origin.y;
      if (lx < -10 || ly < -10 || lx > innerWidth + 10 || ly > innerHeight + 10) continue;
      const a = Math.min(1, p * 6, (1 - p) * 4) * (0.45 + 0.55 * st.k), size = p > 0.85 ? 2 : 3;
      ctx.globalAlpha = a * 0.35; ctx.fillStyle = st.c || HOLO;
      ctx.fillRect(Math.round(lx - size), Math.round(ly - size), size * 2 + 1, size * 2 + 1);
      ctx.globalAlpha = a; ctx.fillStyle = m % 3 ? HOLO2 : '#ffffff';
      ctx.fillRect(Math.round(lx - 1), Math.round(ly - 1), size, size);
    }
  });
  // The eye drinks it in.
  const lx = T.x - origin.x, ly = T.y - origin.y;
  if (lx > -60 && ly > -60 && lx < innerWidth + 60 && ly < innerHeight + 60) {
    const r = 22 + Math.sin(now / 160) * 4, g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
    g.addColorStop(0, 'rgba(158,234,255,0.45)'); g.addColorStop(1, 'rgba(63,208,255,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
  }
  dev();
}

// ---------------------------------------------------------------- usage ring around the eye
const usageColour = (pct) => (pct < 50 ? '#5fd38d' : pct < 80 ? '#f2c14e' : '#f06a5d');
function drawUsageRing(o, g) {
  if (typeof o.usage !== 'number') return;
  const pct = clamp(o.usage, 0, 100), col = usageColour(pct);
  dip();
  if (o.mode === 'fused') {
    // A little meter under the corner socket.
    const cells = 12, ps = g.ps, x0 = g.hx - (cells * ps) / 2 - 1, y = g.top + 6 * ps;
    for (let i = 0; i < cells; i++) {
      const on = i < Math.round((pct / 100) * cells);
      ctx.globalAlpha = on ? 0.95 : 0.35; ctx.fillStyle = on ? col : '#2b2733';
      ctx.fillRect(Math.round(x0 + i * ps), Math.round(y), Math.max(1, ps - 1), Math.max(2, Math.round(ps * 0.7)));
    }
  } else if (!o.hidden) {
    const x = o.x - origin.x, y = o.y - origin.y, R = 15.5 * o.s, n = 36, lit = Math.round((pct / 100) * n), sq = Math.max(2, Math.round(o.s * 0.7));
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      ctx.globalAlpha = i < lit ? 0.9 : 0.25; ctx.fillStyle = i < lit ? col : '#3b3546';
      ctx.fillRect(Math.round(x + Math.cos(a) * R - sq / 2), Math.round(y + Math.sin(a) * R - sq / 2), sq, sq);
    }
  }
  dev();
}

// ---------------------------------------------------------------- the Overlord's remarks
function ovSpeechSprite(text, k) {
  return memo(`ovsay|${text}|${k}`, () => {
    const lines = wrapWords(text, 18), ink = HOLO2, paper = '#0e1c26', edge = HOLO, px = [];
    const w = Math.max(...lines.map((l) => l.length * 4 - 1)) + 6, h = lines.length * 6 + 4;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) continue;
      px.push({ x, y, c: x === 0 || y === 0 || x === w - 1 || y === h - 1 ? edge : paper });
    }
    px.push({ x: 2, y: -1, c: edge }, { x: 3, y: -1, c: edge }, { x: 2, y: -2, c: edge }, { x: 3, y: 0, c: paper }); // tail, up-left
    lines.forEach((l, i) => {
      const ox = Math.floor((w - (l.length * 4 - 1)) / 2);
      for (const p of Clawd.text(l).pixels) px.push({ x: ox + p.x, y: 3 + i * 6 + p.y, c: ink });
    });
    return raster(px, k);
  });
}

function drawOvSay(say, o) {
  if (!say || !o) return;
  const k = 2, sp = ovSpeechSprite(say.text, k);
  let x, y;
  if (o.mode === 'fused') { const g = ovGeom(o); x = g.hx + 12 * g.ps; y = Math.max(g.top + 6 * g.ps, g.bottom) + 6; }
  else { x = o.x - origin.x + 10 * o.s; y = o.y - origin.y + 10 * o.s; }
  if (x > innerWidth || y > innerHeight || x + sp.w < 0) return;
  x = clamp(x, 6, innerWidth - sp.w - 6);
  const a = Math.min(1, say.t / 160, say.left / 300);
  blit(sp, x - sp.ox, y - sp.oy, a);
}

// ---------------------------------------------------------------- inspection: scan beam and stat tags
function drawScan(sc, o) {
  if (!sc || !o) return;
  const x0 = o.x - origin.x, y0 = o.y - origin.y + 9 * o.s, bx = sc.x - origin.x, top = sc.top - origin.y - 6, by = sc.y - origin.y, hw = sc.w / 2 + 10;
  dip();
  ctx.globalAlpha = 0.18 + 0.08 * Math.sin(Date.now() / 90);
  ctx.fillStyle = HOLO;
  ctx.beginPath(); ctx.moveTo(x0 - 4, y0); ctx.lineTo(x0 + 4, y0); ctx.lineTo(bx + hw, by); ctx.lineTo(bx - hw, by); ctx.closePath(); ctx.fill();
  // A bright line sweeping down the buddy.
  const ly = top + (by - top) * ((sc.k * 2.2) % 1);
  ctx.globalAlpha = 0.85; ctx.fillStyle = HOLO2;
  ctx.fillRect(Math.round(bx - hw), Math.round(ly), Math.round(hw * 2), 2);
  brackets(bx - hw, top, hw * 2, by - top, 8, 2, HOLO2, 0.9);
  dev();
}

function drawTag(b) {
  const t = b.inspect, sp = b._sp;
  if (!t || !sp) return;
  const a = Math.min(1, t.k * 12, (1 - t.k) * 6) * (t.k < 0.08 && Math.random() < 0.3 ? 0.3 : 1);
  const lines = [
    [`${t.name}`.toUpperCase().slice(0, 22), HOLO2],
    [`${t.status}`.toUpperCase().slice(0, 24), '#f6e9df'],
    [`${t.tools} TOOLS  ${t.edits} EDITS  ${t.mins} MIN`, HOLO],
  ];
  const s = 2, w = Math.max(...lines.map(([l]) => l.length * 4 - 1)) * s + 16, h = lines.length * 7 * s + 10 + (t.ctx !== null ? 10 : 0);
  const x = clamp(b.x - origin.x - w / 2, 6, innerWidth - w - 6), y = Math.max(6, b.y - origin.y + sp.oy - h - 18);
  dip();
  ctx.globalAlpha = 0.8 * a; ctx.fillStyle = HOLO_BG; ctx.fillRect(Math.round(x), Math.round(y), w, h);
  ctx.globalAlpha = 0.07 * a; ctx.fillStyle = HOLO2; for (let yy = 0; yy < h; yy += 3) ctx.fillRect(Math.round(x), Math.round(y + yy), w, 1);
  brackets(x, y, w, h, 7, 2, HOLO, a);
  ctx.globalAlpha = 0.5 * a; ctx.fillStyle = HOLO; ctx.fillRect(Math.round(b.x - origin.x), Math.round(y + h), 1, 14); // the tag's stalk
  dev();
  lines.forEach(([l, c], i) => pixelText(l, x + 8, y + 6 + i * 7 * s, s, c, a));
  if (t.ctx !== null) {
    dip();
    const bw = w - 16, by = y + h - 12;
    ctx.globalAlpha = 0.5 * a; ctx.fillStyle = '#2b2733'; ctx.fillRect(Math.round(x + 8), Math.round(by), bw, 5);
    ctx.globalAlpha = a; ctx.fillStyle = t.ctx < 70 ? HOLO : t.ctx < 90 ? '#f2c14e' : '#f06a5d'; ctx.fillRect(Math.round(x + 8), Math.round(by), Math.round((bw * clamp(t.ctx, 0, 100)) / 100), 5);
    dev();
  }
}

// ---------------------------------------------------------------- drones
const droneSprite = (f, s) => memo(`drone|${f}|${s}`, () => raster(Clawd.drone(f).pixels, s));
function drawDrones(list) {
  if (!list || !list.length) return;
  const s = 3, now = Date.now();
  for (const d of list) {
    const x = d.x - origin.x, y = d.y - origin.y + Math.sin(now / 180 + d.id) * 3;
    if (x < -60 || y < -60 || x > innerWidth + 60 || y > innerHeight + 200) continue;
    if (d.beam) {
      dip();
      const to = d.beam.to - origin.y;
      ctx.globalAlpha = 0.18 + 0.1 * Math.sin(now / 70); ctx.fillStyle = HOLO;
      ctx.beginPath(); ctx.moveTo(x - 8, y + 8); ctx.lineTo(x + 8, y + 8); ctx.lineTo(x + 26, to + 30); ctx.lineTo(x - 26, to + 30); ctx.closePath(); ctx.fill();
      dev();
    }
    blit(droneSprite(Math.floor(now / 60) % 2, s), x, y, 1);
    if (d.carry) blit(itemSprite(d.carry, s), x, y + 6 * s, 1);
  }
}

// ---------------------------------------------------------------- weather
function drawWeatherBack(W) {
  // Snow settles on the floor and on top of windows.
  if (!W || W.kind !== 'snow') return;
  const depth = Math.min(8, 1 + W.t / 18000) * W.k;
  if (depth < 1) return;
  dip();
  for (const p of W.plats) {
    const x1 = p.x1 - origin.x, x2 = p.x2 - origin.x, y = p.y - origin.y;
    if (x2 < 0 || x1 > innerWidth || y < 0 || y > innerHeight + 10) continue;
    for (let x = Math.max(0, x1); x < Math.min(innerWidth, x2); x += 4) {
      const h = Math.round(depth * (0.75 + 0.25 * hash(Math.floor((x + origin.x) / 4))));
      ctx.globalAlpha = 0.95; ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x), Math.round(y - h), 4, h);
      ctx.fillStyle = '#c9e4f7'; ctx.fillRect(Math.round(x), Math.round(y - 1), 4, 1);
    }
  }
  dev();
}

function drawWeatherFront(W) {
  if (!W) return;
  const now = Date.now(), t = now / 1000, Wd = innerWidth, Hd = innerHeight, k = W.k;
  dip();
  if (W.kind === 'rain' || W.kind === 'storm') {
    if (W.kind === 'storm') { ctx.globalAlpha = 0.14 * k; ctx.fillStyle = '#0a0f1e'; ctx.fillRect(0, 0, Wd, Hd); }
    const n = Math.round((W.kind === 'storm' ? 340 : 230) * k), slant = W.kind === 'storm' ? 0.35 : 0.15;
    ctx.fillStyle = '#9ad7f0';
    for (let i = 0; i < n; i++) {
      const sp = 900 + hash(i * 3.1) * 500, len = 12 + hash(i * 7.7) * 14;
      const y = ((t * sp + hash(i * 1.3) * (Hd + 200)) % (Hd + 200)) - 100;
      const x = ((hash(i * 5.9) * (Wd + 200) + (y + origin.y) * slant - origin.x * 0) % (Wd + 200)) - 100;
      ctx.globalAlpha = 0.55 * k;
      ctx.save(); ctx.translate(x, y); ctx.rotate(-slant * 0.9); ctx.fillRect(0, 0, 2, len); ctx.restore();
    }
    // Splashes on floors and window tops.
    ctx.fillStyle = '#c9e4f7';
    for (const p of W.plats) {
      const x1 = p.x1 - origin.x, x2 = p.x2 - origin.x, y = p.y - origin.y;
      if (x2 < 0 || x1 > Wd || y < 0 || y > Hd + 10) continue;
      const m = Math.floor((x2 - x1) / 40);
      for (let i = 0; i < m; i++) {
        const ph = (t * 3 + hash(i * 3.3 + p.x1)) % 1;
        if (ph > 0.3) continue;
        const sx = x1 + hash(i * 9.1 + Math.floor(t * 3)) * (x2 - x1);
        ctx.globalAlpha = (0.3 - ph) * 2.5 * k;
        ctx.fillRect(Math.round(sx - 3), Math.round(y - 2 - ph * 8), 2, 2); ctx.fillRect(Math.round(sx + 2), Math.round(y - 2 - ph * 8), 2, 2);
      }
    }
  } else if (W.kind === 'snow') {
    const n = Math.round(130 * k);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < n; i++) {
      const sp = 28 + hash(i * 2.7) * 45, y = ((t * sp + hash(i * 4.1) * (Hd + 40)) % (Hd + 40)) - 20;
      const x = ((hash(i * 6.3) * Wd + Math.sin(t * 0.7 + i) * 24) % Wd + Wd) % Wd, sz = hash(i) < 0.3 ? 3 : 2;
      ctx.globalAlpha = 0.85 * k; ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
  }
  if (W.flash > 0) {
    ctx.globalAlpha = 0.4 * W.flash; ctx.fillStyle = '#eef6ff'; ctx.fillRect(0, 0, Wd, Hd);
    if (W.flash > 0.6) {
      // A jagged bolt.
      let x = W.bolt * Wd, y = 0;
      ctx.globalAlpha = W.flash; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y);
      for (let i = 0; i < 9; i++) { x += (hash(i + W.bolt * 100) - 0.5) * 70; y += Hd / 14; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  dev();
}

// ---------------------------------------------------------------- holo-report
function hitReport(mx, my) {
  const R = fx && fx.report;
  if (!R) return false;
  const r = R.rect;
  return mx >= r.x - origin.x && mx <= r.x - origin.x + r.w && my >= r.y - origin.y && my <= r.y - origin.y + r.h;
}

function drawReport(R) {
  if (!R) return;
  const r = R.rect, x = r.x - origin.x, y = r.y - origin.y;
  if (x > innerWidth || y > innerHeight || x + r.w < 0 || y + r.h < 0) return;
  const D = R.data, a = Math.min(1, R.t / 600, R.left / 500), glitch = R.t < 600 && Math.random() < 0.25 ? 0.35 : 1;
  const ex = R.eye.x - origin.x, ey = R.eye.y - origin.y;
  dip();
  // The projector beam from the eye.
  ctx.globalAlpha = 0.12 * a; ctx.fillStyle = HOLO;
  ctx.beginPath(); ctx.moveTo(ex - 6, ey + 6); ctx.lineTo(ex + 6, ey + 6); ctx.lineTo(x + r.w, y); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.85 * a * glitch; ctx.fillStyle = HOLO_BG; ctx.fillRect(Math.round(x), Math.round(y), r.w, r.h);
  ctx.globalAlpha = 0.06 * a; ctx.fillStyle = HOLO2;
  const scroll = (Date.now() / 40) % 3;
  for (let yy = scroll; yy < r.h; yy += 3) ctx.fillRect(Math.round(x), Math.round(y + yy), r.w, 1);
  brackets(x, y, r.w, r.h, 14, 3, HOLO, a);
  dev();
  const A = a * glitch;
  pixelText(`DAILY REPORT  ${D.date}`, x + 18, y + 16, 3, HOLO2, A);
  pixelText(`SESSION ${D.usage.session ?? '--'}%   WEEK ${D.usage.week ?? '--'}%   ${D.totals.prompts} PROMPTS   ${D.totals.tools} TOOLS   ${D.totals.edits} EDITS   ${D.totals.minutes} MIN`, x + 18, y + 40, 2, '#f6e9df', A);
  // Columns: name, prompts, tools (bar), edits, minutes.
  const cols = [x + 18, x + r.w * 0.36, x + r.w * 0.48, x + r.w * 0.78, x + r.w * 0.88];
  ['BUDDY', 'ASKED', 'TOOLS', 'EDITS', 'MIN'].forEach((h, i) => pixelText(h, cols[i], y + 66, 2, HOLO, A * 0.85));
  const max = Math.max(1, ...D.rows.map((rw) => rw.tools));
  D.rows.slice(0, 8).forEach((rw, i) => {
    const ry = y + 86 + i * 26;
    dip(); ctx.globalAlpha = A; ctx.fillStyle = rw.body || '#d97757'; ctx.fillRect(Math.round(cols[0]), Math.round(ry + 1), 8, 8); dev();
    pixelText(rw.name.toUpperCase().slice(0, 16), cols[0] + 14, ry, 2, '#f6e9df', A);
    pixelText(String(rw.prompts), cols[1], ry, 2, '#f6e9df', A);
    const bw = (cols[3] - cols[2] - 40) * (rw.tools / max);
    dip(); ctx.globalAlpha = 0.9 * A; ctx.fillStyle = HOLO; ctx.fillRect(Math.round(cols[2]), Math.round(ry + 1), Math.max(2, Math.round(bw)), 8); dev();
    pixelText(String(rw.tools), cols[2] + Math.max(2, bw) + 6, ry, 2, HOLO2, A);
    pixelText(String(rw.edits), cols[3], ry, 2, '#f6e9df', A);
    pixelText(String(rw.minutes), cols[4], ry, 2, '#f6e9df', A);
  });
  if (!D.rows.length) pixelText('NO ACTIVITY YET TODAY. SUSPICIOUS.', cols[0], y + 90, 2, '#f6e9df', A);
  const hint = textSprite('CLICK TO CLOSE', 2, HOLO);
  pixelText('CLICK TO CLOSE', x + r.w - 18 - hint.w, y + r.h - 22, 2, HOLO, A * (0.6 + 0.4 * Math.sin(Date.now() / 300)));
}

// ---------------------------------------------------------------- the boss fight
const codeSprite = (s) => memo(`code|${s}`, () => raster(Clawd.text('{}').pixels, s, '#37d351'));
function drawBossBack(B) {
  if (!B || !B.laser) return;
  const L = B.laser, x = L.x - origin.x, top = L.top - origin.y, fl = L.floor - origin.y;
  if (x < -20 || x > innerWidth + 20) return;
  dip();
  if (L.k < 0.6) {
    // Warning: a blinking dashed line where it's about to fire.
    ctx.globalAlpha = Math.floor(Date.now() / 90) % 2 ? 0.9 : 0.35; ctx.fillStyle = '#f06a5d';
    for (let y = top; y < fl; y += 12) ctx.fillRect(Math.round(x - 1), Math.round(y), 2, 6);
  } else {
    const w = 14 * (1 - Math.abs((L.k - 0.8) / 0.2) * 0.5);
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#f06a5d'; ctx.fillRect(Math.round(x - w), Math.round(top), Math.round(w * 2), Math.round(fl - top));
    ctx.globalAlpha = 0.95; ctx.fillStyle = '#ffe1dc'; ctx.fillRect(Math.round(x - w / 3), Math.round(top), Math.round((w * 2) / 3), Math.round(fl - top));
  }
  dev();
}

function drawBossFront(B, o) {
  if (!B) return;
  for (const s of B.shots) {
    const x = s.x - origin.x, y = s.y - origin.y;
    if (x < -20 || y < -20 || x > innerWidth + 20 || y > innerHeight + 20) continue;
    const sp = s.kind === 'bug' ? itemSprite('bug', s.s) : codeSprite(s.s);
    blit(sp, x - sp.w / 2 - sp.ox, y - sp.h / 2 - sp.oy, 1);
  }
  dip();
  for (const p of B.sparks) {
    ctx.globalAlpha = Math.max(0, p.a); ctx.fillStyle = p.bug ? '#9e2f44' : Math.random() < 0.5 ? '#ffe12e' : '#ffffff';
    ctx.fillRect(Math.round(p.x - origin.x - 2), Math.round(p.y - origin.y - 2), 4, 4);
  }
  if (o && B.hit && !o.hidden) {
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(o.x - origin.x, o.y - origin.y, 13 * o.s, 0, Math.PI * 2); ctx.fill();
  }
  if (o && B.boom !== null && B.boom < 1500) {
    // It blows up.
    const k = B.boom / 1500, x = o.x - origin.x, y = o.y - origin.y;
    ctx.globalAlpha = (1 - k) * 0.5; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffe12e'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 20 + k * 260, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + hash(i), d = k * (120 + hash(i * 3) * 260);
      ctx.fillStyle = i % 3 ? '#3fd0ff' : '#f06a5d';
      ctx.fillRect(Math.round(x + Math.cos(a) * d - 3), Math.round(y + Math.sin(a) * d - 3), 6, 6);
    }
  }
  dev();
  // The health bar, on the screen the fight is on.
  const bx = B.bar.x - origin.x, by = B.bar.y - origin.y;
  if (bx < 0 || bx > innerWidth || by < 0 || by > innerHeight) return;
  const w = Math.min(420, innerWidth - 40), x0 = bx - w / 2;
  dip();
  ctx.globalAlpha = 0.85; ctx.fillStyle = '#120d18'; ctx.fillRect(Math.round(x0 - 6), Math.round(by - 4), w + 12, 44);
  ctx.globalAlpha = 1; ctx.fillStyle = '#3b1f24'; ctx.fillRect(Math.round(x0), Math.round(by + 18), w, 12);
  ctx.fillStyle = B.hp > 40 ? '#f06a5d' : '#ffe12e'; ctx.fillRect(Math.round(x0), Math.round(by + 18), Math.round((w * B.hp) / B.max), 12);
  ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.25; ctx.fillRect(Math.round(x0), Math.round(by + 18), Math.round((w * B.hp) / B.max), 3);
  dev();
  pixelText('THE OVERLORD', x0, by + 1, 2, '#f06a5d', 1);
  const secs = Math.ceil(B.left / 1000);
  pixelText(B.phase === 'win' ? 'DEFEATED!' : B.phase === 'lose' ? 'TIME UP' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, x0 + w - 60, by + 1, 2, '#f6e9df', 1);
  if (B.phase === 'intro' || (B.phase === 'fight' && B.t < 8000)) pixelText('CLICK THE OVERLORD TO HELP YOUR BUDDIES!', bx - 20 * 8, by + 48, 2, '#ffe12e', 0.6 + 0.4 * Math.sin(Date.now() / 200), '#1f1e1d');
}
