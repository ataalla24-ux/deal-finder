import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { inspectDealUrlHealth, parseExpiryShape } from './expiry-utils.js';
import {
  extractActiveOfferWindow,
  hasRecurringOfferSchedule,
} from './instagram-ai-validity-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEFAULT_REPORT_PATH = path.join(DOCS_DIR, 'deal-validity-report.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;
const DEFAULT_EXTENDED_MAX_AGE_DAYS = 45;
const DEFAULT_CHURCH_WEEKDAY = 1; // Monday, aligned with the Churches Wien weekly workflow.
const EXCLUDED_SOURCE_PATTERNS = [
  { label: 'DieRestaurantWoche', hostPattern: /(^|\.)dierestaurantwoche\.at$/i, textPattern: /\b(die\s*restaurantwoche|restaurantwoche|culinarius\s+restaurant\s+week)\b/i },
  { label: 'Neotaste', hostPattern: /(^|\.)neotaste\.com$/i, textPattern: /\bneotaste\b/i },
  { label: 'TheFork', hostPattern: /(^|\.)thefork\.(at|com)$/i, textPattern: /\bthe\s*fork\b|\bthefork\b/i },
  { label: 'gastro.news', hostPattern: /(^|\.)gastro\.news$/i, textPattern: /\bgastro\.news\b|\bgastro\s+news\b/i },
  { label: '1000things Website', hostPattern: /(^|\.)1000things(?:magazine)?\.(?:at|com)$/i },
  { label: 'Tripadvisor', hostPattern: /(^|\.)tripadvisor\.[a-z.]+$/i, textPattern: /\btripadvisor\b/i },
  { label: 'Yelp', hostPattern: /(^|\.)yelp\.[a-z.]+$/i, textPattern: /\byelp\b/i },
  { label: 'Starbucks US Rewards', textPattern: /\bstarbucks\.com\/rewards\b/i },
];
const VIENNA_SIGNAL_PATTERN = /\b(wien|vienna)\b|(?:^|[^\d])(1(?:0[1-9]0|1[0-9]0|2[0-3]0))(?:\b|[^\d])/i;
const VIENNA_NEGATION_PATTERN = /\b(?:nicht|kein(?:e[rmns]?)?|au(?:ß|ss)erhalb)\s+(?:in\s+)?(?:wien|vienna)\b|\b(?:wien|vienna)\s+(?:ausgeschlossen|ausgenommen)\b|\b(?:von|au(?:ß|ss)erhalb)\s+(?:wien|vienna)\s+entfernt\b/i;
const AUSTRIA_SCOPE_PATTERN = /(?:österreich(?:weit)?|\boesterreich(?:weit)?|\baustria(?:n|wide)?|\bbundesweit|\blandesweit)\b/i;
const ONLINE_SCOPE_PATTERN = /\b(?:onlineshop|online[-\s]angebot|online\s+einlösbar|online\s+einloesbar|im\s+online[-\s]?shop|webshop|österreichweiter\s+versand|oesterreichweiter\s+versand)\b/i;
const UNCERTAIN_LOCATION_PATTERN = /\b(?:not specified|unknown|nicht angegeben|unbekannt|suggests?|vermutlich|wahrscheinlich|möglicherweise|moeglicherweise)\b/i;
const NON_VIENNA_PLACE_PATTERN = /\b(?:graz|salzburg|linz|innsbruck|klagenfurt|villach|st\.?\s*pölten|st\.?\s*poelten|eisenstadt|bregenz|baden|wels|niederösterreich|niederoesterreich|burgenland|steiermark|kärnten|kaernten|tirol|vorarlberg|deutschland|germany|schweiz|switzerland|united\s+states|vereinigte\s+staaten|u\.?s\.?a\.?|america)\b/i;
const PLACE_BOUND_OFFER_PATTERN = /\b(?:museum|museen|theater|oper|konzert|concert|festival|festwochen|veranstaltung|event|ausstellung|führung|fuehrung|ticket|kino|schloss|zentrum|center|arena|steinbruch)\w*/i;
const VERIFIED_VIENNA_MEMBER_BENEFIT_PATTERN = /\b(?:belvedere|leopold\s+museum|kinodonnerstag)\b/i;
const SYNTHETIC_PUBLICATION_SOURCE_PATTERN = /(?:firecrawl.*(?:run|crawl)|agent(?:\s|[-_])?run|crawl(?:ed|er)?(?:\s|[-_])?(?:at|run|time)|scrap(?:ed|er)?(?:\s|[-_])?(?:at|run|time)|discovered(?:\s|[-_])?at|generated(?:\s|[-_])?at|fallback|current(?:\s|[-_])?time|workflow(?:\s|[-_])?run)/i;
const TRUSTED_PUBLICATION_SOURCE_PATTERN = /(?:url\.publicationdate|time\.datetime|rendered[-_. ]?time|post[-_. ]?(?:date|time|timestamp)|source[-_. ]?published[-_. ]?at|published[-_. ]?(?:at|time|date)|article:published_time|og:published_time|instagram[-_. ]?(?:graph|timestamp)|tiktok[-_. ]?(?:timestamp|video[-_. ]?id)|apify[-_. ]?(?:timestamp|taken[-_. ]?at)|meta[-_. ]?(?:timestamp|created[-_. ]?time))/i;
const INSTAGRAM_SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(value) {
  const date = value instanceof Date ? value : toDate(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isBeforeToday(isoDate, now) {
  const text = cleanText(isoDate);
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/)?.[1];
  if (!dateOnly) return false;
  return dateOnly < toIsoDate(startOfUtcDay(now));
}

function ageDays(date, now) {
  if (!(date instanceof Date)) return null;
  const sourceDay = startOfUtcDay(date);
  const today = startOfUtcDay(now);
  return Math.max(0, Math.floor((today.getTime() - sourceDay.getTime()) / DAY_MS));
}

function normalizeUrl(value) {
  const text = cleanText(value);
  return /^https?:\/\//i.test(text) ? text : '';
}

function hostnameFromUrl(value) {
  const url = normalizeUrl(value);
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function locationValueToText(value) {
  if (!value) return '';
  if (typeof value !== 'object' || Array.isArray(value)) return cleanText(value);
  return [
    value.name,
    value.address,
    value.streetAddress,
    value.city,
    value.postalCode,
    value.zip,
  ].map(cleanText).filter(Boolean).join(' ');
}

function hasReliableHealthPayload(health) {
  const status = Number(health?.status);
  return Boolean(
    health
    && !health.invalid
    && !health.transientError
    && !health.blockedByProtection
    && Number.isFinite(status)
    && status >= 200
    && status < 400
  );
}

function reliableContentHints(health) {
  return hasReliableHealthPayload(health) && health.contentHints && typeof health.contentHints === 'object'
    ? health.contentHints
    : {};
}

function reliableDateHints(health) {
  return hasReliableHealthPayload(health) && health.dateHints && typeof health.dateHints === 'object'
    ? health.dateHints
    : {};
}

function decodeInstagramShortcodeDate(value) {
  const url = normalizeUrl(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const typeIndex = parts.findIndex((part) => /^(?:p|reel|tv)$/i.test(part));
    const shortcode = typeIndex >= 0 ? cleanText(parts[typeIndex + 1]) : '';
    if (!/^[A-Za-z0-9_-]{5,20}$/.test(shortcode)) return null;

    let mediaId = 0n;
    for (const char of shortcode) {
      const digit = INSTAGRAM_SHORTCODE_ALPHABET.indexOf(char);
      if (digit < 0) return null;
      mediaId = mediaId * 64n + BigInt(digit);
    }
    const timestamp = Number((mediaId >> 23n) + 1314220021300n);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) || date < new Date('2011-01-01T00:00:00.000Z') ? null : date;
  } catch {
    return null;
  }
}

function decodeTikTokVideoDate(value) {
  const url = normalizeUrl(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)tiktok\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/video\/(\d{16,22})(?:\/|$)/i);
    if (!match) return null;
    const timestamp = Number(BigInt(match[1]) >> 32n) * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) || date < new Date('2016-01-01T00:00:00.000Z') ? null : date;
  } catch {
    return null;
  }
}

