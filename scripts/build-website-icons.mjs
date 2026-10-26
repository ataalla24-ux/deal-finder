import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Render the existing vector artwork; no runtime image dependency is required.
const { default: sharp } = await import(process.env.SHARP_MODULE || 'sharp');
const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const source = fs.readFileSync(path.join(docs, 'icon-192.svg'));
for (const [name, size] of [['favicon-96x96.png', 96], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await sharp(source).resize(size, size).png().toFile(path.join(docs, name));
}
await sharp(source).resize(180, 180).flatten({ background: '#ff752b' }).png().toFile(path.join(docs, 'apple-touch-icon.png'));
await sharp(path.join(docs, 'icon-maskable.svg')).resize(512, 512).png().toFile(path.join(docs, 'icon-maskable.png'));

const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push(await sharp(source).resize(size, size).png().toBuffer());
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [i, size] of sizes.entries()) {
  const entry = 6 + i * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
}
fs.writeFileSync(path.join(docs, 'favicon.ico'), Buffer.concat([header, ...images]));
console.log('Rendered PNG, Apple touch and multi-size ICO icons from existing FreeFinder artwork.');
