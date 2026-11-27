import {createHash} from 'node:crypto';
import {dealImageAssetKey} from '../scraper/deal-image-subject.js';
import {GENERATED_PHOTO_LABEL_BOUNDS,generatedPhotoInputHash,generatedPhotoIdentityHash,generatedPhotoSubjectHash} from './deal-photo-contract.mjs';
export {GENERATED_PHOTO_LABEL_BOUNDS,generatedPhotoInputHash,generatedPhotoIdentityHash,generatedPhotoSubjectHash,
  normalizeGeneratedPhotoDraft,generatedPhotoDraftMatches,generatedPhotoApproval,validateGeneratedPhotoReceipt} from './deal-photo-contract.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').replace(/\s+/g,' ').trim();
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validModel = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);

export async function prepareGeneratedPhoto(deal,{
  generationKey,promptHash,visualSubject,model,generatedAt=new Date().toISOString(),
},sourceBytes,now=new Date()) {
  if (!clean(deal?.id) || !validHash(generationKey) || !validHash(promptHash) || !validModel(model)
    || typeof visualSubject !== 'string' || !visualSubject.trim() || visualSubject.length > 1200
    || !validTime(generatedAt) || !Buffer.isBuffer(sourceBytes) || sourceBytes.length > 20_000_000) {
    throw Error('generated-photo-input-invalid');
  }
  const {default:sharp} = await import('sharp');
  const image = sharp(sourceBytes,{failOn:'warning',limitInputPixels:12_000_000});
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width < 1080 || metadata.height < 400
    || (metadata.pages || 1) !== 1) throw Error('generated-photo-size-invalid');
  const label = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="400"><rect x="428" y="320" width="224" height="54" rx="8" fill="white" fill-opacity="0.96"/><text x="540" y="357" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="600" fill="#161616">Symbolbild</text></svg>');
  const rendered = await image.rotate().resize(1080,400,{fit:'cover',position:'centre',withoutEnlargement:true})
    .composite([{input:label}]).toColourspace('srgb').jpeg({quality:90}).toBuffer();
  const {normalizeOriginalPhoto,prepareOriginalPhoto} = await import('./original-deal-photo.mjs');
  const {bytes} = await normalizeOriginalPhoto(rendered);
  const sha256 = digest(bytes);
  const photoUrl = `https://freefinder.at/assets/approved-deal-photos/${digest(String(deal.id)).slice(0,16)}-${sha256}.jpg`;
  const generatedDealImage = {version:1,sourceKind:'generated-owned',generationKey,inputHash:generatedPhotoInputHash(deal),
    identityHash:generatedPhotoIdentityHash(deal),photoUrl,sha256,assetKey:dealImageAssetKey(deal),
    visualSubject:clean(visualSubject),promptHash,model,generatedAt};
  const prepared = await prepareOriginalPhoto(deal,{
    dealId:deal.id,sourceURL:photoUrl,rights:'owned-original',
    rightsEvidence:`FreeFinder generated editorial illustration. Generation ${generationKey}; model ${model}; prompt ${promptHash}.`,
    reviewedBy:'FreeFinder generated image preparation',kind:'editorial-illustration',
    matchesOffer:true,showsActualProduct:false,showsIllustratedProduct:true,cropChecked:true,
  },bytes,now,{reuseNormalizedBytes:true});
  prepared.review.subjectHash = generatedPhotoSubjectHash(deal,generatedDealImage);
  prepared.review.generation = generatedDealImage;
  prepared.review.renderedDisclosure = {version:2,sourceKind:'generated-owned',label:'Symbolbild',
    imageSha256:sha256,bounds:{...GENERATED_PHOTO_LABEL_BOUNDS}};
  return {...prepared,photoUrl,generatedDealImage};
}
