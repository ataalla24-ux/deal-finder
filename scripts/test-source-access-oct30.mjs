import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInstagramWebAccess } from '../scraper/instagram-web-access-policy.js';
import { discoverProfileCandidates, enrichPreviews, enrichRenderedPreviews, fetchRenderedInstagramPreview, extractViennaLocation } from '../scraper/instagram-ai-agent.js';
import { filterAlreadyQueuedDeals, loadQueuedDealDuplicateKeys, loadRecentlySeenPostKeys, buildSlackMessage } from '../scraper/slack-notify.js';
import { runScheduledPowerSource } from '../scraper/power-source-scheduling.js';
import { POWER_FOOD_SOURCES } from '../scraper/power-food-sources.js';
import { extractFoodOffers, extractFoodExpiry, discoverFoodLinks } from '../scraper/power-food-extraction.js';
import { sourceHttpError } from '../scraper/source-http-policy.js';

const now = new Date('2026-10-30T10:00:00Z');
const clock = hours => new Date(+now + hours * 3600000);
const candidates = Array.from({ length: 5 }, (_, i) => ({ url: `https://www.instagram.com/p/Test${i}/` }));

test('delivery cache needs no auth or reaction lookups; human decisions and cache reuse are preserved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'food-seen-read-'));
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => { throw Error('unnecessary Slack API request'); };
  try {
    const options = { now, cachePath: path.join(dir, 'seen.json'), listThreads: async () => ['1', '2', '3'],
      readThread: async ts => { reads++; return [{ ts, text: 'FreeFinder Wien' }, {
        ts: `${ts}.1`, text: buildSlackMessage({ id: `test${ts}`, title: 'Gratis Kaffee in Wien', brand: 'Cafe Test', category: 'kaffee', type: 'gratis', description: 'Gratis Kaffee in Wien.', url: `https://www.instagram.com/p/Test${ts}/` }, 1),
        reactions: ts === '1' ? [] : [{ name: ts === '2' ? 'white_check_mark' : 'x', users: ['human'] }],
      }, { ts: `${ts}.2`, user: 'human', text: 'Bitte Bedingungen beachten.' }]; } };
    const first = await loadRecentlySeenPostKeys(options);
    assert.equal(first.size, 3, 'delivered, approved and rejected messages all remain seen');
    assert.equal(reads, 3);
    const second = await loadRecentlySeenPostKeys({ ...options, listThreads: async () => { throw Error('fresh cache reread'); } });
    assert.deepEqual(second, first);
    assert.equal(reads, 3);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function browser(status = 200, retryAfter = '') {
  const calls = { launch: 0, navigation: 0, evaluate: 0, closed: 0 };
  const page = { goto: async () => { calls.navigation++; return { status: () => status, headers: () => ({ 'retry-after': retryAfter }) }; },
    evaluate: async () => { calls.evaluate++; return { finalUrl: candidates[0].url, title: 'Instagram', text: 'Something went wrong', html: '', bodyText: '', times: [] }; },
    waitForTimeout: async () => {}, mouse: { wheel: async () => {} }, close: async () => { calls.closed++; } };
  const browserType = { launch: async () => { calls.launch++; return { newContext: async () => ({ newPage: async () => page, addCookies: async () => {}, close: async () => {} }), close: async () => {} }; } };
  return { calls, page, browserType };
}

test('HTTP429 respects Retry-After beyond the backoff cap and persists without sliding', () => {
  const access = createInstagramWebAccess({ now });
  const until = clock(240).toUTCString();
  access.failure('all', { status: 429, retryAfter: until });
  assert.equal(access.pause().nextRetryAt, clock(240).toISOString());
  const next = createInstagramWebAccess({ now: clock(1), previousReport: { webAccess: access.snapshot(), lastUpdated: clock(1).toISOString() } });
  assert.deepEqual(next.snapshot(), access.snapshot());
  next.success();
  assert.equal(next.pause().nextRetryAt, clock(240).toISOString());
});

test('repeated denials back off; successful recovery clears an expired pause', () => {
  const first = createInstagramWebAccess({ now });
  first.failure('profiles', { status: 403 });
  assert.equal(first.pause().nextRetryAt, clock(24).toISOString());
  const second = createInstagramWebAccess({ now: clock(25), previousReport: { webAccess: first.snapshot() } });
  assert.equal(second.pause(), null);
  second.failure('all', { status: 403 });
  assert.equal(second.pause().nextRetryAt, clock(73).toISOString());
  const recovered = createInstagramWebAccess({ now: clock(74), previousReport: { webAccess: second.snapshot() } });
  recovered.success();
  assert.deepEqual(recovered.snapshot(), {});
});

test('healthcheck429 pauses every website transport without disabling cached evidence or Graph', async () => {
  const access = createInstagramWebAccess({ now, healthReport: { status: 'rate-limited', updatedAt: now.toISOString(), nextRetryAt: clock(8).toISOString() } });
  const fake = browser();
  const profile = await discoverProfileCandidates([{ username: 'merchant' }], new Map(), { enabled: true, access, browserType: fake.browserType });
  assert.equal(profile.accountsVisited, 0);
  let fetches = 0;
  const previews = await enrichPreviews(candidates, { enabled: true, access, fetchPreview: async () => { fetches++; } });
  await enrichRenderedPreviews(candidates, { enabled: true, access, browserType: fake.browserType });
  assert.equal(previews.stats.deferred, candidates.length);
  assert.equal(fetches, 0);
  assert.equal(fake.calls.launch, 0);
  assert.equal(candidates[0].preview, undefined);
});

test('legacy profile blocks pause profiles, not exact-post public previews', async () => {
  const access = createInstagramWebAccess({ now: clock(1), previousReport: { lastUpdated: now.toISOString(), profileDiscovery: { stoppedReason: 'three-consecutive-profile-blocks' } } });
  assert.equal(access.pause(), null);
  assert.equal(access.pause('profiles').nextRetryAt, clock(6).toISOString());
  const fake = browser();
  await discoverProfileCandidates([{ username: 'merchant' }], new Map(), { enabled: true, access, browserType: fake.browserType });
  assert.equal(fake.calls.launch, 0);
});

test('profile403/429 makes one request, never a locale retry or anonymous retry', async () => {
  for (const status of [401, 403, 429]) {
    const fake = browser(status, '172800');
    const access = createInstagramWebAccess({ now });
    const stats = await discoverProfileCandidates([{ username: 'merchant' }, { username: 'other' }], new Map(), { enabled: true, access, browserType: fake.browserType });
    assert.equal(fake.calls.navigation, 1);
    assert.equal(fake.calls.evaluate, 0);
    assert.equal(stats.stoppedReason, `instagram-http-${status}`);
    assert.equal(access.pause().nextRetryAt, clock(48).toISOString());
    await enrichRenderedPreviews(candidates, { enabled: true, access, browserType: fake.browserType });
    assert.equal(fake.calls.launch, 1);
  }
});

test('renderer propagates real HTTP errors and stops before parsing or other transports', async () => {
  for (const status of [403, 429, 503]) {
    const fake = browser(status, '86400');
    const result = await fetchRenderedInstagramPreview(fake.page, candidates[0].url);
    assert.equal(result.status, status);
    assert.equal(result.retryAfter, '86400');
    assert.equal(fake.calls.evaluate, 0);
  }
  const fake = browser(429, '172800');
  const access = createInstagramWebAccess({ now });
  const errors = await enrichRenderedPreviews(candidates, { enabled: true, access, browserType: fake.browserType });
  assert.equal(fake.calls.navigation, 1);
  assert.match(errors[0].error, /HTTP 429/);
  assert.equal(access.pause().nextRetryAt, clock(48).toISOString());
});

test('public preview denial persists to the next run, not just an in-memory circuit', async () => {
  const access = createInstagramWebAccess({ now });
  let calls = 0;
  await enrichPreviews(structuredClone(candidates), { enabled: true, access, fetchPreview: async () => { calls++; return { status: 429, retryAfter: '86400' }; } });
  const next = createInstagramWebAccess({ now: clock(1), previousReport: { webAccess: access.snapshot() } });
  await enrichPreviews(candidates, { enabled: true, access: next, fetchPreview: async () => { calls++; } });
  assert.equal(calls, 1);
  assert.equal(next.pause().nextRetryAt, clock(24).toISOString());
});

test('unavailable profiles persist a pause and renderer503 stops after three failures', async () => {
  const fake = browser();
  const access = createInstagramWebAccess({ now });
  const accounts = Array.from({ length: 5 }, (_, i) => ({ username: `merchant${i}` }));
  await discoverProfileCandidates(accounts, new Map(), { enabled: true, access, browserType: fake.browserType });
  assert.equal(fake.calls.navigation, 3);
  const next = createInstagramWebAccess({ now: clock(1), previousReport: { webAccess: access.snapshot() } });
  await discoverProfileCandidates(accounts, new Map(), { enabled: true, access: next, browserType: fake.browserType });
  assert.equal(fake.calls.navigation, 3);
  const failing = browser(503);
  const renderAccess = createInstagramWebAccess({ now });
  await enrichRenderedPreviews(candidates, { enabled: true, access: renderAccess, browserType: failing.browserType });
  assert.equal(failing.calls.navigation, 3);
  assert.equal(renderAccess.pause().nextRetryAt, clock(1).toISOString());
});

test('a rendered login wall is not accepted just because generic metadata exists', async () => {
  const fake = browser();
  fake.page.evaluate = async () => ({ finalUrl: candidates[0].url, bodyText: 'Log in to Instagram', ogDescription: 'Generic metadata', times: [] });
  const access = createInstagramWebAccess({ now });
  const errors = await enrichRenderedPreviews(structuredClone(candidates), { enabled: true, access, browserType: fake.browserType });
  assert.equal(fake.calls.navigation, 1);
  assert.match(errors[0].error, /login-wall/);
  assert.equal(access.pause().reason, 'login-wall');
});

test('BackWerk follows the migrated Austrian offers and rejects the expired Snackbox', async () => {
  const source = POWER_FOOD_SOURCES.find(x => x.name === 'BackWerk');
  assert.equal(source.url, 'https://back-werk.at/de/aktuell');
  const detail = 'https://back-werk.at/de/aktuell/es-ist-snackbox-zeit-id2618';
  assert.deepEqual(discoverFoodLinks(`<a href="/de/aktuell/es-ist-snackbox-zeit-id2618">Snackbox</a><a href="/de/aktuell/store-in-salzburg">Store</a><a href="https://back-werk.de/de/aktuell/angebot">DE</a>`, source), [detail]);
  const html = '<h1>Es ist Snackbox-Zeit - drei belegte Weckerl für 5,90€</h1><p>Die BackWerk-Snackbox ist ideal, um dir einen leckeren Dreierpack für unterwegs zu einem Deal-Preis zu sichern. Bis zum 04. Mai bekommst du die Mehrkornsemmel Omelett, die Kaisersemmel Rösti und die Mehrkornsemmel Putenschinken zusammen für nur 5,90€.</p>';
  const parsed = extractFoodOffers(html, source, { now, pageUrl: detail });
  assert.equal(parsed.deals.length, 0);
  assert.equal(parsed.rejected[0].reason, 'offer-expired');
  for (const [text, expected] of [['bis zum 04. Mai', '2026-05-04'], ['bis 4. Mai 2025', '2025-05-04'], ['bis 4. Mai 2027', '2027-05-04'], ['bis 3. Jänner 2027', '2027-01-03']]) {
    assert.equal(extractFoodExpiry(text, now).validUntil, expected);
  }
  const future = extractFoodOffers(html.replace('04. Mai', '04. November 2026') + '<p>In allen Filialen in Österreich.</p>', source, { now, pageUrl: detail });
  assert.equal(future.deals[0].validUntil, '2026-11-04');
  assert.equal(future.deals[0].evidence.locationScope, 'austria-wide');
  let fetched = 0;
  const result = await runScheduledPowerSource(source, { sources: [{ source: 'BackWerk', url: 'https://www.back-werk.at/de/home/', cooldown: { reason: 'missing-endpoint', nextRetryAt: clock(72).toISOString() } }] }, async () => { fetched++; return { status: 'ok' }; }, now);
  assert.equal(fetched, 1, 'old missing URL does not disable a verified new endpoint');
  assert.equal(result.status, 'ok');
});

test('Power still honors access/rate cooldowns across changed merchant URLs', async () => {
  const source = { name: 'Test Cafe', url: 'https://example.test/offers', officialFood: true };
  const result = await runScheduledPowerSource(source, {}, async () => ({ source: source.name, url: source.url, status: 'error', error: 'HTTP 429', httpStatus: 429, retryAt: clock(240).toISOString() }), now);
  const second = await runScheduledPowerSource({ ...source, url: 'https://example.test/new' }, { sources: [result] }, async () => { throw Error('must not bypass cooldown'); }, clock(1));
  assert.equal(second.status, 'deferred');
  assert.equal(second.cooldown.nextRetryAt, clock(240).toISOString());
  assert.equal(sourceHttpError(403, '3600', now).retryAt, clock(1).toISOString());
});

test('a weaker dated Rhulo repost does not send again; explicit slots and restrictions stay separate', () => {
  const known = { id: 'known', title: 'Cigköfte Wrap für 1 €', brand: 'Rhulo', merchantUsername: 'rhulo1020',
    url: 'https://www.instagram.com/reel/Known/', description: 'Am 30.10.2026 ab 13:00 Uhr. Heinestraße 32, 1020 Wien. Solange der Vorrat reicht.',
    validOn: '2026-10-30', expirySource: 'content-date', slackTs: '1793322873.053609' };
  const next = { ...known, id: 'new', url: 'https://www.instagram.com/reel/New/', slackTs: '',
    title: 'Cigköfte Roll um 1 €', description: 'Am 30.10.2026 bei Rhulo, Heinestraße 32, 1020 Wien, solange der Vorrat reicht.' };
  const baseline = structuredClone(known);
  const keys = loadQueuedDealDuplicateKeys([known]);
  assert.equal(filterAlreadyQueuedDeals([next], keys).removed, 1);
  for (const changed of [
    { description: next.description + ' Ab 17:00 Uhr.' },
    { description: next.description + ' Nur im Kostüm.' },
    { description: next.description.replace('32', '33') },
    { validOn: '2026-10-31' }, { title: 'Cigköfte Roll um 2 €' }, { merchantUsername: 'othermerchant', brand: 'Other' },
    { expiryEstimated: true },
  ]) assert.equal(filterAlreadyQueuedDeals([{ ...next, ...changed }], keys).removed, 0, JSON.stringify(changed));
  assert.deepEqual(known, baseline, 'historical Slack card never rewritten');
  assert.equal(filterAlreadyQueuedDeals([next], loadQueuedDealDuplicateKeys([{ ...known, slackTs: '' }])).removed, 0, 'unsent candidate is not evidence of delivery');
  assert.equal(extractViennaLocation('hlagbar um 1€ (Werbung / Einladung) Rhulo Heinestraße 32 1020 Wien'), '1020 Wien');
});
