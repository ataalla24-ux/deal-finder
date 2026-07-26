import {
  canonicalInstagramPostKey,
  decodeInstagramShortcodeDate,
  getPublicationEvidence,
  getViennaEvidence,
} from './deal-evidence-utils.js';
import { normalizeInstagramPostUrl } from './firecrawl-post-verifier.js';
import {
  evaluateInstagramOfferTiming,
  hasViennaInstagramEvidence,
} from './instagram-ai-validity-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const GIVEAWAY_PATTERN = /\b(?:gewinnspiel|giveaway|verlosung|zu gewinnen|win(?:ne|nen)?|tagge|markiere|kommentiere|folge uns|follow us)\b/i;
const FREE_ATTRIBUTE_PATTERN = /\b(?:gluten|sugar|zucker|lactose|laktose|alcohol|alkohol|dairy|plastic|meat|fleisch|cruelty|guilt)[-\s]?free\b|\bfree[-\s]?flow\b|\b(?:free|gratis|kostenlos(?:er)?)\s+(?:entry|admission|eintritt|shipping|versand|delivery|lieferung|wifi|wlan|parking|parkplatz)\b|\b(?:eintritt|entry|admission|versand|shipping|lieferung|delivery|wlan|wifi|parking|parkplatz)\s+(?:frei|gratis|kostenlos|free)\b/gi;
const FREE_OFFER_PATTERN = /(?:\bgratis\b|\bkostenlos(?:e[nrms]?)?\b|\bkostenfrei\b|\bumsonst\b|\bfor free\b|\bcomplimentary\b|\baufs haus\b|\bon the house\b|\b0\s*(?:€|eur|euro)\b|\b1\s*[+&]\s*1\b|\b2\s*(?:für|fuer|for)\s*1\b|\b2\s*[+&]\s*1\b|\bbogo\b|\bbuy one get one(?: free)?\b|\bwelcome drink\b|\b(?:free|gratis|kostenlose?)\s+(?:sample|probe|kostprobe|verkostung|tasting)\b)/i;
const FOOD_DRINK_PATTERN = /\b(?:essen|food|speise|gericht|menü|menu|meal|frühstück|fruehstueck|brunch|lunch|dinner|buffet|restaurant|gastronomie|cafe|café|kaffee|coffee|espresso|latte|cappuccino|matcha|tee|tea|drink|getränk|getraenk|cocktail|spritz|bier|beer|wein|wine|sekt|saft|juice|smoothie|limonade|pizza|burger|döner|doener|kebab|kebap|falafel|sushi|ramen|pasta|tiramisu|dessert|kuchen|cake|croissant|bagel|waffel|eis|gelato|sandwich|snack|pommes|fries|taco|burrito|bakery|bäckerei|baeckerei|brot|gebäck|gebaeck)\b/i;
const DRINK_PATTERN = /\b(?:kaffee|coffee|espresso|latte|cappuccino|matcha|tee|tea|drink|getränk|getraenk|cocktail|spritz|bier|beer|wein|wine|sekt|saft|juice|smoothie|limonade|shake)\b/i;
const NON_CONSUMABLE_FREE_PATTERN = /(?:\b(?:maschine|maschinen|gerät|geräte|geraet|geraete|equipment|software|beratung|consulting|kurs|course|app)\b.{0,100}\b(?:gratis|kostenlos|for free|free)\b|\b(?:gratis|kostenlos|for free|free)\b.{0,100}\b(?:maschine|maschinen|gerät|geräte|geraet|geraete|equipment|software|beratung|consulting|kurs|course|app)\b|\b(?:service|reparatur|wartungs?)[-\s]?(?:pauschale|gebühr|gebuehr|fee)\b)/i;
const VIENNA_POSTCODE_PATTERN = /(?:^|\D)(1(?:0[1-9]|1\d|2[0-3])0)(?!\d)/;
const VIENNA_DISTRICT_PATTERN = /\b(?:innere stadt|leopoldstadt|landstra(?:ß|ss)e|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|währing|waehring|döbling|doebling|brigittenau|floridsdorf|donaustadt|liesing|(?:1\d|2[0-3])\.\s*bezirk)\b/i;
const STREET_PATTERN = /\b(?:stra(?:ß|ss)e|gasse|platz|weg|ring|allee|kai|markt|zeile|promenade|graben|ufer|steg)\b/i;
const OUTSIDE_VIENNA_PATTERN = /\b(?:raus|hinaus|außerhalb|ausserhalb)\s+(?:aus|von)?\s*wien\b|\bvor\s+den\s+toren\s+(?:von\s+)?wien\b/i;
const UNKNOWN_VALUE_PATTERN = /^(?:unknown|unbekannt|nicht angegeben|keine angabe|n\/?a|null|undefined|-+)$/i;

