import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DAY, LIMITS, discoverySources, selectDiscoverySources, reservationReason,
  classifyDiscoveryPost, postFingerprint, postIdentity, mergeDiscoveryPending } from '../scraper/apify-food-discovery-policy.js';
import { actorInput, runBoundedActor, collectDiscoveryBatches, restrictedMediaFetch, safeMediaUrl, processDiscoveryItems, pipelineHealthReport } from '../scraper/apify-food-discovery.js';

const now = new Date('2026-10-22T18:00:00Z');
const post = overrides => ({ url: 'https://www.instagram.com/p/TestCoffee1/', caption: 'Wien: Nur heute 1+1 auf alle Kaffee!',
  ownerUsername: 'cafe_example', timestamp: '2026-10-22T09:00:00Z', locationName: 'Wien', ...overrides });
const emptyState = () => ({ reservations: [], sources: {}, seen: {} });
const budget = { allowed: true, runCapUsd: .04, cycle: { startAt: '2026-10-15', endAt: '2026-11-14' } };

test('curated profiles rotate fairly; blocked merchants and bar-only seeds excluded', () => {
  const pool = discoverySources({ accounts: [
    { username: 'cafe_one', category: 'food', priority: 100 },
    { username: 'pizza_two', category: 'food', priority: 50 },
    { username: 'bad', category: 'food' }, { username: 'bar', category: 'drinks' },
  ] }, { accounts: [{ username: 'bad', blockedByModeration: true }] });
  assert.equal(pool.filter(s => s.kind === 'profile').length, 2);
  const state = { sources: { 'profile:cafe_one': { lastAttemptAt: now.toISOString() } } };
  assert.equal(selectDiscoverySources(pool, state, now)[0].username, 'pizza_two');
  state.sources['profile:pizza_two'] = { retryAt: new Date(+now + DAY).toISOString() };
  assert.equal(selectDiscoverySources(pool, state, now)[0].username, 'cafe_one');
});
test('reservations prevent duplicate retries, close spacing and exceeding free envelope', () => {
  assert.equal(reservationReason(emptyState(), budget, '1', now), '');
  const state = emptyState();
  state.reservations.push({ key: '1', capUsd: .04, at: '2026-10-22T10:00:00Z' });
  assert.equal(reservationReason(state, budget, '1', now), 'workflow-already-reserved');
  assert.equal(reservationReason(state, budget, '2', new Date('2026-10-22T11:00:00Z')), 'minimum-six-hour-spacing');
  state.reservations.push({ key: '2', capUsd: .04, at: '2026-10-22T01:00:00Z' });
  assert.equal(reservationReason(state, budget, '3', now), 'daily-budget-reserved');
  state.reservations = [{ key: 'old', capUsd: 2.48, at: '2026-10-20T01:00:00Z' }];
  assert.equal(reservationReason(state, budget, '3', now), 'cycle-budget-reserved');
  state.reservations[0].capUsd = 'broken';
  assert.equal(reservationReason(state, budget, '3', now), 'invalid-budget-ledger');
});
test('one-time hashtag validation stays inside existing budgets without changing scan cadence', () => {
  const state = emptyState();
  state.reservations.push({ key: 'old', capUsd: .04, at: now.toISOString() });
  const validation = { ...budget, runCapUsd: .01 };
  assert.equal(reservationReason(state, validation, 'new', now, 'hashtag-test'), '');
  assert.equal(reservationReason(state, budget, 'new', now), 'minimum-six-hour-spacing');
  assert.equal(reservationReason(state, budget, 'new', now, 'hashtag-test'), 'invalid-validation-cap');
  state.hashtagValidationReservedAt = now.toISOString();
  assert.equal(reservationReason(state, validation, 'new', now, 'hashtag-test'), 'hashtag-validation-already-reserved');
  delete state.hashtagValidationReservedAt;
  state.reservations[0].capUsd = .08;
  assert.equal(reservationReason(state, validation, 'new', now, 'hashtag-test'), 'daily-budget-reserved');
  state.reservations[0] = { key: 'old', capUsd: 2.5, at: '2026-10-20T10:00:00Z' };
  assert.equal(reservationReason(state, validation, 'new', now, 'hashtag-test'), 'cycle-budget-reserved');
  state.retryAt = new Date(+now + DAY).toISOString();
  assert.equal(reservationReason(state, validation, 'new', now, 'hashtag-test'), 'channel-cooldown');
});
test('bounded actor input and one charged start, terminal polling and dataset cap', async () => {
  const calls = [];
  let clock = +now;
  const sources = [{ kind: 'profile', url: 'https://www.instagram.com/cafe_example/' }];
  const client = { request: async (url, options) => {
    calls.push({ url, options });
    if (options?.method === 'POST') return { id: 'run123', status: 'RUNNING' };
    if (url.includes('/actor-runs/')) return { id: 'run123', status: 'SUCCEEDED', defaultDatasetId: 'dataset123', usageTotalUsd: .027 };
    return Array.from({ length: 12 }, () => post());
  } };
  const result = await runBoundedActor(client, sources, { now: () => new Date(clock), sleep: async ms => { clock += ms; } });
  assert.equal(result.items.length, 8);
  assert.equal(calls.filter(c => c.options?.method === 'POST').length, 1);
  assert.match(calls[0].url, /timeout=600&memory=512&maxItems=8&maxTotalChargeUsd=0.03/);
  assert.deepEqual(calls[0].options.body, actorInput(sources, now));
});
test('ambiguous start is never retried; polling deadline aborts bounded actor', async () => {
  let count = 0;
  const sources = [{ kind: 'profile', url: 'https://www.instagram.com/test/' }];
  await assert.rejects(runBoundedActor({ request: async () => { count++; throw new Error('uncertain'); } }, sources));
  assert.equal(count, 1);
  let clock = +now, aborted = false;
  await assert.rejects(runBoundedActor({ request: async url => {
    if (url.endsWith('/abort')) aborted = true;
    return { id: 'run123', status: 'RUNNING' };
  } }, sources, { now: () => new Date(clock), sleep: async () => { clock += 120_000; } }), /deadline/);
  assert.equal(aborted, true);
});
test('dedicated hashtag actor gets hashtag input and both actors share the unchanged .04 ceiling', async () => {
  const starts = [], checked = [];
  const sources = [{ kind: 'profile', key: 'profile:cafe', url: 'https://www.instagram.com/cafe/' },
    { kind: 'hashtag', key: 'hashtag:wienfood', url: 'https://www.instagram.com/explore/tags/wienfood/' }];
  const client = {
    preflight: async actor => {
      checked.push(actor);
      return { user: { plan: { monthlyUsageCreditsUsd: 5 } }, limits: { current: { monthlyUsageUsd: 0 },
        limits: { maxMonthlyUsageUsd: 5 }, monthlyUsageCycle: { startAt: '2026-10-01', endAt: '2026-11-01' } },
      actor: { pricingInfos: [{ startedAt: '2026-01-01', pricingModel: 'PAY_PER_EVENT', minimalMaxTotalChargeUsd: .0027 }] } };
    },
    request: async (route, options) => {
      if (options?.method === 'POST') {
        starts.push({ route, body: options.body });
        return { id: `run${starts.length}`, status: 'SUCCEEDED', defaultDatasetId: `data${starts.length}` };
      }
      return [post()];
    },
  };
  const result = await collectDiscoveryBatches(client, sources, { now: () => now });
  assert.equal(starts.length, 2);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(checked, ['apify~instagram-scraper', 'apify~instagram-hashtag-scraper']);
  assert.deepEqual(starts[1].body, { hashtags: ['wienfood'], resultsType: 'posts', resultsLimit: 2, keywordSearch: false });
  const total = starts.reduce((sum, call) => sum + Number(new URL(`https://api.apify.com${call.route}`).searchParams.get('maxTotalChargeUsd')), 0);
  assert.equal(total, .04);
  const oldRequest = client.request;
  client.request = async (route, options) => {
    if (route.includes('instagram-hashtag-scraper/runs')) throw new Error('actor-failed');
    return oldRequest(route, options);
  };
  const partial = await collectDiscoveryBatches(client, sources, { now: () => now });
  assert.equal(partial.items.length, 1);
  assert.equal(partial.errors.length, 1);
  assert.equal(partial.failedSources.has('hashtag:wienfood'), true);
  client.preflight = async () => { throw Object.assign(new Error('apify-http-429'), { httpStatus: 429 }); };
  const paused = await collectDiscoveryBatches(client, sources, { now: () => now });
  assert.equal(paused.runs.length, 0);
  assert.ok(Date.parse(paused.retryAt) >= +now + DAY);
});
test('concrete coffee BOGO is evidenced, not automatically published or fake voted', () => {
  const { deal } = classifyDiscoveryPost(post(), { now });
  assert.ok(deal);
  assert.equal(deal.type, 'bogo');
  assert.equal(deal.votes, 0);
  assert.equal(deal.reviewRequired, true);
  assert.equal(deal.expires, '2026-10-22T21:59:59.999Z');
  assert.ok(deal.qualityScore >= 85);
});
test('German inflection in the supplied free-sample example retains original evidence', () => {
  const caption = 'Gratis Probe unseres neuen veganen Burgers in Wien';
  const { deal } = classifyDiscoveryPost(post({ caption }), { now });
  assert.ok(deal);
  assert.equal(deal.type, 'gratis');
  assert.match(deal.description, /Burgers/);
});
test('alcohol, mixed alcohol, giveaways, ordinary meals, negations and nonfood are excluded', () => {
  for (const caption of [
    'Wien: Weinverkostung 20% Rabatt', 'Wien: Gratis Burger und Bier!',
    'Wien: Kaffee gratis! Gewinnspiel: markiere Freunde!', 'Wien: Leckere Pizza heute!',
    'Wien: Kein gratis Kaffee.', 'Wien: Gratis Lieferung auf Pizza.',
    'Wien: Kein 1+1 auf Kaffee.',
    'Wien: Kaffeemaschine 20% Rabatt', 'Gratis Burger in Graz #viennafood',
  ]) assert.equal(classifyDiscoveryPost(post({ caption, locationName: '' }), { now }).deal, null, caption);
});
test('dietary-free or free WiFi does not turn a priced offer into free food', () => {
  for (const caption of ['Wien: Gluten-free Pizza 20% Rabatt.', 'Wien: Pizza 20% Rabatt. Free WiFi!']) {
    assert.equal(classifyDiscoveryPost(post({ caption }), { now }).deal.type, 'rabatt');
  }
});
test('missing/stale/future dates and expired offers cannot be refreshed by crawling', () => {
  for (const raw of [post({ timestamp: '' }), post({ timestamp: '2026-10-10' }), post({ timestamp: '2026-11-01' }),
    post({ timestamp: '2026-10-21', caption: 'Wien: Nur heute Kaffee gratis!' }),
    post({ caption: 'Wien: Kaffee gratis am 21.10.2026!' })]) {
    assert.equal(classifyDiscoveryPost(raw, { now }).deal, null, JSON.stringify(raw));
  }
});
test('hashtag or unverified discovery profile alone is not Vienna proof', () => {
  const raw = post({ locationName: '', caption: 'Kaffee gratis! #wien #viennafood' });
  assert.equal(classifyDiscoveryPost(raw, { now }).rejectReason, 'missing-vienna-evidence');
  const registry = { accounts: [{ username: 'cafe_example', accountType: 'merchant', viennaVerified: true }] };
  assert.ok(classifyDiscoveryPost(raw, { now, registry }).deal);
  assert.equal(classifyDiscoveryPost({ ...raw, locationName: 'Graz' }, { now, registry }).deal, null);
  assert.equal(classifyDiscoveryPost(post({ caption: 'Gratis Kaffee in Berlin', locationName: 'Wien' }), { now, registry }).deal, null);
});
test('OCR adds evidence while caption, conditions and actual publication date survive', () => {
  const raw = post({ caption: 'Unsere Aktion in Wien.' });
  const result = classifyDiscoveryPost(raw, { now, ocrText: '1+1 Pizza mit Gutschein. Nur fuer die ersten 20 Kunden.' });
  assert.ok(result.deal);
  assert.equal(result.deal.originalCaption, raw.caption);
  assert.match(result.deal.description, /ersten 20/);
  assert.equal(Date.parse(result.deal.sourcePublishedAt), Date.parse(raw.timestamp));
  assert.equal(classifyDiscoveryPost(raw, { now, ocrText: 'Gratis Pizza und Wein' }).deal, null);
});
test('media fetch is CDN-only, image-only, no redirects or access-error retries', async () => {
  for (const url of ['http://s.cdninstagram.com/a', 'https://127.0.0.1/a', 'https://cdninstagram.com.evil.test/a', 'https://a:b@s.fbcdn.net/a']) assert.equal(safeMediaUrl(url), '');
  const url = 'https://s.cdninstagram.com/image.jpg';
  for (const status of [302, 403, 429]) {
    let calls = 0;
    await assert.rejects(restrictedMediaFetch(async (_url, options) => {
      calls++; assert.equal(options.redirect, 'manual'); return new Response('', { status });
    })(url, {}), /media-refused/);
    assert.equal(calls, 1);
  }
});
test('canonical duplicates, fingerprint cursors and OCR limits avoid repeated work', async () => {
  let calls = 0;
  const ocr = async () => { calls++; return { ocrText: '', errors: [] }; };
  const raw = post({ displayUrl: 'https://s.cdninstagram.com/image.jpg?sig=abc' });
  assert.equal(postFingerprint(raw), postFingerprint({ ...raw, displayUrl: 'https://s.cdninstagram.com/image.jpg?sig=def' }));
  const first = await processDiscoveryItems([raw, raw], { now, ocr });
  assert.equal(calls, 1); assert.equal(first.deals.length, 1); assert.equal(first.report.duplicatePosts, 1);
  const second = await processDiscoveryItems([raw], { now, ocr, state: { seen: first.seen }, previous: first.deals });
  assert.equal(calls, 1); assert.equal(second.report.unchangedPosts, 1); assert.equal(second.report.freshAcceptedDeals, 0);
  assert.equal(second.deals.length, 1);
  const known = await processDiscoveryItems([raw], { now, ocr, knownPostKeys: new Set([postIdentity(raw)]) });
  assert.equal(known.deals.length, 0); assert.equal(calls, 1);
  calls = 0;
  await processDiscoveryItems(Array.from({ length: 10 }, (_, i) => ({ ...raw, url: `https://www.instagram.com/p/Test${i}/` })), { now, ocr });
  assert.equal(calls, LIMITS.ocrPosts);
});
test('changed expired caption removes pending item; incomplete OCR retries, source errors retain pending', async () => {
  const raw = post({ displayUrl: 'https://s.cdninstagram.com/image.jpg' });
  const first = await processDiscoveryItems([raw], { now });
  assert.equal(first.seen[postIdentity(raw)].ocrIncomplete, true);
  const failed = await processDiscoveryItems([{ error: 'private-account' }], { now, previous: first.deals });
  assert.equal(failed.report.providerErrors, 1); assert.equal(failed.deals.length, 1);
  const changed = await processDiscoveryItems([{ ...raw, caption: 'Wien: Kaffee gratis am 20.10.2026!' }], { now, previous: first.deals });
  assert.equal(changed.deals.length, 0);
});
test('unknown expiry is anchored to post date, no TTL refresh; content clones dedupe', () => {
  const raw = post({ caption: 'Wien: Kaffee gratis!' });
  const a = classifyDiscoveryPost(raw, { now }).deal;
  const b = classifyDiscoveryPost({ ...raw, url: 'https://www.instagram.com/p/Different1/' }, { now }).deal;
  assert.equal(a.expires, '2026-10-25T09:00:00.000Z');
  assert.equal(mergeDiscoveryPending([a], [b], [], now).length, 1);
  assert.equal(mergeDiscoveryPending([a], [], [], new Date('2026-10-26')).length, 0);
});
test('workflow separates secrets, persists reservation before start, keeps manual approval and fixed cadence', () => {
  const workflow = fs.readFileSync('.github/workflows/apify-discovery.yml', 'utf8');
  assert.ok(workflow.indexOf('Reserve bounded') < workflow.indexOf('Persist reservation'));
  assert.ok(workflow.indexOf('Persist reservation') < workflow.indexOf('apify-food-discovery.js --run'));
  assert.match(workflow, /APIFY_2_DISCOVERY_ENABLED/);
  assert.match(workflow, /25 5,17 \* \* \*/);
  assert.doesNotMatch(workflow, /SLACK_BOT_TOKEN|OPENAI_API_KEY|SCRAPINGBEE/);
  assert.doesNotMatch(fs.readFileSync('.github/workflows/daily-digest.yml', 'utf8'), /Apify 2 Vienna Food Discovery/);
  assert.match(fs.readFileSync('scraper/slack-notify.js', 'utf8'), /file\.startsWith\('deals-pending-'\)/);
});
test('health separates fresh accepted candidates from retained queue and source failures', () => {
  const health = pipelineHealthReport({ generatedAt: now.toISOString(), status: 'partial', fetchedRecords: 5,
    freshAcceptedDeals: 0, pendingDeals: 8, providerErrors: 1 });
  assert.equal(health.status, 'completed-with-errors');
  assert.equal(health.counts.acceptedDeals, 0);
  assert.equal(health.diagnostics.pendingDeals, 8);
  assert.equal(health.diagnostics.providerErrors, 1);
});
