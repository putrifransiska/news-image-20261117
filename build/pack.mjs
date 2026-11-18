// Shrink a rendered RGB(A) PNG into a small palette PNG with no dithering, so flat colours and text stay sharp.
// Usage: node pack.mjs raw.png out.png [colours=64] [page.html]
// Standard library only: PNG decode/encode with node:zlib, palette by median cut refined with k-means.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';

const [inp, out, ncArg, pageArg] = process.argv.slice(2);
const NC = Number(ncArg ?? 64); // total palette size (named design colours count towards it)

function decode(buf) {
  let p = 8, w, h, ct, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('need 8-bit non-interlaced'); }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0; if (!bpp) throw new Error('colour type ' + ct);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(w * h * 3);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) px[(y * w + x) * 3 + k] = cur[x * bpp + k];
    [prev, cur] = [cur, prev];
  }
  return { w, h, px };
}

const { w, h, px } = decode(readFileSync(inp));
// histogram of exact colours
const hist = new Map();
for (let i = 0; i < w * h; i++) { const k = (px[i * 3] << 16) | (px[i * 3 + 1] << 8) | px[i * 3 + 2]; hist.set(k, (hist.get(k) ?? 0) + 1); }
const cols = [...hist].map(([k, n]) => [k >> 16, (k >> 8) & 255, k & 255, n]);
// fixed entries: the most used exact colours (paper, ink, region colours) stay exact
// plus every colour the design names (#rrggbb / #rgb in the page) that the render shows on 20+ pixels
const byUse = cols.slice().sort((a, b) => b[3] - a[3]);
const named = new Set();
if (pageArg) for (const m of readFileSync(pageArg, 'utf8').matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
  let hx = m[1]; if (hx.length === 3) hx = [...hx].map((c) => c + c).join(''); const k = parseInt(hx, 16); if ((hist.get(k) ?? 0) >= 20) named.add(k);
}
for (const q of byUse.slice(0, 12)) named.add((q[0] << 16) | (q[1] << 8) | q[2]);
const fixed = [...named].map((k) => [k >> 16, (k >> 8) & 255, k & 255]);
const NF = fixed.length;
const d2 = (p, r, g, b) => (p[0] - r) ** 2 * 3 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 2;
const rest = cols.filter((q) => !fixed.some((f) => d2(f, q[0], q[1], q[2]) < 40));
// median cut on what the fixed colours do not cover
let boxes = rest.length ? [rest] : [];
while (boxes.length && boxes.length < NC - NF) {
  let bi = -1, best = -1, ax = 0;
  boxes.forEach((b, i) => {
    if (b.length < 2) return;
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0, n = 0; for (const q of b) { lo = Math.min(lo, q[c]); hi = Math.max(hi, q[c]); n += q[3]; }
      const score = (hi - lo) * Math.sqrt(n); if (score > best) { best = score; bi = i; ax = c; }
    }
  });
  if (bi < 0) break;
  const b = boxes[bi].sort((p, q) => p[ax] - q[ax]); let tot = 0; for (const q of b) tot += q[3];
  let acc = 0, cut = 1; for (let i = 0; i < b.length - 1; i++) { acc += b[i][3]; if (acc >= tot / 2) { cut = i + 1; break; } }
  boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
}
let pal = fixed.concat(boxes.map((b) => { let r = 0, g = 0, bl = 0, n = 0; for (const q of b) { r += q[0] * q[3]; g += q[1] * q[3]; bl += q[2] * q[3]; n += q[3]; } return [r / n, g / n, bl / n]; }));
const nearest = (r, g, b) => { let bi = 0, bd = 1e9; for (let i = 0; i < pal.length; i++) { const d = d2(pal[i], r, g, b); if (d < bd) { bd = d; bi = i; } } return bi; };
// k-means: move only the free entries
for (let it = 0; it < 10; it++) {
  const acc = pal.map(() => [0, 0, 0, 0]);
  for (const q of cols) { const i = nearest(q[0], q[1], q[2]); const a = acc[i]; a[0] += q[0] * q[3]; a[1] += q[1] * q[3]; a[2] += q[2] * q[3]; a[3] += q[3]; }
  pal = pal.map((p, i) => (i >= NF && acc[i][3] ? [acc[i][0] / acc[i][3], acc[i][1] / acc[i][3], acc[i][2] / acc[i][3]] : p));
}
pal = pal.map((p) => p.map((v) => Math.round(v)));
const map = new Map(); for (const q of cols) map.set((q[0] << 16) | (q[1] << 8) | q[2], nearest(q[0], q[1], q[2]));
// order palette by use so low indices repeat (helps deflate a little)
const use = new Array(pal.length).fill(0); for (const q of cols) use[map.get((q[0] << 16) | (q[1] << 8) | q[2])] += q[3];
const order = pal.map((_, i) => i).filter((i) => use[i]).sort((a, b) => use[b] - use[a]); const re = new Map(order.map((o, i) => [o, i]));
pal = order.map((i) => pal[i]);
const bits = pal.length <= 2 ? 1 : pal.length <= 4 ? 2 : pal.length <= 16 ? 4 : 8;
const idx = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) idx[i] = re.get(map.get((px[i * 3] << 16) | (px[i * 3 + 1] << 8) | px[i * 3 + 2]));
// pack rows; for palette images filter 0 is usually best, but try each filter type per whole image
const stride = Math.ceil((w * bits) / 8);
const packRow = (y) => { const r = Buffer.alloc(stride); for (let x = 0; x < w; x++) { const v = idx[y * w + x]; const bitpos = x * bits; r[bitpos >> 3] |= v << (8 - bits - (bitpos & 7)); } return r; };
const rows = []; for (let y = 0; y < h; y++) rows.push(packRow(y));
function filtered(ft) {
  const outb = Buffer.alloc(h * (stride + 1)); const bpp = 1;
  for (let y = 0; y < h; y++) {
    const r = rows[y], pr = y ? rows[y - 1] : Buffer.alloc(stride); outb[y * (stride + 1)] = ft;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? r[i - bpp] : 0, b = pr[i], c = i >= bpp ? pr[i - bpp] : 0; let v = r[i];
      if (ft === 1) v -= a; else if (ft === 2) v -= b; else if (ft === 3) v -= (a + b) >> 1;
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v -= pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      outb[y * (stride + 1) + 1 + i] = v & 255;
    }
  }
  return outb;
}
let bestZ = null;
for (const ft of [0, 1, 2, 4]) for (const strategy of [0, 1]) {
  const z = deflateSync(filtered(ft), { level: 9, memLevel: 9, windowBits: 15, strategy });
  if (!bestZ || z.length < bestZ.length) bestZ = z;
}
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bits; ihdr[9] = 3;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', Buffer.from(pal.flat())), chunk('IDAT', bestZ), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(out, png);
let err = 0; for (let i = 0; i < w * h; i++) { const p = pal[idx[i]]; err += Math.abs(p[0] - px[i * 3]) + Math.abs(p[1] - px[i * 3 + 1]) + Math.abs(p[2] - px[i * 3 + 2]); }
console.log(`${out}: ${png.length} bytes, ${pal.length} colours (${NF} fixed), ${bits}-bit, mean abs error ${(err / (w * h * 3)).toFixed(2)}`);
