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
import { blogDigest, applyBlogPublication, articleBaseFingerprint, validateBlogDraft } from './server-blog-content.mjs';
import { verifyPublicBlog } from './verify-server-blog-public.mjs';
import { viennaBlogSlot } from './vienna-blog-slot.mjs';
import { refreshMaintenanceEvidence } from './refresh-maintenance-evidence.mjs';

const now = new Date('2026-11-07T07:30:00Z');
const slug = 'example-wien';
const url = 'https://www.drei.at/de/dreiplus/ersparnisse/cleverfit/';
const text = 'Neue Mitglieder erhalten 10 Prozent Rabatt. Nur teilnehmende Studios. Code per SMS anfordern.';
const deal = { id: 'example', title: '10 % fuer neue Mitglieder', brand: 'clever fit', url, category: 'freizeit' };
const draft = { useful: true, title: 'Einloesung sinnvoll vorbereiten', sections: Array.from({ length: 3 }, (_, i) => ({
  heading: `Pruefpunkt ${i + 1}`, text: Array(90).fill('Beispiel').join(' '), quote: text,
})) };
const independentReview = { supported: true, substantive: true, restrictionsComplete: true, baseConsistent: true };
const original = `<!DOCTYPE html><html><head><title>Original</title><link rel="canonical" href="https://freefinder.at/blog/${slug}.html"><meta name="description" content="Verified guide"><script type="application/ld+json">${JSON.stringify({ '@graph': [
  { '@type': 'Article', datePublished: '2026-10-20', dateModified: '2026-11-01' },
  { '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Wer?', acceptedAnswer: { text: 'Neue Mitglieder.' } }] },
] })}</script></head><body><main data-deal-page data-deal-expires="2026-12-31"><header class="article-hero"><h1>Original</h1><p class="hero-copy">Original intro</p><div class="article-meta"><span>Aktualisiert am 1. November 2026</span><span>3 Minuten Lesezeit</span></div></header><article class="article-body"><picture><img src="/photo.jpg" alt="Original photo"></picture><h2 id="angebot">Angebot</h2><p>Nur fuer neue Mitglieder. Code per SMS anfordern.</p><h2 id="quelle">Quelle</h2><p><a href="${url}">Originalquelle</a></p><h2 id="faq">Fragen</h2><p>Original FAQ</p></article></main></body></html>`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-blog-publish-'));
  for (const dir of ['docs/blog', 'reviews', 'scripts']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const write = (file, value) => fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  write('docs/deals.json', { deals: [deal] });
  write('reviews/blog-coverage-2026-10-30.json', { entries: [{ id: deal.id, status: 'covered', slug }] });
  write('reviews/maintenance-source-evidence.json', { entries: { [url]: {
    url, brand: deal.brand, status: 'verified', text, hash: blogDigest(text), checkedAt: now.toISOString(),
    parserVersion: 3, nextAttemptAt: new Date(+now + 86400000).toISOString(),
  } } });
  write(`docs/blog/${slug}.html`, original);
  write('docs/blog/index.html', '<a href="example-wien.html">Original card</a>');
  write('docs/sitemap.xml', `<urlset><url><loc>https://freefinder.at/blog/${slug}.html</loc><lastmod>2026-11-01</lastmod></url><url><loc>https://freefinder.at/other.html</loc><lastmod>2026-09-01</lastmod></url></urlset>`);
  return { root, write, read: file => fs.readFileSync(path.join(root, file), 'utf8'), json: file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')), close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

async function prepare(f, review = independentReview) {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fixture-not-a-real-key';
  let calls = 0;
  try {
    const report = await prepareServerBlog({ root: f.root, now, allowAi: true, request: async () => ({ ok: true,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(++calls === 1 ? draft : review) } }] }),
    }) });
    assert.equal(calls, 2);
    return report;
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; }
}

