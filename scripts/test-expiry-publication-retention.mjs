import test from 'node:test';
import assert from 'node:assert/strict';
import { readApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';

process.env.SENTRY_DISABLED = '1';
const { validateApprovalCandidates, preparePublishedApprovedDeals } = await import('../scraper/slack-approve.js');

const now = new Date('2026-11-24T12:00:00.000Z');
const sourceUrl = 'https://www.preisjaeger.at/deals/gratis-kaffee-in-wien-372999';
const sourceText = 'Gratis Kaffee bei Cafe Wien. Am 27.11.2026 von 15:00 bis 19:00 Uhr bekommt ihr einen Kaffee gratis.\nNur vor Ort am Rathausplatz, 1010 Wien, solange der Vorrat reicht.';
const candidate = {
  id: 'expiry-source-retention', brand: 'Cafe Wien', title: 'Gratis Kaffee bei Cafe Wien',
  description: 'Am 27.11.2026 von 15:00 bis 19:00 Uhr einen Kaffee gratis am Rathausplatz, 1010 Wien erhalten.',
  source: 'Google Deals', originSource: 'google-deals-scraper', url: sourceUrl,
  type: 'gratis', category: 'kaffee', distance: 'Rathausplatz, 1010 Wien', city: 'Wien', postalCode: '1010',
  validOn: '2026-11-27', validFrom: '2026-11-27', validUntil: '2026-11-27', expiryKind: 'single',
  expires: '2026-11-27T18:00:00.000Z', expiresOriginal: '27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr',
  expiryDisplayText: '27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr', dateConfidence: 'high',
  sourcePublishedAt: '2026-11-24T08:00:00.000Z', sourcePublishedAtSource: 'time.datetime',
  pipelineLifecycle: { manualDecision: 'approved', manualDecisionAt: '2026-11-24T11:59:59.000Z' },
};

async function validate(record = candidate, patch = {}) {
  let healthReads = 0;
  const validation = await validateApprovalCandidates([structuredClone(record)], {
    now, existingDeals: [], requireMap: false, approvalCachedReviewOnly: true,
    inspectDealUrlHealth: async url => {
      healthReads++;
      assert.equal(url, record.url);
      return { status: 200, finalUrl: url, checkedAt: now.toISOString(), dateHints: {}, contentHints: {},
        approvalSourceEvidence: { sourceUrl: url, caption: sourceText }, ...patch };
    },
    approvalModelRequest: async () => { throw new Error('Expiry evidence retention must not request a model'); },
  });
  return { validation, healthReads };
}

test('validated original text survives publication with the final human approval timestamp', async () => {
  const { validation, healthReads } = await validate();
  assert.equal(validation.allowedDeals.length, 1, JSON.stringify(validation.report));
  const approvedAt = '2026-11-24T11:59:59.247Z';
  const approved = { ...validation.allowedDeals[0], approvedAt };
  const published = await preparePublishedApprovedDeals([approved], { now, enabled: false });
  assert.equal(published.length, 1);
  const receipt = readApprovedExpiryEvidence(published[0], { now });
  assert.ok(receipt, 'final publication must contain a valid receipt after approvedAt changes from the temporary input');
  assert.equal(receipt.sourceText.replace(/\s+/g, ' ').trim(), sourceText.replace(/\s+/g, ' ').trim());
  assert.equal(receipt.approvedAt, approvedAt);
  assert.equal(receipt.period.expires, candidate.expires);
  assert.notEqual(receipt.sourceText, published[0].description);
  assert.equal(healthReads, 1, 'source retention reuses the existing URL health read');
  assert.equal(readApprovedExpiryEvidence({ ...published[0], validUntil: '2026-11-28' }, { now }), null);
});

test('a blocked current source cannot turn historical or manually displayed copy into a publication receipt', async () => {
  for (const patch of [
    { status: 403, blockedByProtection: true },
    { status: 503, transientError: true },
    { approvalSourceEvidence: { sourceUrl, caption: sourceText, blockingReason: 'withdrawn-offer' } },
    { approvalSourceEvidence: { sourceUrl: sourceUrl.replace('372999', '372998'), caption: sourceText } },
  ]) {
    const { validation } = await validate(candidate, patch);
    for (const row of [...validation.allowedDeals, ...validation.blockedDeals]) {
      assert.equal(readApprovedExpiryEvidence(row, { now }), null, JSON.stringify(patch));
    }
  }
});

test('manually edited copy with no current original source text does not become expiry evidence', async () => {
  const manual = { ...candidate, editedInSlack: true, slackEditedAt: '2026-11-24T11:58:00.000Z',
    slackEditedFields: ['description'], description: sourceText };
  const { validation } = await validate(manual, { approvalSourceEvidence: undefined });
  for (const row of [...validation.allowedDeals, ...validation.blockedDeals]) {
    assert.equal(readApprovedExpiryEvidence(row, { now }), null);
  }
});

test('a generic collector cannot reuse its original caption against an unsuccessful or mismatched current source read', async () => {
  const tiktok = { ...candidate, id: 'tiktok-expiry-source-retention',
    source: 'TikTok', originSource: 'tiktok-deals-scanner',
    url: 'https://www.tiktok.com/@cafewien/video/7710635479883992342',
    caption: sourceText, sourceAccountType: 'merchant',
    sourcePublishedAt: '2026-11-21T14:43:41.000Z', sourcePublishedAtSource: 'url.tiktokVideoId' };
  const successful = await validate(tiktok);
  assert.equal(successful.validation.allowedDeals.length, 1, JSON.stringify(successful.validation.report));
  assert.ok(readApprovedExpiryEvidence(successful.validation.allowedDeals[0], { now }));
  for (const patch of [
    { status: 403, approvalSourceEvidence: { sourceUrl: tiktok.url, caption: sourceText } },
    { status: 200, approvalSourceEvidence: { sourceUrl: tiktok.url.replace('7710635479883992342', '7710635479883992343'), caption: sourceText } },
    { status: 200, approvalSourceEvidence: { sourceUrl: tiktok.url, caption: '' } },
  ]) {
    const { validation } = await validate(tiktok, patch);
    for (const row of [...validation.allowedDeals, ...validation.blockedDeals]) {
      assert.equal(readApprovedExpiryEvidence(row, { now }), null, JSON.stringify(patch));
    }
  }
  const inherited = successful.validation.allowedDeals[0];
  const stale = await validate(inherited, { status: 503, transientError: true, approvalSourceEvidence: undefined });
  for (const row of [...stale.validation.allowedDeals, ...stale.validation.blockedDeals]) {
    assert.equal(readApprovedExpiryEvidence(row, { now }), null, 'a previously valid receipt cannot survive failed current recapture');
  }
});
