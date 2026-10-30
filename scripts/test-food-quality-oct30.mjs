import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCategoryForScraper } from '../scraper/category-utils.js';
import { inferPreferredBrand } from '../scraper/deal-normalization-utils.js';
import { classifyPromotion, buildConfig, normalizeGraphMediaItem } from '../scraper/meta-instagram-deals.js';
import { discoveryRejection, foodDiscoveryPriority } from '../scraper/deal-discovery-policy.js';
import { buildSlackMessage, normalizeDeal, filterDuplicateDealsInRun } from '../scraper/slack-notify.js';
import { semanticVenueCampaignKey } from '../scraper/deal-evidence-utils.js';
import { enrichPreviews, hasStructuredPostEvidence } from '../scraper/instagram-ai-agent.js';
import { entryMediaPriority } from '../scraper/instagram-media-evidence.js';
import { normalizeSocialAuditCandidate, buildSocialFoodReviewDeal } from '../scraper/social-food-audit-utils.js';
import { classifyDiscoveryPost } from '../scraper/apify-food-discovery-policy.js';
import { runWienDealsCombined } from '../scraper/wien-deals-combined.js';

const now = new Date('2026-10-30T08:00:00Z');
const ballroom = 'Come to BALLROOM in your Halloween costume on October 31st and get one FREE Sweet Dumpling on us! Think apple, caramel & hazelnut. 📍 BALLROOM – DAMN.GOOD.DUMPLINGS, Maria-Theresien-Straße 5, 1090 Vienna';
const sushi = 'Trick or Sushi? 🎃 Dieses Halloween gibt’s bei uns Sushi statt Süßigkeiten. Komm am 31. Oktober verkleidet vorbei, kauf einen Baby Sushi Push Pop und du bekommst den zweiten gratis dazu. 📍 Landstraße Hauptstraße 13 | 1030 Wien #sushipushpop';

test('actual food does not become Apple technology or kitchen equipment food', () => {
  assert.equal(inferPreferredBrand({ brand: '@ballroom', description: ballroom, url: 'https://www.instagram.com/p/food/' }).startsWith('BALLROOM'), true);
  assert.equal(normalizeCategoryForScraper('technik', [ballroom]), 'essen');
  const grill = 'ROLAND MULTIGRILL MIT 2000 WATT – NUR 89,90 €! Knusprige Toasts, Sandwiches, Pizza, Fleisch und warme Gerichte mit nur einem Gerät.';
  assert.equal(normalizeCategoryForScraper('essen', [grill]), 'shopping');
  assert.equal(foodDiscoveryPriority({ title: grill }), 0);
  assert.equal(normalizeCategoryForScraper('technik', ['Apple iPhone 20% Rabatt']), 'technik');
  assert.equal(normalizeCategoryForScraper('reisen', ['Papa auf Urlaub, Sohn halbiert die Preise. 1 Meter Österreich für 26 € im Centimeter Lokal Wien.']), 'essen');
  assert.equal(normalizeCategoryForScraper('kaffee', ['Bintat Supermarkt: Paprika 500g nur 0,99 € in Wien.']), 'supermarkt');
  assert.equal(normalizeDeal({ title: grill, description: grill, category: 'essen' }, 'meta-instagram').category, 'shopping');
  assert.equal(normalizeDeal({ title: grill, description: grill, category: 'essen', editedInSlack: true }, 'meta-instagram').category, 'essen');
});

test('street addresses never become social merchant names', () => {
  assert.notEqual(inferPreferredBrand({ brand: 'Instagram', description: sushi }), 'Landstraße Hauptstraße 13');
  assert.notEqual(inferPreferredBrand({ brand: 'Landstraße Hauptstraße 13', description: sushi, ownerUsername: 'thefirstthought' }), 'Landstraße Hauptstraße 13');
});

test('alcohol and free business/literary content do not pass as food deals', () => {
  for (const text of ['Free shot if we like your costume. Halloween at the Bog, Pumpkin Burger and Espresso Martini in Vienna.',
    'ROPP Frühstück: 1 Flasche Rosecco 0,7 l 15 € statt 32 € beim Brunch in Wien.',
    'The Tarock Card from the Wrong Deck. Free to read: viennawhispers.com #vienna',
    'Webdesign aus Wien. Schreiben Sie PLANET in die Kommentare, wir schauen uns Ihre Website kostenlos an.']) {
    assert.equal(classifyPromotion(text).accepted, false, text);
    assert(discoveryRejection({ title: text, socialFoodReview: true }), 'same gate before Slack');
  }
  for (const text of ['Gratis Ingwer-Shot in Wien', 'Alkoholfreier Martini gratis in Wien', 'Gratis Kaffee zur Beratung in 1070 Wien']) {
    assert.equal(discoveryRejection(text), '', text);
  }
});

