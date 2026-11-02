import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CARRIER_SOURCES, CARRIER_DETAIL_SOURCES, isCarrierUrl, parseDreiListing, parseDreiDetail, parseCarrierTeasers, parseCarrierDetail,
  createCarrierFetcher, collectCarrierBenefits, verifyCarrierBenefit, readCarrierPauses, recordCarrierPauses } from '../scraper/carrier-benefits.js';
import { mergeCarrierPending } from '../scraper/member-benefits-scraper.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { normalizeDeal as normalizeForSlack, buildSlackMessage, filterDuplicateDealsInRun, filterRecentlySeenDeals,
  addSeenDealsFromThread, loadLiveDealDuplicateKeys, filterAlreadyQueuedDeals } from '../scraper/slack-notify.js';
import { normalizeDeal as normalizeApproved } from '../scraper/slack-approve.js';

const now = new Date('2026-11-02T10:00:00Z');
const url = 'https://www.drei.at/de/dreiplus/ersparnisse/pizza-mann/';
const terms = 'Aktion 2 + 1 gratis: Die günstigste oder wertgleiche Pizza ist gratis. Family Pizza und Pizza der Woche ausgenommen. Gültig bis auf Widerruf. Bei Zustellung nicht gültig in 1210, 1220 und 6020, Abholung in allen Filialen Österreichs. Nicht an Feiertagen, nicht in der Pizza-Mann-App, nicht kombinierbar. Pro Bestellung ein Code; Zustellgebühr 3,90 €.';
const detail = ({ brand='Pizza Mann', offer='Jeden Donnerstag gibt’s 2 + 1 Pizza gratis', conditions=terms }={}) => `<main>
  <div class="text-element"><p><a href="/de/dreiplus/">Drei Plus</a>/ ${brand}</p><h1>Dein Plus.</h1><p class="text-primary">Ein Vorteil.</p><ul><li>${offer}</li><li>In allen Filialen Österreichs</li></ul></div>
  <div class="text-element"><h2>So funktioniert's</h2><p>Sende eine gratis SMS mit pizza an 5353. Dein persönlicher Code kommt per SMS.</p></div>
  <div class="text-element"><p>${conditions}</p></div>
  <div class="text-element"><h2>Für alle, die noch mehr Vorteile wollen</h2><p>Andere Werbung</p></div>
  </main><footer>Fremde Aktion bis 1.1.2020</footer>`;
const listing = (href='/de/dreiplus/ersparnisse/pizza-mann/') => `<div class="column-element__content"><div class="column-element__text"><h2>Pizzamann.</h2><p>Deine gratis Extra-Pizza jeden Donnerstag.</p></div><div class="column-element__button"><a href="${href}">Mehr</a></div></div>`;
const parse = html => parseDreiDetail(html, url, { now });
const hot = '<main>Nach erfolgreichem Abschluss der Rufnummernübertragung zu HoT und der anschließenden Buchung eines Tarifpakets erhalten Sie einmalig per E-Mail einen HOFER Gutschein im Wert von 10 Euro geschenkt. Pro Rufnummer einmalig nach der ersten Portierung; erneute Portierung ausgeschlossen. Pro Person werden maximal 5 Gutscheine ausgegeben.</main>';
const response = (body, opts={}) => new Response(body, { headers:{'content-type':'text/html'},...opts });

test('strict carrier URL allowlist rejects foreign hosts, login, API, B2B and malformed paths', () => {
  assert.equal(isCarrierUrl(url), true);
  for (const bad of [url+'?x=1', url+'#x',url.replace('https:', 'http:'),url.replace('www.drei.at','www.drei.at.evil.test'),url.replace('www.drei.at','user@www.drei.at'),'https://www.drei.at/n/api/','https://www.drei.at/de/dreiplus/ersparnisse/hellocash/','https://www.a1.net/login']) assert.equal(isCarrierUrl(bad), false, bad);
});

test('listing scopes real offer cards and dedupes their detail URL', () => {
  assert.deepEqual(parseDreiListing(listing()+listing()+listing('https://evil.test/a')), [{url,brand:'Pizzamann',offer:'Deine gratis Extra-Pizza jeden Donnerstag.'}]);
  assert.deepEqual(parseDreiListing(listing().replace('gratis Extra-Pizza','neue Auswahl')), []);
});

