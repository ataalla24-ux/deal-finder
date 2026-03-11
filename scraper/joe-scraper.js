import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import { cleanText, normalizeCategoryForScraper } from './category-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-joe.json');

const USER_AGENT = 'Mozilla/5.0 (compatible; FreeFinderBot/1.0; +https://freefinder.wien)';
const TODAY = new Date();

const SOURCES = [
  {
    key: 'billa-actions',
    url: 'https://www.billa.at/unsere-aktionen/aktionen',
    brand: 'BILLA',
    source: 'jö Bonus Club',
    distance: 'BILLA & BILLA PLUS Wien',
  },
  {
    key: 'joe-benefits',
    url: 'https://www.billa.at/unsere-aktionen/jo-bonus-club-vorteile-billa',
    brand: 'jö Bonus Club',
    source: 'jö Bonus Club',
    distance: 'BILLA & BILLA PLUS Wien',
  },
  {
    key: 'omv-joe',
    url: 'https://www.joe-club.at/partner/omv',
    brand: 'OMV VIVA',
    source: 'jö Bonus Club',
    distance: 'OMV Stationen Wien',
  },
  {
    key: 'bipa-joe',
    url: 'https://www.joe-club.at/partner/bipa',
    brand: 'BIPA',
    source: 'jö Bonus Club',
    distance: 'BIPA Filialen Wien',
  },
];

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function dealId(prefix, title, url) {
  return `${prefix}-${stableHash(`${title}|${url}`)}`;
}

function endOfDayUtc(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999));
}

