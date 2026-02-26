// ============================================
// 🗑️ FILTER OLD DEALS - Post-Processing
// Entfernt abgelaufene/alte Deals aus allen pending files
// Läuft NACH Scrapern, VOR slack-notify
// ============================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.join(__dirname, '..', 'docs');

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const NOW = new Date();
const TWO_WEEKS_AGO = new Date(NOW.getTime() - TWO_WEEKS_MS);
const MAX_URL_EXPIRY_CHECKS = 40;
const URL_CHECK_TIMEOUT_MS = 7000;
const URL_CHECK_UA = 'Mozilla/5.0 (compatible; FreeFinderBot/1.0; +https://freefinder.wien)';

// ============================================
// Deutsche Datumsformate parsen
// ============================================

const MONTH_MAP = {
  'jänner': 0, 'januar': 0, 'january': 0, 'jan': 0,
  'februar': 1, 'february': 1, 'feb': 1,
  'märz': 2, 'march': 2, 'mar': 2, 'mär': 2,
  'april': 3, 'apr': 3,
  'mai': 4, 'may': 4,
  'juni': 5, 'june': 5, 'jun': 5,
  'juli': 6, 'july': 6, 'jul': 6,
  'august': 7, 'aug': 7,
  'september': 8, 'sep': 8, 'sept': 8,
  'oktober': 9, 'october': 9, 'okt': 9, 'oct': 9,
  'november': 10, 'nov': 10,
  'dezember': 11, 'december': 11, 'dez': 11, 'dec': 11,
};

function parseGermanDate(str) {
  if (!str || typeof str !== 'string') return null;
  str = str.trim().toLowerCase();

  // Skip vague strings
  if (/^(siehe|unbekannt|dauerhaft|unbegrenzt|jederzeit|laufend|täglich|monatlich|solange)/i.test(str)) return null;

  // ISO: 2026-02-19
  let m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));

  // DD.MM.YYYY
  m = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));

  // DD.MM.YY
  m = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/);
  if (m) return new Date(2000 + parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));

  // DD.MM. (ohne Jahr → aktuelles Jahr)
  m = str.match(/(\d{1,2})\.(\d{1,2})\./);
  if (m) {
    const d = new Date(NOW.getFullYear(), parseInt(m[2]) - 1, parseInt(m[1]));
    return d;
  }

  // "19. Februar 2026" / "19 Februar" / "February 18, 2026"
  m = str.match(/(\d{1,2})\.?\s+(jänner|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/);
  if (m) {
    const month = MONTH_MAP[m[2]];
    if (month !== undefined) {
      const year = m[3] ? parseInt(m[3]) : NOW.getFullYear();
      return new Date(year, month, parseInt(m[1]));
    }
  }

  // "February 18, 2026" (English format from Instagram)
  m = str.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s*(\d{4})?/);
  if (m) {
    const month = MONTH_MAP[m[1]];
    if (month !== undefined) {
      const year = m[3] ? parseInt(m[3]) : NOW.getFullYear();
      return new Date(year, month, parseInt(m[2]));
    }
  }

  // Range: "19.-21.02." → nimm das Ende-Datum
  m = str.match(/\d{1,2}\.\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})?/);
  if (m) {
    const year = m[3] ? parseInt(m[3]) : NOW.getFullYear();
    return new Date(year, parseInt(m[2]) - 1, parseInt(m[1]));
  }

  // "Bis DD.MM.YYYY"
  m = str.match(/bis\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));

  return null;
}

function isVagueExpiry(str) {
  if (!str || typeof str !== 'string') return true;
  const s = str.trim().toLowerCase();
  if (!s) return true;
  return /^(siehe|unbekannt|dauerhaft|unbegrenzt|jederzeit|laufend|täglich|monatlich|solange|unknown|ongoing|k\.a\.?)/i.test(s);
}

function extractExpiryDateFromHtml(html) {
  if (!html) return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const phrases = [
    /(?:gültig\s*bis|einlösbar\s*bis|aktion\s*bis|angebot\s*bis|läuft\s*bis|nur\s*bis|endet\s*am|ends?\s*(?:on)?|until)\s*[:\-]?\s*([^.!,;\n]{4,70})/gi,
  ];

  for (const re of phrases) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const candidate = m[1].trim();
      const parsed = parseGermanDate(candidate);
      if (parsed) return parsed;
    }
  }

  const dateLike = text.match(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\.\s*(?:jänner|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*\d{0,4}\b/gi) || [];
  for (const token of dateLike.slice(0, 20)) {
    const parsed = parseGermanDate(token);
    if (parsed) return parsed;
  }

  return null;
}

