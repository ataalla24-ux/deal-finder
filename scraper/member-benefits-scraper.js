import '../sentry/instrument.mjs';

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-member-benefits.json');
const MAX_DEALS_PER_SOURCE = Number(process.env.MEMBER_BENEFITS_MAX_PER_SOURCE || 80);
const MIN_QUALITY_SCORE = Number(process.env.MEMBER_BENEFITS_MIN_SCORE || 18);

const SOURCES = [
  {
    key: 'drei-plus',
    source: 'Drei Plus',
    membership: 'Drei Kund:innen',
    url: 'https://www.drei.at/de/dreiplus/',
    distance: 'Österreich',
  },
  {
    key: 'magenta-moments',
    source: 'Magenta Moments',
    membership: 'Magenta Kund:innen',
    url: 'https://www.magenta.at/magenta-moments',
    distance: 'Österreich',
  },
  {
    key: 'a1-smile',
    source: 'A1 Smile',
    membership: 'A1 Kund:innen',
    url: 'https://www.a1.net/treue',
    distance: 'Österreich',
  },
  {
    key: 'wienmobil-vorteilswelt',
    source: 'WienMobil Vorteilswelt',
    membership: 'Wiener Linien Stammkund:innen',
    url: 'https://www.wienerlinien.at/wienmobil-vorteilswelt',
    distance: 'Wien',
  },
  {
    key: 'vorteilsclub-wien',
    source: 'Vorteilsclub der Stadt Wien',
    membership: 'Vorteilsclub-Mitglieder',
    url: 'https://vorteilsclub.wien.at/meine-vorteile',
    distance: 'Wien',
  },
  {
    key: 'oeamtc-vorteilspartner',
    source: 'ÖAMTC Vorteilspartner',
    membership: 'ÖAMTC Mitglieder',
    url: 'https://www.oeamtc.at/vorteilspartner',
    distance: 'Österreich',
  },
];

const ENTITY_MAP = {
  amp: '&',
  quot: '"',
  apos: "'",
  '#039': "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  uuml: 'ü',
  Uuml: 'Ü',
  auml: 'ä',
  Auml: 'Ä',
  ouml: 'ö',
  Ouml: 'Ö',
  szlig: 'ß',
  euro: '€',
  copy: '',
};

const DEAL_PATTERNS = [
  /(?:^|\b)1\s*\+\s*1\b/i,
  /\b2\s*(?:für|fuer)\s*1\b/i,
  /\bgratis\b/i,
  /\bkostenlos(?:e|er|es|en)?\b/i,
  /\bfree\b/i,
  /\b\d{1,3}\s*%\s*(?:rabatt|ersparnis|nachlass|discount)?\b/i,
  /\b(?:rabatt|ersparnis|nachlass|gutschein|vorteilspreis|aktionspreis|sofortrabatt)\b/i,
  /\b(?:zum|für|fuer)\s+preis\s+von\s+1\b/i,
  /\bzweites?\s+(?:ticket|karte|getränk|getraenk|menü|menue|produkt|artikel)\s+gratis\b/i,
  /\bgratis\s*(?:probe)?monat(?:e|en)?\b/i,
  /\bprobemonat(?:e|en)?\b/i,
];

const NOISE_PATTERNS = [
  /\bcookie\b/i,
  /\bdatenschutz\b/i,
  /\bimpressum\b/i,
  /\blogin\b/i,
  /\banmelden\b/i,
  /\bregistrieren\b/i,
  /\bnewsletter\b/i,
  /\bkontakt\b/i,
  /\bfaq\b/i,
  /\bmitglied werden\b/i,
  /\bgewinnspiel\b/i,
  /\bgewinnen\b/i,
  /\bapp herunterladen\b/i,
  /\bapp downloaden\b/i,
  /\bmenu\b/i,
  /\bbarrierefreiheit\b/i,
  /\bfavoriten speichern\b/i,
];

const GENERIC_TITLE_PATTERNS = [
  /^deine \+/i,
  /^vorteile hoch drei$/i,
  /^alle infos/i,
  /^wo finde ich/i,
  /^app jetzt/i,
  /^treuen kunden verbunden$/i,
  /^unsere angebote/i,
  /^fragen und antworten/i,
  /^weitere services$/i,
  /^handel$/i,
  /^willkommen\b/i,
  /^mit drei plus\b/i,
  /^-?\d{1,3}\s*%\s*(rabatt)?$/i,
];

