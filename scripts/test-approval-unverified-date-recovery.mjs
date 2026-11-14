import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { offerPeriodFields } from '../scraper/offer-period-fields.js';
import { normalizeDealExpiry } from '../scraper/expiry-utils.js';
import { extractIamstudentApprovalSourceEvidence, prepareIamstudentApprovalPeriod,
  prepareIamstudentApprovalCopy, iamstudentApprovalDateHold } from '../scraper/approval-iamstudent-source-evidence.js';

const url = 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26';
const html = readFileSync(new URL('./fixtures/iamstudent-vapiano-20261114.html', import.meta.url), 'utf8');
const evidence = () => extractIamstudentApprovalSourceEvidence(html, url);
const now = new Date('2026-11-14T11:00:00.000Z');
// Exact relevant state of the observed pending row, without reviewer identifiers.
const candidate = () => ({ id: 'g2-15kbyb4', url, brand: 'Vapiano',
  title: '1+1 gratis Pasta bei Neuanmeldung in der VAPIANO Lovers App (Pomodoro, Carbonara, Bolognese oder Bolognese vegan)',
  description: '', source: 'Slack Digest', originSource: 'Firecrawl Gastro #2', category: 'essen', type: 'bogo',
  distance: 'VAPIANO Wien: Herrengasse, Mariahilfer Straße, Moulin Rouge, Vio Plaza, Westbahnhof oder Wien Mitte',
  address: '', city: '', missingFields: [], evidence: {},
  expires: '2027-02-28', expiresOriginal: 'bis 28.02.2027', validUntil: '2027-02-28T12:00:00.000Z',
  validOn: '', validFrom: '', expiryKind: 'end', expiryDisplayText: '2027-02-28',
  expiresSource: 'deal.structured', expirySource: 'deal.structured', dateConfidence: 'medium',
  expiresPrecision: '', expiresDetectedFromUrl: false,
  sourcePublishedAt: '2026-10-23T23:36:03.887Z', pubDate: '2026-10-23T23:36:03.887Z',
  pipelineLifecycle: { stage: 'manually-approved', manualDecision: 'approved' } });
const correct = (deal, proof = evidence(), options = {}) => prepareIamstudentApprovalPeriod(deal, proof, { now, ...options });

test('exact unedited machine period becomes unknown, preserving personal redemption and an isolated audit', async () => {
  const original = candidate(), before = structuredClone(original);
  const corrected = correct(original);
  assert.notEqual(corrected, original);
  assert.deepEqual(original, before, 'pure correction leaves input intact');
  for (const field of offerPeriodFields)
    assert.equal(corrected[field], field === 'expiryKind' ? 'unknown' : undefined, field);
  const audit = corrected.unverifiedPeriodCorrection;
  assert.equal(audit.method, 'iamstudent-unverified-machine-end-v1');
  assert.equal(audit.sourceUrl, url);
  assert.equal(audit.contentHash, evidence().contentHash);
  assert.equal(audit.checkedAt, now.toISOString());
  assert.equal(audit.previousPeriod.validUntil, original.validUntil);
  assert.equal(audit.previousPeriodHash, createHash('sha256').update(JSON.stringify(audit.previousPeriod)).digest('hex'));
  assert.deepEqual(corrected.pipelineLifecycle, original.pipelineLifecycle);
  assert.equal(corrected.description, '', 'period correction never persists a text suggestion');
  assert.equal(corrected.communityDateReview, undefined, 'no fabricated human decision');
  assert.equal(correct(corrected), corrected, 'second correction is a no-op');
  assert.equal(iamstudentApprovalDateHold(corrected, evidence()), '');
  const copy = prepareIamstudentApprovalCopy(corrected, evidence());
  assert.ok(copy.description.includes('Binnen 30 Tagen nach Anmeldung einlösen'));
  assert.ok(copy.description.includes('Österreich außer Linz'));
  await normalizeDealExpiry(copy, { now, allowUrlLookup: false });
  assert.equal(copy.validUntil || '', '', 'audit date is not expiry evidence');
  assert.equal(copy.expires || '', '');
  assert.equal(copy.expiryKind, 'unknown');
});

test('different identities, machine states, provenance and authored copy are never generalized', () => {
  const changes = [{ id: 'another-deal' }, { url: url + '?cached=1' }, { source: 'Other' },
    { originSource: 'Firecrawl Gastro #1' }, { title: 'Another pasta promotion' }, { description: 'Authored conditions' },
    { expires: '2027-03-01' }, { expiresOriginal: 'bis 01.03.2027' },
    { validUntil: '2027-02-28' }, { expiryDisplayText: '28.02.2027' }, { expiryKind: 'recurring' },
    { dateConfidence: 'high' }, { dateConfidence: 'low' }, { expiresSource: 'url' }, { expirySource: 'manual' },
    { validOn: '2027-02-28' }, { validFrom: '2026-11-01' }, { end_date: '2027-02-28' },
    { validity_date: '2027-02-28' }, { validityText: 'Gültig bis 28.02.2027' },
    { expiresPrecision: 'day' }, { expiresDetectedFromUrl: true },
    { evidence: { offerTiming: { validUntil: '2027-02-28', matchedText: 'Gültig bis 28.02.2027' } } },
    { evidence: { textSample: 'Gültig bis 28.02.2027' } }];
  for (const patch of changes) { const deal = { ...candidate(), ...patch }; assert.equal(correct(deal), deal, JSON.stringify(patch)); }
});

