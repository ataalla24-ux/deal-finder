import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load } from 'cheerio';
import { prepareServerBlog } from './server-blog-draft.mjs';
import { publishServerBlog, unfinishedBlogVerification } from './server-blog-publish.mjs';
import { applyBlogPublication, applyBlogIndexPublication, articleBaseFingerprint, blogIndexCardFingerprint, blogDigest, validateBlogRevision, inspectBlogRevision } from './server-blog-content.mjs';
import { verifyPublicBlog, sameBlogReceipt } from './verify-server-blog-public.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const now = new Date('2026-11-07T07:30:00Z'), slug = 'nordsee-wrap-1plus1-wien';
const url = 'https://www.drei.at/de/dreiplus/ersparnisse/nordsee/';
// Fixtures exercise publication mechanics; a stub is not editorial quality evidence.
const source = 'Bei NORDSEE gibt es einen Wrap gratis zum gekauften Wrap. Nur mit Drei Plus Gutschein, bis 3. Januar 2027. Teilnehmende Restaurants und Produktauswahl beachten. Der Gutschein ist vor der Bestellung vorzuzeigen.';
const draft = { useful: true, mode: 'revision', title: 'Wrap dazu mit dem Drei Plus Gutschein',
  meta: 'Ein gekaufter Wrap, ein weiterer gratis: den Drei Plus Gutschein und die teilnehmenden NORDSEE Restaurants vor der Einloesung pruefen.',
  intro: 'Mit dem Drei Plus Gutschein gibt es bei NORDSEE einen Wrap zum gekauften Wrap dazu. Die Bedingungen und teilnehmenden Restaurants sind entscheidend.',
  sections: ['Was der Vorteil umfasst', 'Den Gutschein vorbereiten', 'Die Einloesung planen'].map(heading => ({ heading,
    text: Array(10).fill('Der Gutschein ist erforderlich; die teilnehmenden Restaurants und die Produktauswahl beachten.').join(' '), quote: source.slice(0, 69) })),
  faqs: [
    { question: 'Ist ein Gutschein erforderlich?', answer: 'Ja, fuer den Vorteil wird der Drei Plus Gutschein benoetigt.', quote: 'Nur mit Drei Plus Gutschein' },
    { question: 'Sind alle Restaurants eingeschlossen?', answer: 'Die Teilnahme ist beschraenkt; die teilnehmenden Restaurants beachten.', quote: 'Teilnehmende Restaurants und Produktauswahl beachten.' },
  ],
};
const review = { supported: true, substantive: true, restrictionsComplete: true, baseConsistent: true };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-blog-revision-'));
  for (const dir of ['docs/blog', 'reviews', 'scripts']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const files = ['scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs', 'scripts/blog-visuals.mjs',
    'scripts/blog-photo-catalog.mjs', 'scripts/deal-photos.mjs', 'scripts/server-blog-content.mjs',
    'scripts/blog-backfill-20261018.mjs', 'scripts/blog-backfill-20261030.mjs', 'scripts/blog-backfill-20261105.mjs',
    'reviews/deal-guides.json', 'docs/blog/index.html', 'docs/sitemap.xml'];
  for (const file of files) fs.copyFileSync(path.join(repo, file), path.join(root, file));
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const generate = (at = now) => {
    const run = spawnSync(process.execPath, ['scripts/generate-topic-guides.mjs', slug], { cwd: root, encoding: 'utf8', env: { ...process.env, SEO_NOW: at.toISOString() } });
    assert.equal(run.status, 0, run.stderr);
  };
  generate();
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const write = (file, value) => fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const html = read(`docs/blog/${slug}.html`), index = read('docs/blog/index.html');
  const validUntil = load(html)('main').attr('data-deal-expires').slice(0, 10);
  write('docs/deals.json', { deals: [{ id: 'fixture', title: 'Wrap mit Drei Plus Gutschein', brand: 'NORDSEE', url, category: 'essen', validUntil }] });
  write('reviews/blog-coverage-2026-10-30.json', { entries: [{ id: 'fixture', slug, status: 'covered' }] });
  write('reviews/maintenance-source-evidence.json', { entries: { [url]: { url, brand: 'NORDSEE', status: 'verified', text: source, hash: blogDigest(source), checkedAt: now.toISOString(), parserVersion: 3 } } });
  return { root, read, write, html, index, validUntil, generate, json: file => JSON.parse(read(file)), close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

async function prepare(f, verdict = review) {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-fixture-only';
  let calls = 0;
  try {
    const report = await prepareServerBlog({ root: f.root, now, mode: 'revision', allowAi: true, request: async (_, options) => {
      const body = JSON.parse(options.body), schema = body.response_format.json_schema.schema;
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), 'strict schema requires every declared field');
      assert.match(body.messages[0].content, /COMPLETE/);
      calls++;
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(calls === 1 ? draft : verdict) } }] }) };
    } });
    assert.equal(calls, 2, JSON.stringify(report));
    return report;
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; }
}

