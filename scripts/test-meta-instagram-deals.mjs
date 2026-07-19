import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildConfig,
  classifyPromotion,
  findViennaEvidence,
  normalizeAdLibraryItem,
  normalizeGraphMediaItem,
  runMetaInstagramCollector,
  selectAccountShard,
} from '../scraper/meta-instagram-deals.js';

const now = new Date('2026-07-17T10:00:00.000Z');
const config = buildConfig({
  META_INSTAGRAM_VERIFIED_ACCOUNTS: 'ciosgrill',
  META_INSTAGRAM_MAX_POST_AGE_HOURS: '72',
  META_INSTAGRAM_MAX_POST_AGE_WITH_EXPIRY_DAYS: '7',
  META_AD_LIBRARY_MAX_AGE_DAYS: '30',
}, now);

assert.equal(classifyPromotion('Heute 1+1 gratis auf alle Kaffees').accepted, true);
assert.equal(classifyPromotion('20 % Rabatt auf alle Burger').type, 'rabatt');
assert.equal(classifyPromotion('Gewinnspiel: Gewinne ein Abendessen').accepted, false);
assert.equal(classifyPromotion('Schönes neues Sommermenü').accepted, false);
assert.equal(classifyPromotion('Neue gluten-free Pizza jetzt in Wien').accepted, false);
assert.equal(classifyPromotion('Gluten-free Pizza: heute 20 % Rabatt in Wien').type, 'rabatt');

assert.deepEqual(
  findViennaEvidence({ targetLocations: [{ name: 'Vienna' }] }, null, config),
  { verified: true, source: 'meta-target-location', detail: 'Vienna' }
);
assert.equal(findViennaEvidence({ caption: 'Nur heute in 1070!' }, null, config).verified, true);
assert.equal(findViennaEvidence({ caption: 'Nur heute!', username: 'ciosgrill' }, { username: 'ciosgrill', verifiedVienna: true }, config).verified, true);
assert.equal(findViennaEvidence({ caption: 'Nur heute in Graz!' }, null, config).verified, false);
assert.equal(findViennaEvidence({ targetLocations: [{ name: 'Vienna', excluded: true }] }, null, config).verified, false,
'an explicitly excluded ad target is not Vienna delivery evidence');
assert.equal(findViennaEvidence({
  caption: 'Nur heute: Burger gratis!',
  username: 'viennaeats',
  sourceName: '@viennaeats',
  pageName: 'Vienna Eats',
}, { username: 'viennaeats', category: 'discovery', verifiedVienna: false }, config).verified, false,
'an unverified Vienna-named account is discovery context, not offer-location evidence');

const graphFresh = normalizeGraphMediaItem({
  id: '17890001',
  caption: 'Nur heute: 1+1 Burger gratis!',
  permalink: 'https://www.instagram.com/p/ABC_123/?utm_source=test',
  timestamp: '2026-07-17T08:30:00.000Z',
  username: 'ciosgrill',
}, {
  sourceType: 'account',
  sourceName: '@ciosgrill',
  account: { username: 'ciosgrill', verifiedVienna: true },
}, config, now);
assert.ok(graphFresh.deal);
assert.equal(graphFresh.deal.pubDateSource, 'instagram-graph-timestamp');
assert.equal(graphFresh.deal.viennaEvidence.source, 'verified-merchant-registry');

const graphMissingTimestamp = normalizeGraphMediaItem({
  id: '17890002',
  caption: 'Wien: 20 % Rabatt auf Pizza',
  permalink: 'https://www.instagram.com/reel/DEF456/',
}, { sourceType: 'hashtag', sourceName: '#wienaktion' }, config, now);
assert.equal(graphMissingTimestamp.rejection, 'missing-source-published-at');

const graphOldWithoutExpiry = normalizeGraphMediaItem({
  id: '17890003',
  caption: 'Wien: 20 % Rabatt auf Pizza',
  permalink: 'https://www.instagram.com/p/GHI789/',
  timestamp: '2026-07-13T08:30:00.000Z',
}, { sourceType: 'hashtag', sourceName: '#wienaktion' }, config, now);
assert.equal(graphOldWithoutExpiry.rejection, 'post-too-old');

