import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildHeuristicDeal, fetchRenderedInstagramPreview, makeCandidate } from '../scraper/instagram-ai-agent.js';
import { INSTAGRAM_TAVILY_SOURCE } from '../scraper/instagram-tavily-index.js';
import { applyInstagramCookies, instagramAuthSummary, loadInstagramCookieHints } from '../scraper/instagram-auth-utils.js';
import { instagramPageHasAccessWall, normalizeInstagramPublicPostUrl, readInstagramPostLinkedDate } from '../scraper/instagram-page-access.js';
import { createInstagramWebAccess } from '../scraper/instagram-web-access-policy.js';
import { retryAfterAt } from '../scraper/source-http-policy.js';

export const ORIGINAL = 'https://www.instagram.com/reel/DgKrTGJNERZ/';
export const ORIGINAL_DATE = '2026-11-25T13:51:32.000Z';
const author = 'satansbratan';
const digest = 'cc80ddaaeb094ce41fb6b17a12ad960717cc1cfd3d35ab3a19f251925b21da58';
const priorPath = 'output/instagram-filter-original-prior/evidence.json';
const claimPath = 'source-state/instagram-filter-original-video-claim.json';
const output = 'output/instagram-filter-original-video';
const reportPath = 'docs/instagram-ai-report.json';
const marker = 'data-freefinder-original-proof';
const videoSelector = 'video[' + marker + ']';
const frameStyle = 'body * { visibility:hidden !important; } body *::before, body *::after { visibility:hidden !important; } '
  + videoSelector + ' { visibility:visible !important; }';

export function validateOriginalReceipt(receipt) {
  const rows = Array.isArray(receipt?.rows) ? receipt.rows.filter(row => row.url === ORIGINAL) : [];
  const [row] = rows;
  if (receipt?.browserNavigations !== 3 || receipt?.modelCalls !== 0 || receipt?.tavilySearches !== 0
    || receipt?.publishedDeals !== 0 || rows.length !== 1 || row.status !== 'captured' || row.httpStatus !== 200
    || row.sourcePublishedAt !== ORIGINAL_DATE || row.sourcePublishedAtSource !== 'instagram-rendered-time-datetime'
    || !/^[\d.,]+\s+likes?,\s*[\d.,]+\s+comments?\s*[-–]\s*satansbratan\s+am\s+November\s+25,\s*2026$/i.test(row.caption)) {
    throw new Error('Exact audited metadata-only original required');
  }
}