async function fetchExpiryFromUrl(url) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': URL_CHECK_UA,
        'accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('text/html') && !ctype.includes('application/xhtml+xml')) return null;
    const html = await res.text();
    return extractExpiryDateFromHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// Deal-Alter prüfen
// ============================================

function isExpiredOrOld(deal) {
  const dateFields = [
    deal.validity_date,
    deal.end_date,
    deal.expires,
    deal.start_date,
  ].filter(Boolean);

  for (const field of dateFields) {
    const parsed = parseGermanDate(field);
    if (parsed && parsed < NOW) {
      return { expired: true, reason: `"${field}" → ${parsed.toLocaleDateString('de-AT')} ist abgelaufen` };
    }
  }

  // pubDate-Check: Auch wenn Scraper Date.now() setzen,
  // filtere alles raus was definitiv älter als 2 Wochen ist
  if (deal.pubDate) {
    const pub = new Date(deal.pubDate);
    if (!isNaN(pub) && pub < TWO_WEEKS_AGO) {
      return { expired: true, reason: `pubDate "${deal.pubDate}" → ${pub.toLocaleDateString('de-AT')} ist älter als 2 Wochen` };
    }
  }

  return { expired: false };
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🗑️  FILTER OLD DEALS');
  console.log('='.repeat(40));
  console.log(`📅 Heute: ${NOW.toLocaleDateString('de-AT')}`);
  console.log(`📅 Ablaufdatum-Filter: expires/validity < heute, pubDate-Filter: < ${TWO_WEEKS_AGO.toLocaleDateString('de-AT')}`);
  console.log();

  if (!fs.existsSync(docsDir)) {
    console.log('⚠️ docs/ Verzeichnis nicht gefunden');
    process.exit(0);
  }

  const files = fs.readdirSync(docsDir).filter(f => f.startsWith('deals-pending-') && f.endsWith('.json'));

  if (files.length === 0) {
    console.log('📭 Keine pending Deal-Dateien gefunden');
    process.exit(0);
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let totalRemoved = 0;
  let urlChecksUsed = 0;
  let urlExpiryHits = 0;
  const urlExpiryCache = new Map();

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const deals = data.deals || [];
      const before = deals.length;
      totalBefore += before;

      const freshDeals = [];
      const removedDeals = [];

      for (const deal of deals) {
        if (isVagueExpiry(deal.expires) && deal.url && urlChecksUsed < MAX_URL_EXPIRY_CHECKS) {
          let parsedDate = urlExpiryCache.get(deal.url);
          if (parsedDate === undefined) {
            parsedDate = await fetchExpiryFromUrl(deal.url);
            urlExpiryCache.set(deal.url, parsedDate || null);
            urlChecksUsed += 1;
          }
          if (parsedDate instanceof Date && !Number.isNaN(parsedDate.getTime())) {
            deal.expires = parsedDate.toISOString();
            deal.expiresDetectedFromUrl = true;
            urlExpiryHits += 1;
          }
        }

        const check = isExpiredOrOld(deal);
        if (check.expired) {
          removedDeals.push({ title: deal.title || deal.brand || '?', reason: check.reason });
        } else {
          freshDeals.push(deal);
        }
      }

      const removed = before - freshDeals.length;
      totalRemoved += removed;
      totalAfter += freshDeals.length;

      // Update file
      data.deals = freshDeals;
      data.totalDeals = freshDeals.length;
      data.filteredAt = NOW.toISOString();
      data.removedCount = removed;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

      console.log(`📂 ${file}: ${before} → ${freshDeals.length} (${removed} entfernt)`);
      for (const r of removedDeals.slice(0, 5)) {
        console.log(`   🗑️  ${r.title.substring(0, 40)} — ${r.reason}`);
      }
      if (removedDeals.length > 5) {
        console.log(`   ... und ${removedDeals.length - 5} weitere`);
      }
    } catch (e) {
      console.log(`❌ ${file}: ${e.message}`);
    }
  }

  console.log();
  console.log(`🔎 URL-Expiry checks: ${urlChecksUsed}/${MAX_URL_EXPIRY_CHECKS}, Treffer: ${urlExpiryHits}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 GESAMT: ${totalBefore} → ${totalAfter} Deals (${totalRemoved} entfernt)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
