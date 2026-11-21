import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { extractIamstudentApprovalSourceEvidence, isReviewedIamstudentApprovalEvidence } from '../scraper/approval-iamstudent-source-evidence.js';
import { parseReviewedNapoleonOffer } from '../scraper/reviewed-social-official-source.js';
import { retryAfterAt } from '../scraper/source-http-policy.js';
import { matchesReviewedPeriod } from './deal-redemptions.mjs';

const HOUR = 3600000;
const AGENT = 'FreeFinderWien/1.0 (public offer maintenance)';
const digest = text => createHash('sha256').update(text).digest('hex');
// Only these reviewed provider pages may consume the existing maintenance HTTP allowance.
const sources = {
  'g2-31pd49': { url: 'https://wienerlazizfood.com/' },
  'fc4g-vqsqje': { url: 'https://www.ikea.com/at/de/stores/wien-nord/', block: '58402bd0-5b5e-11f1-84e8-610f7e0a7507' },
  'g2-1gkjf0g': { url: 'https://www.ikea.com/at/de/stores/wien-westbahnhof/ikea-wien-westbahnhof-angebote-pub1aba7a60/', block: 'a14d49a0-d374-11f1-8bcc-a554c95fee7d' },
  'b1-s5vhj5': { url: 'https://www.ikea.com/at/de/ikea-family/benefits/', block: 'ec664fe0-9e91-11f0-8921-4f656ee14915' },
  'meta-ig-18101671448672416': { url: 'https://www.napoleon.wien/' },
  'g2-15kbyb4': { url: 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26' },
};

export function redemptionPageHash(deal, html, finalUrl) {
  const source = sources[deal?.id];
  if (!source || finalUrl !== source.url || typeof html !== 'string' || Buffer.byteLength(html) > 2500000) return null;
  if (deal.id === 'meta-ig-18101671448672416') return parseReviewedNapoleonOffer(html, finalUrl)?.contentHash || null;
  if (deal.id === 'g2-15kbyb4') {
    const evidence = extractIamstudentApprovalSourceEvidence(html, deal.url, finalUrl);
    return isReviewedIamstudentApprovalEvidence(deal, evidence) ? evidence.contentHash : null;
  }
  const $ = load(html);
  $('script,style,noscript,template,svg,[hidden],[aria-hidden="true"]').remove();
  $('[style]').filter((_, node) => /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(node).attr('style'))).remove();
  if (deal.id === 'g2-31pd49') {
    const offers = $('section#angebote'), contact = $('section#kontakt');
    if (offers.length !== 1 || contact.length !== 1 || !contact.find('a[href="tel:+4319230009"]').length
      || !$('a[href="#kontakt"]').toArray().some(el => $(el).text().trim() === 'Bestellen')) return null;
    return digest([offers.text(), contact.text()].map(text => text.replace(/\s+/g, ' ').trim()).join('|'));
  }
  const canonical = $('head link[rel="canonical"]'), og = $('head meta[property="og:url"]');
  if (canonical.length !== 1 || canonical.attr('href') !== source.url || og.length !== 1 || og.attr('content') !== source.url) return null;
  const block = $(`main [id="${source.block}"]`);
  if (block.length !== 1) return null;
  block.find('p,li,div,h2,br').append(' ');
  return digest(block.text().replace(/\s+/g, ' ').trim());
}

