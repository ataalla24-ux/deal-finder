import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'cheerio';
import { applyGuides } from './sync-deal-guides.mjs';
const deal = { id: 'a', title: 'Coffee', url: 'https://example.com/offer', approvedAt: '2026-10-01' };
const guide = { ...deal, sourceUrl: deal.url, slug: 'coffee', reviewUntil: '2026-10-15T00:00:00Z' };
const apply = (d = deal, g = guide, available = new Set(['coffee'])) => applyGuides([d], [g], available, Date.parse('2026-10-01'))[0];
assert.equal(apply().supplementaryGuideUrl, 'https://freefinder.at/blog/coffee.html');
assert.equal(apply().supplementaryGuideReviewUntil, guide.reviewUntil);
assert.equal(Object.hasOwn(apply(), 'guideUrl'), false);
assert.equal(Object.hasOwn(apply(), 'guideReviewUntil'), false);
assert.equal(apply().url, deal.url);
assert.equal(apply({ ...deal, approvedAt: null }).supplementaryGuideUrl, undefined);
assert.equal(apply({ ...deal, title: 'Different offer' }).supplementaryGuideUrl, undefined);
assert.equal(apply({ ...deal, url: 'https://example.com/other' }).supplementaryGuideUrl, undefined);
assert.equal(apply(deal, guide, new Set()).supplementaryGuideUrl, undefined);
assert.equal(apply(deal, { ...guide, slug: '../outside' }).supplementaryGuideUrl, undefined);

const guideFields = ['guideUrl', 'guideReviewUntil', 'supplementaryGuideUrl', 'supplementaryGuideReviewUntil'];
const withStaleGuides = current => ({ ...current,
  guideUrl: 'https://freefinder.at/blog/old-primary.html', guideReviewUntil: '2099-01-01',
  supplementaryGuideUrl: 'https://freefinder.at/blog/old-supplement.html', supplementaryGuideReviewUntil: '2099-01-01',
});
const stale = withStaleGuides(deal);
assert.deepEqual(apply(stale), apply(), 'A valid review replaces stale supplementary fields and removes legacy primary fields');
assert.equal(stale.guideUrl, 'https://freefinder.at/blog/old-primary.html', 'Input must not be mutated');
for (const [current, row, available] of [
  [stale, { ...guide, reviewUntil: '2026-09-01' }, new Set(['coffee'])],
  [stale, guide, new Set()],
  [{ ...stale, approvedAt: null }, guide, new Set(['coffee'])],
  [{ ...stale, title: 'Different offer' }, guide, new Set(['coffee'])],
  [{ ...stale, url: 'https://example.com/other' }, guide, new Set(['coffee'])],
  [stale, { ...guide, slug: '../outside' }, new Set(['../outside'])],
]) {
  const result = apply(current, row, available);
  for (const key of guideFields) assert.equal(Object.hasOwn(result, key), false, `${key} must not survive an invalid or unavailable review`);
  assert.equal(result.url, current.url);
}
for (const key of guideFields) {
  assert.equal(Object.hasOwn(applyGuides([stale], [], new Set())[0], key), false, 'Removed reviews clear every guide field');
}

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const reviews = JSON.parse(read('reviews/deal-guides.json')).guides;
const feed = JSON.parse(read('docs/deals.json'));
const expected = [
  ['g2-a1l0vd', '10 \u20ac Rabatt ab 50 \u20ac Konsumation', 'https://www.gutschein.at/ganesha-restaurant/10-euro-gutschein', 'ganesha-10-euro-gutschein-50-euro-wien'],
  ['g2-3cen4', '10 \u20ac Rabatt ab 40 \u20ac Konsumation', 'https://www.heurigen.gutschein.at/hitomi-wok-und-grill/10-euro-gutschein', 'hitomi-francis-10-euro-gutschein-wien'],
  ['g2-sfff19', '1+1 Schnitzel gratis mit Gutschein', 'https://www.gutschein.at/alleewirt/1-plus-1-schnitzel-gratis', 'alleewirt-schnitzel-1plus1-wien'],
  ['g2-171hxsm', '1+1 Fahrt mit dem Riesenrad', 'https://www.gutschein.at/11-fahrt-gratis-16', 'wiener-riesenrad-1plus1-gutschein'],
  ['g2-1gbztrr', '1+1 Crispy Chicken gratis mit Gutschein', 'https://www.gutschein.at/burger-king/1-plus-1-crispy-chicken-gratis', 'burger-king-crispy-chicken-1plus1-wien'],
];
const reviewUntil = '2026-11-02T22:49:00Z';
const reviewNow = Date.parse('2026-10-27T00:00:00Z');
const available = new Set();
for (const [id, title, sourceUrl, slug] of expected) {
  const rows = reviews.filter(row => row.id === id);
  assert.deepEqual(rows, [{ id, title, sourceUrl, slug, reviewedAt: '2026-10-26', reviewUntil }]);
  const current = feed.deals.find(row => row.id === id);
  assert.ok(current?.approvedAt, `${id} must already be manually approved`);
  assert.equal(current.title, title);
  assert.equal(current.url, sourceUrl);
  const html = read(`docs/blog/${slug}.html`);
  const $ = load(html);
  assert.equal($('[data-guide-reviewed="2026-10-26"]').length, 1);
  assert.equal($(`a[href="${sourceUrl}"]`).length > 0, true, 'Exact issuer URL must be an actual link, not a hidden verification string');
  assert.ok(html.includes(`data-guide-reviewed="${rows[0].reviewedAt}"`) && html.includes(sourceUrl), 'Must satisfy the existing publication guard');
  const text = $('.article-body').text();
  assert.match(text, /Authentifizierung/);
  assert.match(text, /gr\u00fcne Best\u00e4tigung.*Personal vorzeigen/);
  assert.match(text, /Code.*(?:Personal|Original-Gutscheinseite)/);
  assert.match(text, /kein \u00f6ffentlicher Rabattcode/);
  assert.doesNotMatch(text, /Angebot und Bedingungen bei IKEA|undefined/);
  available.add(slug);
  const drifted = applyGuides([{ ...current, title: `${title} changed` }], rows, available, reviewNow)[0];
  assert.equal(drifted.supplementaryGuideUrl, undefined);
  assert.equal(applyGuides([{ ...current, url: `${sourceUrl}?changed=1` }], rows, available, reviewNow)[0].supplementaryGuideUrl, undefined);
  assert.equal(applyGuides([{ ...current, approvedAt: null }], rows, available, reviewNow)[0].supplementaryGuideUrl, undefined);
}

