import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assessLiveDealDuplicates, classifyDealDuplicatePair, canMergeApprovedDealRecords } from './live-deal-duplicates.mjs';
import { semanticCrossPlatformOfferKey } from '../scraper/deal-evidence-utils.js';

process.env.SENTRY_DISABLED = '1';
const { dedupeApprovedDeals, filterAlreadyLiveFallbackDeals, preparePublishedApprovedDeals } = await import('../scraper/slack-approve.js');
const originals = JSON.parse(fs.readFileSync(new URL('./fixtures/live-duplicate-originals-20261128.json', import.meta.url))).deals;
const byId = id => structuredClone(originals.find(row => row.id === id));
const now = new Date('2026-11-28T09:00:00.000Z');
const original = () => byId('meta-ig-18107511371456022');
// Synthetic second internal record of the actual retained post, not a newly
// fetched source or a claim that these duplicate IDs exist in production.
function copiedPost() { return { ...original(), id: 'legacy-copy-of-retained-post', approvedAt: '2026-11-28T08:00:00.000Z' }; }
const options = { now };

test('confirms an identical sourced record and keeps the older ID in either input order without merging fields', () => {
  const keeper = original(), copy = copiedPost(), before = structuredClone([keeper, copy]);
  for (const deals of [[keeper, copy], [copy, keeper]]) {
    const result = assessLiveDealDuplicates(deals, options);
    assert.deepEqual(result.removals.map(row => [row.id, row.keeperId]), [[copy.id, keeper.id]]);
    const proof = result.removals[0].proof;
    assert.match(proof.bindingHash, /^[a-f0-9]{64}$/);
    assert.equal(proof.sourceHashes[0], proof.sourceHashes[1]);
    assert.deepEqual(proof.mediaIds, [keeper.metaGraphMediaId, keeper.metaGraphMediaId]);
    assert.equal(result.decisions.find(row => row.id === keeper.id).action, 'keep');
    const retained = deals.filter(row => !result.removals.some(removal => removal.id === row.id));
    assert.deepEqual(assessLiveDealDuplicates(retained, options).removals, []);
    assert.deepEqual(dedupeApprovedDeals(deals), [keeper]);
  }
  assert.deepEqual([keeper, copy], before);
  assert.notEqual(classifyDealDuplicatePair(keeper, copy, { now: new Date('invalid') }).status, 'confirmed');
});

test('actual Dahab cross-posts need review; 3-for-2 and both M2 months remain separate', () => {
  const dahab = originals.filter(row => /dahab/i.test(row.brand));
  const result = assessLiveDealDuplicates(dahab, options);
  assert.deepEqual(result.removals, []);
  assert.ok(result.reviewPairs.some(pair => [pair.leftId, pair.rightId].includes('meta-ig-17998595205020247')
    && [pair.leftId, pair.rightId].includes('meta-ig-18107511371456022')));
  const months = originals.filter(row => /m2/i.test(row.brand));
  assert.equal(classifyDealDuplicatePair(...months, options).status, 'distinct');
  assert.equal(dedupeApprovedDeals(months).length, 2);
});

test('NORDSEE separate coupons and AIDA benefit tiers are not collapsed by their shared page or source', () => {
  const coupons = originals.filter(row => /nordsee/i.test(row.brand));
  assert.equal(coupons.length, 2);
  assert.equal(dedupeApprovedDeals(coupons).length, 2);
  assert.deepEqual(assessLiveDealDuplicates(coupons, options).removals, []);
  const aida = byId('meta-ig-18121024280323002');
  const tiers = [{ ...aida, id: 'aida-five', title: '5 € Gutschein ab 20 €' },
    { ...aida, id: 'aida-ten', title: '10 € Gutschein ab 40 €' }];
  assert.equal(dedupeApprovedDeals(tiers).length, 2);
  assert.deepEqual(assessLiveDealDuplicates(tiers, options).removals, []);
});

