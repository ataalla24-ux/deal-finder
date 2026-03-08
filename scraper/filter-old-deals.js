// ============================================
// 🗑️ FILTER OLD DEALS - Post-Processing
// Entfernt abgelaufene/alte Deals aus allen pending files
// Läuft NACH Scrapern, VOR slack-notify
// ============================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isVagueExpiry, normalizeDealExpiry, parseExpiryDetails } from './expiry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.join(__dirname, '..', 'docs');

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const NOW = new Date();
const TWO_WEEKS_AGO = new Date(NOW.getTime() - TWO_WEEKS_MS);
const MAX_URL_EXPIRY_CHECKS = 40;
const TRUSTED_IG_PUBDATE_SOURCES = new Set(['ldDate', 'timeDatetime', 'igScriptTimestamp']);

// ============================================
// Deal-Alter prüfen
// ============================================

function isExpiredOrOld(deal) {
  const sourceText = String(deal.source || '').toLowerCase();
  const isInstagramDeal = sourceText.includes('instagram');
  if (isInstagramDeal && !TRUSTED_IG_PUBDATE_SOURCES.has(String(deal.pubDateSource || ''))) {
    return { expired: true, reason: 'Instagram-Deal ohne vertrauenswürdige pubDateSource' };
  }

  const dateFields = [
    deal.validity_date,
    deal.end_date,
    deal.expires,
    deal.start_date,
  ].filter(Boolean);

  for (const field of dateFields) {
    const parsed = parseExpiryDetails(field, { now: NOW })?.date;
    if (parsed instanceof Date && parsed < NOW) {
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
        const rawExpiry = String(deal.expires || deal.end_date || deal.validity_date || '').trim();
        const parsedExpiry = parseExpiryDetails(rawExpiry, { now: NOW });
        const wantsUrlLookup = Boolean(
          deal.url &&
          (
            isVagueExpiry(rawExpiry) ||
            !parsedExpiry?.date ||
            parsedExpiry.precision !== 'day'
          )
        );
        const cacheHadUrl = deal.url ? urlExpiryCache.has(deal.url) : false;
        const allowUrlLookup = wantsUrlLookup && (cacheHadUrl || urlChecksUsed < MAX_URL_EXPIRY_CHECKS);
        const hadUrlExpiry = Boolean(deal.expiresDetectedFromUrl);

        await normalizeDealExpiry(deal, {
          now: NOW,
          urlCache: urlExpiryCache,
          allowUrlLookup,
        });

        if (allowUrlLookup && deal.url && !cacheHadUrl && urlExpiryCache.has(deal.url)) {
          urlChecksUsed += 1;
        }
        if (!hadUrlExpiry && deal.expiresDetectedFromUrl) {
          urlExpiryHits += 1;
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