const graphOldRelativeToday = normalizeGraphMediaItem({
  id: '17890003-relative',
  caption: 'Nur heute in Wien: 1+1 Burger gratis',
  permalink: 'https://www.instagram.com/p/RELATIVEOLD/',
  timestamp: '2026-07-15T08:30:00.000Z',
}, { sourceType: 'hashtag', sourceName: '#wienaktion' }, config, now);
assert.equal(graphOldRelativeToday.rejection, 'offer-expired', 'Nur heute is anchored to the real post day and cannot refresh on every run');

const graphTomorrow = normalizeGraphMediaItem({
  id: '17890003-tomorrow',
  caption: 'Nur morgen in Wien: 1+1 Burger gratis',
  permalink: 'https://www.instagram.com/p/RELATIVETOMORROW/',
  timestamp: '2026-07-17T08:30:00.000Z',
}, { sourceType: 'hashtag', sourceName: '#wienaktion' }, config, now);
assert.equal(graphTomorrow.rejection, 'offer-not-started', 'Nur morgen must not be released one calendar day early');

const graphFutureRange = normalizeGraphMediaItem({
  id: '17890003-future',
  caption: 'Wien: 20 % Rabatt auf Pizza, gültig 20.07.–25.07.2026',
  permalink: 'https://www.instagram.com/p/FUTURERANGE/',
  timestamp: '2026-07-17T08:30:00.000Z',
}, { sourceType: 'hashtag', sourceName: '#wienaktion' }, config, now);
assert.equal(graphFutureRange.rejection, 'offer-not-started', 'future Meta ranges must not be released before validFrom');

const graphOldWithFutureExpiry = normalizeGraphMediaItem({
  id: '17890004',
  caption: 'Wien: 20 % Rabatt auf Pizza, gültig bis 25.07.2026',
  permalink: 'https://www.instagram.com/p/JKL012/',
  timestamp: '2026-07-13T08:30:00.000Z',
}, { sourceType: 'hashtag', sourceName: '#wienaktion' }, config, now);
assert.ok(graphOldWithFutureExpiry.deal);
assert.equal(graphOldWithFutureExpiry.deal.validUntil, '2026-07-25T23:59:59.999Z');

const ad = normalizeAdLibraryItem({
  id: '998877',
  page_id: '1122',
  page_name: 'Kaffeehaus Test',
  ad_delivery_start_time: '2026-07-16T07:00:00.000Z',
  ad_delivery_stop_time: '2026-07-20T22:00:00.000Z',
  ad_creative_bodies: ['Happy Hour in Wien: zweiter Kaffee gratis'],
  ad_creative_link_titles: ['Nur bis Sonntag'],
  ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=998877&access_token=super-secret-token',
  publisher_platforms: ['INSTAGRAM'],
  target_locations: [{ name: 'Vienna' }],
}, config, now);
assert.ok(ad.deal);
assert.equal(ad.deal.pubDate, '2026-07-16T07:00:00.000Z');
assert.equal(ad.deal.expirySource, 'meta-delivery-stop');
assert.equal(ad.deal.url, 'https://www.facebook.com/ads/library/?id=998877');
assert.doesNotMatch(JSON.stringify(ad), /super-secret-token/, 'credential-bearing snapshot URLs must never reach persisted deals');

const futureAd = normalizeAdLibraryItem({
  id: 'future-ad',
  page_name: 'Kaffeehaus Zukunft',
  ad_delivery_start_time: '2026-07-18T07:00:00.000Z',
  ad_creative_bodies: ['Morgen in Wien: zweiter Kaffee gratis'],
  ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=future-ad',
  publisher_platforms: ['INSTAGRAM'],
  target_locations: [{ name: 'Vienna' }],
}, config, now);
assert.equal(futureAd.rejection, 'ad-not-started', 'future ad campaigns must not appear before delivery starts');

const afterNewYear = new Date('2027-01-02T12:00:00.000Z');
const yearlessExpired = normalizeGraphMediaItem({
  id: 'yearless-expired',
  caption: 'Wien: 20 % Rabatt, gültig bis 31.12.',
  permalink: 'https://www.instagram.com/p/YEARLESSEXPIRED/',
  timestamp: '2026-12-30T10:00:00.000Z',
}, { sourceType: 'hashtag', sourceName: '#wienaktion' }, config, afterNewYear);
assert.equal(yearlessExpired.rejection, 'offer-expired', 'yearless dates are anchored to publication year, not revived after New Year');

const accounts = Array.from({ length: 45 }, (_, index) => ({ username: `account${index}`, priority: 100 - index }));
const shard = selectAccountShard(accounts, { maxAccountsPerRun: 20, shardIndex: 2 });
assert.equal(shard.length, 20);
assert.equal(shard[0].username, 'account40');
assert.equal(shard[5].username, 'account0');

