import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fetchTikTokApiCandidates } from '../scraper/tiktok-deals-scanner.js';
import { createTikTokBrowserSearch, observeTikTokSearchRoutes } from '../scraper/tiktok-browser-search.js';
import { selectTikTokPostVisits } from '../scraper/tiktok-search-discovery.js';

const now = new Date('2026-11-11T12:00:00Z');
const item = id => ({ id:String(id),author:{uniqueId:'vienna.cafe'},desc:'Wien: Gratis Kaffee',createTime:1794340800 });
const body = (items, more=false) => ({status_code:0,data:items,has_more:more});
const response = data => ({status:200,contentType:'application/json',body:JSON.stringify(data)});

async function fixture({ documentStatus=200, html, homepage, api=()=>response(body([item(123)])) }, run) {
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({serviceWorkers:'block'});
    const calls=[];
    const documents=[];
    // Every request is fulfilled or aborted locally; these tests never contact TikTok.
    await context.route('**/*', async route => {
      const url=new URL(route.request().url());
      if (url.origin !== 'https://www.tiktok.com') return route.abort();
      if (route.request().isNavigationRequest()) documents.push(url.pathname);
      if (url.pathname === '/' && homepage) return route.fulfill({status:documentStatus,contentType:'text/html',body:homepage});
      if (url.pathname === '/search') return route.fulfill({status:documentStatus,contentType:'text/html',body:html || `
        <body>Search results<script>
        const keyword=new URLSearchParams(location.search).get('q');
        const search=offset=>fetch('/api/search/general/full/?keyword='+encodeURIComponent(keyword)+'&count=30&offset='+offset);
        search(0); window.addEventListener('scroll',()=>search(30),{once:true});
        </script><div style="height:4000px"></div></body>`});
      if (url.pathname.startsWith('/api/search/')) {
        calls.push(url);
        return route.fulfill(await api(url,calls.length));
      }
      return route.abort();
    });
    const page=await context.newPage();
    await run(page,calls,documents);
  } finally { await browser.close(); }
}
const scan = (page,options={}) => fetchTikTokApiCandidates(page,{keywords:['wien gratis kaffee'],now,
  wait:async()=>{},timeoutMs:1500,createTransport:createTikTokBrowserSearch,...options});

const scanDirect = (page, options) => scan(page, { ...options, createTransport: undefined });

test('the default scanner accepts the same-origin homepage path and sends only the October video searches', async () => {
  const homepage = '<body>Home<script>history.replaceState(null, "", "/foryou");'
    + 'fetch("/api/search/suggest/guide/").catch(() => {});</script></body>';
  await fixture({ homepage, api: (_url, n) => response(body([item(n)], true)) }, async (page, calls, documents) => {
    const result = await scanDirect(page, { pages: 2 });
    assert.deepEqual(documents, ['/']);
    assert.equal(result.transport, 'direct-browser-search');
    assert.equal(result.navigations, 1);
    assert.equal(result.homepageNavigation, 'same-origin-redirect');
    assert.equal(result.searchRequests, 2);
    assert.equal(result.rows.length, 2);
    assert.deepEqual(calls.map(url => [url.pathname, ...url.searchParams.values()]), [
      ['/api/search/general/full/', 'wien gratis kaffee', '0', '30'],
      ['/api/search/general/full/', 'wien gratis kaffee', '30', '30'],
    ]);
  });
});

test('the direct homepage search honors refusal and distinguishes a zero-byte response from a result list', async () => {
  const options = { keywords: ['food', 'coffee'] };
  for (const [config, status, reason, count] of [
    [{ homepage: '<form><input type="password"></form>' }, 403, 'login-wall', 0],
    [{ homepage: '<body>Home</body>', api: () => ({status:429,headers:{'Retry-After':'172800'},body:''}) }, 429, 'response-http-error', 1],
    [{ homepage: '<body>Home</body>', api: () => ({status:200,headers:{'Content-Length':'0'},body:''}) }, 200, 'empty-response', 1],
  ]) {
    await fixture(config, async (page, calls) => {
      const result = await scanDirect(page, options);
      assert.equal(calls.length, count);
      assert.equal(result.rows.length, 0);
      assert.equal(result.errors[0].status, status);
      assert.equal(result.errors[0].transportReason, reason);
      assert.equal(result.nextRetryAt, status === 429 ? '2026-11-13T12:00:00.000Z' : '2026-11-12T12:00:00.000Z');
    });
  }
});

