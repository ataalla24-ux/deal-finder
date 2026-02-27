import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-joe.json');

const SOURCES = [
  {
    key: 'billa-actions',
    url: 'https://www.billa.at/unsere-aktionen/aktionen',
    brand: 'BILLA',
    source: 'jö Bonus Club',
    distance: 'BILLA & BILLA PLUS Wien',
  },
];

const USER_AGENT = 'Mozilla/5.0 (compatible; FreeFinderBot/1.0; +https://freefinder.wien)';

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

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/\\u003Cbr\\u003E/gi, ' ')
    .replace(/\\u003C[^>]+\\u003E/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\u0026nbsp;/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\"/g, '"')
    .replace(/\\u00a0/gi, ' ')
    .replace(/\\u20ac/gi, 'EUR')
    .replace(/\\u2011/gi, '-')
    .replace(/\\u2013|\\u2014/gi, '-')
    .replace(/\\u00d6/g, 'Ö')
    .replace(/\\u00f6/g, 'ö')
    .replace(/\\u00e4/g, 'ä')
    .replace(/\\u00fc/g, 'ü')
    .replace(/\\u00df/g, 'ß')
    .replace(/\uFFFD+/g, '‑')
    .replace(/<[^>]*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeUnicodeEscapes(value) {
  if (!value) return '';
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const req = transport.get(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
        'accept-encoding': 'identity',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        resolve(fetchText(nextUrl));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseGermanDateCandidate(text) {
  const value = cleanText(text).toLowerCase();
  if (!value) return null;

  let m = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    return new Date(`${m[3]}-${pad2(m[2])}-${pad2(m[1])}T12:00:00Z`);
  }

  m = value.match(/(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)?[,]?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (m) {
    return new Date(`${m[3]}-${pad2(m[2])}-${pad2(m[1])}T12:00:00Z`);
  }

  m = value.match(/(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)?[,]?\s*(\d{1,2})\.(\d{1,2})\.(?!\d)/i);
  if (m) {
    const year = new Date().getUTCFullYear();
    return new Date(`${year}-${pad2(m[2])}-${pad2(m[1])}T12:00:00Z`);
  }

  return null;
}

function formatIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function splitRawLines(value) {
  return String(value)
    .split(/\r?\n+/)
    .map(cleanText)
    .filter(Boolean);
}

function normalizeJoeTitle(value) {
  return cleanText(value)
    .replace(/[.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeJoeDetail(value) {
  return cleanText(value)
    .replace(/\.\s*-\s*/g, ' - ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/[.]+$/g, '')
    .trim();
}

function sentence(value) {
  const text = cleanText(value);
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function extractBillaExtremBonDeals(html, source) {
  const deals = [];
  const nowIso = new Date().toISOString();
  const normalized = decodeUnicodeEscapes(html);

  const validityMatch = normalized.match(/Gültig von[\s\S]{0,250}?(\d{1,2}\.\d{1,2}\.?\s*)[\s\S]{0,120}?bis[\s\S]{0,120}?(\d{1,2}\.\d{1,2}\.\d{4})/i);
  const expiresDate = validityMatch ? parseGermanDateCandidate(validityMatch[2]) : null;
  const expiresIso = formatIsoDate(expiresDate);

  const teaserMatches = [...normalized.matchAll(/data-teaser-name="([^"]*Extrem[^"]+)"/g)];
  for (const match of teaserMatches) {
    const rawBlock = match[1];
    const description = cleanText(rawBlock);
    if (!description || !/(gratis|%|1\+1|ös|eur|€)/i.test(description)) continue;

    const lines = splitRawLines(rawBlock);
    const title = normalizeJoeTitle(lines[0] || 'jö Äpp Extrem Bon');
    const detail = normalizeJoeDetail(lines.slice(1).join(' - '));
    const finalDescription = [
      sentence(detail),
      'Nur mit gültiger jö Karte und jö Äpp Gutschein einlösbar.',
      expiresIso ? `Gültig bis ${new Date(expiresIso).toLocaleDateString('de-AT')}.` : '',
    ].filter(Boolean).join(' ');

    deals.push({
      id: dealId('joe', title, source.url),
      brand: source.brand,
      logo: '💎',
      title,
      description: finalDescription,
      type: /gratis|1\+1/i.test(description) ? 'gratis' : 'rabatt',
      badge: 'jö',
      category: 'supermarkt',
      source: source.source,
      url: source.url,
      expires: expiresIso || '',
      distance: source.distance,
      hot: true,
      isNew: true,
      qualityScore: 78,
      pubDate: nowIso,
      pubDateSource: 'sourcePage',
    });
  }

  const benefitBlocks = [
    {
      titleMatch: normalized.match(/jö äpp Extrem Bon\*/i),
      bodyMatch: normalized.match(/Holen Sie sich die wöchentlich wechselnden attraktiven Artikelaktionen[\s\S]{0,500}?noch mehr sparen\./i),
      title: 'jö Äpp Extrem Bon bei BILLA',
      category: 'supermarkt',
      type: 'rabatt',
    },
    {
      titleMatch: normalized.match(/1\.000 Ös Aktion gültig/i),
      bodyMatch: normalized.match(/1\.000 Ös Aktion gültig[\s\S]{0,700}?Rechtsweg ist ausgeschlossen\./i),
      title: '1.000 Ös Aktion bei BILLA Reisen',
      category: 'reisen',
      type: 'gratis',
    },
  ];

  for (const block of benefitBlocks) {
    if (!block.titleMatch || !block.bodyMatch) continue;
    const body = cleanText(block.bodyMatch[0]);
    const title = block.title;
    let expires = null;
    if (title.includes('Reisen')) {
      const bookingUntil = body.match(/Neubuchungen zwischen dem \d{1,2}\.\d{1,2}\.\d{4} und (\d{1,2}\.\d{1,2}\.\d{4})/i);
      expires = bookingUntil ? parseGermanDateCandidate(bookingUntil[1]) : null;
    }
    if (!expires) {
      const expiryCandidates = [...body.matchAll(/(\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\.\d{1,2}\.)/g)]
        .map((m) => parseGermanDateCandidate(m[1]))
        .filter(Boolean);
      expires = expiryCandidates.length ? expiryCandidates[expiryCandidates.length - 1] : null;
    }

    deals.push({
      id: dealId('joe', title, source.url),
      brand: title.includes('Reisen') ? 'BILLA Reisen' : source.brand,
      logo: title.includes('Reisen') ? '✈️' : '💎',
      title,
      description: body,
      type: block.type,
      badge: 'jö',
      category: block.category,
      source: source.source,
      url: title.includes('Reisen') ? 'https://www.billareisen.at/' : source.url,
      expires: formatIsoDate(expires),
      distance: title.includes('Reisen') ? 'Online / Österreich' : source.distance,
      hot: true,
      isNew: true,
      qualityScore: 74,
      pubDate: nowIso,
      pubDateSource: 'sourcePage',
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const deal of deals) {
    const key = `${deal.title}|${deal.description}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!deal.expires) continue;
    if (deal.expires) {
      const ts = new Date(deal.expires).getTime();
      if (!Number.isNaN(ts) && ts < Date.now()) continue;
    }
    deduped.push(deal);
  }
  return deduped;
}

async function main() {
  console.log('💎 JOE SCRAPER');
  console.log('========================================');

  const allDeals = [];
  for (const source of SOURCES) {
    try {
      console.log(`🔎 ${source.url}`);
      const html = await fetchText(source.url);
      const deals = extractBillaExtremBonDeals(html, source);
      console.log(`   ↳ ${deals.length} jö Deals`);
      allDeals.push(...deals);
    } catch (error) {
      console.log(`   ❌ ${error.message}`);
    }
  }

  const payload = {
    lastUpdated: new Date().toISOString(),
    source: 'joe-scraper',
    totalDeals: allDeals.length,
    deals: allDeals,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`💾 ${allDeals.length} Deals → ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error('❌ joe scraper failed:', error);
  process.exit(1);
});
