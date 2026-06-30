import assert from 'node:assert/strict';

import {
  dealFreshnessTimestamp,
  isDealNewByDate,
  normalizeDealFreshnessFlags,
} from '../scraper/deal-freshness-utils.js';

const now = new Date('2026-06-30T12:00:00.000Z');

assert.equal(
  isDealNewByDate({ pubDate: '2026-06-29T12:00:00.000Z', approvedAt: '2026-03-01T12:00:00.000Z' }, { now, windowHours: 72 }),
  true,
  'fresh pubDate should mark a deal as new'
);

assert.equal(
  isDealNewByDate({ pubDate: '2026-06-20T12:00:00.000Z', approvedAt: '2026-06-30T11:00:00.000Z' }, { now, windowHours: 72 }),
  false,
  'old pubDate should win over fresh approval date'
);

assert.equal(
  isDealNewByDate({ approvedAt: '2026-06-30T10:00:00.000Z' }, { now, windowHours: 72 }),
  true,
  'approval date should be a fallback when pubDate is missing'
);

assert.equal(
  isDealNewByDate({ pubDate: '2026-07-02T12:00:00.000Z' }, { now, windowHours: 72 }),
  false,
  'future pubDate should not mark a deal as new'
);

assert.equal(
  isDealNewByDate({ pubDate: '2026-06-30T10:00:00.000Z', expires: '2026-06-29T23:59:59.999Z' }, { now, windowHours: 72 }),
  false,
  'expired deals should not be marked as new even when imported recently'
);

assert.deepEqual(
  dealFreshnessTimestamp({ pubDate: '2026-06-20T12:00:00.000Z', approvedAt: '2026-06-30T10:00:00.000Z' }).field,
  'pubDate',
  'pubDate should be the primary freshness timestamp'
);

const normalized = normalizeDealFreshnessFlags([
  { id: 'old-wrong', pubDate: '2026-06-20T12:00:00.000Z', isNew: true },
  { id: 'fresh-wrong', pubDate: '2026-06-30T10:00:00.000Z', isNew: false },
], { now, windowHours: 72 });

assert.equal(normalized.changed, 2);
assert.equal(normalized.freshCount, 1);
assert.equal(normalized.deals[0].isNew, false);
assert.equal(normalized.deals[1].isNew, true);

console.log('Deal freshness tests passed');
