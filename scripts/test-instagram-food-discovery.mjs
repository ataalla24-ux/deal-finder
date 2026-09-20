import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractLowFoodPrice, isFoodDrinkSource } from '../scraper/food-discovery-utils.js';
import { buildConfig, classifyPromotion, loadAccountCatalog, normalizeGraphMediaItem, normalizeAdLibraryItem, selectAccountShard, selectHashtagShard, runMetaInstagramCollector } from '../scraper/meta-instagram-deals.js';
import { enrichInstagramGraphMedia, classifyInstagramOcrWithOpenAI } from '../scraper/instagram-media-evidence.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { buildSlackMessage, normalizeDeal } from '../scraper/slack-notify.js';

const now = new Date('2026-09-20T12:00:00Z');
const config = buildConfig({ OPENAI_API_KEY: 'test-key', META_INSTAGRAM_MEDIA_LLM_CONCURRENCY: '1' }, now);
for (const [caption, amount] of [
  ['Kebab 1 EUR', 1], ['D\u00f6ner: 3,50 EUR', 3.5], ['1 EUR Kaffee', 1],
  ['Pizza 5 EUR', 5], ['Cappuccino 2 EUR', 2], ['Mittagsteller 6 EUR', 6],
  ['Mein Food-Tipp: Kebab 2 EUR in Wien', 2], ['Kaffee um nur 1,50 EUR', 1.5],
]) {
  assert.equal(extractLowFoodPrice(caption)?.amount, amount, caption);
  assert.equal(classifyPromotion(caption).accepted, true, caption);
  assert.equal(classifyPromotion(caption).offerKind, 'low-price', caption);
}
for (const caption of [
  'Kebab 8 EUR', 'Kaffee 4 EUR', 'Kebab ab 2 EUR', 'ab 2 EUR Kebab',
  'Kebab 2 EUR extra', 'Mini Pizza 2 EUR', 'Pizza Slice 2 EUR', 'Pizza 2 EUR pro 100g',
  'Kebab Sauce 1 EUR', 'Kebab 2 EUR/kg', 'Kebab Lieferung 1 EUR', '101 EUR Kebab',
  'Kebab statt 2 EUR jetzt 8 EUR', 'Kebab 0 EUR', '2 EUR Aufpreis zum Burger',
]) assert.equal(extractLowFoodPrice(caption), null, caption);
assert.equal(isFoodDrinkSource({ category: 'drinks' }), true);
assert.equal(isFoodDrinkSource({ category: 'reisen', username: 'flugninja.at' }), false);
assert.equal(isFoodDrinkSource({ category: 'kaffee', username: 'drhauschka.at', foodCategoryFromMention: true }), false);
assert.equal(isFoodDrinkSource({ category: '', username: 'takisushi.at', foodCategoryFromMention: true }), true);

