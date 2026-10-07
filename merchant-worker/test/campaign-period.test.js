import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('paid campaign preserves offer period through storage, Slack, public feed and retry', async t => {
  const records = new Map();
  const slack = [];
  const env = {
    STRIPE_SECRET_KEY: 'test-only-not-a-real-key',
    SLACK_WEBHOOK_URL: 'https://slack.test/webhook',
    MERCHANT_CAMPAIGNS: {
      async get(key, type) {
        const value = records.get(key) ?? null;
        return value && type === 'json' ? JSON.parse(value) : value;
      },
      async put(key, value) { records.set(key, value); },
    },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://api.stripe.com/v1/checkout/sessions/')) {
      return Response.json({ id: 'cs_test_period', payment_intent: 'pi_test_period',
        metadata: { merchant_package_id: 'starter', source: 'freefinder-web' },
        payment_status: 'paid', status: 'complete', currency: 'eur', amount_total: 2599 });
    }
    assert.equal(String(url), env.SLACK_WEBHOOK_URL);
    slack.push(JSON.parse(options.body));
    return new Response('ok');
  });
  const payload = {
    platform: 'web', paymentProvider: 'stripe', packageId: 'starter', transactionId: 'pi_test_period',
    stripeSessionId: 'cs_test_period', restaurantName: 'Testlokal', dealTitle: 'Lunch um 5 Euro',
    description: 'Nur vor Ort.', address: 'Testgasse 1, 1010 Wien', ctaURL: 'https://example.com',
    offerValidityText: '14.–18.10.2026, 12–15 Uhr',
  };
  const call = body => worker.fetch(new Request('https://worker.test/api/merchant/campaigns', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  for (const bad of ['x'.repeat(161), 42, '\u0001']) {
    assert.equal((await call({ ...payload, offerValidityText: bad })).status, 400);
  }
  const first = await call(payload);
  assert.equal(first.status, 201);
  const campaign = (await first.json()).campaign;
  assert.equal(campaign.offerValidityText, payload.offerValidityText);
  assert.equal(campaign.endsAt - campaign.startsAt, 86400000);
  assert.equal(slack.length, 1);
  assert.ok(JSON.stringify(slack[0]).includes(payload.offerValidityText));
  const listing = await worker.fetch(new Request('https://worker.test/api/merchant/campaigns'), env);
  assert.deepEqual((await listing.json()).campaigns, [campaign]);
  const retry = await call(payload);
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).campaign, campaign);
  assert.equal(slack.length, 1);
});
