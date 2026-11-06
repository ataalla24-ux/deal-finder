import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { discoveryRejection, filterDiscoveryDeals, getNonConsumerOfferRejection } from '../scraper/deal-discovery-policy.js';
import { getAdFoodBenefitRejection } from '../scraper/food-discovery-utils.js';
import { classifyPromotion, retainMetaOutbox } from '../scraper/meta-instagram-deals.js';
import { getRejectionReason } from '../scraper/instagram-ai-agent.js';
import { normalizeSocialAuditCandidate, buildSocialFoodReviewDeal } from '../scraper/social-food-audit-utils.js';
import { prepareSocialFoodReviewDeals } from '../scraper/slack-notify.js';
import { earlyPostRejection } from '../scraper/apify-food-discovery-policy.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/discovery-non-consumer-offers.json', import.meta.url), 'utf8'));
fixtures.rejected.push(
  {id:'trade-marketplace-nov06',title:'0 % Provision, keine Grundgebuehr',brand:'Installateur',
    url:'https://www.instagram.com/p/DfaJXt5oUhY/',reason:'business-lead-generation',
    description:'Zufriedene Kunden kommen wieder: Mit dem Serviceabo bucht der Kunde nach dem ersten Auftrag wiederkehrende Wartungen bei Ihrem Betrieb. 0 % Provision, keine Grundgebuehr - fuer Installateure in Wien und Niederoesterreich. Jetzt kostenlos registrieren.'},
  {id:'trade-jobs-nov06',title:'0 % Servicegebuehr Offene Auftraege ansehen',brand:'Elektriker',
    url:'https://www.instagram.com/reel/DfaEX2PnJP8/',reason:'business-lead-generation',
    description:'In Wien warten Kunden auf Elektriker und Installateure. Fuer Betriebe: Kostenlos registrieren. Kein Abo. Erster Auftrag: 0 % Servicegebuehr. Offene Auftraege ansehen.'},
  {id:'cuvee-gift-nov06',title:'Gansl-Special im Silberwirt',brand:'Silberwirt',
    url:'https://www.instagram.com/p/DfZirWGCPB4/',reason:'alcohol-offer',
    description:'Gansl-Special fuer 4 Personen: Gansl um je 34,90 Euro pro Person. Eine Flasche Cuvee G gratis dazu! Silberwirt, Schlossgasse 21, 1050 Wien.'}
);
const now = new Date('2026-11-05T20:00:00.000Z');
const review = input => ({
  pubDate: now.toISOString(), sourcePublishedAt: now.toISOString(), status: 'rejected',
  reason: 'missing-vienna-evidence', socialFoodReview: true, category: 'kaffee', type: 'gratis',
  distance: '1070 Wien', viennaVerified: true,
  evidence: { socialFoodAudit: { foodDrinkScore: 2, dealSignal: true, viennaSignal: true, verifiedViennaSignal: true, unsafeContent: false } },
  ...input,
});

for (const fixture of fixtures.rejected) {
  test(`${fixture.id}: excludes the same false positive across strict and social discovery`, async () => {
    const { reason, ...content } = fixture;
    const input = review(content);
    const before = JSON.stringify(input);
    assert.equal(discoveryRejection(input), reason);
    assert.equal(classifyPromotion(input.description).reason, reason);
    assert.equal(getAdFoodBenefitRejection(input.description), reason);
    assert.equal(getRejectionReason({}, input.description, 100), reason, 'high AI scores cannot rescue a non-offer');
    assert.equal(earlyPostRejection({ url: input.url, caption: input.description, timestamp: now.toISOString() }, now), reason);
    const row = normalizeSocialAuditCandidate(input, { source: 'meta-instagram' }, now);
    assert.equal(row.unsafeContent, true);
    assert.equal(row.reviewEligible, false, 'a collector rejection must not become a review rescue');
    assert.equal(buildSocialFoodReviewDeal(row, now), null);
    assert.equal(prepareSocialFoodReviewDeals([input], { now }).deals.length, 0, 'old artifacts with unsafeContent=false are rechecked');
    assert.deepEqual(filterDiscoveryDeals([input]).reasonCounts, { [reason]: 1 });
    assert.deepEqual(retainMetaOutbox([], [{ ...input, id: `meta-ig-${fixture.id}` }], now), [], 'outbox replay does not bypass discovery policy');
    const validated = await validateDealsForSlack([input], { now,
      inspectDealUrlHealth: async () => ({ status: 200, contentHints: {}, dateHints: {} }),
    });
    assert.equal(validated.allowedDeals.length, 0);
    assert(validated.results[0].decision.reasons.some(value => value.includes(reason)), 'approval reports the quality rejection');
    assert.equal(JSON.stringify(input), before, 'filters must not change stored evidence');
  });
}

test('URL stripping and translated B2B sales pitches retain the exclusion', () => {
  const cleaned = fixtures.rejected[0].description.replace(/(?:www\.)?e-stempel\.at/g, '');
  for (const text of [cleaned,
    'Loyalty software for cafe owners: reward your customers, for example free coffee after five visits. Book a demo in Vienna.',
    'Digitale Stempelkarte: Ihre Kunden sammeln Punkte. Jetzt testen, in 1 Minute einsatzbereit. Gratis Espresso als Prämie in Wien.',
  ]) assert.equal(discoveryRejection(text), 'illustrative-business-reward', text);
});

