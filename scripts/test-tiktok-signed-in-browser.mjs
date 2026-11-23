import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { buildDealFromPost, extractTikTokPostData } from '../scraper/tiktok-deals-scanner.js';
import { collectTikTokBrowserEvidence, detectSignedInTikTok } from '../scraper/tiktok-signed-in-browser.js';

const ORIGIN = 'https://www.tiktok.com';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const PROFILE = '<nav><a href="/@signed-in-user">Profil</a></nav>';
const SEARCH_UI = '<input type="search" aria-label="Suchen" onclick="this.nextElementSibling.hidden = false">'
  + '<form action="/search" method="GET" hidden><input type="text" role="combobox" name="q"></form>';
const options = { keywords: ['wien kaffee'], now: NOW, settleMs: 0, timeoutMs: 2_000 };
const id = index => String(1_234_567_890 + index);
const path = index => '/@cafe.fixture/video/' + id(index);
const card = index => `<a href="${path(index)}?ignored=1">Cafe item</a>`;
const item = (index, overrides = {}) => ({
  id: id(index), author: { uniqueId: 'cafe.fixture', privateAccount: false },
  desc: 'Gratis Kaffee beim Testcafé, 1070 Wien.', createTime: 1795352400,
  privateItem: false, ...overrides,
});
const original = entry => '<main>Originalpost</main><script type="application/json" id="__UNIVERSAL_DATA_FOR_REHYDRATION__">'
  + JSON.stringify({ __DEFAULT_SCOPE__: {
    'webapp.video-detail': { statusCode: 0, itemInfo: { itemStruct: entry } },
    'recommendations': [{ id: 'unrelated', createTime: 1795698000, desc: 'irrelevant' }],
  } }) + '</script>';

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
});
after(async () => browser?.close());

async function fixture(t, handlers, run) {
  // Offline mode and DNS blocking also cover a URL after an intercepted redirect.
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
  try {
    const calls = [];
    const spacing = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      calls.push(url.pathname);
      const resolver = handlers[url.pathname] || (url.pathname === '/foryou' ? PROFILE + SEARCH_UI : null);
      if (!resolver) return route.abort();
      const answer = typeof resolver === 'function' ? await resolver(url) : resolver;
      const body = typeof answer === 'string' && url.pathname === '/search' ? answer + SEARCH_UI : answer;
      return route.fulfill(typeof body === 'string' ? { contentType: 'text/html; charset=utf-8', body } : body);
    });
    const page = await context.newPage();
    t.mock.method(page, 'waitForTimeout', async ms => { spacing.push(ms); });
    await run(page, calls, spacing);
  } finally { await context.close(); }
}

test('signed-in status requires visible TikTok account navigation', async t => {
  await fixture(t, {
    '/foryou': '<div><h2><a data-e2e="nav-profile" href="/@signed-in-user">Profil</a></h2></div>'
      + '<input type="search" aria-label="Suchen">',
    '/other': '<main><a href="/@creator">Profil</a></main>',
    '/login': PROFILE + '<h1>Bei TikTok anmelden</h1>',
    '/partial': PROFILE + '<nav><button>Anmelden</button></nav>',
  }, async page => {
    for (const [target, expected] of Object.entries({ '/foryou': true, '/other': false, '/login': false, '/partial': false })) {
      await page.goto(ORIGIN + target);
      assert.equal(await detectSignedInTikTok(page), expected);
    }
  });
});

test('reads only exact visible originals with explicitly public video metadata', async t => {
  const html = PROFILE + '<main>' + card(1) + card(1)
    + `<a href="${path(5)}" hidden>Hidden</a>`
    + '<a href="https://example.invalid/@cafe.fixture/video/1234567898">Foreign</a>'
    + card(2) + card(3) + card(4) + '</main><nav>' + card(6) + '</nav>';
  await fixture(t, {
    '/search': html, [path(1)]: original(item(1)), [path(2)]: original(item(2, { followersOnly: true })),
    [path(3)]: original(item(4)),
  }, async (page, calls, spacing) => {
    const r = await collectTikTokBrowserEvidence(page, { ...options, keywords: ['wien kaffee', 'wien döner'] });
    assert.deepEqual(calls, ['/foryou', '/search', path(1), path(2), path(3)]);
    assert.equal(r.queryCount, 1);
    assert.equal(r.videoCount, 3);
    assert.equal(r.stop, null);
    assert.deepEqual(r.posts, [{
      url: ORIGIN + path(1), caption: item(1).desc, createTime: new Date(item(1).createTime * 1000).toISOString(),
    }]);
    assert.deepEqual(r.errors.map(error => error.reason), ['public-original-unverified', 'public-original-unverified']);
    assert.deepEqual(spacing, [1500, 1500, 1500, 1500]);
  });
});

