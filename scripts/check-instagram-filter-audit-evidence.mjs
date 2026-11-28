import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fetchRenderedInstagramPreview } from '../scraper/instagram-ai-agent.js';
import { applyInstagramCookies, instagramAuthSummary, loadInstagramCookieHints } from '../scraper/instagram-auth-utils.js';
import { isInstagramOpenGraphHeaderOnly, normalizeInstagramPublicPostUrl, readInstagramPostLinkedDate } from '../scraper/instagram-page-access.js';
import { createInstagramWebAccess } from '../scraper/instagram-web-access-policy.js';
import { retryAfterAt } from '../scraper/source-http-policy.js';

export const AUDIT_TARGETS = Object.freeze([
  'https://www.instagram.com/reel/DgKrTGJNERZ/',
  'https://www.instagram.com/reel/DgKbULOKwil/',
  'https://www.instagram.com/reel/DgKMgKnB387/',
  'https://www.instagram.com/reel/Df_mFWlNzPp/',
]);
const cacheTarget = AUDIT_TARGETS[3];
const cacheAuthor = 'lisa.maria.b';
const navigationCap = 3;
const captionLimit = 2200;
const dayMs = 86_400_000;
const claimPath = 'source-state/instagram-filter-audit-evidence-claim.json';
const outputPath = 'output/instagram-filter-audit';
const reportPath = 'docs/instagram-ai-report.json';
const sourceFiles = [
  'source-state/instagram-tavily-investigation-result.json',
  'source-state/instagram-tavily-render-first-result.json',
  'source-state/instagram-tavily-render-remaining-result.json',
];
const list = value => Array.isArray(value) ? value : [];
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
const user = value => typeof value === 'string' && /^[a-z0-9._]{2,40}$/i.test(value) ? value.toLowerCase() : '';
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return '';
  const parsed = Date.parse(value), day = value.slice(0, 10), midnight = new Date(day + 'T00:00:00Z');
  return Number.isFinite(parsed) && Number.isFinite(+midnight) && midnight.toISOString().slice(0, 10) === day
    && Number(value.slice(11, 13)) < 24 ? new Date(parsed).toISOString() : '';
}

export function priorAuditEvidence(index, reports) {
  if (reports?.length !== 2 || reports.some(report => report?.browserNavigations !== 2
    || report.verifiedNewOffers !== 0 || report.tavilySearches !== 0 || report.modelCalls !== 0)) {
    throw new Error('Expected the two completed prior browser receipts');
  }
  const priorRows = reports.flatMap(report => list(report.rows));
  const originals = list(index?.links);
  return AUDIT_TARGETS.map(url => {
    const matches = priorRows.filter(row => row?.url === url);
    const [row] = matches;
    if (!originals.includes(url) || matches.length !== 1 || row.status !== 'rejected'
      || row.httpStatus !== 200 || !iso(row.sourcePublishedAt) || !text(row.reason, 200)) {
      throw new Error('Expected exact rejected public-index original in the prior receipts');
    }
    return { url, sourcePublishedAt: iso(row.sourcePublishedAt), priorRejection: row.reason };
  });
}

function cachedGraphEvidence(state, prior) {
  const account = state?.sources?.['account:' + cacheAuthor];
  const matches = list(account?.rows).filter(row => normalizeInstagramPublicPostUrl(row?.permalink) === cacheTarget);
  const [row] = matches;
  const caption = text(row?.caption, captionLimit);
  if (matches.length !== 1 || user(row.username) !== cacheAuthor || iso(row.timestamp) !== prior.sourcePublishedAt || !caption) return null;
  return { caption, title: '', ownerUsername: cacheAuthor, ownerEvidence: 'instagram-graph-business-discovery-account',
    sourcePublishedAtSource: 'instagram-graph-timestamp', sourceCapturedAt: iso(account.updatedAt),
    location: '', locationEvidence: '' };
}

