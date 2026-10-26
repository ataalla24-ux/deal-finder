import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyDealRedemptions, loadDealRedemptions } from './deal-redemptions.mjs';
import { computeDealsFeedVersion, stampDealsFeedBundle, stampDealsFeedFile } from './deals-feed-contract.mjs';

const NOW_ISO = '2026-10-26T12:00:00.000Z';
const NOW = Date.parse(NOW_ISO);
const deal = {
  id: 'reviewed-offer',
  title: 'Lunch for EUR 9.90',
  url: 'https://merchant.example/lunch',
  description: 'Lunch only. Show the published offer before ordering.',
  approvedAt: '2026-10-25T10:00:00.000Z',
  votes: 17,
  validFrom: '2026-10-20',
  expires: '2026-11-01',
  hidden: false,
  sourceEvidence: { caption: 'Staff reference PRIVATE_123, not a public coupon.' },
};
const review = {
  dealId: deal.id,
  expectedTitle: deal.title,
  sourceUrl: deal.url,
  expectedDescription: deal.description,
  method: 'onsite',
  details: 'Lunch only.',
  instructions: 'Show the published offer before ordering.',
  verifiedAt: '2026-10-26T11:00:00.000Z',
  reviewUntil: '2026-10-27T12:00:00.000Z',
  evidence: [{ url: deal.url, text: deal.description }],
};
const manifest = (row = review) => ({ reviews: [row] });
const apply = (row = review, current = deal, now = NOW) => applyDealRedemptions([current], manifest(row), now)[0];
const stale = { ...deal, redemption: { method: 'public_code', publicCode: 'OLD_CODE' } };

function withoutRedemption(value) {
  const result = { ...value };
  delete result.redemption;
  return result;
}

test('onsite emits only reviewed metadata and does not invent an action URL', () => {
  const result = apply();
  assert.deepEqual(result.redemption, {
    method: 'onsite', sourceUrl: deal.url, title: deal.title,
    verifiedAt: review.verifiedAt, reviewUntil: review.reviewUntil,
    details: review.details, instructions: review.instructions,
  });
  assert.deepEqual(withoutRedemption(result), deal);
  assert.equal(result.redemption.publicCode, undefined);
  assert.equal(result.redemption.url, undefined);
});

test('public codes require an explicit reviewed public_code method', () => {
  for (const publicCode of ['AB', 'SAVE_10-AT', 'a'.repeat(40)]) {
    const result = apply({ ...review, method: 'public_code', publicCode });
    assert.equal(result.redemption.publicCode, publicCode);
    assert.equal(result.redemption.url, undefined);
  }
});

test('missing, private-format, and malformed public codes fail closed', () => {
  for (const publicCode of [undefined, null, 1234, 'A', 'a'.repeat(41), '_ABC', '-ABC', ' SAVE10', 'SAVE10 ', 'CODE\n', 'SAVE 10', 'SAVE/10', '10%', 'Caf\u00e9']) {
    assert.equal(apply({ ...review, method: 'public_code', publicCode }, stale).redemption, undefined, String(publicCode));
  }
});

test('captions, descriptions, staff codes, and unrelated review fields never become public codes', () => {
  assert.equal(apply().redemption.publicCode, undefined);
  for (const method of ['onsite', 'provider_coupon', 'external', 'unknown']) {
    const result = apply({ ...review, method, publicCode: 'PRIVATE_123', staffCode: 'STAFF_ONLY', url: deal.url });
    assert.equal(result.redemption.publicCode, undefined);
    assert.equal(result.redemption.staffCode, undefined);
    assert.equal(result.redemption.evidence, undefined);
  }
  assert.equal(apply({ ...review, method: 'private_code', publicCode: 'SECRET' }).redemption, undefined);
});

