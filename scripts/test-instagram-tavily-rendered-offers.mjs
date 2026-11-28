import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RENDER_TARGETS, renderedTargetsFromDirectReport, verifyRenderedInstagramTavilyOffers,
} from './check-instagram-tavily-rendered-offers.mjs';

const [first, second] = RENDER_TARGETS;
const now = new Date();
const date = new Date(+now - 40 * 60_000).toISOString();
const end = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric',
  timeZone: 'Europe/Vienna' }).format(new Date(+now + 2 * 86_400_000));
const caption = 'Café Morgenrot in 1070 Wien: Zweiter Kaffee gratis beim Kauf eines großen Cappuccinos. '
  + 'Gültig bis ' + end + '. Nur vor Ort am Neubaugasse 55, keine Lieferung.';
const receipt = { sourceReads: 4, verifiedNewOffers: 0, modelCalls: 0, publishedDeals: 0,
  rows: RENDER_TARGETS.map(url => ({ url, status: 'unverified', httpStatus: 200, reason: 'original-identity-unproven' })) };
const cookies = [{ name: 'sessionid', value: 'offline-fixture-not-a-secret', domain: '.instagram.com' }];

function fixture({ preview = () => ({}), linkedDate = () => date, documentFor = () => ({}), setupFails = false } = {}) {
  const navigated = [], dateReads = [];
  let launches = 0, closedPages = 0, contextClosed = 0;
  const context = {
    async addCookies(fields) {
      assert.equal(fields[0].value, cookies[0].value);
      if (setupFails) throw new Error('offline fixture cookie refusal');
    },
    async newPage() {
      let locationUrl = '';
      return {
        setUrl(value) { locationUrl = value; },
        url: () => locationUrl,
        async close() { closedPages++; },
        async evaluate(extract, options) {
          const settings = documentFor(locationUrl);
          const exactArticle = { innerText: settings.articleText || '' };
          const time = { checkVisibility: () => true,
            closest: selector => selector === 'a[href]' ? { href: locationUrl } : exactArticle };
          const previous = { document: globalThis.document, location: globalThis.location };
          globalThis.location = { href: locationUrl };
          globalThis.document = {
            querySelector(selector) {
              const values = {
                'meta[property="og:url"]': settings.og === undefined ? locationUrl : settings.og,
                'meta[property="og:description"]': settings.caption ?? caption,
                'link[rel="canonical"]': settings.canonical,
              };
              return values[selector] ? { getAttribute: () => values[selector] } : null;
            },
            querySelectorAll: () => [time],
          };
          try { return extract(options); }
          finally { Object.assign(globalThis, previous); }
        },
      };
    },
    async close() { contextClosed++; },
  };
  const browserType = { async launch(options) {
    launches++;
    assert.deepEqual(options, { headless: true });
    return {
      async newContext(config) {
        assert.deepEqual(config, { viewport: { width: 1366, height: 900 }, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
        return context;
      },
      async close() {},
    };
  } };
  const run = overrides => verifyRenderedInstagramTavilyOffers({
    directReport: receipt, now, clock: () => now, cookies, browserType,
    async fetchRendered(page, url) {
      navigated.push(url);
      const result = { status: 200, finalUrl: url, title: 'Café Morgenrot auf Instagram',
        pubDate: new Date(+now - 10 * 60_000).toISOString(), ...preview(url) };
      page.setUrl(result.finalUrl);
      return result;
    },
    async readLinkedDate(_page, url) {
      dateReads.push(url);
      return linkedDate(url);
    },
    ...overrides,
  });
  return { run, navigated, dateReads, get launches() { return launches; },
    get closedPages() { return closedPages; }, get contextClosed() { return contextClosed; } };
}

test('render verification accepts only the exact two previously unverified saved targets', () => {
  assert.deepEqual(renderedTargetsFromDirectReport(receipt), RENDER_TARGETS);
  assert.throws(() => renderedTargetsFromDirectReport({ ...receipt, sourceReads: 5 }), /four-read/);
  assert.throws(() => renderedTargetsFromDirectReport({ ...receipt, rows: [{ ...receipt.rows[0], reason: 'http-429' }, receipt.rows[1]] }), /exact unresolved/);
  assert.throws(() => renderedTargetsFromDirectReport({ ...receipt, rows: [{ ...receipt.rows[0], httpStatus: 403 }, receipt.rows[1]] }), /exact unresolved/);
  assert.throws(() => renderedTargetsFromDirectReport({ ...receipt, rows: [...receipt.rows, receipt.rows[1]] }), /exact unresolved/);
});

test('same-document alias identity and linked clock verify the offer without HTML hint dates', async () => {
  const mock = fixture({
    linkedDate: url => url === first ? date : '',
    documentFor: url => ({ og: url.replace('www.instagram.com/reel/', 'm.instagram.com/morgencafe/reels/'),
      canonical: url, caption: '12 likes, 3 comments - morgencafe on November 25: "' + caption + '"' }),
  });
  const result = await mock.run();
  assert.deepEqual(mock.navigated, RENDER_TARGETS);
  assert.deepEqual(mock.dateReads, RENDER_TARGETS);
  assert.equal(mock.closedPages, 2);
  assert.equal(mock.contextClosed, 1);
  assert.equal(result.report.browserNavigations, 2);
  assert.equal(result.report.verifiedNewOffers, 1, JSON.stringify(result.report));
  assert.equal(result.report.rows[1].reason, 'rendered-bound-publication-unproven');
  assert.equal(result.report.tavilySearches, 0);
  assert.equal(result.report.modelCalls, 0);
  assert.equal(result.report.publishedDeals, 0);
  assert.equal(result.candidates[0].sourcePublishedAt, date);
  assert.equal(result.candidates[0].sourcePublishedAtSource, 'instagram-rendered-time-datetime');
  assert.equal(result.candidates[0].caption, caption);
  assert(!JSON.stringify(result).includes(cookies[0].value));
});

test('foreign identity, unbound caption, truncated caption and impossible date cannot verify', async () => {
  for (const [settings, dateValue, reason] of [
    [{ canonical: second }, date, 'rendered-complete-caption-unproven'],
    [{ og: null, articleText: 'A different original, with another caption elsewhere on the page.' }, date, 'rendered-complete-caption-unproven'],
    [{ caption: caption + '…' }, date, 'rendered-complete-caption-unproven'],
    [{ caption: '314 likes, 10 comments - satansbratan am November 25, 2026' }, date, 'open-graph-header-only'],
    [{}, '2026-02-30T12:00:00Z', 'rendered-bound-publication-unproven'],
  ]) {
    const mock = fixture({ documentFor: () => settings, linkedDate: () => dateValue });
    const result = await mock.run({ inventory: { indexed: [{ url: second }] } });
    assert.equal(result.report.rows[0].reason, reason);
    assert.equal(result.report.verifiedNewOffers, 0);
    assert.deepEqual(mock.navigated, [first]);
  }
});

test('a different final URL is never evaluated or followed by an additional attempt to that original', async () => {
  const mock = fixture({ preview: () => ({ finalUrl: 'https://www.instagram.com/reel/FakeAnother/' }) });
  const result = await mock.run();
  assert.deepEqual(mock.navigated, RENDER_TARGETS);
  assert.deepEqual(mock.dateReads, []);
  assert(result.report.rows.every(row => row.reason === 'rendered-original-identity-unproven'));
});

test('real 429 and login redirect stop further navigation and retain the shared hold', async () => {
  for (const [status, extras, reason, seconds] of [
    [429, { retryAfter: '200000' }, 'http-429', 200000],
    [302, { loginWall: true }, 'login-wall', 6 * 3600],
  ]) {
    const mock = fixture({ preview: () => ({ status, ...extras }) });
    const result = await mock.run();
    assert.deepEqual(mock.navigated, [first]);
    assert.equal(result.report.rows[0].httpStatus, status);
    assert.equal(result.report.rows[0].reason, reason);
    assert.equal(result.report.rows[1].reason, 'web-access-cooldown');
    assert.equal(result.webAccessChanges.all.nextRetryAt, new Date(+now + seconds * 1000).toISOString());
  }
});

test('cookie setup failure, unavailable session and existing holds cannot produce browser navigation', async () => {
  const failing = fixture({ setupFails: true });
  const failure = await failing.run();
  assert.equal(failing.launches, 1);
  assert.deepEqual(failing.navigated, []);
  assert.equal(failure.report.sourceReads, 0);
  assert(failure.report.rows.every(row => row.reason === 'rendered-session-setup-failed'));
  assert.equal(failure.webAccessChanged, false);
  const missing = fixture();
  assert.equal((await missing.run({ cookies: [] })).report.rows[0].reason, 'ordinary-session-unavailable');
  const nextRetryAt = new Date(+now + 3600_000).toISOString();
  const paused = await missing.run({ previousReport: { webAccess: { all: { nextRetryAt, reason: 'http-403' } } } });
  assert.equal(paused.report.rows[0].reason, 'web-access-cooldown');
  assert.equal(paused.webAccessChanged, false);
  assert.equal(missing.launches, 0);
});