test('complete revision replaces stale copy and FAQ, retains identity/media/expiry and replays actual generator twice', async () => {
  const f = fixture();
  try {
    const report = await prepare(f);
    const result = publishServerBlog({ root: f.root, now, report });
    assert.equal(result.status, 'prepared-for-publication');
    const html = f.read(`docs/blog/${slug}.html`), $ = load(html), before = load(f.html);
    assert.equal($('.article-hero h1').text(), draft.title);
    assert.equal($('meta[name="description"]').attr('content'), draft.meta);
    assert.equal($('.hero-copy').text(), draft.intro);
    assert.equal($('[data-server-blog-update],.article-note').length, 0, 'old additions and quick facts removed');
    assert.equal($('article > picture').toString(), before('article > picture').toString());
    assert.equal($('.related-links').toString(), before('.related-links').toString());
    assert.equal($('main').attr('data-deal-expires'), before('main').attr('data-deal-expires'));
    assert.equal($('#faq').next('h3').text(), draft.faqs[0].question);
    const schemas = JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
    assert.equal(schemas.find(row => row['@type'] === 'Article').datePublished, JSON.parse(before('script[type="application/ld+json"]').text())['@graph'][0].datePublished);
    assert.equal(schemas.find(row => row['@type'] === 'FAQPage').mainEntity[0].acceptedAnswer.text, draft.faqs[0].answer);
    assert.equal(schemas.find(row => row['@type'] === 'Article').headline, draft.title);
    const publication = f.json('reviews/server-blog-publications.json').entries[slug];
    assert.equal(applyBlogPublication(html, publication, slug), html);
    assert.equal(applyBlogPublication(f.html, publication, slug), html);
    assert.equal(applyBlogIndexPublication(f.index, publication, slug), f.read('docs/blog/index.html'));
    f.generate(); f.generate();
    assert.equal(f.read(`docs/blog/${slug}.html`), html);
    assert.equal(blogIndexCardFingerprint(f.read('docs/blog/index.html'), slug), result.indexCardHash);
    assert.throws(() => applyBlogPublication(html.replace(draft.intro, 'Manuell korrigiert'), publication, slug), /base-changed/);
    assert.throws(() => applyBlogIndexPublication(f.read('docs/blog/index.html').replace(draft.meta, 'Manuell korrigiert'), publication, slug), /index-base-changed/);
    assert.throws(() => publishServerBlog({ root: f.root, now, report }), /daily-result/);
    assert.equal(f.json('reviews/server-blog-publication-batch.json').outputs.includes('docs/blog/index.html'), true);
    f.write('docs/blog/index.html', f.read('docs/blog/index.html').replace(draft.meta, 'Manuelle Indexkorrektur'));
    const run = spawnSync(process.execPath, ['scripts/generate-topic-guides.mjs', slug], { cwd: f.root, encoding: 'utf8', env: { ...process.env, SEO_NOW: now.toISOString() } });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /index-base-changed/);
    assert.match(f.read('docs/blog/index.html'), /Manuelle Indexkorrektur/);
    assert.equal(f.read(`docs/blog/${slug}.html`), html, 'no article write before rejecting manual index changes');
  } finally { f.close(); }
});

