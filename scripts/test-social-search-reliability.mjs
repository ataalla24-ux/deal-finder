import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicSearchResponse } from '../scraper/public-search-response.js';
import { planInstagramQueries } from '../scraper/instagram-query-plan.js';
import { parseInstagramSearchResults, runInstagramSearchQueries } from '../scraper/instagram-search-discovery.js';
import { parseTikTokSearchResponse, runTikTokApiDiscovery, tikTokDirectProbePrevious, tikTokDiscoveryHealth } from '../scraper/tiktok-search-discovery.js';
import { discoverTikTokLinksViaDuckDuckGo, fetchTikTokApiCandidates, normalizeTikTokApiItem } from '../scraper/tiktok-deals-scanner.js';
import { loadWatchlist } from '../scraper/instagram-ai-agent.js';

const now = new Date('2026-11-10T20:00:00Z');
const never = async () => assert.fail('must not request or wait');
const item = { id: '7551234567891234567', author: { uniqueId: 'vienna.cafe' }, desc: 'Wien: Gratis Kaffee', createTime: 1794340800 };
const valid = batch => ({ ok: true, status: 200, body: { status_code: 0, data: batch, has_more: false } });

test('failed or deferred discovery cannot replace the previous outbox with an empty result', () => {
  assert.deepEqual(tikTokDiscoveryHealth({errors:[{code:'provider-error'}]},{}),{status:'discovery-degraded',outputPreserved:true});
  assert.equal(tikTokDiscoveryHealth({nextRetryAt:'2026-11-11T20:00:00Z'},{}).outputPreserved,true);
  assert.equal(tikTokDiscoveryHealth({},{nextRetryAt:'2026-11-11T20:00:00Z'}).outputPreserved,true);
  assert.equal(tikTokDiscoveryHealth({errors:[{}]},{},1).outputPreserved,false);
  assert.deepEqual(tikTokDiscoveryHealth({errors:[]},{errors:[]}),{status:'completed',outputPreserved:false});
});

test('search distinguishes actual no-results from HTTP-200/202 challenges and changed layouts', async () => {
  assert.match(await readPublicSearchResponse(new Response('<div class="no-results">No results found</div>')), /no-results/);
  for (const [body,status] of [['<form id="challenge-form">',200],['<div class="anomaly-modal">',202],['',200],['<h1>Login required</h1>',200]]) {
    await assert.rejects(readPublicSearchResponse(new Response(body,{status}),now), /challenge|Unrecognized/);
  }
  await assert.rejects(readPublicSearchResponse(new Response('',{status:429,headers:{'Retry-After':'172800'}}),now), error => error.retryAt === '2026-11-12T20:00:00.000Z');
});

test('TikTok response codes and unknown shapes are not successful zero results', () => {
  assert.equal(parseTikTokSearchResponse(valid([])).batch.length,0);
  assert.equal(parseTikTokSearchResponse({ok:true,status:200,body:{status_code:10201}}).code,'provider-error');
  assert.equal(parseTikTokSearchResponse({ok:true,status:200,body:{statusCode:'10000',data:[]}}).code,'provider-error');
  assert.equal(parseTikTokSearchResponse({ok:true,status:200,body:{}}).code,'schema-mismatch');
  assert.equal(parseTikTokSearchResponse({ok:false,status:200}).code,'transport-unavailable');
  assert.deepEqual(parseTikTokSearchResponse({ok:true,status:200,body:{item_list:[item]}}).batch,[item]);
  assert.equal(parseTikTokSearchResponse({ok:false,status:0,transportReason:'request-policy-blocked'}).transportReason,'request-policy-blocked');
  assert.equal(parseTikTokSearchResponse({ok:false,status:0,transportReason:'secret-url?token=private'}).transportReason,'response-unavailable');
});

