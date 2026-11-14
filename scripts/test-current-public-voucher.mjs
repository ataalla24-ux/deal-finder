import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractIamstudentApprovalSourceEvidence } from '../scraper/approval-iamstudent-source-evidence.js';
import { currentPublicVoucherEvidence } from '../scraper/current-public-voucher-evidence.js';
import { prepareIamstudentApprovalCopy, prepareIamstudentApprovalPeriod } from '../scraper/approval-iamstudent-source-evidence.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const url = 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26';
const html = readFileSync(new URL('./fixtures/iamstudent-vapiano-20261114.html', import.meta.url), 'utf8');
const now = new Date('2026-11-14T11:00:00Z');
const deal = { id: 'g2-15kbyb4', url };
const health = { status: 200, finalUrl: url, checkedAt: now.toISOString(),
  approvalSourceEvidence: extractIamstudentApprovalSourceEvidence(html, url) };

test('current exact public voucher establishes availability and geographic scope, never a deadline or pin', () => {
  const proof = currentPublicVoucherEvidence(deal, health, now);
  assert.equal(proof.scope, 'AT-except-Linz');
  for (const field of ['validUntil', 'expires', 'pubDate', 'latitude', 'longitude', 'address']) assert.equal(proof[field], undefined);
});

test('stale, rejected, redirected or changed evidence cannot replace freshness or geography checks', () => {
  for (const patch of [{ status: 403 }, { status: 429 }, { invalid: true }, { transientError: true },
    { blockedByProtection: true }, { finalUrl: 'https://example.invalid/' }, { checkedAt: undefined },
    { checkedAt: '2026-11-14T10:49:59Z' }, { checkedAt: '2026-11-14T11:01:00Z' },
    { approvalSourceEvidence: undefined },
    { approvalSourceEvidence: { ...health.approvalSourceEvidence, caption: 'Nur in Linz gültig.' } },
    { approvalSourceEvidence: { ...health.approvalSourceEvidence, blockingReason: 'withdrawn' } }]) {
    assert.equal(currentPublicVoucherEvidence(deal, { ...health, ...patch }, now), null, JSON.stringify(patch));
  }
  assert.equal(currentPublicVoucherEvidence({ ...deal, url: 'https://www.instagram.com/p/anything/' }, health, now), null);
  assert.equal(currentPublicVoucherEvidence({ ...deal, currentOfferVerification: health }, null, now), null);
});

test('actual old approved input keeps the Linz exclusion and passes geography only with current source proof', async () => {
  const actual = JSON.parse(readFileSync(new URL('./fixtures/approved-vapiano-legacy-20261114.json', import.meta.url)));
  const prepared = prepareIamstudentApprovalCopy(prepareIamstudentApprovalPeriod(actual, health.approvalSourceEvidence, { now }), health.approvalSourceEvidence);
  const before = structuredClone(prepared);
  const check = async (input = prepared, proof = health) => validateDealsForSlack([input], { now, inspectDealUrlHealth: async () => proof });
  const good = await check();
  assert.equal(good.allowedDeals.length, 1, JSON.stringify(good.results[0].decision.reasons));
  assert.match(good.allowedDeals[0].description, /außer Linz/);
  assert.equal(good.allowedDeals[0].sourcePublishedAt, actual.sourcePublishedAt);
  assert.equal(good.allowedDeals[0].validUntil, undefined);
  for (const input of [{ ...prepared, city: 'Linz', postalCode: '4020' },
    { ...prepared, description: prepared.description + ' Nur in Linz gültig.' },
    { ...prepared, description: prepared.description + ' Nicht in Wien gültig.' }]) {
    const bad = await check(input);
    assert.equal(bad.allowedDeals.length, 0);
  }
  const stale = await check(prepared, { ...health, checkedAt: '2026-11-13T11:00:00Z' });
  assert.equal(stale.allowedDeals.length, 0);
  assert.deepEqual(prepared, before, 'validation does not erase the actual terms or location inputs');
});
