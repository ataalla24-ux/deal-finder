import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extractApprovalSourceEvidence, preisjaegerThreadId } from '../scraper/approval-source-evidence.js';
import { extractIamstudentApprovalSourceEvidence, isSupportedIamstudentApprovalUrl, isReviewedIamstudentApprovalEvidence } from '../scraper/approval-iamstudent-source-evidence.js';

const read = (root, file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const digest = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const identity = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const carrierSupported = url => /^https:\/\/www\.drei\.at\/de\/dreiplus\/ersparnisse\/[a-z0-9-]+\/$/.test(url || '');
const publicSupported = url => isSupportedIamstudentApprovalUrl(url) || Boolean(preisjaegerThreadId(url)) && !/[?#]/.test(url);
const supported = url => carrierSupported(url) || publicSupported(url);
const pendingDescription = deal => deal.enrichmentPending === true && deal.enrichmentFields?.includes('description');
const dueDescription = (deal, now) => pendingDescription(deal) && !(Date.parse(deal.enrichmentNextReviewAt) > +now);
const sameMerchant = (left, right, url) => identity(left) === identity(right)
  || url === 'https://www.drei.at/de/dreiplus/ersparnisse/madame-tussauds/'
    && [left, right].every(value => ['madametussauds', 'madametussaudswien'].includes(identity(value)));

// Only call with the complete evidence from a successful, exact current page
// read. Approval and maintenance share this cache shape, without a second GET.
export function createMaintenanceSourceEntry(deal, evidence, now = new Date()) {
  if (!publicSupported(deal?.url) || evidence?.sourceUrl !== deal.url || evidence.blockingReason
    || typeof evidence.caption !== 'string' || !evidence.caption.trim() || evidence.caption.length > 16000
    || isSupportedIamstudentApprovalUrl(deal.url) && !isReviewedIamstudentApprovalEvidence(deal, evidence)
    || !Number.isFinite(+now)) return null;
  return { url: deal.url, brand: deal.brand, status: 'verified', text: evidence.caption, hash: digest(evidence.caption),
    checkedAt: now.toISOString(), nextAttemptAt: new Date(+now + 86400000).toISOString(), parserVersion: 4,
    sourceKind: 'approval-source-caption', approvalSourceEvidence: evidence };
}

export function maintenanceEvidenceFor(deals, cache, now = new Date()) {
  const result = new Map();
  for (const deal of deals) {
    const row = cache?.entries?.[deal.url];
    // Failed or absent current public evidence must not fall back to an old
    // queue caption merely because this already published row needs details.
    if (publicSupported(deal.url) && pendingDescription(deal)) result.set(deal.id, { blockingReason: 'maintenance-current-source-unavailable' });
    if (!row || row.status !== 'verified' || !supported(deal.url) || row.url !== deal.url
      || !sameMerchant(row.brand, deal.brand, deal.url) || typeof row.text !== 'string' || !row.text.trim()
      || row.text.length > 16000 || row.hash !== digest(row.text)
      || !Number.isFinite(Date.parse(row.checkedAt)) || Date.parse(row.checkedAt) > +now
      || +now - Date.parse(row.checkedAt) > 24 * 3600000) continue;
    if (publicSupported(deal.url) && (row.parserVersion !== 4 || row.sourceKind !== 'approval-source-caption'
      || row.approvalSourceEvidence?.caption !== row.text || !createMaintenanceSourceEntry(deal, row.approvalSourceEvidence, now))) continue;
    result.set(deal.id, { officialText: row.text, verifiedAt: row.checkedAt, sourceUrl: row.url, contentHash: row.hash,
      ...(publicSupported(deal.url) ? { approvalSourceEvidence: row.approvalSourceEvidence } : {}) });
  }
  return result;
}

// Refresh only already known offer pages through the existing robots/cooldown
// aware adapter. This does not crawl listings, approve deals or invent codes.
export async function refreshMaintenanceEvidence({ root = process.cwd(), now = new Date(), fetchPage, fetchImpl = fetch, apply = true, offline = false, requireSameDay = false } = {}) {
  const localDay = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(date);
  if (requireSameDay && fs.existsSync(path.join(root, `reviews/${localDay(now)}-daily-blog.json`))) {
    return { report: { checkedAt: now.toISOString(), status: 'existing-daily-blog', sourceRequests: 0, offerPageAttempts: 0 } };
  }
  const feed = read(root, 'docs/deals.json', {}), deals = feed.deals || [];
  const cache = read(root, 'reviews/maintenance-source-evidence.json', { version: 1, entries: {} });
  cache.entries ||= {};
  // Cached readers and lightweight Slack state commits do not install parsers.
  const { createCarrierFetcher, parseDreiDetail } = offline
    ? {} : await import('../scraper/carrier-benefits.js');
  let sourceRequests = 0;
  const boundedFetch = (...args) => {
    if (sourceRequests >= 5) throw Error('Maintenance source request limit');
    sourceRequests++;
    return fetchImpl(...args);
  };
  const pauseState = offline ? {} : read(root, 'docs/carrier-benefit-pause.json', {});
  const client = fetchPage || offline ? null : createCarrierFetcher({ now, state: pauseState, maxRequests: 5,
    fetchImpl: boundedFetch, recordPause: state => {
      if (apply) fs.writeFileSync(path.join(root, 'docs/carrier-benefit-pause.json'), JSON.stringify(state, null, 2) + '\n');
    } });
  const get = async url => {
    if (fetchPage) { sourceRequests++; return fetchPage(url); }
    if (carrierSupported(url)) return client.fetchPage(url);
    const response = await boundedFetch(url, { redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { 'user-agent': 'FreeFinderWien/1.0 (public offer maintenance)', 'accept-language': 'de-AT,de;q=0.9' } });
    if (response.status !== 200 || response.url && response.url !== url || !/text\/html/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      throw Object.assign(Error('Public source unavailable'), { httpStatus: response.status, retryAfter: response.headers.get('retry-after') });
    }
    let size = 0; const chunks = [];
    for await (const part of response.body) { size += part.length; if (size > 4000000) throw Error('Public source HTML limit'); chunks.push(part); }
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: url, status: 200 };
  };
  const missing = deals.filter(d => !clean(d.description) || pendingDescription(d));
  const selected = [...new Map(deals.filter(d => carrierSupported(d.url) || publicSupported(d.url) && dueDescription(d, now)).map(d => [d.url, d])).values()]
    .sort((a, b) => Number(dueDescription(b, now)) - Number(dueDescription(a, now))
      || (requireSameDay ? Number(b.category === 'essen') - Number(a.category === 'essen') : 0)
      || (Date.parse(cache.entries[a.url]?.checkedAt) || 0) - (Date.parse(cache.entries[b.url]?.checkedAt) || 0));
  let requests = 0;
  for (const deal of selected) {
    const previous = cache.entries[deal.url];
    const freshDayNeeded = requireSameDay && previous?.status === 'verified'
      && Number.isFinite(Date.parse(previous.checkedAt)) && localDay(new Date(previous.checkedAt)) !== localDay(now);
    const parserVersion = publicSupported(deal.url) ? 4 : 3;
    const paused = publicSupported(deal.url) && Object.values(cache.entries).some(row => {
      try { return new URL(row.url).origin === new URL(deal.url).origin && [401, 403, 429].includes(row.httpStatus)
        && (!Number.isFinite(Date.parse(row.nextAttemptAt)) || Date.parse(row.nextAttemptAt) > +now); } catch { return false; }
    });
    const originPause = pauseState[new URL(deal.url).origin]?.retryAt;
    if (offline || requests >= 4 || sourceRequests >= 5 || paused
      || originPause && (!Number.isFinite(Date.parse(originPause)) || Date.parse(originPause) > +now)
      || previous?.parserVersion === parserVersion && Date.parse(previous?.nextAttemptAt) > +now && !freshDayNeeded) continue;
    requests++;
    let next = { url: deal.url, parserVersion, checkedAt: now.toISOString(), nextAttemptAt: new Date(+now + 86400000).toISOString(), status: 'deferred' };
    try {
      const page = await get(deal.url);
      if (page.finalUrl !== deal.url) throw Error('unexpected-source-redirect');
      if (page.status && page.status !== 200) throw Object.assign(Error('source-http'), { httpStatus: page.status });
      if (publicSupported(deal.url)) {
        const evidence = isSupportedIamstudentApprovalUrl(deal.url)
          ? extractIamstudentApprovalSourceEvidence(page.html, deal.url, page.finalUrl)
          : extractApprovalSourceEvidence(page.html, deal.url, page.finalUrl);
        const entry = createMaintenanceSourceEntry(deal, evidence, now);
        next = entry || { ...next, reason: evidence?.blockingReason || 'source-not-confirmed' };
      } else {
      const parsed = parseDreiDetail(page.html, deal.url, { previous: deals, now });
      if (!parsed.deal) next.reason = parsed.reason || 'source-not-confirmed';
      else if (!sameMerchant(parsed.deal.brand, deal.brand, deal.url)) next.reason = 'merchant-identity-changed';
      else {
        const text = clean(parsed.deal.evidence?.textSample);
        if (!text || text.length > 16000) throw Error('invalid-source-text');
        next = { ...next, status: 'verified', brand: deal.brand, text, hash: digest(text), sourceKind:'official-page-paragraphs' };
      }
      }
    } catch (error) {
      next.reason = error.httpStatus ? `source-http-${error.httpStatus}` : 'source-unavailable-or-invalid';
      if ([401, 403, 429].includes(error.httpStatus)) {
        next.httpStatus = error.httpStatus;
        const retry = /^\d+$/.test(error.retryAfter || '') ? +now + Number(error.retryAfter) * 1000 : Date.parse(error.retryAfter);
        next.nextAttemptAt = new Date(Math.max(+now + 86400000, Number.isFinite(retry) ? retry : 0)).toISOString();
      }
    }
    cache.entries[deal.url] = next;
  }
  const verified = maintenanceEvidenceFor(deals, cache, now);
  const report = { checkedAt: now.toISOString(), missingDescriptions: missing.length, offerPageAttempts: requests,
    sourceRequests,
    verified: missing.filter(d => verified.get(d.id)?.officialText).map(d => d.id),
    unresolved: missing.filter(d => !verified.get(d.id)?.officialText).map(d => ({ id: d.id, title: d.title,
      reason: supported(d.url) ? cache.entries[d.url]?.reason || 'refresh-deferred' : 'no-reviewed-source-adapter' })),
    noAutomaticApproval: true };
  if (apply) for (const [file, value] of [['reviews/maintenance-source-evidence.json', cache], ['reviews/maintenance-source-report.json', report]]) {
    fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
  }
  return { cache, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { report } = await refreshMaintenanceEvidence({ offline: process.argv.includes('--offline'), apply: !process.argv.includes('--read-only'), requireSameDay: process.argv.includes('--blog-day') });
  console.log(JSON.stringify(report, null, 2));
}
