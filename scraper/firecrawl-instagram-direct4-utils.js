import {
  canonicalInstagramPostKey,
  decodeInstagramShortcodeDate,
} from './deal-evidence-utils.js';
import { normalizeInstagramPostUrl } from './firecrawl-post-verifier.js';
import { evaluateInstagramOfferTiming } from './instagram-ai-validity-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const GIVEAWAY_PATTERN = /\b(?:gewinnspiel|giveaway|verlosung|zu gewinnen|win(?:ne|nen)?|tagge|markiere|kommentiere|folge uns|follow us)\b/i;
const FREE_ATTRIBUTE_PATTERN = /\b(?:gluten|sugar|zucker|lactose|laktose|alcohol|alkohol|dairy|plastic|meat|fleisch|cruelty|guilt)[-\s]?free\b|\bfree[-\s]?flow\b|\b(?:free|gratis|kostenlos(?:er)?)\s+(?:entry|admission|eintritt|shipping|versand|delivery|lieferung|wifi|wlan|parking|parkplatz)\b|\b(?:eintritt|entry|admission|versand|shipping|lieferung|delivery|wlan|wifi|parking|parkplatz)\s+(?:frei|gratis|kostenlos|free)\b/gi;
const FREE_OFFER_PATTERN = /(?:\bgratis\b|\bkostenlos(?:e[nrms]?)?\b|\bkostenfrei\b|\bumsonst\b|\bfor free\b|\bcomplimentary\b|\baufs haus\b|\bon the house\b|\b0\s*(?:€|eur|euro)\b|\b1\s*[+&]\s*1\b|\b2\s*(?:für|fuer|for)\s*1\b|\b2\s*[+&]\s*1\b|\bbogo\b|\bbuy[\s,-]*(?:one|1)[\s,-]*get[\s,-]*(?:one|1)(?:[\s,-]*(?:free|gratis|kostenlos))?\b|\bwelcome drink\b|\b(?:free|gratis|kostenlose?)\s+(?:sample|probe|kostprobe|verkostung|tasting)\b)/i;
const FOOD_DRINK_PATTERN = /\b(?:essen|isst|iss|eat(?:ing)?|foods?|speisen?|gerichte?|menü|menus?|meals?|frühstück|fruehstueck|brunch|lunch|dinner|buffet|restaurant|gastronomie|cafe|café|kaffee|coffee|espresso|latte|cappuccino|matcha|tee|tea|drinks?|getränke?|getraenke?|cocktails?|spritz|bier|beer|wein|wine|sekt|saft|juice|smoothies?|limonade|pizzas?|burgers?|döner|doener|kebab|kebap|falafel|sushi|ramen|pasta|tiramisu|desserts?|kuchen|cakes?|croissants?|bagels?|waffeln?|eis|gelato|sandwich(?:es)?|snacks?|pommes|fries|tacos?|burritos?|bakery|bäckerei|baeckerei|brot|gebäck|gebaeck|onigiri)\b/i;
const DRINK_PATTERN = /\b(?:kaffee|coffee|espresso|latte|cappuccino|matcha|tee|tea|drinks?|getränke?|getraenke?|cocktails?|spritz|bier|beer|wein|wine|sekt|saft|juice|smoothies?|limonade|shakes?)\b/i;
const NON_CONSUMABLE_FREE_PATTERN = /(?:\b(?:maschine|maschinen|gerät|geräte|geraet|geraete|equipment|software|beratung|consulting|kurs|course|app|shirt|t-shirt|fanartikel|merch(?:andise)?|tasche|becher|glas)\b.{0,100}\b(?:gratis|kostenlos|for free|free)\b|\b(?:gratis|kostenlos|for free|free)\b.{0,100}\b(?:maschine|maschinen|gerät|geräte|geraet|geraete|equipment|software|beratung|consulting|kurs|course|app|shirt|t-shirt|fanartikel|merch(?:andise)?|tasche|becher|glas)\b|\b(?:service|reparatur|wartungs?)[-\s]?(?:pauschale|gebühr|gebuehr|fee)\b)/i;
const VIENNA_POSTCODE_PATTERN = /(?:^|\D)(1(?:0[1-9]|1\d|2[0-3])0)(?!\d)/;
const VIENNA_DISTRICT_PATTERN = /\b(?:innere stadt|leopoldstadt|landstra(?:ß|ss)e|wieden|margareten|mariahilf|neubau|josefstadt|alsergrund|favoriten|meidling|hietzing|penzing|rudolfsheim|ottakring|hernals|währing|waehring|döbling|doebling|brigittenau|floridsdorf|donaustadt|liesing|(?:1\d|2[0-3])\.\s*bezirk)\b/i;
const STREET_PATTERN = /\b(?:stra(?:ß|ss)e|gasse|platz|weg|ring|allee|kai|markt|zeile|promenade|graben|ufer|steg)\b/i;
const OUTSIDE_VIENNA_PATTERN = /\b(?:raus|hinaus|außerhalb|ausserhalb)\s+(?:aus|von)?\s*wien\b|\bvor\s+den\s+toren\s+(?:von\s+)?wien\b/i;
const FOREIGN_VIENNA_PATTERN = /\bvienna\s*,?\s*(?:va|virginia|wv|west virginia|ga|georgia|il|illinois|oh|ohio|usa|u\.?s\.?)\b|\b(?:22180|22181|22182)\b|\b(?:maple|chain bridge|nutley|gallows)\s+(?:ave(?:nue)?|rd|road)\b/i;
const EXCLUDED_PLATFORM_PATTERN = /\b(?:neotaste|thefork|download\s+(?:the\s+)?bogo|open\s+bogo|bogo\s+app)\b/i;
const CHANCE_BASED_OFFER_PATTERN = /\b(?:würfel|wuerfel|würfeln|wuerfeln|roll\s+the\s+dice|glücksrad|gluecksrad|mit\s+etwas\s+glück|chance[^.!?]{0,80}(?:gratis|kostenlos|for free))\b/i;
const BLOCKED_INSTAGRAM_PAGE_PATTERN = /\b(?:log in|login|sign up|anmelden|registrieren|create an account)\b/i;

