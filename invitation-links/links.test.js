import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import worker, { invitationCode, invitationToken } from './public/_worker.js';

const code = 'RM-0123456789ABCDEF01234567';
const token = 'ASNFZ4mrze8BI0Vn';
const request = (path, method = 'GET') => worker.fetch(new Request('https://www.freefinder.at' + path, { method }));

test('compact IDs retain all bits, including leading zeros and URL-safe characters', () => {
  assert.equal(invitationToken(code), token);
  assert.equal(invitationCode(token), code);
  for (const hex of ['0'.repeat(24), 'F'.repeat(24), 'FB'.repeat(12),
    ...Array.from({ length: 1000 }, () => randomBytes(12).toString('hex').toUpperCase())]) {
    const original = 'RM-' + hex;
    const compact = invitationToken(original);
    assert.match(compact, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(invitationCode(compact), original);
  }
});

test('invalid, padded, truncated or ambiguous tokens are rejected', () => {
  for (const value of [null, '', token + '=', token + '\n', token.slice(1), 'a'.repeat(17), '/'.repeat(16), 'ä'.repeat(16)]) {
    assert.equal(invitationCode(value), null);
  }
  for (const value of [null, '', code + '\n', code.toLowerCase(), code.slice(1), 'FF-' + '0'.repeat(24)]) {
    assert.equal(invitationToken(value), null);
  }
});

test('GET and HEAD resolve to the original trusted invitation; HEAD sends no body', async () => {
  for (const method of ['GET', 'HEAD']) {
    const result = request('/i/' + token, method);
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('location'), 'https://freefinder.at/invite.html?invite=' + code);
    assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(await result.text(), '');
  }
});

test('deal context is retained without permitting open redirects or duplicate IDs', () => {
  const result = request('/i/' + token + '?deal=pizza-1');
  const target = new URL(result.headers.get('location'));
  assert.equal(target.hostname, 'freefinder.at');
  assert.equal(target.searchParams.get('invite'), code);
  assert.equal(target.searchParams.get('deal'), 'pizza-1');
  for (const suffix of ['?deal=', '?deal=a&deal=b', '?invite=' + code, '?next=https://evil.test',
    '?deal=https://evil.test', '?deal=a%0A', '?deal=' + 'a'.repeat(161), '/', '%2f', '/other']) {
    assert.equal(request('/i/' + token + suffix).status, 404, suffix);
  }
  assert.equal(request('/i/').status, 404);
});

test('all other www paths and queries retain the existing apex redirect', () => {
  for (const path of ['/', '/privacy.html', '/support.html', '/invite.html?invite=' + code,
    '/deal.html?deal=pizza-1', '/.well-known/apple-app-site-association', '/.well-known/assetlinks.json',
    '//evil.test/path', '/blog/?q=a%26b']) {
    const result = request(path);
    assert.equal(result.status, 301);
    assert.equal(result.headers.get('location'), 'https://freefinder.at' + path);
    assert.equal(new URL(result.headers.get('location')).host, 'freefinder.at');
  }
});

test('no POST, reward creation, downstream requests or storage bindings', () => {
  assert.equal(request('/i/' + token, 'POST').status, 405);
  assert.equal(request('/_link-health').status, 200);
  assert.equal(request('/_link-health').headers.get('location'), null);
});
