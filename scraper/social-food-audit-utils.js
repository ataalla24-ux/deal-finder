import { canonicalSocialPostKey } from './deal-evidence-utils.js';
import { advanceDealLifecycle, lifecycleState } from './deal-lifecycle.js';
import { extractActiveOfferWindow } from './instagram-ai-validity-utils.js';
import {
  inferInstagramAccountRole,
  instagramUsernameDisplayName,
  normalizeInstagramUsername,
} from './instagram-entity-resolution.js';
import {
  getEditorialRoundupPromotionReason,
  getNonOfferContentReason,
} from './promotion-quality-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const FOOD_PATTERNS = [
  /\b(?:restaurant|lokal|gastronomie|gastro|essen|food|meal|lunch|dinner|brunch|fruehstueck|fruhstuck|frühstück)\b/i,
  /\b(?:pizza|burger|kebab|kebap|doener|döner|sushi|ramen|pasta|taco|falafel|huhn|chicken|steak)\b/i,
  /\b(?:cafe|café|coffee|kaffee|espresso|latte|matcha|boba|bubble\s*tea|cocktail|spritz|drink|bier|wein)\b/i,
  /\b(?:eis|gelato|dessert|kuchen|croissant|baeckerei|bäckerei|bakery|snack|menu|menue|menü)\b/i,
];

const DEAL_PATTERNS = [
  /\b(?:gratis|kostenlos|freebie|geschenkt|umsonst)\b/i,
  /\b(?:rabatt|discount|gutschein|coupon|voucher|aktionspreis|angebot|aktion|deal|happy\s*hour)\b/i,
  /\b(?:1\s*[+x:]\s*1|2\s*(?:fuer|für|for)\s*1|bogo)\b/i,
  /\b\d{1,2}\s*%\b/i,
  /\b(?:nur|only|statt|save|spare?n?|deal|angebot|aktion|special|menu|menue|menü)\b.{0,45}(?:€\s*)?\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|euro|eur)\b/i,
];

const VIENNA_PATTERNS = [
  /\b(?:wien|vienna)\b/i,
  /\b1(?:0[1-9]|1\d|2[0-3])0\b/,
  /\b(?:favoriten|leopoldstadt|neubau|ottakring|donaustadt|floridsdorf|meidling|mariahilf|währing|waehring)\b/i,
];

const HARD_REJECTION_PATTERNS = [
  /(?:expired|abgelaufen|offer-expired|ad-inactive|aktion galt|kurz-aktion ist abgelaufen)/i,
  /(?:post-too-old|zu alt|liegt außerhalb|older than|terminal)/i,
  /(?:non-vienna|nicht wien|wrong.location|außerhalb wien|ausserhalb wien)/i,
  /(?:giveaway|gewinnspiel|verlosung|excluded-promotion|personal.compensation|job|property)/i,
  /(?:self-syndicated|selbst syndiziert|future.clock|unplausibel in der zukunft)/i,
  /(?:missing.source.published|kein echtes .*postdatum|missing.*date|ohne post-datum)/i,
  /(?:general-recommendation|generic-content|editorial|roundup)/i,
];

const UNSAFE_REVIEW_CONTENT_PATTERNS = [
  /\b(?:top\s*\d+|bucket\s*list|must[- ]?visit|favourites?|favorites?|recommendations?|restaurant\s+tipps?)\b/i,
  /\b(?:vienna,?\s*(?:va|virginia)|northern\s+virginia|tysons|washingtonian|washington\s*dc)\b/i,
  /\b(?:richland\s*,?\s*(?:wa|washington)|george\s+washington\s+way|tri[.\s-]*cities[.\s-]*foodie)\b/i,
  /\b(?:dog|hund|hunde|napf|näpfe|tierbedarf|pet)\b/i,
  /\b(?:hotel|stay|übernachtung|uebernachtung)\b.{0,120}\b(?:save|rabatt|discount|\d{1,2}\s*%)\b/i,
  /\b(?:concert|konzert|event|workshop|ticket|eintritt)\b.{0,100}\b(?:drink|brunch|coffee|kaffee)\b/i,
  /\b(?:sorry|entschuldigung|leider ausverkauft|replacement|compensation)\b.{0,120}\b(?:gratis|kostenlos|free)\b/i,
  /\b(?:anna|kunde|kundin|customer)\b.{0,80}\bbekommt\b.{0,80}\bgratis\b/i,
];

