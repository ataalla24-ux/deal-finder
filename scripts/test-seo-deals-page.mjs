import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(ROOT, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const fixtureRoot = fs.mkdtempSync(path.join(tempRoot, 'seo-deals-page-'));
fs.mkdirSync(path.join(fixtureRoot, 'scripts'));
fs.mkdirSync(path.join(fixtureRoot, 'docs'));
fs.copyFileSync(path.join(ROOT, 'scripts/generate-seo-deals-page.mjs'), path.join(fixtureRoot, 'scripts/generate-seo-deals-page.mjs'));

function deal(id, fields = {}) {
  return { id, brand: 'Wien Anbieter', title: 'Geprüftes Angebot in Wien', url: `https://example.com/${id}`,
    category: 'essen', type: 'rabatt', expires: '2026-10-31T23:59:59.999Z', ...fields };
}

function generate(deals, now = '2026-10-05T10:00:00Z') {
  const feedText = JSON.stringify({ lastUpdated: '2026-10-05T09:00:00Z', deals });
  const feedPath = path.join(fixtureRoot, 'docs/deals.json');
  fs.writeFileSync(feedPath, feedText);
  fs.writeFileSync(path.join(fixtureRoot, 'docs/sitemap.xml'), '<urlset><url><loc>https://freefinder.at/angebote-wien-heute.html</loc><lastmod>2026-09-01</lastmod></url></urlset>');
  const result = spawnSync(process.execPath, [path.join(fixtureRoot, 'scripts/generate-seo-deals-page.mjs')], {
    env: { ...process.env, SEO_NOW: now }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(feedPath, 'utf8'), feedText, 'SEO generation must never mutate its feed');
  const html = fs.readFileSync(path.join(fixtureRoot, 'docs/angebote-wien-heute.html'), 'utf8');
  const ids = [...html.matchAll(/<article class="live-deal-card" id="deal-([^"]+)"/g)].map(match => match[1]);
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  assert.equal(schema['@graph'][0].mainEntity.numberOfItems, ids.length, 'Schema and visible card counts must agree');
  return { html, ids };
}

try {
  const current = generate([
    deal('flight-normalized', { category: 'reisen' }),
    deal('structured-airfare', { category: 'reisen', flight: { outbound: { departureDate: '2026-11-05' } } }),
    deal('legacy-flight', { category: 'flights' }),
    deal('local-transit', { category: 'reisen', title: 'Rabatt für die Wiener Bahn' }),
    deal('earlier-end', { validUntil: '2026-10-07' }),
    deal('past-end', { validUntil: '2026-10-04' }),
    deal('current-single', { validOn: '2026-10-05', expires: '2026-10-01T23:59:59.999Z' }),
    deal('past-single', { validOn: '2026-10-04' }),
    deal('future-single', { validOn: '2026-10-15' }),
    deal('future-start', { validFrom: '2026-10-06', validUntil: '2026-10-31' }),
    deal('current-start', { validFrom: '2026-10-05', validUntil: '2026-10-07' }),
    deal('calendar-after-timestamp', { validUntil: '2026-10-05', expires: '2026-10-04T23:59:59Z' }),
    deal('fallback-active'),
    deal('fallback-past', { expires: '2026-10-05T09:00:00Z' }),
    deal('invalid-day', { validOn: '2026-02-30' }),
    deal('invalid-month', { validUntil: '2026-13-01' }),
    deal('invalid-start', { validFrom: 'tomorrow' }),
    deal('invalid-range', { validFrom: '2026-10-04', validUntil: '2026-10-03' }),
    deal('invalid-expiry', { expires: 'unknown' }),
    deal('iso-calendar-end', { validUntil: '2026-10-07T23:59:59.999Z' }),
  ]);
  assert.deepEqual([...current.ids].sort(), ['local-transit', 'earlier-end', 'current-single', 'current-start',
    'calendar-after-timestamp', 'fallback-active', 'iso-calendar-end'].sort());
  assert.match(current.html, /Gültig bis 07\. Oktober 2026/, 'Explicit validUntil must supply the visible date');
  assert.match(current.html, /Gültig am 05\. Oktober 2026/, 'A one-day deal must be labeled as a day, not an end');

  const midnightDeals = [deal('last-day', { validUntil: '2026-10-05' }),
    deal('single-day', { validOn: '2026-10-05' }),
    deal('timestamp-fallback', { expires: '2026-10-05T22:00:30Z' })];
  assert.equal(generate(midnightDeals, '2026-10-05T21:59:59Z').ids.length, 3, 'Calendar deals last through 23:59 in Vienna');
  assert.deepEqual(generate(midnightDeals, '2026-10-05T22:00:00Z').ids, ['timestamp-fallback'], 'Vienna midnight ends calendar deals before UTC midnight');
  assert.deepEqual(generate(midnightDeals, '2026-10-05T22:00:31Z').ids, [], 'Timestamp-only fallback retains its exact expiration');
  assert.deepEqual(generate([deal('leap-day', { validOn: '2028-02-29' })], '2028-02-29T10:00:00Z').ids, ['leap-day']);
  assert.deepEqual(generate([deal('not-leap-day', { validOn: '2026-02-29' })], '2026-03-01T10:00:00Z').ids, []);
  console.log('SEO deals page regression tests passed (flight scope, explicit dates, Vienna midnight, malformed dates, schema and feed preservation).');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
