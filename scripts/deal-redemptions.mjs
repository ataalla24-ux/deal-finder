import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL('../reviews/deal-redemptions.json', import.meta.url));
const METHODS = new Set(['onsite', 'public_code', 'provider_coupon', 'external', 'unknown']);
const PUBLIC_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

function timestamp(value, allowDateOnly = false) {
  if (allowDateOnly && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) value += 'T00:00:00Z';
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const day = Date.parse(value.slice(0, 10));
  // Date.parse otherwise accepts short numbers and rolls invalid days forward.
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)
    || (value.length > 10 && Number(value.slice(11, 13)) > 23)) return NaN;
  const offset = value.match(/[+-](\d{2}):(\d{2})$/);
  if (offset && (Number(offset[1]) > 18 || (Number(offset[1]) === 18 && Number(offset[2]) !== 0))) return NaN;
  return Date.parse(value);
}

function safeUrl(value) {
  if (!text(value) || !/^https?:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/u.test(value)
    || /^https?:\/\/[^/?#]*@/i.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function hasEvidence(evidence) {
  return Array.isArray(evidence) && evidence.length > 0
    && evidence.every(item => text(item) || (object(item) && Object.values(item).some(text)));
}

export function loadDealRedemptions(manifestPath = DEFAULT_MANIFEST_PATH) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return object(manifest) && Array.isArray(manifest.reviews) ? manifest : null;
  } catch {
    return null;
  }
}

function reviewedRedemption(deal, review, now) {
  if (!object(review) || !METHODS.has(review.method) || !Number.isFinite(now)) return null;
  if (!text(deal.id) || !text(deal.title) || typeof deal.description !== 'string'
    || review.dealId !== deal.id || review.expectedTitle !== deal.title
    || review.sourceUrl !== deal.url || review.expectedDescription !== deal.description
    || !safeUrl(review.sourceUrl) || !hasEvidence(review.evidence)) return null;

  const approvedAt = timestamp(deal.approvedAt, true);
  const verifiedAt = timestamp(review.verifiedAt);
  const reviewUntil = timestamp(review.reviewUntil);
  if (!Number.isFinite(approvedAt) || approvedAt > now + FUTURE_TOLERANCE_MS
    || !Number.isFinite(verifiedAt) || verifiedAt > now + FUTURE_TOLERANCE_MS
    || !Number.isFinite(reviewUntil) || reviewUntil <= now || reviewUntil < verifiedAt) return null;

  if (review.url !== undefined && !safeUrl(review.url)) return null;
  if (['provider_coupon', 'external'].includes(review.method) && !safeUrl(review.url)) return null;
  if (review.method === 'public_code' && (typeof review.publicCode !== 'string'
    || /\s/u.test(review.publicCode) || !PUBLIC_CODE.test(review.publicCode))) return null;
  if (['details', 'instructions'].some(key => review[key] !== undefined && typeof review[key] !== 'string')) return null;

  const redemption = {
    method: review.method,
    sourceUrl: review.sourceUrl,
    title: review.expectedTitle,
    verifiedAt: review.verifiedAt,
    reviewUntil: review.reviewUntil,
  };
  // Unknown is an explicit review outcome, never a fallback or a benefit claim.
  if (review.method !== 'unknown') {
    if (review.method === 'public_code') redemption.publicCode = review.publicCode;
    for (const key of ['details', 'instructions', 'url']) {
      if (text(review[key])) redemption[key] = review[key];
    }
  }
  return redemption;
}

// No I/O here: callers inject both the reviewed manifest and the clock.
export function applyDealRedemptions(deals, manifest, now = Date.now()) {
  const reviews = new Map();
  if (object(manifest) && Array.isArray(manifest.reviews)) {
    for (const review of manifest.reviews) {
      if (!object(review) || !text(review.dealId)) continue;
      // Conflicting reviews must not silently select a first or last claim.
      reviews.set(review.dealId, reviews.has(review.dealId) ? null : review);
    }
  }
  return deals.map(deal => {
    if (!object(deal)) return deal;
    const next = { ...deal };
    delete next.redemption;
    const redemption = reviewedRedemption(deal, reviews.get(deal.id), now);
    if (redemption) next.redemption = redemption;
    return next;
  });
}