const original = structuredClone({ feed, reviews });
const attached = applyGuides(feed.deals, reviews, available, reviewNow);
const noGuideFields = ({ guideUrl, guideReviewUntil, supplementaryGuideUrl, supplementaryGuideReviewUntil, ...rest }) => rest;
assert.deepEqual(attached.map(noGuideFields), feed.deals.map(noGuideFields), 'Optional guides cannot replace source URLs, redemptions, or any deal fields');
assert.equal(attached.filter(row => row.supplementaryGuideUrl).length, 5);
assert.equal(attached.some(row => Object.hasOwn(row, 'guideUrl') || Object.hasOwn(row, 'guideReviewUntil')), false);
for (const [id, , sourceUrl, slug] of expected) {
  const current = attached.find(row => row.id === id);
  assert.equal(current.supplementaryGuideUrl, `https://freefinder.at/blog/${slug}.html`);
  assert.equal(current.supplementaryGuideReviewUntil, reviewUntil);
  assert.equal(current.url, sourceUrl);
  assert.equal(current.guideUrl || current.url, sourceUrl, 'Legacy guide-first clients must still choose the issuer URL');
}
assert.deepEqual(applyGuides(attached, reviews, available, reviewNow), attached);
assert.equal(applyGuides(attached, reviews, new Set(), reviewNow).filter(row => row.supplementaryGuideUrl).length, 0, 'No attachment before pages pass the publication guard');
assert.equal(applyGuides(attached, reviews, available, Date.parse(reviewUntil)).filter(row => row.supplementaryGuideUrl).length, 0, 'Review expiry is exclusive');
const ikea = reviews.filter(row => !expected.some(([id]) => row.id === id));
assert.deepEqual(ikea.map(row => [row.id, row.reviewedAt, row.reviewUntil]), [
  ['b1-s5vhj5', '2026-10-01', '2026-10-15T00:00:00Z'],
  ['g2-5ntng7', '2026-10-01', '2026-10-15T00:00:00Z'],
]);
assert.equal(applyGuides(feed.deals, reviews, new Set(reviews.map(row => row.slug)), reviewNow)
  .filter(row => ikea.some(entry => entry.id === row.id) && row.supplementaryGuideUrl).length, 0, 'Expired IKEA reviews must not revive');
