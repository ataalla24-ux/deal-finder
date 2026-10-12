import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessStructuredExpiry, verifyExpiryBatch, confirmExpiry, expiryFingerprint } from './verified-expiry-apply.mjs';

const now = new Date('2026-10-12T12:00:00Z');
const deal = { id: 'exact', title: 'Chicken Döner um 3,50 Euro', brand: 'Box 16',
  url: 'https://example.com/aktion', validUntil: '2026-10-05', description: 'Ein Chicken Döner zum Aktionspreis.' };
const offer = { '@type': 'Offer', name: deal.title, seller: { '@type': 'Organization', name: deal.brand },
  url: deal.url, validThrough: '2026-10-05' };
function response({ schema = offer, content = `${deal.brand}: ${deal.title}. Gültig bis 05.10.2026.`,
  extra = '', canonical = deal.url, status = 200, url = deal.url } = {}) {
  return { status, url, headers: { 'content-type': 'text/html; charset=utf-8' }, body:
    `<html><head><link rel="canonical" href="${canonical}"><script type="application/ld+json">${JSON.stringify(schema)}</script></head>
    <body><main><article><p>${content}</p>${extra}</article></main></body></html>` };
}
const assess = (options = {}, record = deal) => assessStructuredExpiry(record, response(options), { now });

test('one exact source is only a candidate; two fresh observations confirm', () => {
  const first = assess();
  assert.equal(first.status, 'candidate');
  assert.equal(first.automaticRemovalEligible, false);
  assert.equal(confirmExpiry(first, { ...first, checkedAt: '2026-10-11T12:00:00Z' }, now), true);
  for (const checkedAt of ['2026-10-12T11:59:00Z', '2026-10-13T12:00:00Z', '2026-10-08T12:00:00Z', 'invalid']) {
    assert.equal(confirmExpiry(first, { ...first, checkedAt }, now), false);
  }
});

test('HTML identity, canonical, title, merchant and offer URL must match exactly', () => {
  for (const overrides of [{ status: 404 }, { status: 403 }, { status: 429 }, { status: 500 },
    { url: 'https://example.com/' }, { canonical: 'https://example.com/' }, { canonical: 'http://[' },
    { schema: { ...offer, name: 'Chicken Döner um 5 Euro' } }, { schema: { ...offer, seller: { name: 'Other' } } },
    { schema: { ...offer, url: 'https://example.com/other' } }]) assert.equal(assess(overrides).status, 'review');
  assert.equal(assessStructuredExpiry(deal, { ...response(), headers: { 'content-type': 'application/json' } }, { now }).status, 'review');
});

test('multiple offers, listing pages and unrelated expiry text cannot remove', () => {
  for (const schema of [[offer, { ...offer, name: 'Other' }], { '@type': 'ItemList', itemListElement: [offer] },
    { '@type': 'Event', offers: offer }, { '@type': 'AggregateOffer', offers: offer }]) assert.equal(assess({ schema }).status, 'review');
  assert.equal(assess({ content: 'Other shop. Gültig bis 05.10.2026.', extra: `<p>${deal.brand} ${deal.title}</p>` }).status, 'review');
});

test('missing year, invalid dates, grace, future and conflicting end dates are protected', () => {
  for (const end of ['2026-10-11', '2027-01-01', '2026-02-29', '05.10.2026', '2026-10-05T10:00:00Z']) {
    assert.equal(assess({ schema: { ...offer, validThrough: end } }, { ...deal, validUntil: end }).status, 'review');
  }
  assert.equal(assess({ schema: { ...offer, priceValidUntil: '2027-01-01' } }).status, 'review');
  assert.equal(assess({ schema: { ...offer, validFrom: '2027-01-01' } }).status, 'review');
  for (const extra of ['Gültig bis 31.10.', 'Neue Aktion bis 2027-01-01', 'Gültig bis 31.10.2026']) {
    assert.equal(assess({ extra: `<p>${extra}</p>` }).status, 'review');
  }
  assert.equal(assess({}, { ...deal, validUntil: '2026-10-06' }).status, 'review');
  assert.equal(assess({}, { ...deal, validUntil: undefined, expires: '2026-10-05' }).status, 'review');
});