function parseGermanDate(text) {
  const value = cleanText(text).toLowerCase();
  if (!value) return null;

  let match = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (match) {
    return endOfDayUtc(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  }

  match = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/);
  if (match) {
    return endOfDayUtc(2000 + Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  }

  match = value.match(/(\d{1,2})\.(\d{1,2})\.(?!\d)/);
  if (match) {
    return endOfDayUtc(TODAY.getUTCFullYear(), Number(match[2]) - 1, Number(match[1]));
  }

  match = value.match(
    /(\d{1,2})\.?\s+(jänner|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(\d{4})?/i,
  );
  if (match) {
    const monthMap = {
      jänner: 0,
      januar: 0,
      februar: 1,
      märz: 2,
      april: 3,
      mai: 4,
      juni: 5,
      juli: 6,
      august: 7,
      september: 8,
      oktober: 9,
      november: 10,
      dezember: 11,
    };
    const year = match[3] ? Number(match[3]) : TODAY.getUTCFullYear();
    return endOfDayUtc(year, monthMap[match[2]], Number(match[1]));
  }

  return null;
}

function parseDateRangeEnd(text) {
  const value = cleanText(text);
  if (!value) return null;

  const explicitEnd = value.match(/bis\s+([^\n]+)/i);
  if (explicitEnd) {
    const parsed = parseGermanDate(explicitEnd[1]);
    if (parsed) return parsed;
  }

  const allDateTokens = value.match(/\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}\.\d{1,2}\.|\d{1,2}\.?\s+(?:jänner|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*\d{0,4}/gi) || [];
  let best = null;
  for (const token of allDateTokens) {
    const parsed = parseGermanDate(token);
    if (!parsed) continue;
    if (!best || parsed.getTime() > best.getTime()) best = parsed;
  }
  return best;
}

function formatIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function sentence(text) {
  const value = cleanText(text);
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function makeDescription(parts) {
  return parts.map(sentence).filter(Boolean).join(' ');
}

function decodeJsonString(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
  } catch {
    return text
      .replace(/\\u002F/g, '/')
      .replace(/\\u003C/g, '<')
      .replace(/\\u003E/g, '>')
      .replace(/\\u0026/g, '&')
      .replace(/\\"/g, '"');
  }
}

function inferType(...parts) {
  const text = cleanText(parts.join(' ')).toLowerCase();
  if (!text) return 'rabatt';
  if (/(gratis|kostenlos|kostenfrei|free|1\+1|2 go bons|magazin gratis|produktneuheiten.*gratis)/i.test(text)) {
    return 'gratis';
  }
  return 'rabatt';
}

function buildDeal({
  prefix = 'joe',
  title,
  description,
  brand,
  source,
  url,
  expires = '',
  distance,
  category,
  type,
  badge = 'jö',
  hot = true,
  isNew = true,
  qualityScore = 75,
}) {
  const normalizedTitle = cleanText(title);
  const normalizedDescription = cleanText(description);
  if (!normalizedTitle || !normalizedDescription) return null;

  return {
    id: dealId(prefix, normalizedTitle, url),
    brand,
    logo: '💎',
    title: normalizedTitle,
    description: normalizedDescription,
    type,
    badge,
    category: normalizeCategoryForScraper(category, [
      normalizedTitle,
      normalizedDescription,
      brand,
      source,
      url,
    ]),
    source,
    url,
    expires,
    distance,
    hot,
    isNew,
    qualityScore,
    pubDate: new Date().toISOString(),
    pubDateSource: 'sourcePage',
  };
}

async function openPage(browser, url) {
  const page = await browser.newPage({
    userAgent: USER_AGENT,
    locale: 'de-AT',
  });
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForTimeout(1500);
  return page;
}

async function acceptJoeCookies(page) {
  try {
    const button = page.getByRole('button', { name: 'Einverstanden', exact: true });
    if (await button.isVisible({ timeout: 1500 })) {
      await button.click();
      await page.waitForTimeout(1200);
    }
  } catch {
    // Cookie banner is not always present.
  }
}

async function extractActionsPage(page, source) {
  const pageData = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const links = Array.from(document.querySelectorAll('a[href]')).map((link) => ({
      text: (link.innerText || '').trim(),
      href: link.href,
      context: (link.closest('a, article, div, section')?.innerText || link.innerText || '').trim(),
    }));
    return { text, links };
  });

  const deals = [];
  const validityMatch = pageData.text.match(/Extrem Aktion\*?\s+Gültig von ([^\n]+)/i);
  const validityText = validityMatch ? cleanText(validityMatch[1]) : '';
  const validityEnd = parseDateRangeEnd(validityText);

  const extremDeal = buildDeal({
    title: 'jö Äpp Extrem Aktion bei BILLA',
    description: makeDescription([
      validityText || 'Zusätzliche Aktionen für Ihren Einkauf bei BILLA und BILLA PLUS.',
      'Zusätzliche Aktionen für Ihren Einkauf bei BILLA und BILLA PLUS.',
      'Die konkreten Vorteilsartikel werden in der jö äpp bzw. im Aktionsslider angezeigt.',
    ]),
    brand: 'BILLA',
    source: source.source,
    url: source.url,
    expires: formatIso(validityEnd),
    distance: source.distance,
    category: 'supermarkt',
    type: 'rabatt',
    qualityScore: 68,
  });
  if (extremDeal) deals.push(extremDeal);

  const twoGo = pageData.links.find((entry) => /2 go bons/i.test(entry.text) || /2 go bons/i.test(entry.context));
  if (twoGo) {
    const text = cleanText(twoGo.context);
    const expires = /gültigkeit:\s*siehe bon/i.test(text) ? 'siehe Bon' : '';
    const deal = buildDeal({
      title: 'BILLA 2 Go Bons',
      description: makeDescription([
        text,
        'Digitale Bons für Snacks und Jausen unterwegs.',
      ]),
      brand: 'BILLA',
      source: source.source,
      url: twoGo.href,
      expires,
      distance: 'BILLA 2 Go / Wien',
      category: 'essen',
      type: 'rabatt',
      qualityScore: 78,
    });
    if (deal) deals.push(deal);
  }

  return deals;
}

async function extractJoeBenefitsPage(page, source) {
  const sections = await page.evaluate(() => {
    const headingNodes = Array.from(document.querySelectorAll('h2, h3, h4'));
    return headingNodes.map((heading) => {
      let container = heading.parentElement;
      while (container && (container.innerText || '').trim().length < 40) {
        container = container.parentElement;
      }
      const text = (container?.innerText || heading.innerText || '').trim();
      const links = Array.from((container || heading.parentElement || document).querySelectorAll('a[href]'))
        .map((link) => link.href)
        .filter(Boolean);
      return {
        heading: (heading.textContent || '').trim(),
        text,
        links,
      };
    });
  });

  const findSection = (pattern) => sections.find((section) => pattern.test(section.heading) || pattern.test(section.text));
  const deals = [];

  const addSectionDeal = ({
    pattern,
    title,
    brand = 'jö Bonus Club',
    distance = source.distance,
    category = 'supermarkt',
    url = source.url,
    type,
    expires = '',
    extra = [],
    qualityScore = 76,
  }) => {
    const match = findSection(pattern);
    if (!match) return;
    const description = makeDescription([match.text, ...extra]);
    const deal = buildDeal({
      title,
      description,
      brand,
      source: source.source,
      url: match.links[0] || url,
      expires,
      distance,
      category,
      type: type || inferType(title, match.text, ...extra),
      qualityScore,
    });
    if (deal) deals.push(deal);
  };

  addSectionDeal({
    pattern: /jö\s*rabattsammler/i,
    title: 'jö Rabattsammler',
    extra: ['Bis zu 20% Rabatt auf einen gesamten Einkauf pro Monat.'],
    expires: 'Monatlich',
    type: 'rabatt',
    qualityScore: 82,
  });

  addSectionDeal({
    pattern: /jö äpp day/i,
    title: 'jö äpp Day',
    extra: ['Jeden Dienstag neue Vorteilsbons in der jö äpp.'],
    expires: 'Jeden Dienstag',
    type: 'rabatt',
    qualityScore: 80,
  });

  addSectionDeal({
    pattern: /jö einkaufsbonus/i,
    title: 'jö Einkaufsbonus',
    extra: ['100 Ös entsprechen 1 Euro Vergünstigung an der Kassa.'],
    expires: 'Regelmäßig',
    type: 'rabatt',
    qualityScore: 79,
  });

  addSectionDeal({
    pattern: /frisch gekocht magazin/i,
    title: 'Frisch Gekocht Magazin gratis',
    brand: 'BILLA',
    category: 'essen',
    type: 'gratis',
    qualityScore: 74,
  });

  addSectionDeal({
    pattern: /frisch gekocht kids magazin/i,
    title: 'Frisch Gekocht Kids Magazin gratis',
    brand: 'BILLA',
    category: 'essen',
    type: 'gratis',
    qualityScore: 72,
  });

  addSectionDeal({
    pattern: /probier mal was neues|produktneuheiten/i,
    title: 'BILLA PLUS: Probier mal was Neues',
    brand: 'BILLA PLUS',
    distance: 'BILLA PLUS Wien',
    category: 'supermarkt',
    expires: 'Regelmäßig',
    type: 'gratis',
    qualityScore: 77,
  });

  addSectionDeal({
    pattern: /voller vorteile|spielwaren/i,
    title: 'BILLA PLUS: Voller Vorteile Regal',
    brand: 'BILLA PLUS',
    distance: 'BILLA PLUS Wien',
    category: 'shopping',
    expires: 'Regelmäßig',
    type: 'rabatt',
    qualityScore: 70,
  });

  addSectionDeal({
    pattern: /jö\.reisen/i,
    title: 'jö.REISEN Vorteile',
    brand: 'BILLA Reisen',
    distance: 'Online / Österreich',
    category: 'reisen',
    url: 'https://www.billareisen.at/',
    expires: 'Kurzfristig wechselnd',
    type: 'rabatt',
    qualityScore: 76,
  });

  return deals;
}

async function extractOmvJoePage(page, source) {
  await acceptJoeCookies(page);
  await page.waitForTimeout(1200);
  const pageData = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5'))
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean);
    const listItems = Array.from(document.querySelectorAll('li'))
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean);
    const text = document.body.innerText || '';
    const links = Array.from(document.querySelectorAll('a[href]')).map((link) => ({
      text: (link.innerText || '').trim(),
      href: link.href,
    }));
    return { text, links, headings, listItems };
  });

  const text = cleanText(pageData.text);
  const deals = [];

  const findLink = (pattern, fallback = source.url) => {
    const match = pageData.links.find((entry) => pattern.test(`${entry.text} ${entry.href}`));
    return match?.href || fallback;
  };

  const addOmvDeal = ({
    title,
    description,
    brand,
    category,
    type,
    url,
    distance = source.distance,
    qualityScore = 80,
  }) => {
    const deal = buildDeal({
      prefix: 'joe-omv',
      title,
      description,
      brand,
      source: source.source,
      url,
      expires: 'Regelmäßig',
      distance,
      category,
      type,
      qualityScore,
    });
    if (deal) deals.push(deal);
  };

  if (/3 Cent pro Liter Rabatt/i.test(text) && /MaxxMotion/i.test(text)) {
    addOmvDeal({
      title: 'OMV MaxxMotion: 3 Cent pro Liter Rabatt',
      description: makeDescription([
        'Über jö gibt es bei OMV 3 Cent pro Liter Rabatt auf OMV MaxxMotion Performance Fuels.',
        'Laut jö Partnerseite gültig für eine Tankmenge von 100 Litern pro Einlösung.',
      ]),
      brand: 'OMV MaxxMotion',
      category: 'reisen',
      type: 'rabatt',
      url: findLink(/teilnehmenden OMV Stationen|OMV Webseite/i, source.url),
      qualityScore: 83,
    });
  }

  if (/50%\s+auf alle VIVA Kaffeespezialitäten/i.test(text) && /75 Ös/i.test(text)) {
    addOmvDeal({
      title: 'OMV VIVA: 50% auf Kaffeespezialitäten',
      description: makeDescription([
        'Über jö gibt es bei OMV VIVA 50% Rabatt auf alle VIVA Kaffeespezialitäten für 75 Ös.',
        'Einlösung laut OMV an teilnehmenden Stationen an der Kassa.',
      ]),
      brand: 'OMV VIVA',
      category: 'kaffee',
      type: 'rabatt',
      url: findLink(/OMV Webseite|teilnehmenden OMV Stationen/i),
      qualityScore: 86,
    });
  }

  if (/50%\s+auf alle VIVA Sandwiches/i.test(text) && /100 Ös/i.test(text)) {
    addOmvDeal({
      title: 'OMV VIVA: 50% auf Sandwiches',
      description: makeDescription([
        'Über jö gibt es bei OMV VIVA 50% Rabatt auf alle VIVA Sandwiches inklusive Leberkäs-Semmel für 100 Ös.',
        'Einlösung laut OMV an teilnehmenden Stationen an der Kassa.',
      ]),
      brand: 'OMV VIVA',
      category: 'essen',
      type: 'rabatt',
      url: findLink(/OMV Webseite|teilnehmenden OMV Stationen/i),
      qualityScore: 85,
    });
  }

  if (/30%\s+auf Top Wash Top\/Sensation/i.test(text) && /150 Ös/i.test(text)) {
    addOmvDeal({
      title: 'OMV TopWash: 30% Rabatt',
      description: makeDescription([
        'Über jö gibt es bei OMV 30% Rabatt auf Top Wash Top oder Sensation für 150 Ös.',
        'Einlösung laut OMV an teilnehmenden OMV Stationen an der Kassa.',
      ]),
      brand: 'OMV TopWash',
      category: 'reisen',
      type: 'rabatt',
      url: findLink(/OMV Webseite|teilnehmenden OMV Stationen/i),
      distance: 'OMV TopWash Wien',
      qualityScore: 78,
    });
  }

  return deals;
}