test('complete reviewed update preserves existing offer, image, FAQ, canonical, published date and index', async () => {
  const f = fixture();
  try {
    const report = await prepare(f);
    const result = publishServerBlog({ root: f.root, now, report });
    assert.equal(result.status, 'prepared-for-publication');
    assert.equal(result.published, false);
    const html = f.read(`docs/blog/${slug}.html`), $ = load(html);
    assert.equal(articleBaseFingerprint(html), articleBaseFingerprint(original));
    assert.equal($('[data-server-blog-update]').length, 1);
    assert.equal($('[data-server-blog-update] h3').length, 3);
    assert.equal($('main').attr('data-deal-expires'), '2026-12-31');
    assert.match($('.article-meta').text(), /7\. November 2026/);
    const schema = JSON.parse($('script').text())['@graph'];
    assert.equal(schema[0].datePublished, '2026-10-20');
    assert.equal(schema[0].dateModified, '2026-11-07');
    assert.equal(schema[1].mainEntity[0].acceptedAnswer.text, 'Neue Mitglieder.');
    assert.equal(f.read('docs/blog/index.html'), '<a href="example-wien.html">Original card</a>');
    assert.match(f.read('docs/sitemap.xml'), /other.html<\/loc><lastmod>2026-09-01/);
    const publication = f.json('reviews/server-blog-publications.json').entries[slug];
    assert.equal(applyBlogPublication(html, publication, slug), html, 'idempotent replay');
    assert.equal(applyBlogPublication(original, publication, slug), html, 'survives complete generator regeneration');
    const later = { ...publication, history: [publication.draft], draft: { ...publication.draft, title: 'Eine weitere gepruefte Ergaenzung' } };
    const expanded = load(applyBlogPublication(html, later, slug));
    assert.equal(expanded('[data-server-blog-update] h3').length, 6, 'later additions do not erase previous useful sections');
    assert.match(expanded('[data-server-blog-update]').text(), /Einloesung sinnvoll vorbereiten/);
    assert.throws(() => applyBlogPublication(original.replace('Nur fuer neue', 'Auch bestehende'), publication, slug), /base-changed/);
    assert.throws(() => publishServerBlog({ root: f.root, now, report }), /daily-result-already/);
    const read = async url => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(f.read('docs/' + new URL(url).pathname.slice(1))) });
    assert.equal((await verifyPublicBlog({ root: f.root, request: read, attempts: 1 })).published, true);
    const pending = unfinishedBlogVerification(f.root);
    assert.equal(pending.modelCalls, 0);
    assert.equal(pending.resumingPublicVerification, true);
    f.write('docs/sitemap.xml', f.read('docs/sitemap.xml').replace('2026-09-01', '2026-11-07'));
    const receipt = await verifyPublicBlog({ root: f.root, request: read, attempts: 1 });
    assert.equal(receipt.published, true, 'unrelated newer sitemap entry must not invalidate the verified article');
    assert.equal(receipt.checks.find(row => row.file === 'docs/sitemap.xml').exact, false);
    assert.equal(receipt.checks.find(row => row.file === 'docs/sitemap.xml').articleEntryVerified, true);
    f.write('reviews/server-blog-public-receipt.json', receipt);
    assert.equal(unfinishedBlogVerification(f.root), null);
    f.write('docs/sitemap.xml', f.read('docs/sitemap.xml').replace('2026-11-07', '2026-11-06'));
    assert.equal((await verifyPublicBlog({ root: f.root, request: read, attempts: 1 })).published, false, 'own sitemap date must match');
    assert.equal((await verifyPublicBlog({ root: f.root, request: async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('old') }), attempts: 1 })).published, false);
  } finally { f.close(); }
});

test('rejects unconfirmed old-article conditions and long verbatim source copying', async () => {
  const f = fixture();
  try {
    const report = await prepare(f, { ...independentReview, baseConsistent: false });
    assert.equal(report.status, 'independent-review-rejected');
    publishServerBlog({ root: f.root, now, report });
    assert.equal(f.read(`docs/blog/${slug}.html`), original);
    assert.equal(validateBlogDraft(draft, { source: { officialText: text + ' ' + draft.sections[0].text } }), false);
  } finally { f.close(); }
});

