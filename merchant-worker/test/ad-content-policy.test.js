import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { adContentViolation } from '../src/ad-content-policy.js';

test('business policy blocks alcohol and explicit ads, not normal food or merchant names', () => {
  for (const title of ['Gratis Bier', '1+1 Aperol Spritz', 'Wein um 3 EUR', 'Cocktail Happy Hour', 'Vodka Shots', '🍺 gratis', 'Erotik Massage', 'Porno-Angebot', 'S\u200bex gratis']) {
    assert.ok(adContentViolation({ dealTitle: title }), title);
  }
  for (const title of ['Gratis Kebap', '2 Pizzen zum Preis von 1', 'Alkoholfreies Bier', 'Bier alkoholfrei', 'Cocktail 0,0%', 'Mocktail ohne Alkohol', 'Schnitzel vom Schwein']) {
    assert.equal(adContentViolation({ restaurantName: 'Weinbar Beispiel', address: 'Weingartenallee 2', dealTitle: title }), null, title);
  }
  assert.equal(adContentViolation({ dealTitle: 'Alkoholfreies Bier und ein Shot' }), 'alcohol');
  assert.equal(adContentViolation({ dealTitle: 'Pizza', description: 'Mit Wein gratis' }), 'alcohol');
  assert.equal(adContentViolation({ dealTitle: 'Massage', ctaURL: 'https://example.com/escort' }), 'obscene');
});

test('validation is read-only, rejects invalid inputs and never touches payment/storage', async () => {
  const env = {};
  const draft = { restaurantName: 'Test', dealTitle: 'Gratis Pizza', description: 'Vor Ort', address: 'Gasse 1, Wien', ctaURL: 'https://example.com' };
  const call = payload => worker.fetch(new Request('https://test/api/merchant/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }), env);
  assert.equal((await call(draft)).status, 200);
  assert.equal((await call({ ...draft, description: 'Bier gratis' })).status, 422);
  assert.equal((await call({})).status, 400);
  assert.equal((await call(null)).status, 400);
  assert.equal((await call({ ...draft, ctaURL: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call({ ...draft, ctaURL: 'https://user:pass@example.com' })).status, 400);
  assert.equal((await call({ ...draft, dealTitle: 'x'.repeat(111) })).status, 400);
  assert.equal((await call({ ...draft, offerValidityText: [] })).status, 400);
  assert.equal((await call({ ...draft, oldPrice: 'Bier gratis' })).status, 422);
  assert.equal((await call({ ...draft, description: 'x'.repeat(17000) })).status, 413);
});
