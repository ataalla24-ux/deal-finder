import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  canonicalInstagramPostKey,
  decodeInstagramShortcodeDate,
  extractStructuredOwnerUsername,
  getPublicationEvidence,
  getViennaEvidence,
} from './deal-evidence-utils.js';
import { inspectDealUrlHealth } from './expiry-utils.js';
import { extractActiveOfferWindow } from './instagram-ai-validity-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_REGISTRY_PATH = path.join(ROOT, 'docs', 'instagram-merchant-registry.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const SYNTHETIC_PUBLICATION_SOURCE_PATTERN = /(?:firecrawl.*run|agent(?:\s|[-_])?run|crawl(?:ed|er)?(?:\s|[-_])?(?:at|run|time)|scrap(?:ed|er)?(?:\s|[-_])?(?:at|run|time)|discover(?:ed|y)(?:\s|[-_])?(?:at|run|time)?|generated(?:\s|[-_])?at|fallback|current(?:\s|[-_])?time)/i;
const OFFER_SIGNAL_PATTERN = /(?:\bgratis\b|\bkostenlos\b|\bfree\b|\b1\s*[+&]\s*1\b|\b2\s*(?:für|for)\s*1\b|\b\d{1,2}\s*%|\brabatt\b|\baktion\b|\bangebot\b|\bdeal\b|\bhappy hour\b|\bstatt\s+(?:€\s*)?\d)/i;
const VIENNA_SIGNAL_PATTERN = /\b(?:wien|vienna)\b|(?:^|\D)1(?:0[1-9]|1\d|2[0-3])0(?!\d)/i;

function cleanText(value, maxLength = Infinity) {
  const text = value === null || value === undefined
    ? ''
    : String(value).replace(/\s+/g, ' ').trim();
  return Number.isFinite(maxLength) ? text.slice(0, maxLength) : text;
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function normalizeUsername(value) {
  const username = cleanText(value).replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{2,40}$/.test(username) ? username : '';
}

export function normalizeInstagramPostUrl(value) {
  const text = cleanText(value);
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    const parsed = new URL(text);
    const hostname = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');
    if (hostname !== 'instagram.com') return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const typeIndex = parts.findIndex((part) => /^(?:p|reel|reels|tv)$/i.test(part));
    if (typeIndex < 0 || !parts[typeIndex + 1]) return '';
    const type = /^reels?$/i.test(parts[typeIndex]) ? 'reel' : parts[typeIndex].toLowerCase();
    const shortcode = parts[typeIndex + 1].replace(/[^A-Za-z0-9_-].*$/, '');
    return shortcode ? `https://www.instagram.com/${type}/${shortcode}/` : '';
  } catch {
    return '';
  }
}

export function loadVerifiedViennaMerchantRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const registry = readJson(registryPath, {});
  const accounts = Array.isArray(registry?.accounts) ? registry.accounts : [];
  return new Map(accounts
    .filter((entry) => entry?.viennaVerified === true && cleanText(entry?.accountType || 'merchant').toLowerCase() === 'merchant')
    .map((entry) => [normalizeUsername(entry.username), entry])
    .filter(([username]) => username));
}

