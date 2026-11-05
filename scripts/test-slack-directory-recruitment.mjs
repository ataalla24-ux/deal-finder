import assert from 'node:assert/strict';
import {getNonOfferContentReason} from '../scraper/promotion-quality-utils.js';
import {validateDealsForSlack} from '../scraper/deal-validity-agent.js';
import {selectFirecrawlReviewDeals} from '../scraper/slack-notify.js';
const examples = [
  'CURRENT PROMOTIONS | Hard Rock Cafes Current Promos at Hard Rock Cafe',
  'Aktuelle Gastro Aktionen Hier finden Sie die aktuellen Gastronomieangebote der ADMIRAL Sportsbars.',
  'IKEA Wien Westbahnhof Angebote Hier findest du alle Angebote im IKEA Einrichtungshaus Wien Westbahnhof.',
  'Ein gratis Ticket fuer den Kochkurs im Wert von 130 Euro. Volunteers Wanted! Wir suchen Unterstuetzung. Du bist Adis Helping Hand.',
];
for (const text of examples) assert.ok(getNonOfferContentReason(text), text);
for (const text of [
  'Current promotions: Pizza fuer nur 4 Euro in Wien.',
  'Aktuelle Gastro Aktionen: 1+1 Burger gratis mit Gutschein.',
  'Hier findest du alle Angebote. Heute Kaffee gratis fuer alle Gaeste.',
  'Volunteers wanted. Heute gratis Pizza fuer alle Gaeste in unserem Lokal.',
  'Kostenloser Kochkurs fuer Gaeste am Samstag in Wien.',
]) assert.equal(getNonOfferContentReason(text), '', text);
const now = new Date('2026-11-05T11:00:00Z');
const result = await validateDealsForSlack(examples.map((description,index)=>({id:'noise-fixture-'+index,
  brand:'Fixture Restaurant',title:description,description,category:'essen',type:'gratis',location:'Wien',
  source:'Firecrawl Food #2',url:'https://example.com/offer/'+index,pubDate:now.toISOString(),
  sourcePublishedAt:now.toISOString(),sourcePublishedAtSource:'source.timestamp',validUntil:'2026-11-30'})),
  {now,inspectDealUrlHealth:async()=>({status:200,contentHints:{},dateHints:{}})});
assert.equal(result.allowedDeals.length,0);
assert.ok(result.results.every(row=>row.decision.reasons.some(reason=>/Freiwilligensuche|Angebotsuebersicht/.test(reason))));
assert.equal(selectFirecrawlReviewDeals(result.results).deals.length,0,'Soft-review fallback must not re-admit these exact noise cases');
console.log('PASS: actual directory/recruitment false positives, genuine food controls, central validation and soft-review exclusion');
