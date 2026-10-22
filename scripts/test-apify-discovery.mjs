import test from 'node:test';
import assert from 'node:assert/strict';
import { ApifyDiscoveryClient, budgetCheck } from '../scraper/apify-discovery-client.js';

const now = new Date('2026-10-22T18:00:00Z');
const fixture = () => ({
  user: { plan: { tier: 'FREE', monthlyUsageCreditsUsd: 5 } },
  limits: { limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 0.1 }, monthlyUsageCycle: { startAt: '2026-10-01', endAt: '2026-11-01' } },
  actor: { pricingInfos: [{ startedAt: '2026-01-01', pricingModel: 'PAY_PER_EVENT', minimalMaxTotalChargeUsd: 0.0027 }] },
});

test('known included credit and enforced account limit allow bounded run', () => {
  assert.equal(budgetCheck(fixture(), now).allowed, true);
});
test('larger scans leave 35 cents for storage and stop before included credit is exhausted', () => {
  const data = fixture();
  data.limits.current.monthlyUsageUsd = 4.574;
  assert.equal(budgetCheck(data, now).allowed, true);
  assert.equal(budgetCheck(data, now).creditReserveUsd, .35);
  data.limits.current.monthlyUsageUsd = 4.576;
  assert.equal(budgetCheck(data, now).reason, 'included-credit-reserve');
  for (const cap of [NaN, Infinity, -.01, 0, .076, '0.075']) {
    assert.equal(budgetCheck(fixture(), now, cap).reason, 'invalid-run-cap');
  }
});
test('unknown budget, overage, stale cycle and unsupported pricing fail closed', () => {
  for (const mutate of [
    x => { delete x.user.plan; },
    x => { x.limits.limits.maxMonthlyUsageUsd = 100; },
    x => { x.limits.current.monthlyUsageUsd = 4.8; },
    x => { x.limits.current.monthlyUsageUsd = '0'; },
    x => { x.limits.monthlyUsageCycle.endAt = '2026-10-01'; },
    x => { x.actor.pricingInfos[0].pricingModel = 'FLAT_PRICE_PER_MONTH'; },
    x => { x.actor.pricingInfos[0].minimalMaxTotalChargeUsd = 0.5; },
  ]) {
    const data = fixture(); mutate(data);
    assert.equal(budgetCheck(data, now).allowed, false);
  }
});
test('provider errors are redacted and starts never retried', async () => {
  let calls = 0;
  const client = new ApifyDiscoveryClient('private-token', async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.equal(url.includes('private-token'), false);
    return new Response('private-token and personal profile', { status: 429, headers: { 'retry-after': '90' } });
  });
  await assert.rejects(client.request('/acts/x/runs?timeout=10', { method: 'POST', body: {} }), error => {
    assert.equal(error.message, 'apify-http-429');
    assert.equal(error.httpStatus, 429);
    assert.ok(error.retryAt);
    return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(client.request('https://another-service.test/'));
});