const B2B_PATTERNS = [
  /\bregistrierkassa\b/i,
  /\bpraxis-software\b/i,
  /\bhellocash\b/i,
  /\bcare01\b/i,
  /\bbusiness\b/i,
  /\bautoscout24\b/i,
  /\bsuperinserat\b/i,
  /\bgratis mitglied\b/i,
];

const CATEGORY_RULES = [
  { category: 'kaffee', logo: '☕', pattern: /\b(kaffee|coffee|cafe|café|heißgetränk|heissgetraenk|espresso|cappuccino|latte)\b/i },
  { category: 'essen', logo: '🍽️', pattern: /\b(lieferando|nordsee|pizzamann|pizza|wrap|burger|essen|speisen|restaurant|menü|menue|getränk|getraenk|subway|anker)\b/i },
  { category: 'kultur', logo: '🎟️', pattern: /\b(kino|kinoticket|ticket|museum|belvedere|mumok|leopold|tussauds|ars electronica|theater|ausstellung|konzert|prater)\b/i },
  { category: 'fitness', logo: '💪', pattern: /\b(fitinn|fitness|cleverfit|padel|training|sport|therme)\b/i },
  { category: 'reisen', logo: '🧳', pattern: /\b(flixbus|reise|verreisen|hotel|übernachtung|uebernachtung|booking|westbahn|urlaub)\b/i },
  { category: 'streaming', logo: '📺', pattern: /\b(stream|tv|deezer|spotify|disney|netflix|lieferando\+)\b/i },
  { category: 'shopping', logo: '🛍️', pattern: /\b(shopping|shop|facultas|hervis|interspar|adidas|tefal|anker|zubehör|zubehoer|papier|büro|buero)\b/i },
];

function decodeEntities(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+|#039);/g, (match, key) => {
      const mapped = ENTITY_MAP[key] || ENTITY_MAP[key.toLowerCase()];
      return mapped === undefined ? match : mapped;
    });
}

