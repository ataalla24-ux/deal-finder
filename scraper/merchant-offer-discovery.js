import { createHash } from 'node:crypto';
import { merchantWebsite } from './vienna-merchant-discovery.js';
import { extractFoodOffers } from './power-food-extraction.js';
import { discoveryRejection } from './deal-discovery-policy.js';

const DAY = 86400000;
const OFFER_PATH = /(?:^|[\/\s_.-])(?:aktionen?|aktionsbon|angebote?|specials?|rabatt|deals?)(?=$|[\/\s_.-])|happy[-_\s]?hour|coupon|mittagsaktion|studentenangebot|geburtstagsangebot/i;
const EXCLUDED_PATH = /(?:^|[\/_.-])(?:jobs?|jobangebote|karriere|careers?|stellen(?:angebote)?|bewerbung|catering|business|b2b|corporate|franchise|presse?|login|account|warenkorb|checkout|veranstaltungen?|reservierung|accessoires|running[-_]club|tee-gastronomie|ch|barcelona|teams|kultur|bier)(?=$|[\/_.-])/i;

export function canonicalOfferUrl(value, website) {
  try {
    const normalized = merchantWebsite(value);
    if (!normalized) return '';
    const url = new URL(normalized);
    if (url.origin !== new URL(website).origin || EXCLUDED_PATH.test(decodeURIComponent(url.pathname))
      || /\.(?:pdf|jpe?g|png|webp|gif|mp4)$/i.test(url.pathname)
      || !OFFER_PATH.test(decodeURIComponent(url.pathname))) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return ''; }
}

export function merchantOfferHostPaused(url, state, now) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return Object.entries(state).some(([source, row]) => {
    if (![401, 403, 429].includes(row?.httpStatus)) return false;
    try {
      return new URL(source).hostname.replace(/^www\./, '') === host
        && Math.max(Date.parse(row.checkedAt) + 14 * DAY, Date.parse(row.retryAt) || 0) > +now;
    } catch { return false; }
  });
}

// Offer pages replace homepage slots; they do not add a second request budget.
export function selectMerchantOfferPages(directory, websiteState, offerState, now, budget, powerReport = {}) {
  const coveredUrls = new Set();
  const blockedHosts = new Set();
  for (const source of powerReport.sources || []) {
    try {
      coveredUrls.add(merchantWebsite(source.url));
      for (const page of source.pages || []) coveredUrls.add(merchantWebsite(page.url));
      for (const [url, pause] of Object.entries(source.pageCooldowns || {})) {
        if (Date.parse(pause.nextRetryAt) > +now) coveredUrls.add(merchantWebsite(url));
      }
      if (Date.parse(source.cooldown?.nextRetryAt) > +now
        && ['access-denied', 'rate-limited'].includes(source.cooldown.reason)) blockedHosts.add(new URL(source.url).hostname.replace(/^www\./, ''));
    } catch { /* Invalid historic report rows cannot authorize a fetch. */ }
  }
  const byUrl = new Map();
  for (const merchant of directory.merchants || []) {
    const site = websiteState[merchant.website];
    if (!(Date.parse(merchant.observedAt) >= +now - 45 * DAY)
      || Date.parse(merchant.observedAt) > +now || site?.status !== 'ok'
      || !(Date.parse(site.checkedAt) >= +now - 45 * DAY) || Date.parse(site.checkedAt) > +now) continue;
    for (const raw of site.offerUrls || []) {
      const url = canonicalOfferUrl(raw, merchant.website);
      if (!url || byUrl.has(url) || coveredUrls.has(url)
        || merchantOfferHostPaused(url, offerState, now)
        || blockedHosts.has(new URL(url).hostname.replace(/^www\./, ''))) continue;
      const previous = offerState[url];
      const cooldown = previous?.status === 'ok' ? 7 : 14;
      if (Date.parse(previous?.retryAt) > +now) continue;
      if (Date.parse(previous?.checkedAt) > +now - cooldown * DAY) continue;
      byUrl.set(url, { url, merchant, checkedAt: previous?.checkedAt || '' });
    }
  }
  const ranked = [...byUrl.values()].sort((a, b) => (Date.parse(a.checkedAt) || 0) - (Date.parse(b.checkedAt) || 0) || a.url.localeCompare(b.url));
  const domains = new Set();
  return ranked.filter(row => {
    const host = new URL(row.url).hostname;
    if (domains.has(host)) return false;
    domains.add(host);
    return true;
  }).slice(0, Math.max(0, Math.min(40, Math.floor(budget / 5))));
}

export function extractMerchantOfferCandidates(html, task, now) {
  const source = { name: `merchant-website:${new URL(task.url).hostname}`, brand: task.merchant.name,
    url: task.url, allowedHosts: [new URL(task.url).hostname], category: 'Essen & Trinken' };
  return extractFoodOffers(html, source, { now, pageUrl: task.url }).deals.filter(deal => !discoveryRejection(deal)).map(deal => ({
    ...deal,
    id: `merchant-web-${createHash('sha256').update(`${task.url}|${deal.title}`).digest('hex').slice(0, 20)}`,
    source: 'Offizielle Lokal-Website', originSource: 'vienna-merchant-website',
    // A Vienna directory address is a lead, not proof of coupon participation.
    evidence: { ...deal.evidence, directoryLead: { name: task.merchant.name,
      website: task.merchant.website, address: task.merchant.address, sourceUrl: task.merchant.sourceUrl,
      observedAt: task.merchant.observedAt }, candidateLane: 'merchant-website-review' },
  }));
}

export function currentMerchantCandidates(state, now) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  return Object.values(state).filter(row => row.status === 'ok'
    && Date.parse(row.checkedAt) >= +now - 8 * DAY && Date.parse(row.checkedAt) <= +now)
    .flatMap(row => row.deals || [])
    .filter(deal => /^\d{4}-\d{2}-\d{2}$/.test(deal.validUntil || '')
      ? deal.validUntil >= today
      : !Number.isFinite(Date.parse(deal.validUntil)) || Date.parse(deal.validUntil) >= +now);
}

export function isMerchantWebsiteReview(deal, now = new Date()) {
  const evidence = deal?.evidence;
  const checked = Date.parse(evidence?.checkedAt);
  return deal?.originSource === 'vienna-merchant-website'
    && evidence?.source === 'official-merchant-page'
    && evidence?.candidateLane === 'merchant-website-review'
    && Number.isFinite(checked) && checked <= +now && checked >= +now - 8 * DAY
    && Boolean(canonicalOfferUrl(deal.url, evidence?.directoryLead?.website))
    && evidence?.sourceUrl === deal.url && Boolean(evidence?.textSample)
    && !discoveryRejection(deal);
}
