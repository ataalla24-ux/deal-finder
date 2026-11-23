import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSocialPostKey, semanticCrossPlatformOfferKey } from '../scraper/deal-evidence-utils.js';
import { filterModeratedDeals } from '../scraper/deal-moderation-utils.js';
import { githubRunProvenance } from '../scraper/pipeline-run-report-utils.js';
import { buildDealFromPost } from '../scraper/tiktok-deals-scanner.js';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const outputName = 'deals-pending-tiktok-browser.json';
const outboxSource = 'TikTok Browser';
const maxBytes = 55_000;
const maxPosts = 20;
const maxOutbox = 120;
const maxAge = 7 * 24 * 60 * 60 * 1000;
const videoPath = /^\/@([a-zA-Z0-9._-]{2,40})\/video\/(\d{16,22})\/?$/;
const postFields = new Set(['url', 'caption', 'createTime']);
const genericMerchant = /^@|^(?:TikTok(?: Wien)?|Wien|Vienna)$/iu;
const streetWithHouseNumber = /(?:stra(?:ß|ss)e|str\.?|gasse|platz|weg|ring|allee|kai|markt|zeile|promenade|graben|ufer|steg)\s+\d{1,4}[a-z]?(?=\s|[-/]|$)/iu;

function isCurrent(date, now) {
  const age = +now - +date;
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
}

export function parseTikTokBrowserBatch(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > maxBytes) {
    throw new Error('TikTok browser batch is missing or exceeds 55,000 bytes');
  }
  let batch;
  try {
    batch = JSON.parse(input);
  } catch {
    throw new Error('TikTok browser batch is not valid JSON');
  }
  if (batch?.version !== 1 || Object.keys(batch).some(key => !['version', 'posts'].includes(key))
    || !Array.isArray(batch.posts) || batch.posts.length > maxPosts) {
    throw new Error('TikTok browser batch must contain version 1 and at most 20 posts');
  }
  return batch.posts;
}

function publicPostEvidence(post, now) {
  if (!post || typeof post !== 'object' || Array.isArray(post)
    || Object.keys(post).some(key => !postFields.has(key))
    || typeof post.url !== 'string' || post.url.length > 240
    || typeof post.caption !== 'string' || !post.caption.trim() || post.caption.length > 1800
    || !post.caption.isWellFormed()
    || (typeof post.createTime !== 'string' && typeof post.createTime !== 'number')) return null;
  let url;
  try {
    url = new URL(post.url);
  } catch {
    return null;
  }
  const match = videoPath.exec(url.pathname);
  if (!match || !['https://www.tiktok.com', 'https://tiktok.com', 'https://m.tiktok.com'].includes(url.origin)
    || url.username || url.password || url.search || url.hash) return null;
  const [, accountHandle, videoId] = match;
  const publicUrl = `https://www.tiktok.com/@${accountHandle}/video/${videoId}`;
  const seconds = String(post.createTime);
  if (!/^[1-9]\d{9}$/.test(seconds)) return null;
  const date = new Date(Number(seconds) * 1000);
  if (!isCurrent(date, now)) return null;
  return { url: publicUrl, accountHandle, description: post.caption, timeDateTime: date.toISOString() };
}

export function importTikTokBrowserPosts(posts, {
  knownDeals = [], previous = [], seenPostKeys = [], moderation = {}, now = new Date(),
} = {}) {
  const knownIds = new Set(knownDeals.map(row => row.id).filter(Boolean));
  const knownPosts = new Set(seenPostKeys);
  const knownOffers = new Set();
  for (const row of [...knownDeals, ...previous]) {
    const key = canonicalSocialPostKey(row.url);
    const offer = semanticCrossPlatformOfferKey(row);
    if (key) knownPosts.add(key);
    if (offer) knownOffers.add(offer);
  }
  const retained = previous.filter(row => isCurrent(new Date(row.sourcePublishedAt), now));
  const added = [];
  const counts = { received: posts.length, accepted: 0, invalid: 0, rejected: 0, duplicate: 0, capacity: 0 };
  for (const post of posts) {
    const evidence = publicPostEvidence(post, now);
    if (!evidence) { counts.invalid++; continue; }
    const key = canonicalSocialPostKey(evidence.url);
    if (knownPosts.has(key)) { counts.duplicate++; continue; }
    const { deal } = buildDealFromPost(evidence.url, evidence, { now, discoveredAt: now });
    // A handle fallback or street address cannot resolve the offer merchant.
    const brand = deal?.brand?.trim();
    if (!brand || genericMerchant.test(brand) || streetWithHouseNumber.test(brand)) {
      counts.rejected++;
      continue;
    }
    const candidate = { ...deal, source: 'TikTok', collectionMode: 'authenticated-browser',
      pubDateSource: 'tiktok-timestamp', sourcePublishedAtSource: 'tiktok-timestamp' };
    if (filterModeratedDeals([candidate], moderation).deals.length !== 1) {
      counts.rejected++;
      continue;
    }
    const offer = semanticCrossPlatformOfferKey(candidate);
    if (knownIds.has(candidate.id) || (offer && knownOffers.has(offer))) {
      counts.duplicate++;
      continue;
    }
    if (retained.length + added.length >= maxOutbox) { counts.capacity++; continue; }
    knownIds.add(candidate.id);
    knownPosts.add(key);
    if (offer) knownOffers.add(offer);
    added.push(candidate);
  }
  counts.accepted = added.length;
  return { added, deals: [...retained, ...added], counts };
}

function readJson(file, missing) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && missing !== undefined) return missing;
    throw new Error('TikTok browser input or stored state could not be read');
  }
}

function rows(file, field = 'deals', allowMissing = false) {
  const value = readJson(path.join(docs, file), allowMissing ? { [field]: [] } : undefined)[field];
  if (!Array.isArray(value)) throw new Error('TikTok browser stored state has an invalid schema');
  return value;
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_OUTPUT) {
    throw new Error('TikTok browser import requires its GitHub workflow dispatch');
  }
  // The event file keeps the input out of Actions' printed per-step env block.
  const input = readJson(process.env.GITHUB_EVENT_PATH).inputs?.browsed_posts;
  const posts = parseTikTokBrowserBatch(input);
  const now = new Date();
  const result = posts.length ? importTikTokBrowserPosts(posts, {
    now,
    knownDeals: [
      ...rows('deals.json'),
      ...rows('deals-pending-all.json'),
      ...rows('deals-pending-tiktok.json'),
      ...rows('deal-candidates-index.json', 'candidates'),
    ],
    previous: rows(outputName, 'deals', true),
    seenPostKeys: rows('slack-seen-posts.json', 'seenPostKeys'),
    moderation: readJson(path.join(docs, 'deal-moderation.json')),
  }) : { added: [], counts: { received: 0, accepted: 0 } };
  if (result.added.length) {
    const file = path.join(docs, outputName);
    const temporary = `${file}.${process.pid}.tmp`;
    const payload = { version: 1, source: outboxSource, lastUpdated: now.toISOString(), totalDeals: result.deals.length,
      runProvenance: githubRunProvenance(), deals: result.deals };
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
  }
  console.log(JSON.stringify(result.counts));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    console.error('TikTok browser import failed validation or could not update its outbox.');
    process.exitCode = 1;
  }
}