// Both maintenance lanes share the same host permission and delay. Reserve the
// requested number of HTTP slots for other work before making any network call.
export async function allowFoodOfferPage({ url, state, now, getRobots, remaining, reserve = 0, deliveryUrls = [] }) {
  const origin = new URL(url).origin;
  state.robots ||= {}; state.pauses ||= {};
  if (Date.parse(state.pauses[origin]) > +now || remaining() <= reserve) return false;
  let gate = state.robots[origin];
  if (!gate || !(Date.parse(gate.expiresAt) > +now)) {
    if (remaining() < reserve + 2) return false;
    let content;
    try { content = await getRobots(origin + '/robots.txt'); }
    catch (error) {
      const retry = Date.parse(retryAfterAt(error.retryAfter, now)) || 0;
      state.pauses[origin] = new Date(Math.max(+now + 24 * HOUR, retry)).toISOString();
      return false;
    }
    const rules = robotsParser(origin + '/robots.txt', content);
    const urls = [...Object.values(sources).map(source => source.url), ...deliveryUrls];
    const paths = urls.filter(value => new URL(value).origin === origin && rules.isAllowed(value, AGENT) !== false);
    gate = state.robots[origin] = { paths, delay: rules.getCrawlDelay(AGENT) || 0, expiresAt: new Date(+now + 24 * HOUR).toISOString() };
    if (gate.delay) {
      state.pauses[origin] = new Date(+now + gate.delay * 1000).toISOString();
      return false;
    }
  }
  if (!gate.paths.includes(url) || remaining() <= reserve) return false;
  if (gate.delay) state.pauses[origin] = new Date(+now + gate.delay * 1000).toISOString();
  return true;
}

// Allocate at most three of the ordinary four offer-page slots. Keep one HTTP
// request and one offer slot available for existing source/copy maintenance.
export async function checkDueRedemptionPages({ manifest, live, state, now, getPage, getRobots, remaining, paused = () => false }) {
  const liveById = new Map(live.map(deal => [deal.id, deal]));
  const due = manifest.reviews.filter(row => {
    const source = sources[row.dealId], deal = liveById.get(row.dealId);
    return source && deal && row.recheck?.kind === 'official-food-page' && row.recheck.url === source.url
      && deal.title === row.expectedTitle && deal.description === row.expectedDescription && deal.url === row.sourceUrl
      && matchesReviewedPeriod(deal, row) && (!row.recheck.endExclusive || Date.parse(row.recheck.endExclusive) > +now)
      && Date.parse(row.reviewUntil) <= +now + 16 * HOUR && !(Date.parse(state.pages?.[row.dealId]?.retryAt) > +now);
  }).sort((a, b) => Date.parse(a.reviewUntil) - Date.parse(b.reviewUntil));
  if (!due.length) return [];
  state.pages ||= {}; state.robots ||= {}; state.pauses ||= {};
  const seen = [];
  for (const row of due) {
    if (seen.length >= 3 || remaining() <= 1) break;
    const { url } = sources[row.dealId], origin = new URL(url).origin;
    if (paused(url) || Date.parse(state.pauses[origin]) > +now) continue;
    try {
      if (!await allowFoodOfferPage({ url, state, now, getRobots, remaining, reserve: 1 })) continue;
      seen.push(url);
      const page = await getPage(url);
      if (page.finalUrl !== url || page.status && page.status !== 200) throw Error('unconfirmed-page');
      const hash = redemptionPageHash(liveById.get(row.dealId), page.html, page.finalUrl);
      state.pages[row.dealId] = { url, checkedAt: now.toISOString(), status: hash === row.recheck.contentHash ? 'matched' : 'changed',
        contentHash: hash, retryAt: new Date(+now + (hash === row.recheck.contentHash ? 8 : 24) * HOUR).toISOString() };
    } catch (error) {
      const at = now.toISOString();
      const wait = Math.max(+now + 24 * HOUR, Date.parse(retryAfterAt(error.retryAfter, now)) || 0);
      if ([401, 403, 429].includes(error.httpStatus)) state.pauses[origin] = new Date(wait).toISOString();
      if (!seen.includes(url)) {
        // An unavailable robots file says nothing about the underlying deal.
        state.pauses[origin] = new Date(wait).toISOString();
        continue;
      }
      const status = [404, 410].includes(error.httpStatus) ? 'changed' : 'unavailable';
      state.pages[row.dealId] = { url, status, checkedAt: at, retryAt: new Date(wait).toISOString() };
    }
  }
  return seen;
}