test('known TikTok envelopes normalize only actual post identities and real timestamps', () => {
  for (const raw of [item,{item},{itemStruct:item},{item_info:{item_struct:item}},
    {aweme_info:{...item,id:undefined,aweme_id:item.id,author:{unique_id:'vienna.cafe'}}}]) {
    const actual=normalizeTikTokApiItem(raw);
    assert.equal(actual.url,`https://www.tiktok.com/@vienna.cafe/video/${item.id}`);
    assert.equal(actual.timeDateTime,new Date(item.createTime*1000).toISOString());
  }
  assert.equal(normalizeTikTokApiItem({id:'bad',author:{uniqueId:'vienna.cafe'}}),null);
  assert.equal(normalizeTikTokApiItem({user_info:{uniqueId:'vienna.cafe'}}),null);
  assert.equal(normalizeTikTokApiItem({...item,createTime:undefined}).timeDateTime,'');
  assert.equal(normalizeTikTokApiItem({...item,createTime:1e99,textExtra:{}}).timeDateTime,'');
  assert.equal(normalizeTikTokApiItem({...item,textExtra:[null]}).url,`https://www.tiktok.com/@vienna.cafe/video/${item.id}`);
});

test('TikTok stops on refusal, keeps previous discoveries, and honors Retry-After across runs', async () => {
  let calls=0; const waits=[];
  const first=await runTikTokApiDiscovery({keywords:['food','coffee','pizza'],now,normalize:normalizeTikTokApiItem,
    wait:async ms=>waits.push(ms),request:async()=> ++calls===1 ? valid([item]) : {ok:false,status:429,retryAfter:'172800'}});
  assert.equal(calls,2);assert.equal(first.rows.length,1);assert.equal(first.rawItems,1);
  assert.equal(first.nextRetryAt,'2026-11-12T20:00:00.000Z');
  assert.deepEqual(waits,[1000]);
  const held=await runTikTokApiDiscovery({keywords:['food'],now,previous:first,request:never,wait:never});
  assert.equal(held.attemptedRequests,0);assert.equal(held.nextRetryAt,first.nextRetryAt);
  const heldAgain=await runTikTokApiDiscovery({keywords:['food'],now:new Date(+now+3600000),previous:held,request:never,wait:never});
  assert.equal(heldAgain.nextRetryAt,first.nextRetryAt);
});

test('a local TikTok request-policy rejection gets one probe, then the full pause on repeat', async () => {
  const denied = {ok:false,status:0,transportReason:'request-policy-blocked'};
  const args = {keywords:['a','b','c'],normalize:normalizeTikTokApiItem,wait:never};
  const first = await runTikTokApiDiscovery({...args,now,request:async()=>denied});
  assert.equal(first.nextRetryAt,'2026-11-11T00:00:00.000Z');
  assert.deepEqual(first.boundedRetry,{reason:'local-request-policy',failures:1,failedAt:now.toISOString()});
  const held = await runTikTokApiDiscovery({...args,now:new Date('2026-11-10T23:59:59.999Z'),previous:first,request:never});
  assert.equal(held.attemptedRequests,0);
  assert.deepEqual(held.boundedRetry,first.boundedRetry);
  const probeAt = new Date(held.nextRetryAt);
  const repeat = await runTikTokApiDiscovery({...args,now:probeAt,previous:held,request:async()=>denied});
  assert.equal(repeat.attemptedRequests,1);
  assert.equal(repeat.boundedRetry.failures,2);
  assert.equal(repeat.nextRetryAt,'2026-11-12T00:00:00.000Z');
  const recovered = await runTikTokApiDiscovery({...args,now:probeAt,previous:held,
    request:async()=>({ok:true,status:200,body:{data:[item],has_more:true}})});
  assert.equal(recovered.attemptedRequests,1);
  assert.equal(recovered.rows.length,1);
  assert.equal(recovered.nextRetryAt,'');
  assert.equal(recovered.boundedRetry,undefined);
});

