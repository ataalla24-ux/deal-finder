const VIENNA_POSTCODE_PATTERN = /(?:^|\D)(1(?:0[1-9]|1\d|2[0-3])0)(?!\d)/;
const VIENNA_CITY_PATTERN = /\b(?:wien|vienna)\b/i;
const STREET_PATTERN = /\b(?:stra(?:ß|ss)e|gasse|platz|weg|ring|allee|kai|markt|zeile|promenade)\b/i;
const UNTRUSTED_PUBLICATION_SOURCE_PATTERN = /(?:firecrawl.*run|agent\s*run|crawl(?:ed|er)?(?:\s|[-_])?(?:at|run|time)|scrap(?:ed|er)(?:\s|[-_])?(?:at|run|time)|discover(?:ed|y)(?:\s|[-_])?(?:at|run|time)?|generated(?:\s|[-_])?at|fallback|current(?:\s|[-_])?time|community\s*submission)/i;
const TRUSTED_PUBLICATION_SOURCE_PATTERN = /(?:instagram|meta[-_. ]?(?:graph|business|ad)|apify|time[-_. ]?datetime|ld[-_. ]?json.*(?:upload|date)|article.*published|rendered.*time|taken[-_. ]?at|post[-_. ]?published|source[-_. ]?published)/i;
const RESERVED_INSTAGRAM_USERNAMES = new Set([
  'about', 'accounts', 'api', 'challenge', 'create', 'developer', 'direct', 'directory',
  'download', 'explore', 'legal', 'login', 'p', 'press', 'privacy', 'reel', 'reels',
  'signup', 'stories', 'threads', 'topics', 'tv',
]);

function cleanText(value) {
  return value === null || value === undefined
    ? ''
    : String(value).replace(/\s+/g, ' ').trim();
}

function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return '';
  let candidate = value;
  if (typeof candidate === 'number' || /^\d{10,13}$/.test(cleanText(candidate))) {
    const number = Number(candidate);
    candidate = number < 1e12 ? number * 1000 : number;
  }
  const timestamp = Date.parse(candidate instanceof Date ? candidate.toISOString() : String(candidate));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function normalizeUsername(value) {
  const username = cleanText(value).replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{2,40}$/.test(username) && !RESERVED_INSTAGRAM_USERNAMES.has(username) ? username : '';
}

function instagramUrl(url) {
  const text = cleanText(url);
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');
    return host === 'instagram.com' ? parsed : null;
  } catch {
    return null;
  }
}

export function canonicalInstagramPostKey(url) {
  const parsed = instagramUrl(url);
  if (!parsed) return '';

  if (/^\/accounts\/login\/?$/i.test(parsed.pathname)) {
    const next = cleanText(parsed.searchParams.get('next'));
    if (next) {
      const nextUrl = /^https?:\/\//i.test(next) ? next : `https://instagram.com/${next.replace(/^\/+/, '')}`;
      return canonicalInstagramPostKey(nextUrl);
    }
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const typeIndex = parts.findIndex((part) => ['p', 'reel', 'reels', 'tv'].includes(part.toLowerCase()));
  if (typeIndex < 0) return '';
  const shortcode = cleanText(parts[typeIndex + 1]).replace(/[^A-Za-z0-9_-].*$/, '');
  // Instagram shortcodes are case-sensitive; only URL shape/query noise is
  // canonicalized, never the shortcode itself.
  return shortcode ? `instagram:${shortcode}` : '';
}

export function canonicalSocialPostKey(url) {
  const instagramKey = canonicalInstagramPostKey(url);
  if (instagramKey) return instagramKey;

  const text = cleanText(url);
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (host.endsWith('tiktok.com')) {
      const videoIndex = parts.findIndex((part) => part.toLowerCase() === 'video');
      if (videoIndex >= 0 && parts[videoIndex + 1]) {
        return `tiktok:video:${parts[videoIndex + 1].toLowerCase()}`;
      }
    }
  } catch {
    // The caller can still use a non-social URL key.
  }
  return '';
}

