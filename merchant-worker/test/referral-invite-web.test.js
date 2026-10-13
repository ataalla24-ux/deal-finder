import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../../docs/invite.js', import.meta.url), 'utf8');
const code = 'RM-0123456789ABCDEF01234567';
async function page(search, agent, enabled = true) {
  const elements = new Map(['#status', '#invitation', '#store', '#open'].map(key => [key, { hidden: true }]));
  const requests = [], redirects = [];
  const storage = new Map();
  vm.runInNewContext(script, {
    URLSearchParams, AbortSignal, navigator: {userAgent: agent},
    document: {querySelector: key => elements.get(key)},
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    location: {search, replace: url => redirects.push(url)},
    fetch: async (url, options) => { requests.push({url, options}); return {ok:true, json:async () => ({enabled})}; },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { elements, requests, redirects };
}
test('invalid or duplicate invites never redirect or claim rewards', async () => {
  for (const query of ['?invite=FF-123456', `?invite=${code}&invite=${code}`, '']) {
    const result = await page(query, 'Android');
    assert.equal(result.requests.length, 0); assert.equal(result.redirects.length, 0);
  }
});
test('Android store URL carries the invite and deal as install referrer without clipboard or click credits', async () => {
  const result = await page(`?invite=${code}&deal=pizza-1`, 'Android');
  const url = new URL(result.redirects[0]);
  assert.equal(url.host, 'play.google.com');
  const ref = new URLSearchParams(url.searchParams.get('referrer'));
  assert.equal(ref.get('invite'), code); assert.equal(ref.get('deal'), 'pizza-1');
  assert.equal(result.requests.length, 1);
  assert.match(result.requests[0].url, /\/config$/);
  assert.equal(result.requests[0].options.credentials, 'omit');
});
test('iPhone goes to the official App Store; reopen link retains the invite without promising deferred attribution', async () => {
  const result = await page(`?invite=${code}`, 'iPhone');
  assert.equal(result.redirects[0], 'https://apps.apple.com/app/id6758958213');
  assert.equal(result.elements.get('#open').href, `freefinder://invite?invite=${code}`);
  const html = await readFile(new URL('../../docs/invite.html', import.meta.url), 'utf8');
  assert.match(html, /nach der Installation noch einmal/);
  assert.match(html, /verlängert es sich kostenpflichtig/);
});
test('disabled rollout offers no trial CTA and no store redirect', async () => {
  const result = await page(`?invite=${code}`, 'Android', false);
  assert.equal(result.elements.get('#invitation').hidden, true);
  assert.equal(result.redirects.length, 0);
});
test('invitation privacy and contact links resolve to existing pages', async () => {
  const html = await readFile(new URL('../../docs/invite.html', import.meta.url), 'utf8');
  for (const target of ['privacy.html', 'support.html']) {
    assert.ok(html.includes(`href="${target}"`));
    assert.match(await readFile(new URL(`../../docs/${target}`, import.meta.url), 'utf8'), /<html\b/i);
  }
});
