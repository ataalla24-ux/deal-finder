import assert from 'node:assert/strict';
import { featuredSelectionHistory, recentFeaturedDealIds } from '../scraper/featured-selection-history.js';
import { resolveDailyFeaturedSelection, selectAutomaticFeaturedDeal } from '../scraper/set-daily-deal.js';
import { dailyFeaturedValue } from '../scraper/daily-featured-policy.js';

const now = new Date('2026-10-28T06:00:00Z');
const previous = { date: '2026-10-27', dealId: 'ikea', selectionHistory: [
  { date: '2026-10-27', dealId: 'ikea' }, { date: '2026-10-21', dealId: 'coffee' },
  { date: '2026-10-20', dealId: 'old' }, { date: '2026-10-29', dealId: 'future' },
  { date: '2026-02-30', dealId: 'invalid' }, { date: '2026-10-27', dealId: '' },
] };
const recent = recentFeaturedDealIds(previous, '2026-10-28');
assert.deepEqual([...recent], ['coffee', 'ikea']);
assert.deepEqual(featuredSelectionHistory(previous, { date: '2026-10-28', dealId: 'pizza' }, '2026-10-28'), [
  { date: '2026-10-21', dealId: 'coffee' }, { date: '2026-10-27', dealId: 'ikea' }, { date: '2026-10-28', dealId: 'pizza' },
]);
assert.throws(() => featuredSelectionHistory({}, {}, '2026-02-30'));
assert.deepEqual(featuredSelectionHistory(null, {}, '2026-10-28'), []);

const offer = (id, edits = {}) => ({ id, title: '1+1 Pizza gratis', description: 'Pizza zum Mitnehmen in Wien.',
  brand: 'Pizzeria', category: 'essen', type: 'gratis', url: 'https://pizzeria.example/pizza',
  dateConfidence: 'high', expiryKind: 'end', validUntil: '2026-11-10',
  pipelineLifecycle: { manualDecision: 'approved' }, ...edits });
const options = { kind: 'daily', now, llmEnabled: false, recentDealIds: recent };
const selected = await selectAutomaticFeaturedDeal([offer('ikea'), offer('pizza')], options);
assert.equal(selected?.deal.id, 'pizza');
assert.equal((await selectAutomaticFeaturedDeal([offer('ikea')], options))?.deal.id, 'ikea', 'the best verified offer may repeat');
const ranked = await selectAutomaticFeaturedDeal([offer('recurring', { dateConfidence: 'low', pubDate: now.toISOString() }),
  offer('verified', { pubDate: '2026-10-23T10:00:00Z' })], { ...options, recentDealIds: new Set() });
assert.equal(ranked?.deal.id, 'verified', 'an unverified offer must not become the daily deal');
assert.equal(await selectAutomaticFeaturedDeal([offer('alcohol', { title: 'Gratis Wein zur Pizza' })], options), null);
assert.equal(await selectAutomaticFeaturedDeal([offer('shoes', { category: 'shopping', title: '50 % auf Schuhe', description: 'Schuhe kaufen' })], options), null);

const weaker = offer('weak', { title: '10 % Rabatt auf Pizza', hot: true, votes: 300, pubDate: now.toISOString() });
const stronger = offer('strong', { title: 'Pizza für 6 € statt 15 €', type: 'rabatt', pubDate: '2026-10-22T12:00:00Z' });
assert(dailyFeaturedValue(stronger) > dailyFeaturedValue(weaker));
assert.equal((await selectAutomaticFeaturedDeal([weaker, stronger], { ...options, recentDealIds: new Set(['strong']) })).deal.id,
  'strong', 'value outranks rotations, popularity and publication age');
const current = { date: '2026-10-28', dealId: weaker.id, manualPick: false };
assert.equal((await resolveDailyFeaturedSelection([weaker, stronger], current, now)).deal.id, stronger.id);
assert.equal((await resolveDailyFeaturedSelection([weaker, stronger], { ...current, manualPick: true }, now)).deal.id, weaker.id);
assert.equal((await resolveDailyFeaturedSelection([{ ...weaker, validFrom: '2026-10-29' }, stronger], { ...current, manualPick: true }, now)).deal.id, stronger.id);
assert.equal((await resolveDailyFeaturedSelection([offer('a'), offer('b')],
  { ...current, dealId: 'b', selectionReason: 'automatic-strongest-verified' }, now)).preserve, true, 'same-day ties do not switch');

for (const change of [
  { validFrom: '2026-10-29' }, { validOn: '2026-10-29' }, { validUntil: '2026-10-27' },
  { expires: '2026-10-28T05:00:00Z' }, { dateConfidence: 'low' }, { validUntil: '2026-02-30' },
  { expiryKind: 'unknown' }, { title: 'Pizza mit 40 % Vollkornmehl' },
  { description: 'Gratis Pizza donnerstags.' }, { description: 'Gratis Pizza Mo–Di.' },
  { description: 'Aktion täglich bis 07:00 Uhr.' }, { description: 'Aktuelle Gültigkeit nicht bestätigt.' },
  { description: 'Aktion täglich bis 07:00.' },
  { description: 'Nur mit personalisiertem Code.' }, { campaignId: 'ad-1' }, { hidden: true },
  { title: 'Pizza für 12 €' },
]) assert.equal(await selectAutomaticFeaturedDeal([offer('bad', change)], options), null, JSON.stringify(change));
assert.equal((await selectAutomaticFeaturedDeal([offer('wed', { description: 'Einlösbar Mo–Sa, 11:00 bis 19:00 Uhr.' })], options)).deal.id,
  'wed', 'a verified offer with a later window today is eligible');
assert.equal((await selectAutomaticFeaturedDeal([offer('vienna', { validOn: '2026-10-29', validUntil: '2026-10-29' })],
  { ...options, now: new Date('2026-10-28T23:10:00Z') })).deal.id, 'vienna', 'offer day follows Vienna, not UTC');
assert(dailyFeaturedValue(offer('fixed', { title: '25 % Rabatt auf Pizza' })) > dailyFeaturedValue(offer('max', { title: 'Bis zu 60 % auf Pizza' })));
assert(dailyFeaturedValue(offer('public', { title: '10 € Rabatt ab 20 € für Pizza' })) >
  dailyFeaturedValue(offer('new', { title: '10 € Rabatt ab 20 € für Pizza, nur für Neukunden' })));
console.log('Featured history, actual value and Vienna availability checks passed.');
