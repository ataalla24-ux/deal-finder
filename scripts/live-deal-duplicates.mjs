import { createHash } from 'node:crypto';
import { readApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';
import { officialFoodOfferKey } from '../scraper/power-food-sources.js';
import { decodeInstagramShortcodeDate } from '../scraper/deal-evidence-utils.js';

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const fold = value => clean(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').toLowerCase();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exactDay = value => /^20\d{2}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : '';
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value ? Date.parse(value) : NaN;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const viennaDay = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date(value));

function postKey(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['instagram.com', 'www.instagram.com'].includes(url.hostname)) return '';
    const match = url.pathname.match(/^\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)\/?$/);
    return match ? `instagram:${match[1]}` : '';
  } catch { return ''; }
}

function period(deal) {
  if (deal.expiryEstimated || /unknown|recurring|ongoing/i.test(deal.expiryKind || '')
    || /ttl|fallback|unknown/i.test(deal.expirySource || '')) return null;
  const day = exactDay(deal.validOn), start = exactDay(deal.validFrom), end = exactDay(deal.validUntil);
  if (['validOn', 'validFrom', 'validUntil'].some(key => deal[key] && !exactDay(deal[key]))) return null;
  if (day && (start && start !== day || end && end !== day) || start && end && start > end) return null;
  const calendar = day ? { start: day, end: day } : start && end ? { start, end } : end ? { start: '', end } : null;
  if (!calendar) return null;
  // Exact clocks must agree too; a shared calendar day is not a shared time slot.
  const clock = /T\d{2}:\d{2}/.test(deal.expires || '') ? clean(deal.expires) : '';
  if (clock && !Number.isFinite(timestamp(clock))) return null;
  return { ...calendar, clock };
}

function source(deal, now, latest) {
  if (!Number.isFinite(+now)) return null;
  const receipt = readApprovedExpiryEvidence(deal, { now });
  const caption = clean(deal.metaGraphCaption);
  const owner = fold(deal.ownerUsername), merchant = fold(deal.merchantUsername);
  const entity = deal.evidence?.entityResolution;
  const publishedAt = timestamp(deal.sourcePublishedAt), verifiedAt = timestamp(deal.metaGraphVerifiedAt);
  const key = postKey(deal.url), mediaId = clean(deal.metaGraphMediaId);
  const decoded = decodeInstagramShortcodeDate(deal.url);
  const original = deal.evidence?.originalPost, verification = deal.postVerification;
  const latestOriginal = latest?.evidence?.originalPost, latestVerification = latest?.postVerification;
  const refs = [deal.evidencePostUrl, original?.url, original?.postUrl, original?.permalink,
    verification?.originalPostUrl, verification?.finalUrl, latest?.url, latest?.evidencePostUrl,
    latest?.originalPostUrl, latestOriginal?.url, latestOriginal?.postUrl, latestOriginal?.permalink,
    latestVerification?.originalPostUrl, latestVerification?.finalUrl].filter(Boolean);
  const metadata = [deal, deal.evidence, original, verification, latest, latest?.evidence, latestOriginal, latestVerification];
  if (refs.some(url => postKey(url) !== key) || metadata.some(row => row && (row.isRepost || row.isReshare
    || row.repost || row.reshare || row.repostedFrom || row.resharedFrom || row.isOriginal === false
    || row.metaGraphIsRepost || /story|repost|reshare/i.test(row.mediaProductType || '')))) return null;
  if ([original, verification, latestOriginal, latestVerification].some(row => row?.ownerUsername
    && fold(row.ownerUsername) !== owner)) return null;
  const storedOcr = [deal.metaGraphOcrText, deal.evidence?.mediaEvidence?.ocrText, deal.evidence?.ocrText, deal.ocrText]
    .filter(value => typeof value === 'string').map(clean);
  if (new Set(storedOcr).size > 1) return null;
  const ocrText = storedOcr[0] || '';
  // Only retained, merchant-owned original Graph captions are admitted here.
  // Descriptions, OCR, model confidence and a shared landing page are not proof.
  if (!key || !decoded || !Number.isFinite(publishedAt) || Math.abs(publishedAt - +decoded) > 300000
    || viennaDay(publishedAt) !== viennaDay(decoded)
    || deal.evidencePostUrl && postKey(deal.evidencePostUrl) !== key
    || !owner || owner !== merchant || deal.sourceAccountType !== 'merchant'
    || entity?.resolutionMethod !== 'owner-is-merchant' || fold(entity.ownerUsername) !== owner
    || fold(entity.merchantUsername) !== owner || deal.metaGraphVerified !== true || deal.metaGraphAccepted !== true
    || deal.metaGraphBlockingReason || deal.metaGraphRejection || deal.metaGraphIsRepost || deal.approvalBlock
    || ['blocked', 'withdrawn', 'rejected', 'invalid'].includes(deal.validity?.status)
    || !/^\d+$/.test(mediaId) || clean(deal.evidence?.mediaId) !== mediaId
    || /^meta-ig-/.test(deal.id || '') && deal.id !== `meta-ig-${mediaId}`
    || !caption || caption.length < 30 || !Number.isFinite(publishedAt) || !Number.isFinite(verifiedAt)
    || publishedAt > verifiedAt || verifiedAt > +now
    || !/instagram|meta|shortcode/i.test(deal.sourcePublishedAtSource || '')) return null;
  if (receipt && clean(receipt.sourceText) !== caption) return null;
  if (deal.approvedExpiryEvidence && !receipt) return null;
  if (latest && (latest.blockingReason || latest.isRepost !== false || latest.isReshare || latest.graphAccepted !== true
    || postKey(latest.url) !== key || fold(latest.ownerUsername) !== owner || clean(latest.mediaId) !== mediaId
    || latest.sourceAccountType !== 'merchant'
    || clean(latest.caption) !== caption || clean(latest.ocrText) !== ocrText
    || typeof latest.mediaEvidence?.ocrText === 'string' && clean(latest.mediaEvidence.ocrText) !== ocrText
    || !Number.isFinite(timestamp(latest.verifiedAt))
    || timestamp(latest.verifiedAt) < verifiedAt || timestamp(latest.verifiedAt) > +now
    || +now - timestamp(latest.verifiedAt) > 86400000
    || !Number.isFinite(timestamp(latest.sourcePublishedAt))
    || Math.abs(timestamp(latest.sourcePublishedAt) - +decoded) > 300000
    || viennaDay(latest.sourcePublishedAt) !== viennaDay(decoded))) return null;
  return { key, owner, mediaId, caption, captionHash: hash(caption), ocrHash: hash(ocrText), publishedAt,
    receiptPeriod: receipt?.period, sourceUrl: clean(deal.url) };
}

