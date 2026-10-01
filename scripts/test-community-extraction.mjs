import assert from 'node:assert/strict';
import { applyExtraction, extractCommunityDeal, extractionKey } from '../scraper/community-extraction.js';
const base = { id: 'community:a', submissionId: 'a', originSource: 'community-submission',
  title: 'Community-Deal prüfen', brand: 'Community Fund', description: '', distance: 'Wien', expires: '', url: 'https://www.instagram.com/p/test/' };
const text = 'Box 16: Chicken Döner 3,50 Euro. Nur am 04.10.2026, Testgasse 9, 1160 Wien. Nur mit Gutschein.';
const field = value => ({ value, quote: text });
const result = { title: field('Chicken Döner für 3,50 Euro'), brand: field('Box 16'),
  description: field(text), address: field('Testgasse 9, 1160 Wien'), validity: field('Nur am 04.10.2026') };
const next = applyExtraction(base, result, text);
assert.equal(next.title, result.title.value);
assert.equal(next.brand, 'Box 16');
assert.equal(next.address, result.address.value);
assert.equal(next.expiresOriginal, 'Nur am 04.10.2026');
assert.ok(next.validOn.startsWith('2026-10-04'));
assert.equal(applyExtraction(base, { validity: { value: 'diese Woche', quote: 'nur diese Woche' } }, 'nur diese Woche').expires, '');
assert.equal(next.communityExtraction.requiresReview, true);
assert.equal(applyExtraction(base, { title: field('Döner 1 Euro') }, text).title, base.title);
assert.equal(applyExtraction(base, { brand: field('Thalia') }, text).brand, base.brand);
assert.equal(applyExtraction(base, result, 'Unrelated evidence').title, base.title);
assert.ok(applyExtraction(base, {}, '').missingFields.includes('Genaue Adresse/Standorte'));
assert.notEqual(extractionKey({ title: 'a' }), extractionKey({ title: 'b' }));
let calls = 0;
const extracted = await extractCommunityDeal({ ...base, description: text }, base, {
  apiKey: 'test', crawlerKey: '', fetch: async () => { calls++; return {
    ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }) }; },
});
assert.equal(calls, 1);
assert.equal(extracted.title, result.title.value);
const failed = await extractCommunityDeal(base, base, { apiKey: 'test', crawlerKey: '', fetch: async () => { throw new Error('offline'); } });
assert.equal(failed.id, base.id);
assert.equal(failed.communityExtraction.status, 'needs-review');
console.log('Community extraction regression checks passed');
