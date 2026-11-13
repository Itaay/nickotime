// node tools/icons.mjs — renders the app icon (PNG + SVG) without dependencies.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [14, 23, 38], TRACK = [36, 49, 74], GREEN = [16, 169, 95], WHITE = [255, 255, 255];
const R = 0.5, W = 0.13, DOT = 0.15, ARC = 1.5 * Math.PI;

function color(x, y, px) { // x,y in [-1,1]
  const d = Math.hypot(x, y), a = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);
  const aa = v => Math.max(0, Math.min(1, 0.5 - v / px)); // coverage from signed distance
  let c = BG;
  const mix = (c2, k) => { c = c.map((v, i) => v + (c2[i] - v) * k); };
  const ring = aa(Math.abs(d - R) - W / 2);
  mix(a < ARC ? GREEN : TRACK, ring);
  // round cap at the arc's end
  const ex = R * Math.sin(ARC), ey = -R * Math.cos(ARC);
  mix(GREEN, aa(Math.hypot(x - ex, y - ey) - W / 2));
  mix(WHITE, aa(d - DOT));
  return c;
}

function png(size) {
  const px = 2 / size, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) {
    raw[j * (size * 4 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      const c = color((i + 0.5) * px - 1, (j + 0.5) * px - 1, px);
      raw.set([...c.map(Math.round), 255], j * (size * 4 + 1) + 1 + i * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const dir = new URL('../icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const s of [192, 512]) writeFileSync(new URL(`icon-${s}.png`, dir), png(s));
const ex = 50 + 25 * Math.sin(ARC), ey = 50 - 25 * Math.cos(ARC);
writeFileSync(new URL('icon.svg', dir), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0e1726"/><circle cx="50" cy="50" r="25" fill="none" stroke="#24314a" stroke-width="6.5"/><path d="M50 25A25 25 0 1 1 ${ex} ${ey}" fill="none" stroke="#10a95f" stroke-width="6.5" stroke-linecap="round"/><circle cx="50" cy="50" r="7.5" fill="#fff"/></svg>\n`);
console.log('icons written');
