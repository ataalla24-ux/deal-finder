import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {DEAL_IMAGE_PILOT_ASSETS} from '../scraper/deal-image-pilot.js';
import {normalizeOriginalPhoto} from './original-deal-photo.mjs';
import {photoDigest} from './deal-photo-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory = path.join(root,'docs/assets/deal-image-pilot');
const provenance = JSON.parse(fs.readFileSync(path.join(root,'docs/assets/blog/photos/sources.json'),'utf8'));
const catalog = {version:1,assets:{}};
const label = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="400"><rect x="428" y="320" width="224" height="54" rx="8" fill="white" fill-opacity="0.96"/><text x="540" y="357" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="600" fill="#161616">Symbolbild</text></svg>');
for (const asset of DEAL_IMAGE_PILOT_ASSETS) {
  const proof = provenance.photos?.[asset.key];
  if (proof?.kind !== 'generated-editorial-symbol-photo' || proof.subject !== asset.subject || proof.overlays !== false
    || proof.inputWidth < 600 || proof.inputHeight < 400)
    throw Error('Owned image provenance changed');
  const source = fs.readFileSync(path.join(root,'docs/assets/blog/photos',`${asset.key}.jpg`));
  const rendered = await sharp(source,{failOn:'warning',limitInputPixels:12_000_000}).rotate()
    .resize(1080,400,{fit:'cover',position:'centre'}).composite([{input:label}]).toColourspace('srgb').jpeg({quality:90}).toBuffer();
  const {bytes} = await normalizeOriginalPhoto(rendered);
  const sha256 = photoDigest(bytes), file = `${asset.key}-${sha256}.jpg`;
  fs.mkdirSync(directory,{recursive:true});
  const output = path.join(directory,file);
  if (fs.existsSync(output)) {
    if (!fs.readFileSync(output).equals(bytes)) throw Error('Immutable preview contents changed');
  } else fs.writeFileSync(output,bytes,{flag:'wx'});
  catalog.assets[asset.key] = {key:asset.key,kind:'editorial-illustration',file,sha256,sourceSha256:photoDigest(source),
    provenanceSha256:proof.sourceSha256,width:1080,height:400,label:'Symbolbild',
    labelBounds:{left:428,top:320,width:224,height:54}};
}
fs.writeFileSync(path.join(directory,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