test('a direct diagnostic can replace one obsolete browser-filter hold and preserves new provider deadlines', async () => {
  const failure = { status: 0, transportReason: 'request-policy-blocked' };
  const previous = { transport: 'public-browser-search', attemptedRequests: 1, searchRequests: 0, lastSearchResponse: null,
    nextRetryAt: '2026-11-11T20:00:00Z', boundedRetry: { reason: 'local-request-policy', failures: 2 }, errors: [failure] };
  const eligible = tikTokDirectProbePrevious(previous, now);
  assert.equal(eligible.nextRetryAt, '');
  assert.equal(previous.nextRetryAt, '2026-11-11T20:00:00Z');
  assert.deepEqual(eligible.boundedRetry, previous.boundedRetry);

  for (const variant of [
    { transport: 'direct-browser-search' },
    { searchRequests: 1 },
    { lastSearchResponse: { status: 200 } },
    { errors: [{ ...failure, retryAfter: '3600' }] },
    { errors: [{ status: 429, transportReason: 'response-http-error' }] },
    { errors: [{ status: 0, transportReason: 'response-timeout' }] },
    { boundedRetry: undefined },
  ]) {
    const held = { ...previous, ...variant };
    assert.equal(tikTokDirectProbePrevious(held, now), held);
  }

  const result = await runTikTokApiDiscovery({ keywords: ['a', 'b'], now, previous: eligible, wait: never,
    request: async () => ({ ok: false, status: 429, retryAfter: '172800' }) });
  assert.equal(result.attemptedRequests, 1);
  assert.equal(result.nextRetryAt, '2026-11-12T20:00:00.000Z');
  const direct = { ...result, transport: 'direct-browser-search' };
  assert.equal(tikTokDirectProbePrevious(direct, now), direct);
});

test('unclassified TikTok failures and legacy holds retain the conservative pause', async () => {
  const args = {keywords:['a','b'],normalize:normalizeTikTokApiItem,now,wait:never};
  const previous = {nextRetryAt:'2026-11-11T20:00:00.000Z',stoppedReason:'api-cooldown',errors:[]};
  const held = await runTikTokApiDiscovery({...args,previous,request:never});
  assert.equal(held.nextRetryAt,previous.nextRetryAt);
  assert.equal(held.boundedRetry,undefined);
  for (const failure of [
    {ok:false,status:0,transportReason:'no-search-request'},
    {ok:false,status:403,transportReason:'access-challenge'},
    {ok:false,status:0,transportReason:'request-policy-blocked',retryAfter:'invalid supplied value'},
  ]) {
    const result = await runTikTokApiDiscovery({...args,request:async()=>failure});
    assert.equal(result.nextRetryAt,'2026-11-11T20:00:00.000Z');
    assert.equal(result.boundedRetry,undefined);
  }
});

test('empty TikTok sample is bounded and later runs rotate rather than repeat the same keywords', async () => {
  const keywords=Array.from({length:9},(_,i)=>`food${i}`), attempted=[];
  const first=await runTikTokApiDiscovery({keywords,now,normalize:normalizeTikTokApiItem,request:async({keyword})=>{attempted.push(keyword);return valid([]);}});
  assert.equal(first.attemptedRequests,5);assert.equal(first.errors.length,0);
  assert.equal(first.stoppedReason,'empty-search-sample');assert.equal(first.nextRetryAt,'');
  assert.deepEqual(attempted,keywords.slice(0,5));
  attempted.length=0;
  await runTikTokApiDiscovery({keywords,now,previous:first,normalize:normalizeTikTokApiItem,request:async({keyword})=>{attempted.push(keyword);return valid([]);}});
  assert.equal(attempted[0],'food5');
});

test('TikTok separates unrecognized items, duplicates and accepted API candidates', async () => {
  const report=await fetchTikTokApiCandidates({waitForTimeout:async()=>{}},{keywords:['food'],now,
    request:async()=>valid([item,{item}, {user_info:{id:'123'}}])});
  assert.equal(report.rows.length,1);assert.equal(report.rawItems,3);
  assert.equal(report.normalizedItems,2);assert.equal(report.ignoredItems,1);
});

test('TikTok HTTP-200 search challenge stops fallback immediately and persists cooldown', async () => {
  let calls=0;
  const result=await discoverTikTokLinksViaDuckDuckGo({queries:['a','b'],now,sleep:never,
    fetcher:async()=>{calls++;return new Response('<form id="challenge-form">');}});
  assert.equal(calls,1);assert.equal(result.links.length,0);assert.equal(result.errors.length,1);
  const held=await discoverTikTokLinksViaDuckDuckGo({queries:['a','b'],now,previousReport:{search:result},fetcher:never,sleep:never});
  assert.equal(held.attemptedQueries,0);assert.equal(held.nextRetryAt,result.nextRetryAt);
});

