import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyDealRedemptions } from './deal-redemptions.mjs';
import { refreshFoodRedemptions, syncFoodRedemptions } from './refresh-food-redemptions.mjs';

const live = { id: 'fixture', url: 'https://restaurant.example/coupons', brand: 'Restaurant', title: 'Mittagsmenü',
  description: 'Coupon beim Bestellen vorzeigen.', approvedAt: '2026-11-10T11:00:00Z', validUntil: '2026-11-30' };
const observation = '2026-11-20T12:00:00.000Z';
const text = 'Ein Mittagsmenü zum Aktionspreis bis 30.11.2026';
const contentHash = createHash('sha256').update(text).digest('hex');
const asset = live.url + '/pdf';
const row = { dealId: live.id, expectedTitle: live.title, expectedDescription: live.description, sourceUrl: live.url,
  expectedPeriod: { validOn: '', validFrom: '', validUntil: '2026-11-30', expires: '' },
  verifiedAt: '2026-11-19T09:00:00.000Z', reviewUntil: '2026-11-20T09:00:00.000Z', method: 'provider_coupon',
  url: asset, instructions: live.description, evidence: [{ url: asset }],
  recheck: { kind: 'official-food-card', merchant: live.brand, contentHash, extractionMethod: 'official-reviewed-coupon-card',
    cardSha256: 'a'.repeat(64), validUntil: '2026-11-30', endExclusive: '2026-11-30T23:00:00.000Z' } };
const pending = { id: live.id, originSource: 'power-official-food', brand: live.brand, url: live.url,
  evidence: { checkedAt: observation, contentHash, textSample: text, extractionMethod: row.recheck.extractionMethod,
    merchantSourceKey: live.brand, source: 'official-merchant-page', sourceUrl: live.url,
    offerTiming: {validUntil: live.validUntil}, media: { kind: 'pdf', url: asset, cardSha256: row.recheck.cardSha256 } } };
const now = Date.parse(observation) + 1000;
const refresh = (candidates = [pending], reviewed = row, when = now, deal = live) =>
  refreshFoodRedemptions({ reviews: [reviewed] }, [deal], candidates, when).reviews[0];

test('a new match renews only the identical reviewed card, from source observation time', () => {
  const revisited = refresh();
  assert.equal(revisited.verifiedAt, observation);
  assert.equal(revisited.reviewUntil, '2026-11-21T12:00:00.000Z');
  assert.deepEqual(refresh([pending], revisited, now + 1000), revisited);
  assert.deepEqual(refresh([], revisited), revisited);
  assert.deepEqual(refresh([pending, pending]), row);
  assert.deepEqual(refresh([pending], row, now, { ...live, description: 'Geändert' }), row);
  for (const checkedAt of ['invalid', new Date(now + 5000).toISOString(), new Date(now - 26 * 3600000).toISOString()]) {
    assert.deepEqual(refresh([{ ...pending, evidence: { ...pending.evidence, checkedAt } }]), row);
  }
});

test('altered terms, coupon image, action URL and provenance cannot extend a route', () => {
  const valid = { ...row, reviewUntil: '2026-11-20T17:00:00.000Z' };
  for (const patch of [{ textSample: text + ' ausgenommen Dienstag' }, { sourceUrl: asset }, { contentHash: 'x' },
    { media: { ...pending.evidence.media, cardSha256: 'b'.repeat(64) } }, { media: { ...pending.evidence.media, url: asset + '2' } },
    { source: 'cached' }, { offerTiming: {validUntil: '2026-12-01'} }]) {
    const held = refresh([{ ...pending, evidence: { ...pending.evidence, ...patch } }], valid);
    assert.equal(held.reviewUntil, observation);
    assert.equal(applyDealRedemptions([live], { reviews: [held] }, now)[0].redemption, undefined);
    const olderProof = { ...pending, evidence: { ...pending.evidence, checkedAt: new Date(now - 120000).toISOString() } };
    assert.deepEqual(refresh([olderProof], held), held);
  }
});

test('future offers cannot prolong review past the last inclusive Vienna campaign day', () => {
  const lastDay = { ...pending, evidence: { ...pending.evidence, checkedAt: '2026-11-30T15:00:00.000Z' } };
  assert.equal(refresh([lastDay], row, Date.parse(lastDay.evidence.checkedAt)).reviewUntil, row.recheck.endExclusive);
  assert.equal(refresh([lastDay], row, Date.parse(row.recheck.endExclusive)), row);
  const current = refresh();
  assert.equal(applyDealRedemptions([{ ...live, validUntil: '2026-11-17' }], { reviews: [current] }, now)[0].redemption, undefined);
});

test('a reviewed onsite card stays bound to its official text and redemption channel', () => {
  const r = { ...row, method: 'onsite', recheck: {kind: 'official-food-card', merchant: live.brand,
    extractionMethod: 'merchant-card', contentHash} };
  delete r.url;
  const p = { ...pending, evidence: { ...pending.evidence, extractionMethod: 'merchant-card', offerTiming: {validUntil: ''} } };
  delete p.evidence.media;
  assert.equal(refresh([p], r).verifiedAt, observation);
  assert.equal(refresh([p], { ...r, method: 'public_code', publicCode: 'SOMETHING' }).verifiedAt, r.verifiedAt);
});

test('normal sync publishes routes, preserves feed contents, is idle on retry and drops stale instructions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-food-redemption-'));
  try {
    fs.mkdirSync(path.join(root,'docs')); fs.mkdirSync(path.join(root,'reviews'));
    const write = (name, value) => fs.writeFileSync(path.join(root,name),JSON.stringify(value));
    const read = name => JSON.parse(fs.readFileSync(path.join(root,name)));
    write('reviews/deal-redemptions.json', {reviews:[row]});
    write('docs/deals.json', {deals:[live]}); write('docs/deals-pending-power.json', {deals:[pending]});
    assert.deepEqual(syncFoodRedemptions(root, now), { refreshedOrShortened:1, feedChanged:true, currentRoutes:1 });
    const result = read('docs/deals.json');
    assert.deepEqual(result.deals[0].redemption.verifiedAt, observation);
    const {redemption, ...rest} = result.deals[0]; assert.deepEqual(rest,live);
    assert.deepEqual(syncFoodRedemptions(root, now + 1000), { refreshedOrShortened:0, feedChanged:false, currentRoutes:1 });
    assert.deepEqual(read('docs/deals.json'), result);
    assert.deepEqual(syncFoodRedemptions(root, now + 86400000), { refreshedOrShortened:0, feedChanged:true, currentRoutes:0 });
    assert.deepEqual(read('docs/deals.json').deals,[live]);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
