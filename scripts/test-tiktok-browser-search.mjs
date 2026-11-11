import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fetchTikTokApiCandidates } from '../scraper/tiktok-deals-scanner.js';

const now = new Date('2026-11-11T12:00:00Z');
const item = id => ({ id:String(id),author:{uniqueId:'vienna.cafe'},desc:'Wien: Gratis Kaffee',createTime:1794340800 });
const body = (items, more=false) => ({status_code:0,data:items,has_more:more});
const response = data => ({status:200,contentType:'application/json',body:JSON.stringify(data)});

async function fixture({ documentStatus=200, html, api=()=>response(body([item(123)])) }, run) {
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({serviceWorkers:'block'});
    const calls=[];
    // Every request is fulfilled or aborted locally; these tests never contact TikTok.
    await context.route('**/*', async route => {
      const url=new URL(route.request().url());
      if (url.origin !== 'https://www.tiktok.com') return route.abort();
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
    await run(page,calls);
  } finally { await browser.close(); }
}
const scan = (page,options={}) => fetchTikTokApiCandidates(page,{keywords:['wien gratis kaffee'],now,
  wait:async()=>{},timeoutMs:1500,...options});

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
  const result=await scan(page,{previous});
  assert.equal(result.nextRetryAt,previous.nextRetryAt);assert.equal(result.attemptedRequests,0);
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
