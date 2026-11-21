import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyReviewReasons, maintainFeedFile, maintainDeals } from './automatic-deal-maintenance.mjs';
import { createMaintenanceSourceEntry, maintenanceEvidenceFor, refreshMaintenanceEvidence } from './refresh-maintenance-evidence.mjs';
import { extractIamstudentApprovalSourceEvidence, reviewedIamstudentCopy } from '../scraper/approval-iamstudent-source-evidence.js';
import { projectEnrichmentDeal } from '../scraper/deal-enrichment-state.js';
import { extractMarktguruCashbackEvidence, MARKTGURU_NESCAFE_URL } from '../scraper/marktguru-cashback-evidence.js';

const now = new Date('2026-11-14T12:00:00Z');
const policy = { version: 1, enabled: true, automaticLocalCopy: true, automaticExpiry: false, maxAiCandidatesPerRun: 4 };
const url = 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26';
const html = fs.readFileSync(fileURLToPath(new URL('./fixtures/iamstudent-vapiano-20261114.html', import.meta.url)), 'utf8');
const evidence = extractIamstudentApprovalSourceEvidence(html, url, url);
const caption = 'Mit dem Gutschein erhältst du einen kostenlosen Kaffee. Das Angebot gilt nur für registrierte Mitglieder.';
const description = 'Registrierte Mitglieder bekommen nach Vorlage ihres Gutscheins einen Kaffee gratis.';
const pending = (id = 'pending') => projectEnrichmentDeal({ id, title: 'Gratis Kaffee mit Gutschein', brand: 'Fixture',
  url: 'https://example.org/offer', caption, description: 'Gratis Kaffee mit Gutschein', expiryKind: 'unknown',
  approvalPublicationMode: 'two-stage-v1', enrichmentPending: true, enrichmentFields: ['description', 'map'],
  enrichmentNextReviewAt: '2026-11-14T10:00:00Z' });

async function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-enrichment-'));
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-fixture-not-a-key';
  const put = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), JSON.stringify(value)); };
  try { put('reviews/automatic-maintenance-policy.json', policy); put('docs/deals.json', { deals: [] }); await callback({ root, put }); }
  finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; fs.rmSync(root, { recursive: true, force: true }); }
}
function modelMock(calls, supported = true) {
  return async (_url, init) => {
    const request = JSON.parse(init.body), payload = JSON.parse(request.messages[1].content);
    calls.push(payload);
    const content = Object.hasOwn(payload, 'patch') ? { supported }
      : { title: '', quote: '', description, conditionsQuote: caption, dateQuote: '' };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] });
  };
}

test('a public placeholder stays pending and local title preparation cannot complete conditions', () => {
  const deal = pending();
  assert(copyReviewReasons(deal).includes('description'));
  assert(!copyReviewReasons(deal, new Set(['description'])).includes('description'));
  assert.deepEqual(maintainDeals([deal], { policy, now }).deals, [deal]);
});

test('disabled or unknown maintenance policy blocks fixed copy and AI even with four configured slots', () => fixture(async ({ root, put }) => {
  const deal = { ...pending(), url, brand: 'VAPIANO' };
  put('docs/deals.json', { deals: [deal] });
  put('reviews/maintenance-source-evidence.json', { entries: { [url]: createMaintenanceSourceEntry(deal, evidence, now) } });
  for (const disabled of [{ ...policy, enabled: false }, { ...policy, version: 2 }]) {
    put('reviews/automatic-maintenance-policy.json', disabled);
    const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request: () => assert.fail('disabled policy') });
    assert.deepEqual(result.deals, [deal]);
    assert.equal(result.report.mode, 'disabled');
    assert(!fs.existsSync(path.join(root, 'reviews/automatic-deal-maintenance-state.json')));
  }
}));

