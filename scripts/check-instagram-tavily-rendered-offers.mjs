import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fetchRenderedInstagramPreview } from '../scraper/instagram-ai-agent.js';
import { applyInstagramCookies, instagramAuthSummary, instagramCookieHeader, loadInstagramCookieHints } from '../scraper/instagram-auth-utils.js';
import { loadDealModeration } from '../scraper/deal-moderation-utils.js';
import { isInstagramOpenGraphHeaderOnly, readInstagramPostLinkedDate } from '../scraper/instagram-page-access.js';
import { normalizeInstagramTavilyUrl } from '../scraper/instagram-tavily-index.js';
import { verifyInstagramTavilyOffers } from './check-instagram-tavily-offers.mjs';

export const RENDER_TARGETS = Object.freeze([
  'https://www.instagram.com/reel/DgKMgKnB387/',
  'https://www.instagram.com/reel/Df_mFWlNzPp/',
]);
const captionLimit = 1200;
// The first pair was conclusively read by run 46081522342. This separate claim
// admits only the two remaining direct-HTTP200 originals, never a repeat of them.
const claimFile = 'source-state/instagram-tavily-render-remaining-claim.json';
const outputDirectory = 'output/social-discovery';
const marker = path.join(outputDirectory, '.instagram-tavily-render-verification.started');
const normalize = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function renderedTargetsFromDirectReport(report) {
  if (report?.sourceReads !== 4 || report.verifiedNewOffers !== 0 || report.modelCalls !== 0
    || report.publishedDeals !== 0 || !Array.isArray(report.rows)) {
    throw new Error('Expected the completed four-read direct verification receipt');
  }
  for (const url of RENDER_TARGETS) {
    const rows = report.rows.filter(row => row?.url === url);
    if (rows.length !== 1 || rows[0].status !== 'unverified' || rows[0].httpStatus !== 200
      || rows[0].reason !== 'original-identity-unproven') {
      throw new Error('Expected both exact unresolved originals in the direct receipt');
    }
  }
  return [...RENDER_TARGETS];
}

