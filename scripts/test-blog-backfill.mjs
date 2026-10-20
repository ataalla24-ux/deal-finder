import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { load } from 'cheerio';
import { backfillGuides } from './blog-backfill-20261018.mjs';
import { polishHtml } from './polish-website.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const report = JSON.parse(read('reviews/blog-backfill-2026-10-18.json'));
const index = load(read('docs/blog/index.html'));
const sitemap = load(read('docs/sitemap.xml'), { xml: true });
const ids = [...Object.keys(report.existingCoverage), ...backfillGuides.flatMap(g => g.ids), ...report.deferred.map(d => d.id)];
assert.equal(new Set(ids).size, ids.length, 'Every reviewed feed entry has exactly one disposition');
assert.equal(ids.length, report.totalFeedEntries);
assert.equal(backfillGuides.filter(g => !g.updateExisting).length, report.newArticles);
assert.equal(backfillGuides.filter(g => !g.updateExisting).flatMap(g => g.ids).length, report.newArticleDealIds);
assert.equal(backfillGuides.filter(g => g.updateExisting).length, report.updatedArticles);
for (const slug of Object.values(report.existingCoverage)) assert.ok(fs.existsSync(path.join(root, 'docs/blog', `${slug}.html`)));

for (const guide of backfillGuides) {
  const filename = `blog/${guide.slug}.html`;
  const html = read(`docs/${filename}`);
  const $ = load(html);
  const canonical = `https://freefinder.at/${filename}`;
  assert.equal($('h1').text(), guide.title);
  assert.equal($('link[rel="canonical"]').attr('href'), canonical);
  assert.ok($('title').text().length <= 75);
  assert.ok($('meta[name="description"]').attr('content').length <= 165);
  assert.equal($('main').attr('data-deal-expires'), guide.expires || '');
  assert.equal(index(`.post-card h2 a[href="${guide.slug}.html"]`).length, 1);
  assert.equal(index(`.post-card h2 a[href="${guide.slug}.html"]`).closest('article').attr('data-topic'), guide.topic);
  assert.equal(sitemap('url').filter((_, node) => sitemap(node).find('loc').text() === canonical).length, 1);
  assert.equal($('img.article-image').attr('src'), `/assets/blog/covers/${guide.slug}.jpg`);
  assert.ok($('#quelle').next('p').find('a[data-track="deal_outbound"]').length === 1);
  assert.doesNotMatch(html, /current-ios|og-preview|PLACEHOLDER|TODO/);
  const graph = JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
  const article = graph.find(item => item['@type'] === 'Article');
  assert.equal(article.datePublished, guide.published);
  assert.equal(article.dateModified, '2026-10-18');
  for (const question of graph.find(item => item['@type'] === 'FAQPage').mainEntity) {
    assert.ok($('.article-body').text().includes(question.name));
    assert.ok($('.article-body').text().includes(question.acceptedAnswer.text));
  }
  assert.equal(polishHtml(html, filename, Date.parse('2026-10-18T12:00:00+02:00')), html);
  if (guide.expires) {
    const expired = load(polishHtml(html, filename, Date.parse(guide.expires) + 1000));
    assert.match(expired('title').text(), /Archiv/);
    assert.equal(expired('[data-deal-status-banner][hidden]').length, 0);
  }
}
assert.match(read('docs/blog/lieferando-neu12-12-euro-gutschein-wien.html'), /2026-12-31T00:00:00\+01:00/);
assert.match(read('docs/blog/nordsee-wrap-1plus1-wien.html'), /Thunfisch/);
assert.doesNotMatch(load(read('docs/blog/nordsee-wrap-1plus1-wien.html'))('title').text(), /Archiv|Garnelen/);
assert.match(read('docs/blog/therme-wien-drei-plus-mittwoch.html'), /25 Prozent Ersparnis zusammen/);

// Exercise exact regeneration twice in a disposable fixture, without touching the feed.
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(tempRoot, 'blog-backfill-test-'));
try {
  for (const name of ['scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs', 'scripts/blog-visuals.mjs', 'scripts/blog-backfill-20261018.mjs', 'reviews/deal-guides.json', 'docs/sitemap.xml', 'docs/blog/index.html']) {
    const destination = path.join(fixture, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, name), destination);
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(fixture, 'docs/blog/unrelated.html'), 'preserve');
  const args = [path.join(fixture, 'scripts/generate-topic-guides.mjs'), ...backfillGuides.map(g => g.slug)];
  // Normalize both sides after the last curated expiry: regeneration remains an
  // exact content comparison independent of the wall clock or stored archive state.
  const comparisonTime = Math.max(...backfillGuides.flatMap(guide =>
    [guide.published, guide.expires].filter(Boolean).map(value => Date.parse(value)))) + 1000;
  assert.ok(Number.isFinite(comparisonTime), 'Curated guide dates must be valid');
  const env = { ...process.env, SEO_NOW: new Date(comparisonTime).toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    execFileSync(process.execPath, args, { env });
    for (const guide of backfillGuides) assert.equal(fs.readFileSync(path.join(fixture, 'docs/blog', `${guide.slug}.html`), 'utf8'),
      polishHtml(read(`docs/blog/${guide.slug}.html`), `blog/${guide.slug}.html`, comparisonTime));
    assert.equal(fs.readFileSync(path.join(fixture, 'docs/blog/index.html'), 'utf8'),
      polishHtml(read('docs/blog/index.html'), 'blog/index.html', comparisonTime));
    assert.equal(fs.readFileSync(path.join(fixture, 'docs/sitemap.xml'), 'utf8'), read('docs/sitemap.xml'));
  }
  const invalid = spawnSync(process.execPath, [args[0], 'unknown-typo-slug'], { env });
  assert.notEqual(invalid.status, 0, 'Unknown slug must fail rather than silently publish nothing');
  assert.equal(fs.readFileSync(path.join(fixture, 'docs/blog/unrelated.html'), 'utf8'), 'preserve');
  assert.equal(fs.existsSync(path.join(fixture, 'docs/deals.json')), false);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(`Blog backfill checks passed: ${backfillGuides.length} articles, ${ids.length} feed dispositions, metadata, covers, expiry, topics, two idempotent regenerations and feed isolation.`);
