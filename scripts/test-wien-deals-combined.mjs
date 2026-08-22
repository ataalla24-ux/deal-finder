import assert from 'node:assert/strict';

import { runWienDealsCombined } from '../scraper/wien-deals-combined.js';

const now = new Date('2026-08-22T12:00:00.000Z');
const freshTimestamp = '2026-08-21T10:00:00.000Z';
const oldTimestamp = '2025-08-21T10:00:00.000Z';

async function fetchImpl(url) {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/ig_hashtag_search')) {
    return new Response(JSON.stringify({ data: [{ id: `tag-${parsed.searchParams.get('q')}` }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (parsed.pathname.includes('/tag-gratiswien/recent_media')) {
    return new Response(JSON.stringify({
      data: [
        {
          id: 'fresh-deal',
          caption: 'Nur in 1070 Wien: zweiter Kaffee gratis, gültig 21.–25. August 2026.',
          permalink: 'https://www.instagram.com/p/DcCombinedFresh/',
          timestamp: freshTimestamp,
          username: 'testcafe',
        },
        {
          id: 'old-deal',
          caption: 'Nur in 1070 Wien: zweiter Kaffee gratis.',
          permalink: 'https://www.instagram.com/p/OldCombinedDeal/',
          timestamp: oldTimestamp,
          username: 'testcafe',
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const result = await runWienDealsCombined({
  now,
  fetchImpl,
  write: false,
  env: {
    INSTAGRAM_ACCESS_TOKEN: 'test-token',
    INSTAGRAM_USER_ID: '17840000000000000',
    META_GRAPH_VERSION: 'v26.0',
    WIEN_COMBINED_GRAPH_HASHTAGS: 'gratiswien,wienaktion',
  },
});

assert.equal(result.payload.totalDeals, 1);
assert.equal(result.payload.deals[0].url, 'https://www.instagram.com/p/DcCombinedFresh/');
assert.equal(result.payload.deals[0].pubDate, freshTimestamp);
assert.equal(result.payload.deals[0].pubDateSource, 'instagram-graph-timestamp');
assert.equal(result.payload.deals[0].validUntil, '2026-08-25T23:59:59.999Z');
assert.equal(result.report.rejectionReasons['post-too-old'], 1);

console.log('wien deals combined tests passed');
