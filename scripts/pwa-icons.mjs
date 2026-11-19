// Icons of the installable dashboard (v6, conception/v6.md §3.5): the Datick logo (docs/public/logo.svg,
// a ticket on a rounded square) drawn as PNG without any image library — 192 and 512 px, and a
// « maskable » 512 px with the safe margin Android needs. node scripts/pwa-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BLUE = [47, 111, 235], WHITE = [255, 255, 255];
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// Signed distance of a rounded rectangle (negative inside)
const roundRect = (px, py, x0, y0, x1, y1, r) => { const cx = Math.max(x0 + r, Math.min(px, x1 - r)), cy = Math.max(y0 + r, Math.min(py, y1 - r)); const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1; const d = Math.hypot(px - cx, py - cy) - r; return inside && d < 0 ? d : Math.max(d, inside ? -0.0001 : Math.max(x0 - px, px - x1, y0 - py, py - y1)); };
// The logo in a 64-unit box: what colour at (u, v), and how much (0..1)
function logo(u, v, { bg = true } = {}) {
  let col = bg ? BLUE : null;
  // Ticket body (18..46 × 18..46 with side notches of radius 5 at mid-height)
  const inBody = u >= 14 && u <= 50 && v >= 18 && v <= 46 && roundRect(u, v, 14, 18, 50, 46, 4) <= 0;
  const notch = Math.hypot(u - 14, v - 32) < 5 || Math.hypot(u - 50, v - 32) < 5;
  if (inBody && !notch) {
    col = WHITE;
    // Dashed separator at x = 38, lines of text
    if (Math.abs(u - 38) < 1.25 && Math.floor((v - 18) / 3) % 2 === 0) col = BLUE;
    if ((Math.abs(v - 28) < 1.25 && u >= 22 && u <= 32) || (Math.abs(v - 36) < 1.25 && u >= 22 && u <= 29)) col = BLUE;
  }
  return col;
}
function draw(size, { margin = 0, rounded = true } = {}) {
  const S = 4; // supersampling
  return png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = (x + (sx + 0.5) / S) / size * 64, py = (y + (sy + 0.5) / S) / size * 64;
      const inSquare = rounded ? roundRect(px, py, 0, 0, 64, 64, 12) <= 0 : true;
      if (!inSquare) continue;
      // Maskable: the logo shrunk into the safe zone, the square filling everything
      const k = 64 / (64 - 2 * margin);
      const u = margin ? (px - 32) * k + 32 : px, v = margin ? (py - 32) * k + 32 : py;
      const c = (u >= 0 && u <= 64 && v >= 0 && v <= 64) ? logo(u, v) : BLUE;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = S * S;
    return [Math.round(r / Math.max(1, a / 255)), Math.round(g / Math.max(1, a / 255)), Math.round(b / Math.max(1, a / 255)), Math.round(a / n)];
  });
}
mkdirSync('dashboard/public/icons', { recursive: true });
writeFileSync('dashboard/public/icons/icon-192.png', draw(192));
writeFileSync('dashboard/public/icons/icon-512.png', draw(512));
writeFileSync('dashboard/public/icons/maskable-512.png', draw(512, { margin: 10, rounded: false }));
writeFileSync('dashboard/public/icons/apple-touch-icon.png', draw(180, { rounded: false }));
console.log('icônes écrites dans dashboard/public/icons/');