function getEncodedSocialPublication(value) {
  const instagramDate = decodeInstagramShortcodeDate(value);
  if (instagramDate) {
    return { source: 'url.instagramShortcode', date: instagramDate, rank: 110 };
  }
  const tiktokDate = decodeTikTokVideoDate(value);
  if (tiktokDate) {
    return { source: 'url.tiktokVideoId', date: tiktokDate, rank: 110 };
  }
  return null;
}

function isSocialPostDeal(deal) {
  const signal = [
    deal.url,
    deal.source,
    deal.originSource,
    deal.id,
  ].map(cleanText).join(' ').toLowerCase();
  const hostname = hostnameFromUrl(deal.url);
  const facebookPostPath = (() => {
    if (!/(^|\.)facebook\.com$/i.test(hostname)) return false;
    try {
      const pathname = new URL(deal.url).pathname;
      return /\/(?:posts|videos|reel|watch)\/|\/(?:permalink|story)\.php(?:\/|$)/i.test(pathname);
    } catch {
      return false;
    }
  })();
  return /(^|[^\w])(tiktok|instagram)([^\w]|$)/i.test(signal)
    || /(^|\.)tiktok\.com$/i.test(hostnameFromUrl(deal.url))
    || /(^|\.)instagram\.com$/i.test(hostnameFromUrl(deal.url))
    || facebookPostPath;
}

function isCrawlerDeal(deal) {
  const signal = [
    deal.source,
    deal.originSource,
    deal.id,
    deal.sourceKeys,
    deal.evidenceSources,
  ].flat().map(cleanText).join(' ');
  return /\b(?:firecrawl|crawler|scraper|scanner|apify|tripadvisor)\b/i.test(signal)
    || /(^|\.)tripadvisor\./i.test(hostnameFromUrl(deal.url));
}

function isNewsAggregatorDeal(deal) {
  const signal = [deal.url, deal.source, deal.originSource, deal.id].map(cleanText).join(' ');
  return /\bgoogle\s+news(?:\s+rss)?\b|\bnews\.google\.com\b|\bvorteilsportal\b|\bvpr-/i.test(signal);
}

function isSharedBenefitPageDeal(deal) {
  const signal = [deal.source, deal.originSource, deal.url, deal.id].map(cleanText).join(' ');
  return /\bmember-benefits-scraper\b|\bwienmobil\s+vorteilswelt\b|\bvorteilsclub\b|\bdrei\s+plus\b|\böamtc\b|\boeamtc\b/i.test(signal);
}

function getDealSignalText(deal, health = null) {
  const contentHints = reliableContentHints(health);
  return [
    deal.id,
    deal.brand,
    deal.title,
    deal.description,
    deal.category,
    deal.type,
    deal.source,
    deal.originSource,
    deal.distance,
    locationValueToText(deal.location),
    deal.ort,
    deal.address,
    deal.city,
    deal.postalCode,
    deal.url,
    health?.finalUrl,
    contentHints.title,
    contentHints.description,
  ].map(cleanText).filter(Boolean).join(' ');
}

function getExcludedSourceMatch(deal, health = null) {
  const signal = getDealSignalText(deal, health);
  const hosts = [deal.url, health?.finalUrl].map(hostnameFromUrl).filter(Boolean);
  return EXCLUDED_SOURCE_PATTERNS.find((entry) => {
    if (entry.textPattern?.test(signal)) return true;
    return entry.hostPattern ? hosts.some((host) => entry.hostPattern.test(host)) : false;
  }) || null;
}

function hasViennaSignalInText(value) {
  return VIENNA_SIGNAL_PATTERN.test(cleanText(value));
}

function hasMissingLocation(deal) {
  return Array.isArray(deal.missingFields) && deal.missingFields.includes('Ort');
}

function hasViennaEvidence(deal, health = null) {
  const contentHints = reliableContentHints(health);
  const strongLocationText = [
    deal.address,
    locationValueToText(deal.location),
    deal.ort,
    deal.city,
    deal.postalCode,
    hasMissingLocation(deal) ? '' : deal.distance,
  ].map(cleanText).filter(Boolean).join(' ');

  if (VIENNA_NEGATION_PATTERN.test(strongLocationText)) return false;
  if (hasViennaSignalInText(strongLocationText)) return true;

  const contextText = [
    deal.brand,
    deal.title,
    deal.description,
    deal.brand,
    deal.url,
    health?.finalUrl,
    contentHints.title,
    contentHints.description,
  ].map(cleanText).filter(Boolean).join(' ');

  return !VIENNA_NEGATION_PATTERN.test(contextText) && hasViennaSignalInText(contextText);
}

function hasNonViennaPostalCode(value) {
  const matches = cleanText(value).match(/(?:^|\D)(\d{4})(?=\D|$)/g) || [];
  return matches.some((match) => {
    const postalCode = Number(match.replace(/\D/g, ''));
    const isViennaPostalCode = postalCode >= 1010 && postalCode <= 1230 && postalCode % 10 === 0;
    return postalCode >= 1000 && postalCode <= 9999 && !isViennaPostalCode;
  });
}