export function canonicalDealUrl(url) {
  const text = cleanText(url);
  if (!/^https?:\/\//i.test(text)) return '';
  const postKey = canonicalInstagramPostKey(text);
  if (postKey) return postKey;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const metaAdId = /(?:^|\.)facebook\.com$/i.test(host)
      && /^\/ads\/(?:library\/?|archive\/render_ad\/?)/i.test(parsed.pathname)
      ? cleanText(parsed.searchParams.get('id')).replace(/[^A-Za-z0-9._-]/g, '')
      : '';
    if (metaAdId) return `meta-ad:${metaAdId}`;
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = host;
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().toLowerCase();
  } catch {
    return text.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

export function extractStructuredOwnerUsername(deal = {}) {
  const candidates = [
    deal.ownerUsername,
    deal.owner_username,
    deal.accountUsername,
    deal.instagramUsername,
    deal.instagramHandle,
    deal.username,
    deal.owner?.username,
    deal.user?.username,
    deal.account?.username,
    deal.media?.ownerUsername,
    deal.media?.owner?.username,
    deal.evidence?.username,
  ];
  return candidates.map(normalizeUsername).find(Boolean) || '';
}

export function extractInstagramProfileUsername(url) {
  const parsed = instagramUrl(url);
  if (!parsed) return '';
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 1) return '';
  return normalizeUsername(parts[0]);
}

function publicationCandidates(deal = {}) {
  return [
    ['sourcePublishedAt', deal.sourcePublishedAt, 5, deal.sourcePublishedAtSource || deal.sourceDateSource],
    ['source_published_at', deal.source_published_at, 5, deal.sourcePublishedAtSource || deal.sourceDateSource],
    ['postPublishedAt', deal.postPublishedAt, 5, deal.postPublishedAtSource],
    ['postTimestamp', deal.postTimestamp, 5, deal.postTimestampSource],
    ['takenAt', deal.takenAt, 5, deal.takenAtSource],
    ['taken_at_timestamp', deal.taken_at_timestamp, 5, deal.takenAtSource],
    ['timestamp', deal.timestamp, 4, deal.timestampSource],
    ['publishedAt', deal.publishedAt, 3, deal.publishedAtSource],
    ['pubDate', deal.pubDate, 2, deal.pubDateSource || deal.sourceDateSource || deal.timestampSource],
  ];
}

function discoveryCandidates(deal = {}) {
  return [
    deal.discoveredAt,
    deal.collectedAt,
    deal.scrapedAt,
    deal.fetchedAt,
    deal.createdAt,
    deal.lastUpdated,
  ];
}

export function getPublicationEvidence(deal = {}) {
  const usable = [];
  const untrusted = [];

  for (const [field, value, defaultRank, rawDeclaredSource] of publicationCandidates(deal)) {
    const timestamp = toIsoTimestamp(value);
    if (!timestamp) continue;
    const declaredSource = cleanText(rawDeclaredSource);
    const sourceLabel = declaredSource || field;
    const trustedBusinessDiscoveryTimestamp = /meta[-_. ]?business[-_. ]?discovery[-_. ]?timestamp/i.test(sourceLabel);
    if (UNTRUSTED_PUBLICATION_SOURCE_PATTERN.test(sourceLabel) && !trustedBusinessDiscoveryTimestamp) {
      untrusted.push(timestamp);
      continue;
    }
    // A low-quality pubDate must never become high-confidence merely because a
    // downstream normalizer copied it into sourcePublishedAt.
    const rank = declaredSource
      ? (TRUSTED_PUBLICATION_SOURCE_PATTERN.test(declaredSource) ? Math.max(defaultRank, 4) : Math.min(defaultRank, 2))
      : defaultRank;
    usable.push({
      sourcePublishedAt: timestamp,
      sourcePublishedAtSource: sourceLabel,
      publicationEvidenceRank: rank,
      field,
    });
  }

  usable.sort((left, right) => right.publicationEvidenceRank - left.publicationEvidenceRank
    || Date.parse(right.sourcePublishedAt) - Date.parse(left.sourcePublishedAt));
  const strongest = usable[0];
  const discoveredAt = discoveryCandidates(deal).map(toIsoTimestamp).find(Boolean) || untrusted[0] || '';
  if (strongest) return { ...strongest, discoveredAt };

  return {
    sourcePublishedAt: '',
    sourcePublishedAtSource: '',
    publicationEvidenceRank: 0,
    discoveredAt,
  };
}

function coordinatesFromDeal(deal = {}) {
  const latitude = Number(deal.latitude ?? deal.lat ?? deal.location?.latitude ?? deal.location?.lat);
  const longitude = Number(deal.longitude ?? deal.lng ?? deal.lon ?? deal.location?.longitude ?? deal.location?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

export function getViennaEvidence(deal = {}, options = {}) {
  const declaredViennaEvidence = deal.viennaEvidence || deal.evidence?.viennaEvidence;
  if (declaredViennaEvidence && typeof declaredViennaEvidence === 'object' && !Array.isArray(declaredViennaEvidence)
      && declaredViennaEvidence.verified === true
      && (
        /(?:meta-target-location|apify-location|verified-account|merchant-registry|address|postal|coordinates|business-discovery|structured-location)/i.test(cleanText(declaredViennaEvidence.source || declaredViennaEvidence.type))
        || (
          /instagram-post/i.test(cleanText(declaredViennaEvidence.source || declaredViennaEvidence.type))
          && (VIENNA_CITY_PATTERN.test(cleanText(declaredViennaEvidence.detail || declaredViennaEvidence.value))
            || VIENNA_POSTCODE_PATTERN.test(cleanText(declaredViennaEvidence.detail || declaredViennaEvidence.value)))
        )
      )) {
    return {
      hasViennaEvidence: true,
      type: cleanText(declaredViennaEvidence.source || declaredViennaEvidence.type),
      value: cleanText(declaredViennaEvidence.detail || declaredViennaEvidence.value || 'verified Vienna evidence'),
    };
  }

  if ((deal.viennaVerified === true || deal.locationVerified === true)
      && VIENNA_CITY_PATTERN.test(cleanText(deal.city || deal.location?.city))) {
    return { hasViennaEvidence: true, type: 'verified-flag', value: 'verified Vienna location' };
  }

  const postalCode = cleanText(deal.postalCode || deal.zip || deal.zipCode || deal.location?.postalCode);
  if (VIENNA_POSTCODE_PATTERN.test(postalCode)) {
    return { hasViennaEvidence: true, type: 'postal-code', value: postalCode.match(VIENNA_POSTCODE_PATTERN)?.[1] || postalCode };
  }

  const structuredAddress = [
    deal.address,
    deal.streetAddress,
    deal.venueAddress,
    deal.location?.address,
    deal.location?.streetAddress,
  ].map(cleanText).filter(Boolean).join(' | ');
  const postcodeMatch = structuredAddress.match(VIENNA_POSTCODE_PATTERN);
  if (postcodeMatch) {
    return { hasViennaEvidence: true, type: 'address-postal-code', value: postcodeMatch[1] };
  }
  if (VIENNA_CITY_PATTERN.test(structuredAddress) && STREET_PATTERN.test(structuredAddress)) {
    return { hasViennaEvidence: true, type: 'street-address', value: structuredAddress };
  }

  const structuredCity = cleanText(deal.city || deal.location?.city || deal.venue?.city);
  if (VIENNA_CITY_PATTERN.test(structuredCity)) {
    return { hasViennaEvidence: true, type: 'structured-city', value: structuredCity };
  }

  const coordinates = coordinatesFromDeal(deal);
  if (coordinates && coordinates.latitude >= 48.11 && coordinates.latitude <= 48.34 && coordinates.longitude >= 16.18 && coordinates.longitude <= 16.58) {
    return { hasViennaEvidence: true, type: 'coordinates', value: `${coordinates.latitude},${coordinates.longitude}` };
  }

  const registryUsernames = options.registryUsernames instanceof Set ? options.registryUsernames : new Set();
  const ownerUsername = extractStructuredOwnerUsername(deal);
  if (ownerUsername && registryUsernames.has(ownerUsername)) {
    return { hasViennaEvidence: true, type: 'verified-registry', value: ownerUsername };
  }

  return { hasViennaEvidence: false, type: '', value: '' };
}

function parseExpiryTimestamp(deal = {}, nowMs = Date.now()) {
  return expiryEvidence(deal, nowMs).timestampMs;
}

export function getExpiryEvidenceRank(deal = {}, field = 'expires') {
  const source = cleanText(field === 'expires'
    ? (deal.expiresSource || deal.expirySource)
    : (deal.expirySource || deal.expiresSource)).toLowerCase();
  const confidence = cleanText(deal.dateConfidence).toLowerCase();
  const kind = cleanText(deal.expiryKind).toLowerCase();

  // Review TTLs are delivery safeguards, not evidence that an offer is still
  // running. They must never revive a stronger explicit/content-derived date.
  if (/short[-_. ]?review[-_. ]?ttl|review[-_. ]?ttl|fallback|weak[-_. ]?import/.test(`${source} ${kind}`)) {
    return 10;
  }

  let rank = ['validUntil', 'validOn'].includes(field) ? 55 : field === 'expires' ? 40 : 30;
  if (/^(?:url|url[._ -].*)$/.test(source) || deal.expiresDetectedFromUrl) rank = Math.max(rank, 85);
  else if (/(?:content[-_. ]?date|post[-_. ]?caption|explicit[-_. ]?validity|delivery[-_. ]?stop|business[-_. ]?discovery|merchant|instagram|meta|apify)/.test(source)) {
    rank = Math.max(rank, 75);
  }
  if (confidence === 'high') rank += 5;
  else if (confidence === 'medium') rank += 2;
  else if (confidence === 'low') rank -= 10;
  return Math.max(1, rank);
}

function expiryEvidence(deal = {}, nowMs = Date.now()) {
  const fields = [
    ['validUntil', deal.validUntil],
    ['validOn', deal.validOn],
    ['expires', deal.expires],
    ['end_date', deal.end_date],
    ['validity_date', deal.validity_date],
  ];
  const candidates = [];
  for (const [field, value] of fields) {
    const timestamp = toIsoTimestamp(value);
    if (!timestamp) continue;
    const timestampMs = Date.parse(timestamp);
    candidates.push({
      field,
      timestamp,
      timestampMs,
      rank: getExpiryEvidenceRank(deal, field),
      future: timestampMs >= nowMs,
    });
  }
  return candidates.sort((a, b) => b.rank - a.rank
    || Number(b.future) - Number(a.future)
    || b.timestampMs - a.timestampMs)[0]
    || { field: '', timestamp: '', timestampMs: null, rank: 0, future: false };
}

function evidenceScore(deal = {}, options = {}) {
  const publication = getPublicationEvidence(deal);
  const vienna = getViennaEvidence(deal, options);
  const nowMs = options.now instanceof Date ? options.now.getTime() : Number(options.now) || Date.now();
  const expiry = parseExpiryTimestamp(deal, nowMs);
  return publication.publicationEvidenceRank * 30
    + (vienna.hasViennaEvidence ? 35 : 0)
    + (Number.isFinite(expiry) && expiry >= nowMs ? 22 : Number.isFinite(expiry) ? 4 : 0)
    + (canonicalInstagramPostKey(deal.url || deal.post_url || deal.postUrl) ? 12 : 0)
    + Math.min(Math.max(Number(deal.qualityScore) || 0, 0), 100) / 10;
}

function uniqueStrings(values) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value]).map(cleanText).filter(Boolean))];
}