test('fresh complete IAM evidence fills live conditions without a model and preserves map/date state', () => fixture(async ({ root, put }) => {
  const deal = { ...pending('vapiano'), url, brand: 'VAPIANO', title: 'VAPIANO: 1+1 Pasta für App-Neukunden', validUntil: '2027-02-28' };
  put('docs/deals.json', { deals: [deal] });
  put('reviews/maintenance-source-evidence.json', { entries: { [url]: createMaintenanceSourceEntry(deal, evidence, now) } });
  const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request: () => assert.fail('no model call') });
  assert.equal(result.deals[0].description, reviewedIamstudentCopy(evidence).description);
  assert.equal(result.deals[0].validUntil, deal.validUntil, 'copy enrichment never changes a period');
  assert.equal(result.deals[0].enrichmentPending, true);
  assert.deepEqual(result.deals[0].enrichmentFields, ['map']);
  assert.equal(result.deals[0].distance, 'Wien · Standort folgt');
  assert.equal(result.report.ai.attempted, 0);
  assert.equal(result.state.corrections[0].method, 'reviewed-source-template-v1');
  assert.deepEqual(maintainDeals([deal], { policy, now, state: result.state,
    sourceEvidence: maintenanceEvidenceFor([deal], { entries: { [url]: createMaintenanceSourceEntry(deal, evidence, now) } }, now) }).deals, result.deals);
}));

test('stale, changed, rejected or missing current public evidence cannot reuse an old caption', () => fixture(async ({ root, put }) => {
  const deal = { ...pending(), url, brand: 'VAPIANO', caption: evidence.caption };
  const row = createMaintenanceSourceEntry(deal, evidence, now);
  for (const entry of [null, { ...row, checkedAt: '2026-11-12T12:00:00Z' }, { ...row, status: 'deferred' },
    { ...row, text: 'Changed conditions' }, { ...row, approvalSourceEvidence: { ...evidence, voucherId: 'other' } }]) {
    put('docs/deals.json', { deals: [deal] });
    put('reviews/maintenance-source-evidence.json', { entries: entry ? { [url]: entry } : {} });
    const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request: () => assert.fail('no stale model review') });
    assert.deepEqual(result.deals, [deal]);
  }
}));

test('due descriptions take the existing four slots, retain feed order and never consume a fifth review', () => fixture(async ({ root, put }) => {
  const ordinary = { ...pending('ordinary'), enrichmentPending: false, enrichmentFields: [], description: '' };
  const deals = [ordinary, ...Array.from({ length: 5 }, (_, i) => pending(`due-${i}`)),
    { ...pending('future'), enrichmentNextReviewAt: '2026-11-15T12:00:00Z' },
    { ...pending('manual'), liveEditedFields: ['description'] }];
  put('docs/deals.json', { deals });
  const calls = [];
  const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request: modelMock(calls) });
  assert.equal(result.report.ai.attempted, 4);
  assert.equal(calls.length, 8, 'four draft plus independent verification pairs');
  assert.deepEqual(result.deals.map(d => d.id), deals.map(d => d.id));
  for (const deal of result.deals.slice(1, 5)) { assert.equal(deal.description, description); assert.deepEqual(deal.enrichmentFields, ['map']); }
  assert.deepEqual(result.deals[0], ordinary);
  for (let i = 5; i < deals.length; i++) assert.deepEqual(result.deals[i], deals[i]);
}));

test('a veto keeps the placeholder, schedules a bounded retry and cannot rebill immediately', () => fixture(async ({ root, put }) => {
  put('docs/deals.json', { deals: [pending()] });
  const calls = [], request = modelMock(calls, false);
  const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request });
  assert.equal(result.deals[0].description, pending().description);
  assert.deepEqual(result.deals[0].enrichmentFields, ['description', 'map']);
  assert.equal(result.deals[0].enrichmentNextReviewAt, '2026-11-14T13:00:00.000Z', 'map remains eligible at the earlier hourly pass');
  await maintainFeedFile({ cwd: root, now, allowAi: true, request });
  await maintainFeedFile({ cwd: root, now: new Date(+now + 2 * 3600000), allowAi: true, request });
  assert.equal(calls.length, 2);
}));