export const KEY4_GENERAL_SEARCH_QUERIES = [
  'site:instagram.com/p/ Wien (gratis OR kostenlos OR "aufs Haus") (Essen OR Kaffee OR Restaurant OR Cafe)',
  'site:instagram.com/reel/ Wien (gratis OR kostenlos OR "aufs Haus") (Essen OR Getränk OR Restaurant)',
  'site:instagram.com/p/ Wien ("1+1" OR "2 für 1" OR "2+1") (Burger OR Pizza OR Kaffee OR Cocktail)',
  'site:instagram.com/reel/ Wien ("1+1" OR "2 für 1" OR BOGO) (Restaurant OR Cafe OR Bar)',
  'site:instagram.com/p/ Vienna Austria -Virginia -"Vienna, VA" ("buy one get one" OR "for free" OR complimentary) (food OR coffee OR drink)',
  'site:instagram.com/reel/ Wien (Neueröffnung OR Eröffnung) (gratis OR kostenlos OR "welcome drink")',
  'site:instagram.com (inurl:/p/ OR inurl:/reel/) Wien (Geburtstag OR birthday) (gratis OR kostenlos OR free) (Essen OR Getränk OR Restaurant)',
  'site:instagram.com (inurl:/p/ OR inurl:/reel/) ("#gratiswien" OR "#aktionwien" OR "#schnäppchenwien" OR "#wienfood" OR "#wienesse") (gratis OR kostenlos OR "1+1" OR BOGO OR Geburtstag)',
  'site:instagram.com (inurl:/p/ OR inurl:/reel/) ("#viennafood" OR "#viennarestaurant" OR "#restaurantvienna" OR "#viennafoodie" OR "#allyoucaneatvienna") (gratis OR kostenlos OR "1+1" OR BOGO OR birthday)',
];

export const KEY4_INSTAGRAM_HASHTAGS = Object.freeze([
  'allyoucaneatvienna',
  'viennafood',
  'wienesse',
  'viennarestaurant',
  'gratiswien',
  'aktionwien',
  'schnäppchenwien',
  'wienfood',
  'restaurantvienna',
  'viennafoodie',
]);

function cleanText(value, maxLength = Infinity) {
  const text = value === null || value === undefined
    ? ''
    : String(value).replace(/\s+/g, ' ').trim();
  return Number.isFinite(maxLength) ? text.slice(0, maxLength) : text;
}

function normalizeUsername(value) {
  const username = cleanText(value, 80).replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{2,40}$/.test(username) ? username : '';
}

