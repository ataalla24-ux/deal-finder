import assert from 'node:assert/strict';
import test from 'node:test';
import { assessInstagramFiniteRangeEnd } from './expiry-instagram-finite-range.mjs';

const now = new Date('2026-11-16T15:30:00Z');
const caption = '-26% auf euren Snack nach Wahl! 🥪 Von 02.11. bis 15.11. bekommt ihr jeden Montag bis Samstag eine ganze Reihe unserer Snacks günstiger.';
const deal = {
  url: 'https://www.instagram.com/p/DfRuATHiGLU/',
  title: '26 % auf ausgewählte Snacks (Mo–Sa)',
  description: 'Bei DerMann gibt es laut Originalbeitrag vom 2. bis 15. November montags bis samstags 26 % Rabatt auf ausgewählte Snacks.',
  expiryKind: 'end',
  validUntil: '2026-11-15',
  expires: '2026-11-15T23:59:59.999Z',
  dateConfidence: 'high',
  sourcePublishedAt: '2026-11-03T10:56:59.000Z',
  sourcePublishedAtSource: 'url.instagramShortcode',
  metaGraphCaption: caption,
  metaGraphVerifiedAt: '2026-11-03T13:01:24.993Z',
  metaGraphVerified: true,
  metaGraphAccepted: false,
  metaGraphRejection: 'missing-vienna-evidence',
  metaGraphMediaId: '17995471719110038',
  ownerUsername: 'baeckereidermann',
  approvedAt: '2026-11-03T13:32:13.598Z',
};
const latest = {
  caption,
  url: deal.url,
  mediaId: deal.metaGraphMediaId,
  verifiedAt: '2026-11-15T13:00:00Z',
  sourcePublishedAt: deal.sourcePublishedAt,
  sourcePublishedAtSource: 'instagram-graph-timestamp',
  graphAccepted: true,
};
const assess = (record = deal, evidence, at = now) => assessInstagramFiniteRangeEnd(record, evidence, at);

test('a verified original caption and shortcode confirm the stored end of a weekday campaign', () => {
  const result = assess();
  assert.deepEqual(result, { end: '2026-11-15', evidence: [caption], originalPostPublishedAt: '2026-11-03T10:56:59.843Z' });
  assert.deepEqual(assess(deal, latest), result);
  assert.deepEqual(assess(deal, { ...latest, graphAccepted: false, blockingReason: 'offer-expired' }), result);
  assert.deepEqual(assess({ ...deal, metaGraphBlockingReason: 'offer-expired' }), result);
  assert.equal(assess({ ...deal, validFrom: '2026-11-02', expiryKind: 'range' }).end, '2026-11-15');
});

test('unverified capture, wrong post or timestamps and unknown structured bounds never prove expiry', () => {
  for (const patch of [
    { metaGraphVerified: false },
    { metaGraphVerifiedAt: '' },
    { metaGraphMediaId: '' },
    { metaGraphRejection: 'offer-expired' },
    { metaGraphBlockingReason: 'source-blocked' },
    { ownerUsername: '' },
    { approvedAt: null },
    { sourcePublishedAt: '2025-11-03T10:56:59.000Z' },
    { sourcePublishedAtSource: 'discoveredAt' },
    { evidencePostUrl: 'https://www.instagram.com/p/DfVARy_I2AK/' },
    { isReshare: true },
    { validUntil: undefined },
    { validUntil: '2027-11-15' },
    { validUntil: '2026-11-17' },
    { validFrom: '2026-11-04' },
    { validity: { expiryDate: '2026-11-17' } },
    { dateConfidence: 'low' },
  ]) {
    assert.equal(assess({ ...deal, ...patch }), null, JSON.stringify(patch));
  }
});

test('latest source refusals, new dates and contradiction in edited copy veto old evidence', () => {
  for (const update of [
    { graphAccepted: false },
    { graphAccepted: false, blockingReason: 'access-restricted' },
    { blockingReason: 'offer-expired' },
    { mediaId: '01234567890123456' },
    { verifiedAt: '2026-11-03T12:00:00Z' },
    { verifiedAt: '2026-11-21T12:00:00Z' },
    { sourcePublishedAt: '2026-11-04T12:00:00Z' },
    { url: 'https://www.instagram.com/p/DfVARy_I2AK/' },
    { caption: 'Jeden Montag bis Samstag 26% Rabatt.', ocrText: caption },
    { caption: 'Von 02.11. bis 22.11. bekommt ihr jeden Montag bis Samstag Rabatt.' },
    { ocrText: 'Gültig bis 20.11.2026' },
  ]) {
    assert.equal(assess(deal, { ...latest, ...update }), null, JSON.stringify(update));
  }
  for (const description of [
    'Ab dem 16. November gilt der Rabatt weiter.',
    'Vom 2. bis 22. November auf ausgewählte Snacks.',
    'Vom 3. bis 15. November auf ausgewählte Snacks.',
    'Die Aktion wurde verlängert.',
  ]) {
    assert.equal(assess({ ...deal, description }), null, description);
  }
});

test('a weekday pattern alone, unrelated timing and ambiguous or continued campaigns stay visible', () => {
  for (const metaGraphCaption of [
    'Jeden Montag bis Samstag bekommt ihr Rabatt.',
    'Von 02.11. bis 15.11. läuft unser Gewinnspiel. Rabatt gibt es jeden Montag bis Samstag.',
    'Von 02.11. bis 15.11. sind Renovierungsarbeiten. Jeden Montag bis Samstag gibt es Rabatt.',
    'Von 02.11. bis 15.11. bekommt ihr jeden Montag bis Samstag Rabatt. Danach weiterhin zum Angebot.',
    'Nicht nur von 02.11. bis 15.11. bekommt ihr jeden Montag bis Samstag Rabatt.',
    'Von 02.11. bis 15.11. bekommt ihr jeden Montag bis Samstag Rabatt. Ab 15.11. gilt die Aktion weiter.',
    'Von 02.11. bis 15.11. bekommt ihr jeden Montag bis Samstag Rabatt. Neue Frist bis 21.11',
    'Von 02.11. bis 15.11. und von 02.12. bis 15.12. bekommt ihr jeden Montag bis Samstag Rabatt.',
    'Repost: Von 02.11. bis 15.11. bekommt ihr jeden Montag bis Samstag Rabatt.',
    'Von 02.11.2025 bis 15.11. bekommt ihr jeden Montag bis Samstag Rabatt.',
    'Von 31.10. bis 15.11. bekommt ihr jeden Montag bis Samstag Rabatt. Siehe https://www.instagram.com/p/DfVARy_I2AK/',
  ]) {
    assert.equal(assess({ ...deal, metaGraphCaption }), null, metaGraphCaption);
  }
});
