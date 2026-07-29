import assert from 'node:assert/strict';
import worker from '../referrals-worker/src/index.js';

class MemoryKV {
  constructor() {
    this.values = new Map();
  }

  async get(key, format) {
    const value = this.values.get(key);
    if (value == null) return null;
    return format === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}

const env = { REFERRAL_KV: new MemoryKV() };
const baseURL = 'https://referrals.example.test';
const deviceId = 'device-test-12345678';

async function call(path, init) {
  const response = await worker.fetch(new Request(`${baseURL}${path}`, init), env);
  return {
    status: response.status,
    body: await response.json(),
  };
}

const firstRedemption = await call('/api/promotions/redeem', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code: 'plus30wien',
    deviceId,
    platform: 'ios',
    appVersion: '5.3',
    source: 'flyer-qr',
  }),
});

assert.equal(firstRedemption.status, 201);
assert.equal(firstRedemption.body.promotion.plan, 'plus');
assert.equal(firstRedemption.body.promotion.active, true);
assert.equal(firstRedemption.body.promotion.durationDays, 30);

const repeatedRedemption = await call('/api/promotions/redeem', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code: 'PLUS30WIEN',
    deviceId,
    platform: 'android',
    appVersion: '5.3',
  }),
});

assert.equal(repeatedRedemption.status, 200);
assert.equal(repeatedRedemption.body.alreadyRedeemed, true);
assert.equal(
  repeatedRedemption.body.promotion.expiresAt,
  firstRedemption.body.promotion.expiresAt,
);

const status = await call(
  `/api/promotions/status?code=PLUS30WIEN&deviceId=${encodeURIComponent(deviceId)}`,
);

assert.equal(status.status, 200);
assert.equal(status.body.redeemed, true);
assert.equal(status.body.promotion.active, true);

const unusedDeviceStatus = await call(
  '/api/promotions/status?code=PLUS30WIEN&deviceId=device-unused-12345678',
);

assert.equal(unusedDeviceStatus.status, 200);
assert.equal(unusedDeviceStatus.body.redeemed, false);
assert.equal(unusedDeviceStatus.body.promotion.active, false);

const invalidCode = await call('/api/promotions/redeem', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code: 'NOT-A-CAMPAIGN',
    deviceId,
    platform: 'ios',
  }),
});

assert.equal(invalidCode.status, 404);

console.log('Promotion campaign tests passed.');
