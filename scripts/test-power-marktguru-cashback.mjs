import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POWER_FOOD_SOURCES, officialFoodOfferKey } from '../scraper/power-food-sources.js';
import { extractFoodOffers } from '../scraper/power-food-extraction.js';
import { crawlFoodSource } from '../scraper/power-food-crawler.js';
import { verifyOfficialFoodDeal } from '../scraper/power-food-verification.js';
import { runScheduledPowerSource } from '../scraper/power-source-scheduling.js';
import { sourceHttpError } from '../scraper/source-http-policy.js';

process.env.SENTRY_DISABLED = '1';
const { validateDealsForSlack } = await import('../scraper/deal-validity-agent.js');
const { validateApprovalCandidates } = await import('../scraper/slack-approve.js');
const source = POWER_FOOD_SOURCES.find(source => source.name === 'marktguru Cashback');
const index = 'https://www.marktguru.at/cashback';
const url = 'https://www.marktguru.at/mb/test-knoedel-cashback-789';
const other = 'https://www.marktguru.at/mb/test-kaese-cashback-711';
const now = new Date('2026-11-21T12:00:00Z');
const product = 'Test-Knödel mit Füllung';
const action = '50% Cashback beim Kauf von einer Packung Test-Knödel';
const terms = '<ul><li>Start der Aktion: 16.11.2026</li><li>Aktion: ' + action
  + '</li><li>Wo gültig: Interspar</li><li>Kassenbon vollständig einreichen.</li>'
  + '<li>Gültig beim Kauf in Österreich ab dem 16.11.2026 bei folgenden Händlern: Interspar</li>'
  + '<li>Onlinekäufe sind erlaubt, solange die Lieferadresse in Österreich ist. Bestimmte Shops sind ausgeschlossen.</li>'
  + '<li>Aktion gültig nur solange der Vorrat und das Budget reicht</li></ul>';

function html(canonical, data, body) {
  return '<html><head><link rel="canonical" href="' + canonical + '"></head><body><main class="app-main">'
    + body + '</main><script type="application/json">' + JSON.stringify({data}) + '</script></body></html>';
}

function detail(overrides = {}, conditions = terms) {
  const data = { id: 789, detailTitle: product, type: 'percent', cashbackValue: 50, workflowState: 'published',
    validFrom: '2026-11-15T23:00:00Z', cutoffDate: null, receiptEndValidityDate: null,
    isReceiptCampaign: true, userRedeemLimit: 3, campaignAvailability: 81, conditionsDescription: conditions,
    redeemDescription: '<p>Rechnung mit der App einreichen. Mindestguthaben für die Auszahlung: 5 €.</p>', ...overrides };
  return html(url, { cashback: {status: 200, data} },
    '<div class="cashback-details"><div class="info"><h1>' + product + '</h1><div class="cashback-badge">50 %Cashback</div>'
      + '<div class="cashback-details-info"><div class="progress">81% verfügbar</div><div>3x Einlösbar pro Person</div></div></div></div>'
      + '<div class="box"><div class="title"><h2>Bedingungen</h2></div><div class="desc">' + conditions + '</div></div>');
}

function listing() {
  const rows = [
    [711, 'Test-Käse', other], [789, product, url],
    [800, 'Käse-Gewinnspiel', 'https://www.marktguru.at/mb/gewinnspiel-cashback-800'],
  ];
  return html(index, {items: rows.map(([id, name]) => ({ id, name, type: 'percent', cashbackValue: 50, isLoyaltyCampaign: false }))},
    '<div class="box cashbacks"><div class="title"><h2>Aktuelle cashback Aktionen</h2></div>' +
    rows.map(([, name, link]) => '<a class="cashback" href="' + new URL(link).pathname + '" title="' + name + ' mit 50 % - Cashback">'
      + '<div class="cashback-title">' + name + '</div><div class="cashback-badge">50 %Cashback</div></a>').join('') + '</div>');
}

const extract = (body, href = url) => extractFoodOffers(body, source, { now, pageUrl: href }).deals;
const page = html => ({ status: 200, finalUrl: url, html });

test('the existing Power schedule spends two direct pages, rotates and respects source-denial cooldown', async () => {
  const fetches = [];
  const collect = source => crawlFoodSource(source, {now, maxPages: 8, fetchPage: async href => {
    fetches.push(href);
    return {status:200, finalUrl:href, html: href === index ? listing() : detail()};
  }, renderPage: () => assert.fail('no browser fallback') });
  const initial = await runScheduledPowerSource(source, {}, collect, now);
  assert.deepEqual(fetches, [index, url]);
  assert.equal(initial.rows.length, 1);
  fetches.length = 0;
  await runScheduledPowerSource(source, { sources:[initial] }, collect, now);
  assert.deepEqual(fetches, [index, other]);
  const blocked = await runScheduledPowerSource(source, {}, src => crawlFoodSource(src, {
    now, fetchPage: async () => {throw sourceHttpError(403);},
  }), now);
  assert.equal(blocked.cooldown.reason, 'access-denied');
  const deferred = await runScheduledPowerSource(source, { sources:[blocked] }, () => assert.fail('cooldown ignored'), now);
  assert.equal(deferred.status, 'deferred');
});