test('the route-only probe blocks all search requests and logs bounded shape information only', async () => {
  await fixture({ html: '<script>fetch("/api/search/suggest/guide/?keyword=known-term&signature=keep-out");'
    + 'fetch("/api/search/user/private_handle/?uid=9876543210");</script>' }, async (page, calls) => {
    const result = await observeTikTokSearchRoutes(page, 'known-term', { waitMs: 300 });
    assert.equal(result.navigationStatus, 200);
    assert.equal(result.forwardedSearchRequests, 0);
    assert.equal(calls.length, 0);
    assert.ok(result.requests.some(request => request.path === '/api/search/suggest/guide/'
      && request.keyword === 'match' && request.origin === 'first-party' && request.count === 'absent'));
    assert.ok(result.requests.some(request => request.path === '[redacted]'));
    assert.doesNotMatch(JSON.stringify(result), /known-term|keep-out|private_handle|9876543210/);
  });
});

test('public frontend creates its requests; exact search responses yield original IDs and dates', async () => {
  await fixture({},async(page,calls)=>{
    const result=await scan(page);
    assert.equal(result.rows.length,1);
    assert.equal(result.rows[0].data.timeDateTime,new Date(1794340800*1000).toISOString());
    assert.equal(result.transport,'public-browser-search');assert.equal(result.searchRequests,1);
    assert.equal(result.navigations,1);assert.equal(calls.length,1);
    assert.equal(calls[0].searchParams.get('keyword'),'wien gratis kaffee');
  });
});

test('pagination uses scrolling and the frontend cursor, bounded by existing pages', async () => {
  await fixture({api:(_url,n)=>response(body([item(n)],n<2))},async(page,calls)=>{
    const result=await scan(page,{pages:2});
    assert.equal(result.rows.length,2);assert.equal(calls.length,2);assert.equal(result.searchRequests,2);
  });
});

test('the same general-full route works with or without a final slash, under one request cap', async () => {
  await fixture({html: `<script>
    const base='/api/search/general/full?keyword=wien%20gratis%20kaffee&count=30';
    fetch(base); fetch('/api/search/general/full/?keyword=wien%20gratis%20kaffee&count=30');
    </script>`}, async(page,calls)=>{
    const result=await scan(page,{pages:1});
    assert.equal(result.rows.length,1);
    assert.equal(calls.length,1);
    assert.equal(calls[0].pathname,'/api/search/general/full');
    assert.equal(result.searchRequests,1);
    assert.equal(result.blockedRequestReasons['request-cap'],1);
    assert.equal(result.errors.length,0);
  });
});

test('provider error 2483 and HTTP 429 stay refusals, with persisted Retry-After and no retries', async () => {
  for (const api of [()=>response({status_code:2483}),()=>({status:429,headers:{'Retry-After':'172800'},body:''})]) {
    await fixture({api},async(page,calls)=>{
      const result=await scan(page,{keywords:['food','coffee']});
      assert.equal(result.rows.length,0);assert.equal(calls.length,1);assert.equal(result.errors.length,1);
      assert.ok(Date.parse(result.nextRetryAt)>=+now+86400000);
      if (result.errors[0].status===429) assert.equal(result.nextRetryAt,'2026-11-13T12:00:00.000Z');
      else assert.equal(result.errors[0].providerCode,'2483');
    });
  }
});

test('HTTP refusal, visible challenge, missing data and unrelated responses are not empty success', async () => {
  for (const config of [
    {documentStatus:403,html:'denied'},
    {html:'<body>Verify to continue</body>'},
    {html:'<body>Search unavailable</body>'},
    {html:`<script>fetch('/api/search/general/full/?keyword=unrelated&count=30')</script>`},
  ]) await fixture(config,async(page,calls)=>{
    const result=await scan(page);
    assert.equal(result.rows.length,0);assert.equal(result.errors.length,1);
    assert.ok(result.nextRetryAt);assert.equal(calls.length,0);
  });
});

