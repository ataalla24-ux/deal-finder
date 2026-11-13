import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { merchantOfferHostPaused } from './merchant-offer-discovery.js';
import { retryAfterAt } from './source-http-policy.js';

const DAY = 86400000;
const ROOT = new URL('../', import.meta.url);
const PAUSE_PATH = new URL('docs/reviewed-social-source-pause.json', ROOT);
const HOME = 'https://www.napoleon.wien/';
const ORIGIN = 'https://www.napoleon.wien';
const OFFER = `${HOME}2026/11/05/napoleon-kinder-happy-hour-50-auf-kindergerichte/`;
const POST = 'https://www.instagram.com/p/DfZ9qMYsGRG/';
const ID = 'meta-ig-18101671448672416';
const CAPTION_HASH = '0d310508ffefc6f77c1901ee3915ff90e66b35e054c7d0538a027f0debbce1d7';
const TITLE = 'Napoleon Kinder Happy Hour: 50% auf Kindergerichte';
const TERMS = 'Bei unserer Napoleon Kinder Happy Hour gibt’s von Montag bis Freitag, 15:30–17:30 Uhr, für alle Kinder bis 12 Jahre 50% auf die Kindergerichte!';
const COPY = 'Im Gasthaus Napoleon gibt es montags bis freitags von 15:30 bis 17:30 Uhr 50 % Rabatt auf Kindergerichte für Kinder bis 12 Jahre.';
const ADDRESS = 'Kagraner Platz 33, 1220 Wien';
const clean = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const caption = value => clean(String(value || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ''));
const hash = value => createHash('sha256').update(value).digest('hex');

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export function readReviewedSocialSourceState(pausePath = PAUSE_PATH) {
  return {
    pause: readJson(pausePath, {}),
    websites: readJson(new URL('reviews/vienna-merchant-website-state.json', ROOT), {}),
    offers: readJson(new URL('reviews/vienna-merchant-offer-state.json', ROOT), {}),
    power: readJson(new URL('docs/power-scraper-report.json', ROOT), {}),
  };
}

export function recordReviewedSocialSourcePause(row, pausePath = PAUSE_PATH) {
  const previous = readJson(pausePath, {});
  const prior = previous[ORIGIN];
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)
    || (prior !== undefined && (!prior || typeof prior !== 'object' || !Number.isFinite(Date.parse(prior.retryAt))))
    || !Number.isFinite(Date.parse(row.retryAt))) throw new Error('Invalid saved source pause');
  if (Date.parse(prior?.retryAt) >= Date.parse(row.retryAt)) return;
  const temporary = `${pausePath instanceof URL ? pausePath.pathname : pausePath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({ ...previous, [ORIGIN]: { sourceUrl: HOME, ...row } }, null, 2)}\n`);
  renameSync(temporary, pausePath);
}

// Exactly one ordinary HTML request replaces the original social URL probe.
// A redirect (including another path on this origin) is not followed.
export async function fetchReviewedSocialOfficialPage(url, { fetchImpl = fetch } = {}) {
  if (url !== HOME) throw new Error('Unreviewed official source');
  const response = await fetchImpl(url, {
    redirect: 'manual', signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': 'FreeFinder/1.0 (+https://freefinder.at)', 'accept-language': 'de-AT,de;q=0.9' },
  });
  const result = { status: response.status, finalUrl: response.url || url, retryAfter: response.headers.get('retry-after') || '' };
  if (response.status !== 200 || result.finalUrl !== HOME || !/text\/html/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    return result;
  }
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 2500000) { await reader.cancel(); throw new Error('Official source HTML limit'); }
    chunks.push(value);
  }
  return { ...result, html: Buffer.concat(chunks).toString('utf8') };
}

function matchesReviewedCandidate(deal, now) {
  const published = Date.parse(deal.sourcePublishedAt);
  const absent = fields => fields.every(field => deal[field] === undefined || deal[field] === null || deal[field] === '');
  // This exception corroborates one known offer, not arbitrary edited facts.
  // No end date or fixed price is stated by the original or the current page.
  if (!absent(['expires', 'validFrom', 'validUntil', 'validOn', 'expiresOriginal', 'expiryDisplayText', 'end_date', 'validity_date',
    'price', 'originalPrice', 'priceText', 'couponCode', 'code', 'conditions', 'minimumSpend', 'minSpend'])
    || !['', 'recurring'].includes(clean(deal.expiryKind))
    || (deal.discountPercent != null && deal.discountPercent !== '' && Number(deal.discountPercent) !== 50)
    || (deal.ageLimit != null && deal.ageLimit !== '' && Number(deal.ageLimit) !== 12)
    || !['', ADDRESS].includes(clean(deal.address))
    || !['', 'Wien', ADDRESS].includes(clean(deal.distance))
    || !['', 'Wien'].includes(clean(deal.city))
    || !['', '1220'].includes(clean(deal.postalCode))
    || !['', ADDRESS].includes(clean(deal.ort))
    || !['', ADDRESS, 'Jetzt reservieren: www.napoleon.wien .'].includes(caption(deal.location))
    || !['', '-50%'].includes(clean(deal.promotionEvidence))
    || [deal.offerText, deal.metaGraphOcrText, deal.evidence?.textSample,
      deal.evidence?.mediaEvidence?.ocrText, deal.evidence?.mediaEvidence?.ai?.offerText]
      .some(value => clean(value) && caption(value) !== caption(deal.metaGraphCaption))) return false;
  return deal.url === POST && deal.brand === 'Napoleon Wien' && deal.title === '50% auf Kindergerichte'
    && deal.ownerUsername === 'napoleon.wien' && deal.sourceAccountType === 'merchant'
    && deal.originSource === 'Meta Instagram Business Discovery'
    && deal.metaGraphVerified === true && deal.metaGraphMediaId === '18101671448672416'
    && ['instagram-graph-timestamp', 'url.instagramShortcode'].includes(deal.sourcePublishedAtSource)
    && Number.isFinite(published) && published <= +now && published >= +now - 45 * DAY
    && ['2026-11-06T15:47:42.000Z', '2026-11-06T15:51:17.000Z'].includes(new Date(published).toISOString())
    && hash(caption(deal.metaGraphCaption)) === CAPTION_HASH
    && [caption(deal.metaGraphCaption), COPY].includes(caption(deal.description))
    && deal.type === 'rabatt' && deal.category === 'essen'
    && !deal.isRepost && !deal.metaGraphIsRepost
    && (!deal.metaGraphBlockingReason || deal.metaGraphBlockingReason === 'post-too-old');
}