test('current Preisjaeger full-body evidence replaces its stale preview within one existing source slot', () => fixture(async ({ root, put }) => {
  const sourceUrl = 'https://www.preisjaeger.at/deals/mcdonalds-gratis-fussball-donut-zum-osterreich-match-372365';
  const source = fs.readFileSync(fileURLToPath(new URL('./fixtures/preisjaeger-donut-dom-20261114.html', import.meta.url)), 'utf8');
  const deal = { ...pending('donut'), url: sourceUrl, brand: "McDonald's" };
  put('docs/deals.json', { deals: [deal] });
  let calls = 0;
  const result = await refreshMaintenanceEvidence({ root, now, fetchPage: async value => {
    calls++; assert.equal(value, sourceUrl); return { html: source, finalUrl: sourceUrl, status: 200 };
  } });
  assert.equal(calls, 1);
  const current = maintenanceEvidenceFor([deal], result.cache, now).get(deal.id).officialText;
  assert(current.includes('17.11.2026'));
  assert(current.includes('Nicht über McDelivery'));
  assert(!current.includes('morgen wissen wir mehr'));
  assert.equal(result.report.sourceRequests, 1);
}));

test('title-only review fetches the exact source and corrects that live row without buffering a second fetch or touching approved fields', () => fixture(async ({ root, put }) => {
  const sourceUrl = 'https://www.preisjaeger.at/deals/mcdonalds-gratis-fussball-donut-zum-osterreich-match-372365';
  const source = fs.readFileSync(fileURLToPath(new URL('./fixtures/preisjaeger-donut-dom-20261114.html', import.meta.url)), 'utf8');
  const deal = {
    id: 'title-only', url: sourceUrl, brand: "McDonald's", title: 'Instagram Deal mit viel Text ohne eine klare Überschrift zum Speiseangebot',
    description: 'Ein Donut mit der App, gültig am 17.11.2026.', expiryKind: 'single',
    validOn: '2026-11-17', expires: '2026-11-17T23:59:59.999Z', votes: 11, liveEditedFields: ['description', 'validOn'],
  };
  put('docs/deals.json', { deals: [deal] });
  let reads = 0;
  const result = await refreshMaintenanceEvidence({ root, now, fetchPage: async currentUrl => {
    assert.equal(currentUrl, sourceUrl);
    reads++;
    return { html: source, finalUrl: currentUrl, status: 200 };
  } });
  assert.equal(reads, 1);
  const captured = maintenanceEvidenceFor([deal], result.cache, now).get(deal.id).officialText.replace(/\s+/g, ' ');
  assert.match(captured, /gratis Fußball Donut/);
  let reviews = 0;
  const edited = await maintainFeedFile({ cwd: root, now, allowAi: true, request: async (_url, init) => {
    reviews++;
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    const content = Object.hasOwn(payload, 'patch') ? { supported: true }
      : { title: 'Gratis Fußball-Donut', quote: 'gratis Fußball Donut', description: '', conditionsQuote: '', dateQuote: '' };
    assert.ok(payload.evidence.includes(captured));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] });
  } });
  assert.equal(reviews, 2);
  assert.deepEqual(edited.deals, [{ ...deal, title: 'Gratis Fußball-Donut' }]);
  const reviewed = { ...deal, liveEditedFields: ['title', 'description', 'validOn'] };
  put('docs/deals.json', { deals: [reviewed] });
  put('reviews/maintenance-source-evidence.json', { entries: {} });
  const manual = await refreshMaintenanceEvidence({ root, now, fetchPage: () => assert.fail('protected title is not fetched') });
  assert.equal(manual.report.sourceRequests, 0);
}));