function isVerifiedViennaMemberBenefit(deal) {
  const source = [deal.source, deal.originSource].map(cleanText).join(' ');
  const partner = [deal.brand, deal.title].map(cleanText).join(' ');
  return /\b(?:member-benefits-scraper|drei\s+plus)\b/i.test(source)
    && VERIFIED_VIENNA_MEMBER_BENEFIT_PATTERN.test(partner);
}

function isViennaOriginFlight(deal) {
  const source = [deal.source, deal.originSource, deal.id].map(cleanText).join(' ');
  const route = [deal.title, deal.description, deal.url].map(cleanText).join(' ');
  const trustedFlightSource = /\b(?:flights?\s+vienna|flights-vienna-scraper)\b/i.test(source)
    || (deal.flight && typeof deal.flight === 'object');
  return trustedFlightSource
    && /(?:\boriginIata=VIE\b|\b(?:roundtrip|hin\s*&?\s*zurück|return)\b[^.!?]{0,80}\b(?:wien|vienna|VIE)\b|\b(?:wien|vienna|VIE)\b[^.!?]{0,80}\b(?:roundtrip|hin\s*&?\s*zurück|return)\b)/i.test(route);
}

function isExplicitlyUsableInVienna(deal, health = null) {
  const contentHints = reliableContentHints(health);
  const verifiedLocationText = [
    deal.address,
    locationValueToText(deal.location),
    deal.ort,
    deal.city,
    deal.postalCode,
  ].map(cleanText).filter(Boolean).join(' ');
  const strongLocationText = [
    deal.address,
    locationValueToText(deal.location),
    deal.ort,
    deal.city,
    deal.postalCode,
    hasMissingLocation(deal) ? '' : deal.distance,
  ].map(cleanText).filter(Boolean).join(' ');
  const contextText = [
    deal.brand,
    deal.title,
    deal.description,
    deal.evidence?.textSample,
    contentHints.title,
    contentHints.description,
  ].map(cleanText).filter(Boolean).join(' ');
  const allText = `${strongLocationText} ${contextText}`.trim();

  if (VIENNA_NEGATION_PATTERN.test(allText)) return false;
  if (isViennaOriginFlight(deal)) return true;
  if (hasViennaSignalInText(verifiedLocationText)) return true;
  if (NON_VIENNA_PLACE_PATTERN.test(contextText) && !hasViennaSignalInText(contextText)) return false;
  if (hasViennaSignalInText(strongLocationText)) return true;

  const structuredCity = cleanText(deal.city || (deal.location && typeof deal.location === 'object' ? deal.location.city : ''));
  const explicitOnlineLocation = /^(?:online|online[-\s]?shop|webshop)$/i.test(strongLocationText);
  const conflictingStructuredCity = structuredCity
    && !hasViennaSignalInText(structuredCity)
    && !AUSTRIA_SCOPE_PATTERN.test(structuredCity)
    && !ONLINE_SCOPE_PATTERN.test(structuredCity)
    && !/^(?:online|online[-\s]?shop|webshop)$/i.test(structuredCity);
  const conflictingLocation = VIENNA_NEGATION_PATTERN.test(allText)
    || hasNonViennaPostalCode(strongLocationText)
    || NON_VIENNA_PLACE_PATTERN.test(strongLocationText)
    || conflictingStructuredCity;
  if (conflictingLocation) return false;
  if (hasViennaSignalInText(contextText)) return true;
  if (NON_VIENNA_PLACE_PATTERN.test(contextText)) return false;
  if (isVerifiedViennaMemberBenefit(deal)) return true;
  if (PLACE_BOUND_OFFER_PATTERN.test(contextText)) return false;

  const nationwide = (AUSTRIA_SCOPE_PATTERN.test(allText) && !UNCERTAIN_LOCATION_PATTERN.test(allText))
    || explicitOnlineLocation
    || ONLINE_SCOPE_PATTERN.test(contextText);
  return nationwide;
}

function hasSubstantiveSocialEvidence(deal, health = null) {
  const contentHints = reliableContentHints(health);
  return [
    deal.description,
    deal.evidence?.textSample,
    deal.offerText,
    contentHints.description,
  ].map(cleanText).some((value) => value.length >= 12);
}

function getUnsubstantiatedSocialFallbackReason(deal, health = null) {
  const source = [deal.source, deal.originSource, deal.id].map(cleanText).join(' ');
  if (!/\b(?:instagram|tiktok)[-\s]?(?:deals[-\s]?)?(?:scanner|scraper)\b/i.test(source)) return '';
  if (hasSubstantiveSocialEvidence(deal, health)) return '';

  const title = cleanText(deal.title);
  const brand = cleanText(deal.brand);
  if (/^(?:gratis|kostenlos|free)\s+(?:eintritt|entry)\s+(?:bei|at)\s+@[a-z0-9._-]+$/i.test(title)) {
    return 'kein konkretes Angebot: unbelegter generischer Social-Scanner-Titel';
  }
  if (/^(?:vorreservierung|reservierung|rabatt|gutschein|aktion|angebot|gratis|kostenlos)\b|\b\d{1,2}\s*%\b/i.test(brand)) {
    return 'kein konkretes Angebot: fehlerhaft erzeugter Social-Scanner-Titel';
  }
  return '';
}

function getMalformedAggregatorReason(deal) {
  const source = [deal.source, deal.originSource, deal.url].map(cleanText).join(' ');
  if (!/\bgutscheine\.at\b/i.test(source)) return '';
  const brand = cleanText(deal.brand);
  const offerText = [deal.title, deal.description].map(cleanText).join(' ');
  if (/^rabatt\s+(?:auf|bei)\b|^gutschein\s+exklusiv\b/i.test(brand)) {
    return 'kein konkretes Angebot: fehlerhaft gelesener Gutscheine.at-Händler';
  }
  if (/\bWolt\b[^.!?]{0,80}\bDyson\b|\bDyson\b[^.!?]{0,80}\bWolt\b/i.test(offerText)) {
    return 'kein konkretes Angebot: vermischte Gutscheine.at-Angebote';
  }
  return '';
}

function getOfferText(deal, health = null) {
  const contentHints = reliableContentHints(health);
  const title = cleanText(deal.title);
  const usableTitle = /^@?[a-z0-9._-]+\s+(?:angebot|deal)$/i.test(title) ? '' : title;
  return [
    usableTitle,
    deal.description,
    deal.evidence?.textSample,
    deal.offerText,
    contentHints.title,
    contentHints.description,
  ].map(cleanText).filter(Boolean).join(' ');
}

