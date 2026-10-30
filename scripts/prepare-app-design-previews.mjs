import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Pass the directory containing the approved six-image manifest');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
if (manifest.status !== 'owner_approved_all_six_generated_designs' || manifest.images.length !== 6) {
  throw new Error('Expected the existing owner-approved six-image design set');
}
const destination = path.join(root, 'docs/assets/klar-urban-20261030');
fs.mkdirSync(destination, { recursive: true });
const images = [];
for (const image of manifest.images) {
  if (!/^0[1-6]-[a-z-]+$/.test(image.name)) throw new Error('Unexpected image name');
  const input = path.join(source, image.name + '.png');
  const sha256 = createHash('sha256').update(fs.readFileSync(input)).digest('hex');
  if (sha256 !== image.sha256) throw new Error(`Approved source changed: ${image.name}`);
  const variants = [];
  for (const width of [360, 720]) {
    const file = `${image.name}-${width}.webp`;
    execFileSync('cwebp', ['-quiet', '-q', '90', '-m', '6', '-resize', String(width), '0', input, '-o', path.join(destination, file)]);
    variants.push({ file, width, bytes: fs.statSync(path.join(destination, file)).size });
  }
  images.push({ name: image.name, sourceSha256: sha256, inputWidth: image.width, inputHeight: image.height, variants });
}
fs.writeFileSync(path.join(destination, 'sources.json'), JSON.stringify({
  source: 'Existing owner-approved Klar x Urban individual designs, 2026-10-18',
  actualNativeCaptures: false,
  newlyGenerated: false,
  disclosure: 'Illustrative design previews with sample merchants, offers, map and savings; not verified current offers.',
  processing: 'Proportional WebP conversion only; no new generation or content edits',
  images,
}, null, 2) + '\n');
console.log(`Prepared ${images.length} approved design previews and 12 responsive WebP assets`);
