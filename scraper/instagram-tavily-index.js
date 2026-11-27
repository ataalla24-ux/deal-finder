import fs from 'node:fs';
import path from 'node:path';
import { canonicalInstagramPostKey } from './deal-evidence-utils.js';
import { normalizeInstagramPublicPostUrl } from './instagram-page-access.js';

export const INSTAGRAM_TAVILY_CACHE = 'source-state/instagram-tavily-index.json';
export const INSTAGRAM_TAVILY_SOURCE = 'tavily-public-index';
const DAY_MS = 86_400_000;
const MAX_LEADS = 20;
const QUERY_TOPICS = ['gratis Essen und Getränke Neueröffnung', '1+1 Rabatt Restaurant Kaffee', 'Gratis Pizza Burger Kebab Angebot'];

export function buildInstagramTavilyQuery(now) {
  const index = Math.floor(+now / DAY_MS) % QUERY_TOPICS.length;
  return `Wien Instagram öffentliche Beiträge oder Reels ${QUERY_TOPICS[index]}`;
}

export function normalizeInstagramTavilyUrl(value) {
  if (typeof value !== 'string' || value.length > 600) return '';
  const url = normalizeInstagramPublicPostUrl(value);
  return /^https:\/\/www\.instagram\.com\/(?:p|reel)\//.test(url) ? url : '';
}

export function getInstagramTavilyLeads(cache, now = new Date()) {
  if (!Array.isArray(cache?.links)) return [];
  const unique = new Map();
  for (const entry of cache.links.slice(0, MAX_LEADS)) {
    const url = normalizeInstagramTavilyUrl(entry?.url);
    const indexedAt = Date.parse(entry?.indexedAt);
    if (!url || entry?.source !== INSTAGRAM_TAVILY_SOURCE || !(indexedAt <= +now && indexedAt > +now - 7 * DAY_MS)) continue;
    const key = canonicalInstagramPostKey(url);
    if (!unique.has(key)) unique.set(key, { url, source: INSTAGRAM_TAVILY_SOURCE, indexedAt: new Date(indexedAt).toISOString() });
  }
  return [...unique.values()];
}

export function readInstagramTavilyCache(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value?.version !== 1 || !Array.isArray(value.links) || typeof value.nextRetryAt !== 'string') return null;
    if (value.nextRetryAt && !Number.isFinite(Date.parse(value.nextRetryAt))) return null;
    if (value.lastProbeAt !== undefined && !Number.isFinite(Date.parse(value.lastProbeAt))) return null;
    return value;
  } catch (error) {
    return error.code === 'ENOENT' ? {} : null;
  }
}

export function updateInstagramTavilyCache(previous, result, { probe = false, now = new Date() } = {}) {
  if (previous === null) return null;
  const index = result.instagramIndex;
  const nextRetryAt = result.nextRetryAt || '';
  if (!index?.attemptedQueries && (!nextRetryAt || nextRetryAt === previous?.nextRetryAt)) return null;
  const indexedAt = now.toISOString();
  const previousLeads = getInstagramTavilyLeads(previous, now);
  const existing = new Set(previousLeads.map(lead => canonicalInstagramPostKey(lead.url)));
  // A rediscovered URL preserves its original discovery clock. Tavily search
  // times and excerpts never count as original Instagram publication evidence.
  const fresh = (index?.links || []).filter(url => !existing.has(canonicalInstagramPostKey(url)))
    .map(url => ({ url, source: INSTAGRAM_TAVILY_SOURCE, indexedAt }));
  const links = getInstagramTavilyLeads({ links: [...fresh, ...previousLeads] }, now);
  const probeAt = probe && index?.attemptedQueries ? indexedAt : previous?.lastProbeAt;
  return { version: 1, updatedAt: indexedAt, nextRetryAt, ...(probeAt ? { lastProbeAt: probeAt } : {}), links };
}

export function writeInstagramTavilyCache(file, cache, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    fileSystem.writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, { flag: 'wx' });
    fileSystem.renameSync(temporary, file);
  } finally {
    fileSystem.rmSync(temporary, { force: true });
  }
}