test('real cafe loyalty rewards survive strict and social review, including digital and tiered cards', () => {
  for (const [index, description] of fixtures.loyaltyOffers.entries()) {
    const input = review({ id: `loyalty-${index}`, url: `https://www.instagram.com/p/Loyalty${index}/`,
      title: 'Gratis Espresso mit Treuekarte', brand: 'Café am Park', description });
    assert.equal(discoveryRejection(input), '', description);
    assert.equal(classifyPromotion(description).accepted, true, description);
    const row = normalizeSocialAuditCandidate(input, { source: 'meta-instagram' }, now);
    assert.equal(row.reviewEligible, true, description);
    assert(buildSocialFoodReviewDeal(row, now));
    assert.equal(prepareSocialFoodReviewDeals([input], { now }).deals.length, 1, description);
  }
});

test('a genuine independent saving keeps a mixed post eligible for other review checks', () => {
  for (const text of fixtures.mixedOffers) assert.equal(discoveryRejection(text), '', text);
  assert.equal(discoveryRejection('Heute 5 € mehr Rabatt auf Kaffee in Wien.'), '', 'more savings is not a surcharge');
  assert.equal(discoveryRejection('Software powered loyalty card in our Vienna cafe: 10 coffees, one espresso gratis.'), '');
  const truncated = { title: 'VIP is only €25 more', description: 'Dinner buffet included in Vienna.' };
  for (const source of [
    { metaGraphCaption: fixtures.mixedOffers[0] },
    { originalCaption: fixtures.mixedOffers[0] },
    { evidence: { offerDateSignal: fixtures.mixedOffers[0] } },
  ]) assert.equal(discoveryRejection({ ...truncated, ...source }), '', 'full saved source distinguishes a mixed offer from a pure upsell');
  assert.equal(discoveryRejection({ ...truncated, brand: 'Save €15', address: 'Gratis Kaffee Gasse' }), 'paid-upsell-without-saving', 'names and addresses are not a saving');
});

test('a real advertised meal promotion is not lost because optional drinks carry an extra charge', () => {
  assert.equal(discoveryRejection(fixtures.mealWithAddOn), '');
  for (const price of ['5,90', '5.90']) {
    assert.equal(getNonConsumerOfferRejection(`Kaffee und Kuchen zum Sonderpreis von €${price}. Cappuccino: 1,20 Euro Aufpreis.`), '');
  }
  assert.equal(getNonConsumerOfferRejection('VIP zum Spezialpreis von 25 € mehr, Dinner buffet in Wien.'), 'paid-upsell-without-saving');
});

test('actual human/community loyalty submissions remain approvable without rewriting their content', async () => {
  const deals = fixtures.loyaltyOffers.map((description, index) => ({
    id: `community-loyalty-${index}`, title: 'Gratis Espresso mit Treuekarte', brand: 'Café am Park', description,
    source: 'Community', originSource: 'Community Submission', communityApproved: true,
    url: `https://cafe.example/treuekarte/${index}`, distance: '1070 Wien',
    validFrom: '2026-11-05', validUntil: '2026-11-30', category: 'kaffee', type: 'gratis',
  }));
  const before = JSON.stringify(deals);
  assert.deepEqual(filterDiscoveryDeals(deals).deals, deals);
  const validated = await validateDealsForSlack(deals, { now,
    inspectDealUrlHealth: async () => ({ status: 200, contentHints: {}, dateHints: {} }),
  });
  assert.deepEqual(validated.allowedDeals.map(deal => deal.id), deals.map(deal => deal.id), JSON.stringify(validated.results));
  assert.equal(JSON.stringify(deals), before);
});

test('only a paid upsell is rejected; free-from, negated discounts and regular bundle prices do not rescue it', () => {
  for (const text of [
    'VIP nur 25 Euro mehr, Dinner Buffet in Wien.',
    'Dinner buffet with an Aufpreis von 25 EUR in Vienna.',
    'VIP: surcharge of €25, dinner buffet included in Vienna.',
    'VIP is only €25 more. No discount. Duo €119.',
    'VIP is only €25 more. Gluten-free pizza and free wifi in Vienna.',
    'VIP nur 25 € mehr. Kein 20 % Rabatt auf Tickets in Wien.',
  ]) assert.equal(getNonConsumerOfferRejection(text), 'paid-upsell-without-saving', text);
});

test('trade customer perks and explicitly alcohol-free cuvee are not business recruiting or alcoholic gifts',()=>{
  for(const text of ['Fuer Installateure in Wien: 10 % Rabatt auf jede Pizza.',
    'Kostenlos registrieren: Restaurant fuer Handwerker in Wien, jeder zehnte Kaffee gratis.',
    'Gansl mit einer Flasche alkoholfreie Cuvee gratis in Wien.',
    'Kaffee fuer 2 Euro fuer alle Gaeste, keine Provision fuer Betriebe genannt.']){
    assert.equal(discoveryRejection(text),'',text);
  }
});