test('published marktguru terms complete the same NESCAFÉ text without a model or guessed expiry or map points', () => fixture(async ({ root, put }) => {
  const source = fs.readFileSync(fileURLToPath(new URL('./fixtures/marktguru-nescafe-20261117.html', import.meta.url)), 'utf8');
  const deal = { ...pending('fc4g-w3wqsu'), url: MARKTGURU_NESCAFE_URL, brand: 'BILLA',
    title: '1+1 gratis beim Kauf von zwei NESCAFÉ Espresso Concentrate', distance: 'Wien · Standort folgt', expiryKind: 'start',
    validFrom: '2026-11-06', expiresOriginal: 'ab 06.11.2026 ab 09:00 Uhr' };
  for (const changed of [source.replace('61% verfügbar', '0% verfügbar'), source.replace('"workflowState":"published"', '"workflowState":"expired"'),
    source.replace('"id":6566', '"id":6567'), source.replace('Eurospar', 'Andere Händler'),
    source.replace('class="desc"', 'class="desc" hidden'), source.replace('"cutoffDate":null', '"cutoffDate":"2026-11-30"')]) {
    assert.match(extractMarktguruCashbackEvidence(changed, deal.url).blockingReason, /nicht/);
  }
  put('docs/deals.json', { deals: [deal] });
  const result = await refreshMaintenanceEvidence({ root, now, fetchPage: async currentUrl => {
    assert.equal(currentUrl, deal.url);
    return { html: source, finalUrl: currentUrl, status: 200 };
  } });
  assert.equal(result.report.sourceRequests, 1);
  assert.equal(result.cache.entries[deal.url].status, 'verified');
  const completed = await maintainFeedFile({ cwd: root, now, allowAi: true, request: () => assert.fail('reviewed fixed copy requires no model') });
  const row = completed.deals[0];
  assert.equal(row.id, deal.id);
  assert.equal(row.title, deal.title);
  assert.equal(row.distance, deal.distance);
  assert.equal(row.validFrom, deal.validFrom);
  assert.equal(row.expiresOriginal, deal.expiresOriginal);
  assert.equal(row.validUntil, undefined);
  assert.match(row.description, /günstigeren Produkts/);
  assert.match(row.description, /drei Einlösungen pro Person/);
  assert.match(row.description, /Click & Collect/);
  assert.deepEqual(row.enrichmentFields, ['map']);
  assert.equal(completed.report.ai.attempted, 0);
}));

test('source refresh prioritizes due public originals inside the same four offer attempts and caches the response', () => fixture(async ({ root, put }) => {
  const publicDeal = { ...pending('vapiano'), url, brand: 'VAPIANO' };
  const others = Array.from({ length: 5 }, (_, i) => ({ id: `carrier-${i}`, brand: 'Fixture',
    url: `https://www.drei.at/de/dreiplus/ersparnisse/fixture-${i}/`, description: '' }));
  put('docs/deals.json', { deals: [...others, publicDeal] });
  const calls = [];
  const fetchPage = async value => { calls.push(value); return { html: value === url ? html : '<html></html>', finalUrl: value, status: 200 }; };
  const result = await refreshMaintenanceEvidence({ root, now, fetchPage });
  assert.equal(calls[0], url);
  assert.equal(calls.length, 4);
  assert.equal(result.report.sourceRequests, 4);
  assert.equal(result.report.offerPageAttempts, 4);
  assert.equal(result.cache.entries[url].status, 'verified');
  assert.equal(maintenanceEvidenceFor([publicDeal], result.cache, now).get(publicDeal.id).officialText, evidence.caption);
  calls.length = 0;
  await refreshMaintenanceEvidence({ root, now, fetchPage });
  assert(!calls.includes(url), 'successful source read is not repeated every push');
}));

test('public refresh fails closed for refusal/redirect/changed terms and honours host pause without extending it', () => fixture(async ({ root, put }) => {
  const deal = { ...pending(), url, brand: 'VAPIANO' };
  put('docs/deals.json', { deals: [deal] });
  for (const page of [{ html, finalUrl: url, status: 403 }, { html, finalUrl: 'https://www.iamstudent.at/login', status: 200 },
    { html: html.replace('PASTALOVER', 'OTHER'), finalUrl: url, status: 200 }]) {
    put('reviews/maintenance-source-evidence.json', { entries: {} });
    const result = await refreshMaintenanceEvidence({ root, now, fetchPage: async () => page });
    assert.equal(result.cache.entries[url].status, 'deferred');
    assert(!maintenanceEvidenceFor([deal], result.cache, now).get(deal.id).officialText);
  }
  const paused = { entries: { [url]: { url, status: 'deferred', httpStatus: 429, nextAttemptAt: '2026-11-18T12:00:00Z' } } };
  put('reviews/maintenance-source-evidence.json', paused);
  const result = await refreshMaintenanceEvidence({ root, now, fetchPage: () => assert.fail('paused host is not requested') });
  assert.deepEqual(result.cache, paused);
}));