test('missing public marker, private author and conflicting private data are held', async t => {
  const samePostPrivate = '<script type="application/json" id="SIGI_STATE">' +
    JSON.stringify({ ItemModule: { [id(3)]: item(3, { privateItem: true }) } }) + '</script>';
  await fixture(t, {
    '/search': PROFILE + '<main>' + [1, 2, 3].map(card).join('') + '</main>',
    [path(1)]: original(item(1, { privateItem: undefined })),
    [path(2)]: original(item(2, { author: { uniqueId: 'cafe.fixture', privateAccount: true } })),
    [path(3)]: original(item(3)) + samePostPrivate,
  }, async page => {
    const r = await collectTikTokBrowserEvidence(page, options);
    assert.equal(r.videoCount, 3);
    assert.equal(r.posts.length, 0);
    assert.equal(r.errors.length, 3);
  });
});

test('saved cooldown produces no browser operations and native provider refusal stops immediately', async t => {
  const later = new Date(+NOW + 48 * 3600000).toISOString();
  const untouched = new Proxy({}, { get() { assert.fail('active cooldown touched browser'); } });
  const deferred = await collectTikTokBrowserEvidence(untouched, { ...options, nextRetryAt: later });
  assert.equal(deferred.queryCount, 0);
  assert.equal(deferred.videoCount, 0);
  assert.equal(deferred.stop.nextRetryAt, later);

  await fixture(t, {
    '/search': PROFILE + '<main>' + card(1) + '</main><script>'
      + 'fetch("/api/search/general/full/?keyword=wien%20kaffee").catch(() => {});</script>',
    '/api/search/general/full/': { status: 429, headers: { 'Retry-After': '172800' }, body: 'wait' },
  }, async (page, calls) => {
    const r = await collectTikTokBrowserEvidence(page, { ...options, settleMs: 100 });
    assert.deepEqual(calls, ['/foryou', '/search', '/api/search/general/full/']);
    assert.equal(r.queryCount, 1);
    assert.equal(r.videoCount, 0);
    assert.equal(r.stop.reason, 'search-response-refused');
    assert.equal(r.stop.status, 429);
    assert.equal(r.stop.retryAfter, later);
    assert.equal(r.stop.nextRetryAt, later);
  });
});

test('a late challenge suppresses links from the same search page', async t => {
  await fixture(t, {
    '/search': PROFILE + '<main></main><script>setTimeout(() => {'
      + 'document.title = "Verify to continue"; document.querySelector("main").innerHTML = '
      + JSON.stringify(card(1)) + ';}, 80)</script>',
  }, async (page, calls) => {
    const r = await collectTikTokBrowserEvidence(page, options);
    assert.deepEqual(calls, ['/foryou', '/search']);
    assert.equal(r.videoCount, 0);
    assert.equal(r.stop.reason, 'access-challenge');
  });
});

test('the search form document keeps a provider-supplied Retry-After', async t => {
  await fixture(t, {
    '/search': { status: 403, headers: { 'Retry-After': '259200' }, body: 'wait' },
  }, async (page, calls) => {
    const r = await collectTikTokBrowserEvidence(page, options);
    assert.deepEqual(calls, ['/foryou', '/search']);
    assert.equal(r.videoCount, 0);
    assert.equal(r.stop.reason, 'document-http-error');
    assert.equal(r.stop.status, 403);
    assert.equal(r.stop.nextRetryAt, new Date(+NOW + 72 * 3600000).toISOString());
  });
});