export function extractInstagramOwnerUsername(health = {}, fallback = '') {
  const signal = [
    health?.contentHints?.description,
    health?.contentHints?.title,
    health?.contentHints?.textSnippet,
  ].map((value) => cleanText(value, 2400)).filter(Boolean).join(' ');

  const patterns = [
    /\bcomments?\s*-\s*([a-z0-9._]{2,40})\s+(?:on|am)\b/i,
    /\bkommentare?\s*-\s*([a-z0-9._]{2,40})\s+(?:am|vom)\b/i,
    /(?:^|[\s"'(])@([a-z0-9._]{2,40})(?=$|[\s"',).:])/i,
  ];
  for (const pattern of patterns) {
    const username = normalizeUsername(signal.match(pattern)?.[1]);
    if (username) return username;
  }
  return normalizeUsername(fallback);
}

function extractCaptionFromHealth(health = {}) {
  const values = [
    health?.contentHints?.title,
    health?.contentHints?.description,
    health?.contentHints?.textSnippet,
  ].map((value) => cleanText(value, 2600)).filter(Boolean);

  for (const value of values) {
    const quoted = value.match(/(?:instagram\s*:\s*)?["“]([\s\S]{20,2200})["”]/i)?.[1];
    if (quoted) return cleanText(quoted, 2200);
  }
  return cleanText(values.find((value) => OFFER_SIGNAL_PATTERN.test(value)) || values[0] || '', 2200);
}

function hasUsableOriginalPostHealth(health = {}) {
  const status = Number(health?.status || 0);
  if (health?.invalid || health?.transientError || health?.blockedByProtection) return false;
  if (!(status >= 200 && status < 400)) return false;
  const signal = [
    health?.contentHints?.title,
    health?.contentHints?.description,
    health?.contentHints?.textSnippet,
  ].map(cleanText).join(' ');
  return Boolean(signal) && !/^(?:instagram|log in|anmelden|registrieren)\b/i.test(signal);
}

function publicationFromOriginalPost(url, health = {}) {
  const explicit = cleanText(health?.dateHints?.publicationDate);
  const explicitDate = explicit ? new Date(explicit) : null;
  if (explicitDate && !Number.isNaN(explicitDate.getTime())) {
    return {
      date: explicitDate,
      source: `instagram-original-post-${cleanText(health?.dateHints?.publicationDateSource || 'publication-date')}`,
    };
  }
  const encodedDate = decodeInstagramShortcodeDate(url);
  return encodedDate ? { date: encodedDate, source: 'url.instagramShortcode' } : null;
}

function existingTrustedPublication(deal = {}) {
  const publication = getPublicationEvidence(deal);
  if (publication.publicationEvidenceRank < 4) return null;
  if (SYNTHETIC_PUBLICATION_SOURCE_PATTERN.test(publication.sourcePublishedAtSource)) return null;
  const date = new Date(publication.sourcePublishedAt);
  return Number.isNaN(date.getTime())
    ? null
    : { date, source: publication.sourcePublishedAtSource };
}

function choosePublication(deal, url, health = null) {
  const original = health ? publicationFromOriginalPost(url, health) : null;
  if (original) return original;
  const encoded = decodeInstagramShortcodeDate(url);
  if (encoded) return { date: encoded, source: 'url.instagramShortcode' };
  return existingTrustedPublication(deal);
}

function verificationSignal(deal = {}, caption = '', health = {}) {
  return [
    caption,
    health?.contentHints?.title,
    health?.contentHints?.description,
    health?.contentHints?.textSnippet,
    deal.title,
    deal.description,
    deal.expiresOriginal,
    deal.expires,
    deal.expiryDisplayText,
    deal.distance,
    deal.location,
  ].map((value) => cleanText(value, 2200)).filter(Boolean).join(' ');
}

function originalPostSignal(caption = '', health = {}) {
  return [
    caption,
    health?.contentHints?.title,
    health?.contentHints?.description,
    health?.contentHints?.textSnippet,
  ].map((value) => cleanText(value, 2200)).filter(Boolean).join(' ');
}

function applyPublication(deal, publication, discoveredAt) {
  const next = {
    ...deal,
    discoveredAt,
  };
  if (!publication?.date || Number.isNaN(publication.date.getTime())) {
    next.sourcePublishedAt = '';
    next.sourcePublishedAtSource = '';
    next.pubDate = '';
    next.pubDateSource = '';
    return next;
  }
  const timestamp = publication.date.toISOString();
  next.sourcePublishedAt = timestamp;
  next.sourcePublishedAtSource = publication.source;
  next.pubDate = timestamp;
  next.pubDateSource = publication.source;
  return next;
}

function applyViennaEvidence(deal, signal, ownerUsername, registry) {
  const existingVienna = getViennaEvidence(deal);
  if (existingVienna.hasViennaEvidence) return deal;

  const captionVienna = getViennaEvidence({ address: signal });
  if (captionVienna.hasViennaEvidence) {
    return {
      ...deal,
      city: 'Wien',
      locationVerified: true,
      viennaVerified: true,
      viennaEvidence: {
        verified: true,
        source: 'instagram-post-caption',
        type: 'instagram-post-caption',
        detail: captionVienna.value,
        value: captionVienna.value,
      },
    };
  }

  const merchant = ownerUsername ? registry.get(ownerUsername) : null;
  if (!merchant) return deal;
  return {
    ...deal,
    city: 'Wien',
    locationVerified: true,
    viennaVerified: true,
    viennaEvidence: {
      verified: true,
      source: 'merchant-registry',
      type: 'merchant-registry',
      detail: ownerUsername,
      value: ownerUsername,
      registryVerificationSource: cleanText(merchant.verificationSource),
    },
  };
}

function applyOfferWindow(deal, signal, publication, now) {
  const window = extractActiveOfferWindow(signal, {
    now,
    pubDate: publication?.date || now,
  });
  if (!window) return deal;

  const next = {
    ...deal,
    expiryKind: window.kind,
    expiryDisplayText: cleanText(window.evidence, 220),
    expirySource: 'instagram-original-post',
    expiresSource: 'instagram-original-post',
    dateConfidence: 'high',
  };
  if (window.startDate) next.validFrom = window.startDate.toISOString();
  if (window.endDate) {
    next.validUntil = window.endDate.toISOString();
    next.expires = window.endDate.toISOString();
  }
  return next;
}

function networkCandidateScore(deal, registry, now) {
  const url = normalizeInstagramPostUrl(deal.url || deal.post_url || deal.postUrl);
  const encoded = decodeInstagramShortcodeDate(url);
  const owner = extractStructuredOwnerUsername(deal);
  const signal = verificationSignal(deal);
  const ageDays = encoded ? Math.max(0, (now.getTime() - encoded.getTime()) / DAY_MS) : null;
  let score = 0;
  if (owner && registry.has(owner)) score += 45;
  if (ageDays === null) score += 24;
  else if (ageDays <= 7) score += 38;
  else if (ageDays <= 21) score += 24;
  else if (ageDays <= 45) score += 12;
  if (OFFER_SIGNAL_PATTERN.test(signal)) score += 24;
  if (VIENNA_SIGNAL_PATTERN.test(signal)) score += 18;
  return { url, encoded, score };
}

function hasFutureValidity(deal, now) {
  const candidates = [deal.validUntil, deal.validOn, deal.expires, deal.end_date];
  return candidates.some((value) => {
    const timestamp = Date.parse(cleanText(value));
    return Number.isFinite(timestamp) && timestamp >= now.getTime();
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.floor(concurrency)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function verifyFirecrawlDeals(deals = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const discoveredAt = now.toISOString();
  const registry = options.registry instanceof Map
    ? options.registry
    : loadVerifiedViennaMerchantRegistry(options.registryPath || DEFAULT_REGISTRY_PATH);
  const maxNetworkVerifications = Math.max(0, Number(
    options.maxNetworkVerifications
      ?? process.env.FIRECRAWL_POST_VERIFY_MAX
      ?? 80
  ) || 0);
  const networkMaxAgeDays = Math.max(1, Number(
    options.networkMaxAgeDays
      ?? process.env.FIRECRAWL_POST_VERIFY_MAX_AGE_DAYS
      ?? 45
  ) || 45);
  const concurrency = Math.max(1, Number(
    options.concurrency
      ?? process.env.FIRECRAWL_POST_VERIFY_CONCURRENCY
      ?? 4
  ) || 4);
  const inspector = options.inspectDealUrlHealth || inspectDealUrlHealth;

  const baseDeals = deals.map((deal) => {
    const url = normalizeInstagramPostUrl(deal?.url || deal?.post_url || deal?.postUrl);
    const existingDiscovery = getPublicationEvidence(deal).discoveredAt;
    const publication = url ? choosePublication(deal, url) : existingTrustedPublication(deal);
    const ownerUsername = extractStructuredOwnerUsername(deal);
    let next = applyPublication(
      { ...deal, ...(url ? { url } : {}) },
      publication,
      cleanText(deal?.discoveredAt || existingDiscovery) || discoveredAt,
    );
    if (ownerUsername) next.ownerUsername = ownerUsername;
    if (url) {
      next.postVerification = {
        status: publication ? 'timestamp-derived' : 'pending',
        checkedAt: '',
        publicationSource: publication?.source || '',
        originalPostUrl: url,
      };
    }
    return next;
  });

  const candidatesByKey = new Map();
  for (const deal of baseDeals) {
    const candidate = networkCandidateScore(deal, registry, now);
    const key = canonicalInstagramPostKey(candidate.url);
    if (!key || !candidate.url) continue;
    const ageDays = candidate.encoded ? (now.getTime() - candidate.encoded.getTime()) / DAY_MS : null;
    if (ageDays !== null && ageDays > networkMaxAgeDays && !hasFutureValidity(deal, now)) continue;
    const existing = candidatesByKey.get(key);
    if (!existing || candidate.score > existing.score) {
      candidatesByKey.set(key, { ...candidate, key, deal });
    }
  }

  const networkCandidates = [...candidatesByKey.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, maxNetworkVerifications);
  const healthRows = await mapWithConcurrency(networkCandidates, concurrency, async (candidate) => {
    try {
      const health = await inspector(candidate.url, {
        timeoutMs: Number(options.timeoutMs || process.env.FIRECRAWL_POST_VERIFY_TIMEOUT_MS || 8000),
        now,
      });
      return [candidate.key, health || { transientError: true }];
    } catch (error) {
      return [candidate.key, { transientError: true, reason: cleanText(error?.message, 180) }];
    }
  });
  const healthByKey = new Map(healthRows);

  let verifiedCount = 0;
  let timestampOnlyCount = 0;
  let registryViennaCount = 0;
  const verifiedDeals = baseDeals.map((deal) => {
    const url = normalizeInstagramPostUrl(deal.url);
    const key = canonicalInstagramPostKey(url);
    if (!key) return deal;

    const health = healthByKey.get(key);
    if (!health) {
      if (deal.postVerification?.status === 'timestamp-derived') timestampOnlyCount += 1;
      return deal;
    }

    const usable = hasUsableOriginalPostHealth(health);
    const caption = usable ? extractCaptionFromHealth(health) : '';
    const ownerUsername = extractInstagramOwnerUsername(health, deal.ownerUsername);
    const publication = choosePublication(deal, url, health);
    const signal = originalPostSignal(caption, health);
    let next = applyPublication(deal, publication, deal.discoveredAt || discoveredAt);
    if (ownerUsername) {
      next.ownerUsername = ownerUsername;
      next.instagramProfileUrl = `https://www.instagram.com/${ownerUsername}/`;
    }
    if (caption) next.postCaption = caption;
    next = applyViennaEvidence(next, signal, ownerUsername, registry);
    if (next.viennaEvidence?.source === 'merchant-registry') registryViennaCount += 1;
    if (usable) next = applyOfferWindow(next, signal, publication, now);
    next.postVerification = {
      status: usable
        ? 'verified-original-post'
        : (publication ? 'timestamp-only' : (health?.invalid ? 'invalid' : 'unavailable')),
      checkedAt: cleanText(health?.checkedAt) || discoveredAt,
      httpStatus: Number(health?.status || 0) || null,
      finalUrl: cleanText(health?.finalUrl || url),
      publicationSource: publication?.source || '',
      ownerUsername,
      originalPostUrl: url,
      reason: cleanText(health?.reason, 180),
    };
    if (usable) {
      next.lastVerifiedAt = next.postVerification.checkedAt;
      verifiedCount += 1;
    } else if (publication) {
      timestampOnlyCount += 1;
    }
    next.evidence = {
      ...(deal.evidence && typeof deal.evidence === 'object' ? deal.evidence : {}),
      originalPost: {
        status: next.postVerification.status,
        checkedAt: next.postVerification.checkedAt,
        url,
        publicationSource: next.postVerification.publicationSource,
        ownerUsername,
        captionSample: cleanText(caption, 500),
      },
    };
    return next;
  });

  console.log('🔬 Firecrawl original-post verification');
  console.log(`   candidates: ${deals.length}; network checked: ${networkCandidates.length}`);
  console.log(`   original posts verified: ${verifiedCount}; timestamp only: ${timestampOnlyCount}`);
  console.log(`   Vienna via verified merchant registry: ${registryViennaCount}; registry merchants: ${registry.size}`);

  return verifiedDeals;
}
