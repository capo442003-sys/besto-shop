import sharp from 'sharp';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');
const logoPng = path.join(publicDir, 'logo-bmb.png');
const logoSvgPath = path.join(publicDir, 'logo-icon.svg');
const logoSource = existsSync(logoPng) ? logoPng : logoSvgPath;
const logoSvg = readFileSync(logoSvgPath);

const brandBg = { r: 26, g: 61, b: 40, alpha: 1 };

const maskableSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#1a3d28"/>
  <circle cx="256" cy="220" r="88" fill="#f0c84a" opacity="0.95"/>
  <path d="M96 400c48-96 112-144 160-144s112 48 160 144" stroke="#f0c84a" stroke-width="16" fill="none" opacity="0.55"/>
</svg>`);

const icons = [
  { file: 'apple-touch-icon.png', size: 180, source: logoSource, pad: 0.08 },
  { file: 'pwa-192x192.png', size: 192, source: logoSource, pad: 0.08 },
  { file: 'pwa-512x512.png', size: 512, source: logoSource, pad: 0.08 },
  { file: 'pwa-maskable-512x512.png', size: 512, source: maskableSvg, pad: 0 },
];

for (const { file, size, source, pad } of icons) {
  const out = path.join(publicDir, file);
  const inner = Math.round(size * (1 - pad * 2));
  const offset = Math.round((size - inner) / 2);
  const resized = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: brandBg })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: brandBg,
    },
  })
    .composite([{ input: resized, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`Generated ${file} (${size}x${size})`);
}
