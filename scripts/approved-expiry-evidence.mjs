import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { decodeInstagramShortcodeDate } from '../scraper/deal-evidence-utils.js';

const VERSION = 1;
const PERIOD_FIELDS = ['validFrom', 'validOn', 'validUntil', 'expires', 'expiryKind',
  'expiresOriginal', 'expiryDisplayText', 'validityText', 'expiresSource', 'expirySource'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Deliberately one reviewed relationship, not permission to attach arbitrary
// same-site documents to an offer. Add another only with its own source review.
const LINKED_PDFS = new Map([
  ['https://www.nordsee.com/at/coupons', 'https://www.nordsee.com/at/coupons/pdf'],
]);
const REVIEWED_IMAGE_POST = { url: 'https://www.instagram.com/p/DgLPXp-xxSu/',
  mediaId: '18126514285942800', owner: 'maisonnayavienna' };
const normalizedCopy = value => typeof value === 'string'
  ? value.replace(/\\[nr]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const instant = value => typeof value === 'string'
  && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));

// Use the actual public source, never a login redirect or an inferred merchant
// homepage. Only known social URL decoration is removed from post identities.
function canonicalSourceUrl(value) {
  try {
    if (typeof value !== 'string' || !value.trim()) return '';
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    url.hash = '';
    const host = url.hostname.toLowerCase();
    if (['instagram.com', 'www.instagram.com'].includes(host)) {
      const post = url.pathname.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?$/);
      return post ? `https://www.instagram.com/p/${post[1]}/` : '';
    }
    if (['tiktok.com', 'www.tiktok.com'].includes(host)) {
      const post = url.pathname.match(/^\/@([^/]+)\/video\/(\d+)\/?$/);
      return post ? `https://www.tiktok.com/@${post[1]}/video/${post[2]}` : '';
    }
    return url.href;
  } catch { return ''; }
}

function bindingFor(deal) {
  if (!deal || typeof deal.id !== 'string' || !deal.id.trim()
    || typeof deal.brand !== 'string' || !deal.brand.trim()) return null;
  const sourceUrl = canonicalSourceUrl(deal.url);
  if (!sourceUrl) return null;
  const approvedAt = deal.approvedAt || '';
  const lifecycle = deal.pipelineLifecycle;
  const manualDecision = lifecycle?.manualDecision || '';
  const manualDecisionAt = lifecycle?.manualDecisionAt || '';
  if (manualDecision && manualDecision !== 'approved') return null;
  if (!instant(approvedAt) && !(manualDecision === 'approved' && instant(manualDecisionAt))) return null;
  if ((approvedAt && !instant(approvedAt)) || (manualDecisionAt && !instant(manualDecisionAt))) return null;
  const period = {};
  for (const field of PERIOD_FIELDS) {
    if (!Object.hasOwn(deal, field) || deal[field] === undefined) continue;
    if (deal[field] !== null && !['string', 'boolean', 'number'].includes(typeof deal[field])) return null;
    period[field] = deal[field];
  }
  const evidencePostUrl = deal.evidencePostUrl ? canonicalSourceUrl(deal.evidencePostUrl) : '';
  if (deal.evidencePostUrl && evidencePostUrl !== sourceUrl) return null;
  const sourcePublishedAt = deal.sourcePublishedAt || '';
  const sourcePublishedAtSource = deal.sourcePublishedAtSource || '';
  if (typeof sourcePublishedAt !== 'string' || typeof sourcePublishedAtSource !== 'string'
    || sourcePublishedAt && !instant(sourcePublishedAt)) return null;
  return { dealId: deal.id, brand: deal.brand, sourceUrl, evidencePostUrl, approvedAt,
    manualDecision, manualDecisionAt, sourcePublishedAt, sourcePublishedAtSource, period };
}

function linkedPdfUrls(binding, sourceUrl, document) {
  const page = binding.sourceUrl, pdf = LINKED_PDFS.get(page);
  if (!pdf || !document || canonicalSourceUrl(sourceUrl) !== pdf
    || canonicalSourceUrl(document.pageUrl) !== page
    || canonicalSourceUrl(document.pageFinalUrl) !== page
    || canonicalSourceUrl(document.documentFinalUrl) !== pdf
    || new URL(page).origin !== new URL(pdf).origin
    || document.pageHttpStatus !== 200 || document.documentHttpStatus !== 200
    || document.documentContentType !== 'application/pdf') return null;
  return { page, pdf };
}

function resolvedPdfLink(value, page, pdf) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  try { return canonicalSourceUrl(new URL(value, page).href) === pdf; }
  catch { return false; }
}