test('query limits cannot exceed eight and original visits cannot exceed twenty', async t => {
  const fixtures = { '/search': url => PROFILE + (url.searchParams.get('q') === 'go'
    ? '<main>' + Array.from({ length: 24 }, (_, index) => card(index)).join('') + '</main>'
    : '<main>Keine Ergebnisse gefunden</main>') };
  for (let index = 0; index < 24; index++) fixtures[path(index)] = original(item(index));
  await fixture(t, fixtures, async (page, calls) => {
    const before = Array.from({ length: 7 }, (_, index) => 'empty ' + index);
    const r = await collectTikTokBrowserEvidence(page, {
      ...options, keywords: [...before, 'go', 'never sent'], maxQueries: 99, maxPosts: 50,
    });
    assert.equal(r.queryCount, 8);
    assert.equal(r.videoCount, 20);
    assert.equal(r.posts.length, 20);
    assert.equal(calls.length, 29);
  });
});

test('scheduled keywords share original visits without repeating a video', async t => {
  const fixtures = {
    '/search': url => PROFILE + '<main>' + (url.searchParams.get('q') === 'coffee'
      ? [1, 2, 3].map(card).join('') : [1, 4, 5].map(card).join('')) + '</main>',
  };
  for (let index = 1; index <= 5; index++) fixtures[path(index)] = original(item(index));
  await fixture(t, fixtures, async (page, calls) => {
    const r = await collectTikTokBrowserEvidence(page, { ...options, keywords: ['coffee', 'kebap'], maxQueries: 2 });
    assert.deepEqual(calls.slice(0, 3), ['/foryou', '/search', '/search']);
    assert.equal(r.queryCount, 2);
    assert.equal(r.videoCount, 3);
    assert.ok(r.posts.some(post => post.url === ORIGIN + path(4)));
    assert.equal(new Set(r.posts.map(post => post.url)).size, 3);
  });
});

test('waits for the observed account marker before clicking the normal search box', async t => {
  const lateMarker = '<script>setTimeout(() => document.body.insertAdjacentHTML("beforeend", '
    + JSON.stringify('<div><h2><a data-e2e="nav-profile" href="/@signed-in-user">Profil</a></h2></div>') + '), 100)</script>';
  await fixture(t, {
    '/foryou': SEARCH_UI + lateMarker,
    '/search': PROFILE + '<main>' + card(1) + '</main>',
    [path(1)]: original(item(1)),
  }, async (page, calls) => {
    const r = await collectTikTokBrowserEvidence(page, options);
    assert.deepEqual(calls, ['/foryou', '/search', path(1)]);
    assert.equal(r.queryCount, 1);
    assert.equal(r.posts.length, 1);
  });
});

test('a later rewritten query preserves earlier exact search results only', async t => {
  await fixture(t, {
    '/search': url => PROFILE + (url.searchParams.get('q') === 'coffee'
      ? '<main>' + card(1) + '</main>'
      : '<main>' + card(2) + '</main><script>history.replaceState({}, "", "/search?q=rewritten")</script>'),
    [path(1)]: original(item(1)),
    [path(2)]: original(item(2)),
  }, async (page, calls) => {
    const r = await collectTikTokBrowserEvidence(page, { ...options, keywords: ['coffee', 'kebap'], maxQueries: 2 });
    assert.deepEqual(calls, ['/foryou', '/search', '/search', path(1)]);
    assert.equal(r.stop, null);
    assert.deepEqual(r.errors.map(error => error.reason), ['search-page-mismatch']);
    assert.deepEqual(r.posts.map(post => post.url), [ORIGIN + path(1)]);
  });
});

