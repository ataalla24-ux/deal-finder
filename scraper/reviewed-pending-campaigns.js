import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { copyOfferPeriod, hasReviewedOfferPeriod } from './offer-period-fields.js';

const digest = value => createHash('sha256').update(value || '').digest('hex');
const clean = value => (value || '').replace(/\s+/gu, ' ').trim();
export const pizzaPost = 'https://www.instagram.com/p/Dfk5ZC8DiTM/';
const pizza = { id: 'social-food-review-vmehme', url: pizzaPost, brand: 'M2 La Romana',
  hash: 'c5737824274bf079e55b34da51efd6f4bae8f85b0f5a801f25a7083cdf5b50fd',
  from: '2026-11-01', until: '2026-11-30',
  title: 'M2 La Romana: Klassische Pizzen ab 8,50 €, Spezialpizzen um 11,50 €',
  description: 'Im November kosten klassische Pizzen bei M2 La Romana in Wien-Meidling ab 8,50 €. Spezialpizzen gibt es um 11,50 €.' };
const happyHour = { id: 'g2-13q9t1x', thread: '372595',
  url: 'https://www.preisjaeger.at/deals/xxxlutz-restaurant-gutscheine-ab-1711-zb-2x-schnitzel-mit-pommer-fur-8eur-oder-2x-grillteller-fur-12eur-372595',
  brand: 'XXXLutz Restaurant', merchant: 'XXXLutz',
  body: '42e19a72e058d65800f102b7251bfe0cce8ae874fb154804958620dcfeffcd27',
  sourceTitle: 'XXXLutz Restaurant Gutscheine ab 17.11 z.B. 2x Schnitzel mit Pommes für 8€ oder 2x Grillteller für 12€',
  from: '2026-11-17', until: '2026-12-08', endEpoch: 1796770740,
  reference: 'https://catalog.xxxlutz.at/frontend/catalogs/1420952/1/pdf/complete.pdf',
  title: 'XXXLutz: Zwei Schnitzel um 8 € oder zwei Grillteller um 12 €',
  description: 'Mit Gutschein gibt es täglich ab 16 Uhr zwei Schweinsschnitzel mit Pommes für insgesamt 8 € oder zwei Grillteller für insgesamt 12 €. Den Gutschein bei der Bestellung abgeben. Gültig bis einschließlich 8. Dezember, solange der Vorrat reicht.' };
const chicken = { id: 'fc4g-1569bjd', thread: '366802',
  url: 'https://www.preisjaeger.at/deals/gutschein-11-crispychicken-in-ausgewahlten-burger-king-filialen-3x-wien-3x-wien-4x-niederosterreich-und-2x-burgenland-366802',
  brand: 'Burger King', merchant: 'Burger King',
  sourceTitle: '1+1 CrispyChicken in ausgewählten Burger King Filialen: 3x Wien, 4x Niederösterreich und 2x Burgenland',
  body: '2b5316311d06f6284226227d495419c0de969b4a87de403e7c6bb6241773b1cf',
  until: '2026-12-31', endEpoch: 1798757940, code: 'D1001',
  title: 'Burger King: Zwei Crispy Chicken zum Preis von einem',
  description: 'Mit Coupon D1001 bekommst du zwei Crispy Chicken zum Preis von einem. In Wien gilt der Gutschein am Hauptbahnhof (E0 beim Infopoint), am Elterleinplatz 8 und an der Straße des 1. Mai 114. Gültig bis einschließlich 31. Dezember. Nicht mit anderen Aktionen kombinierbar. Keine Barablöse.' };
const rules = [pizza, happyHour, chicken];
const viennaDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' });
const day = date => viennaDay.format(date);

// Bind the first-party post to its canonical shortcode, owner, publish day and
// the entire caption. Likes, comment counts and interface language may change.
export function readReviewedPizzaPost(html, requestedUrl, finalUrl) {
  if (requestedUrl !== pizza.url) return null;
  const hold = { sourceUrl: requestedUrl, blockingReason: 'Aktueller Originalbeitrag nicht eindeutig bestätigt.' };
  if (finalUrl !== requestedUrl) return hold;
  const $ = load(html);
  const one = (selector, attr = 'content') => $(selector).length === 1 ? $(selector).attr(attr) || '' : '';
  const description = one('meta[property="og:description"]');
  const parsed = description.match(/(?:^| - )m2_laromana (?:am|on) November 10, 2026: "([\s\S]+)"\.?\s*$/u);
  if (!parsed || one('link[rel="canonical"]', 'href') !== requestedUrl
    || one('meta[property="og:url"]') !== 'https://www.instagram.com/m2_laromana/p/Dfk5ZC8DiTM/'
    || one('meta[property="al:ios:url"]') !== 'instagram://media?id=4027596376569160908'
    || digest(clean(parsed[1])) !== pizza.hash) return hold;
  return { sourceUrl: requestedUrl, sourceKind: 'reviewed-original-post', contentHash: pizza.hash,
    caption: clean(parsed[1]), campaignId: pizza.id };
}