test('verified revision archives on its existing expiry and remains stable on repeated future rebuilds', async () => {
  const f = fixture();
  try {
    publishServerBlog({ root: f.root, now, report: await prepare(f) });
    const after = new Date('2027-01-05T12:00:00Z');
    f.generate(after);
    const archived = f.read(`docs/blog/${slug}.html`), $ = load(archived);
    assert.equal($('body').hasClass('deal-is-expired'), true);
    assert.match($('.eyebrow').first().text(), /Archiv/);
    const publication = f.json('reviews/server-blog-publications.json').entries[slug];
    assert.equal(articleBaseFingerprint(archived), publication.archiveFingerprint);
    f.generate(after);
    assert.equal(f.read(`docs/blog/${slug}.html`), archived);
  } finally { f.close(); }
});

test('an index edit during independent review rejects the whole local batch', async () => {
  const f = fixture();
  try {
    const report = await prepare(f);
    f.write('docs/blog/index.html', f.index + '<!-- concurrent manual edit -->');
    assert.throws(() => publishServerBlog({ root: f.root, now, report }), /index-changed-after-review/);
    assert.equal(f.read(`docs/blog/${slug}.html`), f.html);
    assert.equal(fs.existsSync(path.join(f.root, 'reviews/server-blog-publications.json')), false);
  } finally { f.close(); }
});

test('independent veto rejects stale retained expiry without any article, index or publication writes', async () => {
  const f = fixture();
  try {
    const result = publishServerBlog({ root: f.root, now, report: await prepare(f, { ...review, baseConsistent: false }) });
    assert.equal(result.status, 'independent-review-rejected');
    assert.equal(f.read(`docs/blog/${slug}.html`), f.html);
    assert.equal(f.read('docs/blog/index.html'), f.index);
    assert.equal(fs.existsSync(path.join(f.root, 'reviews/server-blog-publications.json')), false);
  } finally { f.close(); }
});

test('unsupported dates and index are held before model calls; existing daily result blocks another attempt', async () => {
  const f = fixture();
  try {
    assert.equal(inspectBlogRevision(f.html, slug, ''), 'article-campaign-expiry-needs-review');
    f.write('docs/blog/index.html', '<html></html>');
    const held = await prepareServerBlog({ root: f.root, now, mode: 'revision', apply: false });
    assert.equal(held.heldGuides[0].reason, 'unsupported-blog-index-card');
    assert.equal(held.modelCalls, 0);
    f.write('docs/blog/index.html', f.index);
    f.write('reviews/2026-11-07-daily-blog.json', { existing: true });
    const result = await prepareServerBlog({ root: f.root, now, mode: 'revision', allowAi: true, request: () => { throw Error('no request allowed'); } });
    assert.equal(result.status, 'existing-editorial-result-needs-no-second-draft');
    assert.equal(result.modelCalls, 0);
  } finally { f.close(); }
});

test('all reader-facing fields reject unsupported numbers, links, markup, duplicate sections and copied source text', () => {
  const candidate = { source: { officialText: source } };
  assert.equal(validateBlogRevision(draft, candidate), true);
  for (const patch of [
    { meta: draft.meta + ' 99 Euro' }, { intro: draft.intro + ' <script>' },
    { faqs: [{ ...draft.faqs[0], answer: 'Gratis fuer alle unter https://evil.invalid' }, draft.faqs[1]] },
    { faqs: [draft.faqs[0], draft.faqs[0]] },
    { sections: draft.sections.map(row => ({ ...row, heading: 'Gleicher Titel' })) },
    { intro: source },
  ]) assert.equal(validateBlogRevision({ ...draft, ...patch }, candidate), false, JSON.stringify(patch));
});

