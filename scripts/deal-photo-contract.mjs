import { createHash } from 'node:crypto';
import { dealImageAssetKey, dealImageSubjectHash } from '../scraper/deal-image-subject.js';

export const photoDigest = value => createHash('sha256').update(value).digest('hex');
export function photoSubjectHash(deal) {
  const approved = normalizeApprovedDealImage(deal?.approvedDealImage,deal?.id,deal?.photoUrl);
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
  if (!raw || raw.version !== 1 || raw.status !== 'locked'
    || !['editorial-illustration','merchant-photo'].includes(raw.kind)
    || typeof raw.assetKey !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(raw.assetKey)
    || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)
    || !approvedDealPhotoURL(raw.photoUrl,dealId) || raw.photoUrl !== photoUrl
    || !raw.photoUrl.endsWith(`-${raw.sha256}.jpg`)
    || typeof raw.approvedAt !== 'string' || !Number.isFinite(Date.parse(raw.approvedAt))) return null;
  return {version:1,status:'locked',photoUrl:raw.photoUrl,sha256:raw.sha256,assetKey:raw.assetKey,
    kind:raw.kind,approvedAt:raw.approvedAt};
}
