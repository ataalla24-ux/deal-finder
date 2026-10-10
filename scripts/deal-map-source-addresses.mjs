import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { extractAddresses, inspectDealLocation, locationFingerprint, normalize } from './deal-map-enrichment.mjs';

const manager = 'source-address-discovery-v1';
const policyVersion = 1;
const userAgent = 'FreeFinder-source-discovery/1.0 (+https://freefinder.at)';
const dayMs = 86400000;
const ttl = { positive: 7 * dayMs, negative: dayMs, error: 15 * 60000 };
const hash = value => createHash('sha256').update(value).digest('hex');
const addressKey = address => normalize(`${address.street} ${address.number}`).replace(/ /g, '');
const viennaPostcode = /^1(?:0[1-9]|1[0-9]|2[0-3])0$/;
const boilerplate = 'footer,header,nav,aside,[role="contentinfo"],[hidden],[aria-hidden="true"],[id*="footer" i],[class*="footer" i]';
const blockedHosts = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.watch|threads\.(net|com)|tiktok\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|linkedin\.com|pinterest\.[a-z.]+|reddit\.com|t\.co|bit\.ly|linktr\.ee|tinyurl\.com|gutscheine\.at|gutschein[a-z-]*\.[a-z.]+|marktguru\.[a-z.]+|wogibtswas\.[a-z.]+|preisjaeger\.at|mydealz\.de|aktionsfinder\.at|foodora\.[a-z.]+|lieferando\.at|wolt\.com|google\.[a-z.]+|tripadvisor\.[a-z.]+|yelp\.[a-z.]+|foursquare\.com|booking\.com|thefork\.[a-z.]+|neotaste\.[a-z.]+)$/i;

let dependencies;
async function discoveryDependencies() {
  dependencies ??= Promise.all([import('cheerio'), import('robots-parser'), import('./discover-vienna-merchants.mjs')])
    .then(([html, robots, discovery]) => ({ load: html.load, robotsParser: robots.default, ...discovery }));
  return dependencies;
}

async function fetchMerchantPage(url, hops) {
  return (await discoveryDependencies()).fetchMerchantPage(url, hops);
}

function sourceUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, '');
    const path = decodeURIComponent(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.')
      || /[\[\]:]/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return '';
    if (url.hostname !== host || blockedHosts.test(host) || /\.(local|localhost|internal|lan|home|test|invalid)$/i.test(host)) return '';
    if (/[\\\u0000-\u0020\u007f]/.test(path)
      || /(^|\/)(log[._-]?in|sign[._-]?in|auth|oauth2?|sso|accounts?|sessions?|members?|admin|checkout|cart|impressum|imprint|privacy|datenschutz|kontakt|contact)([/.;_-]|$)/i.test(path)) return '';
    // No tracking, signed, credential or search URLs; do not rewrite the original URL.
    if (url.search || /[\u0000-\u0020\u007f]/.test(value)) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function datePart(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return '';
  const day = value.slice(0, 10);
  return Number.isFinite(Date.parse(value)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? day : '';
}

function validity(deal, today, now, event = {}) {
  const starts = [deal.validFrom, deal.validOn, event.startDate].filter(Boolean);
  const ends = [deal.validUntil, deal.validOn, deal.expires, deal.expiry, deal.expiresAt, event.endDate].filter(Boolean);
  if ([...starts, ...ends].some(value => !datePart(value))) return { reason: 'unparseable-validity' };
  const validFrom = starts.map(datePart).sort().at(-1) || '';
  const validUntil = ends.map(datePart).sort()[0] || '';
  if (validFrom > today || (validUntil && validUntil < today)
    || ends.some(value => value.includes('T') && Date.parse(value) <= now.getTime())) return { reason: 'evidence-not-current' };
  const evidenceExpiresAt = ends.filter(value => value.includes('T')).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || '';
  return { validFrom, validUntil, evidenceExpiresAt };
}

function postalAddress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const street = String(value.streetAddress || '').trim();
  const addresses = extractAddresses(street);
  if (addresses.length !== 1) return null;
  const address = addresses[0];
  if (normalize(`${address.street} ${address.number}`) !== normalize(street) || !/^\d+[a-z]?$/i.test(address.number)) return null;
  const country = normalize(typeof value.addressCountry === 'object' ? value.addressCountry?.name : value.addressCountry);
  if (!['wien', 'vienna'].includes(normalize(value.addressLocality)) || !viennaPostcode.test(String(value.postalCode || ''))
    || (country && !['at', 'austria', 'osterreich'].includes(country))) return null;
  return { street: address.street, number: address.number, postalCode: String(value.postalCode) };
}

function visibleAddresses(text) {
  const exact = extractAddresses(text);
  // Wider detection is only an ambiguity guard, not permission to geocode guessed streets.
  const pattern = /\b((?:[A-Z\u00c4\u00d6\u00dc][\p{L}.-]*[ -]){0,3}[A-Z\u00c4\u00d6\u00dc][\p{L}.-]*)\s+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)(?:,?\s+(\d{4})\s+(?:Wien|Vienna))?/gu;
  const broad = [...text.matchAll(pattern)].map(match => ({ street: match[1], number: match[2], postalCode: match[3] || '' }));
  return [...exact, ...broad.filter(candidate => !exact.some(address => address.number === candidate.number
    && normalize(address.street).endsWith(normalize(candidate.street))
    && (!candidate.postalCode || candidate.postalCode === address.postalCode)))];
}

