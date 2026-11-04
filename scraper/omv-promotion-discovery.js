import { load } from 'cheerio';
import crypto from 'node:crypto';
import { extractActiveOfferWindow } from './instagram-ai-validity-utils.js';
import { sourceFailureFields, sourceHttpError } from './source-http-policy.js';

export const OMV_PROMOTION_SEEDS = [
  'https://presse.ikp.at/News.aspx?menueid=33632&l=deutsch',
  'https://www.omv.at/de/viva/viva-kaffee',
];
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

export function omvPromotionUrl(value, base) {
  try {
    const u = new URL(value, base);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
    if (['www.omv.at', 'omv.at'].includes(u.hostname)) {
      if (!/^\/de\/(?:viva\/viva-kaffee(?:\/[^?#]*)?|markenpartner\/joe-partner)\/?$/.test(u.pathname)) return '';
      u.search = '';
    } else if (u.hostname === 'presse.ikp.at') {
      if (u.searchParams.get('menueid') !== '33632'
          || !(/\/News\.aspx$/i.test(u.pathname) || /^\/news-[a-z0-9-]+$/i.test(u.pathname))) return '';
      if (!/\/News\.aspx$/i.test(u.pathname) && !/^\d+$/.test(u.searchParams.get('id') || '')) return '';
      const id = u.searchParams.get('id');
      u.search = '';
      if (id) u.searchParams.set('id', id);
      u.searchParams.set('menueid', '33632');
      u.searchParams.set('l', 'deutsch');
    } else return '';
    u.hash = '';
    return u.href;
  } catch { return ''; }
}

export function discoverOmvPromotionLinks(html, pageUrl) {
  const $ = load(html), links = new Map();
  $('a[href]').each((_, el) => {
    const url = omvPromotionUrl($(el).attr('href'), pageUrl);
    if (!url || url === pageUrl) return;
    const u = new URL(url);
    if (!/kaffee|coffee|viva|latte|espresso|winterdrink|eiskaffee|gratis/i.test(`${u.pathname} ${$(el).text()}`)) return;
    const key = u.hostname === 'presse.ikp.at' ? `press:${u.searchParams.get('id')}` : url;
    if (key === 'press:null') return;
    links.set(key, url);
  });
  return [...links.values()].slice(0, 6);
}

export function parseOmvPromotion(html, pageUrl, now = new Date()) {
  const url = omvPromotionUrl(pageUrl);
  const reject = reason => ({ deals: [], rejected: [{ url: pageUrl, reason }] });
  if (!url) return reject('untrusted-source-url');
  const $ = load(html);
  $('script,style,nav,footer,header,noscript').remove();
  const press = new URL(url).hostname === 'presse.ikp.at';
  const root = press ? $('.detail.text-long').first() : $('main').first();
  if (!root.length) return reject('missing-offer-body');
  const title = clean($('h1').first().text());
  const text = clean(root.text());
  if (/\bnur\s+(?:in\s+)?(?:Deutschland|Tschechien|Slowakei|Ungarn|Rumänien)\b|\b(?:CZK|RON|HUF)\b/i.test(text)) return reject('outside-austria');
  if (!/OMV|VIVA/i.test(title) || !/jö|jo[eö] app|jo[eö] äpp/i.test(text)
      || !/kaffee|coffee|latte|espresso|winterdrinks/i.test(text)) return reject('not-omv-joe-coffee-offer');
  const paragraphs = root.find('p,li').map((_, el) => clean($(el).text())).get();
  const windows = paragraphs.filter(p => /gratis|kostenlos|kostenfrei/i.test(p)
    && !/\b(?:nicht|kein\w*|no|not)\s+(?:mehr\s+)?(?:gratis|kostenlos\w*|kostenfrei|free)\b/i.test(p)
    && /jö|mitglieder/i.test(p) && /20\d{2}/.test(p)).map(p => ({ paragraph: p, window: extractActiveOfferWindow(p, { now }) }))
    .filter(entry => entry.window?.endDate && /20\d{2}/.test(entry.window.evidence));
  if (!windows.length) return reject('no-explicit-dated-free-offer');
  if (new Set(windows.map(e => e.window.endDate.toISOString().slice(0, 10))).size !== 1) return reject('conflicting-offer-dates');
  windows.sort((a, b) => Number(Boolean(b.window.startDate)) - Number(Boolean(a.window.startDate)));
  const { paragraph, window } = windows[0];
  const validUntil = window.endDate.toISOString().slice(0, 10);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  if (validUntil < today) return reject('offer-expired');
  const names = [...new Set(root.find('strong,b,h2,h3').map((_, el) => clean($(el).text()).replace(/[,.;:]+$/, '')).get()
    .filter(name => name.length <= 70 && /\b(?:Latte|Espresso|Cappuccino|Matcha)\b/i.test(name)))];
  const countWords = { zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6 };
  const countText = paragraph.match(/\balle\s+([2-6]|zwei|drei|vier|fünf|sechs)\b/i)?.[1]?.toLowerCase();
  const count = countWords[countText] || Number(countText) || 0;
  if (names.length > 6 || count && names.length && names.length !== count) return reject('ambiguous-product-scope');
  const published = $('time[datetime]').first().attr('datetime') || $('meta[property="article:published_time"]').attr('content') || '';
  const publishedDate = /^20\d{2}-\d{2}-\d{2}(?:T.*)?$/.test(published) ? new Date(published) : null;
  if (publishedDate && +publishedDate > +now + 86400000) return reject('publication-in-future');
  const idKey = press ? `ikp-${new URL(url).searchParams.get('id')}` : new URL(url).pathname;
  const id = 'joe-omv-current-' + crypto.createHash('sha256').update(`${idKey}|${validUntil}|${names.join('|')}`).digest('hex').slice(0, 12);
  const campaign = {
    id, brand: 'OMV VIVA', source: 'jö Bonus Club', originSource: 'OMV official public promotion',
    title: `${count || names.length || ''} OMV-Kaffeespezialitäten gratis mit jö`.trim(),
    description: [names.length ? `Sorten: ${names.join(', ')}.` : '', paragraph,
      /jö.{0,15}(?:App|äpp)/i.test(text)
        ? 'Einlösung über die jö App. Gültige OMV/VIVA-Station und persönliche Einlösbarkeit in der App prüfen.'
        : 'Gültige OMV/VIVA-Station und Einlösungsbedingungen im Originalangebot prüfen.'].filter(Boolean).join(' '),
    url, category: 'kaffee', type: 'gratis', logo: '☕', badge: 'jö',
    expires: validUntil, validUntil, ...(window.startDate ? { validFrom: window.startDate.toISOString().slice(0, 10) } : {}),
    expirySource: 'content-date', expiresSource: 'content-date', expiryKind: 'until', dateConfidence: 'high',
    distance: 'Österreich – teilnehmende OMV/VIVA-Stationen (Wien in der App prüfen)',
    location: 'Österreich – teilnehmende OMV/VIVA-Stationen', country: 'AT',
    ...(publishedDate && Number.isFinite(+publishedDate) ? { pubDate: publishedDate.toISOString(), pubDateSource: 'article.published-date', sourcePublishedAt: publishedDate.toISOString(), sourcePublishedAtSource: 'article.published-date' } : {}),
    discoveredAt: now.toISOString(), lastCheckedAt: now.toISOString(), qualityScore: 88, reviewRequired: true,
    promotionProducts: names,
    evidence: { source: 'official-merchant-press-release', sourceUrl: url, checkedAt: now.toISOString(),
      offerText: paragraph, offerTiming: { matchedText: window.evidence, validUntil },
      contentHash: crypto.createHash('sha256').update(text).digest('hex') },
  };
  // Separate cards require explicit per-variety redemption, not merely a choice of drinks.
  const separate = names.length > 1 && count === names.length && /\bje(?:weils)?\s+einmal\s+gratis\b/i.test(paragraph);
  const deals = separate ? names.map(name => ({
    ...campaign,
    id: `${id}-${crypto.createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 12)}`,
    title: `Gratis ${name} mit jö`,
    description: `Diese Karte: ${name} einmal gratis testen. ${campaign.description}`,
    promotionCampaignId: id,
    promotionProducts: [name],
    promotionCampaignProducts: names,
  })) : [campaign];
  return { rejected: [], deals };
}

export function retainActiveOmvPromotions(current, previous, now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const retained = previous.filter(deal => deal.id?.startsWith('joe-omv-current-')
    && omvPromotionUrl(deal.url) && /^20\d{2}-\d{2}-\d{2}$/.test(deal.validUntil || '') && deal.validUntil >= today
    && deal.evidence?.offerTiming?.validUntil === deal.validUntil);
  const byId = new Map(retained.map(deal => [deal.id, deal]));
  for (const deal of current) if (deal.promotionCampaignId) byId.delete(deal.promotionCampaignId);
  for (const deal of current) byId.set(deal.id, deal);
  return [...byId.values()];
}

export async function collectOmvPromotions({ fetchImpl = fetch, now = new Date(), previous = {}, knownCampaignUrls = [], maxPages = 6, maxRequests = 8 } = {}) {
  const report = { pages: [], rejected: [], requests: 0, pausesByHost: { ...previous.pausesByHost } };
  const queue = [...OMV_PROMOTION_SEEDS, ...knownCampaignUrls.map(url => omvPromotionUrl(url)).filter(Boolean).slice(0, 2)], seen = new Set(), deals = new Map();
  while (queue.length && report.pages.length < Math.min(6, maxPages) && report.requests < Math.min(8, maxRequests)) {
    let url = queue.shift();
    const key = new URL(url).hostname === 'presse.ikp.at' && new URL(url).searchParams.has('id') ? `press:${new URL(url).searchParams.get('id')}` : url;
    if (seen.has(key)) continue;
    seen.add(key);
    const host = new URL(url).hostname;
    if (Date.parse(report.pausesByHost[host]?.nextRetryAt) > +now) { report.pages.push({ url, status: 'deferred', nextRetryAt: report.pausesByHost[host].nextRetryAt }); continue; }
    const original = url;
    try {
      let html = '';
      for (let redirect = 0; redirect < 3; redirect++) {
        if (report.requests >= Math.min(8, maxRequests)) throw Error('request-budget');
        report.requests++;
        const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'FreeFinder jö/OMV offer reader (+https://freefinder.at)' } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const next = omvPromotionUrl(response.headers.get('location'), url);
          await response.body?.cancel();
          if (!next || redirect === 2) throw Error('untrusted-or-excessive-redirect');
          if (Date.parse(report.pausesByHost[new URL(next).hostname]?.nextRetryAt) > +now) throw Error('redirect-target-host-paused');
          url = next; continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw sourceHttpError(response.status, response.headers.get('retry-after'), now); }
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 2_500_000) throw Error('html-too-large'); chunks.push(value); } }
        finally { await reader.cancel(); }
        html = Buffer.concat(chunks).toString('utf8'); break;
      }
      const parsed = parseOmvPromotion(html, url, now);
      for (const deal of parsed.deals) deals.set(deal.id, deal);
      report.rejected.push(...parsed.rejected);
      report.pages.push({ url: original, finalUrl: url, status: 'ok', candidates: parsed.deals.length });
      delete report.pausesByHost[host];
      for (const link of discoverOmvPromotionLinks(html, url)) if (!queue.includes(link)) queue.push(link);
    } catch (error) {
      const failure = sourceFailureFields(error);
      report.pages.push({ url: original, status: 'error', error: error.message, ...failure });
      if ([401, 403, 429].includes(failure.httpStatus)) report.pausesByHost[new URL(url).hostname] = {
        nextRetryAt: new Date(Math.max(+now + 86400000, Date.parse(failure.retryAt) || 0)).toISOString(), reason: `http-${failure.httpStatus}`,
      };
    }
  }
  report.budgetDeferred = queue.length > 0 && (report.pages.length >= Math.min(6, maxPages) || report.requests >= Math.min(8, maxRequests));
  return { deals: [...deals.values()], report };
}
