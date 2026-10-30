import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FOOD_GRAPH_HASHTAGS, COMBINED_FOOD_HASHTAGS, foodGraphHashtags, selectInstagramFoodAccounts, isDedicatedFoodHashtag } from '../scraper/instagram-food-source-policy.js';
import { buildConfig, loadAccountCatalog, runMetaInstagramCollector } from '../scraper/meta-instagram-deals.js';
import { selectCoverageAccounts, selectCoverageHashtags } from '../scraper/instagram-source-scheduler.js';
import { runWienDealsCombined } from '../scraper/wien-deals-combined.js';

const now = new Date('2026-10-30T14:00:00Z');

test('both Graph searches share a bounded evergreen pool already used by these jobs', () => {
  const previousUnion = new Set('gratiswien gratisinwien wiengastro wienessen wienkaffee wienaktion wienrabatt wiengutschein neueröffnungwien wienangebote wienangebot wiengratis viennadeals wienerdeals happyhourvienna wien vienna viennafood wienevents wientipps wienfamilie sommerinwien wienergastro essenwien viennaeats viennaevents viennarestaurants wienfood wienisst wienfoodie wienstreetfood'.split(' '));
  assert.equal(previousUnion.size, 31);
  assert.equal(FOOD_GRAPH_HASHTAGS.length, 18);
  assert.equal(new Set([...FOOD_GRAPH_HASHTAGS, ...COMBINED_FOOD_HASHTAGS]).size, 18);
  assert(FOOD_GRAPH_HASHTAGS.every(tag => previousUnion.has(tag)));
  assert(COMBINED_FOOD_HASHTAGS.every(isDedicatedFoodHashtag));
  assert(!FOOD_GRAPH_HASHTAGS.some(tag => /sommer|winter|weihnacht|events|familie|happyhour/.test(tag)));
  const config = buildConfig({ META_INSTAGRAM_FOOD_SOURCES_ONLY: '1', META_INSTAGRAM_HASHTAGS: 'sommerinwien,wienevents,wienessen,viernamystery' }, now);
  assert.deepEqual(config.hashtags, ['wienessen']);
  assert.deepEqual(foodGraphHashtags('sommerinwien'), [...FOOD_GRAPH_HASHTAGS]);
});

test('Combined filters stale variable overrides before requesting hashtags', async () => {
  const queries = [];
  const result = await runWienDealsCombined({ env: { INSTAGRAM_ACCESS_TOKEN: 'FAKE', INSTAGRAM_USER_ID: '123', META_INSTAGRAM_FOOD_SOURCES_ONLY: '1', WIEN_COMBINED_GRAPH_HASHTAGS: 'sommerinwien,wien,wienfood' },
    now, write: false, scanState: { version: 1, sources: {} }, fetchImpl: async url => {
      const u = new URL(url);
      if (u.pathname.endsWith('/ig_hashtag_search')) { queries.push(u.searchParams.get('q')); return Response.json({ data: [{ id: '456' }] }); }
      return Response.json({ data: [] });
    } });
  assert.deepEqual(result.report.hashtags, ['wienfood']);
  assert.deepEqual(queries, ['wienfood']);
});

test('old high-yield event scores cannot consume reserved food hashtag slots', () => {
  const config = { foodSourcesOnly: true, maxHashtagsPerRun: 8 };
  const state = { hashtagPerformance: Object.fromEntries(['wien', 'gratiswien', 'wiengratis'].map(tag => [tag, { recentFetched: 100, recentNewAccepted: 100 }])) };
  const selected = selectCoverageHashtags([...FOOD_GRAPH_HASHTAGS], config, state, now);
  assert.equal(selected.length, 8);
  assert.equal(selected.filter(isDedicatedFoodHashtag).length, 6);
  assert.equal(selected.filter(tag => !isDedicatedFoodHashtag(tag)).length, 2);
  const active = Object.fromEntries(FOOD_GRAPH_HASHTAGS.filter(isDedicatedFoodHashtag).map(tag => [tag, { lastRunAt: now.toISOString() }]));
  assert(selectCoverageHashtags([...FOOD_GRAPH_HASHTAGS], config, { hashtagPerformance: active }, now).length <= 2);
});

test('wrong food labels and historical acceptance do not resurrect unrelated accounts', () => {
  const bad = ['flugninja.at', 'welovehandmade.at', 'howmuch.live', 'rhea_mat', 'holzhandwerk.wien', 'apotheke.at', 'juwel.wien', 'shop.klanglichtimpark.at', 'market.island_uae'];
  const sources = bad.map(username => ({ username, category: 'essen', foodOfferSamples: ['Gratis Kaffee in Wien'], manualApprovedDeals: 100, verifiedVienna: true }));
  sources.push({ username: 'unknown_software', category: 'essen', origins: ['registry'], foodOfferSamples: ['Gratis Software-Testmonat'] });
  const result = selectInstagramFoodAccounts(sources);
  assert.equal(result.accounts.length, 0);
  assert.equal(result.excluded.length, sources.length);
});

