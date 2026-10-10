import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refreshBusinessSnapshot } from './deal-map-business.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-business-map-review-'));
const previousEnv = { ...process.env };
const previousFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in tests'); };
process.env.SLACK_LIVE_REVIEW_DRY_RUN = '1';
process.env.SLACK_BOT_TOKEN = '';
process.env.SLACK_CHANNEL_ID = '';
process.env.DEAL_REMOVE_LINK_SECRET = 'test-only';
const now = new Date('2026-10-10T12:00:00Z');
const mapContext = { map: { locations: [] }, reviewed: {}, today: '2026-10-10' };
const campaign = {
  id: 'test', restaurantName: 'Restaurant Beispiel', dealTitle: 'Kaffee zur Abholung gratis',
  address: 'Wollzeile 29, 1010 Wien', status: 'paid',
  endsAt: new Date('2099-12-31T23:59:59Z').getTime(),
  email: 'private@example.invalid', transactionId: 'private-transaction',
};
const fixture = { root: temp, now, mapContext };
const write = (file, value) => fs.writeFileSync(path.join(temp, file), JSON.stringify(value));
try {
  const { loadBusinessMapReviews, businessMapReviewBlocks } = await import('./slack-live-deal-review.mjs');
  assert.deepEqual(loadBusinessMapReviews(fixture), { total: 0, entries: [] });
  assert.deepEqual(businessMapReviewBlocks(loadBusinessMapReviews(fixture)), []);
  fs.mkdirSync(path.join(temp, 'reviews'));
  write('reviews/map-business-campaigns.json', { deals: [] });
  assert.deepEqual(loadBusinessMapReviews(fixture), { total: 0, entries: [] });

  const projection = await refreshBusinessSnapshot({ now, fetcher: async () => Response.json({ ok: true, campaigns: [
    campaign,
    { ...campaign, id: 'hidden', status: 'hidden' },
    { ...campaign, id: 'cancelled', status: 'cancelled' },
    { ...campaign, id: 'expired', endsAt: now.getTime() },
  ] }) });
  assert.equal(projection.error, null);
  assert.equal(projection.snapshot.deals.length, 1, 'Hidden and expired campaigns are excluded by the business helper');
  const deal = projection.snapshot.deals[0];
  write('reviews/map-business-campaigns.json', { deals: [
    ...projection.snapshot.deals,
    { ...deal, id: 'merchant-expired-snapshot', validUntil: now.toISOString() },
    { ...deal, id: 'ordinary-deal' },
    { ...deal, id: 'merchant-online', address: 'Online', distance: 'Online', title: 'Online-Gutschein' },
  ] });
  const snapshotBefore = fs.readFileSync(path.join(temp, 'reviews/map-business-campaigns.json'), 'utf8');
  const review = loadBusinessMapReviews(fixture);
  assert.equal(review.total, 1, 'Only active unresolved business projections appear');
  assert.equal(review.entries[0].id, 'merchant-test');
  assert.equal(review.entries[0].review.status, 'address-ready');
  const blocks = businessMapReviewBlocks(review);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].text.type, 'plain_text');
  assert.match(blocks[1].text.text, /Restaurant: Restaurant Beispiel/);
  assert.match(blocks[1].text.text, /Angebot: Kaffee zur Abholung gratis/);
  assert.match(blocks[1].text.text, /Adresse: Wollzeile 29, 1010 Wien/);
  assert.match(blocks[2].elements[0].text, /\[address-ready\]/);
  assert.match(blocks[2].elements[0].text, /Business-Datensatz/);
  assert.ok(blocks.every(block => block.type !== 'actions'));
  assert.doesNotMatch(JSON.stringify(blocks), /Bearbeiten|action_id|\/api\/deals|private@|private-transaction|Deal-ID:/);
  assert.equal(fs.readFileSync(path.join(temp, 'reviews/map-business-campaigns.json'), 'utf8'), snapshotBefore);

  const verified = { id: 'test-location', name: 'Restaurant Beispiel', address: deal.address,
    latitude: 48.208, longitude: 16.379, confidence: 1, source: 'test', dealIds: [deal.id] };
  assert.equal(loadBusinessMapReviews({ ...fixture, mapContext: { ...mapContext, map: { locations: [verified] } } }).total, 0,
    'Mapped campaigns are omitted from the unresolved summary');
  write('reviews/map-business-campaigns.json', { deals: [{ ...deal, address: 'Wien', distance: 'Wien' }] });
  const missing = loadBusinessMapReviews(fixture);
  assert.equal(missing.entries[0].review.status, 'needs-review');
  assert.match(missing.entries[0].review.text, /Eine eindeutige Adresse mit Hausnummer fehlt/);
  assert.doesNotMatch(missing.entries[0].review.text, /missing-exact-address|Bearbeiten/);

  write('reviews/map-business-campaigns.json', { deals: Array.from({ length: 25 }, (_, index) => ({
    ...deal, id: `merchant-${index}`, brand: 'a'.repeat(179) + '\ud83c\udf89', title: '<!channel> & Angebot',
  })) });
  const bounded = loadBusinessMapReviews(fixture);
  assert.equal(bounded.total, 25);
  assert.equal(bounded.entries.length, 20);
  const boundedBlocks = businessMapReviewBlocks(bounded);
  assert.equal(boundedBlocks.length, 41);
  assert.match(boundedBlocks[0].text.text, /20 von 25/);
  for (const block of boundedBlocks) {
    const field = block.text || block.elements[0];
    assert.ok(field.text.isWellFormed());
    assert.ok(Array.from(field.text).length < 3000);
    if (field.text.includes('<!channel>')) assert.equal(field.type, 'plain_text');
  }

  // Test the real daily-review entry point without tokens, sends, or live files.
  fs.mkdirSync(path.join(temp, 'scripts'));
  fs.mkdirSync(path.join(temp, 'docs'));
  for (const file of ['slack-live-deal-review.mjs', 'deal-map-review.mjs', 'deal-map-enrichment.mjs', 'deal-map-business.mjs']) {
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(temp, 'scripts', file));
  }
  write('reviews/map-business-campaigns.json', projection.snapshot);
  for (const ordinary of [[], [{ id: 'ordinary', brand: 'Ordinary Cafe', title: 'Ordinary coffee', distance: 'Wien' }]]) {
    write('docs/deals.json', { deals: ordinary, totalDeals: ordinary.length });
    const before = fs.readFileSync(path.join(temp, 'docs/deals.json'), 'utf8');
    const run = spawnSync(process.execPath, [path.join(temp, 'scripts/slack-live-deal-review.mjs')], {
      cwd: temp, encoding: 'utf8', env: { ...process.env, SLACK_LIVE_REVIEW_DRY_RUN: '1' },
    });
    assert.equal(run.status, 0, run.stderr);
    const messages = run.stdout.trim().split(/\n(?=\{)/).map(value => JSON.parse(value));
    const business = messages.filter(message => message.text.startsWith('INTERN: Business-'));
    assert.equal(business.length, 1, 'Business review still appears when no ordinary live deals exist');
    assert.doesNotMatch(JSON.stringify(business), /action_id|\/api\/deals|Bearbeiten|merchant-test/);
    assert.match(JSON.stringify(business), /Restaurant Beispiel/);
    assert.doesNotMatch(JSON.stringify(messages.filter(message => !business.includes(message))), /Restaurant Beispiel|merchant-test/);
    assert.equal(fs.readFileSync(path.join(temp, 'docs/deals.json'), 'utf8'), before);
  }
  assert.equal(networkCalls, 0);
  console.log('Business Slack map review: absent/empty, hidden/expired helpers, unresolved-only, German reasons, bounds, Unicode and separation from ordinary actions passed');
} finally {
  globalThis.fetch = previousFetch;
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