test('public proof requires article, its sitemap entry AND the new index card; unrelated cards may change', async () => {
  const f = fixture();
  try {
    const result = publishServerBlog({ root: f.root, now, report: await prepare(f) });
    const request = async url => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(f.read('docs' + new URL(url).pathname)) });
    const good = await verifyPublicBlog({ root: f.root, request, attempts: 1 });
    assert.equal(good.published, true);
    assert.equal(good.checks.find(row => row.file === 'docs/blog/index.html').cardHash, result.indexCardHash);
    const newIndex = f.read('docs/blog/index.html');
    f.write('docs/blog/index.html', f.index);
    assert.equal((await verifyPublicBlog({ root: f.root, request, attempts: 1 })).published, false);
    f.write('reviews/server-blog-public-receipt.json', { ...good, checks: good.checks.filter(row => row.file !== 'docs/blog/index.html') });
    assert.equal(unfinishedBlogVerification(f.root).resumingPublicVerification, true);
    f.write('docs/blog/index.html', newIndex.replace('</body>', '<!-- another ordinary update --></body>'));
    const newer = await verifyPublicBlog({ root: f.root, request, attempts: 1 });
    assert.equal(newer.published, true);
    assert.equal(newer.checks.find(row => row.file === 'docs/blog/index.html').exact, false);
    f.write('reviews/server-blog-public-receipt.json', newer);
    assert.equal(unfinishedBlogVerification(f.root), null);
    assert.equal(sameBlogReceipt(good, newer), true, 'unrelated Pages changes cannot cause a receipt commit loop');
    assert.equal(sameBlogReceipt(good, { ...newer, checkedAt: '2027-01-01T00:00:00Z' }), true);
    assert.equal(sameBlogReceipt(good, { ...newer, published: false }), false);
  } finally { f.close(); }
});

test('publication proof runs only after successful trusted Pages, never in the editorial writer', () => {
  const writer = fs.readFileSync(path.join(repo, '.github/workflows/server-blog.yml'), 'utf8');
  const proof = fs.readFileSync(path.join(repo, '.github/workflows/server-blog-publication.yml'), 'utf8');
  assert.ok(!writer.includes('run: node scripts/verify-server-blog-public.mjs'));
  assert.match(proof, /workflow_run:\s+workflows: \['pages-build-deployment'\]\s+branches: \[main\]\s+types: \[completed\]/);
  assert.match(proof, /conclusion == 'success'/);
  assert.match(proof, /head_repository.full_name == github.repository/);
  assert.match(proof, /head_branch == 'main'/);
  assert.match(proof, /group: deal-state-writer\s+cancel-in-progress: false\s+queue: max/);
  assert.match(proof, /ref: main/);
  assert.match(proof, /--files reviews\/server-blog-public-receipt.json/);
  assert.ok(!proof.includes('secrets.'));
  assert.ok(!proof.includes('server-blog-publish.mjs'));
});

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

for (const partial of [false, true]) test(`real atomic revision committer ${partial ? 'rejects missing index' : 'publishes complete batch'}`, async () => {
  const f = fixture(), remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-blog-revision-remote-'));
  try {
    git(remote, 'init', '--bare', '--initial-branch=main');
    git(f.root, 'init', '--initial-branch=main'); git(f.root, 'add', 'docs', 'reviews', 'scripts'); git(f.root, 'commit', '-m', 'baseline');
    git(f.root, 'remote', 'add', 'origin', remote); git(f.root, 'push', '-u', 'origin', 'main');
    const before = git(remote, 'rev-parse', 'main');
    publishServerBlog({ root: f.root, now, report: await prepare(f) });
    let files = f.json('reviews/server-blog-publication-batch.json').outputs;
    if (partial) files = files.filter(file => file !== 'docs/blog/index.html');
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/commit-generated.mjs'), '--message', 'fixture revision', '--branch', 'main', '--skip-conflicts', '--replace-conflicts', '--files', ...files], { cwd: f.root, encoding: 'utf8' });
    if (partial) {
      assert.notEqual(result.status, 0); assert.match(result.stderr, /partial batch omits docs\/blog\/index.html/);
      assert.equal(git(remote, 'rev-parse', 'main'), before);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(git(remote, 'show', 'main:docs/blog/index.html'), f.read('docs/blog/index.html').trim());
    }
  } finally { f.close(); fs.rmSync(remote, { recursive: true, force: true }); }
});