const unconfigured = await runMetaInstagramCollector({
  now,
  env: { META_INSTAGRAM_REQUIRE_SOURCE: '1' },
  write: false,
});
assert.equal(unconfigured.report.status, 'not-configured');
assert.equal(unconfigured.shouldFail, true);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-instagram-test-'));
const outputPath = path.join(tempDir, 'deals.json');
const reportPath = path.join(tempDir, 'report.json');
const statePath = path.join(tempDir, 'state.json');
const lastGoodPayload = {
  lastUpdated: '2026-07-16T10:00:00.000Z',
  source: 'meta-instagram',
  totalDeals: 1,
  deals: [{ id: 'last-good', title: 'Last good Meta deal' }],
};
const lastGoodState = {
  version: 1,
  hashtagIds: { gratiswien: '123' },
  seenIds: { 'meta-ad-last-good': '2026-07-16T10:00:00.000Z' },
};
fs.writeFileSync(outputPath, JSON.stringify(lastGoodPayload));
fs.writeFileSync(statePath, JSON.stringify(lastGoodState));

const unconfiguredPreserved = await runMetaInstagramCollector({
  now,
  env: {
    META_INSTAGRAM_REQUIRE_SOURCE: '1',
    META_INSTAGRAM_OUTPUT_PATH: outputPath,
    META_INSTAGRAM_REPORT_PATH: reportPath,
    META_INSTAGRAM_STATE_PATH: statePath,
  },
});
assert.equal(unconfiguredPreserved.report.status, 'not-configured');
assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), lastGoodPayload, 'missing configuration must preserve last-good output');
assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), lastGoodState, 'missing configuration must preserve state');

const failedPreserved = await runMetaInstagramCollector({
  now,
  env: {
    META_AD_LIBRARY_ACCESS_TOKEN: 'test-token',
    META_AD_LIBRARY_SEARCH_TERMS: 'Wien gratis',
    META_AD_LIBRARY_MAX_PAGES_PER_TERM: '1',
    META_INSTAGRAM_MAX_RETRIES: '0',
    META_INSTAGRAM_OUTPUT_PATH: outputPath,
    META_INSTAGRAM_REPORT_PATH: reportPath,
    META_INSTAGRAM_STATE_PATH: statePath,
  },
  fetchImpl: async () => new Response('{"error":{"message":"temporary outage"}}', {
    status: 503,
    headers: { 'content-type': 'application/json' },
  }),
});
assert.equal(failedPreserved.report.status, 'failed');
assert.equal(failedPreserved.shouldFail, true);
assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), lastGoodPayload, 'an all-source failure must preserve last-good output');
assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), lastGoodState, 'an all-source failure must preserve delivery state');

