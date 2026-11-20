import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redemptionPageHash, checkDueRedemptionPages } from './food-redemption-sources.mjs';
import { refreshFoodRedemptions } from './refresh-food-redemptions.mjs';
import { refreshMaintenanceEvidence } from './refresh-maintenance-evidence.mjs';

const now = new Date('2026-11-21T03:00:00Z');
const previous = '2026-11-20T13:00:00.000Z';
const expiry = '2026-11-21T13:00:00.000Z';
const pages = [
  ['fc4g-vqsqje','https://www.ikea.com/at/de/stores/wien-nord/','58402bd0-5b5e-11f1-84e8-610f7e0a7507'],
  ['g2-1gkjf0g','https://www.ikea.com/at/de/stores/wien-westbahnhof/ikea-wien-westbahnhof-angebote-pub1aba7a60/','a14d49a0-d374-11f1-8bcc-a554c95fee7d'],
  ['b1-s5vhj5','https://www.ikea.com/at/de/ikea-family/benefits/','ec664fe0-9e91-11f0-8921-4f656ee14915'],
];
const live = pages.map(([id,url]) => ({ id,url,brand:'IKEA',title:id,description:'Terms' }));
const bodies = Object.fromEntries(pages.map(([id,url,block]) => [url,
  `<html><head><link rel="canonical" href="${url}"><meta property="og:url" content="${url}"></head><body><main><section><div id="${block}"><h2>${id}</h2><p>Die Aktion.</p></div></section></main></body></html>`]));
const manifest = { reviews: live.map(d => ({dealId:d.id, sourceUrl:d.url, expectedTitle:d.title, expectedDescription:d.description,
  method:'onsite', verifiedAt:previous, reviewUntil:expiry, recheck:{kind:'official-food-page',url:d.url,contentHash:redemptionPageHash(d,bodies[d.url],d.url)}})) };
