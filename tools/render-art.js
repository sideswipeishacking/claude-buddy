// Render the README artwork from the sprite engine (no screenshots involved).
// usage: node tools/render-art.js [out=docs/images/hero.png]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Clawd = require('../app/sprites.js');

Clawd.loadPoses(JSON.parse(fs.readFileSync(path.join(__dirname, '../app/assets/poses.json'), 'utf8')));
const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'images', 'hero.png');

const S = 6; // device pixels per art pixel
const W = 150 * S, H = 62 * S;
const img = Buffer.alloc(W * H * 4, 0); // transparent
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function put(x, y, rgb, a = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4, ia = img[i + 3] / 255, oa = a + ia * (1 - a);
  for (let c = 0; c < 3; c++) img[i + c] = Math.round((rgb[c] * a + img[i + c] * ia * (1 - a)) / (oa || 1));
  img[i + 3] = Math.round(oa * 255);
}
function draw(pixels, ax, ay) {
  for (const p of pixels) for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put(Math.round((ax + p.x) * S) + dx, Math.round((ay + p.y) * S) + dy, hex(p.c), p.a ?? 1);
}

// A lineup of buddies in different outfits (calm poses: the rest is for you to discover).
const crew = [
  { anim: 'idle', look: { hat: 'wizard', hand: 'wand', body: Clawd.COL.body } },
  { anim: 'idle', look: { hat: 'hardhat', face: 'glasses', body: '#5aa9e6' } },
  { anim: 'idle', look: { hat: 'crown', back: 'royal', body: Clawd.COL.body } },
  { anim: 'idle', look: { hat: 'beanie', neck: 'scarf', body: '#3b3743' } },
  { anim: 'idle', look: { hat: 'propeller', hand: 'balloon', body: '#5fd38d' } },
];
const ground = 58;
crew.forEach((m, i) => {
  const fr = Clawd.frame(m.anim, 0, { hand: null, face: null, neck: null, back: null, eye: Clawd.COL.eye, ...m.look }, i % 2 === 1);
  draw(fr.pixels, 19 + i * 28, ground);
});
// The Overlord, watching over them.
draw(Clawd.overlord({ t: 0, lookX: 0, lookY: 0.7, R: 11 }).pixels, 75, 16);

// Minimal PNG encoder (RGBA).
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; img.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${path.relative(process.cwd(), out)} (${W}x${H})`);
