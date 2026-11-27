import test from 'node:test';
import assert from 'node:assert/strict';
import { captureApprovedExpiryEvidence, readApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';

const now = new Date('2026-11-27T21:00:00.000Z');
const deal = { id: 'tiktok-original', brand: 'Cafe Wien',
  url: 'https://www.tiktok.com/@cafewien/video/7710635479883992342',
  title: 'Gratis Kaffee', description: 'Editorial copy is not original evidence.',
  validFrom: '2026-11-27', validOn: '2026-11-27', validUntil: '2026-11-27',
  expires: '2026-11-27T18:00:00.000Z', expiryKind: 'single',
  expiresOriginal: '27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr',
  sourcePublishedAt: '2026-11-21T14:43:41.000Z', sourcePublishedAtSource: 'url.tiktokVideoId',
  approvedAt: '2026-11-24T11:28:41.247Z',
  pipelineLifecycle: { manualDecision: 'approved', manualDecisionAt: '2026-11-24T11:28:41.000Z' } };
const original = '🎉 Am 27.11.2026 von 15:00 bis 19:00 Uhr: Gratis Kaffee!\nNur bei Cafe Wien.';
const capture = (record = deal, options = {}) => captureApprovedExpiryEvidence(record, {
  sourceText: original, sourceUrl: deal.url, verifiedAt: '2026-11-24T11:28:00.000Z', now, ...options });
const withReceipt = (record = deal) => ({ ...record, approvedExpiryEvidence: capture(record) });

test('preserves complete original text with exact period, source and real approval binding', () => {
  const record = withReceipt();
  const receipt = readApprovedExpiryEvidence(record, { now });
  assert.equal(receipt.sourceText, original);
  assert.equal(receipt.sourceUrl, deal.url);
  assert.equal(receipt.period.expires, deal.expires);
  assert.equal(receipt.approvedAt, deal.approvedAt);
  assert.match(receipt.sourceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(record.expires, deal.expires);
});

test('does not promote displayed copy or arbitrary missing inputs into source evidence', () => {
  assert.equal(capture(deal, { sourceText: undefined }), null);
  for (const options of [{ sourceText: '' }, { sourceText: '   ' }, { sourceText: original + '\u0000' },
    { sourceText: 'x'.repeat(16001) },
    { verifiedAt: '' }, { verifiedAt: '2026-11-24' }, { verifiedAt: '2026-11-28T00:00:00Z' },
    { sourceUrl: 'https://www.tiktok.com/@someoneelse/video/123' }, { sourceUrl: 'http://www.tiktok.com/@cafewien/video/7710635479883992342' }]) {
    assert.equal(capture(deal, options), null, JSON.stringify(options));
  }
  assert.equal(capture({ ...deal, approvedAt: '', pipelineLifecycle: {} }), null);
  assert.equal(capture({ ...deal, pipelineLifecycle: { ...deal.pipelineLifecycle, manualDecision: 'rejected' } }), null);
});

test('identity, original source, approval and period changes invalidate the receipt', () => {
  const record = withReceipt();
  for (const patch of [{ id: 'other' }, { brand: 'Other Cafe' }, { url: 'https://example.com/other' },
    { evidencePostUrl: 'https://www.instagram.com/p/Other/' }, { approvedAt: '2026-11-25T11:28:41.247Z' },
    { validUntil: '2026-11-28' }, { validOn: null }, { validFrom: '' }, { expires: '2026-11-28T18:00:00Z' },
    { expiresOriginal: 'Verlängert' }, { expiryKind: 'start' }, { expirySource: 'manual' },
    { sourcePublishedAt: '2026-11-22T14:43:41.000Z' }, { sourcePublishedAtSource: 'guessed-date' },
    { pipelineLifecycle: { ...deal.pipelineLifecycle, manualDecisionAt: '2026-11-25T11:28:41.000Z' } }]) {
    assert.equal(readApprovedExpiryEvidence({ ...record, ...patch }, { now }), null, JSON.stringify(patch));
  }
});

test('receipt tampering or corrupted version is rejected; editor-only copy changes remain valid', () => {
  const record = withReceipt();
  for (const patch of [{ version: 2 }, { sourceText: original + ' And tomorrow.' }, { verifiedAt: '2026-11-25T11:28:00Z' },
    { sourceHash: 'f'.repeat(64) }, { bindingHash: 'f'.repeat(64) }, { brand: 'Other Cafe' }, { period: {} }]) {
    assert.equal(readApprovedExpiryEvidence({ ...record, approvedExpiryEvidence: { ...record.approvedExpiryEvidence, ...patch } }, { now }), null);
  }
  assert.ok(readApprovedExpiryEvidence({ ...record, title: 'Reviewed concise title', description: 'Reviewed concise copy', votes: 12 }, { now }));
});

test('optional undefined period fields do not invalidate a receipt or invent evidence', () => {
  const record = withReceipt();
  assert.ok(capture({ ...deal, validityText: undefined, expirySource: undefined }));
  assert.ok(readApprovedExpiryEvidence({ ...record, validityText: undefined }, { now }));
  assert.equal(capture({ ...deal, sourcePublishedAt: 'not-a-date' }), null);
  assert.equal(capture({ ...deal, sourcePublishedAtSource: {} }), null);
  assert.equal(readApprovedExpiryEvidence({ ...record, approvedExpiryEvidence: {
    ...record.approvedExpiryEvidence, sourcePublishedAt: '2026-11-22T14:43:41.000Z' } }, { now }), null);
});

test('canonical post decoration preserves original identity without accepting login pages or other posts', () => {
  const instagram = { ...deal, id: 'ig-original', url: 'https://instagram.com/reel/AbCdEf123/?utm_source=test' };
  const receipt = capture(instagram, { caption: original, sourceText: undefined,
    sourceUrl: 'https://www.instagram.com/p/AbCdEf123/' });
  assert.ok(receipt);
  assert.equal(receipt.sourceUrl, 'https://www.instagram.com/p/AbCdEf123/');
  assert.ok(readApprovedExpiryEvidence({ ...instagram, url: receipt.sourceUrl, approvedExpiryEvidence: receipt }, { now }));
  assert.equal(capture(instagram, { sourceUrl: 'https://www.instagram.com/p/abcdef123/' }), null);
  for (const url of ['https://instagram.com/accounts/login/?next=/p/AbCdEf123/',
    'https://secret@instagram.com/p/AbCdEf123/', 'https://instagram.com:444/p/AbCdEf123/',
    'https://www.tiktok.com/@cafewien', 'not-a-url']) assert.equal(capture({ ...deal, url }, { sourceUrl: url }), null);
});

test('a later actual source review preserves old human approval without inventing a new approval', () => {
  const receipt = capture(deal, { verifiedAt: now.toISOString() });
  assert.equal(receipt.verifiedAt, now.toISOString());
  assert.equal(receipt.approvedAt, deal.approvedAt);
  const legacy = { ...deal, approvedAt: undefined };
  assert.ok(capture(legacy));
});
