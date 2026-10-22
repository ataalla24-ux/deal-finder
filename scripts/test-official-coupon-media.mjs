import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  allowedCouponAsset,discoverCouponMedia,fetchCouponAsset,parsePdfImageList,
  couponCardOffer,extractCouponMediaOffers,
} from '../scraper/official-coupon-media.js';
import {POWER_FOOD_SOURCES,isAllowedFoodUrl} from '../scraper/power-food-sources.js';
import {verifyOfficialFoodDeal} from '../scraper/power-food-verification.js';
import {crawlFoodSource} from '../scraper/power-food-crawler.js';
const source = POWER_FOOD_SOURCES.find(s=>s.name==='NORDSEE');
const now = new Date('2026-10-23T12:00:00Z');
const url = source.url+'/pdf';
const image = 'https://www.nordsee.com/assets/img/console/appUser/news/1496_view_at.jpg';
const html = `<a href="${url}">Gutscheine</a>`;
const card = {index:0,footer:'2 Alaska-Seelachsfilets\ngebacken & Beilage\nGültig bis 30.11.2026 in allen teilnehmenden\nRestaurants in Österreich. Nicht gültig an\nAutobahnraststätten. Serviervorschlag',benefit:'1+1\nGRATIS',discount:'50%',side:''};
const data = Buffer.from('%PDF-fixture');
card.sha256 = crypto.createHash('sha256').update('unchanged coupon pixels').digest('hex');
const asset = {kind:'pdf',url,sha256:crypto.createHash('sha256').update(data).digest('hex')};
const mocks = {fetchAsset:async()=>data,readAsset:async()=>[card]};

