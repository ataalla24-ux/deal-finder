import { readFileSync } from 'node:fs';
import path from 'node:path';
import { moderationReasonForDeal } from './deal-moderation-utils.js';

const leadQueues = ['deals-pending-firecrawl4.json', 'deals-pending-gastro2.json'];
const knownQueues = [
  ['deal-review-feedback.json', 'events'],
  ['deals.json', 'deals'],
  ['deals-pending-all.json', 'deals'],
  ['deals-pending-tiktok.json', 'deals'],
  ['deals-pending-tiktok-browser.json', 'deals'],
];
const maxDiscoveryAge = 7 * 24 * 60 * 60 * 1000;
const maxLinks = 20;
const maxIndexWait = 48 * 60 * 60 * 1000;
const indexSources = ['duckduckgo', 'tavily'];
const canonicalUrl = /^https:\/\/www\.tiktok\.com\/@([a-zA-Z0-9._-]{2,40})\/video\/([1-9]\d{15,21})$/;
const selfAccountKeys = new Set(['freefinder', 'freefinderat', 'freefinderwien']);
// Older stored URLs can have a mobile hostname or tracking parameters. These
// are used only for duplicate matching and can never become navigation targets.
const storedUrl = /^https?:\/\/(?:(?:www|m)\.)?tiktok\.com\/@[a-zA-Z0-9._-]{2,40}\/video\/([1-9]\d{15,21})(?:\/?(?:[?#].*)?)$/i;
const postKey = /^tiktok:video:([1-9]\d{15,21})$/;
const discoveryTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function storedVideoId(value) {
  if (typeof value === 'string') return postKey.exec(value)?.[1] ?? storedUrl.exec(value)?.[1];
}

function readDocument(docsDir, filename) {
  try {
    return JSON.parse(readFileSync(path.join(docsDir, filename), 'utf8'));
  } catch {
    return null;
  }
}

function readRows(docsDir, filename, field) {
  const rows = readDocument(docsDir, filename)?.[field];
  return Array.isArray(rows) ? rows : null;
}

function canonicalVideo(value) {
  if (typeof value !== 'string') return null;
  const match = canonicalUrl.exec(value);
  return match && match[0] === value ? match : null;
}

function isSelfHandle(handle) {
  return selfAccountKeys.has(handle.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

function readTikTokLeadState(docsDir, now) {
  const seenKeys = readRows(docsDir, 'slack-seen-posts.json', 'seenPostKeys');
  const knownLists = knownQueues.map(([file, field]) => readRows(docsDir, file, field));
  const moderation = readDocument(docsDir, 'deal-moderation.json');
  if (!seenKeys || knownLists.includes(null) || !moderation) return null;

  const knownVideoIds = new Set();
  const historicalSent = readDocument(docsDir, 'sent-deal-ids.json');
  const knownDealIds = new Set(Object.keys(historicalSent ?? {}));
  for (const value of seenKeys) {
    const videoId = storedVideoId(value);
    if (videoId) knownVideoIds.add(videoId);
  }
  for (const list of knownLists) {
    for (const row of list) {
      if (!row) continue;
      if (row.id) knownDealIds.add(row.id);
      if (row.dealId) knownDealIds.add(row.dealId);
      for (const value of [row.postKey, row.key, row.url, row.postUrl]) {
        const videoId = storedVideoId(value);
        if (videoId) knownVideoIds.add(videoId);
      }
    }
  }

  const links = new Map();
  for (const file of leadQueues) {
    for (const row of readRows(docsDir, file, 'deals') ?? []) {
      const match = canonicalVideo(row?.url);
      if (!match) continue;
      const [, handle, videoId] = match;
      if (isSelfHandle(handle) || knownDealIds.has(row.id) || moderationReasonForDeal(row, moderation)) knownVideoIds.add(videoId);
      if (typeof row.discoveredAt !== 'string' || !discoveryTimestamp.test(row.discoveredAt)) continue;
      const age = +now - Date.parse(row.discoveredAt);
      if (age > maxDiscoveryAge) knownVideoIds.add(videoId);
      if (!Number.isFinite(age) || age < 0 || age > maxDiscoveryAge) continue;
      const existingUrl = links.get(videoId);
      if (!existingUrl || row.url < existingUrl) links.set(videoId, row.url);
    }
  }

  return { links, knownVideoIds, moderation };
}

export function readKnownTikTokLinks(docsDir, { now = new Date() } = {}) {
  const state = readTikTokLeadState(docsDir, now);
  if (!state) return [];
  const { links, knownVideoIds } = state;
  // Stable order independent of queue rewrites. No timestamp or offer evidence
  // is derived from the ID, discovery date, or the referring feed's copy.
  return [...links.keys()]
    .filter(id => !knownVideoIds.has(id))
    .sort((a, b) => b.length - a.length || b.localeCompare(a, 'en'))
    .slice(0, maxLinks)
    .map(id => links.get(id));
}

export function selectTikTokIndexedLeads(docsDir, {
  previous = [], duckduckgo = [], tavily = [], now = new Date(),
} = {}) {
  const state = readTikTokLeadState(docsDir, now);
  if (!state) return [];
  const { knownVideoIds, moderation } = state;
  const leads = new Map();
  function add(url, sources, seenAt) {
    const match = canonicalVideo(url);
    if (!match) return;
    const [, handle, id] = match;
    if (isSelfHandle(handle) || moderationReasonForDeal({ url }, moderation)) knownVideoIds.add(id);
    if (knownVideoIds.has(id) || !sources.length || !Number.isFinite(seenAt) || seenAt > +now) return;
    // A repeat in an index cannot extend a stored lead's deadline.
    if (+now - seenAt >= maxIndexWait) {
      knownVideoIds.add(id);
      return;
    }
    const existing = leads.get(id);
    if (existing) {
      existing.firstSeenAt = Math.min(seenAt, existing.firstSeenAt);
      existing.sources = indexSources.filter(source => existing.sources.includes(source) || sources.includes(source));
    } else {
      leads.set(id, { url, sources, firstSeenAt: seenAt });
    }
  }

  for (const row of Array.isArray(previous) ? previous.slice(0, maxLinks) : []) {
    if (!Array.isArray(row?.sources) || !discoveryTimestamp.test(row.firstSeenAt)) continue;
    add(row.url, indexSources.filter(source => row.sources.includes(source)), Date.parse(row.firstSeenAt));
  }
  for (const [source, urls] of [['tavily', tavily], ['duckduckgo', duckduckgo]]) {
    for (const url of Array.isArray(urls) ? urls : []) add(url, [source], +now);
  }

  return [...leads].filter(([id]) => !knownVideoIds.has(id))
    .map(([, row]) => row)
    .sort((first, second) => first.firstSeenAt - second.firstSeenAt)
    .map(row => ({ ...row, firstSeenAt: new Date(row.firstSeenAt).toISOString() }));
}

export function retainUnattemptedTikTokIndexLeads(leads, attemptedUrls = []) {
  const attemptedIds = new Set(Array.from(attemptedUrls, url => canonicalVideo(url)?.[2]));
  return leads.filter(row => !attemptedIds.has(canonicalVideo(row.url)?.[2])).slice(0, maxLinks);
}