test('manual edits, recurring benefits, protected records and business campaigns remain', () => {
  for (const change of [{ forceKeep: true }, { campaignId: 'ad' }, { source: 'business-ad' },
    { description: 'Jeden Montag' }, { description: 'Mitgliedervorteil' }]) assert.equal(assess({}, { ...deal, ...change }).status, 'review');
  for (const edit of [{ dealId: deal.id }, { url: deal.url }]) assert.equal(assessStructuredExpiry(deal, response(), { now, edits: [edit] }).status, 'review');
  assert.equal(assess({ extra: '<p>Die Aktion wurde verlängert.</p>' }).status, 'review');
});

test('a social page or our own guide cannot prove automatic expiry', () => {
  for (const url of ['https://www.instagram.com/p/offer/', 'https://freefinder.at/deal/example', 'https://www.thefork.at/aktion']) {
    assert.equal(assessStructuredExpiry({ ...deal, url }, { ...response(), url }, { now }).status, 'review');
  }
});

test('changes reset evidence and counters do not change the offer fingerprint', () => {
  assert.equal(expiryFingerprint(deal), expiryFingerprint({ ...deal, votes: 8 }));
  const first = { ...assess(), checkedAt: '2026-10-11T12:00:00Z' };
  assert.equal(confirmExpiry({ ...assess(), evidenceHash: 'changed' }, first, now), false);
  assert.equal(confirmExpiry({ ...assess(), fingerprint: expiryFingerprint({ ...deal, approvedAt: now.toISOString() }) }, first, now), false);
});

test('application archives the full record only after confirmation, preview never removes', async () => {
  const inspect = async () => response();
  const first = await verifyExpiryBatch([deal], {}, [], { now: new Date('2026-10-11T12:00:00Z'), inspect, apply: true });
  assert.equal(first.removed.length, 0);
  const preview = await verifyExpiryBatch([deal], first.state, [], { now, inspect });
  assert.equal(preview.removed.length, 0);
  const next = await verifyExpiryBatch([deal], first.state, [], { now, inspect, apply: true });
  assert.equal(next.deals.length, 0);
  assert.deepEqual(next.removed[0].originalDeal, deal);
  assert.equal(next.removed[0].priorEvidence.checkedAt, '2026-10-11T12:00:00.000Z');
  assert.equal(deal.validUntil, '2026-10-05');
});

test('failures and re-approval reset confirmation; immediate reruns preserve observation', async () => {
  const first = await verifyExpiryBatch([deal], {}, [], { now, inspect: async () => response() });
  const repeat = await verifyExpiryBatch([deal], first.state, [], { now: new Date(now.getTime() + 1000), inspect: async () => response(), apply: true });
  assert.equal(repeat.removed.length, 0);
  assert.equal(repeat.state.entries.exact.checkedAt, first.state.entries.exact.checkedAt);
  const failed = await verifyExpiryBatch([deal], first.state, [], { now: new Date(now.getTime() + 25 * 3600000), inspect: async () => { throw Error('offline'); }, apply: true });
  assert.equal(failed.state.entries.exact.status, 'review');
  assert.equal(failed.removed.length, 0);
  const changed = await verifyExpiryBatch([{ ...deal, approvedAt: now.toISOString() }], first.state, [], { now: new Date(now.getTime() + 25 * 3600000), inspect: async () => response(), apply: true });
  assert.equal(changed.removed.length, 0);
});

test('per-run removal cap and fairness limit blast radius', async () => {
  const deals = Array.from({ length: 20 }, (_, i) => ({ ...deal, id: `deal${i}` }));
  const inspect = async () => response();
  const first = await verifyExpiryBatch(deals, {}, [], { now: new Date('2026-10-11T12:00:00Z'), inspect });
  const second = await verifyExpiryBatch(deals, first.state, [], { now, inspect, apply: true });
  assert.equal(second.removed.length, 2);
  const limited = await verifyExpiryBatch(deals, { entries: { deal0: first.state.entries.deal0 } }, [], { now, inspect, budget: 1 });
  assert.equal(limited.report.entries[0].id, 'deal1');
});
