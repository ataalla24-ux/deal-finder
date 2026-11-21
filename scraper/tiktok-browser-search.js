export async function tikTokAccessRefusal(page, document) {
  if (document && [401, 403, 429, 451].includes(document.status())) {
    return { status: document.status(), retryAfter: await document.headerValue('retry-after'), transportReason: 'document-http-error' };
  }
  const title = await page.title();
  const body = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  const finalPath = new URL(page.url()).pathname;
  const loginForm = await page.locator('form input[type="password"]').first().isVisible().catch(() => false);
  if (/^\/(?:login|signup|challenge|checkpoint)(?:\/|$)/i.test(finalPath) || loginForm) {
    return { status: 403, transportReason: 'login-wall' };
  }
  if (/verify (?:to continue|you are human)|security check|unusual traffic|too many requests|log in to search|anmelden,? um|sicherheits(?:pruefung|pr\u00fcfung)/i.test(`${title} ${body.slice(0, 1000)}`)) {
    return { status: 403, transportReason: 'access-challenge' };
  }
  return null;
}

async function visiblePublicVideoLinks(page, keyword, limit) {
  return page.evaluate(({ keyword, limit }) => {
    const current = new URL(location.href);
    if (current.origin !== 'https://www.tiktok.com' || !/^\/search\/?$/.test(current.pathname)
        || current.searchParams.get('q') !== keyword) return [];
    const links = new Set();
    for (const anchor of document.querySelectorAll('main a[href], [role="main"] a[href]')) {
      if (!anchor.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const url = new URL(anchor.href, current);
      if (url.origin !== current.origin || !/^\/@[\w.-]{2,40}\/video\/\d{8,30}\/?$/.test(url.pathname)) continue;
      links.add(`${url.origin}${url.pathname.replace(/\/$/, '')}`);
      if (links.size >= limit) break;
    }
    return [...links];
  }, { keyword, limit });
}

const publicSearchOrigin = 'https://www.tiktok.com';
const searchRoutePattern = '**/api/search/**';
const auxiliarySearchPath = /^\/api\/search\/(?:user\/preview|suggest\/guide)\/?$/;
const publicRouteShape = /^\/api\/search\/(?:general|item|user|suggest|recommend|suggest_words|suggest_guide|live|video|business|multi|aggregate)(?:\/(?:full|preview|guide|stream|list|mixed|v[1-9]\d?)){0,2}\/?$/;

function countBucket(buckets, key, limit = 12) {
  if (Object.hasOwn(buckets, key) || Object.keys(buckets).length < limit) buckets[key] = (buckets[key] || 0) + 1;
}

function countClass(value, limit) {
  if (value === null) return 'absent';
  const count = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(count)) return 'invalid';
  return count > limit ? 'over-cap' : 'within-cap';
}

function searchRequestShape(request, url, keyword, count) {
  return {
    path: url.origin === publicSearchOrigin && publicRouteShape.test(url.pathname) ? url.pathname : '[redacted]',
    origin: url.origin === publicSearchOrigin ? 'first-party' : 'other',
    method: request.method() === 'GET' ? 'GET' : 'other',
    resource: ['fetch', 'xhr'].includes(request.resourceType()) ? request.resourceType() : 'other',
    keyword: url.searchParams.get('keyword') === keyword ? 'match' : url.searchParams.has('keyword') ? 'mismatch' : 'absent',
    count: countClass(url.searchParams.get('count'), count),
  };
}

export async function observeTikTokSearchRoutes(page, keyword, { waitMs = 6000 } = {}) {
  const stats = { navigationStatus: null, refusal: null, requests: {}, forwardedSearchRequests: 0, visibleVideoLinks: 0 };
  const observe = async route => {
    const request = route.request();
    const url = new URL(request.url());
    countBucket(stats.requests, JSON.stringify(searchRequestShape(request, url, keyword, 30)));
    await route.abort();
  };
  await page.route(searchRoutePattern, observe);
  try {
    const document = await page.goto(publicSearchOrigin + '/search?q=' + encodeURIComponent(keyword), {
      waitUntil: 'domcontentloaded', timeout: 15000,
    });
    stats.navigationStatus = document?.status() || null;
    stats.refusal = await tikTokAccessRefusal(page, document);
    if (document?.ok() && !stats.refusal) {
      await page.waitForTimeout(waitMs);
      stats.refusal = await tikTokAccessRefusal(page);
      if (!stats.refusal) stats.visibleVideoLinks = (await visiblePublicVideoLinks(page, keyword, 30)).length;
    }
  } finally {
    await page.goto('about:blank').catch(() => {});
    await page.unroute(searchRoutePattern, observe);
  }
  return {
    ...stats,
    requests: Object.entries(stats.requests).map(([key, seen]) => ({ ...JSON.parse(key), seen })),
  };
}