test('unsupported legacy guide is held before any model or budget request', async () => {
  const f = fixture();
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fixture-not-a-real-key';
  try {
    f.write(`docs/blog/${slug}.html`, original.replace('id="quelle"', 'id="legacy-source"'));
    const report = await prepareServerBlog({ root: f.root, now, allowAi: true, request: async () => { throw Error('must not be called'); } });
    assert.equal(report.modelCalls, 0);
    assert.equal(report.eligible.length, 0);
    assert.equal(report.heldGuides[0].reason, 'unsupported-guide-layout');
    assert.equal(f.json('reviews/server-blog-state.json').attempts.length, 0);
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; f.close(); }
});

for (const change of ['article', 'source', 'feed', 'review', 'day']) test(`publication rejects changed ${change} before any article write`, async () => {
  const f = fixture();
  try {
    const report = await prepare(f);
    if (change === 'article') f.write(`docs/blog/${slug}.html`, original + '<!-- manual change -->');
    if (change === 'source') f.write('reviews/maintenance-source-evidence.json', { entries: {} });
    if (change === 'feed') f.write('docs/deals.json', { deals: [{ ...deal, title: 'Changed terms' }] });
    if (change === 'review') delete report.draft.independentReview;
    const before = f.read(`docs/blog/${slug}.html`);
    assert.throws(() => publishServerBlog({ root: f.root, now: change === 'day' ? new Date(+now + 86400000) : now, report }));
    assert.equal(f.read(`docs/blog/${slug}.html`), before);
    assert.equal(fs.existsSync(path.join(f.root, 'reviews/server-blog-publications.json')), false);
  } finally { f.close(); }
});

test('blog uses one Vienna morning slot in both time zones and tolerates bounded queue delay', () => {
  assert.equal(viennaBlogSlot({ now, event: 'schedule', schedule: '30 7 * * *' }).run, true);
  assert.equal(viennaBlogSlot({ now, event: 'schedule', schedule: '30 6 * * *' }).run, false);
  assert.equal(viennaBlogSlot({ now: new Date('2026-07-07T06:30:00Z'), event: 'schedule', schedule: '30 6 * * *' }).run, true);
  assert.equal(viennaBlogSlot({ now: new Date('2026-11-07T10:30:00Z'), event: 'schedule', schedule: '30 7 * * *' }).run, true);
  assert.equal(viennaBlogSlot({ now: new Date('2026-11-07T12:30:00Z'), event: 'schedule', schedule: '30 7 * * *' }).run, false);
});

test('today editorial result prevents fresh source requests', async () => {
  const f = fixture();
  try {
    f.write('reviews/2026-11-07-daily-blog.json', { status: 'existing' });
    const result = await refreshMaintenanceEvidence({ root: f.root, now, requireSameDay: true, fetchPage: async () => { throw Error('must not run'); } });
    assert.equal(result.report.sourceRequests, 0);
  } finally { f.close(); }
});

test('new-day source refresh keeps failed-source cooldowns and existing four-page bound', async () => {
  const f = fixture();
  try {
    const cache = f.json('reviews/maintenance-source-evidence.json');
    cache.entries[url].checkedAt = '2026-11-06T15:30:00Z';
    cache.entries[url].nextAttemptAt = '2026-11-07T15:30:00Z';
    f.write('reviews/maintenance-source-evidence.json', cache);
    let calls = 0;
    const fetchPage = async () => { calls++; throw Error('fixture failure'); };
    await refreshMaintenanceEvidence({ root: f.root, now, requireSameDay: true, fetchPage });
    assert.equal(calls, 1, 'successful old-day evidence may be refreshed');
    await refreshMaintenanceEvidence({ root: f.root, now, requireSameDay: true, fetchPage });
    assert.equal(calls, 1, 'failure cooldown is never bypassed for a blog');
  } finally { f.close(); }
});

