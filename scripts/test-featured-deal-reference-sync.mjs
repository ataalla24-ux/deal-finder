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

const coffee = deals[1];
for (const period of [
  { expires: '2020-01-01' },
  { validUntil: '2020-01-01' },
  { validity: { expiryDate: '2020-01-01' } },
  { validity: { status: 'invalid' } },
  { validFrom: '2030-01-01' },
]) {
  const ineligible = { ...coffee, id: 'ineligible', ...period };
  const repaired = syncFeaturedDealSnapshots({ deals: [ineligible, coffee] },
    { ...ineligible, dealId: ineligible.id }, { ...ineligible, dealId: ineligible.id }, { now });
  assert.equal(repaired.daily.payload.dealId, coffee.id, 'Daily replacement must be currently valid');
  assert.equal(repaired.weekly.payload.dealId, coffee.id, 'Weekly replacement must be currently valid');
  assert.deepEqual(ineligible, { ...coffee, id: 'ineligible', ...period }, 'Source record is not deleted or changed');
}

console.log('featured deal reference sync tests passed');
