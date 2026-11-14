import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractApprovalSourceEvidence } from '../scraper/approval-source-evidence.js';
import { prepareReviewedApprovalCopy } from '../scraper/approval-reviewed-source-copy.js';
import { normalizeDealExpiry } from '../scraper/expiry-utils.js';
import { copyReviewReasons } from './automatic-deal-maintenance.mjs';

const now = new Date('2026-11-14T12:00:00Z');
// Minimal public-offer fields copied from actual pending queue on 14 November.
// Slack user/message identifiers are deliberately absent from the fixture.
const original = {
  id: 'fc4g-1opqd7m', brand: "McDonald's", source: 'Slack Digest', originSource: 'Firecrawl Gastro #4',
  url: 'https://www.preisjaeger.at/deals/mcdonalds-gratis-fussball-donut-zum-osterreich-match-372365',
  title: '1 Fußball-Donut gratis zum Österreich-Match', description: '',
  validFrom: '2026-11-14', validUntil: '', validOn: '', expires: '', expiryKind: 'start', dateConfidence: 'high',
  expiresOriginal: 'ab 14. November 2026; Enddatum im Beitrag Keine konkrete Uhrzeit angegeben',
  expiryDisplayText: 'ab 14. November 2026; Enddatum im Beitrag Keine konkrete Uhrzeit angegeben',
  expiresSource: '', expirySource: '', expiresPrecision: '', expiresDetectedFromUrl: false,
  pipelineLifecycle: { manualDecision: 'approved', stage: 'manually-approved', publishedAt: '' },
  approvalCopyReview: { hash: 'prior-copy-wait', waitingForSlot: true }, evidence: {},
};
const html = fs.readFileSync(fileURLToPath(new URL('./fixtures/preisjaeger-donut-dom-20261114.html', import.meta.url)), 'utf8');
const proof = () => ({ ...extractApprovalSourceEvidence(html, original.url, original.url), checkedAt: now.toISOString() });

test('actual Donut source and queue yield complete fixed wording with exact Vienna period and no source/model call', () => {
  const before = structuredClone(original), evidence = proof();
  const result = prepareReviewedApprovalCopy(original, evidence, { now });
  assert.notEqual(result, original);
  assert.deepEqual(original, before);
  assert.equal(result.title, 'McDonald’s: Gratis Fußball-Donut per App');
  for (const term of ['App', '17.11.2026', 'teilnehmenden', 'Vorrat', 'Einmal pro Bestellung', 'zweimal pro Gast',
    'sechs MyMcDonald’s-Gutscheine', 'neuer Bestellung', 'Kein McDelivery', 'keine Barauszahlung']) assert(result.description.includes(term), term);
  assert(result.description.length < 550);
  assert.equal(result.validFrom, original.validFrom);
  assert.equal(result.validUntil, '2026-11-17');
  assert.equal(result.expires, '2026-11-17T22:59:59.999Z');
  assert.equal(result.expiryKind, 'range');
  assert.deepEqual(copyReviewReasons(result), []);
  assert.equal(result.reviewedSourceCopy.offerPeriodEvidence.literal, 'bis inkl. 17.11.2026');
  assert.equal(result.reviewedSourceCopy.method, 'reviewed-source-template-v1');
  assert.equal(result.approvalCopyReview, undefined, 'fixed wording drops the obsolete empty-copy memo without fabricating an AI review');
  assert.equal(prepareReviewedApprovalCopy(result, evidence, { now }), result, 'already prepared copy remains unchanged');
});

test('complete period survives ordinary offline expiry normalization atomically', async () => {
  const result = prepareReviewedApprovalCopy(original, proof(), { now });
  const before = structuredClone(result);
  await normalizeDealExpiry(result, { now, allowUrlLookup: false });
  assert.deepEqual(result, before);
  await normalizeDealExpiry(result, { now: new Date('2026-11-16T19:00:00Z'), allowUrlLookup: false });
  assert.deepEqual(result, before, 'read date never moves the offer period');
});