const context = { sourceType: 'account', sourceName: '@testcafe', account: { username: 'testcafe', category: 'food', verifiedVienna: true } };
let numericMediaId = (BigInt(Date.parse('2026-09-20T09:00:00Z')) - 1314220021300n) << 23n;
let shortcode = '';
while (numericMediaId > 0n) {
  shortcode = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Number(numericMediaId % 64n)] + shortcode;
  numericMediaId /= 64n;
}
const post = { id: 'food-price', caption: 'Dauerhaft: Kebab 2 EUR in 1070 Wien.', timestamp: '2026-09-20T09:00:00Z', permalink: `https://www.instagram.com/p/${shortcode}/` };
const deal = normalizeGraphMediaItem(post, context, config, now).deal;
assert.ok(deal);
assert.equal(deal.offerKind, 'low-price');
assert.equal(deal.priceEvidence.amount, 2);
assert.match(deal.title, /Preis-Tipp/);
assert.doesNotMatch(deal.title, /Rabatt|statt|%/i);
assert.match(buildSlackMessage(normalizeDeal(deal, 'meta-instagram'), 1), /Typ: Preis-Tipp \(kein Rabatt behauptet\)/);
const slack = await validateDealsForSlack([deal], {
  now,
  inspectDealUrlHealth: async (url) => ({ ok: true, status: 200, finalUrl: url, fetchedAt: now.toISOString(), contentHints: {} }),
});
assert.equal(slack.allowedDeals.length, 1, JSON.stringify(slack.report));
assert.equal(normalizeGraphMediaItem({ ...post, timestamp: '2025-09-20T09:00:00Z' }, context, config, now).deal, null);
assert.equal(normalizeGraphMediaItem({ ...post, caption: 'Kebab 1 EUR in Wien am 21.09.2026.' }, context, config, now).deal?.validFrom?.slice(0, 10), '2026-09-21');
assert.equal(normalizeGraphMediaItem({ ...post, caption: 'Kebab 1 EUR in Wien bis 19.09.2026.' }, context, config, now).rejection, 'offer-expired');
assert.equal(normalizeGraphMediaItem({ ...post, caption: 'Kebab 1 EUR in Graz.' }, context, config, now).deal, null);
assert.equal(classifyPromotion('Gewinnspiel: Kebab 1 EUR gewinnen').accepted, false);
for (const text of [
  'All You Can Eat a la carte fuer nur 22,90 EUR pro Person in Wien.',
  'Deine digitale Stempelkarte: sammle wie gewohnt Stempel fuer tolle Gratis-Pr\u00e4mien in Wien.',
]) {
  assert.equal(classifyPromotion(text).accepted, false, text);
  const rejected = await validateDealsForSlack([{ ...deal, title: text, description: text, offerKind: undefined, promotionEvidence: '', priceEvidence: undefined }], {
    now, inspectDealUrlHealth: async (url) => ({ status: 200, finalUrl: url, contentHints: {} }),
  });
  assert.equal(rejected.allowedDeals.length, 0, text);
}
assert.equal(classifyPromotion('Buffet 8 EUR in Wien').accepted, true);
assert.equal(classifyPromotion('Heute 20% Rabatt auf das Buffet fuer 22,90 EUR in Wien').accepted, true);
assert.equal(classifyPromotion('All You Can Eat 22,90 EUR und zweiter Drink gratis in Wien').accepted, true);
assert.equal(classifyPromotion('8 Stempel = eine gratis Bubble Waffle oder 10 Stempel fuer ein Gratis-Heissgetraenk in Wien').accepted, true);

const accounts = Array.from({ length: 50 }, (_, i) => ({ username: `food${i}`, category: 'food', accountType: 'merchant', priority: 1 }));
accounts.push(...Array.from({ length: 40 }, (_, i) => ({ username: `travel${i}`, category: 'reisen', accountType: 'merchant', priority: 500, manualApprovedDeals: 10 })));
const selected = selectAccountShard(accounts, { ...config, maxAccountsPerRun: 24 }, {}, now);
assert.equal(selected.length, 24);
assert.ok(selected.filter(isFoodDrinkSource).length >= 20, 'at least 80% food even when other categories have more feedback');
assert.equal(new Set(selected.map((account) => account.username)).size, 24);
assert.equal(selectAccountShard(accounts.slice(0, 4), { ...config, maxAccountsPerRun: 24 }, {}, now).length, 4);
const nextSelected = selectAccountShard(accounts, { ...config, maxAccountsPerRun: 24, shardIndex: config.shardIndex + 1 }, { accountPerformance: Object.fromEntries(selected.map((account) => [account.username, { lastRunAt: now.toISOString() }])) }, now);
assert.ok(nextSelected.some((account) => !selected.includes(account)), 'cooldowns retain discovery rotation');
const tags = selectHashtagShard(config.hashtags, config, {});
assert.ok(tags.filter(isFoodDrinkSource).length >= 4);
assert.ok(tags.every((tag) => config.hashtags.includes(tag)), 'do not expand the rolling Meta hashtag pool');

