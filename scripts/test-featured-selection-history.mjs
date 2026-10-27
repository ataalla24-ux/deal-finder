import assert from 'node:assert/strict';
import { featuredSelectionHistory, recentFeaturedDealIds } from '../scraper/featured-selection-history.js';
import { selectAutomaticFeaturedDeal } from '../scraper/set-daily-deal.js';

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
assert.equal(await selectAutomaticFeaturedDeal([offer('ikea')], options), null, 'no fake new daily deal when only repeats remain');
const ranked = await selectAutomaticFeaturedDeal([offer('recurring', { dateConfidence: 'low', pubDate: now.toISOString() }),
  offer('verified', { pubDate: '2026-10-23T10:00:00Z' })], { ...options, recentDealIds: new Set() });
assert.equal(ranked?.deal.id, 'verified', 'push-ready offer precedes an unverified recurring offer');
assert.equal(await selectAutomaticFeaturedDeal([offer('alcohol', { title: 'Gratis Wein zur Pizza' })], options), null);
assert.equal(await selectAutomaticFeaturedDeal([offer('shoes', { category: 'shopping', title: '50 % auf Schuhe', description: 'Schuhe kaufen' })], options), null);
console.log('Featured history and notification-aligned rotation checks passed.');