function hasLowProductPrice(value) {
  const text = cleanText(value);
  const product = '(?:pizza|döner|doener|doner|kebab|kebap|dürüm|dueruem|burger|kaffee|coffee|espresso|latte|matcha|drink|cocktail|bier|spritzer|taco|wrap|falafel|croissant|baklava|cannoli|tiramisu|sushi|bowl|menü|menue)';
  const amount = '(\\d{1,2}(?:[.,]\\d{1,2})?)';
  const patterns = [
    new RegExp(`\\b${product}\\b[^.!?]{0,24}\\b(?:um|ab|für|fuer)\\s*(?:je\\s*)?€\\s*${amount}(?![\\d.,])`, 'gi'),
    new RegExp(`\\b${product}\\b[^.!?]{0,24}\\b(?:um|ab|für|fuer)\\s*(?:je\\s*)?${amount}\\s*(?:€(?!\\w)|euro\\b|eur\\b)`, 'gi'),
    new RegExp(`€\\s*${amount}(?![\\d.,])\\s*${product}\\b`, 'gi'),
    new RegExp(`${amount}\\s*(?:€(?!\\w)|euro\\b|eur\\b)\\s*${product}\\b`, 'gi'),
  ];
  return patterns.some((pattern) => [...text.matchAll(pattern)].some((match) => (
    Number(String(match[1]).replace(',', '.')) <= 5
  )));
}

