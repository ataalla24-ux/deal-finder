import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function fixture() {
  const values = new Map();
  const env = { REFERRAL_KV: {
    get: async (key, type) => type === 'json' ? JSON.parse(values.get(key) || 'null') : values.get(key) || null,
    put: async (key, value) => values.set(key, value),
    list: async () => ({ keys: [], list_complete: true }),
  } };
  const call = body => worker.fetch(new Request('https://test/api/deals/submissions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  return { values, call };
}

const draft = { brand: 'Testlokal', title: '1+1 Pizza gratis', distance: 'Testgasse 1, 1010 Wien',
  description: 'Nur vor Ort.', expires: '12.10.2026, 12:00 bis 14.10.2026, 15:00 Uhr',
  url: '', submittedFrom: 'android-native-free-submit' };

test('manual offer without link is queued with date and address unchanged', async () => {
  const { call, values } = fixture();
  const response = await call(draft);
  assert.equal(response.status, 201);
  const saved = [...values.values()].map(value => JSON.parse(value)).find(value => value.title === draft.title);
  assert.equal(saved.url, '');
  assert.equal(saved.distance, draft.distance);
  assert.equal(saved.expires, draft.expires);
  assert.equal(saved.status, 'pending');
});

test('manual required fields and invalid supplied links fail without writes', async () => {
  const { call, values } = fixture();
  for (const field of ['brand', 'title', 'distance']) assert.equal((await call({ ...draft, [field]: '' })).status, 400);
  for (const url of ['javascript:alert(1)', 'bad link', [], 42]) assert.equal((await call({ ...draft, url })).status, 400);
  assert.equal(values.size, 0);
});

test('social link-only import still reaches enrichment, no link alone cannot', async () => {
  const { call } = fixture();
  assert.equal((await call({ url: 'https://www.instagram.com/p/test/', submittedFrom: 'ios-share-extension' })).status, 201);
  assert.equal((await call({ url: '', submittedFrom: 'ios-share-extension' })).status, 400);
});