const FREEFINDER_ACCOUNT_KEYS = new Set([
  'freefinder',
  'freefinderat',
  'freefinderwien',
]);

function cleanText(value, max = 4000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeUsername(value) {
  return cleanText(value, 80).replace(/^@/, '').toLowerCase();
}

function isoDate(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function patternHits(value, patterns) {
  const text = cleanText(value, 8000);
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function textWithoutHashtags(value) {
  return cleanText(value, 8000)
    .replace(/#[\p{L}\p{N}_.-]+/gu, ' ')
    .replace(/\b(?:wien|vienna)\s+(?:gratis|kostenlos|free|deal|deals|aktion|rabatt|1\s*\+\s*1|neueröffnung|neueroeffnung)\s+(?:\d{1,2}\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jänner|jaenner|januar|februar|märz|maerz|mai|juni|juli|oktober|november|dezember)\s+20\d{2}\b/gi, ' ');
}

export function foodDrinkScore(value) {
  return patternHits(value, FOOD_PATTERNS);
}

export function hasDealSignal(value) {
  return patternHits(value, DEAL_PATTERNS) > 0;
}

export function hasViennaSignal(value) {
  return patternHits(value, VIENNA_PATTERNS) > 0;
}

export function hasTrustedSocialFoodViennaSignal(value) {
  return hasViennaSignal(textWithoutHashtags(value));
}

export function normalizeLossReason(value) {
  const reason = cleanText(value, 240).toLowerCase();
  if (!reason) return 'unknown';
  if (/(?:expired|abgelaufen|offer-expired|ad-inactive|aktion galt|kurz-aktion)/i.test(reason)) return 'expired-offer';
  if (/(?:post-too-old|zu alt|liegt außerhalb|older than|terminal)/i.test(reason)) return 'stale-post';
  if (/(?:non-vienna|nicht wien|outside.vienna|wrong.location|außerhalb wien|ausserhalb wien)/i.test(reason)) return 'outside-vienna';
  if (/(?:missing-vienna|kein eindeutiges wien|kein .*wien-signal)/i.test(reason)) return 'missing-vienna-evidence';
  if (/(?:no-concrete-offer|kein starkes gratis|kein konkretes angebot|deal-signal)/i.test(reason)) return 'no-concrete-offer';
  if (/(?:missing.*date|kein echtes .*postdatum|ohne post-datum|source-published)/i.test(reason)) return 'missing-post-date';
  if (/(?:marke|brand|merchant|anbieter|quelle)/i.test(reason)) return 'weak-merchant-evidence';
  if (/(?:media.*403|http 403|download|unreadable|tesseract|vision|ocr)/i.test(reason)) return 'media-access-or-reading';
  if (/(?:giveaway|gewinnspiel|verlosung|excluded|job|property|compensation|syndicated)/i.test(reason)) return 'excluded-content';
  if (/(?:general-recommendation|generic-content|editorial|roundup)/i.test(reason)) return 'generic-recommendation';
  if (/(?:duplicate|doppelt|already|bereits)/i.test(reason)) return 'duplicate';
  if (/(?:llm|media-ai)/i.test(reason)) return 'ai-rejected-or-missing';
  if (/(?:normalisierung|validity|validator|blockiert)/i.test(reason)) return 'validator-blocked';
  return 'other';
}

export function isHardSocialRejection(value) {
  const reason = cleanText(value, 500);
  return HARD_REJECTION_PATTERNS.some((pattern) => pattern.test(reason));
}

export function isUnsafeSocialFoodReviewContent(value) {
  const text = cleanText(value, 8000);
  return UNSAFE_REVIEW_CONTENT_PATTERNS.some((pattern) => pattern.test(text))
    || Boolean(getEditorialRoundupPromotionReason(text))
    || Boolean(getNonOfferContentReason(text));
}

export function isFreeFinderSocialAccount(value) {
  const key = normalizeUsername(value).replace(/[^a-z0-9]/g, '');
  return FREEFINDER_ACCOUNT_KEYS.has(key);
}

function viennaIsoDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function isExpiredSocialFoodReviewContent(value, pubDate, now = new Date(), explicitValidUntil = '') {
  const today = viennaIsoDay(now);
  const explicitEndDay = viennaIsoDay(explicitValidUntil);
  if (today && explicitEndDay && explicitEndDay < today) return true;

  const publication = new Date(pubDate);
  if (Number.isNaN(publication.getTime())) return false;
  const offerWindow = extractActiveOfferWindow(cleanText(value, 8000), { now, pubDate: publication });
  const extractedEndDay = viennaIsoDay(offerWindow?.endDate);
  return Boolean(today && extractedEndDay && extractedEndDay < today);
}

function candidateText(input = {}) {
  return cleanText([
    input.text,
    input.textSample,
    input.caption,
    input.description,
    input.title,
    input.brand,
    input.source,
    input.mediaEvidence?.ocrText,
    input.mediaEvidence?.ai?.offerText,
  ].filter(Boolean).join(' '), 8000);
}

function candidateEvidenceText(input = {}) {
  return cleanText([
    input.text,
    input.textSample,
    input.caption,
    input.description,
    input.title,
    input.mediaEvidence?.ocrText,
    input.mediaEvidence?.ai?.offerText,
  ].filter(Boolean).join(' '), 8000);
}

function inferredPlatform(input = {}, source = '') {
  const signal = cleanText([input.platform, input.url, source].filter(Boolean).join(' '), 1200);
  if (/tiktok/i.test(signal)) return 'tiktok';
  if (/instagram|meta/i.test(signal)) return 'instagram';
  return 'social';
}

function mediaAudit(input = {}) {
  const evidence = input.mediaEvidence && typeof input.mediaEvidence === 'object'
    ? input.mediaEvidence
    : {};
  return {
    attempted: Boolean(
      evidence.analyzedAt
      || Number(evidence.assetCount || 0) > 0
      || (Array.isArray(evidence.errors) && evidence.errors.length > 0)
    ),
    assetCount: Math.max(0, Number(evidence.assetCount || 0)),
    imageCount: Math.max(0, Number(evidence.imageCount || 0)),
    videoFrameCount: Math.max(0, Number(evidence.videoFrameCount || 0)),
    ocrChars: cleanText(evidence.ocrText, 8000).length,
    aiCalled: Boolean(evidence.ai || evidence.aiError),
    aiAccepted: evidence.ai?.isDeal === true,
    errors: Array.isArray(evidence.errors) ? evidence.errors.map((entry) => cleanText(entry, 180)).filter(Boolean).slice(0, 5) : [],
  };
}

export function normalizeSocialAuditCandidate(input = {}, defaults = {}, now = new Date()) {
  const source = cleanText(input.auditSource || input.source || defaults.source || 'unknown', 120);
  const sourceLabel = cleanText(input.sourceLabel || defaults.sourceLabel || source, 160);
  const url = cleanText(input.url || input.permalink || input.postUrl, 1200);
  const text = candidateText(input);
  const status = cleanText(input.status || defaults.status || (input.rejectionReason || input.reason ? 'rejected' : 'collector-accepted'), 40);
  const rejectionReason = cleanText(input.rejectionReason || input.reason, 240);
  const pubDate = isoDate(input.pubDate || input.sourcePublishedAt || input.timestamp);
  const pubDateMs = Date.parse(pubDate || '');
  const ageDays = Number.isFinite(pubDateMs)
    ? Number(((now.getTime() - pubDateMs) / DAY_MS).toFixed(2))
    : null;
  const ownerUsername = normalizeUsername(
    input.ownerUsername || input.accountHandle || input.username || input.sourceAccount,
  );
  const merchantUsername = normalizeUsername(input.merchantUsername || input.providerUsername);
  const foodScore = foodDrinkScore(text);
  const evidenceText = candidateEvidenceText(input);
  const prose = textWithoutHashtags(evidenceText);
  const contentViennaSignal = hasViennaSignal(prose);
  const explicitViennaSignal = hasViennaSignal([
    input.location,
    input.distance,
    input.viennaEvidence?.detail,
    input.mediaEvidence?.ai?.locationText,
  ].filter(Boolean).join(' '));
  const verifiedViennaSignal = input.viennaVerified === true;
  const viennaSignal = verifiedViennaSignal || contentViennaSignal || explicitViennaSignal;
  const dealSignal = hasDealSignal(prose);
  const media = mediaAudit(input);
  const directPostUrl = /^https:\/\/(?:www\.|m\.)?(?:instagram\.com\/(?:p|reel|tv)\/|tiktok\.com\/@[^/]+\/video\/)/i.test(url);
  const fresh = typeof ageDays === 'number' && ageDays >= -0.05 && ageDays <= 7;
  const ownAccount = isFreeFinderSocialAccount(ownerUsername);
  const unsafeContent = isUnsafeSocialFoodReviewContent(evidenceText);
  const expiredOfferWindow = isExpiredSocialFoodReviewContent(evidenceText, pubDate, now);
  const reviewEligible = status === 'rejected'
    && directPostUrl
    && fresh
    && foodScore > 0
    && dealSignal
    && viennaSignal
    && !ownAccount
    && !unsafeContent
    && !expiredOfferWindow
    && !isHardSocialRejection(rejectionReason);
  const canonicalKey = canonicalSocialPostKey(url) || `${source}:${stableHash(`${url}|${input.id || ''}|${text.slice(0, 300)}`)}`;

  return {
    key: canonicalKey,
    id: cleanText(input.id, 180),
    source,
    sourceLabel,
    platform: inferredPlatform(input, source),
    status,
    stage: status === 'rejected' ? 'collector-rejected' : 'collector-accepted',
    url,
    title: cleanText(input.title || input.brand || (ownerUsername ? `@${ownerUsername}` : ''), 180),
    textSample: cleanText(text, 700),
    ownerUsername,
    ownerRole: cleanText(input.ownerRole || input.accountType, 40),
    merchantUsername,
    pubDate,
    ageDays,
    rejectionReason,
    lossCategory: status === 'rejected' ? normalizeLossReason(rejectionReason) : '',
    collectorScore: Number.isFinite(Number(input.score ?? input.qualityScore)) ? Number(input.score ?? input.qualityScore) : null,
    foodDrinkScore: foodScore,
    foodDrinkRelevant: foodScore > 0,
    dealSignal,
    viennaSignal,
    contentViennaSignal,
    explicitViennaSignal,
    verifiedViennaSignal,
    ownAccount,
    unsafeContent,
    expiredOfferWindow,
    media,
    reviewEligible,
  };
}

function rowHash(row) {
  return stableHash(`${row.source}|${row.lossCategory}|${row.key}`);
}

export function buildStratifiedAuditSample(rows, limit = 80) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => (
      row.status === 'rejected'
      && row.foodDrinkRelevant
      && typeof row.ageDays === 'number'
      && row.ageDays >= -0.05
      && row.ageDays <= 7
    ))
    .sort((left, right) => rowHash(left).localeCompare(rowHash(right)));
  const groups = new Map();
  for (const row of candidates) {
    const key = `${row.source}|${row.lossCategory || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const orderedGroups = [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  const sample = [];
  let round = 0;
  while (sample.length < limit) {
    let added = 0;
    for (const [, group] of orderedGroups) {
      if (group[round]) {
        sample.push(group[round]);
        added += 1;
        if (sample.length >= limit) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return sample;
}

function increment(counts, key) {
  const normalized = cleanText(key || 'unknown', 160);
  counts[normalized] = (counts[normalized] || 0) + 1;
}

function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function isFoodDrinkFeedbackEvent(event = {}) {
  const category = cleanText(event.category, 80).toLowerCase();
  return event.socialFoodReview === true
    || ['essen', 'kaffee', 'food', 'food & drink', 'restaurant'].includes(category);
}

export function buildSocialFoodFunnel(rows, feedbackEvents = []) {
  const sourceCounts = {};
  const lossReasons = {};
  const foodRows = rows.filter((row) => row.foodDrinkRelevant);
  for (const row of rows) increment(sourceCounts, row.source);
  for (const row of foodRows.filter((candidate) => candidate.status === 'rejected')) {
    increment(lossReasons, row.lossCategory);
  }
  const feedback = (Array.isArray(feedbackEvents) ? feedbackEvents : [])
    .filter(isFoodDrinkFeedbackEvent);
  return {
    definitions: {
      discovered: 'Unique social posts present in collector evidence.',
      collectorAccepted: 'Technically extracted by a collector; not a human quality decision.',
      slackSent: 'Persisted only after Slack confirms the message timestamp.',
      manuallyApproved: 'A non-bot Slack user added an approval reaction.',
      manuallyRejected: 'A non-bot Slack user added a rejection reaction.',
      published: 'Passed current validation and was written to the live feed.',
    },
    counts: {
      discovered: rows.length,
      foodDrinkDiscovered: foodRows.length,
      collectorAccepted: rows.filter((row) => row.status === 'collector-accepted').length,
      collectorRejected: rows.filter((row) => row.status === 'rejected').length,
      foodDrinkRejected: foodRows.filter((row) => row.status === 'rejected').length,
      mediaAttempted: rows.filter((row) => row.media.attempted).length,
      reviewEligible: rows.filter((row) => row.reviewEligible).length,
      slackSent: feedback.filter((event) => event.slackSentAt).length,
      manuallyApproved: feedback.filter((event) => event.decision === 'approved').length,
      manuallyRejected: feedback.filter((event) => event.decision === 'rejected').length,
      published: feedback.filter((event) => event.publicationStatus === 'published').length,
    },
    sourceCounts: sortedCounts(sourceCounts),
    foodLossReasons: sortedCounts(lossReasons),
  };
}

function inferredReviewType(row) {
  const text = row.textSample;
  if (/\b(?:1\s*[+x:]\s*1|2\s*(?:fuer|für|for)\s*1|bogo)\b/i.test(text)) return 'bogo';
  if (/\b(?:gratis|kostenlos|freebie|geschenkt)\b/i.test(text)) return 'gratis';
  return 'rabatt';
}

function inferredReviewCategory(row) {
  return /\b(?:kaffee|coffee|espresso|latte|matcha|boba|bubble\s*tea)\b/i.test(row.textSample)
    ? 'kaffee'
    : 'essen';
}

function inferredReviewIdentity(row) {
  const bylineUsername = normalizeInstagramUsername(
    row.textSample.match(/(?:likes?|comments?)\s*[-–]\s*([a-z0-9._]{2,30})\s+(?:am|on)\s+/i)?.[1],
  );
  const ownerUsername = normalizeInstagramUsername(row.ownerUsername || bylineUsername);
  const merchantUsername = normalizeInstagramUsername(row.merchantUsername)
    || (inferInstagramAccountRole({ username: ownerUsername }) === 'merchant' ? ownerUsername : '');
  const headingBrand = cleanText(row.title, 180).match(/^(.{2,90}?)\s+(?:auf|on)\s+Instagram\s*:/i)?.[1] || '';
  let brand = merchantUsername ? instagramUsernameDisplayName(merchantUsername) : cleanText(headingBrand, 90);
  if (/^2[‘'’]?nd\s+street\s+burger$/i.test(brand)) brand = '2nd Street Burger';
  if (!brand) brand = ownerUsername ? instagramUsernameDisplayName(ownerUsername) : 'Social Food Fund';
  return { ownerUsername, merchantUsername, brand };
}

function inferredReviewTitle(row, brand) {
  const percent = row.textSample.match(/\b(\d{1,2}\s*%\s*Rabatt\s+auf\s+[^.!?📍#⏰]{2,80})/i)?.[1];
  if (percent) {
    const offer = cleanText(percent, 100)
      .replace(/[^\p{L}\p{N}%€.'’ -]+$/gu, '')
      .replace(/\bALLE\b/g, 'alle')
      .trim();
    return `${offer} bei ${brand}`;
  }
  const happyHour = row.textSample.match(/\b(Happy\s+Hour[^.!?📍#]{0,85})/i)?.[1];
  if (happyHour) return `${cleanText(happyHour, 100)} bei ${brand}`;
  const titleSignal = cleanText(row.title, 130);
  return titleSignal && !/\s(?:auf|on)\s+Instagram\s*:/i.test(titleSignal)
    ? titleSignal
    : `Food-Angebot bei ${brand}`;
}

export function buildSocialFoodReviewDeal(row, now = new Date()) {
  if (!row?.reviewEligible) return null;
  const identity = inferredReviewIdentity(row);
  const title = inferredReviewTitle(row, identity.brand);
  const pubDate = new Date(row.pubDate);
  let offerWindow = Number.isNaN(pubDate.getTime())
    ? null
    : extractActiveOfferWindow(row.textSample, { now, pubDate });
  const durationWeeks = row.textSample.match(/\bab\s+heute\b.{0,50}?\b(\d{1,2})\s+wochen\s+lang\b/i)?.[1];
  if (!offerWindow && durationWeeks && !Number.isNaN(pubDate.getTime())) {
    const endDate = new Date(pubDate);
    endDate.setUTCDate(endDate.getUTCDate() + Number(durationWeeks) * 7);
    endDate.setUTCHours(23, 59, 59, 999);
    offerWindow = {
      kind: 'relative-duration',
      startDate: pubDate,
      endDate,
      evidence: `ab heute ${durationWeeks} Wochen lang`,
    };
  }
  const validFrom = offerWindow?.startDate?.toISOString().slice(0, 10) || '';
  const validUntil = offerWindow?.endDate?.toISOString() || '';
  const extracted = advanceDealLifecycle({
    id: `social-food-review-${stableHash(row.key)}`,
    title,
    brand: identity.brand,
    description: cleanText(row.textSample, 900),
    type: inferredReviewType(row),
    category: inferredReviewCategory(row),
    source: row.platform === 'tiktok' ? 'TikTok Review' : 'Instagram Review',
    originSource: row.sourceLabel || row.source,
    url: row.url,
    pubDate: row.pubDate,
    sourcePublishedAt: row.pubDate,
    pubDateSource: `${row.platform}.collector-evidence`,
    sourcePublishedAtSource: `${row.platform}.collector-evidence`,
    discoveredAt: now.toISOString(),
    expires: validUntil,
    validFrom,
    validUntil,
    expiryKind: offerWindow?.kind || '',
    expirySource: offerWindow ? 'social-post-content-date' : '',
    expiresSource: offerWindow ? 'social-post-content-date' : '',
    dateConfidence: offerWindow ? 'high' : '',
    distance: 'Wien - manuell pruefen',
    location: 'Wien',
    city: 'Wien',
    viennaVerified: false,
    qualityScore: Math.max(35, Math.min(69, Number(row.collectorScore || 50))),
    reviewTier: 'manual-food-review',
    socialFoodReview: true,
    socialFoodReviewReason: row.rejectionReason,
    socialFoodAuditKey: row.key,
    ownerUsername: identity.ownerUsername,
    sourceAccountType: inferInstagramAccountRole({ username: identity.ownerUsername }),
    scoutUsername: row.ownerRole === 'creator' || row.ownerRole === 'discovery' ? identity.ownerUsername : '',
    merchantUsername: identity.merchantUsername,
    evidence: {
      socialFoodAudit: {
        source: row.source,
        lossCategory: row.lossCategory,
        foodDrinkScore: row.foodDrinkScore,
        dealSignal: row.dealSignal,
        viennaSignal: row.viennaSignal,
        contentViennaSignal: row.contentViennaSignal,
        explicitViennaSignal: row.explicitViennaSignal,
        verifiedViennaSignal: row.verifiedViennaSignal,
        ownAccount: row.ownAccount,
        unsafeContent: row.unsafeContent,
        expiredOfferWindow: row.expiredOfferWindow,
        hardRejection: isHardSocialRejection(row.rejectionReason),
        media: row.media,
      },
    },
    hot: false,
    isNew: true,
    priority: 20,
    votes: 0,
  }, 'discovered', { at: now });
  return advanceDealLifecycle(extracted, 'extracted', { at: now });
}

export function dedupeAuditRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!row?.key) continue;
    const previous = byKey.get(row.key);
    const previousAccepted = previous?.status === 'collector-accepted';
    const rowAccepted = row.status === 'collector-accepted';
    if (!previous || (!previousAccepted && rowAccepted) || (!previousAccepted && !previous.reviewEligible && row.reviewEligible)) {
      byKey.set(row.key, row);
    }
  }
  return [...byKey.values()];
}

export { cleanText, lifecycleState, stableHash };