test('DuckDuckGo challenge with verified absent Retry-After gets one probe after four hours', async () => {
  const challenge = async () => {
    throw Object.assign(new Error('Search challenge; no bypass attempted'), {httpStatus:403,retryAt:'',retryAfterProvided:false});
  };
  const options = {search:challenge,sleep:never};
  const queries = ['a','b','c'];
  const first = await runInstagramSearchQueries(queries,{...options,now});
  assert.equal(first.nextRetryAt,'2026-11-11T00:00:00.000Z');
  assert.equal(first.errors[0].retryAfterProvided,false);
  assert.deepEqual(first.boundedRetry,{reason:'challenge-without-retry-after',failures:1,failedAt:now.toISOString()});
  const held = await runInstagramSearchQueries(queries,{...options,now:new Date('2026-11-10T23:59:59.999Z'),
    previousReport:{search:first},search:never});
  assert.equal(held.attemptedQueries,0);
  assert.deepEqual(held.boundedRetry,first.boundedRetry);
  const probeAt = new Date(held.nextRetryAt);
  const repeat = await runInstagramSearchQueries(queries,{...options,now:probeAt,previousReport:{search:held}});
  assert.equal(repeat.attemptedQueries,1);
  assert.equal(repeat.boundedRetry.failures,2);
  assert.equal(repeat.nextRetryAt,'2026-11-12T00:00:00.000Z');
  const failedProbe = await runInstagramSearchQueries(queries,{...options,now:probeAt,previousReport:{search:held},
    search:async()=>{throw new Error('network unavailable');}});
  assert.equal(failedProbe.attemptedQueries,1);
  assert.equal(failedProbe.nextRetryAt,'2026-11-12T00:00:00.000Z');
  const recovered = await runInstagramSearchQueries(queries,{...options,now:probeAt,previousReport:{search:held},search:async query=>[query]});
  assert.deepEqual(recovered.candidates,['b']);
  assert.equal(recovered.nextRetryAt,'');
  assert.equal(recovered.boundedRetry,undefined);
});

test('DuckDuckGo preserves explicit Retry-After and holds when historical evidence is missing', async () => {
  const challenge = 'Search challenge; no bypass attempted';
  const cases = [
    [{message:challenge,retryAt:'2026-11-12T20:00:00.000Z',retryAfterProvided:true},'2026-11-12T20:00:00.000Z'],
    [{message:challenge,retryAt:'',retryAfterProvided:true},'2026-11-11T20:00:00.000Z'],
    [{message:challenge,retryAt:''},'2026-11-11T20:00:00.000Z'],
    [{message:'HTTP 403',retryAt:'',retryAfterProvided:false},'2026-11-11T20:00:00.000Z'],
  ];
  for (const [failure,nextRetryAt] of cases) {
    const result = await runInstagramSearchQueries(['a','b'],{now,sleep:never,search:async()=>{
      throw Object.assign(new Error(failure.message),{httpStatus:403,...failure});
    }});
    assert.equal(result.nextRetryAt,nextRetryAt);
    assert.equal(result.boundedRetry,undefined);
    assert.equal(result.attemptedQueries,1);
  }
  const previous = {nextRetryAt:'2026-11-11T20:00:00.000Z',errors:[],stoppedReason:'search-cooldown'};
  const held = await runInstagramSearchQueries(['a','b'],{now,sleep:never,previousReport:{search:previous},search:never});
  assert.equal(held.nextRetryAt,previous.nextRetryAt);
  assert.equal(held.boundedRetry,undefined);
});

test('TikTok web search uses the October site path and deduplicates permalinks', async () => {
  const queries=[];
  const url=`https://www.tiktok.com/@vienna.cafe/video/${item.id}`;
  const result=await discoverTikTokLinksViaDuckDuckGo({now,sleep:async()=>{},fetcher:async input=>{
    queries.push(new URL(input).searchParams.get('q'));
    return new Response(`<a class="result__a" href="${url}">food</a><a href="${url}">food</a>`);
  }});
  assert.equal(queries.length,25);
  assert.equal(queries[0], 'site:tiktok.com/@ wien gratis heute');
  assert.ok(queries.every(q => q.startsWith('site:tiktok.com/@ ')));
  assert.equal(new Set(queries).size,25);
  assert.deepEqual(result.links,[url]);
});

