import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { MerchantPromoLedger } from '../src/merchant-promos.js';

const live = process.argv.includes('--send-slack-test');
const channel = live ? process.env.SLACK_CHANNEL_ID : 'C0AF8TXN2KW';
if (live && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'ataalla24-ux/deal-finder' ||
    process.env.ISOLATED_SLACK_TEST !== 'owner-authorized' || !process.env.SLACK_BOT_TOKEN || channel !== 'C0AF8TXN2KW')) {
  throw Error('Explicit isolated diagnostic configuration is required. No message was sent.');
}
const runId = `FF-CHECK-${new Date().toISOString().replace(/[^0-9]/g, '')}-${crypto.randomUUID().slice(0, 8)}`;
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init) { super(input, init?.body?.getReader ? { ...init, duplex: 'half' } : init); }
};
const records = new Map();
const storage = {
  async get(key) { return records.get(key); },
  async put(key, value) { records.set(key, structuredClone(value)); },
  async list({ prefix = '' } = {}) { return new Map([...records].filter(([key]) => key.startsWith(prefix))); },
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) records.delete(key); },
  async transaction(operation) { return operation(storage); },
};
const ledger = new MerchantPromoLedger({ storage });
const nativeFetch = globalThis.fetch;
let attempts = 0;
let receipt;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://slack.com/api/chat.postMessage');
  assert.equal(options.method, 'POST');
  const message = JSON.parse(options.body);
  assert.equal(message.channel, channel);
  assert.ok(message.text.includes('[TEST]'));
  assert.ok(JSON.stringify(message).includes(runId));
  assert.ok(!message.blocks.some(block => block.type === 'actions'), 'test cards must not have publication controls');
  assert.equal(++attempts, 1, 'never automatically repeat a possibly delivered diagnostic');
  const response = live ? await nativeFetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) })
    : Response.json({ ok: true, channel, ts: 'offline-fixture' });
  const result = await response.clone().json();
  assert.ok(response.ok && result.ok === true && result.channel === channel && result.ts, 'Slack acceptance not established');
  receipt = { ok: true, channel: result.channel, ts: result.ts,
    permalink: live ? `https://freefinder.slack.com/archives/${channel}/p${result.ts.replace('.', '')}` : null };
  return response;
};
const env = {
  MERCHANT_PROMO_ADMIN_SECRET: crypto.randomUUID(),
  SLACK_BOT_TOKEN: live ? process.env.SLACK_BOT_TOKEN : 'offline-fixture-only',
  SLACK_CHANNEL_ID: channel,
  MERCHANT_PROMOS: { idFromName: name => name, get: () => ledger },
};
const call = (route, body, admin = false) => worker.fetch(new Request(`https://isolated.invalid/api/merchant/promos/${route}`, {
  method: 'POST', headers: { 'content-type': 'application/json',
    ...(admin ? { authorization: `Bearer ${env.MERCHANT_PROMO_ADMIN_SECRET}` } : {}) }, body: JSON.stringify(body),
}), env);
try {
  assert.equal((await call('admin/codes', { kind: 'shared', code: 'SPOTLIGHTGRATIS', packageId: 'spotlight' }, true)).status, 201);
  const check = await call('check', { code: 'SPOTLIGHTGRATIS' });
  assert.equal(check.status, 200);
  assert.equal((await check.json()).package.durationDays, 3);
  const draft = { code: 'SPOTLIGHTGRATIS', requestId: crypto.randomUUID(), platform: 'android',
    restaurantName: '[TEST] FreeFinder - nicht veroeffentlichen', dealTitle: '[TEST] Datenfluss, kein echtes Angebot',
    description: `Isolierte technische Kontrolle ${runId}. Keine echte Anzeige, Bestellung oder Restaurantaktion.`,
    address: 'Testadresse 1, 1010 Wien', offerValidityText: 'Nur Testdaten; keine Angebotsgueltigkeit.',
    oldPrice: 'Test-Normalpreis', dealPrice: 'Test-Angebotspreis', acceptedTerms: true };
  const first = await call('redeem', draft);
  assert.equal(first.status, 201);
  const { campaign } = await first.json();
  assert.equal(campaign.amount, 0);
  assert.equal(campaign.endsAt - campaign.startsAt, 3 * 86400000);
  assert.equal((await call('redeem', draft)).status, 200);
  assert.equal(attempts, 1);
  assert.ok(receipt, 'No actual accepted Slack response was captured. Do not resend automatically.');
  const report = { checkedAt: new Date().toISOString(), runId, liveSlackTransport: live,
    sourceCommit: process.env.GITHUB_SHA || null, isolatedLedgerOnly: true,
    productionCampaignsWritten: 0, productionPromoClaimsConsumed: 0, customerNotificationsSent: 0,
    storePurchases: 0, paidProviderCalls: 0, slackAttempts: attempts, idempotentRetryPassed: true, receipt };
  const output = path.resolve('output/isolated-slack-submission.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  globalThis.fetch = nativeFetch;
  globalThis.Request = NativeRequest;
}