// Let the public search page create its own requests. Signatures and credentials
// belong to the browser, and a refusal ends the scan.
export async function createTikTokBrowserSearch(page, { pages = 3, count = 30, timeoutMs = 12000 } = {}) {
  let keyword = '', requests = 0, resultsBlocked = 0, auxiliaryBlocked = 0, unknownBlocked = 0, closed = false, generation = 0;
  let waiting = null;
  const responses = [];
  const admitted = new Set();
  const stats = { transport: 'public-browser-search', navigations: 0, searchRequests: 0, blockedExtraRequests: 0,
    blockedRequestReasons: {}, observedSearchEndpoints: {}, observedSearchPaths: {} };
  const publicVideoLinks = [];
  const unavailable = (status = 0, retryAfter = '', transportReason = 'response-unavailable') => ({ ok: false, status, retryAfter, transportReason });
  const deliver = value => {
    if (closed) return;
    if (waiting) { const resolve = waiting; waiting = null; resolve(value); }
    else responses.push(value);
  };
  const routePattern = searchRoutePattern;
  const route = async route => {
    const request = route.request();
    const url = new URL(request.url());
    const isGeneralFull = /^\/api\/search\/general\/full\/?$/.test(url.pathname);
    const endpoint = isGeneralFull ? 'general-full'
      : url.pathname === '/api/search/item/full/' ? 'item-full'
      : url.pathname === '/api/search/user/full/' ? 'user-full' : 'other-search';
    stats.observedSearchEndpoints[endpoint] = (stats.observedSearchEndpoints[endpoint] || 0) + 1;
    const shape = searchRequestShape(request, url, keyword, count);
    countBucket(stats.observedSearchPaths, shape.path);
    let reason = '';
    if (shape.origin !== 'first-party') reason = 'unexpected-origin';
    else if (auxiliarySearchPath.test(url.pathname)) reason = 'auxiliary-endpoint';
    else if (!isGeneralFull) reason = 'unexpected-endpoint';
    else if (shape.method !== 'GET' || shape.resource === 'other') reason = 'unexpected-transport';
    else if (shape.keyword !== 'match' || url.searchParams.getAll('keyword').length !== 1) reason = 'keyword-mismatch';
    else if (requests >= pages) reason = 'request-cap';
    else if (shape.count !== 'within-cap' || url.searchParams.getAll('count').length !== 1) reason = 'count-cap';

    if (reason) {
      stats.blockedExtraRequests++;
      if (reason === 'auxiliary-endpoint') auxiliaryBlocked++;
      else if (isGeneralFull && shape.origin === 'first-party') resultsBlocked++;
      else unknownBlocked++;
      countBucket(stats.blockedRequestReasons, reason);
      await route.abort();
      return;
    }
    requests++;
    stats.searchRequests++;
    admitted.add(request);
    await route.fallback();
  };
  const onResponse = async response => {
    if (!admitted.delete(response.request())) return;
    const responseGeneration = generation;
    let result;
    try {
      const status = response.status();
      const retryAfter = await response.headerValue('retry-after');
      if (!response.ok()) result = unavailable(status, retryAfter, 'response-http-error');
      else if ((await response.headerValue('content-length')) === '0') result = unavailable(status, retryAfter, 'empty-response');
      else {
        const text = await response.text();
        if (!text || text.length > 4_000_000) result = unavailable(status, retryAfter, text ? 'response-too-large' : 'empty-response');
        else {
          try { result = { ok: true, status, body: JSON.parse(text) }; }
          catch { result = unavailable(status, retryAfter, 'non-json-response'); }
        }
      }
    } catch { result = unavailable(response.status(), '', 'response-read-failed'); }
    if (responseGeneration === generation) deliver(result);
  };
  const onFailed = request => {
    if (admitted.delete(request)) deliver(unavailable(0, '', 'request-failed'));
  };
  await page.route(routePattern, route);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);

  return {
    stats,
    publicVideoLinks,
    async request({ keyword: nextKeyword, offset }) {
      if (offset === 0) {
        generation++;
        keyword = nextKeyword;
        requests = 0;
        resultsBlocked = 0;
        auxiliaryBlocked = 0;
        unknownBlocked = 0;
        responses.length = 0;
        admitted.clear();
      }
      let timer;
      const buffered = responses.length > 0;
      const responsePromise = buffered ? Promise.resolve(responses.shift()) : new Promise(resolve => {
        waiting = resolve;
        timer = setTimeout(() => {
          waiting = null;
          resolve(unavailable(0, '', requests ? 'response-timeout'
            : resultsBlocked ? 'request-policy-blocked'
              : unknownBlocked ? 'unrecognized-search-request'
              : auxiliaryBlocked ? 'ancillary-search-only' : 'no-search-request'));
        }, timeoutMs);
      });
      try {
        if (offset === 0) {
          stats.navigations++;
          const document = await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, {
            waitUntil: 'domcontentloaded', timeout: timeoutMs,
          });
          if (document && !document.ok()) return unavailable(document.status(), await document.headerValue('retry-after'), 'document-http-error');
          const refusal = await tikTokAccessRefusal(page);
          if (refusal) return { ok: false, ...refusal };
        } else if (!buffered && requests < pages) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        const result = await responsePromise;
        if (offset === 0 && requests === 0 && ['request-policy-blocked', 'no-search-request',
          'unrecognized-search-request', 'ancillary-search-only'].includes(result.transportReason)) {
          const refusal = await tikTokAccessRefusal(page);
          if (refusal) return { ok: false, ...refusal };
          // Read the already-visible results from the successful public page.
          // The missing API response and its cooldown remain in the report.
          publicVideoLinks.push(...await visiblePublicVideoLinks(page, keyword, Math.min(count, 30)));
        }
        return result;
      } finally {
        clearTimeout(timer);
        if (waiting) { const resolve = waiting; waiting = null; resolve(unavailable()); }
      }
    },
    async close() {
      closed = true;
      page.off('response', onResponse);
      page.off('requestfailed', onFailed);
      // Stop automatic page requests before releasing the cap for post visits.
      await page.goto('about:blank').catch(() => {});
      await page.unroute(routePattern, route);
      admitted.clear();
      responses.length = 0;
    },
  };
}
