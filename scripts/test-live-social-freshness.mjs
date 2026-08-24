import assert from 'node:assert/strict';

import {
  buildStructuredSocialTitle,
  getSocialPostFreshnessRemovalReason,
} from '../scraper/normalize-live-deals.js';

const now = new Date('2026-08-22T12:00:00.000Z');
const oldWithFutureOffer = {
  id: 'old-social-with-future-offer',
  url: 'https://www.instagram.com/reel/OldButActive123/',
  pubDate: '2026-08-10T12:00:00.000Z',
  pubDateSource: 'instagram-graph-timestamp',
  sourcePublishedAt: '2026-08-10T12:00:00.000Z',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
  validFrom: '2026-08-25T00:00:00.000Z',
  validUntil: '2026-09-15T23:59:59.999Z',
  expires: '2026-09-15T23:59:59.999Z',
};

assert.match(
  getSocialPostFreshnessRemovalReason(oldWithFutureOffer, now),
  /Social-Post älter als 7 Tage/,
  'future validity must not rescue an old social post in the live feed',
);

assert.equal(getSocialPostFreshnessRemovalReason({
  ...oldWithFutureOffer,
  id: 'fresh-social-with-future-offer',
  pubDate: '2026-08-20T12:00:00.000Z',
  sourcePublishedAt: '2026-08-20T12:00:00.000Z',
}, now), '', 'a fresh post announcing a future offer remains valid');

assert.equal(getSocialPostFreshnessRemovalReason({
  ...oldWithFutureOffer,
  id: 'synthetic-firecrawl-date',
  pubDateSource: 'firecrawlAgentRun',
  sourcePublishedAtSource: 'firecrawlAgentRun',
  source: 'Firecrawl Instagram',
}, now), '', 'a synthetic crawler run time must not masquerade as a reliable social publication date');

assert.equal(buildStructuredSocialTitle({
  brand: 'Alfies',
  ownerUsername: 'lisa.maria.b',
  title: 'Anzeige €10 Rabatt mit Code LISAMARIA10 bei alfies.at ALFIES TOPFENKNÖDEL',
  description: 'Flaumige Topfenknödel zuhause machen.',
  type: 'rabatt',
}), '10 € Rabatt bei Alfies mit Code LISAMARIA10');

assert.equal(buildStructuredSocialTitle({
  brand: 'Balls & Clubs',
  ownerUsername: 'lisa.maria.b',
  title: 'lisa.maria.b: anzeige Indoor-Minigolf mitten in Wien! 10% Rabattcode LISAMARIA',
  description: '18 verschiedene Minigolf-Bahnen.',
  type: 'rabatt',
}), '10% Rabatt auf Indoor-Minigolf bei Balls & Clubs mit Code LISAMARIA');

assert.equal(buildStructuredSocialTitle({
  brand: 'Balls & Clubs',
  ownerUsername: 'lisa.maria.b',
  title: '10% Rabatt auf Indoor-Minigolf bei Balls & Clubs mit Code ANZEIGE',
  description: 'anzeige Indoor-Minigolf: 10% Rabattcode LISAMARIA bei Balls & Clubs',
  type: 'rabatt',
}), '10% Rabatt auf Indoor-Minigolf bei Balls & Clubs mit Code LISAMARIA');

assert.equal(buildStructuredSocialTitle({
  brand: 'Bezirksvorstehung Mariahilf',
  ownerUsername: 'bezirksvorstehung_mariahilf',
  title: 'bezirksvorstehung_mariahilf: bezirksvorstehung_mariahilf: Sport- und Spielefest für Kids im Esterhazypark :tada: Am 27.8., ...',
  type: 'gratis',
}), 'Gratis Sport- und Spielefest für Kids im Esterhazypark');

console.log('live social freshness tests passed');