function stripTags(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function cleanText(value = '', max = 500) {
  return decodeEntities(stripTags(value))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stableHash(value = '') {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function absolutizeUrl(href, baseUrl) {
  const cleaned = cleanText(href, 1000);
  if (!cleaned || cleaned.startsWith('#') || /^javascript:/i.test(cleaned) || /^mailto:/i.test(cleaned)) return '';
  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return '';
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; FreeFinderBenefitsBot/1.0; +https://freefinder.app)',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function isDealLike(title, description) {
  const text = `${title} ${description}`;
  if (text.length < 12) return false;
  if (!DEAL_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(title)) && title.length < 40) return false;
  if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return false;
  if (/\b(?:kostenlos|gratis)\s+(?:downloaden|herunterladen|laden)\b/i.test(text)) return false;
  if (B2B_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return true;
}

function inferType(text) {
  if (/\b1\s*\+\s*1\b|\b2\s*(?:für|fuer)\s*1\b|\bzweites?\s+\w+\s+gratis\b/i.test(text)) return 'bogo';
  if (/\bgratis\b|\bkostenlos|\bfree\b/i.test(text)) return 'gratis';
  if (/\bprobemonat|gratis\s*(?:probe)?monat/i.test(text)) return 'testabo';
  return 'rabatt';
}

function inferCategoryAndLogo(text, type) {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return { category: rule.category, logo: rule.logo };
  }
  if (type === 'gratis') return { category: 'gratis', logo: '🎁' };
  return { category: 'shopping', logo: '🎯' };
}

function trimSentence(value = '', max = 210) {
  const text = cleanText(value, 700)
    .replace(/\b(?:Mehr erfahren|Alle Infos|Zur Übersicht|Zum Angebot|Zu .{1,40})\b.*$/i, '')
    .replace(/\bUm Favoriten\b.*$/i, '')
    .replace(/\bBitte melde dich hier an\b.*$/i, '')
    .replace(/\bFalls du noch kein\b.*$/i, '')
    .trim();
  if (text.length <= max) return text;
  const shortened = text.slice(0, max);
  const lastBoundary = Math.max(shortened.lastIndexOf('.'), shortened.lastIndexOf('!'), shortened.lastIndexOf('?'), shortened.lastIndexOf(' '));
  return `${shortened.slice(0, lastBoundary > 80 ? lastBoundary : max).trim()}...`;
}

function buildOfferCore(description) {
  const text = cleanText(description, 260);
  if (!text) return '';

  if (/\b1\s*\+\s*1\b/i.test(text)) {
    if (/\bkinoticket/i.test(text)) return '1+1 Kinoticket gratis';
    if (/\bwrap\b/i.test(text)) return '1+1 Wrap gratis';
    if (/\bpapier|büro|buero|schreibwaren\b/i.test(text)) return '1+1 auf Papier- und Schreibwaren';
    if (/\bticket|tickets|karte|karten|eintritt\b/i.test(text)) return '1+1 Ticket gratis';
    return '1+1 gratis';
  }

  let match = text.match(/-?\s*(\d{1,3})\s*%\s*(?:rabatt|ermäßigung|ermaessigung|ersparnis|nachlass)?/i);
  if (match) return `${match[1]}% Rabatt`;

  match = text.match(/\b(\d+)\s+gratis\*?\s+(tageskarten?|tickets?|kinotickets?|monate?|probemonate?|stunden)\b/i);
  if (match) return `${match[1]} gratis ${cleanText(match[2], 42)}`;

  match = text.match(/\b(zwei|drei|vier)\s+gratis\*?\s+(tageskarten?|tickets?|kinotickets?|monate?|probemonate?|stunden)\b/i);
  if (match) {
    const amount = { zwei: '2', drei: '3', vier: '4' }[match[1].toLowerCase()] || match[1];
    return `${amount} gratis ${cleanText(match[2], 42)}`;
  }

  match = text.match(/\b(\d+)\s+gratis\*?\s+([^.,;]{3,42})/i);
  if (match) return `${match[1]} gratis ${cleanText(match[2], 42)}`;

  match = text.match(/\bgratis\*?\s+([^.,;]{3,58})/i);
  if (match) return `Gratis ${cleanText(match[1], 58)}`;

  return '';
}

function buildTitle(brand, description, sourceName) {
  const desc = cleanText(description, 180);
  const partner = cleanText(brand, 80);
  if (!desc) return partner || sourceName;

  let core = (buildOfferCore(desc) || desc)
    .replace(/^jeden\s+\w+\s+gibt'?s\s+/i, '')
    .replace(/^deine\s+/i, '')
    .replace(/\s+(?:Zum|Zur|Zu)\s+.{2,45}$/i, '')
    .replace(/\.$/, '')
    .trim();
  if (/^gratis\b/i.test(partner) && /^gratis\s+dazu$/i.test(core)) return partner;
  if (core.length > 95) core = trimSentence(core, 95);
  if (partner && !new RegExp(`\\b${partner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(core)) {
    return `${core} bei ${partner}`;
  }
  return core;
}

function scoreDeal(title, description, source) {
  const text = `${title} ${description}`;
  let score = 0;
  if (/\b1\s*\+\s*1\b|\b2\s*(?:für|fuer)\s*1\b/i.test(text)) score += 34;
  if (/\bgratis\b|\bkostenlos|\bfree\b/i.test(text)) score += 28;
  if (/\b\d{1,3}\s*%\b/.test(text)) score += 18;
  if (/\brabatt|ersparnis|gutschein|vorteilspreis\b/i.test(text)) score += 12;
  if (/\bkino|ticket|museum|kaffee|pizza|wrap|speisen|tageskarten|prater\b/i.test(text)) score += 12;
  if (source.distance === 'Wien') score += 6;
  return score;
}

function extractHrefFromBlock(block, baseUrl) {
  const matches = [...String(block || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of matches) {
    const text = cleanText(match[2], 100);
    const href = absolutizeUrl(match[1], baseUrl);
    if (/\/(?:login|registrieren)(?:$|[/?#])/i.test(href)) continue;
    if (href && !NOISE_PATTERNS.some((pattern) => pattern.test(text))) return href;
  }
  return '';
}

function extractHeadingCandidates(html, source) {
  const candidates = [];
  const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const matches = [...html.matchAll(headingRegex)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = cleanText(match[2], 120).replace(/\.$/, '');
    if (!title || title.length < 2 || title.length > 95) continue;

    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index || Math.min(html.length, start + 2200);
    const block = html.slice(start, end);
    const description = trimSentence(block);
    if (!description || !isDealLike(title, description)) continue;

    const rawUrl = extractHrefFromBlock(block, source.url) || source.url;
    candidates.push({ brand: title, description, url: rawUrl });
  }
  return candidates;
}

function extractCompactTextCandidates(html, source) {
  const text = cleanText(html, 50000);
  const candidates = [];
  const pattern = /([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&+.' -]{2,60})\.\s+([^.!?]{0,170}(?:1\s*\+\s*1|gratis|kostenlos|free|\d{1,3}\s*%|Rabatt|Ersparnis|Vorteilspreis|Gutschein)[^.!?]{0,170})[.!?]?/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const brand = cleanText(match[1], 80).replace(/^(Zu|Zur|Zum)\s+/i, '');
    const description = trimSentence(match[2], 220);
    if (!brand || !description || !isDealLike(brand, description)) continue;
    candidates.push({ brand, description, url: source.url });
  }
  return candidates;
}

function normalizeCandidate(candidate, source) {
  const description = trimSentence(candidate.description);
  const brand = cleanText(candidate.brand, 90)
    .replace(/\s+-\s+.*$/, '')
    .replace(/^(Aktion|Top|Neu)\s+/i, '')
    .trim();
  if (!brand || !description) return null;
  if (brand.split(/\s+/).length > 9) return null;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(brand))) return null;
  if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(brand))) return null;
  if (B2B_PATTERNS.some((pattern) => pattern.test(`${brand} ${description}`))) return null;

  const rawTitle = buildTitle(brand, description, source.source);
  const signal = `${brand} ${rawTitle} ${description}`;
  const qualityScore = scoreDeal(rawTitle, description, source);
  if (qualityScore < MIN_QUALITY_SCORE) return null;

  const type = inferType(signal);
  const { category, logo } = inferCategoryAndLogo(signal, type);
  const url = candidate.url || source.url;

  return {
    id: `benefit-${source.key}-${stableHash(`${brand}|${rawTitle}|${url}`)}`,
    brand,
    logo,
    title: rawTitle,
    description: `${description} Exklusiv für ${source.membership}.`,
    type,
    category,
    source: source.source,
    originSource: 'member-benefits-scraper',
    url,
    expires: /jeden\s+\w+|regelmäßig|regelmaessig|bis auf widerruf/i.test(signal) ? 'regelmäßig / laut Quelle' : 'laut Quelle',
    distance: source.distance,
    hot: type === 'bogo' || type === 'gratis',
    isNew: true,
    votes: type === 'bogo' ? 3 : 2,
    priority: type === 'bogo' || type === 'gratis' ? 5 : 4,
    qualityScore,
    pubDate: new Date().toISOString(),
    pubDateSource: 'sourcePage',
    membershipRequired: source.membership,
  };
}

function dedupeDeals(deals) {
  const byKey = new Map();
  for (const deal of deals) {
    const key = `${deal.source}|${deal.brand}|${deal.title}`.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || deal.qualityScore > existing.qualityScore) byKey.set(key, deal);
  }
  return [...byKey.values()].sort((left, right) => right.qualityScore - left.qualityScore || left.source.localeCompare(right.source));
}

async function scrapeSource(source) {
  console.log(`🔎 ${source.source}: ${source.url}`);
  const html = await fetchHtml(source.url);
  const headingCandidates = extractHeadingCandidates(html, source);
  const compactCandidates = source.allowCompactCandidates || headingCandidates.length === 0
    ? extractCompactTextCandidates(html, source)
    : [];
  const candidates = [...headingCandidates, ...compactCandidates];
  const deals = dedupeDeals(candidates.map((candidate) => normalizeCandidate(candidate, source)).filter(Boolean))
    .slice(0, MAX_DEALS_PER_SOURCE);
  console.log(`   ↳ ${deals.length} Angebote`);
  return deals;
}

async function main() {
  console.log('🎟️ MEMBER BENEFITS SCRAPER');
  console.log('========================================');

  const allDeals = [];
  const errors = [];
  for (const source of SOURCES) {
    try {
      allDeals.push(...await scrapeSource(source));
    } catch (error) {
      errors.push({ source: source.source, url: source.url, error: error.message });
      console.log(`   ⚠️ ${error.message}`);
    }
  }

  const deals = dedupeDeals(allDeals);
  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'member-benefits-scraper',
    totalDeals: deals.length,
    errors,
    sources: SOURCES.map(({ key, source, url, membership }) => ({ key, source, url, membership })),
    deals,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`💾 ${deals.length} Deals → ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error('❌ member benefits scraper failed:', error);
  process.exit(1);
});
