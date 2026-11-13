import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  allowedCouponAsset,discoverCouponMedia,fetchCouponAsset,parsePdfImageList,
  couponCardOffer,extractCouponMediaOffers,readCouponAsset,
} from '../scraper/official-coupon-media.js';
import {POWER_FOOD_SOURCES,isAllowedFoodUrl} from '../scraper/power-food-sources.js';
import {verifyOfficialFoodDeal} from '../scraper/power-food-verification.js';
import {crawlFoodSource} from '../scraper/power-food-crawler.js';
import {applyCardEditorial} from '../scraper/deal-card-editor.js';
import {reviewedRestaurantCards, allowedRestaurantCouponAsset} from '../scraper/reviewed-restaurant-coupons.js';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
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
const restaurantDocument = JSON.parse(fs.readFileSync(new URL('../reviews/restaurant-coupon-documents.json', import.meta.url))).documents[0];
const restaurantSource = POWER_FOOD_SOURCES.find(s=>s.name==='Mömax Restaurant');
const restaurantAsset = {kind:'pdf',format:'reviewed-restaurant-v1',url:restaurantDocument.url,sha256:restaurantDocument.sha256};
const restaurantHtml = `<a href="${restaurantAsset.url}">Exklusive Angebote des Monats</a>`;
const nordseeCapture = JSON.parse(fs.readFileSync(new URL('./fixtures/nordsee-coupon-ocr-20261113.json', import.meta.url)));
const nordseeReview = JSON.parse(fs.readFileSync(new URL('../reviews/nordsee-coupon-cards-20261113.json', import.meta.url)));

const fakeCouponCommand = (command,args) => ({stdout:command==='ffprobe'
  ? JSON.stringify({streams:[{width:800,height:740}]})
  : command==='ffmpeg' && args.includes('rawvideo') ? Buffer.alloc(800*740*3)
    : command==='tesseract' ? 'readable text' : ''});
test('coupon deadline expires before the first subprocess without starting any tool',async()=>{
  let ticks=0,calls=0;
  await assert.rejects(readCouponAsset({kind:'image'},data,{now:()=>ticks++?180000:0,
    execute:async()=>{calls++;return {stdout:''};}}),/coupon-ocr-total-time-limit/);
  assert.equal(calls,0);
});
test('a late probe cannot start a new full-image hash phase',async()=>{
  let clock=0;const calls=[];
  await assert.rejects(readCouponAsset({kind:'image'},data,{now:()=>clock,
    execute:async(command,args,options)=>{calls.push({command,timeout:options.timeout});clock=180001;return fakeCouponCommand(command,args);}}),/coupon-ocr-total-time-limit/);
  assert.deepEqual(calls,[{command:'ffprobe',timeout:20000}]);
});
test('full-image hash timeout is capped by the remaining budget and late pixels are discarded',async()=>{
  let clock=0;const calls=[];
  await assert.rejects(readCouponAsset({kind:'image'},data,{now:()=>clock,
    execute:async(command,args,options)=>{
      calls.push({command,timeout:options.timeout});clock=calls.length===1?179999:180000;
      return fakeCouponCommand(command,args);
    }}),/coupon-ocr-total-time-limit/);
  assert.deepEqual(calls,[{command:'ffprobe',timeout:20000},{command:'ffmpeg',timeout:1}]);
});
test('last OCR phase receives only remaining time and cannot return a late coupon',async()=>{
  let clock=0;const calls=[];
  await assert.rejects(readCouponAsset({kind:'image'},data,{now:()=>clock,
    execute:async(command,args,options)=>{
      calls.push({command,timeout:options.timeout});
      if(calls.length===9)clock=179990;
      if(calls.length===10)clock=180000;
      return fakeCouponCommand(command,args);
    }}),/coupon-ocr-total-time-limit/);
  assert.equal(calls.length,10);assert.deepEqual(calls.at(-1),{command:'tesseract',timeout:10});
});
test('final file hashing cannot return a card after the total deadline',async()=>{
  let calls=0,finished=false,checks=0;
  await assert.rejects(readCouponAsset({kind:'image'},data,{now:()=>finished?(++checks>=3?180000:179999):0,
    execute:async(command,args)=>{if(++calls===10)finished=true;return fakeCouponCommand(command,args);}}),/coupon-ocr-total-time-limit/);
  assert.equal(calls,10);assert.equal(checks,3);
});
test('PDF inspection and extraction share the same deadline as image OCR',async()=>{
  let clock=0;const calls=[];
  await assert.rejects(readCouponAsset({kind:'pdf'},data,{now:()=>clock,
    execute:async(command,args,options)=>{
      calls.push({command,timeout:options.timeout});clock=calls.length===1?179999:180000;
      return {stdout:command==='pdfinfo'?'Pages: 1\n':'1 0 image 800 740 rgb 3 8 jpeg no 1 0 300 300 342K 20%'};
    }}),/coupon-ocr-total-time-limit/);
  assert.deepEqual(calls,[{command:'pdfinfo',timeout:20000},{command:'pdfimages',timeout:1}]);
});

