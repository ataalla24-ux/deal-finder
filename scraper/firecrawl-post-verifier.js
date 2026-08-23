import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  canonicalInstagramPostKey,
  decodeInstagramShortcodeDate,
  extractStructuredOwnerUsername,
  getPublicationEvidence,
  getViennaEvidence,
  mergeDuplicateDealRecords,
} from './deal-evidence-utils.js';
import { inspectDealUrlHealth } from './expiry-utils.js';
import {
  enrichDealWithInstagramGraphEvidence,
  loadInstagramGraphEvidence,
} from './instagram-graph-evidence.js';
import { extractActiveOfferWindow } from './instagram-ai-validity-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_REGISTRY_PATH = path.join(ROOT, 'docs', 'instagram-merchant-registry.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const SYNTHETIC_PUBLICATION_SOURCE_PATTERN = /(?:firecrawl.*run|agent(?:\s|[-_])?run|crawl(?:ed|er)?(?:\s|[-_])?(?:at|run|time)|scrap(?:ed|er)?(?:\s|[-_])?(?:at|run|time)|discover(?:ed|y)(?:\s|[-_])?(?:at|run|time)?|generated(?:\s|[-_])?at|fallback|current(?:\s|[-_])?time)/i;
const OFFER_SIGNAL_PATTERN = /(?:\bgratis\b|\bkostenlos\b|\bfree\b|\b1\s*[+&]\s*1\b|\b2\s*(?:für|for)\s*1\b|\b\d{1,2}\s*%|\brabatt\b|\baktion\b|\bangebot\b|\bdeal\b|\bhappy hour\b|\bstatt\s+(?:€\s*)?\d)/i;
const STRONG_OFFER_SIGNAL_PATTERN = /(?:\bgratis\b|\bkostenlos\b|\bfree\b|\bumsonst\b|\b0\s*€|\b1\s*[+&]\s*1\b|\b2\s*(?:für|for)\s*1\b|\bbogo\b|\b\d{1,2}\s*%|\brabatt\b|\baktion\b|\bdeal\b|\bcoupon\b|\bgutschein\b|\bhappy hour\b|\bstatt\s+(?:€\s*)?\d|\b(?:sonder|aktions|wochen|tages)angebot\b|\bim angebot\b|\bangebot\s+(?:gilt|bis|nur)\b|\bangebot\s+(?:für|um|ab)\s+(?:€\s*)?\d|\bangebot\s*:)/i;
const VIENNA_SIGNAL_PATTERN = /\b(?:wien|vienna)\b|(?:^|\D)1(?:0[1-9]|1\d|2[0-3])0(?!\d)/i;
const GIVEAWAY_SIGNAL_PATTERN = /(?:\bgewinnspiel\b|\bgiveaway\b|\bverlos(?:ung|en)\b|\bgewinn(?:e|en|st|t|er|erin|erinnen)?\b|\bzu gewinnen\b|\blostopf\b|\bteilnahmeschluss\b|\bmarkiere\b.*\bfreund|\bkommentiere\b.*\bgewinn)/i;
const NON_OFFER_FREE_PATTERN = /(?:\bfeel free\b|\bfree[ -]?flow\b|\b(?:gluten|sugar|lactose|dairy|alcohol)[ -]?free\b)/gi;
const GENERIC_COLLECTION_TITLE_PATTERN = /(?:\balle termine\b|\bveranstaltungskalender\b|\bevents? (?:in|für) wien\b|\bangebote? im überblick\b|\bdeal[- ]?(?:liste|übersicht)\b|\bseite\s+\d+\b)/i;

function cleanText(value, maxLength = Infinity) {
  const text = value === null || value === undefined
    ? ''
    : String(value).replace(/\s+/g, ' ').trim();
  return Number.isFinite(maxLength) ? text.slice(0, maxLength) : text;
}

function hasConcreteOriginalOfferSignal(value) {
  const signal = cleanText(value, 7000).replace(NON_OFFER_FREE_PATTERN, '');
  return STRONG_OFFER_SIGNAL_PATTERN.test(signal) && !GIVEAWAY_SIGNAL_PATTERN.test(signal);
}

function inferExactOfferType(value) {
  const signal = cleanText(value, 7000).replace(NON_OFFER_FREE_PATTERN, '');
  if (/(?:\b1\s*[+&]\s*1\b|\b2\s*(?:für|for)\s*1\b|\bbogo\b|\bbuy one get one\b)/i.test(signal)) return 'bogo';
  if (/(?:\bgratis\b|\bkostenlos\b|\bumsonst\b|\b0\s*€|\bfree\b)/i.test(signal)) return 'gratis';
  return 'rabatt';
}

function isFirecrawlSearchDiscovery(deal = {}) {
  return cleanText(deal.discoveryMethod || deal.discovery_method, 80).toLowerCase() === 'firecrawl-search';
}

