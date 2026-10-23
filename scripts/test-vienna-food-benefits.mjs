import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isViennaBenefitUrl, parseViennaBenefitListing, parseViennaFoodBenefit, collectViennaFoodBenefits, verifyViennaFoodBenefit, fetchViennaBenefitPage, readViennaFoodPause, recordViennaFoodPause } from '../scraper/vienna-food-benefits.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const url='https://vorteilsclub.wien.at/meine-vorteile/pizzeria-test';
const now=new Date('2026-10-23T12:00:00Z');
const offer='20 Prozent Ermäßigung auf die Einzelrechnung des Vorteilsclub-Mitglieds bei Vorreservierung*';
const terms='Mittagsmenüs ausgenommen. Tisch vorab reservieren; Mitgliedskarte vor der ersten Bestellung vorzeigen. Nur persönlich konsumierte Speisen und Getränke.';
const fixture=({ heading='Pizzeria Test', benefit=offer, conditions=terms, address='Testgasse 1 1090 Wien' }={})=>`<main class="wm-site-content"><h1 class="wm-stage__heading">${heading}</h1><div class="wm-text-background"><strong>${benefit}</strong></div><h3 class="wm-accordion__header">Details</h3><div class="wm-accordion__panel">${conditions}</div><div class="wm-card--partner"><div class="wm-icon-text__content">${address}</div></div><div class="wm-card"><h3 class="wm-card__heading"><a href="/meine-vorteile/other">Other</a></h3><p class="benefit-card-info">50 Prozent anderer Rabatt</p></div></main>`;
const parse=html=>parseViennaFoodBenefit(html,url,{now});
test('host, credentials, scheme, detail path and listing filters are closed',()=>{
  for(const bad of ['https://evil.test/meine-vorteile/a','http://vorteilsclub.wien.at/meine-vorteile/a','https://evil@vorteilsclub.wien.at/meine-vorteile/a',url+'?x=1',url+'#x',url+'/../login']) assert.equal(isViennaBenefitUrl(bad),false,bad);
  assert.equal(isViennaBenefitUrl(url),true);
  assert.equal(isViennaBenefitUrl('https://vorteilsclub.wien.at/meine-vorteile?kategorien=nachtleben&p=1',false),false);
});
test('scoped detail facts, full conditions, no invented publication, expiry or votes',()=>{
  const d=parse(fixture()).deal;
  assert.equal(d.brand,'Pizzeria Test');assert.equal(d.votes,0);assert.equal(d.pubDate,undefined);assert.equal(d.validUntil,undefined);
  assert.ok(d.description.includes(terms));assert.ok(d.description.includes('Kostenlose Mitgliedschaft'));assert.ok(d.title.includes('Vorteilsclub'));
  assert.ok(!d.description.includes('50 Prozent')); assert.equal(d.address,'Testgasse 1 1090 Wien');
});
test('missing, duplicate or changed critical blocks fail closed',()=>{
  for(const html of [fixture().replace('wm-text-background','not-offer'),fixture().replace('Details','Other'),fixture()+fixture(),fixture({address:'Testgasse 1 8010 Graz'}),fixture({benefit:'Neu! Jetzt reservieren'}),fixture({conditions:''})]) assert.equal(parse(html).deal,undefined);
});
test('alcohol, specialized events and expired benefits are withheld',()=>{
  assert.equal(parse(fixture({heading:'Maßschneiderei',conditions:'Mitgliedskarte vorzeigen.'})).reason,'not-food-benefit');
  assert.equal(parse(fixture({benefit:'20 Prozent Ermäßigung auf Wein und Cocktails'})).deal,undefined);
  assert.equal(parse(fixture({conditions:terms+' Gratis Wein inklusive.'})).deal,undefined);
  assert.equal(parse(fixture({conditions:terms+' Gültig bis 22.10.2026.'})).reason,'expired-benefit');
  assert.equal(parseViennaFoodBenefit(fixture(),url.replace('pizzeria-test','feuerdorf'),{now}).deal,undefined);
});
test('take-away, cakes, Tuesdays and code conditions stay exact',()=>{
  for(const benefit of ['20 Prozent Ermäßigung auf Take-Away-Bestellungen','20 Prozent Ermäßigung auf Torten bei Abholung','20 Prozent Ermäßigung jeden Dienstag auf alle Produkte und die Konsumation vor Ort']) {
    const d=parse(fixture({benefit,conditions:'Rabattcode nur für eingeloggte Mitglieder sichtbar. Mitgliedskarte vorzeigen.'})).deal;
    assert.ok(d.description.startsWith(benefit));assert.ok(d.description.includes('Rabattcode nur für eingeloggte'));
  }
});
test('listing pagination does not admit foreign hosts or duplicate links',()=>{
  const list=`${fixture()}<a href="?kategorien=restaurants&p=5">5</a><a href="?kategorien=nachtleben&p=8">8</a><a href="https://evil.test/meine-vorteile?a=1">bad</a>`;
  const p=parseViennaBenefitListing(list,'https://vorteilsclub.wien.at/meine-vorteile?kategorien=restaurants&p=1');
  assert.equal(p.pages,5);assert.deepEqual(p.urls,['https://vorteilsclub.wien.at/meine-vorteile/other']);
});
test('exact live re-extraction restores facts and rejects missing conditions or fabricated price',async()=>{
  const deal=parse(fixture()).deal;const fetchPage=async()=>({html:fixture(),finalUrl:url});
  assert.ok((await verifyViennaFoodBenefit(deal,{now,fetchPage})).ok);
  assert.equal((await verifyViennaFoodBenefit({...deal,description:deal.description.replace('Mittagsmenüs ausgenommen.','')},{now,fetchPage})).ok,false);
  assert.equal((await verifyViennaFoodBenefit({...deal,title:'50 % Rabatt'},{now,fetchPage})).ok,false);
  assert.equal((await verifyViennaFoodBenefit(deal,{now,fetchPage:async()=>({html:fixture({conditions:terms+' Neue Ausnahme.'})})})).ok,false);
  const result=await validateDealsForSlack([{...deal,address:'Fake 1200 Wien',validUntil:'2099-01-01'}],{now,fetchViennaBenefitPage:fetchPage,inspectDealUrlHealth:async()=>{throw Error('Generic probe must not bypass source guard');}});
  assert.equal(result.allowedDeals.length,1,JSON.stringify(result.results));assert.equal(result.allowedDeals[0].validUntil,undefined);assert.equal(result.allowedDeals[0].address,deal.address);
});
test('collector keeps cap, counts rejected entries and stops on denial without provider fallback',async()=>{
  let calls=0;
  const result=await collectViennaFoodBenefits({now,fetchPage:async()=>{calls++;throw Object.assign(new Error('HTTP 429'),{httpStatus:429,retryAt:'2026-10-30T12:00:00Z'});}});
  assert.equal(calls,1);assert.equal(result.deals.length,0);assert.equal(result.report.retryAt,'2026-10-30T12:00:00Z');
  const list=Array.from({length:100},(_,i)=>`<div class="wm-card"><h3 class="wm-card__heading"><a href="/meine-vorteile/place-${i}">Place</a></h3><p class="benefit-card-info">20 Prozent</p></div>`).join('');
  const bounded=await collectViennaFoodBenefits({now,maxDeals:2,fetchPage:async u=>({html:u.includes('?')?list:fixture(),finalUrl:u})});
  assert.equal(bounded.deals.length,2);assert.equal(bounded.report.limited,true);assert.ok(bounded.report.requests<=96);
});
test('HTTP wrapper rejects redirect, large bodies and records Retry-After',async()=>{
  let pause;
  const opts={sleep:async()=>{},recordPause:error=>{pause=error.retryAt;}};
  await assert.rejects(fetchViennaBenefitPage(url,{...opts,fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://evil.test/'}})}),/HTTP 302/);
  await assert.rejects(fetchViennaBenefitPage(url,{...opts,fetchImpl:async()=>new Response('x'.repeat(2500001),{headers:{'content-type':'text/html'}})}),/HTML limit/);
  await assert.rejects(fetchViennaBenefitPage(url,{...opts,fetchImpl:async()=>new Response('',{status:429,headers:{'retry-after':'172800'}})}),error=>error.httpStatus===429&&Date.parse(error.retryAt)>Date.now()+86400000);
  assert.ok(Date.parse(pause)>Date.now()+86400000);
  await assert.rejects(fetchViennaBenefitPage(url,{...opts,fetchImpl:async()=>{throw new Error('must not fetch');}}),/cooldown/);
});
test('source pause survives another reader and cannot be shortened or silently ignored',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vienna-benefit-pause-'));const file=path.join(dir,'pause.json');
  try {
    recordViennaFoodPause({httpStatus:429,retryAt:'2026-11-10T00:00:00Z'},file);
    recordViennaFoodPause({httpStatus:403,retryAt:'2026-10-24T00:00:00Z'},file);
    assert.equal(readViennaFoodPause(file),Date.parse('2026-11-10T00:00:00Z'));
    fs.writeFileSync(file,'{"retryAt":"invalid"}');assert.throws(()=>readViennaFoodPause(file),/Invalid benefit source pause/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
