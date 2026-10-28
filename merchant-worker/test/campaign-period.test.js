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
      const isLong = new URL(url).pathname.endsWith('/cs_long_fields');
      return Response.json({ id: isLong ? 'cs_long_fields' : 'cs_test_period', payment_intent: isLong ? 'pi_long_fields' : 'pi_test_period',
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
    description: 'Nur vor Ort. Ab 2 Personen; solange der Vorrat reicht. <!channel>',
    address: 'Testgasse 1, 1010 Wien', ctaURL: 'https://example.com',
    oldPrice: '9 EUR', dealPrice: '5 EUR',
    offerValidityText: '14.–18.10.2026, 12–15 Uhr',
  };
  const call = body => worker.fetch(new Request('https://worker.test/api/merchant/campaigns', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  for (const bad of ['x'.repeat(161), 42, '\u0001']) {
    assert.equal((await call({ ...payload, offerValidityText: bad })).status, 400);
  }
  for (const dealTitle of ['Gratis Bier', 'Porno Angebot']) {
    assert.equal((await call({ ...payload, dealTitle })).status, 422);
    assert.equal(records.size, 0);
    assert.equal(slack.length, 0);
  }
  const first = await call(payload);
  assert.equal(first.status, 201);
  const campaign = (await first.json()).campaign;
  assert.equal(campaign.offerValidityText, payload.offerValidityText);
  assert.equal(campaign.endsAt - campaign.startsAt, 86400000);
  assert.equal(slack.length, 1);
  assert.ok(JSON.stringify(slack[0]).includes(payload.offerValidityText));
  const slackText = slack[0].blocks[1].text.text;
  assert.ok(slackText.includes('Details und Bedingungen: Nur vor Ort. Ab 2 Personen; solange der Vorrat reicht. &lt;!channel&gt;'));
  assert.ok(slackText.includes('Normalpreis: 9 EUR'));
  assert.ok(slackText.includes('Angebotspreis: 5 EUR'));
  assert.ok(!slackText.includes('<!channel>'));
  assert.equal(slack[0].unfurl_links, false);
  assert.equal(slack[0].unfurl_media, false);
  const listing = await worker.fetch(new Request('https://worker.test/api/merchant/campaigns'), env);
  assert.deepEqual((await listing.json()).campaigns, [campaign]);
  const retry = await call(payload);
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).campaign, campaign);
  assert.equal(slack.length, 1);

  const expandedPayload = { ...payload, transactionId: 'pi_long_fields', stripeSessionId: 'cs_long_fields',
    restaurantName: 'Test & '.repeat(12), dealTitle: 'Pizza um 5 EUR ' + '&'.repeat(90),
    description: 'Pizza vor Ort. ' + '&'.repeat(340), address: 'Testgasse 1, Wien ' + '&'.repeat(110),
    ctaURL: 'https://example.com/menu?a=' + '&'.repeat(200),
  };
  const expanded = await call(expandedPayload);
  assert.equal(expanded.status, 201);
  const expandedCampaign = (await expanded.json()).campaign;
  assert.equal(slack.length, 2);
  const sections = slack[1].blocks.filter(block => block.type === 'section');
  assert.ok(sections.every(block => block.text.text.length <= 2800), 'escaped Slack sections must stay below the service limit');
  const combined = sections.map(block => block.text.text).join('\n');
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  assert.ok(combined.includes(escape(expandedCampaign.description)));
  assert.ok(combined.includes(escape(expandedCampaign.ctaURL)));
});