test('full terms and quantities survive without fake votes, publication, expiry or private code', () => {
  const d = parse(detail()).deal;
  assert.equal(d.title,'Drei: donnerstags 2+1 Pizza gratis bei Pizza Mann');
  assert.ok(d.description.includes(terms)); assert.ok(!d.description.includes('Andere Werbung'));
  assert.ok(d.description.includes('FreeFinder Pro ersetzt')); assert.equal(d.votes,0);
  assert.equal(d.pubDate,undefined); assert.equal(d.validUntil,undefined); assert.equal(d.code,undefined);
  const prior = [{...d,id:'benefit-drei-plus-1m300u0'}];
  assert.equal(parseDreiDetail(detail(),url,{now,previous:prior}).deal.id, prior[0].id);
});

test('FlixBus exact tariff exclusions, service fees, dates and app-only redemption retained', () => {
  const facts = 'Nur Drei Handyvertrag; ausgenommen up-Abo, Wertkarte und Internet-Tarife. Code ausschließlich in FlixBus-App. Einmal wöchentlich. Fahrten 7.1.2026 bis inkl. 18.12.2026; Servicegebühren und Extras ausgenommen. Veröffentlichung persönlicher Codes verboten.';
  const d = parseDreiDetail(detail({brand:'FlixBus',offer:'10 % Rabatt auf Buchungen über die FlixBus-App',conditions:facts}),url.replace('pizza-mann','flixbus'),{now}).deal;
  assert.ok(d.description.includes(facts)); assert.equal(d.validUntil,'2026-12-18'); assert.ok(d.title.includes('10 %'));
});

test('missing, ambiguous, expired or conflicting source evidence is held instead of guessed', () => {
  for (const html of [detail().replaceAll('text-element','other'),detail()+detail(),detail({conditions:''}).replace(/<div class="text-element"><h2>So funktioniert[\s\S]*?<\/div>/,''),detail({offer:'Ein schönes Wochenende'})]) assert.equal(parse(html).deal,undefined);
  assert.equal(parse(detail({conditions:terms+' Bis 31.12.2025.'})).reason,'conflicting-source-validity');
  assert.equal(parse(detail({conditions:'Gültig bis 1.11.2026. Code erforderlich.'})).reason,'expired-benefit');
  assert.equal(parse(detail({conditions:'Gültig bis 31.2.2027. Code erforderlich.'})).reason,'invalid-source-date');
  assert.equal(parseDreiDetail(detail({brand:'Museum Graz'}),url.replace('pizza-mann','joanneum'),{now}).reason,'regional-benefit-outside-vienna');
});

test('HoT benefit discloses first porting and paid tariff; Magenta marketing does not become 1+1 offer', () => {
  const d = parseCarrierTeasers(hot,CARRIER_SOURCES[3],{now}).deals[0];
  assert.ok(d.title.includes('erster HoT-Portierung und Tarifbuchung'));
  assert.ok(d.description.includes('erneute Portierung ausgeschlossen')); assert.equal(d.type,'rabatt');
  assert.equal(parseCarrierTeasers(hot.replace('Buchung eines Tarifpakets','Handy benutzen'),CARRIER_SOURCES[3],{now}).deals.length,0);
  const r = parseCarrierTeasers('<div class="cmp-text">Bis zu 100 Euro monatlich sparen: 1+1 und viele Marken, nur in der App.</div>',CARRIER_SOURCES[1],{now});
  assert.equal(r.deals.length,0); assert.equal(r.held.length,1); assert.equal(r.appOnly,true);
});

