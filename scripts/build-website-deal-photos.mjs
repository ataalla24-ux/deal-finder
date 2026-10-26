import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { photoDefinitions } from './deal-photos.mjs';

// Authoring only: extract the exact same cells as native DealsHomeImages.grid().
const { default: sharp } = await import(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.NATIVE_ASSETS_ROOT) throw new Error('Set NATIVE_ASSETS_ROOT to the existing iOS Assets.xcassets directory.');
const native = path.resolve(process.env.NATIVE_ASSETS_ROOT);
const destination = path.join(root, 'docs/assets/deal-photos');
await fs.mkdir(destination, { recursive: true });
const atlases = [
  ['DealsHomeFood.imageset/food-atlas.jpg', 2, 0],
  ['DealsHomeTopics.imageset/deals-home-topics.jpg', 4, 4],
  ...['A', 'B', 'C', 'D'].map((letter, i) => [`DealsHomeVariety${letter}.imageset/deals-home-variety-${letter.toLowerCase()}.jpg`, 4, 20 + i * 16]),
];
const sources = {};
const photos = {};
for (const [key, [index, subject]] of Object.entries(photoDefinitions)) {
  const [file, columns, start] = atlases.find(([, columns, start]) => index >= start && index < start + columns * columns);
  if (!sources[file]) {
    const bytes = await fs.readFile(path.join(native, file));
    sources[file] = { bytes, metadata: await sharp(bytes).metadata(), sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const { bytes, metadata, sha256 } = sources[file];
  const cell = index - start, column = cell % columns, row = Math.floor(cell / columns);
  const left = Math.floor(column * metadata.width / columns), top = Math.floor(row * metadata.height / columns);
  const width = Math.floor((column + 1) * metadata.width / columns) - left;
  const height = Math.floor((row + 1) * metadata.height / columns) - top;
  const tile = await sharp(bytes).extract({ left, top, width, height }).toBuffer();
  const full = await sharp(tile).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 86 }).toFile(path.join(destination, `${key}.webp`));
  const thumb = await sharp(tile).resize({ width: 160, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(destination, `${key}-160.webp`));
  photos[key] = { nativeIndex: index, subject, source: file, sourceSha256: sha256, crop: { left, top, width, height },
    width: full.width, height: full.height, thumbWidth: thumb.width, bytes: full.size, thumbBytes: thumb.size };
}
await fs.writeFile(path.join(destination, 'sources.json'), JSON.stringify({
  kind: 'Existing generated editorial symbol photos from the native app, not merchant/product documentation',
  sourceRenderer: 'FreeFinderWien/DealsHomeStyle.swift: DealsHomeImages.grid',
  photos,
}, null, 2) + '\n');
console.log(`Exported ${Object.keys(photos).length} existing app motifs with responsive thumbnails; native files unchanged.`);
