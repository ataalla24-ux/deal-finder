import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { covers } from './blog-visuals.mjs';

// Optional authoring tool. Published assets require no image dependency at runtime.
const { default: sharp } = await import(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'docs/assets/blog/covers');
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const tones = { green: ['#e7f1eb', '#164b38'], rose: ['#f9e8ed', '#7b2947'], blue: ['#e9f0fa', '#234d79'], yellow: ['#fff4cf', '#60501b'] };
fs.mkdirSync(destination, { recursive: true });
for (const [slug, cover] of Object.entries(covers)) {
  const [background, ink] = tones[cover.tone];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="${background}"/><rect x="840" width="360" height="630" fill="#ffffff"/>
    <g font-family="Arial, Helvetica, sans-serif" fill="${ink}">
      <text x="64" y="87" font-size="26" font-weight="700">FreeFinder</text>
      <path d="M64 121H776" stroke="${ink}" stroke-opacity=".22"/>
      <text x="64" y="202" font-size="23">${escape(cover.topic)}</text>
      ${cover.lines.map((line, i) => `<text x="60" y="${309 + i * 88}" font-size="${line.length > 19 ? 58 : 66}" font-weight="700">${escape(line)}</text>`).join('')}
      <text x="64" y="565" font-size="22">freefinder.at / blog</text>
      ${cover.brand ? '' : '<text x="897" y="320" font-size="76" font-weight="700">WIEN</text><text x="902" y="362" font-size="25">DER GUIDE</text>'}
    </g></svg>`;
  const overlays = cover.brand ? [{ input: await sharp(path.join(destination, 'logos', `${cover.brand}.png`)).resize(256, 256, { fit: 'contain' }).toBuffer(), left: 892, top: 187 }] : [];
  const buffer = await sharp(Buffer.from(svg)).composite(overlays).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  fs.writeFileSync(path.join(destination, `${slug}.jpg`), buffer);
  await sharp(buffer).resize(480).webp({ quality: 82 }).toFile(path.join(destination, `${slug}-480.webp`));
}
console.log(`Rendered ${Object.keys(covers).length} editorial covers and mobile thumbnails.`);
