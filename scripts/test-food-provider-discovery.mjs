import test from 'node:test';
import assert from 'node:assert/strict';
import { FoodProviderClient, usageSummary } from '../scraper/food-provider-client.js';

test('usage summary never includes keys, email or unrecognized values', () => {
  const value = usageSummary('scraperapi', { requestCount: 0, requestLimit: 1000,
    apiKey: 'private-value', email: 'private-address', plan: { name: 'free', credits: 1000, apiKey: 'hidden' } });
  assert.equal(value.maximum, 1000);
  assert.equal(value.used, 0);
  assert.doesNotMatch(JSON.stringify(value), /private|hidden|apiKey|email/);
  assert.equal(usageSummary('scrapingbee', {}).maximum, null);
});
test('audit is read-only, fixed host, no redirects and sanitized errors', async () => {
  let calls = 0;
  const client = new FoodProviderClient('scrapingbee', { env: { SCRAPINGBEE: 'private-value' },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.href, 'https://app.scrapingbee.com/api/v1/usage');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer private-value');
      throw new Error('private-value');
    } });
  await assert.rejects(client.usage(), /^Error: provider-network-error$/);
  assert.equal(calls, 1);
});
test('missing key cannot make a request; Zyte audit does not pretend extraction key is stats key', async () => {
  const fetchImpl = () => { throw new Error('unexpected-fetch'); };
  await assert.rejects(new FoodProviderClient('scraperapi', { env: {}, fetchImpl }).usage(), /missing-credential/);
  assert.equal((await new FoodProviderClient('zyte', { env: { ZYSTE: 'private' }, fetchImpl }).usage()).status,
    'dashboard-trial-check-required');
});
