import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { inspectTikTokPublicForm, priorTikTokFormPause } from '../scraper/tiktok-public-form.js';

const origin = 'https://www.tiktok.com';
const input = '<form action="/search"><input type="search" name="q" aria-label="Suchen"></form>';
const control = '<button role="searchbox" aria-label="Suchen" onclick="this.nextElementSibling.hidden=false">Suchen</button>'
  + '<form hidden action="/search"><input role="combobox" name="q"></form>';
const link = '<a href="/@public.cafe/video/1234567890?tracking=x">Original</a>';
const reply = body => ({ contentType: 'text/html', body });

async function fixture(home, search, check) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const paths = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      paths.push(url.pathname + url.search);
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/') return route.fulfill(home);
      if (url.pathname === '/search') return route.fulfill(search);
      return route.abort();
    });
    const page = await context.newPage();
    await check(await inspectTikTokPublicForm(page, { controlsMs: 800, resultsMs: 950 }), paths);
  } finally { await browser.close(); }
}

test('one visible search submission accepts only new public links from the result region', async () => {
  const noise = '<a hidden href="/@hidden.cafe/video/4567890123">hidden</a>'
    + '<a href="https://example.invalid/@other.cafe/video/5678901234">external</a>'
    + '<nav><a href="/@menu.cafe/video/7654321098">navigation</a></nav>'
    + '<a href="http://[invalid">bad URL</a>';
  const homeFeed = '<a href="/@home.cafe/video/2345678901">home</a>';
  await fixture(reply(control + '<main>' + homeFeed + '</main>'),
    reply('<main>' + noise + homeFeed + link + link + '</main>'), (report, paths) => {
      assert.equal(report.outcome, 'visible-results');
      assert.equal(report.openerClicked, true);
      assert.equal(report.submissions, 1);
      assert.deepEqual(paths, ['/', '/search?q=wien+essen']);
      assert.deepEqual(report.publicVideoLinks, [origin + '/@public.cafe/video/1234567890']);
    });
});

test('a search form only on the correct route can produce a confirmed empty result', async () => {
  for (const [page, expected] of [
    ['<main><progress></progress></main><script>setTimeout(()=>document.querySelector("main").textContent="Keine Ergebnisse gefunden",300)</script>', 'visible-no-results'],
    ['<main></main>', 'search-results-unverified'],
    ['<main>' + link + '</main><script>history.replaceState(null,"","/search?q=wien+essen&q=other")</script>', 'search-page-not-reached'],
    ['<main>' + link + '<div role="dialog">Log in to TikTok</div></main>', 'login-dialog'],
  ]) {
    await fixture(reply(input), reply(page), (report, paths) => {
      assert.equal(report.outcome, expected);
      assert.equal(report.openerClicked, false);
      assert.equal(report.submissions, 1);
      assert.equal(paths.length, 2);
      assert.deepEqual(report.publicVideoLinks, []);
    });
  }
});

test('a public homepage wall, restriction or missing form makes zero submissions', async () => {
  for (const [home, expected] of [
    [reply('<div role="dialog">Cookies zulassen?</div>' + input), 'consent-dialog'],
    [reply('<main>Verify you are human</main>' + input), 'access-challenge'],
    [reply('<div role="dialog">Log in</div>' + input), 'login-dialog'],
    [{ status: 429, headers: { 'Retry-After': '120' }, body: input }, 'document-refusal'],
    [reply('<main>' + link + '</main>'), 'public-search-controls-unavailable'],
  ]) {
    await fixture(home, reply('<main>' + link + '</main>'), (report, paths) => {
      assert.equal(report.outcome, expected);
      assert.equal(report.submissions, 0);
      assert.deepEqual(report.publicVideoLinks, []);
      assert.deepEqual(paths, ['/']);
    });
  }
});

test('only the unclassified direct-scanner backoff is independent of the public form', () => {
  const now = Date.now();
  const nextRetryAt = new Date(now + 3600000).toISOString();
  const lastFailure = { code: 'provider-error', status: 200, providerSignal: 'unclassified', retryAfterProvided: false };
  const apiDiscovery = { nextRetryAt, lastFailure };
  const check = report => priorTikTokFormPause(report, now);
  assert.equal(check({ apiDiscovery }), null);
  for (const change of [{ status: 403 }, { retryAfterProvided: true }, { providerSignal: 'verification' }]) {
    assert.equal(check({ apiDiscovery: { ...apiDiscovery, lastFailure: { ...lastFailure, ...change } } }), nextRetryAt);
  }
  assert.equal(check({ apiDiscovery: { nextRetryAt } }), nextRetryAt);
  assert.equal(check({ apiDiscovery, searchDiscovery: { postVisitStop: { retryAt: nextRetryAt } } }), nextRetryAt);
});
