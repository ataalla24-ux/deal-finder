import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareServerBlog, blogCandidates } from './server-blog-draft.mjs';
import { maintenanceEvidenceFor } from './refresh-maintenance-evidence.mjs';
import { polishHtml } from './polish-website.mjs';
import { applyBlogPublication, applyBlogIndexPublication, blogIndexCardFingerprint, articleBaseFingerprint, updateBlogSitemap, validateBlogDraft, blogDigest, blogDay } from './server-blog-content.mjs';

const read = (root, file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const write = (root, file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');

export function unfinishedBlogVerification(root) {
  const report = read(root, 'reviews/server-blog-report.json', {});
  if (report.status !== 'prepared-for-publication') return null;
  const receipt = read(root, 'reviews/server-blog-public-receipt.json', {});
  if (receipt.published && receipt.checks?.some(row => row.file === report.articlePath && row.exact && row.actual === report.articleHash)
    && (!report.indexCardHash || receipt.checks?.some(row => row.file === 'docs/blog/index.html' && row.verified && row.cardHash === report.indexCardHash))) return null;
  return { ...report, modelCalls: 0, publicationModelCalls: report.publicationModelCalls ?? report.modelCalls,
    resumingPublicVerification: true, note: 'Resume the existing publication receipt before generating another update. No additional model calls.' };
}

export function publishServerBlog({ root = process.cwd(), now = new Date(), report } = {}) {
  if (report?.status !== 'verified-draft-awaiting-publication-pipeline') return report;
  const draft = report.draft, day = blogDay(now);
  const review = draft?.independentReview;
  if (report.day !== day || !review || !['supported', 'substantive', 'restrictionsComplete', 'baseConsistent'].every(key => review[key] === true)) throw Error('blog-independent-review-required');
  const dailyFile = `reviews/${day}-daily-blog.json`;
  if (fs.existsSync(path.join(root, dailyFile))) throw Error('blog-daily-result-already-exists');
  const deals = read(root, 'docs/deals.json', {}).deals || [];
  const evidence = maintenanceEvidenceFor(deals, read(root, 'reviews/maintenance-source-evidence.json', {}), now);
  const candidate = blogCandidates(deals, read(root, 'reviews/blog-coverage-2026-10-30.json', {}), evidence, now)
    .find(row => row.id === draft.id && row.slug === draft.slug && row.fingerprint === draft.fingerprint);
  if (!candidate || candidate.source.contentHash !== draft.sourceHash || candidate.url !== draft.sourceUrl
    || !validateBlogDraft(draft, candidate)) throw Error('blog-evidence-changed-or-stale');
  const articleFile = `docs/blog/${candidate.slug}.html`;
  const original = fs.readFileSync(path.join(root, articleFile), 'utf8');
  if (blogDigest(original) !== draft.articleHash) throw Error('blog-article-changed-after-review');
  const publications = read(root, 'reviews/server-blog-publications.json', { version: 1, entries: {} });
  const previous = publications.entries[candidate.slug];
  const revision = draft.mode === 'revision';
  if (previous?.kind === 'revision' && !revision) throw Error('blog-revision-cannot-be-downgraded');
  const indexOriginal = revision ? fs.readFileSync(path.join(root, 'docs/blog/index.html'), 'utf8') : null;
  if (revision && blogDigest(indexOriginal) !== draft.indexHash) throw Error('blog-index-changed-after-review');
  const publication = {
    day, slug: candidate.slug, id: candidate.id, fingerprint: candidate.fingerprint,
    baseFingerprint: articleBaseFingerprint(original), sourceUrl: candidate.url,
    sourceText: candidate.source.officialText, sourceHash: candidate.source.contentHash,
    verifiedAt: candidate.source.verifiedAt, independentReview: review,
    history: previous ? [...(previous.history || []), previous.draft] : [],
    draft: { useful: true, title: draft.title, sections: draft.sections },
  };
  if (revision) {
    Object.assign(publication, {
      kind: 'revision', validUntil: candidate.validUntil,
      baseFingerprint: previous?.baseFingerprint || articleBaseFingerprint(original),
      inputFingerprint: articleBaseFingerprint(original),
      indexBaseFingerprint: previous?.indexBaseFingerprint || blogIndexCardFingerprint(indexOriginal, candidate.slug),
      indexInputFingerprint: blogIndexCardFingerprint(indexOriginal, candidate.slug),
      draft: { ...publication.draft, mode: 'revision', meta: draft.meta, intro: draft.intro, faqs: draft.faqs },
      history: [], superseded: previous || null,
    });
    // A manual edit since the preceding publication requires editorial re-baselining,
    // never a new permissive replay fingerprint copied from the modified HTML.
    if (previous) applyBlogPublication(original, previous, candidate.slug);
    if (previous?.kind === 'revision') applyBlogIndexPublication(indexOriginal, previous, candidate.slug);
  }
  const html = applyBlogPublication(original, publication, candidate.slug);
  const index = revision ? applyBlogIndexPublication(indexOriginal, publication, candidate.slug) : null;
  if (revision) {
    publication.resultFingerprint = articleBaseFingerprint(html);
    publication.indexResultFingerprint = blogIndexCardFingerprint(index, candidate.slug);
    if (candidate.validUntil) publication.archiveFingerprint = articleBaseFingerprint(polishHtml(html, `blog/${candidate.slug}.html`, Date.parse(`${candidate.validUntil}T23:59:59Z`) + 86400000));
  }
  const sitemap = updateBlogSitemap(fs.readFileSync(path.join(root, 'docs/sitemap.xml'), 'utf8'), candidate.slug, day);
  publications.entries[candidate.slug] = publication;
  const files = [articleFile, ...(revision ? ['docs/blog/index.html'] : []), 'docs/sitemap.xml', 'reviews/server-blog-publications.json', dailyFile,
    'reviews/server-blog-state.json', 'reviews/server-blog-report.json', 'reviews/server-blog-publication-batch.json'];
  const inputs = [...new Set([...files, 'docs/deals.json', 'docs/live-deal-edits.json', 'docs/blog/index.html',
    'reviews/maintenance-source-evidence.json', 'reviews/blog-coverage-2026-10-30.json',
    'scripts/server-blog-draft.mjs', 'scripts/server-blog-publish.mjs', 'scripts/server-blog-content.mjs',
    'scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs',
    'scripts/blog-visuals.mjs', 'scripts/blog-photo-catalog.mjs', 'scripts/deal-photos.mjs',
    'scripts/refresh-maintenance-evidence.mjs', 'scraper/ai-credit-budget.js',
    ...fs.readdirSync(path.join(root, 'scripts')).filter(file => file.startsWith('blog-backfill-') && file.endsWith('.mjs')).map(file => `scripts/${file}`)])];
  const state = read(root, 'reviews/server-blog-state.json', { version: 1, attempts: [] });
  const attempt = state.attempts.find(row => row.day === day && row.fingerprint === candidate.fingerprint);
  if (!attempt || (attempt.mode || 'addition') !== (draft.mode || 'addition') || attempt.outcome !== 'verified-draft-awaiting-publication-pipeline') throw Error('blog-matching-attempt-required');
  attempt.outcome = 'prepared-for-publication';
  const next = { ...report, status: 'prepared-for-publication', automaticPublicationEnabled: true,
    localBlogReplacementReady: false, publicVerified: false, published: false,
    articlePath: articleFile, articleHash: blogDigest(html), sitemapHash: blogDigest(sitemap),
    ...(revision ? { indexHash: blogDigest(index), indexCardHash: publication.indexResultFingerprint } : {}),
    note: `One existing guide ${revision ? 'fully revised including FAQ, metadata and index' : 'expanded'}. Public HTTP verification is still required; no new duplicate article.` };
  // Validate every output before writing. Git publishes this entire batch or none.
  fs.writeFileSync(path.join(root, articleFile), html);
  if (revision) fs.writeFileSync(path.join(root, 'docs/blog/index.html'), index);
  fs.writeFileSync(path.join(root, 'docs/sitemap.xml'), sitemap);
  write(root, 'reviews/server-blog-publications.json', publications);
  write(root, dailyFile, { day, origin: 'server-blog', action: revision ? 'substantive-existing-guide-revision' : 'substantive-existing-guide-update',
    slug: candidate.slug, id: candidate.id, sourceUrl: candidate.url, sourceHash: candidate.source.contentHash,
    independentReview: review, articleHash: next.articleHash, status: 'prepared-awaiting-public-proof', published: false });
  write(root, 'reviews/server-blog-state.json', state);
  write(root, 'reviews/server-blog-report.json', next);
  write(root, 'reviews/server-blog-publication-batch.json', { version: 1, kind: revision ? 'revision' : 'addition', day, slug: candidate.slug, outputs: files, inputs });
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd(), now = new Date();
  const report = unfinishedBlogVerification(root) || await prepareServerBlog({ root, now, mode: 'revision', allowAi: !process.argv.includes('--offline') });
  report.publicationPipelineEnabled = true;
  report.note = 'Existing-guide publication pipeline enabled. No duplicate article or public-success claim without a verified update and HTTP receipt. Local editorial fallback remains active during migration.';
  const result = publishServerBlog({ root, now, report });
  write(root, 'reviews/server-blog-report.json', result);
  console.log(JSON.stringify({ status: result.status, calls: result.modelCalls, publicVerified: false }));
}