async function extractBipaJoePage(page, source) {
  await acceptJoeCookies(page);
  await page.waitForTimeout(1200);
  const text = cleanText(await page.locator('body').innerText());
  const deals = [];
  const actionLink = 'https://www.bipa.at/cp/joe-bonusclub';

  if (/Bis zu -20% Rabatt/i.test(text) && /Rabattsammler/i.test(text)) {
    deals.push(buildDeal({
      prefix: 'joe-bipa',
      title: 'BIPA jö Rabattsammler: bis zu -20%',
      description: makeDescription([
        'Laut jö Partnerseite ist der BIPA jö Rabattsammler einmal pro Monat bei einem Einkauf einlösbar.',
        'Es sind bis zu -20% Rabatt auf den Einkauf möglich.',
      ]),
      brand: 'BIPA',
      source: source.source,
      url: actionLink,
      expires: 'Monatlich',
      distance: source.distance,
      category: 'beauty',
      type: 'rabatt',
      qualityScore: 82,
    }));
  }

  if (/100 Ös/i.test(text) && /1 Euro/i.test(text) && /Einkaufsbonus/i.test(text)) {
    deals.push(buildDeal({
      prefix: 'joe-bipa',
      title: 'BIPA jö Einkaufsbonus: 100 Ös = 1€',
      description: makeDescription([
        'Auf der jö Partnerseite wird der BIPA Einkaufsbonus als direkter Kassarabatt beschrieben.',
        'Für 100 Ös reduziert sich die Rechnung um 1 Euro.',
      ]),
      brand: 'BIPA',
      source: source.source,
      url: actionLink,
      expires: 'Regelmäßig',
      distance: source.distance,
      category: 'beauty',
      type: 'rabatt',
      qualityScore: 78,
    }));
  }

  return deals.filter(Boolean);
}