function sourceVenue(text) {
  const matches = [...fold(text).matchAll(/\b([a-z]+(?:[ -][a-z]+)*(?:strasse|gasse|platz|weg|ring|allee|markt|zeile|kai))\s+(\d+[a-z]?(?:\/\d+)?)\s*,?\s*(1(?:0[1-9]|1\d|2[0-3])0)\s+(?:wien|vienna)\b/g)];
  return matches.length === 1 ? matches[0].slice(1).join('|') : '';
}

function sourceSupportsPeriod(source, value) {
  const days = [...new Set([value.start, value.end].filter(Boolean))];
  // With no explicit start, an end-only campaign may be an extension of an old
  // campaign. Keep it for review unless the validated receipt supplies the period.
  if (!value.start) return false;
  const text = fold(source.caption), publicationYear = new Date(source.publishedAt).getUTCFullYear();
  if (/\b(?:nicht\s+(?:nur\s+)?(?:am|bis)|not\s+(?:only\s+)?(?:on|until)|verlanger\w*|extended|weekly|recurring|jeden?\s+(?:tag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))\b/.test(text)) return false;
  return days.every(day => {
    const [year, month, date] = day.split('-').map(Number);
    if (text.includes(day)) return true;
    const literal = new RegExp(`\\b0?${date}[./]0?${month}(?:[./]${year}\\b|(?![./]\\d|\\d))`);
    if (!literal.test(text)) return false;
    return text.includes(`${date}.${month}.${year}`) || (year === publicationYear
      && Math.abs(Date.parse(day) - source.publishedAt) <= 31 * 86400000);
  });
}