test('seven exact reviewed November cards recover without changing the four readable coupon IDs',()=>{
  const at = new Date('2026-11-13T20:00:00Z');
  const recovered = nordseeCapture.cards.map(c => couponCardOffer(c,asset,source,at));
  assert.equal(recovered.filter(r=>r.deal).length,11);
  for (const index of [3,4,6,10]) {
    const c = nordseeCapture.cards[index];
    const original = couponCardOffer({...c,pixelSha256:undefined},asset,source,at).deal;
    assert.deepEqual(recovered[index].deal,original);
  }
  assert.equal(new Set(recovered.map(r=>r.deal.id)).size,11);
  for (const index of [0,1,2,5,7,8,9]) {
    const d=recovered[index].deal;
    assert.equal(d.evidence.extractionMethod,'official-reviewed-coupon-card');
    assert.equal(d.validUntil,'2026-11-30');
    assert.ok(d.reviewRequired);
    assert.equal(d.price,undefined);
    assert.match(d.description,/Nicht gültig an Autobahnraststätten/);
    assert.match(d.description,/teilnehmenden Restaurants in Österreich/);
    assert.equal(couponCardOffer(nordseeCapture.cards[index],asset,source,new Date('2026-12-01T12:00:00Z')).deal,undefined);
  }
  assert.match(recovered[1].deal.description,/0,25 EUR Pfand/);
  assert.match(recovered[1].deal.title,/Softdrink 0,5 l PET/);
  assert.match(recovered[2].deal.title,/2 Bremer, 2 Backfisch-Baguettes, 1 Fish & Chips/);
  assert.match(recovered[9].deal.title,/2 Menüs.*Schollenfilet.*oder Alaska-Seelachsfilet.*1 Softdrink 0,2 l/);
});
test('reviewed card fallback requires exact full-image identity and its original official source',()=>{
  const c=nordseeCapture.cards[1],at=new Date('2026-11-13T20:00:00Z');
  for(const changed of [{...c,pixelSha256:undefined},{...c,pixelSha256:'a'.repeat(64)}])
    assert.equal(couponCardOffer(changed,asset,source,at).deal,undefined);
  for(const changedAsset of [{...asset,url:'https://evil.test/at/coupons/pdf'},{...asset,url:'https://www.nordsee.com/de/coupons/pdf'}, {...asset,metadataExpiry:'2026-11-12'}])
    assert.equal(couponCardOffer(c,changedAsset,source,at).deal,undefined);
  for(const changedSource of [{...source,couponMedia:undefined},{...source,url:'https://www.nordsee.com/de/coupons'}])
    assert.equal(couponCardOffer(c,asset,changedSource,at).deal,undefined);
});
test('real PNG and JPEG cards produce the reviewed full-pixel fingerprints locally', async t=>{
  if (['ffmpeg','ffprobe','tesseract'].some(command=>spawnSync(command,['-version']).error)) {
    assert.notEqual(process.env.REQUIRE_COUPON_PIXEL_TEST,'1','Real coupon tools are required for the Linux fingerprint contract');
    t.skip('Optional local coupon tools absent; semantic and hash-bound policy tests still run');return;
  }
  for(const [name,index] of [['card-000.png',0],['card-005.jpg',5]]) {
    const data=fs.readFileSync(new URL('./fixtures/nordsee-coupons-20261113/'+name,import.meta.url));
    const [actual]=await readCouponAsset({kind:'image',url:image},data);
    assert.equal(actual.pixelSha256,nordseeCapture.cards[index].pixelSha256,name);
    assert.ok(nordseeReview.cards.some(c=>c.pixelSha256===actual.pixelSha256));
  }
  const original=fs.readFileSync(new URL('./fixtures/nordsee-coupons-20261113/card-000.png',import.meta.url));
  const encode=filter=>{
    const encoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-i','pipe:0',
      ...(filter?['-vf',filter]:[]),'-frames:v','1','-pix_fmt','rgb24','-f','image2pipe','-c:v','png','pipe:1'],
    {input:original,maxBuffer:8000000});
    assert.equal(encoded.status,0,String(encoded.stderr));return encoded.stdout;
  };
  const [reencoded]=await readCouponAsset({kind:'image',url:image},encode());
  assert.equal(reencoded.pixelSha256,nordseeCapture.cards[0].pixelSha256,'PNG encoding does not change coupon facts');
  const [changed]=await readCouponAsset({kind:'image',url:image},encode('drawbox=x=0:y=0:w=1:h=1:color=white:t=fill'));
  assert.notEqual(changed.pixelSha256,nordseeCapture.cards[0].pixelSha256,'Even one changed pixel prevents the reviewed fallback');
  assert.equal(couponCardOffer({...changed,footer:'unreadable'},asset,source,new Date('2026-11-13T20:00:00Z')).deal,undefined);
});