function stableHash(value) {
  let hash = 5381;
  for (const character of String(value || '')) {
    hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function finiteDate(value) {
  const date = value instanceof Date ? value : new Date(value || '');
  return Number.isNaN(date.getTime()) ? null : date;
}

function decodeHtmlEntities(value) {
  return cleanText(value)
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function extractMetaValues(rawHtml) {
  const values = new Map();
  const html = String(rawHtml || '');
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    const attributePattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = attributePattern.exec(tag))) {
      attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    const key = cleanText(attrs.property || attrs.name || attrs.itemprop).toLowerCase();
    if (key && attrs.content) values.set(key, attrs.content);
  }
  return values;
}

function extractOwnerUsername(values = []) {
  const patterns = [
    /\(@([a-z0-9._]{2,40})\)/i,
    /(?:^|[\s"'(])@([a-z0-9._]{2,40})(?=$|[\s"',).:])/i,
    /[-–—]\s*([a-z0-9._]{2,40})\s+(?:on|auf)\s+instagram\b/i,
    /[-–—]\s*([a-z0-9._]{2,40})\s+on\s+[a-z]{3,10}\s+\d{1,2},?\s+20\d{2}\b/i,
    /^([a-z0-9._]{2,40})\s+(?:on|auf)\s+instagram\b/i,
  ];
  for (const value of values) {
    for (const pattern of patterns) {
      const username = normalizeUsername(cleanText(value, 1000).match(pattern)?.[1]);
      if (username && !/^(?:instagram|wien|vienna|restaurant|gastro)$/.test(username)) return username;
    }
  }
  return '';
}

function unwrapInstagramCaption(value) {
  const text = decodeHtmlEntities(value);
  if (text.length < 12 || BLOCKED_INSTAGRAM_PAGE_PATTERN.test(text)) return '';
  if (/^(?:instagram|instagram photos and videos|see instagram photos)/i.test(text)) return '';

  const quoted = text.match(/(?:instagram\s*:|\bon\s+instagram\s*:|\bauf\s+instagram\s*:|:\s*)\s*["“]([\s\S]{12,4000})["”]\s*\.?$/i)?.[1];
  if (quoted) return cleanText(quoted, 4000);

  const dashWrapped = text.match(/[-–—]\s*[a-z0-9._]{2,40}\s+(?:on|auf)\s+instagram\s*:\s*["“]?([\s\S]{12,4000}?)["”]?\s*$/i)?.[1];
  if (dashWrapped) return cleanText(dashWrapped, 4000);

  const datedWrapped = text.match(/[-–—]\s*[a-z0-9._]{2,40}\s+on\s+[a-z]{3,10}\s+\d{1,2},?\s+20\d{2}[^:]{0,30}:\s*["“]([\s\S]{12,4000})["”]\s*\.?/i)?.[1];
  if (datedWrapped) return cleanText(datedWrapped, 4000);

  return cleanText(text, 4000);
}

function specificViennaEvidence(signal) {
  const text = cleanText(signal, 5000);
  if (!text || OUTSIDE_VIENNA_PATTERN.test(text)) return null;
  const postcode = text.match(VIENNA_POSTCODE_PATTERN)?.[1] || '';
  if (postcode) return { source: 'instagram-original-caption', value: postcode };
  const district = text.match(VIENNA_DISTRICT_PATTERN)?.[0] || '';
  if (district) return { source: 'instagram-original-caption', value: district };
  if (/\b(?:wien|vienna)\b/i.test(text) && STREET_PATTERN.test(text)) {
    return { source: 'instagram-original-caption', value: 'Wien address' };
  }
  if (/(?:^|\s)#(?:wien|vienna)\b/i.test(text) || /\bvienna\s*,?\s*austria\b/i.test(text)) {
    return { source: 'instagram-original-caption-hashtag', value: 'Vienna' };
  }
  return null;
}

function extractAddress(signal) {
  const text = cleanText(signal, 5000);
  const match = text.match(/(?:^|[.!?]\s|📍)([^.!?]{0,100}(?:1(?:0[1-9]|1\d|2[0-3])0)\s+(?:wien|vienna)[^.!?]{0,60})/i);
  return cleanText(match?.[1], 180);
}

function freeSignalDecision(signal) {
  const original = cleanText(signal, 5000);
  const cleaned = original.replace(FREE_ATTRIBUTE_PATTERN, ' ');
  if (GIVEAWAY_PATTERN.test(original)) return { accepted: false, reason: 'giveaway' };
  if (!FREE_OFFER_PATTERN.test(cleaned)) return { accepted: false, reason: 'not-free' };
  if (!FOOD_DRINK_PATTERN.test(cleaned)) return { accepted: false, reason: 'not-food-drink' };
  if (NON_CONSUMABLE_FREE_PATTERN.test(cleaned)) {
    return { accepted: false, reason: 'free-item-not-food-drink' };
  }
  return { accepted: true, reason: '', cleaned };
}

function offerType(signal) {
  return /\b(?:1\s*[+&]\s*1|2\s*(?:für|fuer|for)\s*1|2\s*[+&]\s*1|bogo|buy[\s,-]*(?:one|1)[\s,-]*get[\s,-]*(?:one|1))\b/i.test(signal)
    ? 'bogo'
    : 'gratis';
}

function offerCategory(signal) {
  return DRINK_PATTERN.test(signal) ? 'kaffee' : 'essen';
}

function offerSummary(signal) {
  const text = cleanText(signal, 4000);
  const match = text.match(FREE_OFFER_PATTERN);
  if (!match || match.index === undefined) return cleanText(text, 220);
  const start = Math.max(0, Math.max(
    text.lastIndexOf('.', match.index - 1),
    text.lastIndexOf('!', match.index - 1),
    text.lastIndexOf('?', match.index - 1),
  ) + 1);
  const after = text.slice(match.index + match[0].length);
  const boundary = after.search(/[.!?](?:\s|$)/);
  const end = boundary >= 0
    ? match.index + match[0].length + boundary + 1
    : Math.min(text.length, match.index + match[0].length + 160);
  const summary = cleanText(text.slice(start, end), 260);
  return summary.length >= 12 ? summary : cleanText(text, 220);
}

function sameInstagramPost(left, right) {
  const leftKey = canonicalInstagramPostKey(left);
  const rightKey = canonicalInstagramPostKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function mergeCandidate(left, right) {
  const richer = cleanText(right.discoverySnippet).length > cleanText(left.discoverySnippet).length
    ? right
    : left;
  const other = richer === left ? right : left;
  return {
    ...other,
    ...richer,
    targetUsername: richer.targetUsername || other.targetUsername || '',
    targetViennaVerified: Boolean(richer.targetViennaVerified || other.targetViennaVerified),
    previousDeal: richer.previousDeal || other.previousDeal || null,
    discoveredBy: [...new Set([
      ...(Array.isArray(left.discoveredBy) ? left.discoveredBy : []),
      ...(Array.isArray(right.discoveredBy) ? right.discoveredBy : []),
    ].filter(Boolean))],
  };
}

export function buildKey4TargetAccounts(watchlist = {}, registry = {}, limit = 30) {
  const entries = new Map();
  const registryAccounts = Array.isArray(registry?.accounts) ? registry.accounts : [];
  const registryByUsername = new Map(registryAccounts
    .map((entry) => [normalizeUsername(entry?.username), entry])
    .filter(([username]) => username));

  for (const account of registryAccounts) {
    const username = normalizeUsername(account?.username);
    const accountType = cleanText(account?.accountType || 'merchant').toLowerCase();
    if (!username || accountType !== 'merchant') continue;
    const viennaVerified = account?.viennaVerified === true;
    const score = (viennaVerified ? 1000 : 0)
      + (Number(account?.priorityScore) || 0)
      + (Number(account?.confidence) || 0);
    entries.set(username, {
      username,
      viennaVerified,
      score,
      source: 'merchant-registry',
    });
  }

  for (const account of Array.isArray(watchlist?.accounts) ? watchlist.accounts : []) {
    const username = normalizeUsername(account?.username);
    const category = cleanText(account?.category || account?.accountType).toLowerCase();
    if (!username || !/(?:food|gastro|merchant|restaurant|cafe)/.test(category)) continue;
    const registryAccount = registryByUsername.get(username);
    const viennaVerified = registryAccount?.viennaVerified === true;
    const score = (viennaVerified ? 1000 : 0)
      + (Number(account?.priority) || 0)
      + (Number(registryAccount?.priorityScore) || 0);
    const existing = entries.get(username);
    if (!existing || score > existing.score) {
      entries.set(username, {
        username,
        viennaVerified,
        score,
        source: 'watchlist',
      });
    }
  }

  return [...entries.values()]
    .sort((left, right) => right.score - left.score || left.username.localeCompare(right.username))
    .slice(0, Math.max(1, Number(limit) || 30));
}

export function buildKey4SearchQueries(targetAccounts = [], options = {}) {
  const profileLimit = Math.max(0, Number(options.profileLimit ?? 18) || 0);
  const general = KEY4_GENERAL_SEARCH_QUERIES.map((query, index) => ({
    id: `general-${index + 1}`,
    query,
    targetUsername: '',
    targetViennaVerified: false,
  }));
  const profiles = targetAccounts.slice(0, profileLimit).map((account) => ({
    id: `profile-${account.username}`,
    query: `site:instagram.com (inurl:/p/ OR inurl:/reel/) "${account.username}" (gratis OR kostenlos OR "1+1" OR "2 für 1" OR BOGO OR "aufs Haus")`,
    targetUsername: account.username,
    targetViennaVerified: account.viennaVerified === true,
  }));
  return [...general, ...profiles];
}

export function buildKey4HashtagSources(limit = KEY4_INSTAGRAM_HASHTAGS.length) {
  return KEY4_INSTAGRAM_HASHTAGS
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((hashtag, index) => ({
      id: `hashtag-${hashtag}`,
      hashtag,
      priority: KEY4_INSTAGRAM_HASHTAGS.length - index,
      url: `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`,
    }));
}

export function agentDealToKey4Candidate(deal = {}, source = {}, now = new Date()) {
  const url = normalizeInstagramPostUrl(
    deal?.post_url || deal?.postUrl || deal?.url || deal?.original_post_url,
  );
  if (!url) return null;

  const encodedPublication = decodeInstagramShortcodeDate(url);
  const reportedPublication = finiteDate(
    deal?.post_date || deal?.postDate || deal?.published_at || deal?.publishedAt,
  );
  const publication = encodedPublication || reportedPublication;
  const ownerUsername = normalizeUsername(deal?.owner_username || deal?.ownerUsername);
  const discoverySnippet = cleanText([
    deal?.post_caption,
    deal?.postCaption,
    deal?.offer,
    deal?.item_given_away,
    deal?.location,
    deal?.validity,
    deal?.validity_date,
  ].filter(Boolean).join(' '), 4000);
  return {
    url,
    title: cleanText(deal?.brand_or_store || deal?.brand || deal?.title, 500),
    discoverySnippet,
    ownerUsername,
    ownerSource: ownerUsername ? 'firecrawl-agent-candidate' : '',
    targetUsername: ownerUsername,
    targetViennaVerified: false,
    sourcePublishedAt: publication?.toISOString() || '',
    sourcePublishedAtSource: publication
      ? (encodedPublication ? 'url.instagramShortcode' : 'firecrawl-agent-reported-publication')
      : '',
    discoveredAt: finiteDate(now)?.toISOString() || new Date().toISOString(),
    agentSource: cleanText(source?.id || source?.hashtag || source?.url, 160),
    agentSourcePriority: Number(source?.priority) || 0,
    discoveredBy: [`firecrawl-agent:${cleanText(source?.id || source?.hashtag || 'hashtag', 160)}`],
  };
}

export function searchResultToKey4Candidate(result = {}, query = {}, now = new Date()) {
  const metadata = result?.metadata && typeof result.metadata === 'object' ? result.metadata : {};
  const url = normalizeInstagramPostUrl(
    result?.url || metadata?.url || metadata?.ogUrl || metadata?.sourceURL,
  );
  if (!url) return null;

  const title = cleanText(result?.title || metadata?.title || metadata?.ogTitle, 500);
  const description = cleanText(
    result?.description || result?.markdown || metadata?.description || metadata?.ogDescription,
    2200,
  );
  const encoded = decodeInstagramShortcodeDate(url);
  const ownerUsername = extractOwnerUsername([title, description]);
  return {
    url,
    title,
    discoverySnippet: description,
    ownerUsername,
    ownerSource: ownerUsername ? 'search-result' : '',
    targetUsername: normalizeUsername(query?.targetUsername),
    targetViennaVerified: query?.targetViennaVerified === true,
    sourcePublishedAt: encoded?.toISOString() || '',
    sourcePublishedAtSource: encoded ? 'url.instagramShortcode' : '',
    discoveredAt: finiteDate(now)?.toISOString() || new Date().toISOString(),
    discoveredBy: [`firecrawl-search:${cleanText(query?.id || query?.query, 160)}`],
  };
}

export function dealToKey4SeedCandidate(deal = {}, sourceLabel = 'pending-source', now = new Date()) {
  const url = normalizeInstagramPostUrl(deal?.url || deal?.post_url || deal?.postUrl);
  if (!url) return null;
  const publication = decodeInstagramShortcodeDate(url)
    || finiteDate(deal?.sourcePublishedAt || deal?.pubDate || deal?.reportedPostDate);
  const ownerUsername = normalizeUsername(deal?.ownerUsername);
  return {
    url,
    title: cleanText(deal?.title, 500),
    discoverySnippet: cleanText(
      [deal?.postCaption, deal?.description, deal?.title].filter(Boolean).join(' '),
      3000,
    ),
    ownerUsername,
    ownerSource: ownerUsername ? 'pending-seed' : '',
    targetUsername: ownerUsername,
    targetViennaVerified: deal?.viennaVerified === true,
    sourcePublishedAt: publication?.toISOString() || '',
    sourcePublishedAtSource: publication
      ? (decodeInstagramShortcodeDate(url) ? 'url.instagramShortcode' : 'pending-seed-publication')
      : '',
    discoveredAt: finiteDate(now)?.toISOString() || new Date().toISOString(),
    seedSource: cleanText(sourceLabel, 160),
    discoveredBy: [`key4-seed:${cleanText(sourceLabel, 160)}`],
  };
}

export function dedupeKey4Candidates(candidates = []) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const url = normalizeInstagramPostUrl(candidate?.url);
    const key = canonicalInstagramPostKey(url);
    if (!key) continue;
    const normalized = { ...candidate, url };
    byKey.set(key, byKey.has(key) ? mergeCandidate(byKey.get(key), normalized) : normalized);
  }
  return [...byKey.values()];
}

export function isKey4DiscoveryCandidateRecent(candidate = {}, options = {}) {
  const now = finiteDate(options.now) || new Date();
  const maxAgeDays = Math.max(1, Number(options.maxAgeDays ?? 14) || 14);
  const recurringMaxAgeDays = Math.max(maxAgeDays, Number(options.recurringMaxAgeDays ?? 45) || 45);
  const publication = finiteDate(candidate.sourcePublishedAt)
    || decodeInstagramShortcodeDate(candidate.url);
  if (!publication) return true;
  const ageDays = (now.getTime() - publication.getTime()) / DAY_MS;
  if (ageDays < -0.25) return false;
  if (ageDays <= maxAgeDays) return true;
  return ageDays <= recurringMaxAgeDays
    && /\b(?:jeden|jede|every|daily|weekly|wöchentlich|woechentlich|monatlich|ongoing|bis auf weiteres|geburtstag|birthday)\b/i.test(candidate.discoverySnippet || '');
}

export function key4CandidatePriority(candidate = {}, now = new Date()) {
  const publication = finiteDate(candidate.sourcePublishedAt)
    || decodeInstagramShortcodeDate(candidate.url);
  const ageDays = publication ? Math.max(0, (now.getTime() - publication.getTime()) / DAY_MS) : 30;
  let score = candidate.previousDeal ? 300 : 0;
  if (candidate.seedSource) score += 120;
  if (candidate.targetViennaVerified) score += 160;
  if (candidate.targetUsername) score += 60;
  if (candidate.agentSource) score += 100 + Math.max(0, Number(candidate.agentSourcePriority) || 0);
  if (FREE_OFFER_PATTERN.test(candidate.discoverySnippet || '')) score += 80;
  if (FOOD_DRINK_PATTERN.test(candidate.discoverySnippet || '')) score += 40;
  score += Math.max(0, 60 - ageDays * 3);
  return score;
}

export function extractKey4PostEvidence(document = {}, candidate = {}, options = {}) {
  const now = finiteDate(options.now) || new Date();
  const registry = options.registry instanceof Map ? options.registry : new Map();
  const url = normalizeInstagramPostUrl(candidate.url);
  const metadata = document?.metadata && typeof document.metadata === 'object' ? document.metadata : {};
  const rawMeta = extractMetaValues(document?.rawHtml || document?.html);
  const finalUrl = normalizeInstagramPostUrl(
    metadata?.url || metadata?.ogUrl || metadata?.sourceURL || url,
  );
  const matchingOriginalUrl = !finalUrl || sameInstagramPost(url, finalUrl);

  const captionSources = [
    ['metadata.ogDescription', metadata?.ogDescription],
    ['html.og:description', rawMeta.get('og:description')],
    ['metadata.description', metadata?.description],
  ];
  if (FREE_OFFER_PATTERN.test(document?.markdown || '')) {
    captionSources.push(['firecrawl.markdown', document.markdown]);
  }

  let postCaption = '';
  let captionSource = '';
  if (matchingOriginalUrl) {
    for (const [source, value] of captionSources) {
      const caption = unwrapInstagramCaption(value);
      if (!caption || caption.length < 12) continue;
      postCaption = caption;
      captionSource = source;
      break;
    }
  }

  const ownerValues = [
    metadata?.ogTitle,
    rawMeta.get('og:title'),
    metadata?.title,
    metadata?.ogDescription,
    rawMeta.get('og:description'),
    metadata?.description,
  ];
  let ownerUsername = extractOwnerUsername(ownerValues);
  let ownerSource = ownerUsername ? 'instagram-original-metadata' : '';
  if (!ownerUsername && candidate.previousDeal?.ownerUsername) {
    ownerUsername = normalizeUsername(candidate.previousDeal.ownerUsername);
    ownerSource = ownerUsername ? 'previous-verified-post' : '';
  }

  let publication = [
    metadata?.publishedTime,
    rawMeta.get('article:published_time'),
    metadata?.dcTermsCreated,
    metadata?.dcDateCreated,
    metadata?.dcDate,
  ].map(finiteDate).find(Boolean);
  let publicationSource = publication ? 'instagram-original-metadata' : '';
  if (!publication) {
    publication = decodeInstagramShortcodeDate(url) || finiteDate(candidate.sourcePublishedAt);
    publicationSource = publication ? 'url.instagramShortcode' : '';
  }

  let verificationStatus = postCaption ? 'verified-original-post' : 'unavailable';
  if (!postCaption && candidate.previousDeal?.postCaption) {
    const previousVerifiedAt = finiteDate(
      candidate.previousDeal.lastVerifiedAt || candidate.previousDeal.postVerification?.checkedAt,
    );
    const cacheAgeDays = previousVerifiedAt
      ? (now.getTime() - previousVerifiedAt.getTime()) / DAY_MS
      : Infinity;
    if (cacheAgeDays <= 3) {
      postCaption = cleanText(candidate.previousDeal.postCaption, 4000);
      captionSource = 'previous-verified-post';
      verificationStatus = 'verified-original-post-cached';
    }
  }

  const captionVienna = specificViennaEvidence(postCaption);
  const merchant = ownerUsername && ownerSource !== 'search-result'
    ? registry.get(ownerUsername)
    : null;
  const registryVienna = merchant?.viennaVerified === true;
  const viennaEvidence = captionVienna || (registryVienna
    ? {
        source: 'merchant-registry',
        value: ownerUsername,
        verificationSource: cleanText(merchant?.verificationSource, 160),
      }
    : null);

  return {
    ...candidate,
    url,
    ownerUsername,
    ownerSource,
    postCaption,
    captionSource,
    sourcePublishedAt: publication?.toISOString() || '',
    sourcePublishedAtSource: publicationSource,
    postVerification: {
      status: verificationStatus,
      checkedAt: now.toISOString(),
      originalPostUrl: url,
      finalUrl: finalUrl || url,
      httpStatus: Number(metadata?.statusCode || 0) || null,
      captionSource,
      ownerUsername,
      reason: cleanText(options.scrapeError || document?.warning || metadata?.error, 240),
    },
    viennaVerified: Boolean(viennaEvidence),
    viennaEvidence,
    address: extractAddress(postCaption),
    scrapeEvidence: {
      retrievalMode: cleanText(options.retrievalMode || 'firecrawl-direct-scrape', 80),
      metadataTitle: cleanText(metadata?.ogTitle || metadata?.title, 300),
      captionSource,
      matchingOriginalUrl,
    },
  };
}

function toDeal(evidence, decision, now, timing, confidence) {
  const signal = evidence.postCaption || evidence.discoverySnippet || evidence.title || '';
  const summary = offerSummary(signal) || 'Möglicher kostenloser Gastro-Deal';
  const ownerUsername = normalizeUsername(evidence.ownerUsername);
  const brand = ownerUsername ? `@${ownerUsername}` : 'Instagram Gastro';
  const publication = finiteDate(evidence.sourcePublishedAt);
  const offerWindow = timing?.offerWindow || null;
  return {
    id: `fc4-${stableHash(evidence.url)}`,
    brand,
    title: `${brand}: ${summary}`.slice(0, 220),
    description: summary,
    offerEvidenceText: evidence.postCaption ? summary : cleanText(evidence.discoverySnippet, 260),
    descriptionSource: evidence.postCaption ? 'instagram-original-post' : 'firecrawl-search-review',
    type: offerType(signal),
    category: offerCategory(signal),
    source: 'Firecrawl Instagram Direct #4',
    originSource: 'firecrawl4',
    url: evidence.url,
    address: evidence.address || '',
    location: evidence.address || '',
    city: evidence.viennaVerified ? 'Wien' : '',
    ownerUsername,
    instagramProfileUrl: ownerUsername ? `https://www.instagram.com/${ownerUsername}/` : '',
    discoveredBy: Array.isArray(evidence.discoveredBy) ? evidence.discoveredBy : [],
    discoveredAt: evidence.discoveredAt || now.toISOString(),
    sourcePublishedAt: publication?.toISOString() || '',
    sourcePublishedAtSource: evidence.sourcePublishedAtSource || '',
    pubDate: publication?.toISOString() || '',
    pubDateSource: evidence.sourcePublishedAtSource || '',
    validFrom: offerWindow?.startDate?.toISOString() || '',
    validUntil: offerWindow?.endDate?.toISOString() || '',
    expires: offerWindow?.endDate?.toISOString() || '',
    expiryDisplayText: cleanText(offerWindow?.evidence, 220),
    expirySource: offerWindow ? 'instagram-original-post' : '',
    recurringSchedule: timing?.recurring === true,
    viennaVerified: evidence.viennaVerified === true,
    locationVerified: evidence.viennaVerified === true,
    viennaEvidence: evidence.viennaEvidence || null,
    postCaption: evidence.postCaption || '',
    postVerification: evidence.postVerification || {},
    lastVerifiedAt: /^verified-original-post/.test(evidence.postVerification?.status || '')
      ? evidence.postVerification?.checkedAt || now.toISOString()
      : '',
    evidence: {
      originalPost: {
        status: evidence.postVerification?.status || 'unavailable',
        checkedAt: evidence.postVerification?.checkedAt || now.toISOString(),
        url: evidence.url,
        publicationSource: evidence.sourcePublishedAtSource || '',
        ownerUsername,
        captionSource: evidence.captionSource || '',
        captionSample: cleanText(evidence.postCaption, 700),
      },
      discoverySnippet: cleanText(evidence.discoverySnippet, 500),
    },
    key4Decision: {
      status: decision.status,
      reasons: decision.reasons,
      confidence,
      decidedAt: now.toISOString(),
    },
    postAgeDays: publication
      ? Number(Math.max(0, (now.getTime() - publication.getTime()) / DAY_MS).toFixed(1))
      : null,
    qualityScore: confidence,
    hot: decision.status === 'accepted',
    isNew: true,
    priority: decision.status === 'accepted' ? 2 : 1,
    votes: decision.status === 'accepted' ? 1 : 0,
  };
}

function key4OfferSignature(deal = {}) {
  const ownerUsername = normalizeUsername(deal.ownerUsername);
  const offerText = cleanText(deal.description, 1000)
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!ownerUsername || offerText.length < 24) return '';
  return `${ownerUsername}|${cleanText(deal.type).toLowerCase()}|${offerText}`;
}

function rejectDuplicateOfferPost(deal, originalDeal) {
  return {
    reason: 'duplicate-offer-post',
    deal: {
      ...deal,
      duplicateOfDealId: originalDeal.id,
      hot: false,
      priority: 1,
      key4Decision: {
        ...deal.key4Decision,
        status: 'rejected',
        reasons: ['duplicate-offer-post'],
      },
    },
  };
}

function decideEvidence(evidence, options) {
  const now = finiteDate(options.now) || new Date();
  const maxAgeDays = Math.max(1, Number(options.maxAgeDays ?? 7) || 7);
  const recurringMaxAgeDays = Math.max(maxAgeDays, Number(options.recurringMaxAgeDays ?? 45) || 45);
  const originalStatus = cleanText(evidence.postVerification?.status).toLowerCase();
  const hasOriginalEvidence = /^verified-original-post/.test(originalStatus)
    && Boolean(cleanText(evidence.postCaption));
  const originalSignal = cleanText(evidence.postCaption, 5000);
  const discoverySignal = cleanText(
    [evidence.discoverySnippet, evidence.title].filter(Boolean).join(' '),
    3000,
  );
  const availableSignal = originalSignal || discoverySignal;

  if (FOREIGN_VIENNA_PATTERN.test(availableSignal)) {
    const decision = { status: 'rejected', reasons: ['not-vienna-austria'] };
    return { decision, timing: null, confidence: 90, deal: toDeal(evidence, decision, now, null, 90) };
  }
  if (EXCLUDED_PLATFORM_PATTERN.test(availableSignal)) {
    const decision = { status: 'rejected', reasons: ['excluded-platform'] };
    return { decision, timing: null, confidence: 90, deal: toDeal(evidence, decision, now, null, 90) };
  }

  if (!hasOriginalEvidence) {
    const discoveryDecision = freeSignalDecision(discoverySignal);
    const decision = discoveryDecision.accepted
      ? { status: 'review', reasons: ['missing-original-offer-evidence'] }
      : { status: 'rejected', reasons: ['missing-original-offer-evidence', discoveryDecision.reason] };
    const confidence = discoveryDecision.accepted ? 40 : 10;
    return { decision, timing: null, confidence, deal: toDeal(evidence, decision, now, null, confidence) };
  }

  const signalDecision = freeSignalDecision(originalSignal);
  if (!signalDecision.accepted) {
    const decision = { status: 'rejected', reasons: [signalDecision.reason] };
    return { decision, timing: null, confidence: 35, deal: toDeal(evidence, decision, now, null, 35) };
  }

  if (OUTSIDE_VIENNA_PATTERN.test(originalSignal)) {
    const decision = { status: 'rejected', reasons: ['not-verified-vienna'] };
    return { decision, timing: null, confidence: 55, deal: toDeal(evidence, decision, now, null, 55) };
  }

  const publication = finiteDate(evidence.sourcePublishedAt);
  const evaluatedTiming = evaluateInstagramOfferTiming({
    now,
    pubDate: publication,
    signal: originalSignal,
    maxAgeDays,
    activeOfferMaxAgeDays: recurringMaxAgeDays,
    futureSkewMinutes: 10,
  });
  const recurringOccasion = /\bgeburtstag(?:sangebot|sdeal|sspecial)?\b|\bbirthday\b/i.test(originalSignal);
  const timing = recurringOccasion
    && evaluatedTiming.withinActiveOfferLimit
    && !evaluatedTiming.expired
    && !evaluatedTiming.notStarted
    && !evaluatedTiming.futurePublication
    ? {
        ...evaluatedTiming,
        recurring: true,
        activeEvidence: true,
        eligibleByAge: true,
      }
    : evaluatedTiming;

  if (timing.futurePublication) {
    const decision = { status: 'rejected', reasons: ['future-post-date'] };
    return { decision, timing, confidence: 55, deal: toDeal(evidence, decision, now, timing, 55) };
  }
  if (timing.expired) {
    const decision = { status: 'rejected', reasons: ['expired-offer'] };
    return { decision, timing, confidence: 70, deal: toDeal(evidence, decision, now, timing, 70) };
  }
  if (timing.notStarted) {
    const decision = { status: 'rejected', reasons: ['not-started'] };
    return { decision, timing, confidence: 70, deal: toDeal(evidence, decision, now, timing, 70) };
  }

  if (!evidence.viennaVerified) {
    const decision = { status: 'review', reasons: ['not-verified-vienna'] };
    return { decision, timing, confidence: 70, deal: toDeal(evidence, decision, now, timing, 70) };
  }
  if (CHANCE_BASED_OFFER_PATTERN.test(originalSignal)) {
    const decision = { status: 'review', reasons: ['chance-based-offer'] };
    return { decision, timing, confidence: 85, deal: toDeal(evidence, decision, now, timing, 85) };
  }
  if (!publication) {
    const decision = { status: 'review', reasons: ['missing-real-post-date'] };
    return { decision, timing, confidence: 80, deal: toDeal(evidence, decision, now, timing, 80) };
  }
  if (!timing.eligibleByAge) {
    const reason = timing.ageDays !== null && timing.ageDays > recurringMaxAgeDays
      ? `older-than-${recurringMaxAgeDays}-days`
      : `older-than-${maxAgeDays}-days`;
    const status = timing.ageDays !== null && timing.ageDays <= recurringMaxAgeDays
      ? 'review'
      : 'rejected';
    const decision = { status, reasons: [reason] };
    return { decision, timing, confidence: 75, deal: toDeal(evidence, decision, now, timing, 75) };
  }

  const cachedPenalty = originalStatus === 'verified-original-post-cached' ? 5 : 0;
  const confidence = 100 - cachedPenalty;
  const decision = { status: 'accepted', reasons: [] };
  return { decision, timing, confidence, deal: toDeal(evidence, decision, now, timing, confidence) };
}

export function classifyKey4Evidence(evidenceRows = [], options = {}) {
  const acceptedCandidates = [];
  const reviewCandidates = [];
  const rejected = [];
  for (const evidence of dedupeKey4Candidates(evidenceRows)) {
    const result = decideEvidence(evidence, options);
    if (result.decision.status === 'accepted') acceptedCandidates.push(result.deal);
    else if (result.decision.status === 'review') reviewCandidates.push(result.deal);
    else rejected.push({ reason: result.decision.reasons[0], deal: result.deal });
  }

  const byDate = (left, right) => String(right.sourcePublishedAt || '').localeCompare(left.sourcePublishedAt || '');
  acceptedCandidates.sort(byDate);
  reviewCandidates.sort(byDate);
  const accepted = [];
  const review = [];
  const offerBySignature = new Map();
  for (const [status, candidates, target] of [
    ['accepted', acceptedCandidates, accepted],
    ['review', reviewCandidates, review],
  ]) {
    for (const deal of candidates) {
      const signature = key4OfferSignature(deal);
      const originalDeal = signature ? offerBySignature.get(signature) : null;
      if (originalDeal) {
        rejected.push(rejectDuplicateOfferPost(deal, originalDeal));
        continue;
      }
      target.push(deal);
      if (signature) offerBySignature.set(signature, { ...deal, key4OriginalStatus: status });
    }
  }

  const rejectedByReason = {};
  for (const entry of rejected) {
    for (const reason of entry.deal.key4Decision?.reasons || [entry.reason]) {
      rejectedByReason[reason] = (rejectedByReason[reason] || 0) + 1;
    }
  }
  const reviewByReason = {};
  for (const deal of review) {
    for (const reason of deal.key4Decision?.reasons || []) {
      reviewByReason[reason] = (reviewByReason[reason] || 0) + 1;
    }
  }

  return {
    accepted,
    review,
    rejected,
    summary: {
      candidates: evidenceRows.length,
      accepted: accepted.length,
      review: review.length,
      rejected: rejected.length,
      rejectedByReason,
      reviewByReason,
    },
  };
}