test('real transport shares the five-request cap with carrier robots and rejects public redirects without following', () => fixture(async ({ root, put }) => {
  const publicDeal = { ...pending(), url, brand: 'VAPIANO' };
  const carriers = Array.from({ length: 4 }, (_, i) => ({ id: `carrier-${i}`, brand: 'Fixture',
    url: `https://www.drei.at/de/dreiplus/ersparnisse/fixture-${i}/`, description: '' }));
  put('docs/deals.json', { deals: [publicDeal, ...carriers] });
  const calls = [];
  const fetchImpl = async (value, init) => {
    calls.push(value); assert.equal(init.redirect, 'manual');
    return new Response(value.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : value === url ? html : '<html></html>',
      { headers: { 'content-type': 'text/html' } });
  };
  const result = await refreshMaintenanceEvidence({ root, now, fetchImpl });
  assert.equal(calls.length, 5);
  assert.equal(result.report.offerPageAttempts, 4);
  assert.equal(result.report.sourceRequests, 5);
  put('reviews/maintenance-source-evidence.json', { entries: {} });
  put('docs/deals.json', { deals: [publicDeal] });
  let redirects = 0;
  await refreshMaintenanceEvidence({ root, now, fetchImpl: async (_url, init) => {
    redirects++; assert.equal(init.redirect, 'manual'); return new Response('', { status: 302, headers: { location: 'https://example.org/' } });
  } });
  assert.equal(redirects, 1);
}));

test('targeted review passes one real draft to the independent verifier and preserves unrelated feed records', () =>
  fixture(async ({ root, put }) => {
    const untouched = pending('other'), target = pending('target');
    const globalReport = { existing: true };
    put('docs/deals.json', { deals: [untouched, target], totalDeals: 2 });
    put('docs/automatic-deal-maintenance-report.json', globalReport);
    const drafts = [], verifications = [];
    const editor = { model: 'gpt-6.2-sol', request: modelMock(drafts) };
    const result = await maintainFeedFile({ cwd: root, now, allowAi: true, targetDealId: 'target',
      editor, request: modelMock(verifications) });
    assert.equal(drafts.length, 1);
    assert.equal(verifications.length, 1);
    assert.deepEqual(verifications[0].patch, { description });
    assert.deepEqual(result.report.corrected.map(row => row.id), ['target']);
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'docs/deals.json')));
    assert.equal(saved.totalDeals, 2);
    assert.deepEqual(saved.deals[0], untouched);
    assert.equal(saved.deals[1].description, description);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'docs/automatic-deal-maintenance-report.json'))), globalReport);
    await assert.rejects(maintainFeedFile({ cwd: root, now, allowAi: true, targetDealId: 'absent',
      editor, request: modelMock(verifications) }), /exactly one live deal/);
    assert.equal(drafts.length, 1);
  }));

test('a duplicated benefit badge in verified merchant copy requests a grounded description only', () =>
  fixture(async ({ root, put }) => {
    const url = 'https://example.org/aktionen', text = '3+1 3+1 Gratis Aktion. Auf ausgewählte Süßwaren gilt unser 3+1-Angebot. Nur solange der Vorrat reicht!';
    const evidence = { source: 'official-merchant-page', extractionMethod: 'merchant-card', sourceUrl: url,
      textSample: text, contentHash: createHash('sha256').update(text).digest('hex') };
    const row = { id: 'sweets', brand: 'Testladen', url, title: '3+1 auf ausgewählte Süßwaren',
      description: text, evidence, expiryKind: 'unknown' };
    assert.deepEqual(copyReviewReasons(row), ['description']);
    assert.deepEqual(copyReviewReasons(row, new Set(['description'])), []);
    for (const change of [
      {description: '3+1 gratis auf ausgewählte Ware.'}, {evidence: {...evidence, contentHash:'outdated'}},
      {evidence: {...evidence, sourceUrl:'https://example.org/other'}},
      {evidence: {...evidence, extractionMethod:'news-index'}},
    ]) assert.deepEqual(copyReviewReasons({...row,...change}), []);
    put('docs/deals.json', { deals: [row] });
    const cleanCopy = 'Für ausgewählte Süßwaren gilt die Aktion 3+1, solange der Vorrat reicht.';
    let editorCalls = 0, verifierCalls = 0;
    const answer = value => Response.json({ choices: [{finish_reason:'stop',message:{content:JSON.stringify(value)}}] });
    const result = await maintainFeedFile({ cwd: root, now, allowAi:true, request:async (_url,init) => {
      const payload=JSON.parse(JSON.parse(init.body).messages[1].content);
      if (payload.requestedFields) {
        editorCalls++;
        assert.deepEqual(payload.requestedFields, ['description']);
        return answer({title:'',quote:'',description:cleanCopy,conditionsQuote:text,dateQuote:''});
      }
      verifierCalls++;
      assert.deepEqual(payload.patch,{description:cleanCopy});
      return answer({supported:true});
    } });
    assert.equal(editorCalls,1); assert.equal(verifierCalls,1);
    assert.deepEqual(result.deals[0],{...row,description:cleanCopy});
    assert.equal(result.report.ai.corrected,1);
    assert.deepEqual(copyReviewReasons(result.deals[0]), []);
  }));

