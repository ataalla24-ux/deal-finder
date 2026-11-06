import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blogDigest } from './server-blog-content.mjs';
import { load } from 'cheerio';

export async function verifyPublicBlog({ root = process.cwd(), request = fetch, attempts = 12,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), clock = Date.now, maxDurationMs = 240000 } = {}) {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'reviews/server-blog-report.json'), 'utf8'));
  if (report.status !== 'prepared-for-publication') return { status: 'no-new-publication', reason: report.status, published: false };
  if (!/^docs\/blog\/[a-z0-9-]+\.html$/.test(report.articlePath)) throw Error('invalid-blog-public-path');
  const expected = new Map([[report.articlePath, report.articleHash], ['docs/sitemap.xml', report.sitemapHash]]);
  if (blogDigest(fs.readFileSync(path.join(root, report.articlePath))) !== report.articleHash) throw Error('blog-local-output-changed');
  const deadline = clock() + Math.min(240000, Math.max(1, maxDurationMs));
  let checks = [];
  for (let attempt = 0; attempt < Math.max(1, Math.min(attempts, 12)); attempt++) {
    checks = [];
    for (const [file, hash] of expected) {
      if (clock() >= deadline) break;
      try {
        const response = await request(`https://freefinder.at/${file.slice(5)}?blog=${hash.slice(0, 16)}`, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - clock()))), headers: { 'cache-control': 'no-cache' },
        });
        const bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
        const actual = bytes ? blogDigest(bytes) : null;
        let articleEntryVerified = false;
        if (file === 'docs/sitemap.xml' && bytes) {
          const $ = load(bytes.toString('utf8'), { xml: true });
          const entry = $('url').filter((_, node) => $(node).find('loc').text() === `https://freefinder.at/${report.articlePath.slice(5)}`);
          articleEntryVerified = entry.length === 1 && entry.find('lastmod').length === 1 && entry.find('lastmod').text() === report.day;
        }
        checks.push({ file, status: response.status, expected: hash, actual, exact: response.ok && actual === hash,
          articleEntryVerified, verified: response.ok && (file === 'docs/sitemap.xml' ? articleEntryVerified : actual === hash) });
      } catch { checks.push({ file, exact: false, reason: 'public-file-unavailable' }); }
    }
    if (checks.length === expected.size && checks.every(row => row.verified)) return { status: 'publicly-verified', published: true, day: report.day,
      articlePath: report.articlePath, checkedAt: new Date().toISOString(), checks };
    if (clock() >= deadline) break;
    if (attempt + 1 < Math.min(attempts, 12)) await wait(Math.min(15000, Math.max(0, deadline - clock())));
  }
  return { status: 'publication-not-confirmed', published: false, checkedAt: new Date().toISOString(), checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const proof = await verifyPublicBlog();
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync('output/server-blog-public-proof.json', JSON.stringify(proof, null, 2) + '\n');
  if (proof.published) fs.writeFileSync('reviews/server-blog-public-receipt.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Blog: ${proof.status}.\n`);
  if (proof.status === 'publication-not-confirmed') process.exitCode = 1;
}