test('the scheduled scanner reads caption, date, place and media only from the exact original', async t => {
  const fresh = Math.floor(+NOW / 1000) - 3600;
  const stale = fresh - 12 * 86400;
  const valid = item(1, { createTime: fresh, video: { cover: 'https://media.invalid/exact.jpg' } });
  const noise = '<aside>Kommentare: Gratis Donut in 1010 Wien! <time datetime="' + NOW.toISOString()
    + '">heute</time></aside><script type="application/json">' + JSON.stringify({ createTime: fresh }) + '</script>';
  const sigi = '<script type="application/json" id="SIGI_STATE">' + JSON.stringify({
    ItemModule: { [id(6)]: { ...valid, id: id(6), author: 'cafe.fixture', createTime: String(fresh) } },
  }) + '</script>';
  await fixture(t, {
    [path(1)]: original(valid) + noise,
    [path(2)]: original(item(2, { createTime: stale })) + noise,
    [path(3)]: original(item(3, { createTime: undefined })) + noise,
    [path(4)]: original(item(4, { createTime: fresh, desc: 'Gratis Kaffee beim Testcafé!' })) + noise,
    [path(5)]: original(item(5, { createTime: fresh, desc: '' })) + noise,
    [path(6)]: sigi + noise,
  }, async (page, calls) => {
    async function read(index) {
      const url = ORIGIN + path(index);
      const data = await extractTikTokPostData(page, url);
      return { data, ...buildDealFromPost(url, data, { now: NOW }) };
    }
    const good = await read(1);
    assert.equal(good.data.description, valid.desc);
    assert.equal(good.data.thumbnailUrl, valid.video.cover);
    assert.equal(good.data.timeDateTime, new Date(fresh * 1000).toISOString());
    assert.ok(good.deal, good.reason);
    assert.match((await read(2)).reason, /älter/);
    assert.match((await read(3)).reason, /kein echtes TikTok-Post-Datum/);
    assert.match((await read(4)).reason, /kein eindeutiges Wien/);
    assert.equal((await read(5)).deal, null);
    assert.ok((await read(6)).deal);
    assert.deepEqual(calls, [1, 2, 3, 4, 5, 6].map(path));
  });
});

test('exact public VideoObject and canonical page metadata remain usable when embedded item data are absent', async t => {
  const caption = item(1).desc;
  const published = '2026-11-22T10:30:00.000Z';
  const ld = record => '<script type="application/ld+json">' + JSON.stringify({ '@graph': record }) + '</script>';
  const video = index => ({ '@type': 'VideoObject', url: ORIGIN + path(index), description: caption,
    uploadDate: published, thumbnailUrl: ['https://media.invalid/original.jpg'] });
  const tag = (key, value) => '<meta property="' + key + '" content="' + value + '">';
  const head = index => '<head>' + tag('og:url', ORIGIN + path(index)) + tag('og:description', caption)
    + tag('article:published_time', published) + tag('og:image', 'https://media.invalid/og.jpg') + '</head>';
  await fixture(t, {
    [path(1)]: ld([video(3), video(1)]),
    [path(2)]: head(2),
    [path(3)]: head(2) + ld([video(1)]),
    [path(4)]: head(4) + original(item(4, { privateItem: true })),
    [path(5)]: head(5) + original(item(5, { privateItem: undefined })),
    [path(6)]: head(6) + original(item(7)),
    [path(7)]: head(7) + original(item(7, { createTime: undefined })),
    [path(8)]: head(8) + original(item(8, { desc: '' })),
    [path(9)]: head(9).replace('article:published_time', 'article:modified_time'),
    [path(10)]: head(10) + '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">malformed</script>',
    [path(11)]: { status: 403, contentType: 'text/html', body: head(11) },
    [path(12)]: { status: 200, headers: { 'retry-after': '86400' }, contentType: 'text/html', body: head(12) },
    [path(13)]: head(13) + ld([{ ...video(13), isAccessibleForFree: false }]),
  }, async page => {
    for (const [index, image] of [[1, 'original'], [2, 'og']]) {
      const url = ORIGIN + path(index);
      const data = await extractTikTokPostData(page, url);
      assert.equal(data.description, caption);
      assert.equal(data.thumbnailUrl, 'https://media.invalid/' + image + '.jpg');
      assert.ok(buildDealFromPost(url, data, { now: NOW }).deal);
    }
    for (const index of [3, 4, 5, 6, 7, 8, 9, 10, 13]) {
      const url = ORIGIN + path(index);
      assert.equal(buildDealFromPost(url, await extractTikTokPostData(page, url), { now: NOW }).deal, null);
    }
    const refused = await extractTikTokPostData(page, ORIGIN + path(11));
    assert.equal(refused.accessRefusal.status, 403);
    const backoff = await extractTikTokPostData(page, ORIGIN + path(12));
    assert.equal(backoff.accessRefusal.retryAfter, '86400');
  });
});