function preferText(primary, secondary, field) {
  const first = cleanText(primary?.[field]);
  const second = cleanText(secondary?.[field]);
  if (!first) return second;
  if (!second) return first;
  return second.length > first.length ? second : first;
}

function isLegacyFirecrawlRecord(deal = {}) {
  return /\bfirecrawl\b/i.test([
    deal.source,
    deal.originSource,
    deal.id,
    deal.sourceKeys,
    deal.evidenceSources,
  ].flat().map(cleanText).join(' '));
}

export function mergeDealEvidence(left = {}, right = {}, options = {}) {
  const leftScore = evidenceScore(left, options);
  const rightScore = evidenceScore(right, options);
  const primary = rightScore > leftScore ? right : left;
  const secondary = primary === left ? right : left;
  const merged = { ...secondary, ...primary };

  for (const field of ['brand', 'title', 'description', 'address', 'ort', 'distance']) {
    merged[field] = preferText(primary, secondary, field);
  }
  if (primary.location && typeof primary.location === 'object') merged.location = primary.location;
  else if (secondary.location && typeof secondary.location === 'object') merged.location = secondary.location;
  else merged.location = preferText(primary, secondary, 'location');

  const publications = [getPublicationEvidence(left), getPublicationEvidence(right)]
    .filter((item) => item.sourcePublishedAt)
    .sort((a, b) => b.publicationEvidenceRank - a.publicationEvidenceRank || Date.parse(b.sourcePublishedAt) - Date.parse(a.sourcePublishedAt));
  const publication = publications[0] || getPublicationEvidence(merged);
  const discoveries = [getPublicationEvidence(left).discoveredAt, getPublicationEvidence(right).discoveredAt]
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  merged.sourcePublishedAt = publication.sourcePublishedAt || '';
  merged.sourcePublishedAtSource = publication.sourcePublishedAtSource || '';
  merged.pubDate = publication.sourcePublishedAt || '';
  merged.pubDateSource = publication.sourcePublishedAtSource || '';
  merged.discoveredAt = discoveries[0] || '';
  if (publication.publicationEvidenceRank < 4 && (isLegacyFirecrawlRecord(left) || isLegacyFirecrawlRecord(right))) {
    const legacyPublication = [left, right]
      .filter(isLegacyFirecrawlRecord)
      .map((deal) => ({
        timestamp: toIsoTimestamp(deal.pubDate),
        source: cleanText(deal.pubDateSource),
      }))
      .find((item) => item.timestamp);
    if (legacyPublication) {
      merged.pubDate = legacyPublication.timestamp;
      merged.pubDateSource = legacyPublication.source;
    }
  }

  const nowMs = options.now instanceof Date ? options.now.getTime() : Number(options.now) || Date.now();
  const expiryCandidates = [left, right]
    .map((deal) => ({ deal, evidence: expiryEvidence(deal, nowMs) }))
    .filter((item) => Number.isFinite(item.evidence.timestampMs))
    .sort((a, b) => b.evidence.rank - a.evidence.rank
      || Number(b.evidence.future) - Number(a.evidence.future)
      || b.evidence.timestampMs - a.evidence.timestampMs);
  if (expiryCandidates[0]) {
    const expiryDeal = expiryCandidates[0].deal;
    const selectedExpiry = expiryCandidates[0].evidence;
    const expiryFields = ['expires', 'expiresOriginal', 'expiresSource', 'expirySource', 'expiryKind', 'expiryDisplayText', 'validOn', 'validFrom', 'validUntil', 'end_date', 'validity_date', 'dateConfidence'];
    for (const field of expiryFields) delete merged[field];
    for (const field of ['expiryKind', 'expiryDisplayText', 'validFrom', 'dateConfidence']) {
      if (cleanText(expiryDeal[field])) merged[field] = expiryDeal[field];
    }
    merged.expires = selectedExpiry.timestamp;
    if (selectedExpiry.field === 'validOn') merged.validOn = selectedExpiry.timestamp;
    if (selectedExpiry.field === 'validUntil') merged.validUntil = selectedExpiry.timestamp;
    if (selectedExpiry.field === 'end_date') merged.end_date = selectedExpiry.timestamp;
    if (selectedExpiry.field === 'validity_date') merged.validity_date = selectedExpiry.timestamp;
    const selectedExpirySource = selectedExpiry.field === 'expires'
      ? cleanText(expiryDeal.expiresSource || expiryDeal.expirySource)
      : cleanText(expiryDeal.expirySource || expiryDeal.expiresSource);
    merged.expiresSource = selectedExpirySource || selectedExpiry.field;
    merged.expirySource = selectedExpirySource || selectedExpiry.field;
    if (toIsoTimestamp(expiryDeal.expiresOriginal) === selectedExpiry.timestamp) {
      merged.expiresOriginal = expiryDeal.expiresOriginal;
    }
  }

  const leftVienna = getViennaEvidence(left, options);
  const rightVienna = getViennaEvidence(right, options);
  const viennaDeal = rightVienna.hasViennaEvidence && !leftVienna.hasViennaEvidence ? right : leftVienna.hasViennaEvidence ? left : null;
  if (viennaDeal) {
    for (const field of ['address', 'streetAddress', 'venueAddress', 'postalCode', 'zip', 'zipCode', 'city', 'location', 'ort', 'distance', 'latitude', 'longitude']) {
      if (viennaDeal[field] !== undefined && cleanText(viennaDeal[field])) merged[field] = viennaDeal[field];
    }
    const evidence = getViennaEvidence(viennaDeal, options);
    merged.viennaVerified = true;
    merged.viennaEvidence = { verified: true, type: evidence.type, source: evidence.type, value: evidence.value, detail: evidence.value };
  }

  const ownerUsername = extractStructuredOwnerUsername(primary) || extractStructuredOwnerUsername(secondary);
  if (ownerUsername) merged.ownerUsername = ownerUsername;
  merged.qualityScore = Math.max(Number(left.qualityScore) || 0, Number(right.qualityScore) || 0);
  merged.votes = Math.max(Number(left.votes) || 0, Number(right.votes) || 0);
  merged.sourceKeys = uniqueStrings([left.sourceKeys, right.sourceKeys, left.source, right.source, left.originSource, right.originSource]);
  merged.evidenceSources = uniqueStrings([left.evidenceSources, right.evidenceSources, left.source, right.source]);

  return merged;
}

export function duplicateDealKey(deal = {}) {
  const postKey = canonicalInstagramPostKey(deal.url || deal.post_url || deal.postUrl)
    || canonicalInstagramPostKey(deal.post_url || deal.postUrl);
  if (postKey) return postKey;
  const url = canonicalDealUrl(deal.url || deal.post_url || deal.postUrl);
  if (url.startsWith('meta-ad:')) return url;
  const title = cleanText(deal.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return url && title ? `${url}|${title}` : '';
}

export function mergeDuplicateDealRecords(deals = [], options = {}) {
  const merged = [];
  const keyToIndex = new Map();
  let duplicateCount = 0;

  for (const deal of deals) {
    const key = duplicateDealKey(deal);
    if (!key || !keyToIndex.has(key)) {
      if (key) keyToIndex.set(key, merged.length);
      merged.push(deal);
      continue;
    }
    const index = keyToIndex.get(key);
    merged[index] = mergeDealEvidence(merged[index], deal, options);
    duplicateCount += 1;
  }

  return { deals: merged, duplicateCount };
}