function cleanText(value, maxLength = Infinity) {
  const text = value === null || value === undefined
    ? ''
    : String(value).replace(/\s+/g, ' ').trim();
  return Number.isFinite(maxLength) ? text.slice(0, maxLength) : text;
}

function usableText(value, maxLength = Infinity) {
  const text = cleanText(value, maxLength);
  return text && !UNKNOWN_VALUE_PATTERN.test(text) ? text : '';
}

function normalizeUsername(value) {
  const username = usableText(value, 80).replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{2,40}$/.test(username)) return '';
  if (/^(?:unknown|unbekannt|instagram|wien|vienna|restaurant|gastro|admin|user)$/.test(username)) return '';
  return username;
}

function stableHash(value) {
  let hash = 5381;
  for (const character of String(value || '')) {
    hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function offerType(signal) {
  if (/\b(?:1\s*[+&]\s*1|2\s*(?:für|fuer|for)\s*1|2\s*[+&]\s*1|bogo|buy one get one)\b/i.test(signal)) {
    return 'bogo';
  }
  return 'gratis';
}

function offerCategory(signal) {
  return DRINK_PATTERN.test(signal) ? 'kaffee' : 'essen';
}

function sameInstagramPost(left, right) {
  const leftKey = canonicalInstagramPostKey(left);
  const rightKey = canonicalInstagramPostKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function specificViennaLocation(value) {
  const location = cleanText(value, 500);
  if (!location || !hasViennaInstagramEvidence(location)) return false;
  if (VIENNA_POSTCODE_PATTERN.test(location)) return true;
  if (VIENNA_DISTRICT_PATTERN.test(location)) return true;
  return /\b(?:wien|vienna)\b/i.test(location) && STREET_PATTERN.test(location);
}

function viennaDateKey(value) {
  const date = value instanceof Date ? value : new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function isExpiredRelativeOffer(signal, publicationDate, now) {
  if (!publicationDate) return false;
  const todayOnly = /\b(?:nur heute|heute nur|only today|today only)\b/i.test(signal)
    && !/\b(?:ab heute|starting today|from today)\b/i.test(signal);
  return todayOnly && viennaDateKey(publicationDate) < viennaDateKey(now);
}

function dealSignal(deal = {}) {
  return [
    deal.postCaption,
    deal.title,
    deal.description,
    deal.offerTypeOriginal,
    deal.expiresOriginal,
    deal.expiryDisplayText,
    deal.expires,
  ].map((value) => cleanText(value, 2400)).filter(Boolean).join(' ');
}

function freeFoodDrinkSignalDecision(originalSignal) {
  const signal = originalSignal.replace(FREE_ATTRIBUTE_PATTERN, ' ');
  if (GIVEAWAY_PATTERN.test(originalSignal)) return { accepted: false, reason: 'giveaway' };
  if (!FREE_OFFER_PATTERN.test(signal)) return { accepted: false, reason: 'not-free' };
  if (!FOOD_DRINK_PATTERN.test(signal)) return { accepted: false, reason: 'not-food-drink' };
  if (NON_CONSUMABLE_FREE_PATTERN.test(signal)) {
    return { accepted: false, reason: 'free-item-not-food-drink' };
  }
  return { accepted: true, reason: '' };
}

function verifiedOriginalPostSignal(deal = {}) {
  const verificationStatus = cleanText(
    deal.postVerification?.status || deal.evidence?.originalPost?.status,
  ).toLowerCase();
  if (verificationStatus !== 'verified-original-post') return '';
  return [
    deal.postCaption,
    deal.evidence?.originalPost?.captionSample,
  ].map((value) => cleanText(value, 2600)).filter(Boolean).join(' ');
}

function originalOfferSummary(signal) {
  const text = cleanText(signal, 2600);
  const match = text.match(FREE_OFFER_PATTERN);
  if (!match || match.index === undefined) return '';
  const matchStart = match.index;
  const previousBoundary = Math.max(
    text.lastIndexOf('.', matchStart - 1),
    text.lastIndexOf('!', matchStart - 1),
    text.lastIndexOf('?', matchStart - 1),
  );
  const following = text.slice(matchStart + match[0].length);
  const followingBoundary = following.search(/[.!?](?:\s|$)/);
  const end = followingBoundary >= 0
    ? matchStart + match[0].length + followingBoundary + 1
    : Math.min(text.length, matchStart + match[0].length + 140);
  let summary = cleanText(text.slice(previousBoundary + 1, end), 240);
  if (summary.length < 12) {
    summary = cleanText(text.slice(Math.max(0, matchStart - 70), matchStart + match[0].length + 140), 240);
  }
  return summary;
}

function verifiedDisplayBrand(deal = {}) {
  const brand = cleanText(deal.brand, 120);
  const ownerUsername = normalizeUsername(deal.ownerUsername);
  const unreliableBrand = !brand
    || /^(?:instagram gastro|instagram|restaurant)$/i.test(brand)
    || brand.length > 60
    || /\bon instagram\b|\.\.\.|…/i.test(brand);
  return unreliableBrand && ownerUsername ? `@${ownerUsername}` : (brand || 'Instagram Gastro');
}

function publicationDecision(deal, now, maxAgeDays) {
  const publication = getPublicationEvidence(deal);
  const date = publication.sourcePublishedAt ? new Date(publication.sourcePublishedAt) : null;
  if (!date || Number.isNaN(date.getTime()) || publication.publicationEvidenceRank < 4) {
    return { accepted: false, reason: 'missing-real-post-date', publication, date: null, timing: null };
  }

  const timing = evaluateInstagramOfferTiming({
    now,
    pubDate: date,
    signal: dealSignal(deal),
    maxAgeDays,
    activeOfferMaxAgeDays: maxAgeDays,
    futureSkewMinutes: 10,
  });
  if (timing.futurePublication) {
    return { accepted: false, reason: 'future-post-date', publication, date, timing };
  }
  if (!timing.withinFreshWindow) {
    return { accepted: false, reason: 'older-than-7-days', publication, date, timing };
  }
  if (timing.expired || isExpiredRelativeOffer(dealSignal(deal), date, now)) {
    return { accepted: false, reason: 'expired-offer', publication, date, timing };
  }
  if (timing.notStarted) {
    return { accepted: false, reason: 'not-started', publication, date, timing };
  }
  return { accepted: true, reason: '', publication, date, timing };
}

function viennaDecision(deal) {
  const verified = getViennaEvidence(deal);
  if (verified.hasViennaEvidence) {
    const type = cleanText(verified.type).toLowerCase();
    const value = cleanText(verified.value, 2600);
    const originalSignal = verifiedOriginalPostSignal(deal);
    const hasSpecificOriginalLocation = specificViennaLocation(originalSignal);
    const explicitlyOutside = OUTSIDE_VIENNA_PATTERN.test(originalSignal)
      && !VIENNA_POSTCODE_PATTERN.test(originalSignal);
    const needsSpecificOriginalLocation = /instagram-post|verified-flag|structured-city/.test(type);
    if (!explicitlyOutside && (!needsSpecificOriginalLocation || specificViennaLocation(value))) {
      return { accepted: true, source: verified.type, value: verified.value, cited: false };
    }
    if (!explicitlyOutside && hasSpecificOriginalLocation) {
      return {
        accepted: true,
        source: 'instagram-post-caption-specific-location',
        value: originalSignal.match(VIENNA_POSTCODE_PATTERN)?.[1] || value,
        cited: false,
      };
    }
  }

  const location = cleanText(deal.reportedLocation || deal.distance, 500);
  const citation = cleanText(deal.locationCitation);
  const fromSearchSnippet = (Array.isArray(deal.discoveredBy) ? deal.discoveredBy : [])
    .some((source) => /^firecrawl-search:/i.test(cleanText(source)));
  if (!fromSearchSnippet && specificViennaLocation(location) && sameInstagramPost(deal.url, citation)) {
    return {
      accepted: true,
      source: 'firecrawl-cited-original-post-location',
      value: location,
      cited: true,
      citation: normalizeInstagramPostUrl(citation),
    };
  }
  return { accepted: false, source: '', value: '', cited: false };
}

function richerDeal(left, right) {
  const score = (deal) => [
    deal.postVerification?.status === 'verified-original-post' ? 1000 : 0,
    getViennaEvidence(deal).hasViennaEvidence ? 500 : 0,
    cleanText(deal.postCaption).length,
    cleanText(deal.description).length,
  ].reduce((sum, value) => sum + Number(value || 0), 0);
  const primary = score(right) > score(left) ? right : left;
  const secondary = primary === left ? right : left;
  return {
    ...secondary,
    ...primary,
    discoveredBy: [...new Set([
      ...(Array.isArray(left.discoveredBy) ? left.discoveredBy : []),
      ...(Array.isArray(right.discoveredBy) ? right.discoveredBy : []),
    ].filter(Boolean))],
  };
}

export function normalizeKey4Offer(offer = {}, options = {}) {
  const url = normalizeInstagramPostUrl(offer.post_url || offer.postUrl || offer.url);
  if (!url) return null;

  const ownerUsername = normalizeUsername(offer.owner_username || offer.ownerUsername);
  const restaurantName = usableText(offer.restaurant_name || offer.restaurantName, 100)
    || ownerUsername
    || 'Instagram Gastro';
  const description = usableText(offer.offer_description || offer.description, 600);
  const rawOfferType = usableText(offer.offer_type || offer.offerType, 220);
  const location = usableText(offer.location || offer.reportedLocation, 500);
  const validUntil = usableText(offer.valid_until || offer.validUntil || offer.expires, 300);
  const signal = [restaurantName, description, rawOfferType].filter(Boolean).join(' ');
  const type = offerType(signal);
  const category = offerCategory(signal);
  const titleCore = description || rawOfferType || 'kostenloses Instagram-Angebot';
  const title = `${restaurantName}: ${titleCore}`.slice(0, 160);

  return {
    id: `fc4-${stableHash(`${restaurantName}|${title}|${url}`)}`,
    brand: restaurantName,
    title,
    description: [description, rawOfferType].filter(Boolean).join(' | ').slice(0, 800),
    type,
    category,
    source: 'Firecrawl Instagram Direct #4',
    originSource: 'firecrawl4',
    url,
    expires: validUntil,
    expiresOriginal: validUntil,
    expiryDisplayText: validUntil,
    distance: location,
    reportedLocation: location,
    locationCitation: usableText(offer.location_citation || offer.locationCitation, 1000),
    postUrlCitation: usableText(offer.post_url_citation || offer.postUrlCitation, 1000),
    ownerUsername,
    ownerUsernameCitation: usableText(offer.owner_username_citation || offer.ownerUsernameCitation, 1000),
    reportedPostDate: usableText(offer.post_date || offer.reportedPostDate, 120),
    reportedPostDateCitation: usableText(offer.post_date_citation || offer.reportedPostDateCitation, 1000),
    offerTypeOriginal: rawOfferType,
    agentCurrentlyValid: typeof offer.is_currently_valid === 'boolean'
      ? offer.is_currently_valid
      : null,
    discoveredBy: [usableText(options.discoverySource, 120)].filter(Boolean),
    hot: true,
    isNew: true,
    priority: type === 'gratis' ? 1 : 2,
    votes: 1,
    qualityScore: type === 'gratis' ? 82 : 76,
  };
}

export function searchResultToKey4Offer(result = {}, query = '') {
  const url = normalizeInstagramPostUrl(result.url || result.metadata?.sourceURL || result.metadata?.url);
  if (!url) return null;
  const title = usableText(result.title || result.metadata?.title, 300);
  const description = usableText(result.description || result.snippet || result.markdown, 1200);
  const signal = [title, description].filter(Boolean).join(' ');
  const owner = title.match(/^@?([a-z0-9._]{2,40})\s+(?:on|auf)\s+instagram\b/i)?.[1] || '';
  return {
    restaurant_name: title.replace(/\s+(?:on|auf)\s+instagram[\s:–-].*$/i, '').replace(/^@/, ''),
    post_url: url,
    post_url_citation: url,
    offer_description: signal,
    offer_description_citation: url,
    offer_type: signal,
    offer_type_citation: url,
    location: specificViennaLocation(signal) ? signal : '',
    location_citation: url,
    owner_username: owner,
    owner_username_citation: owner ? url : '',
    discoverySource: `firecrawl-search:${cleanText(query, 100)}`,
  };
}

export function dedupeKey4Deals(deals = []) {
  const byPost = new Map();
  for (const deal of deals.filter(Boolean)) {
    const key = canonicalInstagramPostKey(deal.url);
    if (!key) continue;
    byPost.set(key, byPost.has(key) ? richerDeal(byPost.get(key), deal) : deal);
  }
  return [...byPost.values()];
}

export function isRecentKey4PostUrl(url, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) return false;
  const configuredMaxAgeDays = Number(options.maxAgeDays ?? 7);
  const maxAgeDays = Math.min(7, Math.max(
    1,
    Number.isFinite(configuredMaxAgeDays) ? configuredMaxAgeDays : 7,
  ));
  const publishedAt = decodeInstagramShortcodeDate(url);
  if (!publishedAt) return false;
  const ageMs = now.getTime() - publishedAt.getTime();
  return ageMs >= -(10 * 60 * 1000) && ageMs <= maxAgeDays * DAY_MS;
}

export function qualifyKey4Deals(deals = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const configuredMaxAgeDays = Number(options.maxAgeDays ?? 7);
  const maxAgeDays = Math.min(7, Math.max(1, Number.isFinite(configuredMaxAgeDays) ? configuredMaxAgeDays : 7));
  const configuredMaxDeals = Number(options.maxDeals ?? 40);
  const maxDeals = Math.max(1, Number.isFinite(configuredMaxDeals) ? Math.floor(configuredMaxDeals) : 40);
  const rejected = [];
  const accepted = [];

  for (const rawDeal of dedupeKey4Deals(deals)) {
    const deal = { ...rawDeal, url: normalizeInstagramPostUrl(rawDeal.url) };
    let reason = '';
    const originalOfferSignal = verifiedOriginalPostSignal(deal);
    if (!originalOfferSignal) reason = 'missing-original-offer-evidence';
    const freeFood = originalOfferSignal
      ? freeFoodDrinkSignalDecision(originalOfferSignal)
      : { accepted: false, reason };
    if (!reason && !freeFood.accepted) reason = freeFood.reason;
    if (!reason && deal.agentCurrentlyValid === false) reason = 'agent-marked-expired';

    const publication = publicationDecision(deal, now, maxAgeDays);
    if (!reason && !publication.accepted) reason = publication.reason;

    const vienna = viennaDecision(deal);
    if (!reason && !vienna.accepted) reason = 'not-verified-vienna';

    if (reason) {
      rejected.push({ deal, reason });
      continue;
    }

    const publicationIso = publication.date.toISOString();
    const brand = verifiedDisplayBrand(deal);
    const offerSummary = originalOfferSummary(originalOfferSignal)
      || cleanText(deal.description, 220)
      || 'Kostenloses Instagram-Angebot';
    const next = {
      ...deal,
      brand,
      title: `${brand}: ${offerSummary}`.slice(0, 160),
      description: offerSummary,
      offerEvidenceText: offerSummary,
      descriptionSource: 'instagram-original-post',
      pubDate: publicationIso,
      pubDateSource: publication.publication.sourcePublishedAtSource,
      sourcePublishedAt: publicationIso,
      sourcePublishedAtSource: publication.publication.sourcePublishedAtSource,
      postAgeDays: Math.round((publication.timing.ageDays || 0) * 10) / 10,
      key4VerifiedAt: now.toISOString(),
      qualityScore: Math.min(100, Math.max(
        Number(deal.qualityScore) || 0,
        78
          + (deal.postVerification?.status === 'verified-original-post' ? 10 : 0)
          + (vienna.cited ? 4 : 8)
          + (publication.timing.ageDays <= 2 ? 4 : 0)
      )),
    };
    if (vienna.cited) {
      next.city = 'Wien';
      next.locationVerified = true;
      next.viennaVerified = true;
      next.viennaEvidence = {
        verified: true,
        source: 'structured-location',
        type: 'structured-location',
        value: vienna.value,
        detail: vienna.value,
        method: vienna.source,
        citation: vienna.citation,
      };
      if (!next.address) next.address = vienna.value;
    }
    accepted.push(next);
  }

  accepted.sort((left, right) => {
    const dateDifference = Date.parse(right.sourcePublishedAt) - Date.parse(left.sourcePublishedAt);
    if (dateDifference) return dateDifference;
    return Number(right.qualityScore || 0) - Number(left.qualityScore || 0);
  });

  const reasonCounts = rejected.reduce((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }, {});
  return {
    deals: accepted.slice(0, maxDeals),
    rejected,
    summary: {
      inputDeals: deals.length,
      distinctPosts: dedupeKey4Deals(deals).length,
      acceptedDeals: Math.min(accepted.length, maxDeals),
      acceptedBeforeLimit: accepted.length,
      maxAgeDays,
      maxDeals,
      rejectedByReason: reasonCounts,
    },
  };
}

export const KEY4_SEARCH_QUERIES = [
  'site:instagram.com/reel/ Wien "gratis Essen"',
  'site:instagram.com/reel/ Wien "gratis Kaffee"',
  'site:instagram.com/reel/ Wien "1+1 gratis"',
  'site:instagram.com/p/ Wien "kostenlos" Restaurant',
  'site:instagram.com/reel/ Wien "gratis Verkostung"',
  'site:instagram.com/reel/ Vienna "free food"',
];