function getConcreteOfferDecision(deal, health = null) {
  const offerText = getOfferText(deal, health);
  const socialFallbackReason = getUnsubstantiatedSocialFallbackReason(deal, health);
  if (socialFallbackReason) return { concrete: false, reason: socialFallbackReason };
  const malformedAggregatorReason = getMalformedAggregatorReason(deal);
  if (malformedAggregatorReason) return { concrete: false, reason: malformedAggregatorReason };
  if (/\b(?:gewinnspiel|giveaway|verlosung|raffle|sweepstake|zu\s+gewinnen|gewinne(?:n)?)\b/i.test(offerText)) {
    return { concrete: false, reason: 'Gewinnspiel/Verlosung statt direkt nutzbarem Deal' };
  }

  const recommendationLanguage = /\b(?:favou?rite|lieblings(?:platz|spot|ort)|summer\s+spot|things\s+to\s+do|must[-\s]?visit|guide|tipps?|vibe|save\s+(?:this|and)|send\s+this)\b/i;
  const explicitPromotionBeyondGenericFree = /(?:\b\d+\s*%|\b1\s*[+&]\s*1\b|\b(?:rabatt|gutschein|coupon|deal|aktion|angebot|special|happy\s*hour)\b|\b(?:statt|nur\s+heute|today\s+only)\b|\b(?:gratis|free)\s+(?:zu|zum|bei|with)\b)/i;
  if (recommendationLanguage.test(offerText) && !explicitPromotionBeyondGenericFree.test(offerText)) {
    return { concrete: false, reason: 'allgemeine Empfehlung/Gratis-Event statt konkreter Aktion' };
  }
  const genericFreeEvent = /(?:\b(?:gratis|kostenlos|kostenfrei|free)\s+(?:eintritt|entry)\b[^.!?]{0,80}\b(?:festival|veranstaltung|event)\b|\b(?:festival|veranstaltung|event)\b[^.!?]{0,80}\b(?:gratis|kostenlos|kostenfrei|free)\s+(?:eintritt|entry)\b)/i;
  const eventPromotionMechanism = /\b(?:aktion|deal|rabatt|gutschein|coupon|1\s*[+&]\s*1|nur\s+heute|today\s+only|mitglieder|members|code)\b/i;
  if (genericFreeEvent.test(offerText) && !eventPromotionMechanism.test(offerText)) {
    return { concrete: false, reason: 'allgemeine Empfehlung/Gratis-Event statt konkreter Aktion' };
  }

  const shippingSignal = /\b(?:(?:gratis|kostenlos(?:e[rmns]?|en)?|free)\s+(?:lieferung|versand|zustellung|shipping|delivery)|(?:lieferung|versand|zustellung|shipping|delivery)\s+(?:gratis|kostenlos|free))\b/i;
  const withoutShipping = offerText
    .replace(/\b(?:(?:gratis|kostenlos(?:e[rmns]?|en)?|free)\s+(?:lieferung|versand|zustellung|shipping|delivery)|(?:lieferung|versand|zustellung|shipping|delivery)\s+(?:gratis|kostenlos|free))(?:\s+(?:in|nach|innerhalb)\s+[^.!?,;]{0,60})?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const offerEvidenceText = withoutShipping
    .replace(/\b(?:gluten|sugar|zucker|alcohol|alkohol|dairy|lactose|laktose|cruelty|fat|caffeine|koffein)[-\s]?free\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const concreteOfferPatterns = [
    /(?:\b(?:rabatt|spare(?:n)?|save|minus|off)\b[^.!?]{0,20}\b\d{1,2}\s*%|\b\d{1,2}\s*%\s*(?:rabatt|off|günstiger|guenstiger|auf\b|weniger))/i,
    /\b(?:1\s*[+&]\s*1|2\s*(?:für|fuer|zum\s+preis\s+von)\s*1|buy\s+one\s+get\s+one|bogo)\b/i,
    /\b(?:gratis|kostenlos(?:e[rmns]?|en)?|kostenfrei|umsonst|geschenkt|free)\b/i,
    /\b(?:eintritt\s+(?:frei|kostenlos|kostenfrei)|free\s+entry)\b/i,
    /\b(?:rabatt|gutschein|coupon|deal|aktion|angebot|special|happy\s*hour|sparen|ersparnis|ermäßig\w*|ermaessig\w*|reduziert|preisnachlass|sonderpreis|testabo)\b/i,
    /\b(?:zahl(?:e|en)?\s+was\s+du\s+willst|pay\s+what\s+you\s+want)\b/i,
    /\b(?:statt|nur)\s*(?:€\s*)?\d+(?:[.,]\d{1,2})?\s*(?:€|euro)?\b/i,
    /(?:€\s*)?\d+(?:[.,]\d{1,2})?\s*(?:€|euro)?\s+statt\b/i,
  ];
  const concrete = concreteOfferPatterns.some((pattern) => pattern.test(offerEvidenceText))
    || hasLowProductPrice(offerEvidenceText)
    || (isViennaOriginFlight(deal)
      && /\b(?:hin\s*&?\s*zurück|roundtrip|return)\b[^.!?]{0,100}\bab\s*(?:€\s*)?\d+(?:[.,]\d{1,2})?/i.test(offerEvidenceText));
  if (!concrete && shippingSignal.test(offerText)) {
    return { concrete: false, reason: 'nur Gratis-Lieferung/Versand, kein eigentlicher Deal' };
  }
  if (!concrete) {
    return { concrete: false, reason: 'kein konkretes Angebot erkennbar' };
  }
  return { concrete: true, reason: '' };
}

function getRelativeOfferDecision(deal, selectedPublication, now, options = {}) {
  if (!selectedPublication?.date || options.activeValidity || options.recurring) return { blocked: false };
  const text = getOfferText(deal, options.health);
  const mentionsToday = /\b(?:heute|today|tonight)\b/i.test(text)
    && !/\b(?:ab\s+heute|starting\s+today|from\s+today)\b/i.test(text);
  const oneDayOffer = mentionsToday && /\b(?:gratis|kostenlos|free\s+entry|free|rabatt|aktion|deal|special)\b/i.test(text);
  if (!oneDayOffer) return { blocked: false };

  const publicationDay = toIsoDate(selectedPublication.date);
  const today = toIsoDate(startOfUtcDay(now));
  if (!publicationDay || publicationDay >= today) return { blocked: false };
  return {
    blocked: true,
    reason: `relative Kurz-Aktion abgelaufen (${publicationDay})`,
  };
}

function isChurchServiceDeal(deal) {
  const signal = [
    deal.category,
    deal.source,
    deal.originSource,
    deal.title,
    deal.description,
  ].map(cleanText).join(' ').toLowerCase();

  return /\b(gottesdienste?|freikirche|freikirchen|church service|service times)\b/i.test(signal);
}

function shouldAllowChurchThisRun(now, options = {}) {
  const configured = Number(options.churchWeekday ?? process.env.DEAL_VALIDITY_CHURCH_WEEKDAY ?? DEFAULT_CHURCH_WEEKDAY);
  const weekday = Number.isFinite(configured) ? configured : DEFAULT_CHURCH_WEEKDAY;
  return startOfUtcDay(now).getUTCDay() === weekday;
}

function collectExpiryCandidates(deal, health, now) {
  const candidates = [];
  const add = (source, raw, shape = null, rank = 50) => {
    const text = cleanText(raw);
    const offerWindow = !shape && text ? extractActiveOfferWindow(text, { now }) : null;
    const parsedShape = shape || (offerWindow ? {
      kind: offerWindow.kind,
      raw: offerWindow.evidence || text,
      validFrom: offerWindow.startDate?.toISOString().slice(0, 10) || '',
      validUntil: offerWindow.endDate?.toISOString().slice(0, 10) || '',
      confidence: 'medium',
    } : (text ? parseExpiryShape(text, {
      now,
      contextText: [deal.title, deal.description, deal.category, deal.type].filter(Boolean).join(' '),
    }) : null));
    if (!parsedShape) return;
    candidates.push({
      source,
      raw: text || cleanText(parsedShape.raw),
      kind: cleanText(parsedShape.kind),
      validOn: cleanText(parsedShape.validOn),
      validFrom: cleanText(parsedShape.validFrom),
      validUntil: cleanText(parsedShape.validUntil),
      confidence: cleanText(parsedShape.confidence),
      rank,
    });
  };

  const rawDealExpiry = deal.expires || deal.expiresOriginal || deal.end_date || deal.validity_date || '';
  const flightDepartureAsExpiry = isViennaOriginFlight(deal)
    && /^\s*(?:abflug|departure|hinflug)\b/i.test(cleanText(rawDealExpiry));
  if (!flightDepartureAsExpiry) {
    add('deal.expires', rawDealExpiry, null, 50);
  }

  const offerTiming = deal.evidence?.offerTiming;
  if (offerTiming && (offerTiming.validFrom || offerTiming.validUntil || offerTiming.recurring)) {
    add('deal.evidence.offerTiming', offerTiming.matchedText || deal.evidence?.offerDateSignal || '', {
      kind: offerTiming.kind || (offerTiming.recurring ? 'recurring' : 'end'),
      raw: offerTiming.matchedText || deal.evidence?.offerDateSignal || '',
      validFrom: toIsoDate(offerTiming.validFrom),
      validUntil: toIsoDate(offerTiming.validUntil),
      confidence: 'high',
    }, 95);
  }

  if (deal.validOn || deal.validFrom || deal.validUntil) {
    const structuredProvenance = [deal.expirySource, deal.expiryKind]
      .map(cleanText)
      .join(' ');
    const lowConfidenceReviewTtl = /review[-_\s]?ttl/i.test(structuredProvenance)
      && confidenceRank(deal.dateConfidence) <= 1;
    add('deal.structured', deal.expiryDisplayText || deal.expires || '', {
      kind: deal.expiryKind || (deal.validOn ? 'single' : (deal.validUntil ? 'end' : 'start')),
      raw: deal.expiryDisplayText || deal.expires || '',
      validOn: deal.validOn || '',
      validFrom: deal.validFrom || '',
      validUntil: deal.validUntil || '',
      confidence: deal.dateConfidence || '',
    }, lowConfidenceReviewTtl ? 40 : 90);
  }

  const hints = reliableDateHints(health);
  const hintEvidence = cleanText(hints.targetDateEvidence);
  const hintRaw = cleanText(hints.targetDateRaw);
  const explicitHintLanguage = /\b(?:gültig|gueltig|einlösbar|einloesbar|aktion|angebot|deal|nur)\s+(?:bis|am|ab)\b|\b(?:endet|deadline|valid\s+until|until\s+further\s+notice)\b/i.test(hintRaw);
  const structuredHint = hintEvidence === 'structured-data'
    || /(?:validthrough|enddate|startdate|availabilityends|availabilitystarts)/i.test(cleanText(hints.targetDateSource));
  const trustedTargetHint = hintEvidence === 'explicit-phrase' || explicitHintLanguage || structuredHint;
  if (!isViennaOriginFlight(deal) && trustedTargetHint && (hints.validOn || hints.validFrom || hints.validUntil)) {
    add('url.dateHints', hints.targetDateRaw || hints.validOn || hints.validUntil || hints.validFrom, {
      kind: hints.targetDateKind || (hints.validOn ? 'single' : (hints.validUntil ? 'end' : 'start')),
      raw: hints.targetDateRaw || '',
      validOn: hints.validOn || '',
      validFrom: hints.validFrom || '',
      validUntil: hints.validUntil || '',
      confidence: 'url',
    }, 100);
  }

  return candidates.filter((candidate) => candidate.validOn || candidate.validFrom || candidate.validUntil || candidate.kind === 'recurring');
}

function confidenceRank(value) {
  const confidence = cleanText(value).toLowerCase();
  if (confidence === 'high' || confidence === 'url') return 3;
  if (confidence === 'medium') return 2;
  if (confidence === 'low') return 1;
  return 0;
}

function isAfterToday(isoDate, now) {
  const text = cleanText(isoDate);
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/)?.[1];
  if (dateOnly) return dateOnly > toIsoDate(startOfUtcDay(now));
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function getExpiryDecision(expiryCandidates, now) {
  const ranked = [...expiryCandidates].sort((left, right) => {
    const rankDifference = Number(right.rank || 0) - Number(left.rank || 0);
    if (rankDifference) return rankDifference;
    const confidenceDifference = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    if (confidenceDifference) return confidenceDifference;
    const rightTerminal = Date.parse(right.validUntil || right.validOn || '') || 0;
    const leftTerminal = Date.parse(left.validUntil || left.validOn || '') || 0;
    return rightTerminal - leftTerminal;
  });
  const selected = ranked[0] || null;
  if (!selected) return { blocked: false, candidate: null };

  const expired = (selected.validOn && isBeforeToday(selected.validOn, now))
    || (selected.validUntil && isBeforeToday(selected.validUntil, now));
  if (expired) {
    return {
      blocked: true,
      reason: `abgelaufen (${selected.validOn || selected.validUntil})`,
      source: selected.source,
      candidate: selected,
    };
  }

  const startsOn = selected.validFrom || selected.validOn || '';
  if (startsOn && isAfterToday(startsOn, now)) {
    return {
      blocked: true,
      reason: `noch nicht gestartet (${startsOn})`,
      source: selected.source,
      candidate: selected,
    };
  }
  return { blocked: false, source: selected.source, candidate: selected };
}

function isTrustedPublicationSource(value) {
  const source = cleanText(value);
  return Boolean(source)
    && !SYNTHETIC_PUBLICATION_SOURCE_PATTERN.test(source)
    && TRUSTED_PUBLICATION_SOURCE_PATTERN.test(source);
}

function getPublicationCandidates(deal, health, options = {}) {
  const dateHints = reliableDateHints(health);
  const candidates = [];
  const add = (source, value, rank = 50) => {
    const date = toDate(value);
    if (!date) return;
    candidates.push({
      source,
      iso: date.toISOString(),
      date,
      rank,
    });
  };

  if (!options.ignoreUrlPublicationDate) {
    add('url.publicationDate', dateHints.publicationDate, 100);
  }
  const encodedSocial = getEncodedSocialPublication(deal.url);
  if (encodedSocial) {
    add(encodedSocial.source, encodedSocial.date, encodedSocial.rank);
  }

  const freshnessSensitive = Boolean(options.freshnessSensitive);
  const sourcePublishedAtSource = cleanText(
    deal.sourcePublishedAtSource
      || deal.sourceDateSource
      || deal.evidence?.sourcePublishedAtSource
  );
  if (!freshnessSensitive || isTrustedPublicationSource(sourcePublishedAtSource)) {
    add(
      `deal.${sourcePublishedAtSource || 'sourcePublishedAt'}`,
      deal.sourcePublishedAt || deal.source_published_at || deal.evidence?.sourcePublishedAt,
      90,
    );
  }

  const pubDateSource = cleanText(deal.pubDateSource);
  if (!freshnessSensitive || isTrustedPublicationSource(pubDateSource)) {
    add(`deal.${pubDateSource || 'pubDate'}`, deal.pubDate, 80);
  }

  if (freshnessSensitive) {
    return candidates;
  }
  add('deal.createdAt', deal.createdAt, 30);
  add('deal.submittedAt', deal.submittedAt, 25);
  add('deal.lastUpdated', deal.lastUpdated, 20);
  add('deal.discoveredAt', deal.discoveredAt, 10);
  return candidates;
}

function hasRecurringSchedule(deal, expiryCandidates = []) {
  const text = [
    deal.title,
    deal.description,
    deal.expires,
    deal.expiryDisplayText,
    deal.evidence?.offerDateSignal,
    deal.evidence?.textSample,
    ...expiryCandidates.map((candidate) => candidate.raw),
  ].map(cleanText).filter(Boolean).join(' ');
  return Boolean(deal.evidence?.offerTiming?.recurring) || hasRecurringOfferSchedule(text);
}

function hasActiveExplicitValidity(deal, expiryDecision, now) {
  if (expiryDecision.blocked || !expiryDecision.candidate) return false;
  const candidate = expiryDecision.candidate;
  const terminalDate = candidate.validUntil || candidate.validOn || '';
  if (candidate.kind === 'recurring') return false;
  const structuredValidity = Number(candidate.rank || 0) >= 90;
  const rawHasExplicitYear = /\b20\d{2}\b/.test(candidate.raw);
  const rawConfidence = confidenceRank(deal.dateConfidence) >= 2;
  const firecrawlDeal = /\bfirecrawl\b/i.test([
    deal.source,
    deal.originSource,
    deal.id,
  ].map(cleanText).join(' '));
  if (!structuredValidity && !(candidate.source === 'deal.expires' && rawHasExplicitYear && (rawConfidence || firecrawlDeal))) {
    return false;
  }
  if (candidate.kind === 'ongoing' && candidate.validFrom) {
    const dateOnly = cleanText(candidate.validFrom).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) && dateOnly <= toIsoDate(startOfUtcDay(now));
  }
  if (!terminalDate) return false;
  const dateOnly = cleanText(terminalDate).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) && dateOnly >= toIsoDate(startOfUtcDay(now));
}

