import fs from 'node:fs';
import path from 'node:path';
import {approvedDealPhotoURL, inspectOriginalJPEG, photoDigest, photoSubjectHash} from './deal-photo-contract.mjs';

function boundedRead(file, base, maximum) {
  const real = fs.realpathSync(file);
  if (!real.startsWith(fs.realpathSync(base)+path.sep)) throw Error('photo-path-outside-review');
  const size = fs.statSync(real).size;
  if (size <= 0 || size > maximum) throw Error('photo-file-size');
  return fs.readFileSync(real);
}

export function validatePhotoPermission(request) {
  for (const key of ['dealId','sourceURL','rightsEvidence','reviewedBy']) {
    if (typeof request[key] !== 'string' || !request[key].trim()) throw Error(`Missing ${key}`);
  }
  const url = new URL(request.sourceURL);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid public source URL');
  if (!['merchant-permission','owned-original'].includes(request.rights) || request.revoked === true)
    throw Error('Document current permission or ownership; public visibility is not permission');
  if(request.kind!==undefined && !['merchant-photo','editorial-illustration'].includes(request.kind))throw Error('Unknown image kind');
  const illustration=request.kind==='editorial-illustration';
  if(illustration && (request.rights!=='owned-original' || request.showsActualProduct!==false || request.showsIllustratedProduct!==true))
    throw Error('Owned editorial illustrations must not claim an actual merchant product');
  if (request.matchesOffer !== true || (!illustration && request.showsActualProduct !== true) || request.cropChecked !== true)
    throw Error('Review product relevance, visible food and 2.7:1 crop first');
}

export async function normalizeOriginalPhoto(bytes, {reuseNormalizedBytes = false} = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1_500_000) throw Error('JPEG required, at most 1.5 MB');
  const size = inspectOriginalJPEG(bytes);
  const {default:sharp} = await import('sharp');
  const options = {failOn:'warning',limitInputPixels:12_000_000};
  const metadata = await sharp(bytes,options).metadata();
  if (metadata.format !== 'jpeg' || (metadata.pages||1)!==1 || metadata.width!==size.width || metadata.height!==size.height)
    throw Error('Invalid original photograph');
  // Re-encoding actually decodes the image and removes metadata, including IPTC/comments.
  if (reuseNormalizedBytes && (metadata.orientation || metadata.exif || metadata.iptc || metadata.xmp || metadata.icc))
    throw Error('Reusable photograph must already be normalized');
  const normalized = reuseNormalizedBytes ? bytes
    : await sharp(bytes,options).rotate().toColourspace('srgb').jpeg({quality:90}).toBuffer();
  const normalizedSize = inspectOriginalJPEG(normalized);
  const width = Math.floor(Math.min(normalizedSize.width,normalizedSize.height*2.7));
  const height = Math.floor(width/2.7);
  if (width<600 || height<222) throw Error('Original card crop is too small');
  const crop = {left:Math.floor((normalizedSize.width-width)/2),top:Math.floor((normalizedSize.height-height)/2),width,height};
  const card = await sharp(normalized,options).extract(crop).jpeg({quality:90}).toBuffer();
  return {bytes:normalized,card,size:normalizedSize,crop};
}

export async function prepareOriginalPhoto(deal, request, sourceBytes, now = new Date(), options = {}) {
  validatePhotoPermission(request);
  if (request.dealId !== deal.id) throw Error('Photo request does not match the deal');
  const {bytes,card,size,crop} = await normalizeOriginalPhoto(sourceBytes, options);
  const filename = `${photoDigest(deal.id).slice(0, 16)}-${photoDigest(bytes)}.jpg`;
  const photoUrl = `https://freefinder.at/assets/approved-deal-photos/${filename}`;
  const review = {version:2,dealId:deal.id,file:filename,sourceURL:request.sourceURL,
    rights:request.rights,rightsEvidence:request.rightsEvidence,reviewedBy:request.reviewedBy,
    matchesOffer:true,cropChecked:true,
    ...(request.kind==='editorial-illustration'?{kind:request.kind,showsActualProduct:false,showsIllustratedProduct:true}:{showsActualProduct:true}),
    titleAtReview:deal.title,brandAtReview:deal.brand,subjectHash:photoSubjectHash(deal),
    photoUrl,...size,crop,sha256:photoDigest(bytes),cardSha256:photoDigest(card),
    originalSha256:photoDigest(sourceBytes),reviewedAt:now.toISOString()};
  return {bytes,card,size,crop,review};
}