export function parseReviewedNapoleonOffer(html, finalUrl) {
  if (finalUrl !== HOME || typeof html !== 'string' || Buffer.byteLength(html) > 2500000) return null;
  const $ = load(html);
  $('script,style,noscript,svg,[hidden],[aria-hidden="true"]').remove();
  $('[style]').filter((_, node) => /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(node).attr('style'))).remove();
  const text = node => clean($(node).clone().find('*').append(' ').end().text());
  const links = $('.wp-block-news-events-feature .card.post > .wrapper > a[href]').filter((_, node) => $(node).attr('href') === OFFER);
  // The reviewed layout repeats the same offer once for desktop and mobile.
  // A withdrawn or changed copy must not inherit the other copy's evidence.
  if (links.length !== 2) return null;
  for (const link of links.toArray()) {
    const content = $(link).children('.content');
    if (content.length !== 1 || clean(content.find('h3').text()) !== TITLE
      || content.find('.mb-3').length !== 1 || clean(content.find('.mb-3').text()) !== TERMS
      || text(content) !== `News ${TITLE} ${TERMS}`) return null;
  }
  const contact = $('footer a[href="mailto:info@napoleon.wien"]');
  if (contact.length !== 1 || !/^Kagraner Platz 33, 1220 Wien\b/.test(text(contact.parent('p')))) return null;
  const footerText = text($('footer'));
  const addresses = [...footerText.matchAll(/[^,.;]{0,60}\d+[a-z]?\s*,\s*1\d{3}\s+Wien\b/g)].map(match => match[0]);
  if (addresses.length !== 1) return null;
  return { sourceUrl: HOME, offerUrl: OFFER, contentHash: hash(`${TITLE}|${TERMS}|Kagraner Platz 33, 1220 Wien`),
    address: 'Kagraner Platz 33, 1220 Wien', recurring: 'Mo–Fr 15:30–17:30', ageLimit: 12, discountPercent: 50 };
}

// No caller-supplied "verified" field is accepted. Every successful result is
// produced from this run's fetched, precisely matched official homepage segment.
export async function verifyReviewedSocialOfficialOffer(deal, {
  approvalContext = false, now = new Date(), cache = new Map(),
  fetchPage = fetchReviewedSocialOfficialPage, readState = readReviewedSocialSourceState,
  recordPause = recordReviewedSocialSourcePause,
} = {}) {
  if (!approvalContext || deal?.id !== ID || deal.pipelineLifecycle?.manualDecision !== 'approved') return null;
  if (!matchesReviewedCandidate(deal, now)) return { ok: false, reason: 'reviewed-candidate-changed' };
  const key = `reviewed-social-official:${HOME}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    let state;
    try { state = readState(); } catch { return { ok: false, reason: 'source-pause-unreadable' }; }
    if (!state || ['pause', 'websites', 'offers', 'power'].some(key => !state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])))
      return { ok: false, reason: 'source-pause-unreadable' };
    const ownPause = state.pause[ORIGIN], retry = ownPause?.retryAt;
    if (ownPause !== undefined && (!ownPause || typeof ownPause !== 'object' || !Number.isFinite(Date.parse(retry))))
      return { ok: false, reason: 'source-pause-unreadable' };
    if (Date.parse(retry) > +now || merchantOfferHostPaused(HOME, state.websites, now, state.power)
      || merchantOfferHostPaused(HOME, state.offers, now, state.power))
      return { ok: false, reason: 'source-paused' };
    let response;
    try { response = await fetchPage(HOME); }
    catch { return { ok: false, reason: 'source-unavailable' }; }
    const health = { status: response?.status, finalUrl: response?.finalUrl || HOME, dateHints: {}, contentHints: {} };
    if ([401, 403, 429].includes(response?.status)) {
      const after = Date.parse(retryAfterAt(response.retryAfter, now)) || 0;
      const retryAt = new Date(Math.max(+now + (response.status === 429 ? 1 : 3) * DAY, after)).toISOString();
      try { recordPause({ checkedAt: now.toISOString(), retryAt, httpStatus: response.status }); }
      catch { return { ok: false, reason: 'source-pause-storage-failed', health }; }
    }
    if (response?.status !== 200 || response.finalUrl !== HOME) return { ok: false, reason: 'source-unavailable-or-redirected', health };
    const proof = parseReviewedNapoleonOffer(response.html, response.finalUrl);
    if (!proof) return { ok: false, reason: 'current-official-offer-unconfirmed', health };
    return { ok: true, health, proof: { ...proof, checkedAt: now.toISOString(), method: 'reviewed-official-homepage-segment' } };
  })());
  return cache.get(key);
}