function offerFields(deal) {
  return { brand: fold(deal.brand), title: fold(deal.title), description: fold(deal.description), type: clean(deal.type),
    promotion: fold(deal.promotionEvidence), category: clean(deal.category),
    explicitTerms: Object.fromEntries(['price', 'originalPrice', 'conditions', 'couponCode', 'promoCode', 'discount',
      'discountPercent', 'redemptionInstructions', 'redemption', 'eligibility', 'quantity', 'minimumSpend',
      'minSpend', 'minOrderValue', 'locations', 'onlineOnly', 'deliveryOnly'].map(key => [key, deal[key] ?? null])) };
}

function protectedDeal(deal, edits, policy) {
  const matched = edits.filter(edit => clean(edit.dealId) ? clean(edit.dealId) === clean(deal.id)
    : Boolean(deal.url && edit.url === deal.url));
  return Boolean(deal.forceKeep || deal.liveForceKeep || deal.campaignId || deal.isBusiness || deal.isBusinessAdvertisement
    || deal.liveEditedAt || deal.editedInSlack || deal.slackEditedAt || deal.slackFormEditTs
    || deal.liveEditedFields?.length || deal.slackEditedFields?.length
    || matched.length || (policy.protectedMerchants || []).some(brand => fold(brand) === fold(deal.brand)));
}

/** Pure classification. Similar titles/URLs are candidates, never removal proof. */
export function classifyDealDuplicatePair(left, right, { now = new Date(), sourceEvidence = new Map() } = {}) {
  const result = (status, reason, proof) => ({ status, reason, ...(proof ? { proof } : {}) });
  if (!left || !right || !clean(left.id) || !clean(right.id)) return result('review', 'missing-record-identity');
  if (left.flight || right.flight) return result('distinct', 'flight-itineraries-use-flight-selection');
  const lVariant = officialFoodOfferKey(left), rVariant = officialFoodOfferKey(right);
  if (lVariant && rVariant && lVariant !== rVariant) return result('distinct', 'different-official-offer-variants');
  const lPeriod = period(left), rPeriod = period(right);
  if (lPeriod && rPeriod && (lPeriod.end !== rPeriod.end
    || lPeriod.start && rPeriod.start && lPeriod.start !== rPeriod.start
    || lPeriod.clock && rPeriod.clock && lPeriod.clock !== rPeriod.clock)) return result('distinct', 'different-offer-period');
  const lOffer = offerFields(left), rOffer = offerFields(right);
  if (lOffer.title && rOffer.title && lOffer.title !== rOffer.title) return result('review', 'different-offer-copy');
  if (left.couponCode && right.couponCode && left.couponCode !== right.couponCode) return result('distinct', 'different-coupon');
  const latest = deal => sourceEvidence instanceof Map ? sourceEvidence.get(deal.id) : sourceEvidence?.[deal.id];
  const lSource = source(left, now, latest(left)), rSource = source(right, now, latest(right));
  if (!lSource || !rSource) return result('review', 'original-merchant-source-unconfirmed');
  if ([left, right].some(deal => deal.pipelineLifecycle?.manualDecision !== 'approved'
    || !Number.isFinite(timestamp(deal.approvedAt)) || timestamp(deal.approvedAt) > +now
    || timestamp(deal.approvedAt) < timestamp(deal.sourcePublishedAt))) {
    return result('review', 'original-approval-unconfirmed');
  }
  if (lSource.owner !== rSource.owner) return result('distinct', 'different-original-merchant');
  if (lSource.captionHash !== rSource.captionHash) return result('review', 'different-original-terms');
  if (lSource.ocrHash !== rSource.ocrHash) return result('review', 'different-original-image-terms');
  if (!lOffer.title || !lOffer.description || !lOffer.type || !equal(lOffer, rOffer)) return result('review', 'offer-or-conditions-unconfirmed');
  // A repeated editorial error is not original offer evidence. This automatic
  // path accepts literal source-backed titles; rewritten summaries stay review.
  if (!fold(lSource.caption).includes(lOffer.title)
    || Object.values(lOffer.explicitTerms).some(value => value !== null)) return result('review', 'literal-offer-proof-required');
  if (!lPeriod || !rPeriod || !equal(lPeriod, rPeriod)
    || !sourceSupportsPeriod(lSource, lPeriod) || !sourceSupportsPeriod(rSource, rPeriod)) {
    return result('review', 'original-period-unconfirmed');
  }
  const venue = sourceVenue(lSource.caption);
  if (!venue || venue !== sourceVenue(rSource.caption)) return result('review', 'original-location-unconfirmed');
  for (const deal of [left, right]) {
    for (const value of [deal.address, deal.location]) {
      if (clean(value) && sourceVenue(value) !== venue) return result('review', 'display-location-conflict');
    }
    if (clean(deal.distance) && !/^(?:wien|vienna)$/i.test(clean(deal.distance)) && sourceVenue(deal.distance) !== venue
      || clean(deal.city) && !/^(?:wien|vienna)$/i.test(clean(deal.city))
      || clean(deal.postalCode) && venue.split('|')[2] !== clean(deal.postalCode)) return result('review', 'display-location-conflict');
  }
  return result('confirmed', 'identical-source-backed-offer', {
    sourceKeys: [lSource.key, rSource.key], sourceHashes: [lSource.captionHash, rSource.captionHash],
    owner: lSource.owner, mediaIds: [lSource.mediaId, rSource.mediaId], period: lPeriod,
    venueHash: hash(venue), offerHash: hash(lOffer),
    bindingHash: hash([left.id, right.id, left.approvedAt, right.approvedAt, lSource, rSource, lPeriod, lOffer, venue]),
  });
}