for (const method of ['provider_coupon', 'external']) {
  test(`${method} requires an explicit safe reviewed action URL, including an explicit source URL`, () => {
    for (const url of [deal.url, 'https://provider.example/coupon?id=42', 'http://merchant.example/redeem']) {
      assert.equal(apply({ ...review, method, url }).redemption.url, url);
    }
    assert.equal(apply({ ...review, method }, stale).redemption, undefined);
    assert.equal(apply({ ...review, method, publicCode: 'MEMBER_ONLY' }, stale).redemption, undefined);
  });
}

test('unknown emits no optional claims, instructions, codes, or action', () => {
  const result = apply({ ...review, method: 'unknown', publicCode: 'SECRET', url: deal.url });
  assert.deepEqual(result.redemption, {
    method: 'unknown', sourceUrl: deal.url, title: deal.title,
    verifiedAt: review.verifiedAt, reviewUntil: review.reviewUntil,
  });
  assert.equal(apply({ ...review, method: undefined }).redemption, undefined);
});

test('exact deal ID, title, source URL, and full description are mandatory', () => {
  for (const patch of [
    { id: 'other' }, { title: `${deal.title} ` }, { title: deal.title.toLowerCase() },
    { url: `${deal.url}/` }, { url: `${deal.url}?tracking=1` },
    { description: `${deal.description} ` }, { description: 'Changed conditions.' },
    { description: undefined },
  ]) {
    assert.equal(apply(review, { ...stale, ...patch }).redemption, undefined, JSON.stringify(patch));
  }
  for (const patch of [
    { dealId: undefined }, { expectedTitle: undefined }, { sourceUrl: undefined }, { expectedDescription: undefined },
  ]) {
    assert.equal(apply({ ...review, ...patch }, stale).redemption, undefined);
  }
  assert.ok(apply({ ...review, expectedDescription: '' }, { ...deal, description: '' }).redemption);
});

test('manual approval must exist and be a valid timestamp within clock tolerance', () => {
  for (const approvedAt of [undefined, null, false, '', 'not-a-date', '1', '2026-02-30', 123, {}, '2026-10-26T12:05:00.001Z']) {
    assert.equal(apply(review, { ...stale, approvedAt }).redemption, undefined);
  }
  const pending = { ...stale, approvedAt: undefined, pipelineLifecycle: { manualDecision: 'approved' } };
  assert.equal(apply(review, pending).redemption, undefined);
  assert.equal(apply().approvedAt, deal.approvedAt);
});

test('review timestamps must be interoperable full ISO instants', () => {
  for (const verifiedAt of ['2026-10-26', '2026-10-26T11:00:00.1234567890Z', '2026-10-26T11:00:00+19:00']) {
    assert.equal(apply({ ...review, verifiedAt }, stale).redemption, undefined);
  }
  assert.equal(apply({ ...review, reviewUntil: '2026-10-30' }, stale).redemption, undefined);
});

test('empty URL credentials do not pass as provider actions', () => {
  assert.equal(apply({ ...review, method: 'external', url: 'https://@merchant.example/redeem' }, stale).redemption, undefined);
  assert.equal(apply({ ...review, method: 'external', url: 'https://:@merchant.example/redeem' }, stale).redemption, undefined);
});

test('expired, inverted, missing, invalid, and too-far-future review dates are rejected', () => {
  for (const patch of [
    { reviewUntil: NOW_ISO }, { reviewUntil: '2026-10-26T11:59:59.999Z' },
    { verifiedAt: '2026-10-26T12:05:00.001Z' },
    { verifiedAt: '2026-10-26T12:04:00.000Z', reviewUntil: '2026-10-26T12:03:00.000Z' },
    { verifiedAt: undefined }, { verifiedAt: 'invalid' }, { verifiedAt: true },
    { verifiedAt: '1' }, { verifiedAt: '2026-02-30T11:00:00Z' },
    { verifiedAt: '2026-10-25T24:00:00Z' },
    { reviewUntil: undefined }, { reviewUntil: 'invalid' }, { reviewUntil: 123 },
    { reviewUntil: '2026-10-32' }, { reviewUntil: '2027-02-29' },
  ]) {
    assert.equal(apply({ ...review, ...patch }, stale).redemption, undefined, JSON.stringify(patch));
  }
  assert.equal(apply(review, stale, NaN).redemption, undefined);
});