function readRenderedCaption(page, url, limit) {
  return page.evaluate(({ url: target, limit: max }) => {
    const postPath = /^\/(?:[a-z0-9._]{2,40}\/)?(p|reels?|tv)\/([a-z0-9_-]{5,20})\/?$/i;
    const exact = (value, linked = false) => {
      try {
        const resolved = new URL(value, location.href);
        const match = postPath.exec(resolved.pathname);
        if (!match || resolved.protocol !== 'https:' || !/^(?:(?:www|m)\.)?instagram\.com$/i.test(resolved.hostname)
          || resolved.username || resolved.password || resolved.port || linked && (resolved.search || resolved.hash)) return false;
        const type = /^reels?$/i.test(match[1]) ? 'reel' : match[1].toLowerCase();
        return 'https://www.instagram.com/' + type + '/' + match[2] + '/' === target;
      } catch { return false; }
    };
    const meta = name => document.querySelector('meta[property="' + name + '"]')?.getAttribute('content') || '';
    const identities = [meta('og:url'), document.querySelector('link[rel="canonical"]')?.getAttribute('href')].filter(Boolean);
    if (!identities.every(value => exact(value))) return null;
    const raw = meta('og:description');
    const value = raw.replace(/\s+/g, ' ').trim();
    // Strip only Instagram's recognized Open Graph author/engagement prefix.
    const quoted = value.match(/^[\d.,]+\s+likes?(?:,\s*[\d.,]+\s+comments?)?\s*[-–]\s*[^:"“]+:\s*["“]([\s\S]+)["”]\s*\.?$/i)?.[1];
    const caption = quoted || value;
    if (!caption || caption.length > max || /(?:…|\.\.\.)\s*$/.test(caption)
      || /^(?:instagram|this account is private|dieses konto ist privat)$/i.test(caption)) return null;
    // The caller independently requires an exact visible linked post date.
    if (identities.length) return { caption };
    const scopes = new Set();
    for (const time of document.querySelectorAll('main time[datetime], [role="main"] time[datetime]')) {
      const anchor = time.closest('a[href]');
      const article = time.closest('article, [role="article"]');
      if (anchor && article && exact(anchor.href, true) && time.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
        scopes.add(article);
      }
    }
    if (scopes.size !== 1) return null;
    const [article] = scopes;
    if (!article.innerText.replace(/\s+/g, ' ').trim().includes(caption)) return null;
    return { caption };
  }, { url, limit });
}

function exactDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return '';
  const day = value.slice(0, 10);
  const midnight = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(+midnight) || midnight.toISOString().slice(0, 10) !== day || Number(value.slice(11, 13)) >= 24) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function proofResponse(url, title, caption, date) {
  const json = JSON.stringify({ '@type': 'SocialMediaPosting', url, datePublished: date, headline: title, caption })
    .replace(/</g, '\\u003c');
  return new Response('<link rel="canonical" href="' + url + '"><script type="application/ld+json">'
    + json + '</script>', { headers: { 'content-type': 'text/html' } });
}

export async function verifyRenderedInstagramTavilyOffers({
  directReport, inventory, now = new Date(), clock = () => new Date(), moderation,
  previousReport, relatedReport, healthReport, cookies = [], browserType = chromium,
  fetchRendered = fetchRenderedInstagramPreview, readLinkedDate = readInstagramPostLinkedDate,
  readCaption = readRenderedCaption,
} = {}) {
  const urls = renderedTargetsFromDirectReport(directReport);
  const cookieHeader = instagramAuthSummary(cookies).authenticatedSession ? instagramCookieHeader(cookies) : '';
  const readResults = new Map();
  const statuses = new Map();
  let browser;
  let context;
  let setupFailed = false;
  let browserNavigations = 0;

  const fetcher = async url => {
    if (!urls.includes(url) || browserNavigations >= RENDER_TARGETS.length) throw new Error('Unexpected rendered original');
    if (setupFailed) {
      readResults.set(url, 'rendered-session-setup-failed');
      throw new Error('Unusable browser session');
    }
    if (!context) {
      let pendingContext;
      try {
        browser = await browserType.launch({ headless: true });
        pendingContext = await browser.newContext({
          viewport: { width: 1366, height: 900 }, locale: 'de-AT', timezoneId: 'Europe/Vienna',
        });
        await applyInstagramCookies(pendingContext, cookies);
        context = pendingContext;
      } catch {
        setupFailed = true;
        readResults.set(url, 'rendered-session-setup-failed');
        await pendingContext?.close().catch(() => {});
        throw new Error('Unusable browser session');
      }
    }
    const page = await context.newPage();
    browserNavigations++;
    try {
      const preview = await fetchRendered(page, url);
      const { status, retryAfter, finalUrl, loginWall } = preview;
      const headers = { 'content-type': 'text/html', ...(retryAfter ? { 'retry-after': retryAfter } : {}) };
      if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('Incomplete browser navigation');
      statuses.set(url, status);
      // Preserve genuine access signals for the ordinary shared website policy.
      if (loginWall && ![401, 403, 429].includes(status)) {
        return new Response(null, { status: 302, headers: { ...headers, location: '/accounts/login/' } });
      }
      if (status !== 200) return new Response(null, { status, headers });
      if (retryAfter) {
        readResults.set(url, 'rendered-response-with-retry-header');
        return new Response('<main></main>', { status, headers });
      }
      const unverified = reason => {
        readResults.set(url, reason);
        return new Response('<main></main>', { status, headers });
      };
      if (normalizeInstagramTavilyUrl(finalUrl) !== url || normalizeInstagramTavilyUrl(page.url()) !== url) {
        return unverified('rendered-original-identity-unproven');
      }
      const publishedAt = exactDate(await readLinkedDate(page, url));
      if (!publishedAt) return unverified('rendered-bound-publication-unproven');
      const proof = await readCaption(page, url, captionLimit);
      let caption = normalize(proof?.caption);
      if (isInstagramOpenGraphHeaderOnly(caption) && preview.captionEvidence === 'exact-original-caption') {
        caption = normalize(preview.description) || caption;
      }
      if (isInstagramOpenGraphHeaderOnly(caption)) return unverified('open-graph-header-only');
      if (!caption || caption.length > captionLimit || /(?:…|\.\.\.)\s*$/.test(caption)) {
        return unverified('rendered-complete-caption-unproven');
      }
      if (normalizeInstagramTavilyUrl(page.url()) !== url) return unverified('rendered-original-identity-unproven');
      return proofResponse(url, normalize(preview.title), caption, publishedAt);
    } finally {
      await page.close().catch(() => {});
    }
  };

  try {
    const result = await verifyInstagramTavilyOffers({
      links: urls, inventory, now, clock, moderation, previousReport, relatedReport, healthReport,
      cookieHeader, requireSession: true, fetcher,
    });
    const report = { ...result.report, sourceReads: browserNavigations, browserNavigations,
      stage: 'rendered-original-proof-remaining', tavilySearches: 0,
      rows: result.report.rows.map(row => ({
        ...row, ...(statuses.has(row.url) ? { httpStatus: statuses.get(row.url) } : {}),
        ...(readResults.has(row.url) && row.status === 'unverified' ? { reason: readResults.get(row.url) } : {}),
      })),
    };
    const candidates = result.candidates.map(candidate => ({
      ...candidate, sourcePublishedAtSource: 'instagram-rendered-time-datetime',
    }));
    return { ...result, report, candidates };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function loadInventory(docs) {
  const read = name => readJson(path.join(docs, name));
  const deals = name => {
    const payload = read(name);
    return Array.isArray(payload) ? payload : payload?.deals || [];
  };
  return { live: deals('deals.json'),
    pending: fs.readdirSync(docs).filter(name => /^deals-pending-.+\.json$/.test(name)).flatMap(deals),
    indexed: read('deal-candidates-index.json').candidates, seen: read('slack-seen-posts.json'),
    graphPosts: read('instagram-graph-post-evidence.json').posts };
}

function writeJson(file, value, exclusive = false) {
  const temporary = exclusive ? file : file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    if (!exclusive) fs.renameSync(temporary, file);
  } finally {
    if (!exclusive) fs.rmSync(temporary, { force: true });
  }
}

async function main() {
  const [receiptPath, action, ...extra] = process.argv.slice(2);
  const { GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT } = process.env;
  if (!receiptPath || action && action !== '--claim' || extra.length || GITHUB_REF !== 'refs/heads/main'
    || GITHUB_RUN_ATTEMPT !== '1' || !/^\d+$/.test(GITHUB_RUN_ID || '') || !GITHUB_OUTPUT) {
    throw new Error('Explicit first main-branch diagnostic invocation required');
  }
  const raw = fs.readFileSync(receiptPath);
  const directReport = JSON.parse(raw);
  renderedTargetsFromDirectReport(directReport);
  const receiptSha256 = createHash('sha256').update(raw).digest('hex');
  if (action === '--claim') {
    const claim = { version: 1, runId: GITHUB_RUN_ID, receiptSha256,
      claimedAt: new Date().toISOString(), maximumBrowserNavigations: RENDER_TARGETS.length };
    try { writeJson(claimFile, claim, true); }
    catch (error) { if (error.code === 'EEXIST') return; throw error; }
    fs.appendFileSync(GITHUB_OUTPUT, 'claimed=true\n');
    return;
  }
  const claim = readJson(claimFile);
  if (claim?.version !== 1 || claim.runId !== GITHUB_RUN_ID || claim.receiptSha256 !== receiptSha256
    || claim.maximumBrowserNavigations !== RENDER_TARGETS.length) throw new Error('Missing exact rendered verification claim');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(marker, GITHUB_RUN_ID + '\n', { flag: 'wx' });
  const docs = 'docs';
  const reportPath = path.join(docs, 'instagram-ai-report.json');
  const result = await verifyRenderedInstagramTavilyOffers({
    directReport, cookies: loadInstagramCookieHints(), inventory: loadInventory(docs),
    moderation: loadDealModeration(), previousReport: readJson(reportPath),
    relatedReport: readJson(path.join(docs, 'instagram-discovery-report.json')),
    healthReport: readJson(path.join(docs, 'instagram-auth-health.json')),
  });
  if (result.webAccessChanged) {
    const latest = readJson(reportPath);
    const webAccess = { ...latest.webAccess };
    let changed = false;
    for (const [scope, pause] of Object.entries(result.webAccessChanges)) {
      if (Date.parse(pause.nextRetryAt) <= (Date.parse(webAccess[scope]?.nextRetryAt) || 0)) continue;
      webAccess[scope] = pause;
      changed = true;
    }
    if (changed) {
      writeJson(reportPath, { ...latest, webAccess });
      fs.appendFileSync(GITHUB_OUTPUT, 'web_access_changed=true\n');
    }
  }
  writeJson(path.join(outputDirectory, 'instagram-tavily-rendered-offers.json'), result.report);
  writeJson(path.join(outputDirectory, 'instagram-tavily-rendered-offers.candidates.json'), {
    version: 1, checkedAt: result.report.checkedAt, candidates: result.candidates,
  });
  console.log(JSON.stringify(result.report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Rendered Instagram original verification could not be completed'); process.exitCode = 1; });
}