function readPublicPost(page, url) {
  return page.evaluate(({ target, limit }) => {
    const postPath = /^\/(?:[a-z0-9._]{2,40}\/)?(p|reels?|tv)\/([a-z0-9_-]{5,20})\/?$/i;
    const host = /^(?:(?:www|m)\.)?instagram\.com$/i;
    const asUrl = value => {
      if (typeof value !== 'string' || !value.trim()) return null;
      try {
        const parsed = new URL(value, location.href);
        return parsed.protocol === 'https:' && host.test(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port ? parsed : null;
      } catch { return null; }
    };
    const exact = (value, linked = false) => {
      const parsed = asUrl(value);
      const match = parsed && postPath.exec(parsed.pathname);
      if (!match || linked && (parsed.search || parsed.hash)) return false;
      const type = /^reels?$/i.test(match[1]) ? 'reel' : match[1].toLowerCase();
      return 'https://www.instagram.com/' + type + '/' + match[2] + '/' === target;
    };
    const meta = key => document.querySelector('meta[property="' + key + '"]')?.getAttribute('content') || '';
    const identities = [meta('og:url'), document.querySelector('link[rel="canonical"]')?.getAttribute('href')].filter(Boolean);
    if (!identities.every(value => exact(value))) return { reason: 'public-original-identity-conflict' };
    const visible = node => node && !node.closest('[hidden], [aria-hidden="true"]')
      && node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const articles = new Set();
    for (const time of document.querySelectorAll('main time[datetime], [role="main"] time[datetime]')) {
      if (!visible(time) || !exact(time.closest('a[href]')?.href, true)) continue;
      const article = time.closest('article, [role="article"]');
      if (article) articles.add(article);
    }
    const article = articles.size === 1 ? [...articles][0] : null;
    if (!identities.length && !article) return { reason: 'public-original-identity-unproven' };
    const scoped = article?.innerText || '';
    const blockedAudience = /(?:this account is private|dieses konto ist privat|shared with close friends|mit engen freunden geteilt|only visible to followers|nur für follower sichtbar)/i;
    const ogCaption = meta('og:description').trim();
    if (blockedAudience.test(ogCaption) || blockedAudience.test(scoped)) return { reason: 'public-audience-unproven' };
    const wrapper = ogCaption.match(/^[\d.,]+\s+(?:likes?|Gefällt-mir-Angaben)(?:,\s*[\d.,]+\s+(?:comments?|Kommentare?))?\s*[-–]\s*([a-z0-9._]{2,40})\s+(?:on|am)\s+[^:"“]+:\s*["“]([\s\S]+)["”]\s*\.?$/i);
    const caption = (wrapper?.[2] || ogCaption).trim();
    if (!caption || caption.length > limit || /(?:…|\.\.\.)\s*$/.test(caption) || /^instagram$/i.test(caption)) {
      return { reason: 'complete-public-caption-unproven' };
    }
    if (!identities.length && !scoped.replace(/\s+/g, ' ').includes(caption.replace(/\s+/g, ' '))) {
      return { reason: 'complete-public-caption-unproven' };
    }
    const owner = new Map();
    const addOwner = (value, evidence) => {
      if (typeof value === 'string' && /^[a-z0-9._]{2,40}$/i.test(value)) owner.set(value.toLowerCase(), evidence);
    };
    const title = meta('og:title').trim();
    addOwner(title.match(/\(@([a-z0-9._]{2,40})\)\s*(?:on Instagram|auf Instagram|[•|])/i)?.[1], 'exact-post-open-graph-title');
    addOwner(wrapper?.[1], 'exact-post-open-graph-caption-author');
    const locations = new Set();
    if (article) {
      for (const link of article.querySelectorAll('header a[href]')) {
        const parsed = asUrl(link.href);
        const username = parsed && /^\/([a-z0-9._]{2,40})\/?$/i.exec(parsed.pathname)?.[1];
        if (visible(link) && username && !/^(?:explore|reels?|accounts|stories|direct|p|tv)$/i.test(username)) {
          addOwner(username, 'exact-post-rendered-article-header');
        }
      }
      for (const link of article.querySelectorAll('header a[href]')) {
        const parsed = asUrl(link.href);
        const locationName = link.innerText.trim();
        if (visible(link) && /^\/explore\/locations\/\d+(?:\/|$)/.test(parsed?.pathname || '')
          && locationName && locationName.length <= 200) locations.add(locationName);
      }
    }
    const [[ownerUsername, ownerEvidence] = ['', '']] = owner.size === 1 ? [...owner] : [];
    const locationName = locations.size === 1 ? [...locations][0] : '';
    return { caption, title: title.length <= 400 ? title : '', ownerUsername, ownerEvidence,
      location: locationName, locationEvidence: locationName ? 'exact-post-rendered-location-link' : '' };
  }, { target: url, limit: captionLimit });
}

export async function captureInstagramFilterAudit({
  priors, graphState, previousReport, relatedReport, healthReport, cookies = [], now = new Date(),
  clock = () => new Date(), browserType = chromium, fetchRendered = fetchRenderedInstagramPreview,
  readLinkedDate = readInstagramPostLinkedDate, capturePost = readPublicPost,
} = {}) {
  if (priors?.length !== AUDIT_TARGETS.length || AUDIT_TARGETS.some((url, index) => priors[index]?.url !== url)) {
    throw new Error('Unexpected audit originals');
  }
  const access = createInstagramWebAccess({ previousReport, relatedReport, healthReport, now: clock });
  const before = access.snapshot();
  const report = { checkedAt: now.toISOString(), browserNavigations: 0, capturedCount: 0,
    cachedGraphCaptures: 0, modelCalls: 0, tavilySearches: 0, publishedDeals: 0, rows: [] };
  let browser, context, sessionUnavailable = !instagramAuthSummary(cookies).authenticatedSession;
  let failures = 0;
  try {
    for (const prior of priors) {
      const { url, sourcePublishedAt } = prior;
      const age = +now - Date.parse(sourcePublishedAt);
      const row = { ...prior, freshForCurrentSevenDays: age >= 0 && age <= 7 * dayMs, status: 'unverified' };
      report.rows.push(row);
      if (url === cacheTarget) {
        const cached = cachedGraphEvidence(graphState, prior);
        Object.assign(row, { transport: 'retained-meta-graph',
          ...(cached ? { ...cached, status: 'captured' } : { reason: 'exact-cached-original-unavailable' }) });
        if (cached) report.cachedGraphCaptures++;
        continue;
      }
      const paused = access.pause();
      if (paused || sessionUnavailable || report.browserNavigations >= navigationCap) {
        Object.assign(row, { status: 'deferred',
          reason: paused ? 'web-access-cooldown' : sessionUnavailable ? 'ordinary-session-unavailable' : 'browser-navigation-cap',
          ...(paused ? { nextRetryAt: paused.nextRetryAt } : {}) });
        continue;
      }
      if (!context) {
        let candidateContext;
        try {
          browser = await browserType.launch({ headless: true });
          candidateContext = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
          await applyInstagramCookies(candidateContext, cookies);
          context = candidateContext;
        } catch {
          sessionUnavailable = true;
          row.reason = 'ordinary-session-setup-failed';
          await candidateContext?.close().catch(() => {});
          continue;
        }
      }
      let page;
      try {
        page = await context.newPage();
        report.browserNavigations++;
        row.transport = 'ordinary-browser';
        const preview = await fetchRendered(page, url);
        row.httpStatus = preview.status;
        if ([401, 403, 429].includes(preview.status) || preview.loginWall || retryAfterAt(preview.retryAfter, clock())) {
          const hold = access.failure('all', { status: preview.status, retryAfter: preview.retryAfter,
            reason: preview.loginWall ? 'login-wall' : 'transport-failures' });
          Object.assign(row, { status: 'blocked', reason: hold.reason, nextRetryAt: hold.nextRetryAt });
          continue;
        }
        if (!preview.status || preview.status >= 500) throw new Error('Browser transport unavailable');
        failures = 0;
        if (preview.status !== 200 || normalizeInstagramPublicPostUrl(preview.finalUrl) !== url
          || normalizeInstagramPublicPostUrl(page.url()) !== url) {
          row.reason = 'exact-rendered-original-unavailable';
          continue;
        }
        const date = iso(await readLinkedDate(page, url));
        if (!date || date !== sourcePublishedAt) {
          row.reason = date ? 'original-timestamp-conflicts-with-prior' : 'original-timestamp-unproven';
          continue;
        }
        const proof = await capturePost(page, url);
        let caption = text(proof?.caption, captionLimit);
        if (isInstagramOpenGraphHeaderOnly(caption) && preview.captionEvidence === 'exact-original-caption') {
          caption = text(preview.description, captionLimit) || caption;
        }
        if (isInstagramOpenGraphHeaderOnly(caption)) {
          row.reason = 'open-graph-header-only';
          continue;
        }
        if (!caption || normalizeInstagramPublicPostUrl(page.url()) !== url) {
          row.reason = proof?.reason || 'complete-public-caption-unproven';
          continue;
        }
        Object.assign(row, { status: 'captured', caption, title: text(proof.title, 400), sourceCapturedAt: clock().toISOString(),
          ownerUsername: user(proof.ownerUsername), ownerEvidence: text(proof.ownerEvidence, 80),
          location: text(proof.location, 200), locationEvidence: text(proof.locationEvidence, 80),
          sourcePublishedAtSource: 'instagram-rendered-time-datetime' });
      } catch {
        row.reason = 'rendered-source-unavailable';
        if (++failures >= 3) access.failure('all', { reason: 'transport-failures' });
      } finally { await page?.close().catch(() => {}); }
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
  report.capturedCount = report.rows.filter(row => row.status === 'captured').length;
  const webAccessChanges = Object.fromEntries(Object.entries(access.snapshot()).filter(([scope, hold]) =>
    JSON.stringify(hold) !== JSON.stringify(before[scope])));
  return { report, webAccessChanges };
}

function writeJson(file, value, exclusive = false) {
  const temp = exclusive ? file : file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    if (!exclusive) fs.renameSync(temp, file);
  } finally { if (!exclusive) fs.rmSync(temp, { force: true }); }
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  const { GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT } = process.env;
  if (!['--claim', '--run'].includes(mode) || extra.length || GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || GITHUB_REF !== 'refs/heads/main' || GITHUB_RUN_ATTEMPT !== '1' || !/^\d+$/.test(GITHUB_RUN_ID || '') || !GITHUB_OUTPUT) {
    throw new Error('Expected explicit first main-branch audit invocation');
  }
  const sources = sourceFiles.map(file => fs.readFileSync(file));
  const [index, ...receipts] = sources.map(bytes => JSON.parse(bytes));
  const priors = priorAuditEvidence(index, receipts);
  const sourceDigests = sources.map(bytes => createHash('sha256').update(bytes).digest('hex'));
  if (mode === '--claim') {
    try { writeJson(claimPath, { version: 1, runId: GITHUB_RUN_ID, sourceDigests, navigationCap, claimedAt: new Date().toISOString() }, true); }
    catch (error) { if (error.code === 'EEXIST') return; throw error; }
    fs.appendFileSync(GITHUB_OUTPUT, 'claimed=true\n');
    return;
  }
  const claim = readJson(claimPath);
  if (claim.version !== 1 || claim.runId !== GITHUB_RUN_ID || claim.navigationCap !== navigationCap
    || JSON.stringify(claim.sourceDigests) !== JSON.stringify(sourceDigests)) throw new Error('Exact audit source claim missing');
  fs.mkdirSync(outputPath, { recursive: true });
  fs.writeFileSync(path.join(outputPath, '.started'), GITHUB_RUN_ID + '\n', { flag: 'wx' });
  const result = await captureInstagramFilterAudit({
    priors, graphState: readJson('docs/meta-instagram-scan-state.json'), cookies: loadInstagramCookieHints(),
    previousReport: readJson(reportPath), relatedReport: readJson('docs/instagram-discovery-report.json'),
    healthReport: readJson('docs/instagram-auth-health.json'),
  });
  const latest = readJson(reportPath);
  const webAccess = { ...latest.webAccess };
  let changed = false;
  for (const [scope, hold] of Object.entries(result.webAccessChanges)) {
    if (Date.parse(hold.nextRetryAt) <= (Date.parse(webAccess[scope]?.nextRetryAt) || 0)) continue;
    webAccess[scope] = hold;
    changed = true;
  }
  if (changed) {
    writeJson(reportPath, { ...latest, webAccess });
    fs.appendFileSync(GITHUB_OUTPUT, 'web_access_changed=true\n');
  }
  writeJson(path.join(outputPath, 'evidence.json'), result.report);
  // Captions go directly to the scoped artifact; logs carry status counts only.
  const { browserNavigations, capturedCount, cachedGraphCaptures, rows } = result.report;
  console.log(JSON.stringify({ browserNavigations, capturedCount, cachedGraphCaptures,
    outcomes: rows.map(({ url, status, reason, httpStatus }) => ({ url, status, reason, httpStatus })) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Instagram filter-audit capture could not be completed'); process.exitCode = 1; });
}