const ad = { id: 'test-ad', ad_creative_bodies: ['Kebab 2 EUR in Wien'], ad_delivery_start_time: '2026-09-19T08:00:00Z', publisher_platforms: ['INSTAGRAM'], ad_snapshot_url: 'https://facebook.com/ads/archive/render_ad/?access_token=secret', page_name: 'Test Kebab' };
assert.ok(normalizeAdLibraryItem(ad, config, now).deal);
assert.doesNotMatch(JSON.stringify(normalizeAdLibraryItem(ad, config, now)), /access_token|secret/);
assert.equal(normalizeAdLibraryItem({ ...ad, publisher_platforms: ['FACEBOOK'] }, config, now).rejection, 'not-instagram-ad');
assert.equal(normalizeAdLibraryItem({ ...ad, ad_creative_bodies: ['Wien Beauty 20% Rabatt'] }, config, now).rejection, 'non-food-ad');
assert.equal(normalizeAdLibraryItem({ ...ad, ad_creative_bodies: ['Free coffee in Berlin'], target_locations: [{ name: 'Wien' }] }, config, now).rejection, 'missing-vienna-redemption-evidence');
assert.ok(normalizeAdLibraryItem({ ...ad, ad_creative_bodies: ['Gratis Getr\u00e4nke in Wien am 21.09.2026'] }, config, now).deal);

const success = () => Response.json({ output_text: JSON.stringify({ isDeal: true, confidence: 0.94, offerText: 'Kebab 1 EUR', locationText: 'Wien', validityText: '', exclusion: 'none' }) });
let calls = 0;
let slept = 0;
const retryResult = await classifyInstagramOcrWithOpenAI({ caption: 'Kebab', ocrText: 'Kebab 1 EUR Wien' }, config, {
  fetchImpl: async () => ++calls === 1 ? Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'retry-after': '1' } }) : success(),
  sleepImpl: async (ms) => { slept += ms; },
});
assert.equal(retryResult.isDeal, true);
assert.equal(calls, 2);
assert.equal(slept, 1000);
calls = 0;
await assert.rejects(classifyInstagramOcrWithOpenAI({ caption: 'Kebab' }, config, {
  fetchImpl: async () => { calls += 1; return Response.json({ error: { code: 'insufficient_quota', message: 'secret-private-provider-message' } }, { status: 429 }); },
}), (error) => error.code === 'insufficient_quota' && error.haltBatch && !error.message.includes('secret'));
assert.equal(calls, 1, 'billing failures must not be retried');
calls = 0;
await assert.rejects(classifyInstagramOcrWithOpenAI({ caption: 'Kebab' }, config, {
  fetchImpl: async () => { calls += 1; return Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'retry-after': '60' } }); },
  sleepImpl: async () => assert.fail('must not retry sooner than the provider asks'),
}));
assert.equal(calls, 1);

