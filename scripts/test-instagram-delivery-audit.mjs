import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstagramDeliveryAudit } from '../scraper/instagram-delivery-audit.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { getEditorialRoundupPromotionReason } from '../scraper/promotion-quality-utils.js';

const now = new Date('2026-11-10T21:25:42Z');
const candidate = (id, extra = {}) => ({ id, url: `https://www.instagram.com/p/${id}/`, originSource: 'instagram-ai-agent', ...extra });

test('delivery audit accounts for every row at its actual first blocking stage', () => {
  const candidates = ['moderated','excluded','seen','live','queued','blocked','duplicate','ready','sent'].map(id => candidate(id));
  const validation = { results: candidates.slice(5).map(deal => ({ deal, decision: {
    allowed: deal.id !== 'blocked', reasons: deal.id === 'blocked' ? ['kein konkretes Angebot erkennbar'] : [],
  } })) };
  const result = buildInstagramDeliveryAudit({ candidates: [...candidates, { id:'private',source:'community' }],
    stages: ['moderated','discovery-excluded','already-seen-post','already-live','already-queued']
      .map((reason,index) => ({ reason, deals:candidates.slice(index+1) })),
    validation, selected:candidates.slice(7), delivered:[{...candidates[7]}, {...candidates[8],slackTs:'1.2'}], now });
  assert.equal(result.extractedCandidates,9);
  assert.equal(Object.values(result.counts).reduce((a,b)=>a+b,0),9);
  assert.deepEqual(result.rows.map(row=>row.status), ['moderated','discovery-excluded','already-seen-post','already-live',
    'already-queued','validator-blocked','duplicate-in-run','selected-not-confirmed','slack-confirmed']);
  assert.deepEqual(result.rows[5].reasons,['kein konkretes Angebot erkennbar']);
});

test('collector acceptance and URL matches from another source are not delivery receipts', () => {
  const deal = candidate('x');
  const args = { candidates:[deal], stages:[], validation:{results:[]}, selected:[deal], now };
  assert.equal(buildInstagramDeliveryAudit({...args,delivered:[{...deal,id:'meta-x',slackTs:'123'}]}).counts['slack-confirmed'],undefined);
  assert.equal(buildInstagramDeliveryAudit({...args,selected:[]}).rows[0].status,'not-in-standard-lane');
});

// Same structure as the real Mahrischer Spatz caption: a dated weekly menu,
// two undated alternatives, repeated by Graph and Instagram OG previews.
const caption = 'Mittagsmenue vom 09.11.–13.11.2026 in Wien. Suppe und Hauptgericht fuer nur € 14,90. '
  + 'Menue-Alternativen • Wiener Schnitzel mit Kartoffelsalat und Preiselbeeren '
  + '• Gebackenes Zanderfilet mit Kartoffel-Mayonnaise-Salat und Zitrone. Ybbsstrasse 25, 1020 Wien.';
const menu = { ...candidate('DfiAZS_R3e8'), source:'Instagram AI Agent', brand:'Mahrischer Spatz 1925',
  title:'Mittagsmenue inklusive Suppe fuer 14,90 EUR', description:'Menue vom 09.11. bis 13.11.2026, 1020 Wien.',
  category:'essen & trinken', type:'rabatt', distance:'1020 Wien', viennaVerified:true,
  sourcePublishedAt:'2026-11-09T18:47:24Z',sourcePublishedAtSource:'instagram-graph-timestamp',
  validFrom:'2026-11-09',validUntil:'2026-11-13',expires:'2026-11-13',metaGraphCaption:caption };
const inspect = text => async url => ({ok:true,status:200,finalUrl:url,dateHints:{},contentHints:{title:text,description:text}});

test('identical Graph/OG captions cannot invent multiple dated events; original policy stays strict', async () => {
  assert.equal(getEditorialRoundupPromotionReason(caption),'');
  assert.match(getEditorialRoundupPromotionReason([caption,caption,caption].join(' ')),/Mehrfach-Roundup/);
  const validation = await validateDealsForSlack([menu],{now,inspectDealUrlHealth:inspect(caption)});
  assert.deepEqual(validation.results[0].decision.reasons,[]);
  assert.equal(validation.allowedDeals.length,1);
  const wrapped = await validateDealsForSlack([menu],{now,inspectDealUrlHealth:async url => ({
    ok:true,status:200,finalUrl:url,dateHints:{},contentHints:{
      title:`Mahrischer Spatz on Instagram: "${caption}"`,
      description:`${caption} - @mahrischer_spatz on November 9, 2026`,
    },
  })});
  assert.equal(wrapped.allowedDeals.length,1);
  const roundup = 'Gratis Kaffee in Wien: • Kaffeeaktion am 10.11.2026 in Lokal A, 1010 Wien. '
    + '• Gratis Pizza am 11.11.2026 in Lokal B, 1020 Wien.';
  const blocked = await validateDealsForSlack([{...menu,metaGraphCaption:roundup}],{now,inspectDealUrlHealth:inspect(roundup)});
  assert.ok(blocked.results[0].decision.reasons.some(reason=>reason.includes('Mehrfach-Roundup')));
  const conflictingWrapper = await validateDealsForSlack([menu],{now,inspectDealUrlHealth:inspect(`${caption} Gewinnspiel!`)});
  assert.ok(conflictingWrapper.results[0].decision.reasons.some(reason=>reason.includes('Gewinnspiel')));
});

test('duplicate evidence cleanup cannot relax age, ordinary-price, contest or foreign-city exclusions', async () => {
  const cases = [
    [{...menu,url:'https://www.instagram.com/p/DfIZoK6xzYU/',expires:'',validFrom:'',validUntil:''},caption,/älter als 7 Tage/],
    [{...menu,metaGraphCaption:'',title:'Mittagsmenue mit Suppe fuer 9,99 EUR',description:'Mittagsmenue mit Suppe fuer 9,99 EUR, 1020 Wien.'},'',/kein konkretes Angebot/],
    [menu,'Gewinnspiel: Gratis Kaffee in Wien zu gewinnen. Folge und kommentiere.',/Gewinnspiel/],
    [{...menu,city:'Graz',distance:'8010 Graz',viennaVerified:false},'Nur heute Gratis Kaffee in Graz',/Wien|Graz|Ort/],
  ];
  for (const [deal,text,expected] of cases) {
    const result=await validateDealsForSlack([{...deal,metaGraphCaption:text}],{now,inspectDealUrlHealth:inspect(text)});
    assert.equal(result.allowedDeals.length,0);
    assert.match(result.results[0].decision.reasons.join('; '),expected);
  }
});
