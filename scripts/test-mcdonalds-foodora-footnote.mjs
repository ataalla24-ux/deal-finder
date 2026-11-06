import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFoodOffers} from '../scraper/power-food-extraction.js';
import {POWER_FOOD_SOURCES} from '../scraper/power-food-sources.js';
const source=POWER_FOOD_SOURCES.find(s=>s.name==="McDonald's");
const breakfast='Beim Kauf eines McMuffin Fresh Chicken, Nougatburgers oder Hashbrowns über die Bestellplattform foodora bis 10:30 Uhr und bis inklusive 30.11.2026';
const main='beim Kauf eines Hamburger Royal TS, Crispy Veggie Burgers, Filet-o-Fish, 6er Chicken McNuggets oder McPops® Strawberry, McPops® Chocolate oder McPops® Stracciatella über die Bestellplattform foodora bis inklusive 09.11.2026';
const shared='erhalten Kund ein zweites Exemplar des jeweils gewählten Produktes gratis dazu. Mindestbestellwert unverändert. In allen teilnehmenden Restaurants in Österreich, solange der Vorrat reicht. Nähere Infos auf www.foodora.at/mcdonalds';
const html=`<h2>1+1=1</h2><div class="column_attr"><p>** ${breakfast} oder ${main} ${shared}</p></div>`;
const parse=(text=html,day='2026-11-06',overrides={})=>extractFoodOffers(text,{...source,...overrides},{pageUrl:'https://www.mcdonalds.at/',now:new Date(day+'T12:00:00Z')});
test('two official periods retain their own products, provider and conditions',()=>{
  const rows=parse().deals;assert.equal(rows.length,2);
  assert.equal(rows[0].validUntil,'2026-11-30');assert.equal(rows[1].validUntil,'2026-11-09');
  assert.match(rows[0].description,/bis 10:30 Uhr/);assert.doesNotMatch(rows[1].description,/10:30|30\.11/);
  for(const d of rows){assert.equal(d.type,'bogo');assert.match(d.description,/Mindestbestellwert unverändert/);assert.match(d.description,/teilnehmenden Restaurants/);assert.match(d.title,/foodora/);assert.equal(d.pubDate,undefined);}
  assert.equal(new Set(rows.map(r=>r.id)).size,2);
  assert.equal(parse(html,'2026-11-10').deals.length,1);assert.equal(parse(html,'2026-12-01').deals.length,0);
});
test('changed products, timing, missing conditions and ambiguous duplicate footnotes fail closed',()=>{
  for(const changed of [html.replace('Hashbrowns','New Breakfast'),html.replace('09.11.2026','09.11.'),html.replace('Mindestbestellwert unverändert.',''),html+html,html.replace('1+1=1','Aktion')])
    assert.equal(parse(changed).deals.length,0);
  assert.equal(parse(html,'2026-11-06',{foodoraFootnote:false}).deals.length,0);
});
