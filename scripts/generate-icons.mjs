import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '../public/logo-original.png');
const out = path.join(__dirname, '../public');

// Tema rengi: krem (#f5efe6)
const BG = { r: 245, g: 239, b: 230, alpha: 1 };

async function makeIcon(size, filename, paddingRatio = 0.15) {
  const pad = Math.round(size * paddingRatio);
  const logoSize = size - pad * 2;

  const logo = await sharp(src)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toFile(path.join(out, filename));

  console.log(`✓  ${filename}  (${size}×${size})`);
}

// apple-touch-icon: 180×180, iOS standart
await makeIcon(180, 'apple-touch-icon.png', 0.12);

// PWA manifest icons
await makeIcon(192, 'pwa-192.png', 0.12);
await makeIcon(512, 'pwa-512.png', 0.12);

// Maskable: safe-zone %80 → padding %10 yeterli ama genelde %15–20 önerilir
await makeIcon(512, 'pwa-512-maskable.png', 0.18);

console.log('\nTüm ikonlar oluşturuldu!');