/** Approval may update an explicit record ID; cross-ID merges need full proof. */
export function canMergeApprovedDealRecords(left, right, options = {}) {
  if (clean(left?.id) && clean(left.id) === clean(right?.id)) return true;
  const edits = Array.isArray(options.edits) ? options.edits : options.edits?.edits || [];
  if (!left || !right || protectedDeal(left, edits, options.policy || {}) || protectedDeal(right, edits, options.policy || {})) return false;
  return classifyDealDuplicatePair(left, right, options).status === 'confirmed';
}

function related(left, right) {
  return Boolean(fold(left.brand) && fold(left.brand) === fold(right.brand)
    || postKey(left.url) && postKey(left.url) === postKey(right.url)
    || clean(left.url) && clean(left.url) === clean(right.url));
}

function keeperOrder(a, b) {
  const age = deal => timestamp(deal.approvedAt) || timestamp(deal.sourcePublishedAt) || Infinity;
  return age(a) - age(b) || String(a.id).localeCompare(String(b.id), 'en');
}

export function preferredDuplicateKeeper(left, right) {
  return keeperOrder(left, right) <= 0 ? left : right;
}

/** No mutations, file access, network, generated timestamps or invented approval. */
export function assessLiveDealDuplicates(deals, { now = new Date(), edits = [], policy = {}, sourceEvidence = new Map() } = {}) {
  edits = Array.isArray(edits) ? edits : edits.edits || [];
  const decisions = new Map(deals.map(deal => [deal.id, { id: deal.id, action: 'keep', reason: 'no-confirmed-duplicate' }]));
  const removals = [], reviewPairs = [], sorted = [...deals].sort(keeperOrder);
  for (let i = 0; i < sorted.length; i++) {
    const keeper = sorted[i];
    if (decisions.get(keeper.id)?.action === 'remove') continue;
    for (const candidate of sorted.slice(i + 1)) {
      if (decisions.get(candidate.id)?.action === 'remove' || !related(keeper, candidate)) continue;
      const assessment = classifyDealDuplicatePair(keeper, candidate, { now, sourceEvidence });
      if (assessment.status === 'distinct') continue;
      const protectedPair = protectedDeal(keeper, edits, policy) || protectedDeal(candidate, edits, policy);
      if (assessment.status !== 'confirmed' || protectedPair || keeper.id === candidate.id) {
        const reason = protectedPair ? 'manual-protection' : keeper.id === candidate.id ? 'duplicate-id-needs-review' : assessment.reason;
        reviewPairs.push({ leftId: keeper.id, rightId: candidate.id, reason });
        for (const row of [keeper, candidate]) if (decisions.get(row.id).action === 'keep') {
          decisions.set(row.id, { id: row.id, action: 'review', reason });
        }
        continue;
      }
      const removal = { id: candidate.id, keeperId: keeper.id, reason: assessment.reason, proof: assessment.proof };
      removals.push(removal);
      decisions.set(candidate.id, { ...removal, action: 'remove' });
    }
  }
  return { version: 1, decisions: deals.map(deal => decisions.get(deal.id)), removals, reviewPairs };
}
