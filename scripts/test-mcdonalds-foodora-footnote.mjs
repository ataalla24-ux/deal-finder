import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractFoodOffers} from '../scraper/power-food-extraction.js';
import {POWER_FOOD_SOURCES} from '../scraper/power-food-sources.js';
const source=POWER_FOOD_SOURCES.find(s=>s.name==="McDonald's");
const breakfast='Beim Kauf eines McMuffin Fresh Chicken, Nougatburgers oder Hashbrowns über die Bestellplattform foodora bis 10:30 Uhr und bis inklusive 30.11.2026';
const main='beim Kauf eines Hamburger Royal TS, Crispy Veggie Burgers, Filet-o-Fish, 6er Chicken McNuggets oder McPops® Strawberry, McPops® Chocolate oder McPops® Stracciatella über die Bestellplattform foodora bis inklusive 09.11.2026';
const shared='erhalten Kund ein zweites Exemplar des jeweils gewählten Produktes gratis dazu. Mindestbestellwert unverändert. In allen teilnehmenden Restaurants in Österreich, solange der Vorrat reicht. Nähere Infos auf www.foodora.at/mcdonalds';
const html=`<h2>1+1=1</h2><div class="column_attr"><p>** ${breakfast} oder ${main} ${shared}</p></div>`;
const parse=(text=html,day='2026-11-06',overrides={})=>extractFoodOffers(text,{...source,...overrides},{pageUrl:'https://www.mcdonalds.at/',now:new Date(day+'T12:00:00Z')});
const current=fs.readFileSync(new URL('./fixtures/mcdonalds-foodora-20261113.html',import.meta.url),'utf8');
test('actual November 13 footnote is a new main campaign, not an extension of the expired Nuggets offer',()=>{
  const rows=parse(current,'2026-11-13').deals;
  assert.equal(rows.length,2);
  const [breakfast,main]=rows;
  assert.equal(breakfast.validUntil,'2026-11-30');assert.equal(main.validUntil,'2026-11-30');
  assert.match(breakfast.description,/bis 10:30 Uhr/);assert.doesNotMatch(main.description,/10:30|Royal TS|Chicken McNuggets/);
  for(const product of ['Big Mac','McChicken','Filet-o-Fish','Crispy Veggie Burger','McPops® Strawberry','McPops® Chocolate','McPops® Stracciatella'])
    assert.ok(main.description.includes(product),product);
  assert.match(main.title,/Big Mac, McChicken/);assert.doesNotMatch(main.title,/Nuggets/);
  for(const row of rows) {
    assert.match(row.description,/Mindestbestellwert unverändert/);
    assert.match(row.description,/teilnehmenden Restaurants in Österreich, solange der Vorrat reicht/);
    assert.equal(row.type,'bogo');
  }
  assert.equal(breakfast.id,parse().deals[0].id);
  assert.notEqual(main.id,parse().deals[1].id);
  assert.equal(parse(html,'2026-11-13').deals.length,1,'Legacy main campaign remains expired');
  assert.equal(parse(current,'2026-12-01').deals.length,0);
});
test('new campaign still rejects unknown products, mixed footnotes and incomplete source dates',()=>{
  for(const altered of [current.replace('Big Mac','Big Tasty'),current.replaceAll('30.11.2026','30.11.'),
    current.replace('Mindestbestellwert unverändert.',''),current+html])
    assert.equal(parse(altered,'2026-11-13').deals.length,0);
});
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
