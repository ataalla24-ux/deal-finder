import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { load } from 'cheerio';
import { novemberGuides } from './blog-backfill-20261105.mjs';
import { blogVisual } from './blog-visuals.mjs';
import { polishHtml } from './polish-website.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = load(read('docs/blog/index.html'));
const sitemap = load(read('docs/sitemap.xml'), { xml: true });
const review = JSON.parse(read('reviews/blog-coverage-2026-10-30.json'));
assert.equal(novemberGuides.length, 11);
assert.equal(new Set(novemberGuides.flatMap(g => g.ids)).size, 11);
for (const guide of novemberGuides) {
  const file = `blog/${guide.slug}.html`;
  const html = read(`docs/${file}`);
  const q = load(html);
  assert.equal(q('h1').text(), guide.title);
  assert.ok(q('title').text().length <= 75);
  assert.ok(q('meta[name="description"]').attr('content').length <= 165);
  assert.equal(q('link[rel="canonical"]').attr('href'), `https://freefinder.at/${file}`);
  assert.equal(index(`.post-card h2 a[href="${guide.slug}.html"]`).length, 1);
  assert.equal(sitemap('loc').filter((_, e) => sitemap(e).text() === `https://freefinder.at/${file}`).length, 1);
  assert.equal(q('img.article-image').attr('src'), blogVisual(guide.slug).src);
  assert.match(q('img.article-image').attr('alt'), /^Symbolfoto:/);
  assert.equal(q('main').attr('data-deal-expires'), guide.expires || '');
  const graph = JSON.parse(q('script[type="application/ld+json"]').text())['@graph'];
  const article = graph.find(e => e['@type'] === 'Article');
  assert.equal(article.datePublished, '2026-11-05');
  assert.equal(article.dateModified, '2026-11-05');
  for (const question of graph.find(e => e['@type'] === 'FAQPage').mainEntity) {
    assert.ok(q('.article-body').text().includes(question.name));
    assert.ok(q('.article-body').text().includes(question.acceptedAnswer.text));
  }
  assert.ok(q('#quelle').next('p').find('a[data-track="deal_outbound"]').length >= 1);
  assert.ok(q('.article-body').text().split(/\s+/).length >= 300);
  for (const id of guide.ids) assert.equal(review.entries.find(e => e.id === id)?.slug, guide.slug);
  if (guide.expires) {
    const expired = load(polishHtml(html, file, Date.parse(guide.expires) + 1000));
    assert.match(expired('title').text(), /Archiv/);
    assert.equal(expired('[data-deal-status-banner][hidden]').length, 0);
  }
}
const body = slug => load(read(`docs/blog/${slug}.html`))('.article-body').text();
assert.match(body('noodle-king-wien-20-prozent-vorteilsclub'), /vor der ersten Bestellung/i);
assert.equal(novemberGuides.find(g => g.slug.startsWith('noodle-king')).expires, undefined);
assert.match(body('ikea-westbahnhof-10-euro-gutschein-restaurant-wien'), /mindestens 50 Euro/);
assert.match(body('der-mann-snacks-26-prozent-wien-november'), /Feiertage/);
assert.match(body('flixbus-drei-10-prozent-rabatt-wien'), /Wertkarte/);
assert.match(body('padelzone-wien-rabatt-drei'), /Montag bis Freitag bis 16 Uhr, inklusive Feiertagen/);
assert.match(body('abby-smashburger-990-wien-rochusmarkt'), /nicht zwei/);
const updated = ['dahab-doener-1plus1-wien', 'gratis-heissgetraenk-ikea-wien', 'foodsharing-wien-gratis-lebensmittel', 'foodora-60-prozent-rabatt-genuss-wien'];
const published = ['2026-09-23', '2026-09-01', '2026-10-18', '2026-09-28'];
const modified = ['2026-11-10', '2026-11-05', '2026-11-05', '2026-11-20'];
for (const [i, slug] of updated.entries()) {
  const q = load(read(`docs/blog/${slug}.html`));
  const article = JSON.parse(q('script[type="application/ld+json"]').text())['@graph'].find(e => e['@type'] === 'Article');
  assert.equal(article.datePublished, published[i]);
  assert.equal(article.dateModified, modified[i]);
  assert.equal(index(`.post-card h2 a[href="${slug}.html"]`).length, 1);
}
assert.match(body(updated[0]), /3. bis 30. November/);
assert.match(body(updated[0]), /Wagramer Straße 126/);
assert.match(body(updated[1]), /Westbahnhof.*ausgenommen/);
assert.match(body(updated[2]), /15 zugängliche institutionelle beziehungsweise geschäftliche Wiener Fairteiler/);
const foodora = load(read(`docs/blog/${updated[3]}.html`));
assert.match(foodora('title').text(), /foodora Gutschein Österreich.*GENUSS/);
assert.match(foodora('.hero-copy').text(), /keinen festen Rabatt/);
assert.equal(foodora('#rabatt + .article-note time').attr('datetime'), modified[3]);
assert.match(foodora('#rabatt + .article-note + p').text(), /60 Prozent.*historischer Wert/);
assert.equal(index('.post-card').filter((_, e) => index(e).find('h2 a').attr('href') === `${updated[0]}.html`).attr('data-archive'), 'false');

