import assert from 'node:assert/strict';

import { runWienDealsCombined } from '../scraper/wien-deals-combined.js';

const now = new Date('2026-08-22T12:00:00.000Z');
const freshTimestamp = '2026-08-21T10:00:00.000Z';
const oldTimestamp = '2025-08-21T10:00:00.000Z';

async function fetchImpl(url) {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/ig_hashtag_search')) {
    if (parsed.searchParams.get('q') === 'missingtag') {
      return new Response(JSON.stringify({
        error: { code: 24, message: 'The requested resource does not exist' },
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: [{ id: `tag-${parsed.searchParams.get('q')}` }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (parsed.pathname.includes('/recent_media') && String(parsed.searchParams.get('fields') || '').split(',').includes('children')) {
    return new Response(JSON.stringify({
      error: { code: 100, message: '(#100) Please read documentation for supported fields.' },
    }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  if (parsed.pathname.includes('/tag-gratiswien/recent_media')) {
    const requestedFields = String(parsed.searchParams.get('fields') || '').split(',');
    assert.equal(requestedFields.includes('username'), false, 'hashtag media must not request unsupported username');
    assert.equal(requestedFields.includes('media_url'), true, 'hashtag media must include image evidence');
    assert.doesNotMatch(parsed.searchParams.get('fields') || '', /children\{/);
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
          id: 'image-only-deal',
          caption: 'Unser neuer Wochenplan #wien',
          permalink: 'https://www.instagram.com/p/DcCombinedImageOnly/',
          timestamp: freshTimestamp,
          media_type: 'IMAGE',
          media_url: 'https://cdn.example/image-only.jpg',
        },
        {
          id: 'image-giveaway',
          caption: 'Gewinnspiel: Gewinne einen gratis Brunch in Wien.',
          permalink: 'https://www.instagram.com/p/DcCombinedGiveaway/',
          timestamp: freshTimestamp,
          media_type: 'IMAGE',
          media_url: 'https://cdn.example/giveaway.jpg',
        },
        {
          id: 'old-image-only',
          caption: 'Unser Wochenplan #wien',
          permalink: 'https://www.instagram.com/p/DcCombinedOldImage/',
          timestamp: oldTimestamp,
          media_type: 'IMAGE',
          media_url: 'https://cdn.example/old-image.jpg',
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
  if (parsed.pathname.includes('/tag-zweittag/recent_media')) {
    return Response.json({
      data: [{
        id: 'image-only-deal',
        caption: 'Unser neuer Wochenplan #wien',
        permalink: 'https://www.instagram.com/p/DcCombinedImageOnly/',
        timestamp: freshTimestamp,
        media_type: 'IMAGE',
        media_url: 'https://cdn.example/image-only.jpg',
      }],
    });
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
    WIEN_COMBINED_GRAPH_HASHTAGS: 'gratiswien,missingtag,zweittag',
    OPENAI_API_KEY: 'test-openai-key',
  },
  enrichGraphMedia: async (entries) => {
    assert.deepEqual(entries.map((entry) => entry.item.id), ['image-only-deal']);
    entries[0].item._mediaEvidence = {
      analyzedAt: now.toISOString(),
      ocrText: '',
      visionImageCount: 1,
      ai: {
        isDeal: true,
        confidence: 0.96,
        offerText: 'Zweiter Kaffee gratis',
        locationText: 'Neubaugasse 12, 1070 Wien',
        validityText: 'Gültig bis 25. August 2026',
        exclusion: 'none',
      },
    };
    return {
      entries,
      cache: { 'image-only-deal': entries[0].item._mediaEvidence },
      report: {
        status: 'ok',
        eligible: 1,
        selected: 1,
        cached: 0,
        analyzed: 1,
        withOcrText: 0,
        withVisionImages: 1,
        aiCalls: 1,
        visionCalls: 1,
        aiAccepted: 1,
        errors: [],
      },
    };
  },
});

assert.equal(result.payload.totalDeals, 2);
const captionDeal = result.payload.deals.find((deal) => deal.url.endsWith('/DcCombinedFresh/'));
const imageDeal = result.payload.deals.find((deal) => deal.url.endsWith('/DcCombinedImageOnly/'));
assert.ok(captionDeal);
assert.ok(imageDeal, 'a fresh image-only offer must be recovered');
assert.equal(captionDeal.pubDate, freshTimestamp);
assert.equal(captionDeal.pubDateSource, 'instagram-graph-timestamp');
assert.equal(captionDeal.validUntil, '2026-08-25T23:59:59.999Z');
assert.equal(imageDeal.validUntil, '2026-08-25T23:59:59.999Z');
assert.equal(result.report.rejectionReasons['post-too-old'], 1);
assert.equal(result.report.rejectionReasons['excluded-promotion-type'], 1);
assert.equal(result.report.rejectionReasons['no-concrete-offer'], 1);
assert.equal(result.report.rescueEligible, 1);
assert.equal(result.report.rescuedDeals, 1);
assert.equal(result.report.uniquePosts, 5, 'the same Graph post found by two hashtags is analyzed once');
assert.equal(result.report.mediaEvidence.visionCalls, 1);
assert.equal(result.report.status, 'healthy');
assert.equal(result.report.sources.find((source) => source.hashtag === 'missingtag')?.status, 'not-found');
assert.equal(result.report.sources.find((source) => source.hashtag === 'gratiswien')?.mediaFieldMode, 'media-url');

const degraded = await runWienDealsCombined({
  now,
  fetchImpl,
  write: false,
  env: {
    INSTAGRAM_ACCESS_TOKEN: 'test-token',
    INSTAGRAM_USER_ID: '17840000000000000',
    META_GRAPH_VERSION: 'v26.0',
    WIEN_COMBINED_GRAPH_HASHTAGS: 'gratiswien',
    OPENAI_API_KEY: 'test-openai-key',
  },
  enrichGraphMedia: async () => {
    throw new Error('OpenAI temporarily unavailable');
  },
});
assert.equal(degraded.payload.totalDeals, 1, 'caption deals survive a media-analysis outage');
assert.equal(degraded.report.status, 'degraded');
assert.match(degraded.report.mediaEvidence.errors.join(' '), /OpenAI temporarily unavailable/);

console.log('wien deals combined tests passed');
