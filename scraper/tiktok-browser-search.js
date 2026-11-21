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

// Let the public search page create its own requests. Signatures and credentials
// belong to the browser, and a refusal ends the scan.
export async function createTikTokBrowserSearch(page, { pages = 3, count = 30, timeoutMs = 12000 } = {}) {
  let keyword = '', requests = 0, rejectedForKeyword = 0, closed = false, generation = 0;
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
  const routePattern = '**/api/search/**';
  const route = async route => {
    const request = route.request();
    const url = new URL(request.url());
    const isGeneralFull = /^\/api\/search\/general\/full\/?$/.test(url.pathname);
    const endpoint = isGeneralFull ? 'general-full'
      : url.pathname === '/api/search/item/full/' ? 'item-full'
      : url.pathname === '/api/search/user/full/' ? 'user-full' : 'other-search';
    stats.observedSearchEndpoints[endpoint] = (stats.observedSearchEndpoints[endpoint] || 0) + 1;
    // Retain only short route names, never a query, signature, user ID, or
    // foreign origin. Unknown paths remain blocked pending a source review.
    const safePath = url.origin === 'https://www.tiktok.com'
      && /^\/api\/search\/(?:general|item|user|suggest|recommend|suggest_words|suggest_guide|live|video|business)(?:\/(?:full|preview))?\/?$/.test(url.pathname)
      ? url.pathname : '[redacted]';
    if (Object.hasOwn(stats.observedSearchPaths, safePath) || Object.keys(stats.observedSearchPaths).length < 12) {
      stats.observedSearchPaths[safePath] = (stats.observedSearchPaths[safePath] || 0) + 1;
    }
    const requestCount = Number(url.searchParams.get('count') || count);
    const matching = url.origin === 'https://www.tiktok.com'
      && isGeneralFull
      && url.searchParams.get('keyword') === keyword;
    if (!matching || requests >= pages || !Number.isFinite(requestCount) || requestCount > count || requestCount < 1) {
      stats.blockedExtraRequests++;
      rejectedForKeyword++;
      const reason = url.origin !== 'https://www.tiktok.com' || endpoint !== 'general-full' ? 'unexpected-endpoint'
        : url.searchParams.get('keyword') !== keyword ? 'keyword-mismatch'
        : requests >= pages ? 'request-cap' : 'count-cap';
      stats.blockedRequestReasons[reason] = (stats.blockedRequestReasons[reason] || 0) + 1;
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
        rejectedForKeyword = 0;
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
            : rejectedForKeyword ? 'request-policy-blocked' : 'no-search-request'));
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
        if (offset === 0 && requests === 0 && ['request-policy-blocked', 'no-search-request'].includes(result.transportReason)) {
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
