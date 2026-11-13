import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstagramWebAccess } from '../scraper/instagram-web-access-policy.js';
import { openInstagramDailyPage } from '../scraper/instagram-daily-sync.js';
import { discoveryAvailability } from '../scraper/discovery-availability.js';
import { discoveryRejection } from '../scraper/deal-discovery-policy.js';
import { isUnsafeSocialFoodReviewContent } from '../scraper/social-food-audit-utils.js';
import { buildConfig, normalizeGraphMediaItem, retainMetaOutbox } from '../scraper/meta-instagram-deals.js';

const now = new Date('2026-11-13T08:45:00Z');
const until = '2026-11-18T20:10:00.000Z';
const url = 'https://www.instagram.com/fixture_merchant/';
const fakePage = ({ status = 200, finalUrl = url, html = '<main><a href="/accounts/login/">Anmelden</a></main>' } = {}) => {
  const visits = [];
  return {
    visits,
    async goto(target) {
      visits.push(target);
      return { status: () => status, ok: () => status === 200, headers: () => ({ 'retry-after': '36000' }) };
    },
    url: () => finalUrl,
    waitForTimeout: async () => {},
    content: async () => html,
  };
};

test('both Instagram runs honor the longest saved pause without navigating or extending it', async () => {
  const saved = { webAccess: { all: { nextRetryAt: until, reason: 'http-403' } } };
  const other = { webAccess: { all: { nextRetryAt: '2026-11-14T01:00:00.000Z', reason: 'login-wall' } } };
  for (const [previousReport, relatedReport] of [[saved, other], [other, saved]]) {
    const access = createInstagramWebAccess({ previousReport, relatedReport, now });
    const page = fakePage();
    assert.equal(await openInstagramDailyPage(page, url, access), 'paused');
    assert.deepEqual(page.visits, []);
    assert.equal(access.pause('profiles').nextRetryAt, until);
  }
  const recovered = createInstagramWebAccess({ relatedReport: saved, now: new Date('2026-11-19T00:00:00Z') });
  assert.equal(recovered.pause('profiles'), null);
  assert.deepEqual(recovered.snapshot(), {});
});

test('Instagram stops on rate limit, login redirect or blocking form, not on a navigation link', async () => {
  for (const [options, reason] of [
    [{ status: 429 }, 'http-429'],
    [{ status: 404, finalUrl: 'https://www.instagram.com/accounts/login/' }, 'login-wall'],
    [{ html: '<form><input type="password"></form>' }, 'login-wall'],
  ]) {
    const access = createInstagramWebAccess({ now });
    const page = fakePage(options);
    assert.equal(await openInstagramDailyPage(page, url, access), 'blocked');
    assert.equal(access.pause('all').reason, reason);
    if (reason === 'http-429') assert.equal(access.pause().nextRetryAt, '2026-11-13T18:45:00.000Z');
    assert.equal(await openInstagramDailyPage(page, url, access), 'paused');
    assert.deepEqual(page.visits, [url]);
  }
  const access = createInstagramWebAccess({ now });
  assert.equal(await openInstagramDailyPage(fakePage(), url, access), 'readable');
  assert.equal(await openInstagramDailyPage(fakePage({ status: 404 }), url, access), 'unavailable');
  assert.equal(await openInstagramDailyPage(fakePage({ finalUrl: 'https://www.instagram.com/' }), url, access), 'unavailable');
  assert.equal(access.pause(), null);
});

test('expired TikTok pause with no later observation is not a new access failure or recovery', () => {
  const previous = { lastUpdated: '2026-11-12T22:43:00Z', apiDiscovery: {
    stoppedReason: 'saved-cooldown', attemptedRequests: 0, nextRetryAt: '2026-11-12T23:28:00Z',
  } };
  const lane = (report, at) => discoveryAvailability({}, report, at).lanes.find(value => value.name === 'tiktok-public-search');
  assert.equal(lane(previous, new Date('2026-11-12T23:00:00Z')).status, 'paused');
  assert.equal(lane(previous, now).status, 'awaiting-post-cooldown-run');
  assert.equal(lane({ ...previous, lastUpdated: now.toISOString() }, now).status, 'recovery-not-yet-proven');
  assert.equal(lane(previous, now).deliveredToSlack, null);
});