test('manual edits, live rows, missing approval and expired ends remain protected', () => {
  for (const patch of [{ editedInSlack: true }, { slackEditedAt: '2026-11-14' }, { slackFormEditTs: '1' },
    { liveEditedAt: '2026-11-14' }, { slackEditedFields: ['expires'] }, { liveEditedFields: ['description'] },
    { communityDateReview: { at: '2026-11-14' } }, { isBusiness: true }, { campaignId: 'x' }, { forceKeep: true },
    { pipelineLifecycle: {} }, { pipelineLifecycle: { manualDecision: 'rejected' } },
    { pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-11-14' } },
    { pipelineLifecycle: { manualDecision: 'approved', stage: 'published' } }]) {
    const deal = { ...candidate(), ...patch }; assert.equal(correct(deal), deal, JSON.stringify(patch));
  }
  const deal = candidate();
  assert.equal(correct(deal, evidence(), { existingIds: new Set([deal.id]) }), deal);
  for (const date of [new Date('2027-02-28T00:00:00Z'), new Date('2027-03-01'), new Date('invalid'), null])
    assert.equal(correct(deal, evidence(), { now: date }), deal);
  const alreadyExpired = { ...deal, expires: '2026-11-01', validUntil: '2026-11-01' };
  assert.equal(correct(alreadyExpired), alreadyExpired);
});

test('absent, changed, withdrawn or stored proof cannot authorize a correction', () => {
  const proof = evidence();
  const deal = { ...candidate(), unverifiedPeriodCorrection: correct(candidate()).unverifiedPeriodCorrection,
    reviewedSourceCopy: { contentHash: proof.contentHash }, approvalSourceEvidence: proof };
  for (const invalid of [null, {}, { ...proof, blockingReason: 'withdrawn' }, { ...proof, contentHash: 'other' },
    { ...proof, caption: proof.caption.replace('30 Tagen', '60 Tagen') },
    { ...proof, sourceUrl: url + '/other' }, { ...proof, sourceKind: 'other' }, { ...proof, voucherId: '1' }])
    assert.equal(correct(deal, invalid), deal);
});

async function withOfflineApproval(run) {
  process.env.SENTRY_DISABLED = '1';
  const { validateApprovalCandidates } = await import('../scraper/slack-approve.js');
  const oldFetch = globalThis.fetch, oldReview = process.env.APPROVAL_SOURCE_COPY_REVIEW;
  let requests = 0, modelCalls = 0;
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '1';
  globalThis.fetch = async (requested, init) => {
    requests++; assert.equal(requested, url); assert.equal(init.redirect, 'manual');
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  };
  try {
    await run(async (deal, options = {}) => {
      const before = requests;
      const result = await validateApprovalCandidates([deal], { now, existingDeals: [], requireMap: false,
        approvalCachedReviewOnly: true, requireVienna: false,
        approvalModelRequest: async () => { modelCalls++; throw Error('MODEL_FORBIDDEN'); }, ...options });
      assert.equal(requests - before, 1, 'only the existing health GET, served by the offline fixture');
      assert.equal(modelCalls, 0);
      return result;
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldReview === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = oldReview;
  }
}

test('production source inspector and approval use corrected originals with no expiry resurrection', async () => {
  await withOfflineApproval(async validate => {
    const result = await validate(candidate());
    assert.equal(result.allowedDeals.length, 1, JSON.stringify(result.results[0].decision.reasons));
    const [deal] = result.allowedDeals;
    assert.equal(deal.validUntil || '', ''); assert.equal(deal.expires || '', '');
    assert.equal(deal.expiryKind, 'unknown');
    assert.ok(deal.description.includes('30 Tagen nach Anmeldung'));
    assert.equal(deal.unverifiedPeriodCorrection.previousPeriod.expires, '2027-02-28');
    assert.equal(deal.communityDateReview, undefined);
  });
});

test('an independent hold retains the correction but restores empty input copy on each retry', async () => {
  await withOfflineApproval(async validate => {
    let pending = { ...candidate(), city: 'Linz', address: 'Hauptplatz 1, 4020 Linz', distance: 'Linz' };
    let firstAudit;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await validate(pending, { requireVienna: true });
      assert.equal(result.allowedDeals.length, 0);
      assert.ok(result.results[0].decision.reasons.includes('nicht eindeutig in Wien'));
      assert.ok(!result.results[0].decision.reasons.some(reason => reason.startsWith('Aktionszeitraum widersprüchlich')));
      [pending] = result.blockedDeals;
      assert.equal(pending.validUntil, undefined); assert.equal(pending.expires, undefined);
      assert.equal(pending.expiryKind, 'unknown'); assert.equal(pending.description, '');
      assert.equal(pending.reviewedSourceCopy, undefined, 'source text suggestions are never retained as evidence');
      assert.equal(pending.pipelineLifecycle.manualDecision, 'approved');
      if (firstAudit) assert.deepEqual(pending.unverifiedPeriodCorrection, firstAudit);
      firstAudit = pending.unverifiedPeriodCorrection;
    }
  });
});
