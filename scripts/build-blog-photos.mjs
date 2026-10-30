import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { photoRecipes, articlePhotos } from './blog-photo-catalog.mjs';

// Authoring only. Serving and normalizing committed photos needs no image runtime.
const { default: sharp } = await import(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'docs/assets/blog/photos');
await fs.mkdir(destination, { recursive: true });
const atlases = [
  ['DealsHomeFood.imageset/food-atlas.jpg', 2, 0],
  ['DealsHomeTopics.imageset/deals-home-topics.jpg', 4, 4],
  ...['A', 'B', 'C', 'D'].map((letter, i) => [`DealsHomeVariety${letter}.imageset/deals-home-variety-${letter.toLowerCase()}.jpg`, 4, 20 + i * 16]),
];
const selected = process.argv.slice(2).map(slug => articlePhotos[slug] || slug);
for (const key of selected) if (!Object.hasOwn(photoRecipes, key)) throw new Error(`Unknown photographic subject: ${key}`);
let sources = {};
try { sources = JSON.parse(await fs.readFile(path.join(destination, 'sources.json'), 'utf8')).photos; } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const [key, recipe] of Object.entries(photoRecipes).filter(([key]) => !selected.length || selected.includes(key))) {
  let file, crop;
  if (recipe.generated) {
    if (!process.env.BLOG_PHOTO_SOURCE_DIR) throw new Error('Set BLOG_PHOTO_SOURCE_DIR to the saved generated-photo directory.');
    file = path.join(process.env.BLOG_PHOTO_SOURCE_DIR, recipe.generated);
  } else if (recipe.existing) file = path.join(root, 'docs', recipe.existing);
  else {
    if (!process.env.NATIVE_ASSETS_ROOT) throw new Error('Set NATIVE_ASSETS_ROOT to the existing Assets.xcassets directory.');
    if (recipe.nativeIndex === 86) file = path.join(process.env.NATIVE_ASSETS_ROOT, 'DealsHomeSpecific86.imageset/deals-home-durum.jpg');
    else {
      const [atlas, columns, start] = atlases.find(([, count, start]) => recipe.nativeIndex >= start && recipe.nativeIndex < start + count * count);
      file = path.join(process.env.NATIVE_ASSETS_ROOT, atlas);
      const { width, height } = await sharp(file).metadata();
      const cell = recipe.nativeIndex - start, column = cell % columns, row = Math.floor(cell / columns);
      const left = Math.floor(column * width / columns), top = Math.floor(row * height / columns);
      crop = { left, top, width: Math.floor((column + 1) * width / columns) - left, height: Math.floor((row + 1) * height / columns) - top };
    }
  }
  const original = await fs.readFile(file);
  const input = crop ? await sharp(original).extract(crop).toBuffer() : original;
  const position = key === 'furniture' ? 'south' : 'centre';
  const resized = await sharp(input).resize(1200, 630, { fit: 'cover', position }).png().toBuffer();
  let jpeg;
  for (const quality of [84, 80, 76, 72, 68, 64, 60]) {
    jpeg = await sharp(resized).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length < 160000) break;
  }
  if (jpeg.length >= 160000) throw new Error(`${key}: photographic JPEG exceeds 160 KB`);
  let webp;
  for (const quality of [84, 80, 76, 72, 68, 64, 60, 56]) {
    webp = await sharp(resized).webp({ quality }).toBuffer();
    if (webp.length < 160000) break;
  }
  if (webp.length >= 160000) throw new Error(`${key}: photographic WebP exceeds 160 KB`);
  let thumbnail;
  for (const quality of [82, 78, 74, 70, 66, 62, 58]) {
    thumbnail = await sharp(resized).resize(480).webp({ quality }).toBuffer();
    if (thumbnail.length < 35000) break;
  }
  if (thumbnail.length >= 35000) throw new Error(`${key}: photographic thumbnail exceeds 35 KB`);
  await fs.writeFile(path.join(destination, `${key}.jpg`), jpeg);
  await fs.writeFile(path.join(destination, `${key}.webp`), webp);
  await fs.writeFile(path.join(destination, `${key}-480.webp`), thumbnail);
  const inputMetadata = await sharp(input).metadata();
  sources[key] = { kind: 'generated-editorial-symbol-photo', subject: recipe.subject,
    source: recipe.generated || recipe.existing || `native-artwork-index-${recipe.nativeIndex}`,
    sourceSha256: createHash('sha256').update(original).digest('hex'), nativeIndex: recipe.nativeIndex, crop,
    inputWidth: inputMetadata.width, inputHeight: inputMetadata.height,
    width: 1200, height: 630, bytes: jpeg.length, webpBytes: webp.length, thumbnailWidth: 480, thumbnailBytes: thumbnail.length,
    overlays: false };
}
await fs.writeFile(path.join(destination, 'sources.json'), JSON.stringify({
  description: 'Photographic editorial illustrations only; no merchant-product documentation or added text/logo/price overlays.',
  generatedPhotoMethod: 'Built-in image_gen for supplemental source photos; existing native/editorial imagery reused for other subjects. No API-key CLI.',
  photos: sources,
}, null, 2) + '\n');
console.log(`Prepared ${Object.keys(sources).length} photographic subjects with 1200px JPEG and 480px WebP assets.`);