test('future sushi promotion keeps its date and a complete offer title', () => {
  const config = buildConfig({}, now);
  const { deal } = normalizeGraphMediaItem({ id: 'sushi', caption: sushi, username: 'thefirstthought', timestamp: now.toISOString(), permalink: 'https://www.instagram.com/p/sushi/' },
    { sourceType: 'hashtag', sourceName: 'viennafood' }, config, now);
  assert(deal);
  assert.match(deal.title, /Sushi/i);
  assert.match(deal.title, /1\+1|zweiten? gratis/i);
  assert.doesNotMatch(deal.title, /^Oktober/);
  assert.equal(deal.validFrom.slice(0, 10), '2026-10-31');
  assert.equal(deal.type, 'bogo');
  assert.match(deal.description, /verkleidet/);
});

test('Slack display preserves human titles', () => {
  const edited = normalizeDeal({ id: 'protected', title: 'Mein eigener Titel', description: sushi, editedInSlack: true }, 'meta-instagram');
  assert.equal(edited.title, 'Mein eigener Titel');
  assert.match(buildSlackMessage(edited, 1, {}), /Mein eigener Titel/);
});

test('dated cross-posts deduplicate by venue but not across branches, prices or conditions', () => {
  const a = { id: 'scout', brand: 'Rhulo', merchantUsername: 'rhuloofficial', title: 'Cigköfte Wrap für 1 €', description: 'Heinestraße 32, 1020 Wien ab 13:00 Uhr.', validFrom: '2026-10-30', validUntil: '2026-10-30', url: 'https://www.instagram.com/p/scout/' };
  const b = { ...a, id: 'merchant', brand: '@rhulo1020', merchantUsername: 'rhulo1020', title: 'Wrap um 1 € bei Rhulo', url: 'https://www.instagram.com/reel/merchant/', validUntil: '2026-10-30T23:59:59+01:00' };
  assert(semanticVenueCampaignKey(a));
  assert.equal(semanticVenueCampaignKey(a), semanticVenueCampaignKey(b));
  assert.equal(filterDuplicateDealsInRun([a, b]).deals.length, 1);
  for (const different of [
    { description: 'Heinestraße 33, 1020 Wien ab 13:00 Uhr.' },
    { title: 'Wrap um 2 €' }, { validUntil: '2026-10-31' },
    { description: `${a.description} Nur für Neukunden.` },
    { description: `${a.description} Nur im Kostüm.` },
    { description: `${a.description} Nur für die ersten 20 Personen.` },
    { title: 'Vegan Wrap um 1 €' },
    { brand: 'Other restaurant', merchantUsername: 'other.restaurant' },
    { description: 'Heinestraße 32, 1020 Wien ab 15:00 Uhr.' },
  ]) assert.equal(filterDuplicateDealsInRun([a, { ...b, ...different }]).deals.length, 2);
  assert.equal(semanticVenueCampaignKey({ ...a, expirySource: 'review-ttl' }), '');
  assert.equal(semanticVenueCampaignKey({ ...a, sourceAccountType: 'creator', merchantUsername: '' }), '');
});

test('OCR is retained as evidence, not duplicated unreadable Slack prose', () => {
  const caption = 'Am 30. Oktober Cigköfte Wrap für 1€ in Wien, Heinestraße 32 ab 13:00 Uhr, solange der Vorrat reicht.';
  const row = normalizeSocialAuditCandidate({ caption, text: caption, description: caption, status: 'rejected', reason: 'no-concrete-offer',
    url: 'https://www.instagram.com/p/wrap/', pubDate: now.toISOString(), mediaEvidence: { ocrText: 'a ~~ XY % z q | 33' } }, {}, now);
  const deal = buildSocialFoodReviewDeal({ ...row, reviewEligible: true }, now);
  assert.equal(deal.title, 'Cigköfte Wrap um 1 €');
  assert.equal(deal.description.split('Am 30. Oktober').length - 1, 1);
  assert.doesNotMatch(deal.description, /XY/);
  assert.match(deal.description, /Vorrat reicht/);
  assert.match(deal.evidence.originalOcrText, /XY/);
});