test('current official revalidation rejects edited conditions, titles and mismatched evidence', async () => {
  const d=parse(detail()).deal, fetchPage=async()=>({html:detail(),finalUrl:url});
  assert.equal((await verifyCarrierBenefit(d,{now,fetchPage})).ok,true);
  for (const edit of [{title:'1+1 Pizza gratis'}, {description:d.description.replace('Nicht an Feiertagen,','')}, {membershipRequired:''}, {carrierProvider:'hot-vorteile'}, {evidence:{...d.evidence,sourceUrl:'https://evil.test/'}}]) {
    assert.equal((await verifyCarrierBenefit({...d,...edit},{now,fetchPage})).ok,false);
  }
  const result = await validateDealsForSlack([{...d,address:'Fake 1010 Wien',validUntil:'2099-01-01'}],{now,fetchCarrierBenefitPage:fetchPage,inspectDealUrlHealth:async()=>{throw Error('Generic probe must not bypass carrier source guard');}});
  assert.equal(result.allowedDeals.length,1,JSON.stringify(result.report));
  assert.equal(result.allowedDeals[0].address,undefined); assert.equal(result.allowedDeals[0].validUntil,undefined);
  assert.equal(normalizeForSlack(d,'member-benefits').votes,0);
  assert.equal(normalizeApproved(d).votes,0);
  const message=JSON.stringify(buildSlackMessage(normalizeForSlack(d,'member-benefits'),1));
  for (const condition of ['Family Pizza', '1210', '1220', 'Feiertagen', '3,90', 'Drei Kund:innen']) assert.ok(message.includes(condition),condition);
  const normalizedResult=await validateDealsForSlack([normalizeForSlack(d,'member-benefits')],{now,fetchCarrierBenefitPage:fetchPage,inspectDealUrlHealth:async()=>{throw Error('No generic probe');}});
  assert.equal(normalizedResult.allowedDeals.length,1,JSON.stringify(normalizedResult.report));
});

test('a redemption-code bullet is not mistaken for the actual discount or ticket quantity', () => {
  const html=detail({brand:'Therme Wien',offer:'Mit SMS-Code oder per Gutschein einlösbar'})
    .replace('Ein Vorteil.','50 % Ersparnis auf das 2. Ticket')
    .replace('In allen Filialen Österreichs','Angebot gültig jeden Mittwoch ab 18 Uhr');
  const parsed=parseDreiDetail(html,url.replace('pizza-mann','therme-wien'),{now});
  assert.equal(parsed.deal.title,'Drei: mittwochs ab 18 Uhr 2. Thermenticket 50 % günstiger');
  const kino=detail({brand:'Kino',offer:'2 Kinotickets zum Preis von 1'}).replace('In allen Filialen Österreichs','Jeden Film, jeden Donnerstag');
  assert.equal(parseDreiDetail(kino,url.replace('pizza-mann','kinodonnerstag'),{now}).deal.title,'Drei: donnerstags 1+1 Kinotickets bei Cineplexx');
});

test('collector follows bounded detail pages and reports zero confirmed app-only catalog offers', async () => {
  const result = await collectCarrierBenefits({now,sources:CARRIER_SOURCES.slice(0,2),fetchPage:async u=>({html:u===url?detail():u===CARRIER_SOURCES[0].url?listing(): '<div class="cmp-text">1+1 Überraschungen</div>',finalUrl:u})});
  assert.equal(result.deals.length,1);assert.equal(result.report.providers[0].pagesRead,2);
  assert.equal(result.report.providers[0].newCandidates,1);assert.equal(result.report.providers[1].verifiedCandidates,0);
  assert.equal(result.report.complete,false);
  let calls=0;
  const denied = await collectCarrierBenefits({now,sources:[CARRIER_SOURCES[0]],fetchPage:async()=>{calls++;throw Object.assign(Error('HTTP 429'),{httpStatus:429,retryAt:'2026-11-04T10:00:00Z'});}});
  assert.equal(calls,1);assert.equal(denied.deals.length,0); assert.equal(denied.report.providers[0].errors[0].httpStatus,429);
});

