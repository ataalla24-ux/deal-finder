import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { invitationCode } from './public/_worker.js';
import { dealToken, resolveDealLink } from './public/deals.js';

const request = (path, method = 'GET') => new Request('https://www.freefinder.at' + path, { method });
const respond = (req, body, status, headers = {}) => new Response(req.method === 'HEAD' ? null : body, { status, headers });
const feed = async () => [{ id: 'pizza-1' }, { id: 'community:abc-123' }];
const run = (path, load = feed, method = 'GET') => resolveDealLink(request(path, method), invitationCode, respond, load);

test('known vectors match Swift and Kotlin, IDs stay stable after content edits', async () => {
  for (const [id, expected] of [['pizza-1', 'UoJ7Ip8gAf8e'], ['community:abc-123', 'TtiiFjm7GAzY'],
    ['joe-omv-current-5044fa7c7e98-299871f8c80c', 'qrWarYB3kC5W']]) assert.equal(await dealToken(id), expected);
  for (const id of [null, '', 'a\nb', 'a'.repeat(161)]) assert.equal(await dealToken(id), null);
});

test('exact deal and both invitation systems survive the compact link', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const suffix of ['', '?r=ABC123', '?i=ASNFZ4mrze8BI0Vn']) {
      const result = await run('/d/UoJ7Ip8gAf8e' + suffix, feed, method);
      assert.equal(result.status, 302);
      const target = new URL(result.headers.get('location'));
      assert.equal(target.host, 'freefinder.at');
      assert.equal(target.searchParams.get('deal'), 'pizza-1');
      assert.equal(target.searchParams.get('source'), 'deal_share');
      assert.equal(target.searchParams.get('ref'), suffix.includes('r=') ? 'FF-ABC123' : null);
      assert.equal(target.searchParams.get('invite'), suffix.includes('i=') ? 'RM-0123456789ABCDEF01234567' : null);
      assert.equal(target.pathname, suffix.includes('i=') ? '/invite.html' : '/');
      assert.equal(await result.text(), '');
    }
  }
  const community = new URL((await run('/d/TtiiFjm7GAzY')).headers.get('location'));
  assert.equal(community.searchParams.get('deal'), 'community:abc-123');
});

test('ambiguous input and open redirects never read the feed', async () => {
  let calls = 0;
  const load = async () => { calls++; return []; };
  for (const path of ['/d/', '/d/UoJ7Ip8gAf8e/', '/d/UoJ7Ip8gAf8e%0A', '/d/UoJ7Ip8gAf8e?next=https://evil.test',
    '/d/UoJ7Ip8gAf8e?r=', '/d/UoJ7Ip8gAf8e?i=', '/d/UoJ7Ip8gAf8e?r=ABC123&r=ABC123',
    '/d/UoJ7Ip8gAf8e?i=ASNFZ4mrze8BI0Vn&r=ABC123', '/d/UoJ7Ip8gAf8e?r=ABC12%0A']) {
    assert.equal((await run(path, load)).status, 404, path);
  }
  assert.equal(calls, 0);
});

test('missing, duplicate and unavailable offers fail closed without an unrelated redirect', async () => {
  assert.equal((await run('/d/UoJ7Ip8gAf8e', async () => [])).status, 410);
  for (const load of [async () => { throw new Error('offline'); }, async () => [{ id: 'pizza-1' }, { id: 'pizza-1' }]]) {
    const result = await run('/d/UoJ7Ip8gAf8e', load);
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('location'), null);
  }
});

test('actual worker uses only bounded public cached reads, preserves HEAD and cache isolation', async () => {
  const original = globalThis.fetch;
  let payload = JSON.stringify({ deals: await feed() });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://freefinder.at/deals.json');
    assert.equal(options.cf.cacheTtl, 180);
    assert.equal(options.redirect, 'error');
    return new Response(payload);
  };
  try {
    const result = await worker.fetch(request('/d/UoJ7Ip8gAf8e?r=ABC123', 'HEAD'));
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(await result.text(), '');
    for (const bad of ['invalid JSON', JSON.stringify({ deals: {} }), ' '.repeat(2 * 1024 * 1024 + 1)]) {
      payload = bad;
      assert.equal((await worker.fetch(request('/d/UoJ7Ip8gAf8e'))).status, 503);
    }
    assert.equal((await worker.fetch(request('/d/UoJ7Ip8gAf8e', 'POST'))).status, 405);
  } finally { globalThis.fetch = original; }
});
