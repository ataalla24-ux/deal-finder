import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { extractFoodOffers } from '../scraper/power-food-extraction.js';
import { POWER_FOOD_SOURCES } from '../scraper/power-food-sources.js';
import { verifyOfficialFoodDeal } from '../scraper/power-food-verification.js';

const html = readFileSync(new URL('./fixtures/kfc-preiskracher-20261113.html', import.meta.url), 'utf8');
const source = POWER_FOOD_SOURCES.find(row => row.name === 'KFC');
const now = new Date('2026-11-14T10:00:00Z');
const original = extractFoodOffers(html, source, { now, pageUrl: source.url }).deals[0];
const input = { ...original, title: 'Crispy Cheese Burger für 1,70 Euro',
  source: 'Slack Digest', originSource: 'power-official-food',
  sourcePublishedAt: '2026-10-20T12:00:00.000Z', pubDate: '2026-10-20T12:00:00.000Z',
  sourcePublishedAtSource: 'slack.digest-validated-source-date', pubDateSource: 'slack.digest-validated-source-date',
  pipelineLifecycle: { manualDecision: 'approved' } };
const check = (deal = input, body = html) => verifyOfficialFoodDeal(deal, { now,
  fetchPage: async url => { assert.equal(url, source.url, 'no extra restaurant GET'); return { html: body, finalUrl: url }; } });

test('saved source excerpt reproduces the exact queued ID, full description and content hash', () => {
  assert.equal(original.id, 'power-food-73cf88790a2d');
  assert.equal(original.title, 'Unser Preiskracher: Crispy Cheese Burger mit Käse, Gurkerl und Ketchup um 1,70 Euro');
  assert.equal(original.description, original.title);
  assert.equal(original.evidence.contentHash, 'fbcfc52691ccdb4bed424b086cb6b1830d52aabdd0bba3da2e31b75b4631576b');
});

test('title equivalence alone supplies no fresh transport proof or Vienna branch', async () => {
  let reads = 0;
  const proof = await verifyOfficialFoodDeal(input, { now, fetchPage: async url => {
    reads++; assert.equal(url, source.url); return { html, finalUrl: url };
  } });
  assert.equal(reads, 1);
  assert.equal(proof.ok, true);
  assert.equal(proof.current, true);
  assert.equal(proof.currentOfferVerification, undefined, 'title match without current HTTP metadata cannot relax age');
  assert.equal(proof.viennaBranchEvidence, '');
  assert.equal(proof.branchEvidenceUrl, '');
  assert.equal(source.currentOffers, true);
  assert.equal(source.branchEvidenceUrl, undefined);
});

test('changed title amount, product, quantity, description, ID, hash or source cannot use the alias', async () => {
  for (const patch of [{ title: 'Crispy Cheese Burger für 0,70 Euro' }, { title: 'Veggie Burger für 1,70 Euro' },
    { title: '2 Crispy Cheese Burger für 1,70 Euro' }, { title: 'Burger gratis' }, { description: 'Gratis Burger' },
    { brand: 'Other merchant' }, { id: 'power-food-another' }, { url: 'https://kfc.co.at/archiv' },
    { evidence: { ...input.evidence, contentHash: 'forged' } }]) {
    const proof = await verifyOfficialFoodDeal({ ...input, ...patch }, { now,
      fetchPage: async url => ({ html, finalUrl: url }) });
    assert.equal(proof.ok, false, JSON.stringify(patch));
  }
});

test('changed or removed source caption still fails even when the input claims to be verified', async () => {
  for (const body of [html.replace('1,70 Euro', '2,70 Euro'), html.replace('Crispy Cheese Burger', 'Crispy Chicken Burger'),
    html.replace('mit Käse, Gurkerl und Ketchup', 'nur bei Kauf eines Menüs'), '<main></main>']) {
    assert.equal((await check({ ...input, current: true, officialFoodReverifiedAt: now.toISOString() }, body)).ok, false);
  }
  const changed = extractFoodOffers(html.replace('1,70 Euro', '2,70 Euro'), source, { now, pageUrl: source.url }).deals[0];
  assert.equal((await check({ ...changed, title: 'Crispy Cheese Burger für 2,70 Euro' }, html.replace('1,70 Euro', '2,70 Euro'))).ok,
    false, 'a newly calculated hash cannot broaden the one reviewed alias');
});

test('ordinary validator removes only the false missing-offer reason; age and Vienna remain blocked', async () => {
  process.env.SENTRY_DISABLED = '1';
  const { validateDealsForSlack } = await import('../scraper/deal-validity-agent.js');
  const previous = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = () => { throw Error('External requests forbidden'); };
  try {
    const result = await validateDealsForSlack([structuredClone(input)], { now,
      inspectDealUrlHealth: async url => ({ status: 200, finalUrl: url, dateHints: {}, contentHints: {} }),
      fetchOfficialFoodPage: async url => { reads++; assert.equal(url, source.url); return { html, finalUrl: url }; } });
    assert.equal(reads, 1);
    assert.equal(result.allowedDeals.length, 0);
    const row = result.results[0];
    assert.ok(!row.decision.reasons.some(reason => reason.includes('offer-not-on-current-page')));
    assert.ok(row.decision.reasons.some(reason => reason.includes('älter als 7 Tage')));
    assert.ok(row.decision.reasons.some(reason => reason.includes('nicht eindeutig in Wien')));
    assert.equal(row.deal.sourcePublishedAt, input.sourcePublishedAt);
    assert.equal(row.deal.pubDate, input.pubDate);
    assert.equal(row.deal.title, input.title);
    assert.equal(row.deal.description, input.description);
    assert.equal(row.deal.evidence.checkedAt, input.evidence.checkedAt);
  } finally { globalThis.fetch = previous; }
});