test('missing or changed source identity, terms, time, location or approval never authorizes removal', () => {
  const mutations = [
    d => d.metaGraphAccepted = false, d => d.metaGraphVerified = false,
    d => d.metaGraphBlockingReason = 'source-unavailable', d => d.metaGraphIsRepost = true,
    d => d.isRepost = true, d => d.isReshare = true, d => d.isOriginal = false,
    d => d.evidence.repost = true, d => d.evidence.originalPost = { isOriginal: false },
    d => d.evidence.originalPost = { url: 'https://www.instagram.com/p/DgMwmvoOI77/' },
    d => d.postVerification = { originalPostUrl: 'https://www.instagram.com/p/DgMwmvoOI77/' },
    d => d.postVerification = { ownerUsername: 'other' },
    d => d.evidence.mediaId = '999', d => d.merchantUsername = 'othermerchant',
    d => d.evidence.entityResolution.ownerUsername = 'othermerchant', d => d.sourceAccountType = 'creator',
    d => d.url = 'https://instagram.example/p/DgQIUvqNQm-/', d => d.metaGraphCaption = '',
    d => d.url = 'https://www.instagram.com/p/DgMwmvoOI77/',
    d => d.evidencePostUrl = 'https://www.instagram.com/p/DgMwmvoOI77/',
    d => d.sourcePublishedAt = '2026-11-25T16:39:53.000Z',
    d => d.approvedAt = '2000-01-01T00:00:00.000Z',
    d => d.metaGraphCaption += ' Nur für Neukunden.', d => d.description += ' Nur mit Gutschein.',
    d => d.metaGraphOcrText = 'Nur mit anderem Couponcode 1234.',
    d => d.evidence.mediaEvidence = { ocrText: 'Nur am 29.11.2026.' },
    d => d.title = d.title.replace('1 + 1', '3 für 2'), d => d.promotionEvidence = '3 für 2',
    d => d.price = 1, d => d.conditions = 'Nur für Neukunden',
    d => d.validOn = '2026-11-29', d => d.expires = '2026-11-28T17:00:00.000Z',
    d => d.expiryKind = 'unknown', d => d.expiryEstimated = true,
    d => d.address = 'Andere Straße 10, 1010 Wien', d => d.location = 'Wien',
    d => d.metaGraphVerifiedAt = '2026-11-29T00:00:00.000Z', d => d.approvedAt = '',
    d => d.pipelineLifecycle.manualDecision = 'rejected', d => d.validity = { status: 'blocked' },
    d => d.approvalBlock = { reasons: ['unverified'] },
  ];
  for (const mutate of mutations) {
    const copy = copiedPost(); mutate(copy);
    assert.notEqual(classifyDealDuplicatePair(original(), copy, options).status, 'confirmed', String(mutate));
    assert.deepEqual(assessLiveDealDuplicates([original(), copy], options).removals, [], String(mutate));
  }
});

test('owner/manual protections apply by explicit ID, and URL-only legacy edits remain conservative', () => {
  for (const field of ['forceKeep', 'liveForceKeep', 'isBusinessAdvertisement', 'isBusiness', 'campaignId', 'liveEditedAt', 'editedInSlack']) {
    const copy = copiedPost(); copy[field] = true;
    assert.deepEqual(assessLiveDealDuplicates([original(), copy], options).removals, [], field);
    assert.equal(dedupeApprovedDeals([original(), copy]).length, 2, field);
  }
  const copy = copiedPost();
  for (const edits of [[{ dealId: copy.id, forceKeep: true }], [{ url: copy.url, forceKeep: true }]]) {
    assert.deepEqual(assessLiveDealDuplicates([original(), copy], { ...options, edits }).removals, []);
    assert.equal(canMergeApprovedDealRecords(original(), copy, { ...options, edits }), false);
  }
  assert.equal(assessLiveDealDuplicates([original(), copy], { ...options,
    edits: [{ dealId: 'different-offer', url: copy.url, forceKeep: true }] }).removals.length, 1);
});