function dedupeDeals(deals) {
  const deduped = [];
  const seen = new Set();

  for (const deal of deals) {
    if (!deal) continue;
    const key = `${deal.title}|${deal.url}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(deal);
  }

  return deduped;
}

async function main() {
  console.log('💎 JÖ SCRAPER (PLAYWRIGHT)');
  console.log('========================================');

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const allDeals = [];

    for (const source of SOURCES) {
      console.log(`🔎 ${source.url}`);
      const page = await openPage(browser, source.url);

      try {
        let deals = [];
        if (source.key === 'billa-actions') {
          deals = await extractActionsPage(page, source);
        } else if (source.key === 'joe-benefits') {
          deals = await extractJoeBenefitsPage(page, source);
        } else if (source.key === 'omv-joe') {
          deals = await extractOmvJoePage(page, source);
        } else if (source.key === 'bipa-joe') {
          deals = await extractBipaJoePage(page, source);
        }

        console.log(`   ↳ ${deals.length} jö Deals`);
        allDeals.push(...deals);
      } finally {
        await page.close();
      }
    }

    const deduped = dedupeDeals(allDeals);
    const payload = {
      lastUpdated: new Date().toISOString(),
      source: 'joe-scraper',
      totalDeals: deduped.length,
      deals: deduped,
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    console.log(`💾 ${deduped.length} Deals → ${OUTPUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('❌ joe scraper failed:', error);
  process.exit(1);
});