test('asset allowlist is separate from HTML URL policy',()=>{
  assert.ok(allowedCouponAsset(url,'pdf'));
  assert.ok(allowedCouponAsset(image,'image'));
  assert.equal(isAllowedFoodUrl(url,source),false);
  for (const value of ['http://www.nordsee.com/at/coupons/pdf','https://evil.test/at/coupons/pdf',url+'?next=evil',url+'#x','https://user@www.nordsee.com/at/coupons/pdf','https://127.0.0.1/at/coupons/pdf']) assert.equal(allowedCouponAsset(value,'pdf'),false,value);
  assert.equal(allowedCouponAsset(image.replace('.jpg','.svg'),'image'),false);
});
test('only opt-in current merchant page links become assets; scripts are never executed',()=>{
  assert.equal(discoverCouponMedia(html,source).length,1);
  assert.deepEqual(discoverCouponMedia(html,{...source,couponMedia:undefined}),[]);
  assert.deepEqual(discoverCouponMedia(html,source,'https://evil.test'),[]);
  const payload = {promo:{a:{title:'Alaska-Seelachsfilet 1+1',img:{detail:image}}}};
  const literal = JSON.stringify(JSON.stringify(payload)).slice(1,-1);
  const script = `var dati_pagina = JSON.parse('${literal}');`;
  assert.equal(discoverCouponMedia(script,source)[0].url,image);
  assert.deepEqual(discoverCouponMedia("var dati_pagina = JSON.parse(''); globalThis.COMPROMISED=true;",source),[]);
  assert.equal(globalThis.COMPROMISED,undefined);
});
test('PDF images are bounded and rejected rather than merging unsupported layouts',()=>{
  const line = '1 0 image 800 740 rgb 3 8 jpeg no 1 0 300 300 342K 20%';
  assert.equal(parsePdfImageList(line).length,1);
  for (const text of ['',line.replace('800 740','9000 8000'),line.replace('image','smask'),Array(13).fill(line).join('\n')]) assert.throws(()=>parsePdfImageList(text));
});
test('transport rejects redirects, MIME tricks, oversized streams and false magic',async()=>{
  let calls=0;
  await assert.rejects(fetchCouponAsset(asset,{fetch:async()=>{calls++;return new Response('',{status:302,headers:{location:'http://127.0.0.1'}})}}));
  assert.equal(calls,1);
  for (const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response('fake',{headers:{'content-type':'application/pdf'}}),new Response(data,{headers:{'content-type':'application/pdf','content-length':'9000000'}}),new Response(Buffer.alloc(8388609),{headers:{'content-type':'application/pdf'}})]) await assert.rejects(fetchCouponAsset(asset,{fetch:async()=>response}));
  assert.deepEqual(await fetchCouponAsset(asset,{fetch:async()=>new Response(data,{headers:{'content-type':'application/pdf'}})}),data);
});
test('one card preserves product, coupon, expiry, territory and exclusions',()=>{
  const {deal}=couponCardOffer(card,asset,source,now);
  assert.equal(deal.type,'bogo');
  assert.equal(deal.category,'essen');
  assert.equal(deal.validUntil,'2026-11-30');
  assert.match(deal.title,/2 Alaska-Seelachsfilets gebacken & Beilage: 1\+1 gratis/);
  assert.match(deal.description,/Nicht gültig an Autobahnraststätten/);
  assert.ok(deal.reviewRequired);
  assert.equal(deal.evidence.media.sha256,asset.sha256);
  assert.equal(deal.price,undefined);
});
test('expired, yearless, foreign, unreadable, alcohol and conflicting coupons fail closed',()=>{
  for (const c of [
    {...card,footer:card.footer.replace('30.11.2026','18.10.2026')},
    {...card,footer:card.footer.replace('.2026','')},
    {...card,footer:card.footer.replace('Österreich','Deutschland')},
    {...card,footer:card.footer.replace('Autobahnraststätten','???')},
    {...card,benefit:'unreadable'},
    {...card,footer:card.footer.replace('Beilage','Beilage und Bier')},
    {...card,footer:card.footer.replace('Beilage','Beilage + Softdrink 0,21')},
  ]) assert.equal(couponCardOffer(c,asset,source,now).deal,undefined);
  assert.equal(couponCardOffer(card,{...asset,metadataExpiry:'2026-10-18'},source,now).deal,undefined);
});
test('percent discounts and deposit conditions stay exact; no superscript price guessing',()=>{
  const c={...card,benefit:'nur 13 49',discount:'MEHR ALS 20% RABATT',side:'zzgl. 0,25 EUR Pfand'};
  const {deal}=couponCardOffer(c,asset,source,now);
  assert.match(deal.title,/Mehr als 20 % Rabatt/);
  assert.match(deal.description,/0,25 EUR Pfand/);
  assert.doesNotMatch(deal.title,/13/);
  assert.equal(couponCardOffer({...c,discount:'EHR ALS 20% RABATT'},asset,source,now).deal,undefined);
});
test('PDF is one request, missing tools are reported and cannot use a paid fallback',async()=>{
  let requests=0;
  const r=await extractCouponMediaOffers(html,source,{now,...mocks,fetchAsset:async()=>{requests++;return data}});
  assert.equal(requests,1);assert.equal(r.deals.length,1);assert.equal(r.assets[0].cards,1);
  const fail=await extractCouponMediaOffers(html,source,{now,...mocks,readAsset:async()=>{throw new Error('ENOENT tesseract')}});
  assert.equal(fail.deals.length,0);assert.equal(fail.assets[0].status,'error');
});
test('collector records media failures, exact evidence survives repeat verification',async()=>{
  const fetchPage=async()=>({html,finalUrl:source.url});
  const r=await crawlFoodSource(source,{now,fetchPage,couponMedia:mocks});
  assert.equal(r.rows.length,1);
  assert.equal((await verifyOfficialFoodDeal(r.rows[0],{now,fetchPage,couponMedia:mocks})).ok,true);
  const failure=await crawlFoodSource(source,{now,fetchPage,couponMedia:{...mocks,readAsset:async()=>{throw new Error('missing tools')}}});
  assert.equal(failure.operationalStatus,'degraded');
});
test('unlinked documents, changed bytes, forged text, hash and dates do not gain trust',async()=>{
  const r=await extractCouponMediaOffers(html,source,{now,...mocks});
  const d=r.deals[0]; const fetchPage=async()=>({html,finalUrl:source.url});
  for (const modified of [{...d,title:'Free everything'}, {...d,evidence:{...d.evidence,media:{...d.evidence.media,cardSha256:'forged'}}}]) assert.equal((await verifyOfficialFoodDeal(modified,{now,fetchPage,couponMedia:mocks})).ok,false);
  assert.equal((await verifyOfficialFoodDeal(d,{now,fetchPage:async()=>({html:'removed',finalUrl:source.url}),couponMedia:mocks})).ok,false);
  assert.equal((await verifyOfficialFoodDeal(d,{now,fetchPage,couponMedia:{...mocks,fetchAsset:async()=>Buffer.from('%PDF-new-creation-date')}})).ok,true);
  assert.equal((await verifyOfficialFoodDeal(d,{now,fetchPage,couponMedia:{...mocks,readAsset:async()=>[{...card,sha256:'b'.repeat(64)}]}})).ok,false);
  const verified=await verifyOfficialFoodDeal({...d,validUntil:'2030-01-01'},{now,fetchPage,couponMedia:mocks});
  assert.equal(verified.deal.validUntil,'2026-11-30');
});