function getFreshnessDecision(publicationCandidates, maxAgeDays, now, options = {}) {
  const extendedBy = options.activeValidity
    ? 'ausdrücklich noch aktive Gültigkeit'
    : (options.recurring ? 'wiederkehrender Zeitplan' : '');
  if (publicationCandidates.length === 0) {
    if (options.requireDate && options.activeValidity) {
      return {
        blocked: false,
        warning: 'kein verlässliches Quell-/Post-Datum; zugelassen: ausdrücklich noch aktive Gültigkeit',
        selected: null,
        ageDays: null,
      };
    }
    return {
      blocked: Boolean(options.requireDate),
      reason: options.requireDate
        ? (options.socialPost
            ? 'kein echtes Social-Post-Datum gefunden'
            : 'kein verlässliches Quell-/Post-Datum gefunden')
        : '',
      warning: 'kein Quell-/Post-Datum gefunden',
      selected: null,
    };
  }

  const selected = [...publicationCandidates].sort((left, right) => (
    Number(right.rank || 0) - Number(left.rank || 0)
    || right.date.getTime() - left.date.getTime()
  ))[0];

  if (selected.date.getTime() > now.getTime() + FUTURE_CLOCK_SKEW_MS) {
    return {
      blocked: true,
      reason: `Quell-/Post-Datum liegt in der Zukunft (${toIsoDate(selected.date)})`,
      selected,
      ageDays: null,
    };
  }

  const age = ageDays(selected.date, now);
  if (age !== null && age > maxAgeDays) {
    if (extendedBy && age <= options.extendedMaxAgeDays) {
      return {
        blocked: false,
        warning: `Post ist ${age} Tage alt; zugelassen wegen ${extendedBy}`,
        selected,
        ageDays: Number(age.toFixed(1)),
      };
    }
    return {
      blocked: true,
      reason: extendedBy && age > options.extendedMaxAgeDays
        ? `älter als ${options.extendedMaxAgeDays} Tage trotz ${extendedBy} (${toIsoDate(selected.date)})`
        : `älter als ${maxAgeDays} Tage (${toIsoDate(selected.date)})`,
      selected,
      ageDays: Number(age.toFixed(1)),
    };
  }

  return {
    blocked: false,
    selected,
    ageDays: Number(ageDays(selected.date, now).toFixed(1)),
  };
}