const entry = (id) => ({ item: { ...post, id, caption: 'Unser Kaffee in Wien', media_type: 'IMAGE', media_url: 'https://cdn.example/food.jpg' }, context });
const analysis = async () => ({ ocrText: 'Morgen Kebab 1 EUR in Wien', visionImages: ['data:image/jpeg;base64,AQID'], errors: [], warnings: [], assetCount: 1 });
const mediaOptions = { tools: { tesseract: true }, analyzeItem: analysis };
let classified = 0;
const duplicated = await enrichInstagramGraphMedia([entry('duplicate'), entry('duplicate')], config, now, {
  ...mediaOptions, classifyOcr: async () => { classified += 1; return { isDeal: true, confidence: 0.95, offerText: 'Kebab 1 EUR', exclusion: 'none' }; },
});
assert.equal(duplicated.report.analyzed, 1);
assert.equal(classified, 1);
assert.equal(duplicated.entries[0].item._mediaEvidence, duplicated.entries[1].item._mediaEvidence);
const blocked = await enrichInstagramGraphMedia([entry('blocked1'), entry('blocked2'), entry('blocked3')], config, now, {
  ...mediaOptions,
  openAiFetchImpl: async () => Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }),
});
assert.equal(blocked.report.aiCalls, 1);
assert.equal(blocked.report.aiSkippedCircuitOpen, 2);
assert.equal(blocked.report.aiCircuit.code, 'insufficient_quota');
const sameHour = await enrichInstagramGraphMedia([entry('blocked1')], config, new Date(now.getTime() + 3600000), {
  ...mediaOptions, cache: blocked.cache, classifyOcr: async () => assert.fail('quota cooldown must survive the next run'),
});
assert.equal(sameHour.report.aiCalls, 0);
const recovered = await enrichInstagramGraphMedia([entry('blocked1')], config, new Date(now.getTime() + 7 * 3600000), {
  ...mediaOptions, cache: blocked.cache, classifyOcr: async () => ({ isDeal: true, confidence: 0.95, offerText: 'Kebab 1 EUR', exclusion: 'none' }),
});
assert.equal(recovered.report.aiAccepted, 1, 'failed AI evidence is retried, not cached for seven days');
const oldError = await enrichInstagramGraphMedia([entry('legacy')], config, now, {
  ...mediaOptions, cache: { legacy: { analyzedAt: '2026-09-20T09:00:00Z', aiError: 'OpenAI HTTP 429', errors: [] } },
  classifyOcr: async () => ({ isDeal: true, confidence: 0.95, offerText: 'Kebab 1 EUR', exclusion: 'none' }),
});
assert.equal(oldError.report.aiAccepted, 1, 'legacy failures also recover');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-food-test-'));
try {
  const env = { META_AD_LIBRARY_ACCESS_TOKEN: 'fake-token', META_AD_LIBRARY_SEARCH_TERMS: 'Wien Kebab,Wien Kaffee,Wien Pizza', META_INSTAGRAM_MAX_RETRIES: '0', META_INSTAGRAM_OUTPUT_PATH: path.join(tmp, 'output.json'), META_INSTAGRAM_REPORT_PATH: path.join(tmp, 'report.json'), META_INSTAGRAM_STATE_PATH: path.join(tmp, 'state.json') };
  const paths = { watchlistPath: path.join(tmp, 'none'), registryPath: path.join(tmp, 'none'), candidatePaths: [] };
  const discoveredCatalog = loadAccountCatalog(config, paths, { discoveredAccounts: {
    'beauty.account': { username: 'beauty.account', category: 'kaffee' },
    'takisushi.at': { username: 'takisushi.at', category: '' },
  } });
  assert.equal(isFoodDrinkSource(discoveredCatalog.find((account) => account.username === 'beauty.account')), false);
  assert.equal(isFoodDrinkSource(discoveredCatalog.find((account) => account.username === 'takisushi.at')), true);
  let requests = 0;
  const inaccessible = await runMetaInstagramCollector({ env, now, paths, fetchImpl: async () => { requests += 1; return Response.json({ error: { code: 10, message: 'Ad Library permission missing' } }, { status: 400 }); } });
  assert.equal(requests, 1, 'stop the ad search rotation on an authorization failure');
  assert.equal(inaccessible.report.sources.adLibrary.status, 'failed');
  await runMetaInstagramCollector({ env, now, paths, fetchImpl: async () => assert.fail('ad permission cooldown should persist') });
  fs.unlinkSync(env.META_INSTAGRAM_STATE_PATH);
  const available = await runMetaInstagramCollector({ env: { ...env, META_AD_LIBRARY_MAX_TERMS_PER_RUN: '2' }, now, paths, fetchImpl: async (url) => {
    assert.equal(new URL(url).searchParams.get('ad_active_status'), 'ACTIVE');
    return Response.json({ data: [ad] });
  } });
  assert.equal(available.report.sources.adLibrary.selectedTerms.length, 2);
  assert.equal(available.report.sources.adLibrary.fetched, 1, 'deduplicate across ad search terms');
  assert.equal(available.payload.deals.length, 1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('Instagram food discovery, Slack gate, API recovery and ad capability tests passed');
