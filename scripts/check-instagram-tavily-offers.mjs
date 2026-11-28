import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { buildHeuristicDeal, knownInstagramPosts, makeCandidate } from '../scraper/instagram-ai-agent.js';
import { canonicalInstagramPostKey, semanticCrossPlatformOfferKey } from '../scraper/deal-evidence-utils.js';
import { filterModeratedDeals, loadDealModeration } from '../scraper/deal-moderation-utils.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { instagramAuthSummary, instagramCookieHeader, loadInstagramCookieHints } from '../scraper/instagram-auth-utils.js';
import { instagramPageHasAccessWall, isInstagramOpenGraphHeaderOnly } from '../scraper/instagram-page-access.js';
import { INSTAGRAM_TAVILY_SOURCE, normalizeInstagramTavilyUrl } from '../scraper/instagram-tavily-index.js';
import { INSTAGRAM_TAVILY_INVESTIGATION } from '../scraper/instagram-tavily-investigation.js';
import { createInstagramWebAccess } from '../scraper/instagram-web-access-policy.js';
import { retryAfterAt } from '../scraper/source-http-policy.js';
import { partitionInstagramAiDeals } from './validate-instagram-ai-output.mjs';

const claimFile = 'source-state/instagram-tavily-verification-claim.json';
const outputDirectory = 'output/social-discovery';
const startFile = path.join(outputDirectory, '.instagram-tavily-verification.started');
const sourceReadCap = 6;
const postAgeMs = 7 * 86_400_000;
const captionLimit = 1200; // Upper bound read by the existing Instagram offer-date gate.
const normalizeText = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const clean = (value, max) => normalizeText(value).slice(0, max);
// Match the ordinary Instagram AI direct preview's existing request headers.
const previewHeaders = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
const rows = value => Array.isArray(value) ? value : [];
const readJson = (file, optional = false) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (!optional || error.code !== 'ENOENT') throw error; return {}; }
};

function matchOriginal(value, url) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value, url);
    if (parsed.search || parsed.hash) return false;
    const candidate = normalizeInstagramTavilyUrl(parsed.href);
    return Boolean(candidate) && canonicalInstagramPostKey(candidate) === canonicalInstagramPostKey(url);
  } catch { return false; }
}

function absolutePostDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return '';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function exactPostProof(html, url) {
  const $ = load(html);
  $('template,[hidden],[aria-hidden="true"]').remove();
  $('[style]').filter((_, node) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(node).attr('style'))).remove();
  const meta = key => $('meta[property="' + key + '"]').attr('content');
  const identities = [$('link[rel="canonical"]').attr('href'), meta('og:url')].filter(Boolean);
  if (identities.some(value => !matchOriginal(value, url))) return { reason: 'original-identity-mismatch' };
  const dated = new Map();
  const recordDate = (value, source) => {
    const date = absolutePostDate(value);
    if (date && !dated.has(date)) dated.set(date, source);
  };
  let postTitle = '', postCaption = '', matchingStructured = false;
  $('script[type="application/ld+json"]').slice(0, 12).each((_, node) => {
    let parsed;
    try { parsed = JSON.parse($(node).html()); } catch { return; }
    const entries = Array.isArray(parsed) ? parsed : [parsed, ...rows(parsed?.['@graph'])];
    for (const entry of entries.slice(0, 30)) {
      const types = Array.isArray(entry?.['@type']) ? entry['@type'] : [entry?.['@type']];
      if (!types.some(type => ['SocialMediaPosting', 'VideoObject', 'ImageObject'].includes(type))) continue;
      const references = [entry.url, entry['@id'], typeof entry.mainEntityOfPage === 'string'
        ? entry.mainEntityOfPage : entry.mainEntityOfPage?.['@id']].filter(Boolean);
      if (!references.some(value => matchOriginal(value, url))) continue;
      matchingStructured = true;
      recordDate(entry.datePublished, 'instagram-public-html-datePublished');
      recordDate(entry.uploadDate, 'instagram-public-html-uploadDate');
      postTitle ||= clean(entry.headline || entry.name, 500);
      const caption = normalizeText(entry.caption || entry.description || entry.articleBody);
      if (caption && !isInstagramOpenGraphHeaderOnly(caption)) postCaption ||= caption;
    }
  });
  $('main time[datetime],[role="main"] time[datetime]').slice(0, 30).each((_, node) => {
    if (matchOriginal($(node).closest('a[href]').attr('href'), url)) {
      recordDate($(node).attr('datetime'), 'instagram-public-html-time-datetime');
    }
  });
  if (!identities.length && !matchingStructured) return { reason: 'original-identity-unproven' };
  if (dated.size !== 1) return { reason: dated.size ? 'conflicting-original-dates' : 'missing-bound-original-date' };
  const [[pubDate, pubDateSource]] = dated;
  const title = postTitle || (identities.length ? clean(meta('og:title'), 500) : '');
  const description = postCaption || (identities.length ? normalizeText(meta('og:description')) : '');
  if (isInstagramOpenGraphHeaderOnly(description)) return { reason: 'open-graph-header-only' };
  if (!description) return { reason: 'missing-original-caption' };
  if (description.length > captionLimit) return { reason: 'original-caption-over-limit' };
  return { title, description, pubDate, pubDateSource };
}