test('HTTP respects robots, request cap, redirect, content limits and persistent source pauses', async () => {
  const opts={now,sleep:async()=>{}};
  let calls=0; const state={};
  const f=createCarrierFetcher({...opts,state,fetchImpl:async u=>{calls++; return u.endsWith('robots.txt')?response('User-agent: *\nAllow: /'):response('',{status:429,headers:{'retry-after':'172800'}});}});
  await assert.rejects(f.fetchPage(url),error=>error.httpStatus===429);
  await assert.rejects(f.fetchPage(url),/cooldown/);assert.equal(calls,2);
  assert.equal(state['https://www.drei.at'].retryAt,'2026-11-04T10:00:00.000Z');
  const disallowed=createCarrierFetcher({...opts,fetchImpl:async()=>response('User-agent: *\nDisallow: /de/')});
  await assert.rejects(disallowed.fetchPage(url),/robots disallow/);assert.equal(disallowed.requests,1);
  const cap=createCarrierFetcher({...opts,maxRequests:1,fetchImpl:async()=>response('User-agent: *\nAllow: /')});
  await assert.rejects(cap.fetchPage(url),/request limit/);
  for (const body of [response('',{status:302}),response('x'.repeat(2500001)),response('{}',{headers:{'content-type':'application/json'}})]) {
    const client=createCarrierFetcher({...opts,fetchImpl:async u=>u.endsWith('robots.txt')?response(''):body});
    await assert.rejects(client.fetchPage(url),/HTTP 302|HTML limit|not HTML/);
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carrier-pauses-')), file=path.join(dir,'pause.json');
  try {
    recordCarrierPauses(state,file);assert.deepEqual(readCarrierPauses(file),state);
    recordCarrierPauses({'https://www.drei.at':{retryAt:'2026-11-03T00:00:00Z'}},file);
    assert.deepEqual(readCarrierPauses(file),state);
    fs.writeFileSync(file,'{"https://www.drei.at":{"retryAt":"bad"}}');assert.throws(()=>readCarrierPauses(file),/Invalid carrier/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('carrier-only refresh preserves unrelated pending records and removes false generic carrier cards', () => {
  const untouched={id:'other',source:'WienMobil Vorteilswelt',title:'Existing offer'};
  assert.deepEqual(mergeCarrierPending({deals:[untouched,{source:'A1 Smile'},{source:'Magenta Moments'}]},[parse(detail()).deal]),[untouched,parse(detail()).deal]);
});

const a1Card=(heading,body)=>`<div class="inner"><h2>${heading}</h2><p>${body}</p><a href="/mein-a1-app">Zur App</a></div>`;
const a1Fixture=a1Card('A1 Mesh WLAN Set jetzt 30% günstiger','A1 Mesh WLAN Set um nur € 70,- statt € 100,- und spare 30%.')
  +a1Card('Minus 30% auf foodora PRO 3-Monatsplan','Sichere dir 30 % Rabatt auf den foodora PRO 3-Monatsplan.')
  +a1Card('-30% auf ausgewählte Bosch Haushaltsgeräte','Sichere dir auf ausgewählte Geräte 30% Rabatt.')
  +a1Card('-30% bei Hundetraining.me','30% Rabatt auf das Premium-Jahresabo von Hundetraining.me, online trainieren.')
  +a1Card('Minus 30% auf ausgewählte Weine bei WEIN & CO','30% Rabatt auf Wein.');
const cinemaUrl=CARRIER_DETAIL_SOURCES['magenta-moments'][0];
const tvUrl=CARRIER_DETAIL_SOURCES['magenta-moments'][1];
const cinemaFixture=`<div><h1 class="main-content-title">Magenta Moments: Kinotickets 1+1 gratis</h1><div class="editor-content">
  <p>Jeden Dienstag für Magenta Moments Mitglieder 1+1 Kinoticket gratis in allen Hollywood Megaplex und im Metropol Kino.</p>
  <p>Ein Vollpreis-Ticket bezahlen. QR Code vor dem Bezahlvorgang direkt an der Kinokassa vorweisen.</p>
  <p>Gültig bis auf Widerruf. Gilt nicht für Sondervorstellungen und ist nicht mit anderen Rabatten und Aktionen kombinierbar.</p>
  <p>An allen anderen Tagen gibt es 20% Rabatt auf den Ticketvollpreis und an allen Tagen 10% Rabatt auf den gesamten Einkauf am Kinobuffet.</p>
  </div></div><a href="/kinoprogramm/gasometer">Wien Gasometer</a>`;
const tvFixture=(price='3,90')=>`<div class="cmp-text"><h1>Erlebe Magenta TV mit TV Mini</h1><h2>3 Monate TV Mini geschenkt</h2>
  <p>*Gültig bis auf Widerruf bei Neuanmeldung von TV Mini mit Magenta Moments Code. Ab dem 4. Monat € ${price} mtl. Grundgebühr. Magenta Internetzugang (exkl. KLAX) erforderlich. Unternehmer:innen sind vom Angebot ausgeschlossen.</p>
  <p>Innerhalb von Österreich im Netz von Magenta nutzbar.</p>
  <p>Die Aktion ist nicht mit anderen Aktionen/bestehenden Rabatten kombinierbar.</p>
  <p>Sie können Ihr Magenta TV-Produkt ohne Bindung jederzeit kündigen.</p>
  <p>TV Box: optional (zzgl. € 2 mtl.) mit 3 Monaten Mindestvertragsdauer.</p></div>`;

test('A1 concrete public offers stay distinct, disclose app gaps, and reject alcohol and invented savings',()=>{
  const result=parseCarrierTeasers(a1Fixture,CARRIER_SOURCES[2],{now});
  assert.equal(result.deals.length,4);assert.equal(new Set(result.deals.map(d=>d.id)).size,4);
  assert.ok(result.held.some(d=>d.reason==='alcohol-offer'));
  const food=result.deals.find(d=>d.brand==='foodora');
  assert.equal(food.category,'essen');assert.equal(food.type,'rabatt');
  assert.ok(food.description.includes('nicht um drei kostenlose Monate'));
  assert.ok(food.missingFields.some(value=>value.includes('Gesamtpreis')));
  assert.ok(result.deals.every(d=>d.evidence.publicOfferOnly && d.missingFields.length && !d.pubDate && !d.code));
  const repeated=parseCarrierTeasers(a1Fixture,CARRIER_SOURCES[2],{now,previous:result.deals});
  assert.deepEqual(repeated.deals.map(d=>d.id),result.deals.map(d=>d.id));
  const invalid=parseCarrierTeasers(a1Card('A1 Mesh WLAN Set jetzt 30% günstiger','A1 Mesh WLAN Set um nur € 80,- statt € 100,- und spare 30%.'),CARRIER_SOURCES[2],{now});
  assert.equal(invalid.deals.length,0);
  assert.equal(parseCarrierTeasers(a1Fixture+a1Fixture,CARRIER_SOURCES[2],{now}).deals.length,4);
  const conflict=parseCarrierTeasers(a1Fixture+a1Card('-20% auf ausgewählte Bosch Haushaltsgeräte','Auf ausgewählte Geräte 20% Rabatt.'),CARRIER_SOURCES[2],{now});
  assert.equal(conflict.deals.some(d=>d.brand==='Bosch'),false);assert.ok(conflict.held.some(d=>d.reason==='conflicting-public-carrier-offer'));
});

test('one A1 delivery does not suppress the other offers sharing the same landing page',()=>{
  const deals=parseCarrierTeasers(a1Fixture,CARRIER_SOURCES[2],{now}).deals.map(d=>normalizeForSlack(d,'member-benefits'));
  assert.equal(filterDuplicateDealsInRun([...deals,deals[0]]).deals.length,4);
  const seen=new Set();addSeenDealsFromThread(seen,[{id:deals[0].id,url:deals[0].url}]);
  assert.equal(filterRecentlySeenDeals(deals,seen).deals.length,3);
  assert.equal(filterRecentlySeenDeals([deals[0]],seen).deals.length,0);
  assert.equal(filterAlreadyQueuedDeals(deals,loadLiveDealDuplicateKeys([deals[0]])).deals.length,3);
});

test('Magenta merchant source provides actual cinema terms and keeps the existing approved offer ID',()=>{
  const legacy={id:'benefit-magenta-moments-oz9vs',url:CARRIER_SOURCES[1].url,title:'1+1 Kinotickets am Dienstag für Magenta-Kunden'};
  const result=parseCarrierDetail(cinemaFixture,cinemaUrl,'magenta-moments',{now,previous:[legacy]});
  assert.equal(result.deals.length,1);const d=result.deals[0];
  assert.equal(d.id,legacy.id);assert.equal(d.type,'bogo');assert.ok(d.evidence.viennaContext.includes('Wien Gasometer'));
  for(const condition of ['Vollpreis','Sondervorstellungen','20 %','10 %','Kinokassa','nicht möglich']) assert.ok(d.description.includes(condition),condition);
  for(const invalid of [cinemaFixture.replace('vor dem Bezahlvorgang','später'),cinemaFixture.replace('Wien Gasometer','Linz'),cinemaFixture.replace('nicht für Sondervorstellungen','für alle Vorstellungen')])
    assert.equal(parseCarrierDetail(invalid,cinemaUrl,'magenta-moments',{now}).deals.length,0);
  assert.equal(parseCarrierDetail(cinemaFixture,cinemaUrl,'a1-smile',{now}).deals.length,0);
});

test('TV Mini includes follow-up price, eligibility, optional box cost and binding; missing terms stop it',()=>{
  const d=parseCarrierDetail(tvFixture(),tvUrl,'magenta-moments',{now}).deals[0];
  assert.ok(d.title.includes('danach 3,90 €/Monat'));
  for(const value of ['KLAX','Privatkunden','Unternehmen','zusätzlich 2 Euro','drei Monate Mindestvertragsdauer','Wertsicherung']) assert.ok(d.description.includes(value),value);
  for(const invalid of [tvFixture().replace('exkl. KLAX','inkl. KLAX'),tvFixture().replace('Ab dem 4. Monat € 3,90','Ab dem 4. Monat'),tvFixture().replace('TV Box:','Andere Box:'),tvFixture().replace('ohne Bindung jederzeit kündigen','nicht kündigen')])
    assert.equal(parseCarrierDetail(invalid,tvUrl,'magenta-moments',{now}).deals.length,0);
});

test('A1 and Magenta go through real Slack normalization without probing another provider or hiding missing facts',async()=>{
  const get=async u=>({html:u===CARRIER_SOURCES[2].url?a1Fixture:u===cinemaUrl?cinemaFixture:tvFixture(),finalUrl:u});
  const deals=[...parseCarrierTeasers(a1Fixture,CARRIER_SOURCES[2],{now}).deals,
    ...parseCarrierDetail(cinemaFixture,cinemaUrl,'magenta-moments',{now}).deals,
    ...parseCarrierDetail(tvFixture(),tvUrl,'magenta-moments',{now}).deals];
  const result=await validateDealsForSlack(deals.map(d=>normalizeForSlack(d,'member-benefits')),{now,fetchCarrierBenefitPage:get,inspectDealUrlHealth:async()=>{throw Error('Unexpected generic probe');}});
  assert.equal(result.allowedDeals.length,6,JSON.stringify(result.report));
  const d=deals.find(d=>d.url===tvUrl);
  assert.equal((await verifyCarrierBenefit(d,{now,fetchPage:async()=>({html:tvFixture('4,90'),finalUrl:tvUrl})})).ok,false);
  assert.equal((await verifyCarrierBenefit({...d,carrierProvider:'a1-smile',evidence:{...d.evidence,provider:'a1-smile'}},{now,fetchPage:get})).ok,false);
  assert.equal((await verifyCarrierBenefit({...d,carrierProvider:'drei-plus',url:'not a URL'},{now,fetchPage:get})).ok,false);
  const foodora=deals.find(row=>row.brand==='foodora');
  const corrected=await validateDealsForSlack([{...foodora,type:'gratis',category:'events',missingFields:[],needsReview:false}],{now,fetchCarrierBenefitPage:get});
  assert.equal(corrected.allowedDeals[0].type,'rabatt');assert.equal(corrected.allowedDeals[0].category,'essen');
  assert.ok(corrected.allowedDeals[0].missingFields.some(value=>value.includes('Gesamtpreis')));assert.equal(corrected.allowedDeals[0].needsReview,true);
});

test('targeted A1/Magenta refresh preserves all other carrier and noncarrier candidates exactly',()=>{
  const other=[parse(detail()).deal,{id:'hot-existing',source:'HoT Vorteile',carrierProvider:'hot-vorteile'},{id:'other',source:'Vorteilsclub der Stadt Wien'}];
  const stale={id:'a1-old',source:'A1 Vorteilswelt',carrierProvider:'a1-smile'};
  const replacements=parseCarrierTeasers(a1Fixture,CARRIER_SOURCES[2],{now}).deals;
  assert.deepEqual(mergeCarrierPending({deals:[...other,stale]},replacements,CARRIER_SOURCES.filter(s=>['a1-smile','magenta-moments'].includes(s.key))),[...other,...replacements]);
});

test('public Magenta partner details are independently collected after a denied overview',async()=>{
  const result=await collectCarrierBenefits({now,sources:[CARRIER_SOURCES[1]],fetchPage:async u=>{
    if(u===CARRIER_SOURCES[1].url)throw Object.assign(Error('HTTP 403'),{httpStatus:403});
    return {html:u===cinemaUrl?cinemaFixture:tvFixture(),finalUrl:u};
  }});
  assert.equal(result.deals.length,2);assert.equal(result.report.providers[0].errors.length,1);
  assert.equal(result.report.complete,false);
  assert.equal(isCarrierUrl('https://www.megaplex.at/inhalt/other'),false);
  assert.equal(isCarrierUrl(cinemaUrl),true);
});
