import assert from 'node:assert/strict';

import {
  buildHeuristicDeal, fetchInstagramPreview, fetchRenderedInstagramPreview,
  isTerminalRejection, mergeAiDeal,
} from '../scraper/instagram-ai-agent.js';
import { isInstagramOpenGraphHeaderOnly } from '../scraper/instagram-page-access.js';

const now = new Date();
const dayMs = 24 * 60 * 60 * 1000;
const publishedEightDaysAgo = new Date(now.getTime() - 8 * dayMs).toISOString();
const publishedYesterday = new Date(now.getTime() - dayMs).toISOString();
const activeEnd = new Date(now.getTime() + 20 * dayMs);
const activeEndText = `${activeEnd.getUTCDate()}.${activeEnd.getUTCMonth() + 1}.${activeEnd.getUTCFullYear()}`;
const germanMonths = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function candidate({ url, source = 'all', sourceDeal = null, title, description, pubDate = publishedYesterday }) {
  return {
    url,
    source,
    sourceDeal,
    title,
    snippet: description,
    preview: {
      status: 200,
      title,
      description,
      bodyText: description,
      pubDate,
      pubDateSource: 'instagram-rendered-time-datetime',
    },
  };
}

const blueTomato = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/DaxA5jYFitT/',
  title: 'Blue Tomato auf Instagram',
  description: 'Free coffee in our @bluetomatoshopwien Rotenturmstraße. Come by and grab a coffee.',
}));
assert.ok(blueTomato, 'the explicit Vienna branch handle must rescue the Blue Tomato free-coffee post');

const creatorScoutDeal = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/reel/CreatorMerchant1/',
  sourceDeal: { ownerUsername: 'lisa.maria.b', sourceAccountType: 'creator' },
  title: 'Sushi Deal in Wien',
  description: 'Heute 30 % Rabatt auf Sushi bei @tennosushiofficial, Landstraßer Hauptstraße 1, 1030 Wien.',
}));
assert.ok(creatorScoutDeal);
assert.equal(creatorScoutDeal.sourceAccountType, 'creator');
assert.equal(creatorScoutDeal.scoutUsername, 'lisa.maria.b');
assert.equal(creatorScoutDeal.merchantUsername, 'tennosushiofficial');
assert.equal(creatorScoutDeal.brand, 'Tenno Sushi');
assert.equal(creatorScoutDeal.pipelineLifecycle.stage, 'extracted');

const unverifiedLegacyViennaContext = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/Das-rG-kVlD/',
  source: 'deals',
  sourceDeal: {
    brand: 'Ernesto Osteria',
    title: '2. Illy Caffè GRATIS zu jedem Frühstück',
    distance: 'Wien',
  },
  title: 'Ernesto Osteria auf Instagram',
  description: `AKTION: 2. Illy Caffè GRATIS zu jedem Frühstück. Gültig bis ${activeEndText}.`,
  pubDate: publishedEightDaysAgo,
}));
assert.equal(
  unverifiedLegacyViennaContext,
  null,
  'a legacy distance label must not turn a non-Vienna Instagram offer into a Vienna deal',
);

const apronPrice = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/Daia5aCFi-M/',
  source: 'gastro2',
  sourceDeal: { brand: 'Restaurant APRON', title: '5-Gänge-Menü', distance: 'Wien' },
  title: 'Restaurant APRON Wien auf Instagram',
  description: `Von heute bis ${activeEndText}: 5-Gänge-Menü um € 130 statt € 166 in Wien.`,
  pubDate: publishedYesterday,
}));
assert.ok(apronPrice, 'the euro-before-number instead-price form must count as a concrete active offer');

const oldApronPrice = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/Daia5aCFi-Old/',
  source: 'gastro2',
  sourceDeal: { brand: 'Restaurant APRON', title: '5-Gänge-Menü', distance: 'Wien' },
  title: 'Restaurant APRON Wien auf Instagram',
  description: `Von heute bis ${activeEndText}: 5-Gänge-Menü um € 130 statt € 166 in Wien.`,
  pubDate: publishedEightDaysAgo,
}));
assert.equal(oldApronPrice, null, 'an active offer must not rescue an Instagram post older than seven days');

const futureEventDate = new Date(now.getTime() + 20 * dayMs);
const futureAidsEvent = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/DbAYf0BMaIn/',
  source: 'deals',
  sourceDeal: { brand: 'Aids Hilfe Wien', distance: 'Wien' },
  title: 'Aids Hilfe Wien Straßenfest',
  description: `Am ${futureEventDate.getUTCDate()}. ${germanMonths[futureEventDate.getUTCMonth()]} ${futureEventDate.getUTCFullYear()} findet unser 6. Straßenfest statt – gratis Kinderbetreuung in Wien.`,
}));
assert.ok(futureAidsEvent, 'a published future one-day offer should enter the review queue');

const glutenFreeMarketing = buildHeuristicDeal(candidate({
  url: 'https://www.instagram.com/p/Da0GlutenFree/',
  title: 'Pizza in Wien',
  description: '100% gluten-free pizza, sugar-free drinks und vegane Zutaten in Wien.',
}));
assert.equal(glutenFreeMarketing, null, 'free-from product claims must not be classified as gratis deals');