function storedLinkedPdf(binding, sourceUrl, document) {
  const urls = linkedPdfUrls(binding, sourceUrl, document);
  if (!urls || document.kind !== 'linked-official-pdf'
    || !/^[a-f0-9]{64}$/.test(document.pageHtmlHash || '')
    || !/^[a-f0-9]{64}$/.test(document.documentSha256 || '')
    || document.documentUrl !== urls.pdf
    || !resolvedPdfLink(document.linkHref, urls.page, urls.pdf)
    || !Number.isInteger(document.documentBytes) || document.documentBytes < 8 || document.documentBytes > 20_000_000
    || document.pageCanonicalUrl !== '' && document.pageCanonicalUrl !== urls.page) return null;
  return { kind: 'linked-official-pdf', pageUrl: urls.page, pageFinalUrl: urls.page,
    pageHttpStatus: 200, pageCanonicalUrl: document.pageCanonicalUrl, pageHtmlHash: document.pageHtmlHash,
    linkHref: document.linkHref, documentUrl: urls.pdf, documentFinalUrl: urls.pdf,
    documentHttpStatus: 200, documentContentType: 'application/pdf',
    documentBytes: document.documentBytes, documentSha256: document.documentSha256 };
}

function captureLinkedPdf(binding, sourceUrl, document) {
  const urls = linkedPdfUrls(binding, sourceUrl, document);
  const bytes = document?.documentBytes, html = document?.pageHtml;
  if (!urls || typeof html !== 'string' || !html.trim() || html.length > 1_000_000 || html.includes('\u0000')
    || !(bytes instanceof Uint8Array) || bytes.byteLength < 8 || bytes.byteLength > 20_000_000
    || Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') return null;
  const $ = load(html);
  // An HTML base or a different canonical page would change the asserted link
  // relationship. Inert script/template text is not an actual download link.
  if ($('base[href]').length) return null;
  $('script,style,template,noscript').remove();
  if ($('form input[type="password"]').length
    || /^(?:login|sign in|anmelden|access denied|forbidden|just a moment)\b/i.test($('title').text().trim())) return null;
  const canonicals = $('link[rel]').toArray().filter(node =>
    ($(node).attr('rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  if (canonicals.some(node => canonicalSourceUrl($(node).attr('href')) !== urls.page)) return null;
  const anchor = $('a[href]').toArray().find(node => resolvedPdfLink($(node).attr('href'), urls.page, urls.pdf));
  if (!anchor) return null;
  return storedLinkedPdf(binding, sourceUrl, { ...document, kind: 'linked-official-pdf',
    pageCanonicalUrl: canonicals.length ? urls.page : '', pageHtmlHash: sha256(html),
    linkHref: $(anchor).attr('href'), documentUrl: urls.pdf,
    documentBytes: bytes.byteLength, documentSha256: sha256(bytes) });
}

function imagePostIdentity(deal, now) {
  const post = REVIEWED_IMAGE_POST, decoded = decodeInstagramShortcodeDate(deal?.url);
  const published = Date.parse(deal?.sourcePublishedAt), verified = Date.parse(deal?.metaGraphVerifiedAt);
  if (canonicalSourceUrl(deal?.url) !== post.url || deal.id !== `meta-ig-${post.mediaId}`
    || deal.metaGraphMediaId !== post.mediaId || deal.evidence?.mediaId !== post.mediaId
    || deal.ownerUsername !== post.owner || deal.merchantUsername !== post.owner || deal.evidence?.username !== post.owner
    || deal.sourceAccountType !== 'merchant' || deal.metaGraphVerified !== true
    || deal.metaGraphAccepted !== false || deal.metaGraphRejection !== 'missing-vienna-evidence'
    || deal.metaGraphBlockingReason || deal.metaGraphIsRepost || deal.isRepost || deal.isReshare
    || !decoded || !Number.isFinite(published) || Math.abs(published - +decoded) > 60000
    || !['url.instagramShortcode', 'instagram-graph-timestamp'].includes(deal.sourcePublishedAtSource)
    || !Number.isFinite(verified) || verified < published || verified > +new Date(now)
    || !normalizedCopy(deal.metaGraphCaption) || !normalizedCopy(deal.metaGraphOcrText)
    || deal.metaGraphOcrText !== deal.evidence?.mediaEvidence?.ocrText) return null;
  return { mediaId: post.mediaId, ownerUsername: post.owner, sourcePublishedAt: deal.sourcePublishedAt,
    sourcePublishedAtSource: deal.sourcePublishedAtSource, originalVerifiedAt: deal.metaGraphVerifiedAt,
    originalCaptionHash: sha256(deal.metaGraphCaption), retainedOcrHash: sha256(deal.metaGraphOcrText),
    graphAccepted: false, graphRejection: 'missing-vienna-evidence' };
}

function trustedImageUrl(value) {
  const canonical = canonicalSourceUrl(value);
  if (!canonical) return '';
  const url = new URL(canonical);
  return /^scontent-[a-z0-9-]+\.cdninstagram\.com$/.test(url.hostname)
    && /^\/v\/[^\s]+\.jpe?g$/i.test(url.pathname) ? canonical : '';
}

function storedOriginalMedia(deal, sourceText, sourceUrl, media, now) {
  const identity = imagePostIdentity(deal, now), page = canonicalSourceUrl(sourceUrl);
  if (!identity || !media || media.kind !== 'reviewed-original-post-image' || page !== REVIEWED_IMAGE_POST.url
    || media.pageUrl !== page || media.pageFinalUrl !== page || media.pageHttpStatus !== 200
    || !/^[a-f0-9]{64}$/.test(media.pageHtmlHash || '') || !trustedImageUrl(media.imageUrl)
    || media.imageHttpStatus !== 200 || media.imageContentType !== 'image/jpeg'
    || !/^[a-f0-9]{64}$/.test(media.imageSha256 || '') || !Number.isInteger(media.imageBytes)
    || media.imageBytes < 8 || media.imageBytes > 10_000_000
    || !instant(media.imageCheckedAt) || Date.parse(media.imageCheckedAt) < Date.parse(deal.sourcePublishedAt)
    || Date.parse(media.imageCheckedAt) > +new Date(now) + 300000
    || media.reviewMethod !== 'visual-original-image' || typeof media.caption !== 'string'
    || media.caption !== sourceText || normalizedCopy(media.caption) !== normalizedCopy(deal.metaGraphCaption)
    || media.captionHash !== sha256(media.caption) || typeof media.ocrText !== 'string'
    || !media.ocrText.trim() || media.ocrText.length > 1600 || media.ocrText.includes('\u0000')
    || media.ocrHash !== sha256(media.ocrText)
    || Object.entries(identity).some(([key, value]) => media[key] !== value)) return null;
  return { kind: 'reviewed-original-post-image', ...identity, pageUrl: page, pageFinalUrl: page,
    pageHttpStatus: 200, pageHtmlHash: media.pageHtmlHash, imageUrl: trustedImageUrl(media.imageUrl),
    imageHttpStatus: 200, imageContentType: 'image/jpeg', imageBytes: media.imageBytes,
    imageSha256: media.imageSha256, imageCheckedAt: media.imageCheckedAt,
    reviewMethod: 'visual-original-image', caption: media.caption, captionHash: media.captionHash,
    ocrText: media.ocrText, ocrHash: media.ocrHash };
}

function captureOriginalMedia(deal, sourceText, sourceUrl, media, now) {
  const identity = imagePostIdentity(deal, now), page = canonicalSourceUrl(sourceUrl);
  const html = media?.pageHtml, bytes = media?.imageBytes;
  if (!identity || !media || canonicalSourceUrl(media.pageUrl) !== page || canonicalSourceUrl(media.pageFinalUrl) !== page
    || typeof html !== 'string' || !html.trim() || html.length > 4_000_000 || html.includes('\u0000')
    || typeof media.ocrText !== 'string' || !media.ocrText.trim() || media.ocrText.length > 1600 || media.ocrText.includes('\u0000')
    || !(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > 10_000_000
    || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  const $ = load(html);
  $('script,style,template,noscript').remove();
  if ($('base[href],form input[type="password"]').length
    || /^(?:login|sign in|anmelden|access denied|forbidden|just a moment)\b/i.test($('title').text().trim())) return null;
  const canonicalPages = $('link[rel]').toArray().filter(node =>
    ($(node).attr('rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  if (canonicalPages.some(node => canonicalSourceUrl($(node).attr('href')) !== page)) return null;
  const images = $('meta[property="og:image"]').toArray().map(node => $(node).attr('content'));
  const descriptions = $('meta[property="og:description"]').toArray().map(node => $(node).attr('content'));
  const caption = normalizedCopy(media.caption), owner = REVIEWED_IMAGE_POST.owner;
  const publicationDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vienna', month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(deal.sourcePublishedAt));
  if (images.length !== 1 || trustedImageUrl(images[0]) !== trustedImageUrl(media.imageUrl) || !trustedImageUrl(media.imageUrl)
    || descriptions.length !== 1 || !normalizedCopy(descriptions[0]).startsWith(`${owner} on ${publicationDay}: `)
    || !caption || !normalizedCopy(descriptions[0]).includes(caption)) return null;
  return storedOriginalMedia(deal, sourceText, sourceUrl, { ...media, kind: 'reviewed-original-post-image',
    ...identity, pageUrl: page, pageFinalUrl: page, pageHtmlHash: sha256(html),
    imageContentType: 'image/jpeg', imageBytes: bytes.length, imageSha256: sha256(bytes),
    captionHash: sha256(media.caption), ocrHash: sha256(media.ocrText || '') }, now);
}

function makeReceipt(deal, { sourceText, sourceUrl, verifiedAt, now, linkedDocument, originalMedia }) {
  const binding = bindingFor(deal), clock = +new Date(now);
  const actualSourceUrl = canonicalSourceUrl(sourceUrl);
  if (!binding || typeof sourceText !== 'string' || !sourceText.trim() || sourceText.length > 16000 || sourceText.includes('\u0000')
    || !instant(verifiedAt) || !Number.isFinite(clock) || Date.parse(verifiedAt) > clock + 300000
    || [binding.approvedAt, binding.manualDecisionAt].filter(Boolean).some(value => Date.parse(value) > clock + 300000)
    || linkedDocument && originalMedia
    || (linkedDocument ? !storedLinkedPdf(binding, sourceUrl, linkedDocument) : actualSourceUrl !== binding.sourceUrl)
    || originalMedia && !storedOriginalMedia(deal, sourceText, sourceUrl, originalMedia, now)) return null;
  const sourceHash = sha256(sourceText);
  // Preserve the version-1 hash contract for existing direct-source receipts.
  const provenance = linkedDocument ? { evidenceSourceUrl: actualSourceUrl, linkedDocument }
    : originalMedia ? { originalMedia } : {};
  const bindingHash = sha256(JSON.stringify({ version: VERSION, ...binding, verifiedAt, sourceHash, ...provenance }));
  return { version: VERSION, ...binding, sourceUrl: actualSourceUrl, sourceText, verifiedAt,
    sourceHash, bindingHash, ...(linkedDocument ? { linkedDocument } : {}), ...(originalMedia ? { originalMedia } : {}) };
}

/**
 * Capture only original text explicitly validated by the caller at approval (or
 * a later source review). This deliberately never falls back to deal.description.
 * The receipt is returned for assignment to deal.approvedExpiryEvidence.
 */
export function captureApprovedExpiryEvidence(deal, { sourceText, caption, sourceUrl = deal?.url,
  verifiedAt, checkedAt, now = new Date(), linkedDocument, originalMedia } = {}) {
  const binding = bindingFor(deal);
  if (!binding) return null;
  const proof = linkedDocument === undefined ? undefined : captureLinkedPdf(binding, sourceUrl, linkedDocument);
  if (linkedDocument !== undefined && !proof) return null;
  const imageProof = originalMedia === undefined ? undefined : captureOriginalMedia(deal, sourceText ?? caption, sourceUrl, originalMedia, now);
  if (originalMedia !== undefined && !imageProof) return null;
  return makeReceipt(deal, { sourceText: sourceText ?? caption, sourceUrl, verifiedAt: verifiedAt ?? checkedAt,
    now, linkedDocument: proof, originalMedia: imageProof });
}

/** Returns null after an approval, source, period or receipt-content change. */
export function readApprovedExpiryEvidence(deal, { now = new Date() } = {}) {
  const receipt = deal?.approvedExpiryEvidence;
  if (!receipt || receipt.version !== VERSION) return null;
  const binding = bindingFor(deal);
  if (!binding) return null;
  const proof = receipt.linkedDocument === undefined ? undefined : storedLinkedPdf(binding, receipt.sourceUrl, receipt.linkedDocument);
  if (receipt.linkedDocument !== undefined && (!proof || JSON.stringify(proof) !== JSON.stringify(receipt.linkedDocument))) return null;
  const imageProof = receipt.originalMedia === undefined ? undefined : storedOriginalMedia(deal, receipt.sourceText, receipt.sourceUrl, receipt.originalMedia, now);
  if (receipt.originalMedia !== undefined && (!imageProof || JSON.stringify(imageProof) !== JSON.stringify(receipt.originalMedia))) return null;
  const expected = makeReceipt(deal, { sourceText: receipt.sourceText,
    sourceUrl: receipt.sourceUrl, verifiedAt: receipt.verifiedAt, now, linkedDocument: proof, originalMedia: imageProof });
  if (!expected || receipt.sourceHash !== expected.sourceHash || receipt.bindingHash !== expected.bindingHash) return null;
  for (const field of ['dealId', 'brand', 'sourceUrl', 'evidencePostUrl', 'approvedAt', 'manualDecision', 'manualDecisionAt',
    'sourcePublishedAt', 'sourcePublishedAtSource']) {
    if (receipt[field] !== expected[field]) return null;
  }
  if (JSON.stringify(receipt.period) !== JSON.stringify(expected.period)) return null;
  return expected;
}
