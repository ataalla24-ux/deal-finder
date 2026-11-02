import { createHash } from 'node:crypto';

export const photoDigest = value => createHash('sha256').update(value).digest('hex');
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