test('available campaign retains terms, local start, unknown end, stable URL identity and passes review', async () => {
  const offer = extract(detail())[0];
  assert.equal(offer.validFrom, '2026-11-16');
  assert.equal(offer.validUntil, undefined);
  assert.equal(offer.address, undefined);
  assert.equal(offer.sourcePublishedAt, undefined);
  assert.equal(officialFoodOfferKey(offer), url.replace('www.', ''));
  for (const term of [action, 'Interspar', '3 Einlösungen', 'Kassenbon', 'Shops sind ausgeschlossen', '5 €']) assert.ok(offer.description.includes(term), term);
  const response = page(detail());
  const options = { now, requireVienna:true, existingDeals:[], requireMap: false,
    inspectDealUrlHealth: async () => ({status:200, finalUrl:url, dateHints:{}, contentHints:{}}),
    fetchOfficialFoodPage: async () => response };
  const slack = await validateDealsForSlack([structuredClone(offer)], options);
  assert.equal(slack.allowedDeals.length, 1, JSON.stringify(slack.results[0].decision));
  assert.equal(slack.results[0].decision.sourceDate, '');
  const approval = await validateApprovalCandidates([{...structuredClone(offer), pipelineLifecycle:{manualDecision:'approved'}}], options);
  assert.equal(approval.allowedDeals.length, 1, JSON.stringify(approval.results[0].decision));
  assert.equal((await verifyOfficialFoodDeal({...offer, id:'power-food-000000000000'}, { now, fetchPage:async()=>response })).ok, false);
  assert.equal((await verifyOfficialFoodDeal(offer, { now, fetchPage:async()=>page(detail({campaignAvailability:0})) })).ok, false);
});

test('withdrawn, foreign, altered and contradictory campaigns never enter the queue', () => {
  for (const patch of [{id:790}, {workflowState:'expired'}, {isReceiptCampaign:false}, {campaignAvailability:0}, {campaignAvailability:12},
    {validFrom:'2027-11-16T00:00:00Z'}, {receiptEndValidityDate:'2026-11-19'}, {cutoffDate:'2026-11-17'},
    {type:'percent', cashbackValue:5}, {cashbackValue:51}, {userRedeemLimit:1}, {conditionsDescription:'other'}]) {
    assert.equal(extract(detail(patch)).length, 0, JSON.stringify(patch));
  }
  for (const marker of ['außer Wien', 'nur in Graz', 'gültig bis 20.11.2026', 'Aktion vorzeitig beendet', 'in Österreich nicht gültig', 'kein Cashback']) {
    assert.equal(extract(detail({},terms.replace('</ul>', '<li>' + marker + '</li></ul>'))).length, 0, marker);
  }
  assert.equal(extract(detail().replace('class="info"', 'class="info" hidden')).length, 0);
  assert.equal(extract(detail(), url + '?archiv=1').length, 0);
  assert.equal(extract(detail(), other).length, 0);
});

test('Slack and app retain the food category and mixed redemption when online shops are excluded', async () => {
  const {normalizeDeal: notify} = await import('../scraper/slack-notify.js');
  const {normalizeDeal: approve} = await import('../scraper/slack-approve.js');
  const {normalizeDealRecord} = await import('../scraper/deal-normalization-utils.js');
  const {onlineOnly} = await import('./deal-map-enrichment.mjs');
  const original = extract(detail({}, terms.replace('Bestimmte Shops', 'dm und Bipa-Onlineshops')))[0];
  const misclassified = {...original, category:'beauty'};
  for (const row of [notify(misclassified, 'power'), approve(misclassified), normalizeDealRecord(misclassified)]) {
    assert.equal(row.category, 'essen');
    assert.equal(onlineOnly(row), false);
    assert.equal(row.address || '', '');
  }
});