async function readOriginalHtml(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_500_000) {
      await reader.cancel().catch(() => {});
      return '';
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function knownPostInventory(inventory, now) {
  const known = knownInstagramPosts(inventory, now);
  for (const [reason, candidates] of [
    ['previously-pending', rows(inventory.pending)],
    ['previously-indexed', rows(inventory.indexed)],
    ['previously-reviewed-instagram-original', rows(inventory.reviewedPosts)],
  ]) {
    for (const candidate of candidates) {
      const key = canonicalInstagramPostKey(candidate?.url || candidate?.postUrl || candidate?.post_url);
      if (key && !known.has(key)) known.set(key, reason);
    }
  }
  for (const key of rows(inventory.seen?.seenPostKeys)) {
    const match = typeof key === 'string' && /^instagram:(?:(?:p|reel|tv):)?([A-Za-z0-9_-]{5,20})$/.exec(key);
    if (match && !known.has('instagram:' + match[1])) known.set('instagram:' + match[1], 'previously-seen');
  }
  for (const post of rows(inventory.graphPosts)) {
    const url = normalizeInstagramTavilyUrl(post?.url || post?.permalink);
    const key = canonicalInstagramPostKey(url);
    if (key && !known.has(key)) known.set(key, 'previously-seen-graph');
  }
  return known;
}

export async function verifyInstagramTavilyOffers({
  links = [], inventory = {}, now = new Date(), clock = () => new Date(), fetcher = fetch,
  previousReport = {}, relatedReport = {}, healthReport = {}, moderation = {}, cookieHeader = '', requireSession = false,
  maxSourceReads = sourceReadCap, boundRenderProof = false,
} = {}) {
  if (!Number.isInteger(maxSourceReads) || maxSourceReads < 1 || maxSourceReads > sourceReadCap) {
    throw new Error('Invalid Instagram original read cap');
  }
  const access = createInstagramWebAccess({ previousReport, relatedReport, healthReport, now: clock });
  const initialAccess = access.snapshot();
  const known = knownPostInventory(inventory, now);
  const campaignKeys = new Set([...rows(inventory.live), ...rows(inventory.pending), ...rows(inventory.indexed)]
    .map(semanticCrossPlatformOfferKey).filter(Boolean));
  const unique = new Map();
  for (const link of rows(links)) {
    const raw = typeof link === 'string' ? link : link?.url;
    const url = normalizeInstagramTavilyUrl(raw);
    if (url && url === raw) unique.set(canonicalInstagramPostKey(url), url);
  }
  const report = { checkedAt: now.toISOString(), canonicalLinks: unique.size, sourceReads: 0,
    knownLinks: 0, verifiedNewOffers: 0, modelCalls: 0, publishedDeals: 0, rows: [] };
  const candidates = [];
  let failures = 0;
  for (const [postKey, url] of unique) {
    const entry = { url, postKey, status: 'unverified' };
    report.rows.push(entry);
    if (known.has(postKey)) {
      Object.assign(entry, { status: 'known', reason: known.get(postKey) });
      report.knownLinks++;
      continue;
    }
    const paused = access.pause();
    if (paused || requireSession && !cookieHeader || report.sourceReads >= maxSourceReads) {
      const reason = paused ? 'web-access-cooldown' : !cookieHeader && requireSession ? 'ordinary-session-unavailable' : 'source-read-cap';
      Object.assign(entry, { status: 'deferred', reason,
        ...(paused ? { nextRetryAt: paused.nextRetryAt } : {}) });
      continue;
    }
    const hold = (status, retryAfter, reason) => {
      const pause = access.failure('all', { status, retryAfter, reason });
      Object.assign(entry, { status: 'blocked', reason: pause.reason, nextRetryAt: pause.nextRetryAt });
    };
    report.sourceReads++;
    let proof;
    try {
      const response = await fetcher(url, {
        method: 'GET', redirect: 'manual', credentials: cookieHeader ? 'same-origin' : 'omit', signal: AbortSignal.timeout(12_000),
        headers: { ...previewHeaders, ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      });
      entry.httpStatus = response.status;
      const retryAfter = response.headers.get('retry-after') || '';
      const location = response.headers.get('location');
      let redirectWall = false;
      try {
        redirectWall = Boolean(location) && response.status >= 300 && response.status < 400
          && instagramPageHasAccessWall({ finalUrl: new URL(location, url).href });
      } catch { /* malformed redirects are unverified */ }
      if ([401, 403, 429].includes(response.status) || redirectWall
        || retryAfterAt(retryAfter, clock())) {
        await response.body?.cancel().catch(() => {});
        hold(response.status, retryAfter, redirectWall ? 'login-wall' : 'transport-failures');
        continue;
      }
      if (response.status >= 500) {
        await response.body?.cancel().catch(() => {});
        throw new Error('source-transport-unavailable');
      }
      failures = 0;
      if (response.status !== 200 || !matchOriginal(response.url || url, url)
        || !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel().catch(() => {});
        entry.reason = 'original-http-or-identity-unverified';
        continue;
      }
      const html = await readOriginalHtml(response);
      if (!html) { entry.reason = 'original-html-unavailable'; continue; }
      if (instagramPageHasAccessWall({ finalUrl: response.url || url, html })) {
        hold(response.status, retryAfter, 'login-wall');
        continue;
      }
      proof = exactPostProof(html, url);
    } catch {
      entry.reason = 'source-transport-unavailable';
      if (++failures >= 3) hold(0, '', 'transport-failures');
      continue;
    }
    if (proof.reason) { entry.reason = proof.reason; continue; }
    if (boundRenderProof) {
      proof.pubDateSource = 'instagram-rendered-time-datetime';
      entry.sourceEvidence = { title: proof.title, caption: proof.description,
        sourcePublishedAt: proof.pubDate, sourcePublishedAtSource: proof.pubDateSource };
    }
    entry.sourcePublishedAt = proof.pubDate;
    const age = +now - Date.parse(proof.pubDate);
    if (age < 0 || age > postAgeMs) {
      Object.assign(entry, { status: 'rejected', reason: 'original-post-outside-freshness-window' });
      continue;
    }
    const candidate = makeCandidate({ url, source: INSTAGRAM_TAVILY_SOURCE });
    candidate.preview = { ...proof, status: 200, loginWall: false, finalUrl: url,
      ...(boundRenderProof ? { captionEvidence: 'exact-original-caption' } : {}) };
    const deal = buildHeuristicDeal(candidate);
    if (boundRenderProof) entry.productionTextCheck = {
      captionEvidence: candidate.preview.captionEvidence, accepted: Boolean(deal),
      reason: candidate.rejectionReason, score: candidate.score, sourcePublishedAt: proof.pubDate,
    };
    if (!deal) {
      Object.assign(entry, { status: 'rejected', reason: clean(candidate.rejectionReason, 180) || 'offer-evidence-insufficient' });
      continue;
    }
    const admitted = partitionInstagramAiDeals([deal], {}, { now });
    if (!admitted.deals.length || !filterModeratedDeals(admitted.deals, moderation).deals.length) {
      Object.assign(entry, { status: 'rejected', reason: 'finished-output-or-moderation', details: Object.keys(admitted.quarantine.reasons) });
      continue;
    }
    const evidenceOnly = async () => { throw new Error('Diagnostic allows no secondary network checks'); };
    const { allowedDeals, results } = await validateDealsForSlack([deal], {
      now, concurrency: 1, fetchOfficialFoodPage: evidenceOnly, fetchCarrierBenefitPage: evidenceOnly,
      fetchViennaBenefitPage: evidenceOnly, reviewedSocialOfficialOptions: { fetchPage: evidenceOnly },
      inspectDealUrlHealth: async target => matchOriginal(target, url)
        ? { ok: true, status: 200, checkedAt: now.toISOString(), finalUrl: url,
          dateHints: { publicationDate: proof.pubDate, publicationDateSource: proof.pubDateSource },
          contentHints: { title: proof.title, description: proof.description } }
        : { invalid: true, reason: 'verified-original-mismatch' },
    });
    if (!allowedDeals.length) {
      Object.assign(entry, { status: 'rejected', reason: 'central-validity',
        details: rows(results[0]?.decision?.reasons).map(reason => clean(reason, 180)) });
      continue;
    }
    const campaignKey = semanticCrossPlatformOfferKey(allowedDeals[0]);
    if (campaignKey && campaignKeys.has(campaignKey)) {
      Object.assign(entry, { status: 'known', reason: 'previously-seen-campaign' });
      report.knownLinks++;
      continue;
    }
    if (campaignKey) campaignKeys.add(campaignKey);
    const { id, brand, title, type, category, distance, validOn, validFrom, validUntil, expires } = allowedDeals[0];
    candidates.push({ id, source: INSTAGRAM_TAVILY_SOURCE, url, brand, title, type, category, distance,
      caption: proof.description, sourcePublishedAt: proof.pubDate, sourcePublishedAtSource: proof.pubDateSource,
      ...(validOn ? { validOn } : {}), ...(validFrom ? { validFrom } : {}),
      ...(validUntil ? { validUntil } : {}), ...(expires ? { expires } : {}) });
    entry.status = 'verified-new-offer';
  }
  report.verifiedNewOffers = candidates.length;
  const webAccess = access.snapshot();
  const webAccessChanges = Object.fromEntries(Object.entries(webAccess).filter(([scope, pause]) =>
    JSON.stringify(pause) !== JSON.stringify(initialAccess[scope])));
  return { report, candidates, webAccess, webAccessChanges, webAccessChanged: Object.keys(webAccessChanges).length > 0 };
}

function loadInventory(docs) {
  const readDeals = name => {
    const payload = readJson(path.join(docs, name));
    return rows(payload?.deals || payload);
  };
  const live = readDeals('deals.json');
  const pending = fs.readdirSync(docs).filter(name => /^deals-pending-.+\.json$/.test(name)).flatMap(readDeals);
  const indexed = readJson(path.join(docs, 'deal-candidates-index.json')).candidates;
  const seen = readJson(path.join(docs, 'slack-seen-posts.json'));
  const graphPosts = readJson(path.join(docs, 'instagram-graph-post-evidence.json')).posts;
  return { live, pending, indexed, seen, graphPosts };
}

function writeJson(file, value) {
  const temporary = file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

async function main() {
  const [receiptFile, action, ...extra] = process.argv.slice(2);
  const runId = process.env.GITHUB_RUN_ID;
  if (!receiptFile || (action && action !== '--claim') || extra.length || !/^\d+$/.test(runId || '')
      || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_RUN_ATTEMPT !== '1') {
    throw new Error('A fresh explicit main-branch original verification and investigation artifact are required');
  }
  const raw = fs.readFileSync(receiptFile);
  const probe = JSON.parse(raw);
  if (probe?.investigation !== INSTAGRAM_TAVILY_INVESTIGATION || !Array.isArray(probe.links)) {
    throw new Error('Expected the saved receipt from this investigation');
  }
  const receiptSha256 = createHash('sha256').update(raw).digest('hex');
  if (action === '--claim') {
    fs.mkdirSync(path.dirname(claimFile), { recursive: true });
    const claim = { investigation: INSTAGRAM_TAVILY_INVESTIGATION, runId, receiptSha256,
      claimedAt: new Date().toISOString(), maximumSourceReads: sourceReadCap };
    try {
      fs.writeFileSync(claimFile, JSON.stringify(claim, null, 2) + '\n', { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      console.log('Original verification already claimed.');
      return;
    }
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'claimed=true\n');
    return;
  }
  const claim = readJson(claimFile);
  if (claim?.investigation !== INSTAGRAM_TAVILY_INVESTIGATION || claim.runId !== runId || claim.receiptSha256 !== receiptSha256) {
    throw new Error('Matching durable original verification claim required');
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(startFile, runId + '\n', { flag: 'wx' });
  const docs = path.resolve('docs');
  const reportPath = path.join(docs, 'instagram-ai-report.json');
  const cookies = loadInstagramCookieHints();
  const cookieHeader = instagramAuthSummary(cookies).authenticatedSession ? instagramCookieHeader(cookies) : '';
  const result = await verifyInstagramTavilyOffers({
    links: probe.links,
    inventory: loadInventory(docs),
    moderation: loadDealModeration(path.join(docs, 'deal-moderation.json')),
    previousReport: readJson(reportPath, true),
    relatedReport: readJson(path.join(docs, 'instagram-discovery-report.json'), true),
    healthReport: readJson(path.join(docs, 'instagram-auth-health.json'), true),
    cookieHeader, requireSession: true,
  });
  if (result.webAccessChanged) {
    const latest = readJson(reportPath, true);
    const webAccess = { ...latest.webAccess };
    let changed = false;
    for (const [scope, pause] of Object.entries(result.webAccessChanges)) {
      if (Date.parse(pause.nextRetryAt) <= (Date.parse(webAccess[scope]?.nextRetryAt) || 0)) continue;
      webAccess[scope] = pause;
      changed = true;
    }
    if (changed) {
      writeJson(reportPath, { ...latest, webAccess });
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'web_access_changed=true\n');
    }
  }
  writeJson(path.join(outputDirectory, 'instagram-tavily-offers.json'), result.report);
  writeJson(path.join(outputDirectory, 'instagram-tavily-offers.candidates.json'), {
    version: 1, checkedAt: result.report.checkedAt, candidates: result.candidates,
  });
  console.log(JSON.stringify(result.report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Instagram original verification could not be completed'); process.exitCode = 1; });
}