export function inspectOriginalVideo(page) {
  return page.evaluate(({ original, date, author, marker }) => {
    const visible = node => node && !node.closest('[hidden], [aria-hidden="true"]')
      && node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const exact = href => {
      try {
        const url = new URL(href, location.href);
        const match = /^\/(?:[a-z0-9._]{2,40}\/)?reels?\/([a-z0-9_-]{5,20})\/?$/i.exec(url.pathname);
        return url.protocol === 'https:' && /^(?:(?:www|m)\.)?instagram\.com$/i.test(url.hostname)
          && !url.username && !url.password && !url.port && match && 'https://www.instagram.com/reel/' + match[1] + '/' === original;
      } catch { return false; }
    };
    const wall = {
      hasLoginForm: [...document.querySelectorAll('form input[type="password"]')].some(visible),
      blockingDialogText: [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
        .filter(visible).map(node => node.innerText).join(' ').slice(0, 1200),
    };
    const meta = key => document.querySelector('meta[property="og:' + key + '"]')?.content || '';
    const identities = [meta('url'), document.querySelector('link[rel="canonical"]')?.href].filter(Boolean);
    if (!exact(location.href) || !identities.length || !identities.every(exact)) return { wall, reason: 'exact-original-unproven' };
    const times = [...document.querySelectorAll('main time[datetime], [role="main"] time[datetime]')].filter(node =>
      visible(node) && exact(node.closest('a[href]')?.href) && Date.parse(node.dateTime) === Date.parse(date));
    const mains = new Set(times.map(node => node.closest('main, [role="main"]')));
    if (mains.size !== 1) return { wall, reason: 'exact-linked-clock-unproven' };
    const [main] = mains;
    const privatePost = /this account is private|dieses konto ist privat|shared with close friends|mit engen freunden geteilt|only visible to followers|nur für follower sichtbar/i;
    if (privatePost.test(meta('description')) || privatePost.test(main.innerText)) return { wall, reason: 'public-audience-unproven' };
    const articles = new Set(times.map(node => node.closest('article, [role="article"]')).filter(Boolean));
    if (articles.size > 1) return { wall, reason: 'exact-rendered-scope-ambiguous' };
    const [article] = articles;
    const owner = link => {
      try {
        const url = new URL(link.href);
        return url.origin === 'https://www.instagram.com' && url.pathname.toLowerCase().replace(/\/$/, '') === '/' + author;
      } catch { return false; }
    };
    const excluded = 'nav, aside, header, [role="dialog"], [role="comment"], [data-testid*="comment" i], [data-e2e*="comment" i]';
    const explicit = '[data-testid="post-caption"], [data-e2e="post-caption"], [itemprop="caption"]';
    const captions = new Set();
    for (const node of (article || main).querySelectorAll(explicit + ', h1')) {
      if (!visible(node) || node.closest(excluded) || article && node.closest('article, [role="article"]') !== article) continue;
      if (!node.matches(explicit) || !article) {
        const row = node.closest('li, [role="listitem"]') || node.parentElement?.parentElement;
        if (!row || ![...row.querySelectorAll('a[href]')].some(link => visible(link) && owner(link))) continue;
      }
      const text = node.innerText.trim();
      if (text && text.length <= 2200 && !/(?:…|\.\.\.|mehr anzeigen|see more)\s*$/i.test(text)
        && !/^(?:instagram|reels?|satansbratan)$/i.test(text) && !/^\d[\d.,]*\s+likes?,/i.test(text)) captions.add(text);
    }
    const videos = [...document.querySelectorAll('video')].filter(node => {
      if (!visible(node)) return false;
      const box = node.getBoundingClientRect();
      return box.width >= 100 && box.height >= 100 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
    });
    const [video] = videos;
    const box = video?.getBoundingClientRect();
    const usable = videos.length === 1 && main.contains(video) && !video.closest(excluded)
      && (!article || article.contains(video))
      && box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
    for (const node of document.querySelectorAll('[' + marker + ']')) node.removeAttribute(marker);
    if (usable) video.setAttribute(marker, '');
    return { wall, caption: captions.size === 1 ? [...captions][0] : '',
      captionReason: captions.size > 1 ? 'visible-original-caption-ambiguous' : 'visible-original-caption-unavailable',
      video: Boolean(usable), duration: usable && Number.isFinite(video.duration) ? video.duration : null };
  }, { original: ORIGINAL, date: ORIGINAL_DATE, author, marker });
}

async function frameAt(page, seconds, seek) {
  const video = page.locator(videoSelector);
  await video.evaluate((node, { seconds, seek }) => {
    if (seek && Array.from({ length: node.seekable.length }, (_, i) => i).some(i =>
      node.seekable.start(i) <= seconds && node.seekable.end(i) > seconds)) {
      node.currentTime = seconds;
      return;
    }
    if (node.paused && !node.ended) node.play().catch(() => {});
  }, { seconds, seek }, { timeout: 2000 });
  await page.waitForFunction(({ selector, seconds }) => {
    const node = document.querySelector(selector);
    return node && !node.seeking && node.readyState >= 2 && node.currentTime >= seconds - 0.2;
  }, { selector: videoSelector, seconds }, { timeout: 6500 });
  const actual = await video.evaluate(node => node.currentTime, undefined, { timeout: 2000 });
  const image = await video.screenshot({ type: 'jpeg', quality: 80, style: frameStyle, timeout: 3000 });
  return { image, actual };
}

export async function captureOriginalVideo({
  previousReport, relatedReport, healthReport, cookies = [], clock = () => new Date(), browserType = chromium,
  fetchRendered = fetchRenderedInstagramPreview, readLinkedDate = readInstagramPostLinkedDate,
  inspect = inspectOriginalVideo, frame = frameAt, saveFrame,
} = {}) {
  const access = createInstagramWebAccess({ previousReport, relatedReport, healthReport, now: clock });
  const before = access.snapshot();
  const report = { url: ORIGINAL, checkedAt: clock().toISOString(), browserNavigations: 0, frames: [],
    modelCalls: 0, tavilySearches: 0, publishedDeals: 0 };
  let browser, page;
  const blocked = (status, retryAfter, wall) => {
    const hold = access.failure('all', { status, retryAfter, reason: wall ? 'login-wall' : 'transport-failures' });
    return { status: 'blocked', reason: hold.reason, nextRetryAt: hold.nextRetryAt };
  };
  const exactPage = () => normalizeInstagramPublicPostUrl(page.url()) === ORIGINAL;
  const guard = proof => {
    if (instagramPageHasAccessWall({ finalUrl: page.url(), ...proof.wall })) return blocked(report.httpStatus, '', true);
    if (proof.reason || !exactPage()) return { status: 'unverified', reason: proof.reason || 'rendered-original-changed' };
    return null;
  };
  const capture = async () => {
    const pause = access.pause();
    if (pause) return { status: 'deferred', reason: 'web-access-cooldown', nextRetryAt: pause.nextRetryAt };
    if (!instagramAuthSummary(cookies).authenticatedSession) return { status: 'deferred', reason: 'ordinary-session-unavailable' };
    try {
      browser = await browserType.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
      await applyInstagramCookies(context, cookies);
      page = await context.newPage();
    } catch { return { status: 'unverified', reason: 'ordinary-session-setup-failed' }; }
    report.browserNavigations++;
    const preview = await fetchRendered(page, ORIGINAL);
    report.httpStatus = preview.status;
    if ([401, 403, 429].includes(preview.status) || preview.loginWall || retryAfterAt(preview.retryAfter, clock())) {
      return blocked(preview.status, preview.retryAfter, preview.loginWall);
    }
    if (preview.status !== 200 || normalizeInstagramPublicPostUrl(preview.finalUrl) !== ORIGINAL || !exactPage()) {
      return { status: 'unverified', reason: 'exact-rendered-original-unavailable' };
    }
    if (Date.parse(await readLinkedDate(page, ORIGINAL)) !== Date.parse(ORIGINAL_DATE)) {
      return { status: 'unverified', reason: 'original-linked-clock-unproven' };
    }
    const proof = await inspect(page);
    const initialGuard = guard(proof);
    if (initialGuard) return initialGuard;
    const sourcePublishedAtSource = 'instagram-rendered-time-datetime';
    const candidate = makeCandidate({ url: ORIGINAL, source: INSTAGRAM_TAVILY_SOURCE });
    candidate.preview = { ...preview, pubDate: ORIGINAL_DATE, pubDateSource: sourcePublishedAtSource };
    const accepted = Boolean(buildHeuristicDeal(candidate));
    report.productionTextCheck = { captionEvidence: preview.captionEvidence || '', accepted,
      reason: candidate.rejectionReason, score: candidate.score, sourcePublishedAt: ORIGINAL_DATE };
    const exactCaption = preview.captionEvidence === 'exact-original-caption' ? preview.description : '';
    const caption = proof.caption || exactCaption;
    Object.assign(report, { sourcePublishedAt: ORIGINAL_DATE, sourcePublishedAtSource,
      ownerUsername: author, ownerEvidence: 'exact-prior-open-graph-byline',
      ...(caption ? { caption, captionEvidence: proof.caption ? 'visible-original-caption' : preview.captionEvidence }
        : { captionReason: proof.captionReason }) });
    if (proof.video) {
      const hasDuration = Number.isFinite(proof.duration) && proof.duration > 2;
      if (hasDuration) report.videoDurationSeconds = Math.round(proof.duration * 100) / 100;
      const positions = hasDuration ? [0, proof.duration / 2, proof.duration * 0.9] : [0, 5, 10];
      for (const [index, seconds] of positions.entries()) {
        const prior = await inspect(page);
        const priorGuard = guard(prior);
        if (priorGuard) return priorGuard;
        if (!prior.video) break;
        const shot = await frame(page, seconds, hasDuration && index > 0).catch(() => null);
        const after = await inspect(page);
        const afterGuard = guard(after);
        if (afterGuard) return afterGuard;
        if (!after.video || !shot || !Number.isFinite(shot.actual) || report.frames.some(row => Math.abs(row.seconds - shot.actual) < 0.5)) continue;
        const file = 'frame-' + (index + 1) + '.jpg';
        await saveFrame(file, shot.image);
        report.frames.push({ file, seconds: Math.round(shot.actual * 100) / 100 });
      }
    }
    return report.caption || report.frames.length ? { status: 'captured' } : { status: 'unverified', reason: 'original-content-unavailable' };
  };
  try { Object.assign(report, await capture()); }
  catch { Object.assign(report, { status: 'unverified', reason: 'ordinary-render-unavailable' }); }
  finally { await browser?.close().catch(() => {}); }
  return { report, accessChanges: Object.fromEntries(Object.entries(access.snapshot()).filter(([scope, hold]) =>
    JSON.stringify(hold) !== JSON.stringify(before[scope]))) };
}

const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  const { GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT } = process.env;
  if (!['--claim', '--run'].includes(mode) || extra.length || GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || GITHUB_REF !== 'refs/heads/main' || GITHUB_RUN_ATTEMPT !== '1' || !/^\d+$/.test(GITHUB_RUN_ID || '') || !GITHUB_OUTPUT) {
    throw new Error('Expected explicit first main-branch invocation');
  }
  const prior = fs.readFileSync(priorPath);
  if (createHash('sha256').update(prior).digest('hex') !== digest) throw new Error('Original receipt digest mismatch');
  validateOriginalReceipt(JSON.parse(prior));
  const expected = { runId: GITHUB_RUN_ID, receiptDigest: digest, original: ORIGINAL, navigationCap: 1, frameCap: 3 };
  if (mode === '--claim') {
    try { fs.writeFileSync(claimPath, JSON.stringify(expected, null, 2) + '\n', { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') return; throw error; }
    fs.appendFileSync(GITHUB_OUTPUT, 'claimed=true\n');
    return;
  }
  const claim = readJson(claimPath);
  if (!Object.entries(expected).every(([key, value]) => claim[key] === value)) throw new Error('Matching claim required');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, '.started'), GITHUB_RUN_ID + '\n', { flag: 'wx' });
  const { report, accessChanges } = await captureOriginalVideo({
    cookies: loadInstagramCookieHints(), previousReport: readJson(reportPath),
    relatedReport: readJson('docs/instagram-discovery-report.json'), healthReport: readJson('docs/instagram-auth-health.json'),
    saveFrame: async (file, image) => fs.writeFileSync(path.join(output, file), image, { flag: 'wx' }),
  });
  const saved = readJson(reportPath);
  const webAccess = { ...saved.webAccess };
  let changed = false;
  for (const [scope, hold] of Object.entries(accessChanges)) {
    if (Date.parse(hold.nextRetryAt) <= (Date.parse(webAccess[scope]?.nextRetryAt) || 0)) continue;
    webAccess[scope] = hold;
    changed = true;
  }
  if (changed) {
    const temporary = reportPath + '.tmp-' + process.pid;
    fs.writeFileSync(temporary, JSON.stringify({ ...saved, webAccess }, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, reportPath);
    fs.appendFileSync(GITHUB_OUTPUT, 'web_access_changed=true\n');
  }
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, reason: report.reason, browserNavigations: report.browserNavigations,
    hasCaption: Boolean(report.caption), frames: report.frames.length }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Original video evidence could not be completed'); process.exitCode = 1; });
}
