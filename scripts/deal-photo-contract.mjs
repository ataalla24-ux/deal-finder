import { createHash } from 'node:crypto';
import { dealImageAssetKey, dealImageSubjectHash } from '../scraper/deal-image-subject.js';

export const photoDigest = value => createHash('sha256').update(value).digest('hex');
export function photoSubjectHash(deal) {
  const approved = normalizeApprovedDealImage(deal?.approvedDealImage,deal?.id,deal?.photoUrl);
  if (approved?.version === 2) return generatedPhotoSubjectHash(deal,approved);
  if (approved && approved.assetKey === dealImageAssetKey(deal)) return dealImageSubjectHash(deal,approved.assetKey);
  return photoDigest(JSON.stringify(['original-photo-subject-v1',
    ...['id','title','brand','description','category','url'].map(field=>String(deal?.[field]||'').trim())]));
}
export function disclosedPhotoDescription(description) {
  const text = String(description || '').trim();
  return /\bSymbol(?:bild|foto)\b/i.test(text) ? text : `${text} Symbolbild.`.trim();
}
export function approvedDealPhotoURL(value, dealId) {
  if (!dealId || typeof value !== 'string') return '';
  const owner = photoDigest(String(dealId)).slice(0, 16);
  return new RegExp(`^https://freefinder\\.at/assets/approved-deal-photos/${owner}-[a-f0-9]{64}\\.jpg$`).test(value) ? value : '';
}

export function inspectOriginalJPEG(bytes) {
  if (bytes.length < 4 || bytes.length > 1_500_000 || bytes.readUInt16BE(0) !== 0xffd8) throw new Error('JPEG required, at most 1.5 MB');
  let size;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset] !== 0xff) throw new Error('Invalid JPEG marker');
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) throw new Error('Invalid JPEG length');
    if (marker === 0xe1) throw new Error('Export a normalized JPEG without EXIF/GPS metadata first');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) throw new Error('Invalid JPEG dimensions');
      size = {width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5)};
    }
    offset += 2 + length;
  }
  if (!size || size.width < 600 || size.height < 400 || size.width > 6000 || size.height > 6000
      || size.width * size.height > 12_000_000) throw new Error('Expected 600x400 minimum, at most 12 megapixels');
  return size;
}

export function normalizeApprovedDealImage(raw, dealId, photoUrl) {
  if (!raw || ![1,2].includes(raw.version) || raw.status !== 'locked'
    || !['editorial-illustration','merchant-photo'].includes(raw.kind)
    || typeof raw.assetKey !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(raw.assetKey)
    || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)
    || !approvedDealPhotoURL(raw.photoUrl,dealId) || raw.photoUrl !== photoUrl
    || !raw.photoUrl.endsWith(`-${raw.sha256}.jpg`)
    || typeof raw.approvedAt !== 'string' || !Number.isFinite(Date.parse(raw.approvedAt))) return null;
  if (raw.version === 2 && (raw.sourceKind !== 'generated-owned' || raw.kind !== 'editorial-illustration'
    || !validGeneratedHash(raw.generationKey) || !validGeneratedHash(raw.draftContextHash)
    || typeof raw.visualSubject !== 'string' || !raw.visualSubject.trim() || raw.visualSubject.length > 1200)) return null;
  return {version:raw.version,status:'locked',photoUrl:raw.photoUrl,sha256:raw.sha256,assetKey:raw.assetKey,
    kind:raw.kind,approvedAt:raw.approvedAt,...(raw.version === 2 ? {sourceKind:'generated-owned',
      generationKey:raw.generationKey,draftContextHash:raw.draftContextHash,visualSubject:cleanGeneratedPhotoText(raw.visualSubject)} : {})};
}

const cleanGeneratedPhotoText = value => String(value ?? "").replace(/\s+/g," ").trim();
const validGeneratedHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validGeneratedTime = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const validGeneratedModel = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
export const GENERATED_PHOTO_LABEL_BOUNDS = Object.freeze({left:428,top:320,width:224,height:54});

export function generatedPhotoInputHash(deal) {
  return photoDigest(JSON.stringify(['generated-photo-input-v1',
    ...['id','url','brand','category','title','description'].map(field => cleanGeneratedPhotoText(deal?.[field]))]));
}

export function generatedPhotoIdentityHash(deal) {
  return photoDigest(JSON.stringify(['generated-photo-identity-v1',
    ...['id','url','brand','category'].map(field => cleanGeneratedPhotoText(deal?.[field]))]));
}

export function generatedPhotoSubjectHash(deal, image) {
  if (!validGeneratedHash(image?.generationKey) || !validGeneratedHash(image?.draftContextHash || image?.inputHash)
    || typeof image?.visualSubject !== 'string' || !image.visualSubject.trim() || image.visualSubject.length > 1200
    || image.assetKey !== dealImageAssetKey(deal)) return '';
  return photoDigest(JSON.stringify(['generated-photo-subject-v1',generatedPhotoIdentityHash(deal),
    image.assetKey,image.generationKey,image.draftContextHash || image.inputHash,cleanGeneratedPhotoText(image.visualSubject)]));
}

