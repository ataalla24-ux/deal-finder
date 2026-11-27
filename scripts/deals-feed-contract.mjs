import { projectEnrichmentDeal, stripEnrichmentNotice } from '../scraper/deal-enrichment-state.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizePublicDealText } from '../scraper/public-deal-text.js';
import { applyDealRedemptions, loadDealRedemptions } from './deal-redemptions.mjs';
import { redactPublishedCommunityDraft } from './community-public-boundary.mjs';
import { clearReviewExpiry, hasReviewExpiry } from '../scraper/offer-period-fields.js';

export const DEALS_FEED_SCHEMA_VERSION = 1;

export function computeDealsFeedVersion(deals) {
  if (!Array.isArray(deals)) throw new Error('Deals feed must contain a deals array');
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(deals))
    .digest('hex')
    .slice(0, 20);
  return `ff${DEALS_FEED_SCHEMA_VERSION}-${digest}`;
}

export function stampDealsFeedBundle(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('Deals feed must be a JSON object');
  }
  if (!Array.isArray(bundle.deals)) {
    throw new Error('Deals feed must contain a deals array');
  }

  const nowIso = options.nowIso || new Date().toISOString();
  const redemptionManifest = Object.hasOwn(options, 'redemptionManifest')
    ? options.redemptionManifest : loadDealRedemptions(options.redemptionManifestPath);
  const bindingDeals = bundle.deals.map(redactPublishedCommunityDraft).map(sanitizePublicDealText).map(deal => {
    const stripNotice = deal.approvalPublicationMode === 'two-stage-v1' && deal.enrichmentFields?.includes('description');
    if (!stripNotice && !hasReviewExpiry(deal) && !['pendingDealImage','imageApprovalContextHash','imagePreparationState','generatedDealImage'].some(key=>Object.hasOwn(deal,key))) return deal;
    const publicDeal = { ...deal };
    delete publicDeal.pendingDealImage;
    delete publicDeal.imageApprovalContextHash;
    delete publicDeal.imagePreparationState;
    delete publicDeal.generatedDealImage;
    if (stripNotice) publicDeal.description = stripEnrichmentNotice(deal.description);
    clearReviewExpiry(publicDeal);
    return publicDeal;
  });
  const deals = applyDealRedemptions(bindingDeals, redemptionManifest, Date.parse(nowIso)).map(projectEnrichmentDeal);
  return {
    ...bundle,
    deals,
    schemaVersion: DEALS_FEED_SCHEMA_VERSION,
    feedVersion: computeDealsFeedVersion(deals),
    totalDeals: bundle.deals.length,
    lastUpdated: nowIso,
  };
}

export function stampDealsFeedFile(filePath, options = {}) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const stamped = stampDealsFeedBundle(parsed, options);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(stamped, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
  return stamped;
}
