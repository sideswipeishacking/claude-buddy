// Render every animation (several frames each) into a PNG contact sheet.
// usage: node tools/preview.js out.png [hat] [frames=4] [filter-regex]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Clawd = require('../app/sprites.js');

Clawd.loadPoses(JSON.parse(fs.readFileSync(path.join(__dirname, '../app/assets/poses.json'), 'utf8')));
const [out = 'preview.png', hat = '', framesArg = '4', filter = '.'] = process.argv.slice(2);
const FR = +framesArg, S = 3, CW = 34, CH = 34, LABEL = 7, GROUPS = 3;
const names = Object.keys(Clawd.ANIMS).filter((n) => new RegExp(filter).test(n));
const GW = FR * CW + 8, rows = Math.ceil(names.length / GROUPS);
const W = GROUPS * GW * S, H = rows * (CH + LABEL) * S;
const img = Buffer.alloc(W * H * 4, 255);

function put(x, y, rgb, a = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  for (let c = 0; c < 3; c++) img[i + c] = Math.round(img[i + c] * (1 - a) + rgb[c] * a);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function cell(px0, py0, pixels, colour) {
  for (const p of pixels) for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++)
    put(px0 + Math.floor(p.x * S) + dx, py0 + Math.floor(p.y * S) + dy, colour || hex(p.c), p.a ?? 1);
}

names.forEach((name, i) => {
  const y0 = Math.floor(i / GROUPS) * (CH + LABEL) * S, x0 = (i % GROUPS) * GW * S;
  cell(x0 + 2 * S, y0 + 1 * S, Clawd.text(name.slice(0, 16)).pixels, [60, 60, 60]);
  for (let f = 0; f < FR; f++) {
    const fr = Clawd.frame(name, Math.floor((f * Clawd.frameCount(name)) / FR), hat, false);
    const ax = x0 + (f * CW + CW / 2) * S, ay = y0 + (CH + LABEL - 2) * S;
    for (let x = -CW / 2 + 1; x < CW / 2 - 1; x++) put(ax + x * S, ay, [200, 200, 200]); // ground line
    cell(ax, ay, fr.pixels);
  }
});

// Minimal PNG encoder.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; img.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${names.length} animations -> ${out} (${W}x${H})`);