test('newer blocked, stale or mismatched source evidence vetoes an older duplicate proof', () => {
  const copy = copiedPost();
  const latest = { url: copy.url, mediaId: copy.metaGraphMediaId, ownerUsername: copy.ownerUsername,
    caption: copy.metaGraphCaption, sourcePublishedAt: copy.sourcePublishedAt, sourceAccountType: 'merchant',
    verifiedAt: '2026-11-28T08:30:00.000Z', isRepost: false, graphAccepted: true };
  const sourceEvidence = new Map([[copy.id, latest]]);
  assert.equal(assessLiveDealDuplicates([original(), copy], { ...options, sourceEvidence }).removals.length, 1);
  for (const patch of [{ blockingReason: 'source-unavailable' }, { graphAccepted: false }, { isRepost: true },
    { isReshare: true }, { ownerUsername: 'other' }, { sourceAccountType: 'creator' },
    { isOriginal: false }, { repostedFrom: 'another-source' },
    { evidence: { originalPost: { url: 'https://www.instagram.com/p/DgMwmvoOI77/' } } },
    { postVerification: { originalPostUrl: 'https://www.instagram.com/p/DgMwmvoOI77/' } },
    { url: 'https://www.instagram.com/p/DgMwmvoOI77/' }, { mediaId: '999' }, { caption: 'Changed campaign' },
    { ocrText: 'Nicht am 28.11.2026; neue Aktion am 29.11.2026.' },
    { mediaEvidence: { ocrText: 'Nur mit anderem Couponcode 1234.' } },
    { verifiedAt: '2026-11-28T09:00:00.001Z' }, { verifiedAt: '2026-11-27T08:59:59.999Z' },
    { sourcePublishedAt: '2026-11-25T16:39:53.000Z' }]) {
    const evidence = new Map([[copy.id, { ...latest, ...patch }]]);
    assert.deepEqual(assessLiveDealDuplicates([original(), copy], { ...options, sourceEvidence: evidence }).removals, [], JSON.stringify(patch));
    assert.equal(canMergeApprovedDealRecords(original(), copy, { ...options, sourceEvidence: evidence }), false);
  }
});

test('the same invented title on two records is not corroborated by their genuine caption', () => {
  const keeper = original(), copy = copiedPost();
  keeper.title = copy.title = 'Gratis Pizza für alle';
  assert.deepEqual(assessLiveDealDuplicates([keeper, copy], options).removals, []);
});

test('preapproval preserves separate months and products sharing the same URL', () => {
  const base = { ...original(), title: '20 % Rabatt auf Pizza', id: 'november', validOn: '',
    validFrom: '2026-11-01', validUntil: '2026-11-30' };
  const december = { ...base, id: 'december', url: 'https://www.instagram.com/p/DecemberOffer/',
    validFrom: '2026-12-01', validUntil: '2026-12-31' };
  assert.equal(dedupeApprovedDeals([base, december]).length, 2);
  const shared = { id: 'soup', brand: 'Cafe Example', title: 'Suppe für 5 €', url: 'https://cafe.example/offers' };
  assert.equal(dedupeApprovedDeals([shared, { ...shared, id: 'pizza', title: 'Pizza für 8 €' }]).length, 2);
  assert.equal(canMergeApprovedDealRecords(shared, { ...shared, id: 'other-id' }), false);
  assert.equal(canMergeApprovedDealRecords(shared, { ...shared, title: 'Korrigierter Titel' }), true);
  const kept = filterAlreadyLiveFallbackDeals([december], [], [base]);
  assert.equal(kept.deals.length, 1);
});

test('decimal amounts and EUR/percent units remain distinct in shared semantic matching', () => {
  const base = { brand: 'Pizza Example', description: '', validOn: '2026-11-28', url: 'https://www.instagram.com/p/Offer/' };
  const key = title => semanticCrossPlatformOfferKey({ ...base, title });
  assert.match(key('Pizza für 8,50 €'), /8\.50eur/);
  assert.match(key('Pizza für 11,50 €'), /11\.50eur/);
  assert.notEqual(key('Pizza für 8,50 €'), key('Pizza für 11,50 €'));
  assert.notEqual(key('Pizza für 8,50 €'), key('8,50 % Rabatt auf Pizza'));
  assert.match(key('8,50 % Rabatt auf Pizza'), /8\.50pct/);
  assert.notEqual(key('8,50 % Rabatt auf Pizza'), key('9,50 % Rabatt auf Pizza'));
  assert.notEqual(key('Pizza für 1.234,50 €'), key('Pizza für 234,50 €'));
  assert.equal(key('Pizza für 1.234,50 €'), '', 'an ambiguous thousands-formatted price must not match only its tail');
  for (const title of ['Pizza für 1 234,50 €', 'Pizza für €1 234,50', 'Pizza für 1\u00a0234,50 €',
    'Pizza für €1\u202f234,50', 'Pizza für 1,234.50 €']) assert.equal(key(title), '', title);
});

test('an unproven shared-page match does not bypass new-offer photo approval', async () => {
  const current = { id: 'current', brand: 'Cafe', title: 'Suppe', url: 'https://cafe.example/offers' };
  const incoming = { ...current, id: 'incoming', title: 'Pizza', imageApprovalRequired: true };
  const blockedDeals = [];
  assert.deepEqual(await preparePublishedApprovedDeals([incoming], { now, enabled: false, existingDeals: [current], blockedDeals }), []);
  assert.equal(blockedDeals.length, 1);
});