test('real topic generator retains the reviewed addition and new sitemap date on two rebuilds', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-blog-generator-'));
  try {
    for (const dir of ['docs/blog', 'reviews', 'scripts']) fs.mkdirSync(path.join(temp, dir), { recursive: true });
    const files = ['scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs', 'scripts/blog-visuals.mjs',
      'scripts/blog-photo-catalog.mjs', 'scripts/deal-photos.mjs', 'scripts/server-blog-content.mjs',
      'scripts/blog-backfill-20261018.mjs', 'scripts/blog-backfill-20261030.mjs', 'scripts/blog-backfill-20261105.mjs',
      'reviews/deal-guides.json', 'docs/blog/index.html', 'docs/sitemap.xml'];
    for (const file of files) fs.copyFileSync(path.join(root, file), path.join(temp, file));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
    const guide = 'nordsee-wrap-1plus1-wien';
    const run = () => {
      const result = spawnSync(process.execPath, [path.join(temp, 'scripts/generate-topic-guides.mjs'), guide], { cwd: temp, encoding: 'utf8', env: { ...process.env, SEO_NOW: now.toISOString() } });
      assert.equal(result.status, 0, result.stderr);
    };
    run();
    const file = path.join(temp, `docs/blog/${guide}.html`);
    const base = fs.readFileSync(file, 'utf8');
    const publication = { day: '2026-11-07', slug: guide, fingerprint: 'fixture-only', baseFingerprint: articleBaseFingerprint(base), sourceText: text, draft };
    const expected = applyBlogPublication(base, publication, guide);
    fs.writeFileSync(path.join(temp, 'reviews/server-blog-publications.json'), JSON.stringify({ version: 1, entries: { [guide]: publication } }));
    run(); run();
    assert.equal(fs.readFileSync(file, 'utf8'), expected);
    const xml = load(fs.readFileSync(path.join(temp, 'docs/sitemap.xml'), 'utf8'), { xml: true });
    assert.equal(xml('url').filter((_, node) => xml(node).find('loc').text().endsWith(`/${guide}.html`)).find('lastmod').text(), '2026-11-07');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

for (const mode of ['full', 'partial', 'remote-source', 'remote-day']) test(`real generated committer: ${mode} publication batch`, async () => {
  const f = fixture();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-blog-remote-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-blog-other-'));
  try {
    git(remote, 'init', '--bare', '--initial-branch=main');
    git(f.root, 'init', '--initial-branch=main'); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'baseline');
    git(f.root, 'remote', 'add', 'origin', remote); git(f.root, 'push', '-u', 'origin', 'main');
    const before = git(remote, 'rev-parse', 'main');
    const report = await prepare(f);
    publishServerBlog({ root: f.root, now, report });
    if (mode.startsWith('remote-')) {
      git(other, 'clone', remote, '.');
      const file = mode === 'remote-source' ? 'docs/deals.json' : 'reviews/2026-11-07-daily-blog.json';
      fs.writeFileSync(path.join(other, file), '{}\n'); git(other, 'add', file); git(other, 'commit', '-m', 'concurrent change'); git(other, 'push', 'origin', 'main');
    }
    const remoteBeforeAttempt = git(remote, 'rev-parse', 'main');
    let files = f.json('reviews/server-blog-publication-batch.json').outputs;
    if (mode === 'partial') files = files.filter(file => file !== 'docs/sitemap.xml');
    const script = fileURLToPath(new URL('./commit-generated.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--message', 'verified blog', '--branch', 'main', '--skip-conflicts', '--replace-conflicts', '--files', ...files], { cwd: f.root, encoding: 'utf8' });
    if (mode === 'full') {
      assert.equal(result.status, 0, result.stderr);
      assert.notEqual(git(remote, 'rev-parse', 'main'), before);
      assert.equal(git(remote, 'show', `main:docs/blog/${slug}.html`), f.read(`docs/blog/${slug}.html`).trim());
    } else {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Blog input consistency check failed/);
      assert.equal(git(remote, 'rev-parse', 'main'), remoteBeforeAttempt);
    }
  } finally { f.close(); fs.rmSync(remote, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); }
});