const backwerk = 'Dein Donut geht auf uns! Jetzt bekommst du beim Kauf eines Heißgetränks in Größe Large einen Schoggi Donut gratis dazu. Der Deal gilt vom 10. bis einschließlich 29. November bei BackWerk.';
const directory = "Heute ausg'steckt in Wien (Grinzing)! Alle Aussteckzeiten in ganz Österreich: Link im Profil heurigen.at – auch in unserer Gratis-App.";
const ownPost = '3 Baguettes kaufen, das 4. gratis! Bei Bäckerei Schwarz in Wien. Mehr Wiener Angebote in FreeFinder: https://freefinder.at/app/ Eigenwerbung für FreeFinder.';
const freshMenu = 'Auf dem Bild: Avocado Tofu Bowl – ein Einblick in unser Bowl-Angebot. Zusätzlich unsere Tagesgerichte am 12.11. in Wien: Exotic Taj mit Basmatireis und Pumpkin Pot. Alser Straße 21, 1080 Wien.';
const config = buildConfig({}, now);
const graph = (caption, fields = {}, context = {}) => normalizeGraphMediaItem({
  caption, id: 'fixture', permalink: 'https://www.instagram.com/p/FIXTURE01/',
  timestamp: '2026-11-13T07:00:00Z', ...fields,
}, context, config, now);

test('German BackWerk round and OCR numbers cannot acquire a Vienna location', () => {
  assert.equal(graph(backwerk, { _mediaEvidence: { ocrText: '1010 1100 1200' } }).rejection, 'missing-vienna-evidence');
  const context = { account: { username: 'meinbackwerk', verifiedVienna: true } };
  assert.equal(graph(backwerk, { name: 'BackWerk Deutschland', username: 'meinbackwerk' }, context).rejection, 'non-vienna-location');
  assert.ok(graph(`${backwerk} Auch in Wien.`, { name: 'BackWerk Deutschland', username: 'meinbackwerk' }, context).deal);
  assert.ok(graph('Heute 1+1 Burger gratis!', { _mediaEvidence: { ocrText: 'Testgasse 1, 1070 Wien' } }).deal);
  assert.equal(graph('Heute 1+1 Burger gratis!', { _mediaEvidence: { ocrText: 'Beliebiger Text', ai: {
    confidence: 0.99, isDeal: true, exclusion: 'none', offerText: '1+1 Burger gratis', locationText: '1070 Wien',
  } } }).rejection, 'missing-vienna-evidence');
  assert.ok(graph('Unser Wochenplan', { _mediaEvidence: { visionImageCount: 1, ai: {
    confidence: 0.99, isDeal: true, exclusion: 'none', offerText: '1+1 Burger gratis', locationText: 'Testgasse 1, 1070 Wien',
  } } }).deal);
});

test('directory and own clips are excluded even with tempting OCR or stale outbox flags', () => {
  assert.equal(graph(directory, { _mediaEvidence: { ocrText: 'Gratis Kaffee in 1190 Wien' } }).rejection, 'non-offer-content');
  assert.equal(graph(ownPost).rejection, 'self-syndicated-deal');
  assert.equal(isUnsafeSocialFoodReviewContent(directory), true);
  assert.equal(isUnsafeSocialFoodReviewContent(ownPost), true);
  assert.equal(isUnsafeSocialFoodReviewContent(freshMenu), true);
  assert.equal(graph(freshMenu).rejection, 'non-offer-content');
  assert.equal(discoveryRejection(`${freshMenu} Heute 20 % Rabatt auf die Bowl.`), '');
  assert.equal(discoveryRejection(`${directory} Heute gibt es bei uns gratis Kaffee zum Frühstück.`), '');
  assert.equal(discoveryRejection('Heute 1+1 Pizza gratis in Wien. Quelle: FreeFinder.'), '');
  const [backwerkRow, directoryRow, ownRow, good] = [
    { brand: 'BackWerk Deutschland', description: backwerk, city: 'Wien', viennaVerified: true },
    { description: directory },
    { description: ownPost },
    { description: 'Heute 1+1 Burger gratis in 1070 Wien.' },
  ].map((deal, index) => ({ id: `meta-ig-${index}`, sourcePublishedAt: '2026-11-13T07:00:00Z', ...deal }));
  assert.deepEqual(retainMetaOutbox([], [backwerkRow, directoryRow, ownRow, good], now), [good]);
});
