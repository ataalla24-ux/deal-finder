import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createCarrierFetcher, parseDreiDetail, readCarrierPauses, recordCarrierPauses } from '../scraper/carrier-benefits.js';

const read = (root, file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const digest = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const identity = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const supported = url => /^https:\/\/www\.drei\.at\/de\/dreiplus\/ersparnisse\/[a-z0-9-]+\/$/.test(url || '');
const sameMerchant = (left, right, url) => identity(left) === identity(right)
  || url === 'https://www.drei.at/de/dreiplus/ersparnisse/madame-tussauds/'
    && [left, right].every(value => ['madametussauds', 'madametussaudswien'].includes(identity(value)));

export function maintenanceEvidenceFor(deals, cache, now = new Date()) {
  const result = new Map();
  for (const deal of deals) {
    const row = cache?.entries?.[deal.url];
    if (!row || row.status !== 'verified' || !supported(deal.url) || row.url !== deal.url
      || !sameMerchant(row.brand, deal.brand, deal.url) || typeof row.text !== 'string' || !row.text.trim()
      || row.text.length > 16000 || row.hash !== digest(row.text)
      || !Number.isFinite(Date.parse(row.checkedAt)) || Date.parse(row.checkedAt) > +now
      || +now - Date.parse(row.checkedAt) > 24 * 3600000) continue;
    result.set(deal.id, { officialText: row.text, verifiedAt: row.checkedAt, sourceUrl: row.url, contentHash: row.hash });
  }
  return result;
}

// Refresh only already known offer pages through the existing robots/cooldown
// aware adapter. This does not crawl listings, approve deals or invent codes.
export async function refreshMaintenanceEvidence({ root = process.cwd(), now = new Date(), fetchPage, apply = true, offline = false } = {}) {
  const feed = read(root, 'docs/deals.json', {}), deals = feed.deals || [];
  const cache = read(root, 'reviews/maintenance-source-evidence.json', { version: 1, entries: {} });
  const client = fetchPage || offline ? null : createCarrierFetcher({ now, state: readCarrierPauses(), maxRequests: 5, recordPause: recordCarrierPauses });
  const get = fetchPage || client?.fetchPage;
  const missing = deals.filter(d => !clean(d.description));
  const selected = [...new Map(deals.filter(d => supported(d.url)).map(d => [d.url, d])).values()]
    .sort((a, b) => (Date.parse(cache.entries[a.url]?.checkedAt) || 0) - (Date.parse(cache.entries[b.url]?.checkedAt) || 0));
  let requests = 0;
  for (const deal of selected) {
    const previous = cache.entries[deal.url];
    if (offline || requests >= 4 || previous?.parserVersion === 3 && Date.parse(previous?.nextAttemptAt) > +now) continue;
    requests++;
    let next = { url: deal.url, parserVersion: 3, checkedAt: now.toISOString(), nextAttemptAt: new Date(+now + 86400000).toISOString(), status: 'deferred' };
    try {
      const page = await get(deal.url);
      if (page.finalUrl !== deal.url) throw Error('unexpected-source-redirect');
      const parsed = parseDreiDetail(page.html, deal.url, { previous: deals, now });
      if (!parsed.deal) next.reason = parsed.reason || 'source-not-confirmed';
      else if (!sameMerchant(parsed.deal.brand, deal.brand, deal.url)) next.reason = 'merchant-identity-changed';
      else {
        const text = clean(parsed.deal.evidence?.textSample);
        if (!text || text.length > 16000) throw Error('invalid-source-text');
        next = { ...next, status: 'verified', brand: deal.brand, text, hash: digest(text), sourceKind:'official-page-paragraphs' };
      }
    } catch (error) { next.reason = error.httpStatus ? `source-http-${error.httpStatus}` : 'source-unavailable-or-invalid'; }
    cache.entries[deal.url] = next;
  }
  const verified = maintenanceEvidenceFor(deals, cache, now);
  const report = { checkedAt: now.toISOString(), missingDescriptions: missing.length, offerPageAttempts: requests,
    sourceRequests: client?.requests ?? (offline ? 0 : requests),
    verified: missing.filter(d => verified.has(d.id)).map(d => d.id),
    unresolved: missing.filter(d => !verified.has(d.id)).map(d => ({ id: d.id, title: d.title,
      reason: supported(d.url) ? cache.entries[d.url]?.reason || 'refresh-deferred' : 'no-reviewed-source-adapter' })),
    noAutomaticApproval: true };
  if (apply) for (const [file, value] of [['reviews/maintenance-source-evidence.json', cache], ['reviews/maintenance-source-report.json', report]]) {
    fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
  }
  return { cache, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { report } = await refreshMaintenanceEvidence({ offline: process.argv.includes('--offline'), apply: !process.argv.includes('--read-only') });
  console.log(JSON.stringify(report, null, 2));
}
