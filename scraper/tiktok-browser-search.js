// Let the public search page create its own requests. Never synthesize website
// signatures, replay credentials, or retry a challenge through another endpoint.
export async function createTikTokBrowserSearch(page, { pages = 3, count = 30, timeoutMs = 12000 } = {}) {
  let keyword = '', requests = 0, rejectedForKeyword = 0, closed = false, generation = 0;
  let waiting = null;
  const responses = [];
  const admitted = new Set();
  const stats = { transport: 'public-browser-search', navigations: 0, searchRequests: 0, blockedExtraRequests: 0,
    blockedRequestReasons: {}, observedSearchEndpoints: {} };
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
    const endpoint = url.pathname === '/api/search/general/full/' ? 'general-full'
      : url.pathname === '/api/search/item/full/' ? 'item-full'
      : url.pathname === '/api/search/user/full/' ? 'user-full' : 'other-search';
    stats.observedSearchEndpoints[endpoint] = (stats.observedSearchEndpoints[endpoint] || 0) + 1;
    const requestCount = Number(url.searchParams.get('count') || count);
    const matching = url.origin === 'https://www.tiktok.com'
      && url.pathname === '/api/search/general/full/'
      && url.searchParams.get('keyword') === keyword;
    if (!matching || requests >= pages || !Number.isFinite(requestCount) || requestCount > count || requestCount < 1) {
      stats.blockedExtraRequests++;
      rejectedForKeyword++;
      const reason = url.origin !== 'https://www.tiktok.com' || endpoint !== 'general-full' ? 'unexpected-endpoint'
        : url.searchParams.get('keyword') !== keyword ? 'keyword-mismatch'
        : requests >= pages ? 'request-cap' : 'count-cap';
      stats.blockedRequestReasons[reason] = (stats.blockedRequestReasons[reason] || 0) + 1;
      if (matching && requests < pages) deliver(unavailable(0, '', 'request-policy-blocked'));
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
          // A visible challenge is a refusal, not an empty search or a puzzle
          // for this collector to solve. The caller persists the usual pause.
          const title = await page.title();
          const body = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
          const finalPath = new URL(page.url()).pathname;
          const loginForm = await page.locator('form input[type="password"]').first().isVisible().catch(() => false);
          if (/^\/(?:login|signup|challenge|checkpoint)(?:\/|$)/i.test(finalPath) || loginForm) {
            return unavailable(403, '', 'login-wall');
          }
          if (/verify (?:to continue|you are human)|security check|unusual traffic|too many requests|log in to search|anmelden,? um|sicherheits(?:pruefung|pr\u00fcfung)/i.test(`${title} ${body.slice(0, 1000)}`)) {
            return unavailable(403, '', 'access-challenge');
          }
        } else if (!buffered && requests < pages) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        return await responsePromise;
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