test('exact label repair keeps the existing Slack button and receipt, and a retry only reads', async () => {
  const {repairQueuedSlackDeal} = await import('./repair-slack-queued-deal.mjs');
  const offer = extract(detail())[0];
  const target = {...offer, category:'essen', slackTs:'1.2', slackThreadTs:'1.0'};
  const queuePayload = {deals:[target]};
  const receipt = {dealId:target.id,url:target.url,slackTs:'1.2',slackThreadTs:'1.0',category:'beauty',decision:'',slackSentAt:'2026-11-21T12:00:00Z'};
  const button = {type:'actions',elements:[{type:'button',action_id:'freefinder_edit_pending',text:{type:'plain_text',text:'Bearbeiten'},url:'https://example.invalid/signed'}]};
  const labels = 'Kategorie: beauty | Typ: rabatt\nINTERN Karte: [online-only] Reines Online-Angebot. Nur Hinweis, keine Freigabe-/Entfernungsregel.';
  let message = {ts:target.slackTs,thread_ts:target.slackThreadTs,bot_id:'test-bot',
    text:target.id + '\n' + target.url + '\n' + labels, blocks:[{type:'section',text:{type:'mrkdwn',text:labels}},button]};
  const methods = [];
  const options = {action:'update',channel:'test',expectedDealId:target.id,url:target.url,sourceDeals:[offer],queuePayload,
    validate:async()=>({allowedDeals:[offer]}),feedbackPayload:{events:[receipt]}, now, slackApi:async(method,payload)=>{
      methods.push(method);
      if(method === 'reactions.get') return {ok:true, message};
      assert.equal(method,'chat.update');
      assert.equal(payload.ts,target.slackTs);
      message = {...message,...payload};
      return {ok:true};
    }};
  const result = await repairQueuedSlackDeal(options);
  assert.deepEqual(methods,['reactions.get','chat.update']);
  assert.equal(result.slackChanged,true);
  assert.deepEqual(result.feedbackPayload.events,[{...receipt,category:'essen'}]);
  assert.deepEqual(message.blocks[1],button);
  assert.match(message.text,/Kategorie: essen/);
  assert.match(message.blocks[0].text.text,/INTERN Karte: \[needs-review\]/);
  const retry = await repairQueuedSlackDeal({...options,feedbackPayload:result.feedbackPayload});
  assert.equal(retry.slackChanged,false);
  assert.equal(retry.feedbackPayload,undefined);
  assert.deepEqual(methods,['reactions.get','chat.update','reactions.get']);
});

test('rotation keeps only recent, independently listed unchanged detail evidence without new requests or a new timestamp', async () => {
  const original = extract(detail())[0];
  const nextTime = new Date(+now + 86400000);
  async function next(previousRows, { at=nextTime, indexHtml=listing(), body=detail(), selected=other, status=200, maxDeals=10 }={}) {
    const urls=[];
    const result=await crawlFoodSource({ ...source, previousDetailUrl: selected === other ? url : other }, {
      previousCashbackRows:previousRows, now:at, maxPages:2, maxDeals,
      fetchPage:async href => {
        urls.push(href);
        if (href===index) return {status:200,finalUrl:href,html:indexHtml};
        if (status!==200) throw sourceHttpError(status);
        const payload=href===other ? body.replaceAll(product,'Test-Käse').replaceAll('Test-Knödel','Test-Käse')
          .replaceAll(url, other).replace('"id":789','"id":711') : body;
        return {status:200,finalUrl:href,html:payload};
      }
    });
    assert.ok(urls.length<=2, 'never spend additional page requests on retained coupons');
    return result;
  }
  const second=await next([original,original]);
  assert.equal(second.rows.length,2);
  assert.equal(second.cashbackDetailsVerified,1);
  assert.equal(second.cashbackDetailsRetained,1);
  assert.deepEqual(second.rows.find(row=>row.id===original.id),original);
  assert.notEqual(second.rows[0].id,original.id,'newly fetched detail has priority');
  // Stable identity avoids a second Slack delivery even on a later fresh visit.
  const third=await next(second.rows,{selected:url});
  assert.equal(third.rows.length,2);
  assert.equal(officialFoodOfferKey(third.rows[0]),officialFoodOfferKey(original));
  assert.equal(third.rows[0].id, original.id);
  assert.equal(third.rows[0].lastCheckedAt,nextTime.toISOString());
  for(const indexHtml of [
    listing().replaceAll(product,'Geänderter Artikel'),
    listing().replace('class="cashback" href="'+new URL(url).pathname,'class="cashback" hidden href="'+new URL(url).pathname),
    listing().replace('Aktuelle cashback Aktionen','Archiv'),
    listing().replaceAll('"isLoyaltyCampaign":false','"isLoyaltyCampaign":false,"campaignAvailability":0'),
    listing().replaceAll('"isLoyaltyCampaign":false','"isLoyaltyCampaign":false,"workflowState":"archived"'),
    listing().replaceAll('50 %Cashback','25 %Cashback'),
    listing().replace(new URL(url).pathname, '/mb/neuer-link-cashback-789'),
    listing().replace('Aktuelle cashback Aktionen','Keine aktuellen cashback Aktionen'),
    '<html>Unvollständiger Abruf</html>',
  ]) assert.ok(!(await next([original],{indexHtml})).rows.some(row=>row.id===original.id));
  for(const body of [detail({campaignAvailability:0}), detail({workflowState:'archived'}), detail({cutoffDate:'2026-11-22'})])
    assert.ok(!(await next(second.rows,{selected:url,body})).rows.some(row=>row.id===original.id));
  assert.equal((await next([original],{status:403})).cashbackDetailsRetained,0);
  assert.equal((await next([original],{at:new Date(+now+8*86400000)})).cashbackDetailsRetained,0);
  assert.equal((await next([original],{at:new Date(+now-1000)})).cashbackDetailsRetained,0);
  assert.equal((await next([original],{maxDeals:1})).rows.length,1);
});