assert.deepEqual({ feed, reviews }, original, 'Offline attachment does not mutate the manifest or live snapshot');

// Run only a copied writer in a disposable fixture; every fetch is a local stub.
const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'supplementary-deal-guides-')));
try {
  for (const directory of ['scripts', 'docs', 'reviews']) fs.mkdirSync(path.join(fixture, directory));
  const scriptPath = path.join(fixture, 'scripts/sync-deal-guides.mjs');
  fs.copyFileSync(new URL('scripts/sync-deal-guides.mjs', root), scriptPath);
  const registryPath = path.join(fixture, 'reviews/deal-guides.json');
  const registry = read('reviews/deal-guides.json');
  fs.writeFileSync(registryPath, registry);
  const fixtureDeals = feed.deals.map(withStaleGuides);
  const matched = feed.deals.find(row => row.id === expected[0][0]);
  const input = { ...feed, deals: fixtureDeals.concat({ ...withStaleGuides(matched), id: 'unreviewed-ikea-fixture', brand: 'IKEA' }) };
  const feedPath = path.join(fixture, 'docs/deals.json');
  const pages = expected.map(([, , , slug]) => [
    `https://freefinder.at/blog/${slug}.html`, read(`docs/blog/${slug}.html`),
  ]);
  for (const mode of ['verified', 'unavailable', 'marker-mismatch', 'source-mismatch']) {
    fs.writeFileSync(feedPath, JSON.stringify(input));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { pathToFileURL } from 'node:url';
      Date.now = () => ${reviewNow};
      const pages = new Map(${JSON.stringify(pages)});
      let requests = 0;
      globalThis.fetch = async url => {
        assert.ok(pages.has(url), 'Only current guide fixtures may be requested');
        requests++;
        let html = pages.get(url);
        if (${JSON.stringify(mode)} === 'marker-mismatch') html = html.replace('data-guide-reviewed="2026-10-26"', 'data-guide-reviewed="2026-10-25"');
        if (${JSON.stringify(mode)} === 'source-mismatch') html = html.replaceAll('https://www.', 'https://changed.example/');
        return { ok: ${mode !== 'unavailable'}, text: async () => html };
      };
      await import(pathToFileURL(process.argv[1]).href);
      assert.equal(requests, 5, 'Expired IKEA reviews must not be requested');
    `, scriptPath], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, `${mode}: ${result.stdout}\n${result.stderr}`);
    const written = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
    const expectedDeals = applyGuides(input.deals, reviews, mode === 'verified' ? available : new Set(), reviewNow);
    assert.deepEqual(written, { ...input, deals: expectedDeals });
    assert.equal(written.deals.some(row => Object.hasOwn(row, 'guideUrl') || Object.hasOwn(row, 'guideReviewUntil')), false);
    assert.deepEqual(written.deals.map(noGuideFields), input.deals.map(noGuideFields));
    const candidates = JSON.parse(fs.readFileSync(path.join(fixture, 'reviews/deal-guide-candidates.json'), 'utf8')).candidates;
    assert.ok(candidates.some(row => row.id === 'unreviewed-ikea-fixture'));
    assert.equal(fs.readFileSync(registryPath, 'utf8'), registry);
    assert.match(result.stdout, new RegExp(`Verified supplementary deal guides: ${mode === 'verified' ? 5 : 0};`));
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log('Deal guide routing regression checks passed');