test('five-minute verification tolerance is inclusive and equal review end is allowed if still future', () => {
  const verifiedAt = '2026-10-26T12:05:00.000Z';
  assert.ok(apply({ ...review, verifiedAt }).redemption);
  assert.ok(apply({ ...review, verifiedAt, reviewUntil: verifiedAt }).redemption);
  assert.ok(apply({ ...review, reviewUntil: '2026-10-26T12:00:00.001Z' }).redemption);
});

test('nonempty evidence is required and is never made public', () => {
  for (const evidence of [undefined, null, [], {}, 'reviewed', [null], [' '], [{}], [{ text: '' }]]) {
    assert.equal(apply({ ...review, evidence }, stale).redemption, undefined);
  }
  const result = apply({ ...review, evidence: ['Archived exact offer text.'] });
  assert.ok(result.redemption);
  assert.equal(result.redemption.evidence, undefined);
});

test('unsafe source or action URLs reject review metadata without changing original fields', () => {
  for (const url of [
    '', 'javascript:alert(1)', 'data:text/plain,offer', 'file:///tmp/coupon', 'ftp://merchant.example/coupon',
    '/coupon', '//merchant.example/coupon', 'https://', 'https:/merchant.example/coupon',
    'https://user:password@merchant.example/coupon', 'https://user@merchant.example/coupon',
    'https://:password@merchant.example/coupon', 'https://merchant.example/ coupon',
    'https://merchant.example/\ncoupon', 'https:\\merchant.example\\coupon',
  ]) {
    const current = { ...stale, url };
    const sourceResult = apply({ ...review, sourceUrl: url }, current);
    assert.equal(sourceResult.redemption, undefined, url);
    assert.deepEqual(sourceResult, withoutRedemption(current));
    for (const method of ['onsite', 'public_code', 'provider_coupon', 'external', 'unknown']) {
      assert.equal(apply({ ...review, method, publicCode: 'SAVE10', url }, stale).redemption, undefined, `${method}: ${url}`);
    }
  }
});

test('optional details and instructions must be reviewed strings, with no description fallback', () => {
  const minimal = apply({ ...review, details: undefined, instructions: undefined });
  assert.equal(minimal.redemption.details, undefined);
  assert.equal(minimal.redemption.instructions, undefined);
  for (const patch of [{ details: {} }, { instructions: ['Show coupon'] }]) {
    assert.equal(apply({ ...review, ...patch }, stale).redemption, undefined);
  }
});

test('malformed or missing manifests and duplicate reviews remove stale metadata', () => {
  for (const data of [undefined, null, [], 'invalid', {}, { reviews: {} }, { reviews: [] }, { reviews: [null, 4, {}] }, manifest(null), { reviews: [review, review] }]) {
    assert.deepEqual(applyDealRedemptions([stale], data, NOW), [deal]);
  }
  assert.ok(applyDealRedemptions([deal], { reviews: [null, review, {}] }, NOW)[0].redemption);
});

test('apply is idempotent, does not mutate inputs, and preserves all unrelated fields and deal order', () => {
  const hidden = { ...deal, id: 'hidden', hidden: true, votes: 81, custom: { keep: ['a', 'b'] } };
  const deals = [stale, hidden];
  const data = manifest();
  const original = structuredClone({ deals, data });
  const first = applyDealRedemptions(deals, data, NOW);
  assert.deepEqual(applyDealRedemptions(first, data, NOW), first);
  assert.deepEqual(first.map(withoutRedemption), [deal, hidden]);
  assert.deepEqual({ deals, data }, original);
  assert.deepEqual(applyDealRedemptions(first, data, Date.parse(review.reviewUntil)), [deal, hidden]);
  assert.deepEqual(applyDealRedemptions([null, 7, 'unchanged'], data, NOW), [null, 7, 'unchanged']);
});

