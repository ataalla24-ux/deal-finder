import fs from 'node:fs';
import path from 'node:path';

import {
  canonicalInstagramPostKey,
  decodeInstagramShortcodeDate,
  extractStructuredOwnerUsername,
  getPublicationEvidence,
  mergeDealEvidence,
} from './deal-evidence-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EVIDENCE_PATH = path.join(process.cwd(), 'docs', 'instagram-graph-post-evidence.json');
const HARD_BLOCKING_REASONS = new Set([
  'self-syndicated-deal',
  'non-vienna-location',
  'offer-expired',
  'excluded-promotion-type',
  'post-too-old',
]);

function cleanText(value, max = 2000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function toIso(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function normalizeUsername(value) {
  const username = cleanText(value, 100).replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{2,40}$/.test(username) ? username : '';
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function candidateText(deal = {}) {
  return [
    deal.title,
    deal.description,
    deal.preview?.title,
    deal.preview?.description,
    deal.preview?.text,
    deal.postCaption,
    deal.caption,
    deal.evidence?.offerDateSignal,
    deal.evidence?.textSample,
  ].map((value) => cleanText(value, 5000)).filter(Boolean).join(' ');
}

export function inferInstagramPostingUsername(deal = {}) {
  const structured = extractStructuredOwnerUsername({
    ...deal,
    ownerUsername: deal.ownerUsername
      || deal.profileAccount
      || deal.postVerification?.ownerUsername
      || deal.evidence?.originalPost?.ownerUsername,
  });
  if (structured) return structured;

  const signal = candidateText(deal);
  const patterns = [
    /\b(?:likes?|comments?|kommentare?)\s*-\s*([a-z0-9._]{2,40})\s+(?:am|on|vom)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|januar|februar|m(?:aerz|ärz)|mai|juni|juli|oktober|dezember)\b/i,
    /(?:^|[.!?]\s+)([a-z0-9._]{2,40})\s+(?:auf\s+Instagram|on\s+Instagram)\s*:/i,
  ];
  for (const pattern of patterns) {
    const username = normalizeUsername(signal.match(pattern)?.[1]);
    if (username) return username;
  }
  return '';
}

export function getInstagramCandidatePublication(deal = {}) {
  const publication = getPublicationEvidence(deal);
  if (publication.sourcePublishedAt) return publication;
  const url = cleanText(deal.url || deal.post_url || deal.postUrl, 1000);
  const decoded = decodeInstagramShortcodeDate(url);
  if (!decoded) return publication;
  return {
    sourcePublishedAt: decoded.toISOString(),
    sourcePublishedAtSource: 'url.instagramShortcode',
    publicationEvidenceRank: 4,
    discoveredAt: publication.discoveredAt || '',
  };
}

export function graphPostEvidenceFromEntry(entry, outcome = {}, now = new Date()) {
  const item = entry?.item || {};
  const url = cleanText(item.permalink, 1000);
  const postKey = canonicalInstagramPostKey(url);
  const sourcePublishedAt = toIso(item.timestamp);
  if (!postKey || !sourcePublishedAt) return null;

  const account = entry?.context?.account || {};
  const username = normalizeUsername(item.username || account.username);
  const rejection = cleanText(outcome?.rejection, 100);
  const ageMs = now.getTime() - Date.parse(sourcePublishedAt);
  const blockingReason = HARD_BLOCKING_REASONS.has(rejection)
    && (rejection !== 'post-too-old' || ageMs > 7 * DAY_MS)
      ? rejection
      : '';
  const sourceType = cleanText(entry?.context?.sourceType, 40);
  const mediaEvidence = item?._mediaEvidence && typeof item._mediaEvidence === 'object'
    ? item._mediaEvidence
    : {};

  return {
    postKey,
    url,
    mediaId: cleanText(item.id, 160),
    ownerUsername: username,
    sourcePublishedAt,
    sourcePublishedAtSource: 'instagram-graph-timestamp',
    mediaType: cleanText(item.media_type, 40),
    mediaProductType: cleanText(item.media_product_type, 40),
    caption: cleanText(item.caption, 1800),
    ocrText: cleanText(mediaEvidence.ocrText, 1800),
    graphAccepted: Boolean(outcome?.deal),
    graphRejection: rejection,
    blockingReason,
    sourceTypes: sourceType ? [sourceType] : [],
    sourceNames: cleanText(entry?.context?.sourceName, 100) ? [cleanText(entry.context.sourceName, 100)] : [],
    verifiedAt: now.toISOString(),
  };
}

function mergePostEvidence(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  const newest = Date.parse(next.verifiedAt || '') >= Date.parse(previous.verifiedAt || '') ? next : previous;
  const older = newest === next ? previous : next;
  return {
    ...older,
    ...newest,
    ownerUsername: newest.ownerUsername || older.ownerUsername,
    caption: newest.caption || older.caption,
    ocrText: newest.ocrText || older.ocrText,
    sourceTypes: [...new Set([...(older.sourceTypes || []), ...(newest.sourceTypes || [])])],
    sourceNames: [...new Set([...(older.sourceNames || []), ...(newest.sourceNames || [])])],
  };
}

export function buildInstagramGraphEvidencePayload(entries = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const retentionDays = Math.max(7, Number(options.retentionDays) || 14);
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const previousPosts = Array.isArray(options.previous?.posts) ? options.previous.posts : [];
  const byKey = new Map();

  for (const post of previousPosts) {
    const timestamp = Date.parse(post?.sourcePublishedAt || '');
    if (!post?.postKey || !Number.isFinite(timestamp) || timestamp < cutoff) continue;
    byKey.set(post.postKey, post);
  }

  for (const value of entries) {
    const post = value?.postKey
      ? value
      : graphPostEvidenceFromEntry(value?.entry || value, value?.outcome || {}, now);
    if (!post?.postKey) continue;
    const timestamp = Date.parse(post.sourcePublishedAt || '');
    if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now.getTime() + 10 * 60 * 1000) continue;
    byKey.set(post.postKey, mergePostEvidence(byKey.get(post.postKey), post));
  }

  const posts = [...byKey.values()]
    .sort((left, right) => Date.parse(right.sourcePublishedAt) - Date.parse(left.sourcePublishedAt))
    .slice(0, Math.max(100, Number(options.maxPosts) || 2000));

  return {
    generatedAt: now.toISOString(),
    source: 'meta-instagram-graph-evidence',
    totalPosts: posts.length,
    blockedPosts: posts.filter((post) => post.blockingReason).length,
    posts,
  };
}

export function loadInstagramGraphEvidence(filePath = DEFAULT_EVIDENCE_PATH) {
  const payload = readJson(filePath, {});
  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  return {
    payload,
    byKey: new Map(posts.filter((post) => post?.postKey).map((post) => [post.postKey, post])),
  };
}

export function writeInstagramGraphEvidence(payload, filePath = DEFAULT_EVIDENCE_PATH) {
  writeJsonAtomic(filePath, payload);
}

export function enrichDealWithInstagramGraphEvidence(deal = {}, evidenceIndex, options = {}) {
  const byKey = evidenceIndex instanceof Map ? evidenceIndex : evidenceIndex?.byKey;
  const postKey = canonicalInstagramPostKey(deal.url || deal.post_url || deal.postUrl);
  const post = postKey && byKey instanceof Map ? byKey.get(postKey) : null;
  if (!post) return { deal, matched: false, blocked: false };

  const graphRecord = {
    url: post.url,
    ownerUsername: post.ownerUsername,
    sourcePublishedAt: post.sourcePublishedAt,
    sourcePublishedAtSource: post.sourcePublishedAtSource || 'instagram-graph-timestamp',
    pubDate: post.sourcePublishedAt,
    pubDateSource: post.sourcePublishedAtSource || 'instagram-graph-timestamp',
    metaGraphVerified: true,
    metaGraphVerifiedAt: post.verifiedAt,
    metaGraphMediaId: post.mediaId,
    metaGraphCaption: post.caption,
    metaGraphOcrText: post.ocrText,
    metaGraphAccepted: post.graphAccepted,
    metaGraphRejection: post.graphRejection,
    metaGraphBlockingReason: post.blockingReason,
  };
  const enriched = mergeDealEvidence(deal, graphRecord, options);
  // An exact Graph permalink match is authoritative. Scraper timestamps can be
  // inferred or copied incorrectly, so never let a newer estimate outrank Meta.
  enriched.sourcePublishedAt = post.sourcePublishedAt;
  enriched.sourcePublishedAtSource = post.sourcePublishedAtSource || 'instagram-graph-timestamp';
  enriched.pubDate = post.sourcePublishedAt;
  enriched.pubDateSource = post.sourcePublishedAtSource || 'instagram-graph-timestamp';
  if (post.ownerUsername) enriched.ownerUsername = post.ownerUsername;
  enriched.metaGraphVerified = true;
  enriched.metaGraphVerifiedAt = post.verifiedAt;
  enriched.metaGraphMediaId = post.mediaId;
  enriched.metaGraphCaption = post.caption;
  enriched.metaGraphOcrText = post.ocrText;
  enriched.metaGraphAccepted = post.graphAccepted;
  enriched.metaGraphRejection = post.graphRejection;
  enriched.metaGraphBlockingReason = post.blockingReason;
  enriched.evidenceSources = [...new Set([
    ...(Array.isArray(enriched.evidenceSources) ? enriched.evidenceSources : []),
    'Meta Instagram Graph Evidence',
  ])];
  return { deal: enriched, matched: true, blocked: Boolean(post.blockingReason), evidence: post };
}

export function candidateIsFreshForGraph(deal, now = new Date(), maxAgeDays = 7) {
  const publication = getInstagramCandidatePublication(deal);
  const timestamp = Date.parse(publication.sourcePublishedAt || '');
  const hardMaxAgeDays = Math.min(7, Math.max(1, Number(maxAgeDays) || 7));
  return Number.isFinite(timestamp)
    && timestamp <= now.getTime() + 10 * 60 * 1000
    && now.getTime() - timestamp <= hardMaxAgeDays * DAY_MS;
}

export { DEFAULT_EVIDENCE_PATH };
