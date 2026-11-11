import assert from 'node:assert/strict';

import { syncFeaturedDealSnapshots } from '../scraper/native-weekly-utils.js';

const now = new Date('2026-08-26T12:00:00.000Z');
const deals = [
  {
    id: 'community-dyson',
    brand: 'Dyson',
    title: 'Gratis Haarstyling und Drinks beim Dyson Pop-up',
    description: 'Gratis Styling am Rathausplatz, 1010 Wien.',
    url: 'https://www.instagram.com/reel/DYSONNEW/',
    type: 'gratis',
    category: 'beauty',
    distance: 'Rathausplatz, 1010 Wien',
    logo: '💇',
    logoUrl: 'https://freefinder.at/assets/brand-logos/dyson.png',
  },
  {
    id: 'weekly-coffee',
    brand: 'Cafe Wien',
    title: 'Gratis Kaffee',
    description: 'Gratis Kaffee in 1070 Wien.',
    url: 'https://cafe.example/kaffee',
    type: 'gratis',
    category: 'kaffee',
    distance: '1070 Wien',
    logo: '☕',
    logoUrl: '',
  },
];

const synced = syncFeaturedDealSnapshots({ deals }, {
  date: '2026-08-26',
  dealId: 'removed-tiktok-dyson',
  brand: 'Dyson',
  title: 'Gratis Haarstyling und Drinks beim Dyson Pop-up',
  description: 'Old copy',
  url: 'https://www.tiktok.com/@example/video/123',
  manualPick: false,
}, {
  week: '2026-08-24',
  dealId: 'weekly-coffee',
  brand: 'Cafe Wien',
  title: 'Stale weekly title',
}, { now });

assert.equal(synced.daily.report.reason, 'semantic_relink');
assert.equal(synced.daily.payload.dealId, 'community-dyson');
assert.equal(synced.daily.payload.url, 'https://www.instagram.com/reel/DYSONNEW/');
assert.equal(synced.daily.payload.distance, 'Rathausplatz, 1010 Wien');
assert.equal(synced.weekly.report.reason, 'current_id');
assert.equal(synced.weekly.payload.title, 'Gratis Kaffee');
assert.equal(synced.changed, true);

const stable = syncFeaturedDealSnapshots(
  { deals },
  synced.daily.payload,
  synced.weekly.payload,
  { now },
);
assert.equal(stable.changed, false, 'a second sync must be idempotent');

const coffee = { ...deals[1], dateConfidence: 'high', expiryKind: 'end', validUntil: '2026-08-31' };
const second = { ...coffee, id: 'weekly-tea', title: '20 % Rabatt auf Tee' };
for (const period of [
  { expires: '2020-01-01' },
  { validUntil: '2020-01-01' },
  { validity: { expiryDate: '2020-01-01' } },
  { validity: { status: 'invalid' } },
  { validFrom: '2030-01-01' },
]) {
  const ineligible = { ...deals[1], id: 'ineligible', ...period };
  const repaired = syncFeaturedDealSnapshots({ deals: [ineligible, coffee, second] },
    { ...ineligible, date: '2026-08-26', dealId: ineligible.id }, { ...ineligible, dealId: ineligible.id }, { now });
  assert.equal(repaired.daily.payload.dealId, coffee.id, 'Daily replacement must be currently valid');
  assert.equal(repaired.weekly.payload.dealId, second.id, 'Weekly replacement must be valid and distinct from today');
  assert.deepEqual(ineligible, { ...deals[1], id: 'ineligible', ...period }, 'Source record is not deleted or changed');
}

const absent = syncFeaturedDealSnapshots({ deals: [deals[1]] }, { dealId: 'no-longer-live' }, {}, { now });
assert.equal(absent.daily.payload.dealId, '');
assert.equal(absent.daily.payload.selectionReason, 'no-verified-daily-deal');
const repairedBest = syncFeaturedDealSnapshots({ deals: [coffee, { ...coffee, id: 'free-pizza', title: 'Pizza gratis' }] },
  absent.daily.payload, {}, { now });
assert.equal(repairedBest.daily.payload.dealId, 'free-pizza');
assert.equal(repairedBest.weekly.payload.dealId, coffee.id);
const noWeekly = syncFeaturedDealSnapshots({ deals: [coffee] }, { date: '2026-08-26', dealId: coffee.id }, {}, { now });
assert.equal(noWeekly.weekly.payload.selectionReason, 'no-verified-weekly-deal');
assert.equal(noWeekly.weekly.payload.dealId, '');

console.log('featured deal reference sync tests passed');