const fixture = fs.mkdtempSync(path.join(root, 'tmp', 'blog-november-'));
try {
  for (const file of ['scripts/original-deal-photo.mjs', 'scripts/deal-photo-contract.mjs', 'scripts/server-blog-content.mjs', 'scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs', 'scripts/blog-visuals.mjs', 'scripts/blog-photo-catalog.mjs', 'scripts/deal-photos.mjs', 'scripts/blog-backfill-20261018.mjs', 'scripts/blog-backfill-20261030.mjs', 'scripts/blog-backfill-20261105.mjs', 'scripts/blog-backfill-20261120.mjs', 'reviews/deal-guides.json', 'docs/blog/index.html', 'docs/sitemap.xml']) {
    fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(fixture, 'docs/deals.json'), 'unchanged-feed-sentinel');
  const slugs = [...novemberGuides.map(g => g.slug), ...updated];
  const comparisonTime = Math.max(...slugs.map(slug => {
    const expiry = load(read(`docs/blog/${slug}.html`))('main').attr('data-deal-expires');
    return expiry ? Date.parse(expiry) : Date.parse('2026-11-05T22:00:00+01:00');
  })) + 1000;
  assert.ok(Number.isFinite(comparisonTime), 'Curated guide dates must be valid');
  const env = { ...process.env, SEO_NOW: new Date(comparisonTime).toISOString() };
  for (let pass = 0; pass < 2; pass++) {
    execFileSync(process.execPath, [path.join(fixture, 'scripts/generate-topic-guides.mjs'), ...slugs], { env });
    for (const slug of slugs) {
      const file = `blog/${slug}.html`;
      assert.equal(fs.readFileSync(path.join(fixture, 'docs', file), 'utf8'),
        polishHtml(read(`docs/${file}`), file, comparisonTime), file);
    }
    assert.equal(fs.readFileSync(path.join(fixture, 'docs/deals.json'), 'utf8'), 'unchanged-feed-sentinel');
    assert.equal(fs.readFileSync(path.join(fixture, 'reviews/deal-guides.json'), 'utf8'), read('reviews/deal-guides.json'));
  }
  // A later archive publication is a real modification, not a new source check.
  // Preserve it across template replay, while rejecting future/invalid dates.
  const sitemapFile = path.join(fixture, 'docs/sitemap.xml');
  const maintenanceCases = [
    ['der-mann-snacks-26-prozent-wien-november', '2026-11-23', '2026-11-23'],
    ['baeckerei-schwarz-baguette-3plus1-wien', '2030-01-01', '2026-11-05'],
    ['abby-smashburger-990-wien-rochusmarkt', '2026-02-30', '2026-11-05'],
    ['hot-hofer-10-euro-gutschein-rufnummernmitnahme', '2026-10-01', '2026-11-05'],
  ];
  const maintenanceXml = load(fs.readFileSync(sitemapFile, 'utf8'), { xml: true });
  for (const [slug, existing] of maintenanceCases) maintenanceXml('loc')
    .filter((_, node) => maintenanceXml(node).text() === `https://freefinder.at/blog/${slug}.html`).next('lastmod').text(existing);
  fs.writeFileSync(sitemapFile, maintenanceXml.xml());
  const runMaintenance = () => execFileSync(process.execPath,
    [path.join(fixture, 'scripts/generate-topic-guides.mjs'), ...maintenanceCases.map(([slug]) => slug)],
    { env: { ...process.env, SEO_NOW: '2026-11-22T23:30:00Z' } });
  runMaintenance();
  const result = load(fs.readFileSync(sitemapFile, 'utf8'), { xml: true });
  for (const [slug, , expected] of maintenanceCases) assert.equal(result('loc')
    .filter((_, node) => result(node).text() === `https://freefinder.at/blog/${slug}.html`).next('lastmod').text(), expected, slug);
  const maintained = fs.readFileSync(sitemapFile, 'utf8');
  runMaintenance();
  assert.equal(fs.readFileSync(sitemapFile, 'utf8'), maintained, 'Lastmod replay is idempotent');
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
console.log('November blog checks passed: 11 new guides, 4 updates, dates, evidence, expiry, photos and repeatable isolated regeneration.');