const apiRun = await runMetaInstagramCollector({
  now,
  env: {
    META_AD_LIBRARY_ACCESS_TOKEN: 'test-token',
    META_AD_LIBRARY_SEARCH_TERMS: 'Wien gratis',
    META_AD_LIBRARY_MAX_PAGES_PER_TERM: '1',
  },
  fetchImpl: async (url) => {
    assert.match(String(url), /ads_archive/);
    assert.match(String(url), /publisher_platforms/);
    return new Response(JSON.stringify({
      data: [{
        id: 'api-test-ad',
        page_id: 'page-test',
        page_name: 'Wien Kaffee Test',
        ad_delivery_start_time: '2026-07-17T08:00:00.000Z',
        ad_creative_bodies: ['Heute in Wien: ein Espresso gratis'],
        ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=api-test-ad&access_token=api-response-secret',
        publisher_platforms: ['INSTAGRAM'],
        target_locations: [{ name: 'Vienna' }],
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
  write: false,
});
assert.equal(apiRun.report.status, 'ok');
assert.equal(apiRun.payload.totalDeals, 1);
assert.equal(apiRun.report.sources.adLibrary.fetched, 1);
assert.doesNotMatch(JSON.stringify(apiRun), /api-response-secret/, 'API response tokens must not enter payload, report, or state');

const thrownSecret = 'audit-secret-123';
const thrownNetworkFailure = await runMetaInstagramCollector({
  now,
  env: {
    META_AD_LIBRARY_ACCESS_TOKEN: thrownSecret,
    META_AD_LIBRARY_SEARCH_TERMS: 'Wien gratis',
    META_AD_LIBRARY_MAX_PAGES_PER_TERM: '1',
    META_INSTAGRAM_MAX_RETRIES: '0',
  },
  fetchImpl: async (url) => {
    throw new Error(`network failure for ${url}`);
  },
  write: false,
});
assert.doesNotMatch(JSON.stringify(thrownNetworkFailure), new RegExp(thrownSecret), 'thrown network errors must redact access tokens before entering reports');

fs.writeFileSync(statePath, JSON.stringify({
  ...lastGoodState,
  seenIds: { 'meta-ad-api-test-ad': '2026-07-17T09:00:00.000Z' },
}));
const observedButUndelivered = await runMetaInstagramCollector({
  now,
  env: {
    META_AD_LIBRARY_ACCESS_TOKEN: 'test-token',
    META_AD_LIBRARY_SEARCH_TERMS: 'Wien gratis',
    META_AD_LIBRARY_MAX_PAGES_PER_TERM: '1',
    META_INSTAGRAM_OUTPUT_PATH: outputPath,
    META_INSTAGRAM_REPORT_PATH: reportPath,
    META_INSTAGRAM_STATE_PATH: statePath,
  },
  fetchImpl: async () => new Response(JSON.stringify({
    data: [{
      id: 'api-test-ad',
      page_id: 'page-test',
      page_name: 'Kaffee Test',
      ad_delivery_start_time: '2026-07-17T08:00:00.000Z',
      ad_creative_bodies: ['Heute in Wien: ein Espresso gratis'],
      ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=api-test-ad',
      publisher_platforms: ['INSTAGRAM'],
      target_locations: [{ name: 'Vienna' }],
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }),
  write: false,
});
assert.equal(observedButUndelivered.payload.totalDeals, 1, 'observed state is not proof of Slack delivery and must not suppress output');

fs.writeFileSync(statePath, JSON.stringify({ version: 1, hashtagIds: {}, seenIds: {} }));
const rotatingAds = Array.from({ length: 5 }, (_, index) => ({
  id: `rotation-${index + 1}`,
  page_id: `page-${index + 1}`,
  page_name: `Kaffee ${index + 1}`,
  ad_delivery_start_time: `2026-07-17T0${8 - index}:00:00.000Z`,
  ad_creative_bodies: [`Heute in Wien: Espresso ${index + 1} gratis`],
  ad_snapshot_url: `https://www.facebook.com/ads/archive/render_ad/?id=rotation-${index + 1}`,
  publisher_platforms: ['INSTAGRAM'],
  target_locations: [{ name: 'Vienna' }],
}));
const rotationOptions = {
  now,
  env: {
    META_AD_LIBRARY_ACCESS_TOKEN: 'test-token',
    META_AD_LIBRARY_SEARCH_TERMS: 'Wien gratis',
    META_AD_LIBRARY_MAX_PAGES_PER_TERM: '1',
    META_INSTAGRAM_MAX_DEALS_PER_RUN: '2',
    META_INSTAGRAM_OUTPUT_PATH: outputPath,
    META_INSTAGRAM_REPORT_PATH: reportPath,
    META_INSTAGRAM_STATE_PATH: statePath,
  },
  fetchImpl: async () => new Response(JSON.stringify({ data: rotatingAds }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
};
const rotationRun = (minuteOffset) => runMetaInstagramCollector({
  ...rotationOptions,
  now: new Date(now.getTime() + minuteOffset * 60 * 1000),
});
const rotationFirst = await rotationRun(0);
const rotationSecond = await rotationRun(1);
const rotationThird = await rotationRun(2);
const rotationFourth = await rotationRun(3);
const firstBatchIds = new Set(rotationFirst.payload.deals.map((deal) => deal.id));
const secondBatchIds = new Set(rotationSecond.payload.deals.map((deal) => deal.id));
assert.equal(firstBatchIds.size, 2);
assert.equal(secondBatchIds.size, 2);
assert.equal([...firstBatchIds].some((id) => secondBatchIds.has(id)), false, 'rows beyond the per-run limit must rotate into the next batch');
assert.deepEqual(
  rotationFourth.payload.deals.map((deal) => deal.id),
  ['meta-ad-rotation-2', 'meta-ad-rotation-3'],
  'rotation continues by oldest observation after every row has been seen once',
);
assert.equal(rotationThird.payload.deals.length, 2);

fs.rmSync(tempDir, { recursive: true, force: true });

console.log('meta instagram collector tests passed');
