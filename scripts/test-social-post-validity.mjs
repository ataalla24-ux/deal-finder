import assert from 'node:assert/strict';

import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const now = new Date('2026-05-18T12:00:00.000Z');
const baseTikTokDeal = {
  id: 'tiktok-test',
  brand: 'Test',
  title: 'Gratis Kaffee in Wien',
  description: 'Gratis Kaffee in Wien',
  category: 'kaffee',
  type: 'gratis',
  source: 'TikTok Scanner',
  originSource: 'tiktok-deals-scanner',
  url: 'https://www.tiktok.com/@test/video/1234567890123456789',
  distance: 'Wien',
  expires: '2026-05-20',
};

const urlHealth = {
  status: 200,
  finalUrl: baseTikTokDeal.url,
  dateHints: {},
  contentHints: {
    title: 'Gratis Kaffee in Wien',
    description: 'Gratis Kaffee in Wien',
  },
};

const options = {
  now,
  maxAgeDays: 7,
  concurrency: 1,
  inspectDealUrlHealth: async () => urlHealth,
};

const missingRealPostDate = await validateDealsForSlack([
  {
    ...baseTikTokDeal,
    discoveredAt: now.toISOString(),
    lastUpdated: now.toISOString(),
  },
], options);

assert.equal(missingRealPostDate.allowedDeals.length, 0);
assert.match(missingRealPostDate.results[0].decision.reasons.join(' '), /kein echtes Social-Post-Datum/);

const oldRealPostDate = await validateDealsForSlack([
  {
    ...baseTikTokDeal,
    pubDate: '2026-05-09T10:00:00.000Z',
    pubDateSource: 'time.datetime',
    discoveredAt: now.toISOString(),
  },
], options);

assert.equal(oldRealPostDate.allowedDeals.length, 0);
assert.match(oldRealPostDate.results[0].decision.reasons.join(' '), /älter als 7 Tage \(2026-05-09\)/);

const freshRealPostDate = await validateDealsForSlack([
  {
    ...baseTikTokDeal,
    pubDate: '2026-05-16T10:00:00.000Z',
    pubDateSource: 'time.datetime',
    discoveredAt: now.toISOString(),
  },
], options);

assert.equal(freshRealPostDate.allowedDeals.length, 1);

console.log('social post validity ok');
