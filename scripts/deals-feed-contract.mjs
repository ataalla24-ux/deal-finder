import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
  return {
    ...bundle,
    schemaVersion: DEALS_FEED_SCHEMA_VERSION,
    feedVersion: computeDealsFeedVersion(bundle.deals),
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