test('restaurant PDF transport only accepts its dedicated Austrian CDN paths',()=>{
  assert.ok(allowedRestaurantCouponAsset(restaurantAsset.url,'pdf'));
  for(const url of [restaurantAsset.url+'?redirect=evil',restaurantAsset.url+'#x',restaurantAsset.url.replace('https:','http:'),restaurantAsset.url.replace('moemax.a.bigcontent.io','other.a.bigcontent.io'),restaurantAsset.url.replace('at_dvat','de_dvat')]) assert.equal(allowedRestaurantCouponAsset(url,'pdf'),false,url);
  assert.equal(allowedRestaurantCouponAsset(restaurantAsset.url,'image'),false);
});
test('reviewed restaurant facts require exact current document identity; changed documents held',()=>{
  const cards=reviewedRestaurantCards(restaurantAsset);
  assert.equal(cards.length,5);
  assert.equal(new Set(cards.map(c=>c.title)).size,5);
  assert.match(cards[1].title,/5,50/);
  assert.match(cards[1].footer,/Abholpreise.*Pro Person ein Gutschein.*vorzeigen und abgeben.*Vorrat/);
  assert.ok(cards.every(c=>!/Stiegl|Bier|After Work/i.test(c.footer)));
  assert.throws(()=>reviewedRestaurantCards({...restaurantAsset,sha256:'a'.repeat(64)}),/needs-review/);
  assert.throws(()=>reviewedRestaurantCards({...restaurantAsset,url:restaurantAsset.url.replace('44-6','45-6')}),/needs-review/);
});
test('Mömax offers require linked reviewed PDF, not normal menu prices or an arbitrary merchant',async()=>{
  assert.equal(discoverCouponMedia(restaurantHtml,restaurantSource).length,1);
  assert.deepEqual(discoverCouponMedia(restaurantHtml,{...restaurantSource,couponMedia:undefined}),[]);
  assert.deepEqual(discoverCouponMedia(restaurantHtml,restaurantSource,'https://evil.test'),[]);
  const {extractFoodOffers}=await import('../scraper/power-food-extraction.js');
  assert.equal(extractFoodOffers('<h2>Burger für 5 €</h2><p>Aktionspreis für Möbelkunden!</p>',restaurantSource).deals.length,0);
});
test('all five restaurant coupons preserve dates and conditions, expiry rejects them',()=>{
  for(const c of reviewedRestaurantCards(restaurantAsset)) {
    const {deal}=couponCardOffer(c,restaurantAsset,restaurantSource,new Date('2026-11-11T12:00Z'));
    assert.ok(deal,c.title);
    assert.equal(deal.validFrom,'2026-11-02');
    assert.equal(deal.validUntil,'2026-11-30');
    assert.equal(deal.category,'essen');
    assert.ok(deal.reviewRequired);
    assert.equal(deal.evidence.restaurantLocations.addresses.length,4);
    assert.equal(couponCardOffer(c,restaurantAsset,restaurantSource,new Date('2026-12-01T12:00Z')).deal,undefined);
  }
});
test('unknown restaurant PDF is deferred without OCR, AI, retries or pretending no offers',async()=>{
  let reads=0;
  const r=await crawlFoodSource(restaurantSource,{now:new Date('2026-11-11T12:00Z'),
    fetchPage:async()=>({html:restaurantHtml,finalUrl:restaurantSource.url}),
    couponMedia:{fetchAsset:async()=>{reads++;return Buffer.from('%PDF-unknown');}}});
  assert.equal(reads,1);assert.equal(r.rows.length,0);
  assert.equal(r.pages[0].status,'needs-review');
  assert.equal(r.pages[0].media[0].error,'coupon-document-needs-review');
  assert.notEqual(r.operationalStatus,'no-offers');
});
test('blocked restaurant root cannot be bypassed by directly fetching the PDF',async()=>{
  let pdfCalls=0;
  const r=await crawlFoodSource(restaurantSource,{fetchPage:async()=>{throw Object.assign(new Error('HTTP 403'),{status:403});},
    couponMedia:{fetchAsset:async()=>{pdfCalls++;return data;}}});
  assert.equal(pdfCalls,0);assert.equal(r.rows.length,0);assert.equal(r.pages.length,1);
});

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
test('editorial coupon titles survive approval only with the same complete offer facts',async()=>{
  const c={...card,benefit:'nur 7 49',discount:'MEHR ALS 19% RABATT'};
  const {deal}=couponCardOffer(c,asset,source,now);
  const title='Mehr als 19 % Rabatt auf 2 Alaska-Seelachsfilets gebacken & Beilage';
  const edited=applyCardEditorial(deal,{title,titleEvidence:deal.description},{titleVerified:true,now});
  assert.equal(edited.title,title);
  const options={now,fetchPage:async()=>({html,finalUrl:source.url}),couponMedia:{...mocks,readAsset:async()=>[c]}};
  assert.equal((await verifyOfficialFoodDeal(edited,options)).ok,true);
  for(const altered of [
    {...edited,title:title.replace('19','29')},
    {...edited,title:title.replace('Mehr als ','')},
    {...edited,title:title.replace('2 Alaska','3 Alaska')},
    {...edited,title:title.replace(' & Beilage','')},
    {...edited,title:title+' ohne Gutschein'},
    {...edited,description:edited.description.replace('Nicht gültig an Autobahnraststätten.','')},
  ]) assert.equal((await verifyOfficialFoodDeal(altered,options)).ok,false);
  const baguette={...card,footer:card.footer.replace('2 Alaska-Seelachsfilets\ngebacken & Beilage','2 Backfisch-Baguettes\nKalt oder heiss')};
  const {deal:b}=couponCardOffer(baguette,asset,source,now);
  assert.equal((await verifyOfficialFoodDeal({...b,title:b.title.replace('Kalt oder heiss','kalt oder heiß')},{...options,couponMedia:{...mocks,readAsset:async()=>[baguette]}})).ok,true);
});