test('active pause does not even install a browser transport or navigate', async () => {
  const page=new Proxy({}, {get(){assert.fail('no browser access during saved pause');}});
  const previous={nextRetryAt:'2026-11-11T22:22:04.465Z',nextKeywordIndex:1};
  const result=await scanDirect(page,{previous});
  assert.equal(result.nextRetryAt,previous.nextRetryAt);assert.equal(result.attemptedRequests,0);
});

test('TikTok diagnostics distinguish a local request cap from unreadable or missing provider responses', async () => {
  for (const [config, reason] of [
    [{html: '<body>Search unavailable</body>'}, 'no-search-request'],
    [{html: '<script>fetch("/api/search/item/full/?keyword=private-value&count=30&token=do-not-log")</script>'}, 'unrecognized-search-request'],
    [{api: () => ({status:200,contentType:'text/html',body:'<html>Unavailable</html>'})}, 'non-json-response'],
    [{api: () => ({status:200,contentType:'application/json',headers:{'content-length':'0'},body:''})}, 'empty-response'],
    [{documentStatus:403,html:'denied'}, 'document-http-error'],
    [{html:'<body>Verify to continue</body>'}, 'access-challenge'],
    [{html:'<form><input type="password"></form>'}, 'login-wall'],
  ]) await fixture(config,async(page,calls)=>{
    const result=await scan(page);
    assert.equal(result.errors[0].transportReason,reason);
    assert.equal(result.rows.length,0);
    assert.ok(result.nextRetryAt);
    assert.doesNotMatch(JSON.stringify(result),/private-value|do-not-log/);
    if (reason==='unrecognized-search-request') {
      assert.equal(result.observedSearchEndpoints['item-full'],1);
      assert.equal(result.observedSearchPaths['/api/search/item/full/'],1);
      assert.equal(result.blockedRequestReasons['unexpected-endpoint'],1);
      assert.equal(calls.length,0,'diagnostics must not authorize an alternate endpoint');
    }
  });
});

test('route diagnostics retain known route shapes only, without authorizing them or logging credentials', async () => {
  await fixture({html:`<script>
    fetch('/api/search/general/preview/?keyword=private-value&token=do-not-log');
    fetch('/api/search/general/full?keyword=private-value&signature=do-not-log');
    fetch('/api/search/privateaccount/privatetoken/?token=do-not-log');
    </script>`},async(page,calls)=>{
    const result=await scan(page);
    assert.equal(calls.length,0);
    assert.equal(result.searchRequests,0);
    assert.equal(result.errors[0].transportReason,'request-policy-blocked');
    assert.equal(result.observedSearchPaths['/api/search/general/preview/'],1);
    assert.equal(result.observedSearchPaths['/api/search/general/full'],1);
    assert.equal(result.observedSearchPaths['[redacted]'],1);
    assert.doesNotMatch(JSON.stringify(result), /private-value|do-not-log|privateaccount|privatetoken/);
  });
});

test('frontend cannot exceed the existing request cap or substitute another endpoint', async () => {
  await fixture({html:`<script>
    const base='/api/search/general/full/?keyword=wien%20gratis%20kaffee&count=30';
    fetch(base); fetch(base+'&offset=30'); fetch(base+'&offset=60');
    fetch('/api/search/general/full/?keyword=other&count=30');
    fetch('/api/search/item/full/?keyword=wien%20gratis%20kaffee&count=30');
    </script>`},async(page,calls)=>{
    const result=await scan(page,{pages:1});
    assert.equal(result.rows.length,1);assert.equal(calls.length,1);
    assert.equal(result.searchRequests,1);assert.ok(result.blockedExtraRequests>=2);
  });
});

test('a blocked ancillary request cannot mask the allowed search response', async () => {
  await fixture({html:`<script>
    const base='/api/search/general/full/?keyword=wien%20gratis%20kaffee';
    fetch(base+'&count=60').catch(()=>fetch(base+'&count=30'));
  </script>`}, async(page,calls)=>{
    const result=await scan(page,{pages:1});
    assert.equal(result.rows.length,1);
    assert.equal(calls.length,1);
    assert.equal(calls[0].searchParams.get('count'),'30');
    assert.equal(result.blockedRequestReasons['count-cap'],1);
    assert.equal(result.nextRetryAt,'');
  });
});