const check = (state, getPage, options={}) => {
  let calls = 0;
  return checkDueRedemptionPages({ live, manifest, state, now, getPage: async url => {calls++;return getPage(url);},
    getRobots: async () => {calls++; return 'User-agent: *\nAllow: /';}, remaining: () => 5-calls, ...options });
};
const good = url => ({html:bodies[url],finalUrl:url,status:200});
test('scheduled reader shares one robots read, three offer slots, and renews the currently signed page only', async () => {
  const state = {};
  const seen = await check(state,good);
  assert.deepEqual(seen,live.map(d=>d.url));
  assert.deepEqual(Object.values(state.pages).map(x=>x.status),['matched','matched','matched']);
  const result = refreshFoodRedemptions(manifest,live,[],+now,state.pages);
  assert.ok(result.reviews.every(r=>r.verifiedAt===now.toISOString()));
  assert.deepEqual(await check(state, () => assert.fail('repeat')),[]);
  assert.deepEqual(await check({}, () => assert.fail('far from review expiry'),{now:new Date(previous)}),[]);
});
test('changed, hidden, redirected, and missing pages cannot extend a review', async () => {
  for (const transform of [s=>s.replace('Die Aktion.','Nur mit Mitgliedschaft.'),s=>s.replace('<section>','<section hidden>'),
    s=>s.replace('rel="canonical"','rel="unrelated"'),s=>s.replace('<main>','<aside>')]) {
    const state = {}; await check(state,url=>({...good(url),html:transform(bodies[url])}));
    assert.ok(Object.values(state.pages).every(x=>x.status==='changed'));
    assert.ok(refreshFoodRedemptions(manifest,live,[],+now,state.pages).reviews.every(r=>r.reviewUntil===now.toISOString()));
  }
  for (const status of [404,410,503,429]) {
    const state={}; await check(state,()=>{throw Object.assign(Error('HTTP'),{httpStatus:status,retryAfter:'90000'});});
    const result = refreshFoodRedemptions(manifest,live,[],+now,state.pages);
    const proof = Object.values(state.pages)[0];
    if ([404,410].includes(status)) {assert.equal(proof.status,'changed');assert.equal(result.reviews[0].reviewUntil,now.toISOString());}
    else {assert.equal(proof.status,'unavailable');assert.deepEqual(result,manifest);}
    if (status===429) { assert.equal(Object.keys(state.pages).length,1);assert.equal(state.pauses['https://www.ikea.com'],'2026-11-22T04:00:00.000Z'); }
  }
  const state={}; await check(state, url=>({...good(url),finalUrl:'https://other.example/'}));assert.equal(state.pages[live[0].id].status,'unavailable');
});
test('robots denial, active source pause and unknown source destinations make zero page requests', async () => {
  const state={}; const never=()=>assert.fail('page request');
  assert.deepEqual(await check(state,never,{getRobots:async()=>'User-agent: *\nDisallow: /'}),[]);
  assert.deepEqual(await check({},never,{paused:()=>true,getRobots:never}),[]);
  const changed = structuredClone(manifest); for(const r of changed.reviews)r.recheck.url='https://other.example/';
  assert.deepEqual(await check({},never,{manifest:changed,getRobots:never}),[]);
});
test('same-source PDF collection needs every matched card from one observed document', () => {
  const cards = ['a','b'].map((hash,index)=>({id:'card'+index,brand:'NORDSEE',url:'https://www.nordsee.com/at/coupons',
    originSource:'power-official-food',evidence:{source:'official-merchant-page',sourceUrl:'https://www.nordsee.com/at/coupons',
      merchantSourceKey:'NORDSEE',checkedAt:now.toISOString(),offerTiming:{validUntil:'2026-11-30'},
      media:{kind:'pdf',url:'https://www.nordsee.com/at/coupons/pdf',index,sha256:'pdf-hash',cardSha256:hash}}}));
  const d = {...live[0],brand:'NORDSEE',url:cards[0].url};
  const r = {...manifest.reviews[0],sourceUrl:d.url,method:'provider_coupon',url:cards[0].evidence.media.url,
    recheck:{kind:'official-coupon-pdf',merchant:'NORDSEE',validUntil:'2026-11-30',endExclusive:'2026-11-30T23:00:00.000Z',cardHashes:['a','b']}};
  const run = p=>refreshFoodRedemptions({reviews:[r]},[d],p,+now).reviews[0];
  assert.equal(run(cards).verifiedAt,now.toISOString());assert.equal(run(cards.slice(0,1)),r);
  const different=structuredClone(cards);different[0].evidence.media.cardSha256='changed';assert.equal(run(different).reviewUntil,now.toISOString());
  different[0].evidence.media.sha256='different-print';assert.equal(run(different),r);
});
test('real maintenance entry point shares overall five-request, four-offer ceiling with other work', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ff-route-budget-'));
  try {
    for(const dir of ['reviews','docs'])fs.mkdirSync(path.join(root,dir));
    const other={id:'drei',url:'https://www.drei.at/de/dreiplus/ersparnisse/nordsee/',brand:'NORDSEE',description:'',title:'Wrap'};
    fs.writeFileSync(path.join(root,'docs/deals.json'),JSON.stringify({deals:[...live,other]}));
    fs.writeFileSync(path.join(root,'reviews/deal-redemptions.json'),JSON.stringify(manifest));
    const urls=[];
    const result=await refreshMaintenanceEvidence({root,now,renewRedemptions:true,apply:false,
      fetchImpl:async url=>{urls.push(url);return new Response('User-agent: *\nAllow: /',{headers:{'content-type':'text/plain'}});},
      fetchPage:async url=>{urls.push(url);return good(url);}});
    assert.equal(urls.length,5);assert.equal(result.report.offerPageAttempts,4);assert.equal(result.report.sourceRequests,5);
    assert.equal(urls.at(-1),other.url);assert.equal(Object.keys(result.cache.foodRedemptions.pages).length,3);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
