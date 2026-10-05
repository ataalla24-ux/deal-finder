import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../../docs/business-promo.js', import.meta.url), 'utf8');
function page() {
  const elements = new Map();
  const responses = [];
  const requests = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', hidden: true, checked: false,
      handlers: {}, classList: { toggle() {} }, focus() {}, reportValidity: () => true,
      addEventListener(name, action) { this.handlers[name] = action; } });
    return elements.get(id);
  };
  runInNewContext(source, {
    document: { getElementById: element }, location: { hash: '' }, history: {}, URLSearchParams,
    sessionStorage: { getItem: () => null, setItem() {} }, crypto: webcrypto, TextEncoder, AbortSignal,
    FormData: class { *[Symbol.iterator]() { yield ['restaurantName', 'Test']; yield ['dealTitle', 'Test offer']; } },
    fetch: async (url, request) => {
      requests.push({ url, body: JSON.parse(request.body) });
      return { ok: true, json: async () => responses.shift() };
    },
  });
  return { element, responses, requests, submit: id => element(id).handlers.submit({ preventDefault() {} }) };
}

for (const [id, days, name] of [['starter', 1, 'Starter Boost'], ['spotlight', 3, 'Spotlight Boost'], ['city', 8, 'City Push']]) {
  test(`web check and receipt use ${id} with ${days} days, never default to starter`, async () => {
    const p = page();
    p.element('code').value = `${id}GRATIS`;
    p.responses.push({ ok: true, amount: 0, currency: 'EUR', package: { id, durationDays: days } });
    await p.submit('code-form');
    assert.equal(p.element('editor').hidden, false);
    assert.equal(p.element('offer-name').textContent, name);
    assert.equal(p.element('offer-period').textContent, `${days * 24} Stunden ab Aktivierung`);
    p.element('consent').checked = true;
    const campaign = { id: 'test', packageId: id, amount: 0, currency: 'EUR', startsAt: 1000, endsAt: 1000 + days * 86400000, restaurantName: 'Test', dealTitle: 'Test offer' };
    p.responses.push({ ok: true, campaign: { ...campaign, endsAt: campaign.endsAt + 1 } });
    await p.submit('ad-form');
    assert.equal(p.element('success').hidden, true);
    assert.match(p.element('ad-status').textContent, /nicht bestätigt/);
    p.responses.push({ ok: true, campaign });
    await p.submit('ad-form');
    assert.equal(p.element('success').hidden, false);
    assert.equal(p.requests[1].body.requestId, p.requests[2].body.requestId);
  });
}

test('web rejects unknown/nonfree/mismatched offers and clears consent on code change', async () => {
  const p = page();
  p.element('code').value = 'CITYGRATIS';
  for (const extra of [{ amount: 1 }, { currency: 'USD' }, { package: { id: 'city', durationDays: 1 } }, { package: { id: 'unknown', durationDays: 1 } }]) {
    p.responses.push({ ok: true, amount: 0, currency: 'EUR', package: { id: 'city', durationDays: 8 }, ...extra });
    await p.submit('code-form');
    assert.equal(p.element('editor').hidden, true);
  }
  p.responses.push({ ok: true, amount: 0, currency: 'EUR', package: { id: 'city', durationDays: 8 } });
  await p.submit('code-form');
  p.element('consent').checked = true;
  p.element('code').value = 'SPOTLIGHTGRATIS';
  p.element('code').handlers.input();
  assert.equal(p.element('editor').hidden, true);
  assert.equal(p.element('consent').checked, false);
  const before = p.requests.length;
  await p.submit('ad-form');
  assert.equal(p.requests.length, before);
});
