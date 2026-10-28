import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { MerchantPromoLedger } from '../src/merchant-promos.js';

test('SPOTLIGHTGRATIS reaches Slack once with complete fields in an isolated ledger', async t => {
  const NodeRequest = globalThis.Request;
  t.mock.method(globalThis, 'Request', function (input, init) {
    // Node requires duplex for the streaming request forwarded by Workers.
    return new NodeRequest(input, init?.body?.getReader ? { ...init, duplex: 'half' } : init);
  });
  const records = new Map();
  const storage = {
    async get(key) { return records.get(key); },
    async put(key, value) { records.set(key, structuredClone(value)); },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) records.delete(key); },
    async list({ prefix = '' } = {}) { return new Map([...records].filter(([key]) => key.startsWith(prefix))); },
    async transaction(operation) { return operation(storage); },
  };
  const ledger = new MerchantPromoLedger({ storage });
  const sent = [];
  const env = {
    MERCHANT_PROMO_ADMIN_SECRET: 'fixture-only-secret',
    SLACK_WEBHOOK_URL: 'https://slack.test/isolated',
    MERCHANT_PROMOS: { idFromName: name => name, get: () => ledger },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), env.SLACK_WEBHOOK_URL, 'no payment, provider or other network call is allowed');
    sent.push(JSON.parse(options.body));
    return new Response('ok');
  });
  const call = (path, payload, admin = false) => worker.fetch(new Request(`https://fixture.test/api/merchant/promos/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json',
      ...(admin ? { authorization: 'Bearer fixture-only-secret' } : {}) }, body: JSON.stringify(payload),
  }), env);
  assert.equal((await call('admin/codes', { kind: 'shared', code: 'SPOTLIGHTGRATIS', packageId: 'spotlight' }, true)).status, 201);
  const checked = await call('check', { code: 'spotlightgratis' });
  assert.equal(checked.status, 200);
  assert.equal((await checked.json()).package.durationDays, 3);
  const draft = {
    code: 'SPOTLIGHTGRATIS', requestId: crypto.randomUUID(), platform: 'android',
    restaurantName: 'Fixture Cafe <!here>', dealTitle: '2 Pizzen zum Preis von 1',
    description: 'Nur Abholung. Zwei gleichwertige Pizzen; solange der Vorrat reicht.',
    address: 'Testgasse 1, 1010 Wien', offerValidityText: '30.10.2026, 12 bis 15 Uhr',
    oldPrice: '20 EUR', dealPrice: '10 EUR', acceptedTerms: true,
  };
  for (const patch of [{ acceptedTerms: false }, { address: '' }, { dealTitle: 'Gratis Bier' }]) {
    assert.ok([400, 422].includes((await call('redeem', { ...draft, ...patch })).status));
  }
  assert.equal(sent.length, 0);
  const first = await call('redeem', { ...draft, amount: 99999, packageId: 'city' });
  assert.equal(first.status, 201);
  const { campaign } = await first.json();
  assert.equal(campaign.amount, 0);
  assert.equal(campaign.packageId, 'spotlight');
  assert.equal(campaign.endsAt - campaign.startsAt, 3 * 86400000);
  assert.equal(sent.length, 1);
  const message = sent[0].blocks[1].text.text;
  for (const text of [draft.description, draft.address, draft.offerValidityText, 'Normalpreis: 20 EUR', 'Angebotspreis: 10 EUR']) {
    assert.ok(message.includes(text), `Slack must retain ${text}`);
  }
  assert.ok(message.includes('&lt;!here&gt;'));
  assert.ok(!JSON.stringify(sent[0]).includes('<!here>'));
  assert.equal((await call('redeem', draft)).status, 200);
  assert.equal(sent.length, 1, 'an idempotent retry must not send a second Slack notification');
  assert.equal((await call('redeem', { ...draft, requestId: crypto.randomUUID() })).status, 409);
  assert.equal(sent.length, 1);
});
