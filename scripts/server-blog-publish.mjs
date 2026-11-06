import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareServerBlog, blogCandidates } from './server-blog-draft.mjs';
import { maintenanceEvidenceFor } from './refresh-maintenance-evidence.mjs';
import { applyBlogPublication, articleBaseFingerprint, updateBlogSitemap, validateBlogDraft, blogDigest, blogDay } from './server-blog-content.mjs';

const read = (root, file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const write = (root, file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');

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
  const publication = {
    day, slug: candidate.slug, id: candidate.id, fingerprint: candidate.fingerprint,
    baseFingerprint: articleBaseFingerprint(original), sourceUrl: candidate.url,
    sourceText: candidate.source.officialText, sourceHash: candidate.source.contentHash,
    verifiedAt: candidate.source.verifiedAt, independentReview: review,
    history: previous ? [...(previous.history || []), previous.draft] : [],
    draft: { useful: true, title: draft.title, sections: draft.sections },
  };
  const html = applyBlogPublication(original, publication, candidate.slug);
  const sitemap = updateBlogSitemap(fs.readFileSync(path.join(root, 'docs/sitemap.xml'), 'utf8'), candidate.slug, day);
  publications.entries[candidate.slug] = publication;
  const files = [articleFile, 'docs/sitemap.xml', 'reviews/server-blog-publications.json', dailyFile,
    'reviews/server-blog-state.json', 'reviews/server-blog-report.json', 'reviews/server-blog-publication-batch.json'];
  const inputs = [...new Set([...files, 'docs/deals.json', 'docs/live-deal-edits.json', 'docs/blog/index.html',
    'reviews/maintenance-source-evidence.json', 'reviews/blog-coverage-2026-10-30.json',
    'scripts/server-blog-draft.mjs', 'scripts/server-blog-publish.mjs', 'scripts/server-blog-content.mjs',
    'scripts/generate-topic-guides.mjs', 'scripts/polish-website.mjs',
    'scripts/refresh-maintenance-evidence.mjs', 'scraper/ai-credit-budget.js',
    ...fs.readdirSync(path.join(root, 'scripts')).filter(file => file.startsWith('blog-backfill-') && file.endsWith('.mjs')).map(file => `scripts/${file}`)])];
  const state = read(root, 'reviews/server-blog-state.json', { version: 1, attempts: [] });
  const attempt = state.attempts.find(row => row.day === day && row.fingerprint === candidate.fingerprint);
  if (!attempt || attempt.outcome !== 'verified-draft-awaiting-publication-pipeline') throw Error('blog-matching-attempt-required');
  attempt.outcome = 'prepared-for-publication';
  const next = { ...report, status: 'prepared-for-publication', automaticPublicationEnabled: true,
    localBlogReplacementReady: false, publicVerified: false, published: false,
    articlePath: articleFile, articleHash: blogDigest(html), sitemapHash: blogDigest(sitemap),
    note: 'One existing guide expanded. Public HTTP byte verification is still required; no new duplicate article.' };
  // Validate every output before writing. Git publishes this entire batch or none.
  fs.writeFileSync(path.join(root, articleFile), html);
  fs.writeFileSync(path.join(root, 'docs/sitemap.xml'), sitemap);
  write(root, 'reviews/server-blog-publications.json', publications);
  write(root, dailyFile, { day, origin: 'server-blog', action: 'substantive-existing-guide-update',
    slug: candidate.slug, id: candidate.id, sourceUrl: candidate.url, sourceHash: candidate.source.contentHash,
    independentReview: review, articleHash: next.articleHash, status: 'prepared-awaiting-public-proof', published: false });
  write(root, 'reviews/server-blog-state.json', state);
  write(root, 'reviews/server-blog-report.json', next);
  write(root, 'reviews/server-blog-publication-batch.json', { version: 1, day, slug: candidate.slug, outputs: files, inputs });
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd(), now = new Date();
  const report = await prepareServerBlog({ root, now, allowAi: !process.argv.includes('--offline') });
  report.publicationPipelineEnabled = true;
  report.note = 'Existing-guide publication pipeline enabled. No duplicate article or public-success claim without a verified update and HTTP receipt. Local editorial fallback remains active during migration.';
  const result = publishServerBlog({ root, now, report });
  write(root, 'reviews/server-blog-report.json', result);
  console.log(JSON.stringify({ status: result.status, calls: result.modelCalls, publicVerified: false }));
}