const headerOnly = '314 likes, 10 comments - satansbratan am November 25, 2026';
const original = 'https://www.instagram.com/reel/DgKrTGJNERZ/';
const neighborOffer = 'Café Morgenrot, 1070 Wien: Den zweiten Cappuccino gibt es gratis zum ersten Cappuccino.';
const unreadable = candidate({ url: original, title: 'Café Morgenrot auf Instagram', description: neighborOffer });
unreadable.preview = await fetchInstagramPreview(original, { fetcher: async () => new Response(
  `<meta property="og:title" content="Café Morgenrot auf Instagram">
  <meta property="og:description" content="${headerOnly}">
  <time datetime="${publishedYesterday}"></time>
  <script type="application/ld+json">${JSON.stringify({ '@type': 'SocialMediaPosting',
    url: 'https://www.instagram.com/reel/DifferentPost/', description: neighborOffer })}</script>`,
) });
unreadable.preview.bodyText = neighborOffer;
assert.equal(buildHeuristicDeal(unreadable), null, 'metadata-only originals cannot borrow page body or unrelated JSON-LD');
assert.equal(unreadable.rejectionReason, 'Originalbeschreibung des Instagram-Posts nicht lesbar');
assert.equal(isTerminalRejection(unreadable.rejectionReason), false);
assert.equal(mergeAiDeal(unreadable, { accept: true, confidence: 0.99, brand: 'Café Morgenrot',
  title: 'Zweiter Cappuccino gratis', type: 'bogo', description: neighborOffer }), null);
assert.equal(isInstagramOpenGraphHeaderOnly(headerOnly), true);
assert.equal(isInstagramOpenGraphHeaderOnly('314 Gefällt-mir-Angaben, 10 Kommentare – @satansbratan am 25. November 2026.'), true);
assert.equal(isInstagramOpenGraphHeaderOnly('3 likes - morgencafe on November 25, 2026: "Zweiter Kaffee gratis in Wien"'), false);
assert.equal(isInstagramOpenGraphHeaderOnly(neighborOffer), false);

const withRealProof = async (entry, extra = {}) => {
  const input = candidate({ url: original, title: 'Café Morgenrot auf Instagram', description: '', ...extra });
  input.preview = await fetchInstagramPreview(original, { fetcher: async () => new Response(
    `<meta property="og:title" content="Café Morgenrot auf Instagram">
    <meta property="og:description" content="${headerOnly}">
    <script type="application/ld+json">${JSON.stringify({ '@type': 'SocialMediaPosting', ...entry })}</script>`,
  ) });
  return input;
};
const exactStructured = await withRealProof({ url: original, caption: neighborOffer, datePublished: publishedYesterday });
assert.equal(exactStructured.preview.captionEvidence, 'exact-original-caption');
assert.ok(buildHeuristicDeal(exactStructured), 'own dated structured caption survives an OG-header-only response');
const expiredDate = new Date(+now - 2 * dayMs).toISOString().slice(0, 10).split('-').reverse().join('.');
const longCaption = neighborOffer + ' ' + 'Wir freuen uns auf euren Besuch. '.repeat(54) + 'Gültig bis ' + expiredDate + '.';
assert.ok(longCaption.indexOf('Gültig bis') > 1800 && longCaption.length < 2200);
const lateExpiry = await withRealProof({ url: original, caption: longCaption, datePublished: publishedYesterday });
assert.equal(buildHeuristicDeal(lateExpiry), null);
assert.match(lateExpiry.rejectionReason, /Aktionsende liegt in der Vergangenheit/);
const conflictingReference = await withRealProof({ url: 'https://www.instagram.com/reel/DifferentPost/',
  '@id': original, caption: neighborOffer, datePublished: publishedYesterday });
assert.equal(buildHeuristicDeal(conflictingReference), null);
assert.equal(conflictingReference.rejectionReason, unreadable.rejectionReason);

for (const published of [publishedYesterday, publishedEightDaysAgo]) {
  const savedCaption = await withRealProof({}, { sourceDeal: { url: original, source: 'Meta Instagram',
    brand: 'Café Morgenrot', caption: '1070 Wien: Zweiter Kaffee gratis zum ersten Kaffee.',
    sourcePublishedAt: published, sourcePublishedAtSource: 'instagram-graph-timestamp' } });
  const found = buildHeuristicDeal(savedCaption);
  assert.equal(Boolean(found), published === publishedYesterday);
  if (!found) assert.match(savedCaption.rejectionReason, /aelter als 7 Tage/);
}

function renderedPage({ caption = '', linkedDate = publishedYesterday, transitionTo } = {}) {
  let current = original;
  return {
    url: () => current,
    async goto(target) {
      assert.equal(target, original);
      return { status: () => 200, headers: () => ({}) };
    },
    async waitForTimeout() {},
    async evaluate(_read, options) {
      if (options?.pathSource) {
        if (transitionTo) current = transitionTo;
        return caption;
      }
      if (options?.postPathSource) return [linkedDate];
      return { finalUrl: current, ogTitle: 'Café Morgenrot auf Instagram', ogDescription: headerOnly,
        bodyText: neighborOffer, times: [{ dateTime: publishedEightDaysAgo }] };
    },
    async content() { return '<main></main>'; },
  };
}

const renderedShell = await fetchRenderedInstagramPreview(renderedPage(), original);
assert.equal(renderedShell.captionEvidence, 'open-graph-header-only');
assert.equal(renderedShell.pubDate, publishedYesterday, 'the linked timestamp remains independent caption evidence');
const genuineVisible = await fetchRenderedInstagramPreview(renderedPage({ caption: neighborOffer }), original);
assert.equal(genuineVisible.captionEvidence, 'exact-original-caption');
assert.ok(buildHeuristicDeal({ ...unreadable, preview: genuineVisible }), 'the exact rendered caption still qualifies');
const loginUrl = 'https://www.instagram.com/accounts/login/';
const renderedWall = await fetchRenderedInstagramPreview(renderedPage({ caption: neighborOffer, transitionTo: loginUrl }), original);
assert.equal(renderedWall.loginWall, true);
assert.equal(renderedWall.finalUrl, loginUrl);
assert.equal(renderedWall.description, '');

console.log('Instagram AI end-to-end acceptance tests passed');
