import assert from 'node:assert/strict';
import test from 'node:test';
import { addPreviouslyReviewedInstagram, comparisonUrls, verifyInstagramQueryOffers } from './check-instagram-query-offers.mjs';

const runId = '12345';
const comparisons = links => ({ status: 'completed', httpStatus: 200, links });
const receipt = (links = originals) => ({
  check: 'instagram-query-improvement-20261128-v1', runId, status: 'completed',
  links, unseenLinks: links.length, comparisons: [comparisons(links)],
});
const cookies = [{ name: 'sessionid', value: 'offline-test-only', domain: '.instagram.com' }];
const now = new Date();
const date = new Date(+now - 3600_000).toISOString();
const instagramAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const originals = Array.from({ length: 8 }, (_, i) => {
  let id = (BigInt(Date.parse(date)) - 1314220021300n) * (2n ** 23n) + BigInt(i);
  let shortcode = '';
  while (id) {
    shortcode = instagramAlphabet[Number(id % 64n)] + shortcode;
    id /= 64n;
  }
  return 'https://www.instagram.com/reel/' + shortcode + '/';
});
const end = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric',
  timeZone: 'Europe/Vienna' }).format(new Date(+now + 2 * 86_400_000));
const caption = 'Café Morgenrot in 1070 Wien: Zweiter Kaffee gratis beim Kauf eines großen Cappuccinos. Gültig bis '
  + end + '. Nur vor Ort am Neubaugasse 55, keine Lieferung.';

function fixture(opts = {}) {
  const navigated = [];
  let launches = 0;
  return {
    navigated,
    get launches() { return launches; },
    run: () => verifyInstagramQueryOffers({
      receipt: receipt(), compareRunId: runId, now, clock: () => now, cookies,
      browserType: { async launch() {
        launches++;
        return {
          async newContext() { return {
            async addCookies() {},
            async newPage() { return { current: '', url() { return this.current; }, async close() {} }; },
            async close() {},
          }; },
          async close() {},
        };
      } },
      async fetchRendered(page, url) {
        navigated.push(url);
        page.current = url;
        return { status: 200, finalUrl: url, title: 'Café Morgenrot auf Instagram',
          bodyText: 'unrelated account interface', ...opts.preview?.(url) };
      },
      async readLinkedDate(_page, url) { return opts.dateFor ? opts.dateFor(url) : date; },
      async readCaption(_page, url) { return opts.captionFor ? opts.captionFor(url) : { caption }; },
      ...opts,
    }),
  };
}

test('receipt requires exact successful provenance and alternates variants before source reads', () => {
  const units = [comparisons([originals[0], originals[1], originals[2]]),
    comparisons([originals[3], originals[4]]), comparisons([originals[0], originals[5]])];
  const document = { ...receipt(originals.slice(0, 6)), comparisons: units };
  assert.deepEqual(comparisonUrls(document, runId), [originals[0], originals[3], originals[1], originals[4], originals[5], originals[2]]);
  assert.throws(() => comparisonUrls(document, '12344'), /exact query comparison/);
  assert.throws(() => comparisonUrls({ ...document, comparisons: units.slice(0, 2) }, runId), /missing from completed/);
  assert.throws(() => comparisonUrls(receipt([originals[0], originals[0].replace('/reel/', '/p/')]), runId), /unique canonical/);
});

test('raw Graph, prior capture and AI rejected rows cost zero visits; cap is four actual originals', async () => {
  const inventory = addPreviouslyReviewedInstagram({}, {
    graph: { sources: { 'account:fixture': { rows: [{ permalink: originals[0].replace('/reel/', '/p/') }] } } },
    aiReport: { terminalRejected: [{ url: originals[1] }] },
    priorRenderedFirst: { rows: [{ url: originals[2], status: 'rejected' }] },
  });
  const check = fixture({ inventory, captionFor: url => ({ caption: url === originals[3] ? caption : 'Vienna nightlife guide' }) });
  const { report, candidates } = await check.run();
  assert.deepEqual(check.navigated, originals.slice(3, 7));
  assert.equal(report.knownLinks, 3);
  assert.equal(report.rows[7].reason, 'source-read-cap');
  assert.equal(report.browserNavigations, 4);
  assert.equal(report.verifiedNewOffers, 1, JSON.stringify(report));
  assert.equal(report.rows[3].productionTextCheck.accepted, true);
  assert.equal(report.rows[3].productionTextCheck.captionEvidence, 'exact-original-caption');
  assert.equal(candidates[0].caption, caption);
  assert.equal(candidates[0].sourcePublishedAt, date);
  assert.equal(candidates[0].sourcePublishedAtSource, 'instagram-rendered-time-datetime');
  assert.equal(report.rows[4].status, 'rejected');
  assert.deepEqual(report.rows[4].sourceEvidence, { caption: 'Vienna nightlife guide',
    title: 'Café Morgenrot auf Instagram', sourcePublishedAt: date,
    sourcePublishedAtSource: 'instagram-rendered-time-datetime' });
  assert.equal(report.rows[2].sourceEvidence, undefined);
  assert.equal(report.modelCalls + report.tavilySearches + report.publishedDeals, 0);
  assert.doesNotMatch(JSON.stringify(report), /unrelated account interface|offline-test-only/);
});

test('original dates and bound readable captions are required independently from a successful search', async () => {
  const check = fixture({ receipt: receipt(originals.slice(0, 3)),
    preview: () => ({ pubDate: date, description: caption, captionEvidence: 'exact-original-caption' }),
    dateFor: url => url === originals[0] ? '' : new Date(+now - 10 * 86_400_000).toISOString(),
    captionFor: url => url === originals[2] ? { blocked: true } : { caption } });
  const { report } = await check.run();
  assert.deepEqual(report.rows.map(row => row.reason), ['rendered-bound-publication-unproven',
    'original-post-outside-freshness-window', 'rendered-complete-caption-unproven']);
  assert.equal(report.verifiedNewOffers, 0);
  assert.equal(report.rows[0].sourceEvidence, undefined);
  assert.equal(report.rows[1].sourceEvidence.caption, caption);
  assert.equal(report.rows[2].sourceEvidence, undefined);
});

test('any real provider hold stops remaining originals and carries its full deadline', async () => {
  const wait = 36_000;
  const check = fixture({ preview: () => ({ status: 429, retryAfter: String(wait) }) });
  const { report, webAccessChanges } = await check.run();
  assert.deepEqual(check.navigated, originals.slice(0, 1));
  assert.equal(report.rows[0].reason, 'http-429');
  assert.equal(webAccessChanges.all.nextRetryAt, new Date(+now + wait * 1000).toISOString());
  assert(report.rows.slice(1).every(row => row.reason === 'web-access-cooldown'));
});

test('no unseen hits or local cookie setup failure cannot trigger a provider hold or visit', async () => {
  const empty = fixture({ receipt: receipt([]) });
  assert.equal((await empty.run()).report.browserNavigations, 0);
  assert.equal(empty.launches, 0);
  const broken = fixture({ browserType: { async launch() { throw new Error('local setup failure'); } } });
  const result = await broken.run();
  assert.equal(result.report.browserNavigations, 0);
  assert.equal(result.webAccessChanged, false);
  assert.equal(result.report.rows[0].reason, 'rendered-session-setup-failed');
});