test('Apify keeps future food offers and their actual date without raw OCR prose', () => {
  const { deal, rejectReason } = classifyDiscoveryPost({ url: 'https://www.instagram.com/p/FutureCoffee/', caption: 'Am 31. Oktober 2026: Gratis Kaffee in 1070 Wien!',
    ownerUsername: 'cafe_example', timestamp: now.toISOString(), locationName: 'Wien' }, { now, ocrText: 'q ~ XY \u00a7 _' });
  assert(deal, rejectReason);
  assert.match(deal.originalCaption, /31\. Oktober/);
  assert.match(deal.ocrText, /XY/);
  assert.doesNotMatch(deal.description, /XY/);
  assert(Date.parse(deal.validFrom) > +now);
  assert.equal(deal.expiryEstimated, false);
  for (const year of ['25', '2025']) {
    const expired = classifyDiscoveryPost({ url: 'https://www.instagram.com/p/OldCampaign/', caption: `Gratis Kaffee am 31.10.${year} in 1070 Wien!`,
      ownerUsername: 'cafe_example', timestamp: now.toISOString(), locationName: 'Wien' }, { now });
    assert.equal(expired.deal, null, 'current post cannot revive last year\'s promotion');
    const metaExpired = normalizeGraphMediaItem({ id: 'old', caption: `Gratis Kaffee nur am 31.10.${year} in 1070 Wien!`, timestamp: now.toISOString(), permalink: 'https://www.instagram.com/p/OldMeta/' },
      { sourceType: 'hashtag', sourceName: 'viennafood' }, buildConfig({}, now), now);
    assert.equal(metaExpired.deal, null, 'Meta also retains the explicit old year');
  }
  const shortDate = classifyDiscoveryPost({ url: 'https://www.instagram.com/p/RhuloDate/', caption: '1€ Wrap in Wien, Heinestraße 32, 30.10.26 solange der Vorrat reicht.',
    ownerUsername: 'foodiewien', timestamp: now.toISOString(), locationName: 'Wien' }, { now });
  assert(shortDate.deal);
  assert.equal(new Date(shortDate.deal.validUntil).toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' }), '2026-10-30');
});

test('food expiring soon outranks an otherwise identical far-future offer', () => {
  const entry = caption => ({ item: { timestamp: now.toISOString(), caption }, context: { account: { category: 'food' } } });
  assert(entryMediaPriority(entry('Gratis Kaffee in Wien am 31.10.2026'), now)
    > entryMediaPriority(entry('Gratis Kaffee in Wien am 20.11.2026'), now));
  assert(entryMediaPriority(entry('Gratis Kaffee in Wien am 29.10.2026'), now) <= -1000);
});

test('preview uses existing exact-post evidence and stops network failure storms', async () => {
  const url = 'https://www.instagram.com/p/ExistingFood/';
  const candidate = { url, sourceDeal: { url, pubDate: now.toISOString(), pubDateSource: 'instagram-graph-timestamp',
    source: 'Meta Instagram', caption: ballroom } };
  assert(hasStructuredPostEvidence(candidate, now));
  assert.equal(hasStructuredPostEvidence({ ...candidate, url: 'https://www.instagram.com/p/Different/' }, now), false);
  const missing = Array.from({ length: 20 }, (_, i) => ({ url: `https://www.instagram.com/p/Missing${i}/` }));
  let calls = 0;
  const errors = await enrichPreviews([candidate, ...missing], { now, enabled: true, sleep: async () => {}, fetchPreview: async () => { calls++; throw new Error('fetch failed'); } });
  assert.equal(calls, 3);
  assert.equal(errors.stats.structuredEvidence, 1);
  assert.equal(errors.stats.deferred, 17);
  assert.equal(errors.stats.stoppedReason, 'consecutive-preview-failures');
  calls = 0;
  const denied = await enrichPreviews(missing, { enabled: true, sleep: async () => {}, fetchPreview: async () => { calls++; return { status: 403 }; } });
  assert.equal(calls, 1);
  assert.equal(denied.stats.stoppedReason, 'http-403');
});

test('Combined replays a fresh scan with zero Graph calls', async () => {
  let calls = 0;
  const result = await runWienDealsCombined({ now, write: false, mediaCache: {},
    env: { INSTAGRAM_SHARED_QUOTA_ENABLED: '0', INSTAGRAM_ACCESS_TOKEN: 'fixture', INSTAGRAM_USER_ID: '123', META_GRAPH_VERSION: 'v26.0', WIEN_COMBINED_GRAPH_HASHTAGS: 'viennafood' },
    scanState: { scope: 'v26.0:123', sources: { 'hashtag:viennafood': { updatedAt: now.toISOString(), rows: [], report: { incomplete: false } } } },
    fetchImpl: async () => { calls++; throw new Error('must reuse snapshot'); },
  });
  assert.equal(calls, 0);
  assert.equal(result.report.sources[0].coverage.cacheHit, true);
});
