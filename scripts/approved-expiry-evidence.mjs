import { createHash } from 'node:crypto';

const VERSION = 1;
const PERIOD_FIELDS = ['validFrom', 'validOn', 'validUntil', 'expires', 'expiryKind',
  'expiresOriginal', 'expiryDisplayText', 'validityText', 'expiresSource', 'expirySource'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
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

/**
 * Capture only original text explicitly validated by the caller at approval (or
 * a later source review). This deliberately never falls back to deal.description.
 * The receipt is returned for assignment to deal.approvedExpiryEvidence.
 */
export function captureApprovedExpiryEvidence(deal, { sourceText, caption, sourceUrl = deal?.url,
  verifiedAt, checkedAt, now = new Date() } = {}) {
  const binding = bindingFor(deal);
  const text = sourceText ?? caption;
  const capturedAt = verifiedAt ?? checkedAt;
  const clock = +new Date(now);
  if (!binding || typeof text !== 'string' || !text.trim() || text.length > 16000 || text.includes('\u0000')
    || canonicalSourceUrl(sourceUrl) !== binding.sourceUrl || !instant(capturedAt)
    || !Number.isFinite(clock) || Date.parse(capturedAt) > clock + 300000
    || [binding.approvedAt, binding.manualDecisionAt].filter(Boolean).some(value => Date.parse(value) > clock + 300000)) return null;
  const sourceHash = sha256(text);
  const bindingHash = sha256(JSON.stringify({ version: VERSION, ...binding, verifiedAt: capturedAt, sourceHash }));
  return { version: VERSION, ...binding, sourceText: text, verifiedAt: capturedAt, sourceHash, bindingHash };
}

/** Returns null after an approval, source, period or receipt-content change. */
export function readApprovedExpiryEvidence(deal, { now = new Date() } = {}) {
  const receipt = deal?.approvedExpiryEvidence;
  if (!receipt || receipt.version !== VERSION) return null;
  const expected = captureApprovedExpiryEvidence(deal, { sourceText: receipt.sourceText,
    sourceUrl: receipt.sourceUrl, verifiedAt: receipt.verifiedAt, now });
  if (!expected || receipt.sourceHash !== expected.sourceHash || receipt.bindingHash !== expected.bindingHash) return null;
  for (const field of ['dealId', 'brand', 'sourceUrl', 'evidencePostUrl', 'approvedAt', 'manualDecision', 'manualDecisionAt',
    'sourcePublishedAt', 'sourcePublishedAtSource']) {
    if (receipt[field] !== expected[field]) return null;
  }
  if (JSON.stringify(receipt.period) !== JSON.stringify(expected.period)) return null;
  return expected;
}
