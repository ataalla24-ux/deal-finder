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

export async function createTikTokDirectSearch(page, { timeoutMs = 12000 } = {}) {
  const stats = { transport: 'direct-browser-search', navigations: 0, searchRequests: 0, lastSearchResponse: null };
  let expectedUrl = '';
  const intercept = async route => {
    const request = route.request();
    if (request.url() !== expectedUrl || request.method() !== 'GET' || request.resourceType() !== 'fetch'
        || request.frame() !== page.mainFrame()) return route.abort();
    expectedUrl = '';
    stats.searchRequests++;
    await route.fallback();
  };
  await page.route(searchRoutePattern, intercept);

  return {
    stats,
    async request({ keyword, offset, count }) {
      if (!stats.navigations) {
        stats.navigations++;
        const document = await page.goto(publicSearchOrigin + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (document && !document.ok()) {
          return { ok: false, status: document.status(), retryAfter: await document.headerValue('retry-after'),
            transportReason: 'document-http-error' };
        }
        await page.waitForTimeout(2200);
        const home = new URL(page.url());
        stats.homepageNavigation = home.origin !== publicSearchOrigin ? 'other-origin'
          : home.pathname === '/' ? 'root' : 'same-origin-redirect';
        const refusal = await tikTokAccessRefusal(page, document);
        if (refusal) return { ok: false, ...refusal };
      }
      expectedUrl = `${publicSearchOrigin}/api/search/general/full/?keyword=${encodeURIComponent(keyword)}&offset=${offset}&count=${count}`;
      try {
        const { evidence, ...result } = await page.evaluate(async ({ url, timeoutMs }) => {
          if (location.origin !== new URL(url).origin) {
            return { ok: false, transportReason: 'homepage-origin-mismatch' };
          }
          const response = await fetch(url, {
            headers: { accept: 'application/json,text/plain,*/*' },
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs),
          });
          const retryAfter = response.headers.get('retry-after');
          const status = response.status;
          const length = response.headers.get('content-length');
          const declaredBytes = length && /^\d+$/.test(length) ? Number(length) : null;
          const evidence = { status, declaredBytes, decodedBytes: null, retryAfterProvided: retryAfter !== null };
          const unavailable = (transportReason, bodyState) => ({
            ok: false, status, retryAfter, transportReason, evidence: { ...evidence, bodyState },
          });
          if (!response.ok) return unavailable('response-http-error', 'http-error');
          if (declaredBytes > 4_000_000) return unavailable('response-too-large', 'too-large');
          if (declaredBytes === 0) return unavailable('empty-response', 'declared-empty');
          const decoder = new TextDecoder();
          let text = '';
          let decodedBytes = 0;
          for await (const chunk of response.body || []) {
            decodedBytes += chunk.byteLength;
            if (decodedBytes > 4_000_000) return unavailable('response-too-large', 'too-large');
            text += decoder.decode(chunk, { stream: true });
          }
          evidence.decodedBytes = decodedBytes;
          if (!decodedBytes) return unavailable('empty-response', 'decoded-empty');
          try {
            return { ok: true, status, retryAfter, body: JSON.parse(text + decoder.decode()),
              evidence: { ...evidence, bodyState: 'json' } };
          } catch {
            return unavailable('non-json-response', 'non-json');
          }
        }, { url: expectedUrl, timeoutMs });
        stats.lastSearchResponse = evidence || null;
        return result;
      } finally {
        expectedUrl = '';
      }
    },
    async close() {
      await page.goto('about:blank').catch(() => {});
      await page.unroute(searchRoutePattern, intercept);
    },
  };
}

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

function responseMediaClass(contentType) {
  const media = contentType?.split(';', 1)[0].trim().toLowerCase();
  if (!media) return 'absent';
  if (media === 'application/json' || media.endsWith('+json')) return 'json';
  if (media === 'text/html' || media === 'application/xhtml+xml') return 'html';
  return 'other';
}