test('changed identity/title/description/amount cannot inherit the reviewed offer', () => {
  for (const patch of [{ id: 'other' }, { url: original.url + '?other=1' }, { brand: 'Other' }, { source: 'Other' },
    { originSource: 'Other' }, { title: 'Zwei Fußball-Donuts gratis' }, { title: '1 Fußball-Donut um 1 €' },
    { description: 'An owner description' }, { price: 1 }, { discountPercent: 50 }]) {
    const deal = { ...original, ...patch };
    assert.equal(prepareReviewedApprovalCopy(deal, proof(), { now }), deal, JSON.stringify(patch));
  }
});

test('withdrawn/changed/wrong or stale proof never becomes a current source through a stored copy memo', () => {
  const source = proof();
  for (const patch of [{ sourceUrl: 'https://example.org/' }, { sourceKind: 'untrusted' }, { blockingReason: 'expired' },
    { caption: source.caption.replace('17.11.2026', '15.11.2026') },
    { caption: source.caption.replace('Maximal 2', 'Maximal 1') },
    { caption: source.caption.replace('Fußball Donut', 'Kaffee') },
    { caption: source.caption.replace('Nicht über McDelivery verfügbar und nicht gegen Bargeld einlösbar.', '') },
    { checkedAt: undefined }, { checkedAt: '2026-11-13T12:00:00.000Z' }, { checkedAt: '2026-11-15T12:00:00.000Z' }]) {
    assert.equal(prepareReviewedApprovalCopy(original, { ...source, ...patch }, { now }), original);
  }
  const stored = { ...original, reviewedSourceCopy: prepareReviewedApprovalCopy(original, source, { now }).reviewedSourceCopy };
  assert.equal(prepareReviewedApprovalCopy(stored, null, { now }), stored);
  const expiredNow = new Date('2026-11-17T23:00:00Z');
  assert.equal(prepareReviewedApprovalCopy(original, { ...source, checkedAt: expiredNow.toISOString() }, { now: expiredNow }), original);
});

test('existing ends, conflicting starts and manual periods remain untouched', () => {
  for (const patch of [{ validUntil: '2026-11-17' }, { expires: '2026-11-18' }, { validOn: '2026-11-14' },
    { validFrom: '2026-11-13' }, { end_date: '2026-11-20' }, { validity_date: '2026-11-20' },
    { expiryKind: 'end' }, { expiresOriginal: 'bis 30. November 2026' }, { expiryDisplayText: 'Unbekannt' },
    { evidence: { offerTiming: { validUntil: '2026-11-19' } } }, { communityDateReview: true },
    { expiresSource: 'slack.community-human-review' }]) {
    const deal = { ...original, ...patch };
    assert.equal(prepareReviewedApprovalCopy(deal, proof(), { now }), deal, JSON.stringify(patch));
  }
});

test('human approval/live membership/manual edits are required independently of a newly set approval timestamp', () => {
  const freshlyApproved = { ...original, approvedAt: now.toISOString() };
  assert.notEqual(prepareReviewedApprovalCopy(freshlyApproved, proof(), { now }), freshlyApproved);
  assert.equal(prepareReviewedApprovalCopy(original, proof(), { now, existingIds: new Set([original.id]) }), original);
  for (const patch of [{ pipelineLifecycle: { manualDecision: 'rejected' } },
    { pipelineLifecycle: { ...original.pipelineLifecycle, stage: 'published' } },
    { pipelineLifecycle: { ...original.pipelineLifecycle, publishedAt: now.toISOString() } },
    { editedInSlack: true }, { slackEditedAt: now.toISOString() }, { slackFormEditTs: 'existing-edit' },
    { liveEditedAt: now.toISOString() }, { liveEditedFields: ['description'] }, { slackEditedFields: ['title'] },
    { isBusiness: true }, { campaignId: 'campaign' }, { forceKeep: true }]) {
    const deal = { ...original, ...patch };
    assert.equal(prepareReviewedApprovalCopy(deal, proof(), { now }), deal, JSON.stringify(patch));
  }
});
