import { readFileSync } from 'node:fs';
import path from 'node:path';

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
const canonicalUrl = /^https:\/\/www\.tiktok\.com\/@[a-zA-Z0-9._-]{2,40}\/video\/([1-9]\d{15,21})$/;
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

export function readKnownTikTokLinks(docsDir, { now = new Date() } = {}) {
  const seenKeys = readRows(docsDir, 'slack-seen-posts.json', 'seenPostKeys');
  const knownLists = knownQueues.map(([file, field]) => readRows(docsDir, file, field));
  if (!seenKeys || knownLists.includes(null)) return [];

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
      if (typeof row?.url !== 'string') continue;
      const match = canonicalUrl.exec(row.url);
      if (!match || match[0] !== row.url) continue;
      const videoId = match[1];
      if (knownDealIds.has(row.id)) knownVideoIds.add(videoId);
      if (typeof row.discoveredAt !== 'string' || !discoveryTimestamp.test(row.discoveredAt)) continue;
      const age = +now - Date.parse(row.discoveredAt);
      if (!Number.isFinite(age) || age < 0 || age > maxDiscoveryAge) continue;
      const existingUrl = links.get(videoId);
      if (!existingUrl || row.url < existingUrl) links.set(videoId, row.url);
    }
  }

  // Stable order independent of queue rewrites. No timestamp or offer evidence
  // is derived from the ID, discovery date, or the referring feed's copy.
  return [...links.keys()]
    .filter(id => !knownVideoIds.has(id))
    .sort((a, b) => b.length - a.length || b.localeCompare(a, 'en'))
    .slice(0, maxLinks)
    .map(id => links.get(id));
}