// Let the public search page create its own requests. Signatures and credentials
// belong to the browser, and a refusal ends the scan.
export async function createTikTokBrowserSearch(page, { pages = 3, count = 30, timeoutMs = 12000 } = {}) {
  let keyword = '', requests = 0, resultsBlocked = 0, auxiliaryBlocked = 0, unknownBlocked = 0, closed = false, generation = 0;
  let waiting = null;
  let acceptSearchRequests = false;
  const responses = [];
  const admitted = new Set();
  const stats = { transport: 'public-browser-search', navigations: 0, searchRequests: 0, blockedExtraRequests: 0,
    blockedRequestReasons: {}, observedSearchEndpoints: {}, observedSearchPaths: {}, lastSearchResponse: null };
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
    else if (!acceptSearchRequests) reason = 'response-stopped';
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
    let retryAfter = null;
    const evidence = {
      status: response.status(), content: 'absent', declaredBytes: null, decodedBytes: null,
      fromServiceWorker: response.fromServiceWorker(), retryAfterProvided: null, bodyState: 'read-failed',
    };
    try {
      retryAfter = await response.headerValue('retry-after');
      evidence.retryAfterProvided = retryAfter !== null;
      const length = await response.headerValue('content-length');
      const declaredBytes = Number(length);
      if (length && /^\d+$/.test(length) && Number.isSafeInteger(declaredBytes)) evidence.declaredBytes = declaredBytes;
      evidence.content = responseMediaClass(await response.headerValue('content-type'));
      if (!response.ok()) {
        evidence.bodyState = 'http-error';
        result = unavailable(evidence.status, retryAfter, 'response-http-error');
      } else if (evidence.declaredBytes === 0) {
        evidence.bodyState = 'declared-empty';
        result = unavailable(evidence.status, retryAfter, 'empty-response');
      } else if (evidence.declaredBytes > 4_000_000) {
        evidence.bodyState = 'too-large';
        result = unavailable(evidence.status, retryAfter, 'response-too-large');
      } else {
        const bytes = await response.body();
        evidence.decodedBytes = bytes.length;
        if (!bytes.length) {
          evidence.bodyState = 'decoded-empty';
          result = unavailable(evidence.status, retryAfter, 'empty-response');
        } else if (bytes.length > 4_000_000) {
          evidence.bodyState = 'too-large';
          result = unavailable(evidence.status, retryAfter, 'response-too-large');
        } else {
          try {
            result = { ok: true, status: evidence.status, body: JSON.parse(bytes.toString('utf8')) };
            evidence.bodyState = 'json';
          } catch {
            evidence.bodyState = 'non-json';
            result = unavailable(evidence.status, retryAfter, 'non-json-response');
          }
        }
      }
    } catch {
      result = unavailable(evidence.status, retryAfter, 'response-read-failed');
    }
    if (responseGeneration === generation) {
      stats.lastSearchResponse = evidence;
      if (!result.ok) acceptSearchRequests = false;
      deliver(result);
    }
  };
  const onFailed = request => {
    if (!admitted.delete(request)) return;
    acceptSearchRequests = false;
    deliver(unavailable(0, '', 'request-failed'));
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
        acceptSearchRequests = true;
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
        if (!result.ok) acceptSearchRequests = false;
        const noResultRequest = requests === 0 && ['request-policy-blocked', 'no-search-request',
          'unrecognized-search-request', 'ancillary-search-only'].includes(result.transportReason);
        const emptyOk = result.status === 200 && result.transportReason === 'empty-response' && result.retryAfter === null;
        if (offset === 0 && (noResultRequest || emptyOk)) {
          if (emptyOk) await page.waitForTimeout(650);
          const refusal = await tikTokAccessRefusal(page);
          if (refusal) return { ok: false, ...refusal };
          // Read only links rendered by the same public page; the search
          // failure and its cooldown still apply to subsequent collection.
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