test('Instagram search reads nested result bodies and ignores unrelated links', () => {
  const page = '<div class="result"><div class="result__body"><a href="https://example.org">Fremd</a>'
    + '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.instagram.com%2Fvienna.cafe%2Freel%2FFreshStory01%2F">Wiener Kaffee</a>'
    + '<div class="result__snippet">Gratis <b>Kaffee</b> am Freitag</div></div></div>'
    + '<a href="https://www.instagram.com/p/FooterPost01/">Footer</a>'
    + '<div class="result"><a class="result__a" href="https://instagram.com.example/p/FakePost01/">Falscher Host</a></div>'
    + '<div class="result"><a class="result__a" href="https://example.org/?url=https://www.instagram.com/p/WrappedPost01/">Fremder Redirect</a></div>';
  assert.deepEqual(parseInstagramSearchResults(page), [{
    url: 'https://www.instagram.com/reel/FreshStory01/', title: 'Wiener Kaffee', snippet: 'Gratis Kaffee am Freitag',
  }]);
});

test('Instagram search reserves account slots, rotates topics, and never exceeds its existing cap', () => {
  const args={general:Array.from({length:60},(_,i)=>`site:instagram.com/reel wien food${i}`),
    accounts:[{username:'vienna.cafe'},{username:'kebab.wien'}],configured:['site:instagram.com wien pizza'],limit:6};
  const first=planInstagramQueries(args),second=planInstagramQueries({...args,bucket:1});
  assert.equal(first.length,6);assert.equal(new Set(first).size,6);
  assert.ok(first.some(q=>q.includes('"vienna.cafe"')));
  assert.ok(first.includes('site:instagram.com wien pizza'));
  assert.ok(first.every(q=>!q.includes('site:instagram.com/vienna.cafe')));
  assert.notDeepEqual(first,second);
  assert.deepEqual(planInstagramQueries({...args,limit:0}),[]);
});

test('Instagram search keeps reviewed food provenance and cannot resurrect moderated or non-food sources', () => {
  const accounts=loadWatchlist({watchlist:{accounts:[
    {username:'fixture_local',category:'food',priority:50},
    {username:'fixture_blocked_cafe',category:'food',priority:50,blockedByModeration:true},
    {username:'flugninja.at',category:'food',priority:100},
    {username:'fixture_software',category:'software',priority:100},
  ]},registry:{accounts:[
    {username:'fixture_local',priorityScore:100},
    {username:'fixture_blocked_cafe',priorityScore:100},
  ]}});
  const local=accounts.find(a=>a.username==='fixture_local');
  assert.equal(local.priority,100);assert.equal(local.foodSourceReason,'reviewed-food-watchlist');
  for (const name of ['fixture_blocked_cafe','flugninja.at','fixture_software']) assert.ok(!accounts.some(a=>a.username===name));
});

test('Instagram resumes after a blocked query without erasing or extending the pause', async () => {
  const queries=['a','b','c']; const attempts=[];
  const blocked=await runInstagramSearchQueries(queries,{now,sleep:never,search:async q=>{
    attempts.push(q);return readPublicSearchResponse(new Response('<div class="anomaly-modal">',{headers:{'Retry-After':'86400'}}),now);
  }});
  assert.equal(blocked.nextQueryIndex,1);
  const held=await runInstagramSearchQueries(queries,{now,previousReport:{search:blocked},search:never,sleep:never});
  assert.equal(held.nextQueryIndex,1);assert.equal(held.nextRetryAt,blocked.nextRetryAt);
  attempts.length=0;
  await runInstagramSearchQueries(queries,{now:new Date(blocked.nextRetryAt),previousReport:{search:held},sleep:async()=>{},search:async q=>{attempts.push(q);return [];}});
  assert.deepEqual(attempts,['b','c','a']);
});