function summarizeUrlHealth(health) {
  if (!health) return 'nicht geprüft';
  if (health.invalid) return `ungültig: ${health.reason || 'URL ungültig'}`;
  if (health.transientError) return `unklar: ${health.reason || 'temporärer URL-Fehler'}`;
  if (health.status) return `HTTP ${health.status}`;
  return 'geprüft';
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function inspectUrlWithCache(url, cache, options) {
  if (!url) {
    return { invalid: true, reason: 'fehlende Ziel-URL' };
  }
  if (cache.has(url)) return cache.get(url);
  const inspector = options.inspectDealUrlHealth || inspectDealUrlHealth;
  const health = await inspector(url, options);
  cache.set(url, health);
  return health;
}

function buildPublicValidationMeta(decision) {
  return {
    status: decision.allowed ? (decision.warnings.length ? 'warning' : 'ok') : 'blocked',
    checkedAt: decision.checkedAt,
    reasons: decision.reasons,
    warnings: decision.warnings,
    sourceDate: decision.sourceDate,
    sourceDateSource: decision.sourceDateSource,
    sourceAgeDays: decision.sourceAgeDays,
    expiryDate: decision.expiryDate,
    expirySource: decision.expirySource,
    urlStatus: decision.urlStatus,
    finalUrl: decision.finalUrl,
  };
}

async function validateDeal(deal, context) {
  const now = context.now;
  const checkedAt = new Date().toISOString();
  const url = normalizeUrl(deal.url);
  const health = await inspectUrlWithCache(url, context.urlCache, context.urlOptions);
  const excludedSource = getExcludedSourceMatch(deal, health);
  const socialPostDeal = isSocialPostDeal(deal);
  const newsAggregatorDeal = isNewsAggregatorDeal(deal);
  const sharedBenefitPageDeal = isSharedBenefitPageDeal(deal);
  const freshnessSensitive = socialPostDeal || newsAggregatorDeal || isCrawlerDeal(deal);
  const expiryCandidates = collectExpiryCandidates(deal, health, now);
  const expiry = getExpiryDecision(expiryCandidates, now);
  const recurring = hasRecurringSchedule(deal, expiryCandidates);
  const activeValidity = hasActiveExplicitValidity(deal, expiry, now);
  const publicationCandidates = getPublicationCandidates(deal, health, {
    freshnessSensitive,
    ignoreUrlPublicationDate: sharedBenefitPageDeal,
  });
  const freshness = getFreshnessDecision(publicationCandidates, context.maxAgeDays, now, {
    // Crawler run timestamps are ignored, but an official non-social offer
    // page may legitimately have no publication date. Social posts still
    // need a real platform timestamp (or explicit active validity evidence).
    requireDate: socialPostDeal || newsAggregatorDeal,
    socialPost: socialPostDeal,
    activeValidity,
    recurring,
    extendedMaxAgeDays: context.extendedMaxAgeDays,
  });
  const relativeOffer = getRelativeOfferDecision(deal, freshness.selected, now, {
    activeValidity,
    health,
    recurring,
  });
  const offer = getConcreteOfferDecision(deal, health);
  const reasons = [];
  const warnings = [];

  if (health?.invalid) {
    reasons.push(`URL ungültig (${health.reason || 'unbekannt'})`);
  } else if (health?.transientError) {
    warnings.push(`URL nicht eindeutig prüfbar (${health.reason || 'temporärer Fehler'})`);
  }

  if (excludedSource) {
    reasons.push(`ausgeschlossene Quelle (${excludedSource.label})`);
  }

  if (context.requireVienna && !isExplicitlyUsableInVienna(deal, health)) {
    reasons.push('nicht eindeutig in Wien');
  }

  if (!offer.concrete) {
    reasons.push(offer.reason);
  }

  if (isChurchServiceDeal(deal) && !context.allowChurchThisRun) {
    reasons.push('Gottesdienste nur im Wochenlauf');
  }

  if (freshness.blocked) {
    reasons.push(freshness.reason);
  } else if (freshness.warning) {
    warnings.push(freshness.warning);
  }

  if (expiry.blocked) {
    reasons.push(expiry.reason);
  } else if (expiryCandidates.length === 0) {
    warnings.push('kein Ablaufdatum gefunden');
  }

  if (relativeOffer.blocked) {
    reasons.push(relativeOffer.reason);
  }

  const selectedExpiry = expiry.candidate || null;
  const selectedDate = freshness.selected || null;
  const allowed = reasons.length === 0;
  const decision = {
    allowed,
    checkedAt,
    reasons,
    warnings,
    sourceDate: selectedDate?.iso || '',
    sourceDateSource: selectedDate?.source || '',
    sourceAgeDays: freshness.ageDays ?? null,
    expiryDate: selectedExpiry?.validOn || selectedExpiry?.validUntil || '',
    expirySource: selectedExpiry?.source || '',
    urlStatus: summarizeUrlHealth(health),
    finalUrl: health?.finalUrl || url,
  };

  const nextDeal = {
    ...deal,
    url: url || deal.url,
    validity: buildPublicValidationMeta(decision),
  };

  if (selectedDate?.iso && (
    !deal.pubDate
    || selectedDate.source.startsWith('url.')
    || !isTrustedPublicationSource(deal.pubDateSource)
  )) {
    nextDeal.pubDate = selectedDate.iso;
    nextDeal.pubDateSource = selectedDate.source;
  }

  if (selectedExpiry?.validOn || selectedExpiry?.validFrom || selectedExpiry?.validUntil) {
    nextDeal.expiryKind = selectedExpiry.kind || nextDeal.expiryKind;
    nextDeal.expiryDisplayText = selectedExpiry.raw || nextDeal.expiryDisplayText;
    nextDeal.dateConfidence = selectedExpiry.confidence || nextDeal.dateConfidence;
    if (selectedExpiry.validOn) nextDeal.validOn = selectedExpiry.validOn;
    if (selectedExpiry.validFrom) nextDeal.validFrom = selectedExpiry.validFrom;
    if (selectedExpiry.validUntil) nextDeal.validUntil = selectedExpiry.validUntil;
  }

  return { deal: nextDeal, decision };
}

function buildSummary(results, maxAgeDays) {
  const allowed = results.filter((item) => item.decision.allowed);
  const blocked = results.filter((item) => !item.decision.allowed);
  const warning = allowed.filter((item) => item.decision.warnings.length > 0);
  const reasonCounts = {};
  const reasonCategoryCounts = {};
  for (const item of blocked) {
    for (const reason of item.decision.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      const category = classifyBlockReason(reason);
      reasonCategoryCounts[category] = (reasonCategoryCounts[category] || 0) + 1;
    }
  }
  return {
    maxAgeDays,
    total: results.length,
    allowed: allowed.length,
    blocked: blocked.length,
    warnings: warning.length,
    reasonCounts,
    reasonCategoryCounts,
  };
}

function classifyBlockReason(reason) {
  const text = cleanText(reason).toLowerCase();
  if (text.startsWith('älter') || text.startsWith('aelter')) return 'älter als 7 Tage';
  if (text.startsWith('abgelaufen')) return 'abgelaufen';
  if (text.startsWith('relative kurz-aktion abgelaufen')) return 'abgelaufen';
  if (text.startsWith('url ungültig')) return 'ungültige URL';
  if (text.startsWith('ausgeschlossene quelle')) return 'ausgeschlossene Quelle';
  if (text.startsWith('nicht eindeutig in wien')) return 'nicht Wien';
  if (text.startsWith('kein konkretes angebot') || text.startsWith('nur gratis-lieferung') || text.startsWith('allgemeine empfehlung')) return 'kein konkreter Deal';
  if (text.startsWith('gewinnspiel')) return 'Gewinnspiel';
  if (text.startsWith('kein verlässliches quell') || text.startsWith('kein echtes social-post-datum')) return 'kein echtes Post-Datum';
  if (text.startsWith('quell-/post-datum liegt in der zukunft')) return 'Post-Datum in Zukunft';
  if (text.startsWith('noch nicht gestartet')) return 'noch nicht gestartet';
  if (text.startsWith('gottesdienste nur')) return 'Gottesdienste außerhalb Wochenlauf';
  return 'sonstiges';
}

function buildReport(results, summary) {
  const pick = (item) => ({
    id: item.deal.id,
    title: item.deal.title,
    brand: item.deal.brand,
    source: item.deal.originSource || item.deal.source,
    url: item.deal.url,
    reasons: item.decision.reasons,
    warnings: item.decision.warnings,
    sourceDate: item.decision.sourceDate,
    sourceDateSource: item.decision.sourceDateSource,
    sourceAgeDays: item.decision.sourceAgeDays,
    expiryDate: item.decision.expiryDate,
    expirySource: item.decision.expirySource,
    urlStatus: item.decision.urlStatus,
  });

  return {
    generatedAt: new Date().toISOString(),
    summary,
    allowed: results.filter((item) => item.decision.allowed).map(pick),
    blocked: results.filter((item) => !item.decision.allowed).map(pick),
  };
}

async function validateDealsForSlack(deals, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const configuredMaxAgeDays = Number(options.maxAgeDays || process.env.DEAL_VALIDITY_MAX_AGE_DAYS || 7);
  const maxAgeDays = Number.isFinite(configuredMaxAgeDays) && configuredMaxAgeDays >= 0 ? configuredMaxAgeDays : 7;
  const configuredExtendedMaxAgeDays = Number(
    options.extendedMaxAgeDays
      || process.env.DEAL_VALIDITY_EXTENDED_MAX_AGE_DAYS
      || DEFAULT_EXTENDED_MAX_AGE_DAYS
  );
  const extendedMaxAgeDays = Number.isFinite(configuredExtendedMaxAgeDays)
    && configuredExtendedMaxAgeDays >= maxAgeDays
    ? configuredExtendedMaxAgeDays
    : Math.max(DEFAULT_EXTENDED_MAX_AGE_DAYS, maxAgeDays);
  const concurrency = Number(options.concurrency || process.env.DEAL_VALIDITY_URL_CONCURRENCY || 8);
  const timeoutMs = Number(options.timeoutMs || process.env.URL_CHECK_TIMEOUT_MS || 7000);
  const urlCache = options.urlCache || new Map();
  const requireVienna = options.requireVienna ?? process.env.DEAL_VALIDITY_REQUIRE_VIENNA !== '0';
  const context = {
    now,
    maxAgeDays,
    extendedMaxAgeDays,
    requireVienna,
    allowChurchThisRun: options.allowChurchThisRun ?? shouldAllowChurchThisRun(now, options),
    urlCache,
    urlOptions: {
      now,
      timeoutMs,
      inspectDealUrlHealth: options.inspectDealUrlHealth,
    },
  };

  const results = await mapWithConcurrency(deals, concurrency, (deal) => validateDeal(deal, context));
  const summary = buildSummary(results, maxAgeDays);
  const report = buildReport(results, summary);

  return {
    allowedDeals: results.filter((item) => item.decision.allowed).map((item) => item.deal),
    blockedDeals: results.filter((item) => !item.decision.allowed).map((item) => item.deal),
    results,
    summary,
    report,
  };
}

function writeDealValidityReport(report, reportPath = DEFAULT_REPORT_PATH) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

export {
  DEFAULT_REPORT_PATH,
  validateDealsForSlack,
  writeDealValidityReport,
};