test('real food sources, named products, scouts, groceries and unfamiliar merchants survive', () => {
  const original = [
    { username: 'onlynoodle_', category: 'essen', foodOfferSamples: ['1+1 gratis Biang Biang Noodles'] },
    { username: 'boca.vienna', foodOfferSamples: ['Say hola to our Lunch Deal.'] },
    { username: 'rhulo1020', consumerFoodOfferEvidence: true },
    { username: 'new_unknown', consumerFoodOfferEvidence: true },
    { username: 'dieseeteufel', approvedFoodSource: true },
    { username: 'marin_kaffee' }, { username: 'eylulbaeckerei' },
    { username: 'viennawurstelstand', accountType: 'creator' },
    { username: 'wolt.oesterreich', category: 'delivery' },
    { username: 'lidloesterreich', category: 'supermarkt' },
    { username: 'obscure_venue', origins: ['vienna-directory'], merchants: [{ kind: 'restaurant' }] },
  ];
  const before = structuredClone(original);
  const result = selectInstagramFoodAccounts(original);
  assert.equal(result.accounts.length, original.length);
  assert.deepEqual(original, before, 'source/history objects are never edited');
  const selected = selectCoverageAccounts(result.accounts, { maxAccountsPerRun: 20, foodAccountShare: 1 }, {}, now);
  assert.equal(selected.length, original.length, 'valid grocery/scout sources can use food slots');
});

test('published approved Vienna food sources survive without changing any live record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approved-food-source-'));
  try {
    const registryPath = path.join(dir, 'registry.json'), watchlistPath = path.join(dir, 'watchlist.json'), publishedPath = path.join(dir, 'live.json');
    fs.writeFileSync(registryPath, JSON.stringify({ accounts: [{ username: 'dieseeteufel' }, { username: 'unknown_app' }, { username: 'foreign_venue' }] }));
    fs.writeFileSync(watchlistPath, JSON.stringify({ accounts: [] }));
    const published = { deals: [{ ownerUsername: 'dieseeteufel', brand: 'Die Seeteufel', category: 'essen', title: 'Rabatt', city: 'Wien', approvedAt: now.toISOString() },
      { ownerUsername: 'unknown_app', brand: 'Application', category: 'technik', city: 'Wien', approvedAt: now.toISOString() },
      { ownerUsername: 'foreign_venue', brand: 'Another Venue', category: 'essen', city: 'Dubai', approvedAt: now.toISOString() }] };
    fs.writeFileSync(publishedPath, JSON.stringify(published));
    const catalog = loadAccountCatalog(buildConfig({}, now), { registryPath, watchlistPath, publishedPath, candidatePaths: [] });
    assert.deepEqual(selectInstagramFoodAccounts(catalog).accounts.map(a => a.username), ['dieseeteufel']);
    assert.deepEqual(JSON.parse(fs.readFileSync(publishedPath)), published);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('collector excludes irrelevant accounts before any Graph request and retains generic food merchants', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-food-sources-'));
  try {
    const registryPath = path.join(dir, 'registry.json');
    const watchlistPath = path.join(dir, 'watchlist.json');
    const candidatePath = path.join(dir, 'candidates.json');
    fs.writeFileSync(watchlistPath, JSON.stringify({ accounts: [{ username: 'cafe_test', category: 'food' }] }));
    fs.writeFileSync(registryPath, JSON.stringify({ accounts: [{ username: 'flugninja.at', category: 'essen' }, { username: 'random_app', topCategories: [{ value: 'essen' }], sampleTitles: ['Free trial for software'] }] }));
    fs.writeFileSync(candidatePath, JSON.stringify({ deals: [{ ownerUsername: 'new_venue', brand: 'New Venue', title: 'Gratis Kaffee', description: 'Gratis Kaffee in Wien, 1010 Wien.', address: 'Testgasse 1, 1010 Wien', url: 'https://www.instagram.com/p/NewFood/' }] }));
    const config = { ...buildConfig({ META_INSTAGRAM_FOOD_SOURCES_ONLY: '1', META_INSTAGRAM_MAX_COVERAGE: '1', INSTAGRAM_ACCESS_TOKEN: 'FAKE', INSTAGRAM_USER_ID: '123' }, now),
      hashtags: [], foodAccountShare: 1, maxAccountsPerRun: 20, mediaMaxPostsPerRun: 0, mediaLlmMaxCallsPerRun: 0,
      outputPath: path.join(dir, 'out.json'), reportPath: path.join(dir, 'report.json'), statePath: path.join(dir, 'state.json'), graphEvidencePath: path.join(dir, 'evidence.json') };
    const calls = [];
    const result = await runMetaInstagramCollector({ config, env: {}, now, write: false, paths: { watchlistPath, registryPath, candidatePaths: [candidatePath] }, fetchImpl: async url => {
      const username = new URL(url).searchParams.get('fields')?.match(/business_discovery\.username\(([^)]+)\)/)?.[1];
      assert(['cafe_test', 'new_venue'].includes(username), `unexpected source ${username}`);
      calls.push(username);
      return Response.json({ business_discovery: { username, media: { data: [] } } });
    } });
    assert.deepEqual([...calls].sort(), ['cafe_test', 'new_venue']);
    assert.equal(result.report.accountSourceSelection.catalogBeforeFilter, 4);
    assert.equal(result.report.accountSourceSelection.excluded.length, 2);
    assert.equal(result.report.selectedAccounts.filter(a => a.foodFocused).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