const deliveryKitchen = { ...pending('g2-oyxgdj'), brand:'Kitchen 23', title:'30 % auf ausgewählte Super-Deals',
  url:'https://www.lieferando.at/speisekarte/kitchen-23-1230', enrichmentFields:['description'], caption:'Eine alte Kopie' };
const deliveryBurger = { ...deliveryKitchen, id:'g2-1kg4kae', brand:'Lieferando',
  title:'1+1 gratis: ausgewählte Burger und Nuggets bei Lieferando', url:'https://www.lieferando.at/en/menu/bk-lc-wien-lugner-city',
  liveEditedAt:now.toISOString(), liveEditedFields:['title'] };
const deliveryPizza = { ...deliveryKitchen, id:'g2-acp99i', brand:'Don’t Call It Pizza', title:'7 EUR Rabatt auf Bestellungen über 16 EUR',
  url:'https://wolt.com/de-at/aut/vienna/restaurant/dont-call-it-pizza' };
const menuPage = (url, venue, title, text) => '<html><head><link rel="canonical" href="'+url+'"></head><body><main><h1>'+venue+
  '</h1><article><h2>'+title+'</h2><p>'+text+'</p></article></main></body></html>';
const transport = (handler, calls) => async (url, init) => {
  calls.push(url); assert.equal(init.redirect, 'manual');
  return url.endsWith('/robots.txt') ? new Response('User-agent: *\nAllow: /', {headers:{'content-type':'text/plain'}}) : handler(url);
};
const htmlReply = text => new Response(text,{headers:{'content-type':'text/html'}});

test('restaurant menus share the normal HTTP cap, actual provider refusal blocks the other venue, stale copy is suppressed', () => fixture(async ({ root, put }) => {
  const ds=[deliveryKitchen,deliveryBurger,deliveryPizza]; put('docs/deals.json',{deals:ds}); const calls=[];
  const result=await refreshMaintenanceEvidence({ root,now,renewRedemptions:true,fetchImpl:transport(url =>
    url===deliveryKitchen.url ? new Response('Forbidden',{status:403,headers:{'retry-after':'90000'}}) :
      htmlReply(menuPage(url,"Don't Call It Pizza 1120",'Speisekarte','Pizza 7 EUR. Pizza Special 16 EUR.')), calls) });
  assert.deepEqual(calls,['https://www.lieferando.at/robots.txt',deliveryKitchen.url,'https://wolt.com/robots.txt',deliveryPizza.url]);
  assert.equal(result.report.sourceRequests,4);
  assert.equal(result.cache.entries[deliveryPizza.url].reason,'promotion-not-confirmed-on-current-menu');
  assert.equal(result.cache.entries[deliveryKitchen.url].httpStatus,403);
  for (const row of ds) assert.ok(maintenanceEvidenceFor(ds,result.cache,now).get(row.id).blockingReason);
  await refreshMaintenanceEvidence({root,now:new Date(+now+3600000),renewRedemptions:true,fetchImpl:()=>assert.fail('ignore cooldown')});
}));

test('a protected title still permits its independently matched description to be researched', () => fixture(async({root,put}) => {
  put('docs/deals.json',{deals:[deliveryBurger]});
  const calls=[];
  const text='1+1 gratis auf den Crispy Chicken bei der Bestellung über das Menü für die Filiale Lugner City.';
  const result=await refreshMaintenanceEvidence({root,now,renewRedemptions:true,
    fetchImpl:transport(url => htmlReply(menuPage(url,'Burger King Lugner City','1+1 Deals',text)),calls)});
  assert.equal(calls.length,2); const evidence=maintenanceEvidenceFor([deliveryBurger],result.cache,now).get(deliveryBurger.id);
  assert.match(evidence.officialText,/Crispy Chicken/);assert.equal(evidence.deliveryOffer,true);
  const hidden={...deliveryBurger, liveEditedFields:['description']}; put('docs/deals.json',{deals:[hidden]});
  await refreshMaintenanceEvidence({root,now:new Date(+now+2*86400000),renewRedemptions:true,fetchImpl:()=>assert.fail('protected field')});
}));