test('ancillary search requests stay blocked without claiming that a video result request was denied', async () => {
  await fixture({ html: '<script>fetch("/api/search/user/preview/");'
    + 'fetch("/api/search/suggest/guide/?keyword=wien%20gratis%20kaffee")</script>' }, async (page, calls) => {
    const result = await scan(page);
    assert.equal(calls.length, 0);
    assert.equal(result.searchRequests, 0);
    assert.equal(result.blockedRequestReasons['auxiliary-endpoint'], 2);
    assert.equal(result.errors[0].transportReason, 'ancillary-search-only');
    assert.equal(result.boundedRetry, undefined, 'an ancillary-only page cannot trigger a short local retry');
    assert.equal(result.nextRetryAt, '2026-11-12T12:00:00.000Z');
  });
});

test('a result route must be one GET with the exact query and one explicit integer count at or below the cap', async () => {
  await fixture({ html: '<script>const base="/api/search/general/full/?keyword=wien%20gratis%20kaffee";'
    + 'fetch(base); fetch(base+"&count=1.5"); fetch(base+"&count=30&count=90");'
    + 'fetch(base+"&keyword=other&count=30"); fetch(base+"&count=30",{method:"POST"});'
    + 'fetch(base+"&count=30");</script>' }, async (page, calls) => {
    const result = await scan(page, { pages: 1 });
    assert.equal(result.rows.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(result.blockedRequestReasons['count-cap'], 3);
    assert.equal(result.blockedRequestReasons['keyword-mismatch'], 1);
    assert.equal(result.blockedRequestReasons['unexpected-transport'], 1);
  });
});

test('a readable public search page exposes only visible first-party video links', async () => {
  await fixture({html:`<main>
    <a href="/@vienna.cafe/video/1234567890123456789?ref=drop-me">Coffee clip</a>
    <a href="/@vienna.cafe/video/1234567890123456789">Same clip</a>
    <a href="/@vienna.cafe/video/2345678901234567890" hidden>Hidden clip</a>
    <a href="https://example.invalid/@vienna.cafe/video/3456789012345678901">Foreign clip</a>
    <a href="/@vienna.cafe/video/4567890123456789012/other">Inexact path</a>
  </main><nav><a href="/@vienna.cafe/video/5678901234567890123">Navigation clip</a></nav>
  <script>fetch('/api/search/user/preview/').catch(()=>{})</script>`}, async(page,calls)=>{
    const result=await scan(page,{timeoutMs:1000});
    const visibleUrl='https://www.tiktok.com/@vienna.cafe/video/1234567890123456789';
    assert.equal(calls.length,0);
    assert.equal(result.errors[0].transportReason,'ancillary-search-only');
    assert.ok(result.nextRetryAt);
    assert.deepEqual(result.publicVideoLinks,[visibleUrl]);
    assert.deepEqual(selectTikTokPostVisits(result,[visibleUrl,'https://www.tiktok.com/@vienna.cafe/video/6789012345678901234'],2),
      {urls:[visibleUrl],deferredWebVisits:1});
  });
});

const emptyResponsePage = (script = '') => '<main id="results"></main><script>'
  + 'const request = () => fetch("/api/search/general/full/?keyword=wien%20gratis%20kaffee&count=30");'
  + 'request().catch(() => {});' + script + '</script>';
const exactPublicClip = 'https://www.tiktok.com/@vienna.cafe/video/1234567890123456789';

test('a zero-length HTTP 200 still permits an already rendered public link on the same results page', async () => {
  const markup = '<a href="' + exactPublicClip + '">Coffee clip</a>';
  const html = emptyResponsePage('setTimeout(() => document.querySelector("#results").innerHTML = ' + JSON.stringify(markup) + ', 150);'
    + 'setTimeout(() => request().catch(() => {}), 350);');
  await fixture({html,api:()=>({status:200,headers:{'Content-Length':'0'},body:''})},async(page,calls)=>{
    const result = await scan(page, { pages: 3 });
    assert.equal(calls.length,1,'settling the existing page cannot send another search after the empty response');
    assert.equal(result.rows.length,0);
    assert.equal(result.errors[0].transportReason,'empty-response');
    assert.equal(result.lastSearchResponse.bodyState,'declared-empty');
    assert.equal(result.lastSearchResponse.declaredBytes,0);
    assert.equal(result.lastSearchResponse.retryAfterProvided,false);
    assert.deepEqual(result.publicVideoLinks,[exactPublicClip]);
    assert.ok(result.nextRetryAt,'public links must not clear the transport pause');
  });
});

test('a late wall and an explicit wait with empty HTTP 200 both suppress public links', async () => {
  const markup = '<a href="' + exactPublicClip + '">Coffee clip</a>';
  for (const [apiHeaders,lateWall] of [[{'Content-Length':'0'},true],
    [{'Content-Length':'0','Retry-After':'172800'},false]]) {
    const html = emptyResponsePage('document.querySelector("#results").innerHTML=' + JSON.stringify(markup) + ';'
      + (lateWall ? 'setTimeout(() => document.title="Verify to continue", 150);' : ''));
    await fixture({html,api:()=>({status:200,headers:apiHeaders,body:''})},async(page,calls)=>{
      const result = await scan(page);
      assert.equal(calls.length,1);
      assert.deepEqual(result.publicVideoLinks,[]);
      assert.equal(result.errors[0].transportReason,lateWall ? 'access-challenge' : 'empty-response');
      if(!lateWall) {
        assert.equal(result.lastSearchResponse.retryAfterProvided,true);
        assert.equal(result.nextRetryAt,'2026-11-13T12:00:00.000Z');
      }
    });
  }
});

test('a valid empty JSON collection is a normal zero-result search', async () => {
  await fixture({api:()=>response(body([]))}, async (page,calls) => {
    const result = await scan(page);
    assert.equal(calls.length,1);
    assert.equal(result.emptyResponses,1);
    assert.equal(result.errors.length,0);
    assert.equal(result.nextRetryAt,'');
    assert.equal(result.lastSearchResponse.bodyState,'json');
    assert.ok(result.lastSearchResponse.decodedBytes>0);
  });
});

test('a public document refusal or challenge never exposes stale links', async () => {
  const staleLink='<main><a href="/@vienna.cafe/video/1234567890123456789">Old clip</a></main>';
  for (const config of [
    {documentStatus:403,html:staleLink},
    {html:`<body>Verify to continue${staleLink}</body>`},
    {html:`<body><form><input type="password"></form>${staleLink}</body>`},
  ]) await fixture(config,async(page,calls)=>{
    const result=await scan(page);
    assert.equal(result.errors[0].status,403);
    assert.ok(result.nextRetryAt);
    assert.deepEqual(result.publicVideoLinks,[]);
    assert.equal(calls.length,0);
    assert.deepEqual(selectTikTokPostVisits(result,['https://www.tiktok.com/@vienna.cafe/video/1234567890123456789'],1),
      {urls:[],deferredWebVisits:1});
  });
});

test('an admitted search API refusal blocks fallback even with visible video links', async () => {
  await fixture({
    html:`<main><a href="/@vienna.cafe/video/1234567890123456789">Old clip</a></main>
      <script>fetch('/api/search/general/full/?keyword=wien%20gratis%20kaffee&count=30')</script>`,
    api:()=>({status:429,headers:{'Retry-After':'172800'},body:''}),
  }, async(page,calls)=>{
    const result=await scan(page);
    assert.equal(calls.length,1);
    assert.equal(result.errors[0].status,429);
    assert.equal(result.nextRetryAt,'2026-11-13T12:00:00.000Z');
    assert.deepEqual(result.publicVideoLinks,[]);
  });
});

test('the first eligible local retry uses one navigation and one admitted request', async () => {
  await fixture({html:`<script>
    const keyword=encodeURIComponent(new URLSearchParams(location.search).get('q'));
    const base='/api/search/general/full/?keyword='+keyword+'&count=30';
    fetch(base);
    fetch(base+'&offset=30').catch(()=>{});
  </script>`, api:()=>response(body([item(123)],true))}, async(page,calls)=>{
    const result=await scan(page,{keywords:['a','b'],pages:3,
      previous:{nextRetryAt:now.toISOString(),boundedRetry:{reason:'local-request-policy',failures:1}}});
    assert.equal(calls.length,1);
    assert.equal(result.navigations,1);
    assert.equal(result.searchRequests,1);
    assert.equal(result.rows.length,1);
    assert.equal(result.nextRetryAt,'');
    assert.equal(result.boundedRetry,undefined);
  });
});
