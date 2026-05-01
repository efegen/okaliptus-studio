// Generates placeholder PWA icons into public/
// Pure Node — no external deps. Re-run with `node scripts/generate-pwa-icons.mjs`
// when the real logo arrives, replace the drawing logic and re-emit.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 as zlibCrc32 } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');

const TERRA = [0xa6, 0x4b, 0x2a, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const CLEAR = [0, 0, 0, 0];

function blend(dst, src) {
  const a = src[3] / 255;
  return [
    Math.round(src[0] * a + dst[0] * (1 - a)),
    Math.round(src[1] * a + dst[1] * (1 - a)),
    Math.round(src[2] * a + dst[2] * (1 - a)),
    Math.max(dst[3], src[3]),
  ];
}

function makeBuffer(size) {
  const buf = new Uint8Array(size * size * 4);
  return { size, buf };
}

function setPx(img, x, y, color) {
  if (x < 0 || y < 0 || x >= img.size || y >= img.size) return;
  const i = (y * img.size + x) * 4;
  const dst = [img.buf[i], img.buf[i + 1], img.buf[i + 2], img.buf[i + 3]];
  const out = blend(dst, color);
  img.buf[i] = out[0];
  img.buf[i + 1] = out[1];
  img.buf[i + 2] = out[2];
  img.buf[i + 3] = out[3];
}

function fillSquare(img, color) {
  for (let y = 0; y < img.size; y++) {
    for (let x = 0; x < img.size; x++) setPx(img, x, y, color);
  }
}

// AA disk: coverage = clamp(0.5 + (r - dist), 0, 1)
function fillDisk(img, cx, cy, r, color) {
  const minX = Math.max(0, Math.floor(cx - r - 1));
  const maxX = Math.min(img.size - 1, Math.ceil(cx + r + 1));
  const minY = Math.max(0, Math.floor(cy - r - 1));
  const maxY = Math.min(img.size - 1, Math.ceil(cy + r + 1));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.max(0, Math.min(1, 0.5 + (r - d)));
      if (cov <= 0) continue;
      setPx(img, x, y, [color[0], color[1], color[2], Math.round(color[3] * cov)]);
    }
  }
}

// AA ring: outerR..innerR
function fillRing(img, cx, cy, outerR, innerR, color) {
  const minX = Math.max(0, Math.floor(cx - outerR - 1));
  const maxX = Math.min(img.size - 1, Math.ceil(cx + outerR + 1));
  const minY = Math.max(0, Math.floor(cy - outerR - 1));
  const maxY = Math.min(img.size - 1, Math.ceil(cy + outerR + 1));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const outerCov = Math.max(0, Math.min(1, 0.5 + (outerR - d)));
      const innerCov = Math.max(0, Math.min(1, 0.5 + (d - innerR)));
      const cov = Math.min(outerCov, innerCov);
      if (cov <= 0) continue;
      setPx(img, x, y, [color[0], color[1], color[2], Math.round(color[3] * cov)]);
    }
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const td = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlibCrc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(img) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.size, 0);
  ihdr.writeUInt32BE(img.size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowLen = img.size * 4;
  const raw = Buffer.alloc((rowLen + 1) * img.size);
  for (let y = 0; y < img.size; y++) {
    raw[y * (rowLen + 1)] = 0; // filter: None
    Buffer.from(img.buf.subarray(y * rowLen, (y + 1) * rowLen)).copy(raw, y * (rowLen + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Draw an "O" (ring) centered, using bg + ring colors.
function drawOIcon({ size, fillEntireSquare, oRadiusFactor, ringThicknessFactor }) {
  const img = makeBuffer(size);
  const cx = size / 2;
  const cy = size / 2;
  if (fillEntireSquare) {
    fillSquare(img, TERRA);
  } else {
    // full-bleed terracotta disk
    fillDisk(img, cx, cy, size / 2, TERRA);
  }
  const outerR = size * oRadiusFactor;
  const innerR = outerR - size * ringThicknessFactor;
  fillRing(img, cx, cy, outerR, innerR, WHITE);
  return encodePng(img);
}

mkdirSync(PUBLIC, { recursive: true });

// Standard PWA icons — full-bleed terracotta disk, white O in center.
writeFileSync(resolve(PUBLIC, 'pwa-192.png'), drawOIcon({
  size: 192,
  fillEntireSquare: false,
  oRadiusFactor: 0.30,
  ringThicknessFactor: 0.075,
}));

writeFileSync(resolve(PUBLIC, 'pwa-512.png'), drawOIcon({
  size: 512,
  fillEntireSquare: false,
  oRadiusFactor: 0.30,
  ringThicknessFactor: 0.075,
}));

// Maskable: full square fill, "O" inside 80% safe zone (radius <= 0.4 of size).
writeFileSync(resolve(PUBLIC, 'pwa-512-maskable.png'), drawOIcon({
  size: 512,
  fillEntireSquare: true,
  oRadiusFactor: 0.24,   // well within 0.4 safe zone
  ringThicknessFactor: 0.06,
}));

// Apple touch icon: square (Apple rounds the corners itself).
writeFileSync(resolve(PUBLIC, 'apple-touch-icon.png'), drawOIcon({
  size: 180,
  fillEntireSquare: true,
  oRadiusFactor: 0.30,
  ringThicknessFactor: 0.075,
}));

// favicon.svg — simple vector version.
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="32" fill="#a64b2a"/>
  <circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" stroke-width="5"/>
</svg>
`;
writeFileSync(resolve(PUBLIC, 'favicon.svg'), FAVICON);

console.log('Wrote PWA icons to', PUBLIC);
