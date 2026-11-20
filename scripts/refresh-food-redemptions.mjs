import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchesReviewedPeriod } from './deal-redemptions.mjs';
import { stampDealsFeedBundle, stampDealsFeedFile } from './deals-feed-contract.mjs';

const DAY = 24 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');

function matchesOfficialCard(row, candidate) {
  const rule = row.recheck;
  const proof = candidate.evidence;
  if (!proof || proof.source !== 'official-merchant-page' || candidate.originSource !== 'power-official-food'
    || candidate.url !== row.sourceUrl || proof.sourceUrl !== row.sourceUrl
    || candidate.brand !== rule.merchant || proof.merchantSourceKey !== rule.merchant
    || proof.extractionMethod !== rule.extractionMethod || typeof proof.textSample !== 'string'
    || proof.contentHash !== rule.contentHash || digest(proof.textSample) !== rule.contentHash) return false;
  if (!rule.cardSha256) return row.method === 'onsite' && rule.extractionMethod === 'merchant-card'
    && !proof.media && !proof.offerTiming?.validUntil;
  return row.method === 'provider_coupon' && proof.media?.kind === 'pdf' && row.url === proof.media.url
    && proof.media.cardSha256 === rule.cardSha256 && proof.offerTiming?.validUntil === rule.validUntil
    && Number.isFinite(Date.parse(rule.endExclusive));
}

// Reuse only a newer official observation of the identical reviewed offer, never the Power run time.
export function refreshFoodRedemptions(manifest, live, pending, now = Date.now()) {
  const liveById = new Map(live.map(d => [d.id, d]));
  const reviews = manifest.reviews.map(row => {
    if (row.recheck?.kind !== 'official-food-card') return row;
    const deal = liveById.get(row.dealId);
    if (!deal || deal.title !== row.expectedTitle || deal.description !== row.expectedDescription
      || deal.url !== row.sourceUrl || deal.brand !== row.recheck.merchant || !matchesReviewedPeriod(deal, row)) return row;
    const matches = pending.filter(d => d.id === row.dealId);
    if (matches.length !== 1) return row;
    const candidate = matches[0];
    const checkedAt = Date.parse(candidate.evidence?.checkedAt);
    if (!Number.isFinite(checkedAt) || checkedAt > now || checkedAt + DAY <= now
      || checkedAt <= Date.parse(row.verifiedAt) || checkedAt <= Date.parse(row.recheck.lastMismatchAt)) return row;
    if (!matchesOfficialCard(row, candidate)) {
      return checkedAt < Date.parse(row.reviewUntil) ? { ...row, reviewUntil: new Date(checkedAt).toISOString(),
        recheck: { ...row.recheck, lastMismatchAt: new Date(checkedAt).toISOString() } } : row;
    }
    const end = Math.min(checkedAt + DAY, row.recheck.endExclusive ? Date.parse(row.recheck.endExclusive) : Infinity);
    if (end <= now) return row;
    return { ...row, verifiedAt: new Date(checkedAt).toISOString(), reviewUntil: new Date(end).toISOString() };
  });
  return { ...manifest, reviews };
}

export function syncFoodRedemptions(root = process.cwd(), now = Date.now()) {
  const manifestFile = path.join(root, 'reviews/deal-redemptions.json');
  const feedFile = path.join(root, 'docs/deals.json');
  const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
  const manifest = read(manifestFile), feed = read(feedFile);
  const pending = read(path.join(root, 'docs/deals-pending-power.json'));
  const result = refreshFoodRedemptions(manifest, feed.deals, pending.deals, now);
  const changed = result.reviews.filter((row, index) => row !== manifest.reviews[index]).length;
  if (changed) {
    const tmp = manifestFile + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(result, null, 2) + '\n');
    fs.renameSync(tmp, manifestFile);
  }
  const options = { redemptionManifest: result, nowIso: new Date(now).toISOString() };
  const projected = stampDealsFeedBundle(feed, options);
  // Include stale route removals even on days with no new or edited deals. Ordinary feed publication
  // still performs all normalizations and version stamping through the original contract.
  const feedChanged = projected.deals.some((deal, index) =>
    JSON.stringify(deal.redemption) !== JSON.stringify(feed.deals[index].redemption));
  if (feedChanged) stampDealsFeedFile(feedFile, options);
  return { refreshedOrShortened: changed, feedChanged, currentRoutes: projected.deals.filter(d => d.redemption?.method && d.redemption.method !== 'unknown').length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(syncFoodRedemptions()));
}