function textOf(node) {
  const stack = node ? [node] : [];
  const chunks = [];
  let visited = 0;
  while (stack.length) {
    if (++visited > 100000) return '';
    const current = stack.pop();
    if (current.type === 'text') chunks.push(current.data);
    else for (let index = (current.children?.length || 0) - 1; index >= 0; index--) stack.push(current.children[index]);
  }
  return chunks.join(' ');
}

const includesPhrase = (text, phrase) => Boolean(phrase) && ` ${normalize(text)} `.includes(` ${normalize(phrase)} `);
const hasType = (node, type) => [node?.['@type']].flat().some(value => String(value).replace(/^https?:\/\/schema\.org\//, '') === type);

function structuredNodes($) {
  const nodes = [];
  let visited = 0;
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object') return;
    if (++visited > 1500 || depth > 24) throw new Error('structured-data-limit');
    if (!Array.isArray(value)) nodes.push(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  const scripts = $('script[type="application/ld+json"]').filter((_, node) => !$(node).parents(boilerplate).length);
  if (scripts.length > 40) throw new Error('structured-data-limit');
  scripts.each((_, node) => visit(JSON.parse($(node).text())));
  const ids = new Map();
  for (const node of nodes) {
    if (typeof node['@id'] !== 'string' || Object.keys(node).length === 1) continue;
    if (ids.has(node['@id']) && JSON.stringify(ids.get(node['@id'])) !== JSON.stringify(node)) throw new Error('conflicting-structured-identity');
    ids.set(node['@id'], node);
  }
  return { nodes, resolve: value => value && Object.keys(value).length === 1 && value['@id'] ? ids.get(value['@id']) : value };
}

function samePage(value, url) {
  if (!value) return true;
  if (typeof value !== 'string') return false;
  try {
    const candidate = new URL(value, url);
    candidate.hash = '';
    return candidate.href === url;
  } catch { return false; }
}

// Pure evidence inspection. Text-only addresses remain candidates, never approvals.
export async function inspectSourceAddressPage({ deal, html, url = deal.url, now = new Date() }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const negative = (reason, candidates = []) => ({ outcome: 'negative', reason, candidates });
  if (!sourceUrl(url) || sourceUrl(url) !== sourceUrl(deal.url)) return negative('source-url-mismatch');
  if (typeof html !== 'string' || Buffer.byteLength(html) > 2_500_000) return negative('invalid-html');
  const { load } = await discoveryDependencies();
  const $ = load(html);
  if ($('input[type="password"]').length || /captcha|access denied|verify you are human/i.test($('title').text())) return negative('restricted-page');
  if ($('link[rel="canonical"]').toArray().some(node => !samePage($(node).attr('href'), url))) return negative('canonical-source-mismatch');
  let graph;
  try { graph = structuredNodes($); } catch { return negative('invalid-structured-data'); }
  $(boilerplate).remove();
  $('script,style,noscript,template,[style*="display:none" i],[style*="display: none" i]').remove();
  const title = normalize(deal.title);
  const brand = normalize(deal.brand);
  if (!brand || title.length < 12 || title.split(' ').length < 3) return negative('insufficient-offer-identity');
  const headings = $('h1,h2,h3').filter((_, node) => normalize(textOf(node)) === title);
  if (headings.length !== 1) return negative('offer-heading-mismatch');
  const scope = headings.closest('article').length ? headings.closest('article') : headings.closest('main');
  if (scope.length !== 1) return negative('missing-offer-region');
  const text = textOf(scope[0]);
  const visible = visibleAddresses(text);
  const candidates = [...new Map(visible.map(address => [addressKey(address), address])).values()].slice(0, 10);
  if (!includesPhrase(text, brand)) return negative('brand-not-corroborated', candidates);
  if (/\b(nicht|ausgenommen|ausser|except|excluded|not|abgelaufen|beendet|expired|cancelled|teilnehmende\w*|filialen|standorte|branches|locations|stores|nur online|online only)\b/.test(normalize(text))) return negative('ambiguous-offer-membership', candidates);
  if (new Set(visible.map(addressKey)).size !== 1) return negative(visible.length ? 'multiple-source-addresses' : 'no-visible-offer-address', candidates);

  const allPostal = graph.nodes.filter(node => node.streetAddress);
  const allKeys = new Set(allPostal.map(node => normalize(node.streetAddress).replace(/ /g, '')));
  if (allKeys.size > 1) return negative('multiple-structured-addresses', candidates);
  const proofs = [];
  let mismatch = false;
  for (const node of graph.nodes) {
    const event = hasType(node, 'Event');
    const business = hasType(node, 'LocalBusiness') || hasType(node, 'Restaurant');
    if (!event && !business) continue;
    if (event && normalize(node.name) !== title) continue;
    if (business && normalize(node.name) !== brand) continue;
    if (!samePage(node.url, url) || !samePage(node.mainEntityOfPage?.['@id'] || node.mainEntityOfPage, url)) { mismatch = true; continue; }
    if (event && (/Cancelled|Postponed|Rescheduled/.test(String(node.eventStatus || '')) || /OnlineEventAttendanceMode/.test(String(node.eventAttendanceMode || '')))) { mismatch = true; continue; }
    const place = event ? graph.resolve(node.location) : node;
    if (!place || Array.isArray(place) || normalize(place.name) !== brand) { mismatch = true; continue; }
    const address = postalAddress(graph.resolve(place.address));
    if (!address || !visible.some(item => addressKey(item) === addressKey(address) && item.postalCode === address.postalCode)
      || visible.some(item => item.postalCode && item.postalCode !== address.postalCode)) { mismatch = true; continue; }
    const window = validity(deal, today, now, event ? { ...node,
      endDate: node.endDate || (typeof node.startDate === 'string' ? node.startDate.slice(0, 10) : node.startDate) } : {});
    if (window.reason) { mismatch = true; continue; }
    if (!event) {
      const membership = scope.find('p,li,address').toArray().some(element => {
        const sentence = textOf(element);
        return sentence.length <= 500 && includesPhrase(sentence, brand)
          && extractAddresses(sentence).some(item => addressKey(item) === addressKey(address))
          && /\b(?:dieses angebot|diese aktion|dieser gutschein|this offer|this deal)\b.{0,100}\b(?:gilt|einlosbar|erhaltlich|valid|redeemable|available)\b/.test(normalize(sentence));
      });
      if (!membership) continue;
    }
    proofs.push({ ...address, ...(window.validFrom ? { validFrom: window.validFrom } : {}),
      ...(window.validUntil ? { validUntil: window.validUntil } : {}), evidenceExpiresAt: window.evidenceExpiresAt,
      evidenceKind: event ? 'jsonld-event-location' : 'jsonld-business-explicit-offer' });
  }
  if (mismatch) return negative('structured-evidence-mismatch', candidates);
  if (!proofs.length) return negative('membership-unproven', candidates);
  // Conflicting dates or kinds need review too; do not select whichever proof is convenient.
  const unique = [...new Map(proofs.map(proof => [JSON.stringify(proof), proof])).values()];
  if (unique.length !== 1) return negative('multiple-offer-proofs', candidates);
  const { evidenceKind, evidenceExpiresAt, ...address } = unique[0];
  return { outcome: 'positive', reason: 'exact-source-offer-address', candidates: [address], evidenceKind, evidenceExpiresAt, locations: [address] };
}

function inputFingerprint(deal) {
  return hash(JSON.stringify([locationFingerprint(deal), deal.validFrom, deal.validUntil, deal.expires,
    deal.sourceUrl, deal.originalUrl, deal.cardEditorial?.sourceUrl]));
}

function usableCache(entry, deal, url, fingerprint, now, today) {
  if (!entry || entry.policyVersion !== policyVersion || entry.inputFingerprint !== fingerprint || entry.sourceUrl !== url) return false;
  const age = now - new Date(entry.checkedAt);
  if (!(age >= 0 && age < (ttl[entry.outcome] || 0))) return false;
  if (entry.outcome !== 'positive') return true;
  if (!/^[a-f0-9]{64}$/.test(entry.contentFingerprint || '') || entry.locations?.length !== 1
    || (entry.evidenceExpiresAt && !(Date.parse(entry.evidenceExpiresAt) > now.getTime()))) return false;
  const address = entry.locations[0];
  if (!postalAddress({ streetAddress: `${address.street} ${address.number}`, postalCode: address.postalCode, addressLocality: 'Wien' })) return false;
  return !validity(deal, today, now, { startDate: address.validFrom, endDate: address.validUntil }).reason;
}

/**
 * No writes, geocoding, link crawling or feed mutation. Cache may be persisted separately;
 * returned reviewed is ephemeral and must never replace the manual review file.
 * maxRequests counts robots and HTML calls; the 30s default is a request-start deadline.
 * One already-started pinned-DNS call retains the helper's own DNS/HTTP timeouts.
 */
export async function enrichSourceAddresses({ deals, map, catalog = {}, reviewed = {}, cache = {}, now = new Date(),
  maxRequests = 8, fetchPage = fetchMerchantPage, maxDurationMs = 30000 }) {
  const enriched = structuredClone(reviewed);
  const nextCache = structuredClone(cache);
  // A returned auto-entry is not manual authority: revalidate through the cache on every run.
  for (const [id, entry] of Object.entries(enriched)) if (entry?.managedBy === manager) delete enriched[id];
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const budget = Number.isFinite(maxRequests) ? Math.max(0, Math.floor(maxRequests)) : 0;
  const duration = Number.isFinite(maxDurationMs) ? Math.max(0, Math.min(maxDurationMs, 120000)) : 0;
  const deadline = performance.now() + duration;
  const originTimes = new Map();
  const robotsByOrigin = new Map();
  const rows = [];
  const pending = [];
  let requests = 0;
  async function request(url, markAttempt) {
    if (requests >= budget) throw new Error('request-budget');
    const origin = new URL(url).origin;
    const wait = Math.max(0, (originTimes.get(origin) || 0) + 500 - performance.now());
    if (performance.now() + wait >= deadline) throw new Error('time-budget');
    if (wait) await pause(wait);
    if (performance.now() >= deadline) throw new Error('time-budget');
    requests++;
    markAttempt();
    try {
      // Starting at the redirect ceiling makes the shared helper refuse a redirect BEFORE
      // requesting its target. This also keeps robots and request accounting exact.
      const result = await fetchPage(url, 3);
      if (!result || result.url !== url || (result.status >= 300 && result.status < 400)) throw new Error('redirect-deferred');
      return result;
    } finally { originTimes.set(origin, performance.now()); }
  }
  function applyResult({ deal, row, fingerprint, url }, result) {
    row.reason = result.reason;
    row.candidates = structuredClone(result.candidates || []);
    if (result.outcome === 'positive') {
      enriched[deal.id] = { managedBy: manager, evidenceUrl: url, evidenceKind: result.evidenceKind,
        fingerprint: row.fingerprint, inputFingerprint: fingerprint, contentFingerprint: result.contentFingerprint,
        checkedAt: result.checkedAt, evidenceExpiresAt: result.evidenceExpiresAt, locations: structuredClone(result.locations) };
      row.status = 'address-ready';
    } else if (row.candidates.length) row.status = 'candidates-only';
  }
  for (const deal of deals) {
    const assessment = inspectDealLocation(deal, { map, catalog, reviewed: enriched, today });
    const row = { id: deal.id, brand: deal.brand, status: assessment.status, reason: assessment.reason, cacheHit: false,
      fingerprint: locationFingerprint(deal), candidates: [] };
    rows.push(row);
    if (assessment.status !== 'needs-review' || assessment.reason !== 'missing-exact-address') continue;
    const url = sourceUrl(deal.url);
    if (!url) { row.reason = 'source-url-ineligible'; continue; }
    row.sourceUrl = url;
    // Never substitute a homepage, guessed merchant URL, editorial link or final redirect.
    if ([deal.originalUrl, deal.sourceUrl, deal.cardEditorial?.sourceUrl].filter(Boolean).some(value => sourceUrl(value) !== url)) {
      row.reason = 'original-source-mismatch'; continue;
    }
    const window = validity(deal, today, now);
    if (window.reason) { row.reason = window.reason; continue; }
    const fingerprint = inputFingerprint(deal);
    const key = `${manager}:${hash(String(deal.id))}`;
    const result = nextCache[key];
    const job = { deal, row, fingerprint, url, key, index: rows.length - 1 };
    if (usableCache(result, deal, url, fingerprint, now, today)) {
      row.cacheHit = true;
      applyResult(job, result);
    } else {
      const attemptedAt = result?.sourceUrl === url ? Date.parse(result.lastAttemptAt || result.checkedAt) : NaN;
      const lastAttempt = Number.isFinite(attemptedAt) && attemptedAt >= 0 && attemptedAt <= now.getTime() ? attemptedAt : -Infinity;
      // Retain scheduling history, never expired or edited evidence, even on cache-only runs.
      if (Number.isFinite(lastAttempt)) nextCache[key] = { sourceUrl: url, lastAttemptAt: new Date(lastAttempt).toISOString() };
      else delete nextCache[key];
      pending.push({ ...job, lastAttempt });
    }
  }
  // Sort a separate queue, not deals or report rows; unattempted sources precede retries.
  pending.sort((a, b) => a.lastAttempt - b.lastAttempt || a.index - b.index);
  for (const job of pending) {
    const { deal, row, fingerprint, url, key } = job;
    const markAttempt = () => { nextCache[key] = { sourceUrl: url, lastAttemptAt: now.toISOString() }; };
    let result;
    try {
      const origin = new URL(url).origin;
      let robots = robotsByOrigin.get(origin);
      if (!robots) {
        robots = await request(new URL('/robots.txt', url).href, markAttempt);
        robotsByOrigin.set(origin, robots);
      }
      const { robotsAllowsDiscovery, robotsParser } = await discoveryDependencies();
      if (robots.status !== 404 && robots.status !== 200) throw new Error('robots-unavailable');
      if (robots.status === 200 && (typeof robots.body !== 'string' || Buffer.byteLength(robots.body) > 512000
        || /<(?:html|!doctype)/i.test(robots.body))) throw new Error('robots-unreadable');
      if (robots.status === 200 && !robotsAllowsDiscovery(robots.body, url)) result = { outcome: 'negative', reason: 'robots-disallowed', candidates: [] };
      else if (robots.status === 200 && robotsParser(new URL('/robots.txt', url).href, robots.body).getCrawlDelay(userAgent) > 0) {
        result = { outcome: 'negative', reason: 'robots-crawl-delay-deferred', candidates: [] };
      } else {
        const page = await request(url, markAttempt);
        if (page.status === 404 || page.status === 410) result = { outcome: 'negative', reason: 'source-unavailable', candidates: [] };
        else if (page.status !== 200) throw new Error('source-http-error');
        else if (!/^text\/html(?:;|$)/i.test(page.headers?.['content-type'] || '')) throw new Error('source-not-html');
        else result = { ...await inspectSourceAddressPage({ deal, html: page.body, url, now }), contentFingerprint: hash(page.body) };
      }
    } catch (error) {
      const reason = ['request-budget', 'time-budget', 'redirect-deferred', 'robots-unavailable', 'robots-unreadable', 'source-http-error', 'source-not-html'].includes(error.message)
        ? error.message : 'source-fetch-error';
      if (reason === 'request-budget' || reason === 'time-budget') { row.reason = reason; continue; }
      result = { outcome: 'error', reason, candidates: [] };
    }
    result = { ...result, policyVersion, inputFingerprint: fingerprint, sourceUrl: url,
      checkedAt: now.toISOString(), lastAttemptAt: now.toISOString() };
    nextCache[key] = result;
    applyResult(job, result);
  }
  return { reviewed: enriched, cache: nextCache, requests, report: { generatedAt: now.toISOString(), totalDeals: deals.length,
    enrichedDeals: rows.filter(row => row.reason === 'exact-source-offer-address').length,
    candidateDeals: rows.filter(row => row.status === 'candidates-only').length,
    cacheHits: rows.filter(row => row.cacheHit).length, requests, deals: rows } };
}
