// Compresses public/logo-original.png down to a 256×256 PNG + WebP pair for
// the brand logo. Re-run with `node scripts/compress-logo.mjs` if the source
// asset changes. Targets: PNG <30KB, WebP <10KB. Logo is shown at 44–48px,
// so 256 gives plenty of headroom for retina displays without bloat.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');

const SOURCE = resolve(PUBLIC, 'logo-original.png');
const PNG_OUT = resolve(PUBLIC, 'logo.png');
const WEBP_OUT = resolve(PUBLIC, 'logo.webp');
const TARGET_SIZE = 256;

const input = await readFile(SOURCE);

await sharp(input)
  .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'inside', withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toFile(PNG_OUT);

await sharp(input)
  .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 55, effort: 6, alphaQuality: 70, smartSubsample: true })
  .toFile(WEBP_OUT);

const fmt = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const src = await stat(SOURCE);
const png = await stat(PNG_OUT);
const webp = await stat(WEBP_OUT);

console.log(`source ${SOURCE.split(/[\\/]/).pop()}: ${fmt(src.size)}`);
console.log(`→ logo.png:  ${fmt(png.size)}  (target <30 KB)  ${png.size < 30 * 1024 ? 'OK' : 'OVER'}`);
console.log(`→ logo.webp: ${fmt(webp.size)} (target <10 KB)  ${webp.size < 10 * 1024 ? 'OK' : 'OVER'}`);