function exactInstagramPostSignal(deal = {}) {
  return [
    deal.metaGraphCaption,
    deal.metaGraphOcrText,
    deal.postCaption,
    deal.evidence?.originalPost?.captionSample,
  ].map((value) => cleanText(value, 2600)).filter(Boolean).join(' ');
}

function exactWebPageSignal(health = {}) {
  return [
    health?.contentHints?.title,
    health?.contentHints?.description,
    health?.contentHints?.textSnippet,
  ].map((value) => cleanText(value, 2600)).filter(Boolean).join(' ');
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

export function readFirecrawlDealOutput(outputPath) {
  const payload = readJson(outputPath, null);
  return {
    payload,
    deals: Array.isArray(payload?.deals) ? payload.deals : [],
  };
}

export function mergeFirecrawlDealHistory(currentDeals = [], previousDeals = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxAgeDays = Math.min(7, Math.max(1, Number(options.maxAgeDays) || 7));
  const futureAllowanceMs = 10 * 60 * 1000;
  const cutoff = now.getTime() - maxAgeDays * DAY_MS;
  const freshPreviousDeals = previousDeals.filter((deal) => {
    const publication = getPublicationEvidence(deal);
    const publishedAt = Date.parse(publication.sourcePublishedAt || '');
    const discoveredAt = Date.parse(publication.discoveredAt || deal?.discoveredAt || '');
    const timestamp = Number.isFinite(publishedAt) ? publishedAt : discoveredAt;
    return Number.isFinite(timestamp)
      && timestamp >= cutoff
      && timestamp <= now.getTime() + futureAllowanceMs;
  });
  const merged = mergeDuplicateDealRecords([...currentDeals, ...freshPreviousDeals], { now });

  return {
    deals: merged.deals,
    previousDeals: previousDeals.length,
    retainedPreviousDeals: freshPreviousDeals.length,
    prunedPreviousDeals: previousDeals.length - freshPreviousDeals.length,
    duplicateCount: merged.duplicateCount,
  };
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
  const trusted = existingTrustedPublication(deal);
  if (/^instagram-graph-/i.test(trusted?.source || '')) return trusted;
  const original = health ? publicationFromOriginalPost(url, health) : null;
  if (original) return original;
  const encoded = decodeInstagramShortcodeDate(url);
  if (encoded) return { date: encoded, source: 'url.instagramShortcode' };
  return trusted;
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
  const networkMaxAgeDays = Math.min(7, Math.max(1, Number(
    options.networkMaxAgeDays
      ?? process.env.FIRECRAWL_POST_VERIFY_MAX_AGE_DAYS
      ?? 7
  ) || 7));
  const maxAcceptedAgeDays = Math.min(7, Math.max(1, Number(
    options.maxAcceptedAgeDays
      ?? process.env.FIRECRAWL_POST_MAX_ACCEPTED_AGE_DAYS
      ?? 7
  ) || 7));
  const concurrency = Math.max(1, Number(
    options.concurrency
      ?? process.env.FIRECRAWL_POST_VERIFY_CONCURRENCY
      ?? 4
  ) || 4);
  const inspector = options.inspectDealUrlHealth || inspectDealUrlHealth;

  let graphEvidenceByKey = new Map();
  if (options.useGraphEvidence !== false) {
    if (options.graphEvidenceIndex instanceof Map) {
      graphEvidenceByKey = options.graphEvidenceIndex;
    } else if (options.graphEvidenceIndex?.byKey instanceof Map) {
      graphEvidenceByKey = options.graphEvidenceIndex.byKey;
    } else {
      graphEvidenceByKey = loadInstagramGraphEvidence(options.graphEvidencePath).byKey;
    }
  }

  let graphMatchedCount = 0;
  let graphBlockedCount = 0;
  let verifiedCount = 0;
  let timestampOnlyCount = 0;
  let registryViennaCount = 0;
  const graphEnrichedDeals = [];
  for (const deal of deals) {
    const result = enrichDealWithInstagramGraphEvidence(deal, graphEvidenceByKey, { now });
    if (result.matched) graphMatchedCount += 1;
    if (result.blocked) {
      graphBlockedCount += 1;
      continue;
    }
    graphEnrichedDeals.push(result.deal);
  }

  const baseDeals = graphEnrichedDeals.map((deal) => {
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
      if (deal.metaGraphVerified) {
        const graphSignal = [deal.metaGraphCaption, deal.metaGraphOcrText]
          .map((value) => cleanText(value, 2200))
          .filter(Boolean)
          .join(' ');
        if (cleanText(deal.metaGraphCaption)) next.postCaption = cleanText(deal.metaGraphCaption, 2200);
        if (ownerUsername) next.instagramProfileUrl = `https://www.instagram.com/${ownerUsername}/`;
        next = applyViennaEvidence(next, graphSignal, ownerUsername, registry);
        if (next.viennaEvidence?.source === 'merchant-registry') registryViennaCount += 1;
        if (graphSignal) next = applyOfferWindow(next, graphSignal, publication, now);
        next.postVerification = {
          status: 'verified-meta-graph',
          checkedAt: cleanText(deal.metaGraphVerifiedAt) || discoveredAt,
          publicationSource: publication?.source || 'instagram-graph-timestamp',
          ownerUsername,
          originalPostUrl: url,
          reason: cleanText(deal.metaGraphRejection, 180),
        };
        next.lastVerifiedAt = next.postVerification.checkedAt;
        next.evidence = {
          ...(deal.evidence && typeof deal.evidence === 'object' ? deal.evidence : {}),
          originalPost: {
            status: next.postVerification.status,
            checkedAt: next.postVerification.checkedAt,
            url,
            publicationSource: next.postVerification.publicationSource,
            ownerUsername,
            captionSample: cleanText(deal.metaGraphCaption, 500),
            ocrSample: cleanText(deal.metaGraphOcrText, 500),
          },
        };
      } else {
        next.postVerification = {
          status: publication ? 'timestamp-derived' : 'pending',
          checkedAt: '',
          publicationSource: publication?.source || '',
          originalPostUrl: url,
        };
      }
    }
    return next;
  });

  const candidatesByKey = new Map();
  for (const deal of baseDeals) {
    if (deal.metaGraphVerified) continue;
    const candidate = networkCandidateScore(deal, registry, now);
    const key = canonicalInstagramPostKey(candidate.url);
    if (!key || !candidate.url) continue;
    const ageDays = candidate.encoded ? (now.getTime() - candidate.encoded.getTime()) / DAY_MS : null;
    if (ageDays !== null && ageDays > networkMaxAgeDays) continue;
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

  const webSearchCandidatesByUrl = new Map();
  for (const deal of baseDeals) {
    const url = cleanText(deal?.url || deal?.post_url || deal?.postUrl, 1200);
    if (!url || normalizeInstagramPostUrl(url) || !isFirecrawlSearchDiscovery(deal)) continue;
    if (!webSearchCandidatesByUrl.has(url)) webSearchCandidatesByUrl.set(url, deal);
  }
  const webSearchCandidates = [...webSearchCandidatesByUrl.entries()].slice(0, maxNetworkVerifications);
  const webHealthRows = await mapWithConcurrency(webSearchCandidates, concurrency, async ([url]) => {
    try {
      const health = await inspector(url, {
        timeoutMs: Number(options.timeoutMs || process.env.FIRECRAWL_POST_VERIFY_TIMEOUT_MS || 8000),
        now,
      });
      return [url, health || { transientError: true }];
    } catch (error) {
      return [url, { transientError: true, reason: cleanText(error?.message, 180) }];
    }
  });
  const webHealthByUrl = new Map(webHealthRows);

  const enrichedDeals = baseDeals.map((deal) => {
    const url = normalizeInstagramPostUrl(deal.url);
    const key = canonicalInstagramPostKey(url);
    if (!key) {
      const rawUrl = cleanText(deal?.url || deal?.post_url || deal?.postUrl, 1200);
      const health = webHealthByUrl.get(rawUrl);
      if (!health) return deal;
      const signal = exactWebPageSignal(health);
      const pageTitle = cleanText(health?.contentHints?.title, 500);
      return {
        ...deal,
        webVerification: {
          status: hasUsableOriginalPostHealth(health) ? 'verified-source-page' : 'unavailable',
          checkedAt: cleanText(health?.checkedAt) || discoveredAt,
          httpStatus: Number(health?.status || 0) || null,
          finalUrl: cleanText(health?.finalUrl || rawUrl),
          reason: cleanText(health?.reason, 180),
          exactOffer: hasConcreteOriginalOfferSignal(signal),
          exactType: inferExactOfferType(signal),
          exactVienna: VIENNA_SIGNAL_PATTERN.test(signal),
          genericCollection: GENERIC_COLLECTION_TITLE_PATTERN.test(pageTitle),
          titleSample: pageTitle,
          descriptionSample: cleanText(health?.contentHints?.description, 700),
        },
      };
    }

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

  const evidenceAlignedDeals = enrichedDeals.map((deal) => {
    const searchDiscovery = isFirecrawlSearchDiscovery(deal);
    const rawUrl = cleanText(deal.url || deal.post_url || deal.postUrl);
    if (!/(?:^|\.)instagram\.com\//i.test(rawUrl)) {
      if (!searchDiscovery) return deal;
      const type = cleanText(deal.webVerification?.exactType, 40) || deal.type;
      return {
        ...deal,
        type,
        hot: type === 'gratis' || type === 'bogo',
        description: cleanText(deal.webVerification?.descriptionSample || deal.description, 2200),
        searchEvidenceAligned: true,
      };
    }

    const exactSignal = exactInstagramPostSignal(deal);
    if (!exactSignal) return deal;
    const ownerUsername = extractStructuredOwnerUsername(deal);
    const type = inferExactOfferType(exactSignal);
    if (!searchDiscovery) {
      return {
        ...deal,
        type,
        hot: type === 'gratis' || type === 'bogo',
        description: cleanText(deal.metaGraphCaption || deal.postCaption || deal.description, 2200),
        originalEvidenceAligned: true,
      };
    }
    const oldBrand = cleanText(deal.brand, 120);
    const currentTitle = cleanText(deal.title, 500);
    const titleCore = oldBrand && currentTitle.toLowerCase().startsWith(`${oldBrand.toLowerCase()}:`)
      ? cleanText(currentTitle.slice(oldBrand.length + 1), 420)
      : currentTitle;
    return {
      ...deal,
      ...(ownerUsername ? {
        brand: ownerUsername,
        title: `${ownerUsername}: ${titleCore || cleanText(exactSignal, 120)}`.slice(0, 140),
      } : {}),
      type,
      hot: type === 'gratis' || type === 'bogo',
      description: cleanText(deal.metaGraphCaption || deal.postCaption || deal.description, 2200),
      searchEvidenceAligned: true,
    };
  });

  let staleInstagramPosts = 0;
  let undatedInstagramPosts = 0;
  let invalidInstagramUrls = 0;
  let searchMissingOriginalOffer = 0;
  let searchMissingViennaEvidence = 0;
  let searchWebUnavailable = 0;
  let searchWebGenericCollection = 0;
  const verifiedDeals = evidenceAlignedDeals.filter((deal) => {
    const rawUrl = cleanText(deal.url || deal.post_url || deal.postUrl);
    if (!/(?:^|\.)instagram\.com\//i.test(rawUrl)) {
      if (!isFirecrawlSearchDiscovery(deal)) return true;
      if (deal.webVerification?.status !== 'verified-source-page') {
        searchWebUnavailable += 1;
        return false;
      }
      if (deal.webVerification.genericCollection) {
        searchWebGenericCollection += 1;
        return false;
      }
      if (!deal.webVerification.exactOffer) {
        searchMissingOriginalOffer += 1;
        return false;
      }
      if (!deal.webVerification.exactVienna) {
        searchMissingViennaEvidence += 1;
        return false;
      }
      return true;
    }
    const postUrl = normalizeInstagramPostUrl(rawUrl);
    if (!postUrl) {
      invalidInstagramUrls += 1;
      return false;
    }
    const publication = getPublicationEvidence(deal);
    const timestamp = Date.parse(publication.sourcePublishedAt || '');
    if (!Number.isFinite(timestamp)) {
      undatedInstagramPosts += 1;
      return false;
    }
    const ageDays = (now.getTime() - timestamp) / DAY_MS;
    if (ageDays < -10 / (24 * 60) || ageDays > maxAcceptedAgeDays) {
      staleInstagramPosts += 1;
      return false;
    }
    if (isFirecrawlSearchDiscovery(deal)) {
      const exactSignal = exactInstagramPostSignal(deal);
      if (!hasConcreteOriginalOfferSignal(exactSignal)) {
        searchMissingOriginalOffer += 1;
        return false;
      }
      const ownerUsername = extractStructuredOwnerUsername(deal);
      if (!VIENNA_SIGNAL_PATTERN.test(exactSignal) && !(ownerUsername && registry.has(ownerUsername))) {
        searchMissingViennaEvidence += 1;
        return false;
      }
    }
    return true;
  });

  console.log('🔬 Firecrawl original-post verification');
  console.log(`   candidates: ${deals.length}; network checked: ${networkCandidates.length}`);
  console.log(`   Meta Graph exact matches: ${graphMatchedCount}; hard-blocked: ${graphBlockedCount}`);
  console.log(`   original posts verified: ${verifiedCount}; timestamp only: ${timestampOnlyCount}`);
  console.log(`   Vienna via verified merchant registry: ${registryViennaCount}; registry merchants: ${registry.size}`);
  console.log(`   fresh output: ${verifiedDeals.length}; stale: ${staleInstagramPosts}; undated: ${undatedInstagramPosts}; invalid Instagram URLs: ${invalidInstagramUrls}`);
  console.log(`   strict Search rejects: no exact offer ${searchMissingOriginalOffer}; no exact Vienna ${searchMissingViennaEvidence}; web unavailable ${searchWebUnavailable}; generic web lists ${searchWebGenericCollection}`);

  return verifiedDeals;
}
