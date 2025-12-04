import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const icons = [
  { svg: 'icon-192.svg', png: 'icon-192.png', size: 192 },
  { svg: 'icon-512.svg', png: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', png: 'icon-maskable.png', size: 512 },
  { svg: 'apple-touch-icon.svg', png: 'apple-touch-icon.png', size: 180 },
];

async function generateIcons() {
  for (const icon of icons) {
    const svgPath = join(publicDir, icon.svg);
    const pngPath = join(publicDir, icon.png);

    const svgBuffer = readFileSync(svgPath);

    await sharp(svgBuffer)
      .resize(icon.size, icon.size)
      .png()
      .toFile(pngPath);

    console.log(`Generated ${icon.png}`);
  }
  console.log('All icons generated!');
}

generateIcons().catch(console.error);