test('bundle stamps include metadata in the version, preserve bundle fields, and remain idempotent', () => {
  const bundle = { deals: [stale, { ...deal, id: 'not-reviewed' }], totalDeals: 99, custom: { keep: true } };
  const original = structuredClone(bundle);
  const options = { nowIso: NOW_ISO, redemptionManifest: manifest() };
  const first = stampDealsFeedBundle(bundle, options);
  assert.ok(first.deals[0].redemption);
  assert.equal(first.deals[1].redemption, undefined);
  assert.deepEqual(first.deals.map(withoutRedemption), bundle.deals.map(withoutRedemption));
  assert.deepEqual(first.custom, bundle.custom);
  assert.equal(first.totalDeals, 2);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.lastUpdated, NOW_ISO);
  assert.equal(first.feedVersion, computeDealsFeedVersion(first.deals));
  assert.notEqual(first.feedVersion, computeDealsFeedVersion(first.deals.map(withoutRedemption)));
  assert.deepEqual(stampDealsFeedBundle(first, options), first);
  assert.deepEqual(bundle, original);
  const removed = stampDealsFeedBundle(first, { ...options, redemptionManifest: null });
  assert.deepEqual(removed.deals, first.deals.map(withoutRedemption));
});

test('existing public-text sanitization and stamp validation are unchanged', () => {
  const original = { ...deal, title: `${deal.title} - manual review required` };
  const clean = stampDealsFeedBundle({ deals: [original] }, { nowIso: NOW_ISO, redemptionManifest: null });
  assert.equal(clean.deals[0].title, deal.title);
  assert.equal(original.title, `${deal.title} - manual review required`);
  for (const bundle of [null, [], {}, { deals: {} }]) {
    assert.throws(() => stampDealsFeedBundle(bundle, { redemptionManifest: null }));
  }
});

test('local loading and file stamping use only a temporary fixture; missing and malformed files fail safe', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-redemptions-'));
  try {
    const manifestPath = path.join(directory, 'reviews.json');
    const feedPath = path.join(directory, 'deals.json');
    const options = { nowIso: NOW_ISO, redemptionManifestPath: manifestPath };
    const bundle = { deals: [stale], preserved: 'fixture' };
    assert.equal(loadDealRedemptions(manifestPath), null);
    assert.deepEqual(stampDealsFeedBundle(bundle, options).deals, [deal]);
    for (const contents of ['{malformed', 'null', '[]', '{"reviews":{}}']) {
      fs.writeFileSync(manifestPath, contents);
      assert.equal(loadDealRedemptions(manifestPath), null);
      assert.deepEqual(stampDealsFeedBundle(bundle, options).deals, [deal]);
      assert.equal(fs.readFileSync(manifestPath, 'utf8'), contents);
    }
    const contents = JSON.stringify(manifest());
    fs.writeFileSync(manifestPath, contents);
    assert.deepEqual(loadDealRedemptions(manifestPath), manifest());
    assert.ok(stampDealsFeedBundle(bundle, options).deals[0].redemption);
    assert.equal(stampDealsFeedBundle(bundle, { ...options, redemptionManifest: null }).deals[0].redemption, undefined);
    fs.writeFileSync(feedPath, JSON.stringify(bundle));
    const first = stampDealsFeedFile(feedPath, options);
    assert.ok(first.deals[0].redemption);
    assert.deepEqual(JSON.parse(fs.readFileSync(feedPath, 'utf8')), first);
    assert.deepEqual(stampDealsFeedFile(feedPath, options), first);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), contents);
    assert.deepEqual(bundle, { deals: [stale], preserved: 'fixture' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