export function normalizeGeneratedPhotoDraft(raw, deal) {
  if (!raw || raw.version !== 1 || raw.sourceKind !== 'generated-owned'
    || !validGeneratedHash(raw.generationKey) || !validGeneratedHash(raw.inputHash) || !validGeneratedHash(raw.identityHash)
    || !validGeneratedHash(raw.sha256) || !validGeneratedHash(raw.promptHash) || !validGeneratedModel(raw.model)
    || typeof raw.visualSubject !== 'string' || !raw.visualSubject.trim() || raw.visualSubject.length > 1200
    || typeof raw.assetKey !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(raw.assetKey)
    || !validGeneratedTime(raw.generatedAt) || typeof raw.photoUrl !== 'string'
    || !/^https:\/\/freefinder\.at\/assets\/approved-deal-photos\/[a-f0-9]{16}-[a-f0-9]{64}\.jpg$/.test(raw.photoUrl)
    || !raw.photoUrl.endsWith(`-${raw.sha256}.jpg`)) return null;
  if (deal && (raw.identityHash !== generatedPhotoIdentityHash(deal)
    || raw.assetKey !== dealImageAssetKey(deal)
    || !raw.photoUrl.includes(`/${photoDigest(String(deal.id)).slice(0,16)}-`))) return null;
  return {version:1,sourceKind:'generated-owned',generationKey:raw.generationKey,inputHash:raw.inputHash,
    identityHash:raw.identityHash,photoUrl:raw.photoUrl,sha256:raw.sha256,assetKey:raw.assetKey,
    visualSubject:cleanGeneratedPhotoText(raw.visualSubject),promptHash:raw.promptHash,model:raw.model,generatedAt:raw.generatedAt};
}

export function generatedPhotoDraftMatches(deal, draft) {
  const normalized = normalizeGeneratedPhotoDraft(draft,deal);
  return Boolean(normalized && normalized.inputHash === generatedPhotoInputHash(deal));
}

export function generatedPhotoApproval(deal, draft, approvedAt = new Date(), {allowCopyEnrichment=false}={}) {
  const normalized = normalizeGeneratedPhotoDraft(draft,deal);
  const at = approvedAt instanceof Date ? approvedAt.toISOString() : approvedAt;
  if (!normalized || !validGeneratedTime(at) || !allowCopyEnrichment && !generatedPhotoDraftMatches(deal,normalized)) {
    throw Error('generated-photo-approval-context-mismatch');
  }
  return {version:2,status:'locked',sourceKind:'generated-owned',photoUrl:normalized.photoUrl,
    sha256:normalized.sha256,assetKey:normalized.assetKey,kind:'editorial-illustration',approvedAt:at,
    generationKey:normalized.generationKey,draftContextHash:normalized.inputHash,visualSubject:normalized.visualSubject};
}

export function validateGeneratedPhotoReceipt(deal, review, {approvedImage}={}) {
  const generated = normalizeGeneratedPhotoDraft(review.generation,deal);
  const disclosure = review.renderedDisclosure;
  if (!generated || generated.photoUrl !== review.photoUrl || generated.sha256 !== review.sha256
    || review.kind !== 'editorial-illustration' || review.rights !== 'owned-original'
    || review.showsActualProduct !== false || review.showsIllustratedProduct !== true
    || review.sourceURL !== review.photoUrl
    || disclosure?.version !== 2 || disclosure.sourceKind !== 'generated-owned'
    || disclosure.label !== 'Symbolbild' || disclosure.imageSha256 !== review.sha256
    || JSON.stringify(disclosure.bounds) !== JSON.stringify(GENERATED_PHOTO_LABEL_BOUNDS)
    || review.width !== 1080 || review.height !== 400) throw Error('generated-photo-provenance-invalid');
  if (approvedImage) {
    if (approvedImage.version !== 2 || approvedImage.sourceKind !== 'generated-owned'
      || approvedImage.photoUrl !== generated.photoUrl || approvedImage.sha256 !== generated.sha256
      || approvedImage.assetKey !== generated.assetKey || approvedImage.generationKey !== generated.generationKey
      || approvedImage.draftContextHash !== generated.inputHash || approvedImage.visualSubject !== generated.visualSubject) {
      throw Error('generated-photo-approval-receipt-mismatch');
    }
  } else if (!generatedPhotoDraftMatches(deal,generated)) {
    throw Error('generated-photo-draft-stale');
  }
  if (review.subjectHash !== generatedPhotoSubjectHash(deal,generated)) throw Error('generated-photo-subject-stale');
  return generated;
}