// The entire current body (including its coupon artwork references), identity,
// merchant and structured end date must still match the reviewed campaign.
export function reviewedThreadCampaign(thread, requestedUrl) {
  const rule = rules.find(entry => entry.thread && entry.url === requestedUrl);
  if (!rule || String(thread.threadId) !== rule.thread || thread.merchant?.merchantName !== rule.merchant
    || thread.title !== rule.sourceTitle || digest(thread.threadDetails?.preparedHtmlDescription) !== rule.body
    || thread.endDate?.timestamp !== rule.endEpoch || thread.isExpired !== false || thread.isMaybeExpired
    || thread.expiryReportStatus !== 'None' || (rule.code && thread.voucherCode !== rule.code)) return {};
  return { campaignId: rule.id, contentHash: rule.body };
}

function editableRule(deal) {
  if (deal?.pipelineLifecycle?.manualDecision !== 'approved' || deal.editedInSlack || deal.slackFormEditTs
    || deal.slackEditedAt || deal.liveEditedAt || hasReviewedOfferPeriod(deal)) return null;
  return rules.find(row => row.id === deal.id && row.url === deal.url);
}

function matchedRule(deal, evidence, now) {
  const rule = editableRule(deal);
  if (!rule || evidence?.campaignId !== rule.id || evidence.sourceUrl !== rule.url
    || evidence.contentHash !== (rule.hash || rule.body) || evidence.blockingReason
    || evidence.checkedAt !== now.toISOString() || day(now) > rule.until || rule.from && day(now) < rule.from) return null;
  if (rule === pizza && (deal.sourcePublishedAtSource !== 'instagram-graph-timestamp'
    || deal.sourcePublishedAt !== '2026-11-10T21:42:04.000Z' || deal.metaGraphIsRepost !== false
    || deal.metaGraphMediaId !== '18114458954125623' || digest(clean(deal.metaGraphCaption)) !== pizza.hash)) return null;
  return rule;
}

export function reviewedCampaignHold(deal, evidence, now) {
  if (!editableRule(deal) || matchedRule(deal, evidence, now)) return '';
  return 'Geprüfte Kampagne, Aktionszeitraum oder aktuelles Original nicht mehr identisch.';
}

export function prepareReviewedCampaign(deal, evidence, now) {
  const rule = matchedRule(deal, evidence, now);
  if (!rule) return deal;
  const prepared = { ...deal, title: rule.title, description: rule.description, brand: rule.brand };
  // Drop saved machine suggestions made against the incomplete offer.
  delete prepared.approvalCopyReview;
  if (rule === happyHour) prepared.distance = 'Wien – teilnehmende XXXLutz Restaurants';
  if (rule === pizza) Object.assign(prepared, { ownerUsername: 'm2_laromana', merchantUsername: 'm2_laromana', distance: '1120 Wien' });
  const literal = 'bis ' + rule.until.split('-').reverse().join('.');
  copyOfferPeriod(prepared, { validFrom: rule.from || '', validUntil: rule.until, expires: rule.until + 'T22:59:59.999Z',
    expiryKind: rule.from ? 'range' : 'end', expiresOriginal: literal, expiryDisplayText: literal,
    expiresSource: 'url', expirySource: 'url', expiresPrecision: 'day', dateConfidence: 'high' });
  prepared.reviewedSourceCopy = { method: 'reviewed-source-template-v1', rule: rule.id,
    fields: ['title', 'description', 'validUntil'], checkedAt: evidence.checkedAt, sourceUrl: rule.url,
    contentHash: evidence.contentHash, ...(rule.reference ? { corroboratingUrl: rule.reference } : {}) };
  return prepared;
}

// These reviewed rows are allowed the normal freshness exception
// only for the currently fetched original and the unchanged reviewed period.
export function currentReviewedCampaign(deal, health, now) {
  if (!health || health.status !== 200 || health.invalid || health.transientError || health.blockedByProtection) return null;
  const rule = matchedRule(deal, { ...health.approvalSourceEvidence, checkedAt: health.checkedAt }, now);
  if (!rule || deal.validUntil !== rule.until || deal.title !== rule.title || deal.description !== rule.description) return null;
  return rule.id;
}

export function isReviewedCampaignRetry(deal, now = new Date()) {
  const rule = editableRule(deal);
  return Boolean(rule && day(now) <= rule.until && deal.approvalBlock);
}

// The generic expiry parser uses UTC end-of-day. These three reviewed winter
// campaigns end at local midnight in Vienna; retain that instant on replays.
export function reconcileReviewedCampaignExpiry(deal) {
  const rule = rules.find(row => deal?.id === row.id && deal.url === row.url);
  const proof = deal?.reviewedSourceCopy;
  if (!rule || hasReviewedOfferPeriod(deal) || proof?.rule !== rule.id || proof.sourceUrl !== rule.url
    || proof.contentHash !== (rule.hash || rule.body) || deal.validUntil !== rule.until
    || deal.expiresOriginal !== 'bis ' + rule.until.split('-').reverse().join('.')
    || !String(deal.expires || '').startsWith(rule.until)) return false;
  deal.expires = rule.until + 'T22:59:59.999Z';
  return true;
}