test('future approved menus require a canonical first-party restaurant, exact campaign title and original product or conditions', async () => {
  const {extractDeliveryOffer}=await import('../scraper/delivery-menu-evidence.js');
  const d={...deliveryKitchen,id:'future-branch-campaign',brand:'Pizzeria Wien', title:'20 % auf ausgewählte große Pizzen',
    description:'Details werden ergänzt. Gilt nur für die Aktionspizzen Marinara und Funghi ab 25 EUR Bestellwert. – Testgasse 1, 1010 Wien',
    distance:'Testgasse 1, 1010 Wien',approvedAt:now.toISOString(),url:'https://www.lieferando.at/speisekarte/pizzeria-wien'};
  const details='Gilt nur für die Aktionspizzen Marinara und Funghi ab 25 EUR Bestellwert.';
  const page=menuPage(d.url,d.brand,d.title,details+' Gültig bis 30.11.2026. Gutschein an der Kasse aktivieren.');
  assert.match(extractDeliveryOffer(d,page,d.url,now),/Gutschein an der Kasse/);
  for (const broken of [page.replace('20 %','25 %'), page.replace('25 EUR Bestellwert','20 EUR Bestellwert'),
    page.replace('Marinara und Funghi','alle Gerichte'), page.replace('Pizzeria Wien','Andere Filiale'),
    page.replace('30.11.2026','10.11.2026'), page.replace('<article>','<article hidden>'), page.replace('canonical','unknown')]) {
    assert.equal(extractDeliveryOffer(d,broken,d.url,now),null);
  }
  assert.equal(extractDeliveryOffer({...d,description:d.title},page,d.url,now),null);
  assert.equal(extractDeliveryOffer(d,page,'https://other.example/menu',now),null);
});

test('unchanged delivery terms are not repeatedly sent to the editor after a veto; a later source revision is eligible', () => fixture(async({root,put}) => {
  const deal={...deliveryPizza,enrichmentNextReviewAt:'2026-11-10T00:00:00Z'};
  put('docs/deals.json',{deals:[deal]});
  const source=menuPage(deal.url,"Don't Call It Pizza 1120",'Aktionsangebot',
    '7 EUR Rabatt auf Bestellungen über 16 EUR. Der Vorteil gilt bei Lieferung der Speisen durch Wolt.');
  const refresh=(at,page)=>refreshMaintenanceEvidence({root,now:at,renewRedemptions:true,fetchImpl:transport(()=>htmlReply(page),[])});
  const calls=[];
  const check=at=>maintainFeedFile({cwd:root,now:at,allowAi:true,request:modelMock(calls,false)});
  await refresh(now,source);
  assert.equal((await check(now)).report.ai.attempted,1);
  const later=new Date(+now+25*3600000);
  await refresh(later,source);
  assert.equal((await check(later)).report.ai.attempted,0);
  const after=new Date(+later+25*3600000);
  await refresh(after,source.replace('durch Wolt','durch Wolt, einmal pro Konto'));
  assert.equal((await check(after)).report.ai.attempted,1);
}));

test('a field-specific title edit permits original coupon terms to be refreshed; unspecified historical edit remains protected', () => fixture(async ({root,put}) => {
  const manual={...pending(),url,brand:'VAPIANO',title:'Persönlicher, redigierter Titel',liveEditedAt:now.toISOString(),liveEditedFields:['title']};
  put('docs/deals.json',{deals:[manual]});
  const calls=[];
  const result=await refreshMaintenanceEvidence({root,now,fetchPage:async value=>{calls.push(value);return {html,finalUrl:value,status:200};}});
  assert.deepEqual(calls,[url]); assert.equal(result.cache.entries[url].status,'verified');
  put('docs/deals.json',{deals:[{...manual,liveEditedFields:[]}]});
  await refreshMaintenanceEvidence({root,now:new Date(+now+2*86400000),fetchPage:()=>assert.fail('unspecified manual edit')});
}));
