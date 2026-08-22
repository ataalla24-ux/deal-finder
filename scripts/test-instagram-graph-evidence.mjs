import assert from 'node:assert/strict';

import {
  buildInstagramGraphEvidencePayload,
  candidateIsFreshForGraph,
  enrichDealWithInstagramGraphEvidence,
  graphPostEvidenceFromEntry,
  inferInstagramPostingUsername,
} from '../scraper/instagram-graph-evidence.js';

const now = new Date('2026-08-22T12:00:00.000Z');
const url = 'https://www.instagram.com/reel/DcQZBSlIsVa/';

assert.equal(inferInstagramPostingUsername({
  evidence: {
    offerDateSignal: '698 likes, 44 comments - foodiewien am August 20, 2026: "10 Euro Rabatt"',
  },
}), 'foodiewien');
assert.equal(inferInstagramPostingUsername({
  ownerUsername: 'boca.vienna',
  caption: '@unrelated mention',
}), 'boca.vienna');
assert.equal(inferInstagramPostingUsername({ caption: '@merchant mention only' }), '', 'mentions alone cannot identify the posting account');

const entry = {
  item: {
    id: 'graph-1',
    permalink: url,
    timestamp: '2026-08-20T09:01:55.000Z',
    username: 'foodiewien',
    media_type: 'VIDEO',
    caption: 'BTS in Vienna: FOODIE10 fuer 10 Euro Rabatt.',
    media_url: 'https://scontent.example/secret-cdn-url.mp4',
  },
  context: { sourceType: 'account', sourceName: '@foodiewien' },
};
const acceptedPost = graphPostEvidenceFromEntry(entry, { deal: { id: 'accepted' }, rejection: '' }, now);
assert.equal(acceptedPost.ownerUsername, 'foodiewien');
assert.equal(acceptedPost.graphAccepted, true);
assert.doesNotMatch(JSON.stringify(acceptedPost), /secret-cdn-url/, 'temporary Meta CDN URLs must never be persisted');

const payload = buildInstagramGraphEvidencePayload([{ entry, outcome: { deal: { id: 'accepted' } } }], { now });
assert.equal(payload.totalPosts, 1);
const enriched = enrichDealWithInstagramGraphEvidence({
  id: 'ai-candidate',
  title: '10 Euro Rabatt mit FOODIE10',
  description: 'Aktueller Rabatt in Wien.',
  url,
  // This deliberately wrong, newer scraper estimate must not outrank Graph.
  sourcePublishedAt: '2026-08-21T09:00:46.000Z',
  sourcePublishedAtSource: 'instagram-rendered-time-datetime',
  pubDate: '2026-08-21T09:00:46.000Z',
  pubDateSource: 'instagram-rendered-time-datetime',
  qualityScore: 95,
}, new Map(payload.posts.map((post) => [post.postKey, post])), { now });
assert.equal(enriched.matched, true);
assert.equal(enriched.deal.ownerUsername, 'foodiewien');
assert.equal(enriched.deal.sourcePublishedAt, '2026-08-20T09:01:55.000Z');
assert.equal(enriched.deal.sourcePublishedAtSource, 'instagram-graph-timestamp');
assert.equal(enriched.deal.title, '10 Euro Rabatt mit FOODIE10');

const blockedEntry = {
  item: {
    id: 'graph-2',
    permalink: 'https://www.instagram.com/p/BLOCKED123/',
    timestamp: '2026-08-21T08:00:00.000Z',
    username: 'outside.account',
    caption: 'Nur heute in Graz: 1+1 gratis.',
  },
  context: { sourceType: 'account', sourceName: '@outside.account' },
};
const blockedPayload = buildInstagramGraphEvidencePayload([{
  entry: blockedEntry,
  outcome: { deal: null, rejection: 'non-vienna-location' },
}], { now });
const blocked = enrichDealWithInstagramGraphEvidence({
  id: 'bad-candidate',
  title: '1+1 gratis in Wien',
  url: blockedEntry.item.permalink,
}, new Map(blockedPayload.posts.map((post) => [post.postKey, post])), { now });
assert.equal(blocked.blocked, true);
assert.equal(blocked.deal.metaGraphBlockingReason, 'non-vienna-location');

assert.equal(candidateIsFreshForGraph({ url }, now, 8), true, 'shortcode date is a safe freshness fallback');
assert.equal(candidateIsFreshForGraph({
  url: 'https://www.instagram.com/p/ABC123/',
  sourcePublishedAt: '2025-08-20T09:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
}, now, 8), false);
assert.equal(candidateIsFreshForGraph({
  url: 'https://www.instagram.com/p/ABCSevenDayClamp/',
  sourcePublishedAt: '2026-08-14T09:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
}, now, 30), false, 'configuration cannot widen Graph verification beyond seven days');

console.log('instagram graph evidence tests passed');