export function writePreparedOriginalPhoto(root, {bytes,review}) {
  const directory = path.join(root, 'docs/assets/approved-deal-photos');
  fs.mkdirSync(directory, {recursive: true});
  const destination = path.join(directory, review.file);
  if (fs.existsSync(destination) && !fs.readFileSync(destination).equals(bytes)) throw Error('Existing immutable photo differs');
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, {flag: 'wx'});
  const reviewDir = path.join(root, 'reviews/deal-photos');
  fs.mkdirSync(reviewDir, {recursive: true});
  fs.writeFileSync(path.join(reviewDir, `${review.file}.json`), JSON.stringify(review, null, 2) + '\n');
}

export function readBoundPhotoSnapshot(deal,{root=process.cwd()}={}) {
  if (!deal.photoUrl) return null;
  const url = approvedDealPhotoURL(deal.photoUrl,deal.id);
  if (!url) throw Error('unapproved-photo-url');
  const filename = path.basename(new URL(url).pathname);
  const reviewDirectory = path.join(root,'reviews/deal-photos');
  const review = JSON.parse(boundedRead(path.join(reviewDirectory,filename+'.json'),reviewDirectory,20000));
  validatePhotoPermission(review);
  if (review.version!==2 || review.dealId!==deal.id || review.photoUrl!==url || review.file!==filename
    || review.subjectHash!==photoSubjectHash(deal) || !Number.isFinite(Date.parse(review.reviewedAt)))
    throw Error('original-photo-review-stale');
  const imageDirectory = path.join(root,'docs/assets/approved-deal-photos');
  const bytes = boundedRead(path.join(imageDirectory,filename),imageDirectory,1_500_000);
  if (photoDigest(bytes)!==review.sha256 || filename!==`${photoDigest(deal.id).slice(0,16)}-${review.sha256}.jpg`)
    throw Error('original-photo-integrity-failed');
  if (Object.hasOwn(review,'renderedDisclosure')) {
    const disclosure = review.renderedDisclosure;
    const previewDirectory = path.join(root,'docs/assets/deal-image-pilot');
    const catalog = JSON.parse(boundedRead(path.join(previewDirectory,'catalog.json'),previewDirectory,100_000));
    const asset = catalog.assets?.[disclosure?.assetKey];
    if (catalog.version!==1 || review.kind!=='editorial-illustration' || !asset
      || disclosure.label!=='Symbolbild' || asset.label!=='Symbolbild'
      || disclosure.imageSha256!==review.sha256 || asset.sha256!==review.sha256
      || asset.file!==`${disclosure.assetKey}-${review.sha256}.jpg`
      || review.sourceURL!==`https://freefinder.at/assets/deal-image-pilot/${asset.file}`
      || JSON.stringify(asset.labelBounds)!==JSON.stringify({left:428,top:320,width:224,height:54})
      || JSON.stringify(disclosure.bounds)!==JSON.stringify(asset.labelBounds)
      || asset.width!==1080 || asset.height!==400
      || photoDigest(boundedRead(path.join(previewDirectory,asset.file),previewDirectory,1_500_000))!==review.sha256)
      throw Error('original-photo-disclosure-proof-invalid');
  }
  const size = inspectOriginalJPEG(bytes);
  if (size.width!==review.width || size.height!==review.height) throw Error('original-photo-size-mismatch');
  const width = Math.floor(Math.min(size.width,size.height*2.7)),height=Math.floor(width/2.7);
  if (width<600 || height<222) throw Error('Original card crop is too small');
  const crop={left:Math.floor((size.width-width)/2),top:Math.floor((size.height-height)/2),width,height};
  if (JSON.stringify(crop)!==JSON.stringify(review.crop)) throw Error('original-photo-crop-mismatch');
  return {bytes,size,crop,review};
}

export async function inspectBoundOriginalPhoto(deal,{root=process.cwd()}={}) {
  if(!deal.photoUrl)return null;
  const {bytes,size,crop,review}=readBoundPhotoSnapshot(deal,{root});
  const {default:sharp} = await import('sharp');
  const card = await sharp(bytes,{failOn:'warning',limitInputPixels:12_000_000}).extract(crop).jpeg({quality:90}).toBuffer();
  if (photoDigest(card)!==review.cardSha256) throw Error('original-photo-crop-integrity-failed');
  return {bytes,card,size,crop,review};
}
